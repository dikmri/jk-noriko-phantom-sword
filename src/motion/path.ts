/**
 * モーションエディタで描いた軌跡を、モーションのキー列へ変換する（純粋ロジック）。
 */
import { MotionKey, MotionSample, retimeByArc, sampleDistance } from './motion';

export interface RawPoint extends MotionSample {
  /** 何筆目か。筆が変わっても軌跡はつながる（手が次の始点へ移動する）。 */
  stroke: number;
}

/** 1 つのモーションに使える腕の移動量の上限（ラジアン相当）。エディタの「インク」。 */
export const MAX_INK = Math.PI * 4.5;
export const MAX_KEYS = 40;

/** 軌跡の長さ（ラジアン相当）。 */
export function pathLength(points: MotionSample[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += sampleDistance(points[i - 1], points[i]);
  return total;
}

function perpDistance(p: MotionSample, a: MotionSample, b: MotionSample): number {
  const ab = sampleDistance(a, b);
  if (ab < 1e-6) return sampleDistance(p, a);
  const ap = sampleDistance(a, p);
  const pb = sampleDistance(p, b);
  // 三角形の 3 辺から、底辺 ab に対する高さを求める（ヘロンの公式）
  const s = (ab + ap + pb) / 2;
  const area = Math.sqrt(Math.max(0, s * (s - ab) * (s - ap) * (s - pb)));
  return (2 * area) / ab;
}

/** Ramer–Douglas–Peucker 法で点を間引く。始点と終点は必ず残す。 */
export function simplify<T extends MotionSample>(points: T[], tol: number): T[] {
  if (points.length <= 2) return points.slice();
  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = keep[points.length - 1] = true;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let worst = -1;
    let worstD = tol;
    for (let i = a + 1; i < b; i++) {
      const d = perpDistance(points[i], points[a], points[b]);
      if (d > worstD) {
        worstD = d;
        worst = i;
      }
    }
    if (worst >= 0) {
      keep[worst] = true;
      stack.push([a, worst], [worst, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/** 上限を超えないよう、軌跡を先頭から maxLen の長さで切る。 */
export function truncateToLength<T extends MotionSample>(points: T[], maxLen: number): T[] {
  const out: T[] = [];
  let total = 0;
  for (let i = 0; i < points.length; i++) {
    if (i > 0) {
      total += sampleDistance(points[i - 1], points[i]);
      if (total > maxLen) break;
    }
    out.push(points[i]);
  }
  return out;
}

/**
 * 描いた点列からキー列を作る。
 * 筆ごとに間引き、全体が MAX_KEYS を超えるなら許容誤差を広げてやり直す。
 * 2 点に満たない入力は null を返す。
 */
export function buildKeys(points: RawPoint[], tol = 0.035): MotionKey[] | null {
  const pts = truncateToLength(points, MAX_INK);
  if (pts.length < 2) return null;
  const strokes = new Map<number, RawPoint[]>();
  for (const p of pts) {
    if (!strokes.has(p.stroke)) strokes.set(p.stroke, []);
    strokes.get(p.stroke)!.push(p);
  }
  let t = tol;
  let merged: RawPoint[] = [];
  for (let attempt = 0; attempt < 8; attempt++) {
    merged = [];
    for (const [, st] of strokes) merged.push(...simplify(st, t));
    if (merged.length <= MAX_KEYS) break;
    t *= 1.6;
  }
  if (merged.length > MAX_KEYS) {
    const step = merged.length / MAX_KEYS;
    const pick: RawPoint[] = [];
    for (let i = 0; i < MAX_KEYS - 1; i++) pick.push(merged[Math.floor(i * step)]);
    pick.push(merged[merged.length - 1]);
    merged = pick;
  }
  if (merged.length < 2 || pathLength(merged) < 0.05) return null;
  return retimeByArc(merged);
}
