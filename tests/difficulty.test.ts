import { describe, expect, test } from 'bun:test';
import { BOSSES, DIFFICULTIES, difficultyUnlocked, eliteChance, ENEMIES, enemyDmgScale, enemyHpScale, FINAL_BOSS, STAGES } from '../src/game/defs';

const stats = (clears: number, hardClears: number) => ({ bestTime: 0, totalKills: 0, bossKills: 0, chainKills: 0, maxLevel: 0, maxDestruction: 0, clears, runs: 1, hardClears, storyClears: 0, endlessBest: 0, endlessLv: 0 });

describe('難易度', () => {
  test('上の難易度ほど、敵が硬く・痛く・多い', () => {
    for (let i = 1; i < DIFFICULTIES.length; i++) {
      const a = DIFFICULTIES[i - 1];
      const b = DIFFICULTIES[i];
      expect(b.hp).toBeGreaterThan(a.hp);
      expect(b.dmg).toBeGreaterThan(a.dmg);
      expect(b.spawn).toBeGreaterThan(a.spawn);
      expect(b.bossHp).toBeGreaterThan(a.bossHp);
      expect(b.coins).toBeGreaterThan(a.coins);
    }
  });
  test('ふつうは最初から、むずかしいは 1 回クリア後、鬼はむずかしいをクリア後に選べる', () => {
    const [normal, hard, oni] = DIFFICULTIES;
    expect(difficultyUnlocked(normal, stats(0, 0))).toBe(true);
    expect(difficultyUnlocked(hard, stats(0, 0))).toBe(false);
    expect(difficultyUnlocked(hard, stats(1, 0))).toBe(true);
    expect(difficultyUnlocked(oni, stats(5, 0))).toBe(false);
    expect(difficultyUnlocked(oni, stats(5, 1))).toBe(true);
  });
});

describe('時間による強さ', () => {
  test('敵の体力は後半ほど大きく伸びる（10 分で 4.5 倍以上）', () => {
    expect(enemyHpScale(0)).toBe(1);
    expect(enemyHpScale(600)).toBeGreaterThan(4.5);
    // 後半 5 分の伸びは、前半 5 分の伸びより大きい
    expect(enemyHpScale(600) - enemyHpScale(300)).toBeGreaterThan(enemyHpScale(300) - enemyHpScale(0));
  });
  test('敵の攻撃力も時間とともに上がる', () => {
    expect(enemyDmgScale(0)).toBe(1);
    expect(enemyDmgScale(600)).toBeGreaterThan(1.7);
    expect(enemyDmgScale(300)).toBeLessThan(enemyDmgScale(600));
  });
  test('強い個体（エリート）は 2 分半までは出ず、その後は少しずつ増える。上限がある', () => {
    expect(eliteChance(100, 1)).toBe(0);
    expect(eliteChance(300, 1)).toBeGreaterThan(0);
    expect(eliteChance(600, 1)).toBeGreaterThan(eliteChance(300, 1));
    expect(eliteChance(5000, 3)).toBeLessThanOrEqual(0.35);
  });
});

describe('ボス', () => {
  test('ボスの出現表とラスボスは、実在するボスを指す', () => {
    for (const b of BOSSES) for (const id of b.ids) expect(ENEMIES[id]?.boss).toBe(true);
    expect(ENEMIES[FINAL_BOSS]?.boss).toBe(true);
    for (let i = 1; i < BOSSES.length; i++) expect(BOSSES[i].at).toBeGreaterThan(BOSSES[i - 1].at);
  });
  test('ボスは 6 種類以上いる', () => {
    expect(Object.values(ENEMIES).filter((e) => e.boss).length).toBeGreaterThanOrEqual(6);
  });
});

describe('ステージ', () => {
  test('7 つ以上あり、id が重ならない', () => {
    expect(STAGES.length).toBeGreaterThanOrEqual(7);
    expect(new Set(STAGES.map((s) => s.id)).size).toBe(STAGES.length);
  });
});
