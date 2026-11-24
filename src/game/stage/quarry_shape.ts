/**
 * 採石場の地形の形（描画や物理に依存しない計算）。
 * 擂り鉢状の段々の採掘穴・らせんの運搬路・ボタ山の高さと、敵が穴のまわりを回り込む向きを求める。
 */

/** 穴の中心 */
export const PC = { x: 6, z: 8 };
/** 穴の縁と底の半径（穴の中心からの「ゆがめた距離」）、深さ、段の高さ */
export const R_RIM = 38;
export const R_BOT = 10;
export const DEPTH = 16;
export const STEP = 4;
/** 段のうち、崖が占める割合（残りが平らな段） */
const CLIFF = 0.28;
/** 運搬路の半幅・点の数・巻き数・入口の角度 */
export const ROAD_W = 3.4;
export const ROAD_N = 170;
const TURNS = 1.05;
const A0 = -Math.PI / 2 + 0.45;
/** ボタ山（盛り土）: 中心・裾の半径・頂上の平らな所の半径・高さ。まわりは敵が登れないほど急 */
export const HEAP = { x: -46, z: 44, r: 19, top: 5, h: 8 };
/** ボタ山の南の登り坂: x は中心線、z0 が登り口（高さ 0）、z1 が頂上の縁、w は半幅 */
export const RAMP = { x: HEAP.x, z0: HEAP.z - 34, z1: HEAP.z - HEAP.top, w: 2.6 };

export function smooth(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** 穴の形を少しいびつにする倍率（角度 a ごと）。 */
export function noiseF(a: number): number {
  return 1 + 0.035 * Math.sin(3 * a + 0.7) + 0.025 * Math.sin(5 * a + 2.1);
}

/** 穴の中心からの距離（いびつさを含めた値。段の位置はこの値で決まる）。 */
export function pitDist(x: number, z: number): number {
  const dx = x - PC.x;
  const dz = z - PC.z;
  return Math.hypot(dx, dz) * noiseF(Math.atan2(dz, dx));
}

/** 角度 a の方向で、ゆがめた距離が dn になる点。 */
export function polar(a: number, dn: number): { x: number; z: number } {
  const r = dn / noiseF(a);
  return { x: PC.x + Math.cos(a) * r, z: PC.z + Math.sin(a) * r };
}

/** 穴の深さ（正の値）。段の大半は平らで、境目で急に深くなる（崖）。 */
export function pitDepth(dn: number): number {
  if (dn >= R_RIM) return 0;
  const raw = Math.min(DEPTH, (DEPTH * (R_RIM - dn)) / (R_RIM - R_BOT));
  const q = Math.floor(raw / STEP);
  const frac = raw / STEP - q;
  return Math.min(DEPTH, (q + smooth(1 - CLIFF, 1, frac)) * STEP);
}

/** 段 k（0 = 縁の高さ、4 = 底）の平らな所の、内側と外側のゆがめた距離。 */
export function benchRange(k: number): [number, number] {
  const span = R_RIM - R_BOT;
  const outer = k === 0 ? Infinity : R_RIM - (span * (STEP * k)) / DEPTH;
  const inner = k >= DEPTH / STEP ? 0 : R_RIM - (span * (STEP * k + STEP * (1 - CLIFF))) / DEPTH;
  return [inner, outer];
}

export interface RoadPt {
  x: number;
  z: number;
  h: number;
}

/** 運搬路の点。i = 0 が縁（高さ 0）、最後が底（-DEPTH）。 */
export function roadPoints(): RoadPt[] {
  const pts: RoadPt[] = [];
  for (let i = 0; i <= ROAD_N; i++) {
    const t = i / ROAD_N;
    const a = A0 + t * Math.PI * 2 * TURNS;
    const p = polar(a, R_RIM - 3 - (R_RIM - 3 - (R_BOT - 1)) * t);
    pts.push({ x: p.x, z: p.z, h: 0 });
  }
  // 高さは道のりに比例させる（内側ほど 1 周が短いので、t に比例させると底の近くが急になる）
  const len = [0];
  for (let i = 1; i < pts.length; i++) len.push(len[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
  const total = len[len.length - 1];
  for (let i = 0; i < pts.length; i++) pts[i].h = (-DEPTH * len[i]) / total;
  return pts;
}

/** 点から運搬路までの距離・いちばん近い所の高さ・その区間の番号。 */
export function nearRoad(pts: RoadPt[], x: number, z: number, from = 0, to = pts.length - 1): { d: number; h: number; i: number } {
  let best = Infinity;
  let bh = 0;
  let bi = 0;
  const a0 = Math.max(0, from);
  const a1 = Math.min(pts.length - 1, to);
  for (let i = a0; i < a1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const vx = b.x - a.x;
    const vz = b.z - a.z;
    const l2 = vx * vx + vz * vz || 1;
    const t = Math.max(0, Math.min(1, ((x - a.x) * vx + (z - a.z) * vz) / l2));
    const d = Math.hypot(x - (a.x + vx * t), z - (a.z + vz * t));
    if (d < best) {
      best = d;
      bh = a.h + (b.h - a.h) * t;
      bi = i;
    }
  }
  return { d: best, h: bh, i: bi };
}

/** 地面の高さ。pts は運搬路の点。 */
export function quarryHeight(x: number, z: number, pts: RoadPt[]): number {
  const dn = pitDist(x, z);
  let h = -pitDepth(dn);
  // 穴の外のゆるい起伏（縁の近くは平らにしておく）
  if (dn > R_RIM + 2) h += (0.35 * Math.sin(x * 0.08 + z * 0.05) + 0.25 * Math.cos(z * 0.11 - x * 0.04)) * smooth(R_RIM + 2, R_RIM + 10, dn);
  // ボタ山（円すい。頂上は平ら）と、南の登り坂
  const hh = heapHeight(x, z);
  // 山のふもとで段差ができないよう、まわりの起伏から山の高さへなめらかに移す
  if (hh > 0) h = h * (1 - smooth(0, 3, hh)) + hh;
  // 運搬路: 道の上は道の高さ。道の脇は 4m かけてなだらかにつなぐ
  if (dn < R_RIM + 6) {
    const r = nearRoad(pts, x, z);
    if (r.d < ROAD_W + 4) {
      const k = 1 - smooth(ROAD_W, ROAD_W + 4, r.d);
      h = h + (r.h + 0.15 - h) * k;
    }
  }
  return h;
}

/** ボタ山と登り坂の高さ（無い所は 0）。 */
export function heapHeight(x: number, z: number): number {
  let hh = 0;
  const hd = Math.hypot(x - HEAP.x, z - HEAP.z);
  if (hd < HEAP.r) {
    const lin = Math.min(1, (HEAP.r - hd) / (HEAP.r - HEAP.top));
    hh = HEAP.h * (0.6 * lin + 0.4 * smooth(0, 1, lin)) + 0.3 * Math.sin(x * 0.5) * Math.cos(z * 0.45) * (1 - lin);
  }
  const off = Math.abs(x - RAMP.x);
  if (z > RAMP.z0 - 3 && z < RAMP.z1 + 2 && off < RAMP.w + 3) {
    const rh = HEAP.h * Math.min(1, Math.max(0, (z - RAMP.z0) / (RAMP.z1 - RAMP.z0)));
    hh = Math.max(hh, rh * (1 - smooth(RAMP.w, RAMP.w + 3, off)));
  }
  return hh;
}

/**
 * 穴のまわりを回り込んで近づく向き（単位ベクトル）。
 * 敵 (ex, ez) が、中心 c（省くと穴の中心）・半径 tr の円に沿って、プレイヤー (px, pz) のいる角度へ近い回り方で進む。
 */
export function ringDir(ex: number, ez: number, px: number, pz: number, tr: number, c: { x: number; z: number } = PC): [number, number] {
  const ae = Math.atan2(ez - c.z, ex - c.x);
  const ap = Math.atan2(pz - c.z, px - c.x);
  let da = ap - ae;
  while (da > Math.PI) da -= Math.PI * 2;
  while (da < -Math.PI) da += Math.PI * 2;
  const s = da >= 0 ? 1 : -1;
  // 接線（角度が増える向き）に、半径のずれを直す成分を足す
  const tx = -Math.sin(ae) * s;
  const tz = Math.cos(ae) * s;
  const er = Math.hypot(ex - c.x, ez - c.z);
  const k = Math.max(-0.8, Math.min(0.8, (tr - er) * 0.35));
  const vx = tx + Math.cos(ae) * k;
  const vz = tz + Math.sin(ae) * k;
  const d = Math.hypot(vx, vz) || 1;
  return [vx / d, vz / d];
}
