/**
 * 温泉街の地形の形（純粋な計算だけ。描画や物理には依存しない）。
 * 南（z が小さい方）が低く、北へ STEP_H ずつ段が上がる。中央の大通りはまっすぐな坂、東西の石段は緩い坂。
 */

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** 段の高さと、段の境目（崖）の z。南から順に、ここを越えると STEP_H 上がる */
export const STEP_H = 4;
export const EDGES = [-29.25, -7.75, 13.75, 35.25];
export const TOP_H = STEP_H * EDGES.length;
/** 崖の幅の半分（この幅で一気に上がる） */
export const CLIFF = 1.1;
/** 大通り: 道の半幅、両脇のなだらかにつなぐ幅、坂の下端と上端の z（高さは 0 → TOP_H） */
export const ST_W = 4;
export const ST_BLEND = 4;
export const ST_Z0 = -40;
export const ST_Z1 = 46;
/** 石段: 東西に 1 本ずつ。半幅と、境目から前後に何 m かけて上がるか（敵が登れるよう、傾きは 0.25 より緩く） */
export const STAIRS_X = [-36, 36];
export const STAIR_W = 3;
export const STAIR_L = 9;
/** 湯の川（西）: 中心の x、半幅、深さ */
export const RIVER_X = -58;
export const RIVER_W = 3;
export const RIVER_D = 0.7;
/** 露天風呂: 中心と、x・z 方向の半径 */
export const POOLS = [
  { x: -24, z: 2.5, rx: 6, rz: 4.2 },
  { x: 25, z: 24.5, rx: 5.5, rz: 4 },
  { x: -26, z: 52, rx: 7, rz: 5 },
];
/** 露天風呂の深さと、水面の高さ（段の高さからの差） */
export const POOL_D = 0.65;
export const POOL_WATER = -0.3;
/** 間欠泉: 位置と、打ち上げる範囲の半径 */
export const GEYSERS = [
  { x: 20, z: -18, r: 3.6 },
  { x: -14, z: 24, r: 3.6 },
  { x: 32, z: 52, r: 4 },
];
export function terraceH(z: number): number {
  let h = 0;
  for (const e of EDGES) h += STEP_H * smoothstep(e - CLIFF, e + CLIFF, z);
  return h;
}

/** 大通りの高さ（z だけで決まる、まっすぐな坂）。 */
export function streetH(z: number): number {
  return TOP_H * Math.min(1, Math.max(0, (z - ST_Z0) / (ST_Z1 - ST_Z0)));
}

/** 大通りの上で、高さが h になる z。 */
export function streetZAt(h: number): number {
  return ST_Z0 + (Math.min(TOP_H, Math.max(0, h)) / TOP_H) * (ST_Z1 - ST_Z0);
}

export function riverX(z: number): number {
  return RIVER_X + 1.2 * Math.sin(z * 0.06);
}

/** 露天風呂の中心からの距離（楕円の縁で 1）。いちばん近い風呂の番号も返す。 */
export function poolDist(x: number, z: number): { d: number; i: number } {
  let best = Infinity;
  let bi = -1;
  for (let i = 0; i < POOLS.length; i++) {
    const p = POOLS[i];
    const d = Math.hypot((x - p.x) / p.rx, (z - p.z) / p.rz);
    if (d < best) {
      best = d;
      bi = i;
    }
  }
  return { d: best, i: bi };
}

/** 地面の高さ。 */
export function onsenHeight(x: number, z: number): number {
  let h = terraceH(z);
  // 石段: 境目の前後 STAIR_L で、下の段から上の段へまっすぐ上がる坂
  for (const sx of STAIRS_X) {
    const dx = Math.abs(x - sx);
    if (dx > STAIR_W + 1.6) continue;
    for (let i = 0; i < EDGES.length; i++) {
      const e = EDGES[i];
      if (Math.abs(z - e) > STAIR_L + 0.5) continue;
      const ramp = i * STEP_H + STEP_H * Math.min(1, Math.max(0, (z - (e - STAIR_L)) / (2 * STAIR_L)));
      const k = 1 - smoothstep(STAIR_W, STAIR_W + 1.6, dx);
      h += (ramp - h) * k;
    }
  }
  // 大通り: 道の上は道の高さ。両脇はなだらかに段とつなぐ（どの段からも道へ出られる）
  const ax = Math.abs(x);
  if (ax < ST_W + ST_BLEND && z > ST_Z0 - 8 && z < ST_Z1 + 8) {
    const k = 1 - smoothstep(ST_W, ST_W + ST_BLEND, ax);
    h += (streetH(z) - h) * k;
  }
  // 湯の川
  const rx = Math.abs(x - riverX(z));
  if (rx < RIVER_W + 1.5) h -= RIVER_D * (1 - smoothstep(RIVER_W - 0.8, RIVER_W + 1.5, rx));
  // 露天風呂のくぼみ
  const pd = poolDist(x, z).d;
  if (pd < 1.1) h -= POOL_D * (1 - smoothstep(0.6, 1.0, pd));
  // 間欠泉の小さな盛り上がり
  for (const v of GEYSERS) {
    const d = Math.hypot(x - v.x, z - v.z);
    if (d < 2.6) h += 0.45 * (1 - smoothstep(0.8, 2.6, d));
  }
  // 東西と北の山（谷のふち）。山だけ起伏をつける
  const m = Math.max(smoothstep(62, 71, ax), smoothstep(63, 72, z));
  if (m > 0) h += m * (16 + 2.5 * Math.sin(z * 0.13 + x * 0.05) + 1.6 * Math.cos(x * 0.21 - z * 0.07));
  return h;
}

