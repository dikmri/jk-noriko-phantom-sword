import { V3 } from '../core/vec';
import { log } from '../log';
import { EliteKind, SkillDmg } from './defs';
import type { Enemy } from './enemies';
import { ZONE } from './fx';
import type { Game } from './game';
import type { StackInfo } from './hud';
import { choiceCount, fortifyCut, nisshiCut, sunglassMul, trophyMul } from './rules';
import { PROPS } from './world';

const PHYS: SkillDmg = { kind: 'phys' };
const MAGIC: SkillDmg = { kind: 'magic' };
const BUFF_NAME: Record<EliteKind, string> = { tough: '頑丈', swift: '俊足', bomb: '爆弾' };

/**
 * 第 2 弾のアイテムと強化（ノリノリ・八つ当たり・番狂わせ）の効果。
 * game・enemies・player・skills の決まった場所から 1 行ずつ呼ぶ。
 */
export class ItemFx {
  /** 優勝トロフィーのたまった数 */
  trophy = 0;
  /** ノリノリ: 重なった数と残り秒数 */
  private mom = 0;
  private momT = 0;
  /** 番長の学ラン: もらった力と残り秒数 */
  buff: { kind: EliteKind; t: number } | null = null;
  /** 三色ボールペン: スキルが発動してから、武器の一撃が強くなっている残り秒数と、次に使えるまでの秒数 */
  private penReady = 0;
  private penCd = 0;
  /** ひらめきメモの待ち時間・おまじないのシールにたまったダメージ */
  private critCd = 0;
  private hurtAcc = 0;
  /** 金のシャーペン: 次に倒した敵が 3 倍になるか、なるまでの秒数 */
  private midasReady = false;
  private midasT = 25;
  /** 防災ずきんのシールドの残り量・残り秒数・次に張れるまでの秒数 */
  shield = 0;
  private shieldT = 0;
  private zukinCd = 0;
  private sokuT = 0;
  private auraT = 0;
  private boltT = 0;
  private bombT = 0;
  /** 八つ当たりが八つ当たりを呼ぶ深さ */
  private depth = 0;
  /** スーパーの特売チラシ: 次のカートまでの秒数 */
  private cartT = 6;
  /** 自転車のベル: 棒の攻撃を当てた回数 */
  private bellN = 0;
  /** 麦茶の水筒: 次に回復するまでの秒数 */
  private suitouT = 10;
  /** 手鏡: 返している残り秒数と、次に使えるまでの秒数 */
  private mirrorT = 0;
  private mirrorCd = 0;
  /** 風鈴の守り: 次のダメージを防げるか、防げるようになるまでの秒数 */
  private fuurinReady = true;
  private fuurinT = 0;
  /** ゲームのコントローラー: 重なった数と残り秒数 */
  private ctrl = 0;
  private ctrlT = 0;
  /** 応援団の旗: たまった守りと残り秒数 */
  private fort = 0;
  private fortT = 0;
  /** 直前の一撃で、守りを通ったあとに実際に受けたダメージ（手鏡が返す量） */
  private lastTaken = 0;

  constructor(private g: Game) {}

  /** アイテムの強さを、頭打ちを付けて返す（★と掛け持ちで伸びすぎないように）。 */
  /** アイテムの効果の強さ（★と掛け持ち）。★5（3 倍）まで伸びる。cap は効果ごとの上限 */
  private pw(id: string, cap = 3): number {
    return Math.min(cap, this.g.ip(id));
  }

  /** ctx のダメージの種類で、敵へ直接ダメージを与える（スキルの威力・会心は乗せない）。 */
  private deal(e: Enemy, amount: number, kind: SkillDmg['kind'], quiet = false): boolean {
    return this.g.enemies.damage(e, amount * this.g.stats.power, 'skill', { kind, noCharge: true, quiet });
  }

  /** 飛び道具を、決まったダメージの種類で撃つ（そのとき動いていたスキルの種類を引き継がないように）。 */
  private shoot(ctx: SkillDmg, fn: () => void): void {
    const sk = this.g.skills;
    const keep = sk.cur;
    sk.cur = ctx;
    try {
      fn();
    } finally {
      sk.cur = keep;
    }
  }

  // ---------------------------------------------------------------- 与えるダメージ
  /** 敵が受けるダメージの倍率（優勝トロフィー・番狂わせ・陰口・お化け屋敷）。 */
  dealtMul(e: Enemy): number {
    const g = this.g;
    let m = (this.trophy > 0 ? trophyMul(this.trophy) : 1) * (g.detours?.dealtMul() ?? 1);
    // ラムネ菓子: すべての攻撃 +8% / 怒りマーク: HP が半分以下なら +30%
    const rm = g.ip('ramune');
    if (rm > 0) m *= 1 + 0.08 * rm;
    const ik = g.ip('ikari');
    if (ik > 0 && g.player.hp <= g.stats.maxHp * 0.5) m *= 1 + 0.3 * ik;
    if (e.elite || e.def.boss) m *= g.stats.bigMul;
    const kg = g.ip('kageguchi');
    if (kg > 0) {
      const p = g.player.pos;
      if (Math.hypot(e.x - p.x, e.z - p.z) < 7) m *= 1 + 0.15 * kg;
    }
    if ((e.scared ?? 0) > g.time) m *= 1.3;
    // 絶好調: HP が 80% 以上
    if (g.stats.fullHp > 0 && g.player.hp >= g.stats.maxHp * 0.8) m *= 1 + g.stats.fullHp;
    // 業務用冷凍庫（業務用冷蔵庫の進化）: 凍った敵は割れやすい
    if (e.frozen > 0 && g.skills.get('reizouko')?.evolved) m *= 1.3;
    if (!g.items.length) return m;
    const ak = g.ip('akaten');
    if (ak > 0 && (e.akaten ?? 0) > g.time) m *= 1 + 0.25 * Math.min(3, ak);
    if (e.poison > 0 && g.ip('gyunyu') > 0) m *= 1.1;
    if (g.ip('sunglasses') > 0) m *= sunglassMul(e.maxHp, !!e.def.boss);
    return m;
  }

  /** 武器かスキルが当たったとき（賞味期限切れの牛乳・エナジードリンク）。dmg は与えたダメージ。 */
  onHitAny(e: Enemy, dmg: number, src: 'skill' | 'weapon'): void {
    const g = this.g;
    if (!g.items.length) return;
    const gy = g.ip('gyunyu');
    if (gy > 0 && e.alive && e.hp > 0 && Math.random() < 0.2) g.enemies.poisonIt(e, 3, (5 + g.ap * 0.1) * gy);
    const en = g.ip('energy');
    if (en > 0 && src === 'skill') g.addHeal(dmg * 0.03 * Math.min(3, en));
  }

  /** 会心が出たとき（ひらめきメモ・赤点の答案）。 */
  onCrit(e: Enemy): void {
    if (this.g.ip('akaten') > 0) e.akaten = this.g.time + 4;
    const pw = this.g.ip('hirameki');
    if (pw <= 0 || this.critCd > 0 || Math.random() > 0.25 * Math.min(3, pw)) return;
    this.critCd = 2;
    const s = this.g.skills.castRandom('hirameki');
    if (s) {
      const p = this.g.player.pos;
      this.g.fx.number({ x: p.x, y: p.y + 2.2, z: p.z }, '💡 ひらめき！', 'info');
    }
  }

  /** とどめで余ったダメージ（八つ当たり）。over は余った量。 */
  onOverkill(e: Enemy, over: number): void {
    const g = this.g;
    const pct = g.stats.overkill;
    if (pct <= 0 || over < 2 || this.depth > 3) return;
    const t = g.enemies.nearest({ x: e.x, y: e.y, z: e.z }, 4, (o) => o === e);
    if (!t) return;
    g.fx.bolt({ x: e.x, y: e.y + 0.6, z: e.z }, { x: t.x, y: t.y + 0.4, z: t.z }, 0xff5a3a, 0.2, 0.4, 0.12);
    this.depth++;
    try {
      g.enemies.damage(t, over * pct, 'skill', { kind: 'true', noCharge: true });
    } finally {
      this.depth--;
    }
  }

  // ---------------------------------------------------------------- 武器
  /** 攻撃スキルが発動したとき（三色ボールペン）。 */
  onSkillCast(): void {
    if (this.g.ip('sanshoku') > 0) this.penReady = 3;
  }

  /** 武器が敵に当たったとき（分身の攻撃は除く）。 */
  onWeaponHit(e: Enemy, pos: V3): void {
    const g = this.g;
    if (!g.items.length && !this.buff) return;
    const cd = (e.cd ??= new Map());
    // 保冷剤: 同じ敵を 4 回殴ると凍らせる
    const ho = this.pw('horeizai');
    if (ho > 0 && e.state !== 'dead') {
      const n = (cd.get('horei') ?? 0) + 1;
      if (n >= 4) {
        cd.set('horei', 0);
        g.enemies.freeze(e, 1 * Math.min(2, ho));
      } else cd.set('horei', n);
    }
    // 肩たたき券: 同じ敵を 3 回殴るごとにトゥルーダメージ
    const kt = this.pw('katatataki');
    if (kt > 0 && e.state !== 'dead') {
      const n = (cd.get('kata') ?? 0) + 1;
      if (n >= 3) {
        cd.set('kata', 0);
        this.deal(e, (20 + g.ad * 0.25) * kt, 'true');
        g.fx.sparkle({ x: e.x, y: e.y + 0.8, z: e.z }, 0xffffff, 6, 0.5);
      } else cd.set('kata', n);
    }
    // おもちゃのステッキ: 魔法ダメージを追加
    const stk = this.pw('stick');
    if (stk > 0 && e.state !== 'dead') this.deal(e, (15 + g.ap * 0.2) * stk, 'magic', true);
    // 三色ボールペン: スキルのあとの一撃が強くなる
    const sa = this.pw('sanshoku');
    if (sa > 0 && this.penReady > 0 && this.penCd <= 0 && e.state !== 'dead') {
      this.penReady = 0;
      this.penCd = 1.5;
      this.deal(e, g.ad * 1.0 * sa, 'phys');
      g.fx.ring({ x: e.x, y: e.y + 0.2, z: e.z }, 0.2, 1.4, 0xff4a4a, 0.25);
      g.fx.ring({ x: e.x, y: e.y + 0.4, z: e.z }, 0.2, 1.1, 0x3a7bff, 0.25);
    }
    // 三連ホチキス: 近くの別の敵 2 体へ針
    const hc = this.pw('hotchkiss');
    if (hc > 0) {
      let n = 0;
      const done = new Set<Enemy>([e]);
      while (n < 2) {
        const t = g.enemies.nearest(pos, 6, (o) => done.has(o));
        if (!t) break;
        done.add(t);
        n++;
        const dx = t.x - pos.x;
        const dy = t.y - pos.y;
        const dz = t.z - pos.z;
        const d = Math.hypot(dx, dy, dz) || 1;
        this.shoot(PHYS, () => g.projectiles.fire({ emoji: '📍', size: 0.45, pos: { ...pos }, vel: { x: (dx / d) * 26, y: (dy / d) * 26, z: (dz / d) * 26 }, r: 0.35, dmg: g.ad * 0.4 * hc, life: 0.6, homing: 10, target: t, knock: 2, aim: true }));
      }
    }
    // 速読の教本: 攻撃スキルの待ち時間を進める
    const sd = this.pw('sokudoku');
    if (sd > 0 && this.sokuT <= 0) {
      this.sokuT = 0.12;
      for (const s of g.skills.actives) s.cd -= 0.15 * sd;
    }
    // ゲームのコントローラー: 殴るほど速くなり、8 回で魔法ダメージが乗る
    const ct = this.pw('controller', 2);
    if (ct > 0) {
      this.ctrl = Math.min(8, this.ctrl + 1);
      this.ctrlT = 3;
      if (this.ctrl >= 8 && e.state !== 'dead') this.deal(e, g.ad * 0.3 * ct, 'magic', true);
    }
    // 重い学生カバン: 最大 HP の 2.5% の物理ダメージ
    const kb = this.pw('kaban');
    if (kb > 0 && e.state !== 'dead') this.deal(e, g.stats.maxHp * 0.025 * kb, 'phys', true);
    // 自転車のベル: 6 回当てるごとに、まわりへ衝撃波
    const bl = this.pw('bell');
    if (bl > 0 && ++this.bellN >= 6) {
      this.bellN = 0;
      const p = g.player.pos;
      g.enemies.inRadius(p, 3.5, (o) => {
        if (o.state === 'dead') return;
        const dx = o.x - p.x;
        const dz = o.z - p.z;
        const d = Math.hypot(dx, dz) || 1;
        this.deal(o, (25 + g.ad * 0.3) * bl, 'impact');
        if (!o.def.boss && o.alive) o.stagger = Math.max(o.stagger, 0.5);
        g.enemies.push(o, { x: (dx / d) * 6, y: 2, z: (dz / d) * 6 });
      });
      g.fx.ring({ x: p.x, y: p.y + 0.3, z: p.z }, 0.4, 3.5, 0xffe14d, 0.3, 0.8);
      g.audio.chime();
    }
    // 応援団の旗: 守りがたまる
    if (g.ip('ouendan') > 0) {
      this.fort = Math.min(20, this.fort + 1);
      this.fortT = 4;
    }
    // 番長の学ラン（爆弾持ち）: 武器が当たると爆発
    if (this.buff?.kind === 'bomb' && this.bombT <= 0) {
      this.bombT = 0.25;
      g.explode(pos, 2.2, 15 + g.ad * 0.3, { force: 8, struct: 6, source: 'skill', small: true, ctx: PHYS });
    }
  }

  /** ノリコの振る速さ・移動速度の倍率（ノリノリ・番長の学ランの俊足）。 */
  swingMul(): number {
    return (this.g.skills.fourth?.swingMul() ?? 1) * (1 + this.mom * this.g.stats.momentum + (this.buff?.kind === 'swift' ? 0.25 : 0) + (this.ctrl > 0 ? this.ctrl * 0.05 * this.pw('controller', 2) : 0));
  }

  moveMul(): number {
    return (1 + this.mom * this.g.stats.momentum + (this.buff?.kind === 'swift' ? 0.25 : 0)) * (this.g.detours?.moveMul() ?? 1);
  }

  // ---------------------------------------------------------------- 倒したとき
  onKill(e: Enemy): void {
    const g = this.g;
    // ノリノリ
    if (g.stats.momentum > 0) {
      this.mom = Math.min(10, this.mom + 1);
      this.momT = 3;
    }
    if (!g.items.length) return;
    // 優勝トロフィー
    const tr = g.ip('trophy');
    if (tr > 0 && (e.elite || e.def.boss)) {
      const before = Math.floor(this.trophy);
      this.trophy = Math.min(25, this.trophy + (e.def.boss ? 5 : 1) * tr);
      if (Math.floor(this.trophy) > before) log('item.trophy', { by: e.def.id }, { stacks: Math.round(this.trophy * 10) / 10 });
    }
    // 番長の学ラン: エリートの力をもらう
    const gk = g.ip('gakuran');
    if (gk > 0 && e.elite) {
      this.buff = { kind: e.elite, t: 20 * gk };
      const p = g.player.pos;
      g.hud.toast(`🧥 エリートの力をもらった（${BUFF_NAME[e.elite]}）`, 'gold');
      g.fx.sparkle({ x: p.x, y: p.y + 1.2, z: p.z }, 0xffd23a, 12, 1);
      log('item.gakuran', { kind: e.elite }, { sec: Math.round(this.buff.t) });
    }
    // 雷おこし: ぬれた敵・凍った敵が倒れると雷が伝わる
    const km = g.ip('kaminari');
    if (km > 0 && (e.wet > 0 || e.frozen > 0) && this.boltT <= 0) {
      this.boltT = 0.08;
      let from: V3 = { x: e.x, y: e.y + 0.5, z: e.z };
      const done = new Set<Enemy>([e]);
      for (let i = 0; i < 4; i++) {
        const t = g.enemies.nearest(from, 7, (o) => done.has(o));
        if (!t) break;
        done.add(t);
        const to = { x: t.x, y: t.y + 0.4, z: t.z };
        g.fx.bolt(from, to, 0x9fd8ff, 0.22, 0.6, 0.14);
        this.deal(t, (25 + g.ap * 0.6) * km * (t.wet > 0 ? 1.5 : 1), 'magic');
        from = to;
      }
      g.audio.thunder();
    }
    // 金のシャーペン: 次に倒した敵の経験値 3 倍とコイン
    if (this.midasReady && g.ip('midas') > 0) {
      this.midasReady = false;
      this.midasT = 25 / Math.min(3, g.ip('midas'));
      const pos = { x: e.x, y: e.y, z: e.z };
      const xp = e.def.xp * g.rule.xp * (e.elite ? 4 : 1) * 2;
      for (let i = 0; i < 3; i++) g.pickups.dropXp({ x: pos.x + (Math.random() - 0.5), y: pos.y, z: pos.z + (Math.random() - 0.5) }, xp / 3);
      g.pickups.dropItem('coin', pos, 3);
      g.fx.sparkle({ x: pos.x, y: pos.y + 0.6, z: pos.z }, 0xffd23a, 12, 0.9);
      g.fx.number({ x: pos.x, y: pos.y + 1.6, z: pos.z }, '✒️ ×3', 'info');
      log('item.midas', { id: e.def.id }, { xp: Math.round(xp) });
    }
  }

  // ---------------------------------------------------------------- 受けるダメージ
  /** ノリコが受けるダメージを減らす（学級日誌・番長の学ランの頑丈・防災ずきんのシールド）。 */
  mitigate(d: number): number {
    this.lastTaken = this.cut(d);
    return this.lastTaken;
  }

  private cut(d: number): number {
    const g = this.g;
    // 風鈴の守り: 1 回だけ防ぐ
    if (this.fuurinReady && d > 0 && g.ip('fuurin') > 0) {
      this.fuurinReady = false;
      this.fuurinT = 15 / Math.min(3, g.ip('fuurin'));
      const p = g.player.pos;
      g.fx.number({ x: p.x, y: p.y + 2.1, z: p.z }, '🎐 チリン', 'info');
      g.fx.ring({ x: p.x, y: p.y + 0.8, z: p.z }, 0.3, 1.6, 0x9fd8ff, 0.3, 0.7);
      return 0;
    }
    if (this.fort > 0 && g.ip('ouendan') > 0) d *= fortifyCut(this.fort, g.ip('ouendan'));
    const ni = g.ip('nisshi');
    if (ni > 0) d = nisshiCut(d, g.stats.maxHp, ni);
    if (this.buff?.kind === 'tough') d *= 0.75;
    if (this.shield > 0 && d > 0) {
      const a = Math.min(this.shield, d);
      this.shield -= a;
      d -= a;
      const p = g.player.pos;
      g.fx.number({ x: p.x, y: p.y + 2.1, z: p.z }, `🛡️${Math.round(a)}`, 'info');
    }
    return d;
  }

  /** ノリコがダメージを受けたあと（おまじないのシール・防災ずきん）。raw は防御で減らす前。 */
  afterHurt(raw: number): void {
    const g = this.g;
    // 手鏡: 受けたダメージの 2 倍を、まわりの敵へ返す
    const tk = g.ip('tekagami');
    const taken = this.lastTaken;
    if (tk > 0 && taken > 0) {
      if (this.mirrorT <= 0 && this.mirrorCd <= 0) {
        this.mirrorT = 4;
        this.mirrorCd = 20;
        const p = g.player.pos;
        g.fx.number({ x: p.x, y: p.y + 2.3, z: p.z }, '🪞 反射！', 'info');
        log('item.tekagami', {}, { time: Math.round(g.time) });
      }
      if (this.mirrorT > 0) {
        const p = g.player.pos;
        g.enemies.inRadius(p, 3.5, (e) => {
          this.deal(e, taken * 2 * Math.min(3, tk), 'true');
        });
        g.fx.ring({ x: p.x, y: p.y + 0.8, z: p.z }, 0.3, 3.5, 0xd8f0ff, 0.25, 0.6);
      }
    }
    const om = g.ip('omajinai');
    if (om > 0) {
      this.hurtAcc += raw;
      const need = 50 / Math.min(2, om);
      if (this.hurtAcc >= need) {
        this.hurtAcc = 0;
        if (g.skills.castRandom('omajinai')) {
          const p = g.player.pos;
          g.fx.number({ x: p.x, y: p.y + 2.2, z: p.z }, '🌈 いたいのとんでけ！', 'info');
        }
      }
    }
    const zk = g.ip('zukin');
    if (zk > 0 && this.zukinCd <= 0 && g.player.hp > 0 && g.player.hp < g.stats.maxHp * 0.35) {
      this.zukinCd = 60;
      this.shield = g.stats.maxHp * 0.35 * Math.min(2.5, zk);
      this.shieldT = 6;
      const p = g.player.pos;
      g.fx.ring({ x: p.x, y: p.y + 0.1, z: p.z }, 0.4, 2.4, ZONE.ally, 0.5);
      g.hud.toast('⛑️ 防災ずきん！ シールドを張った', 'gold');
      log('item.zukin', {}, { shield: Math.round(this.shield), time: Math.round(g.time) });
    }
  }

  /** 回復量の倍率（絆創膏）。 */
  healMul(): number {
    return 1 + 0.3 * this.g.ip('bansoko');
  }

  // ---------------------------------------------------------------- ダッシュ
  /** ダッシュしたとき（ローラースケート）。dx, dz は向き。 */
  onDash(dx: number, dz: number): void {
    const g = this.g;
    const rs = this.pw('roller');
    if (rs <= 0) return;
    const p = g.player.pos;
    const base = Math.atan2(dx, dz);
    this.shoot(MAGIC, () => {
      for (let i = 0; i < 5; i++) {
        const a = base + (i - 2) * 0.22;
        g.projectiles.fire({ emoji: '✨', size: 0.7, pos: { x: p.x, y: p.y + 0.9, z: p.z }, vel: { x: Math.sin(a) * 24, y: 0, z: Math.cos(a) * 24 }, r: 0.45, dmg: (20 + g.ap * 0.5) * rs, life: 0.75, pierce: 1, knock: 3 });
      }
    });
  }

  // ---------------------------------------------------------------- 毎フレーム
  update(dt: number): void {
    const g = this.g;
    if (this.critCd > 0) this.critCd -= dt;
    if (this.penCd > 0) this.penCd -= dt;
    if (this.penReady > 0) this.penReady -= dt;
    if (this.sokuT > 0) this.sokuT -= dt;
    if (this.boltT > 0) this.boltT -= dt;
    if (this.bombT > 0) this.bombT -= dt;
    if (this.zukinCd > 0) this.zukinCd -= dt;
    if (this.mirrorT > 0) this.mirrorT -= dt;
    // 麦茶の水筒: 10 秒ごとに最大 HP の 4% 回復
    const st = g.ip('suitou');
    if (st > 0) {
      this.suitouT -= dt;
      if (this.suitouT <= 0) {
        this.suitouT = 10;
        g.addHeal(g.stats.maxHp * 0.04 * st);
      }
    }
    if (this.mirrorCd > 0) this.mirrorCd -= dt;
    if (!this.fuurinReady) {
      this.fuurinT -= dt;
      if (this.fuurinT <= 0) this.fuurinReady = true;
    }
    if (this.ctrlT > 0) {
      this.ctrlT -= dt;
      if (this.ctrlT <= 0) this.ctrl = 0;
    }
    if (this.fortT > 0) {
      this.fortT -= dt;
      if (this.fortT <= 0) this.fort = 0;
    }
    if (this.momT > 0) {
      this.momT -= dt;
      if (this.momT <= 0) this.mom = 0;
    }
    if (this.shieldT > 0) {
      this.shieldT -= dt;
      if (this.shieldT <= 0) this.shield = 0;
    }
    if (this.buff) {
      this.buff.t -= dt;
      if (this.buff.t <= 0) {
        log('item.gakuran.end', { kind: this.buff.kind }, {});
        this.buff = null;
      }
    }
    if (!g.items.length) return;
    // 金のシャーペン: 25 秒ごとに準備ができる
    if (!this.midasReady && g.ip('midas') > 0) {
      this.midasT -= dt;
      if (this.midasT <= 0) {
        this.midasReady = true;
        const p = g.player.pos;
        g.fx.sparkle({ x: p.x, y: p.y + 1.8, z: p.z }, 0xffd23a, 6, 0.5);
      }
    }
    // スーパーの特売チラシ: ショッピングカートが群れへ突っ込む
    const ch = g.ip('chirashi');
    if (ch > 0 && PROPS.u_cart) {
      this.cartT -= dt;
      if (this.cartT <= 0) {
        const p = g.player.pos;
        const c = g.enemies.cluster(p, 20);
        if (c) {
          this.cartT = 14 / Math.min(2, ch);
          const dx = c.x - p.x;
          const dz = c.z - p.z;
          const d = Math.hypot(dx, dz) || 1;
          const ux = dx / d;
          const uz = dz / d;
          // ノリコの後ろから、群れへ向かって走らせる
          const sx = p.x - ux * 3;
          const sz = p.z - uz * 3;
          const cart = g.world.spawnProp('u_cart', { x: sx, y: g.world.groundY(sx, sz) + 0.05, z: sz }, Math.atan2(ux, uz), { vel: { x: ux * 17, y: 0, z: uz * 17 }, hot: 3.5, dmgMul: 2.5 * Math.min(2, ch), life: 4 });
          if (cart) log('item.chirashi', {}, { time: Math.round(g.time) });
        } else this.cartT = 1;
      }
    }
    // 風紀委員のバッジ: まわりの敵の物理防御を下げる
    const fu = g.ip('fuuki');
    if (fu > 0) {
      this.auraT -= dt;
      if (this.auraT <= 0) {
        this.auraT = 0.5;
        const p = g.player.pos;
        const pct = Math.min(0.5, 0.25 * fu);
        g.enemies.inRadius(p, 6, (e) => g.enemies.shred(e, pct, 0, 0.7));
      }
    }
  }

  /** レベルアップの選択肢の枚数。 */
  choiceN(): number {
    return choiceCount(this.g.items, this.g.stats.luck);
  }

  /** 一時停止画面に出す行。 */
  /** 遊んでいる間、スキル欄のアイコンに出す「たまっている数」と、その効果。 */
  stacks(out: StackInfo[]): void {
    const g = this.g;
    const pct = (v: number) => Math.round(v * 100);
    if (this.mom > 0 && g.stats.momentum > 0) out.push({ key: 'p:norinori', badge: `×${this.mom}`, fill: this.mom / 10, text: `🎧 ノリノリ ×${this.mom}/10　振る速さ・移動 +${pct(this.mom * g.stats.momentum)}%` });
    if (this.trophy > 0 && g.ip('trophy') > 0) {
      const n = Math.floor(this.trophy);
      out.push({ key: 'i:trophy', badge: String(n), fill: this.trophy / 25, text: `🏆 優勝トロフィー ${n}/25　与えるダメージ +${pct(trophyMul(this.trophy) - 1)}%` });
    }
    if (this.ctrl > 0 && g.ip('controller') > 0) out.push({ key: 'i:controller', badge: `×${this.ctrl}`, fill: this.ctrl / 8, text: `🎮 コントローラー ×${this.ctrl}/8　振る速さ +${pct(this.ctrl * 0.05 * this.pw('controller', 1.5))}%${this.ctrl >= 8 ? '・魔法ダメージ追加中' : ''}` });
    if (this.fort > 0 && g.ip('ouendan') > 0) out.push({ key: 'i:ouendan', badge: String(this.fort), fill: this.fort / 20, text: `🚩 応援団の旗 ${this.fort}/20　受けるダメージ -${pct(1 - fortifyCut(this.fort, g.ip('ouendan')))}%` });
    if (this.shield > 0) out.push({ key: 'i:zukin', badge: String(Math.round(this.shield)), text: `⛑️ 防災ずきんのシールド ${Math.round(this.shield)}` });
    if (this.buff && g.ip('gakuran') > 0) out.push({ key: 'i:gakuran', badge: `${Math.ceil(this.buff.t)}秒`, text: `🧥 番長の学ラン: ${BUFF_NAME[this.buff.kind]}の力　残り ${Math.ceil(this.buff.t)} 秒` });
    if (g.ip('tekagami') > 0 && this.mirrorT > 0) out.push({ key: 'i:tekagami', badge: '反射', text: `🪞 手鏡: 反射中　残り ${Math.ceil(this.mirrorT)} 秒` });
    if (g.ip('fuurin') > 0) out.push({ key: 'i:fuurin', badge: this.fuurinReady ? '✓' : `${Math.ceil(this.fuurinT)}`, fill: this.fuurinReady ? 1 : 1 - this.fuurinT / (15 / Math.min(3, g.ip('fuurin'))) });
  }

  statLines(): string[] {
    const out: string[] = [];
    if (this.trophy > 0) out.push(`🏆 優勝トロフィー ${Math.floor(this.trophy)}/25（与えるダメージ +${Math.round((trophyMul(this.trophy) - 1) * 100)}%）`);
    if (this.buff) out.push(`🧥 番長の学ラン: ${BUFF_NAME[this.buff.kind]} 残り ${Math.ceil(this.buff.t)} 秒`);
    if (this.mom > 0) out.push(`🎧 ノリノリ ×${this.mom}`);
    if (this.shield > 0) out.push(`⛑️ シールド ${Math.round(this.shield)}`);
    if (this.fort > 0) out.push(`🚩 応援団の旗 ${this.fort}（受けるダメージ -${Math.round((1 - fortifyCut(this.fort, this.g.ip('ouendan'))) * 100)}%）`);
    if (this.ctrl > 0) out.push(`🎮 コントローラー ×${this.ctrl}`);
    return out;
  }
}
