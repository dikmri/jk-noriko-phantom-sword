/**
 * マウスの移動量 1 件を、視点の回転に使うかどうか決める。
 *
 * 画面固定（ポインターロック）中のブラウザは、まれに桁違いに大きい移動量を 1 件だけ返すことがある。
 * そのまま使うと視点が別の方向へ飛ぶので、直前の動きと比べて不自然な 1 件を除く。
 */
export const MOUSE_FILTER = {
  /** 画面固定を得た直後、移動を使わない時間 (ms)。固定の瞬間にカーソルの移動分が混ざるため */
  afterLockMs: 80,
  /** 直前の動きとして見る時間 (ms) */
  windowMs: 120,
  /** これより小さい移動 (px) は、いつでも使う */
  minMag: 150,
  /** 「桁違い」と見なす速さ (px/ms) = baseSpeed + ratio × 直前の最大の速さ */
  baseSpeed: 30,
  ratio: 6,
};

export interface MouseVerdict {
  use: boolean;
  reason: 'ok' | 'afterLock' | 'spike';
  /** この移動の速さ (px/ms) */
  speed: number;
  /** 直前 windowMs の間の最大の速さ (px/ms) */
  peak: number;
}

export class MouseFilter {
  private lockAt = -1e9;
  private lastT = -1e9;
  private hist: { t: number; s: number }[] = [];
  private droppedLast = false;

  /** 画面固定を得た時刻を知らせる。 */
  lock(now: number): void {
    this.lockAt = now;
    this.lastT = -1e9;
    this.hist.length = 0;
    this.droppedLast = false;
  }

  /**
   * raw: OS の加速を通さない移動量を受け取っているか。
   * raw のときは単位がマウスの解像度で変わり、px 前提のしきい値を当てはめられないので、捨てずに記録だけする。
   */
  push(dx: number, dy: number, now: number, raw: boolean): MouseVerdict {
    if (now - this.lockAt < MOUSE_FILTER.afterLockMs) return { use: false, reason: 'afterLock', speed: 0, peak: 0 };
    const mag = Math.hypot(dx, dy);
    const dtm = Math.min(100, Math.max(4, now - this.lastT));
    const speed = mag / dtm;
    while (this.hist.length && now - this.hist[0].t > MOUSE_FILTER.windowMs) this.hist.shift();
    let peak = 0;
    for (const h of this.hist) if (h.s > peak) peak = h.s;
    this.lastT = now;
    const spike = mag >= MOUSE_FILTER.minMag && speed > MOUSE_FILTER.baseSpeed + MOUSE_FILTER.ratio * peak;
    // 2 件続けては捨てない。続くなら、本当に速く動かしている
    if (spike && !raw && !this.droppedLast) {
      this.droppedLast = true;
      return { use: false, reason: 'spike', speed, peak };
    }
    this.droppedLast = false;
    this.hist.push({ t: now, s: speed });
    return { use: true, reason: spike && raw ? 'spike' : 'ok', speed, peak };
  }
}
