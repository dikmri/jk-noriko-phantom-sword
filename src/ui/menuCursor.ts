import { log } from '../log';

const CLICKABLE = 'button, .lv-card, [data-click]';

function describe(e: HTMLElement): string {
  const cls = e.className ? `.${String(e.className).split(' ').filter(Boolean).slice(0, 2).join('.')}` : '';
  return `${e.tagName.toLowerCase()}${cls}:${(e.textContent ?? '').trim().slice(0, 16)}`;
}

/**
 * 画面固定（ポインターロック）を保ったままメニューを選ぶための、画面内に描くカーソル。
 *
 * 固定を外すと、OS のカーソルは固定した瞬間の位置（前回クリックした場所）に現れる。
 * その位置は遊んでいる人には予想できないので、レベルアップなどの短い選択では固定を外さず、
 * 毎回同じ場所（data-cursor-home を付けた要素の中央）から始まるカーソルを描く。
 */
export class MenuCursor {
  active = false;
  private el: HTMLDivElement;
  private x = 0;
  private y = 0;
  private hover: HTMLElement | null = null;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'menu-cursor';
    parent.appendChild(this.el);
  }

  /** 表示する。すでに出ているときは位置を保ち、下にある要素だけ調べ直す。 */
  show(): void {
    if (!this.active) {
      this.active = true;
      const home = document.querySelector('[data-cursor-home]');
      if (home) {
        const r = home.getBoundingClientRect();
        this.x = r.left + r.width / 2;
        this.y = r.top + r.height / 2;
      } else {
        this.x = window.innerWidth / 2;
        this.y = window.innerHeight * 0.2;
      }
      this.el.style.display = 'block';
      log('ui.cursor', { show: true }, { x: Math.round(this.x), y: Math.round(this.y), home: !!home });
    }
    this.place();
  }

  hide(): void {
    if (!this.active) return;
    this.active = false;
    this.el.style.display = 'none';
    this.setHover(null);
    log('ui.cursor', { show: false });
  }

  move(dx: number, dy: number): void {
    this.x = Math.min(window.innerWidth - 2, Math.max(0, this.x + dx));
    this.y = Math.min(window.innerHeight - 2, Math.max(0, this.y + dy));
    this.place();
  }

  /** 左クリック。カーソルの下にあるボタンやカードを押す。 */
  press(): void {
    const t = this.pick();
    log('ui.cursor.click', { x: Math.round(this.x), y: Math.round(this.y) }, { target: t ? describe(t) : null });
    if (t) t.click();
    // 押した結果で画面が作り直されることがあるので、下にある要素を調べ直す
    if (this.active) this.place();
  }

  /** ホイール。カーソルの下にあるスクロールできる領域を動かす（無ければいちばん手前の重ね画面）。 */
  scroll(dy: number): void {
    let e = document.elementFromPoint(this.x, this.y) as HTMLElement | null;
    while (e && e !== document.body) {
      const oy = getComputedStyle(e).overflowY;
      if ((oy === 'auto' || oy === 'scroll') && e.scrollHeight > e.clientHeight + 1) break;
      e = e.parentElement;
    }
    if (!e || e === document.body) {
      const all = document.querySelectorAll<HTMLElement>('.overlay');
      e = all.length ? all[all.length - 1] : null;
    }
    e?.scrollBy(0, dy);
    if (this.active) this.place();
  }

  private pick(): HTMLElement | null {
    const e = document.elementFromPoint(this.x, this.y);
    return e ? e.closest<HTMLElement>(CLICKABLE) : null;
  }

  private setHover(t: HTMLElement | null): void {
    if (t === this.hover) return;
    if (this.hover) {
      this.hover.classList.remove('vhover');
      this.hover.dispatchEvent(new MouseEvent('mouseleave'));
    }
    this.hover = t;
    if (t) {
      t.classList.add('vhover');
      t.dispatchEvent(new MouseEvent('mouseenter'));
    }
  }

  private place(): void {
    this.el.style.transform = `translate(${this.x.toFixed(1)}px, ${this.y.toFixed(1)}px)`;
    this.setHover(this.pick());
  }
}
