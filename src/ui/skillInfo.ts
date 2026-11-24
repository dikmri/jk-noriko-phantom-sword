/**
 * スキルの説明とシナジー（つながり）を見せる部品。
 * レベルアップ画面の「持っているスキル」欄、カードのシナジー欄、スキル図鑑。
 */
import { DMG_KINDS, ITEM_MAP, ITEM_SLOTS, ITEMS, Scope, SCOPE_INFO, SKILL_MAP, SKILLS, SkillDef } from '../game/defs';
import { BREAK_INFO, type BreakKind, type Owned } from '../game/rules';
import { itemLinks, itemsForSkill, linksWithOwned, LinkKind, SynergyLink, synergyLinks } from '../game/synergy';
import { log } from '../log';
import { button, clear, h } from './dom';

export interface OwnedSkills {
  actives: Owned[];
  passives: Owned[];
  items?: string[];
  /** アイテムの★ */
  itemLv?: Record<string, number>;
}

const KIND_ICON: Record<LinkKind, string> = { evo: '✨', combo: '🔗', boost: '⬆️' };
const KIND_LABEL: Record<LinkKind, string> = { evo: '進化', combo: 'コンボ', boost: '強化' };

export function ownedIds(o: OwnedSkills | null): string[] {
  return o ? [...o.actives.map((a) => a.id), ...o.passives.map((p) => p.id)] : [];
}

function chip(id: string): string {
  const d = SKILL_MAP[id] ?? ITEM_MAP[id];
  return d ? `${d.emoji}${d.name}` : id;
}

// ====================================================================== ダメージの種類
/** スキルのダメージの種類と反映率の札（例: ⚔️物理 AD 60%）。ダメージの無いスキルは null。 */
export function dmgBadge(id: string): HTMLElement | null {
  const d = SKILL_MAP[id]?.dmg;
  if (!d) return null;
  const k = DMG_KINDS[d.kind];
  const parts = [`${k.icon}${k.name}`];
  if (d.ad) parts.push(`AD ${Math.round(d.ad * 100)}%`);
  if (d.ap) parts.push(`AP ${Math.round(d.ap * 100)}%`);
  if (d.dot) parts.push(d.dot === 'bleed' ? '出血' : d.dot === 'burn' ? '燃焼' : '毒');
  return h('span', { class: `dmg-badge dmg-${d.kind}`, title: k.desc }, parts.join(' '));
}

// ====================================================================== 効く範囲
/** アイテムと強化の「効く範囲」の札（例: 🗡️棒の攻撃）。範囲の決まっていないものは null。 */
export function scopeBadge(id: string): HTMLElement | null {
  return scopeBadgeOf(ITEM_MAP[id]?.scope ?? (SKILL_MAP[id]?.kind === 'passive' ? SKILL_MAP[id].scope : undefined));
}

export function scopeBadgeOf(sc: readonly Scope[] | undefined): HTMLElement | null {
  if (!sc?.length) return null;
  return h('span', { class: 'scope-badges' }, ...sc.map((k) => h('span', { class: `scope-badge scope-${k}`, title: SCOPE_INFO[k].desc }, `${SCOPE_INFO[k].icon}${SCOPE_INFO[k].name}`)));
}

/** 用語の説明（レベルアップの画面とスキル帳の下に出す）。 */
export function scopeLegend(): HTMLElement {
  return h('div', { class: 'scope-legend' }, ...(['weapon', 'skill', 'all'] as const).map((k) => h('span', null, h('b', null, `${SCOPE_INFO[k].icon}${SCOPE_INFO[k].name}`), `＝${SCOPE_INFO[k].desc.replace(/だけに効く|に効く(?=（|$)/, '')}`)));
}

// ====================================================================== カードのシナジー欄
/**
 * 選択肢のカードに付ける「持っているスキルとのつながり」。つながりが無ければ null。
 * max 件まで書き、残りは件数だけ書く。
 */
export function cardSynergy(id: string, owned: OwnedSkills | null, max = 3): { el: HTMLElement; links: SynergyLink[] } | null {
  const items = owned?.items ?? [];
  const links = [
    ...linksWithOwned(id, ownedIds(owned)),
    ...itemsForSkill(id).filter((it) => items.includes(it.id)).map((it) => ({ kind: 'boost' as const, other: it.id, title: 'と相性がよい', desc: it.link?.text ?? '' })),
  ];
  if (!links.length) return null;
  const el = h('div', { class: 'lv-syn' }, h('div', { class: 'lv-syn-head' }, `🔗 持っているスキルとシナジー ${links.length}`));
  for (const l of links.slice(0, max)) {
    el.appendChild(h('div', { class: `lv-syn-row ${l.kind}` }, h('span', { class: 'lv-syn-icon' }, KIND_ICON[l.kind]), h('span', null, h('b', null, chip(l.other)), ` ${l.title}`, h('i', null, l.desc))));
  }
  if (links.length > max) el.appendChild(h('div', { class: 'lv-syn-more' }, `ほか ${links.length - max} 件（スキル図鑑で見られる）`));
  return { el, links };
}

/** アイテムのカードに付ける「持っているスキルとの相性」。 */
export function itemCardSynergy(itemId: string, owned: OwnedSkills | null, max = 3): { el: HTMLElement; links: SynergyLink[] } | null {
  const have = ownedIds(owned);
  const links = itemLinks(itemId).filter((l) => have.includes(l.other));
  if (!links.length) return null;
  const el = h('div', { class: 'lv-syn' }, h('div', { class: 'lv-syn-head' }, `🔗 持っているスキルと相性 ${links.length}`));
  for (const l of links.slice(0, max)) el.appendChild(h('div', { class: 'lv-syn-row boost' }, h('span', { class: 'lv-syn-icon' }, '⬆️'), h('span', null, h('b', null, chip(l.other)), h('i', null, l.desc))));
  if (links.length > max) el.appendChild(h('div', { class: 'lv-syn-more' }, `ほか ${links.length - max} 件`));
  return { el, links };
}

/** 一時停止画面の能力値の欄。 */
export function statsPanel(lines: [string, string][]): HTMLElement {
  return h('div', { class: 'own-panel stat-panel' }, h('div', { class: 'own-title' }, '能力値'), ...lines.map(([k, v]) => h('div', { class: 'stat-line' }, h('span', null, k), h('b', null, v))));
}

// ====================================================================== 持っているスキル欄
function evoStatus(def: SkillDef, o: Owned, owned: string[], items: string[] = []): HTMLElement | null {
  if (def.kind === 'active') {
    if (o.evolved) return h('div', { class: 'own-evo done' }, '★ 進化ずみ');
    if (!def.evo) return null;
    const lvOk = o.level >= def.max;
    // 校長の推薦状があれば、相手の強化はいらない
    const partnerOk = owned.includes(def.evo.with) || items.includes('suisen');
    return h('div', { class: 'own-evo' }, '進化: ', h('span', { class: lvOk ? 'ok' : '' }, `${lvOk ? '✔' : '・'}Lv ${def.max}`), ' ＋ ', h('span', { class: partnerOk ? 'ok' : '' }, `${partnerOk ? '✔' : '・'}${chip(def.evo.with)}`));
  }
  const evolves = SKILLS.filter((a) => a.evo?.with === def.id && owned.includes(a.id));
  if (!evolves.length) return null;
  return h('div', { class: 'own-evo' }, `進化させる: ${evolves.map((a) => chip(a.id)).join('、')}`);
}

/** 持っているスキルの一覧。highlight() で、つながるスキルの行を光らせる。 */
export function ownedPanel(owned: OwnedSkills): { el: HTMLElement; highlight: (links: SynergyLink[] | null) => void } {
  const ids = ownedIds(owned);
  const rows = new Map<string, { row: HTMLElement; note: HTMLElement }>();
  const list = h('div', { class: 'own-list' });
  const section = (title: string, items: Owned[], cap: number) => {
    list.appendChild(h('div', { class: 'own-sec' }, `${title}（${items.length}/${cap}）`));
    if (!items.length) list.appendChild(h('div', { class: 'own-empty' }, 'まだない'));
    for (const o of items) {
      const def = SKILL_MAP[o.id];
      if (!def) continue;
      const evo = o.evolved && def.evo;
      const note = h('div', { class: 'own-note' });
      const row = h('div', { class: `own-row${o.evolved ? ' evo' : ''}` },
        h('div', { class: 'own-emoji' }, evo ? def.evo!.emoji : def.emoji),
        h('div', { class: 'own-body' },
          h('div', { class: 'own-name' }, evo ? def.evo!.name : def.name, h('span', { class: 'own-lv' }, `${o.evolved ? '★' : `Lv ${o.level}/${def.max}`}${o.brk ? ` 突破+${o.brk}` : ''}`)),
          h('div', { class: 'own-desc' }, evo ? def.evo!.desc : def.desc),
          o.bk && o.brk ? h('div', { class: 'own-evo done' }, `突破: ${Object.entries(o.bk).filter(([, n]) => n).map(([k, n]) => `${BREAK_INFO[k as BreakKind].name}×${n}`).join('・')}`) : null,
          evoStatus(def, o, ids, owned.items ?? []),
          note,
        ),
      );
      rows.set(o.id, { row, note });
      list.appendChild(row);
    }
  };
  section('攻撃', owned.actives, 6);
  section('強化', owned.passives, 6);
  // アイテム
  const items = owned.items ?? [];
  list.appendChild(h('div', { class: 'own-sec' }, `アイテム（${items.length}/${ITEM_SLOTS}）`));
  if (!items.length) list.appendChild(h('div', { class: 'own-empty' }, '5 レベルごとと、ボスの宝箱で選べる。枠が埋まったら★を上げられる'));
  for (const id of items) {
    const it = ITEM_MAP[id];
    if (!it) continue;
    const note = h('div', { class: 'own-note' });
    const lv = owned.itemLv?.[id] ?? 1;
    const row = h('div', { class: 'own-row item' }, h('div', { class: 'own-emoji' }, it.emoji), h('div', { class: 'own-body' }, h('div', { class: 'own-name' }, it.name, h('span', { class: 'own-lv' }, '★'.repeat(lv))), scopeBadge(it.id), h('div', { class: 'own-desc' }, it.desc), note));
    rows.set(id, { row, note });
    list.appendChild(row);
  }
  const el = h('div', { class: 'own-panel' }, h('div', { class: 'own-title' }, '持っているスキル'), list);
  const highlight = (links: SynergyLink[] | null) => {
    for (const { row, note } of rows.values()) {
      row.classList.remove('link');
      clear(note);
    }
    if (!links) return;
    for (const l of links) {
      const r = rows.get(l.other);
      if (!r) continue;
      r.row.classList.add('link');
      r.note.appendChild(h('div', null, `${KIND_ICON[l.kind]} ${l.title}`));
    }
  };
  return { el, highlight };
}

// ====================================================================== スキル図鑑
type BookFilter = 'all' | 'active' | 'passive' | 'owned' | 'items';

/**
 * スキル図鑑を手前に重ねて開く。owned が null なら（タイトル画面から開いたとき）持っている印を付けない。
 * 閉じたら onClose を呼ぶ。戻り値は、外から閉じるための関数。
 */
export function showSkillBook(root: HTMLElement, owned: OwnedSkills | null, onClose: () => void, ui?: (k: 'move' | 'ok' | 'cancel') => void): () => void {
  const ids = ownedIds(owned);
  const levelOf = (id: string): Owned | undefined => owned?.actives.find((a) => a.id === id) ?? owned?.passives.find((p) => p.id === id);
  let filter: BookFilter = owned && ids.length ? 'owned' : 'all';
  let selected: string | null = null;
  const grid = h('div', { class: 'book-grid' });
  const cards = new Map<string, HTMLElement>();
  const el = h('div', { class: 'screen overlay book' });
  log('ui.book.open', { owned: ids.length });

  const linkLine = (kind: LinkKind, links: SynergyLink[]) => {
    const ls = links.filter((l) => l.kind === kind);
    if (!ls.length) return null;
    return h('div', { class: `book-links ${kind}` },
      h('span', { class: 'book-links-k' }, `${KIND_ICON[kind]} ${KIND_LABEL[kind]}`),
      ...ls.map((l) => h('span', { class: `book-link${ids.includes(l.other) ? ' have' : ''}`, title: l.desc }, chip(l.other), kind === 'boost' ? null : h('i', null, ` ${l.title.replace(/^(進化|コンボ)/, '')}`))),
    );
  };

  const card = (def: SkillDef) => {
    const o = levelOf(def.id);
    const links = synergyLinks(def.id);
    const combos = links.filter((l) => l.kind === 'combo');
    const c = h('div', { class: `book-card ${def.kind} ${def.rarity}${o ? ' have' : ''}`, 'data-click': '1', 'data-skill': def.id },
      h('div', { class: 'book-head' },
        h('span', { class: 'book-emoji' }, def.emoji),
        h('span', { class: 'book-name' }, def.name),
        h('span', { class: 'book-tag' }, o ? (o.evolved ? '★進化ずみ' : `Lv ${o.level}/${def.max}`) : def.kind === 'active' ? '攻撃' : '強化'),
      ),
      dmgBadge(def.id),
      scopeBadge(def.id),
      h('div', { class: 'book-desc' }, def.desc),
      def.kind === 'active' && itemsForSkill(def.id).length ? h('div', { class: 'book-links boost' }, h('span', { class: 'book-links-k' }, '🎒 相性のよいアイテム'), ...itemsForSkill(def.id).map((it) => h('span', { class: `book-link${owned?.items?.includes(it.id) ? ' have' : ''}`, title: it.desc }, `${it.emoji}${it.name}`))) : null,
      def.evo ? h('div', { class: 'book-evo' }, `✨ 進化: Lv ${def.max} ＋ ${chip(def.evo.with)} → ${def.evo.emoji}「${def.evo.name}」 ${def.evo.desc}`) : null,
      ...combos.map((l) => h('div', { class: 'book-combo' }, `🔗 ${chip(l.other)}と ${l.title}: ${l.desc}`)),
      def.kind === 'passive' ? linkLine('evo', links) : null,
      linkLine('boost', links),
    );
    c.addEventListener('click', () => {
      selected = selected === def.id ? null : def.id;
      ui?.('move');
      log('ui.book.select', { id: def.id }, { selected });
      refresh();
    });
    cards.set(def.id, c);
    return c;
  };

  /** アイテムの図鑑カード */
  const itemCard = (id: string) => {
    const it = ITEM_MAP[id];
    const have = owned?.items?.includes(id);
    const links = itemLinks(id);
    return h('div', { class: `book-card item ${it.rarity}${have ? ' have' : ''}` },
      h('div', { class: 'book-head' }, h('span', { class: 'book-emoji' }, it.emoji), h('span', { class: 'book-name' }, it.name), h('span', { class: 'book-tag' }, have ? '持っている' : 'アイテム')),
      scopeBadge(id),
      h('div', { class: 'book-desc' }, it.desc),
      links.length ? h('div', { class: 'book-links boost' }, h('span', { class: 'book-links-k' }, `⬆️ ${it.link?.text ?? ''}`), ...links.slice(0, 12).map((l) => h('span', { class: `book-link${ids.includes(l.other) ? ' have' : ''}` }, chip(l.other))), links.length > 12 ? h('span', null, `ほか ${links.length - 12}`) : null) : null,
    );
  };

  const refresh = () => {
    clear(grid);
    for (const [k, b] of tabs) b.classList.toggle('on', k === filter);
    if (filter === 'items') {
      grid.appendChild(h('div', { class: 'book-legend' }, ...Object.values(DMG_KINDS).map((k) => h('span', { title: k.desc }, `${k.icon}${k.name}: ${k.desc}`))));
      // 効く範囲の印の説明
      grid.appendChild(h('div', { class: 'book-legend' }, ...Object.values(SCOPE_INFO).map((k) => h('span', null, `${k.icon}${k.name}: ${k.desc}`))));
      for (const it of ITEMS) grid.appendChild(itemCard(it.id));
      return;
    }
    const shown = SKILLS.filter((s) => filter === 'all' || (filter === 'owned' ? ids.includes(s.id) : s.kind === filter));
    // 攻撃 → 強化の順。持っているものを先に
    shown.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'active' ? -1 : 1) || Number(ids.includes(b.id)) - Number(ids.includes(a.id)));
    const rel = new Set(selected ? synergyLinks(selected).map((l) => l.other) : []);
    for (const s of shown) {
      const c = cards.get(s.id) ?? card(s);
      c.classList.toggle('sel', s.id === selected);
      c.classList.toggle('rel', rel.has(s.id));
      c.classList.toggle('dim', !!selected && s.id !== selected && !rel.has(s.id));
      grid.appendChild(c);
    }
    if (!shown.length) grid.appendChild(h('div', { class: 'own-empty' }, 'まだスキルを持っていない'));
    for (const [k, b] of tabs) b.classList.toggle('on', k === filter);
  };

  const tabs = new Map<BookFilter, HTMLButtonElement>();
  const tabRow = h('div', { class: 'book-tabs' });
  const addTab = (k: BookFilter, label: string) => {
    const b = button(label, `book.tab.${k}`, () => {
      filter = k;
      ui?.('move');
      refresh();
    }, 'btn small');
    tabs.set(k, b);
    tabRow.appendChild(b);
  };
  if (owned) addTab('owned', '持っているもの');
  addTab('all', 'すべて');
  addTab('active', '攻撃');
  addTab('passive', '強化');
  addTab('items', 'アイテムとダメージの種類');

  const close = () => {
    window.removeEventListener('keydown', key, true);
    el.remove();
    log('ui.book.close', {});
    onClose();
  };
  // 図鑑を開いている間は、後ろの画面にキーを渡さない
  const key = (e: KeyboardEvent) => {
    e.stopImmediatePropagation();
    if (e.code === 'Escape' || e.code === 'Tab') {
      e.preventDefault();
      ui?.('cancel');
      close();
    }
  };
  window.addEventListener('keydown', key, true);

  el.append(
    h('div', { class: 'lv-title', 'data-cursor-home': '1' }, 'スキル図鑑'),
    h('div', { class: 'lv-sub' }, 'スキルをクリックすると、つながるスキルが光る。✨進化 🔗コンボ ⬆️強化'),
    tabRow,
    grid,
    h('div', { class: 'lv-foot' }, button('とじる（Tab / Esc）', 'book.close', () => {
      ui?.('cancel');
      close();
    }, 'btn primary')),
  );
  root.appendChild(el);
  refresh();
  return close;
}
