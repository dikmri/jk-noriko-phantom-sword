/**
 * 温泉街（夕方）。谷あいの段々の町並み。南（z が小さい方）が低く、北へ 4m ずつ 4 段上がる。段の境目は石垣の崖。
 * 中央を石畳の坂道（大通り）がまっすぐ北へ登り、東西の石段でも段と段がつながる。西に湯の川。
 * 仕掛け: 間欠泉（赤い輪で予告して噴き上がり、上の敵とノリコを打ち上げる）、坂を転がり落ちる酒樽、入った敵が燃える露天風呂。
 */
import * as THREE from 'three';
import { G } from '../../core/physics';
import { log } from '../../log';
import { SH, ZONE } from '../fx';
import type { Game } from '../game';
import { ARENA, Prop, WorldMap } from '../world';
import type { Stage } from './index';
import { CLIFF, EDGES, GEYSERS, onsenHeight, poolDist, POOL_WATER, POOLS, RIVER_W, riverX, ST_BLEND, ST_W, ST_Z0, ST_Z1, STAIR_L, STAIR_W, STAIRS_X, STEP_H, streetH, streetZAt, terraceH } from './onsen_shape';
import { cobble, ishigaki, ryokanWall, signBoard, stoneStairs } from './onsen_tex';
import { HeightGrid, smoothstep, terrainMesh } from './terrain';
import { dirt, water } from './textures';

/** 間欠泉: 予告の秒数と、噴いている秒数 */
const G_WARN = 1.6;
const G_BURST = 1.3;
/** 酒樽の山の位置（大通りの上端の平らな所）。樽は X 軸の円柱なので z 方向に転がる。崩れると、南の坂を転がり落ちる */
const TARU_STACKS = [
  { x: -2.6, z: 48.4 },
  { x: 2.6, z: 48.4 },
];
const S = { sleep: true };

/** 地面に沿わせた帯（道・石段・石垣・川の水面）。pts は中心線、half は半幅、across は横の分割数。 */
function drape(
  w: WorldMap, grid: HeightGrid, pts: { x: number; z: number }[], half: number, across: number, mat: THREE.Material,
  lift: number, vPer: number, uScale = 1, swap = false,
): THREE.Mesh {
  const vs: number[] = [];
  const uvs: number[] = [];
  const ix: number[] = [];
  const cols = across + 1;
  let dist = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const dl = Math.hypot(dx, dz) || 1;
    const nx = -dz / dl;
    const nz = dx / dl;
    if (i > 0) dist += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
    for (let j = 0; j <= across; j++) {
      const s = -1 + (2 * j) / across;
      const x = pts[i].x + nx * half * s;
      const z = pts[i].z + nz * half * s;
      vs.push(x, grid.at(x, z) + lift, z);
      const u = ((s + 1) / 2) * uScale;
      const v = dist / vPer;
      if (swap) uvs.push(v, u);
      else uvs.push(u, v);
    }
    if (i > 0) {
      for (let j = 0; j < across; j++) {
        const a0 = (i - 1) * cols + j;
        const b0 = i * cols + j;
        ix.push(a0, b0, a0 + 1, a0 + 1, b0, b0 + 1);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(vs, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(ix);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  w.root.add(mesh);
  return mesh;
}

function line(x0: number, z0: number, x1: number, z1: number, step: number): { x: number; z: number }[] {
  const n = Math.max(1, Math.round(Math.hypot(x1 - x0, z1 - z0) / step));
  const out: { x: number; z: number }[] = [];
  for (let i = 0; i <= n; i++) out.push({ x: x0 + ((x1 - x0) * i) / n, z: z0 + ((z1 - z0) * i) / n });
  return out;
}

interface Geyser {
  x: number;
  z: number;
  r: number;
  gy: number;
  t: number;
  phase: 'idle' | 'warn' | 'burst';
  col: THREE.Mesh | null;
  steamT: number;
}

export function onsen(g: Game, w: WorldMap): Stage {
  const grid = HeightGrid.build(-ARENA - 10, -ARENA - 10, ARENA + 10, ARENA + 10, 1.2, onsenHeight);
  const geysers: Geyser[] = GEYSERS.map((v, i) => ({ ...v, gy: 0, t: 8 + i * 5, phase: 'idle', col: null, steamT: 0 }));
  const poolY = POOLS.map((p) => terraceH(p.z) + POOL_WATER);
  /** 積んである酒樽（叩くと転がる）と、上から転がってくる酒樽 */
  const stacked: Prop[] = [];
  const knocked = new Set<Prop>();
  const rolling: { prop: Prop; cd: number }[] = [];
  let taruT = 30;
  let taruPending = -1;
  let taruTotal = 0;
  let knockLogT = 0;
  let wetT = 0;
  let steamT = 0;
  let boiled = 0;
  let boilLogT = 15;
  let waterTex: THREE.Texture | null = null;
  const floaters: { prop: Prop; pool: number }[] = [];

  const inPool = (x: number, z: number, k = 0.95) => poolDist(x, z).d < k;
  const inRiver = (x: number, z: number, pad = 0) => Math.abs(x - riverX(z)) < RIVER_W - 0.6 + pad;

  /** 湯けむり。 */
  const steam = (x: number, y: number, z: number, size = 1, alpha = 0.32) => {
    g.fx.spawn({
      pos: { x: x + (Math.random() - 0.5) * size, y, z: z + (Math.random() - 0.5) * size },
      vel: { x: (Math.random() - 0.5) * 0.4, y: 0.9 + Math.random() * 0.7, z: (Math.random() - 0.5) * 0.4 },
      drag: 0.5, life: 2.2, size: 0.7 * size, size2: 2.4 * size, color: 0xffffff, color2: 0xf0e4dc, shape: SH.PUFF, alpha,
    });
  };

  /** 間欠泉が噴き上がる: 範囲の敵を高く打ち上げて、ぬらして燃やす。物とノリコも打ち上げる。 */
  const burst = (gs: Geyser, i: number) => {
    let n = 0;
    const at = { x: gs.x, y: gs.gy, z: gs.z };
    g.enemies.inRadius(at, gs.r, (e) => {
      if (Math.abs(e.y - gs.gy) > 4) return;
      g.enemies.wetIt(e, 4);
      g.enemies.damage(e, 10 * g.stats.power, 'skill', { kind: 'magic', quiet: true });
      if (e.alive && e.state !== 'dead') {
        e.burn = Math.max(e.burn, 2);
        e.burnDps = Math.max(e.burnDps, 6);
      }
      if (e.def.boss) return;
      const dx = e.x - gs.x;
      const dz = e.z - gs.z;
      const d = Math.hypot(dx, dz) || 1;
      g.enemies.launch(e, { x: (dx / d) * 2.5, y: 17 + Math.random() * 3, z: (dz / d) * 2.5 });
      n++;
    });
    g.physics.querySphere({ x: gs.x, y: gs.gy + 1, z: gs.z }, gs.r, G.PROP | G.DEBRIS, (o) => {
      const p = o.ref as Prop;
      if (o.kind === 'prop' && p.alive && !p.rooted) {
        p.body.applyImpulse({ x: 0, y: p.mass * 15, z: 0 }, true);
        w.heat(p, 3);
      }
    });
    const pl = g.player;
    const pd = Math.hypot(pl.pos.x - gs.x, pl.pos.z - gs.z);
    const hitPlayer = pd < gs.r && Math.abs(pl.pos.y - gs.gy) < 2.5;
    if (hitPlayer) {
      const dx = pl.pos.x - gs.x;
      const dz = pl.pos.z - gs.z;
      const d = pd || 1;
      pl.launch((dx / d) * 3, 17, (dz / d) * 3);
    }
    for (let k = 0; k < 26; k++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 1.5 + Math.random() * 3.5;
      g.fx.spawn({ pos: { x: gs.x, y: gs.gy + 0.5, z: gs.z }, vel: { x: Math.cos(a) * sp, y: 6 + Math.random() * 8, z: Math.sin(a) * sp }, grav: -14, life: 0.9, size: 0.35, size2: 0.15, color: 0xe8f8ff, shape: 0, alpha: 0.9 });
    }
    for (let k = 0; k < 8; k++) steam(gs.x, gs.gy + 1 + Math.random() * 6, gs.z, 2.2, 0.4);
    g.fx.ring({ x: gs.x, y: gs.gy + 0.15, z: gs.z }, 0.5, gs.r, 0xffffff, 0.4, 0.6);
    const near = Math.hypot(pl.pos.x - gs.x, pl.pos.z - gs.z) < 30;
    if (near) {
      g.audio.splash(1.6);
      g.fx.shake('S');
    }
    log('onsen.geyser', { i }, { launched: n, player: hitPlayer, time: Math.round(g.time) });
  };

  /** 上の通りから酒樽を 3 つ転がす。 */
  const rollTaru = () => {
    let n = 0;
    for (const x of [-2.2, 0, 2.2]) {
      const z = ST_Z1 - 1.5;
      const prop = w.spawnProp('taru', { x, y: grid.at(x, z) + 0.05, z }, 0, { hot: 30, dmgMul: 1.3, life: 24, vel: { x: (Math.random() - 0.5) * 0.6, y: 0, z: -5 } });
      if (prop) {
        rolling.push({ prop, cd: 0 });
        n++;
      }
    }
    taruTotal += n;
    log('onsen.taru', {}, { rolled: n, total: taruTotal, time: Math.round(g.time) });
  };

  return {
    start: { x: 0, z: -52 },
    sky: { top: 0x4b5c9e, mid: 0xffb27e, fog: 0xe6a688, fogNear: 55, fogFar: 175, sun: 0xffb27a, sunI: 2.0, hemiSky: 0xffd6b8, hemiGround: 0x6a4a3a, hemiI: 1.1 },
    heightAt: (x, z) => grid.at(x, z),

    steer(e, tx, tz) {
      void tx;
      void tz;
      if (e.def.behavior === 'heli') return null;
      const p = g.player.pos;
      const eg = grid.at(e.x, e.z);
      // 屋根の上などではなく、ノリコの足元の地面の高さで比べる
      const pg = grid.at(p.x, p.z);
      // 同じ段なら（風呂のくぼみ程度の差は無視）、ふつうにノリコへ向かう
      if (pg - eg < 0.8) return null;
      const norm = (x: number, z: number): [number, number] => {
        const d = Math.hypot(x, z) || 1;
        return [x / d, z / d];
      };
      // 大通りの上: ノリコの段と同じ高さになる所まで坂を登る
      if (Math.abs(e.x) < ST_W + 1 && e.z > ST_Z0 - 4) {
        const goal = streetZAt(pg);
        const gx = Math.max(-ST_W + 1, Math.min(ST_W - 1, p.x));
        return norm(gx - e.x, goal + 3 - e.z);
      }
      // 段の上: 次の段への登り口（大通りか石段のうち、近い方）へ
      // いまいる段（石段の途中は、下の段として数える）
      const k = Math.floor((eg + 1) / STEP_H);
      if (k < 0 || k >= EDGES.length) return null;
      const edge = EDGES[k];
      let bx = 0;
      let bd = Math.abs(e.x);
      for (const sx of STAIRS_X) {
        const d = Math.abs(e.x - sx);
        if (d < bd) {
          bd = d;
          bx = sx;
        }
      }
      // 大通りへは、道の高さがいまの段と同じになる所から横に入る（急な土手を登らずにすむ）
      if (bx === 0) return norm(-e.x, streetZAt(eg) - 1 - e.z);
      // 石段: 下の入口まで行ってから、上へ
      const onStair = bd < STAIR_W + 0.3 && e.z > edge - STAIR_L - 1.5 && e.z < edge + STAIR_L + 1;
      const gz = onStair ? edge + STAIR_L + 2 : edge - STAIR_L - 1;
      return norm(bx - e.x, gz - e.z);
    },

    build() {
      // ---- 地面（段々・大通り・石段・川・風呂のくぼみ・山）
      const town = new THREE.Color().setRGB(1.08, 1.0, 0.92);
      const forest = new THREE.Color().setRGB(0.52, 0.84, 0.48);
      const bed = new THREE.Color().setRGB(0.7, 0.66, 0.6);
      const c = new THREE.Color();
      terrainMesh(w, grid, dirt(1), 9.6, (x, z) => {
        const m = Math.max(smoothstep(60, 66, Math.abs(x)), smoothstep(61, 67, z));
        if (m > 0) return c.copy(town).lerp(forest, m);
        if (inRiver(x, z, 1.2)) return c.copy(bed);
        return c.copy(town);
      });
      // 大通りの石畳
      const cob = cobble();
      drape(w, grid, line(0, ST_Z0 - 10, 0, ST_Z1 + 8, 1), ST_W, 2, new THREE.MeshLambertMaterial({ map: cob, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 }), 0.05, 4, 2);
      // 石段
      const stairMat = new THREE.MeshLambertMaterial({ map: stoneStairs(), side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 });
      for (const sx of STAIRS_X) for (const e of EDGES) drape(w, grid, line(sx, e - STAIR_L - 0.6, sx, e + STAIR_L + 0.6, 0.5), STAIR_W, 2, stairMat, 0.06, 2.25);
      // 石垣（段の境目の崖）。大通りと石段の所は空ける
      const wallMat = new THREE.MeshLambertMaterial({ map: ishigaki(), side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1 });
      const spans: [number, number][] = [[-64, -STAIRS_X[1] - STAIR_W - 1.4], [-STAIRS_X[1] + STAIR_W + 1.4, -ST_W - ST_BLEND - 0.4], [ST_W + ST_BLEND + 0.4, STAIRS_X[1] - STAIR_W - 1.4], [STAIRS_X[1] + STAIR_W + 1.4, 64]];
      for (const e of EDGES) for (const [x0, x1] of spans) drape(w, grid, line(x0, e, x1, e, 1), CLIFF + 0.5, 8, wallMat, 0.05, 3, 1, true);
      // 湯の川の水面（崖では滝になる）
      waterTex = water(1);
      waterTex.repeat.set(1, 1);
      const riverPts: { x: number; z: number }[] = [];
      for (let z = -ARENA - 8; z <= ARENA - 8; z += 1.5) riverPts.push({ x: riverX(z), z });
      drape(w, grid, riverPts, RIVER_W - 0.2, 3, new THREE.MeshLambertMaterial({ map: waterTex, color: 0xd8f4f0, emissive: 0x302018, transparent: true, opacity: 0.82, depthWrite: false, side: THREE.DoubleSide }), 0.42, 6);
      w.bounds(new THREE.MeshLambertMaterial({ color: 0x5a3e2a }), 2.2);

      // ---- 露天風呂（湯の面・縁の岩・湯桶）
      const poolTex = water(1);
      poolTex.repeat.set(2, 2);
      const poolMat = new THREE.MeshLambertMaterial({ map: poolTex, color: 0xc8f0ec, emissive: 0x3a3028, transparent: true, opacity: 0.86, depthWrite: false });
      const rockGeo = new THREE.DodecahedronGeometry(1, 0);
      const rocks = new THREE.InstancedMesh(rockGeo, new THREE.MeshLambertMaterial({ color: 0x8a847a }), POOLS.length * 26 + GEYSERS.length * 12);
      const m4 = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const ev = new THREE.Euler();
      let ri = 0;
      POOLS.forEach((p, i) => {
        const surf = new THREE.Mesh(new THREE.CircleGeometry(1, 40), poolMat);
        surf.rotation.x = -Math.PI / 2;
        surf.scale.set(p.rx * 0.98, p.rz * 0.98, 1);
        surf.position.set(p.x, poolY[i], p.z);
        w.root.add(surf);
        for (let k = 0; k < 26; k++) {
          const a = (k / 26) * Math.PI * 2;
          const x = p.x + Math.cos(a) * p.rx * 1.02;
          const z = p.z + Math.sin(a) * p.rz * 1.02;
          const s = 0.35 + Math.random() * 0.3;
          q.setFromEuler(ev.set(Math.random() * 3, Math.random() * 3, Math.random() * 3));
          m4.compose(new THREE.Vector3(x, terraceH(p.z) + s * 0.3, z), q, new THREE.Vector3(s * 1.2, s * 0.8, s));
          rocks.setMatrixAt(ri++, m4);
        }
        // 浮かぶ湯桶と、縁に積んだ湯桶
        for (let k = 0; k < 2; k++) {
          const prop = w.spawnProp('oke', { x: p.x + (k ? 1.5 : -1.8), y: poolY[i] - 0.1, z: p.z + (k ? -1 : 0.8) }, Math.random() * 6, {});
          if (prop) floaters.push({ prop, pool: i });
        }
        const bx = p.x + p.rx + 1.6;
        for (let k = 0; k < 3; k++) w.spawnProp('oke', { x: bx, y: terraceH(p.z) + k * 0.31 + 0.01, z: p.z }, k * 0.4, S);
        // 石灯籠
        w.spawnProp('toro', { x: p.x - p.rx - 1.5, y: terraceH(p.z) + 0.01, z: p.z + p.rz * 0.5 }, 0, S);
        w.spawnProp('bench', { x: p.x, y: terraceH(p.z) + 0.01, z: p.z - p.rz - 1.8 }, 0, S);
      });

      // ---- 間欠泉（湯の花で白くなった地面、岩の輪と穴。噴き上がる湯柱）
      const sinter = new THREE.MeshLambertMaterial({ color: 0xe8dcb8 });
      const vent = new THREE.MeshBasicMaterial({ color: 0x2a2420 });
      const colMat = new THREE.MeshBasicMaterial({ color: 0xf4fbff, transparent: true, opacity: 0.78, depthWrite: false });
      for (const gs of geysers) {
        gs.gy = grid.at(gs.x, gs.z);
        const ring = new THREE.Mesh(new THREE.CircleGeometry(2.4, 20), sinter);
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(gs.x, gs.gy + 0.03, gs.z);
        for (let k = 0; k < 12; k++) {
          const a = (k / 12) * Math.PI * 2 + Math.random() * 0.3;
          const s = 0.28 + Math.random() * 0.22;
          q.setFromEuler(ev.set(Math.random() * 3, Math.random() * 3, Math.random() * 3));
          m4.compose(new THREE.Vector3(gs.x + Math.cos(a) * 1.15, gs.gy + s * 0.25, gs.z + Math.sin(a) * 1.15), q, new THREE.Vector3(s * 1.2, s * 0.8, s));
          rocks.setMatrixAt(ri++, m4);
        }
        const hole = new THREE.Mesh(new THREE.CircleGeometry(0.85, 16), vent);
        hole.rotation.x = -Math.PI / 2;
        hole.position.set(gs.x, gs.gy + 0.06, gs.z);
        const col = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.5, 12, 14, 1, true), colMat);
        col.position.set(gs.x, gs.gy + 6, gs.z);
        col.visible = false;
        gs.col = col;
        w.root.add(ring, hole, col);
      }
      rocks.count = ri;
      w.root.add(rocks);

      // ---- 旅館と土産物屋（壊せる。黒い板張りと障子窓）
      w.registerWallStyle('ryokan', { plain: ryokanWall(false), win: ryokanWall(true), edge: 0x3a2a1e });
      const R = { style: 'ryokan', hp: 60 };
      const house = (x0: number, z0: number, cols: number, depth: number, floors: number, door: 'front' | 'back' | 'left' | 'right', at: number) => {
        w.addBuilding(x0, z0, cols, depth, floors, { ...R, doors: [{ side: door, at }], y0: terraceH(z0 + depth) - 0.1 });
      };
      // 0 段目（ふもと）
      house(-26, -52, 5, 4, 1, 'right', 1);
      house(14, -50, 4, 4, 2, 'left', 1);
      house(30, -64, 6, 4, 1, 'front', 2);
      // 1 段目
      house(-28, -24, 5, 4, 1, 'right', 1);
      house(42, -25, 4, 4, 1, 'left', 1);
      // 2 段目
      house(14, -3, 5, 4, 2, 'left', 1);
      house(44, -4, 5, 5, 1, 'left', 1);
      house(-52, 0, 4, 4, 1, 'right', 1);
      // 3 段目
      house(-50, 18, 4, 4, 1, 'right', 1);
      house(42, 18, 5, 4, 1, 'left', 1);
      // 4 段目（いちばん上）: 大きな老舗旅館と、離れ
      house(-14, 54, 14, 4, 2, 'front', 6);
      house(42, 40, 4, 4, 1, 'left', 1);

      // ---- 入口の門と看板
      const wood = new THREE.MeshLambertMaterial({ color: 0x5a3a24 });
      for (const sx of [-1, 1]) w.staticCyl({ x: sx * 5.4, y: 0, z: ST_Z0 - 3 }, 0.3, 5.6, wood, 10);
      const beam = new THREE.Mesh(new THREE.BoxGeometry(13, 0.5, 0.6), wood);
      beam.position.set(0, 5.7, ST_Z0 - 3);
      const signTex = signBoard('温泉街', '#2a1c12', '#f2d8a0');
      const sign = new THREE.Mesh(new THREE.BoxGeometry(1.25, 2.2, 0.12), [wood, wood, wood, wood, new THREE.MeshBasicMaterial({ map: signTex }), new THREE.MeshBasicMaterial({ map: signTex })]);
      sign.position.set(0, 4.3, ST_Z0 - 3);
      w.root.add(beam, sign);

      // ---- 大通りの提灯（見た目だけ）と明かり
      lanterns(w, grid);
      for (const lz of [-28, 4, 38]) {
        const l = new THREE.PointLight(0xffb070, 45, 30, 1.6);
        l.position.set(0, streetH(lz) + 5, lz);
        w.root.add(l);
      }

      // ---- 酒樽の山（叩くと坂を転がる）
      for (const st of TARU_STACKS) {
        const gy = grid.at(st.x, st.z);
        for (let row = 0; row < 3; row++) {
          for (let k = 0; k < 3 - row; k++) {
            // 隣どうし・地面とめり込まない間隔で積む（めり込むと、始まってすぐ崩れる）
            const prop = w.spawnProp('taru', { x: st.x, y: gy + row * 0.89 + 0.03, z: st.z + (k - (2 - row) / 2) * 1.03 }, 0, { ...S, dmgMul: 1.3 });
            if (prop) stacked.push(prop);
          }
        }
      }

      // ---- 木（段のすみ）と、山の杉（見た目だけ）
      const rng = g.rng;
      for (let k = 0; k < 40; k++) {
        const x = (rng() < 0.5 ? -1 : 1) * (12 + rng() * 48);
        const z = -66 + rng() * 128;
        if (!w.free(x, z, 1.5) || Math.abs(x - riverX(z)) < RIVER_W + 2 || grid.slope(x, z) > 0.3 || poolDist(x, z).d < 1.6) continue;
        if (STAIRS_X.some((sx) => Math.abs(x - sx) < STAIR_W + 3) || GEYSERS.some((v) => Math.hypot(x - v.x, z - v.z) < v.r + 2)) continue;
        w.spawnProp('tree', { x, y: grid.at(x, z) - 0.1, z }, rng() * 6, { scale: 0.7 + rng() * 0.35 });
      }
      cedars(w, grid, rng);
      farMountains(w, rng);

      // ---- 自動販売機・看板・ドラム缶
      for (const [x, z, yaw] of [[24, -44, -Math.PI / 2], [25.5, 1, -Math.PI / 2], [-16.5, -14, Math.PI / 2]] as const) w.spawnProp('vending', { x, y: grid.at(x, z) + 0.01, z }, yaw, S);
      for (const [x, z] of [[-8, -48], [8, -36], [-8, -10], [8, 12]] as const) w.spawnProp('sign', { x, y: grid.at(x, z) + 0.01, z }, 0, S);
      const nBarrel = Math.round(3 * g.rule.barrels);
      for (let i = 0; i < nBarrel; i++) {
        const x = 46 + (i % 3) * 1.2;
        const z = -12 + Math.floor(i / 3) * 1.2;
        w.spawnProp('barrel', { x, y: grid.at(x, z) + 0.01, z }, 0, S);
      }
    },

    surface(x, z, out) {
      if (inPool(x, z)) {
        out.water = true;
        out.speed = 0.6;
        out.grip = 0.8;
      } else if (inRiver(x, z)) {
        out.water = true;
        out.speed = 0.7;
        out.grip = 0.85;
      }
    },

    spawnOk(x, z) {
      if (Math.abs(x) > 60 || z > 61) return false;
      if (inPool(x, z, 1.25) || inRiver(x, z, 1.2)) return false;
      if (GEYSERS.some((v) => Math.hypot(x - v.x, z - v.z) < v.r + 1)) return false;
      for (const b of w.blocked) if (x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1) return false;
      return grid.slope(x, z) < 0.45;
    },

    update(dt) {
      if (waterTex) waterTex.offset.y -= dt * 0.25;
      const pl = g.player;
      // ---- 間欠泉
      for (let i = 0; i < geysers.length; i++) {
        const gs = geysers[i];
        gs.t -= dt;
        gs.steamT -= dt;
        if (gs.phase === 'idle') {
          if (gs.steamT <= 0) {
            gs.steamT = 0.5;
            steam(gs.x, gs.gy + 0.4, gs.z, 1, 0.25);
          }
          if (gs.t <= G_WARN) {
            gs.phase = 'warn';
            // ノリコにも当たるので、予告は赤
            g.fx.ring({ x: gs.x, y: gs.gy + 0.12, z: gs.z }, gs.r * 0.85, gs.r, ZONE.enemy, G_WARN, 0.85);
            if (Math.hypot(pl.pos.x - gs.x, pl.pos.z - gs.z) < 26) g.audio.warn();
          }
        } else if (gs.phase === 'warn') {
          if (Math.random() < dt * 24) g.fx.spawn({ pos: { x: gs.x + (Math.random() - 0.5) * 1.6, y: gs.gy + 0.3, z: gs.z + (Math.random() - 0.5) * 1.6 }, vel: { x: 0, y: 2 + Math.random() * 3, z: 0 }, grav: -8, life: 0.5, size: 0.3, size2: 0.15, color: 0xdff4ff, shape: 0, alpha: 0.9 });
          if (gs.steamT <= 0) {
            gs.steamT = 0.15;
            steam(gs.x, gs.gy + 0.4, gs.z, 1.2, 0.35);
          }
          if (gs.t <= 0) {
            gs.phase = 'burst';
            gs.t = G_BURST;
            if (gs.col) gs.col.visible = true;
            burst(gs, i);
          }
        } else {
          if (gs.col) {
            const k = Math.min(1, (G_BURST - gs.t) / 0.15) * Math.min(1, gs.t / 0.4);
            gs.col.scale.set(1, Math.max(0.01, k), 1);
            gs.col.position.y = gs.gy + 6 * Math.max(0.01, k);
          }
          if (Math.random() < dt * 50) {
            const a = Math.random() * Math.PI * 2;
            g.fx.spawn({ pos: { x: gs.x, y: gs.gy + 9 + Math.random() * 3, z: gs.z }, vel: { x: Math.cos(a) * 3, y: 2, z: Math.sin(a) * 3 }, grav: -14, life: 1, size: 0.5, size2: 0.2, color: 0xe8f8ff, shape: 0, alpha: 0.9 });
          }
          if (gs.t <= 0) {
            gs.phase = 'idle';
            gs.t = 12 + Math.random() * 6;
            if (gs.col) gs.col.visible = false;
          }
        }
      }

      // ---- 露天風呂と湯の川: 入った敵はぬれる。風呂は熱いので燃える
      wetT -= dt;
      if (wetT <= 0) {
        wetT = 0.25;
        const dps = 6 + g.time * 0.02;
        for (const e of g.enemies.list) {
          if (!e.alive || e.state === 'dead') continue;
          const pd = poolDist(e.x, e.z);
          if (pd.d < 0.95 && e.y < poolY[pd.i] + e.halfH + e.radius + 0.5) {
            g.enemies.wetIt(e, 3);
            if (e.burn <= 0) boiled++;
            e.burn = Math.max(e.burn, 1.2);
            e.burnDps = Math.max(e.burnDps, dps);
          } else if (inRiver(e.x, e.z)) g.enemies.wetIt(e, 4);
        }
      }
      boilLogT -= dt;
      if (boilLogT <= 0) {
        boilLogT = 15;
        if (boiled > 0) log('onsen.pool', {}, { boiled, time: Math.round(g.time) });
        boiled = 0;
      }
      for (const f of floaters) floatOke(f.prop, POOLS[f.pool], poolY[f.pool], dt);

      // ---- 湯けむり（風呂と川）
      steamT -= dt;
      if (steamT <= 0) {
        steamT = 0.12;
        const i = Math.floor(Math.random() * POOLS.length);
        const p = POOLS[i];
        const a = Math.random() * Math.PI * 2;
        const r = Math.random() * 0.8;
        steam(p.x + Math.cos(a) * p.rx * r, poolY[i] + 0.2, p.z + Math.sin(a) * p.rz * r, 1.4, 0.28);
        if (Math.random() < 0.35) {
          const z = pl.pos.z + (Math.random() - 0.5) * 50;
          steam(riverX(z), grid.at(riverX(z), z) + 0.6, z, 2, 0.2);
        }
      }

      // ---- 酒樽: 積んである樽は、叩かれて転がり出したら当たると痛い
      knockLogT -= dt;
      for (const p of stacked) {
        if (!p.alive || p.body.isSleeping()) continue;
        const v = p.body.linvel();
        const sp = Math.hypot(v.x, v.y, v.z);
        if (sp > 2.5) w.heat(p, 0.6);
        if (sp > 3 && !knocked.has(p)) {
          knocked.add(p);
          if (knockLogT <= 0) {
            knockLogT = 2;
            log('onsen.taru.knock', {}, { count: knocked.size, time: Math.round(g.time) });
          }
        }
      }
      // 上から転がってくる酒樽: 予告（大通りに赤い輪）のあと 1.3 秒で転がす
      taruT -= dt;
      if (taruT <= 0) {
        taruT = 26 + Math.random() * 8;
        taruPending = 1.3;
        g.hud.toast('酒樽が転がってくる！ 大通りから離れて！', 'warn');
        if (Math.abs(pl.pos.x) < 20) g.audio.warn();
        for (const z of [40, 26, 12, -2, -16, -30]) g.fx.ring({ x: 0, y: streetH(z) + 0.15, z }, ST_W * 0.7, ST_W, ZONE.enemy, 1.6, 0.8);
      }
      if (taruPending > 0) {
        taruPending -= dt;
        if (taruPending <= 0) rollTaru();
      }
      for (let i = rolling.length - 1; i >= 0; i--) {
        const r = rolling[i];
        if (!r.prop.alive) {
          rolling.splice(i, 1);
          continue;
        }
        r.cd -= dt;
        const t = r.prop.body.translation();
        const v = r.prop.body.linvel();
        const sp = Math.hypot(v.x, v.y, v.z);
        if (sp > 2) w.heat(r.prop, 1);
        if (sp > 4 && Math.random() < dt * 8) g.fx.dust({ x: t.x, y: t.y - r.prop.half.y, z: t.z }, 0.8, 0xb8a888, 1);
        // ノリコをひく
        if (r.cd <= 0 && sp > 4 && Math.hypot(pl.pos.x - t.x, pl.pos.y + 0.9 - t.y, pl.pos.z - t.z) < r.prop.half.y + 0.75) {
          r.cd = 1;
          pl.hurt(20, { x: t.x, y: t.y, z: t.z }, '酒樽');
          pl.launch(v.x * 0.5, 6, v.z * 0.5);
        }
      }
    },

    dispose() {
      stacked.length = 0;
      rolling.length = 0;
      floaters.length = 0;
      knocked.clear();
    },
  };
}

/** 湯桶を湯の面に浮かべる（沈んだ分だけ上へ押し、揺れを止める）。 */
function floatOke(p: Prop, pool: { x: number; z: number; rx: number; rz: number }, waterY: number, dt: number): void {
  if (!p.alive || p.dying >= 0) return;
  const b = p.body;
  const t = b.translation();
  if (Math.hypot((t.x - pool.x) / pool.rx, (t.z - pool.z) / pool.rz) > 1) return;
  const bottom = t.y - p.half.y;
  if (bottom > waterY) return;
  if (b.isSleeping()) b.wakeUp();
  const sub = Math.min(1, (waterY - bottom) / (p.half.y * 2));
  const f = p.def.float ?? 0;
  b.applyImpulse({ x: 0, y: p.mass * 22 * f * sub * dt, z: 0 }, true);
  const v = b.linvel();
  const drag = Math.min(1, 2.2 * sub * dt);
  b.setLinvel({ x: v.x * (1 - drag), y: v.y * (1 - drag * 1.5), z: v.z * (1 - drag) }, true);
}

/** 大通りの両脇の提灯（見た目だけ。当たり判定なし）。 */
function lanterns(w: WorldMap, grid: HeightGrid): void {
  const xs: number[] = [];
  const zs: number[] = [];
  for (let z = ST_Z0 + 2; z <= ST_Z1 - 2; z += 6) for (const sx of [-1, 1]) {
    xs.push(sx * (ST_W + 0.7));
    zs.push(z);
  }
  const n = xs.length;
  const poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.07, 0.09, 3, 6), new THREE.MeshLambertMaterial({ color: 0x3a2618 }), n);
  const arms = new THREE.InstancedMesh(new THREE.BoxGeometry(0.9, 0.08, 0.08), new THREE.MeshLambertMaterial({ color: 0x3a2618 }), n);
  const lamps = new THREE.InstancedMesh(new THREE.SphereGeometry(0.3, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }), n);
  const m = new THREE.Matrix4();
  const c = new THREE.Color();
  for (let i = 0; i < n; i++) {
    const gy = grid.at(xs[i], zs[i]);
    const toward = -Math.sign(xs[i]);
    m.makeTranslation(xs[i], gy + 1.5, zs[i]);
    poles.setMatrixAt(i, m);
    m.makeTranslation(xs[i] + toward * 0.4, gy + 2.95, zs[i]);
    arms.setMatrixAt(i, m);
    m.makeScale(1, 1.35, 1).setPosition(xs[i] + toward * 0.75, gy + 2.45, zs[i]);
    lamps.setMatrixAt(i, m);
    lamps.setColorAt(i, c.setHex(i % 4 < 2 ? 0xff6a3a : 0xfff0c8));
  }
  w.root.add(poles, arms, lamps);
}

/** 谷のふちの山に生える杉（見た目だけ）。 */
function cedars(w: WorldMap, grid: HeightGrid, rng: () => number): void {
  const n = 170;
  const leaf = new THREE.InstancedMesh(new THREE.ConeGeometry(1.6, 6, 7), new THREE.MeshLambertMaterial({ color: 0x2f5a34 }), n);
  const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.25, 0.3, 2, 5), new THREE.MeshLambertMaterial({ color: 0x4a3222 }), n);
  const m = new THREE.Matrix4();
  const c = new THREE.Color();
  let k = 0;
  for (let i = 0; i < 600 && k < n; i++) {
    const side = rng();
    let x: number;
    let z: number;
    if (side < 0.36) {
      x = -63 - rng() * 18;
      z = -80 + rng() * 160;
    } else if (side < 0.72) {
      x = 63 + rng() * 18;
      z = -80 + rng() * 160;
    } else {
      x = -80 + rng() * 160;
      z = 64 + rng() * 17;
    }
    const gy = grid.at(x, z);
    const s = 0.8 + rng() * 0.7;
    m.makeScale(s, s, s).setPosition(x, gy + 2 * s + 3 * s - 0.2, z);
    leaf.setMatrixAt(k, m);
    leaf.setColorAt(k, c.setHSL(0.36 + rng() * 0.05, 0.35, 0.22 + rng() * 0.1));
    m.makeScale(s, s, s).setPosition(x, gy + s - 0.2, z);
    trunk.setMatrixAt(k, m);
    k++;
  }
  leaf.count = k;
  trunk.count = k;
  w.root.add(leaf, trunk);
}

/** 遠くの山並み（見た目だけ）。 */
function farMountains(w: WorldMap, rng: () => number): void {
  const n = 44;
  const mesh = new THREE.InstancedMesh(new THREE.ConeGeometry(1, 1, 8), new THREE.MeshLambertMaterial({ color: 0x4a5a58 }), n);
  const m = new THREE.Matrix4();
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rng() * 0.1;
    // 南（ふもと側）は低く、北は高く
    const north = Math.max(0, Math.sin(a));
    const d = 120 + rng() * 50;
    const h = 22 + north * 40 + rng() * 18;
    const r = 30 + rng() * 25;
    m.makeScale(r, h, r).setPosition(Math.cos(a) * d, h / 2 - 2, Math.sin(a) * d);
    mesh.setMatrixAt(i, m);
  }
  w.root.add(mesh);
}
