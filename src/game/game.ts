import { Assets } from '../core/assets';
import { AudioSys } from '../core/audio';
import { Engine } from '../core/engine';
import { Input } from '../core/input';
import { Owner, Physics } from '../core/physics';
import { SaveData, unlockedWeapons, writeSave } from '../core/save';
import { V3 } from '../core/vec';
import { log } from '../log';
import { Motion } from '../motion/motion';
import { DIFFICULTIES, DmgKind, ENDLESS_FINALS, ENDLESS_MIX, ITEM_MAP, ITEM_SLOTS, SkillDmg, DifficultyDef, DifficultyId, eliteChance, EliteKind, ENEMIES, GameMode, RuleDef, RuleEffect, ruleEffect, RULES, SKILL_MAP, StageDef, StageId, STAGES, Stats, STORY_STAGES, TierDef, TIERS, TUNE, WaveDef, WAVES, WeaponDef, xpForLevel } from './defs';
import { Enemy, EnemyManager } from './enemies';
import { Fx, ZONE } from './fx';
import { Hud, StackInfo } from './hud';
import { Pickups } from './pickups';
import { Player } from './player';
import { Projectiles } from './projectiles';
import { applyChoice, Choice, choicePool, computeStats, endlessPlan, foeScale, isItemLevel, ITEM_MAX_LV, itemPow, makeRng, starText, Owned, rollChoices, rollItemChoices, screenBearing, skillScale, weaponTrain } from './rules';
import { CarrySkill, Skills } from './skills';
import { ItemFx } from './itemFx';
import { Detours } from './detour';
import { Chunk, Prop, WorldMap } from './world';

export interface RunStats {
  kills: number;
  chainKills: number;
  bossKills: number;
  damage: number;
  damageTaken: number;
  coins: number;
  parries: number;
  bestCombo: number;
}

export interface ResultData {
  clear: boolean;
  /** 遊び方と、最後に遊んだ面（1〜3）・クリアした面の数 */
  mode: GameMode;
  stageNo: number;
  stagesCleared: number;
  /** エンドレスで到達したレベル（ラスボスを倒す前は 0）と、自己ベストを更新したか */
  endlessLv: number;
  newBest: boolean;
  /** 回ったステージ（遊んだ順） */
  route: StageDef[];
  /** 全部の面の時間の合計 */
  time: number;
  level: number;
  run: RunStats;
  destruction: number;
  coinsEarned: number;
  newWeapons: WeaponDef[];
  skills: { emoji: string; name: string; level: string }[];
  killedBy: string;
  rule: RuleDef;
  stage: StageDef;
  difficulty: DifficultyDef;
}

export interface GameOpts {
  weapon: WeaponDef;
  motion: Motion;
  ruleId: string;
  stageId: StageId;
  difficultyId: DifficultyId;
  seed: number;
  /** 遊び方（3 面通し / エンドレス） */
  mode: GameMode;
  /** 前の面から引き継ぐもの（1 面目は無し） */
  carry?: Carry | null;
}

/** 3 面通しで、次の面へ引き継ぐもの。 */
export interface Carry {
  /** 次に遊ぶ面の番号（2 か 3） */
  stageNo: number;
  /** これまでに回ったステージ（遊んだ順） */
  visited: StageId[];
  /** これまでの面の時間の合計 */
  time: number;
  level: number;
  xp: number;
  actives: CarrySkill[];
  passives: Owned[];
  items: string[];
  itemLv: Record<string, number>;
  stack: { ad: number; hp: number; ap: number };
  weaponBonus: number;
  /** 棒を鍛えた段階 */
  weaponLv: number;
  trophy: number;
  rerolls: number;
  banishes: number;
  banished: string[];
  revives: number;
  run: RunStats;
  eliteKills: number;
  destruction: number;
  /** 前の面で拾いきれなかった経験値・まだ選んでいないレベルアップ・開けていない宝箱（ラスボスの宝箱など） */
  xpBank: number;
  pendingLevels: number;
  chests: ('boss' | 'small' | 'item')[];
}

export interface LevelUpAnswer {
  pick?: Choice;
  action?: 'reroll' | 'skip';
  banish?: Choice;
}

/** 画面側（レベルアップの選択など）とのやりとり。 */
export interface OwnedSkillsInfo {
  actives: Owned[];
  passives: Owned[];
  items: string[];
  /** アイテムの★ */
  itemLv: Record<string, number>;
}

export interface GameHooks {
  levelUp(choices: Choice[], info: { level: number; rerolls: number; banishes: number; owned: OwnedSkillsInfo; mode: 'skill' | 'item' }): Promise<LevelUpAnswer>;
  chest(items: Choice[], coins: number): Promise<void>;
  pause(owned: OwnedSkillsInfo, stats: [string, string][]): Promise<'resume' | 'quit'>;
  result(r: ResultData): void;
  /** 3 面通しで面をクリアした。次の面を選ぶ画面を出す */
  stageClear(next: Carry): void;
  quit(): void;
}

export interface GameDeps {
  engine: Engine;
  input: Input;
  audio: AudioSys;
  assets: Assets;
  save: SaveData;
  ui: HTMLElement;
  hooks: GameHooks;
}

export interface ExplodeOpts {
  /** スキルの爆発のとき、ダメージの種類と反映率（省くと、いま動いているスキルのもの） */
  ctx?: SkillDmg;
  force?: number;
  struct?: number;
  hurtPlayer?: boolean;
  source: 'skill' | 'enemy' | 'prop';
  element?: 'fire' | 'ice' | 'elec' | 'dark' | 'water';
  quietFx?: boolean;
  small?: boolean;
}

export class Game {
  engine: Engine;
  input: Input;
  audio: AudioSys;
  assets: Assets;
  save: SaveData;
  physics!: Physics;
  fx!: Fx;
  world!: WorldMap;
  enemies!: EnemyManager;
  player!: Player;
  projectiles!: Projectiles;
  pickups!: Pickups;
  skills!: Skills;
  itemFx!: ItemFx;
  hud!: Hud;
  rng: () => number;
  rule: RuleEffect;
  ruleDef: RuleDef;
  stageDef: StageDef;
  /** 難易度（敵の強さの倍率） */
  diff: DifficultyDef;
  weaponDef: WeaponDef;
  motion: Motion;
  stats!: Stats;
  /** 遊び方と、いまの面（1〜3）とその強さ */
  mode: GameMode;
  stageNo: number;
  tier: TierDef;
  /** エンドレス: ラスボスを倒したあとか・来た強いラスボスの数（レベル）・次が来るまでの秒数 */
  endless = false;
  endlessLv = 0;
  private endlessT = 0;
  /** 寄り道（マップのあちこちに出る、行くと得をする目的地）と避難訓練 */
  detours!: Detours;
  /** 前の面から引き継いだもの */
  private carry: Carry | null;
  /** 面の時間（ボスや敵の出方はこれで決まる）。全部の面の合計は totalTime */
  time = 0;
  state: 'playing' | 'levelup' | 'paused' | 'over' | 'clear' = 'playing';
  level = 1;
  xp = 0;
  xpNeed = xpForLevel(1);
  run: RunStats = { kills: 0, chainKills: 0, bossKills: 0, damage: 0, damageTaken: 0, coins: 0, parries: 0, bestCombo: 0 };
  debug = { on: false, god: false };
  private hooks: GameHooks;
  private ui: HTMLElement;
  private stopT = 0;
  private swingSeq = 0;
  private spawnT = 1.2;
  private bossIdx = 0;
  private calm = 0;
  private pendingLevels = 0;
  private rerolls: number;
  private banishes = 2;
  private banished: string[] = [];
  private combo = 0;
  private comboT = 0;
  private overT = 0;
  private killedBy = '';
  private finalPhase = false;
  /** 持っているアイテムと、その★（無ければ ★1） */
  items: string[] = [];
  itemLv: Record<string, number> = {};
  /** 倒すほど育つアイテム（プロテイン・優等生の手帳）でたまった分 */
  stack = { ad: 0, hp: 0, ap: 0 };
  /** アイテムの効果の待ち時間など */
  private itemT: Record<string, number> = {};
  /** 棒を鍛えた段階（上限なし） */
  weaponLv = 0;
  /** 静電気の下敷き: たまった電気 */
  private charge = 0;
  /** 最後にダメージを受けた時刻（母の手作り弁当） */
  lastHurtT = -99;
  /** 吸収（ライフスティール）で回復する分を少しずつためて、まとめて回復する */
  private stealPool = 0;
  private stealT = 0;
  /** ボウリングのピン: 巻き込みで倒した数と、続く残り秒数 */
  private pins = 0;
  private pinsT = 0;
  /** 先生の赤ペン: 武器が当たった回数 */
  redpenHits = 0;
  /** 生徒会長の盾: 続く残り秒数と、上がる防御 */
  shieldT = 0;
  shieldDef = 0;
  /** 三巨頭のあとのラスボスを出したか */
  private finalBoss = false;
  private eliteKills = 0;
  private perfT = 0;
  private disposed = false;
  /** いま流している場面の曲（stage / late / boss / final） */
  private musicState = '';
  private chestQueue = 0;
  private chestKinds: ('boss' | 'small' | 'item')[] = [];
  private busy = false;
  /** 直近 10 秒の、敵の発射数と「画面外から当たりそう」の警告数（perf のログに出す） */
  shotCount = 0;
  private warnCount = 0;

  private constructor(d: GameDeps, opts: GameOpts) {
    this.engine = d.engine;
    this.input = d.input;
    this.audio = d.audio;
    this.assets = d.assets;
    this.save = d.save;
    this.hooks = d.hooks;
    this.ui = d.ui;
    this.rng = makeRng(opts.seed);
    this.ruleDef = RULES.find((r) => r.id === opts.ruleId) ?? RULES[0];
    this.rule = ruleEffect(this.ruleDef.id);
    this.stageDef = STAGES.find((s) => s.id === opts.stageId) ?? STAGES[0];
    this.diff = DIFFICULTIES.find((d) => d.id === opts.difficultyId) ?? DIFFICULTIES[0];
    this.weaponDef = opts.weapon;
    this.motion = opts.motion;
    this.mode = opts.mode;
    this.carry = opts.carry ?? null;
    this.stageNo = opts.mode === 'story' ? Math.min(STORY_STAGES, this.carry?.stageNo ?? 1) : 1;
    this.tier = TIERS[this.stageNo - 1];
    this.rerolls = 1 + d.save.shop.reroll;
    this.debug.on = new URLSearchParams(location.search).has('debug');
  }

  static async create(d: GameDeps, opts: GameOpts): Promise<Game> {
    const g = new Game(d, opts);
    g.physics = await Physics.create(TUNE.gravity * g.rule.gravity);
    g.stats = computeStats([], d.save.shop);
    g.fx = new Fx(d.engine.scene, d.engine.camera, d.ui);
    g.fx.shakeScale = d.save.settings.shake;
    g.world = new WorldMap(g);
    g.fx.groundAt = (x, z) => g.world.groundY(x, z);
    g.enemies = new EnemyManager(g);
    g.player = new Player(g);
    g.projectiles = new Projectiles(g);
    g.pickups = new Pickups(g);
    g.skills = new Skills(g);
    g.itemFx = new ItemFx(g);
    g.hud = new Hud(g, d.ui);
    g.detours = new Detours(g);
    if (g.carry) g.restoreCarry(g.carry);
    g.playMusic('stage');
    log('game.start', { stage: g.stageDef.id, difficulty: g.diff.id, weapon: opts.weapon.id, motion: opts.motion.id, motionName: opts.motion.name, keys: opts.motion.keys.length, rule: g.ruleDef.id, seed: opts.seed, mode: g.mode, stageNo: g.stageNo }, { maxHp: g.stats.maxHp, rerolls: g.rerolls, level: g.level, carried: !!g.carry });
    const no = g.mode === 'story' ? `${g.stageNo} 面　` : '♾️ エンドレス　';
    g.hud.toast(`${no}${g.stageDef.emoji} ${g.stageDef.name}${g.diff.id !== 'normal' ? `（${g.diff.name}）` : ''}`, 'gold');
    if (g.stageNo > 1) g.hud.toast('敵が強くなった！ 新しい敵も出る', 'warn');
    else if (g.ruleDef.id !== 'normal') g.hud.toast(`本日の校則: ${g.ruleDef.name}`, 'warn');
    return g;
  }

  /** 前の面で育てたものを、そのまま持たせる。HP は全回復する。 */
  private restoreCarry(c: Carry): void {
    this.level = c.level;
    this.xp = c.xp;
    this.xpNeed = xpForLevel(c.level);
    this.items = [...c.items];
    this.itemLv = { ...c.itemLv };
    this.stack = { ...c.stack };
    this.rerolls = c.rerolls;
    this.banishes = c.banishes;
    this.banished = [...c.banished];
    this.run = { ...c.run };
    this.eliteKills = c.eliteKills;
    this.player.weaponBonus = c.weaponBonus;
    this.weaponLv = c.weaponLv ?? 0;
    this.itemFx.trophy = c.trophy;
    this.skills.restore(c.actives, c.passives);
    this.player.revives = c.revives;
    this.player.hp = this.stats.maxHp;
    // 前の面で拾いきれなかったもの: 経験値はそのまま足し、宝箱は面の始めに開ける
    this.pendingLevels = c.pendingLevels;
    if (c.xpBank > 0) this.addXp(c.xpBank);
    for (const k of c.chests) this.openChest(k);
    if (c.chests.length) this.hud.toast(`🎁 前の面の宝箱を ${c.chests.length} 個 持ってきた`, 'gold');
    log('game.carry', { stageNo: c.stageNo, visited: c.visited }, { level: c.level, actives: c.actives.map((a) => `${a.id}:${a.level}${a.evolved ? '*' : ''}`), items: c.items, time: Math.round(c.time), xpBank: Math.round(c.xpBank), pending: c.pendingLevels, chests: c.chests });
  }

  /** 全部の面の時間の合計（結果と記録に使う）。 */
  get totalTime(): number {
    return (this.carry?.time ?? 0) + this.time;
  }

  /** 敵の強さの倍率（面ごとの強さ × エンドレスのレベル）。 */
  get foe(): { hp: number; dmg: number; spawn: number; bossHp: number; elite: number } {
    return foeScale(this.tier, this.endlessLv);
  }

  // ---------------------------------------------------------------- 攻撃力・アイテム
  /** 棒の威力: 武器の威力 + 「棒、育つ」で増えた分。「棒を鍛える」で割合が増える */
  get weaponPower(): number {
    return (this.weaponDef.damage + (this.player?.weaponBonus ?? 0)) * weaponTrain(this.weaponLv).dmg;
  }

  /** AD（物理攻撃力）: 棒の威力 + 強化とアイテムの分 */
  get ad(): number {
    return this.weaponPower + this.stats.ad;
  }

  /** 棒を鍛える（レベルアップ・宝箱で選ぶ。上限なし）。 */
  trainWeapon(): void {
    const before = Math.round(this.weaponPower);
    this.weaponLv++;
    // 成績表: ときどき 2 段上がる
    if (this.ip('seiseki') > 0 && Math.random() < 0.25 * Math.min(2, this.ip('seiseki'))) {
      this.weaponLv++;
      this.hud.toast('📈 成績表のおかげで、もう 1 段鍛えた！', 'praise');
    }
    this.recomputeStats();
    this.hud.toast(`🔨 棒を鍛えた！ Lv ${this.weaponLv}　棒の威力 ${before} → ${Math.round(this.weaponPower)}`, 'gold');
    log('weapon.train', { lv: this.weaponLv }, { power: Math.round(this.weaponPower), swing: Math.round(weaponTrain(this.weaponLv).swing * 100) / 100 });
  }

  /** AP（魔法攻撃力） */
  get ap(): number {
    return this.stats.ap;
  }

  hasItem(id: string): boolean {
    return this.items.includes(id);
  }

  /** スキルのダメージの種類と反映率から、威力の倍率を求める（筋トレなどの威力・スキルの威力・限界突破も含む）。 */
  scaleFor(ctx: SkillDmg | null | undefined): number {
    return skillScale(ctx ?? undefined, this.ad, this.ap) * this.stats.power * this.stats.skillMul * (ctx?.mul ?? 1);
  }

  /** アイテムの効果の強さ（★と「部活の掛け持ち」）。持っていなければ 0。 */
  ip(id: string): number {
    if (!this.items.includes(id)) return 0;
    const k = this.skills?.passives.find((p) => p.id === 'kakemochi');
    return itemPow(this.itemLv[id]) * (1 + 0.06 * (k ? k.level + 0.5 * (k.brk ?? 0) : 0));
  }

  /** あとでまとめて回復する量を足す（0.5 秒ごとに回復する。数字が出すぎないように）。 */
  addHeal(n: number): void {
    if (n > 0) this.stealPool += n;
  }

  /** 与えたダメージの一部を回復する（謎の赤いジュース）。 */
  lifesteal(dmg: number): void {
    if (this.stats.lifesteal > 0) this.stealPool += dmg * this.stats.lifesteal;
  }

  pinsMul(): number {
    return 1 + this.pins * 0.15 * (this.pins > 0 ? this.ip('pins') : 1);
  }

  shieldActive(): boolean {
    return this.shieldT > 0;
  }

  addItem(id: string): void {
    if (this.items.includes(id) || this.items.length >= ITEM_SLOTS) return;
    this.items.push(id);
    this.itemLv[id] = 1;
    this.recomputeStats();
    log('item.get', { id }, { items: this.items });
  }

  /** 持っているアイテムの★を 1 つ上げる。 */
  upgradeItem(id: string): void {
    if (!this.items.includes(id)) return;
    this.itemLv[id] = Math.min(ITEM_MAX_LV, (this.itemLv[id] ?? 1) + 1);
    this.recomputeStats();
    log('item.up', { id }, { lv: this.itemLv[id] });
  }

  nextSwingId(): number {
    return ++this.swingSeq;
  }

  hitStop(sec: number): void {
    this.stopT = Math.max(this.stopT, sec);
  }

  /** 画面に見えていない弾が当たりそうなとき、画面の縁の点滅と小さな警告音で知らせる。t は当たるまでの秒数。 */
  warnShot(from: V3, t: number, miss: number): void {
    this.audio.warn();
    this.hud.dangerFlash();
    this.warnCount++;
    const p = this.player;
    const bearing = screenBearing(from.x - p.pos.x, from.z - p.pos.z, p.camYaw);
    log('warn.shot', { t: Math.round(t * 100) / 100, miss: Math.round(miss * 10) / 10, dist: Math.round(Math.hypot(from.x - p.pos.x, from.z - p.pos.z) * 10) / 10 }, { bearingDeg: Math.round((bearing * 180) / Math.PI), time: Math.round(this.time) });
  }

  recomputeStats(): void {
    const before = this.stats?.maxHp ?? 0;
    this.stats = computeStats(this.skills.passives, this.save.shop, this.items, this.itemLv);
    this.stats.ad += this.stack.ad;
    this.stats.maxHp += this.stack.hp;
    this.stats.ap += this.stack.ap * this.stats.apMul;
    // 棒を鍛える: 振る速さ
    this.stats.attackSpeed *= weaponTrain(this.weaponLv).swing;
    if (this.player) {
      this.player.refreshStats();
      if (this.stats.maxHp > before) this.player.hp += this.stats.maxHp - before;
    }
  }

  // ---------------------------------------------------------------- 爆発
  explode(pos: V3, radius: number, dmg: number, o: ExplodeOpts): void {
    const r = radius * this.rule.explosion;
    const force = o.force ?? 10;
    const ctx = o.source === 'skill' ? (o.ctx ?? this.skills.cur ?? { kind: 'magic' as DmgKind, ap: 0.6 }) : null;
    const power = ctx ? this.scaleFor(ctx) : 1;
    const kind: DmgKind = ctx ? ctx.kind : 'magic';
    const lamp = o.element === 'fire' && this.hasItem('lamp');
    for (const e of this.enemies.list) {
      if (!e.alive) continue;
      const dx = e.x - pos.x;
      const dy = e.y - pos.y;
      const dz = e.z - pos.z;
      const d = Math.hypot(dx, dy, dz);
      if (d > r + e.radius) continue;
      const f = Math.max(0.35, 1 - (d / r) * 0.65);
      const inv = 1 / Math.max(0.4, d);
      this.enemies.damage(e, dmg * f * power, 'explosion', { kind, impulse: { x: dx * inv * force * f, y: Math.max(dy * inv, 0.5) * force * f, z: dz * inv * force * f } });
      if (lamp && e.alive) {
        e.burn = Math.max(e.burn, 2.5);
        e.burnDps = Math.max(e.burnDps, (6 + this.ap * 0.15) * this.ip('lamp'));
      }
    }
    this.world.blast(pos, r, o.struct ?? dmg * 0.4, force, dmg * 0.6);
    const pp = this.player.pos;
    const pd = Math.hypot(pp.x - pos.x, pp.y + 0.8 - pos.y, pp.z - pos.z);
    if (o.hurtPlayer && pd < r) this.player.hurt(dmg * 0.35 * Math.max(0.4, 1 - pd / r), pos, '爆発', undefined, 'magic');
    if (!o.quietFx) this.fx.explosion(pos, o.small ? r * 0.8 : r);
    const ringY = this.world.groundY(pos.x, pos.z) + 0.12;
    if (o.hurtPlayer) this.fx.ring({ x: pos.x, y: ringY, z: pos.z }, r * 0.3, r, ZONE.enemy, 0.35, 0.8);
    else if (!o.small && !o.quietFx) this.fx.ring({ x: pos.x, y: ringY, z: pos.z }, r * 0.3, r, ZONE.ally, 0.3, 0.45);
    if (o.element) this.fx.element(pos, o.element, 1.6);
    // 引火: 炎の爆発が毒の霧に触れると、霧も爆発する
    if (o.element === 'fire' && this.skills.clouds.length) this.skills.ignite(pos, r);
    this.audio.explode(o.small ? 0.4 : r / 4);
    if (!o.small) {
      if (r > 6 && pd < 50) this.fx.shake('L');
      else if (r > 2.4 && pd < 32) this.fx.shake('M');
      else if (pd < 16) this.fx.shake('S');
    }
  }

  // ---------------------------------------------------------------- 衝突（巻き込み・たたきつけ）
  private processCollisions(): void {
    // 衝突の通知は先に全部取り出す。通知を受け取っている最中に物を消すと、物理エンジンの内部が壊れる
    const pairs = this.physics.drainStarted();
    for (let i = 0; i < pairs.length; i += 2) {
      const a = this.physics.ownerOfHandle(pairs[i]);
      const b = this.physics.ownerOfHandle(pairs[i + 1]);
      if (!a || !b) continue;
      this.collide(a, b);
      // 1 つめの処理で片方が消えていることがあるので、持ち主を引き直す
      const a2 = this.physics.ownerOfHandle(pairs[i]);
      const b2 = this.physics.ownerOfHandle(pairs[i + 1]);
      if (a2 && b2) this.collide(b2, a2);
    }
  }

  /** a が b にぶつかったときの処理（a が加害側）。 */
  private collide(a: Owner, b: Owner): void {
    if (a.kind === 'enemy') {
      const e = a.ref as Enemy;
      if (!e.alive) return;
      const flying = e.state === 'knock' || e.state === 'dead' || e.aiState === 2;
      if (!flying || e.prevSpeed < TUNE.chainMinSpeed) return;
      const v = e.prevSpeed;
      const mk = Math.sqrt(e.mass / 60);
      if (b.kind === 'enemy') {
        const o = b.ref as Enemy;
        if (!o.alive || o.state === 'dead' || o === e) return;
        const dx = o.x - e.x;
        const dz = o.z - e.z;
        const d = Math.hypot(dx, dz) || 1;
        // ちゃんこ鍋: 巻き込みの勢いが落ちにくく、次の敵を強く押す
        const chanko = this.ip('chanko');
        const k = Math.min(18 * (1 + 0.3 * chanko), v * 0.55 * mk * (1 + 0.4 * chanko));
        this.enemies.damage(o, TUNE.chainDamage * v * mk, 'chain', { impulse: { x: (dx / d) * k, y: 0.3 * k, z: (dz / d) * k } });
        if (o.state === 'knock') o.chained = true;
        if (this.hasItem('firecracker') && (o.cd?.get('cracker') ?? 0) <= 0) {
          (o.cd ??= new Map()).set('cracker', 0.5);
          this.explode({ x: (e.x + o.x) / 2, y: (e.y + o.y) / 2, z: (e.z + o.z) / 2 }, 2, 12 * this.ip('firecracker'), { source: 'skill', small: true, force: 6, struct: 4, ctx: { kind: 'magic', ap: 0.6 } });
        }
        this.fx.hitMark({ x: (e.x + o.x) / 2, y: (e.y + o.y) / 2, z: (e.z + o.z) / 2 }, Math.min(0.6, v / 30));
        this.audio.hit(Math.min(0.7, v / 25));
        e.prevSpeed *= chanko > 0 ? Math.min(0.95, 0.72 + 0.12 * chanko) : 0.72;
      } else if (b.kind === 'chunk') {
        const ch = b.ref as Chunk;
        if (v < TUNE.slamMinSpeed) return;
        const dx = ch.pos.x - e.x;
        const dz = ch.pos.z - e.z;
        const d = Math.hypot(dx, dz) || 1;
        this.world.hitChunk(ch, (e.mass / 60) * v * 0.9, { x: (dx / d) * 3, y: 0.5, z: (dz / d) * 3 }, { x: e.x, y: e.y, z: e.z });
        if (e.state === 'knock') {
          this.enemies.damage(e, TUNE.slamDamage * (v - 4), 'slam');
          this.fx.dust({ x: e.x, y: e.y, z: e.z }, 0.8, 0xd8d0c0, 2);
        }
        e.prevSpeed *= 0.5;
      } else if (b.kind === 'static') {
        if (e.state !== 'knock' || v < TUNE.slamMinSpeed + 2) return;
        this.enemies.damage(e, TUNE.slamDamage * (v - 6) * 0.8, 'slam');
        this.fx.dust({ x: e.x, y: Math.max(0.1, e.y - e.halfH), z: e.z }, 0.7, 0xe6dcc8, 2);
        this.audio.thud(0.4);
        e.prevSpeed *= 0.5;
      } else if (b.kind === 'prop') {
        const p = b.ref as Prop;
        if (!p.alive) return;
        if (p.hp !== Infinity) this.world.hitProp(p, v * 2 * mk, { x: 0, y: 0, z: 0 });
        else this.world.heat(p, 2);
      }
      return;
    }
    if (a.kind === 'prop' || a.kind === 'debris') {
      const o = a.ref as Prop | Chunk;
      if (o.hot <= 0) return;
      // すでに消えた物の物理ボディには触らない
      if (a.kind === 'prop' ? !(o as Prop).alive : (o as Chunk).state !== 'loose') return;
      const v = o.prevSpeed;
      const isProp = a.kind === 'prop';
      if (v < (isProp ? TUNE.propMinSpeed : 3)) return;
      const body = o.body;
      if (!body) return;
      const t = body.translation();
      const sm = Math.sqrt(o.mass);
      const mul = isProp ? (o as Prop).dmgMul : 0.65;
      if (b.kind === 'enemy') {
        const e = b.ref as Enemy;
        if (!e.alive || e.state === 'dead') return;
        const dx = e.x - t.x;
        const dz = e.z - t.z;
        const d = Math.hypot(dx, dz) || 1;
        const k = Math.min(20, v * Math.sqrt(o.mass / 20) * 0.5);
        this.enemies.damage(e, Math.min(500, TUNE.propDamage * v * sm * mul), 'prop', { impulse: { x: (dx / d) * k, y: 0.35 * k, z: (dz / d) * k } });
        if (e.state === 'knock') e.chained = true;
        if (isProp) (o as Prop).hits++;
        this.fx.hitMark({ x: e.x, y: e.y, z: e.z }, Math.min(0.7, v / 25));
        this.audio.hit(Math.min(0.8, v / 20));
        o.prevSpeed *= 0.8;
      } else if (b.kind === 'chunk') {
        const ch = b.ref as Chunk;
        if (ch.state !== 'fixed') return;
        const dx = ch.pos.x - t.x;
        const dz = ch.pos.z - t.z;
        const d = Math.hypot(dx, dz) || 1;
        this.world.hitChunk(ch, sm * v * (isProp ? 0.5 * mul : 0.25), { x: (dx / d) * 2, y: -0.5, z: (dz / d) * 2 }, { x: t.x, y: t.y, z: t.z });
        o.prevSpeed *= 0.6;
      } else if (b.kind === 'player' && !isProp) {
        if (v > 5 && o.mass > 60) this.player.hurt(8 + v * 0.8, { x: t.x, y: t.y, z: t.z }, 'がれき');
      }
    }
  }

  // ---------------------------------------------------------------- 敵を倒したとき
  onEnemyKilled(e: Enemy, chain: boolean): void {
    this.run.kills++;
    this.itemsOnKill(e, chain);
    // トマトジュース: 12 体ごとに回復
    if (this.stats.killHeal > 0 && this.run.kills % 12 === 0) this.player.heal(this.stats.killHeal);
    const pos = { x: e.x, y: e.y, z: e.z };
    if (chain) {
      this.run.chainKills++;
      if (this.hasItem('pins')) {
        this.pins = Math.min(10, this.pins + 1);
        this.pinsT = 2;
      }
      this.combo++;
      this.comboT = 1.6;
      if (this.combo > this.run.bestCombo) this.run.bestCombo = this.combo;
      if ([3, 6, 10, 20, 40].includes(this.combo)) {
        this.hud.toast(`${this.combo >= 20 ? '大惨事！' : this.combo >= 10 ? 'お見事！' : 'ナイス巻き込み！'} ×${this.combo}`, 'praise');
        this.audio.coin();
        this.player.emote('smug', 1.2);
      }
    }
    const xp = e.def.xp * this.rule.xp;
    if (e.def.boss) {
      this.run.bossKills++;
      for (let i = 0; i < 12; i++) this.pickups.dropXp({ x: pos.x + (Math.random() - 0.5) * 3, y: pos.y, z: pos.z + (Math.random() - 0.5) * 3 }, xp / 12);
      this.pickups.dropItem('chest', pos);
      this.pickups.dropItem('coin', { x: pos.x + 1, y: pos.y, z: pos.z }, Math.round(e.def.coin * this.rule.coins));
      this.hud.toast(`${e.def.name}を倒した！`, 'gold');
      this.fx.flash('gold');
      this.fx.shake('L');
      this.hitStop(0.18);
      this.calm = 6;
      log('boss.kill', { id: e.def.id }, { time: Math.round(this.time), level: this.level });
    } else if (e.elite) {
      // エリート: 経験値 4 倍、コイン、ときどき回復
      this.eliteKills++;
      for (let i = 0; i < 4; i++) this.pickups.dropXp({ x: pos.x + (Math.random() - 0.5) * 1.5, y: pos.y, z: pos.z + (Math.random() - 0.5) * 1.5 }, xp);
      this.pickups.dropItem('coin', { x: pos.x + 0.6, y: pos.y, z: pos.z }, Math.max(2, Math.round(2 * this.rule.coins)));
      if (Math.random() < 0.25 * this.rule.heals) this.pickups.dropItem('heart', { x: pos.x - 0.6, y: pos.y, z: pos.z });
      this.fx.sparkle(pos, 0xffe14d, 10, 1);
    } else {
      this.pickups.dropXp(pos, xp);
      const luck = 1 + this.stats.luck;
      const r = Math.random();
      if (e.def.coin > 0 || r < 0.035 * this.rule.coins) this.pickups.dropItem('coin', pos, Math.max(1, Math.round(Math.max(1, e.def.coin) * this.rule.coins)));
      else if (r < 0.035 + 0.017 * luck * this.rule.heals) this.pickups.dropItem('heart', pos);
      else if (r > 0.9975) this.pickups.dropItem('magnet', pos);
      else if (r > 0.9955) this.pickups.dropItem('bomb', pos);
    }
  }

  /** 倒したときに働くアイテム。 */
  private itemsOnKill(e: Enemy, chain: boolean): void {
    this.itemFx.onKill(e);
    let dirty = false;
    // プロテイン: エリートで AD +1・最大 HP +3（ボスは 10 倍）
    const pr = this.ip('protein');
    if (pr > 0 && (e.elite || e.def.boss)) {
      const m = (e.def.boss ? 10 : 1) * pr;
      this.stack.ad += m;
      this.stack.hp += 3 * m;
      dirty = true;
    }
    // 優等生の手帳: 30 体ごとに AP +2（最大 120）
    const te = this.ip('techo');
    if (te > 0 && this.run.kills % 30 === 0 && this.stack.ap < 120 * te) {
      this.stack.ap = Math.min(120 * te, this.stack.ap + 2 * te);
      dirty = true;
    }
    if (dirty) this.recomputeStats();
    // 文化祭のくす玉: 巻き込み・たたきつけ・物で倒した敵が破裂する
    const ku = this.ip('kusudama');
    if (ku > 0 && chain && (e.cd?.get('kusu') ?? 0) <= 0) {
      (e.cd ??= new Map()).set('kusu', 9);
      this.explode({ x: e.x, y: e.y, z: e.z }, 2.5, 20 * ku, { source: 'skill', small: true, force: 9, struct: 6, ctx: { kind: 'magic', ap: 0.6 } });
      this.fx.sparkle({ x: e.x, y: e.y + 0.5, z: e.z }, 0xff7ad0, 8, 1);
    }
  }

  /** 静電気の下敷き: 当たるたびに電気をためる。20 回で近くの敵 6 体へ雷が伝わる。 */
  addCharge(): void {
    const pw = this.ip('shitajiki');
    if (pw <= 0) return;
    if (++this.charge < 20) return;
    this.charge = 0;
    const p = this.player.pos;
    let from: V3 = { x: p.x, y: p.y + 1.2, z: p.z };
    const done = new Set<Enemy>();
    for (let i = 0; i < 6; i++) {
      const next = this.enemies.nearest(from, i === 0 ? 14 : 8, (o) => done.has(o));
      if (!next) break;
      done.add(next);
      const to = { x: next.x, y: next.y, z: next.z };
      this.fx.bolt(from, to, 0x9fd8ff, 0.25, 0.6, 0.16);
      const dmg = (30 + this.ap * 0.4) * pw * (next.wet > 0 ? 1.5 : 1) * this.stats.power;
      this.enemies.damage(next, dmg, 'skill', { kind: 'magic', noCharge: true });
      from = to;
    }
    this.audio.thunder();
  }

  /** ノリコがダメージを受けたとき（がまんの限界・弁当・診断書）。raw は防御で減らす前。HP がまだ残るかを返す。 */
  onPlayerHurt(raw: number): void {
    this.lastHurtT = this.time;
    this.skills.onPlayerHurt(raw);
    this.itemFx.afterHurt(raw);
  }

  /** 仮病の診断書: HP が 25% を切ったら、2.5 秒間 無敵になり、まわりを吹き飛ばす（60 秒に 1 回）。 */
  tryShindansho(): boolean {
    if (this.ip('shindansho') <= 0 || (this.itemT.shindansho ?? 0) > 0) return false;
    this.itemT.shindansho = 60 / Math.min(2.5, this.ip('shindansho'));
    const p = this.player.pos;
    this.explode({ x: p.x, y: p.y + 0.8, z: p.z }, 6, 10, { force: 24, struct: 10, source: 'skill', ctx: { kind: 'magic', ap: 0.3 } });
    this.fx.flash('gold');
    this.hud.toast('🩺 仮病の診断書！ 2.5 秒間 無敵', 'gold');
    log('item.shindansho', {}, { time: Math.round(this.time) });
    return true;
  }

  /** 時間で働くアイテム。 */
  private updateItems(dt: number): void {
    const T = this.itemT;
    for (const k in T) if (T[k] > 0) T[k] -= dt;
    const p = this.player.pos;
    // モバイルバッテリー: 30 秒ごとに、攻撃スキルの待ち時間がすぐ終わる
    const bat = this.ip('battery');
    if (bat > 0 && (T.battery ?? 0) <= 0) {
      T.battery = 30 / bat;
      for (const s of this.skills.actives) s.cd = Math.min(s.cd, 0);
      this.fx.sparkle({ x: p.x, y: p.y + 1.6, z: p.z }, 0x8fe05a, 10, 0.8);
      log('item.battery', {}, { time: Math.round(this.time) });
    }
    // 日本舞踊の扇子: 8 秒ごとに、近くのいちばん大きな群れを打ち上げる
    const se = this.ip('sensu');
    if (se > 0 && (T.sensu ?? 0) <= 0) {
      const c = this.enemies.cluster(p, 18);
      if (c) {
        T.sensu = 8 / Math.min(2.4, se);
        let n = 0;
        for (const e of this.enemies.list) {
          if (e.state === 'dead' || Math.hypot(e.x - c.x, e.z - c.z) > 3.6) continue;
          this.enemies.launch(e, { x: (Math.random() - 0.5) * 3, y: 11 + 2 * se, z: (Math.random() - 0.5) * 3 });
          n++;
        }
        const gy = this.world.groundY(c.x, c.z);
        this.fx.ring({ x: c.x, y: gy + 0.1, z: c.z }, 0.6, 3.6, ZONE.ally, 0.5, 0.7);
        for (let i = 0; i < 14; i++) this.fx.dust({ x: c.x + (Math.random() - 0.5) * 3, y: gy + Math.random() * 4, z: c.z + (Math.random() - 0.5) * 3 }, 1, 0xd8e8f0, 1);
        this.audio.whoosh();
        log('item.sensu', { n }, { time: Math.round(this.time) });
      } else T.sensu = 1;
    }
    // 体育教師の笛: 6 秒ごとに冷たい波
    const wh = this.ip('whistle');
    if (wh > 0 && (T.whistle ?? 0) <= 0) {
      T.whistle = 6;
      const r = 7 * this.stats.area;
      for (const e of this.enemies.list) {
        if (e.state === 'dead' || Math.hypot(e.x - p.x, e.z - p.z) > r) continue;
        this.enemies.damage(e, (15 + this.ap * 0.3) * wh * this.stats.power, 'skill', { kind: 'magic' });
        this.enemies.slowIt(e, 0.4, 2);
      }
      this.fx.ring({ x: p.x, y: p.y + 0.1, z: p.z }, 0.5, r, ZONE.ally, 0.5, 0.6);
      this.audio.whoosh();
    }
    // 使い捨てカイロ: まわり 3.5m に毎秒の魔法ダメージ（0.5 秒ごとに半分ずつ）
    const ka = this.ip('kairo');
    if (ka > 0 && (T.kairo ?? 0) <= 0) {
      T.kairo = 0.5;
      const dps = (8 + (this.stats.physDef + this.stats.magicDef) * 0.12) * ka;
      for (const e of this.enemies.list) {
        if (e.state === 'dead' || Math.hypot(e.x - p.x, e.z - p.z) > 3.5) continue;
        this.enemies.damage(e, dps * 0.5, 'skill', { kind: 'magic', quiet: true, noCharge: true });
      }
    }
    // 母の手作り弁当: 4 秒間ダメージを受けないと、毎秒 最大 HP の 2% 回復
    const be = this.ip('bento');
    if (be > 0 && this.time - this.lastHurtT > 4 && this.player.hp < this.stats.maxHp) {
      this.stealPool += this.stats.maxHp * 0.02 * be * dt;
    }
  }

  onChunkBroken(): void {
    /* 破壊率は world が数える。演出はここで足せる */
  }

  /**
   * 場面の曲を流す。bgm/ に曲が無ければ合成音。
   * 2 面・3 面・エンドレスは、それぞれ別の曲（合成音）にする。
   */
  playMusic(scene: string): void {
    this.musicState = scene;
    const st = this.stageDef.id;
    const n = this.stageNo;
    const battle = n === 3 ? 'battle3' : n === 2 ? 'battle2' : 'battle';
    const boss = n >= 2 ? 'boss2' : 'boss';
    if (scene === 'stage') this.audio.music([`${st}-${n}`, n === 1 ? st : battle, battle], battle);
    else if (scene === 'late') this.audio.music([n === 1 ? 'late' : `late-${n}`, `${st}-${n}`, n === 1 ? st : battle, battle], battle);
    else if (scene === 'boss') this.audio.music([n === 1 ? 'boss' : boss, 'boss'], boss);
    else if (scene === 'final') this.audio.music([n === 1 ? 'final' : `final-${n}`, boss, 'boss'], boss);
    else if (scene === 'endless') this.audio.music(['endless'], 'endless');
    else this.audio.music([scene], 'none');
  }

  onPlayerDead(by: string): void {
    this.killedBy = by;
    this.state = 'over';
    this.overT = 1.6;
    this.playMusic('gameover');
    this.audio.death();
    this.fx.flash('hurt');
    this.fx.shake('L');
    log('player.dead', { by }, { time: Math.round(this.time), level: this.level, kills: this.run.kills });
  }

  // ---------------------------------------------------------------- 経験値とレベルアップ
  addXp(v: number): void {
    this.xp += v * this.stats.xpGain;
    while (this.xp >= this.xpNeed) {
      this.xp -= this.xpNeed;
      this.level++;
      this.xpNeed = xpForLevel(this.level);
      this.pendingLevels++;
    }
  }

  /** 一時停止画面に出す能力値。 */
  statLines(): [string, string][] {
    const s = this.stats;
    const pct = (v: number) => `${Math.round(v * 100)}%`;
    return [
      ['🗡️ 棒の威力（鍛えた段階）', `${Math.round(this.weaponPower)}（Lv ${this.weaponLv}）`],
      ['⚔️ AD（物理攻撃力）', `${Math.round(this.ad)}`],
      ['🔮 AP（魔法攻撃力）', `${Math.round(this.ap)}`],
      ['💪 威力', `×${s.power.toFixed(2)}`],
      ['🛡️ 物理防御', `${Math.round(s.physDef)}`],
      ['🧿 魔法防御', `${Math.round(s.magicDef)}`],
      ['📐 物理防御の貫通', pct(s.armorPen)],
      ['🔮 魔法防御の貫通', pct(s.magicPen)],
      ['🎯 会心率 / 会心ダメージ', `${pct(s.crit)} / ×${s.critDmg.toFixed(1)}`],
      ['💥 衝撃ダメージ', `×${s.impactMul.toFixed(2)}`],
      ['🧱 たたきつけ', `×${s.slamMul.toFixed(2)}`],
      ['🩸 継続ダメージ', `×${s.dotMul.toFixed(2)}`],
      ['🧃 吸収', pct(s.lifesteal)],
      ['⏳ 待ち時間', `×${s.cooldown.toFixed(2)}`],
      ['🌀 範囲', `×${s.area.toFixed(2)}`],
      ['✨ スキルの威力', `×${s.skillMul.toFixed(2)}`],
      ['🎯 飛び道具の数', `+${s.amount}`],
      ...(this.stack.ad || this.stack.ap || this.stack.hp ? [['🥤 育った分', `AD +${Math.round(this.stack.ad)} / AP +${Math.round(this.stack.ap)} / HP +${Math.round(this.stack.hp)}`] as [string, string]] : []),
      ...(s.projSpeed !== 1 ? [['🥎 飛び道具の速さ', `×${s.projSpeed.toFixed(2)}`] as [string, string]] : []),
      ...(s.bigMul !== 1 ? [['👊 エリートとボスへのダメージ', `×${s.bigMul.toFixed(2)}`] as [string, string]] : []),
      ...this.itemFx.statLines().map((t) => [t, ''] as [string, string]),
    ];
  }

  /** スキル欄に出す「たまっている数」（スタック）と、その効果。 */
  stackInfo(): StackInfo[] {
    const out: StackInfo[] = [];
    this.skills.stacks(out);
    this.itemFx.stacks(out);
    const r = Math.round;
    if (this.ip('protein') > 0 && (this.stack.ad > 0 || this.stack.hp > 0)) out.push({ key: 'i:protein', badge: `+${r(this.stack.ad)}`, text: `🥤 プロテイン　AD +${r(this.stack.ad)}・最大 HP +${r(this.stack.hp)}` });
    const te = this.ip('techo');
    if (te > 0 && this.stack.ap > 0) out.push({ key: 'i:techo', badge: `+${r(this.stack.ap)}`, fill: this.stack.ap / (120 * te), text: `📒 優等生の手帳　AP +${r(this.stack.ap)}（上限 ${r(120 * te)}）` });
    if (this.pins > 0 && this.hasItem('pins')) out.push({ key: 'i:pins', badge: `×${this.pins}`, fill: this.pins / 10, text: `🎳 ボウリングのピン ×${this.pins}/10　衝撃ダメージ +${r((this.pinsMul() - 1) * 100)}%` });
    if (this.detours.buffT > 0) out.push({ key: 'x:yaruki', badge: '', text: `⭐ やる気満々　与えるダメージ +25%・移動 +12%　残り ${Math.ceil(this.detours.buffT)} 秒` });
    if (this.ip('shitajiki') > 0 && this.charge > 0) out.push({ key: 'i:shitajiki', badge: String(this.charge), fill: this.charge / 20, text: `⚡ 静電気の下敷き ${this.charge}/20　20 で雷が伝わる` });
    return out;
  }

  /** 画面に見せる、持っているスキル（コピー）。 */
  ownedSkills(): OwnedSkillsInfo {
    return { actives: this.skills.actives.map((a) => ({ id: a.id, level: a.level, evolved: a.evolved, brk: a.brk, bk: { ...a.bk } })), passives: this.skills.passives.map((p) => ({ ...p })), items: [...this.items], itemLv: { ...this.itemLv } };
  }

  private choiceState() {
    return { actives: this.skills.actives.map((a) => ({ id: a.id, level: a.level, evolved: a.evolved, brk: a.brk, bk: { ...a.bk } })), passives: this.skills.passives.map((p) => ({ ...p })), banished: this.banished, luck: this.stats.luck, items: this.items, weaponLv: this.weaponLv };
  }

  private applyBonus(c: Choice): void {
    if (c.id === 'heal') {
      this.player.heal(this.stats.maxHp * 0.3);
      this.audio.heal();
    } else {
      this.run.coins += 10;
      this.audio.coin();
    }
  }

  private async levelUpFlow(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.state = 'levelup';
    // 画面固定は外さない。外すと OS のカーソルが前回クリックした位置に現れ、連打していると意図しない選択になる
    this.audio.levelup();
    this.player.emote('happy', 2);
    this.fx.sparkle({ x: this.player.pos.x, y: this.player.pos.y + 1, z: this.player.pos.z }, 0xffe14d, 14, 1.2);
    try {
      while (this.pendingLevels > 0 && !this.disposed) {
        // 5 レベルごとは、アイテムを選ぶ回（新しいアイテムか、持っているアイテムの★上げ。どちらも無ければスキル）
        const shownLevel = this.level - this.pendingLevels + 1;
        const itemTurn = isItemLevel(shownLevel) && rollItemChoices(this.items, this.itemLv, Math.random, 1).length > 0;
        const roll = (n: number): Choice[] => (itemTurn ? rollItemChoices(this.items, this.itemLv, Math.random, n) : rollChoices(this.choiceState(), Math.random, n));
        // 職員室の合鍵で 1 枚、運が高いとさらに 1 枚増える
        let choices = roll(this.itemFx.choiceN());
        log('levelup.open', { level: this.level, pending: this.pendingLevels }, { choices: choices.map((c) => `${c.kind}:${c.id}`) });
        for (;;) {
          // 自動操作（動作確認用）のときは、先頭の選択肢をそのまま選ぶ
          let ans: LevelUpAnswer;
          if (this.player.auto) ans = { pick: choices[0] };
          else {
            const asked = this.hooks.levelUp(choices, { level: shownLevel, rerolls: this.rerolls, banishes: itemTurn ? 0 : this.banishes, owned: this.ownedSkills(), mode: itemTurn ? 'item' : 'skill' });
            // 画面を作ったあとで、メニュー用のカーソルを決まった位置に出す（画面固定中だけ）
            this.input.menuCursor(true);
            ans = await asked;
          }
          if (this.disposed) return;
          if (ans.action === 'reroll' && this.rerolls > 0) {
            this.rerolls--;
            choices = roll(choices.length);
            log('levelup.reroll', { left: this.rerolls }, { choices: choices.map((c) => `${c.kind}:${c.id}`) });
            continue;
          }
          if (ans.banish && this.banishes > 0 && ans.banish.kind === 'new') {
            this.banishes--;
            this.banished.push(ans.banish.id);
            choices = rollChoices(this.choiceState(), Math.random, choices.length);
            log('levelup.banish', { id: ans.banish.id, left: this.banishes });
            continue;
          }
          if (ans.pick) {
            if (ans.pick.kind === 'bonus') this.applyBonus(ans.pick);
            else if (ans.pick.kind === 'item') {
              this.addItem(ans.pick.id);
              this.audio.evolve();
            } else if (ans.pick.kind === 'itemup') {
              this.upgradeItem(ans.pick.id);
              this.audio.evolve();
            } else if (ans.pick.kind === 'weapon') {
              this.trainWeapon();
              this.audio.evolve();
            } else {
              this.skills.apply(ans.pick);
              if (ans.pick.kind === 'evolve') {
                this.audio.evolve();
                this.fx.flash('gold');
              }
            }
            log('levelup.pick', { kind: ans.pick.kind, id: ans.pick.id, level: ans.pick.level, ...(ans.pick.sub ? { sub: ans.pick.sub } : {}) });
          } else log('levelup.skip', {});
          break;
        }
        this.pendingLevels--;
      }
    } finally {
      this.busy = false;
      this.input.menuCursor(false);
    }
    if (this.disposed) return;
    // 再開直後に囲まれて殴られないよう、まわりの敵を押しのける
    const pp = this.player.pos;
    this.explode({ x: pp.x, y: pp.y + 0.8, z: pp.z }, 4.5, 4, { force: 13, struct: 0, source: 'skill', quietFx: true, small: true });
    this.fx.ring({ x: pp.x, y: pp.y + 0.1, z: pp.z }, 0.5, 4.5, ZONE.ally, 0.35);
    this.player.inv = Math.max(this.player.inv, 0.8);
    this.state = 'playing';
    if (!this.player.auto) this.input.requestLock();
  }

  /**
   * 宝箱を開ける。boss: ボスの宝箱（スキルをまとめて強化し、アイテムも選べる）/ small: 寄り道の落とし物（スキルを 1〜2 つ強化）/
   * item: 賞金首のごほうび（アイテムを選ぶだけ）。
   */
  openChest(kind: 'boss' | 'small' | 'item' = 'boss'): void {
    this.chestKinds.push(kind);
    this.chestQueue++;
  }

  private async chestFlow(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.state = 'levelup';
    try {
      while (this.chestQueue > 0 && !this.disposed) {
        this.chestQueue--;
        const kind = this.chestKinds.shift() ?? 'boss';
        const r = Math.random() - this.stats.luck * 0.3;
        const n = kind === 'item' ? 0 : kind === 'small' ? (r < 0.35 ? 2 : 1) : r < 0.12 ? 5 : r < 0.45 ? 3 : 1;
        const got: Choice[] = [];
        for (let i = 0; i < n; i++) {
          const pool = choicePool(this.choiceState()).filter((p) => p.choice.kind !== 'new');
          if (!pool.length) break;
          const evo = pool.find((p) => p.choice.kind === 'evolve');
          const pick = evo ? evo.choice : pool[Math.floor(Math.random() * pool.length)].choice;
          if (pick.kind === 'weapon') this.trainWeapon();
          else this.skills.apply(pick);
          got.push(pick);
        }
        const coins = (kind === 'boss' ? 15 : 8) + Math.floor(Math.random() * 20);
        this.run.coins += coins;
        this.audio.evolve();
        log('chest.open', { count: n, kind }, { got: got.map((c) => `${c.kind}:${c.id}`), coins });
        if (!this.player.auto && kind !== 'item') {
          const shown = this.hooks.chest(got, coins);
          this.input.menuCursor(true);
          await shown;
        }
        const choices = kind === 'small' ? [] : rollItemChoices(this.items, this.itemLv, Math.random, 3);
        const offer = choices.map((c) => `${c.kind}:${c.id}`);
        if (choices.length && !this.disposed) {
          let ans: LevelUpAnswer = { pick: choices[0] };
          if (!this.player.auto) {
            const asked = this.hooks.levelUp(choices, { level: this.level, rerolls: 0, banishes: 0, owned: this.ownedSkills(), mode: 'item' });
            this.input.menuCursor(true);
            ans = await asked;
          }
          if (ans.pick?.kind === 'item') this.addItem(ans.pick.id);
          else if (ans.pick?.kind === 'itemup') this.upgradeItem(ans.pick.id);
          log('chest.item', { offer }, { pick: ans.pick ? `${ans.pick.kind}:${ans.pick.id}` : null });
        }
      }
    } finally {
      this.busy = false;
      this.input.menuCursor(false);
    }
    if (this.disposed) return;
    this.state = 'playing';
    this.input.requestLock();
  }

  async pause(): Promise<void> {
    if (this.state !== 'playing' || this.busy) return;
    this.busy = true;
    this.state = 'paused';
    this.input.releaseLock();
    log('game.pause', { time: Math.round(this.time) });
    let ans: 'resume' | 'quit' = 'resume';
    try {
      ans = await this.hooks.pause(this.ownedSkills(), this.statLines());
    } finally {
      this.busy = false;
    }
    if (this.disposed) return;
    log('game.pause.end', { answer: ans });
    this.fx.shakeScale = this.save.settings.shake;
    if (ans === 'quit') {
      this.finish(false, '自主的に下校');
      return;
    }
    this.state = 'playing';
    this.input.requestLock();
  }

  // ---------------------------------------------------------------- 出現
  /** エリートにするかどうかと、その種類。 */
  private rollElite(): EliteKind | null {
    if (Math.random() >= eliteChance(this.time, this.diff.elite) + this.foe.elite) return null;
    const r = Math.random();
    return r < 0.4 ? 'tough' : r < 0.75 ? 'swift' : 'bomb';
  }

  private pickEnemy(mix: [string, number][]): string {
    const total = mix.reduce((a, m) => a + m[1], 0);
    let r = Math.random() * total;
    for (const [id, w] of mix) {
      r -= w;
      if (r <= 0) return id;
    }
    return mix[0][0];
  }

  /** エンドレスのラスボスのあとの敵の出方（レベルとともに増える） */
  private endlessWave(): WaveDef {
    const lv = this.endlessLv;
    return { from: 0, interval: Math.max(0.22, 0.34 - 0.012 * lv), batch: [6, 10], cap: 240, mix: ENDLESS_MIX };
  }

  private director(dt: number): void {
    if (this.calm > 0) this.calm -= dt;
    const waves = this.tier.waves;
    let wave = waves[0];
    for (const w of waves) if (this.time >= w.from) wave = w;
    if (this.endless) wave = this.endlessWave();
    this.spawnT -= dt;
    if (this.spawnT <= 0 && this.calm <= 0) {
      const spawnMul = this.rule.spawn * this.diff.spawn * this.foe.spawn;
      this.spawnT = wave.interval / Math.max(0.5, Math.sqrt(spawnMul));
      const cap = Math.min(TUNE.maxEnemies, wave.cap * spawnMul);
      if (this.enemies.living < cap) {
        const n = Math.round((wave.batch[0] + Math.random() * (wave.batch[1] - wave.batch[0])) * Math.sqrt(spawnMul));
        const first = this.enemies.spawnAround(this.pickEnemy(wave.mix), 24, 34, this.rollElite());
        if (first) {
          for (let i = 1; i < n; i++) {
            const id = this.pickEnemy(wave.mix);
            const a = Math.random() * Math.PI * 2;
            const x = first.x + Math.cos(a) * (1 + Math.random() * 2.5);
            const z = first.z + Math.sin(a) * (1 + Math.random() * 2.5);
            if (this.world.spawnOk(x, z)) this.enemies.spawn(id, x, z, undefined, this.rollElite());
          }
        }
      }
    }
    const bosses = this.tier.bosses;
    if (this.bossIdx < bosses.length && this.time >= bosses[this.bossIdx].at) {
      const ev = bosses[this.bossIdx++];
      for (const id of ev.ids) this.enemies.spawnAround(id, 26, 30);
      this.hud.toast(ev.text, 'warn');
      this.audio.boss();
      this.fx.flash('dark');
      if (ev.at >= TUNE.runLength) this.finalPhase = true;
      log('boss.spawn', { ids: ev.ids }, { time: Math.round(this.time), enemies: this.enemies.count });
    }
    const bossAlive = this.enemies.bosses.length > 0;
    // 曲: ボスがいればボスの曲（ラスボスは専用）。8 分を過ぎたら終盤の曲（あれば）。エンドレスは専用の曲
    const scene = this.endless ? 'endless' : bossAlive ? (this.finalBoss ? 'final' : 'boss') : this.time >= 480 ? 'late' : 'stage';
    if (scene !== this.musicState) this.playMusic(scene);
    if (this.endless) {
      this.endlessDirector(dt);
      return;
    }
    if (this.finalPhase && !bossAlive && this.state === 'playing' && !this.finalBoss) {
      // 三巨頭が倒れたら、合体したラスボスが現れる
      this.finalBoss = true;
      const id = this.tier.final;
      this.enemies.spawnAround(id, 18, 24);
      this.hud.toast(this.tier.finalText, 'warn');
      this.audio.boss();
      this.fx.flash('dark');
      this.fx.shake('L');
      log('boss.spawn', { ids: [id] }, { time: Math.round(this.time), enemies: this.enemies.count });
    } else if (this.finalPhase && this.finalBoss && !bossAlive && this.state === 'playing') {
      this.stageCleared();
    }
  }

  /** ラスボスを倒した。3 面通しなら次の面へ（3 面なら全部クリア）。エンドレスなら終わらずに続く。 */
  private stageCleared(): void {
    const s = this.save;
    s.stats.clears++;
    if (this.diff.id !== 'normal') s.stats.hardClears++;
    writeSave(s);
    this.fx.flash('gold');
    this.player.emote('happy', 5);
    log('game.clear', { mode: this.mode, stageNo: this.stageNo }, { time: Math.round(this.time), total: Math.round(this.totalTime), level: this.level, kills: this.run.kills });
    if (this.mode === 'endless') {
      this.endless = true;
      this.endlessLv = 0;
      this.endlessT = 25;
      this.calm = 4;
      this.audio.clear();
      this.hud.toast('ラスボスを倒した！ ……でも、まだ終わらない', 'gold');
      this.hud.toast('♾️ エンドレス開始！ どこまで耐えられる？', 'warn');
      this.player.heal(this.stats.maxHp * 0.5);
      log('endless.start', {}, { time: Math.round(this.time), level: this.level });
      return;
    }
    this.state = 'clear';
    this.overT = 2.6;
    this.playMusic('clear');
    this.audio.clear();
    this.hud.toast(this.stageNo < STORY_STAGES ? `${this.stageNo} 面クリア！ 次の現場へ向かう` : '学校を守りきった！', 'gold');
  }

  /** エンドレス: 一定の間隔で、強くなったラスボスが来る。レベルが上がるほど、ほかのボスもついてくる。 */
  private endlessDirector(dt: number): void {
    this.endlessT -= dt;
    if (this.endlessT > 0) return;
    this.endlessT = 70;
    const lv = ++this.endlessLv;
    const plan = endlessPlan(lv);
    const boss = this.enemies.spawnAround(plan.final, 18, 24);
    if (boss) {
      boss.title = `${boss.def.name}・改 Lv${lv}`;
      boss.armor += 8 * lv;
      boss.mr += 8 * lv;
    }
    const others = Object.keys(ENEMIES).filter((k) => ENEMIES[k].boss && !ENDLESS_FINALS.includes(k));
    const extra: string[] = [];
    for (let i = 0; i < plan.extra; i++) {
      const id = others[Math.floor(Math.random() * others.length)];
      extra.push(id);
      this.enemies.spawnAround(id, 22, 30);
    }
    this.hud.toast(`♾️ エンドレス Lv${lv}　${boss?.title ?? ENEMIES[plan.final].name}が来た！`, 'warn');
    this.audio.boss();
    this.fx.flash('dark');
    this.fx.shake('L');
    log('endless.wave', { lv, final: plan.final, extra }, { time: Math.round(this.time), total: Math.round(this.totalTime), level: this.level, enemies: this.enemies.count, hpMul: Math.round(this.foe.bossHp * 100) / 100 });
  }

  /** 面をクリアしたあと、次の面へ進まずに終える（結果を出す）。 */
  leaveAfterClear(): void {
    this.finish(true, '');
  }

  /** 次の面へ引き継ぐものをまとめる。 */
  private makeCarry(): Carry {
    const left = this.pickups.leftovers();
    return {
      stageNo: this.stageNo + 1,
      visited: [...(this.carry?.visited ?? []), this.stageDef.id],
      time: this.totalTime,
      level: this.level,
      xp: this.xp,
      actives: this.skills.carry(),
      passives: this.skills.passives.map((p) => ({ ...p })),
      items: [...this.items],
      itemLv: { ...this.itemLv },
      stack: { ...this.stack },
      weaponBonus: this.player.weaponBonus,
      weaponLv: this.weaponLv,
      trophy: this.itemFx.trophy,
      rerolls: this.rerolls,
      banishes: this.banishes,
      banished: [...this.banished],
      revives: this.player.revives,
      run: { ...this.run },
      eliteKills: this.eliteKills,
      destruction: (this.carry?.destruction ?? 0) + this.world.destruction,
      xpBank: left.xp,
      pendingLevels: this.pendingLevels,
      chests: [...this.chestKinds, ...Array.from({ length: left.chests }, () => 'boss' as const)],
    };
  }

  // ---------------------------------------------------------------- 終了
  private finish(clear: boolean, by: string): void {
    if (this.disposed) return;
    const s = this.save;
    const before = unlockedWeapons(s).map((w) => w.id);
    // 破壊率は、回った面の平均
    const destruction = ((this.carry?.destruction ?? 0) + this.world.destruction) / this.stageNo;
    const stagesCleared = this.stageNo - 1 + (clear ? 1 : 0) + (this.endless ? 1 : 0);
    const total = this.totalTime;
    const coinsEarned = Math.round((this.run.coins + Math.floor(this.run.kills / 15) + this.level * 2 + 150 * stagesCleared + 20 * this.endlessLv + Math.floor(destruction)) * this.diff.coins * this.stats.coinMul);
    s.coins += coinsEarned;
    s.stats.runs++;
    s.stats.bestTime = Math.max(s.stats.bestTime, Math.floor(total));
    let newBest = false;
    if (this.mode === 'endless') {
      newBest = Math.floor(total) > s.stats.endlessBest;
      s.stats.endlessBest = Math.max(s.stats.endlessBest, Math.floor(total));
      s.stats.endlessLv = Math.max(s.stats.endlessLv, this.endlessLv);
    }
    if (clear && this.mode === 'story' && this.stageNo >= STORY_STAGES) s.stats.storyClears++;
    s.stats.totalKills += this.run.kills;
    s.stats.bossKills += this.run.bossKills;
    s.stats.chainKills += this.run.chainKills;
    s.stats.maxLevel = Math.max(s.stats.maxLevel, this.level);
    s.stats.maxDestruction = Math.max(s.stats.maxDestruction, Math.floor(destruction));
    writeSave(s);
    const newWeapons = unlockedWeapons(s).filter((w) => !before.includes(w.id));
    const skills = [
      ...this.skills.actives.map((a) => {
        const d = SKILL_MAP[a.id];
        return a.evolved && d.evo ? { emoji: d.evo.emoji, name: d.evo.name, level: '★' } : { emoji: d.emoji, name: d.name, level: `Lv${a.level}` };
      }),
      ...this.skills.passives.map((p) => ({ emoji: SKILL_MAP[p.id].emoji, name: SKILL_MAP[p.id].name, level: `Lv${p.level}` })),
      ...this.items.map((id) => ({ emoji: ITEM_MAP[id].emoji, name: ITEM_MAP[id].name, level: starText(this.itemLv[id] ?? 1) })),
    ];
    const route = [...(this.carry?.visited ?? []), this.stageDef.id].map((id) => STAGES.find((x) => x.id === id) ?? this.stageDef);
    const endlessLv = this.endlessLv;
    const data: ResultData = { clear, mode: this.mode, stageNo: this.stageNo, stagesCleared, endlessLv, newBest, route, time: total, level: this.level, run: this.run, destruction, coinsEarned, newWeapons, skills, killedBy: by, rule: this.ruleDef, stage: this.stageDef, difficulty: this.diff };
    log('game.result', { clear, by, stage: this.stageDef.id, difficulty: this.diff.id, mode: this.mode, stageNo: this.stageNo }, { stagesCleared, endlessLv, newBest, total: Math.round(total), route: route.map((r) => r.id), items: this.items.map((id) => `${id}:${this.itemLv[id] ?? 1}`), breaks: [...this.skills.actives, ...this.skills.passives].filter((s) => s.brk).map((s) => `${s.id}:${s.brk}`), eliteKills: this.eliteKills, finalBoss: this.finalBoss, time: Math.round(this.time), level: this.level, kills: this.run.kills, chainKills: this.run.chainKills, bossKills: this.run.bossKills, destruction: Math.round(destruction * 10) / 10, coinsEarned, newWeapons: newWeapons.map((w) => w.id), fps: Math.round(this.hud.fps) });
    this.input.releaseLock();
    this.hooks.result(data);
  }

  // ---------------------------------------------------------------- デバッグ
  private debugKeys(): void {
    const i = this.input;
    if (i.hit('F2')) {
      this.debug.on = !this.debug.on;
      log('debug.toggle', { on: this.debug.on });
    }
    if (!this.debug.on) return;
    if (i.hit('KeyL')) this.addXp(this.xpNeed - this.xp + 0.01);
    if (i.hit('KeyG')) this.debug.god = !this.debug.god;
    if (i.hit('KeyP')) this.player.auto = !this.player.auto;
    if (i.hit('KeyT')) this.time += 60;
    if (i.hit('KeyB')) {
      const ids = Object.keys(ENEMIES).filter((k) => ENEMIES[k].boss);
      this.enemies.spawnAround(ids[Math.floor(Math.random() * ids.length)], 14, 18);
    }
    if (i.hit('KeyK')) for (const e of this.enemies.list.slice()) this.enemies.damage(e, 99999, 'skill', { quiet: true });
    if (i.hit('KeyN')) for (let k = 0; k < 30; k++) this.enemies.spawnAround(this.pickEnemy(WAVES[4].mix), 8, 16);
    if (i.hit('KeyX')) this.explode({ x: this.player.pos.x + Math.sin(this.player.yaw) * 8, y: 1, z: this.player.pos.z + Math.cos(this.player.yaw) * 8 }, 8, 150, { force: 25, struct: 250, source: 'skill' });
  }

  /** デバッグ用: スキルを直接与える。 */
  debugGive(id: string, level = 1, evolve = false): void {
    const def = SKILL_MAP[id];
    if (!def) return;
    const list = def.kind === 'active' ? this.skills.actives : this.skills.passives;
    if (!list.find((x) => x.id === id)) this.skills.apply({ kind: 'new', id, level: 1 });
    for (let l = 2; l <= Math.min(def.max, level); l++) this.skills.apply({ kind: 'up', id, level: l });
    if (evolve) this.skills.apply({ kind: 'evolve', id, level: def.max });
    void applyChoice;
  }

  // ---------------------------------------------------------------- 1 フレーム
  frame(real: number): void {
    if (this.disposed) return;
    const inp = this.input;
    real = Math.min(real, 0.05);
    this.debugKeys();
    let dt = 0;
    if (this.state === 'playing' || this.state === 'over' || this.state === 'clear') {
      if (this.stopT > 0) this.stopT -= real;
      else dt = Math.min(real, 1 / 30) * (this.state === 'over' ? 0.35 : 1);
    }
    // 視点はヒットストップ中も動かす（時間を止めている間のマウスの移動を捨てない）
    if (this.state === 'playing' || this.state === 'over' || this.state === 'clear') this.player.look();
    if (dt > 0) {
      if (this.state === 'playing') {
        if (inp.hit('Escape') || inp.hit('KeyP') && !this.debug.on) void this.pause();
        if (inp.down('KeyW') || inp.down('KeyA') || inp.down('KeyS') || inp.down('KeyD')) this.hud.noteAction('move');
        if (inp.buttons.has(0)) this.hud.noteAction('attack');
        if (this.player.dashing) this.hud.noteAction('dash');
      }
      this.time += this.state === 'playing' ? dt : 0;
      this.player.update(dt);
      this.enemies.update(dt);
      this.skills.update(dt);
      this.projectiles.update(dt);
      this.world.update(dt);
      this.physics.step(dt);
      this.processCollisions();
      this.pickups.update(dt);
      if (this.state === 'playing') {
        this.director(dt);
        this.detours.update(dt);
      }
      if (this.pinsT > 0) {
        this.pinsT -= dt;
        if (this.pinsT <= 0) this.pins = 0;
      }
      if (this.shieldT > 0) this.shieldT -= dt;
      if (this.state === 'playing') this.itemFx.update(dt);
      if (this.state === 'playing' && this.items.length) this.updateItems(dt);
      this.stealT -= dt;
      if (this.stealT <= 0) {
        this.stealT = 0.5;
        if (this.stealPool >= 1) {
          this.player.heal(this.stealPool);
          this.stealPool = 0;
        }
      }
      if (this.comboT > 0) {
        this.comboT -= dt;
        if (this.comboT <= 0) this.combo = 0;
      }
      if (this.state === 'over' || this.state === 'clear') {
        this.overT -= real;
        if (this.overT <= 0) {
          const clear = this.state === 'clear';
          if (clear && this.mode === 'story' && this.stageNo < STORY_STAGES) {
            // 次の面へ: 育てたものをまとめて渡す。
            // 画面固定は外さない（外すと OS のカーソルが前回クリックした位置に現れ、見失いやすい）。メニュー用のカーソルで選ぶ
            this.state = 'paused';
            const next = this.makeCarry();
            log('game.next', { from: this.stageDef.id, stageNo: next.stageNo }, { level: this.level, total: Math.round(next.time), locked: this.input.locked });
            this.hooks.stageClear(next);
            this.input.menuCursor(true);
          } else {
            this.finish(clear, clear ? '' : this.killedBy);
            this.state = 'paused';
          }
        }
      } else if (this.state === 'playing' && !this.busy) {
        if (this.pendingLevels > 0) void this.levelUpFlow();
        else if (this.chestQueue > 0) void this.chestFlow();
      }
      this.perfT += dt;
      if (this.perfT >= 10) {
        this.perfT = 0;
        log('perf', { time: Math.round(this.time) }, { fps: Math.round(this.hud.fps), enemies: this.enemies.count, loose: this.world.loose.length, props: this.world.props.length, particles: this.fx.particleCount, level: this.level, hp: Math.round(this.player.hp), kills: this.run.kills, destruction: Math.round(this.world.destruction * 10) / 10, shots: this.shotCount, warns: this.warnCount, elites: this.enemies.list.filter((e) => e.elite && e.state !== 'dead').length, bosses: this.enemies.bosses.length });
        this.shotCount = 0;
        this.warnCount = 0;
      }
    }
    this.enemies.render();
    this.player.render(real);
    this.fx.update(dt, real);
    this.hud.update(real);
    this.engine.render();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.input.menuCursor(false);
    this.audio.bgm('none');
    this.skills.dispose();
    this.detours.dispose();
    this.projectiles.clear();
    this.pickups.clear();
    this.player.dispose();
    this.hud.dispose();
    this.fx.dispose();
    this.world.dispose();
    this.physics.dispose();
    this.engine.scene.fog = null;
    void this.ui;
    log('game.dispose', {});
  }
}
