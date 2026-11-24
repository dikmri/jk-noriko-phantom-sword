import { describe, expect, test } from 'bun:test';
import { EDGES, GEYSERS, onsenHeight, POOLS, ST_Z0, ST_Z1, STAIR_L, STAIRS_X, STEP_H, streetH, streetZAt, TOP_H } from '../src/game/stage/onsen_shape';

/** (x, z) から z 方向へ 0.5m 進んだときの傾き。 */
function slopeZ(x: number, z: number): number {
  return Math.abs(onsenHeight(x, z + 0.25) - onsenHeight(x, z - 0.25)) / 0.5;
}

describe('温泉街の地形', () => {
  test('段は南から北へ STEP_H ずつ上がり、いちばん上は TOP_H', () => {
    // 大通りと石段から離れた所で、各段の真ん中の高さを見る
    const x = 12;
    const mids = [-50, -18.5, 3, 24.5, 50];
    mids.forEach((z, k) => expect(onsenHeight(x, z)).toBeCloseTo(k * STEP_H, 1));
    expect(onsenHeight(x, 50)).toBeCloseTo(TOP_H, 1);
  });

  test('段の境目（大通り・石段以外）は、敵が歩いて登れない急な崖', () => {
    for (const e of EDGES) expect(slopeZ(20, e)).toBeGreaterThan(1.5);
  });

  test('大通りは、どこでも敵が登れる緩い坂（傾き 0.25 未満）', () => {
    for (let z = ST_Z0 - 4; z <= ST_Z1 + 4; z += 0.5) expect(slopeZ(0, z)).toBeLessThan(0.25);
  });

  test('石段も、敵が登れる緩い坂（傾き 0.3 未満）で、下の段から上の段へつながる', () => {
    for (const sx of STAIRS_X) {
      EDGES.forEach((e, i) => {
        for (let z = e - STAIR_L - 1; z <= e + STAIR_L + 1; z += 0.5) expect(slopeZ(sx, z)).toBeLessThan(0.3);
        expect(onsenHeight(sx, e - STAIR_L - 1)).toBeCloseTo(i * STEP_H, 1);
        expect(onsenHeight(sx, e + STAIR_L + 1)).toBeCloseTo((i + 1) * STEP_H, 1);
      });
    }
  });

  test('streetZAt は streetH の逆（大通りで、その高さになる z）', () => {
    for (const h of [0, 3, 8, 12.5, TOP_H]) expect(streetH(streetZAt(h))).toBeCloseTo(h, 5);
  });

  test('露天風呂と間欠泉は、段の平らな所にある（崖や石段にかからない）', () => {
    for (const p of [...POOLS, ...GEYSERS]) {
      for (const e of EDGES) expect(Math.abs(p.z - e)).toBeGreaterThan(('rz' in p ? p.rz : p.r) + 1.5);
      const rx = 'rx' in p ? p.rx : p.r;
      const rz = 'rz' in p ? p.rz : p.r;
      // 石段の坂（z の範囲）と重なる所では、石段から x で離れている
      for (const sx of STAIRS_X) for (const e of EDGES) {
        const overlap = p.z + rz > e - STAIR_L - 1 && p.z - rz < e + STAIR_L + 1;
        if (overlap) expect(Math.abs(p.x - sx)).toBeGreaterThan(rx + 4.6);
      }
    }
  });
});
