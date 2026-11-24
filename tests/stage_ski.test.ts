import { describe, expect, test } from 'bun:test';
import { inRamp, inRampLip, pisteCenter, rampTop, SKI, skiHeight, slopeBase } from '../src/game/stage/ski_shape';

describe('雪山のスキー場の地形', () => {
  test('ふもとは平らで 0m 付近、頂上は 24m 付近', () => {
    for (const x of [-30, 0, 20]) {
      expect(Math.abs(skiHeight(x, -60))).toBeLessThan(0.5);
      expect(Math.abs(skiHeight(x, 60) - SKI.topH)).toBeLessThan(0.6);
    }
  });

  test('ゲレンデは南から北へ上り続ける', () => {
    let prev = -1;
    for (let z = SKI.baseZ; z <= SKI.topZ; z += 2) {
      const h = slopeBase(z);
      expect(h).toBeGreaterThanOrEqual(prev);
      prev = h;
    }
  });

  test('整備されたコースの上は、敵が歩いて登れる傾き（0.45 未満）', () => {
    let max = 0;
    for (let z = SKI.baseZ - 10; z <= SKI.topZ + 10; z += 0.5) {
      const x = pisteCenter(z);
      const s = Math.abs(skiHeight(x, z + 0.25) - skiHeight(x, z - 0.25)) / 0.5;
      max = Math.max(max, s);
    }
    expect(max).toBeLessThan(0.45);
  });

  test('両脇は尾根で高くなる', () => {
    expect(skiHeight(70, -60)).toBeGreaterThan(skiHeight(0, -60) + 6);
    expect(skiHeight(-70, 0)).toBeGreaterThan(skiHeight(0, 0) + 6);
  });

  test('ジャンプ台の先端は地面より高く、北の端は地面と同じ高さ', () => {
    const r = SKI.ramp;
    const zs = r.z + r.len / 2;
    const ze = r.z - r.len / 2;
    expect(Math.abs(rampTop(zs) - skiHeight(r.x, zs))).toBeLessThan(0.01);
    expect(rampTop(ze) - skiHeight(r.x, ze)).toBeCloseTo(r.h, 5);
    // 台の上面は、途中で地面より下に潜らない
    for (let z = ze; z <= zs; z += 0.5) expect(rampTop(z)).toBeGreaterThanOrEqual(skiHeight(r.x, z) - 0.05);
  });

  test('ジャンプ台の先端の判定', () => {
    const r = SKI.ramp;
    const ze = r.z - r.len / 2;
    expect(inRampLip(r.x, ze + 1)).toBe(true);
    expect(inRampLip(r.x, r.z + r.len / 2)).toBe(false);
    expect(inRampLip(r.x + r.w, ze + 1)).toBe(false);
    expect(inRamp(r.x, r.z)).toBe(true);
    expect(inRamp(0, -56)).toBe(false);
  });
});
