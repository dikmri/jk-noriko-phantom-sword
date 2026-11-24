import { describe, expect, test } from 'bun:test';
import { DEG, len, segSegDist, sub, v3 } from '../src/core/vec';
import { bodyTurn, handDistance, solveTwoBone, weaponPose, ArmSpec, ARM_YAW_MAX } from '../src/motion/arm';
import { dirFromAngles, easeProgress, isValidMotion, motionArc, PRESET_MOTIONS, retimeByArc, sampleMotion, swingTiming } from '../src/motion/motion';
import { buildKeys, MAX_INK, MAX_KEYS, pathLength, RawPoint, simplify } from '../src/motion/path';

const ARM: ArmSpec = { shoulder: v3(-0.13, 0.91, 0), upper: 0.17, lower: 0.19 };
const near = (a: number, b: number, eps = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(eps);

describe('モーションの方向', () => {
  test('yaw=0, pitch=0 は正面(+Z)', () => {
    const d = dirFromAngles(0, 0);
    near(d.x, 0);
    near(d.y, 0);
    near(d.z, 1);
  });
  test('yaw が正なら右(-X)、pitch が正なら上(+Y)', () => {
    expect(dirFromAngles(90 * DEG, 0).x).toBeLessThan(-0.99);
    expect(dirFromAngles(0, 90 * DEG).y).toBeGreaterThan(0.99);
  });
});

describe('モーションの補間', () => {
  test('始点と終点は最初と最後のキーに一致する', () => {
    for (const m of PRESET_MOTIONS) {
      const a = sampleMotion(m, 0);
      const b = sampleMotion(m, 1);
      near(a.yaw, m.keys[0].yaw);
      near(b.pitch, m.keys[m.keys.length - 1].pitch);
      near(b.reach, m.keys[m.keys.length - 1].reach);
    }
  });
  test('プリセットはすべてモーションとして妥当', () => {
    for (const m of PRESET_MOTIONS) expect(isValidMotion(m)).toBe(true);
    expect(isValidMotion({ id: 'x', name: 'x', ease: 0, keys: [] })).toBe(false);
  });
  test('タメを強くしても始点・終点は変わらず、途中は遅れる', () => {
    near(easeProgress(0, 1), 0);
    near(easeProgress(1, 1), 1);
    expect(easeProgress(0.5, 1)).toBeLessThan(easeProgress(0.5, 0));
  });
  test('横薙ぎの移動量はおよそ 165 度ぶん', () => {
    const yoko = PRESET_MOTIONS.find((m) => m.id === 'yoko')!;
    const arc = motionArc(yoko.keys);
    expect(arc).toBeGreaterThan(150 * DEG);
    expect(arc).toBeLessThan(185 * DEG);
  });
  test('回転斬りは一周ぶんの移動量になる', () => {
    const k = PRESET_MOTIONS.find((m) => m.id === 'kaiten')!;
    expect(motionArc(k.keys)).toBeGreaterThan(330 * DEG);
  });
  test('移動量が大きいモーションほど時間がかかり、上下限で止まる', () => {
    const yoko = PRESET_MOTIONS.find((m) => m.id === 'yoko')!;
    const kaiten = PRESET_MOTIONS.find((m) => m.id === 'kaiten')!;
    expect(swingTiming(kaiten, 14).duration).toBeGreaterThan(swingTiming(yoko, 14).duration);
    expect(swingTiming(yoko, 10000).duration).toBe(0.1);
    expect(swingTiming(kaiten, 0.5).duration).toBe(2.4);
  });
  test('retimeByArc は t を 0 から 1 へ単調に並べる', () => {
    const keys = retimeByArc([
      { yaw: 1, pitch: 0, reach: 1 },
      { yaw: 0, pitch: 0, reach: 1 },
      { yaw: -0.2, pitch: 0, reach: 1 },
    ]);
    expect(keys[0].t).toBe(0);
    near(keys[2].t, 1);
    expect(keys[1].t).toBeGreaterThan(0.7);
  });
});

describe('腕の逆運動学', () => {
  test('届く距離なら手は目標に一致し、骨の長さが保たれる', () => {
    const target = v3(0.1, -0.05, 0.25);
    const r = solveTwoBone(target, 0.17, 0.19, v3(-0.5, -0.8, -0.3));
    near(len(sub(r.hand, target)), 0, 1e-6);
    near(len(r.elbow), 0.17, 1e-6);
    near(len(sub(r.hand, r.elbow)), 0.19, 1e-6);
  });
  test('届かない距離なら伸ばしきった位置で止まる', () => {
    const r = solveTwoBone(v3(0, 0, 5), 0.17, 0.19, v3(0, -1, 0));
    expect(len(r.hand)).toBeLessThan(0.36);
    expect(len(r.hand)).toBeGreaterThan(0.35);
  });
  test('reach が大きいほど手が遠くなる', () => {
    expect(handDistance(1, ARM)).toBeGreaterThan(handDistance(0, ARM) * 2);
  });
});

describe('武器の姿勢', () => {
  test('正面への突きは、キャラの向いた方向へ先端が伸びる', () => {
    const p = weaponPose(v3(10, 0, 5), 90 * DEG, { yaw: 0, pitch: 0, reach: 1 }, ARM, 1.0);
    // rotation.y = 90度 なら正面は +X
    expect(p.tip.x - p.hand.x).toBeGreaterThan(0.99);
    near(p.tip.z - p.hand.z, 0, 1e-6);
    near(len(sub(p.tip, p.hand)), 1.0, 1e-6);
  });
  test('腕の可動域を超えた yaw は体の回転が受け持つ', () => {
    near(bodyTurn(1.0).spin, 0);
    near(bodyTurn(Math.PI).spin, -(Math.PI - ARM_YAW_MAX));
  });
});

describe('線分どうしの距離', () => {
  test('交差する線分は 0、平行な線分は間隔に一致', () => {
    near(segSegDist(v3(-1, 0, 0), v3(1, 0, 0), v3(0, -1, 0), v3(0, 1, 0)), 0);
    near(segSegDist(v3(0, 0, 0), v3(1, 0, 0), v3(0, 0, 2), v3(1, 0, 2)), 2);
  });
  test('端点どうしが最短になる場合', () => {
    near(segSegDist(v3(0, 0, 0), v3(1, 0, 0), v3(2, 0, 0), v3(3, 0, 0)), 1);
  });
});

describe('描いた軌跡からのモーション生成', () => {
  const line = (n: number): RawPoint[] => Array.from({ length: n }, (_, i) => ({ yaw: 1 - (2 * i) / (n - 1), pitch: 0, reach: 1, stroke: 0 }));
  test('一直線の点は始点と終点だけに間引かれる', () => {
    expect(simplify(line(50), 0.02).length).toBe(2);
  });
  test('折れ曲がった点は残る', () => {
    const pts: RawPoint[] = [
      { yaw: 1, pitch: 0, reach: 1, stroke: 0 },
      { yaw: 0, pitch: 0, reach: 1, stroke: 0 },
      { yaw: 0, pitch: 1, reach: 1, stroke: 0 },
    ];
    expect(simplify(pts, 0.02).length).toBe(3);
  });
  test('キーは 0 から 1 へ単調に並び、上限数を超えない', () => {
    const pts: RawPoint[] = Array.from({ length: 600 }, (_, i) => ({ yaw: Math.sin(i * 0.3) * 1.2, pitch: Math.cos(i * 0.17) * 0.8, reach: 1, stroke: 0 }));
    const keys = buildKeys(pts)!;
    expect(keys.length).toBeLessThanOrEqual(MAX_KEYS);
    expect(keys[0].t).toBe(0);
    near(keys[keys.length - 1].t, 1);
    for (let i = 1; i < keys.length; i++) expect(keys[i].t).toBeGreaterThanOrEqual(keys[i - 1].t);
  });
  test('インクの上限を超えた分は切り捨てられる', () => {
    const pts: RawPoint[] = Array.from({ length: 400 }, (_, i) => ({ yaw: (i % 2 ? 1 : -1) * 1.5, pitch: 0, reach: 1, stroke: 0 }));
    const keys = buildKeys(pts)!;
    expect(pathLength(keys)).toBeLessThanOrEqual(MAX_INK + 1e-6);
  });
  test('点が足りない、またはほとんど動いていない入力は null', () => {
    expect(buildKeys([])).toBeNull();
    expect(buildKeys([{ yaw: 0, pitch: 0, reach: 1, stroke: 0 }])).toBeNull();
    expect(buildKeys([{ yaw: 0, pitch: 0, reach: 1, stroke: 0 }, { yaw: 0.001, pitch: 0, reach: 1, stroke: 0 }])).toBeNull();
  });
});
