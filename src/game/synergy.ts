/**
 * スキル同士のつながり（シナジー）を求める。描画や物理に依存しない。
 * evo: 進化の組み合わせ / combo: 両方持つと起きる追加の効果 / boost: 強化（パッシブ）がこのスキルに効く
 */
import { COMBOS, ItemDef, ITEM_MAP, ITEMS, SKILL_MAP, SKILLS, STAT_LINKS } from './defs';

export type LinkKind = 'evo' | 'combo' | 'boost';

export interface SynergyLink {
  kind: LinkKind;
  /** 相手のスキルの id */
  other: string;
  /** 例: 進化「チョーク・ガトリング」 */
  title: string;
  desc: string;
}

const ORDER: Record<LinkKind, number> = { evo: 0, combo: 1, boost: 2 };

/** このスキルとつながるスキルをすべて返す（持っているかどうかは問わない）。 */
export function synergyLinks(id: string): SynergyLink[] {
  const def = SKILL_MAP[id];
  if (!def) return [];
  const out: SynergyLink[] = [];
  // 進化
  if (def.kind === 'active' && def.evo) {
    const partner = SKILL_MAP[def.evo.with];
    out.push({ kind: 'evo', other: def.evo.with, title: `進化「${def.evo.name}」`, desc: `Lv ${def.max} で「${partner?.name ?? def.evo.with}」を持っていると進化する。${def.evo.desc}` });
  }
  if (def.kind === 'passive') {
    for (const a of SKILLS) {
      if (a.evo?.with !== id) continue;
      out.push({ kind: 'evo', other: a.id, title: `進化「${a.evo.name}」`, desc: `「${a.name}」を Lv ${a.max} まで育てると進化する。${a.evo.desc}` });
    }
  }
  // コンボ
  for (const c of COMBOS) {
    if (c.a !== id && c.b !== id) continue;
    out.push({ kind: 'combo', other: c.a === id ? c.b : c.a, title: `コンボ「${c.name}」`, desc: c.desc });
  }
  // 強化の影響
  if (def.kind === 'active') {
    for (const l of STAT_LINKS) {
      if (!def.tags?.includes(l.tag)) continue;
      out.push({ kind: 'boost', other: l.passive, title: `${SKILL_MAP[l.passive].name}で強化`, desc: l.text });
    }
  } else {
    for (const l of STAT_LINKS) {
      if (l.passive !== id) continue;
      for (const a of SKILLS) {
        if (a.kind !== 'active' || !a.tags?.includes(l.tag)) continue;
        out.push({ kind: 'boost', other: a.id, title: `${a.name}を強化`, desc: l.text });
      }
    }
  }
  // 安定ソート: 種類の順。同じ種類の中では定義の順を保つ
  return out.map((l, i) => ({ l, i })).sort((x, y) => ORDER[x.l.kind] - ORDER[y.l.kind] || x.i - y.i).map((x) => x.l);
}

/** 持っているスキルとのつながりだけを返す。 */
export function linksWithOwned(id: string, owned: readonly string[]): SynergyLink[] {
  return synergyLinks(id).filter((l) => owned.includes(l.other));
}

/** アイテムと相性のよい攻撃スキル（ダメージの種類・性質・継続ダメージで決まる）。 */
export function itemLinks(itemId: string): SynergyLink[] {
  const it = ITEM_MAP[itemId];
  const L = it?.link;
  if (!L) return [];
  return SKILLS.filter((s) => {
    if (s.kind !== 'active') return false;
    if (L.kinds && s.dmg && L.kinds.includes(s.dmg.kind)) return true;
    if (L.tags && s.tags?.some((t) => L.tags!.includes(t))) return true;
    return !!(L.dot && s.dmg?.dot);
  }).map((s) => ({ kind: 'boost' as const, other: s.id, title: `${it.emoji}${it.name}と相性がよい`, desc: L.text }));
}

/** 攻撃スキルと相性のよいアイテム。 */
export function itemsForSkill(skillId: string): ItemDef[] {
  return ITEMS.filter((it) => itemLinks(it.id).some((l) => l.other === skillId));
}
