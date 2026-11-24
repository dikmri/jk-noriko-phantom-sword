import { describe, expect, test } from 'bun:test';
import { ITEM_MAP, ITEMS, SKILL_MAP, SKILLS } from '../src/game/defs';
import { choiceCount, computeStats, nisshiCut, omikujiDraw, planeScale, planeStun, trophyMul } from '../src/game/rules';

const SHOP0 = { hp: 0, power: 0, speed: 0, xp: 0, reroll: 0, magnet: 0, revive: 0 };

describe('第 2 弾の強化', () => {
  test('ソフトボール部の肩: 飛び道具の速さ +12%、吹き飛ばし +15%（1 レベルごと）', () => {
    const s = computeStats([{ id: 'kata', level: 2 }], SHOP0);
    expect(s.projSpeed).toBeCloseTo(1.24);
    expect(s.projKnock).toBeCloseTo(1.3);
  });
  test('番狂わせ: エリートとボスへのダメージ +10%', () => {
    expect(computeStats([{ id: 'bankuruwase', level: 3 }], SHOP0).bigMul).toBeCloseTo(1.3);
    expect(computeStats([], SHOP0).bigMul).toBe(1);
  });
  test('ノリノリ: 1 回あたりの上がり幅は 2% × レベル。持っていなければ 0', () => {
    expect(computeStats([{ id: 'norinori', level: 4 }], SHOP0).momentum).toBeCloseTo(0.08);
    expect(computeStats([], SHOP0).momentum).toBe(0);
  });
  test('八つ当たり: 1 レベルで 40%、レベルごとに +10%', () => {
    expect(computeStats([{ id: 'yatsuatari', level: 1 }], SHOP0).overkill).toBeCloseTo(0.4);
    expect(computeStats([{ id: 'yatsuatari', level: 5 }], SHOP0).overkill).toBeCloseTo(0.8);
    expect(computeStats([], SHOP0).overkill).toBe(0);
  });
  test('新しい攻撃スキルの進化先は、どれも強化（パッシブ）', () => {
    for (const id of ['yuutai', 'hikouki', 'nukiuchi', 'shimei', 'omikuji', 'purinto', 'asagao', 'kasa', 'bikkuri']) {
      const evo = SKILL_MAP[id].evo;
      expect(evo).toBeDefined();
      expect(SKILL_MAP[evo!.with].kind).toBe('passive');
    }
  });
  test('スキルの id は重ならない', () => {
    expect(new Set(SKILLS.map((s) => s.id)).size).toBe(SKILLS.length);
  });
});

describe('第 2 弾のアイテム', () => {
  test('月見団子: 振る速さ +20%、★3 で +40%', () => {
    expect(computeStats([], SHOP0, ['tsukimi']).attackSpeed).toBeCloseTo(1.2);
    expect(computeStats([], SHOP0, ['tsukimi'], { tsukimi: 3 }).attackSpeed).toBeCloseTo(1.4);
  });
  test('絆創膏: HP が毎秒 0.5 回復（足し算）', () => {
    expect(computeStats([], SHOP0, ['bansoko']).regen).toBeCloseTo(0.5);
  });
  test('アイテムは 75 個以上あり、id は重ならない', () => {
    expect(ITEMS.length).toBeGreaterThanOrEqual(75);
    expect(new Set(ITEMS.map((i) => i.id)).size).toBe(ITEMS.length);
    expect(ITEM_MAP.aikagi.star).toBe(false);
  });
  test('職員室の合鍵: 選択肢が 4 枚になる', () => {
    expect(choiceCount([])).toBe(3);
    expect(choiceCount(['aikagi', 'darts'])).toBe(4);
  });
  test('運 0.45 以上でさらに 1 枚。幸運のお守り Lv3（0.15 × 3 = 0.4499…）でも増える', () => {
    expect(choiceCount([], 0.15 * 3)).toBe(4);
    expect(choiceCount([], 0.3)).toBe(3);
    expect(choiceCount(['aikagi'], 0.6)).toBe(5);
  });
  test('優勝トロフィー: 1 つにつき +2%、25 で頭打ち', () => {
    expect(trophyMul(0)).toBe(1);
    expect(trophyMul(10)).toBeCloseTo(1.2);
    expect(trophyMul(40)).toBeCloseTo(1.5);
  });
  test('学級日誌: 最大 HP の 10% を超えた分だけ 50% 減る（★で減る割合が増え、80% で頭打ち）', () => {
    expect(nisshiCut(8, 100, 1)).toBe(8);
    expect(nisshiCut(30, 100, 1)).toBeCloseTo(20);
    expect(nisshiCut(30, 100, 2)).toBeCloseTo(10 + 20 * 0.2);
  });
});

describe('第 2 弾の攻撃スキルの計算', () => {
  test('紙飛行機: 長く飛ぶほど強い（0m で 1 倍、24m で 3 倍、それより先も 3 倍）', () => {
    expect(planeScale(0)).toBe(1);
    expect(planeScale(12)).toBeCloseTo(2);
    expect(planeScale(24)).toBeCloseTo(3);
    expect(planeScale(60)).toBe(3);
  });
  test('紙飛行機の気絶: 長く飛ぶほど長い。ボスは 3 割', () => {
    expect(planeStun(0, false)).toBeCloseTo(0.5);
    expect(planeStun(10, false)).toBeCloseTo(1.5);
    expect(planeStun(100, false)).toBe(3);
    expect(planeStun(10, true)).toBeCloseTo(0.45);
  });
  test('おみくじ: 運が良いほど大吉が出やすい。進化すると凶が出ない', () => {
    const count = (luck: number, evolved: boolean) => {
      const c: Record<string, number> = { daikichi: 0, kichi: 0, shokichi: 0, kyo: 0 };
      for (let i = 0; i < 1000; i++) c[omikujiDraw((i + 0.5) / 1000, luck, evolved)]++;
      return c;
    };
    const base = count(0, false);
    expect(base.daikichi).toBe(100);
    expect(base.kyo).toBe(250);
    const lucky = count(0.75, false);
    expect(lucky.daikichi).toBeGreaterThan(base.daikichi);
    const evo = count(0, true);
    expect(evo.kyo).toBe(0);
    expect(evo.daikichi).toBe(350);
  });
});
