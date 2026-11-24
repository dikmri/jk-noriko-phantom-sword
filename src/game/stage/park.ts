/**
 * 森林公園。まん中に深さのある池（地面を掘ってある）。池のまわりには柵があり、橋で渡れる。
 * 仕掛け: 池に落ちた敵は沈む／ぬれる、浮く物（ボート・木・看板）、噴き上がる噴水、シーソー。
 */
import * as THREE from 'three';
import { G, groups, RAPIER } from '../../core/physics';
import { log } from '../../log';
import type { Enemy } from '../enemies';
import type { Game } from '../game';
import { ARENA, Prop, WorldMap } from '../world';
import { DAY_SKY, Stage } from './index';
import { grass, gravel, water } from './textures';

/** 池の中心と半径（楕円） */
const PX = 0;
const PZ = 20;
const RX = 30;
const RZ = 17;
/** 池の深さと水面の高さ */
const DEPTH = 2.4;
const WATER_Y = -0.35;
/** 底が一番深くなる位置（楕円の大きさに対する割合） */
const FLAT = 0.72;
/** 地面を細かく分けて掘る範囲 */
const BX0 = -36;
const BX1 = 36;
const BZ0 = -2;
const BZ1 = 42;
const STEP = 1.5;
/** 橋（南北方向、x = 0） */
const BRIDGE_W = 1.8;
const BRIDGE_Y = 0.3;
const FOUNTAIN = { x: 0, z: -34 };
const S = { sleep: true };

/** 池の楕円の上で 1 になる値（中心 0）。 */
function ell(x: number, z: number): number {
  return Math.hypot((x - PX) / RX, (z - PZ) / RZ);
}

function groundY(x: number, z: number): number {
  const e = ell(x, z);
  if (e >= 1) return 0;
  const t = Math.min(1, (1 - e) / (1 - FLAT));
  return -DEPTH * t * t * (3 - 2 * t);
}

function onBridge(x: number, z: number): boolean {
  return Math.abs(x - PX) < BRIDGE_W + 0.2 && z > PZ - RZ - 2 && z < PZ + RZ + 2;
}

export function park(g: Game, w: WorldMap): Stage {
  const drowning = new Set<Enemy>();
  const splashed = new WeakSet<Enemy>();
  /** 水に浸かっている秒数 */
  const soak = new Map<Enemy, number>();
  let fountainT = 5;
  let fountainPhase: 'idle' | 'bubble' | 'burst' = 'idle';
  let column: THREE.Mesh | null = null;
  let waterTex: THREE.Texture | null = null;
  const ducks: { sp: THREE.Sprite; a: number; r: number; v: number }[] = [];
  let drowned = 0;

  const inWater = (x: number, z: number) => ell(x, z) < 1 && !onBridge(x, z);

  return {
    start: { x: 0, z: -52 },
    sky: DAY_SKY,
    build() {
      // 掘った部分のまわりの、平らな芝生（4 枚）
      const big = ARENA * 2 + 60;
      const half = big / 2;
      const planes: [number, number, number, number][] = [
        [-half, BZ0, half, -half],
        [-half, half, half, BZ1],
        [-half, BZ1, BX0, BZ0],
        [BX1, BZ1, half, BZ0],
      ];
      for (const [x0, z1, x1, z0] of planes) {
        const map = grass(1);
        map.repeat.set(Math.abs(x1 - x0) / 9.6, Math.abs(z1 - z0) / 9.6);
        w.floor(new THREE.MeshLambertMaterial({ map }), Math.abs(x1 - x0), Math.abs(z1 - z0), (x0 + x1) / 2, (z0 + z1) / 2);
      }
      pondBed(g, w);
      // 平らな地面の当たり判定（掘った範囲の外）
      const box = (cx: number, cz: number, hx: number, hz: number) =>
        w.staticCollider(RAPIER.ColliderDesc.cuboid(hx, 1, hz).setTranslation(cx, -1, cz).setCollisionGroups(groups(G.STATIC, 0xffff)).setFriction(0.9), 'ground');
      box(0, (BZ0 - (ARENA + 40)) / 2, ARENA + 40, (BZ0 + ARENA + 40) / 2);
      box(0, (BZ1 + ARENA + 40) / 2, ARENA + 40, (ARENA + 40 - BZ1) / 2);
      box((BX0 - (ARENA + 40)) / 2, (BZ0 + BZ1) / 2, (BX0 + ARENA + 40) / 2, (BZ1 - BZ0) / 2);
      box((BX1 + ARENA + 40) / 2, (BZ0 + BZ1) / 2, (ARENA + 40 - BX1) / 2, (BZ1 - BZ0) / 2);
      // 水面
      waterTex = water(1);
      waterTex.repeat.set(6, 4);
      const wm = new THREE.Mesh(new THREE.CircleGeometry(1, 48), new THREE.MeshLambertMaterial({ map: waterTex, color: 0xcfefff, transparent: true, opacity: 0.84, depthWrite: false }));
      wm.rotation.x = -Math.PI / 2;
      wm.scale.set(RX, RZ, 1);
      wm.position.set(PX, WATER_Y, PZ);
      wm.renderOrder = 3;
      w.root.add(wm);

      // 小道（砂利）
      const path = (x: number, z: number, pw: number, pd: number) => {
        const map = gravel(1);
        map.repeat.set(pw / 4, pd / 4);
        w.floor(new THREE.MeshLambertMaterial({ map }), pw, pd, x, z, 0.02, 1);
      };
      path(0, -46, 5, 52);
      path(0, 57, 5, 30);
      path(0, -34, 120, 5);
      const ring = new THREE.Mesh(new THREE.RingGeometry(1.05, 1.22, 64), new THREE.MeshLambertMaterial({ color: 0xd9c9a4 }));
      ring.rotation.x = -Math.PI / 2;
      ring.scale.set(RX, RZ, 1);
      ring.position.set(PX, 0.015, PZ);
      ring.receiveShadow = true;
      w.root.add(ring);
      const plaza = new THREE.Mesh(new THREE.CircleGeometry(12, 40), new THREE.MeshLambertMaterial({ color: 0xd9c9a4 }));
      plaza.rotation.x = -Math.PI / 2;
      plaza.position.set(FOUNTAIN.x, 0.025, FOUNTAIN.z);
      w.root.add(plaza);

      w.bounds(new THREE.MeshLambertMaterial({ color: 0x6f9a52 }), 1.6);
      w.skyline([0xdfe8d0, 0xd9e6f2, 0xf2e6d0, 0xe8e8e8], 6, 22);

      railing(w);
      bridge(w);
      fountain(w);
      seesaw(g, w, -46, -24, 0);
      seesaw(g, w, -46, -16, 0);
      playground(w);

      // ---- 木（桜並木と、外周の林）
      const rng = g.rng;
      for (let k = 0; k < 12; k++) {
        for (const side of [-1, 1]) {
          const z = -66 + k * 5.2;
          if (Math.abs(z - FOUNTAIN.z) < 13) continue;
          w.spawnProp('tree', { x: side * 6, y: 0, z }, rng() * 6, { scale: 0.9 + rng() * 0.3 });
        }
      }
      for (let k = 0; k < 46; k++) {
        const a = rng() * Math.PI * 2;
        const r = 48 + rng() * 18;
        const x = Math.cos(a) * r;
        const z = Math.sin(a) * r;
        if (w.free(x, z, 1) && ell(x, z) > 1.3 && Math.abs(x) > 8) w.spawnProp('tree', { x, y: 0, z }, rng() * 6, { scale: 0.8 + rng() * 0.5 });
      }
      // ---- 街灯・ベンチ・ゴミ箱
      for (let k = 0; k < 10; k++) {
        const a = (k / 10) * Math.PI * 2 + 0.3;
        const x = PX + Math.cos(a) * RX * 1.3;
        const z = PZ + Math.sin(a) * RZ * 1.3;
        if (onBridge(x, z) || Math.abs(x) < 4) continue;
        w.spawnProp('lamp', { x, y: 0, z }, 0, {});
        w.spawnProp('bench', { x: x + Math.cos(a) * 2.2, y: 0.005, z: z + Math.sin(a) * 2.2 }, -a + Math.PI / 2, S);
      }
      for (let k = 0; k < 8; k++) {
        const { x, z } = w.pickSpot(14, 60, 3, 0, -10);
        w.spawnProp('trash', { x, y: 0.005, z }, 0, S);
      }
      // ---- 売店とボート乗り場
      w.addBuilding(36, -48, 4, 3, 1, { doors: [{ side: 'front', at: 1 }] });
      for (let k = 0; k < 3; k++) w.spawnProp('vending', { x: 37 + k * 1.1, y: 0.005, z: -39.6 }, 0, S);
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2;
        w.spawnProp('boat', { x: PX + Math.cos(a) * RX * 0.5, y: WATER_Y - 0.3, z: PZ + Math.sin(a) * RZ * 0.5 }, a, {});
      }
      // ---- 段ボール（「売店の在庫」）とドラム缶
      const nBarrel = Math.round(4 * g.rule.barrels);
      for (let i = 0; i < nBarrel; i++) {
        const { x, z } = w.pickSpot(12, 60, 3, 0, -10);
        w.spawnProp('barrel', { x, y: 0.005, z }, 0, S);
      }
      // ---- 池のカモ（飾り）
      for (let k = 0; k < 6; k++) {
        const sp = duckSprite();
        w.root.add(sp);
        ducks.push({ sp, a: Math.random() * 6, r: 0.25 + Math.random() * 0.45, v: (Math.random() < 0.5 ? -1 : 1) * (0.05 + Math.random() * 0.06) });
      }
    },

    surface(x, z, out) {
      if (inWater(x, z)) {
        out.water = true;
        out.speed = 0.5;
        out.grip = 0.6;
      }
    },

    spawnOk(x, z) {
      return ell(x, z) > 1.12 && !onBridge(x, z) && Math.hypot(x - FOUNTAIN.x, z - FOUNTAIN.z) > 4.5;
    },

    update(dt) {
      if (waterTex) {
        waterTex.offset.x += dt * 0.012;
        waterTex.offset.y += dt * 0.007;
      }
      for (const d of ducks) {
        d.a += d.v * dt * 3;
        d.sp.position.set(PX + Math.cos(d.a) * RX * d.r, WATER_Y + 0.25 + Math.sin(g.time * 3 + d.a) * 0.03, PZ + Math.sin(d.a) * RZ * d.r);
      }
      // ---- 池: ぬれる・沈む
      for (const e of g.enemies.list) {
        if (!e.alive || drowning.has(e)) continue;
        if (!inWater(e.x, e.z)) {
          soak.delete(e);
          continue;
        }
        g.enemies.wetIt(e, 4);
        if (e.y > WATER_Y + 0.6) continue;
        if (!splashed.has(e)) {
          splashed.add(e);
          splash(g, e.x, e.z, 1);
        }
        // 深い所に落ちたらすぐ、浅い所でも水に浸かったままなら少しして沈む（柵があるので自分では岸に上がれない）
        const t = (soak.get(e) ?? 0) + dt;
        soak.set(e, t);
        if (e.y > WATER_Y - 0.5 && t < 1.2) continue;
        soak.delete(e);
        if (e.def.boss) {
          // ボスは泳いで岸に上がってくる
          const a = Math.atan2((e.z - PZ) / RZ, (e.x - PX) / RX);
          e.body.setTranslation({ x: PX + Math.cos(a) * RX * 1.15, y: e.halfH + e.radius + 0.4, z: PZ + Math.sin(a) * RZ * 1.15 }, true);
          e.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
          splash(g, e.x, e.z, 1.6);
          continue;
        }
        // 沈む: 当たり判定を消して、ゆっくり底へ
        drowning.add(e);
        drowned++;
        if (e.state !== 'dead') {
          g.fx.number({ x: e.x, y: WATER_Y + 1.4, z: e.z }, 'ドボン', 'chain');
          g.enemies.kill(e, 'drown');
        }
        e.col.setCollisionGroups(groups(G.ENEMY, 0));
        e.body.setLinearDamping(3.5);
        if (drowned % 10 === 1) log('park.drown', {}, { total: drowned, time: Math.round(g.time) });
      }
      for (const e of drowning) if (!e.alive) drowning.delete(e);
      // ---- 浮く物
      for (const p of w.props) floatProp(p, inWater, dt);
      // ---- 噴水
      fountainT -= dt;
      if (fountainPhase === 'idle' && fountainT <= 1.2) {
        fountainPhase = 'bubble';
      }
      if (fountainPhase === 'bubble') {
        if (Math.random() < dt * 30) g.fx.spawn({ pos: { x: FOUNTAIN.x + (Math.random() - 0.5) * 3, y: 0.7, z: FOUNTAIN.z + (Math.random() - 0.5) * 3 }, vel: { x: 0, y: 2 + Math.random() * 2, z: 0 }, grav: -8, life: 0.5, size: 0.3, size2: 0.15, color: 0xdff4ff, shape: 0, alpha: 0.9 });
        if (fountainT <= 0) {
          fountainPhase = 'burst';
          fountainT = 1.4;
          burst(g, w);
          column ??= makeColumn(w);
          column.visible = true;
        }
      } else if (fountainPhase === 'burst') {
        if (column) {
          const k = Math.min(1, (1.4 - fountainT) / 0.15) * Math.min(1, fountainT / 0.4);
          column.scale.set(1, Math.max(0.01, k), 1);
        }
        if (Math.random() < dt * 60) {
          const a = Math.random() * Math.PI * 2;
          g.fx.spawn({ pos: { x: FOUNTAIN.x, y: 6 + Math.random() * 4, z: FOUNTAIN.z }, vel: { x: Math.cos(a) * 3, y: 2, z: Math.sin(a) * 3 }, grav: -14, life: 1, size: 0.5, size2: 0.2, color: 0xe8f8ff, shape: 0, alpha: 0.9 });
        }
        if (fountainT <= 0) {
          fountainPhase = 'idle';
          fountainT = 7 + Math.random() * 3;
          if (column) column.visible = false;
        }
      }
    },

    dispose() {
      drowning.clear();
      soak.clear();
    },
  };
}

/** 池の底（地面を掘った形）。見た目と当たり判定を同じ頂点から作る。 */
function pondBed(g: Game, w: WorldMap): void {
  const nx = Math.round((BX1 - BX0) / STEP);
  const nz = Math.round((BZ1 - BZ0) / STEP);
  const pos: number[] = [];
  const uv: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const mud = new THREE.Color(0x7a6a4a);
  const lawn = new THREE.Color(0xffffff);
  const c = new THREE.Color();
  for (let j = 0; j <= nz; j++) {
    for (let i = 0; i <= nx; i++) {
      const x = BX0 + i * STEP;
      const z = BZ0 + j * STEP;
      const y = groundY(x, z);
      pos.push(x, y, z);
      uv.push(x / 9.6, -z / 9.6);
      c.copy(lawn).lerp(mud, Math.min(1, -y / 0.4));
      col.push(c.r, c.g, c.b);
    }
  }
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i;
      const b = a + 1;
      const cc = a + nx + 1;
      const d = cc + 1;
      idx.push(a, cc, b, b, cc, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: grass(1), vertexColors: true }));
  m.receiveShadow = true;
  w.root.add(m);
  w.staticCollider(RAPIER.ColliderDesc.trimesh(new Float32Array(pos), new Uint32Array(idx)).setCollisionGroups(groups(G.STATIC, 0xffff)).setFriction(0.8), 'ground');
  void g;
}

/** 池のまわりの柵。見える柵は低いが、ノリコと歩いている敵は通れない（吹き飛んだ敵は越えて池に落ちる）。 */
function railing(w: WorldMap): void {
  const n = 72;
  const k = 1.05;
  const postMat = new THREE.MeshLambertMaterial({ color: 0x5a4632 });
  const posts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, 0.8, 0.12), postMat, n);
  const rails = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.08, 0.08), postMat, n);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  let pi = 0;
  let ri = 0;
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2;
    const a1 = ((i + 1) / n) * Math.PI * 2;
    const x0 = PX + Math.cos(a0) * RX * k;
    const z0 = PZ + Math.sin(a0) * RZ * k;
    const x1 = PX + Math.cos(a1) * RX * k;
    const z1 = PZ + Math.sin(a1) * RZ * k;
    const mx = (x0 + x1) / 2;
    const mz = (z0 + z1) / 2;
    // 橋の入口は空ける
    if (Math.abs(mx - PX) < BRIDGE_W + 0.6) continue;
    const len = Math.hypot(x1 - x0, z1 - z0);
    const yaw = Math.atan2(-(z1 - z0), x1 - x0);
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    m.compose(new THREE.Vector3(x0, 0.4, z0), q, new THREE.Vector3(1, 1, 1));
    posts.setMatrixAt(pi++, m);
    m.compose(new THREE.Vector3(mx, 0.72, mz), q, new THREE.Vector3(len, 1, 1));
    rails.setMatrixAt(ri++, m);
    w.staticCollider(
      RAPIER.ColliderDesc.cuboid(len / 2 + 0.05, 2.5, 0.08).setTranslation(mx, 2.5, mz).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }).setCollisionGroups(groups(G.RAIL, G.PLAYER | G.ENEMY)),
      'rail',
    );
  }
  posts.count = pi;
  rails.count = ri;
  posts.castShadow = rails.castShadow = true;
  w.root.add(posts, rails);
}

/** 池を南北に渡る橋（朱色の太鼓橋）。 */
function bridge(w: WorldMap): void {
  const red = new THREE.MeshLambertMaterial({ color: 0xc8402a });
  const deck = new THREE.MeshLambertMaterial({ color: 0x9a6a3a });
  const z0 = PZ - RZ - 1.5;
  const z1 = PZ + RZ + 1.5;
  const len = z1 - z0;
  const ramp = 4;
  // 坂（両端）と平らな部分
  const top = BRIDGE_Y;
  const slope = Math.atan2(top + 0.15, ramp);
  for (const [zc, rot] of [[z0 + ramp / 2 - 0.3, -slope], [z1 - ramp / 2 + 0.3, slope]] as const) {
    const half = { x: BRIDGE_W, y: 0.15, z: Math.hypot(ramp, top) / 2 + 0.05 };
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), rot);
    w.staticCollider(RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z).setTranslation(PX, top / 2 - 0.12, zc).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }).setCollisionGroups(groups(G.STATIC, 0xffff)), 'deco');
    const mm = new THREE.Mesh(new THREE.BoxGeometry(half.x * 2, half.y * 2, half.z * 2), deck);
    mm.position.set(PX, top / 2 - 0.12, zc);
    mm.quaternion.copy(q);
    mm.receiveShadow = mm.castShadow = true;
    w.root.add(mm);
  }
  const flat = len - ramp * 2 + 0.6;
  w.staticBox({ x: PX, y: top - 0.15, z: (z0 + z1) / 2 }, { x: BRIDGE_W, y: 0.15, z: flat / 2 }, 0, deck);
  // 欄干（見た目）と、ノリコ・歩く敵を止める壁
  for (const sx of [-1, 1]) {
    const x = PX + sx * (BRIDGE_W + 0.05);
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, len - 1), red);
    rail.position.set(x, top + 0.75, (z0 + z1) / 2);
    rail.castShadow = true;
    w.root.add(rail);
    for (let z = z0 + 1; z < z1 - 0.5; z += 2.4) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.9, 0.16), red);
      post.position.set(x, top + 0.35, z);
      w.root.add(post);
    }
    w.staticCollider(RAPIER.ColliderDesc.cuboid(0.08, 2.5, len / 2 - 0.5).setTranslation(x, 2.5, (z0 + z1) / 2).setCollisionGroups(groups(G.RAIL, G.PLAYER | G.ENEMY)), 'rail');
    // 欄干と池の柵のすき間をふさぐ（橋の両端で、池に入れないように）
    for (const zr of [PZ - RZ * 1.05, PZ + RZ * 1.05]) {
      w.staticCollider(RAPIER.ColliderDesc.cuboid(0.7, 2.5, 0.08).setTranslation(PX + sx * (BRIDGE_W + 0.65), 2.5, zr).setCollisionGroups(groups(G.RAIL, G.PLAYER | G.ENEMY)), 'rail');
    }
  }
  // 橋脚
  for (let z = z0 + 6; z < z1 - 4; z += 7) {
    for (const sx of [-1, 1]) w.staticBox({ x: PX + sx * (BRIDGE_W - 0.3), y: -DEPTH / 2, z }, { x: 0.18, y: DEPTH / 2 + 0.1, z: 0.18 }, 0, red);
  }
}

/** 噴水（石の縁と、まん中の柱）。 */
function fountain(w: WorldMap): void {
  const stone = new THREE.MeshLambertMaterial({ color: 0xbab3a6 });
  const wm = new THREE.MeshLambertMaterial({ color: 0x8fd0f0, transparent: true, opacity: 0.85 });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(3.2, 0.3, 8, 32), stone);
  ring.rotation.x = Math.PI / 2;
  ring.position.set(FOUNTAIN.x, 0.35, FOUNTAIN.z);
  ring.castShadow = ring.receiveShadow = true;
  w.root.add(ring);
  const pool = new THREE.Mesh(new THREE.CircleGeometry(3.1, 32), wm);
  pool.rotation.x = -Math.PI / 2;
  pool.position.set(FOUNTAIN.x, 0.3, FOUNTAIN.z);
  w.root.add(pool);
  w.staticCyl({ x: FOUNTAIN.x, y: 0, z: FOUNTAIN.z }, 0.55, 1.6, stone);
  const bowl = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 0.6, 0.35, 20), stone);
  bowl.position.set(FOUNTAIN.x, 1.6, FOUNTAIN.z);
  w.root.add(bowl);
}

function makeColumn(w: WorldMap): THREE.Mesh {
  const geo = new THREE.CylinderGeometry(0.7, 1.4, 11, 16, 1, true);
  geo.translate(0, 5.5, 0);
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xe0f6ff, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide }));
  m.position.set(FOUNTAIN.x, 1.6, FOUNTAIN.z);
  m.renderOrder = 4;
  w.root.add(m);
  return m;
}

/** 噴水が噴き上がる: 近くの敵・物・ノリコを打ち上げる。 */
function burst(g: Game, w: WorldMap): void {
  const R = 4.6;
  let n = 0;
  g.enemies.inRadius({ x: FOUNTAIN.x, y: 0, z: FOUNTAIN.z }, R, (e) => {
    g.enemies.wetIt(e, 5);
    if (e.def.boss) return;
    const dx = e.x - FOUNTAIN.x;
    const dz = e.z - FOUNTAIN.z;
    const d = Math.hypot(dx, dz) || 1;
    g.enemies.push(e, { x: (dx / d) * 3, y: 19, z: (dz / d) * 3 }, true);
    n++;
  });
  g.physics.querySphere({ x: FOUNTAIN.x, y: 1, z: FOUNTAIN.z }, R, G.PROP | G.DEBRIS, (o) => {
    const p = o.ref as Prop;
    if (o.kind === 'prop' && p.alive && !p.rooted) {
      p.body.applyImpulse({ x: 0, y: p.mass * 14, z: 0 }, true);
      w.heat(p, 3);
    }
  });
  const p = g.player;
  if (Math.hypot(p.pos.x - FOUNTAIN.x, p.pos.z - FOUNTAIN.z) < R) {
    const dx = p.pos.x - FOUNTAIN.x;
    const dz = p.pos.z - FOUNTAIN.z;
    const d = Math.hypot(dx, dz) || 1;
    p.launch((dx / d) * 4, 16, (dz / d) * 4);
  }
  splash(g, FOUNTAIN.x, FOUNTAIN.z, 2.4);
  g.fx.ring({ x: FOUNTAIN.x, y: 0.4, z: FOUNTAIN.z }, 0.5, R, 0xbfe8ff, 0.4);
  if (n > 0) log('park.fountain', {}, { launched: n });
}

function splash(g: Game, x: number, z: number, size: number): void {
  const at = { x, y: WATER_Y + 0.1, z };
  for (let i = 0; i < 8 + size * 6; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = 1.5 + Math.random() * 3 * size;
    g.fx.spawn({ pos: at, vel: { x: Math.cos(a) * sp, y: 3 + Math.random() * 4 * size, z: Math.sin(a) * sp }, grav: -14, life: 0.7, size: 0.3, size2: 0.12, color: 0xdff4ff, shape: 0, alpha: 0.9 });
  }
  g.fx.ring(at, 0.2, 1.2 * size, 0xdff4ff, 0.4);
  g.audio.splash(size);
}

/** 浮力: 水面より下に沈んでいる割合だけ上へ押し、水の抵抗で揺れを止める。 */
function floatProp(p: Prop, inWater: (x: number, z: number) => boolean, dt: number): void {
  if (!p.alive || p.rooted || p.dying >= 0) return;
  const b = p.body;
  if (b.isSleeping()) return;
  const t = b.translation();
  if (!inWater(t.x, t.z)) return;
  const bottom = t.y - p.half.y;
  if (bottom > WATER_Y) return;
  const sub = Math.min(1, (WATER_Y - bottom) / (p.half.y * 2));
  const f = p.def.float ?? 0;
  const m = p.mass;
  if (f > 0) b.applyImpulse({ x: 0, y: m * 22 * f * sub * dt, z: 0 }, true);
  const v = b.linvel();
  const drag = Math.min(1, 2.2 * sub * dt);
  b.setLinvel({ x: v.x * (1 - drag), y: v.y * (1 - drag * 1.5), z: v.z * (1 - drag) }, true);
  const av = b.angvel();
  b.setAngvel({ x: av.x * (1 - drag), y: av.y * (1 - drag), z: av.z * (1 - drag) }, true);
}

/** シーソー: 支点に回転の関節でつないだ板。片側を叩くと反対側が跳ね上がる。 */
function seesaw(g: Game, w: WorldMap, x: number, z: number, yaw: number): void {
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.35, 0.55, 3), new THREE.MeshLambertMaterial({ color: 0x3a6ed2 }));
  base.position.set(x, 0.275, z);
  base.rotation.set(Math.PI / 2, yaw, 0);
  w.root.add(base);
  const plank = w.spawnProp('seesaw', { x, y: 0.55, z }, yaw, {});
  if (!plank) return;
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
  const pivot = g.physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, 0.62, z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }));
  const jd = RAPIER.JointData.revolute({ x: 0, y: 0, z: 0 }, { x: 0, y: 0.62 - (0.55 + plank.half.y), z: 0 }, { x: 0, y: 0, z: 1 });
  g.physics.world.createImpulseJoint(jd, pivot, plank.body, true);
  plank.body.setAngularDamping(0.6);
}

/** すべり台とジャングルジム（動かない遊具）。 */
function playground(w: WorldMap): void {
  const blue = new THREE.MeshLambertMaterial({ color: 0x3a8ad2 });
  const yellow = new THREE.MeshLambertMaterial({ color: 0xf2c84a });
  const red = new THREE.MeshLambertMaterial({ color: 0xd8483a });
  // すべり台
  w.staticBox({ x: -56, y: 1.2, z: -40 }, { x: 0.9, y: 1.2, z: 0.9 }, 0, blue);
  const slide = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -0.55);
  w.staticCollider(RAPIER.ColliderDesc.cuboid(0.6, 0.08, 2.4).setTranslation(-56, 1.2, -42.9).setRotation({ x: slide.x, y: slide.y, z: slide.z, w: slide.w }).setCollisionGroups(groups(G.STATIC, 0xffff)).setFriction(0.05), 'deco');
  const sm = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.16, 4.8), yellow);
  sm.position.set(-56, 1.2, -42.9);
  sm.quaternion.copy(slide);
  sm.castShadow = true;
  w.root.add(sm);
  // ジャングルジム（格子の見た目と、外形の当たり判定）
  const bars = new THREE.Group();
  const bar = new THREE.BoxGeometry(0.08, 0.08, 1);
  for (let i = 0; i <= 3; i++) {
    for (let j = 0; j <= 3; j++) {
      for (let k = 0; k <= 3; k++) {
        if (i < 3) {
          const m = new THREE.Mesh(bar, red);
          m.scale.z = 1;
          m.rotation.y = Math.PI / 2;
          m.position.set(-38 + i + 0.5, k, -42 + j);
          bars.add(m);
        }
        if (j < 3) {
          const m = new THREE.Mesh(bar, red);
          m.position.set(-38 + i, k, -42 + j + 0.5);
          bars.add(m);
        }
        if (k < 3) {
          const m = new THREE.Mesh(bar, red);
          m.rotation.x = Math.PI / 2;
          m.position.set(-38 + i, k + 0.5, -42 + j);
          bars.add(m);
        }
      }
    }
  }
  w.root.add(bars);
  w.staticCollider(RAPIER.ColliderDesc.cuboid(1.5, 1.5, 1.5).setTranslation(-36.5, 1.5, -40.5).setCollisionGroups(groups(G.STATIC, 0xffff)), 'deco');
}

function duckSprite(): THREE.Sprite {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const c = cv.getContext('2d')!;
  c.font = '52px "Segoe UI Emoji", "Apple Color Emoji", sans-serif';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText('🦆', 32, 36);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t }));
  sp.scale.set(0.7, 0.7, 0.7);
  return sp;
}
