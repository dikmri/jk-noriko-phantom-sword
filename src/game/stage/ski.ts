/**
 * 雪山のスキー場。南のふもと（高さ 0）から北の頂上（+24m）へ上る長いゲレンデ。
 * 中央は整備されたコース（よく滑る）。西にこぶ斜面とリフト、両脇は岩の尾根。頂上にロッジ、ふもとにレンタル小屋。
 * 仕掛け: 雪崩（頂上から大きな雪玉が転がり落ちる）、ジャンプ台、壊すと雪玉が転がり出る雪だるま、倒せるリフトの支柱。
 * 雪面は摩擦が小さいので、吹き飛ばした敵は坂を滑り落ちていく。
 */
import * as THREE from 'three';
import { G, groups, RAPIER } from '../../core/physics';
import { log } from '../../log';
import { SH, ZONE } from '../fx';
import type { Game } from '../game';
import { ARENA, Prop, WorldMap } from '../world';
import type { Stage } from './index';
import { HeightGrid, smoothstep } from './terrain';
import { inRamp, inRampLip, mogulK, offPisteK, pisteCenter, rampTop, ridgeK, SKI, skiHeight } from './ski_shape';
import { lodgeWall, netTex, snowTex } from './ski_tex';

const S = { sleep: true };
/** 雪面の摩擦（敵の 0.35 と平均されるので、吹き飛んだ敵は坂を滑り落ちる） */
const SNOW_FRICTION = 0.1;
/** 雪崩: 最初の 1 回までの秒数と、その後の間隔 */
const AVALANCHE_FIRST = 30;
const AVALANCHE_GAP: [number, number] = [36, 46];
/** 雪崩の予告の秒数と、雪玉が転がり始める z、赤い帯の半幅 */
const WARN_T = 3.2;
const ROLL_Z = 49;
const LANE_HALF = 3.2;

interface Ball {
  prop: Prop;
  cd: number;
  still: number;
  /** ノリコに当たったときのダメージと、ログ・被ダメージに出す名前 */
  dmg: number;
  by: string;
}

interface Lane {
  x: number;
  t: number;
  spawned: number;
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
}

/** 格子から雪面のメッシュと当たり判定を作る（terrainMesh と同じ形で、摩擦だけ小さくする）。 */
function snowTerrain(w: WorldMap, grid: HeightGrid, map: THREE.Texture, uvScale: number, color: (x: number, z: number, h: number, slope: number) => THREE.Color): void {
  const { nx, nz, step, x0, z0 } = grid;
  const pos = new Float32Array(nx * nz * 3);
  const uv = new Float32Array(nx * nz * 2);
  const col = new Float32Array(nx * nz * 3);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      const x = x0 + i * step;
      const z = z0 + j * step;
      const y = grid.h[k];
      pos.set([x, y, z], k * 3);
      uv.set([x / uvScale, -z / uvScale], k * 2);
      const c = color(x, z, y, grid.slope(x, z));
      col.set([c.r, c.g, c.b], k * 3);
    }
  }
  const idx = new Uint32Array((nx - 1) * (nz - 1) * 6);
  let n = 0;
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i;
      const b = a + 1;
      const c = a + nx;
      const d = c + 1;
      idx.set([a, c, b, b, c, d], n);
      n += 6;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map, vertexColors: true }));
  mesh.receiveShadow = true;
  w.root.add(mesh);
  w.staticCollider(RAPIER.ColliderDesc.trimesh(pos, idx).setCollisionGroups(groups(G.STATIC, 0xffff)).setFriction(SNOW_FRICTION), 'ground');
}

export function ski(g: Game, w: WorldMap): Stage {
  const grid = HeightGrid.build(-ARENA - 10, -ARENA - 10, ARENA + 10, ARENA + 10, 1.1, skiHeight);
  const H = (x: number, z: number) => grid.at(x, z);
  const balls: Ball[] = [];
  const lanes: Lane[] = [];
  const snowmen: Prop[] = [];
  const pylons: Prop[] = [];
  let avalancheT = AVALANCHE_FIRST;
  let avalanches = 0;
  let snowmenBroken = 0;
  // ジャンプ台: ログは 3 秒に 1 行にまとめる
  let jumps = { enemy: 0, player: 0, logged: -99 };
  let playerJumpCd = 0;
  const prev = { x: 0, z: 0, ok: false };
  // リフト
  const chairs: { g: THREE.Group; s: number }[] = [];
  let loop: { x: number; y: number; z: number; d: number; span: number }[] = [];
  let loopLen = 1;
  let cable: THREE.LineSegments | null = null;
  const brokenSpan = new Set<number>();
  let liftSpeed = 1.6;
  let snowAcc = 0;

  /** リフトの輪の点列（上りは東側、下りは西側。span はどの支柱の間か）。 */
  function buildLoop(): void {
    const n = SKI.pylonZ.length;
    const top = (z: number) => H(SKI.liftX, z) + SKI.cableH;
    const pts: { x: number; y: number; z: number; span: number }[] = [];
    for (let i = 0; i < n; i++) pts.push({ x: SKI.liftX + SKI.cableHalf, y: top(SKI.pylonZ[i]), z: SKI.pylonZ[i], span: Math.min(i, n - 2) });
    for (let i = n - 1; i >= 0; i--) pts.push({ x: SKI.liftX - SKI.cableHalf, y: top(SKI.pylonZ[i]), z: SKI.pylonZ[i], span: Math.max(0, i - 1) });
    let d = 0;
    loop = pts.map((p, k) => {
      if (k > 0) d += Math.hypot(p.x - pts[k - 1].x, p.y - pts[k - 1].y, p.z - pts[k - 1].z);
      return { ...p, d };
    });
    const last = pts[pts.length - 1];
    loopLen = d + Math.hypot(pts[0].x - last.x, pts[0].y - last.y, pts[0].z - last.z);
  }

  /** ケーブルの線を作り直す（倒れた支柱の間は描かない）。 */
  function rebuildCable(): void {
    const v: number[] = [];
    const n = SKI.pylonZ.length;
    const top = (z: number) => H(SKI.liftX, z) + SKI.cableH;
    for (let i = 0; i < n - 1; i++) {
      if (brokenSpan.has(i)) continue;
      for (const s of [-1, 1]) {
        const x = SKI.liftX + s * SKI.cableHalf;
        // 少したるませる
        const za = SKI.pylonZ[i];
        const zb = SKI.pylonZ[i + 1];
        for (let k = 0; k < 6; k++) {
          const t0 = k / 6;
          const t1 = (k + 1) / 6;
          const y0 = top(za) + (top(zb) - top(za)) * t0 - Math.sin(t0 * Math.PI) * 0.5;
          const y1 = top(za) + (top(zb) - top(za)) * t1 - Math.sin(t1 * Math.PI) * 0.5;
          v.push(x, y0, za + (zb - za) * t0, x, y1, za + (zb - za) * t1);
        }
      }
    }
    if (!cable) {
      cable = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x2a2e36 }));
      w.root.add(cable);
    }
    cable.geometry.dispose();
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    cable.geometry = geo;
  }

  function chairAt(s: number, out: THREE.Group): number {
    let d = ((s % loopLen) + loopLen) % loopLen;
    let k = loop.length - 1;
    for (let i = 1; i < loop.length; i++) {
      if (loop[i].d > d) {
        k = i - 1;
        break;
      }
    }
    const a = loop[k];
    const b = k + 1 < loop.length ? loop[k + 1] : loop[0];
    const seg = (k + 1 < loop.length ? b.d : loopLen) - a.d || 1;
    d -= a.d;
    const t = Math.min(1, d / seg);
    out.position.set(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t - Math.sin(t * Math.PI) * 0.5 * (a.span === b.span ? 1 : 0), a.z + (b.z - a.z) * t);
    out.rotation.y = Math.atan2(b.x - a.x, b.z - a.z);
    return a.span;
  }

  function makeChair(color: number): THREE.Group {
    const grp = new THREE.Group();
    const metal = new THREE.MeshLambertMaterial({ color: 0x4e525a });
    const seat = new THREE.MeshLambertMaterial({ color });
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.35, 0.06), metal);
    bar.position.y = -0.68;
    const s1 = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.1, 0.5), seat);
    s1.position.set(0, -1.4, 0.05);
    const s2 = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.5, 0.08), seat);
    s2.position.set(0, -1.12, -0.22);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.05, 0.05), metal);
    arm.position.set(0, -0.98, 0.25);
    grp.add(bar, s1, s2, arm);
    for (const m of [bar, s1, s2]) m.castShadow = true;
    return grp;
  }

  /** ジャンプ台（静的な当たり判定の坂と、見た目）。 */
  function buildRamp(): void {
    const r = SKI.ramp;
    const zs = r.z + r.len / 2;
    const ze = r.z - r.len / 2;
    const yN = rampTop(zs, H);
    const yS = rampTop(ze, H);
    const gS = H(r.x, ze);
    const hw = r.w / 2;
    const pts: number[] = [];
    for (const sx of [-hw, hw]) {
      pts.push(r.x + sx, yN - 0.5, zs, r.x + sx, yN + 0.02, zs, r.x + sx, yS, ze, r.x + sx, gS - 0.5, ze);
    }
    // 当たり判定は持ち主を登録しない。登録すると「静的な壁」として扱われ、滑ってきた敵が台に乗っただけで
    // 壁へのたたきつけダメージを受けて、飛ぶ前に倒れてしまう（動作確認で確かめた）
    const desc = RAPIER.ColliderDesc.convexHull(new Float32Array(pts));
    if (desc) {
      const body = g.physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
      g.physics.world.createCollider(desc.setCollisionGroups(groups(G.STATIC, 0xffff)).setFriction(0.05), body);
    }
    // 見た目: 上面（青白い雪）と側面・先端（板）
    const P = (i: number) => new THREE.Vector3(pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2]);
    // 0..3: 西側（北下・北上・南上・南下）、4..7: 東側
    const quads: [number[], number][] = [
      [[1, 5, 6, 2], 0xeaf2fc], // 上面
      [[0, 1, 2, 3], 0xb8cde4], // 西の側面
      [[4, 7, 6, 5], 0xb8cde4], // 東の側面
      [[3, 2, 6, 7], 0xd2dfee], // 先端
    ];
    for (const [q, color] of quads) {
      const geo = new THREE.BufferGeometry().setFromPoints([P(q[0]), P(q[1]), P(q[2]), P(q[0]), P(q[2]), P(q[3])]);
      geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide }));
      m.receiveShadow = true;
      m.castShadow = true;
      w.root.add(m);
    }
    // 先端の両脇の旗（赤と青）
    for (const [sx, color] of [[-hw - 0.3, 0xe23030], [hw + 0.3, 0x2a5ad8]] as const) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.4), new THREE.MeshLambertMaterial({ color: 0x333333 }));
      pole.position.set(r.x + sx, gS + 1.2, ze + 0.4);
      const flag = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.5, 0.8), new THREE.MeshLambertMaterial({ color }));
      flag.position.set(r.x + sx, gS + 2.1, ze + 0.8);
      w.root.add(pole, flag);
    }
  }

  /** 外周のオレンジの安全ネット（当たり判定は bounds の見えない壁）。 */
  function buildNet(): void {
    const tex = netTex();
    const mat = new THREE.MeshLambertMaterial({ map: tex, transparent: true, alphaTest: 0.3, side: THREE.DoubleSide });
    const E = ARENA - 0.3;
    const sides: [number, number, number, number][] = [[-E, -E, E, -E], [E, -E, E, E], [E, E, -E, E], [-E, E, -E, -E]];
    const posts: THREE.Vector3[] = [];
    for (const [ax, az, bx, bz] of sides) {
      const len = Math.hypot(bx - ax, bz - az);
      const n = Math.ceil(len / 3);
      const vs: number[] = [];
      const uvs: number[] = [];
      const ix: number[] = [];
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const x = ax + (bx - ax) * t;
        const z = az + (bz - az) * t;
        const y = H(x, z);
        vs.push(x, y - 0.3, z, x, y + 1.5, z);
        uvs.push(t * len * 0.8, 0, t * len * 0.8, 1.4);
        if (i > 0) {
          const k = i * 2;
          ix.push(k - 2, k - 1, k, k - 1, k + 1, k);
        }
        if (i % 2 === 0) posts.push(new THREE.Vector3(x, y, z));
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(vs, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      geo.setIndex(ix);
      geo.computeVertexNormals();
      w.root.add(new THREE.Mesh(geo, mat));
    }
    const post = new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, 2, 0.12), new THREE.MeshLambertMaterial({ color: 0x3a3a40 }), posts.length);
    const m4 = new THREE.Matrix4();
    posts.forEach((p, i) => post.setMatrixAt(i, m4.makeTranslation(p.x, p.y + 0.7, p.z)));
    w.root.add(post);
  }

  /** 遠くの雪山（見た目だけ）。 */
  function buildMountains(): void {
    const rng = g.rng;
    const rock = new THREE.Color(0x8792a4);
    const snowC = new THREE.Color(0xf4f8fc);
    const c = new THREE.Color();
    for (let i = 0; i < 18; i++) {
      // 北（頂上の向こう）を中心に、左右へ広がる
      const a = Math.PI / 2 + (rng() - 0.5) * Math.PI * 1.7;
      const d = 230 + rng() * 60;
      const h = 38 + rng() * 45;
      const r = 55 + rng() * 45;
      const geo = new THREE.ConeGeometry(r, h, 7 + Math.floor(rng() * 4), 3);
      const pos = geo.attributes.position;
      const col = new Float32Array(pos.count * 3);
      for (let k = 0; k < pos.count; k++) {
        const y = pos.getY(k) / h + 0.5;
        c.copy(rock).lerp(snowC, smoothstep(0.35, 0.55, y + (rng() - 0.5) * 0.08));
        col.set([c.r, c.g, c.b], k * 3);
      }
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
      m.position.set(Math.cos(a) * d, h / 2 - 8, Math.sin(a) * d);
      m.rotation.y = rng() * 6;
      w.root.add(m);
    }
  }

  function addBall(prop: Prop | null, dmg: number, by: string): void {
    if (prop) balls.push({ prop, cd: 0, still: 0, dmg, by });
  }

  /** 雪崩を始める: 赤い帯で道筋を予告し、WARN_T 秒後に雪玉を転がす。 */
  function startAvalanche(): void {
    const p = g.player.pos;
    const n = 3;
    const base = Math.max(-34, Math.min(34, p.x + (Math.random() - 0.5) * 8));
    const xs: number[] = [];
    for (let i = 0; i < n; i++) xs.push(Math.max(-40, Math.min(40, base + (i - 1) * (11 + Math.random() * 4))));
    for (const x of xs) {
      const vs: number[] = [];
      const ix: number[] = [];
      let k = 0;
      for (let z = ROLL_Z + 2; z >= -ARENA + 2; z -= 2) {
        for (const s of [-1, 1]) {
          const xx = x + s * LANE_HALF;
          vs.push(xx, H(xx, z) + 0.14, z);
        }
        if (k > 0) {
          const a = k * 2;
          ix.push(a - 2, a - 1, a, a - 1, a + 1, a);
        }
        k++;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(vs, 3));
      geo.setIndex(ix);
      const mat = new THREE.MeshBasicMaterial({ color: ZONE.enemy, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.renderOrder = 2;
      w.root.add(mesh);
      lanes.push({ x, t: 0, spawned: 0, mesh, mat });
    }
    avalanches++;
    g.hud.toast('雪崩だ！ 赤い帯から離れろ！', 'warn');
    g.audio.warn();
    g.fx.shake('S');
    log('ski.avalanche', { lanes: xs.map((x) => Math.round(x)) }, { total: avalanches, time: Math.round(g.time) });
  }

  function updateLanes(dt: number): void {
    for (let i = lanes.length - 1; i >= 0; i--) {
      const L = lanes[i];
      L.t += dt;
      if (L.t < WARN_T) L.mat.opacity = 0.28 + 0.2 * Math.max(0, Math.sin(L.t * 11));
      else L.mat.opacity = Math.max(0, 0.32 * (1 - (L.t - WARN_T) / 9));
      // 雪玉を 2 つ、少しずらして転がす
      const due = L.t >= WARN_T ? 1 + (L.t >= WARN_T + 0.8 ? 1 : 0) : 0;
      while (L.spawned < due) {
        L.spawned++;
        const scale = 1.5 + Math.random() * 1.0;
        const x = L.x + (Math.random() - 0.5) * 0.8;
        const prop = w.spawnProp('snowball', { x, y: H(x, ROLL_Z) + 0.05, z: ROLL_Z }, Math.random() * 6, { scale, hot: 30, dmgMul: 1.3, life: 24 });
        if (prop) {
          prop.body.setLinvel({ x: 0, y: -1, z: -7 }, true);
          prop.body.setAngvel({ x: -7 / (0.8 * scale), y: 0, z: 0 }, true);
          g.fx.poof({ x, y: H(x, ROLL_Z) + 1, z: ROLL_Z }, 1.6, 0xffffff);
        }
        addBall(prop, 18 + 6 * scale, '雪崩');
        if (L.spawned === 1) g.audio.crumble(0.8);
      }
      if (L.t > WARN_T + 9) {
        L.mesh.removeFromParent();
        L.mesh.geometry.dispose();
        L.mat.dispose();
        lanes.splice(i, 1);
      }
    }
  }

  function updateBalls(dt: number): void {
    const p = g.player;
    for (let i = balls.length - 1; i >= 0; i--) {
      const b = balls[i];
      if (!b.prop.alive) {
        balls.splice(i, 1);
        continue;
      }
      b.cd -= dt;
      const t = b.prop.body.translation();
      const v = b.prop.body.linvel();
      const sp = Math.hypot(v.x, v.y, v.z);
      const r = b.prop.half.y;
      if (sp > 2) w.heat(b.prop, 1);
      if (sp > 3.5 && Math.random() < dt * 16) {
        g.fx.spawn({ pos: { x: t.x + (Math.random() - 0.5) * r, y: t.y - r * 0.7, z: t.z + (Math.random() - 0.5) * r }, vel: { x: (Math.random() - 0.5) * 3, y: 1.5 + Math.random() * 2, z: (Math.random() - 0.5) * 3 }, grav: -8, life: 0.6, size: 0.3 + r * 0.25, size2: 0.6 + r * 0.3, color: 0xffffff, color2: 0xdde8f4, shape: SH.PUFF, alpha: 0.85 });
      }
      // ノリコをひく
      if (b.cd <= 0 && sp > 3.5 && Math.hypot(p.pos.x - t.x, p.pos.y + 0.9 - t.y, p.pos.z - t.z) < r + 0.7) {
        b.cd = 1;
        p.hurt(b.dmg, { x: t.x, y: t.y, z: t.z }, b.by);
        p.launch(v.x * 0.5, 7, v.z * 0.5);
      }
      // 止まった雪玉は崩れて消える
      b.still = sp < 0.8 ? b.still + dt : 0;
      if (b.still > 2.5) {
        g.fx.poof({ x: t.x, y: t.y, z: t.z }, r * 1.6, 0xffffff);
        g.fx.shards({ x: t.x, y: t.y, z: t.z }, 0xf4f8ff, 6, 4, 0.3);
        w.removeProp(b.prop);
        balls.splice(i, 1);
      }
    }
  }

  /** 壊れた雪だるまは崩れて、中から雪玉が坂を転がり出る。 */
  function updateSnowmen(): void {
    for (let i = snowmen.length - 1; i >= 0; i--) {
      const s = snowmen[i];
      if (!s.alive) {
        snowmen.splice(i, 1);
        continue;
      }
      if (s.hp > 0) continue;
      const t = s.body.translation();
      w.removeProp(s);
      snowmen.splice(i, 1);
      snowmenBroken++;
      g.fx.poof({ x: t.x, y: t.y, z: t.z }, 1.3, 0xffffff);
      g.fx.shards({ x: t.x, y: t.y + 0.4, z: t.z }, 0xf4f8ff, 9, 5, 0.3);
      g.audio.crumble(0.4);
      const prop = w.spawnProp('snowball', { x: t.x, y: H(t.x, t.z) + 0.2, z: t.z }, 0, { scale: 0.75, hot: 15, dmgMul: 1.6, life: 18 });
      if (prop) prop.body.setLinvel({ x: (Math.random() - 0.5) * 2, y: 2, z: -5 }, true);
      addBall(prop, 10, '雪玉');
      log('ski.snowman', {}, { broken: snowmenBroken, left: snowmen.length, time: Math.round(g.time) });
    }
  }

  /** ジャンプ台の先端: 南へ滑ってきた敵とノリコを、前へ高く飛ばす。 */
  function updateRamp(dt: number): void {
    const r = SKI.ramp;
    const ze = r.z - r.len / 2;
    for (const e of g.enemies.list) {
      if (e.state === 'dead' || e.state === 'held' || !inRampLip(e.x, e.z)) continue;
      const feet = e.y - e.halfH - e.radius;
      if (feet < rampTop(Math.max(ze, e.z), H) - 0.7) continue;
      if ((e.w.skj ?? -9) > g.time) continue;
      const v = e.body.linvel();
      if (v.z > -2.5) continue;
      e.w.skj = g.time + 1.5;
      g.enemies.launch(e, { x: v.x * 1.05, y: 8 + Math.min(8, -v.z * 0.45), z: Math.min(v.z * 1.25, -6) });
      g.fx.poof({ x: e.x, y: feet, z: e.z }, 0.9, 0xffffff);
      jumps.enemy++;
    }
    const p = g.player;
    playerJumpCd -= dt;
    const vx = prev.ok ? (p.pos.x - prev.x) / Math.max(1e-4, dt) : 0;
    const vz = prev.ok ? (p.pos.z - prev.z) / Math.max(1e-4, dt) : 0;
    prev.x = p.pos.x;
    prev.z = p.pos.z;
    prev.ok = true;
    if (playerJumpCd <= 0 && inRampLip(p.pos.x, p.pos.z) && vz < -2 && p.pos.y >= rampTop(Math.max(ze, p.pos.z), H) - 0.6) {
      playerJumpCd = 1.2;
      p.launch(vx * 1.1, 12, Math.min(vz * 1.4, -8));
      g.fx.poof({ x: p.pos.x, y: p.pos.y, z: p.pos.z }, 1, 0xffffff);
      g.audio.jump();
      jumps.player++;
    }
    if ((jumps.enemy || jumps.player) && g.time - jumps.logged > 3) {
      log('ski.jump', { enemy: jumps.enemy, player: jumps.player }, { time: Math.round(g.time) });
      jumps = { enemy: 0, player: 0, logged: g.time };
    }
  }

  /** リフト: 椅子を動かす。支柱が倒れたら止まり、その間のケーブルと椅子は消える。 */
  function updateLift(dt: number): void {
    let changed = false;
    pylons.forEach((p, i) => {
      if (p.alive && p.rooted) return;
      for (const span of [i - 1, i]) {
        if (span < 0 || span > SKI.pylonZ.length - 2 || brokenSpan.has(span)) continue;
        brokenSpan.add(span);
        changed = true;
      }
    });
    if (changed) {
      if (liftSpeed > 0) {
        g.hud.toast('リフトの支柱が倒れた！ リフトが止まった', 'info');
        liftSpeed = 0;
      }
      rebuildCable();
      for (const c of chairs) {
        const span = chairAt(c.s, c.g);
        if (brokenSpan.has(span) && c.g.visible) {
          c.g.visible = false;
          g.fx.poof(c.g.position, 0.8, 0xffffff);
        }
      }
      log('ski.pylon', { broken: [...brokenSpan] }, { time: Math.round(g.time) });
    }
    if (liftSpeed <= 0) return;
    for (const c of chairs) {
      c.s += liftSpeed * dt;
      chairAt(c.s, c.g);
    }
  }

  /**
   * 歩いている敵の坂の補正。雪面は grip が小さいので、歩く速さの戻りが重力に負けて坂を滑り落ちる
   * （補正なしでは、頂上のノリコの所へ登れなかった）。坂の傾きの分の重力を、歩いている間だけ打ち消す。
   * 吹き飛んでいる敵には掛けないので、吹き飛ばすと坂を滑り落ちていく。
   */
  function assistWalkers(dt: number): void {
    const G = -22 * g.rule.gravity * dt;
    for (const e of g.enemies.list) {
      // 吹き飛んで地面を滑っている間は、落下ダメージの「一番高い位置」を今の位置に置き直す。
      // 落下ダメージは吹き飛んでから一番高かった位置との差で決まるので、そのままだと
      // 坂を滑り下りた高さまで落ちた高さと数えられ、滑っただけで倒れてしまう（動作確認で 9m 分と数えられた）。
      // 着地した瞬間に置き直すと本当の落下ダメージまで消えるので、3 フレーム続けて地面に接していて、
      // 下向きの速さが小さいときだけ置き直す
      if (e.state === 'knock') {
        const near = e.y - e.halfH - e.radius - grid.at(e.x, e.z) < 0.4;
        e.w.skg = near ? (e.w.skg ?? 0) + 1 : 0;
        if (e.w.skg >= 3 && e.body.linvel().y > -5) e.w.peak = e.y;
      }
      if (e.state !== 'walk' || e.frozen > 0 || e.stagger > 0 || e.def.behavior === 'heli') continue;
      const gx = (grid.at(e.x + 1, e.z) - grid.at(e.x - 1, e.z)) / 2;
      const gz = (grid.at(e.x, e.z + 1) - grid.at(e.x, e.z - 1)) / 2;
      const s2 = gx * gx + gz * gz;
      if (s2 < 0.0025) continue;
      const k = -G / (1 + s2);
      const v = e.body.linvel();
      e.body.setLinvel({ x: v.x + gx * k, y: v.y, z: v.z + gz * k }, true);
    }
  }

  /** 雪が降る（ノリコのまわりだけ）。 */
  function updateSnowfall(dt: number): void {
    snowAcc += dt * 22;
    const p = g.player.pos;
    while (snowAcc >= 1) {
      snowAcc -= 1;
      g.fx.spawn({ pos: { x: p.x + (Math.random() - 0.5) * 40, y: p.y + 10 + Math.random() * 6, z: p.z + (Math.random() - 0.5) * 40 }, vel: { x: 0.5, y: -1.7, z: 0.2 }, life: 6.5, size: 0.11, size2: 0.09, color: 0xffffff, shape: SH.SOFT, alpha: 0.9 });
    }
  }

  return {
    start: { x: 0, z: -56 },
    sky: { top: 0x7fb8f0, mid: 0xe6f0fa, fog: 0xe4eef8, fogNear: 80, fogFar: 300, sun: 0xfff6ea, sunI: 2.1, hemiSky: 0xffffff, hemiGround: 0xc4d0e0, hemiI: 1.05 },
    heightAt: (x, z) => grid.at(x, z),
    surface(x, z, out) {
      if (ridgeK(x) > 0.5) {
        out.grip = 0.85;
        out.speed = 0.9;
        return;
      }
      if (z < SKI.baseZ - 3 || z > SKI.topZ + 3) {
        // ふもとと頂上は踏み固められた雪
        out.grip = 0.75;
        return;
      }
      if (mogulK(x, z) > 0.5) {
        out.grip = 0.5;
        out.speed = 0.85;
      } else if (offPisteK(x, z) < 0.5) {
        // 整備されたコース: よく滑る
        out.grip = 0.35;
        out.speed = 1.05;
      } else {
        // 深い新雪: 少し遅い
        out.grip = 0.6;
        out.speed = 0.9;
      }
    },
    spawnOk(x, z) {
      if (Math.abs(x) > ARENA - 3 || Math.abs(z) > ARENA - 3) return false;
      if (inRamp(x, z, 1.5)) return false;
      return grid.slope(x, z) < 0.75;
    },
    build() {
      // ---- 雪面
      const map = snowTex(1);
      const white = new THREE.Color(1, 1, 1);
      const piste = new THREE.Color(0.84, 0.93, 1.1);
      const packed = new THREE.Color(0.97, 0.95, 0.92);
      const rockC = new THREE.Color(0.48, 0.48, 0.52);
      const c = new THREE.Color();
      snowTerrain(w, grid, map, 8, (x, z, _h, slope) => {
        c.copy(white);
        if (z < SKI.baseZ - 4 || z > SKI.topZ + 4) c.copy(packed);
        else c.lerp(piste, 1 - offPisteK(x, z));
        // 尾根の急な所は岩肌
        return c.lerp(rockC, ridgeK(x) * smoothstep(0.3, 0.75, slope));
      });
      w.bounds(new THREE.MeshBasicMaterial({ visible: false }), 2.4);
      buildNet();
      buildMountains();
      buildRamp();

      // ---- 頂上のロッジとふもとのレンタル小屋（丸太の壁。壊せる）
      w.registerWallStyle('ski', { plain: lodgeWall(false), win: lodgeWall(true), edge: 0x5a3a22 });
      const minY = (x0: number, z0: number, x1: number, z1: number) => Math.min(H(x0, z0), H(x1, z0), H(x0, z1), H(x1, z1), H((x0 + x1) / 2, (z0 + z1) / 2));
      w.addBuilding(-9, 54, 9, 5, 2, { style: 'ski', doors: [{ side: 'back', at: 3, width: 3 }], y0: minY(-9, 54, 9, 64) - 0.1 });
      w.addBuilding(16, -66, 6, 3, 1, { style: 'ski', doors: [{ side: 'front', at: 2 }], y0: minY(16, -66, 28, -60) - 0.1 });
      // 屋根（床の部品）を雪の色にする
      const roof = new THREE.Color(1.9, 1.96, 2.15);
      for (const ch of w.chunks) if (ch.kind === 'slab' && ch.set) ch.set.setColor(ch, roof);

      // ---- リフト（支柱は倒せる。椅子は見た目だけ）
      for (const z of SKI.pylonZ) {
        const pr = w.spawnProp('pylon', { x: SKI.liftX, y: H(SKI.liftX, z) - 0.05, z }, 0);
        if (pr) pylons.push(pr);
      }
      buildLoop();
      rebuildCable();
      const nChairs = 22;
      for (let i = 0; i < nChairs; i++) {
        const grp = makeChair(i % 2 ? 0xd62c28 : 0x2a5ad8);
        w.root.add(grp);
        const ch = { g: grp, s: (i / nChairs) * loopLen };
        chairAt(ch.s, grp);
        chairs.push(ch);
      }

      // ---- 針葉樹（コース・リフト・こぶ斜面・ジャンプ台・スタート地点を避ける）
      const rng = g.rng;
      let trees = 0;
      for (let k = 0; k < 200 && trees < 58; k++) {
        const x = (rng() - 0.5) * 2 * (ARENA - 5);
        const z = (rng() - 0.5) * 2 * (ARENA - 5);
        if (Math.abs(x - pisteCenter(z)) < SKI.pisteW + 3.5) continue;
        if (Math.abs(x - SKI.liftX) < 5 || mogulK(x, z) > 0 || inRamp(x, z, 4)) continue;
        if (Math.hypot(x - 0, z + 56) < 12 || grid.slope(x, z) > 0.8 || !w.free(x, z, 2.5)) continue;
        w.spawnProp('pine', { x, y: H(x, z) - 0.15, z }, rng() * 6, { scale: 0.8 + rng() * 0.45 });
        trees++;
      }

      // ---- 雪だるま（壊すと雪玉が転がり出る）
      for (const [x, z] of [[-9, -60], [7, -63], [-22, -50], [30, -48], [26, -12], [-15, 8], [24, 22], [-14, 36], [15, 49], [-18, 50], [22, 60], [-26, 58]] as const) {
        if (!w.free(x, z, 1)) continue;
        const s = w.spawnProp('snowman', { x, y: H(x, z) - 0.02, z }, rng() * 6, S);
        if (s) snowmen.push(s);
      }

      // ---- コースの目印のコーン（蹴散らせる）
      for (let z = -32; z <= 40; z += 12) {
        for (const s of [-1, 1]) {
          const x = pisteCenter(z) + s * (SKI.pisteW + 0.5);
          if (inRamp(x, z, 2)) continue;
          w.spawnProp('cone', { x, y: H(x, z) + 0.01, z }, 0, S);
        }
      }

      // ---- ふもと: ベンチ・燃料のドラム缶・備品の段ボール。頂上: ベンチ
      for (let k = 0; k < 4; k++) {
        const x = -16 + k * 4.5;
        w.spawnProp('bench', { x, y: H(x, -66) + 0.01, z: -66 }, 0, S);
      }
      for (let k = 0; k < 3; k++) {
        const x = -4 + k * 5;
        w.spawnProp('bench', { x, y: H(x, 50) + 0.01, z: 50 }, Math.PI, S);
      }
      const nBarrel = Math.round(3 * g.rule.barrels);
      for (let i = 0; i < nBarrel; i++) {
        const x = 30 + (i % 3) * 1.1;
        const z = -66 + Math.floor(i / 3) * 1.1;
        w.spawnProp('barrel', { x, y: H(x, z) + 0.01, z }, 0, S);
      }
      const nBox = Math.round(4 * g.rule.clutter);
      for (let i = 0; i < nBox; i++) {
        const x = 14 - (i % 4) * 0.8;
        const z = -58 + Math.floor(i / 4) * 0.8;
        w.spawnProp('box', { x, y: H(x, z) + 0.01, z }, rng(), S);
      }
      for (const [x, z] of [[SKI.ramp.x - 6, SKI.ramp.z + 7], [-4, -46]] as const) w.spawnProp('sign', { x, y: H(x, z) + 0.01, z }, Math.PI, S);
      log('ski.build', {}, { trees, snowmen: snowmen.length, pylons: pylons.length, props: w.props.length });
    },

    update(dt) {
      avalancheT -= dt;
      if (avalancheT <= 0) {
        avalancheT = AVALANCHE_GAP[0] + Math.random() * (AVALANCHE_GAP[1] - AVALANCHE_GAP[0]);
        startAvalanche();
      }
      if (lanes.length) updateLanes(dt);
      if (balls.length) updateBalls(dt);
      updateSnowmen();
      updateRamp(dt);
      assistWalkers(dt);
      updateLift(dt);
      updateSnowfall(dt);
    },

    dispose() {
      for (const L of lanes) {
        L.mesh.geometry.dispose();
        L.mat.dispose();
      }
      lanes.length = 0;
      balls.length = 0;
    },
  };
}
