import * as THREE from 'three';
import { Assets } from '../core/assets';
import { rotY, V3 } from '../core/vec';
import { ArmSpec, bodyTurn, solveTwoBone, weaponPose, WeaponPose } from '../motion/arm';
import { MotionSample } from '../motion/motion';
import { WeaponDef } from './defs';

export const MODEL_SCALE = 1.12;
export const FACES = ['neutral', 'blink', 'attack', 'hurt', 'happy', 'smug', 'dead'] as const;
export type FaceName = (typeof FACES)[number];

/** 攻撃していないときの構え。棒を右肩の前に立てて持つ。 */
export const GUARD: MotionSample = { yaw: 0.55, pitch: 0.95, reach: 0.12 };

const DOWN = new THREE.Vector3(0, -1, 0);
const UP = new THREE.Vector3(0, 1, 0);
const q1 = new THREE.Quaternion();
const q2 = new THREE.Quaternion();
const q3 = new THREE.Quaternion();
const v1 = new THREE.Vector3();
const v2 = new THREE.Vector3();

export interface RigPose {
  pos: V3;
  yaw: number;
  sample: MotionSample;
  weaponLen: number;
  /** 走りの強さ 0..1 */
  run: number;
  /** 走りの位相（ラジアン） */
  phase: number;
  /** 空中にいるか */
  air: boolean;
  /** 経過時間（呼吸などの小さな動き用） */
  time: number;
  /** 攻撃の勢い 0..1（体の前傾に使う） */
  swing?: number;
}

export class NorikoRig {
  holder = new THREE.Group();
  weapon = new THREE.Group();
  spec: ArmSpec;
  lastPose?: WeaponPose;
  private n: Record<string, THREE.Object3D> = {};
  private faceMat?: THREE.MeshToonMaterial;
  private face: FaceName = 'neutral';
  private hipsY = 0;
  private tailLag = 0;
  private prevYaw = 0;
  private weaponMesh?: THREE.Mesh;

  constructor(private assets: Assets, parent: THREE.Object3D, public ghost = false) {
    const src = assets.scenes.get('noriko');
    if (!src) throw new Error('noriko model not loaded');
    const model = src.clone(true);
    model.scale.setScalar(MODEL_SCALE);
    this.holder.add(model);
    parent.add(this.holder);
    parent.add(this.weapon);
    const names = ['hips', 'torso', 'head', 'ponytail', 'armR_upper', 'armR_lower', 'handR', 'socket_weapon', 'armL_upper', 'armL_lower', 'handL', 'legR_upper', 'legR_lower', 'footR', 'legL_upper', 'legL_lower', 'footL'];
    for (const nm of names) {
      const o = model.getObjectByName(nm);
      if (!o) throw new Error(`noriko model: node "${nm}" not found`);
      this.n[nm] = o;
    }
    this.hipsY = this.n.hips.position.y;
    model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      if (ghost) {
        m.material = new THREE.MeshBasicMaterial({ color: 0x7fd4ff, transparent: true, opacity: 0.42, depthWrite: false });
        m.castShadow = false;
      } else if ((m.material as THREE.Material).name === 'face') {
        // 表情を個別に切り替えられるよう、顔のマテリアルは複製する
        this.faceMat = (m.material as THREE.MeshToonMaterial).clone();
        this.faceMat.name = 'face';
        m.material = this.faceMat;
      }
    });
    // 腕の寸法をモデルから測る
    this.holder.updateMatrixWorld(true);
    const s = this.n.armR_upper.getWorldPosition(new THREE.Vector3());
    const e = this.n.armR_lower.getWorldPosition(new THREE.Vector3());
    const h = this.n.socket_weapon.getWorldPosition(new THREE.Vector3());
    this.spec = { shoulder: { x: s.x, y: s.y, z: s.z }, upper: s.distanceTo(e), lower: e.distanceTo(h) };
  }

  setWeapon(def: WeaponDef, lengthMul = 1): void {
    if (this.weaponMesh) {
      this.weaponMesh.removeFromParent();
      (this.weaponMesh.material as THREE.Material).dispose();
    }
    const m = this.assets.merged.get(def.model);
    let geo: THREE.BufferGeometry;
    let scaleY = lengthMul;
    if (m && !m.placeholder) {
      geo = m.geo;
      // モデルの握りから先端までを、定義した長さに合わせる
      scaleY = (def.length * lengthMul) / Math.max(0.01, m.max.y);
    } else {
      geo = new THREE.CylinderGeometry(0.035, 0.03, def.length, 6);
      geo.translate(0, def.length / 2, 0);
    }
    const mat = this.ghost
      ? new THREE.MeshBasicMaterial({ color: 0x9fe0ff, transparent: true, opacity: 0.5, depthWrite: false })
      : new THREE.MeshToonMaterial({ vertexColors: !!(m && !m.placeholder), color: m && !m.placeholder ? 0xffffff : 0x8a5a30, gradientMap: this.assets.toonRamp });
    this.weaponMesh = new THREE.Mesh(geo, mat);
    this.weaponMesh.scale.set(1, scaleY, 1);
    this.weaponMesh.castShadow = !this.ghost;
    this.weapon.add(this.weaponMesh);
  }

  setFace(name: FaceName): void {
    if (this.face === name || !this.faceMat) return;
    const t = this.assets.textures.get(`face_${name}.png`);
    if (!t) return;
    this.face = name;
    this.faceMat.map = t;
  }

  setVisible(v: boolean): void {
    this.holder.visible = v;
    this.weapon.visible = v;
  }

  /** 姿勢を反映する。戻り値は武器の位置（当たり判定と同じ計算結果）。 */
  pose(p: RigPose): WeaponPose {
    const n = this.n;
    const turn = bodyTurn(p.sample.yaw);
    const run = p.run;
    const sw = Math.sin(p.phase) * run;
    const swing = p.swing ?? 0;
    this.holder.position.set(p.pos.x, p.pos.y, p.pos.z);
    this.holder.rotation.y = p.yaw + turn.spin;

    const breath = Math.sin(p.time * 2.4) * 0.006;
    n.hips.position.y = this.hipsY + Math.abs(Math.sin(p.phase)) * 0.035 * run + breath - (p.air ? 0 : swing * 0.02);
    n.hips.rotation.x = 0.1 * run + swing * 0.08;
    n.torso.rotation.y = turn.twist;
    n.torso.rotation.x = 0.12 * run + swing * 0.12;
    n.head.rotation.y = -turn.twist * 0.6;
    n.head.rotation.x = -0.1 * run - swing * 0.1;

    if (p.air) {
      n.legR_upper.rotation.x = -0.7;
      n.legL_upper.rotation.x = -0.2;
      n.legR_lower.rotation.x = 1.1;
      n.legL_lower.rotation.x = 0.7;
    } else {
      n.legR_upper.rotation.x = -sw * 0.95;
      n.legL_upper.rotation.x = sw * 0.95;
      n.legR_lower.rotation.x = Math.max(0, Math.sin(p.phase + 1.3)) * 1.25 * run;
      n.legL_lower.rotation.x = Math.max(0, Math.sin(p.phase + 1.3 + Math.PI)) * 1.25 * run;
    }
    // 左腕は脚と逆に振る。攻撃中は後ろへ引いてバランスを取る
    n.armL_upper.rotation.x = -sw * 0.75 + swing * 0.5 + (p.air ? -0.6 : 0);
    n.armL_upper.rotation.z = 0.14 + swing * 0.5;
    n.armL_lower.rotation.x = -(0.25 + 0.55 * run + swing * 0.4);

    // ポニーテール: 走ると後ろへなびき、向きを変えると遅れてついてくる
    let dy = p.yaw - this.prevYaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    this.prevYaw = p.yaw;
    this.tailLag += (THREE.MathUtils.clamp(dy * 6 + turn.twist * 0.5, -0.9, 0.9) - this.tailLag) * 0.18;
    n.ponytail.rotation.x = -0.35 * run - Math.sin(p.phase * 2) * 0.1 * run + Math.sin(p.time * 1.7) * 0.03 - (p.air ? 0.5 : 0);
    n.ponytail.rotation.z = this.tailLag;

    // 右腕: 逆運動学で手を目標位置へ
    this.holder.updateMatrixWorld(true);
    const wp = weaponPose(p.pos, p.yaw, p.sample, this.spec, p.weaponLen);
    const shoulder = n.armR_upper.getWorldPosition(v1);
    const rel = { x: wp.hand.x - shoulder.x, y: wp.hand.y - shoulder.y, z: wp.hand.z - shoulder.z };
    const pole = rotY({ x: -0.55, y: -0.75, z: -0.35 }, p.yaw + turn.spin + turn.twist);
    const ik = solveTwoBone(rel, this.spec.upper, this.spec.lower, pole);
    n.torso.getWorldQuaternion(q1);
    v2.set(ik.elbow.x, ik.elbow.y, ik.elbow.z).normalize();
    q2.setFromUnitVectors(DOWN, v2);
    n.armR_upper.quaternion.copy(q1).invert().multiply(q2);
    v2.set(ik.hand.x - ik.elbow.x, ik.hand.y - ik.elbow.y, ik.hand.z - ik.elbow.z).normalize();
    q3.setFromUnitVectors(DOWN, v2);
    n.armR_lower.quaternion.copy(q2).invert().multiply(q3);

    this.weapon.position.set(shoulder.x + ik.hand.x, shoulder.y + ik.hand.y, shoulder.z + ik.hand.z);
    v2.set(wp.dir.x, wp.dir.y, wp.dir.z);
    this.weapon.quaternion.setFromUnitVectors(UP, v2);
    this.lastPose = wp;
    return wp;
  }

  dispose(): void {
    this.holder.removeFromParent();
    this.weapon.removeFromParent();
    if (this.weaponMesh) (this.weaponMesh.material as THREE.Material).dispose();
    this.faceMat?.dispose();
  }
}

/** 2 つの姿勢の間を補間する。 */
export function lerpSample(a: MotionSample, b: MotionSample, t: number): MotionSample {
  return { yaw: a.yaw + (b.yaw - a.yaw) * t, pitch: a.pitch + (b.pitch - a.pitch) * t, reach: a.reach + (b.reach - a.reach) * t };
}
