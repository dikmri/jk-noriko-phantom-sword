import { describe, expect, test } from 'bun:test';
import { ITEM_MAP, ITEM_SLOTS, ITEMS, MAX_ACTIVES, SKILL_MAP, SKILLS } from '../src/game/defs';
import { applyChoice, BREAK_MAX_PASSIVE, breakMul, ChoiceState, computeStats, ITEM_MAX_LV, makeRng, rollChoices, rollItemChoices } from '../src/game/rules';

const SHOP0 = { hp: 0, power: 0, speed: 0, xp: 0, reroll: 0, magnet: 0, revive: 0 };
const empty: ChoiceState = { actives: [], passives: [], banished: [], luck: 0 };

/** 攻撃スキル 6 個と強化 6 個を、すべて最大レベルで持っている状態 */
function maxed(brk = 0): ChoiceState {
  const actives = SKILLS.filter((s) => s.kind === 'active').slice(0, MAX_ACTIVES).map((s) => ({ id: s.id, level: s.max, evolved: true, brk }));
  const passives = SKILLS.filter((s) => s.kind === 'passive' && s.max >= 3).slice(0, 6).map((s) => ({ id: s.id, level: s.max, brk: Math.min(brk, BREAK_MAX_PASSIVE) }));
  return { ...empty, actives, passives };
}

describe('限界突破', () => {
  test('スキルがすべて最大でも、限界突破か「棒を鍛える」が候補に出る（回復とコインだけにならない）', () => {
    const rng = makeRng(11);
    for (let i = 0; i < 30; i++) {
      const c = rollChoices(maxed(), rng, 3);
      expect(c.every((x) => x.kind === 'break' || x.kind === 'weapon')).toBe(true);
    }
  });
  test('攻撃スキルの突破には種類（威力・待ち時間・範囲・数）が付く', () => {
    const rng = makeRng(12);
    const seen = new Set<string>();
    for (let i = 0; i < 60; i++) for (const c of rollChoices(maxed(), rng, 3)) if (SKILL_MAP[c.id]?.kind === 'active') seen.add(c.sub ?? 'none');
    expect(seen.has('none')).toBe(false);
    expect(seen.has('dmg') && seen.has('cd') && seen.has('area')).toBe(true);
  });
  test('選ぶと段階が増え、種類ごとに数える', () => {
    const st = maxed();
    const id = st.actives[0].id;
    const after = applyChoice(st, { kind: 'break', id, level: 1, sub: 'dmg' });
    expect(after.actives[0].brk).toBe(1);
    expect(after.actives[0].bk?.dmg).toBe(1);
    const p = st.passives[0].id;
    const after2 = applyChoice(st, { kind: 'break', id: p, level: 1 });
    expect(after2.passives[0].brk).toBe(1);
  });
  test('何十回突破しても、回復とコインだけにはならない（威力の突破と「棒を鍛える」には上限が無い）', () => {
    const st = maxed(40);
    for (const a of st.actives) a.bk = { dmg: 28, cd: 6, area: 6, amt: 3 };
    const rng = makeRng(13);
    for (let i = 0; i < 30; i++) {
      const c = rollChoices(st, rng, 3);
      expect(c.length).toBe(3);
      expect(c.some((x) => x.kind === 'bonus')).toBe(false);
      // 待ち時間と範囲は 6 回で打ち止め。威力だけが出る
      for (const x of c) if (x.kind === 'break' && SKILL_MAP[x.id]?.kind === 'active') expect(x.sub).toBe('dmg');
    }
  });
  test('数を増やす突破は、飛び道具の数が増えるスキルだけに付く', () => {
    const st: ChoiceState = { ...empty, actives: [{ id: 'blizzard', level: 5, evolved: true }] };
    const rng = makeRng(14);
    for (let i = 0; i < 100; i++) for (const c of rollChoices(st, rng, 3)) if (c.kind === 'break') expect(c.sub).not.toBe('amt');
  });
  test('突破の倍率（威力 +20%、待ち時間 ×0.92、範囲 +12%、数 +1 ずつ）', () => {
    const m = breakMul({ dmg: 2, cd: 1, amt: 1 });
    expect(m.dmg).toBeCloseTo(1.4, 5);
    expect(m.cd).toBeCloseTo(0.92, 5);
    expect(m.area).toBeCloseTo(1, 5);
    expect(m.amt).toBe(1);
  });
  test('強化の突破は、1 段で通常の 1 レベルの半分の効果', () => {
    const s = computeStats([{ id: 'kintore', level: 5, brk: 2 }], SHOP0);
    expect(s.power).toBeCloseTo(1 + 0.12 * 6, 5);
  });
  test('コピー機と根性は突破できない', () => {
    const st: ChoiceState = { ...empty, passives: [{ id: 'copy', level: 2 }, { id: 'konjou', level: 1 }] };
    const rng = makeRng(15);
    for (let i = 0; i < 100; i++) for (const c of rollChoices(st, rng, 3)) expect(c.kind).not.toBe('break');
  });
});

describe('アイテムの強化', () => {
  test('枠が空いていれば新しいアイテムも出る。埋まっていれば持っているアイテムの強化だけ', () => {
    const rng = makeRng(21);
    const some = rollItemChoices(['vest'], {}, rng, 3);
    expect(some.some((c) => c.kind === 'item')).toBe(true);
    const full = ITEMS.slice(0, ITEM_SLOTS).map((i) => i.id);
    for (let i = 0; i < 30; i++) {
      const c = rollItemChoices(full, {}, rng, 3);
      expect(c.length).toBe(3);
      for (const x of c) {
        expect(x.kind).toBe('itemup');
        expect(full).toContain(x.id);
        expect(x.level).toBe(2);
      }
    }
  });
  test(`★${ITEM_MAX_LV}（上限）になったアイテムは強化に出ない。全部が上限なら空`, () => {
    expect(ITEM_MAX_LV).toBe(5);
    const full = ITEMS.slice(0, ITEM_SLOTS).map((i) => i.id);
    const lv = Object.fromEntries(full.map((id) => [id, ITEM_MAX_LV]));
    expect(rollItemChoices(full, lv, makeRng(22), 3)).toEqual([]);
  });
  test('効果が「ある・なし」だけのアイテム（フォーク・推薦状など）は★上げに出ない', () => {
    const owned = ['fork', 'clip', 'suisen', 'renkin', 'kinniku', 'wax'];
    expect(rollItemChoices(owned, {}, makeRng(23), 3)).toEqual([]);
  });
  test('★が上がると数値が増える（★3 で 2 倍）。引き換えの短所は増えない', () => {
    const s1 = computeStats([], SHOP0, ['vest']);
    const s3 = computeStats([], SHOP0, ['vest'], { vest: 3 });
    expect(s3.physDef).toBeCloseTo(s1.physDef * 2, 5);
    const h1 = computeStats([], SHOP0, ['hachimaki']);
    const h3 = computeStats([], SHOP0, ['hachimaki'], { hachimaki: 3 });
    expect(h3.power).toBeGreaterThan(h1.power);
    expect(h3.damageTaken).toBeCloseTo(h1.damageTaken, 5);
  });
  test('部活の掛け持ちで、アイテムの数値が増える', () => {
    const a = computeStats([], SHOP0, ['sankosho']);
    const b = computeStats([{ id: 'kakemochi', level: 5 }], SHOP0, ['sankosho']);
    expect(b.ap).toBeGreaterThan(a.ap * 1.25);
  });
});

describe('新しいアイテムの効果', () => {
  test('校長の推薦状があれば、対応する強化なしで進化できる', () => {
    const st: ChoiceState = { ...empty, actives: [{ id: 'chalk', level: 5 }] };
    const rng = makeRng(31);
    for (let i = 0; i < 50; i++) expect(rollChoices(st, rng, 3).some((c) => c.kind === 'evolve')).toBe(false);
    const st2 = { ...st, items: ['suisen'] };
    let seen = false;
    for (let i = 0; i < 50 && !seen; i++) seen = rollChoices(st2, rng, 3).some((c) => c.kind === 'evolve');
    expect(seen).toBe(true);
  });
  test('几帳面なノートは会心を無くし、威力を上げる', () => {
    const s = computeStats([{ id: 'kiai', level: 5 }], SHOP0, ['darts', 'note']);
    expect(s.crit).toBe(0);
    expect(s.power).toBeGreaterThan(1.25);
  });
  test('卒業式の角帽は AP を割合で増やす', () => {
    const a = computeStats([], SHOP0, ['sankosho']);
    const b = computeStats([], SHOP0, ['sankosho', 'kakuboushi']);
    expect(b.ap).toBeGreaterThan((a.ap + 25) * 1.25);
  });
  test('業務用の箱買いは飛び道具 +2、スキルの威力は下がる。数は★や掛け持ちでも整数のまま', () => {
    const s = computeStats([], SHOP0, ['hakogai']);
    expect(s.amount).toBe(2);
    expect(s.skillMul).toBeLessThan(1);
    const s3 = computeStats([{ id: 'kakemochi', level: 5 }], SHOP0, ['hakogai'], { hakogai: 3 });
    expect(s3.amount).toBe(2);
  });
  test('アイテムは 50 個以上あり、すべての説明がある', () => {
    expect(ITEMS.length).toBeGreaterThanOrEqual(50);
    for (const i of ITEMS) expect(ITEM_MAP[i.id].desc.length).toBeGreaterThan(5);
  });
  test('新しい攻撃スキルと強化がある', () => {
    for (const id of ['hook', 'globe', 'snowball', 'pitching', 'landmine', 'geyser', 'cardboard', 'brand', 'gourei', 'gaman', 'hizageri', 'yofukashi', 'megane', 'kakemochi']) expect(SKILL_MAP[id]).toBeDefined();
  });
});
