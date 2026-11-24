import { log } from '../log';

type Child = Node | string | null | undefined | false;

/** DOM 要素を作る小さな補助関数。 */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, unknown> | null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') e.className = String(v);
      else if (k === 'html') e.innerHTML = String(v);
      else if (k === 'style') e.setAttribute('style', String(v));
      else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v as EventListener);
      else if (k in e) (e as unknown as Record<string, unknown>)[k] = v;
      else e.setAttribute(k, String(v));
    }
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return e;
}

/** クリックを記録するボタン。 */
export function button(label: string, id: string, onClick: () => void, cls = 'btn'): HTMLButtonElement {
  return h('button', {
    class: cls,
    type: 'button',
    onclick: () => {
      log('ui.click', { id });
      onClick();
    },
  }, label);
}

export function clear(e: HTMLElement): void {
  while (e.firstChild) e.removeChild(e.firstChild);
}
