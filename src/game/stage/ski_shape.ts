/**
 * 雪山のスキー場の形（純粋な計算）。描画や物理に依存しないので、テストから直接呼べる。
 * 南（z = -72）がふもと、北（z = +72）が頂上。ゲレンデは z = BASE_Z から TOP_Z まで上る。
 */

/** 0..1 へ切り詰めた smoothstep（terrain.ts と同じ式。テストで DOM を読まないよう、ここにも置く） */
function ss(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

export const SKI = {
  /** ふもとの平らな所の北の端と、頂上の平らな所の南の端 */
  baseZ: -40,
  topZ: 44,
  topH: 24,
  /** 両脇の尾根: |x| が ridgeX を超えると上がり始め、ridgeX + ridgeW で ridgeH 上がりきる */
  ridgeX: 44,
  ridgeW: 22,
  ridgeH: 9,
  /** 整備されたコースの半幅 */
  pisteW: 13,
  /** こぶ斜面 */
  mogul: { x0: -37, x1: -21, z0: -16, z1: 24 },
  /** ジャンプ台: 中心・幅・長さ・先端（南の端）の地面からの高さ */
  ramp: { x: 9, z: -22, w: 7, len: 10, h: 2.2 },
  /** リフトの通り道と、支柱の z */
  liftX: -41,
  pylonZ: [-56, -38, -20, -2, 16, 34, 52],
  /** 支柱の横木（ケーブル）の高さと、2 本のケーブルの間隔の半分 */
  cableH: 6.45,
  cableHalf: 1.3,
} as const;

/** 整備されたコースの中心の x（ゆるく蛇行する）。 */
export function pisteCenter(z: number): number {
  return 6 * Math.sin(z * 0.045);
}

/** 尾根の度合い（0: 谷の中 … 1: 尾根の上）。 */
export function ridgeK(x: number): number {
  return ss(SKI.ridgeX, SKI.ridgeX + SKI.ridgeW, Math.abs(x));
}

/** こぶ斜面の度合い（0: 外 … 1: 中）。縁 3m でなめらかに 0 になる。 */
export function mogulK(x: number, z: number): number {
  const m = SKI.mogul;
  return ss(0, 3, Math.min(x - m.x0, m.x1 - x, z - m.z0, m.z1 - z));
}

/** コースの外の度合い（0: コースの上 … 1: コースの外）。 */
export function offPisteK(x: number, z: number): number {
  const d = Math.abs(x - pisteCenter(z));
  return ss(SKI.pisteW - 1, SKI.pisteW + 3, d);
}

/** ゲレンデの基本の高さ（尾根・起伏・こぶを除く）。両端はなだらかで、中ほどが最も急（約 0.36）。 */
export function slopeBase(z: number): number {
  const t = Math.min(1, Math.max(0, (z - SKI.baseZ) / (SKI.topZ - SKI.baseZ)));
  return SKI.topH * (0.5 * t + 0.5 * t * t * (3 - 2 * t));
}

/** 地面の高さ。 */
export function skiHeight(x: number, z: number): number {
  let h = slopeBase(z);
  const rk = ridgeK(x);
  // 尾根（岩っぽい起伏つき）
  h += SKI.ridgeH * rk + rk * 0.9 * Math.sin(x * 0.45 + z * 0.2) * Math.cos(z * 0.37);
  // コースの外の吹きだまり（ふもとと頂上の平らな所では弱める）
  const flat = ss(SKI.baseZ - 10, SKI.baseZ + 4, z) * (1 - ss(SKI.topZ - 4, SKI.topZ + 6, z));
  const drift = 0.35 * Math.sin(x * 0.19 + z * 0.13) + 0.28 * Math.cos(z * 0.16 - x * 0.08);
  h += offPisteK(x, z) * drift * (1 - rk) * (0.35 + 0.65 * flat);
  // こぶ
  const mk = mogulK(x, z);
  if (mk > 0) h += mk * 0.55 * Math.sin(x * 1.35) * Math.sin(z * 1.35 + x * 0.3);
  return h;
}

/** ジャンプ台の上面の高さ（z の位置で）。北の端は地面、南の端（先端）は地面 + h。 */
export function rampTop(z: number, ground: (x: number, z: number) => number = skiHeight): number {
  const r = SKI.ramp;
  const zs = r.z + r.len / 2;
  const ze = r.z - r.len / 2;
  const gN = ground(r.x, zs);
  const gS = ground(r.x, ze) + r.h;
  const t = Math.min(1, Math.max(0, (zs - z) / (zs - ze)));
  return gN + (gS - gN) * t;
}

/** (x, z) がジャンプ台の先端の「飛び出す所」（先端から 3m 以内）か。 */
export function inRampLip(x: number, z: number): boolean {
  const r = SKI.ramp;
  const ze = r.z - r.len / 2;
  return Math.abs(x - r.x) < r.w / 2 + 0.3 && z >= ze - 0.3 && z <= ze + 3;
}

/** (x, z) がジャンプ台の上（または真下の地面）か。 */
export function inRamp(x: number, z: number, margin = 0): boolean {
  const r = SKI.ramp;
  return Math.abs(x - r.x) < r.w / 2 + margin && Math.abs(z - r.z) < r.len / 2 + margin;
}
