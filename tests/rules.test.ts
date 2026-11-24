import { describe, expect, test } from 'bun:test';
import { BOSSES, ENEMIES, enemyHpScale, MAX_ACTIVES, RULES, ruleEffect, SKILL_MAP, SKILLS, WAVES, WEAPONS, xpForLevel } from '../src/game/defs';
import { applyChoice, baseStats, ChoiceState, computeStats, damageTaken, effectiveSpeed, findUnsupported, makeRng, rollChoices, speedFactor, screenBearing, shotThreat, SupportNode, weaponHit } from '../src/game/rules';

const SHOP0 = { hp: 0, power: 0, speed: 0, xp: 0, reroll: 0, magnet: 0, revive: 0 };
const stick = WEAPONS[0];
const bat = WEAPONS.find((w) => w.id === 'bat')!;

describe('ダメージ', () => {
  test('速く当てるほど強く、上下限で止まる', () => {
    expect(speedFactor(stick.refSpeed, stick.refSpeed)).toBe(1);
    expect(speedFactor(0, stick.refSpeed)).toBe(0.35);
    expect(speedFactor(1000, stick.refSpeed)).toBe(2.4);
  });
  test('突きは軸方向の速さが大きく数えられる', () => {
    expect(effectiveSpeed(0, 3)).toBeGreaterThan(effectiveSpeed(3, 0) * 3);
    expect(effectiveSpeed(5, -3)).toBe(5);
  });
  test('重い武器ほど吹き飛ばす力が大きい', () => {
    const s = baseStats();
    expect(weaponHit(bat, s, 12, 1).impulse).toBeGreaterThan(weaponHit(stick, s, 12, 1).impulse * 2);
  });
  test('会心は 2 倍で、ヒットストップは上限を超えない', () => {
    const s = { ...baseStats(), crit: 0.5 };
    const normal = weaponHit(stick, s, 13, 0.9);
    const crit = weaponHit(stick, s, 13, 0.1);
    expect(crit.crit).toBe(true);
    expect(crit.damage).toBeCloseTo(normal.damage * 2, 5);
    expect(weaponHit(bat, { ...s, power: 100 }, 30, 0).hitStop).toBeLessThanOrEqual(0.11);
  });
  test('受けるダメージは防具で減るが 1 未満にならない', () => {
    const s = { ...baseStats(), physDef: 150 };
    expect(damageTaken(10, s)).toBeCloseTo(4, 5);
    expect(damageTaken(2, s)).toBe(1);
  });
});

describe('能力値', () => {
  test('強化なしなら基準値のまま', () => {
    expect(computeStats([], SHOP0)).toEqual(baseStats());
  });
  test('強化と買い物の効果が合わさる', () => {
    const s = computeStats([{ id: 'kintore', level: 2 }, { id: 'kyushoku', level: 1 }], { ...SHOP0, power: 2, hp: 1 });
    expect(s.power).toBeCloseTo(1.34, 5);
    expect(s.maxHp).toBe(130);
  });
});

describe('レベルアップの選択肢', () => {
  const empty: ChoiceState = { actives: [], passives: [], banished: [], luck: 0 };
  test('重複せず、指定した数だけ出る', () => {
    const rng = makeRng(1);
    for (let i = 0; i < 50; i++) {
      const c = rollChoices(empty, rng, 3);
      expect(c.length).toBe(3);
      expect(new Set(c.map((x) => x.id)).size).toBe(3);
    }
  });
  test('最大レベルのスキルは強化の候補に出ない', () => {
    const st: ChoiceState = { ...empty, actives: [{ id: 'chalk', level: 5 }] };
    const rng = makeRng(2);
    for (let i = 0; i < 200; i++) {
      for (const c of rollChoices(st, rng, 4)) expect(c.id === 'chalk' && c.kind === 'up').toBe(false);
    }
  });
  test('最大レベル + 対応する強化を持っていれば進化が候補に出る', () => {
    const st: ChoiceState = { ...empty, actives: [{ id: 'chalk', level: 5 }], passives: [{ id: 'shuuchuu', level: 1 }] };
    const rng = makeRng(3);
    let seen = false;
    for (let i = 0; i < 50 && !seen; i++) seen = rollChoices(st, rng, 3).some((c) => c.kind === 'evolve' && c.id === 'chalk');
    expect(seen).toBe(true);
    const after = applyChoice(st, { kind: 'evolve', id: 'chalk', level: 5 });
    expect(after.actives[0].evolved).toBe(true);
    for (let i = 0; i < 100; i++) expect(rollChoices(after, rng, 4).some((c) => c.kind === 'evolve')).toBe(false);
  });
  test('枠が埋まると新しい攻撃スキルは出ない', () => {
    const actives = SKILLS.filter((s) => s.kind === 'active').slice(0, MAX_ACTIVES).map((s) => ({ id: s.id, level: 1 }));
    const st: ChoiceState = { ...empty, actives };
    const rng = makeRng(4);
    for (let i = 0; i < 200; i++) {
      for (const c of rollChoices(st, rng, 4)) {
        if (c.kind === 'new') expect(SKILL_MAP[c.id].kind).toBe('passive');
      }
    }
  });
  test('除外したスキルは出ない', () => {
    const st: ChoiceState = { ...empty, banished: ['chalk', 'fire'] };
    const rng = makeRng(5);
    for (let i = 0; i < 200; i++) for (const c of rollChoices(st, rng, 4)) expect(['chalk', 'fire']).not.toContain(c.id);
  });
  test('スキルが育ちきっても、おまけ（回復・コイン）で埋めない。威力の突破と「棒を鍛える」が続く', () => {
    const actives = SKILLS.filter((s) => s.kind === 'active').slice(0, MAX_ACTIVES).map((s) => ({ id: s.id, level: s.max, evolved: true, brk: 99 }));
    const passives = SKILLS.filter((s) => s.kind === 'passive').slice(0, 6).map((s) => ({ id: s.id, level: s.max, brk: 99 }));
    const c = rollChoices({ ...empty, actives, passives }, makeRng(6), 3);
    expect(c.length).toBe(3);
    expect(c.some((x) => x.kind === 'bonus')).toBe(false);
  });
  test('何も持っていなくて選べるものが無いときだけ、おまけで埋める', () => {
    expect(rollChoices(empty, makeRng(7), 200).some((x) => x.kind === 'bonus')).toBe(true);
  });
  test('同じ種からは同じ結果が出る', () => {
    expect(rollChoices(empty, makeRng(42), 3)).toEqual(rollChoices(empty, makeRng(42), 3));
  });
});

describe('データ定義の整合', () => {
  test('進化の条件に指定した強化が存在する', () => {
    for (const s of SKILLS) if (s.evo) expect(SKILL_MAP[s.evo.with]?.kind).toBe('passive');
  });
  test('出現表とボスが参照する敵が存在する', () => {
    for (const w of WAVES) for (const [id] of w.mix) expect(ENEMIES[id]).toBeDefined();
    for (const b of BOSSES) for (const id of b.ids) expect(ENEMIES[id]?.boss).toBe(true);
  });
  test('出現表は時刻の順に並ぶ', () => {
    for (let i = 1; i < WAVES.length; i++) expect(WAVES[i].from).toBeGreaterThan(WAVES[i - 1].from);
  });
  test('必要経験値と敵の体力は増えていく', () => {
    for (let l = 1; l < 60; l++) expect(xpForLevel(l + 1)).toBeGreaterThanOrEqual(xpForLevel(l));
    expect(enemyHpScale(600)).toBeGreaterThan(enemyHpScale(0));
    expect(xpForLevel(1)).toBeLessThan(10);
  });
  test('最初の武器は解放条件なし、校則は効果を返す', () => {
    expect(WEAPONS[0].unlock).toBeUndefined();
    for (const r of RULES) expect(ruleEffect(r.id).gravity).toBeGreaterThan(0);
    expect(ruleEffect('glass').dealt).toBe(2);
  });
});

describe('建物の支え', () => {
  // 幅 w・高さ h の壁。番号 = y * w + x
  const wall = (w: number, h: number, span = 2): SupportNode[] => {
    const nodes: SupportNode[] = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const side: number[] = [];
        if (x > 0) side.push(y * w + x - 1);
        if (x < w - 1) side.push(y * w + x + 1);
        nodes.push({ alive: true, grounded: y === 0, below: y > 0 ? [(y - 1) * w + x] : [], side, span });
      }
    }
    return nodes;
  };
  test('無傷の壁は何も落ちない', () => {
    expect(findUnsupported(wall(8, 4))).toEqual([]);
  });
  test('最下段を 1 個抜いても、両隣の柱が支える', () => {
    const n = wall(8, 4);
    n[3].alive = false;
    expect(findUnsupported(n)).toEqual([]);
  });
  test('最下段を広く抜くと、柱から遠い真ん中だけが落ちる', () => {
    const w = 10;
    const n = wall(w, 3, 2);
    for (let x = 2; x <= 7; x++) n[x].alive = false; // 6 個抜く
    const fall = findUnsupported(n).sort((a, b) => a - b);
    // 2段目・3段目の x=4,5 は柱(x=1, x=8)から 3 個離れているので落ちる
    expect(fall).toEqual([w + 4, w + 5, 2 * w + 4, 2 * w + 5]);
  });
  test('最下段をすべて抜くと全部落ちる', () => {
    const n = wall(5, 3);
    for (let x = 0; x < 5; x++) n[x].alive = false;
    expect(findUnsupported(n).length).toBe(10);
  });
  test('すでに無い部品は結果に含まれない', () => {
    const n = wall(3, 2);
    n[4].alive = false;
    expect(findUnsupported(n)).not.toContain(4);
  });
});

describe('弾の予測', () => {
  test('まっすぐ向かってくる弾は、当たるまでの秒数と外れ幅 0 を返す', () => {
    const r = shotThreat({ x: 0, y: 0, z: 10 }, { x: 0, y: 0, z: 12.5 })!;
    expect(r.t).toBeCloseTo(0.8, 5);
    expect(r.miss).toBeCloseTo(0, 5);
  });
  test('横を通り過ぎる弾は、いちばん近づく距離を外れ幅として返す', () => {
    const r = shotThreat({ x: 3, y: 0, z: 10 }, { x: 0, y: 0, z: 10 })!;
    expect(r.t).toBeCloseTo(1, 5);
    expect(r.miss).toBeCloseTo(3, 5);
  });
  test('遠ざかる弾と止まっている弾は対象外', () => {
    expect(shotThreat({ x: 0, y: 0, z: 10 }, { x: 0, y: 0, z: -12 })).toBeNull();
    expect(shotThreat({ x: 0, y: 0, z: 10 }, { x: 0, y: 0, z: 0 })).toBeNull();
  });
});

describe('画面上の方角', () => {
  test('カメラが +Z を向いているとき: 前 0、右 +90°、後ろ 180°、左 -90°', () => {
    expect(screenBearing(0, 5, 0)).toBeCloseTo(0, 5);
    expect(screenBearing(-5, 0, 0)).toBeCloseTo(Math.PI / 2, 5);
    expect(Math.abs(screenBearing(0, -5, 0))).toBeCloseTo(Math.PI, 5);
    expect(screenBearing(5, 0, 0)).toBeCloseTo(-Math.PI / 2, 5);
  });
  test('カメラが +X を向いているとき、+X にあるものは前', () => {
    expect(screenBearing(5, 0, Math.PI / 2)).toBeCloseTo(0, 5);
    expect(screenBearing(0, 5, Math.PI / 2)).toBeCloseTo(Math.PI / 2, 5);
  });
});
