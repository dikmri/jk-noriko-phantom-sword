import { describe, expect, test } from 'bun:test';
import { camFloorY, camFollowY, camLiftSearch } from '../src/game/rules';

describe('カメラの高さ', () => {
  test('採石場の底（地面 -14.5m）でも、カメラを海抜 0.35m へ押し上げない', () => {
    // 以前は Math.max(0.35, y) で、底にいるとカメラが 14m 上から見下ろしていた
    expect(camFloorY(-11, -14.5)).toBe(-11);
    // 地面の下には入らない
    expect(camFloorY(-15, -14.5)).toBeCloseTo(-14.1);
    // 平らなステージ（地面 0）
    expect(camFloorY(-1, 0)).toBeCloseTo(0.4);
  });

  test('13m 落ちても、注視点の遅れは 0.8m を超えない', () => {
    let cur = 13 + 1.55;
    let want = cur;
    let vy = 0;
    let worst = 0;
    for (let i = 0; i < 120; i++) {
      const dt = 1 / 60;
      vy -= 22 * dt;
      want = Math.max(1.55, want + vy * dt);
      cur = camFollowY(cur, want, dt);
      worst = Math.max(worst, Math.abs(cur - want));
    }
    expect(worst).toBeLessThanOrEqual(0.8 + 1e-9);
    // 着地のあとは、ほぼ追いついている
    expect(Math.abs(cur - want)).toBeLessThan(0.01);
  });

  test('打ち上げられても、注視点が下に取り残されない', () => {
    let cur = 1.55;
    let want = cur;
    let worst = 0;
    for (let i = 0; i < 30; i++) {
      want += 18 / 60;
      cur = camFollowY(cur, want, 1 / 60);
      worst = Math.max(worst, want - cur);
    }
    expect(worst).toBeLessThanOrEqual(0.8 + 1e-9);
  });

  test('小さな段差では、すぐには追いつかない（画面が細かく揺れない）', () => {
    const y = camFollowY(0, 0.3, 1 / 60);
    expect(y).toBeGreaterThan(0);
    expect(y).toBeLessThan(0.1);
  });
});

describe('カメラの持ち上げ', () => {
  test('後ろが空いていれば、持ち上げない', () => {
    expect(camLiftSearch(0.32, () => Infinity, 6.4)).toEqual({ lift: 0, dist: 6.4 });
  });

  test('後ろが崖でも、上へ持ち上げれば見通せるなら、近づけずに持ち上げる', () => {
    // 角度 0.6 rad 以上で見通せる崖
    const r = camLiftSearch(0.32, (pitch) => (pitch >= 0.6 ? Infinity : 2), 6.4);
    expect(r.lift).toBeCloseTo(0.3);
    expect(r.dist).toBe(6.4);
  });

  test('どこまで持ち上げても見通せなければ、持ち上げずに近づける', () => {
    const r = camLiftSearch(0.32, () => 3, 6.4);
    expect(r.lift).toBe(0);
    expect(r.dist).toBeCloseTo(2.7);
  });

  test('近づけるときも、1.3m より近くはしない', () => {
    expect(camLiftSearch(0.32, () => 0.5, 6.4).dist).toBe(1.3);
  });

  test('見上げているとき（角度が大きいとき）は、上限を超えて持ち上げない', () => {
    const r = camLiftSearch(1.1, (pitch) => (pitch > 1.2 ? Infinity : 2), 6.4);
    expect(r.lift).toBe(0);
  });
});
