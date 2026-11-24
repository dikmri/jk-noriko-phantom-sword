import { log } from '../log';
import { MenuCursor } from '../ui/menuCursor';
import { MouseFilter, MouseVerdict } from './mouseFilter';

type LockTarget = { requestPointerLock(o?: { unadjustedMovement?: boolean }): Promise<void> | undefined };

const r1 = (v: number): number => Math.round(v * 10) / 10;

/** キーボードとマウスの状態。フレームごとに endFrame() を呼ぶ。 */
export class Input {
  keys = new Set<string>();
  pressed = new Set<string>();
  mouseDX = 0;
  mouseDY = 0;
  wheel = 0;
  buttons = new Set<number>();
  clicked = new Set<number>();
  locked = false;
  /** ポインターロックが使えない環境向け。true の間はドラッグで視点を動かす。 */
  dragLook = false;
  enabled = true;
  /** 設定: OS の加速を通さない移動量を使う（ブラウザが対応していないときは自動で通常の入力になる） */
  wantRaw = true;
  /** いま、OS の加速を通さない移動量を受け取っているか */
  raw = false;
  private filter = new MouseFilter();
  private cursor: MenuCursor;
  /**
   * メニュー（レベルアップ・宝箱・次の現場）を出しているか。
   * 画面固定が後から効いたとき（面の始めに、固定より先にレベルアップの画面が開いたときなど）にも、
   * メニュー用のカーソルを出すために覚えておく。覚えていないと、OS のカーソルは固定で消え、
   * メニュー用のカーソルも出ないので、カーソルが行方不明になる。
   */
  private wantMenu = false;
  private lockFails = 0;
  private afterLock = { n: 0, max: 0 };
  private spikeLogs = 0;

  constructor(private canvas: HTMLCanvasElement, ui: HTMLElement) {
    this.cursor = new MenuCursor(ui);
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      this.pressed.add(e.code);
      if (this.locked && ['Space', 'Tab', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.buttons.clear();
    });
    canvas.addEventListener('mousedown', (e) => {
      // メニュー用のカーソルを出している間は、クリックを攻撃ではなくメニューの選択に使う
      if (this.locked && this.cursor.active) {
        if (e.button === 0) this.cursor.press();
        return;
      }
      this.buttons.add(e.button);
      this.clicked.add(e.button);
    });
    window.addEventListener('mouseup', (e) => this.buttons.delete(e.button));
    window.addEventListener('mousemove', (e) => {
      if (this.locked) {
        const v = this.filter.push(e.movementX, e.movementY, e.timeStamp, this.raw);
        this.noteMove(e, v);
        if (!v.use) return;
        if (this.cursor.active) this.cursor.move(e.movementX, e.movementY);
        else {
          this.mouseDX += e.movementX;
          this.mouseDY += e.movementY;
        }
      } else if (this.dragLook && this.buttons.size > 0) {
        this.mouseDX += e.movementX;
        this.mouseDY += e.movementY;
      }
    });
    canvas.addEventListener('wheel', (e) => {
      if (this.locked && this.cursor.active) {
        this.cursor.scroll(e.deltaY);
        return;
      }
      this.wheel += Math.sign(e.deltaY);
    }, { passive: true });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (this.locked) {
        this.filter.lock(performance.now());
        this.lockFails = 0;
        this.dragLook = false;
        if (this.wantMenu) this.cursor.show();
      } else this.cursor.hide();
      log('input.pointerlock', { locked: this.locked }, { raw: this.locked ? this.raw : null });
      this.onLockChange?.(this.locked);
    });
    document.addEventListener('pointerlockerror', () => this.lockFailed('pointerlockerror'));
  }

  onLockChange?: (locked: boolean) => void;

  /** 異常な移動量を記録する。行数が増えすぎないよう、固定直後の分は 1 行にまとめ、桁違いの分は 60 行までにする。 */
  private noteMove(e: MouseEvent, v: MouseVerdict): void {
    if (v.reason === 'afterLock') {
      this.afterLock.n++;
      this.afterLock.max = Math.max(this.afterLock.max, Math.hypot(e.movementX, e.movementY));
      return;
    }
    if (this.afterLock.n > 0) {
      log('input.mouse.afterlock', { events: this.afterLock.n }, { maxMove: Math.round(this.afterLock.max), dropped: true });
      this.afterLock = { n: 0, max: 0 };
    }
    if (v.reason === 'spike' && this.spikeLogs < 60) {
      this.spikeLogs++;
      log('input.mouse.spike', { dx: e.movementX, dy: e.movementY, speed: r1(v.speed), peak: r1(v.peak), raw: this.raw }, { dropped: !v.use, count: this.spikeLogs });
    }
  }

  /**
   * 固定に失敗した（pointerlockerror）。3 回続いたら、固定できない環境と見なしてドラッグでの視点操作へ切り替える。
   * 1 回の失敗で切り替えると、Esc の直後など一時的に断られただけの場合にも視点が動かなくなる。
   */
  private lockFailed(reason: string): void {
    this.lockFails++;
    if (this.lockFails >= 3) this.dragLook = true;
    log('input.pointerlock.error', { reason, fails: this.lockFails }, { fallback: this.dragLook ? 'dragLook' : 'retry' });
  }

  private lockPlain(): void {
    this.raw = false;
    try {
      const r = (this.canvas as unknown as LockTarget).requestPointerLock();
      if (r && typeof r.catch === 'function') r.catch((err: unknown) => log('input.pointerlock.reject', { raw: false }, { error: String(err) }));
    } catch (err) {
      this.lockFailed(String(err));
    }
  }

  requestLock(): void {
    if (this.locked) return;
    if (!this.wantRaw) {
      this.lockPlain();
      return;
    }
    // OS の加速を通さない移動量を頼む。対応していないブラウザでは通常の入力でやり直す
    try {
      const r = (this.canvas as unknown as LockTarget).requestPointerLock({ unadjustedMovement: true });
      if (r && typeof r.catch === 'function') {
        this.raw = true;
        r.catch((err: unknown) => {
          if ((err as { name?: string } | null)?.name === 'NotSupportedError') {
            log('input.pointerlock.raw', { supported: false }, { fallback: 'adjusted' });
            this.lockPlain();
          } else {
            this.raw = false;
            log('input.pointerlock.reject', { raw: true }, { error: String(err) });
          }
        });
      } else this.raw = false;
    } catch {
      this.lockPlain();
    }
  }

  releaseLock(): void {
    this.wantMenu = false;
    this.cursor.hide();
    if (document.pointerLockElement) document.exitPointerLock();
  }

  /**
   * メニュー用のカーソルを出し入れする。画面固定中だけ出る。
   * 固定していないときは OS のカーソルがそのまま使えるので出さないが、出したいことは覚えておき、
   * あとで固定が効いた時点で出す。
   */
  menuCursor(on: boolean): void {
    if (on && !this.wantMenu && !this.locked) log('ui.cursor.wait', {}, { reason: 'notLocked' });
    this.wantMenu = on;
    if (on && this.locked) this.cursor.show();
    else if (!on) this.cursor.hide();
  }

  down(code: string): boolean {
    return this.enabled && this.keys.has(code);
  }

  hit(code: string): boolean {
    return this.enabled && this.pressed.has(code);
  }

  endFrame(): void {
    this.pressed.clear();
    this.clicked.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
  }
}
