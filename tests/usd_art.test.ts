import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { ART } from '../src/game/usd/catalog';
import { findJoints, isWheel, linkMatrices, makePose, restOf, stepPose, wheelRadius, type ArtDef } from '../src/game/usd/art';

const mats = (def: ArtDef) => def.links.map(() => new THREE.Matrix4());
const apply = (m: THREE.Matrix4, p: [number, number, number]) => new THREE.Vector3(...p).applyMatrix4(m);

describe('USDCraft の目録', () => {
  test('どの物体も、根が先頭で、親は子より前にある', () => {
    for (const [key, def] of Object.entries(ART)) {
      expect(def.links[0].p, key).toBe(-1);
      def.links.forEach((l, i) => {
        if (i > 0) {
          expect(l.p, `${key}.${l.n}`).toBeGreaterThanOrEqual(0);
          expect(l.p, `${key}.${l.n}`).toBeLessThan(i);
        }
        for (let k = 0; k < 3; k++) expect(l.max[k], `${key}.${l.n}`).toBeGreaterThanOrEqual(l.min[k]);
        expect(l.m, `${key}.${l.n}`).toBeGreaterThan(0);
      });
      for (const j of def.joints) {
        expect(def.links[j.c].p, `${key}.${j.n}`).toBe(j.p);
        expect(Math.hypot(...j.x), `${key}.${j.n}`).toBeCloseTo(1, 2);
        expect(j.hi, `${key}.${j.n}`).toBeGreaterThanOrEqual(j.lo);
      }
      expect(def.mass, key).toBeGreaterThan(0);
    }
  });

  test('GLB のノード名が、目録の部品の名前と一致する（ゲームは名前で部品を探す）', () => {
    for (const key of Object.keys(ART)) {
      const buf = readFileSync(`public/models/usd/${key}.glb`);
      const len = buf.readUInt32LE(12);
      const js = JSON.parse(buf.subarray(20, 20 + len).toString('utf8')) as { nodes: { name?: string }[] };
      const names = new Set(js.nodes.map((n) => n.name));
      for (const l of ART[key].links) expect(names.has(l.n), `${key}.${l.n}`).toBe(true);
    }
  });

  test('親のスキルが使う物体がそろっている', () => {
    for (const k of ['piano', 'cart', 'forklift', 'locker', 'merrygo', 'gascyl', 'signal', 'seesaw', 'robovac', 'drone', 'drums', 'dumbbell', 'vending']) {
      expect(ART[k], k).toBeDefined();
    }
  });
});

describe('関節の姿勢', () => {
  test('静止の姿勢では、どの部品も動かない', () => {
    for (const def of Object.values(ART)) {
      const pose = makePose(def);
      const out = mats(def);
      linkMatrices(def, pose, out);
      for (const m of out) expect(m.equals(new THREE.Matrix4())).toBe(true);
    }
  });

  test('ロッカーの扉を開くと、扉の先は前（+Z）へ出て、ちょうつがいは動かない', () => {
    const def = ART.locker;
    const j = findJoints(def, 'door_left')[0];
    const jt = def.joints[j];
    const pose = makePose(def);
    pose.q[j] = Math.PI / 2;
    const out = mats(def);
    linkMatrices(def, pose, out);
    const m = out[jt.c];
    const hinge = apply(m, [jt.a[0], 1, jt.a[2]]);
    expect(hinge.x).toBeCloseTo(jt.a[0], 4);
    expect(hinge.z).toBeCloseTo(jt.a[2], 4);
    const l = def.links[jt.c];
    const edge = apply(m, [l.max[0], 1, l.max[2]]);
    expect(edge.z).toBeGreaterThan(jt.a[2] + 0.2);
  });

  test('固定された部品は親といっしょに回る（回転遊具の床）', () => {
    const def = ART.merrygo;
    const j = def.joints[0];
    const deck = def.links.findIndex((l, i) => i !== j.c && l.p === j.c);
    expect(deck).toBeGreaterThan(0);
    const pose = makePose(def);
    pose.q[0] = 1.2;
    const out = mats(def);
    linkMatrices(def, pose, out);
    expect(out[deck].equals(out[j.c])).toBe(true);
    expect(out[j.c].equals(new THREE.Matrix4())).toBe(false);
  });

  test('つながった関節: カートの前輪の向きを変えると、車輪もいっしょに回り込む', () => {
    const def = ART.cart;
    const sw = findJoints(def, 'swivel_front_left')[0];
    const sp = findJoints(def, 'spin_front_left')[0];
    const wheel = def.joints[sp].c;
    const pose = makePose(def);
    pose.q[sw] = Math.PI;
    const out = mats(def);
    linkMatrices(def, pose, out);
    const a = def.joints[sw].a;
    const wa = def.joints[sp].a;
    const p = apply(out[wheel], wa as [number, number, number]);
    // 縦の軸まわりに半回転すると、軸から見て反対側へ移る
    expect(p.x).toBeCloseTo(2 * a[0] - wa[0], 3);
    expect(p.z).toBeCloseTo(2 * a[2] - wa[2], 3);
  });

  test('はじいた扉は範囲の中で揺れて、閉じた位置へ戻る', () => {
    const def = ART.locker;
    const pose = makePose(def);
    pose.v[0] = 6;
    let maxQ = 0;
    for (let i = 0; i < 400; i++) {
      stepPose(def, pose, 1 / 60);
      const j = def.joints[0];
      expect(pose.q[0]).toBeGreaterThanOrEqual(j.lo - 1e-6);
      expect(pose.q[0]).toBeLessThanOrEqual(j.hi + 1e-6);
      maxQ = Math.max(maxQ, pose.q[0]);
    }
    expect(maxQ).toBeGreaterThan(0.5);
    expect(Math.abs(pose.q[0] - restOf(def.joints[0]))).toBeLessThan(0.05);
  });

  test('目標を与えた関節はそこへ近づく（フォークリフトのフォーク）', () => {
    const def = ART.forklift;
    const j = findJoints(def, 'fork')[0];
    expect(def.joints[j].t).toBe('prismatic');
    const pose = makePose(def);
    pose.target[j] = 1.0;
    for (let i = 0; i < 180; i++) stepPose(def, pose, 1 / 60);
    expect(pose.q[j]).toBeGreaterThan(0.85);
    expect(pose.q[j]).toBeLessThanOrEqual(def.joints[j].hi + 1e-6);
  });

  test('回し続ける関節は少しずつ止まる（回転遊具）', () => {
    const def = ART.merrygo;
    const pose = makePose(def);
    pose.v[0] = 5;
    for (let i = 0; i < 60; i++) stepPose(def, pose, 1 / 60);
    expect(pose.v[0]).toBeLessThan(5);
    expect(pose.v[0]).toBeGreaterThan(2);
  });

  test('車輪を見分け、半径を部品の大きさから求める', () => {
    const def = ART.forklift;
    const w = findJoints(def, 'front_left')[0];
    expect(isWheel(def, w)).toBe(true);
    const r = wheelRadius(def, w);
    expect(r).toBeGreaterThan(0.1);
    expect(r).toBeLessThan(0.4);
    const lift = findJoints(def, 'fork')[0];
    expect(isWheel(def, lift)).toBe(false);
  });
});
