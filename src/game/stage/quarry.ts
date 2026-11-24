/**
 * 採石場。擂り鉢状の段々の採掘穴（底は -16m、段の境目は崖）と、縁から底まで降りるらせんの運搬路。北西にボタ山。
 * 仕掛け: 段の上の TNT（叩くと連鎖爆発）、運搬路のトロッコ（叩くと坂を下って敵をひく。ときどき上から暴走してくる）、
 * 定期的な発破（崖の一部が爆発し、岩の柱が崩れて大岩が転がり落ちる）、穴へ落とすと落下ダメージ。
 */
import * as THREE from 'three';
import { log } from '../../log';
import { ZONE } from '../fx';
import type { Game } from '../game';
import { ARENA, Prop, WorldMap } from '../world';
import { DAY_SKY, Stage } from './index';
import { benchRange, HEAP, nearRoad, PC, pitDist, polar, quarryHeight, R_RIM, RAMP, ringDir, roadPoints, ROAD_W, RoadPt, smooth } from './quarry_shape';
import { HeightGrid, terrainMesh } from './terrain';
import { dirt, gravel } from './textures';

const S = { sleep: true };
/** 発破の爆発の半径と、予告の秒数 */
const BLAST_R = 7;
const BLAST_WARN = 3.2;
/** 暴走トロッコの予告の秒数と、保つ速さ (m/s) */
const CART_WARN = 2.6;
const CART_SPEED = 11;

// ---------------------------------------------------------------- 壁の模様
function canvasTex(S: number, seed: number, draw: (c: CanvasRenderingContext2D, S: number, rnd: () => number) => void): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const c = cv.getContext('2d')!;
  let s = seed;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  draw(c, S, rnd);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** 岩肌（地層の縞とひび）。drill なら発破用の穴が並ぶ。 */
function rockFace(drill: boolean): THREE.CanvasTexture {
  return canvasTex(256, drill ? 11 : 5, (c, S, rnd) => {
    c.fillStyle = '#8e857a';
    c.fillRect(0, 0, S, S);
    for (let y = 0; y < S; y += 16 + rnd() * 16) {
      c.fillStyle = `rgba(${95 + rnd() * 55},${85 + rnd() * 45},${72 + rnd() * 34},0.5)`;
      c.fillRect(0, y, S, 5 + rnd() * 10);
    }
    for (let i = 0; i < 700; i++) {
      const t = 70 + rnd() * 90;
      c.fillStyle = `rgba(${t},${t - 6},${t - 14},0.5)`;
      c.fillRect(rnd() * S, rnd() * S, 1 + rnd() * 3, 1 + rnd() * 3);
    }
    c.strokeStyle = 'rgba(42,38,34,0.6)';
    c.lineWidth = 2;
    for (let k = 0; k < 5; k++) {
      let x = rnd() * S;
      let y = rnd() * S * 0.5;
      c.beginPath();
      c.moveTo(x, y);
      for (let j = 0; j < 5; j++) {
        x += (rnd() - 0.5) * 50;
        y += 10 + rnd() * 30;
        c.lineTo(x, y);
      }
      c.stroke();
    }
    if (drill) {
      for (let k = 0; k < 6; k++) {
        const x = S * (0.12 + (k % 3) * 0.38);
        const y = S * (0.3 + Math.floor(k / 3) * 0.4);
        c.fillStyle = 'rgba(28,26,24,0.85)';
        c.beginPath();
        c.arc(x, y, 6, 0, Math.PI * 2);
        c.fill();
        c.strokeStyle = 'rgba(230,200,60,0.8)';
        c.lineWidth = 2;
        c.beginPath();
        c.moveTo(x, y);
        c.lineTo(x + 8, y + 18);
        c.stroke();
      }
    }
  });
}

/** プレハブの壁（白い板と継ぎ目）。win なら窓。 */
function prefabWall(win: boolean): THREE.CanvasTexture {
  return canvasTex(256, win ? 23 : 17, (c, S, rnd) => {
    c.fillStyle = '#e9e6dc';
    c.fillRect(0, 0, S, S);
    c.fillStyle = 'rgba(120,118,110,0.6)';
    for (const x of [0, S / 2]) c.fillRect(x, 0, 3, S);
    for (let i = 0; i < 200; i++) {
      c.fillStyle = `rgba(150,140,120,${0.1 + rnd() * 0.15})`;
      c.fillRect(rnd() * S, rnd() * S, 2, 2);
    }
    c.fillStyle = 'rgba(140,110,70,0.35)';
    c.fillRect(0, S * 0.9, S, S * 0.1);
    if (win) {
      c.fillStyle = '#9fc4dc';
      c.fillRect(S * 0.18, S * 0.2, S * 0.64, S * 0.45);
      c.strokeStyle = '#b8bcc0';
      c.lineWidth = 8;
      c.strokeRect(S * 0.18, S * 0.2, S * 0.64, S * 0.45);
      c.beginPath();
      c.moveTo(S * 0.5, S * 0.2);
      c.lineTo(S * 0.5, S * 0.65);
      c.stroke();
    }
  });
}

// ---------------------------------------------------------------- 道の帯
/** 運搬路に沿った帯のメッシュ。off は道の中心からのずれ、hw は半幅、lift は地面からの高さ。 */
function ribbon(pts: RoadPt[], grid: HeightGrid, off: number, hw: number, lift: number, mat: THREE.Material, uvLen = 0.4): THREE.Mesh {
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
      const x = pts[i].x + nx * (off + hw * s);
      const z = pts[i].z + nz * (off + hw * s);
      vs.push(x, grid.at(x, z) + lift, z);
      uvs.push(s < 0 ? 0 : 1, i * uvLen);
    }
    if (i > 0) {
      const k = i * 2;
      ix.push(k - 2, k - 1, k, k - 1, k + 1, k);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(vs, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(ix);
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, mat);
  m.receiveShadow = true;
  return m;
}

interface Cart {
  prop: Prop;
  auto: boolean;
  /** 近い道の区間の番号（-1 は未計算） */
  ri: number;
  /** 動き出したか（叩かれて走り出したときに 1 回だけログを出す） */
  moved: boolean;
  /** ノリコに当たったあとの待ち時間 */
  cd: number;
}

export function quarry(g: Game, w: WorldMap): Stage {
  const pts = roadPoints();
  const grid = HeightGrid.build(-ARENA - 10, -ARENA - 10, ARENA + 10, ARENA + 10, 1.2, (x, z) => quarryHeight(x, z, pts));
  const carts: Cart[] = [];
  const tnts: Prop[] = [];
  const rocks: { prop: Prop; cd: number }[] = [];
  /** 発破の候補地（崖のふもと）と、いま予告中の発破 */
  const sites: { x: number; z: number; k: number }[] = [];
  let blast: { x: number; y: number; z: number; t: number; ring: number; k: number } | null = null;
  let blastT = 40;
  let blasts = 0;
  let cartT = 24;
  let cartWarn = -1;
  let autoCarts = 0;
  let warnMesh: THREE.Mesh | null = null;
  let warnMat: THREE.MeshBasicMaterial | null = null;
  /** 発破の予告の赤い円 */
  let blastDisc: THREE.Mesh | null = null;
  let blastMat: THREE.MeshBasicMaterial | null = null;
  /** 運搬路に置いておくトロッコの場所（無くなったら、しばらくして置き直す） */
  const HOMES = [14, 62, 108];
  const homeCarts: (Prop | null)[] = [null, null, null];
  let homeT = 20;
  /** TNT の置き場（発破のあとに補充する） */
  const STORE = { x: -2, z: -46 };

  function addTnt(x: number, z: number, y?: number): void {
    const p = w.spawnProp('tnt', { x, y: y ?? grid.at(x, z) + 0.01, z }, Math.random() * 0.4 - 0.2, S);
    if (p) tnts.push(p);
  }

  function addCart(i: number, auto: boolean): Cart | null {
    const a = pts[i];
    const b = pts[i + 1];
    const yaw = Math.atan2(b.x - a.x, b.z - a.z);
    const prop = w.spawnProp('minecart', { x: a.x, y: grid.at(a.x, a.z) + 0.05, z: a.z }, yaw, auto ? { hot: 40, dmgMul: 1.5, life: 40 } : { ...S, dmgMul: 1.5 });
    if (!prop) return null;
    const c: Cart = { prop, auto, ri: i, moved: auto, cd: 0 };
    carts.push(c);
    return c;
  }

  /** 崖の途中・急な所には敵を出さない。 */
  const spawnOk = (x: number, z: number) => grid.slope(x, z) < 0.55;

  /**
   * 高さ h の所から歩いて行ける、運搬路の近い点。道の高さが h に近い点（±2.5m）だけから選ぶ
   * （上や下の段の道は、水平には近くても崖の向こう側なので行けない）。
   */
  function roadAtLevel(x: number, z: number, h: number): { i: number; d: number } {
    let bi = -1;
    let bd = Infinity;
    for (let i = 0; i < pts.length; i++) {
      if (Math.abs(pts[i].h - h) > 2.5) continue;
      const d = Math.hypot(pts[i].x - x, pts[i].z - z);
      if (d < bd) {
        bd = d;
        bi = i;
      }
    }
    if (bi >= 0) return { i: bi, d: bd };
    // 道より高い所（ボタ山など）や低い所: 高さのいちばん近い端
    const i = h > pts[0].h ? 0 : pts.length - 1;
    return { i, d: Math.hypot(pts[i].x - x, pts[i].z - z) };
  }

  /** (ax, az) から (bx, bz) へまっすぐ進むと、高さ h より 2m 以上低い所（穴）を横切るか。 */
  function dips(ax: number, az: number, bx: number, bz: number, h: number): boolean {
    const low = Math.min(h, grid.at(bx, bz)) - 2;
    for (const f of [0.2, 0.4, 0.6, 0.8]) if (grid.at(ax + (bx - ax) * f, az + (bz - az) * f) < low) return true;
    return false;
  }

  /** (ax, az) から (bx, bz) へまっすぐ進むと、高さ h より 1.5m 以上高い所（ボタ山）を越えるか。 */
  function humps(ax: number, az: number, bx: number, bz: number, h: number): boolean {
    const high = Math.max(h, grid.at(bx, bz)) + 1.5;
    for (const f of [0.2, 0.4, 0.6, 0.8]) if (grid.at(ax + (bx - ax) * f, az + (bz - az) * f) > high) return true;
    return false;
  }

  /** 高さ h の段を回り込むときの円の半径（縁の高さなら穴の外側）。 */
  function ringRadius(h: number): number {
    if (h > -1.5) return R_RIM - 2;
    const [inner, outer] = benchRange(Math.min(4, Math.max(1, Math.round(-h / 4))));
    return (inner + outer) / 2;
  }

  /** 同じ段の上の点へ向かう向き。まっすぐ行くと穴を横切るなら、段に沿って回り込む。 */
  function moveToward(x: number, z: number, h: number, tx: number, tz: number): [number, number] {
    if (dips(x, z, tx, tz, h)) return ringDir(x, z, tx, tz, ringRadius(h));
    const d = Math.hypot(tx - x, tz - z) || 1;
    return [(tx - x) / d, (tz - z) / d];
  }

  return {
    start: { x: 14, z: -38 },
    sky: { ...DAY_SKY, top: 0x77a2d2, mid: 0xe4d6b6, fog: 0xe0cfa8, fogNear: 60, fogFar: 200, hemiGround: 0xb49c74 },
    heightAt: (x, z) => grid.at(x, z),
    spawnOk,

    steer(e) {
      if (e.def.behavior === 'heli') return null;
      const p = g.player.pos;
      const pg = grid.at(p.x, p.z);
      const eg = grid.at(e.x, e.z);
      const dh = pg - eg;
      const ew = e.w;
      // 高さの違う段にいる: 運搬路へ出てから、道に沿って登る（下る）。崖から飛び降りはしない
      if (Math.abs(dh) > 2.2 && (pitDist(e.x, e.z) < R_RIM + 1 || pg < -1.5) && !(dh > 0 && eg > -1.5)) {
        if (ew.ri === undefined || (ew.rt ?? 0) <= g.time) {
          ew.rt = g.time + 0.4;
          const r = roadAtLevel(e.x, e.z, eg);
          ew.ri = r.i;
          ew.rd = r.d;
        }
        const i = ew.ri;
        const up = dh > 0;
        const reached = up ? pts[i].h >= pg - 1.2 || i <= 1 : pts[i].h <= pg + 1.2 || i >= pts.length - 2;
        if (!reached) {
          const tgt = ew.rd > ROAD_W ? pts[i] : pts[up ? Math.max(0, i - 5) : Math.min(pts.length - 1, i + 5)];
          return moveToward(e.x, e.z, eg, tgt.x, tgt.z);
        }
      }
      // ノリコがボタ山の上: 南の登り坂を通って登る
      if (dh > 2.2 && Math.hypot(p.x - HEAP.x, p.z - HEAP.z) < HEAP.r + 1) {
        if (Math.hypot(e.x - HEAP.x, e.z - HEAP.z) < HEAP.top + 1) return null;
        const L = RAMP.z1 - RAMP.z0;
        const u = e.z - RAMP.z0;
        // 坂の上にいる: 坂に沿って登る。坂の外: 自分と同じ高さの坂の点へ向かう
        if (Math.abs(e.x - RAMP.x) < RAMP.w - 0.4 && u > -2 && u < L + 1) return moveToward(e.x, e.z, eg, RAMP.x, Math.min(RAMP.z1 + 2, e.z + 4));
        const ut = Math.max(0, Math.min(L, (L * eg) / HEAP.h - 1));
        const tz = RAMP.z0 + ut;
        // まっすぐ行くと山の急な斜面にぶつかるなら、山のまわりを回り込む
        if (humps(e.x, e.z, RAMP.x, tz, eg)) return ringDir(e.x, e.z, RAMP.x, tz, HEAP.r + 3, HEAP);
        return moveToward(e.x, e.z, eg, RAMP.x, tz);
      }
      // 同じ高さにいる: まっすぐ進むと穴（低い所）を横切るなら、穴のまわりを回り込む
      if (Math.abs(dh) <= 2.2 || pg >= -1.5) return dips(e.x, e.z, p.x, p.z, eg) ? ringDir(e.x, e.z, p.x, p.z, ringRadius(eg)) : null;
      return null;
    },

    build() {
      // ---- 地面（穴の段々・運搬路・ボタ山）
      const rock = new THREE.Color().setRGB(0.92, 0.96, 1.12);
      const bench = new THREE.Color().setRGB(1.22, 1.16, 1.08);
      const outside = new THREE.Color().setRGB(1.05, 1.02, 0.95);
      const heap = new THREE.Color().setRGB(0.82, 0.8, 0.82);
      const ramp = new THREE.Color().setRGB(1.45, 1.3, 1.05);
      const c = new THREE.Color();
      terrainMesh(w, grid, dirt(1), 10, (x, z, h, slope) => {
        const dn = pitDist(x, z);
        if (Math.abs(x - RAMP.x) < RAMP.w && z > RAMP.z0 - 1 && z < RAMP.z1 + 1) return c.copy(ramp);
        if (Math.hypot(x - HEAP.x, z - HEAP.z) < HEAP.r && h > 0.5) return c.copy(heap).lerp(rock, smooth(0.5, 1.0, slope) * 0.5);
        const base = dn < R_RIM ? bench : outside;
        // 急な所（崖）は岩の色
        return c.copy(base).lerp(rock, smooth(0.45, 0.95, slope));
      });
      // 運搬路の帯（砂利）とレール・枕木
      const gt = gravel(1);
      gt.repeat.set(1, 1);
      w.root.add(ribbon(pts, grid, 0, ROAD_W, 0.07, new THREE.MeshLambertMaterial({ map: gt, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 })));
      const railMat = new THREE.MeshLambertMaterial({ color: 0x5a5450, side: THREE.DoubleSide });
      for (const s of [-0.55, 0.55]) w.root.add(ribbon(pts, grid, s, 0.07, 0.2, railMat));
      const sleeperGeo = new THREE.BoxGeometry(1.6, 0.1, 0.26);
      const sleepers = new THREE.InstancedMesh(sleeperGeo, new THREE.MeshLambertMaterial({ color: 0x6e4c2e }), pts.length);
      const m4 = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const up = new THREE.Vector3(0, 1, 0);
      for (let i = 0; i < pts.length; i++) {
        const a = pts[Math.max(0, i - 1)];
        const b = pts[Math.min(pts.length - 1, i + 1)];
        q.setFromAxisAngle(up, Math.atan2(b.x - a.x, b.z - a.z) + Math.PI / 2);
        m4.compose(new THREE.Vector3(pts[i].x, grid.at(pts[i].x, pts[i].z) + 0.12, pts[i].z), q, new THREE.Vector3(1, 1, 1));
        sleepers.setMatrixAt(i, m4);
      }
      sleepers.receiveShadow = true;
      w.root.add(sleepers);
      // 暴走トロッコの通り道の予告（ふだんは隠す）
      warnMat = new THREE.MeshBasicMaterial({ color: ZONE.enemy, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
      warnMesh = ribbon(pts, grid, 0, 1.5, 0.3, warnMat);
      warnMesh.visible = false;
      warnMesh.renderOrder = 2;
      w.root.add(warnMesh);
      blastMat = new THREE.MeshBasicMaterial({ color: ZONE.enemy, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
      blastDisc = new THREE.Mesh(new THREE.CircleGeometry(BLAST_R, 40), blastMat);
      blastDisc.rotation.x = -Math.PI / 2;
      blastDisc.visible = false;
      blastDisc.renderOrder = 2;
      w.root.add(blastDisc);

      w.bounds(new THREE.MeshLambertMaterial({ color: 0xc8b48c }), 2.4);
      w.skyline([0xc8b89a, 0xb8a888, 0xd8cdb4, 0x9aa0a8], 8, 30, 80);
      w.registerWallStyle('rock', { plain: rockFace(false), win: rockFace(true), edge: 0x6e665c });
      w.registerWallStyle('prefab', { plain: prefabWall(false), win: prefabWall(true), edge: 0xb8bcc0 });

      // ---- 段の上の岩の柱（崖に寄せて立てる。崩せる）と、そばの TNT
      const rng = g.rng;
      const pillarAngles: Record<number, number[]> = { 1: [0.15, 1.45, 2.75, 4.05, 5.3], 2: [0.8, 2.35, 3.9, 5.45], 3: [1.7, 3.4, 5.1] };
      for (const [ks, angles] of Object.entries(pillarAngles)) {
        const k = Number(ks);
        const [, outer] = benchRange(k);
        for (const a0 of angles) {
          let placed = false;
          for (const da of [0, 0.25, -0.25, 0.5]) {
            const a = a0 + da;
            const pp = polar(a, outer - 1.5);
            if (nearRoad(pts, pp.x, pp.z).d < ROAD_W + 3) continue;
            const y0 = grid.at(pp.x, pp.z) - 0.15;
            w.addBuilding(pp.x - 1, pp.z - 1, 1, 1, k === 1 ? 2 : 1, { style: 'rock', slabs: 'none', hp: 55, y0 });
            // 柱の左右に TNT
            for (const s of [-1, 1]) {
              const t = polar(a + (s * 2.3) / (outer - 1.5), outer - 1.2);
              addTnt(t.x, t.z);
            }
            // 発破の候補地（柱のそば）
            sites.push({ x: pp.x, z: pp.z, k });
            placed = true;
            break;
          }
          if (!placed) continue;
        }
      }
      // 柱の無い所も発破の候補にする
      for (let k = 1; k <= 3; k++) {
        const [, outer] = benchRange(k);
        for (let a = 0.4; a < Math.PI * 2; a += 1.1) {
          const pp = polar(a, outer - 0.6);
          if (nearRoad(pts, pp.x, pp.z).d < ROAD_W + 2) continue;
          sites.push({ x: pp.x, z: pp.z, k });
        }
      }
      // ---- 縁の上の大きな岩の塊・プレハブの現場事務所
      w.addBuilding(40, -36, 4, 2, 2, { style: 'rock', slabs: 'roof', hp: 70, y0: grid.at(44, -34) - 0.3 });
      w.addBuilding(-50, -6, 3, 3, 1, { style: 'rock', slabs: 'roof', hp: 70, y0: grid.at(-47, -3) - 0.3 });
      w.addBuilding(-16, -56, 3, 2, 1, { style: 'prefab', hp: 45, doors: [{ side: 'front', at: 1, width: 1 }], y0: grid.at(-13, -54) - 0.05 });
      // TNT の置き場（事務所のそば。2 段に積む）
      const nStore = Math.round(4 * g.rule.barrels);
      for (let i = 0; i < nStore; i++) {
        const x = STORE.x + (i % 3) * 0.95;
        const z = STORE.z + Math.floor(i / 3) % 2 * 0.95;
        addTnt(x, z, grid.at(x, z) + 0.01 + Math.floor(i / 6) * 0.82);
      }

      // ---- 運搬路のトロッコ
      HOMES.forEach((i, k) => {
        homeCarts[k] = addCart(i, false)?.prop ?? null;
      });

      // ---- 穴の縁のカラーコーン、段の上の小さながれき、資材
      for (let a = -Math.PI; a < Math.PI; a += 0.26) {
        const pp = polar(a, benchRange(0)[0] + 1.2);
        if (nearRoad(pts, pp.x, pp.z).d < ROAD_W + 1.5) continue;
        if (Math.hypot(pp.x - 14, pp.z + 38) < 9) continue;
        w.spawnProp('cone', { x: pp.x, y: grid.at(pp.x, pp.z) + 0.01, z: pp.z }, 0, S);
      }
      for (let i = 0; i < 12; i++) {
        const k = 1 + (i % 4);
        const [inner, outer] = benchRange(k);
        const dn = k === 4 ? rng() * 8 : inner + 1 + rng() * (outer - inner - 2);
        const pp = polar(rng() * Math.PI * 2, dn);
        if (nearRoad(pts, pp.x, pp.z).d < ROAD_W + 1) continue;
        w.spawnProp('rock', { x: pp.x, y: grid.at(pp.x, pp.z) + 0.02, z: pp.z }, rng() * 6, { ...S, scale: 0.32 + rng() * 0.2 });
      }
      for (let row = 0; row < 2; row++) {
        for (let k = 0; k < 2 - row; k++) w.spawnProp('dokan', { x: 30, y: grid.at(30, -50) + row * 1.39 + 0.01, z: -52 + (k - (1 - row) / 2) * 1.62 }, 0, S);
      }
      for (let k = 0; k < 3; k++) w.spawnProp('beam', { x: -30, y: grid.at(-30, -44) + k * 0.62 + 0.01, z: -44 }, 0.2, S);
      const nBox = Math.round(3 * g.rule.clutter);
      for (let i = 0; i < nBox; i++) {
        const x = -8 + i * 2.2;
        const z = -60;
        for (let k = 0; k < 3; k++) w.spawnProp('box', { x: x + (k % 2) * 0.62, y: grid.at(x, z) + Math.floor(k / 2) * 0.505 + 0.01, z }, 0, S);
      }
      // ---- まわりの木（穴とボタ山から離れた所）
      for (let k = 0; k < 40; k++) {
        const x = (rng() * 2 - 1) * (ARENA - 5);
        const z = (rng() * 2 - 1) * (ARENA - 5);
        if (pitDist(x, z) < R_RIM + 6 || Math.hypot(x - HEAP.x, z - HEAP.z) < HEAP.r + 2) continue;
        if (Math.abs(x) < ARENA - 14 && Math.abs(z) < ARENA - 14) continue;
        if (!w.free(x, z, 2)) continue;
        w.spawnProp('tree', { x, y: grid.at(x, z) - 0.1, z }, rng() * 6, { scale: 0.7 + rng() * 0.4 });
      }
      // ---- 砕石プラント（見た目だけの塔とベルトコンベア。塔には当たり判定）
      const steel = new THREE.MeshLambertMaterial({ color: 0xd8b02a });
      const grey = new THREE.MeshLambertMaterial({ color: 0x8a8a8e });
      const TW = { x: 60, z: 42 };
      const PILE = { x: 52, z: 24 };
      const pg = grid.at(TW.x, TW.z);
      w.staticBox({ x: TW.x, y: pg + 5, z: TW.z }, { x: 2.5, y: 5, z: 2.5 }, 0.3, grey);
      w.staticBox({ x: TW.x, y: pg + 10.6, z: TW.z }, { x: 3, y: 0.6, z: 3 }, 0.3, steel);
      const bl = Math.hypot(TW.x - PILE.x, TW.z - PILE.z);
      const belt = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.3, Math.hypot(bl, 10)), new THREE.MeshLambertMaterial({ color: 0x3a3836 }));
      belt.position.set((TW.x + PILE.x) / 2, pg + 5.6, (TW.z + PILE.z) / 2);
      belt.rotation.order = 'YXZ';
      belt.rotation.y = Math.atan2(TW.x - PILE.x, TW.z - PILE.z);
      belt.rotation.x = -Math.atan2(10, bl);
      belt.castShadow = true;
      w.root.add(belt);
      const pile = new THREE.Mesh(new THREE.ConeGeometry(4.5, 3.2, 10), new THREE.MeshLambertMaterial({ color: 0xb4aa98 }));
      pile.position.set(PILE.x, grid.at(PILE.x, PILE.z) + 1.5, PILE.z);
      w.root.add(pile);
      w.staticCyl({ x: PILE.x, y: grid.at(PILE.x, PILE.z), z: PILE.z }, 2.6, 2.4);
    },

    update(dt) {
      const p = g.player;
      // ---- 坂を登る補助: 歩いている敵が、ゆるい上り坂（運搬路・登り坂）で止まらないよう、地面に沿って持ち上げる
      for (const e of g.enemies.list) {
        if (!e.alive || e.state !== 'walk' || e.def.behavior === 'heli') continue;
        const v = e.body.linvel();
        const hs = Math.hypot(v.x, v.z);
        if (hs < 0.2) continue;
        const gy = grid.at(e.x, e.z);
        if (e.y - e.halfH - e.radius - gy > 0.35) continue;
        const s = (grid.at(e.x + (v.x / hs) * 0.7, e.z + (v.z / hs) * 0.7) - gy) / 0.7;
        if (s > 0.04 && s < 0.45) e.body.setLinvel({ x: v.x, y: Math.max(v.y, s * hs + 0.4), z: v.z }, true);
      }
      // ---- TNT: 爆発した数を数える
      let gone = 0;
      for (let i = tnts.length - 1; i >= 0; i--) {
        if (!tnts[i].alive) {
          tnts.splice(i, 1);
          gone++;
        }
      }
      if (gone) log('quarry.tnt', { n: gone }, { left: tnts.length, time: Math.round(g.time) });

      // ---- 運搬路のトロッコが無くなっていたら、置き直す（20 秒ごとに確かめる）
      homeT -= dt;
      if (homeT <= 0) {
        homeT = 20;
        HOMES.forEach((i, k) => {
          if (homeCarts[k]?.alive) return;
          const h = pts[i];
          if (carts.some((c) => Math.hypot(c.prop.body.translation().x - h.x, c.prop.body.translation().z - h.z) < 6)) return;
          homeCarts[k] = addCart(i, false)?.prop ?? null;
        });
      }

      // ---- 暴走トロッコ: 道の赤い帯で予告してから、縁から流す
      cartT -= dt;
      if (cartT <= 0 && cartWarn < 0) {
        const alive = carts.filter((c) => c.auto && c.prop.alive).length;
        if (alive < 2) {
          cartWarn = CART_WARN;
          if (warnMesh) warnMesh.visible = true;
          g.hud.toast('トロッコが暴走してくる！ 運搬路（赤い帯）から離れろ！', 'warn');
          g.audio.warn();
        }
        cartT = 28 + Math.random() * 8;
      }
      if (cartWarn >= 0) {
        cartWarn -= dt;
        if (warnMat) warnMat.opacity = 0.28 + 0.25 * (0.5 + 0.5 * Math.sin(g.time * 14));
        if (cartWarn < 0) {
          const c = addCart(3, true);
          if (c) {
            const a = pts[3];
            const b = pts[4];
            const d = Math.hypot(b.x - a.x, b.z - a.z) || 1;
            c.prop.body.setLinvel({ x: ((b.x - a.x) / d) * CART_SPEED, y: 0, z: ((b.z - a.z) / d) * CART_SPEED }, true);
            autoCarts++;
            log('quarry.cart', { auto: true }, { total: autoCarts, time: Math.round(g.time) });
          }
          g.audio.whoosh();
        }
      } else if (warnMesh && warnMesh.visible && !carts.some((c) => c.auto && c.prop.alive && c.ri < pts.length - 12)) {
        warnMesh.visible = false;
      }

      // ---- トロッコ: 運搬路の上ではレールに沿って走る（下りで加速）
      for (let i = carts.length - 1; i >= 0; i--) {
        const c = carts[i];
        const pr = c.prop;
        if (!pr.alive) {
          carts.splice(i, 1);
          continue;
        }
        c.cd -= dt;
        const b = pr.body;
        if (b.isSleeping()) continue;
        const t = b.translation();
        const v = b.linvel();
        const sp = Math.hypot(v.x, v.z);
        let r = nearRoad(pts, t.x, t.z, c.ri - 8, c.ri + 8);
        if (r.d > 4) r = nearRoad(pts, t.x, t.z);
        c.ri = r.i;
        const onGround = t.y - grid.at(t.x, t.z) < pr.half.y + 0.6;
        if (r.d < ROAD_W && onGround && r.i < pts.length - 2 && (sp > 1.2 || c.auto)) {
          const a = pts[r.i];
          const bp = pts[r.i + 1];
          const dl = Math.hypot(bp.x - a.x, bp.z - a.z) || 1;
          const tx = (bp.x - a.x) / dl;
          const tz = (bp.z - a.z) / dl;
          let vt = v.x * tx + v.z * tz;
          vt += 2.4 * dt;
          if (c.auto) vt = Math.max(vt, CART_SPEED);
          vt = Math.max(-14, Math.min(15, vt));
          // 道の中心へ寄せる
          const off = (t.x - a.x) * -tz + (t.z - a.z) * tx;
          b.setLinvel({ x: tx * vt + tz * off * 2, y: v.y, z: tz * vt - tx * off * 2 }, true);
          const dir = vt >= 0 ? 1 : -1;
          const yaw = Math.atan2(tx * dir, tz * dir);
          b.setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }, true);
          b.setAngvel({ x: 0, y: 0, z: 0 }, true);
          if (Math.abs(vt) > 3) {
            w.heat(pr, 0.5);
            if (!c.moved) {
              c.moved = true;
              pr.life = Math.min(pr.life, 30);
              log('quarry.cart.push', {}, { speed: Math.round(Math.abs(vt) * 10) / 10, at: r.i, time: Math.round(g.time) });
            }
            if (Math.random() < dt * 8) g.fx.dust({ x: t.x, y: t.y - pr.half.y, z: t.z }, 0.6, 0xc8b490, 1);
          }
        } else if (sp > 3) w.heat(pr, 0.3);
        // ノリコをひく
        const sp3 = Math.hypot(v.x, v.y, v.z);
        if (c.cd <= 0 && sp3 > 4 && Math.hypot(p.pos.x - t.x, p.pos.y + 0.9 - t.y, p.pos.z - t.z) < pr.half.z + 0.6) {
          c.cd = 1;
          p.hurt(24, { x: t.x, y: t.y, z: t.z }, '暴走トロッコ');
          p.launch(v.x * 0.6, 6, v.z * 0.6);
        }
      }

      // ---- 発破: 崖のふもとに赤い輪で予告し、数秒後に爆発。大岩が坂へ転がる
      if (!blast) {
        blastT -= dt;
        if (blastT <= 0 && sites.length) {
          blastT = 35 + Math.random() * 10;
          const near = sites.filter((s) => {
            const d = Math.hypot(s.x - p.pos.x, s.z - p.pos.z);
            return d > 10 && d < 42;
          });
          const pool = near.length ? near : sites;
          const s = pool[Math.floor(Math.random() * pool.length)];
          blast = { x: s.x, y: grid.at(s.x, s.z), z: s.z, t: BLAST_WARN, ring: 0, k: s.k };
          if (blastDisc) {
            blastDisc.position.set(s.x, blast.y + 0.15, s.z);
            blastDisc.visible = true;
          }
          g.hud.toast('発破！ 赤い円から離れろ！', 'warn');
          g.audio.warn();
        }
      } else {
        const bl = blast;
        bl.t -= dt;
        bl.ring -= dt;
        if (blastMat) blastMat.opacity = 0.22 + 0.2 * (0.5 + 0.5 * Math.sin(g.time * (10 + (BLAST_WARN - bl.t) * 6)));
        if (bl.ring <= 0) {
          bl.ring = 0.8;
          g.fx.ring({ x: bl.x, y: bl.y + 0.1, z: bl.z }, 1, BLAST_R, ZONE.enemy, 0.8, 0.85);
          g.fx.dust({ x: bl.x, y: bl.y + 0.5, z: bl.z }, 0.6, 0xe8d8a8, 2);
        }
        if (bl.t <= 0) {
          blast = null;
          if (blastDisc) blastDisc.visible = false;
          blasts++;
          g.explode({ x: bl.x, y: bl.y + 1, z: bl.z }, BLAST_R, 140, { force: 20, struct: 280, hurtPlayer: true, source: 'prop', element: 'fire' });
          g.fx.dust({ x: bl.x, y: bl.y + 1, z: bl.z }, 3, 0xd8c8a0, 10);
          // 大岩を穴の中心の方へ転がす
          const n = 2 + (Math.random() < 0.5 ? 1 : 0);
          for (let i = 0; i < n; i++) {
            const ox = (Math.random() - 0.5) * 3;
            const oz = (Math.random() - 0.5) * 3;
            const x = bl.x + ox;
            const z = bl.z + oz;
            const dx = PC.x - x;
            const dz = PC.z - z;
            const d = Math.hypot(dx, dz) || 1;
            const sp = 4 + Math.random() * 3;
            const prop = w.spawnProp('rock', { x, y: grid.at(x, z) + 1.2, z }, Math.random() * 6, { hot: 25, dmgMul: 1.4, life: 25, scale: 0.55 + Math.random() * 0.25, vel: { x: (dx / d) * sp, y: 3, z: (dz / d) * sp }, spin: true });
            if (prop) rocks.push({ prop, cd: 0 });
          }
          // TNT が減っていたら、置き場に補充する
          let added = 0;
          if (tnts.length < 8) {
            for (let i = 0; i < 3; i++) {
              const x = STORE.x + i * 0.95;
              const z = STORE.z + 2.2;
              if (!w.free(x, z, 0)) continue;
              addTnt(x, z);
              added++;
            }
          }
          log('quarry.blast', { k: bl.k, dist: Math.round(Math.hypot(bl.x - p.pos.x, bl.z - p.pos.z)) }, { total: blasts, rocks: n, tntAdded: added, time: Math.round(g.time) });
        }
      }

      // ---- 転がる大岩（ノリコもひく）
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
        if (r.cd <= 0 && sp > 4 && Math.hypot(p.pos.x - t.x, p.pos.y + 0.9 - t.y, p.pos.z - t.z) < r.prop.half.y + 0.7) {
          r.cd = 1;
          p.hurt(28, { x: t.x, y: t.y, z: t.z }, '落石');
          p.launch(v.x * 0.6, 7, v.z * 0.6);
        }
      }
    },

    dispose() {
      warnMesh = null;
      warnMat = null;
      blastDisc = null;
      blastMat = null;
    },
  };
}
