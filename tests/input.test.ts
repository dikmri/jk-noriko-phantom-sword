import { describe, expect, test } from 'bun:test';
import { MouseFilter } from '../src/core/mouseFilter';

/** 144Hz の画面で、1 フレームごとに 1 件の移動が届く想定 */
const F = 7;

describe('マウスの移動量の選別', () => {
  test('画面固定の直後 80ms の移動は使わない', () => {
    const f = new MouseFilter();
    f.lock(1000);
    expect(f.push(400, 0, 1010, false)).toMatchObject({ use: false, reason: 'afterLock' });
    expect(f.push(3, 0, 1079, false).use).toBe(false);
    expect(f.push(3, 0, 1081, false)).toMatchObject({ use: true, reason: 'ok' });
  });

  test('だんだん速くなる動きは全部使う', () => {
    const f = new MouseFilter();
    f.lock(0);
    let t = 500;
    for (const m of [4, 10, 25, 60, 120, 200, 260, 300]) {
      t += F;
      expect(f.push(m, 0, t, false).use).toBe(true);
    }
  });

  test('ゆっくり動かしている最中に 1 件だけ桁違いに大きい移動が来たら捨てる', () => {
    const f = new MouseFilter();
    f.lock(0);
    let t = 500;
    for (let i = 0; i < 6; i++) {
      t += F;
      f.push(20, 2, t, false);
    }
    t += F;
    expect(f.push(-900, 40, t, false)).toMatchObject({ use: false, reason: 'spike' });
    t += F;
    expect(f.push(20, 2, t, false)).toMatchObject({ use: true, reason: 'ok' });
  });

  test('桁違いの移動が続くときは、2 件目から使う（本当に速く動かしている）', () => {
    const f = new MouseFilter();
    f.lock(0);
    let t = 500;
    for (let i = 0; i < 4; i++) {
      t += F;
      f.push(5, 0, t, false);
    }
    t += F;
    expect(f.push(500, 0, t, false).use).toBe(false);
    t += F;
    expect(f.push(520, 0, t, false).use).toBe(true);
    t += F;
    expect(f.push(540, 0, t, false)).toMatchObject({ use: true, reason: 'ok' });
  });

  test('OS の加速を通さない入力では、桁違いでも捨てずに記録だけする', () => {
    const f = new MouseFilter();
    f.lock(0);
    let t = 500;
    for (let i = 0; i < 6; i++) {
      t += F;
      f.push(20, 2, t, true);
    }
    t += F;
    expect(f.push(-900, 40, t, true)).toMatchObject({ use: true, reason: 'spike' });
  });

  test('しばらく止めたあとの大きな 1 件は使う（処理落ちでまとめて届いた分）', () => {
    const f = new MouseFilter();
    f.lock(0);
    f.push(10, 0, 500, false);
    expect(f.push(300, 0, 620, false)).toMatchObject({ use: true, reason: 'ok' });
  });

  test('小さな移動はいつでも使う', () => {
    const f = new MouseFilter();
    f.lock(0);
    expect(f.push(140, 0, 500, false).use).toBe(true);
    expect(f.push(-140, 0, 504, false).use).toBe(true);
  });
});
