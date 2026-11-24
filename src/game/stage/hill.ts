/**
 * 学校の裏山。段々になった丘（段の境目は崖）と、頂上まで登るらせんの山道。西に崖の台地、東に浅い谷。
 * 仕掛け: 頂上から転がり落ちる大岩、斜面の丸太の山、崖から落とすと落下ダメージ、坂を転がる切り株と丸太。
 */
import * as THREE from 'three';
import { log } from '../../log';
import { ZONE } from '../fx';
import type { Game } from '../game';
import { ARENA, Prop, WorldMap } from '../world';
import { DAY_SKY, Stage } from './index';
import { HeightGrid, smoothstep, terrainMesh } from './terrain';
import { grass, gravel } from './textures';

/** 丘の中心・裾の半径・頂上の平らな所の半径と高さ */
const HC = { x: 6, z: 20 };
const HILL_R = 36;
const TOP_R = 9;
const TOP_H = 15;
/** 段の高さ（この高さごとに崖ができる） */
const TERRACE = 3;
/** 山道: らせん 1 周で、裾から頂上へ */
const ROAD_W = 3.2;
const ROAD_N = 160;
/** 西の台地 */
const MESA = { x0: -64, x1: -36, z0: -34, z1: 6, h: 7 };
const S = { sleep: true };

interface RoadPt {
  x: number;
  z: number;
  h: number;
}

function roadPoints(): RoadPt[] {
  const pts: RoadPt[] = [];
  for (let i = 0; i <= ROAD_N; i++) {
    const t = i / ROAD_N;
    const a = -Math.PI / 2 + t * Math.PI * 2.2;
    const r = HILL_R - 4 - (HILL_R - 4 - TOP_R + 1) * t;
    pts.push({ x: HC.x + Math.cos(a) * r, z: HC.z + Math.sin(a) * r, h: TOP_H * t });
  }
  return pts;
}

/** 点から山道までの距離と、いちばん近い所の山道の高さ。 */
function nearRoad(pts: RoadPt[], x: number, z: number): { d: number; h: number } {
  let best = Infinity;
  let bh = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const vx = b.x - a.x;
    const vz = b.z - a.z;
    const l2 = vx * vx + vz * vz || 1;
    const t = Math.max(0, Math.min(1, ((x - a.x) * vx + (z - a.z) * vz) / l2));
    const px = a.x + vx * t;
    const pz = a.z + vz * t;
    const d = Math.hypot(x - px, z - pz);
    if (d < best) {
      best = d;
      bh = a.h + (b.h - a.h) * t;
    }
  }
  return { d: best, h: bh };
}

/** 丘の高さ（段々。山道は削るか盛る）。 */
function hillHeight(x: number, z: number, pts: RoadPt[]): number {
  const d = Math.hypot(x - HC.x, z - HC.z);
  let h = 0;
  if (d < HILL_R) {
    const raw = TOP_H * (1 - smoothstep(TOP_R, HILL_R, d));
    // 段々にする: 段の大半は平らで、境目で急に上がる（崖）
    const q = Math.floor(raw / TERRACE);
    const frac = raw / TERRACE - q;
    h = (q + smoothstep(0.78, 1, frac)) * TERRACE;
  }
  // 西の台地（まわりは急な崖。東側にだけ坂）
  const mx = Math.max(MESA.x0 - x, x - MESA.x1, 0);
  const mz = Math.max(MESA.z0 - z, z - MESA.z1, 0);
  const md = Math.hypot(mx, mz);
  let mesa = MESA.h * (1 - smoothstep(0, 2.2, md));
  // 台地の東の坂（x: -36 → -18 で 7m → 0m）
  if (z > -22 && z < -14 && x > MESA.x1 - 1 && x < MESA.x1 + 18) mesa = Math.max(mesa, MESA.h * (1 - (x - MESA.x1) / 18));
  h = Math.max(h, mesa);
  // 東の浅い谷
  h -= 2 * (1 - smoothstep(3, 9, Math.abs(x - 50)));
  // 小さな起伏
  h += 0.35 * Math.sin(x * 0.09 + z * 0.05) + 0.25 * Math.cos(z * 0.11 - x * 0.03);
  // 山道: 道の上は道の高さ。道の脇はなだらかにつなぐ
  if (d < HILL_R + 4) {
    const r = nearRoad(pts, x, z);
    if (r.d < ROAD_W + 4) {
      const k = 1 - smoothstep(ROAD_W, ROAD_W + 4, r.d);
      h = h + (r.h + 0.2 - h) * k;
    }
  }
  return h;
}

export function hill(g: Game, w: WorldMap): Stage {
  const pts = roadPoints();
  const grid = HeightGrid.build(-ARENA - 10, -ARENA - 10, ARENA + 10, ARENA + 10, 1.1, (x, z) => hillHeight(x, z, pts));
  let rockT = 16;
  const rocks: { prop: Prop; cd: number }[] = [];
  let rolled = 0;

  return {
    start: { x: 0, z: -50 },
    sky: { ...DAY_SKY, fogNear: 80, fogFar: 220 },
    heightAt: (x, z) => grid.at(x, z),
    steer(e, tx, tz) {
      if (e.def.behavior === 'heli') return null;
      const p = g.player.pos;
      const eg = grid.at(e.x, e.z);
      if (p.y - eg < 2.2) return null;
      const w = e.w;
      // ノリコが台地の上にいる: 東の坂の下 → 坂の上、の順に向かう
      const onMesa = p.x < MESA.x1 + 1 && p.x > MESA.x0 && p.z > MESA.z0 && p.z < MESA.z1;
      if (onMesa) {
        const gx = eg < 2 ? MESA.x1 + 17 : MESA.x1 - 2;
        const gz = -18;
        if (Math.hypot(gx - e.x, gz - e.z) < 2) return null;
        const d = Math.hypot(gx - e.x, gz - e.z) || 1;
        return [(gx - e.x) / d, (gz - e.z) / d];
      }
      // 丘の上にいる: 山道へ出てから、道に沿って登る（近い道の点は 0.4 秒ごとに調べ直す）
      if (Math.hypot(p.x - HC.x, p.z - HC.z) > HILL_R) return null;
      w.rt = (w.rt ?? 0) - 1 / 60;
      if (w.ri === undefined || w.rt <= 0) {
        w.rt = 0.4;
        let best = 0;
        let bd = Infinity;
        for (let i = 0; i < pts.length; i++) {
          const d = (pts[i].x - e.x) ** 2 + (pts[i].z - e.z) ** 2;
          if (d < bd) {
            bd = d;
            best = i;
          }
        }
        w.ri = best;
        w.rd = Math.sqrt(bd);
      }
      const i = w.ri;
      const tgt = w.rd > ROAD_W ? pts[i] : pts[Math.min(pts.length - 1, i + 5)];
      // 道の終わり（頂上）に着いたら、ふつうにノリコへ向かう
      if (i >= pts.length - 3) return null;
      const d = Math.hypot(tgt.x - e.x, tgt.z - e.z) || 1;
      void tx;
      void tz;
      return [(tgt.x - e.x) / d, (tgt.z - e.z) / d];
    },
    build() {
      // ---- 地面（段々の丘・山道・台地・谷）
      const map = grass(1);
      const rock = new THREE.Color().setRGB(1.25, 0.95, 0.7);
      // 山道は明るい砂色（芝生の模様に掛けるので、1 より大きくして明るくする）
      const road = new THREE.Color().setRGB(1.7, 1.35, 0.85);
      const lawn = new THREE.Color(0xffffff);
      const c = new THREE.Color();
      terrainMesh(w, grid, map, 9.6, (x, z, h, slope) => {
        const r = nearRoad(pts, x, z);
        if (r.d < ROAD_W && Math.hypot(x - HC.x, z - HC.z) < HILL_R + 2) return c.copy(road);
        // 急な所（崖）は岩の色
        return c.copy(lawn).lerp(rock, smoothstep(0.5, 1.0, slope));
      });
      // 山道の帯（砂利の模様。登り口が分かるように）
      const vs: number[] = [];
      const uvs: number[] = [];
      const ix: number[] = [];
      for (let i = 0; i < pts.length; i++) {
        const a = pts[Math.max(0, i - 1)];
        const b = pts[Math.min(pts.length - 1, i + 1)];
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const dl = Math.hypot(dx, dz) || 1;
        const nx = -dz / dl;
        const nz = dx / dl;
        for (const s of [-1, 1]) {
          const x = pts[i].x + nx * ROAD_W * s;
          const z = pts[i].z + nz * ROAD_W * s;
          vs.push(x, grid.at(x, z) + 0.08, z);
          uvs.push(s < 0 ? 0 : 1, i * 0.4);
        }
        if (i > 0) {
          const k = i * 2;
          ix.push(k - 2, k - 1, k, k - 1, k + 1, k);
        }
      }
      const rg = new THREE.BufferGeometry();
      rg.setAttribute('position', new THREE.Float32BufferAttribute(vs, 3));
      rg.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      rg.setIndex(ix);
      rg.computeVertexNormals();
      const gt = gravel(1);
      gt.repeat.set(1, 1);
      const roadMesh = new THREE.Mesh(rg, new THREE.MeshLambertMaterial({ map: gt, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 }));
      roadMesh.receiveShadow = true;
      w.root.add(roadMesh);
      w.bounds(new THREE.MeshLambertMaterial({ color: 0x5a7a4a }), 2.4);
      w.skyline([0xdfe8d0, 0xd9e6f2, 0xe8e8e8, 0xf2e6d0], 6, 24, 90);
      // 頂上の祠（壊せる）とベンチ
      w.addBuilding(HC.x - 4, HC.z - 3, 4, 3, 1, { doors: [{ side: 'front', at: 1 }], y0: grid.at(HC.x, HC.z) - 0.1 });
      // ---- 木（斜面にたくさん。切り倒すと坂を転がる）
      const rng = g.rng;
      for (let k = 0; k < 70; k++) {
        const a = rng() * Math.PI * 2;
        const r = 10 + rng() * 58;
        const x = Math.cos(a) * r;
        const z = Math.sin(a) * r;
        if (Math.abs(x) > ARENA - 4 || Math.abs(z) > ARENA - 4) continue;
        if (nearRoad(pts, x, z).d < ROAD_W + 1.5) continue;
        if (Math.hypot(x - 0, z + 50) < 10 || grid.slope(x, z) > 0.7) continue;
        w.spawnProp('tree', { x, y: grid.at(x, z) - 0.1, z }, rng() * 6, { scale: 0.75 + rng() * 0.45 });
      }
      // ---- 丸太の山（段の上。崩すと坂を転がり落ちる）
      for (const [lx, lz] of [[HC.x - 14, HC.z - 18], [HC.x + 18, HC.z - 10], [HC.x - 20, HC.z + 8]] as const) {
        const gy = grid.at(lx, lz);
        for (let row = 0; row < 3; row++) {
          for (let k = 0; k < 3 - row; k++) {
            w.spawnProp('log', { x: lx, y: gy + row * 0.78 + 0.02, z: lz + (k - (2 - row) / 2) * 0.92 }, 0, S);
          }
        }
      }
      // ---- 台地の上: 古い資材置き場（ドラム缶と段ボール）
      const nBarrel = Math.round(4 * g.rule.barrels);
      for (let i = 0; i < nBarrel; i++) {
        const x = MESA.x0 + 6 + (i % 4) * 1.2;
        const z = MESA.z0 + 8 + Math.floor(i / 4) * 1.2;
        w.spawnProp('barrel', { x, y: grid.at(x, z) + 0.01, z }, 0, S);
      }
      for (let k = 0; k < 6; k++) {
        const x = -10 + k * 4;
        const z = -36;
        w.spawnProp('bench', { x, y: grid.at(x, z) + 0.01, z }, 0, S);
      }
    },

    update(dt) {
      // ---- 落石: 頂上の縁に赤い円で予告し、ノリコの方へ転がす
      rockT -= dt;
      if (rockT <= 0) {
        rockT = 18 + Math.random() * 8;
        const p = g.player.pos;
        const a = Math.atan2(p.z - HC.z, p.x - HC.x) + (Math.random() - 0.5) * 0.8;
        const x = HC.x + Math.cos(a) * (TOP_R - 1.5);
        const z = HC.z + Math.sin(a) * (TOP_R - 1.5);
        const gy = grid.at(x, z);
        g.fx.ring({ x, y: gy + 0.1, z }, 1.4, 1.8, ZONE.enemy, 1.4, 0.9);
        g.hud.toast('落石注意！ 頂上から大岩が転がってくる！', 'warn');
        g.audio.warn();
        const prop = w.spawnProp('rock', { x, y: gy + 0.3, z }, Math.random() * 6, { hot: 30, dmgMul: 1.4, life: 30 });
        if (prop) {
          prop.body.setLinvel({ x: Math.cos(a) * 6, y: 1, z: Math.sin(a) * 6 }, true);
          rocks.push({ prop, cd: 0 });
          rolled++;
          log('hill.rock', {}, { total: rolled, time: Math.round(g.time) });
        }
      }
      for (let i = rocks.length - 1; i >= 0; i--) {
        const r = rocks[i];
        if (!r.prop.alive) {
          rocks.splice(i, 1);
          continue;
        }
        r.cd -= dt;
        const t = r.prop.body.translation();
        const v = r.prop.body.linvel();
        const sp = Math.hypot(v.x, v.y, v.z);
        if (sp > 2) w.heat(r.prop, 1);
        if (sp > 4 && Math.random() < dt * 10) g.fx.dust({ x: t.x, y: t.y - r.prop.half.y, z: t.z }, 1, 0xb0a080, 1);
        // ノリコをひく
        const p = g.player;
        if (r.cd <= 0 && sp > 4 && Math.hypot(p.pos.x - t.x, p.pos.y + 0.9 - t.y, p.pos.z - t.z) < r.prop.half.y + 0.7) {
          r.cd = 1;
          p.hurt(30, { x: t.x, y: t.y, z: t.z }, '落石');
          p.launch(v.x * 0.6, 7, v.z * 0.6);
        }
      }
    },
  };
}
