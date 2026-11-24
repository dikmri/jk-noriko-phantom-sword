/**
 * 攻撃モーションのデータと補間（純粋ロジック）。
 *
 * モーションは「腕を向ける方向（yaw / pitch）」と「腕の伸ばし具合（reach）」のキー列で表す。
 *  - yaw:   正面を 0 として、正の値がキャラの右側。±π まで（背面）。
 *  - pitch: 水平を 0 として、正の値が上。
 *  - reach: 0 = 腕を畳む、1 = 伸ばしきる。突きはこれを 0→1 に動かす。
 * キャラのローカル座標は three.js に合わせて +Z が正面、-X が右、+Y が上。
 */
import { clamp, clamp01, V3 } from '../core/vec';

export interface MotionKey {
  t: number;
  yaw: number;
  pitch: number;
  reach: number;
}

export interface MotionSample {
  yaw: number;
  pitch: number;
  reach: number;
}

export interface Motion {
  id: string;
  name: string;
  keys: MotionKey[];
  /** 0..1。大きいほど出だしが遅く、終わり際が速い（タメ）。 */
  ease: number;
  custom?: boolean;
}

export const YAW_LIMIT = Math.PI;
export const PITCH_MIN = -1.15;
export const PITCH_MAX = 1.45;
/** reach を 1 動かすことを、何ラジアン分の腕の動きとして数えるか。 */
export const REACH_WEIGHT = 1.6;

/** タメを反映した進行度。s: 0..1（時間）→ 0..1（キー上の位置）。 */
export function easeProgress(s: number, ease: number): number {
  const k = 1 + 1.5 * clamp01(ease);
  return Math.pow(clamp01(s), k);
}

/** 進行度の時間微分（終端での速度倍率の上限は 1 + 1.5 * ease）。 */
export function easeSpeed(s: number, ease: number): number {
  const k = 1 + 1.5 * clamp01(ease);
  return k * Math.pow(clamp01(s), k - 1);
}

function catmull(p0: number, p1: number, p2: number, p3: number, u: number): number {
  const u2 = u * u;
  const u3 = u2 * u;
  return 0.5 * (2 * p1 + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2 + (-p0 + 3 * p1 - 3 * p2 + p3) * u3);
}

/** キー列を位置 p (0..1) で補間する。 */
export function sampleKeys(keys: MotionKey[], p: number): MotionSample {
  const n = keys.length;
  if (n === 0) return { yaw: 0, pitch: 0, reach: 1 };
  if (n === 1 || p <= keys[0].t) return { yaw: keys[0].yaw, pitch: keys[0].pitch, reach: keys[0].reach };
  if (p >= keys[n - 1].t) return { yaw: keys[n - 1].yaw, pitch: keys[n - 1].pitch, reach: keys[n - 1].reach };
  let i = 0;
  while (i < n - 2 && keys[i + 1].t <= p) i++;
  const k0 = keys[Math.max(0, i - 1)];
  const k1 = keys[i];
  const k2 = keys[i + 1];
  const k3 = keys[Math.min(n - 1, i + 2)];
  const span = k2.t - k1.t;
  const u = span > 1e-9 ? (p - k1.t) / span : 0;
  return {
    yaw: clamp(catmull(k0.yaw, k1.yaw, k2.yaw, k3.yaw, u), -YAW_LIMIT, YAW_LIMIT),
    pitch: clamp(catmull(k0.pitch, k1.pitch, k2.pitch, k3.pitch, u), PITCH_MIN, PITCH_MAX),
    reach: clamp01(catmull(k0.reach, k1.reach, k2.reach, k3.reach, u)),
  };
}

/** 時間 s (0..1) でのモーションの姿勢。 */
export function sampleMotion(m: Motion, s: number): MotionSample {
  return sampleKeys(m.keys, easeProgress(s, m.ease));
}

/** yaw / pitch からキャラのローカル方向ベクトルを作る。 */
export function dirFromAngles(yaw: number, pitch: number): V3 {
  const cp = Math.cos(pitch);
  return { x: -Math.sin(yaw) * cp, y: Math.sin(pitch), z: Math.cos(yaw) * cp };
}

/** 2 つの姿勢の間の「腕の動いた量」（ラジアン相当）。 */
export function sampleDistance(a: MotionSample, b: MotionSample): number {
  const da = dirFromAngles(a.yaw, a.pitch);
  const db = dirFromAngles(b.yaw, b.pitch);
  const d = clamp(da.x * db.x + da.y * db.y + da.z * db.z, -1, 1);
  // yaw が ±π をまたぐ回転斬りでも量が出るよう、角度差そのものも見る
  const ang = Math.max(Math.acos(d), Math.abs(a.yaw - b.yaw) * Math.cos((a.pitch + b.pitch) / 2));
  return ang + Math.abs(a.reach - b.reach) * REACH_WEIGHT;
}

/** モーション全体の腕の移動量（ラジアン相当）。 */
export function motionArc(keys: MotionKey[], samples = 96): number {
  if (keys.length < 2) return 0;
  let total = 0;
  let prev = sampleKeys(keys, 0);
  for (let i = 1; i <= samples; i++) {
    const cur = sampleKeys(keys, i / samples);
    total += sampleDistance(prev, cur);
    prev = cur;
  }
  return total;
}

/** キーの t を、移動量に比例するよう振り直す（等速で動くようになる）。 */
export function retimeByArc(points: MotionSample[]): MotionKey[] {
  if (points.length === 0) return [];
  const acc: number[] = [0];
  for (let i = 1; i < points.length; i++) acc.push(acc[i - 1] + Math.max(1e-4, sampleDistance(points[i - 1], points[i])));
  const total = acc[acc.length - 1] || 1;
  return points.map((p, i) => ({ t: points.length === 1 ? 0 : acc[i] / total, yaw: p.yaw, pitch: p.pitch, reach: p.reach }));
}

export interface SwingTiming {
  /** 振り始めから振り終わりまでの秒数 */
  duration: number;
  /** 腕の移動量（ラジアン相当） */
  arc: number;
}

/**
 * モーションの所要時間。腕の移動量を武器の振りの速さで割る。
 * 短すぎる動きは minDuration、長すぎる動きは maxDuration で止める。
 */
export function swingTiming(m: Motion, swingSpeed: number, minDuration = 0.1, maxDuration = 2.4): SwingTiming {
  const arc = motionArc(m.keys);
  const duration = clamp(arc / Math.max(0.1, swingSpeed), minDuration, maxDuration);
  return { duration, arc };
}

const D = Math.PI / 180;
function preset(id: string, name: string, ease: number, pts: [number, number, number][]): Motion {
  return { id, name, ease, keys: retimeByArc(pts.map(([y, p, r]) => ({ yaw: y * D, pitch: p * D, reach: r }))) };
}

/** 最初から選べるモーション。 */
export const PRESET_MOTIONS: Motion[] = [
  preset('yoko', '横薙ぎ', 0.45, [
    [80, 12, 0.95],
    [45, 6, 1],
    [0, 0, 1],
    [-45, 6, 1],
    [-85, 14, 0.95],
  ]),
  preset('tate', '兜割り', 0.6, [
    [12, 86, 0.85],
    [6, 50, 1],
    [0, 8, 1],
    [-4, -38, 0.95],
  ]),
  preset('x', 'X斬り', 0.3, [
    [62, 62, 1],
    [0, 12, 1],
    [-62, -32, 1],
    [-70, 20, 0.8],
    [-62, 62, 1],
    [0, 12, 1],
    [62, -32, 1],
  ]),
  preset('tsuki', '突き', 0.7, [
    [8, 6, 0.0],
    [4, 4, 0.2],
    [0, 2, 1.0],
  ]),
  preset('kaiten', '回転斬り', 0.2, [
    [175, 0, 1],
    [90, 0, 1],
    [0, 0, 1],
    [-90, 0, 1],
    [-175, 0, 1],
  ]),
  preset('sukui', 'すくい上げ', 0.5, [
    [16, -58, 0.9],
    [8, -12, 1],
    [0, 40, 1],
    [-6, 82, 0.9],
  ]),
];

export function cloneMotion(m: Motion): Motion {
  return { id: m.id, name: m.name, ease: m.ease, custom: m.custom, keys: m.keys.map((k) => ({ ...k })) };
}

/** 保存データなどから読んだ値が、モーションとして使える形かを確かめる。 */
export function isValidMotion(v: unknown): v is Motion {
  const m = v as Motion;
  if (!m || typeof m.id !== 'string' || typeof m.name !== 'string' || !Array.isArray(m.keys) || m.keys.length < 2) return false;
  if (typeof m.ease !== 'number' || !Number.isFinite(m.ease)) return false;
  let prev = -1;
  for (const k of m.keys) {
    if (![k.t, k.yaw, k.pitch, k.reach].every((n) => typeof n === 'number' && Number.isFinite(n))) return false;
    if (k.t < prev) return false;
    prev = k.t;
  }
  return m.keys[0].t === 0 && Math.abs(m.keys[m.keys.length - 1].t - 1) < 1e-6;
}
