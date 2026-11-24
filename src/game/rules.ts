/**
 * ゲームの決まりごとのうち、描画や物理に依存しない計算（純粋ロジック）。
 * ダメージ、能力値、レベルアップの選択肢、建物の支えの判定。
 */
import { clamp } from '../core/vec';
import { DmgKind, ENDLESS_FINALS, ITEM_MAP, ITEM_SLOTS, ITEMS, MAX_ACTIVES, MAX_PASSIVES, Rarity, ShopLevels, SKILL_MAP, SkillDmg, SKILLS, Stats, TUNE, WeaponDef } from './defs';

// ------------------------------------------------------------------ 乱数
/** 種から同じ並びを作れる乱数（mulberry32）。 */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------------------ ダメージ
/**
 * 武器の先端の動きから「当たりの強さ」を求める。
 * perpSpeed: 武器の軸に垂直な方向の速さ（斬る）、axialSpeed: 軸方向の速さ（突く）。
 */
export function effectiveSpeed(perpSpeed: number, axialSpeed: number): number {
  return perpSpeed + Math.max(0, axialSpeed) * TUNE.thrustWeight;
}

/** 当たりの強さに応じたダメージ倍率。遅い当たりは弱く、速い当たりは強い。上下限あり。 */
export function speedFactor(speed: number, refSpeed: number): number {
  return clamp(speed / Math.max(0.1, refSpeed), TUNE.speedFactorMin, TUNE.speedFactorMax);
}

export interface HitResult {
  damage: number;
  crit: boolean;
  /** 敵に与える速度の変化（m/s 相当。敵の重さで割る前の力） */
  impulse: number;
  hitStop: number;
}

/**
 * 武器が当たったときのダメージ・吹き飛ばす力・ヒットストップ。roll は 0..1 の乱数。
 * bonusDamage は武器の威力への上乗せ（「棒、育つ」で増えた分）。
 */
export function weaponHit(weapon: WeaponDef, stats: Stats, speed: number, roll: number, dealtMul = 1, bonusDamage = 0): HitResult {
  const f = speedFactor(speed, weapon.refSpeed);
  const crit = roll < stats.crit;
  const damage = (weapon.damage + bonusDamage + stats.ad) * stats.power * stats.weaponMul * f * (crit ? stats.critDmg : 1) * dealtMul;
  const impulse = weapon.mass * stats.weaponMass * Math.max(speed, weapon.refSpeed * 0.5) * TUNE.knockScale * stats.knockback * (crit ? 1.4 : 1);
  const hitStop = Math.min(TUNE.hitStopMax, TUNE.hitStopBase + damage * TUNE.hitStopPerDamage + (crit ? 0.025 : 0));
  return { damage, crit, impulse, hitStop };
}

// ------------------------------------------------------------------ 能力値
export interface Owned {
  id: string;
  level: number;
  evolved?: boolean;
  /** 限界突破した回数 */
  brk?: number;
  /** 攻撃スキルの限界突破: 種類ごとの回数 */
  bk?: Partial<Record<BreakKind, number>>;
}

/** 攻撃スキルの限界突破の種類。dmg: 威力 / cd: 待ち時間 / area: 範囲 / amt: 数 */
export type BreakKind = 'dmg' | 'cd' | 'area' | 'amt';
/**
 * 攻撃スキルの限界突破の、種類ごとの上限。威力は上限なし（いつまでも強くなれる）。
 * 待ち時間と範囲は 6 回まで（待ち時間 ×0.61・範囲 +72%）、数は 3 回まで。
 */
export const BREAK_KIND_MAX: Record<BreakKind, number> = { dmg: Infinity, cd: 6, area: 6, amt: 3 };
/** 強化の限界突破の上限（PASSIVE_UNLIMITED の強化は上限なし） */
export const BREAK_MAX_PASSIVE = 5;
/** 数を増やす突破は 3 回まで */
export const BREAK_AMT_MAX = BREAK_KIND_MAX.amt;
/**
 * 数値が伸び続けても壊れない強化（限界突破の上限なし）。
 * 待ち時間・会心率・移動速度・範囲のように上限のある値や、増えすぎると遊べなくなる値の強化は入れない。
 */
export const PASSIVE_UNLIMITED: ReadonlySet<string> = new Set(['kintore', 'kyushoku', 'hoken', 'taisougi', 'udetate', 'mahou', 'tomato', 'gabyou', 'hizageri', 'yofukashi', 'bankuruwase', 'naishin', 'hayaoki', 'zekkouchou', 'kakemochi', 'anki', 'asaren']);

/** 棒を鍛えた段階 lv による、棒の威力の倍率（1 段で +10%、上限なし）と、振る速さの倍率（1 段で +1.5%、+30% まで）。 */
export function weaponTrain(lv: number): { dmg: number; swing: number } {
  const n = Math.max(0, lv);
  return { dmg: 1 + 0.1 * n, swing: 1 + Math.min(0.3, 0.015 * n) };
}
export const BREAK_INFO: Record<BreakKind, { name: string; text: string }> = {
  dmg: { name: '威力', text: '威力 +20%' },
  cd: { name: '待ち時間', text: '待ち時間 -8%' },
  area: { name: '範囲', text: '範囲 +12%' },
  amt: { name: '数', text: '出る数 +1' },
};

/** 限界突破の回数から、スキルにかける倍率を求める。 */
export function breakMul(bk: Partial<Record<BreakKind, number>> | undefined): { dmg: number; cd: number; area: number; amt: number } {
  const n = (k: BreakKind) => bk?.[k] ?? 0;
  return { dmg: 1 + 0.2 * n('dmg'), cd: Math.pow(0.92, n('cd')), area: 1 + 0.12 * n('area'), amt: n('amt') };
}

/** アイテムの★の上限と、★による数値の倍率（★2 で 1.5 倍、★3 で 2 倍、★5 で 3 倍）。 */
export const ITEM_MAX_LV = 5;
export function itemPow(lv: number | undefined): number {
  return 1 + 0.5 * (Math.max(1, lv ?? 1) - 1);
}

export function baseStats(): Stats {
  return {
    power: 1, attackSpeed: 1, moveSpeed: 1, maxHp: TUNE.playerHp, regen: 0, magnet: 1, area: 1, cooldown: 1,
    crit: 0, knockback: 1, xpGain: 1, amount: 0, luck: 0, revive: 0, weaponLength: 1, damageTaken: 1,
    weaponMass: 1, dashCooldown: 1, dashBump: 0, killHeal: 0, thorns: 0,
    ad: 0, ap: 0, armorPen: 0, magicPen: 0, physDef: 0, magicDef: 0, critDmg: 2, impactMul: 1, dotMul: 1, slamMul: 1, lifesteal: 0, envResist: 0, coinMul: 1,
    skillMul: 1, apMul: 1, projSpeed: 1, projKnock: 1, bigMul: 1, momentum: 0, overkill: 0,
    dashCharges: 1, dashSpeed: 1, xpHeal: 0, fullHp: 0, weaponMul: 1,
  };
}

/**
 * 持っている強化・購買部で買った強化・持っているアイテムから能力値を求める。
 * 強化の限界突破は、1 回で通常の 1 レベルの半分の効果。itemLv はアイテムの★（無ければ ★1）。
 */
export function computeStats(passives: Owned[], shop: ShopLevels, items: readonly string[] = [], itemLv: Readonly<Record<string, number>> = {}): Stats {
  const s = baseStats();
  const lv = (id: string) => {
    const p = passives.find((o) => o.id === id);
    return p ? p.level + 0.5 * (p.brk ?? 0) : 0;
  };
  s.power *= 1 + 0.12 * lv('kintore') + 0.05 * shop.power;
  s.attackSpeed *= 1 + 0.09 * lv('hayaben');
  s.moveSpeed *= 1 + 0.08 * lv('dash') + 0.03 * shop.speed;
  s.maxHp += 20 * lv('kyushoku') + 10 * shop.hp;
  s.regen += 0.6 * lv('hoken');
  s.magnet *= 1 + 0.35 * lv('jishaku') + 0.1 * shop.magnet;
  s.area *= 1 + 0.1 * lv('mousou');
  s.cooldown *= Math.max(0.4, 1 - 0.07 * lv('shuuchuu'));
  s.crit += 0.06 * lv('kiai');
  s.knockback *= 1 + 0.2 * lv('atsuzoko');
  s.xpGain *= 1 + 0.1 * lv('naishin') + 0.05 * shop.xp;
  s.amount += lv('copy');
  s.luck += 0.15 * lv('un');
  s.physDef += 15 * lv('taisougi');
  s.magicDef += 10 * lv('taisougi');
  s.ad += 6 * lv('udetate');
  s.ap += 12 * lv('mahou');
  s.revive += lv('konjou') + shop.revive;
  s.weaponLength *= 1 + 0.12 * lv('chuuni');
  s.weaponMass *= 1 + 0.25 * lv('omoi');
  s.dashCooldown *= Math.max(0.3, 1 - 0.15 * lv('yokotobi'));
  s.dashBump = lv('yokotobi') > 0 ? 6 + 2 * lv('yokotobi') : 0;
  s.killHeal = 2 * lv('tomato');
  s.thorns = lv('gabyou') > 0 ? 4 + 8 * lv('gabyou') : 0;
  s.impactMul *= 1 + 0.12 * lv('hizageri');
  s.dotMul *= 1 + 0.12 * lv('yofukashi');
  s.crit += 0.02 * lv('megane');
  s.critDmg += 0.15 * lv('megane');
  s.projSpeed *= 1 + 0.12 * lv('kata');
  s.projKnock *= 1 + 0.15 * lv('kata');
  s.bigMul *= 1 + 0.1 * lv('bankuruwase');
  s.momentum = 0.02 * lv('norinori');
  s.overkill = lv('yatsuatari') > 0 ? 0.3 + 0.1 * lv('yatsuatari') : 0;
  s.dashCharges = 1 + Math.floor(lv('idaten'));
  s.dashSpeed *= 1 + 0.1 * lv('idaten');
  s.xpHeal = 0.3 * lv('hayaoki');
  s.fullHp = 0.08 * lv('zekkouchou');
  s.skillMul *= 1 + 0.08 * lv('anki');
  s.weaponMul *= 1 + 0.1 * lv('asaren');
  // アイテム: 割合のものは掛け算、そのほかは足し算。★と「部活の掛け持ち」で数値が増える（短所は増えない）
  const MUL = new Set(['cooldown', 'area', 'moveSpeed', 'weaponMass', 'knockback', 'impactMul', 'dotMul', 'slamMul', 'coinMul', 'power', 'damageTaken', 'skillMul', 'apMul', 'attackSpeed', 'weaponMul', 'xpGain']);
  const boost = 1 + 0.06 * lv('kakemochi');
  const add = (k: keyof Stats, v: number) => {
    if (MUL.has(k)) s[k] *= 1 + v;
    else s[k] += v;
  };
  for (const id of items) {
    const def = ITEM_MAP[id];
    if (!def) continue;
    const pow = itemPow(itemLv[id]) * boost;
    // 飛び道具の数は整数のまま（★や掛け持ちでは増えない）
    for (const [k, v] of Object.entries(def.stats ?? {}) as [keyof Stats, number][]) add(k, k === 'amount' ? v : v * pow);
    for (const [k, v] of Object.entries(def.cost ?? {}) as [keyof Stats, number][]) add(k, v);
  }
  s.ap *= s.apMul;
  // 几帳面なノート: 会心が出ない
  if (items.includes('note')) s.crit = 0;
  s.cooldown = Math.max(0.3, s.cooldown);
  s.armorPen = Math.min(0.8, s.armorPen);
  s.magicPen = Math.min(0.8, s.magicPen);
  s.envResist = Math.min(0.9, s.envResist);
  return s;
}

/**
 * 防御による倍率（LoL と同じ式: 100 / (100 + 防御)）。pen は貫通（防御を割合で減らす）。
 * 衝撃には物理防御が半分だけ効く。トゥルーは減らない。
 */
export function mitigate(kind: DmgKind, armor: number, mr: number, armorPen: number, magicPen: number): number {
  if (kind === 'true') return 1;
  if (kind === 'magic') return 100 / (100 + Math.max(0, mr * (1 - magicPen)));
  const a = Math.max(0, armor * (1 - armorPen)) * (kind === 'impact' ? 0.5 : 1);
  return 100 / (100 + a);
}

/** 反映率によるスキルの威力の倍率。AD・AP が 1 上がるごとに、反映率 × 1% 強くなる。 */
export function skillScale(dmg: SkillDmg | undefined, ad: number, ap: number): number {
  if (!dmg) return 1;
  return 1 + ((dmg.ad ?? 0) * ad + (dmg.ap ?? 0) * ap) / 100;
}

/** 5 レベルごとのレベルアップは、スキルではなくアイテムを選ぶ回になる。 */
export function isItemLevel(level: number): boolean {
  return level >= 5 && level % 5 === 0;
}

/** 持っていないアイテムから n 個選ぶ（めずらしいものは出にくい）。枠が埋まっていれば空。 */
export function rollItems(owned: readonly string[], rng: () => number, n: number): string[] {
  if (owned.length >= ITEM_SLOTS) return [];
  const pool = ITEMS.filter((i) => !owned.includes(i.id)).map((i) => ({ id: i.id, w: RARITY_WEIGHT[i.rarity] }));
  const out: string[] = [];
  while (out.length < n && pool.length) {
    const total = pool.reduce((a, p) => a + p.w, 0);
    let r = rng() * total;
    let idx = pool.length - 1;
    for (let i = 0; i < pool.length; i++) {
      r -= pool[i].w;
      if (r <= 0) {
        idx = i;
        break;
      }
    }
    out.push(pool[idx].id);
    pool.splice(idx, 1);
  }
  return out;
}

/**
 * アイテムを選ぶ回の選択肢。枠が空いていれば新しいアイテムと★上げ、埋まっていれば★上げだけ。
 * ★が上限のアイテムは出ない。選べるものが無ければ空。
 */
export function rollItemChoices(owned: readonly string[], lv: Readonly<Record<string, number>>, rng: () => number, n: number, slots = ITEM_SLOTS): Choice[] {
  const pool: { choice: Choice; w: number }[] = [];
  const open = owned.length < slots;
  if (open) for (const i of ITEMS) if (!owned.includes(i.id)) pool.push({ choice: { kind: 'item', id: i.id, level: 1 }, w: RARITY_WEIGHT[i.rarity] });
  for (const id of owned) {
    const cur = lv[id] ?? 1;
    if (cur < ITEM_MAX_LV && ITEM_MAP[id]?.star !== false) pool.push({ choice: { kind: 'itemup', id, level: cur + 1 }, w: open ? 0.6 : 1 });
  }
  const out: Choice[] = [];
  while (out.length < n && pool.length) {
    const total = pool.reduce((a, p) => a + p.w, 0);
    let r = rng() * total;
    let idx = pool.length - 1;
    for (let i = 0; i < pool.length; i++) {
      r -= pool[i].w;
      if (r <= 0) {
        idx = i;
        break;
      }
    }
    out.push(pool[idx].choice);
    pool.splice(idx, 1);
  }
  return out;
}

/**
 * 「棒、育つ」で、武器が敵に 1 回当たったときに増える威力。
 * 殴るたびに +1（進化後は +3）。とどめを刺したときは Lv-1 を上乗せ（進化後は +6）。
 */
export function growGain(level: number, evolved: boolean, kill: boolean): number {
  if (evolved) return 3 + (kill ? 6 : 0);
  return 1 + (kill ? Math.max(0, level - 1) : 0);
}

/** 受けるダメージ。物理防御・魔法防御で減らすが、1 未満にはならない。 */
export function damageTaken(raw: number, stats: Stats, takenMul = 1, kind: 'phys' | 'magic' = 'phys'): number {
  const def = kind === 'magic' ? stats.magicDef : stats.physDef;
  return Math.max(1, (raw * takenMul * stats.damageTaken * 100) / (100 + Math.max(0, def)));
}

// ------------------------------------------------------------------ レベルアップの選択肢
export interface Choice {
  /** break: 限界突破 / item: 新しいアイテム / itemup: 持っているアイテムの★を上げる / weapon: 棒を鍛える */
  kind: 'new' | 'up' | 'evolve' | 'bonus' | 'item' | 'itemup' | 'break' | 'weapon';
  id: string;
  /** 選んだあとのレベル（限界突破は突破の回数、アイテムは★） */
  level: number;
  /** 攻撃スキルの限界突破の種類 */
  sub?: BreakKind;
}

export interface ChoiceState {
  actives: Owned[];
  passives: Owned[];
  banished: string[];
  luck: number;
  /** 持っているアイテム（校長の推薦状で進化の条件が変わる） */
  items?: readonly string[];
  /** 棒を鍛えた段階 */
  weaponLv?: number;
}

const RARITY_WEIGHT: Record<Rarity, number> = { common: 1, rare: 0.5, epic: 0.2 };

/** いま選べるものをすべて、重みつきで並べる。 */
export function choicePool(st: ChoiceState): { choice: Choice; weight: number }[] {
  const pool: { choice: Choice; weight: number }[] = [];
  const ownedA = new Map(st.actives.map((o) => [o.id, o]));
  const ownedP = new Map(st.passives.map((o) => [o.id, o]));
  for (const def of SKILLS) {
    const owned = def.kind === 'active' ? ownedA.get(def.id) : ownedP.get(def.id);
    if (owned) {
      const brk = owned.brk ?? 0;
      if (owned.level < def.max) {
        pool.push({ choice: { kind: 'up', id: def.id, level: owned.level + 1 }, weight: 1.5 });
      } else if (def.evo && !owned.evolved && (ownedP.has(def.evo.with) || st.items?.includes('suisen'))) {
        pool.push({ choice: { kind: 'evolve', id: def.id, level: owned.level }, weight: 8 });
      } else if (def.kind === 'active') {
        // 威力の突破には上限が無いので、攻撃スキルはいつでも突破できる
        pool.push({ choice: { kind: 'break', id: def.id, level: brk + 1 }, weight: 0.9 });
      } else if (def.kind === 'passive' && def.max >= 3 && (brk < BREAK_MAX_PASSIVE || PASSIVE_UNLIMITED.has(def.id))) {
        pool.push({ choice: { kind: 'break', id: def.id, level: brk + 1 }, weight: 0.6 });
      }
      continue;
    }
    if (st.banished.includes(def.id)) continue;
    const full = def.kind === 'active' ? st.actives.length >= MAX_ACTIVES : st.passives.length >= MAX_PASSIVES;
    if (full) continue;
    const lucky = def.rarity === 'common' ? 1 : 1 + st.luck * 1.5;
    pool.push({ choice: { kind: 'new', id: def.id, level: 1 }, weight: RARITY_WEIGHT[def.rarity] * lucky });
  }
  // 棒を鍛える: いつでも選べる（上限なし）
  pool.push({ choice: { kind: 'weapon', id: 'weapon', level: (st.weaponLv ?? 0) + 1 }, weight: 0.45 });
  return pool;
}

/** レベルアップで出す選択肢を n 個選ぶ。重複しない。足りない分はおまけ（回復・コイン）で埋める。 */
export function rollChoices(st: ChoiceState, rng: () => number, n: number): Choice[] {
  const pool = choicePool(st);
  const out: Choice[] = [];
  while (out.length < n && pool.length > 0) {
    const total = pool.reduce((a, p) => a + p.weight, 0);
    let r = rng() * total;
    let idx = pool.length - 1;
    for (let i = 0; i < pool.length; i++) {
      r -= pool[i].weight;
      if (r <= 0) {
        idx = i;
        break;
      }
    }
    const c = pool[idx].choice;
    pool.splice(idx, 1);
    // 攻撃スキルの限界突破は、種類をここで決める
    const def = SKILL_MAP[c.id];
    if (c.kind === 'break' && def.kind === 'active') {
      const owned = st.actives.find((o) => o.id === c.id);
      const n = (k: BreakKind) => owned?.bk?.[k] ?? 0;
      const subs: BreakKind[] = ['dmg'];
      if (n('cd') < BREAK_KIND_MAX.cd) subs.push('cd');
      if (n('area') < BREAK_KIND_MAX.area) subs.push('area');
      if (def.tags?.includes('amount') && n('amt') < BREAK_KIND_MAX.amt) subs.push('amt');
      out.push({ ...c, sub: subs[Math.floor(rng() * subs.length)] });
    } else out.push(c);
  }
  const bonus = ['heal', 'coins'];
  let b = 0;
  while (out.length < n && b < bonus.length) out.push({ kind: 'bonus', id: bonus[b++], level: 0 });
  return out;
}

/** 選択肢を適用した後の所持スキル。 */
export function applyChoice(st: ChoiceState, c: Choice): ChoiceState {
  const actives = st.actives.map((o) => ({ ...o }));
  const passives = st.passives.map((o) => ({ ...o }));
  const def = SKILL_MAP[c.id];
  if (def && c.kind !== 'bonus') {
    const list = def.kind === 'active' ? actives : passives;
    const cur = list.find((o) => o.id === c.id);
    if (c.kind === 'new' && !cur) list.push({ id: c.id, level: 1 });
    else if (c.kind === 'up' && cur) cur.level = Math.min(def.max, cur.level + 1);
    else if (c.kind === 'evolve' && cur) cur.evolved = true;
    else if (c.kind === 'break' && cur) {
      cur.brk = (cur.brk ?? 0) + 1;
      if (c.sub) cur.bk = { ...cur.bk, [c.sub]: (cur.bk?.[c.sub] ?? 0) + 1 };
    }
  }
  if (c.kind === 'weapon') return { ...st, actives, passives, weaponLv: (st.weaponLv ?? 0) + 1 };
  return { ...st, actives, passives };
}

// ------------------------------------------------------------------ 建物の支え
export interface SupportNode {
  alive: boolean;
  /** 地面に直接乗っているか */
  grounded: boolean;
  /** 真下で支えている部品の番号 */
  below: number[];
  /** 横につながっている部品の番号 */
  side: number[];
  /** 柱（下まで積み上がった部品）から、横に何個ぶん離れていても落ちないか */
  span: number;
}

/**
 * 支えを失った部品の番号を返す。
 * 下が地面まで積み上がっている部品（柱）は残る。柱から横に span 個以内でつながる部品も残る。
 */
export function findUnsupported(nodes: SupportNode[]): number[] {
  const n = nodes.length;
  const column = new Uint8Array(n);
  const above: number[][] = Array.from({ length: n }, () => []);
  for (let i = 0; i < n; i++) for (const b of nodes[i].below) above[b].push(i);
  const queue: number[] = [];
  for (let i = 0; i < n; i++) {
    if (nodes[i].alive && nodes[i].grounded) {
      column[i] = 1;
      queue.push(i);
    }
  }
  for (let q = 0; q < queue.length; q++) {
    for (const a of above[queue[q]]) {
      if (!column[a] && nodes[a].alive) {
        column[a] = 1;
        queue.push(a);
      }
    }
  }
  const dist = new Int32Array(n).fill(1 << 30);
  const bfs: number[] = [];
  for (let i = 0; i < n; i++) {
    if (column[i]) {
      dist[i] = 0;
      bfs.push(i);
    }
  }
  for (let q = 0; q < bfs.length; q++) {
    const i = bfs[q];
    for (const s of nodes[i].side) {
      if (nodes[s].alive && dist[s] > dist[i] + 1) {
        dist[s] = dist[i] + 1;
        bfs.push(s);
      }
    }
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (nodes[i].alive && dist[i] > nodes[i].span) out.push(i);
  return out;
}

// ------------------------------------------------------------------ 弾の予測と方角
/**
 * 等速で飛ぶ弾が、的にいちばん近づくまでの秒数 t と、そのときの距離 miss を返す。
 * rel は「的の位置 − 弾の位置」。遠ざかっている弾と止まっている弾は null。
 */
export function shotThreat(rel: { x: number; y: number; z: number }, vel: { x: number; y: number; z: number }): { t: number; miss: number } | null {
  const sp = Math.hypot(vel.x, vel.y, vel.z);
  if (sp < 1e-6) return null;
  const along = (rel.x * vel.x + rel.y * vel.y + rel.z * vel.z) / sp;
  if (along <= 0) return null;
  const d2 = rel.x * rel.x + rel.y * rel.y + rel.z * rel.z;
  return { t: along / sp, miss: Math.sqrt(Math.max(0, d2 - along * along)) };
}

/**
 * プレイヤーから見て (dx, dz) の方向にある物が、画面上でどちら側にあるかを角度で返す。
 * 0 = 正面（画面の上側）、+π/2 = 右、±π = 真後ろ、-π/2 = 左。camYaw 0 のときカメラは +Z を向き、右は -X。
 */
export function screenBearing(dx: number, dz: number, camYaw: number): number {
  const s = Math.sin(camYaw);
  const c = Math.cos(camYaw);
  return Math.atan2(-dx * c + dz * s, dx * s + dz * c);
}

// ------------------------------------------------------------------ 第 2 弾のスキルとアイテムの計算
/**
 * レベルアップの選択肢の枚数。職員室の合鍵で 1 枚、運 0.45 以上（幸運のお守り Lv3）でさらに 1 枚増える。
 * 0.15 × 3 は小数の誤差で 0.4499… になるので、少しだけ余裕を持たせて比べる。
 */
export function choiceCount(items: readonly string[], luck = 0): number {
  return 3 + (items.includes('aikagi') ? 1 : 0) + (luck >= 0.45 - 1e-9 ? 1 : 0);
}

/** 優勝トロフィー: たまった数による与えるダメージの倍率（1 つ 2%、25 で頭打ち）。 */
export function trophyMul(stacks: number): number {
  return 1 + 0.02 * Math.min(25, Math.max(0, stacks));
}

/** 学級日誌: 最大 HP の 10% を超えた分を減らす。pow はアイテムの強さ（★）。減らす割合は 50% × pow で、80% まで。 */
export function nisshiCut(dmg: number, maxHp: number, pow: number): number {
  const cap = maxHp * 0.1;
  if (dmg <= cap) return dmg;
  return cap + (dmg - cap) * (1 - Math.min(0.8, 0.5 * pow));
}

/** 紙飛行機の遠投: 飛んだ距離による威力の倍率（24m で 3 倍、それより先は 3 倍のまま）。 */
export function planeScale(dist: number): number {
  return Math.min(3, 1 + Math.max(0, dist) / 12);
}

/** 紙飛行機の遠投: 飛んだ距離による気絶の秒数（最大 3 秒。ボスは 3 割）。 */
export function planeStun(dist: number, boss: boolean): number {
  return Math.min(3, 0.5 + Math.max(0, dist) / 10) * (boss ? 0.3 : 1);
}

export type Omikuji = 'daikichi' | 'kichi' | 'shokichi' | 'kyo';
/**
 * おみくじの結果。r は 0..1 の乱数、luck は運（幸運のお守りで 1 レベル 0.15）。
 * 大吉 10%（運 1 につき +10%）、吉 30%、小吉 35%、残りが凶。進化（大大吉）すると凶が出ず、大吉が 35%。
 */
export function omikujiDraw(r: number, luck: number, evolved: boolean): Omikuji {
  const dai = evolved ? 0.35 : 0.1 + 0.1 * Math.max(0, luck);
  if (r < dai) return 'daikichi';
  if (r < dai + 0.3) return 'kichi';
  if (evolved || r < dai + 0.65) return 'shokichi';
  return 'kyo';
}

// ------------------------------------------------------------------ 第 3 弾のスキルとアイテムの計算
/** 双眼鏡: 飛び道具が飛んだ距離による倍率（20m で +40%、それより先は同じ）。pow はアイテムの強さ（★）。 */
export function farShotMul(dist: number, pow: number): number {
  return 1 + Math.min(0.4, 0.02 * Math.max(0, dist)) * pow;
}

/** サングラス: 最大 HP が多い敵ほど強い（5000 分の 1 ずつ、+20% まで）。ボスはさらに +10%。 */
export function sunglassMul(maxHp: number, boss: boolean): number {
  return 1 + Math.min(0.2, Math.max(0, maxHp) / 5000) + (boss ? 0.1 : 0);
}

/** 応援団の旗: たまった守りによる、受けるダメージの倍率（1 つ 1%、20 まで。★の伸びは 1.5 倍まで）。 */
export function fortifyCut(stacks: number, pow: number): number {
  return 1 - 0.01 * Math.min(20, Math.max(0, stacks)) * Math.min(2.5, pow);
}

/** 角度を -π..π に直す。 */
function wrapAngle(a: number): number {
  let x = (a + Math.PI) % (Math.PI * 2);
  if (x < 0) x += Math.PI * 2;
  return x - Math.PI;
}

/** 大縄跳び: 縄が角度 a0 から a1 へ回る間に、角度 x を通ったか（どちら回りでも、一周をまたいでもよい。1 回の動きは半周未満）。 */
export function angleSwept(a0: number, a1: number, x: number): boolean {
  const d = wrapAngle(a1 - a0);
  const p = wrapAngle(x - a0);
  return d >= 0 ? p >= 0 && p <= d : p <= 0 && p >= d;
}

/** 置き土産: 破裂の威力（レベルと、倒れた敵の最大 HP の 6%。HP の分は 200 まで）。 */
export function miyageDmg(level: number, maxHp: number): number {
  return 12 + 5 * level + Math.min(200, 0.06 * Math.max(0, maxHp));
}

// ------------------------------------------------------------------ カメラ
/**
 * カメラの注視点の高さを、キャラの高さへ近づける。小さな段差はゆっくり追い、
 * 落下や打ち上げで大きくずれたときは、遅れを maxLag(m) までに抑える
 * （以前は遅れに上限が無く、13m 落ちるとカメラがふだんの 3 倍近く高い所から見下ろしていた）。
 */
export function camFollowY(cur: number, want: number, real: number, maxLag = 0.8): number {
  const y = cur + (want - cur) * Math.min(1, real * 6);
  return Math.max(want - maxLag, Math.min(want + maxLag, y));
}

/** カメラが地面の下に入らない高さ。地面の高さを基準にする（海抜 0 を基準にすると、採石場の底でカメラが空高く上がる）。 */
export function camFloorY(camY: number, ground: number, clear = 0.4): number {
  return Math.max(ground + clear, camY);
}

/**
 * カメラの後ろが崖や壁でふさがれているとき、どれだけ上へ持ち上げるか。
 * hitAt(pitch) はその角度でカメラへ向かう線が物に当たる距離（当たらなければ Infinity）。
 * 上へ持ち上げて見通せるなら、近づけずに持ち上げる。見通せなければ、持ち上げずに近づける。
 */
export function camLiftSearch(pitch: number, hitAt: (pitch: number) => number, dist: number, maxPitch = 1.15, step = 0.15): { lift: number; dist: number } {
  const usable = (p: number) => hitAt(p) - 0.3;
  const base = usable(pitch);
  if (base >= dist) return { lift: 0, dist };
  for (let k = 1; pitch + step * k <= maxPitch + 1e-9; k++) {
    if (usable(pitch + step * k) >= dist) return { lift: step * k, dist };
  }
  return { lift: 0, dist: Math.max(1.3, base) };
}

// ------------------------------------------------------------------ 面の進み方・エンドレス・寄り道
/**
 * 敵の強さの倍率（面ごとの値に、エンドレスのラスボス後のレベルを掛ける）。
 * lv が 0 のときは面の値そのまま。出る数とエリートの確率には上限がある。
 */
export function foeScale(t: { hp: number; dmg: number; spawn: number; bossHp: number; elite: number }, lv: number): { hp: number; dmg: number; spawn: number; bossHp: number; elite: number } {
  if (lv <= 0) return { hp: t.hp, dmg: t.dmg, spawn: t.spawn, bossHp: t.bossHp, elite: t.elite };
  return {
    hp: t.hp * (1 + 0.25 * lv),
    dmg: t.dmg * (1 + 0.1 * lv),
    spawn: Math.min(1.6, t.spawn * (1 + 0.06 * lv)),
    bossHp: t.bossHp * (1 + 0.5 * lv),
    elite: Math.min(0.25, t.elite + 0.03 * lv),
  };
}

/** エンドレスのレベル lv で来る、強くなったラスボスと、いっしょに来るボスの数。 */
export function endlessPlan(lv: number): { final: string; extra: number } {
  const i = Math.max(0, lv - 1);
  return { final: ENDLESS_FINALS[i % ENDLESS_FINALS.length], extra: Math.min(3, Math.floor(i / 2)) };
}

/** 次の面の候補。まだ行っていないステージから n 個。足りなければ行ったことのあるステージで埋める。 */
export function nextStageChoices<T extends string>(all: readonly T[], visited: readonly T[], rng: () => number, n = 3): T[] {
  const shuffle = (a: T[]) => {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  const fresh = shuffle(all.filter((s) => !visited.includes(s)));
  const old = shuffle(all.filter((s) => visited.includes(s)));
  return [...fresh, ...old].slice(0, n);
}

/**
 * 寄り道の場所の良さ。ノリコから 26〜64m の所だけを選び、最近の寄り道の場所から離れているほど良い
 * （マップのいろいろな所へ行ってもらうため）。距離は 42m くらいを好む。
 */
export function detourScore(c: { x: number; z: number }, p: { x: number; z: number }, recent: readonly { x: number; z: number }[]): number {
  const d = Math.hypot(c.x - p.x, c.z - p.z);
  if (d < 26 || d > 64) return -Infinity;
  let near = 60;
  for (const r of recent) near = Math.min(near, Math.hypot(c.x - r.x, c.z - r.z));
  return near - Math.abs(d - 42) * 0.5;
}

/** アイテムの★の表示（★3 までは並べ、★4 からは数で書く）。 */
export function starText(lv: number): string {
  return lv > 3 ? `★${lv}` : '★'.repeat(Math.max(1, lv));
}
