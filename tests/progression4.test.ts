import { describe, expect, test } from 'bun:test';
import { ITEMS, ITEM_SLOTS, SKILL_MAP, SKILLS } from '../src/game/defs';
import { applyChoice, BREAK_KIND_MAX, BREAK_MAX_PASSIVE, choicePool, ChoiceState, itemPow, makeRng, PASSIVE_UNLIMITED, rollChoices, rollItemChoices, weaponTrain } from '../src/game/rules';

const empty: ChoiceState = { actives: [], passives: [], banished: [], luck: 0 };

describe('いつまでも強くなれる', () => {
  test('「棒を鍛える」はいつでも候補にあり、選ぶと段階が上がる', () => {
    const rng = makeRng(41);
    let seen = false;
    for (let i = 0; i < 200 && !seen; i++) seen = rollChoices(empty, rng, 3).some((c) => c.kind === 'weapon');
    expect(seen).toBe(true);
    const after = applyChoice({ ...empty, weaponLv: 7 }, { kind: 'weapon', id: 'weapon', level: 8 });
    expect(after.weaponLv).toBe(8);
  });

  test('棒を鍛えると、棒の威力が 1 段で +10%。振る速さは 30% で頭打ち', () => {
    expect(weaponTrain(0)).toEqual({ dmg: 1, swing: 1 });
    expect(weaponTrain(5).dmg).toBeCloseTo(1.5);
    expect(weaponTrain(5).swing).toBeCloseTo(1.075);
    expect(weaponTrain(100).swing).toBeCloseTo(1.3);
    expect(weaponTrain(100).dmg).toBeCloseTo(11);
  });

  test('攻撃スキルの限界突破: 威力は上限なし、待ち時間と範囲は 6 回、数は 3 回まで', () => {
    expect(BREAK_KIND_MAX.dmg).toBe(Infinity);
    expect(BREAK_KIND_MAX.cd).toBe(6);
    expect(BREAK_KIND_MAX.area).toBe(6);
    expect(BREAK_KIND_MAX.amt).toBe(3);
    const st: ChoiceState = { ...empty, actives: [{ id: 'chalk', level: 5, evolved: true, brk: 15, bk: { dmg: 3, cd: 6, area: 6 } }] };
    const rng = makeRng(42);
    for (let i = 0; i < 100; i++) for (const c of rollChoices(st, rng, 3)) if (c.kind === 'break') expect(['dmg', 'amt']).toContain(c.sub ?? '');
  });

  test('数値が伸びても壊れない強化だけ、限界突破の上限が無い。ほかは 5 回まで', () => {
    expect(PASSIVE_UNLIMITED.has('kintore')).toBe(true);
    expect(PASSIVE_UNLIMITED.has('shuuchuu')).toBe(false);
    for (const id of PASSIVE_UNLIMITED) expect(SKILL_MAP[id]?.kind).toBe('passive');
    const st: ChoiceState = { ...empty, passives: [{ id: 'kintore', level: 5, brk: 30 }, { id: 'shuuchuu', level: 5, brk: BREAK_MAX_PASSIVE }] };
    const ids = new Set(choicePool(st).filter((p) => p.choice.kind === 'break').map((p) => p.choice.id));
    expect(ids.has('kintore')).toBe(true);
    expect(ids.has('shuuchuu')).toBe(false);
  });

  test('アイテムは★5 まで上がり、★ごとに数値が 0.5 倍ずつ増える', () => {
    expect(itemPow(4)).toBeCloseTo(2.5);
    expect(itemPow(5)).toBeCloseTo(3);
    const full = ITEMS.filter((i) => i.star !== false).slice(0, ITEM_SLOTS).map((i) => i.id);
    const lv = Object.fromEntries(full.map((id) => [id, 3]));
    const c = rollItemChoices(full, lv, makeRng(44), 3);
    expect(c.length).toBe(3);
    for (const x of c) expect(x.level).toBe(4);
  });

  test('全部のスキルを最大まで育て、限界突破を 100 回重ねても、選択肢は 3 枚そろう', () => {
    const actives = SKILLS.filter((s) => s.kind === 'active').slice(0, 6).map((s) => ({ id: s.id, level: s.max, evolved: true, brk: 100, bk: { dmg: 88, cd: 6, area: 6 } }));
    const passives = SKILLS.filter((s) => s.kind === 'passive' && !PASSIVE_UNLIMITED.has(s.id)).slice(0, 6).map((s) => ({ id: s.id, level: s.max, brk: BREAK_MAX_PASSIVE }));
    const st: ChoiceState = { ...empty, actives, passives, weaponLv: 100 };
    const rng = makeRng(45);
    for (let i = 0; i < 50; i++) {
      const c = rollChoices(st, rng, 3);
      expect(c.length).toBe(3);
      expect(c.every((x) => x.kind !== 'bonus')).toBe(true);
    }
  });
});

describe('説明文と効く範囲', () => {
  test('すべてのアイテムと強化に、効く範囲の印がある', async () => {
    const { ITEMS: items, SKILLS: skills, SCOPE_INFO } = await import('../src/game/defs');
    for (const i of items) {
      expect(i.scope?.length ?? 0).toBeGreaterThan(0);
      for (const k of i.scope!) expect(SCOPE_INFO[k]).toBeDefined();
    }
    for (const p of skills.filter((x) => x.kind === 'passive')) expect(p.scope?.length ?? 0).toBeGreaterThan(0);
  });
  test('説明文に「武器」という曖昧な言葉を使わない（棒の攻撃・スキルの攻撃・すべての攻撃で書く）', async () => {
    const { ITEMS: items, SKILLS: skills } = await import('../src/game/defs');
    for (const i of items) expect(i.desc).not.toContain('武器');
    for (const s of skills) {
      expect(s.desc).not.toContain('武器');
      expect(s.up).not.toContain('武器');
      if (s.evo) expect(s.evo.desc).not.toContain('武器');
    }
  });
  test('【棒の攻撃】と書いたアイテムには、棒の攻撃（かすべての攻撃）の印が付いている', async () => {
    const { ITEMS: items } = await import('../src/game/defs');
    // 【すべての攻撃】は棒の攻撃も含む
    for (const i of items) if (i.desc.includes('【棒の攻撃】')) expect(i.scope!.includes('weapon') || i.scope!.includes('all')).toBe(true);
  });
  test('新しい攻撃スキル 10 個・強化 2 個・アイテム 12 個がある', async () => {
    const { SKILL_MAP: sm, ITEM_MAP: im } = await import('../src/game/defs');
    for (const id of ['kokuban', 'jitensha', 'denjishaku', 'honnoame', 'fuusen', 'shutter', 'pingpong', 'karaoke', 'shoot', 'photo']) {
      expect(sm[id]?.kind).toBe('active');
      expect(sm[sm[id].evo!.with].kind).toBe('passive');
      expect(sm[id].dmg).toBeDefined();
    }
    for (const id of ['anki', 'asaren']) expect(sm[id]?.kind).toBe('passive');
    for (const id of ['glove', 'bell', 'shiomusubi', 'kandenchi', 'antenna', 'litmus', 'ramune', 'ikari', 'sori', 'jersey', 'suitou', 'seiseki']) expect(im[id]).toBeDefined();
  });
});
