/**
 * USDCraft-10K の物体（部品と関節つきの小物）の形と、関節の動きの計算。
 * 座標は glTF（Y 上・メートル）。物体の原点は底面の中心付近、正面は +Z。
 * 描画や物理には触らない純粋な計算だけを置く（world.ts が使う）。
 */
import * as THREE from 'three';

export type Vec3 = [number, number, number];
export type JointType = 'revolute' | 'prismatic' | 'continuous';

export interface ArtLink {
  /** 部品の名前（GLB のノード名） */
  n: string;
  /** 親の部品の番号（根は -1）。親は必ず前にある */
  p: number;
  /** 質量 (kg) */
  m: number;
  /** 静止姿勢での箱（物体座標） */
  min: Vec3;
  max: Vec3;
}

export interface ArtJoint {
  n: string;
  t: JointType;
  /** 親と子の部品の番号 */
  p: number;
  c: number;
  /** 支点と軸（静止姿勢の物体座標） */
  a: Vec3;
  x: Vec3;
  /** 動く範囲（回転はラジアン、直動はメートル）。continuous は 0, 0 */
  lo: number;
  hi: number;
}

export interface ArtDef {
  id: string;
  title: string;
  mass: number;
  min: Vec3;
  max: Vec3;
  tris: number;
  links: ArtLink[];
  joints: ArtJoint[];
}

/** 関節の今の姿勢。target が NaN でない関節は、静止位置の代わりにそこへ戻る。 */
export interface ArtPose {
  q: Float32Array;
  v: Float32Array;
  target: Float32Array;
  /** 部品の番号 -> その部品を動かす関節の番号（無ければ -1） */
  jointOf: Int16Array;
}

export function makePose(def: ArtDef): ArtPose {
  const n = def.joints.length;
  const jointOf = new Int16Array(def.links.length).fill(-1);
  def.joints.forEach((j, i) => {
    jointOf[j.c] = i;
  });
  const q = new Float32Array(n);
  def.joints.forEach((j, i) => {
    q[i] = restOf(j);
  });
  return { q, v: new Float32Array(n), target: new Float32Array(n).fill(NaN), jointOf };
}

/** 関節の静止位置（範囲の中で 0 にいちばん近い値）。 */
export function restOf(j: ArtJoint): number {
  if (j.t === 'continuous') return 0;
  return Math.min(j.hi, Math.max(j.lo, 0));
}

const tv = new THREE.Vector3();
const ta = new THREE.Vector3();
const tm = new THREE.Matrix4();
const tr = new THREE.Matrix4();
const tj = new THREE.Matrix4();

/** 関節 j を q 動かす変換（静止姿勢の物体座標）を out に入れる。 */
export function jointMatrix(j: ArtJoint, q: number, out: THREE.Matrix4): THREE.Matrix4 {
  if (j.t === 'prismatic') return out.makeTranslation(j.x[0] * q, j.x[1] * q, j.x[2] * q);
  ta.set(j.a[0], j.a[1], j.a[2]);
  tv.set(j.x[0], j.x[1], j.x[2]);
  out.makeTranslation(ta.x, ta.y, ta.z);
  tr.makeRotationAxis(tv, q);
  out.multiply(tr);
  tm.makeTranslation(-ta.x, -ta.y, -ta.z);
  return out.multiply(tm);
}

/**
 * 各部品の動き（静止姿勢の物体座標からの変換）を求める。
 * 部品の頂点（物体座標）に out[i] を掛けると、今の姿勢での位置になる。
 */
export function linkMatrices(def: ArtDef, pose: ArtPose, out: THREE.Matrix4[]): void {
  const links = def.links;
  for (let i = 0; i < links.length; i++) {
    const p = links[i].p;
    const o = out[i];
    if (p < 0) o.identity();
    else o.copy(out[p]);
    const j = pose.jointOf[i];
    if (j >= 0) o.multiply(jointMatrix(def.joints[j], pose.q[j], tj));
  }
}

export interface StepOpts {
  /** ばねの強さと減衰（扉・引き出し） */
  k?: number;
  c?: number;
  /** 回し続ける関節の止まりやすさ（1 秒あたり） */
  spinDamp?: number;
}

/**
 * 関節を dt 秒進める。範囲のある関節は、ばねで静止位置（または target）へ戻り、端で跳ね返る。
 * 戻り値は動きの大きさ（小さければ止まっている）。
 */
export function stepPose(def: ArtDef, pose: ArtPose, dt: number, opts: StepOpts = {}): number {
  const k = opts.k ?? 28;
  const c = opts.c ?? 3.2;
  const damp = Math.exp(-(opts.spinDamp ?? 0.35) * dt);
  let act = 0;
  const js = def.joints;
  for (let i = 0; i < js.length; i++) {
    const j = js[i];
    let q = pose.q[i];
    let v = pose.v[i];
    if (j.t === 'continuous') {
      const tg = pose.target[i];
      if (!Number.isNaN(tg)) v += (tg - v) * Math.min(1, dt * 4); // target は回る速さ
      else v *= damp;
      q += v * dt;
      if (q > Math.PI) q -= Math.PI * 2;
      else if (q < -Math.PI) q += Math.PI * 2;
      act = Math.max(act, Math.abs(v));
    } else {
      const tg = pose.target[i];
      const rest = Number.isNaN(tg) ? restOf(j) : Math.min(j.hi, Math.max(j.lo, tg));
      // 半陰的オイラー（大きな dt でも発散しにくい）
      v += (-k * (q - rest) - c * v) * dt;
      q += v * dt;
      if (q < j.lo) {
        q = j.lo;
        if (v < 0) v = -v * 0.35;
      } else if (q > j.hi) {
        q = j.hi;
        if (v > 0) v = -v * 0.35;
      }
      if (Math.abs(q - rest) < 1e-4 && Math.abs(v) < 1e-3) {
        q = rest;
        v = 0;
      }
      act = Math.max(act, Math.abs(v), Math.abs(q - rest));
    }
    pose.q[i] = q;
    pose.v[i] = v;
  }
  return act;
}

/** 名前（関節の名前か、動かす部品の名前の一部）に合う関節の番号。 */
export function findJoints(def: ArtDef, name: string): number[] {
  const out: number[] = [];
  def.joints.forEach((j, i) => {
    if (j.n.includes(name) || def.links[j.c].n.includes(name)) out.push(i);
  });
  return out;
}

const WHEEL = /wheel|caster|tire|tyre|roller/;

/** 進む速さに合わせて回す車輪か。 */
export function isWheel(def: ArtDef, j: number): boolean {
  const jt = def.joints[j];
  if (jt.t !== 'continuous') return false;
  if (Math.abs(jt.x[1]) > 0.7) return false; // 縦の軸は車輪ではない（向きを変える台など）
  return WHEEL.test(def.links[jt.c].n) || WHEEL.test(jt.n);
}

/** 車輪の半径（部品の箱のうち、軸に直交する向きの大きさの半分）。 */
export function wheelRadius(def: ArtDef, j: number): number {
  const jt = def.joints[j];
  const l = def.links[jt.c];
  const d = [l.max[0] - l.min[0], l.max[1] - l.min[1], l.max[2] - l.min[2]];
  const ax = jt.x.map(Math.abs);
  const main = ax.indexOf(Math.max(...ax));
  const other = d.filter((_, i) => i !== main);
  return Math.max(0.03, Math.max(...other) / 2);
}

/** 部品の箱の中心（物体座標）。 */
export function linkCenter(l: ArtLink, out: THREE.Vector3): THREE.Vector3 {
  return out.set((l.min[0] + l.max[0]) / 2, (l.min[1] + l.max[1]) / 2, (l.min[2] + l.max[2]) / 2);
}
