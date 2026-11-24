import { describe, expect, test } from 'bun:test';
import { COMBOS, SKILL_MAP, SKILLS, STAT_LINKS, WEAPONS } from '../src/game/defs';
import { baseStats, growGain, weaponHit } from '../src/game/rules';
import { linksWithOwned, synergyLinks } from '../src/game/synergy';

const ids = (links: { other: string }[]) => links.map((l) => l.other);

describe('シナジーの表', () => {
  test('進化の相手・コンボ・強化の表は、どれも実在するスキルを指している', () => {
    for (const s of SKILLS) {
      if (!s.evo) continue;
      expect(SKILL_MAP[s.evo.with]?.kind).toBe('passive');
    }
    for (const c of COMBOS) {
      expect(SKILL_MAP[c.a]).toBeDefined();
      expect(SKILL_MAP[c.b]).toBeDefined();
      expect(c.a).not.toBe(c.b);
    }
    for (const l of STAT_LINKS) expect(SKILL_MAP[l.passive]?.kind).toBe('passive');
  });

  test('攻撃スキルからは、進化の相手の強化が見える', () => {
    const links = synergyLinks('chalk');
    const evo = links.find((l) => l.kind === 'evo');
    expect(evo?.other).toBe('shuuchuu');
    expect(evo?.title).toContain('チョーク・ガトリング');
  });

  test('強化からは、それで進化する攻撃スキルがすべて見える', () => {
    const evo = synergyLinks('shuuchuu').filter((l) => l.kind === 'evo');
    const want = SKILLS.filter((s) => s.evo?.with === 'shuuchuu').map((s) => s.id).sort();
    expect(want).toEqual(expect.arrayContaining(['chalk', 'hanabi', 'laser']));
    expect(ids(evo).sort()).toEqual(want);
  });

  test('コンボはどちらの側から見ても出る', () => {
    expect(ids(synergyLinks('thunder').filter((l) => l.kind === 'combo'))).toContain('balloon');
    expect(ids(synergyLinks('balloon').filter((l) => l.kind === 'combo'))).toContain('thunder');
  });

  test('強化の影響は、性質（タグ）が合うスキルにだけ出る', () => {
    expect(ids(synergyLinks('chalk').filter((l) => l.kind === 'boost'))).toContain('copy');
    expect(ids(synergyLinks('copy').filter((l) => l.kind === 'boost'))).toContain('chalk');
    // ザ・授業中は数も範囲も持たないので、コピー機とつながらない
    expect(ids(synergyLinks('timestop'))).not.toContain('copy');
  });

  test('同じ相手との関係は、進化・コンボ・強化の順に並ぶ', () => {
    const order = { evo: 0, combo: 1, boost: 2 };
    const links = synergyLinks('mousou');
    for (let i = 1; i < links.length; i++) expect(order[links[i - 1].kind]).toBeLessThanOrEqual(order[links[i].kind]);
  });

  test('持っているスキルとのつながりだけを取り出せる', () => {
    const owned = ['shuuchuu', 'kintore', 'milk'];
    expect(ids(linksWithOwned('chalk', owned))).toEqual(['shuuchuu']);
    expect(ids(linksWithOwned('thunder', owned))).toEqual(['milk']);
    expect(linksWithOwned('ufo', owned)).toEqual([]);
  });
});

describe('棒、育つ', () => {
  test('殴るたびに +1。Lv が上がると、とどめのときに上乗せされる', () => {
    expect(growGain(1, false, false)).toBe(1);
    expect(growGain(1, false, true)).toBe(1);
    expect(growGain(3, false, true)).toBe(3);
    expect(growGain(5, false, false)).toBe(1);
  });
  test('進化すると 1 回で +3、とどめでさらに +6', () => {
    expect(growGain(5, true, false)).toBe(3);
    expect(growGain(5, true, true)).toBe(9);
  });
  test('上乗せした威力は、武器のダメージにそのまま足される', () => {
    const stick = WEAPONS[0];
    const s = baseStats();
    const base = weaponHit(stick, s, stick.refSpeed, 1);
    const grown = weaponHit(stick, s, stick.refSpeed, 1, 1, 30);
    expect(grown.damage).toBeCloseTo(base.damage * ((stick.damage + 30) / stick.damage), 5);
  });
  test('置き勉しない主義（武器の重さ）で吹き飛ばしが増え、ダメージは変わらない', () => {
    const stick = WEAPONS[0];
    const heavy = { ...baseStats(), weaponMass: 1.5 };
    const a = weaponHit(stick, baseStats(), 15, 1);
    const b = weaponHit(stick, heavy, 15, 1);
    expect(b.impulse).toBeCloseTo(a.impulse * 1.5, 5);
    expect(b.damage).toBeCloseTo(a.damage, 5);
  });
});
