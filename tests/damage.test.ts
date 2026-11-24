import { describe, expect, test } from 'bun:test';
import { ENEMIES, ITEM_SLOTS, ITEMS, SKILL_MAP, SKILLS } from '../src/game/defs';
import { baseStats, computeStats, damageTaken, isItemLevel, mitigate, rollItems, skillScale } from '../src/game/rules';
import { itemLinks } from '../src/game/synergy';

const SHOP0 = { hp: 0, power: 0, speed: 0, xp: 0, reroll: 0, magnet: 0, revive: 0 };

describe('防御による軽減', () => {
  test('物理防御 100 で物理ダメージは半分。魔法防御は魔法だけに効く', () => {
    expect(mitigate('phys', 100, 0, 0, 0)).toBeCloseTo(0.5, 5);
    expect(mitigate('magic', 100, 0, 0, 0)).toBe(1);
    expect(mitigate('magic', 0, 100, 0, 0)).toBeCloseTo(0.5, 5);
  });
  test('トゥルーダメージは防御で減らない', () => {
    expect(mitigate('true', 500, 500, 0, 0)).toBe(1);
  });
  test('衝撃ダメージには物理防御が半分だけ効く', () => {
    expect(mitigate('impact', 100, 0, 0, 0)).toBeCloseTo(100 / 150, 5);
  });
  test('貫通は防御を割合で減らす', () => {
    expect(mitigate('phys', 100, 0, 0.5, 0)).toBeCloseTo(100 / 150, 5);
    expect(mitigate('magic', 0, 100, 0, 1)).toBe(1);
  });
});

describe('反映率', () => {
  test('AD 反映 60% のスキルは、AD 100 で威力 1.6 倍', () => {
    expect(skillScale({ kind: 'phys', ad: 0.6 }, 100, 0)).toBeCloseTo(1.6, 5);
  });
  test('AP 反映のスキルは AD では伸びない', () => {
    expect(skillScale({ kind: 'magic', ap: 0.8 }, 300, 0)).toBe(1);
    expect(skillScale({ kind: 'magic', ap: 0.8 }, 0, 50)).toBeCloseTo(1.4, 5);
  });
});

describe('受けるダメージ', () => {
  test('物理防御・魔法防御で、それぞれの種類が減る。1 未満にはならない', () => {
    const s = { ...baseStats(), physDef: 100, magicDef: 0 };
    expect(damageTaken(20, s, 1, 'phys')).toBeCloseTo(10, 5);
    expect(damageTaken(20, s, 1, 'magic')).toBeCloseTo(20, 5);
    expect(damageTaken(0.5, s, 1, 'phys')).toBe(1);
  });
});

describe('アイテム', () => {
  test('アイテムの能力値が反映される', () => {
    const s = computeStats([], SHOP0, ['vest', 'sankosho', 'getta']);
    expect(s.physDef).toBeGreaterThanOrEqual(40);
    expect(s.ap).toBeGreaterThanOrEqual(40);
    expect(s.impactMul).toBeCloseTo(1.6, 5);
  });
  test('持っていないアイテムから、重ならないように選ぶ。枠が埋まっていれば選ばない', () => {
    let a = 1;
    const rng = () => ((a = (a * 16807) % 2147483647) / 2147483647);
    const got = rollItems(['vest'], rng, 3);
    expect(got.length).toBe(3);
    expect(new Set(got).size).toBe(3);
    expect(got).not.toContain('vest');
    const full = ITEMS.slice(0, ITEM_SLOTS).map((i) => i.id);
    expect(rollItems(full, rng, 3)).toEqual([]);
  });
  test('5 レベルごとに、アイテムを選ぶ回になる', () => {
    expect(isItemLevel(5)).toBe(true);
    expect(isItemLevel(10)).toBe(true);
    expect(isItemLevel(7)).toBe(false);
    expect(isItemLevel(1)).toBe(false);
  });
  test('アイテムとスキルのつながりが見える（鉄下駄は衝撃のスキル、参考書は魔法のスキル）', () => {
    const geta = itemLinks('getta').map((l) => l.other);
    expect(geta).toContain('domino');
    const book = itemLinks('sankosho').map((l) => l.other);
    expect(book).toContain('fire');
    expect(book).not.toContain('chalk');
  });
});

describe('データ', () => {
  test('すべての攻撃スキルにダメージの種類がある（ダメージを持たないものを除く）', () => {
    for (const s of SKILLS) if (s.kind === 'active' && s.id !== 'timestop') expect(s.dmg?.kind).toBeDefined();
  });
  test('すべての敵に物理防御と魔法防御がある', () => {
    for (const e of Object.values(ENEMIES)) {
      expect(e.armor).toBeGreaterThanOrEqual(0);
      expect(e.mr).toBeGreaterThanOrEqual(0);
    }
    // 戦車は物理にとても強く、魔法に弱い
    expect(ENEMIES.boss_tank.armor).toBeGreaterThan(ENEMIES.boss_tank.mr * 3);
  });
  test('アイテムは 20 個以上あり、id が重ならない', () => {
    expect(ITEMS.length).toBeGreaterThanOrEqual(20);
    expect(new Set(ITEMS.map((i) => i.id)).size).toBe(ITEMS.length);
    expect(SKILL_MAP.carve?.dmg?.dot).toBe('bleed');
  });
});
