import { describe, expect, test } from 'bun:test';
import { benchRange, DEPTH, HEAP, nearRoad, PC, RAMP, pitDist, pitDepth, polar, quarryHeight, R_BOT, R_RIM, ringDir, roadPoints, ROAD_W, STEP } from '../src/game/stage/quarry_shape';

const pts = roadPoints();

describe('採石場の地形', () => {
  test('穴の縁の外は高さ 0、底は -16m', () => {
    expect(pitDepth(R_RIM + 1)).toBe(0);
    expect(pitDepth(0)).toBe(DEPTH);
    expect(pitDepth(R_BOT - 1)).toBe(DEPTH);
  });

  test('段の平らな所は、段の高さちょうどで 4m 以上の幅がある', () => {
    for (let k = 1; k < 4; k++) {
      const [inner, outer] = benchRange(k);
      expect(outer - inner).toBeGreaterThan(4);
      const mid = (inner + outer) / 2;
      expect(pitDepth(mid)).toBeCloseTo(STEP * k, 5);
    }
  });

  test('段の境目は急な崖（水平 2m 未満で 4m 下がる）', () => {
    const [inner1] = benchRange(1);
    const [, outer2] = benchRange(2);
    expect(inner1 - outer2).toBeLessThan(2.1);
    expect(pitDepth(outer2) - pitDepth(inner1)).toBeCloseTo(STEP, 5);
  });

  test('運搬路は縁（0m）から底（-16m）まで、ゆるい坂で続く', () => {
    expect(pts[0].h).toBeCloseTo(0, 6);
    expect(pts[pts.length - 1].h).toBe(-DEPTH);
    let maxSlope = 0;
    for (let i = 1; i < pts.length; i++) {
      const run = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
      maxSlope = Math.max(maxSlope, Math.abs(pts[i].h - pts[i - 1].h) / run);
    }
    expect(maxSlope).toBeLessThan(0.2);
    // 道の上の地面の高さは道の高さ
    for (const i of [10, 60, 120, 165]) {
      const p = pts[i];
      expect(quarryHeight(p.x, p.z, pts)).toBeCloseTo(p.h + 0.15, 1);
    }
  });

  test('運搬路の上を歩くと、どこでも傾きは 50 度未満', () => {
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const ha = quarryHeight(a.x, a.z, pts);
      const hb = quarryHeight(b.x, b.z, pts);
      const run = Math.hypot(b.x - a.x, b.z - a.z);
      expect(Math.abs(hb - ha) / run).toBeLessThan(Math.tan((50 * Math.PI) / 180));
    }
  });

  test('地面の高さ: 穴の底は -16m、段は -4m ごと、穴の外は 0m 付近', () => {
    expect(quarryHeight(PC.x, PC.z, pts)).toBeCloseTo(-DEPTH, 1);
    for (let k = 1; k < 4; k++) {
      const [inner, outer] = benchRange(k);
      // 道から離れた角度で測る
      let best = 0;
      for (let a = 0; a < Math.PI * 2; a += 0.3) {
        const p = polar(a, (inner + outer) / 2);
        if (nearRoad(pts, p.x, p.z).d > ROAD_W + 5) best = quarryHeight(p.x, p.z, pts);
      }
      expect(best).toBeCloseTo(-STEP * k, 1);
    }
    expect(Math.abs(quarryHeight(PC.x, PC.z - R_RIM - 6, pts))).toBeLessThan(0.7);
  });

  test('ボタ山の頂上は 8m', () => {
    expect(quarryHeight(HEAP.x, HEAP.z, pts)).toBeCloseTo(HEAP.h, 0);
  });

  test('ボタ山の南の登り坂は、登り口 0m から頂上 8m まで、敵が登れるゆるさ（傾き 0.35 未満）', () => {
    expect(quarryHeight(RAMP.x, RAMP.z0 - 1, pts)).toBeLessThan(0.6);
    let max = 0;
    for (let z = RAMP.z0; z < RAMP.z1; z += 0.5) {
      max = Math.max(max, Math.abs(quarryHeight(RAMP.x, z + 0.5, pts) - quarryHeight(RAMP.x, z, pts)) / 0.5);
    }
    expect(max).toBeLessThan(0.35);
    expect(quarryHeight(RAMP.x, RAMP.z1, pts)).toBeCloseTo(HEAP.h, 0);
  });

  test('polar で置いた点は、ゆがめた距離が指定どおり', () => {
    for (const a of [0, 1, 2.5, -2]) {
      const p = polar(a, 20);
      expect(pitDist(p.x, p.z)).toBeCloseTo(20, 5);
    }
  });

  test('道から離れた点の nearRoad の距離は道幅より大きい', () => {
    const far = polar(0.3, 50);
    expect(nearRoad(pts, far.x, far.z).d).toBeGreaterThan(ROAD_W);
  });

  test('回り込む向きは、プレイヤーの角度へ近い方へ回る', () => {
    // 敵は穴の東、プレイヤーは北（角度 +π/2）。反時計回り（+z へ向かう成分）になる
    const [, vz] = ringDir(6 + 30, 8, 6, 8 + 30, 30);
    expect(vz).toBeGreaterThan(0.8);
    // 敵は東、プレイヤーは南。-z へ向かう
    const [, vz2] = ringDir(6 + 30, 8, 6, 8 - 30, 30);
    expect(vz2).toBeLessThan(-0.8);
  });
});
