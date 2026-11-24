import { describe, expect, test } from 'bun:test';
import { SONGS, songEvents } from '../src/core/songs';

const ids = Object.keys(SONGS) as (keyof typeof SONGS)[];

describe('合成音の新曲', () => {
  test('2 面・3 面・2 面以降のボス・エンドレスの 4 曲がある', () => {
    expect(ids.sort()).toEqual(['battle2', 'battle3', 'boss2', 'endless']);
  });

  test('どの曲も、1 小節 16 ステップの形がそろっている', () => {
    for (const id of ids) {
      const s = SONGS[id];
      expect(s.bpm).toBeGreaterThanOrEqual(120);
      expect(s.bpm).toBeLessThanOrEqual(200);
      expect(s.prog.length).toBeGreaterThan(0);
      expect(s.bass.length).toBe(16);
      for (const m of s.mel) expect(m.length).toBe(16);
      for (const i of s.melOrder) expect(s.mel[i]).toBeDefined();
      for (const d of s.drums) expect(d).toMatch(/^[ksho.]{16}$/);
    }
  });

  test('同じステップからは、いつも同じ音が出る（ループの 2 周目も同じ）', () => {
    for (const id of ids) {
      const s = SONGS[id];
      const loop = s.prog.length * 16;
      for (const step of [0, 5, 17, 63]) expect(songEvents(s, step + loop)).toEqual(songEvents(s, step));
    }
  });

  test('小節の頭にはキックが鳴る。音の高さは聞こえる範囲に収まる', () => {
    for (const id of ids) {
      const s = SONGS[id];
      for (let bar = 0; bar < s.prog.length; bar++) {
        const ev = songEvents(s, bar * 16);
        expect(ev.some((e) => e.t === 'kick')).toBe(true);
      }
      for (let step = 0; step < s.prog.length * 16; step++) {
        for (const e of songEvents(s, step)) {
          if (e.t !== 'tone') continue;
          // 220Hz を 0 とした半音。下は約 27Hz、上は約 3.5kHz まで
          expect(e.semi).toBeGreaterThanOrEqual(-36);
          expect(e.semi).toBeLessThanOrEqual(48);
          expect(e.len).toBeGreaterThan(0);
          expect(e.vol).toBeGreaterThan(0);
          expect(e.vol).toBeLessThanOrEqual(0.35);
        }
      }
    }
  });

  test('4 曲はテンポかコード進行が違う（同じ曲に聞こえない）', () => {
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = SONGS[ids[i]];
        const b = SONGS[ids[j]];
        expect(a.bpm !== b.bpm || a.prog.join() !== b.prog.join()).toBe(true);
      }
    }
  });
});
