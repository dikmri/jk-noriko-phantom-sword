import { describe, expect, test } from 'bun:test';
import { ITEM_MAP, ITEMS, SKILL_MAP } from '../src/game/defs';
import { angleSwept, choiceCount, computeStats, farShotMul, fortifyCut, miyageDmg, sunglassMul } from '../src/game/rules';

const SHOP0 = { hp: 0, power: 0, speed: 0, xp: 0, reroll: 0, magnet: 0, revive: 0 };

describe('第 3 弾の強化', () => {
  test('韋駄天: ダッシュの回数が 1 レベルごとに +1、速さ +10%', () => {
    expect(computeStats([], SHOP0).dashCharges).toBe(1);
    const s1 = computeStats([{ id: 'idaten', level: 1 }], SHOP0);
    expect(s1.dashCharges).toBe(2);
    expect(s1.dashSpeed).toBeCloseTo(1.1);
    expect(computeStats([{ id: 'idaten', level: 2 }], SHOP0).dashCharges).toBe(3);
  });
  test('早寝早起き: 経験値の玉 1 つで 0.3 × レベル 回復', () => {
    expect(computeStats([{ id: 'hayaoki', level: 2 }], SHOP0).xpHeal).toBeCloseTo(0.6);
  });
  test('絶好調: HP が多いときのダメージ +8% × レベル', () => {
    expect(computeStats([{ id: 'zekkouchou', level: 3 }], SHOP0).fullHp).toBeCloseTo(0.24);
    expect(computeStats([], SHOP0).fullHp).toBe(0);
  });
  test('新しい攻撃スキル 12 個は、進化先がどれも強化', () => {
    for (const id of ['nawatobi', 'rentai', 'jintai', 'senbazuru', 'cracker', 'straw', 'miyage', 'nezumi', 'kora', 'reizouko', 'sentakuki', 'dunk']) {
      expect(SKILL_MAP[id]?.kind).toBe('active');
      expect(SKILL_MAP[SKILL_MAP[id].evo!.with].kind).toBe('passive');
    }
  });
});

describe('第 3 弾のアイテム', () => {
  test('アイテムは 90 個以上あり、id は重ならない', () => {
    expect(ITEMS.length).toBeGreaterThanOrEqual(90);
    expect(new Set(ITEMS.map((i) => i.id)).size).toBe(ITEMS.length);
  });
  test('幸運のサイコロ: 運 +25%。★3 なら 50% で、選択肢が 1 枚増える', () => {
    expect(computeStats([], SHOP0, ['dice']).luck).toBeCloseTo(0.25);
    const s3 = computeStats([], SHOP0, ['dice'], { dice: 3 });
    expect(s3.luck).toBeCloseTo(0.5);
    expect(choiceCount(['dice'], s3.luck)).toBe(4);
  });
  test('勝負かつ丼: 最大 HP +200、短所の移動速度 -5% は★で増えない', () => {
    const s = computeStats([], SHOP0, ['katsudon'], { katsudon: 3 });
    expect(s.maxHp - computeStats([], SHOP0).maxHp).toBeCloseTo(400);
    expect(s.moveSpeed).toBeCloseTo(0.95);
    expect(ITEM_MAP.katsudon.cost?.moveSpeed).toBe(-0.05);
  });
  test('双眼鏡: 20m 飛ぶと +40%、それより先は増えない。★で伸びる', () => {
    expect(farShotMul(0, 1)).toBe(1);
    expect(farShotMul(10, 1)).toBeCloseTo(1.2);
    expect(farShotMul(20, 1)).toBeCloseTo(1.4);
    expect(farShotMul(60, 1)).toBeCloseTo(1.4);
    expect(farShotMul(20, 2)).toBeCloseTo(1.8);
  });
  test('サングラス: 最大 HP が多いほど強く（+20% まで）、ボスはさらに +10%', () => {
    expect(sunglassMul(50, false)).toBeCloseTo(1.01);
    expect(sunglassMul(1000, false)).toBeCloseTo(1.2);
    expect(sunglassMul(5000, false)).toBeCloseTo(1.2);
    expect(sunglassMul(1000, true)).toBeCloseTo(1.3);
  });
  test('応援団の旗: 1 つで -1%、20 で頭打ち。★の伸びは 2.5 倍（★4）まで', () => {
    expect(fortifyCut(0, 1)).toBe(1);
    expect(fortifyCut(10, 1)).toBeCloseTo(0.9);
    expect(fortifyCut(30, 1)).toBeCloseTo(0.8);
    expect(fortifyCut(20, 2)).toBeCloseTo(0.6);
    expect(fortifyCut(20, 3)).toBeCloseTo(0.5);
  });
});

describe('第 3 弾の攻撃スキルの計算', () => {
  test('大縄跳び: 縄が a0 から a1 へ回る間に、その角度の敵を通ったか（一周をまたいでも判定できる）', () => {
    expect(angleSwept(0, 0.5, 0.2)).toBe(true);
    expect(angleSwept(0, 0.5, 0.7)).toBe(false);
    // 3.0 → 3.4 は π（≒3.14）をまたぐ。-3.0 は 3.28 と同じ向き
    expect(angleSwept(3.0, 3.4, -3.0)).toBe(true);
    // 逆回り
    expect(angleSwept(0.5, 0, 0.2)).toBe(true);
    expect(angleSwept(0.5, 0, -0.2)).toBe(false);
  });
  test('置き土産: レベルと、倒れた敵の最大 HP の 6%（200 まで）で決まる', () => {
    expect(miyageDmg(1, 0)).toBe(17);
    expect(miyageDmg(3, 1000)).toBeCloseTo(27 + 60);
    expect(miyageDmg(5, 100000)).toBeCloseTo(37 + 200);
  });
});
