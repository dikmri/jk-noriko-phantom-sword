/**
 * 秋葉原（夕方）。東西の中央通りと、南北の通りの交差点。両側に高いビル、東側に鉄道の高架。
 * 仕掛け: 歩行者天国が終わると車が走り抜ける、ガチャガチャ、崩れると落ちるネオン看板、高架を通る電車。
 */
import * as THREE from 'three';
import { G, G_ALL, groups, RAPIER } from '../../core/physics';
import { log } from '../../log';
import type { Enemy } from '../enemies';
import type { Game } from '../game';
import { ARENA, Chunk, Prop, WorldMap } from '../world';
import type { Stage } from './index';
import { asphalt, neonSign, sidewalk } from './textures';
import { boxPile } from './yard';

/** 中央通り（東西）の半分の幅と、南北の通りの半分の幅 */
const ROAD = 7;
const CROSS = 6;
const WALK = 4;
/** 高架の中心の x と、桁の高さ */
const RAIL_X = 48;
const RAIL_Y = 7.4;
/** 車線（z）と進む向き */
const LANES: [number, number][] = [[-5.2, -1], [-1.8, -1], [1.8, 1], [5.2, 1]];
/** 歩行者天国の長さ・予告・車が走る長さ（秒） */
const HOKO_TIME = 42;
const WARN_TIME = 3;
const DRIVE_TIME = 8;
const CAR_CAP = 28;
const CAR_COLORS = [0xffd84a, 0x3a3a40, 0xffffff, 0xd8443a, 0x4a7ad8, 0x9ad0a0];
const S = { sleep: true };

interface Car {
  body: RAPIER.RigidBody;
  x: number;
  z: number;
  dir: number;
  speed: number;
  color: number;
  hit: Set<unknown>;
}

interface Sign {
  mesh: THREE.Mesh;
  chunk: Chunk;
  body: RAPIER.RigidBody | null;
  age: number;
  hit: Set<Enemy>;
  w: number;
  h: number;
}

export function akiba(g: Game, w: WorldMap): Stage {
  const cars: Car[] = [];
  const signs: Sign[] = [];
  let phase: 'hoko' | 'warn' | 'drive' = 'hoko';
  let phaseT = 30;
  const laneT = LANES.map(() => 0);
  let carMesh: THREE.InstancedMesh | null = null;
  let stripes: THREE.Mesh[] = [];
  let train: THREE.Group | null = null;
  let trainZ = 999;
  let trainT = 20;
  let signT = 0;
  let trafficKills = 0;
  const tm = new THREE.Matrix4();
  const tq = new THREE.Quaternion();
  const tv = new THREE.Vector3();
  const ts = new THREE.Vector3(1, 1, 1);
  const tc = new THREE.Color();

  const onRoad = (x: number, z: number) => Math.abs(z) < ROAD || Math.abs(x) < CROSS;

  /** 建物（入口は通りに向ける）。north は通りの北側か。 */
  const building = (x0: number, z0: number, cols: number, depth: number, floors: number, north: boolean) => {
    w.addBuilding(x0, z0, cols, depth, floors, {
      style: 'akiba', w: 3, h: 3.6, rowsPerFloor: 1, slabs: 'roof', hp: 80,
      winRow: (r) => r > 0,
      doors: [{ side: north ? 'back' : 'front', at: Math.floor(cols / 2) - 1, width: 2 }],
    });
  };

  /** ネオン看板。壁から突き出す縦型（blade）か、壁に貼る横型。chunk が壊れたら落ちる。 */
  const sign = (text: string, color: string, x: number, y: number, z: number, facing: number, blade: boolean) => {
    const tex = neonSign(text, color, blade);
    const n = [...text].length;
    const wdt = blade ? 1.1 : 1.1 * n * 0.9 + 0.6;
    const hgt = blade ? 1.1 * n * 0.9 + 0.6 : 1.4;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(wdt, hgt), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide, fog: false }));
    // 縦型は通りに沿う向き（面が東西を向く）、横型は通りの方を向く
    const ox = 0;
    const oz = blade ? facing * 0.75 : facing * 0.26;
    mesh.position.set(x + ox, y, z + oz);
    mesh.rotation.y = blade ? Math.PI / 2 : facing > 0 ? 0 : Math.PI;
    w.root.add(mesh);
    // いちばん近い壁の部品にくっつける
    let best: Chunk | null = null;
    let bd = Infinity;
    for (const ch of w.chunks) {
      if (ch.kind !== 'wall' && ch.kind !== 'wallwin') continue;
      const d = (ch.pos.x - x) ** 2 + (ch.pos.y - y) ** 2 + (ch.pos.z - z) ** 2;
      if (d < bd) {
        bd = d;
        best = ch;
      }
    }
    if (best) signs.push({ mesh, chunk: best, body: null, age: 0, hit: new Set(), w: wdt, h: hgt });
  };

  return {
    start: { x: -20, z: 0 },
    sky: { top: 0x2b2a6e, mid: 0xf09a6a, fog: 0xc98a8a, fogNear: 55, fogFar: 170, sun: 0xffa868, sunI: 1.7, hemiSky: 0xffc9a8, hemiGround: 0x5a4a70, hemiI: 1.05 },
    build() {
      w.registerWallStyle('akiba', { plain: 'akiba_shop.jpg', win: 'akiba_win.jpg', edge: 0x8a8478 });
      // ---- 地面: アスファルト・歩道・白線
      w.floor(new THREE.MeshLambertMaterial({ map: asphalt(30) }), ARENA * 2 + 60, ARENA * 2 + 60);
      const walkMat = (lx: number, lz: number) => {
        const t = sidewalk(1);
        t.repeat.set(lx / 2, lz / 2);
        return new THREE.MeshLambertMaterial({ map: t });
      };
      for (const sz of [-1, 1]) w.floor(walkMat(ARENA * 2, WALK), ARENA * 2, WALK, 0, sz * (ROAD + WALK / 2), 0.02, 1);
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          const len = ARENA - ROAD - WALK;
          w.floor(walkMat(WALK, len), WALK - 1, len, sx * (CROSS + (WALK - 1) / 2), sz * (ROAD + WALK + len / 2), 0.021, 1);
        }
      }
      roadLines(w);
      w.groundCollider(0.85);
      w.bounds(new THREE.MeshLambertMaterial({ color: 0x4a4650 }), 3.2);
      w.skyline([0x6a6070, 0x8a7a8a, 0x5a5a6a, 0x9a8a7a, 0x7a6a8a], 12, 46, 110, 0x2a1838);

      // ---- ビル（通りの北側と南側）
      building(-60, 14, 7, 5, 5, true);
      building(-34, 14, 6, 5, 6, true);
      building(14, 14, 6, 4, 4, true);
      building(55, 14, 4, 5, 5, true);
      building(-62, -29, 6, 5, 4, false);
      building(-36, -29, 7, 5, 6, false);
      building(12, -29, 7, 5, 5, false);
      building(55, -26, 4, 4, 4, false);
      building(-55, 46, 5, 4, 3, true);
      building(18, 46, 6, 4, 3, true);
      building(-50, -62, 6, 4, 3, false);
      building(18, -62, 5, 4, 3, false);

      // ---- ネオン看板（建物を建てた後で、壁にくっつける）
      const texts: [string, string][] = [['メイド喫茶', '#ff6ad5'], ['ゲーム', '#5af0ff'], ['アニメ', '#ffe14d'], ['カラオケ', '#7dff6a'], ['フィギュア', '#ff9a3a'], ['ガチャ', '#ff6a6a'], ['PCパーツ', '#6ab0ff'], ['ラーメン', '#ffd06a']];
      const fronts: [number, number, number, number][] = [
        [-58, 14, -1, 5], [-40, 14, -1, 5], [-30, 14, -1, 6], [16, 14, -1, 4], [32, 14, -1, 4], [57, 14, -1, 5],
        [-60, -14, 1, 4], [-34, -14, 1, 6], [-16, -14, 1, 6], [14, -14, 1, 5], [30, -14, 1, 5], [57, -14, 1, 4],
      ];
      fronts.forEach(([x, z, f, floors], i) => {
        const [t, c] = texts[i % texts.length];
        const n = [...t].length;
        const top = Math.min(floors * 3.6 - 1, 2 + n * 0.5 + 2.5);
        sign(t, c, x, top - n * 0.5 + 0.6, z, f, true);
      });
      // 壁に貼る横長の看板（どれも建物の正面の上）
      const flats: [number, number, number][] = [[-50, 14, -1], [-22, 14, -1], [22, 14, -1], [-53, -14, 1], [-26, -14, 1], [22, -14, 1]];
      flats.forEach(([x, z, f], i) => {
        const [t, c] = texts[(i + 3) % texts.length];
        sign(t, c, x, 3.6 * 1.5, z, f, false);
      });

      // ---- 高架（動かない。下をくぐれる）と橋脚
      const concrete = new THREE.MeshLambertMaterial({ color: 0x9a968e });
      w.staticBox({ x: RAIL_X, y: RAIL_Y - 0.5, z: 0 }, { x: 4, y: 0.6, z: ARENA + 30 }, 0, concrete);
      for (let z = -66; z <= 66; z += 15) {
        if (Math.abs(z) < ROAD + WALK + 1) continue;
        for (const sx of [-1, 1]) w.staticBox({ x: RAIL_X + sx * 3, y: (RAIL_Y - 1.1) / 2, z }, { x: 0.6, y: (RAIL_Y - 1.1) / 2, z: 0.6 }, 0, concrete);
      }
      const rail = new THREE.MeshLambertMaterial({ color: 0x5a5a5e });
      for (const sx of [-1, 1]) {
        const r = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.9, (ARENA + 30) * 2), rail);
        r.position.set(RAIL_X + sx * 3.9, RAIL_Y + 0.55, 0);
        w.root.add(r);
      }
      train = makeTrain(w);

      // ---- 小道具: ガチャガチャ・自販機・立て看板・段ボール・自転車
      for (const [x0, z, n] of [[-28, 12.2, 8], [18, -12.2, 7], [-58, -12.2, 5], [58, 12.2, 5]] as const) {
        for (let k = 0; k < n; k++) w.spawnProp('gacha', { x: x0 + k * 0.62, y: 0.005, z }, z > 0 ? Math.PI : 0, S);
      }
      for (const [x, z] of [[-45, 12.6], [-44, 12.6], [36, -12.6], [37.1, -12.6], [-12, 12.6], [62, -12.6]] as const) w.spawnProp('vending', { x, y: 0.005, z }, z > 0 ? Math.PI : 0, S);
      for (let k = 0; k < 10; k++) {
        const x = -64 + k * 13.5;
        if (Math.abs(x) < CROSS + 2 || Math.abs(x - RAIL_X) < 5) continue;
        w.spawnProp('sign', { x, y: 0.005, z: k % 2 ? 8.2 : -8.2 }, Math.PI / 2, S);
      }
      const nBox = Math.round(5 * g.rule.clutter);
      for (let i = 0; i < nBox; i++) boxPile(w, -52 + i * 24, i % 2 ? 12.4 : -12.4, 2);
      for (let k = 0; k < 8; k++) w.spawnProp('bike', { x: -20 + k * 0.72, y: 0.005, z: -12.6 }, 0, S);
      for (let k = 0; k < 8; k++) w.spawnProp('bike', { x: 24 + k * 0.72, y: 0.005, z: 12.6 }, 0, S);
      // 裏通りの駐車場（車は爆発する）
      for (let k = 0; k < 3; k++) w.spawnProp('car', { x: -20 + k * 3, y: 0.005, z: 38 }, 0, S);
      for (let k = 0; k < 3; k++) w.spawnProp('car', { x: 40 + k * 3.2, y: 0.005, z: -40 }, 0, S);
      const nBarrel = Math.round(2 * g.rule.barrels);
      for (let i = 0; i < nBarrel; i++) w.spawnProp('barrel', { x: -6 + i * 1.6, y: 0.005, z: 40 }, 0, S);
      for (let k = 0; k < 10; k++) w.spawnProp('cone', { x: 60, y: 0.005, z: -30 + k * 1.2 }, 0, S);

      // ---- 車道の注意の帯（車が来る前から光る）
      const sm = new THREE.MeshBasicMaterial({ color: 0xff3030, transparent: true, opacity: 0, depthWrite: false });
      stripes = [w.floor(sm, ARENA * 2, ROAD * 2, 0, 0, 0.05, 2)];
      carMesh = makeCarMesh(g, w);
    },

    update(dt) {
      // ---- 歩行者天国と車
      phaseT -= dt;
      if (phase === 'hoko' && phaseT <= 0) {
        phase = 'warn';
        phaseT = WARN_TIME;
        g.hud.toast('歩行者天国、終了！ 車道から離れて！', 'warn');
        g.audio.horn();
        log('akiba.traffic', { phase: 'warn' }, { time: Math.round(g.time) });
      } else if (phase === 'warn' && phaseT <= 0) {
        phase = 'drive';
        phaseT = DRIVE_TIME;
        laneT.forEach((_, i) => (laneT[i] = Math.random() * 0.6));
        log('akiba.traffic', { phase: 'drive' }, { time: Math.round(g.time) });
      } else if (phase === 'drive') {
        if (phaseT > 0) {
          LANES.forEach(([lz, dir], i) => {
            laneT[i] -= dt;
            if (laneT[i] > 0 || cars.length >= CAR_CAP) return;
            laneT[i] = 1.1 + Math.random() * 1.3;
            spawnCar(lz, dir);
          });
        } else if (!cars.length) {
          phase = 'hoko';
          phaseT = HOKO_TIME;
          g.hud.toast('歩行者天国、再開', 'info');
          log('akiba.traffic', { phase: 'hoko' }, { time: Math.round(g.time), kills: trafficKills });
        }
      }
      const blink = phase === 'warn' || (phase === 'drive' && phaseT > 0);
      (stripes[0]?.material as THREE.MeshBasicMaterial | undefined)?.setValues({ opacity: blink ? 0.12 + 0.12 * Math.abs(Math.sin(g.time * 8)) : 0 });
      if (phase === 'warn' && Math.floor(phaseT * 2) !== Math.floor((phaseT + dt) * 2)) g.audio.horn();
      updateCars(dt);

      // ---- 看板: くっついていた壁が壊れたら落ちる
      signT -= dt;
      if (signT <= 0) {
        signT = 0.15;
        for (const s of signs) if (!s.body && s.chunk.state !== 'fixed') dropSign(s);
      }
      for (let i = signs.length - 1; i >= 0; i--) {
        const s = signs[i];
        if (!s.body) continue;
        s.age += dt;
        const t = s.body.translation();
        const r = s.body.rotation();
        s.mesh.position.set(t.x, t.y, t.z);
        s.mesh.quaternion.set(r.x, r.y, r.z, r.w);
        const v = s.body.linvel();
        const sp = Math.hypot(v.x, v.y, v.z);
        if (sp > 5) {
          for (const e of g.enemies.list) {
            if (e.state === 'dead' || s.hit.has(e)) continue;
            if (Math.hypot(e.x - t.x, e.y - t.y, e.z - t.z) > 1.6) continue;
            s.hit.add(e);
            g.enemies.damage(e, 30 + sp * 2, 'prop', { impulse: { x: v.x * 0.5, y: 3, z: v.z * 0.5 } });
          }
          const p = g.player;
          if (Math.hypot(p.pos.x - t.x, p.pos.y + 0.9 - t.y, p.pos.z - t.z) < 1.2) p.hurt(10, { x: t.x, y: t.y, z: t.z }, 'ネオン看板');
        }
        if (s.age > 14 || t.y < -5) {
          (s.mesh.material as THREE.MeshBasicMaterial).dispose();
          s.mesh.removeFromParent();
          g.physics.world.removeRigidBody(s.body);
          signs.splice(i, 1);
        }
      }

      // ---- 電車
      trainT -= dt;
      if (trainT <= 0 && trainZ > 900) {
        trainZ = -ARENA - 90;
        trainT = 36 + Math.random() * 10;
        log('akiba.train', {}, { time: Math.round(g.time) });
      }
      if (train && trainZ < 900) {
        trainZ += 26 * dt;
        train.position.set(RAIL_X, RAIL_Y + 0.1, trainZ);
        train.visible = true;
        const pd = Math.abs(g.player.pos.x - RAIL_X);
        const near = Math.abs(trainZ - g.player.pos.z) < 50;
        if (near && pd < 26 && Math.random() < dt * 6) {
          g.fx.shake('S');
          g.audio.crumble(0.25);
        }
        if (trainZ > ARENA + 90) {
          trainZ = 999;
          train.visible = false;
        }
      }
    },

    dispose() {
      for (const c of cars) g.physics.world.removeRigidBody(c.body);
      cars.length = 0;
      signs.length = 0;
    },
  };

  function spawnCar(lz: number, dir: number): void {
    const x = -dir * (ARENA + 8);
    const body = g.physics.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(x, 0.75, lz));
    // 敵と物だけを押す（ノリコとは物理的にはぶつからない。はねる処理は自前で行う）
    g.physics.world.createCollider(RAPIER.ColliderDesc.cuboid(1.95, 0.72, 0.88).setCollisionGroups(groups(G.ENEMY, G.ENEMY | G.PROP | G.DEBRIS)), body);
    cars.push({ body, x, z: lz, dir, speed: 19 + Math.random() * 6, color: CAR_COLORS[Math.floor(Math.random() * CAR_COLORS.length)], hit: new Set() });
  }

  function updateCars(dt: number): void {
    const p = g.player;
    for (let i = cars.length - 1; i >= 0; i--) {
      const c = cars[i];
      c.x += c.dir * c.speed * dt;
      c.body.setNextKinematicTranslation({ x: c.x, y: 0.75, z: c.z });
      if (Math.abs(c.x) > ARENA + 12) {
        g.physics.world.removeRigidBody(c.body);
        cars.splice(i, 1);
        continue;
      }
      // 敵をはねる
      for (const e of g.enemies.list) {
        if (e.state === 'dead' || c.hit.has(e)) continue;
        if (Math.abs(e.x - c.x) > 2.3 + e.radius || Math.abs(e.z - c.z) > 1.0 + e.radius || e.y > 2.6) continue;
        c.hit.add(e);
        const side = e.z >= c.z ? 1 : -1;
        const killed = g.enemies.damage(e, e.def.boss ? 120 : 90, 'traffic', { impulse: { x: c.dir * 26, y: 10, z: side * 7 } });
        if (killed) trafficKills++;
        g.fx.hitMark({ x: e.x, y: e.y, z: e.z }, 0.8);
        g.audio.hit(0.9);
      }
      // 物をはね飛ばす
      g.physics.querySphere({ x: c.x, y: 0.8, z: c.z }, 2.2, G.PROP | G.DEBRIS, (o) => {
        if (c.hit.has(o.ref)) return;
        c.hit.add(o.ref);
        const b = o.kind === 'prop' ? (o.ref as { body: RAPIER.RigidBody; alive: boolean }).body : (o.ref as Chunk).body;
        if (!b || b.isFixed()) return;
        const m = Math.min(400, b.mass());
        b.applyImpulse({ x: c.dir * m * 14, y: m * 5, z: (Math.random() - 0.5) * m * 4 }, true);
        if (o.kind === 'prop') w.heat(o.ref as Prop, 3);
      });
      // ノリコをはねる
      if (!p.dead && Math.abs(p.pos.x - c.x) < 2.5 && Math.abs(p.pos.z - c.z) < 1.3 && p.pos.y < 1.8 && !c.hit.has(p)) {
        c.hit.add(p);
        const side = p.pos.z >= c.z ? 1 : -1;
        p.hurt(24, { x: c.x, y: 0.8, z: c.z }, '暴走車');
        p.launch(c.dir * 9, 7, side * 9);
        log('akiba.hit.player', {}, { time: Math.round(g.time) });
      }
    }
    // 見た目
    if (!carMesh) return;
    carMesh.count = cars.length;
    cars.forEach((c, i) => {
      tq.setFromAxisAngle(tv.set(0, 1, 0), c.dir > 0 ? Math.PI / 2 : -Math.PI / 2);
      tm.compose(tv.set(c.x, 0.02 + Math.abs(Math.sin(g.time * 30 + i)) * 0.03, c.z), tq, ts);
      carMesh!.setMatrixAt(i, tm);
      carMesh!.setColorAt(i, tc.setHex(c.color));
    });
    carMesh.instanceMatrix.needsUpdate = true;
    if (carMesh.instanceColor) carMesh.instanceColor.needsUpdate = true;
  }

  function dropSign(s: Sign): void {
    const p = s.mesh.position;
    const q = s.mesh.quaternion;
    const body = g.physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(p.x, p.y, p.z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }).setLinearDamping(0.05).setAngularDamping(0.3),
    );
    g.physics.world.createCollider(RAPIER.ColliderDesc.cuboid(s.w / 2, s.h / 2, 0.08).setMass(30).setCollisionGroups(groups(G.DEBRIS, G_ALL & ~G.PLAYER)), body);
    body.setLinvel({ x: (Math.random() - 0.5) * 2, y: 0, z: (Math.random() - 0.5) * 2 }, true);
    body.setAngvel({ x: (Math.random() - 0.5) * 3, y: 0, z: (Math.random() - 0.5) * 3 }, true);
    s.body = body;
    g.audio.clank(0.8);
    log('akiba.sign.drop', {}, { time: Math.round(g.time) });
  }

  void onRoad;
}

/** 道路の白線と横断歩道。 */
function roadLines(w: WorldMap): void {
  const cv = document.createElement('canvas');
  cv.width = 256;
  cv.height = 128;
  const c = cv.getContext('2d')!;
  // 中央線（黄）と車線（白の破線）。1 枚で 8m ぶん
  c.fillStyle = 'rgba(255,210,60,0.9)';
  c.fillRect(0, 60, 256, 3);
  c.fillRect(0, 66, 256, 3);
  c.fillStyle = 'rgba(255,255,255,0.85)';
  for (const y of [32, 96]) c.fillRect(0, y - 1, 150, 3);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.repeat.set((ARENA * 2) / 8, 1);
  w.floor(new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false }), ARENA * 2, ROAD * 2 * (128 / 112), 0, 0, 0.03, 2);
  // 横断歩道
  const zc = document.createElement('canvas');
  zc.width = 64;
  zc.height = 64;
  const z = zc.getContext('2d')!;
  z.fillStyle = 'rgba(255,255,255,0.85)';
  z.fillRect(0, 8, 64, 24);
  const zt = new THREE.CanvasTexture(zc);
  zt.wrapT = THREE.RepeatWrapping;
  zt.repeat.set(1, ROAD * 2 / 1.2);
  const zm = new THREE.MeshBasicMaterial({ map: zt, transparent: true, depthWrite: false });
  for (const x of [-CROSS - 3, CROSS + 3]) w.floor(zm, 4, ROAD * 2, x, 0, 0.035, 3);
  const zt2 = zt.clone();
  zt2.repeat.set(1, (CROSS * 2) / 1.2);
  zt2.needsUpdate = true;
  const zm2 = new THREE.MeshBasicMaterial({ map: zt2, transparent: true, depthWrite: false });
  for (const zz of [-ROAD - 2, ROAD + 2]) {
    const m = w.floor(zm2, 4, CROSS * 2, 0, zz, 0.035, 3);
    m.rotation.z = Math.PI / 2;
  }
}

/** 走る車の見た目（色違いを 1 つの InstancedMesh で描く）。 */
function makeCarMesh(g: Game, w: WorldMap): THREE.InstancedMesh {
  const mm = g.assets.merged.get('p_car');
  let geo: THREE.BufferGeometry;
  if (mm) {
    geo = mm.geo.clone();
    geo.translate(-(mm.min.x + mm.max.x) / 2, -mm.min.y, -(mm.min.z + mm.max.z) / 2);
  } else geo = new THREE.BoxGeometry(1.8, 1.4, 4).translate(0, 0.7, 0);
  const mesh = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ vertexColors: !!mm }), CAR_CAP);
  mesh.count = 0;
  mesh.castShadow = true;
  mesh.frustumCulled = false;
  mesh.setColorAt(0, new THREE.Color(1, 1, 1));
  w.root.add(mesh);
  return mesh;
}

/** 高架を走る電車（見た目だけ）。4 両編成、銀色に黄色の帯。 */
function makeTrain(w: WorldMap): THREE.Group {
  const grp = new THREE.Group();
  const body = new THREE.MeshLambertMaterial({ color: 0xd8dade });
  const band = new THREE.MeshLambertMaterial({ color: 0xf2c418 });
  const win = new THREE.MeshLambertMaterial({ color: 0x2a3440, emissive: 0x334455 });
  for (let k = 0; k < 4; k++) {
    const z = k * 20.5;
    const car = new THREE.Mesh(new THREE.BoxGeometry(2.9, 3.0, 20), body);
    car.position.set(0, 1.6, z);
    car.castShadow = true;
    const b = new THREE.Mesh(new THREE.BoxGeometry(2.94, 0.35, 20.02), band);
    b.position.set(0, 1.0, z);
    const wdw = new THREE.Mesh(new THREE.BoxGeometry(2.96, 0.8, 17), win);
    wdw.position.set(0, 2.1, z);
    grp.add(car, b, wdw);
  }
  grp.visible = false;
  w.root.add(grp);
  return grp;
}
