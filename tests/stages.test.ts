import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { ENDLESS_FINALS, ENDLESS_MIX, ENEMIES, ENEMY_MODEL_ASSET, STAGES, STORY_STAGES, TIERS, TUNE } from '../src/game/defs';
import { detourScore, endlessPlan, foeScale, nextStageChoices } from '../src/game/rules';

describe('面ごとの敵とボス', () => {
  test('3 面ぶんの定義があり、面が進むほど敵が強い', () => {
    expect(TIERS.length).toBe(STORY_STAGES);
    for (let i = 1; i < TIERS.length; i++) {
      expect(TIERS[i].hp).toBeGreaterThan(TIERS[i - 1].hp);
      expect(TIERS[i].dmg).toBeGreaterThan(TIERS[i - 1].dmg);
      expect(TIERS[i].bossHp).toBeGreaterThan(TIERS[i - 1].bossHp);
    }
  });

  test('出てくる敵・ボス・ラスボスは、どれも定義されている', () => {
    const ids = new Set<string>();
    for (const t of TIERS) {
      for (const w of t.waves) for (const [id] of w.mix) ids.add(id);
      for (const b of t.bosses) for (const id of b.ids) {
        ids.add(id);
        expect(ENEMIES[id]?.boss).toBe(true);
      }
      expect(ENEMIES[t.final]?.boss).toBe(true);
    }
    for (const [id] of ENDLESS_MIX) ids.add(id);
    for (const id of ENDLESS_FINALS) expect(ENEMIES[id]?.boss).toBe(true);
    for (const id of ids) expect(ENEMIES[id]).toBeDefined();
    // 分かれて出てくる敵も
    for (const e of Object.values(ENEMIES)) if (e.split) expect(ENEMIES[e.split]).toBeDefined();
  });

  test('どの面も、10 分でラスボスの前の三巨頭が出る', () => {
    for (const t of TIERS) {
      const last = t.bosses[t.bosses.length - 1];
      expect(last.at).toBeGreaterThanOrEqual(TUNE.runLength);
      // 出る時刻は早い順
      for (let i = 1; i < t.bosses.length; i++) expect(t.bosses[i].at).toBeGreaterThan(t.bosses[i - 1].at);
    }
  });

  test('2 面・3 面には、1 面に出ない新しい敵とボスがいる', () => {
    const inTier = (k: number) => new Set([...TIERS[k].waves.flatMap((w) => w.mix.map(([id]) => id)), ...TIERS[k].bosses.flatMap((b) => b.ids), TIERS[k].final]);
    const t1 = inTier(0);
    for (const k of [1, 2]) {
      const fresh = [...inTier(k)].filter((id) => !t1.has(id));
      expect(fresh.filter((id) => !ENEMIES[id].boss).length).toBeGreaterThanOrEqual(2);
      expect(fresh.filter((id) => ENEMIES[id].boss).length).toBeGreaterThanOrEqual(2);
    }
  });

  test('新しい敵のモデルのファイルがある', () => {
    for (const name of Object.values(ENEMY_MODEL_ASSET)) expect(existsSync(`public/models/${name}.glb`)).toBe(true);
  });
});

describe('エンドレス', () => {
  test('ラスボスのあとは、レベルごとに敵が強くなる', () => {
    const t = TIERS[0];
    expect(foeScale(t, 0)).toEqual({ hp: t.hp, dmg: t.dmg, spawn: t.spawn, bossHp: t.bossHp, elite: t.elite });
    const a = foeScale(t, 1);
    const b = foeScale(t, 5);
    expect(b.hp).toBeGreaterThan(a.hp);
    expect(b.bossHp).toBeGreaterThan(a.bossHp);
    expect(b.dmg).toBeGreaterThan(a.dmg);
    // 出る数とエリートには上限がある
    expect(foeScale(t, 100).spawn).toBeLessThanOrEqual(1.6);
    expect(foeScale(t, 100).elite).toBeLessThanOrEqual(0.25);
  });

  test('強くなったラスボスが順番に来て、レベルが上がると一緒に来るボスが増える', () => {
    expect(endlessPlan(1).final).toBe(ENDLESS_FINALS[0]);
    expect(endlessPlan(2).final).toBe(ENDLESS_FINALS[1]);
    expect(endlessPlan(4).final).toBe(ENDLESS_FINALS[0]);
    expect(endlessPlan(1).extra).toBe(0);
    expect(endlessPlan(5).extra).toBeGreaterThan(endlessPlan(1).extra);
    expect(endlessPlan(99).extra).toBeLessThanOrEqual(3);
  });
});

describe('次の面の選び方', () => {
  const all = STAGES.map((s) => s.id);
  test('まだ行っていないステージから、重ならずに 3 つ', () => {
    let seed = 1;
    const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const got = nextStageChoices(all, ['yard', 'ski'], rng, 3);
    expect(got.length).toBe(3);
    expect(new Set(got).size).toBe(3);
    expect(got).not.toContain('yard');
    expect(got).not.toContain('ski');
  });
  test('行っていないステージが足りなければ、行ったステージも混ぜる', () => {
    const got = nextStageChoices(['a', 'b', 'c'], ['a', 'b'], Math.random, 3);
    expect(got.length).toBe(3);
    expect(got[0]).toBe('c');
  });
});

describe('寄り道（マップを動き回る理由）', () => {
  test('近すぎる場所・遠すぎる場所は選ばない', () => {
    expect(detourScore({ x: 10, z: 0 }, { x: 0, z: 0 }, [])).toBe(-Infinity);
    expect(detourScore({ x: 90, z: 0 }, { x: 0, z: 0 }, [])).toBe(-Infinity);
    expect(detourScore({ x: 40, z: 0 }, { x: 0, z: 0 }, [])).toBeGreaterThan(-Infinity);
  });
  test('最近の寄り道の場所から離れた場所ほど選ばれやすい（同じ所ばかりにならない）', () => {
    const recent = [{ x: 40, z: 0 }];
    const near = detourScore({ x: 38, z: 6 }, { x: 0, z: 0 }, recent);
    const far = detourScore({ x: -40, z: 0 }, { x: 0, z: 0 }, recent);
    expect(far).toBeGreaterThan(near);
  });
});
