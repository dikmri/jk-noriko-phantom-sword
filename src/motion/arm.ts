/**
 * 腕の姿勢の計算（純粋ロジック）。
 * モーションの姿勢（yaw / pitch / reach）から、肩・ひじ・手・武器の先端の位置を求める。
 * 見た目のモデルと当たり判定の両方が、ここの結果を使う。
 */
import { add, clamp, cross, dot, len, lerp, norm, rotY, scale, sub, V3 } from '../core/vec';
import { dirFromAngles, MotionSample } from './motion';

export interface ArmSpec {
  /** 肩の位置（キャラのローカル座標。右肩は x が負） */
  shoulder: V3;
  /** 上腕の長さ */
  upper: number;
  /** 前腕 + 握りまでの長さ */
  lower: number;
}

/** yaw がこの角度を超えた分は、体ごと回って受け持つ。 */
export const ARM_YAW_MAX = 1.9;
/** 腕の yaw のうち、胴のひねりで受け持つ割合。 */
export const TORSO_TWIST_RATIO = 0.35;
/** reach = 0 のときの、腕の最大長に対する手の距離の割合。 */
export const REACH_MIN_RATIO = 0.45;

export interface BodyTurn {
  /** 体全体の回転（three.js の rotation.y に足す値） */
  spin: number;
  /** 胴のひねり（torso の rotation.y） */
  twist: number;
}

export function bodyTurn(yaw: number): BodyTurn {
  const armYaw = clamp(yaw, -ARM_YAW_MAX, ARM_YAW_MAX);
  // yaw の正は右（-X 側）。three.js の rotation.y は +Z を +X へ回すので符号が逆になる。
  return { spin: -(yaw - armYaw), twist: -armYaw * TORSO_TWIST_RATIO };
}

export interface TwoBone {
  elbow: V3;
  hand: V3;
}

/**
 * 2 本の骨の逆運動学。肩を原点とし、target へ手を届かせる。届かない距離なら伸ばしきる。
 * pole はひじを向けたい方向。
 */
export function solveTwoBone(target: V3, l1: number, l2: number, pole: V3): TwoBone {
  const dRaw = len(target);
  const axis = dRaw > 1e-9 ? scale(target, 1 / dRaw) : { x: 0, y: -1, z: 0 };
  const d = clamp(dRaw, Math.abs(l1 - l2) + 1e-4, l1 + l2 - 1e-4);
  const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  let p = sub(pole, scale(axis, dot(pole, axis)));
  if (len(p) < 1e-6) {
    p = cross(axis, { x: 1, y: 0, z: 0 });
    if (len(p) < 1e-6) p = cross(axis, { x: 0, y: 0, z: 1 });
  }
  p = norm(p);
  return { elbow: add(scale(axis, a), scale(p, h)), hand: scale(axis, d) };
}

/** 肩から手までの距離。 */
export function handDistance(reach: number, spec: ArmSpec): number {
  const max = spec.upper + spec.lower;
  return max * lerp(REACH_MIN_RATIO, 0.995, clamp(reach, 0, 1));
}

export interface WeaponPose {
  shoulder: V3;
  hand: V3;
  tip: V3;
  /** 武器の向き（単位ベクトル、ワールド座標） */
  dir: V3;
  turn: BodyTurn;
}

/**
 * ワールド座標での肩・手・武器の先端。
 * charYaw は three.js の rotation.y（キャラの正面 +Z が向く角度）。
 */
export function weaponPose(charPos: V3, charYaw: number, s: MotionSample, spec: ArmSpec, weaponLen: number, modelScale = 1): WeaponPose {
  const turn = bodyTurn(s.yaw);
  const shoulderLocal = scale(spec.shoulder, modelScale);
  const shoulder = add(charPos, rotY(shoulderLocal, charYaw + turn.spin + turn.twist));
  const dir = rotY(dirFromAngles(s.yaw, s.pitch), charYaw);
  const hand = add(shoulder, scale(dir, handDistance(s.reach, spec) * modelScale));
  const tip = add(hand, scale(dir, weaponLen));
  return { shoulder, hand, tip, dir, turn };
}
