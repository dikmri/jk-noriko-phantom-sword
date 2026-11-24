import * as THREE from 'three';
import { emojiSprite } from '../core/assets';
import { G, groups, Owner, RAPIER } from '../core/physics';
import { rotY, V3 } from '../core/vec';
import { log } from '../log';
import { WeaponPose, weaponPose } from '../motion/arm';
import { SKILL_MAP, SkillDmg } from './defs';
import type { Enemy } from './enemies';
import { ZONE } from './fx';
import type { Game } from './game';
import type { StackInfo } from './hud';
import { sweepWeapon, SwingCtx } from './player';
import { NorikoRig } from './rig';
import { breakMul, Choice, growGain, Owned } from './rules';
import { MoreSkills } from './skillsMore';
import { UsdSkills } from './skillsUsd';
import { ThirdSkills } from './skillsThird';
import { FourthSkills } from './skillsFourth';
import { PROPS, type Chunk, type Prop } from './world';

export interface SkillInst extends Owned {
  cd: number;
  /** スキルごとの作業用データ */
  st: Record<string, any>;
  /** ダメージの種類と反映率（限界突破の威力の倍率を含む） */
  ctx?: SkillDmg | null;
  /** 限界突破の倍率 */
  bm?: { dmg: number; cd: number; area: number; amt: number };
}

/** 次の面へ引き継ぐ攻撃スキル */
export interface CarrySkill extends Owned {
  /** 学級委員の指名でたまった数 */
  stacks?: number;
}

export interface Task {
  update(dt: number): boolean;
  dispose?(): void;
  /** 作られたときに動いていたスキルのダメージの種類（あとで当たるときに使う） */
  ctx?: SkillDmg | null;
}

type Handler = (s: SkillInst, dt: number) => void;

/** 妄想バイオの毒の霧。fuse >= 0 は引火して爆発するまでの秒数 */
interface Cloud {
  x: number;
  z: number;
  r: number;
  life: number;
  max: number;
  dps: number;
  tick: number;
  fuse: number;
  seed: number;
  /** 地面の高さ */
  gy: number;
}

interface Peel {
  x: number;
  z: number;
  sp: THREE.Sprite;
  life: number;
  uses: number;
}

const UPV = new THREE.Vector3(0, 1, 0);
const CLOUD_CAP = 72;
const cm4 = new THREE.Matrix4();
const cq = new THREE.Quaternion();
const cp = new THREE.Vector3();
const cs = new THREE.Vector3();

/** 毎フレーム呼ぶ（待ち時間で発動するのではなく、出しっぱなしの）スキル */
const CONTINUOUS = new Set(['desk', 'compass', 'clone', 'cat', 'bio', 'roomba', 'flail']);

export class Skills {
  actives: SkillInst[] = [];
  passives: Owned[] = [];
  /** 毒の霧（妄想バイオ） */
  clouds: Cloud[] = [];
  /** バナナの皮 */
  peels: Peel[] = [];
  /** 牛乳・カレーの水たまり */
  puddles: { x: number; z: number; r: number; burn: boolean }[] = [];
  /** いま出ているグラビデの渦の中心（無ければ null） */
  vortex: V3 | null = null;
  /** 鳴っている目覚まし時計 */
  private alarms: { x: number; z: number; t: number; life: number; sp: THREE.Sprite; L: number; E: boolean; ring: number; lure: { x: number; z: number; r: number } }[] = [];
  /** 置いてあるトランポリン */
  private tramps: { x: number; z: number; r: number; life: number; mesh: THREE.Group; pad: THREE.Mesh; squash: number; pcd: number; L: number; E: boolean }[] = [];
  private tasks: Task[] = [];
  private handlers: Record<string, Handler>;
  private boomCd = 0;
  private slashCd = 0;
  private cloudMesh: THREE.InstancedMesh | null = null;
  private comboT = new Map<string, number>();
  /** いま動いているスキルのダメージの種類と反映率（弾・爆発・あとで動く処理に引き継ぐ） */
  cur: SkillDmg | null = null;
  /** かんしゃく玉地雷 */
  private mines: { x: number; z: number; gy: number; sp: THREE.Sprite; arm: number; life: number; L: number; E: boolean; ctx: SkillDmg | null }[] = [];
  /** カセットテープ: もう一度発動するスキルと、残り秒数 */
  private echoes: { s: SkillInst; t: number }[] = [];
  /** 第 2 弾の攻撃スキル */
  more: MoreSkills;
  /** 第 2 弾の攻撃スキル（本物の形の物体を使うもの） */
  usd: UsdSkills;
  /** 第 3 弾の攻撃スキル */
  third: ThirdSkills;
  /** 第 4 弾の攻撃スキル */
  fourth: FourthSkills;

  constructor(private g: Game) {
    this.handlers = {
      chalk: (s) => this.chalk(s),
      eraser: (s) => this.eraser(s),
      uwabaki: (s) => this.uwabaki(s),
      pencil: (s) => this.pencil(s),
      fire: (s) => this.fire(s),
      thunder: (s) => this.thunder(s),
      blizzard: (s) => this.blizzard(s),
      gravity: (s) => this.gravity(s),
      desk: (s, dt) => this.orbit(s, dt, 'desk'),
      compass: (s, dt) => this.orbit(s, dt, 'compass'),
      milk: (s) => this.milk(s),
      randoseru: (s) => this.randoseru(s),
      statue: (s) => this.statue(s),
      ball: (s) => this.ball(s),
      wave: (s) => this.wave(s),
      tornado: (s) => this.tornado(s),
      stomp: (s) => this.stomp(s),
      clone: (s, dt) => this.clone(s, dt),
      slashwave: () => {},
      boomsword: () => {},
      ufo: (s) => this.ufo(s),
      cat: (s, dt) => this.cat(s, dt),
      laser: (s) => this.laser(s),
      timestop: (s) => this.timestop(s),
      nuke: (s) => this.nuke(s),
      bio: (s, dt) => this.bio(s, dt),
      grow: () => {},
      banana: (s) => this.banana(s),
      bowling: (s) => this.bowling(s),
      poltergeist: (s) => this.poltergeist(s),
      swing: (s) => this.swing(s),
      chime: (s) => this.chime(s),
      balloon: (s) => this.balloon(s),
      hanabi: (s) => this.hanabi(s),
      alarm: (s) => this.alarm(s),
      bubble: (s) => this.bubble(s),
      roomba: (s, dt) => this.roomba(s, dt),
      domino: (s) => this.domino(s),
      megaphone: (s) => this.megaphone(s),
      trampoline: (s) => this.trampoline(s),
      foam: (s) => this.foam(s),
      carve: (s) => this.carve(s),
      detention: (s) => this.detention(s),
      acid: (s) => this.acid(s),
      rocket: (s) => this.rocket(s),
      billiard: (s) => this.billiard(s),
      pitfall: (s) => this.pitfall(s),
      flail: (s, dt) => this.flail(s, dt),
      shield: (s) => this.shield(s),
      hook: (s) => this.hook(s),
      globe: (s) => this.globe(s),
      snowball: (s) => this.snowball(s),
      pitching: (s) => this.pitching(s),
      landmine: (s) => this.landmine(s),
      geyser: (s) => this.geyser(s),
      cardboard: (s) => this.cardboard(s),
      brand: (s) => this.brand(s),
      gourei: (s) => this.gourei(s),
      gaman: (s) => this.gaman(s),
    };
    this.more = new MoreSkills(g, this);
    this.usd = new UsdSkills(g, this);
    this.third = new ThirdSkills(g, this);
    this.fourth = new FourthSkills(g, this);
    Object.assign(this.handlers, this.more.handlers(), this.usd.handlers(), this.third.handlers(), this.fourth.handlers());
  }

  /**
   * 持っている攻撃スキルを 1 つ選んで、待ち時間を変えずにすぐ発動する（ひらめきメモ・おまじないのシール）。
   * 出しっぱなしのスキルと、武器や撃破で働くスキルは選ばない。
   */
  castRandom(by: string): SkillInst | null {
    const skip = new Set(['gaman', 'slashwave', 'boomsword', 'grow', 'purinto', 'drone', 'straw']);
    const c = this.actives.filter((s) => !CONTINUOUS.has(s.id) && !skip.has(s.id) && this.handlers[s.id]);
    if (!c.length || this.g.player.dead) return null;
    const s = c[Math.floor(Math.random() * c.length)];
    const keep = s.cd;
    this.run(s, this.handlers[s.id], 0);
    s.cd = keep;
    this.comboLog('trigger', { by, id: s.id });
    return s;
  }

  // ---------------------------------------------------------------- 取得
  get(id: string): SkillInst | undefined {
    return this.actives.find((a) => a.id === id);
  }

  /** 攻撃スキル・強化のどちらかとして持っているか。 */
  has(id: string): boolean {
    return this.actives.some((a) => a.id === id) || this.passives.some((p) => p.id === id);
  }

  /** コンボが起きたことをログに残す（同じコンボは 3 秒に 1 行まで）。 */
  comboLog(id: string, info: Record<string, unknown> = {}): void {
    const now = this.g.time;
    if ((this.comboT.get(id) ?? -99) + 3 > now) return;
    this.comboT.set(id, now);
    log('skill.combo', { id, ...info }, { time: Math.round(now) });
  }

  /** 前の面から引き継いだスキルを持たせる（3 面通しで次の面へ進んだとき）。 */
  restore(actives: CarrySkill[], passives: Owned[]): void {
    for (const a of actives) {
      const def = SKILL_MAP[a.id];
      if (!def || this.get(a.id)) continue;
      const cur: SkillInst = { id: a.id, level: a.level, evolved: a.evolved, brk: a.brk, bk: a.bk ? { ...a.bk } : undefined, cd: 0.6 + Math.random(), st: a.stacks ? { stacks: a.stacks } : {} };
      cur.bm = breakMul(cur.bk);
      cur.ctx = def.dmg ? { ...def.dmg, mul: cur.bm.dmg } : null;
      this.actives.push(cur);
    }
    for (const p of passives) if (SKILL_MAP[p.id] && !this.passives.some((x) => x.id === p.id)) this.passives.push({ ...p });
    this.g.recomputeStats();
  }

  /** 次の面へ引き継ぐ形にする（指名でたまった数など、数だけの記録は残す）。 */
  carry(): CarrySkill[] {
    return this.actives.map((a) => ({ id: a.id, level: a.level, evolved: a.evolved, brk: a.brk, bk: a.bk ? { ...a.bk } : undefined, stacks: typeof a.st.stacks === 'number' ? a.st.stacks : undefined }));
  }

  /** レベルアップなどで選んだ内容を反映する。 */
  apply(c: Choice): void {
    const g = this.g;
    const def = SKILL_MAP[c.id];
    if (!def) return;
    if (def.kind === 'active') {
      let cur = this.get(c.id);
      if (c.kind === 'new' && !cur) {
        cur = { id: c.id, level: 1, cd: 0.4, st: {} };
        this.actives.push(cur);
      } else if (c.kind === 'up' && cur) cur.level = Math.min(def.max, cur.level + 1);
      else if (c.kind === 'evolve' && cur) {
        cur.evolved = true;
        cur.cd = 0.3;
      } else if (c.kind === 'break' && cur) {
        cur.brk = (cur.brk ?? 0) + 1;
        if (c.sub) cur.bk = { ...cur.bk, [c.sub]: (cur.bk?.[c.sub] ?? 0) + 1 };
        cur.cd = Math.min(cur.cd, 0.3);
      }
      if (cur) {
        cur.bm = breakMul(cur.bk);
        cur.ctx = def.dmg ? { ...def.dmg, mul: cur.bm.dmg } : null;
      }
    } else {
      const cur = this.passives.find((p) => p.id === c.id);
      if (!cur) this.passives.push({ id: c.id, level: 1 });
      else if (c.kind === 'break') cur.brk = (cur.brk ?? 0) + 1;
      else cur.level = Math.min(def.max, cur.level + 1);
      if (c.id === 'kyushoku') g.player.heal(20);
    }
    g.recomputeStats();
    log('skill.apply', { kind: c.kind, id: c.id, ...(c.sub ? { sub: c.sub } : {}) }, { actives: this.actives.map((a) => `${a.id}:${a.level}${a.evolved ? '*' : ''}${a.brk ? `+${a.brk}` : ''}`), passives: this.passives.map((p) => `${p.id}:${p.level}${p.brk ? `+${p.brk}` : ''}`) });
  }

  /** 遊んでいる間、スキル欄のアイコンに出す「たまっている数」と、その効果。 */
  stacks(out: StackInfo[]): void {
    const g = this.g;
    for (const s of this.actives) {
      const def = SKILL_MAP[s.id];
      const L = s.level;
      if (s.id === 'grow' && g.player.weaponBonus > 0) {
        const b = Math.round(g.player.weaponBonus);
        out.push({ key: 'a:grow', badge: `+${b}`, text: `${def.emoji} ${def.name}　武器の威力 +${b}（${g.weaponDef.damage} → ${g.weaponDef.damage + b}）` });
      } else if (s.id === 'gaman') {
        const need = 60 + 8 * L;
        const store = Math.min(need, s.st.store ?? 0);
        out.push({ key: 'a:gaman', badge: `${Math.floor((store / need) * 100)}%`, fill: store / need, text: `${def.emoji} ${def.name} ${Math.floor(store)}/${need}　たまると ${Math.round(store * (1.5 + 0.25 * L))} のダメージ` });
      } else if (s.id === 'shimei' && (s.st.stacks ?? 0) > 0) {
        const n = s.st.stacks;
        out.push({ key: 'a:shimei', badge: String(n), fill: n / 100, text: `${def.emoji} ${def.name} ${n}/100　狙い撃ちの威力 +${n * 2}%` });
      } else if (s.id === 'cracker') {
        const ch = this.third.crackerCharge();
        if (ch > 0) out.push({ key: 'a:cracker', badge: String(ch), fill: Math.min(1, ch / 4), text: `${def.emoji} クラッカーの火薬 ${ch}/4　破裂の威力 +${ch * 30}%` });
      }
    }
  }

  // ---------------------------------------------------------------- 補助
  cdOf(base: number): number {
    return Math.max(0.05, base * this.g.stats.cooldown);
  }

  area(r: number): number {
    return r * this.g.stats.area;
  }

  chest(): V3 {
    const p = this.g.player.pos;
    return { x: p.x, y: p.y + 1.0, z: p.z };
  }

  forward(): V3 {
    const y = this.g.player.yaw;
    return { x: Math.sin(y), y: 0, z: Math.cos(y) };
  }

  /** 直接ダメージ（会心・威力・吹き飛ばす力を反映）。 */
  hit(e: Enemy, amount: number, impulse?: V3, quiet = false): boolean {
    const g = this.g;
    const st = g.stats;
    const crit = Math.random() < st.crit;
    const k = st.knockback;
    const imp = impulse && k !== 1 ? { x: impulse.x * k, y: impulse.y * k, z: impulse.z * k } : impulse;
    const ctx = this.cur;
    return g.enemies.damage(e, amount * g.scaleFor(ctx) * (crit ? st.critDmg : 1), 'skill', { impulse: imp, crit, quiet, kind: ctx?.kind });
  }

  /** あとで動く処理を足す。作ったときに動いていたスキルのダメージの種類を覚えておく。 */
  addTask(t: Task): void {
    t.ctx = this.cur;
    this.tasks.push(t);
  }

  /**
   * 範囲攻撃の狙い先。グラビデの渦が出ていれば、その中心（一網打尽）。無ければ敵がいちばん集まっている所。
   */
  aim(range: number): V3 | null {
    const v = this.vortex;
    const p = this.g.player.pos;
    if (v && Math.hypot(v.x - p.x, v.z - p.z) < range) {
      this.comboLog('gather');
      return { x: v.x, y: 0, z: v.z };
    }
    return this.g.enemies.cluster(p, range);
  }

  /** プレイヤーに近い順に n 体。 */
  nearestN(n: number, maxDist: number): Enemy[] {
    const p = this.g.player.pos;
    const c: { e: Enemy; d: number }[] = [];
    for (const e of this.g.enemies.list) {
      if (e.state === 'dead') continue;
      const d = Math.hypot(e.x - p.x, e.z - p.z);
      if (d < maxDist) c.push({ e, d });
    }
    c.sort((a, b) => a.d - b.d);
    return c.slice(0, n).map((x) => x.e);
  }

  private dirTo(from: V3, e: Enemy): V3 {
    const dx = e.x - from.x;
    const dy = e.y - from.y;
    const dz = e.z - from.z;
    const d = Math.hypot(dx, dy, dz) || 1;
    return { x: dx / d, y: dy / d, z: dz / d };
  }

  /** 小道具・がれきの物理ボディ。消えた物や、地面に根を張っている物は null。 */
  private liveBody(o: Owner): RAPIER.RigidBody | null {
    if (o.kind === 'prop') {
      const p = o.ref as Prop;
      return p.alive && !p.rooted ? p.body : null;
    }
    const ch = o.ref as Chunk;
    return ch.state === 'loose' ? ch.body : null;
  }

  sprite(emoji: string, size: number): THREE.Sprite {
    const s = emojiSprite(emoji, size);
    this.g.world.root.add(s);
    return s;
  }

  // ---------------------------------------------------------------- 飛び道具
  private chalk(s: SkillInst): void {
    const g = this.g;
    const L = s.level;
    const E = !!s.evolved;
    const n = E ? 1 + g.stats.amount : 1 + (L >= 2 ? 1 : 0) + (L >= 4 ? 1 : 0) + g.stats.amount;
    const targets = this.nearestN(E ? 4 : n, 24);
    if (!targets.length) {
      s.cd = 0.2;
      return;
    }
    s.cd = this.cdOf(E ? 0.13 : 1.05 - 0.07 * L);
    const from = this.chest();
    for (let i = 0; i < n; i++) {
      const t = E ? targets[Math.floor(Math.random() * targets.length)] : targets[i % targets.length];
      const d = this.dirTo(from, t);
      const sp = 27;
      g.projectiles.fire({ emoji: '🖍️', size: 0.55, pos: from, vel: { x: d.x * sp + (Math.random() - 0.5) * 2, y: d.y * sp, z: d.z * sp + (Math.random() - 0.5) * 2 }, r: 0.25, dmg: E ? 11 : 7 + 3 * L, life: 1.4, pierce: E ? 1 : (L >= 3 ? 1 : 0) + (L >= 5 ? 1 : 0), spin: 14, knock: 2.5, struct: 2 });
    }
    g.audio.shoot();
  }

  private eraser(s: SkillInst): void {
    const g = this.g;
    const L = s.level;
    const E = !!s.evolved;
    const targets = this.nearestN(3, 22);
    if (!targets.length) {
      s.cd = 0.25;
      return;
    }
    s.cd = this.cdOf(E ? 1.2 : 1.7 - 0.1 * L);
    const n = (E ? 3 : 1) + g.stats.amount;
    const from = this.chest();
    for (let i = 0; i < n; i++) {
      const d = this.dirTo(from, targets[i % targets.length]);
      g.projectiles.fire({ emoji: '🧽', size: 0.6, pos: from, vel: { x: d.x * 21, y: d.y * 21, z: d.z * 21 }, r: 0.3, dmg: 9 + 3 * L, life: 2.2, bounce: E ? 20 : 2 + L, spin: 10, knock: 4 });
    }
    g.audio.shoot();
  }

  private uwabaki(s: SkillInst): void {
    const g = this.g;
    const L = s.level;
    const E = !!s.evolved;
    const t = g.enemies.nearest(g.player.pos, 20);
    if (!t && !E) {
      s.cd = 0.3;
      return;
    }
    s.cd = this.cdOf(E ? 1.6 : 2.3 - 0.15 * L);
    const n = E ? 8 : 1 + (L >= 3 ? 1 : 0) + (L >= 5 ? 1 : 0) + g.stats.amount;
    const from = this.chest();
    const base = t ? Math.atan2(t.x - from.x, t.z - from.z) : g.player.yaw;
    for (let i = 0; i < n; i++) {
      const a = E ? (i / n) * Math.PI * 2 : base + (i - (n - 1) / 2) * 0.45;
      g.projectiles.fire({ emoji: '👟', size: 0.8 + 0.1 * L, pos: from, vel: { x: Math.sin(a) * 17, y: 0, z: Math.cos(a) * 17 }, r: 0.45 + 0.05 * L, dmg: 8 + 3 * L, life: 3, boomerang: 0.55, spin: 16, knock: 5, ghost: true });
    }
    g.audio.whoosh();
  }

  private pencil(s: SkillInst): void {
    const g = this.g;
    const L = s.level;
    const E = !!s.evolved;
    if (E) {
      const n = 6 + g.stats.amount * 2;
      let any = false;
      for (let i = 0; i < n; i++) {
        const t = g.enemies.random(g.player.pos, 20);
        if (!t) break;
        any = true;
        g.projectiles.fire({ emoji: '✏️', size: 1.1, pos: { x: t.x + (Math.random() - 0.5) * 2, y: 14 + Math.random() * 5, z: t.z + (Math.random() - 0.5) * 2 }, vel: { x: 0, y: -30, z: 0 }, r: 0.4, dmg: 0, life: 2, grav: -1, explode: { r: this.area(1.6), dmg: 26, force: 7, struct: 8 }, ghost: false });
      }
      s.cd = any ? this.cdOf(0.9) : 0.3;
      if (any) g.audio.shoot();
      return;
    }
    s.cd = this.cdOf(1.7 - 0.12 * L);
    const n = 2 + (L >= 3 ? 1 : 0) + (L >= 5 ? 1 : 0) + g.stats.amount;
    const from = this.chest();
    for (let i = 0; i < n; i++) {
      const a = g.player.yaw + (i - (n - 1) / 2) * 0.12;
      g.projectiles.fire({ emoji: '✏️', size: 0.7, pos: from, vel: { x: Math.sin(a) * 31, y: 0, z: Math.cos(a) * 31 }, r: 0.28, dmg: 10 + 3 * L, life: 1.1, pierce: 99, knock: 3, struct: 3 });
    }
    g.audio.shoot();
  }

  private fire(s: SkillInst): void {
    const g = this.g;
    const L = s.level;
    if (s.evolved) {
      const c = this.aim(26);
      if (!c) {
        s.cd = 0.4;
        return;
      }
      s.cd = this.cdOf(3.4);
      const n = 1 + g.stats.amount;
      for (let i = 0; i < n; i++) {
        const tx = c.x + (i ? (Math.random() - 0.5) * 9 : 0);
        const tz = c.z + (i ? (Math.random() - 0.5) * 9 : 0);
        const r = this.area(6);
        g.fx.ring({ x: tx, y: 0.1, z: tz }, r, r * 0.2, ZONE.ally, 0.9, 0.8);
        g.projectiles.fire({ emoji: '☄️', size: 4, pos: { x: tx - 12, y: 30, z: tz - 6 }, vel: { x: 12 / 0.9, y: -30 / 0.9, z: 6 / 0.9 }, r: 1.2, dmg: 0, life: 2, grav: -0.01, ghost: true, element: 'fire', explode: { r, dmg: 120, force: 24, struct: 170 } });
      }
      g.audio.whoosh();
      return;
    }
    const t = g.enemies.nearest(g.player.pos, 22);
    if (!t) {
      s.cd = 0.3;
      return;
    }
    s.cd = this.cdOf(2.6 - 0.18 * L);
    const from = this.chest();
    const n = 1 + g.stats.amount;
    // グラビデの渦があれば、その中心を狙う（一網打尽）
    const v = this.vortex;
    let aimAt: V3 = { x: t.x, y: t.y, z: t.z };
    if (v && Math.hypot(v.x - from.x, v.z - from.z) < 22) {
      aimAt = { x: v.x, y: 0.8, z: v.z };
      this.comboLog('gather', { by: 'fire' });
    }
    for (let i = 0; i < n; i++) {
      const dx = aimAt.x - from.x;
      const dy = aimAt.y - from.y;
      const dz = aimAt.z - from.z;
      const dl = Math.hypot(dx, dy, dz) || 1;
      const d = { x: dx / dl, y: dy / dl, z: dz / dl };
      const a = (i - (n - 1) / 2) * 0.25;
      const v = rotY({ x: d.x * 15, y: d.y * 15, z: d.z * 15 }, a);
      g.projectiles.fire({ emoji: '🔥', size: 1.0, pos: from, vel: v, r: 0.4, dmg: 0, life: 2.5, element: 'fire', explode: { r: this.area(1.8 + 0.25 * L), dmg: 14 + 6 * L, force: 9, struct: 12 + 3 * L } });
    }
    g.audio.whoosh();
  }

  private randoseru(s: SkillInst): void {
    const g = this.g;
    const L = s.level;
    const E = !!s.evolved;
    if (!g.enemies.nearest(g.player.pos, 28)) {
      s.cd = 0.4;
      return;
    }
    s.cd = this.cdOf(E ? 2.2 : 3.0 - 0.2 * L);
    const n = (E ? 8 : 2 + (L >= 3 ? 1 : 0) + (L >= 5 ? 1 : 0)) + g.stats.amount;
    const from = this.chest();
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      g.projectiles.fire({ emoji: E ? '🚀' : '🎒', size: 0.8, pos: from, vel: { x: Math.sin(a) * 6, y: 9, z: Math.cos(a) * 6 }, r: 0.35, dmg: 0, life: 4, homing: 5, target: g.enemies.random(g.player.pos, 26), explode: { r: this.area(1.5), dmg: 12 + 5 * L, force: 7, struct: 10 }, element: 'fire' });
    }
    g.audio.whoosh();
  }

  private milk(s: SkillInst): void {
    const g = this.g;
    const L = s.level;
    const E = !!s.evolved;
    const c = g.enemies.cluster(g.player.pos, 18);
    if (!c) {
      s.cd = 0.4;
      return;
    }
    s.cd = this.cdOf(E ? 3.6 : 3.2 - 0.2 * L);
    const n = (E ? 5 : 1 + (L >= 3 ? 1 : 0)) + g.stats.amount;
    const from = this.chest();
    const T = 0.85;
    const grav = -20;
    for (let i = 0; i < n; i++) {
      const tx = c.x + (i ? (Math.random() - 0.5) * 7 : 0);
      const tz = c.z + (i ? (Math.random() - 0.5) * 7 : 0);
      const r = this.area(2.3 + 0.2 * L);
      g.projectiles.fire({
        emoji: E ? '🍛' : '🥛', size: 0.8, pos: from, vel: { x: (tx - from.x) / T, y: (0.2 - from.y - 0.5 * grav * T * T) / T, z: (tz - from.z) / T }, r: 0.3, dmg: 0, life: 3, grav, spin: 8, ghost: true,
        explode: { r, dmg: 16 + 6 * L, force: 8, struct: 8 }, element: E ? 'fire' : 'water',
        onEnd: (pos) => this.puddle(pos, r * 1.1, E, 3.5 + L * 0.3),
      });
    }
    g.audio.shoot();
  }

  /** 牛乳の水たまり（滑る・ぬれる。ブリザドを持っていると凍る）／カレーの跡（燃える）。 */
  private puddle(pos: V3, r: number, burn: boolean, life: number): void {
    const g = this.g;
    const icy = !burn && this.has('blizzard');
    const mesh = new THREE.Mesh(new THREE.CircleGeometry(r, 20), new THREE.MeshBasicMaterial({ color: burn ? 0xc97a1a : icy ? 0xbfefff : 0xffffff, transparent: true, opacity: 0.6, depthWrite: false }));
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(pos.x, g.world.groundY(pos.x, pos.z) + 0.05, pos.z);
    mesh.renderOrder = 2;
    g.world.root.add(mesh);
    const rec = { x: pos.x, z: pos.z, r, burn };
    this.puddles.push(rec);
    let t = 0;
    let tick = 0;
    this.addTask({
      update: (dt) => {
        t += dt;
        tick -= dt;
        (mesh.material as THREE.MeshBasicMaterial).opacity = 0.6 * Math.min(1, (life - t) / 0.6);
        if (tick <= 0) {
          tick = 0.35;
          let frozen = 0;
          g.enemies.inRadius(pos, r, (e) => {
            if (e.def.boss) return;
            if (burn) {
              e.burn = Math.max(e.burn, 1.2);
              e.burnDps = Math.max(e.burnDps, 9 * g.stats.power);
              return;
            }
            g.enemies.wetIt(e, 4);
            // 滑って転ぶ。アイスバーン（ブリザドを持っている）なら凍って、もっと滑る
            const a = Math.random() * Math.PI * 2;
            if (icy) {
              g.enemies.freeze(e, 1.0);
              frozen++;
              g.enemies.push(e, { x: Math.cos(a) * 4.5, y: 0.3, z: Math.sin(a) * 4.5 });
            } else g.enemies.push(e, { x: Math.cos(a) * 3.2, y: 0.6, z: Math.sin(a) * 3.2 });
          });
          if (frozen > 0) this.comboLog('icebahn', { n: frozen });
        }
        return t < life;
      },
      dispose: () => {
        const i = this.puddles.indexOf(rec);
        if (i >= 0) this.puddles.splice(i, 1);
        mesh.removeFromParent();
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
      },
    });
  }

  // ---------------------------------------------------------------- 落ちてくる・その場で起きる
  private thunder(s: SkillInst): void {
    const g = this.g;
    const L = s.level;
    const E = !!s.evolved;
    const n = (E ? 2 : 1 + Math.floor((L + 1) / 2)) + g.stats.amount;
    let any = false;
    for (let i = 0; i < n; i++) {
      const t = g.enemies.random(g.player.pos, 18);
      if (!t) break;
      any = true;
      const dmg = 16 + 5 * L;
      g.fx.bolt({ x: t.x + (Math.random() - 0.5) * 3, y: 22, z: t.z + (Math.random() - 0.5) * 3 }, { x: t.x, y: t.y, z: t.z }, 0xfff7a0, 0.5, 1.1);
      g.fx.element({ x: t.x, y: t.y, z: t.z }, 'elec', 1.3);
      g.fx.ring({ x: t.x, y: 0.1, z: t.z }, 0.3, 2, ZONE.ally, 0.2);
      const wasWet = t.wet > 0;
      this.hit(t, dmg, { x: 0, y: 3, z: 0 });
      if (wasWet) this.shock(t, dmg);
      let from = t;
      const seen = new Set<Enemy>([t]);
      const chains = 1 + Math.floor(L / 2) + (E ? 2 : 0);
      for (let c = 0; c < chains; c++) {
        const nx = g.enemies.nearest(from, 5.5, (o) => seen.has(o));
        if (!nx) break;
        seen.add(nx);
        g.fx.bolt({ x: from.x, y: from.y, z: from.z }, { x: nx.x, y: nx.y, z: nx.z }, 0xfff7a0, 0.28, 0.4, 0.12);
        this.hit(nx, dmg * 0.6, { x: 0, y: 2, z: 0 });
        from = nx;
      }
    }
    if (any) {
      g.audio.thunder();
      g.fx.shake('S');
      s.cd = this.cdOf(E ? 0.5 : 2.3 - 0.15 * L);
    } else s.cd = 0.3;
  }

  /** 感電: ぬれた敵に落ちた雷が、近くのぬれた敵すべてへ伝わる。 */
  private shock(from: Enemy, dmg: number): void {
    const g = this.g;
    let n = 0;
    for (const e of g.enemies.list) {
      if (e === from || e.state === 'dead' || e.wet <= 0) continue;
      if (Math.hypot(e.x - from.x, e.z - from.z) > 8) continue;
      g.fx.bolt({ x: from.x, y: from.y, z: from.z }, { x: e.x, y: e.y, z: e.z }, 0x9fe0ff, 0.22, 0.5, 0.12);
      this.hit(e, dmg * 0.8, { x: 0, y: 2, z: 0 });
      if (++n >= 14) break;
    }
    if (n > 0) this.comboLog('shock', { n });
  }

  private blizzard(s: SkillInst): void {
    const g = this.g;
    const L = s.level;
    const E = !!s.evolved;
    const p = g.player.pos;
    const r = this.area(E ? 8 : 3.5 + 0.5 * L);
    let n = 0;
    g.enemies.inRadius(p, r, () => n++);
    if (!n) {
      s.cd = 0.4;
      return;
    }
    s.cd = this.cdOf(E ? 5 : 6 - 0.4 * L);
    g.fx.ring({ x: p.x, y: 0.1, z: p.z }, 0.5, r, ZONE.ally, 0.4);
    g.fx.flash('ice');
    g.audio.freeze();
    for (let i = 0; i < 10; i++) {
      const a = Math.random() * Math.PI * 2;
      g.fx.element({ x: p.x + Math.cos(a) * r * Math.random(), y: 0.6, z: p.z + Math.sin(a) * r * Math.random() }, 'ice', 1.2);
    }
    let wet = 0;
    g.enemies.inRadius(p, r, (e) => {
      if (E && !e.def.boss && e.hp < e.maxHp * 0.3) {
        g.fx.shards({ x: e.x, y: e.y, z: e.z }, 0xbfefff, 6, 6, 0.3);
        g.enemies.damage(e, e.hp + 1, 'skill', { quiet: true, kind: 'true' });
        return;
      }
      if (e.wet > 0) wet++;
      this.hit(e, 6 + 2 * L);
      g.enemies.freeze(e, 1.6 + 0.3 * L + (E ? 1.5 : 0));
    });
    if (wet > 0) this.comboLog('flashfreeze', { n: wet });
  }

  private stomp(s: SkillInst): void {
    const g = this.g;
    const L = s.level;
    const E = !!s.evolved;
    const p = g.player.pos;
    const r = this.area(E ? 12 : 3.2 + 0.4 * L);
    let n = 0;
    g.enemies.inRadius(p, r, () => n++);
    if (!n || !g.player.grounded) {
      s.cd = 0.3;
      return;
    }
    s.cd = this.cdOf(E ? 4 : 3.2 - 0.2 * L);
    g.fx.ring({ x: p.x, y: 0.1, z: p.z }, 0.6, r, ZONE.ally, 0.35);
    g.fx.dust({ x: p.x, y: 0.1, z: p.z }, 1.6, 0xe6dcc8, 6);
    g.fx.shake(E ? 'L' : 'M');
    g.audio.thud(1);
    if (E) g.audio.crumble(1.2);
    const up = E ? 12 : 6 + L;
    g.enemies.inRadius(p, r, (e, d) => {
      const k = 1 - (d / r) * 0.5;
      const inv = 1 / Math.max(0.3, d);
      this.hit(e, (E ? 40 : 8 + 4 * L) * k, { x: (e.x - p.x) * inv * 3, y: up * k, z: (e.z - p.z) * inv * 3 });
    });
    g.world.blast({ x: p.x, y: 0.5, z: p.z }, r, E ? 50 : 0, E ? 9 : 6, 4);
    let jumped = 0;
    for (const t of this.tramps) {
      if (Math.hypot(t.x - p.x, t.z - p.z) > r + t.r) continue;
      g.enemies.inRadius({ x: t.x, y: 0, z: t.z }, t.r + 0.5, (e) => {
        if (e.def.boss) return;
        g.enemies.push(e, { x: 0, y: 26, z: 0 });
        jumped++;
      });
      t.squash = 1;
    }
    if (jumped) this.comboLog('jumpfest', { n: jumped });
  }

  private nuke(s: SkillInst): void {
    const g = this.g;
    const L = s.level;
    const c = this.aim(30);
    if (!c) {
      s.cd = 1;
      return;
    }
    s.cd = this.cdOf(46 - 4 * L);
    const r = this.area(9 + L);
    const pos = { x: c.x, y: 1, z: c.z };
    const flask = this.sprite('⚗️', 2.2);
    flask.position.set(pos.x, 20, pos.z);
    let t = 0;
    g.hud.toast('理科室の禁薬、投下！', 'warn');
    this.addTask({
      update: (dt) => {
        t += dt;
        flask.position.y = 20 - (t / 1.4) * 19;
        if (Math.floor(t * 8) !== Math.floor((t - dt) * 8)) g.fx.ring(pos, r, r * 0.9, ZONE.ally, 0.14, 0.9);
        if (t >= 1.4) {
          g.explode(pos, r, 160 + 40 * L, { force: 30, struct: 230, source: 'skill' });
          g.fx.flash('boom');
          return false;
        }
        return true;
      },
      dispose: () => flask.removeFromParent(),
    });
  }

  private timestop(s: SkillInst): void {
    const g = this.g;
    const L = s.level;
    const E = !!s.evolved;
    if (g.enemies.living < 4) {
      s.cd = 1;
      return;
    }
    s.cd = this.cdOf(E ? 20 : 22 - 1.5 * L);
    g.enemies.timeStop = E ? 4.5 : 1.8 + 0.4 * L;
    g.enemies.timeStopBonus = E ? 2 : 1;
    g.fx.flash('dark');
    g.audio.freeze();
    g.hud.toast(E ? '永遠の5時間目…' : 'ザ・授業中！', 'info');
  }

  private statue(s: SkillInst): void {
    const g = this.g;
    const L = s.level;
    const E = !!s.evolved;
    const c = this.aim(22);
    if (!c) {
      s.cd = 0.5;
      return;
    }
    s.cd = this.cdOf(E ? 9 : 8 - 0.5 * L);
    const n = E ? 1 : 1 + (L >= 4 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      const px = c.x + (i ? (Math.random() - 0.5) * 8 : 0);
      const pz = c.z + (i ? (Math.random() - 0.5) * 8 : 0);
      const pos = { x: px, y: g.world.groundY(px, pz) + 18 + i * 3, z: pz };
      const r = this.area(E ? 9 : 3 + 0.3 * L);
      g.fx.ring({ x: pos.x, y: 0.1, z: pos.z }, r, r * 0.3, ZONE.ally, 0.7, 0.8);
      const prop = g.world.spawnProp(E ? 'bigstatue' : 'statue', pos, Math.random() * 6, { vel: { x: 0, y: -24, z: 0 }, life: E ? 7 : 10, scale: E ? 2.8 : 1, hot: 8, dmgMul: 3 + L });
      if (!prop) continue;
      this.watchLanding(prop, () => {
        const t = prop.body.translation();
        const at = { x: t.x, y: 0.5, z: t.z };
        g.fx.dust(at, r * 0.5, 0xe6dcc8, 8);
        g.explode(at, r, E ? 200 : 20 + 8 * L, { force: E ? 26 : 12, struct: E ? 260 : 20, source: 'skill', quietFx: !E });
        g.fx.ring(at, 0.5, r, ZONE.ally, 0.35);
        g.fx.shake(E ? 'L' : 'M');
        g.audio.thud(1);
      });
    }
    g.audio.whoosh();
  }

  private watchLanding(p: Prop, cb: () => void): void {
    let age = 0;
    this.addTask({
      update: (dt) => {
        if (!p.alive) return false;
        age += dt;
        const t = p.body.translation();
        const v = p.body.linvel();
        if (t.y - p.half.y - this.g.world.groundY(t.x, t.z) < 0.4 || (age > 0.3 && Math.abs(v.y) < 3)) {
          cb();
          return false;
        }
        return age < 5;
      },
    });
  }

  private ball(s: SkillInst): void {
    const g = this.g;
    const L = s.level;
    const E = !!s.evolved;
    const t = g.enemies.nearest(g.player.pos, 24);
    if (!t) {
      s.cd = 0.4;
      return;
    }
    s.cd = this.cdOf(E ? 5 : 4 - 0.25 * L);
    const n = (E ? 18 : 2 + Math.floor(L / 2)) + g.stats.amount;
    const from = this.chest();
    const base = Math.atan2(t.x - from.x, t.z - from.z);
    const sp = 22 + 2 * L;
    for (let i = 0; i < n; i++) {
      const a = E ? (i / n) * Math.PI * 2 : base + (i - (n - 1) / 2) * 0.3;
      g.world.spawnProp('ball', { x: from.x + Math.sin(a) * 0.8, y: from.y - 0.2, z: from.z + Math.cos(a) * 0.8 }, 0, { vel: { x: Math.sin(a) * sp, y: 3 + Math.random() * 3, z: Math.cos(a) * sp }, life: E ? 6 : 5, scale: E ? 0.7 : 1.7, hot: 6, dmgMul: E ? 3 : 2.5 + 0.6 * L, spin: true });
    }
    g.audio.shoot();
  }

  private gravity(s: SkillInst): void {
    const g = this.g;
    const L = s.level;
    const E = !!s.evolved;
    const c = g.enemies.cluster(g.player.pos, 18);
    if (!c) {
      s.cd = 0.5;
      return;
    }
    s.cd = this.cdOf(E ? 7 : 7.5 - 0.4 * L);
    const r = this.area(E ? 8 : 4 + 0.5 * L);
    const life = E ? 3.2 : 2.2;
    const pos = { x: c.x, y: 1.4, z: c.z };
    const sp = this.sprite(E ? '🕳️' : '🌀', 2.5);
    sp.position.set(pos.x, pos.y, pos.z);
    let t = 0;
    let tick = 0;
    g.audio.whoosh();
    this.vortex = pos;
    this.addTask({
      dispose: () => {
        sp.removeFromParent();
        if (this.vortex === pos) this.vortex = null;
      },
      update: (dt) => {
        t += dt;
        tick -= dt;
        sp.material.rotation += dt * 6;
        sp.scale.setScalar(2.5 + Math.sin(t * 10) * 0.3 + (E ? 2 : 0));
        if (tick <= 0) {
          tick = 0.08;
          g.fx.element({ x: pos.x + (Math.random() - 0.5) * r, y: pos.y + Math.random(), z: pos.z + (Math.random() - 0.5) * r }, 'dark', 0.8);
          g.enemies.inRadius(pos, r, (e, d) => {
            if (e.def.boss) return;
            const inv = 1 / Math.max(0.5, d);
            const f = (E ? 4.2 : 2.6) + L * 0.25;
            g.enemies.push(e, { x: (pos.x - e.x) * inv * f, y: 0.9, z: (pos.z - e.z) * inv * f });
          });
          g.physics.querySphere(pos, r, 4 | 32, (o) => {
            const b = this.liveBody(o);
            if (!b) return;
            const bt = b.translation();
            const d = Math.hypot(pos.x - bt.x, pos.z - bt.z) || 1;
            const m = Math.min(300, b.mass()) * 1.6;
            b.applyImpulse({ x: ((pos.x - bt.x) / d) * m, y: m * 0.5, z: ((pos.z - bt.z) / d) * m }, true);
          });
          if (E) g.world.blast(pos, r * 0.7, 14, -5, 0);
        }
        if (t >= life) {
          g.explode(pos, r * 0.8, E ? 90 : 22 + 8 * L, { force: 16, struct: E ? 120 : 10, source: 'skill', element: 'dark' });
          return false;
        }
        return true;
      },
    });
  }

  private tornado(s: SkillInst): void {
    const g = this.g;
    const L = s.level;
    const E = !!s.evolved;
    const c = g.enemies.cluster(g.player.pos, 20);
    if (!c) {
      s.cd = 0.5;
      return;
    }
    s.cd = this.cdOf(E ? 8 : 8.5 - 0.5 * L);
    const r = this.area(E ? 5 : 2.2 + 0.2 * L);
    const life = E ? 7 : 4 + 0.5 * L;
    const f = this.forward();
    const pos = { x: g.player.pos.x + f.x * 3, y: 0, z: g.player.pos.z + f.z * 3 };
    const sp = this.sprite('🌪️', r * 2.4);
    let t = 0;
    let tick = 0;
    let ang = Math.atan2(c.x - pos.x, c.z - pos.z);
    g.audio.whoosh();
    this.addTask({
      update: (dt) => {
        t += dt;
        tick -= dt;
        const near = g.enemies.nearest(pos, 18);
        if (near) {
          let d = Math.atan2(near.x - pos.x, near.z - pos.z) - ang;
          while (d > Math.PI) d -= Math.PI * 2;
          while (d < -Math.PI) d += Math.PI * 2;
          ang += d * Math.min(1, dt * 1.5);
        }
        pos.x += Math.sin(ang) * 4.5 * dt;
        pos.z += Math.cos(ang) * 4.5 * dt;
        sp.position.set(pos.x + Math.sin(t * 9) * 0.3, r * 1.1, pos.z + Math.cos(t * 9) * 0.3);
        if (tick <= 0) {
          tick = 0.12;
          g.fx.dust({ x: pos.x, y: 0.2, z: pos.z }, r * 0.6, 0xcfd6dc, 2);
          g.enemies.inRadius(pos, r, (e, d) => {
            if (e.def.boss) {
              this.hit(e, (5 + 2 * L) * 0.4, undefined, true);
              return;
            }
            const inv = 1 / Math.max(0.4, d);
            // 渦に巻いて持ち上げる
            const tx = -(e.z - pos.z) * inv;
            const tz = (e.x - pos.x) * inv;
            const hot = !e.cd || (e.cd.get('tornado') ?? 0) <= 0;
            if (hot) {
              (e.cd ??= new Map()).set('tornado', 0.35);
              this.hit(e, 5 + 2 * L, { x: tx * 4 + (pos.x - e.x) * inv * 2, y: 5.5, z: tz * 4 + (pos.z - e.z) * inv * 2 });
            } else g.enemies.push(e, { x: tx * 1.5, y: 1.2, z: tz * 1.5 });
          });
          g.physics.querySphere({ x: pos.x, y: 1.5, z: pos.z }, r, 4 | 32, (o) => {
            const b = this.liveBody(o);
            if (!b) return;
            const bt = b.translation();
            const d = Math.hypot(pos.x - bt.x, pos.z - bt.z) || 1;
            const m = Math.min(260, b.mass()) * 1.3;
            b.applyImpulse({ x: (-(bt.z - pos.z) / d) * m, y: m * 1.5, z: ((bt.x - pos.x) / d) * m }, true);
          });
          if (E) g.world.blast({ x: pos.x, y: 3, z: pos.z }, r, 16, 7, 6);
        }
        return t < life;
      },
      dispose: () => sp.removeFromParent(),
    });
  }

  private wave(s: SkillInst): void {
    const g = this.g;
    const L = s.level;
    const E = !!s.evolved;
    if (!g.enemies.nearest(g.player.pos, 16)) {
      s.cd = 0.5;
      return;
    }
    s.cd = this.cdOf(E ? 6 : 6.5 - 0.4 * L);
    const width = this.area(E ? 2.4 : 0.8 + 0.15 * L);
    const length = E ? 26 : 14 + 2 * L;
    const dps = E ? 200 : 45 + 15 * L;
    const life = E ? 1.6 : 1.0;
    const geo = new THREE.CylinderGeometry(1, 1, 1, 14, 1, true);
    geo.rotateX(Math.PI / 2);
    geo.translate(0, 0, 0.5);
    const mat = new THREE.MeshBasicMaterial({ color: 0x9ff4ff, transparent: true, opacity: 0.75, depthWrite: false, side: THREE.DoubleSide, fog: false });
    const core = new THREE.Mesh(geo, mat);
    const inner = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false }));
    inner.scale.set(0.45, 0.45, 1);
    core.add(inner);
    g.world.root.add(core);
    let t = 0;
    let tick = 0;
    g.player.emote('smug', life + 0.3);
    g.audio.whoosh();
    g.hud.toast(E ? '極太ノリコ砲ーーッ！' : 'ノリコ波ーーッ！', 'info');
    this.addTask({
      update: (dt) => {
        t += dt;
        tick -= dt;
        const p = this.chest();
        const f = this.forward();
        const k = Math.min(1, t / 0.12) * Math.min(1, (life - t) / 0.15);
        core.position.set(p.x + f.x * 0.6, p.y, p.z + f.z * 0.6);
        core.rotation.y = g.player.yaw;
        core.scale.set(width * k * (1 + Math.sin(t * 60) * 0.08), width * k, length);
        if (tick <= 0) {
          tick = 0.1;
          for (const e of g.enemies.list) {
            if (e.state === 'dead') continue;
            const ex = e.x - p.x;
            const ez = e.z - p.z;
            const al = ex * f.x + ez * f.z;
            if (al < 0 || al > length) continue;
            const off = Math.abs(ex * f.z - ez * f.x);
            if (off > width + e.radius) continue;
            this.hit(e, dps * 0.1, { x: f.x * 3.2, y: 0.5, z: f.z * 3.2 });
          }
          for (let d = 2; d < length; d += 3) {
            const at = { x: p.x + f.x * d, y: p.y, z: p.z + f.z * d };
            g.world.blast(at, width + 0.6, E ? 30 : 3, 5, 3);
          }
          g.fx.element({ x: p.x + f.x * (2 + Math.random() * length * 0.7), y: p.y, z: p.z + f.z * (2 + Math.random() * length * 0.7) }, 'elec', 1);
          g.fx.shake('S');
        }
        return t < life;
      },
      dispose: () => {
        core.removeFromParent();
        geo.dispose();
        mat.dispose();
      },
    });
  }

  private laser(s: SkillInst): void {
    const g = this.g;
    const L = s.level;
    const E = !!s.evolved;
    const n = E ? 3 : 1;
    let any = false;
    for (let i = 0; i < n; i++) {
      const t0 = g.enemies.random(g.player.pos, 24);
      if (!t0) break;
      any = true;
      const r = this.area(1.2 + 0.15 * L);
      const life = 2 + 0.2 * L;
      const dps = 50 + 15 * L;
      const pos = { x: t0.x, y: 0, z: t0.z };
      const geo = new THREE.CylinderGeometry(1, 1, 60, 10, 1, true);
      geo.translate(0, 30, 0);
      const mat = new THREE.MeshBasicMaterial({ color: 0x5ab4ff, transparent: true, opacity: 0.7, depthWrite: false, fog: false });
      const beam = new THREE.Mesh(geo, mat);
      const inner = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false }));
      inner.scale.set(0.4, 1, 0.4);
      beam.add(inner);
      g.world.root.add(beam);
      let t = 0;
      let tick = 0;
      this.addTask({
        update: (dt) => {
          t += dt;
          tick -= dt;
          const near = g.enemies.nearest(pos, 30);
          if (near) {
            const d = Math.hypot(near.x - pos.x, near.z - pos.z) || 1;
            pos.x += ((near.x - pos.x) / d) * Math.min(d, 7 * dt);
            pos.z += ((near.z - pos.z) / d) * Math.min(d, 7 * dt);
          }
          const k = Math.min(1, t / 0.15) * Math.min(1, (life - t) / 0.2);
          beam.position.set(pos.x, 0, pos.z);
          beam.scale.set(r * k * (1 + Math.sin(t * 50) * 0.1), 1, r * k);
          if (tick <= 0) {
            tick = 0.12;
            g.enemies.inRadius(pos, r, (e) => this.hit(e, dps * 0.12, { x: 0, y: 1.5, z: 0 }));
            g.world.blast({ x: pos.x, y: 1, z: pos.z }, r + 0.5, 12 + 3 * L, 4, 8);
            g.fx.element({ x: pos.x, y: 0.4, z: pos.z }, 'fire', 1.2);
            g.fx.ring({ x: pos.x, y: 0.1, z: pos.z }, r * 0.4, r * 1.6, ZONE.ally, 0.2);
          }
          return t < life;
        },
        dispose: () => {
          beam.removeFromParent();
          geo.dispose();
          mat.dispose();
        },
      });
    }
    if (any) {
      g.audio.thunder();
      s.cd = this.cdOf(E ? 8 : 9 - 0.6 * L);
    } else s.cd = 0.5;
  }

  private ufo(s: SkillInst): void {
    const g = this.g;
    const L = s.level;
    const E = !!s.evolved;
    const n = E ? 8 : 1 + Math.floor(L / 2);
    const victims: Enemy[] = [];
    for (let i = 0; i < n * 3 && victims.length < n; i++) {
      const e = g.enemies.random(g.player.pos, 20);
      if (e && !e.def.boss && e.state === 'walk' && !victims.includes(e)) victims.push(e);
    }
    if (!victims.length) {
      s.cd = 0.6;
      return;
    }
    s.cd = this.cdOf(E ? 6 : 5 - 0.4 * L);
    const cx = victims.reduce((a, e) => a + e.x, 0) / victims.length;
    const cz = victims.reduce((a, e) => a + e.z, 0) / victims.length;
    const sp = this.sprite(E ? '👽' : '🛸', E ? 5 : 3);
    sp.position.set(cx, 14, cz);
    for (const e of victims) {
      e.state = 'held';
      e.body.setGravityScale(0, true);
    }
    let t = 0;
    g.audio.whoosh();
    this.addTask({
      update: (dt) => {
        t += dt;
        sp.position.y = 14 + Math.sin(t * 5) * 0.3;
        sp.material.rotation = Math.sin(t * 3) * 0.15;
        if (t < 1.1) {
          for (const e of victims) {
            if (e.state !== 'held') continue;
            const y = e.y + 11 * dt;
            e.body.setTranslation({ x: e.x + (cx - e.x) * dt * 1.5, y, z: e.z + (cz - e.z) * dt * 1.5 }, true);
            e.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
            if (Math.random() < dt * 10) g.fx.bolt({ x: cx, y: 13.5, z: cz }, { x: e.x, y: e.y, z: e.z }, 0x9fffb0, 0.3, 0.1, 0.08);
          }
          return true;
        }
        for (const e of victims) {
          if (e.state !== 'held') continue;
          e.body.setGravityScale(1, true);
          e.state = 'walk';
          const a = Math.random() * Math.PI * 2;
          g.enemies.push(e, { x: Math.cos(a) * 7, y: -8, z: Math.sin(a) * 7 }, true);
        }
        return false;
      },
      dispose: () => {
        sp.removeFromParent();
        for (const e of victims) {
          if (e.state === 'held' && e.alive) {
            e.body.setGravityScale(1, true);
            e.state = 'walk';
          }
        }
      },
    });
  }

  // ---------------------------------------------------------------- まとわりつく
  /** 机バリア／コンパスカッター: プレイヤーのまわりを回る。 */
  private orbit(s: SkillInst, dt: number, kind: 'desk' | 'compass'): void {
    const g = this.g;
    const L = s.level;
    const E = !!s.evolved;
    const sig = `${L}${E}${g.stats.amount}`;
    const st = s.st as { sig?: string; objs?: THREE.Object3D[]; ang?: number };
    const desk = kind === 'desk';
    const n = desk ? (E ? 6 : 1 + (L >= 2 ? 1 : 0) + (L >= 4 ? 1 : 0)) : (E ? 3 : 2 + (L >= 3 ? 1 : 0) + (L >= 5 ? 1 : 0)) + g.stats.amount;
    if (st.sig !== sig) {
      st.objs?.forEach((o) => o.removeFromParent());
      st.objs = [];
      for (let i = 0; i < n; i++) {
        let o: THREE.Object3D;
        if (desk) {
          const mm = g.assets.merged.get('p_desk');
          const geo = mm ? mm.geo : new THREE.BoxGeometry(0.7, 0.72, 0.45);
          o = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: !!mm, color: mm ? 0xffffff : 0xc9a26b }));
          (o as THREE.Mesh).castShadow = true;
        } else o = emojiSprite(E ? '🥏' : '📐', E ? 1.8 : 0.9);
        g.world.root.add(o);
        st.objs.push(o);
      }
      st.sig = sig;
      st.ang = st.ang ?? 0;
    }
    const speed = desk ? (E ? 5.2 : 2.6) : E ? 3.6 : 6;
    st.ang = (st.ang ?? 0) + speed * dt;
    const p = g.player.pos;
    const radius = this.area(desk ? (E ? 3.6 : 2.3) : E ? 3 + Math.sin(g.time * 1.6) * 1.5 : 1.35);
    const hitR = desk ? 0.75 : E ? 0.95 : 0.5;
    const dmg = desk ? 10 + 4 * L : E ? 12 : 4 + 1.5 * L;
    const key = kind;
    for (let i = 0; i < n; i++) {
      const a = st.ang! + (i / n) * Math.PI * 2;
      const x = p.x + Math.sin(a) * radius;
      const z = p.z + Math.cos(a) * radius;
      const y = p.y + (desk ? 0.5 : 0.7);
      const o = st.objs![i];
      o.position.set(x, y, z);
      if (desk) o.rotation.set(0, a * 2, Math.sin(a * 3) * 0.3);
      else (o as THREE.Sprite).material.rotation = -st.ang! * 3;
      for (const e of g.enemies.list) {
        if (e.state === 'dead') continue;
        const dx = e.x - x;
        const dz = e.z - z;
        const rr = hitR + e.radius;
        if (dx * dx + dz * dz > rr * rr || Math.abs(e.y - y) > e.halfH + e.radius + 0.6) continue;
        if (e.cd && (e.cd.get(key) ?? 0) > 0) continue;
        (e.cd ??= new Map()).set(key, desk ? 0.45 : 0.3);
        // 回っている向き（接線方向）へ弾く
        const tx = Math.cos(a);
        const tz = -Math.sin(a);
        const k = desk ? (E ? 13 : 8) : 3;
        this.hit(e, dmg, { x: tx * k + (dx / rr) * 2, y: desk ? (E ? 7 : 2.5) : 1, z: tz * k + (dz / rr) * 2 });
        g.fx.hitMark({ x: e.x, y: e.y, z: e.z }, desk ? 0.4 : 0.15);
        g.audio.hit(desk ? 0.5 : 0.2);
      }
    }
  }

  /** 野良ネコ軍団: 近くの敵へ走っていって引っかく。 */
  private cat(s: SkillInst, dt: number): void {
    const g = this.g;
    const L = s.level;
    const E = !!s.evolved;
    const n = E ? 1 + g.stats.amount : 1 + Math.ceil(L / 2) + g.stats.amount;
    const sig = `${n}${E}`;
    const st = s.st as { sig?: string; cats?: { sp: THREE.Sprite; x: number; z: number; cd: number; target: Enemy | null; hop: number }[] };
    if (st.sig !== sig) {
      st.cats?.forEach((c) => c.sp.removeFromParent());
      st.cats = [];
      for (let i = 0; i < n; i++) st.cats.push({ sp: this.sprite(E ? '🐅' : '🐈', E ? 3 : 1.1), x: g.player.pos.x + i, z: g.player.pos.z - 1, cd: 0, target: null, hop: Math.random() * 6 });
      st.sig = sig;
      g.audio.cat();
    }
    const p = g.player.pos;
    for (const c of st.cats!) {
      c.cd -= dt;
      c.hop += dt * 14;
      if (!c.target || c.target.state === 'dead' || !c.target.alive || Math.hypot(c.target.x - p.x, c.target.z - p.z) > 18) {
        c.target = g.enemies.nearest({ x: p.x + (Math.random() - 0.5) * 8, y: 0, z: p.z + (Math.random() - 0.5) * 8 }, 16);
      }
      const tx = c.target ? c.target.x : p.x + Math.sin(c.hop * 0.05) * 2;
      const tz = c.target ? c.target.z : p.z + Math.cos(c.hop * 0.05) * 2;
      const dx = tx - c.x;
      const dz = tz - c.z;
      const d = Math.hypot(dx, dz) || 1;
      const reach = (c.target ? c.target.radius : 0) + (E ? 1.6 : 0.7);
      if (d > reach) {
        const sp = (E ? 13 : 10.5) * dt;
        c.x += (dx / d) * Math.min(sp, d);
        c.z += (dz / d) * Math.min(sp, d);
      } else if (c.target && c.cd <= 0) {
        c.cd = E ? 0.7 : 0.5;
        this.hit(c.target, E ? 34 : 5 + 2 * L, { x: (dx / d) * (E ? 13 : 2.5), y: E ? 5 : 1, z: (dz / d) * (E ? 13 : 2.5) });
        g.fx.hitMark({ x: c.target.x, y: c.target.y, z: c.target.z }, E ? 0.7 : 0.2);
        g.audio.hit(E ? 0.7 : 0.2);
        if (Math.random() < 0.15) g.audio.cat();
      }
      const size = E ? 3 : 1.1;
      c.sp.position.set(c.x, size * 0.45 + Math.abs(Math.sin(c.hop)) * 0.25, c.z);
    }
  }

  /** 妄想分身: 本体と同じモーションで攻撃する。 */
  private clone(s: SkillInst, dt: number): void {
    const g = this.g;
    const L = s.level;
    const E = !!s.evolved;
    const n = E ? 6 : 1 + (L >= 3 ? 1 : 0) + (L >= 5 ? 1 : 0);
    const sig = `${n}${g.stats.weaponLength}`;
    const st = s.st as { sig?: string; clones?: { rig: NorikoRig; ctx: SwingCtx; prev: WeaponPose | null; swing: number }[] };
    const pl = g.player;
    if (st.sig !== sig) {
      st.clones?.forEach((c) => {
        if (c.ctx.trail) g.fx.removeTrail(c.ctx.trail);
        c.rig.dispose();
      });
      st.clones = [];
      for (let i = 0; i < n; i++) {
        const rig = new NorikoRig(g.assets, g.world.root, true);
        rig.setWeapon(pl.weapon, g.stats.weaponLength);
        st.clones.push({ rig, ctx: { id: 0, dmgMul: 1, hitBodies: new Set(), trail: g.fx.makeTrail(0x7fd4ff), clone: true }, prev: null, swing: -1 });
      }
      st.sig = sig;
    }
    const mul = E ? 0.5 : 0.3 + 0.06 * L;
    const cl = st.clones!;
    for (let i = 0; i < cl.length; i++) {
      const c = cl[i];
      // 配置: 少数なら左右、進化後はまわりを囲む
      const a = E ? (i / cl.length) * Math.PI * 2 + g.time * 0.4 : (i % 2 === 0 ? 1 : -1) * (Math.PI / 2) * (1 + Math.floor(i / 2) * 0.35);
      const dist = E ? 2.6 : 1.7 + Math.floor(i / 2) * 0.9;
      const o = rotY({ x: Math.sin(a) * dist, y: 0, z: Math.cos(a) * dist }, pl.yaw);
      const pos = { x: pl.pos.x + o.x, y: pl.pos.y, z: pl.pos.z + o.z };
      const yaw = E ? pl.yaw + a : pl.yaw;
      const pose = c.rig.pose({ pos, yaw, sample: pl.sample, weaponLen: pl.weaponLen, run: 0.3, phase: g.time * 8 + i, air: !pl.grounded, time: g.time + i, swing: pl.atk === 'swing' ? 1 : 0 });
      if (pl.atk === 'swing') {
        if (c.swing !== pl.swingCount) {
          c.swing = pl.swingCount;
          c.ctx.id = g.nextSwingId();
          c.ctx.hitBodies.clear();
          c.prev = null;
        }
        c.ctx.dmgMul = mul;
        const wp = weaponPose(pos, yaw, pl.sample, c.rig.spec, pl.weaponLen);
        if (c.prev) sweepWeapon(g, c.prev, wp, dt, c.ctx);
        c.prev = wp;
      } else c.prev = null;
      void pose;
    }
  }

  // ---------------------------------------------------------------- 新しいスキル
  /** 妄想バイオ: 歩いた跡に毒の霧を置く。毎フレーム呼ぶ。 */
  private bio(s: SkillInst, dt: number): void {
    const g = this.g;
    const L = s.level;
    const E = !!s.evolved;
    const st = s.st as { lx?: number; lz?: number; t?: number };
    const p = g.player.pos;
    if (st.lx === undefined || st.lz === undefined) {
      st.lx = p.x;
      st.lz = p.z;
    }
    st.t = (st.t ?? 0) + dt;
    const r = this.area(1.1 + 0.15 * L) * (E ? 2 : 1) * (g.player.dashing ? 1.4 : 1);
    const moved = Math.hypot(p.x - st.lx, p.z - st.lz);
    if (moved > Math.max(0.9, r * 0.75) || (st.t > 0.6 && moved > 0.25)) {
      st.lx = p.x;
      st.lz = p.z;
      st.t = 0;
      this.addCloud(p.x, p.z, r, 2.6 + 0.35 * L + (E ? 1 : 0), E ? 24 : 5 + 3 * L);
    }
  }

  /** 毒の霧を置く（理科室の薬品が割れたときにも使う）。dps は 1 秒あたりの毒のダメージ。 */
  addCloud(x: number, z: number, r: number, life: number, dps: number): void {
    if (this.clouds.length >= CLOUD_CAP) this.clouds.shift();
    this.clouds.push({ x, z, r, life, max: life, dps, tick: 0, fuse: -1, seed: Math.random() * 6, gy: this.g.world.groundY(x, z) });
  }

  /** 引火: 炎の爆発が毒の霧に触れたら、霧を順に爆発させる。Game.explode から呼ぶ。 */
  ignite(pos: V3, r: number): void {
    let n = 0;
    for (const c of this.clouds) {
      if (c.fuse >= 0) continue;
      const d = Math.hypot(c.x - pos.x, c.z - pos.z);
      if (d > r + c.r) continue;
      c.fuse = 0.05 + d * 0.025;
      n++;
    }
    if (n > 0) this.comboLog('ignite', { clouds: n });
  }

  private updateClouds(dt: number): void {
    const g = this.g;
    const L = this.get('bio')?.level ?? 1;
    for (let i = this.clouds.length - 1; i >= 0; i--) {
      const c = this.clouds[i];
      c.life -= dt;
      if (c.fuse >= 0) {
        c.fuse -= dt;
        if (c.fuse < 0) {
          this.clouds.splice(i, 1);
          // 爆発が近くの霧へ引火する（explode の中で ignite が呼ばれる）
          g.explode({ x: c.x, y: 0.7, z: c.z }, c.r * 1.5, 16 + 6 * L, { force: 9, struct: 8, source: 'skill', element: 'fire', small: true });
          continue;
        }
      }
      if (c.life <= 0) {
        this.clouds.splice(i, 1);
        continue;
      }
      c.tick -= dt;
      if (c.tick <= 0) {
        c.tick = 0.25;
        g.enemies.inRadius({ x: c.x, y: 0, z: c.z }, c.r, (e) => g.enemies.poisonIt(e, 1.3, c.dps * g.stats.power));
      }
    }
    // 見た目: 半透明の緑の玉をまとめて描く
    if (!this.cloudMesh && this.clouds.length) {
      const geo = new THREE.IcosahedronGeometry(1, 1);
      const mat = new THREE.MeshBasicMaterial({ color: ZONE.ally, transparent: true, opacity: 0.17, depthWrite: false });
      this.cloudMesh = new THREE.InstancedMesh(geo, mat, CLOUD_CAP);
      this.cloudMesh.frustumCulled = false;
      this.cloudMesh.renderOrder = 3;
      g.world.root.add(this.cloudMesh);
    }
    const m = this.cloudMesh;
    if (!m) return;
    m.count = this.clouds.length;
    for (let i = 0; i < this.clouds.length; i++) {
      const c = this.clouds[i];
      const k = Math.min(1, (c.max - c.life) / 0.25) * Math.min(1, c.life / 0.6) * (c.fuse >= 0 ? 1.25 : 1);
      const wob = Math.sin(g.time * 2.4 + c.seed) * 0.08;
      cm4.compose(cp.set(c.x, c.gy + c.r * 0.12 + wob, c.z), cq.identity(), cs.set(c.r * k * (1 + wob), Math.min(1.1, c.r * 0.4) * k, c.r * k * (1 - wob)));
      m.setMatrixAt(i, cm4);
    }
    m.instanceMatrix.needsUpdate = true;
    if (this.clouds.length && Math.random() < dt * 14) {
      const c = this.clouds[Math.floor(Math.random() * this.clouds.length)];
      g.fx.spawn({ pos: { x: c.x + (Math.random() - 0.5) * c.r, y: 0.3, z: c.z + (Math.random() - 0.5) * c.r }, vel: { x: 0, y: 0.8, z: 0 }, life: 0.9, size: c.r * 0.5, size2: c.r * 0.9, color: 0x9fe86a, color2: 0x5a9a3a, shape: 5, alpha: 0.5 });
    }
  }

  /** バナナの皮: まわりにばらまく。踏まれたかどうかは updatePeels で調べる。 */
  private banana(s: SkillInst): void {
    const g = this.g;
    const L = s.level;
    const E = !!s.evolved;
    const p = g.player.pos;
    if (!g.enemies.nearest(p, 20)) {
      s.cd = 0.5;
      return;
    }
    s.cd = this.cdOf(4.4 - 0.3 * L);
    const n = 2 + Math.floor(L / 2) + g.stats.amount + (E ? 2 : 0);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = 2.2 + Math.random() * 5;
      const x = p.x + Math.cos(a) * d;
      const z = p.z + Math.sin(a) * d;
      if (this.peels.length >= 36) this.peels.shift()!.sp.removeFromParent();
      const sp = this.sprite('🍌', 0.8);
      sp.position.set(x, g.world.groundY(x, z) + 0.28, z);
      this.peels.push({ x, z, sp, life: 14, uses: E ? 3 : 1 });
      g.fx.dust({ x, y: 0.1, z }, 0.4, 0xffe066, 1);
    }
    g.audio.whoosh();
  }

  private updatePeels(dt: number): void {
    const g = this.g;
    const s = this.get('banana');
    const L = s?.level ?? 1;
    const E = !!s?.evolved;
    const slapstick = this.has('milk');
    for (let i = this.peels.length - 1; i >= 0; i--) {
      const pl = this.peels[i];
      pl.life -= dt;
      if (pl.life < 1) pl.sp.material.opacity = Math.max(0, pl.life);
      for (const e of g.enemies.list) {
        if (pl.uses <= 0) break;
        if (e.state !== 'walk' || e.frozen > 0) continue;
        const dx = e.x - pl.x;
        const dz = e.z - pl.z;
        const rr = 0.45 + e.radius;
        if (dx * dx + dz * dz > rr * rr) continue;
        pl.uses--;
        // 歩いていた向きへ、足をすくわれて飛ぶ
        const v = e.body.linvel();
        let mx = v.x;
        let mz = v.z;
        let ml = Math.hypot(mx, mz);
        if (ml < 0.5) {
          mx = e.x - g.player.pos.x;
          mz = e.z - g.player.pos.z;
          ml = Math.hypot(mx, mz) || 1;
        }
        mx /= ml;
        mz /= ml;
        let k = (7 + 1.5 * L) * (E ? 2 : 1);
        if (slapstick && this.onPuddle(e.x, e.z)) {
          k *= 3;
          this.comboLog('slapstick');
        }
        const dmg = 6 + 3 * L;
        if (e.def.boss) {
          e.stagger = Math.max(e.stagger, 0.9);
          this.hit(e, dmg * 2);
        } else this.hit(e, dmg, { x: mx * k, y: (6 + 0.6 * L) * (E ? 1.4 : 1), z: mz * k });
        g.fx.number({ x: e.x, y: e.y + 1.2, z: e.z }, 'つるっ', 'info');
        g.audio.slip();
      }
      if (pl.uses <= 0 || pl.life <= 0) {
        pl.sp.removeFromParent();
        this.peels.splice(i, 1);
      }
    }
  }

  private onPuddle(x: number, z: number): boolean {
    for (const p of this.puddles) if (!p.burn && Math.hypot(p.x - x, p.z - z) < p.r) return true;
    return false;
  }

  /** ボウリング部の勧誘: 重い球を前へ転がす。 */
  private bowling(s: SkillInst): void {
    const g = this.g;
    const L = s.level;
    const E = !!s.evolved;
    const p = g.player.pos;
    if (!g.enemies.nearest(p, 22)) {
      s.cd = 0.4;
      return;
    }
    s.cd = this.cdOf(E ? 3.6 : 4 - 0.25 * L);
    const n = (E ? 3 : 1 + (L >= 4 ? 1 : 0)) + g.stats.amount;
    const scale = E ? 1.5 : 1.1 + 0.1 * L;
    const speed = 16;
    const al = this.nearestAlarm(25);
    if (al) this.comboLog('lure');
    const baseYaw = al ? Math.atan2(al.x - p.x, al.z - p.z) : g.player.yaw;
    for (let i = 0; i < n; i++) {
      const a = baseYaw + (i - (n - 1) / 2) * 0.3;
      const dx = Math.sin(a);
      const dz = Math.cos(a);
      const prop = g.world.spawnProp('bowling', { x: p.x + dx * 1.5, y: g.world.groundY(p.x + dx * 1.5, p.z + dz * 1.5) + 0.03, z: p.z + dz * 1.5 }, 0, { vel: { x: dx * speed, y: 0, z: dz * speed }, life: 5, scale, hot: 5, dmgMul: 2 + 0.5 * L });
      if (!prop) continue;
      prop.body.setAngvel({ x: (dz * speed) / prop.half.y, y: 0, z: (-dx * speed) / prop.half.y }, true);
      let age = 0;
      let steerT = 0;
      let goal: V3 | null = null;
      this.addTask({
        update: (dt) => {
          age += dt;
          if (!prop.alive || prop.dying >= 0 || age > 5) {
            if (prop.hits >= 7) {
              g.hud.toast(`ストライク！ ×${prop.hits}`, 'praise');
              g.audio.coin();
              log('skill.bowling.strike', {}, { hits: prop.hits });
            }
            return false;
          }
          if (E) {
            // マグネット: 敵の多い方へ曲がる
            steerT -= dt;
            const t = prop.body.translation();
            if (steerT <= 0) {
              steerT = 0.3;
              goal = g.enemies.cluster(t, 16);
            }
            if (goal) {
              const gx = goal.x - t.x;
              const gz = goal.z - t.z;
              const gl = Math.hypot(gx, gz) || 1;
              prop.body.applyImpulse({ x: (gx / gl) * prop.mass * 9 * dt, y: 0, z: (gz / gl) * prop.mass * 9 * dt }, true);
            }
          }
          return true;
        },
      });
    }
    g.audio.thud(0.7);
  }

  /** ポルターガイスト: 近くの物を浮かせて、敵へ投げる。 */
  private poltergeist(s: SkillInst): void {
    const g = this.g;
    const L = s.level;
    const E = !!s.evolved;
    const p = g.player.pos;
    const range = this.area(E ? 13 : 7.5 + 0.6 * L);
    if (!g.enemies.nearest(p, range + 12)) {
      s.cd = 0.5;
      return;
    }
    const n = (E ? 3 + 2 * L : 2 + L) + g.stats.amount;
    const kinjiro = this.has('statue');
    // 騒霊大行進: 建物の壁をはがして、投げられるがれきにする
    if (E) {
      let torn = 0;
      for (const ch of g.world.chunks) {
        if (torn >= 3) break;
        if (ch.state !== 'fixed' || !ch.building) continue;
        if (Math.hypot(ch.pos.x - p.x, ch.pos.z - p.z) > range) continue;
        g.world.hitChunk(ch, ch.hp + ch.tough + 1, { x: 0, y: 3, z: 0 });
        torn++;
      }
    }
    const cands: { body: RAPIER.RigidBody; ref: Prop | Chunk; prop: Prop | null; d: number }[] = [];
    for (const pr of g.world.props) {
      if (!pr.alive || pr.rooted || pr.dying >= 0) continue;
      const statue = pr.def.id === 'statue' || pr.def.id === 'bigstatue';
      if (pr.mass > (kinjiro && statue ? 2000 : 320)) continue;
      const t = pr.body.translation();
      const d = Math.hypot(t.x - p.x, t.z - p.z);
      if (d > range) continue;
      // 金次郎、飛ぶ: 落ちた像を真っ先に投げる
      cands.push({ body: pr.body, ref: pr, prop: pr, d: kinjiro && statue ? d - 1000 : d });
    }
    for (const ch of g.world.loose) {
      if (ch.state !== 'loose' || !ch.body || ch.mass > 420) continue;
      const t = ch.body.translation();
      const d = Math.hypot(t.x - p.x, t.z - p.z);
      if (d <= range) cands.push({ body: ch.body, ref: ch, prop: null, d });
    }
    if (!cands.length) {
      s.cd = 0.8;
      return;
    }
    cands.sort((a, b) => a.d - b.d);
    const picked = cands.slice(0, n);
    if (picked.some((c) => c.d < -500)) this.comboLog('kinjiro');
    s.cd = this.cdOf(3.6 - 0.2 * L);
    for (const c of picked) {
      const t0 = c.body.translation();
      const hover = { x: t0.x, y: 2.2 + Math.random() * 1.2, z: t0.z };
      const spin = { x: (Math.random() - 0.5) * 6, y: (Math.random() - 0.5) * 6, z: (Math.random() - 0.5) * 6 };
      let t = 0;
      const alive = () => (c.prop ? c.prop.alive && c.prop.dying < 0 : (c.ref as Chunk).state === 'loose');
      this.addTask({
        update: (dt) => {
          t += dt;
          if (!alive()) return false;
          const cur = c.body.translation();
          if (t < 0.45) {
            c.body.setLinvel({ x: (hover.x - cur.x) * 6, y: (hover.y - cur.y) * 6, z: (hover.z - cur.z) * 6 }, true);
            c.body.setAngvel(spin, true);
            if (Math.random() < dt * 12) g.fx.element({ x: cur.x, y: cur.y, z: cur.z }, 'dark', 0.6);
            return true;
          }
          const target = g.enemies.nearest(cur, 26);
          if (target) {
            const dx = target.x - cur.x;
            const dy = target.y - cur.y + 0.3;
            const dz = target.z - cur.z;
            const dl = Math.hypot(dx, dy, dz) || 1;
            c.body.setLinvel({ x: (dx / dl) * 24, y: (dy / dl) * 24 + 1.5, z: (dz / dl) * 24 }, true);
          }
          g.world.heat(c.ref, 3);
          if (c.prop) c.prop.dmgMul = Math.max(c.prop.dmgMul, 2 + 0.5 * L);
          g.fx.element({ x: cur.x, y: cur.y, z: cur.z }, 'dark', 0.9);
          return false;
        },
      });
    }
    g.audio.whoosh();
  }

  /** ジャイアントスイング: 近くの敵をつかんで振り回し、投げる。 */
  private swing(s: SkillInst): void {
    const g = this.g;
    const L = s.level;
    const E = !!s.evolved;
    const p = g.player.pos;
    const near: { e: Enemy; d: number }[] = [];
    for (const e of g.enemies.list) {
      if (e.state !== 'walk' || e.def.boss) continue;
      const d = Math.hypot(e.x - p.x, e.z - p.z);
      if (d < 3.8) near.push({ e, d });
    }
    if (!near.length) {
      s.cd = 0.4;
      return;
    }
    near.sort((a, b) => a.d - b.d);
    const victims = near.slice(0, E ? 3 : 1).map((x) => x.e);
    s.cd = this.cdOf(5.6 - 0.35 * L);
    for (const e of victims) {
      e.state = 'held';
      e.body.setGravityScale(0, true);
    }
    let t = 0;
    let ang = Math.atan2(victims[0].x - p.x, victims[0].z - p.z);
    const dur = 1.25;
    const R = 2.1;
    g.audio.whoosh();
    g.player.emote('smug', 1.6);
    const release = () => {
      const pp = g.player.pos;
      const c = g.enemies.cluster(pp, 22);
      for (const e of victims) {
        if (e.state !== 'held' || !e.alive) continue;
        e.body.setGravityScale(1, true);
        e.state = 'walk';
        let dx = c ? c.x - e.x : Math.cos(ang);
        let dz = c ? c.z - e.z : -Math.sin(ang);
        const dl = Math.hypot(dx, dz) || 1;
        dx /= dl;
        dz /= dl;
        const sp = 20 + 2 * L;
        this.hit(e, 14 + 5 * L);
        g.enemies.push(e, { x: dx * sp, y: 5, z: dz * sp }, true);
        if (E) this.watchThrown(e, L);
      }
    };
    this.addTask({
      update: (dt) => {
        t += dt;
        const w = 4 + (10 + L) * Math.min(1, t / 0.7);
        ang += w * dt;
        const pp = g.player.pos;
        victims.forEach((e, i) => {
          if (e.state !== 'held' || !e.alive) return;
          const a = ang + (i * Math.PI * 2) / victims.length;
          const x = pp.x + Math.sin(a) * R;
          const z = pp.z + Math.cos(a) * R;
          e.body.setTranslation({ x, y: pp.y + 1.1, z }, true);
          e.body.setLinvel({ x: Math.cos(a) * w * R, y: 0, z: -Math.sin(a) * w * R }, true);
          const tx = Math.cos(a);
          const tz = -Math.sin(a);
          for (const o of g.enemies.list) {
            if (o === e || o.state === 'dead' || o.state === 'held') continue;
            const dx = o.x - x;
            const dz = o.z - z;
            const rr = o.radius + e.radius + 0.35;
            if (dx * dx + dz * dz > rr * rr) continue;
            if (o.cd && (o.cd.get('swing') ?? 0) > 0) continue;
            (o.cd ??= new Map()).set('swing', 0.35);
            const k = 10 + L;
            this.hit(o, 8 + 3 * L, { x: tx * k + (dx / rr) * 4, y: 4, z: tz * k + (dz / rr) * 4 });
            g.fx.hitMark({ x: o.x, y: o.y, z: o.z }, 0.4);
            g.audio.hit(0.4);
          }
          if (Math.random() < dt * 20) g.fx.dust({ x, y: 0.1, z }, 0.4, 0xe6dcc8, 1);
        });
        if (Math.floor(t * 5) !== Math.floor((t - dt) * 5)) g.audio.whoosh();
        if (t < dur) return true;
        release();
        return false;
      },
      dispose: () => {
        for (const e of victims) {
          if (e.state === 'held' && e.alive) {
            e.body.setGravityScale(1, true);
            e.state = 'walk';
          }
        }
      },
    });
  }

  /** 人間ハンマー投げ: 投げた敵が落ちた所で爆発する。 */
  private watchThrown(e: Enemy, L: number): void {
    const g = this.g;
    let age = 0;
    this.addTask({
      update: (dt) => {
        age += dt;
        if (!e.alive) return false;
        const low = e.y - g.world.groundY(e.x, e.z) < e.halfH + e.radius + 0.5;
        if ((age > 0.3 && low) || age > 2.2) {
          g.explode({ x: e.x, y: e.y, z: e.z }, this.area(3), 25 + 6 * L, { force: 12, struct: 25, source: 'skill' });
          return false;
        }
        return true;
      },
    });
  }

  /** 下校のチャイム: 弱った敵を帰らせ、まわりをひるませる。 */
  private chime(s: SkillInst): void {
    const g = this.g;
    const L = s.level;
    const E = !!s.evolved;
    if (g.enemies.living < 3) {
      s.cd = 1;
      return;
    }
    s.cd = this.cdOf(E ? 24 : 30 - 3 * L);
    const p = g.player.pos;
    const loud = this.has('megaphone');
    if (loud) this.comboLog('broadcast');
    const r = E ? 200 : this.area(16 + 3 * L) * (loud ? 1.5 : 1);
    const thr = E ? 0.5 : 0.22 + 0.05 * L;
    g.audio.chime();
    g.hud.toast(E ? '強制下校！ 全員帰りなさい！' : 'キーンコーンカーンコーン♪ 下校の時間です', 'info');
    g.fx.ring({ x: p.x, y: 0.2, z: p.z }, 1, Math.min(r, 40), ZONE.ally, 0.9, 0.6);
    let home = 0;
    g.enemies.inRadius(p, r, (e) => {
      if (e.def.boss) {
        if (E) g.enemies.damage(e, e.maxHp * 0.12, 'skill', { kind: 'true' });
        e.stagger = Math.max(e.stagger, 1.0);
        return;
      }
      if (e.hp < e.maxHp * thr) {
        home++;
        g.fx.poof({ x: e.x, y: e.y, z: e.z }, 1.2, 0xfff6c0);
        if (home <= 6) g.fx.number({ x: e.x, y: e.y + 1.4, z: e.z }, 'さようなら', 'info');
        g.enemies.damage(e, e.hp + 1, 'skill', { quiet: true, kind: 'true' });
      } else e.stagger = Math.max(e.stagger, 1.2);
    });
    log('skill.chime', { r: Math.round(Math.min(r, 999)), thr }, { home });
  }

  /** 水風船: 敵をぬらして押し流す。 */
  private balloon(s: SkillInst): void {
    const g = this.g;
    const L = s.level;
    const E = !!s.evolved;
    const c = g.enemies.cluster(g.player.pos, 18);
    if (!c) {
      s.cd = 0.4;
      return;
    }
    if (E) {
      // プール開き: 空から大量の水が降ってくる
      s.cd = this.cdOf(6);
      const r = this.area(7.5);
      g.fx.ring({ x: c.x, y: 0.1, z: c.z }, r, r * 0.25, ZONE.ally, 0.8, 0.8);
      g.projectiles.fire({ emoji: '💧', size: 4, pos: { x: c.x, y: 22, z: c.z }, vel: { x: 0, y: -26, z: 0 }, r: 1, dmg: 0, life: 2, grav: -0.01, ghost: true, onEnd: (pos) => this.splash(pos, r, 30, 10, 11) });
      g.audio.whoosh();
      return;
    }
    s.cd = this.cdOf(3.4 - 0.2 * L);
    const n = 1 + (L >= 3 ? 1 : 0) + g.stats.amount;
    const from = this.chest();
    const T = 0.8;
    const grav = -20;
    for (let i = 0; i < n; i++) {
      const tx = c.x + (i ? (Math.random() - 0.5) * 6 : 0);
      const tz = c.z + (i ? (Math.random() - 0.5) * 6 : 0);
      const r = this.area(2.6 + 0.25 * L);
      g.projectiles.fire({
        emoji: '🎈', size: 0.9, pos: from, vel: { x: (tx - from.x) / T, y: (0.2 - from.y - 0.5 * grav * T * T) / T, z: (tz - from.z) / T }, r: 0.35, dmg: 0, life: 3, grav, spin: 4, knock: 0,
        onEnd: (pos) => this.splash(pos, r, 6 + 3 * L, 6 + L, 5),
      });
    }
    g.audio.shoot();
  }

  private splash(pos: V3, r: number, dmg: number, wetSec: number, push: number): void {
    const g = this.g;
    const at = { x: pos.x, y: 0.3, z: pos.z };
    g.fx.element(at, 'water', 1.4 + r * 0.15);
    g.fx.ring({ x: pos.x, y: 0.1, z: pos.z }, 0.3, r, ZONE.ally, 0.35);
    for (let i = 0; i < 10; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 2 + Math.random() * r;
      g.fx.spawn({ pos: at, vel: { x: Math.cos(a) * sp, y: 3 + Math.random() * 4, z: Math.sin(a) * sp }, grav: -14, life: 0.6, size: 0.25, size2: 0.1, color: 0xbfe8ff, shape: 0, alpha: 0.9 });
    }
    g.audio.splash(r / 3);
    g.enemies.inRadius(pos, r, (e, d) => {
      g.enemies.wetIt(e, wetSec);
      const inv = 1 / Math.max(0.4, d);
      this.hit(e, dmg, { x: (e.x - pos.x) * inv * push, y: 1.5, z: (e.z - pos.z) * inv * push });
    });
    if (push > 8) g.world.blast({ x: pos.x, y: 0.5, z: pos.z }, r, 0, push * 0.6, 0);
  }


  // ---------------------------------------------------------------- 第 2 弾のスキル
  /** 打ち上げ花火: 空で開き、火の粉（小さな炎の爆発）が降る。 */
  private hanabi(s: SkillInst): void {
    const g = this.g;
    const L = s.level;
    const E = !!s.evolved;
    if (!g.enemies.nearest(g.player.pos, 26)) {
      s.cd = 0.5;
      return;
    }
    s.cd = this.cdOf(E ? 1.3 : 3.6 - 0.25 * L);
    const n = (E ? 2 : 1 + Math.floor(L / 2)) + g.stats.amount;
    const from = this.chest();
    for (let i = 0; i < n; i++) {
      const t = g.enemies.random(g.player.pos, 24) ?? g.enemies.nearest(g.player.pos, 26);
      if (!t) break;
      const top = { x: t.x + (Math.random() - 0.5) * 3, y: 13 + Math.random() * 3, z: t.z + (Math.random() - 0.5) * 3 };
      const T = 0.75;
      g.projectiles.fire({ emoji: '✨', size: 0.7, pos: from, vel: { x: (top.x - from.x) / T, y: (top.y - from.y) / T, z: (top.z - from.z) / T }, r: 0.2, dmg: 0, life: T, ghost: true, onEnd: () => this.burstFirework(top, L, E) });
    }
    g.audio.whoosh();
  }

  private burstFirework(pos: V3, L: number, E: boolean): void {
    const g = this.g;
    const colors = [0xff5a8a, 0xffd84a, 0x6ad0ff, 0x9aff6a, 0xd06aff];
    const c = colors[Math.floor(Math.random() * colors.length)];
    for (let k = 0; k < 26; k++) {
      const a = Math.random() * Math.PI * 2;
      const b = Math.acos(Math.random() * 2 - 1);
      const sp = 8 + Math.random() * 4;
      g.fx.spawn({ pos, vel: { x: Math.sin(b) * Math.cos(a) * sp, y: Math.cos(b) * sp, z: Math.sin(b) * Math.sin(a) * sp }, grav: -6, drag: 1.5, life: 0.9, size: 0.6, size2: 0.15, color: c, color2: 0xffffff, shape: 7, alpha: 1 });
    }
    g.audio.explode(0.35);
    const r = this.area(4 + 0.4 * L);
    const sparks = (E ? 8 : 6) + L;
    for (let k = 0; k < sparks; k++) {
      const a = Math.random() * Math.PI * 2;
      const d = Math.sqrt(Math.random()) * r;
      g.projectiles.fire({ emoji: '✨', size: 0.55, pos, vel: { x: (Math.cos(a) * d) / 1.2, y: -2, z: (Math.sin(a) * d) / 1.2 }, grav: -14, r: 0.25, dmg: 0, life: 3, ghost: true, element: 'fire', explode: { r: this.area(1.4), dmg: 9 + 4 * L, force: 4, struct: 3 } });
    }
  }

  /** 目覚まし時計爆弾: 敵を引きつけてから爆発する。 */
  private alarm(s: SkillInst): void {
    const g = this.g;
    const L = s.level;
    const E = !!s.evolved;
    const c = g.enemies.cluster(g.player.pos, 18);
    if (!c) {
      s.cd = 0.5;
      return;
    }
    s.cd = this.cdOf(E ? 7 : 9 - 0.6 * L);
    const n = E ? 2 : 1;
    const from = this.chest();
    const T = 0.8;
    const grav = -20;
    for (let i = 0; i < n; i++) {
      const tx = c.x + (i ? (Math.random() - 0.5) * 10 : 0);
      const tz = c.z + (i ? (Math.random() - 0.5) * 10 : 0);
      g.projectiles.fire({
        emoji: '⏰', size: 0.9, pos: from, vel: { x: (tx - from.x) / T, y: (0.2 - from.y - 0.5 * grav * T * T) / T, z: (tz - from.z) / T }, r: 0.3, dmg: 0, life: 3, grav, spin: 6, ghost: true,
        onEnd: (pos) => this.placeAlarm(pos, L, E),
      });
    }
  }

  private placeAlarm(pos: V3, L: number, E: boolean): void {
    const g = this.g;
    if (this.alarms.length >= 4) return;
    const sp = this.sprite('⏰', 1.2);
    sp.position.set(pos.x, pos.y + 0.5, pos.z);
    const lure = { x: pos.x, z: pos.z, r: this.area(E ? 14 : 9 + L) };
    g.enemies.lures.push(lure);
    this.alarms.push({ x: pos.x, z: pos.z, t: 0, life: 4 + 0.3 * L, sp, L, E, ring: 0, lure });
  }

  /** いま鳴っている目覚まし時計のうち、プレイヤーに近いもの（range 以内）。 */
  private nearestAlarm(range: number): { x: number; z: number } | null {
    const p = this.g.player.pos;
    let best: { x: number; z: number } | null = null;
    let bd = range;
    for (const a of this.alarms) {
      const d = Math.hypot(a.x - p.x, a.z - p.z);
      if (d < bd) {
        bd = d;
        best = a;
      }
    }
    return best;
  }

  private updateAlarms(dt: number): void {
    const g = this.g;
    for (let i = this.alarms.length - 1; i >= 0; i--) {
      const a = this.alarms[i];
      a.t += dt;
      a.ring -= dt;
      a.sp.material.rotation = Math.sin(a.t * 40) * 0.25;
      if (a.ring <= 0) {
        a.ring = 0.5;
        g.audio.ring();
        g.fx.ring({ x: a.x, y: 0.2, z: a.z }, 0.5, a.lure.r, ZONE.ally, 0.45, 0.35);
        // 強力磁石: 力ずくで引き寄せる
        if (a.E) {
          g.enemies.inRadius({ x: a.x, y: 0, z: a.z }, a.lure.r, (e, d) => {
            if (e.def.boss || d < 1) return;
            g.enemies.push(e, { x: ((a.x - e.x) / d) * 3, y: 0.5, z: ((a.z - e.z) / d) * 3 });
          });
        }
      }
      if (a.t < a.life) continue;
      this.alarms.splice(i, 1);
      const li = g.enemies.lures.indexOf(a.lure);
      if (li >= 0) g.enemies.lures.splice(li, 1);
      a.sp.removeFromParent();
      g.explode({ x: a.x, y: 0.6, z: a.z }, this.area(3.5 + 0.3 * a.L), 40 + 15 * a.L, { force: 14, struct: 20, source: 'skill', element: 'fire' });
    }
  }

  /** シャボン玉: 敵を包んで浮かべ、割れると落とす。 */
  private bubble(s: SkillInst): void {
    const g = this.g;
    const L = s.level;
    const E = !!s.evolved;
    const n = (E ? 2 : 1 + Math.floor(L / 2)) + g.stats.amount;
    let any = false;
    for (let i = 0; i < n; i++) {
      const c: Enemy[] = [];
      for (const e of g.enemies.list) if (e.state === 'walk' && !e.def.boss && Math.hypot(e.x - g.player.pos.x, e.z - g.player.pos.z) < 16) c.push(e);
      if (!c.length) break;
      const first = c[Math.floor(Math.random() * c.length)];
      const group = E ? c.filter((e) => Math.hypot(e.x - first.x, e.z - first.z) < 2.4).slice(0, 4) : [first];
      any = true;
      this.trapBubble(group, L, E);
    }
    s.cd = any ? this.cdOf(4 - 0.2 * L) : 0.5;
  }

  private trapBubble(group: Enemy[], L: number, E: boolean): void {
    const g = this.g;
    const cx = group.reduce((a, e) => a + e.x, 0) / group.length;
    const cz = group.reduce((a, e) => a + e.z, 0) / group.length;
    const base = group.map((e) => ({ x: e.x - cx, y: e.y, z: e.z - cz }));
    for (const e of group) {
      e.state = 'held';
      e.body.setGravityScale(0, true);
      g.enemies.wetIt(e, 8);
    }
    const rad = (E ? 2.2 : 1.1) * Math.max(...group.map((e) => e.scale));
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(rad, 16, 12), new THREE.MeshBasicMaterial({ color: 0xcff0ff, transparent: true, opacity: 0.32, depthWrite: false }));
    mesh.renderOrder = 4;
    g.world.root.add(mesh);
    const h = 3 + 0.6 * L + (E ? 2 : 0);
    const dur = 2.4;
    let t = 0;
    g.audio.pop();
    const release = (popped: boolean) => {
      for (const e of group) {
        if (e.state !== 'held' || !e.alive) continue;
        e.body.setGravityScale(1, true);
        e.state = 'walk';
        if (popped) {
          g.enemies.push(e, { x: 0, y: -8, z: 0 });
          this.hit(e, 8 + 4 * L);
        }
      }
    };
    this.addTask({
      update: (dt) => {
        t += dt;
        const k = Math.min(1, t / 1.2);
        const wob = Math.sin(t * 5) * 0.3;
        let alive = 0;
        group.forEach((e, i) => {
          if (e.state !== 'held' || !e.alive) return;
          alive++;
          e.body.setTranslation({ x: cx + base[i].x + wob, y: base[i].y + h * k, z: cz + base[i].z }, true);
          e.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        });
        mesh.position.set(cx + wob, base[0].y + h * k + 0.2, cz);
        mesh.scale.setScalar(1 + Math.sin(t * 7) * 0.04);
        if (t < dur && alive > 0) return true;
        g.fx.sparkle({ x: mesh.position.x, y: mesh.position.y, z: mesh.position.z }, 0xcff0ff, 12, rad);
        g.audio.pop();
        release(true);
        return false;
      },
      dispose: () => {
        mesh.removeFromParent();
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
        release(false);
      },
    });
  }

  /** お掃除ロボ: 経験値を集め、敵にぶつかる。進化すると弱った敵を吸い込んで撃ち出す。毎フレーム呼ぶ。 */
  private roomba(s: SkillInst, dt: number): void {
    const g = this.g;
    const L = s.level;
    const E = !!s.evolved;
    const n = 1 + Math.floor(L / 2) + g.stats.amount;
    const st = s.st as { sig?: string; bots?: { sp: THREE.Sprite; x: number; z: number; goal: { x: number; z: number } | null; think: number; hop: number; robo: Prop | null; yaw: number }[] };
    const sig = `${n}${E}`;
    if (st.sig !== sig) {
      this.dropBots(st.bots);
      st.bots = [];
      for (let i = 0; i < n; i++) {
        const x = g.player.pos.x + i;
        const z = g.player.pos.z + 1;
        // 進化前は USDCraft のロボット掃除機の形（無ければ絵文字）。物理では動かさず、何にも当たらない
        const robo = !E && PROPS.u_robovac ? g.world.spawnProp('u_robovac', { x, y: g.world.groundY(x, z), z }, 0, {}) : null;
        if (robo) {
          robo.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
          robo.rooted = true;
          robo.hp = Infinity;
          robo.col.setCollisionGroups(groups(G.PROP, 0));
        }
        const sp = this.sprite(E ? '🍽️' : '🤖', E ? 1.3 : 1.0);
        sp.visible = !robo;
        st.bots.push({ sp, x, z, goal: null, think: 0, hop: Math.random() * 6, robo, yaw: 0 });
      }
      st.sig = sig;
    }
    const p = g.player.pos;
    const speed = (5 + L) * (E ? 1.2 : 1);
    for (const b of st.bots!) {
      b.think -= dt;
      b.hop += dt * 12;
      if (b.think <= 0) {
        b.think = 0.4;
        // 近くに落ちている経験値 → いちばん近い敵 → ノリコのそば、の順に向かう
        let goal: { x: number; z: number } | null = null;
        let bd = 14;
        for (const gm of g.pickups.gems) {
          if (gm.fly) continue;
          const d = Math.hypot(gm.x - b.x, gm.z - b.z);
          if (d < bd) {
            bd = d;
            goal = gm;
          }
        }
        if (!goal) {
          const e = g.enemies.nearest({ x: b.x, y: 0, z: b.z }, 16);
          goal = e ? { x: e.x, z: e.z } : { x: p.x + Math.sin(b.hop * 0.1) * 2, z: p.z + Math.cos(b.hop * 0.1) * 2 };
        }
        b.goal = goal;
      }
      if (b.goal) {
        const dx = b.goal.x - b.x;
        const dz = b.goal.z - b.z;
        const d = Math.hypot(dx, dz) || 1;
        const step = Math.min(d, speed * dt);
        b.x += (dx / d) * step;
        b.z += (dz / d) * step;
        if (d > 0.2) b.yaw = Math.atan2(dx, dz);
      }
      // 経験値を集める（ノリコのところへ飛んでいく）
      for (const gm of g.pickups.gems) if (!gm.fly && Math.hypot(gm.x - b.x, gm.z - b.z) < 1.3) gm.fly = true;
      // 敵にぶつかる
      for (const e of g.enemies.list) {
        if (e.state === 'dead' || e.state === 'held') continue;
        const dx = e.x - b.x;
        const dz = e.z - b.z;
        const rr = e.radius + 0.6;
        if (dx * dx + dz * dz > rr * rr) continue;
        if (e.cd && (e.cd.get('roomba') ?? 0) > 0) continue;
        (e.cd ??= new Map()).set('roomba', 0.5);
        const d = Math.hypot(dx, dz) || 1;
        if (E && !e.def.boss && e.hp < e.maxHp * 0.4) {
          // 吸い込んで、ほかの敵へ撃ち出す
          g.enemies.damage(e, e.hp + 1, 'skill', { quiet: true, kind: 'true' });
          g.fx.poof({ x: e.x, y: e.y, z: e.z }, 1, 0xffffff);
          const t = g.enemies.nearest({ x: b.x, y: 0, z: b.z }, 20, (o) => o === e);
          if (t) {
            const from = { x: b.x, y: 0.8, z: b.z };
            const dd = this.dirTo(from, t);
            const em = e.def.model === 'bear' ? '🐻' : e.def.model === 'terrorist' ? '🥷' : '🧍';
            g.projectiles.fire({ emoji: em, size: 1.2, pos: from, vel: { x: dd.x * 24, y: dd.y * 24 + 2, z: dd.z * 24 }, r: 0.5, dmg: 30 + 8 * L, life: 1.5, pierce: 2, knock: 9, spin: 12 });
          }
          continue;
        }
        this.hit(e, 6 + 3 * L, { x: (dx / d) * 7, y: 2, z: (dz / d) * 7 });
        g.fx.hitMark({ x: e.x, y: e.y, z: e.z }, 0.3);
        g.audio.hit(0.3);
      }
      const gy = g.world.groundY(b.x, b.z);
      if (b.robo?.alive) {
        b.robo.body.setNextKinematicTranslation({ x: b.x, y: gy + b.robo.half.y + 0.01, z: b.z });
        b.robo.body.setNextKinematicRotation({ x: 0, y: Math.sin(b.yaw / 2), z: 0, w: Math.cos(b.yaw / 2) });
      } else {
        b.sp.visible = true;
        b.sp.position.set(b.x, gy + 0.4 + Math.abs(Math.sin(b.hop)) * 0.08, b.z);
      }
    }
  }

  /** お掃除ロボを片付ける。 */
  private dropBots(bots: { sp: THREE.Sprite; robo: Prop | null }[] | undefined): void {
    bots?.forEach((b) => {
      b.sp.removeFromParent();
      if (b.robo?.alive) this.g.world.removeProp(b.robo);
    });
  }

  /** ドミノ倒し: 敵の方へ並べて、端を押す。 */
  private domino(s: SkillInst): void {
    const g = this.g;
    const L = s.level;
    const E = !!s.evolved;
    const p = g.player.pos;
    // 目覚まし時計があれば、そちらへ並べる（ピタゴラ装置）
    let goal: { x: number; z: number } | null = this.nearestAlarm(24);
    if (goal) this.comboLog('pythagora');
    goal ??= g.enemies.cluster(p, 18) ?? g.enemies.nearest(p, 20);
    if (!goal) {
      s.cd = 0.5;
      return;
    }
    s.cd = this.cdOf(6 - 0.4 * L);
    let dx = goal.x - p.x;
    let dz = goal.z - p.z;
    const dl = Math.hypot(dx, dz) || 1;
    dx /= dl;
    dz /= dl;
    const n = 8 + 2 * L;
    const scale = E ? 1.7 : 1;
    const gap = 0.95 * scale;
    const yaw = Math.atan2(dx, dz);
    const pieces: Prop[] = [];
    for (let i = 0; i < n; i++) {
      const x = p.x + dx * (2 + i * gap);
      const z = p.z + dz * (2 + i * gap);
      const pr = g.world.spawnProp('domino', { x, y: g.world.groundY(x, z) + 0.02, z }, yaw, { life: 7, scale, hot: 7, dmgMul: (E ? 3 : 1.6) + 0.3 * L });
      if (pr) pieces.push(pr);
    }
    g.audio.thud(0.4);
    if (!pieces.length) return;
    let t = 0;
    this.addTask({
      update: (dt) => {
        t += dt;
        if (t < 0.3) return true;
        const first = pieces[0];
        if (first.alive) {
          const tr = first.body.translation();
          first.body.applyImpulseAtPoint({ x: dx * first.mass * 2.4, y: 0, z: dz * first.mass * 2.4 }, { x: tr.x, y: tr.y + first.half.y * 0.9, z: tr.z }, true);
        }
        return false;
      },
    });
  }

  /** 放送委員の絶叫: 前方へ大声。ひるませて吹き飛ばす。 */
  private megaphone(s: SkillInst): void {
    const g = this.g;
    const L = s.level;
    const E = !!s.evolved;
    const p = g.player.pos;
    const f = this.forward();
    const range = this.area(E ? 10 : 7 + L);
    const cosHalf = E ? -1 : Math.cos(0.65);
    let n = 0;
    g.enemies.inRadius(p, range, (e, d) => {
      const dx = e.x - p.x;
      const dz = e.z - p.z;
      const dl = Math.hypot(dx, dz) || 1;
      if ((dx * f.x + dz * f.z) / dl < cosHalf) return;
      n++;
      const k = (8 + L) * (1 - (d / range) * 0.4);
      this.hit(e, 5 + 3 * L, { x: (dx / dl) * k, y: 3, z: (dz / dl) * k });
      e.stagger = Math.max(e.stagger, (1 + 0.15 * L) * (e.def.boss ? 0.3 : 1));
    });
    if (!n) {
      s.cd = 0.4;
      return;
    }
    s.cd = this.cdOf(4.5 - 0.3 * L);
    for (let k = 1; k <= 4; k++) {
      const d = (range / 4) * k;
      g.fx.ring(E ? { x: p.x, y: 1.2, z: p.z } : { x: p.x + f.x * d, y: 1.2, z: p.z + f.z * d }, E ? d * 0.5 : 0.3, E ? d : 1 + d * 0.4, ZONE.ally, 0.3 + k * 0.05, 0.7);
    }
    g.fx.number({ x: p.x, y: p.y + 2.4, z: p.z }, 'わーーーっ！', 'info');
    g.audio.shout();
    g.fx.shake('S');
    if (E) g.world.blast({ x: p.x, y: 1.5, z: p.z }, range, 18, 5, 6);
  }

  /** 体育館のトランポリン: 乗った敵を跳ね上げる。 */
  private trampoline(s: SkillInst): void {
    const g = this.g;
    const L = s.level;
    const E = !!s.evolved;
    const p = g.player.pos;
    if (!g.enemies.nearest(p, 18)) {
      s.cd = 0.5;
      return;
    }
    s.cd = this.cdOf(7 - 0.4 * L);
    const n = 1 + Math.floor(L / 2);
    for (let i = 0; i < n; i++) {
      const t = g.enemies.random(p, 14);
      const a = t ? Math.atan2(t.z - p.z, t.x - p.x) + (Math.random() - 0.5) * 0.6 : Math.random() * Math.PI * 2;
      const d = 3.5 + Math.random() * 2.5;
      const x = p.x + Math.cos(a) * d;
      const z = p.z + Math.sin(a) * d;
      if (this.tramps.length >= 8) this.removeTramp(this.tramps[0]);
      const grp = new THREE.Group();
      const pad = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 0.12, 20), new THREE.MeshLambertMaterial({ color: 0x2a6ad2 }));
      pad.position.y = 0.5;
      const rim = new THREE.Mesh(new THREE.TorusGeometry(1.45, 0.1, 6, 24), new THREE.MeshLambertMaterial({ color: 0xffd84a }));
      rim.rotation.x = Math.PI / 2;
      rim.position.y = 0.52;
      grp.add(pad, rim);
      for (let k = 0; k < 4; k++) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.5, 6), new THREE.MeshLambertMaterial({ color: 0x404048 }));
        leg.position.set(Math.cos(k * 1.57 + 0.78) * 1.3, 0.25, Math.sin(k * 1.57 + 0.78) * 1.3);
        grp.add(leg);
      }
      grp.position.set(x, g.world.groundY(x, z), z);
      g.world.root.add(grp);
      this.tramps.push({ x, z, r: 1.5, life: E ? 12 : 10, mesh: grp, pad, squash: 0, pcd: 0, L, E });
    }
    g.audio.thud(0.4);
  }

  private removeTramp(t: { mesh: THREE.Group }): void {
    t.mesh.removeFromParent();
    const i = this.tramps.indexOf(t as never);
    if (i >= 0) this.tramps.splice(i, 1);
  }

  private updateTramps(dt: number): void {
    const g = this.g;
    for (const t of [...this.tramps]) {
      t.life -= dt;
      t.pcd -= dt;
      t.squash = Math.max(0, t.squash - dt * 4);
      t.pad.scale.set(1, 1 - t.squash * 0.6, 1);
      t.pad.position.y = 0.5 - t.squash * 0.25;
      if (t.life <= 0) {
        g.fx.poof({ x: t.x, y: 0.5, z: t.z }, 1.2);
        this.removeTramp(t);
        continue;
      }
      for (const e of g.enemies.list) {
        if (e.state !== 'walk' || e.def.boss) continue;
        if (Math.hypot(e.x - t.x, e.z - t.z) > t.r + e.radius * 0.5) continue;
        if (e.cd && (e.cd.get('tramp') ?? 0) > 0) continue;
        (e.cd ??= new Map()).set('tramp', 1.2);
        this.hit(e, 4 + 2 * t.L, { x: (Math.random() - 0.5) * 3, y: 13 + 1.5 * t.L, z: (Math.random() - 0.5) * 3 });
        t.squash = 1;
        g.audio.boing();
        if (t.E) this.watchThrown(e, t.L);
      }
      // ノリコが乗ると大ジャンプ
      const p = g.player;
      if (p.grounded && t.pcd <= 0 && Math.hypot(p.pos.x - t.x, p.pos.z - t.z) < t.r) {
        p.vy = 15;
        p.grounded = false;
        t.pcd = 0.6;
        t.squash = 1;
        g.audio.boing();
      }
    }
  }

  /** 消火器ブラスト: 前方へ泡を吹きつける。 */
  private foam(s: SkillInst): void {
    const g = this.g;
    const L = s.level;
    const E = !!s.evolved;
    const p = g.player.pos;
    const f = this.forward();
    const range = this.area(E ? 9 : 6 + 0.6 * L);
    const cosHalf = E ? -1 : Math.cos(0.55);
    const dry = this.has('blizzard');
    let n = 0;
    g.enemies.inRadius(p, range, (e) => {
      const dx = e.x - p.x;
      const dz = e.z - p.z;
      const dl = Math.hypot(dx, dz) || 1;
      if ((dx * f.x + dz * f.z) / dl < cosHalf) return;
      n++;
      const k = E ? 18 : 10 + 1.5 * L;
      this.hit(e, 3 + 2 * L, { x: (dx / dl) * k, y: 1.5, z: (dz / dl) * k });
      g.enemies.wetIt(e, 5);
      e.stagger = Math.max(e.stagger, e.def.boss ? 0.2 : 0.6);
      if (dry) g.enemies.freeze(e, 1.2);
    });
    if (!n) {
      s.cd = 0.4;
      return;
    }
    if (dry) this.comboLog('dryice', { n });
    s.cd = this.cdOf(E ? 3 : 3.4 - 0.2 * L);
    for (let k = 0; k < 34; k++) {
      const a = E ? Math.random() * Math.PI * 2 : g.player.yaw + (Math.random() - 0.5) * 1.1;
      const sp = 6 + Math.random() * range;
      g.fx.spawn({ pos: { x: p.x, y: 1, z: p.z }, vel: { x: Math.sin(a) * sp, y: Math.random() * 2, z: Math.cos(a) * sp }, drag: 2, life: 0.8, size: 0.5, size2: 1.4, color: dry ? 0xd8f4ff : 0xffffff, color2: 0xe8eef2, shape: 5, alpha: 0.85 });
    }
    g.audio.spray();
  }


  // ---------------------------------------------------------------- 第 3 弾のスキル（ダメージの種類・物理演算）
  /** 彫刻刀ラッシュ: 前方を 3 回切りつけ、出血させる（物理の継続ダメージ）。 */
  private carve(s: SkillInst): void {
    const g = this.g;
    const L = s.level;
    const E = !!s.evolved;
    if (!g.enemies.nearest(g.player.pos, 6)) {
      s.cd = 0.3;
      return;
    }
    s.cd = this.cdOf(E ? 2.2 : 2.6 - 0.15 * L);
    const range = this.area(3 + 0.3 * L) * (E ? 1.4 : 1);
    const cosHalf = E ? -1 : Math.cos(0.9);
    const bleed = (4 + 2 * L) * g.scaleFor(this.cur);
    let k = 0;
    let t = 0;
    this.addTask({
      update: (dt) => {
        t += dt;
        if (t < k * 0.12) return true;
        k++;
        const p = g.player.pos;
        const f = this.forward();
        g.enemies.inRadius(p, range, (e) => {
          const dx = e.x - p.x;
          const dz = e.z - p.z;
          const dl = Math.hypot(dx, dz) || 1;
          if ((dx * f.x + dz * f.z) / dl < cosHalf) return;
          this.hit(e, 5 + 2.5 * L, { x: (dx / dl) * 2, y: 0.5, z: (dz / dl) * 2 });
          g.enemies.bleedIt(e, 3, bleed);
        });
        // 切った跡（白い弧）
        const base = g.player.yaw + (k % 2 ? 0.9 : -0.9);
        for (let i = 0; i < 7; i++) {
          const a = base + (k % 2 ? -1 : 1) * (i / 6) * 1.8;
          g.fx.spawn({ pos: { x: p.x + Math.sin(a) * range * 0.7, y: p.y + 1, z: p.z + Math.cos(a) * range * 0.7 }, life: 0.18, size: 0.5, size2: 0.2, color: 0xffffff, color2: 0xff6a6a, shape: 4, alpha: 0.9 });
        }
        g.audio.swing(0.6);
        return k < 3;
      },
    });
  }

  /** 居残りの刑: 印を付けた敵は、3 秒後にその間に受けたダメージの一部をトゥルーダメージで受ける。 */
  private detention(s: SkillInst): void {
    const g = this.g;
    const L = s.level;
    const E = !!s.evolved;
    const p = g.player.pos;
    const c: Enemy[] = [];
    for (const e of g.enemies.list) if (e.state !== 'dead' && e.markT <= 0 && Math.hypot(e.x - p.x, e.z - p.z) < 20) c.push(e);
    if (!c.length) {
      s.cd = 0.5;
      return;
    }
    s.cd = this.cdOf(7 - 0.5 * L);
    // 硬い敵（ボス・体力の多い敵）から先に
    c.sort((a, b) => (b.def.boss ? 1e6 : 0) + b.hp - ((a.def.boss ? 1e6 : 0) + a.hp));
    const n = (E ? 3 : 1) + Math.floor(L / 2);
    for (const e of c.slice(0, n)) {
      e.markT = 3;
      e.markAcc = 0;
      e.markPct = E ? 0.6 : 0.35 + 0.03 * L;
      const sp = this.sprite('⏲️', 0.9);
      this.addTask({
        update: () => {
          sp.position.set(e.x, e.y + e.halfH + e.radius + 1.0, e.z);
          return e.alive && e.state !== 'dead' && e.markT > 0;
        },
        dispose: () => sp.removeFromParent(),
      });
    }
    g.audio.ui('ok');
  }

  /** 酸性雨: 浴びた敵の物理防御と魔法防御を下げ、毒を与える。 */
  private acid(s: SkillInst): void {
    const g = this.g;
    const L = s.level;
    const E = !!s.evolved;
    const c = this.aim(20);
    if (!c) {
      s.cd = 0.5;
      return;
    }
    s.cd = this.cdOf(6 - 0.3 * L);
    const r = this.area(4 + 0.4 * L);
    const life = E ? 5 : 3;
    const cut = E ? 0.6 : 0.3;
    const dps = (6 + 3 * L) * g.scaleFor(this.cur);
    let t = 0;
    let tick = 0;
    this.addTask({
      update: (dt) => {
        t += dt;
        tick -= dt;
        for (let i = 0; i < 3; i++) {
          const a = Math.random() * Math.PI * 2;
          const d = Math.sqrt(Math.random()) * r;
          g.fx.spawn({ pos: { x: c.x + Math.cos(a) * d, y: 7, z: c.z + Math.sin(a) * d }, vel: { x: 0, y: -16, z: 0 }, life: 0.42, size: 0.14, size2: 0.1, color: 0xc8ff6a, shape: 0, alpha: 0.9 });
        }
        if (tick <= 0) {
          tick = 0.3;
          g.fx.ring({ x: c.x, y: 0.1, z: c.z }, r * 0.96, r, ZONE.ally, 0.3, 0.6);
          g.enemies.inRadius({ x: c.x, y: 0, z: c.z }, r, (e) => {
            g.enemies.shred(e, cut, cut, 1.5);
            g.enemies.poisonIt(e, 1.5, dps);
          });
        }
        return t < life;
      },
    });
    g.audio.splash(0.6);
  }

  /** ペットボトルロケット: 敵を空高く打ち上げる。落ちたときに、高さに応じた衝撃ダメージ。 */
  private rocket(s: SkillInst): void {
    const g = this.g;
    const L = s.level;
    const E = !!s.evolved;
    const p = g.player.pos;
    const c: Enemy[] = [];
    for (const e of g.enemies.list) if (e.state === 'walk' && !e.def.boss && Math.hypot(e.x - p.x, e.z - p.z) < 16) c.push(e);
    if (!c.length) {
      s.cd = 0.4;
      return;
    }
    s.cd = this.cdOf(4.2 - 0.25 * L);
    const n = 1 + Math.floor(L / 2) + g.stats.amount;
    const vy = E ? 26 : 17 + 2 * L;
    for (let i = 0; i < n && c.length; i++) {
      const e = c.splice(Math.floor(Math.random() * c.length), 1)[0];
      const v = e.body.linvel();
      g.enemies.launch(e, { x: v.x * 0.3 + (Math.random() - 0.5) * 2, y: vy, z: v.z * 0.3 + (Math.random() - 0.5) * 2 });
      e.t = Math.max(e.t, 2.5);
      const sp = this.sprite('🧴', 0.8);
      let t = 0;
      let peak = e.y;
      const y0 = e.y;
      this.addTask({
        update: (dt) => {
          t += dt;
          if (!e.alive) return false;
          peak = Math.max(peak, e.y);
          if (t < 0.7) {
            sp.position.set(e.x, e.y - e.halfH - 0.3, e.z);
            if (Math.random() < dt * 40) g.fx.spawn({ pos: { x: e.x, y: e.y - e.halfH - 0.5, z: e.z }, vel: { x: (Math.random() - 0.5) * 2, y: -8, z: (Math.random() - 0.5) * 2 }, life: 0.4, size: 0.3, size2: 0.1, color: 0xbfe8ff, shape: 0, alpha: 0.9 });
          } else sp.visible = false;
          const vy2 = e.body.linvel().y;
          if (t > 0.5 && e.y < peak - 0.5 && vy2 > -1.5) {
            // 着地: 高さに応じた衝撃ダメージ（ふだんの落下ダメージとは別に足す）
            const h = peak - y0;
            this.hit(e, 6 + 3 * L + h * 2.5);
            if (E) g.explode({ x: e.x, y: e.y, z: e.z }, this.area(2.6), 20 + 6 * L, { force: 10, struct: 15, source: 'skill' });
            return false;
          }
          return t < 4;
        },
        dispose: () => sp.removeFromParent(),
      });
    }
    g.audio.whoosh();
  }

  /** ビリヤード部の勧誘: 手球を打つ。当たった敵が弾かれて、玉突きのように次の敵へぶつかる。 */
  private billiard(s: SkillInst): void {
    const g = this.g;
    const L = s.level;
    const E = !!s.evolved;
    const t = g.enemies.nearest(g.player.pos, 22);
    if (!t) {
      s.cd = 0.4;
      return;
    }
    s.cd = this.cdOf(3.6 - 0.2 * L);
    const from = this.chest();
    const base = Math.atan2(t.x - from.x, t.z - from.z);
    const n = E ? 9 : 1 + (L >= 3 ? 1 : 0) + (L >= 5 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      const a = base + (i - (n - 1) / 2) * (E ? 0.18 : 0.25);
      g.projectiles.fire({
        emoji: i === 0 ? '⚪' : '🟣', size: 0.6, pos: { x: from.x, y: from.y - 0.4, z: from.z }, vel: { x: Math.sin(a) * 26, y: 0, z: Math.cos(a) * 26 }, r: 0.35, dmg: 6 + 3 * L, life: 1.2, knock: 16 + 2 * L,
        onHit: (e) => {
          // 弾かれた敵が「球」になる。ぶつかった相手には巻き込み（衝撃）ダメージ
          e.chained = true;
          g.audio.clank(0.6);
        },
      });
    }
    g.audio.thud(0.5);
  }

  /** 落とし穴: 踏んだ敵を沈めて動けなくし、しばらくして空へ吐き出す。 */
  private pitfall(s: SkillInst): void {
    const g = this.g;
    const L = s.level;
    const E = !!s.evolved;
    const p = g.player.pos;
    if (!g.enemies.nearest(p, 16)) {
      s.cd = 0.5;
      return;
    }
    s.cd = this.cdOf(6 - 0.4 * L);
    const n = 1 + Math.floor(L / 2);
    for (let i = 0; i < n; i++) {
      const t = g.enemies.random(p, 14);
      const a = t ? Math.atan2(t.z - p.z, t.x - p.x) + (Math.random() - 0.5) * 0.7 : Math.random() * Math.PI * 2;
      const d = 3 + Math.random() * 4;
      const x = p.x + Math.cos(a) * d;
      const z = p.z + Math.sin(a) * d;
      const r = (E ? 2 : 1.2) * Math.sqrt(this.g.stats.area);
      const gy = g.world.groundY(x, z);
      const hole = new THREE.Mesh(new THREE.CircleGeometry(r, 20), new THREE.MeshBasicMaterial({ color: 0x1a120c, transparent: true, opacity: 0.85, depthWrite: false }));
      hole.rotation.x = -Math.PI / 2;
      hole.position.set(x, gy + 0.04, z);
      hole.renderOrder = 2;
      const rim = new THREE.Mesh(new THREE.RingGeometry(r, r + 0.12, 24), new THREE.MeshBasicMaterial({ color: ZONE.ally, transparent: true, opacity: 0.7, depthWrite: false, side: THREE.DoubleSide }));
      rim.rotation.x = -Math.PI / 2;
      rim.position.set(x, gy + 0.05, z);
      g.world.root.add(hole, rim);
      const used = new Set<Enemy>();
      let life = 10;
      this.addTask({
        update: (dt) => {
          life -= dt;
          for (const e of g.enemies.list) {
            if (e.state !== 'walk' || e.def.boss || used.has(e)) continue;
            if (Math.hypot(e.x - x, e.z - z) > r) continue;
            used.add(e);
            this.trapInHole(e, x, gy, z, L, E);
          }
          return life > 0;
        },
        dispose: () => {
          hole.removeFromParent();
          rim.removeFromParent();
        },
      });
    }
    g.audio.thud(0.5);
  }

  private trapInHole(e: Enemy, x: number, gy: number, z: number, L: number, E: boolean): void {
    const g = this.g;
    e.state = 'held';
    e.body.setGravityScale(0, true);
    e.col.setCollisionGroups(groups(G.ENEMY, 0));
    const foot = e.halfH + e.radius;
    let t = 0;
    let tick = 0;
    g.fx.dust({ x, y: gy + 0.2, z }, 1, 0x7a5a3a, 4);
    g.audio.thud(0.4);
    const release = (spit: boolean) => {
      if (e.state !== 'held' || !e.alive) return;
      e.col.setCollisionGroups(groups(G.ENEMY, G.STATIC | G.CHUNK | G.PROP | G.ENEMY | G.PLAYER | G.DEBRIS | G.RAIL | G.FLAIL));
      e.body.setTranslation({ x, y: gy + foot + 0.2, z }, true);
      e.body.setGravityScale(1, true);
      e.state = 'walk';
      if (!spit) return;
      g.enemies.launch(e, { x: (Math.random() - 0.5) * 4, y: (14 + 2 * L) * (E ? 1.6 : 1), z: (Math.random() - 0.5) * 4 });
      g.fx.dust({ x, y: gy + 0.2, z }, 1.4, 0x7a5a3a, 6);
      g.audio.boing();
    };
    this.addTask({
      update: (dt) => {
        t += dt;
        tick -= dt;
        if (!e.alive || e.state !== 'held') return false;
        // 穴に沈んでいく
        const k = Math.min(1, t / 0.3);
        e.body.setTranslation({ x, y: gy + foot - k * (foot * 2 - 0.3), z }, true);
        e.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        if (tick <= 0) {
          tick = 0.35;
          this.hit(e, 3 + L, undefined, true);
        }
        if (t < 1.4) return true;
        release(true);
        return false;
      },
      dispose: () => release(false),
    });
  }

  /** チェーン鉄球: 鎖（ロープの関節）でつないだ鉄球を引きずる。毎フレーム呼ぶ。 */
  private flail(s: SkillInst, dt: number): void {
    const g = this.g;
    const L = s.level;
    const E = !!s.evolved;
    const st = s.st as { sig?: string; balls?: { prop: Prop; joint: RAPIER.ImpulseJoint; chain: THREE.Mesh }[]; ang?: number };
    const sig = `${L}${E}`;
    const pl = g.player;
    const pb = pl.col.parent();
    if (!pb) return;
    if (st.sig !== sig) {
      this.dropFlail(st);
      st.balls = [];
      const n = E ? 2 : 1;
      const scale = (E ? 0.6 : 0.4) + 0.03 * L;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const prop = g.world.spawnProp('wreckball', { x: pl.pos.x + Math.sin(a) * 3, y: pl.pos.y + 0.5, z: pl.pos.z + Math.cos(a) * 3 }, 0, { hot: 1, dmgMul: 1.6 + 0.3 * L, scale });
        if (!prop) continue;
        // ノリコの足元の判定（キャラクターの移動）には引っかからないよう、専用のグループにする
        prop.col.setCollisionGroups(groups(G.FLAIL, G.STATIC | G.CHUNK | G.PROP | G.ENEMY | G.DEBRIS));
        const len = 3 + (E ? 0.6 : 0) + 0.15 * L;
        const jd = RAPIER.JointData.rope(len, { x: 0, y: 0.6, z: 0 }, { x: 0, y: prop.half.y * 0.9, z: 0 });
        const joint = g.physics.world.createImpulseJoint(jd, pb, prop.body, true);
        const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1, 5), new THREE.MeshLambertMaterial({ color: 0x8a8e96 }));
        g.world.root.add(chain);
        st.balls.push({ prop, joint, chain });
      }
      st.sig = sig;
      st.ang = 0;
    }
    st.ang = (st.ang ?? 0) + dt;
    for (const b of st.balls ?? []) {
      if (!b.prop.alive) continue;
      const body = b.prop.body;
      const t = body.translation();
      g.world.heat(b.prop, 1);
      // まわりを回るように、ロープに直角な向きへ押し続ける
      const dx = t.x - pl.pos.x;
      const dz = t.z - pl.pos.z;
      const d = Math.hypot(dx, dz) || 1;
      const v = body.linvel();
      const sp = Math.hypot(v.x, v.z);
      const target = 7 + L;
      if (sp < target) body.applyImpulse({ x: (-dz / d) * b.prop.mass * 9 * dt, y: 0, z: (dx / d) * b.prop.mass * 9 * dt }, true);
      if (E) g.world.blast({ x: t.x, y: t.y, z: t.z }, b.prop.half.y + 0.4, sp > 5 ? 12 : 0, 0, 0);
      // 鎖の見た目
      const hx = pl.pos.x;
      const hy = pl.pos.y + 1.1;
      const hz = pl.pos.z;
      const len = Math.hypot(t.x - hx, t.y - hy, t.z - hz) || 0.01;
      b.chain.position.set((t.x + hx) / 2, (t.y + hy) / 2, (t.z + hz) / 2);
      b.chain.scale.set(1, len, 1);
      b.chain.quaternion.setFromUnitVectors(UPV, new THREE.Vector3(t.x - hx, t.y - hy, t.z - hz).normalize());
    }
  }

  private dropFlail(st: { balls?: { prop: Prop; joint: RAPIER.ImpulseJoint; chain: THREE.Mesh }[] }): void {
    for (const b of st.balls ?? []) {
      if (b.prop.alive) {
        this.g.physics.world.removeImpulseJoint(b.joint, true);
        this.g.world.removeProp(b.prop);
      }
      b.chain.removeFromParent();
    }
    st.balls = [];
  }

  /** 生徒会長の盾: しばらく防御が上がり、体当たりしてきた敵を押し返す。 */
  private shield(s: SkillInst): void {
    const g = this.g;
    const L = s.level;
    const E = !!s.evolved;
    if (!g.enemies.nearest(g.player.pos, 10)) {
      s.cd = 0.5;
      return;
    }
    s.cd = this.cdOf(14 - 0.8 * L);
    const dur = 4 + 0.4 * L + (E ? 1 : 0);
    g.shieldT = dur;
    g.shieldDef = 40 + 15 * L;
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(1.3, 18, 12), new THREE.MeshBasicMaterial({ color: ZONE.ally, transparent: true, opacity: 0.18, depthWrite: false }));
    mesh.renderOrder = 4;
    g.world.root.add(mesh);
    g.audio.ui('ok');
    g.hud.toast('生徒会長の盾！', 'info');
    let t = 0;
    this.addTask({
      update: (dt) => {
        t += dt;
        const p = g.player.pos;
        mesh.position.set(p.x, p.y + 0.9, p.z);
        mesh.scale.setScalar(1 + Math.sin(t * 8) * 0.03);
        // 近づいた敵を押し返す
        g.enemies.inRadius(p, 1.6, (e, d) => {
          if (e.def.boss) return;
          const inv = 1 / Math.max(0.3, d);
          g.enemies.push(e, { x: (e.x - p.x) * inv * 5, y: 1, z: (e.z - p.z) * inv * 5 });
        });
        if (t < dur) return true;
        if (E) g.explode({ x: p.x, y: 0.8, z: p.z }, this.area(6), 30 + 10 * L, { force: 18, struct: 20, source: 'skill' });
        return false;
      },
      dispose: () => mesh.removeFromParent(),
    });
  }

  // ---------------------------------------------------------------- 武器に連動
  /** 振り終わりに呼ばれる（斬撃波）。 */
  onSwingEnd(pose: WeaponPose): void {
    const g = this.g;
    const s = this.get('slashwave');
    if (!s || this.slashCd > 0) return;
    this.cur = s.ctx ?? SKILL_MAP.slashwave.dmg ?? null;
    const L = s.level;
    const E = !!s.evolved;
    this.slashCd = this.cdOf(E ? 0.45 : 0.55 - 0.06 * L);
    const f = this.forward();
    const from = this.chest();
    const w = g.player.weapon;
    g.projectiles.fire({
      emoji: E ? '🌌' : '🌙', size: E ? 5 : 1.5 + 0.2 * L, pos: { x: from.x + f.x, y: from.y, z: from.z + f.z }, vel: { x: f.x * 21, y: 0, z: f.z * 21 },
      // 威力は武器の威力（「棒、育つ」で増えた分を含む）で決まる
      r: E ? 2.3 : 0.7 + 0.1 * L, dmg: g.weaponPower * (E ? 1.5 : 0.5 + 0.1 * L), life: E ? 1.6 : 0.9, pierce: E ? 99 : 2 + L, knock: 5, ghost: E, struct: E ? 0 : 4, carve: E ? 45 : 0,
    });
    if (g.player.weaponBonus > 0) this.comboLog('growslash', { bonus: g.player.weaponBonus });
    void pose;
  }

  /**
   * 武器が敵に当たったときに呼ばれる（棒、育つ／爆裂剣）。killed はこの一撃で倒したか、clone は分身の攻撃か。
   */
  onWeaponHit(e: Enemy, pos: V3, dmg: number, killed: boolean, clone: boolean): void {
    const g = this.g;
    const gs = this.get('grow');
    if (gs) {
      // 分身の攻撃でも育つ（分身も育てる）
      const before = g.player.weaponBonus;
      g.player.weaponBonus += growGain(gs.level, !!gs.evolved, killed);
      const after = g.player.weaponBonus;
      if (clone) this.comboLog('growclone', { bonus: after });
      if (Math.floor(after / 50) > Math.floor(before / 50)) {
        const p = g.player.pos;
        g.fx.number({ x: p.x, y: p.y + 2.3, z: p.z }, `🌱 武器の威力 +${after}`, 'heal');
        g.fx.sparkle({ x: p.x, y: p.y + 1.2, z: p.z }, 0x8fe05a, 10, 0.8);
        log('skill.grow', { gain: after - before }, { bonus: after, weapon: g.player.weapon.damage + after });
      }
    }
    if (clone) return;
    g.itemFx.onWeaponHit(e, pos);
    this.third.onWeaponHit(e);
    // 扇風機の羽根: まわりの敵にも物理ダメージ
    const fan = g.ip('senpuki');
    if (fan > 0) {
      for (const o of g.enemies.list) {
        if (o === e || o.state === 'dead' || Math.hypot(o.x - e.x, o.z - e.z) > 2.5) continue;
        g.enemies.damage(o, dmg * 0.5 * fan, 'skill', { kind: 'phys', noCharge: true });
      }
    }
    // ピコピコハンマー: ときどき気絶させる
    const piko = g.ip('piko');
    if (piko > 0 && e.alive && e.state !== 'dead' && Math.random() < 0.2 * Math.min(2, piko)) {
      e.stagger = Math.max(e.stagger, e.def.boss ? 0.3 : 1.2);
      g.fx.number({ x: e.x, y: e.y + e.halfH + e.radius + 0.8, z: e.z }, '💫', 'info');
      g.audio.boing();
    }
    const s = this.get('boomsword');
    if (!s || this.boomCd > 0) return;
    this.cur = s.ctx ?? SKILL_MAP.boomsword.dmg ?? null;
    const L = s.level;
    const E = !!s.evolved;
    if (!E && Math.random() > 0.2 + 0.1 * L) return;
    this.boomCd = 0.09;
    // 育つ爆発: 育った威力の 30% が乗る
    const grown = gs ? g.player.weaponBonus * 0.3 : 0;
    if (grown > 0) this.comboLog('growboom', { add: Math.round(grown) });
    g.explode(pos, this.area(E ? 2.3 : 1.3 + 0.1 * L), ((E ? 14 : 6 + 3 * L) + grown) * g.stats.power, { force: 6, struct: 4, source: 'skill', small: true });
    void e;
    void dmg;
  }

  // ---------------------------------------------------------------- 追加のスキル（LoL・Dota・PoE の仕組みを学校風に）
  /** 釣り部のフック: 遠くの敵を引き寄せる。引かれた敵は途中の敵を巻き込む。 */
  private hook(s: SkillInst): void {
    const g = this.g;
    const L = s.level;
    const E = !!s.evolved;
    const p = g.player.pos;
    const c: { e: Enemy; d: number }[] = [];
    for (const e of g.enemies.list) {
      if (e.state !== 'walk') continue;
      const d = Math.hypot(e.x - p.x, e.z - p.z);
      if (d > 5 && d < 24) c.push({ e, d });
    }
    if (!c.length) {
      s.cd = 0.4;
      return;
    }
    s.cd = this.cdOf(E ? 2.6 : 3.6 - 0.18 * L);
    c.sort((a, b) => b.d - a.d);
    const n = E ? 3 : 1 + (L >= 4 ? 1 : 0);
    for (let i = 0; i < n && i < c.length; i++) {
      // 遠い方から、ばらけるように選ぶ
      const e = c[Math.min(c.length - 1, i * 2)].e;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(6), 3));
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xf2f2f2 }));
      g.world.root.add(line);
      const hookSp = this.sprite('🪝', 0.6);
      let t = 0;
      let phase = 0;
      let slamT = 0;
      this.hit(e, 10 + 4 * L);
      g.audio.whoosh();
      this.addTask({
        update: (dt) => {
          t += dt;
          if (!e.alive || e.state === 'dead' || t > 2.4) return false;
          const pp = g.player.pos;
          const pos = geo.attributes.position as THREE.BufferAttribute;
          pos.setXYZ(0, pp.x, pp.y + 1.1, pp.z);
          pos.setXYZ(1, e.x, e.y, e.z);
          pos.needsUpdate = true;
          hookSp.position.set(e.x, e.y + 0.3, e.z);
          const dx = pp.x - e.x;
          const dz = pp.z - e.z;
          const d = Math.hypot(dx, dz) || 1;
          if (phase === 0) {
            if (e.def.boss) {
              e.stagger = Math.max(e.stagger, 0.6);
              return t < 0.4;
            }
            // 引き寄せる。飛んでいる間は「巻き込み」になる
            const sp = 17 + 2 * L;
            g.enemies.launch(e, { x: (dx / d) * sp, y: 3.5, z: (dz / d) * sp });
            e.chained = true;
            e.t = Math.max(e.t, 1.2);
            phase = 1;
          } else if (phase === 1) {
            if (d < 2.6) {
              if (!E) return false;
              // 一本釣り: 頭上へ振り上げて、たたきつける
              phase = 2;
              e.body.setLinvel({ x: 0, y: 15, z: 0 }, true);
              slamT = 0.32;
            }
          } else if (phase === 2) {
            slamT -= dt;
            if (slamT <= 0) {
              phase = 3;
              e.body.setLinvel({ x: (-dx / d) * 6, y: -32, z: (-dz / d) * 6 }, true);
            }
          } else if (phase === 3) {
            const gy = g.world.groundY(e.x, e.z);
            if (e.y - gy < e.halfH + e.radius + 0.4) {
              this.hit(e, 20 + 6 * L);
              g.explode({ x: e.x, y: gy + 0.4, z: e.z }, this.area(2.4), 10 + 3 * L, { force: 12, struct: 10, source: 'skill', small: true });
              g.fx.dust({ x: e.x, y: gy + 0.1, z: e.z }, 1.4, 0xe6dcc8, 6);
              g.fx.shake('S');
              return false;
            }
          }
          return true;
        },
        dispose: () => {
          line.removeFromParent();
          geo.dispose();
          (line.material as THREE.Material).dispose();
          hookSp.removeFromParent();
        },
      });
    }
  }

  /** 転がる地球儀: 物理で転がる大きな球。坂では速くなる。 */
  private globe(s: SkillInst): void {
    const g = this.g;
    const L = s.level;
    const E = !!s.evolved;
    const p = g.player.pos;
    const goal = g.enemies.cluster(p, 24);
    if (!goal) {
      s.cd = 0.4;
      return;
    }
    s.cd = this.cdOf(E ? 4.5 : 5.2 - 0.25 * L);
    const n = (E ? 3 : 1 + (L >= 4 ? 1 : 0)) + g.stats.amount;
    const scale = E ? 1.7 : 0.85 + 0.12 * L;
    const base = Math.atan2(goal.x - p.x, goal.z - p.z);
    for (let i = 0; i < n; i++) {
      const a = base + (i - (n - 1) / 2) * 0.35;
      const dx = Math.sin(a);
      const dz = Math.cos(a);
      const x = p.x + dx * 2.2;
      const z = p.z + dz * 2.2;
      const sp = 12;
      const prop = g.world.spawnProp('globe', { x, y: g.world.groundY(x, z) + 0.05, z }, a, { vel: { x: dx * sp, y: 0, z: dz * sp }, life: 8, scale, hot: 8, dmgMul: 2.2 + 0.5 * L });
      if (!prop) continue;
      prop.body.setAngvel({ x: (dz * sp) / prop.half.y, y: 0, z: (-dx * sp) / prop.half.y }, true);
      let age = 0;
      let trail = 0;
      this.addTask({
        update: (dt) => {
          age += dt;
          if (!prop.alive || prop.dying >= 0 || age > 8) return false;
          const v = prop.body.linvel();
          const spd = Math.hypot(v.x, v.z);
          if (spd > 2) g.world.heat(prop, 1);
          // 平らな所でも止まりにくいように、進む向きへ少し押す
          if (spd > 0.5 && spd < 9) prop.body.applyImpulse({ x: (v.x / spd) * prop.mass * 4 * dt, y: 0, z: (v.z / spd) * prop.mass * 4 * dt }, true);
          if (E) {
            trail -= dt;
            if (trail <= 0 && spd > 2) {
              trail = 0.3;
              const t = prop.body.translation();
              this.puddle({ x: t.x, y: t.y, z: t.z }, 1.4, true, 3);
            }
          }
          return true;
        },
      });
    }
    g.audio.thud(0.8);
  }

  /** 雪だるま転がし: ひくたびに大きくなり、最後に砕けて凍らせる。 */
  private snowball(s: SkillInst): void {
    const g = this.g;
    const L = s.level;
    const E = !!s.evolved;
    const p = g.player.pos;
    const goal = g.enemies.cluster(p, 22);
    if (!goal) {
      s.cd = 0.4;
      return;
    }
    s.cd = this.cdOf(E ? 5 : 6 - 0.3 * L);
    const a = Math.atan2(goal.x - p.x, goal.z - p.z);
    const dx = Math.sin(a);
    const dz = Math.cos(a);
    let scale = E ? 0.9 : 0.5;
    const maxScale = E ? 2.2 : 1.0 + 0.15 * L;
    const x0 = p.x + dx * 2;
    const z0 = p.z + dz * 2;
    let prop = g.world.spawnProp('snowball', { x: x0, y: g.world.groundY(x0, z0) + 0.05, z: z0 }, 0, { vel: { x: dx * 11, y: 0, z: dz * 11 }, life: 9, scale, hot: 9, dmgMul: 1.6 + 0.3 * L });
    if (!prop) return;
    let hits = 0;
    let age = 0;
    let slowT = 0;
    let steerT = 0;
    let goalP: V3 | null = null;
    const shatter = () => {
      if (!prop) return;
      const t = prop.body.translation();
      const r = this.area(2.2 + 0.3 * L + scale * 1.2);
      for (const e of g.enemies.list) {
        if (e.state === 'dead' || Math.hypot(e.x - t.x, e.z - t.z) > r) continue;
        this.hit(e, 8 + 3 * L + scale * 6);
        g.enemies.freeze(e, E ? 2.8 : 1.2 + 0.2 * L);
      }
      g.fx.shards({ x: t.x, y: t.y, z: t.z }, 0xf4f8ff, 18, 7, 0.35);
      g.fx.ring({ x: t.x, y: t.y, z: t.z }, 0.5, r, ZONE.ally, 0.4, 0.6);
      g.audio.freeze();
      g.world.removeProp(prop);
    };
    this.addTask({
      update: (dt) => {
        age += dt;
        if (!prop || !prop.alive || prop.dying >= 0) return false;
        const v = prop.body.linvel();
        const spd = Math.hypot(v.x, v.z);
        if (spd > 2) g.world.heat(prop, 1);
        if (spd > 0.5 && spd < 8) prop.body.applyImpulse({ x: (v.x / spd) * prop.mass * 3 * dt, y: 0, z: (v.z / spd) * prop.mass * 3 * dt }, true);
        // 敵の群れの方へ曲がる（離れた所で砕けないように）
        steerT -= dt;
        const tp = prop.body.translation();
        if (steerT <= 0) {
          steerT = 0.4;
          goalP = g.enemies.cluster(tp, 14);
        }
        if (goalP) {
          const gx = goalP.x - tp.x;
          const gz = goalP.z - tp.z;
          const gl = Math.hypot(gx, gz) || 1;
          prop.body.applyImpulse({ x: (gx / gl) * prop.mass * 6 * dt, y: 0, z: (gz / gl) * prop.mass * 6 * dt }, true);
        }
        // ひいた数だけ大きくする（物理の形は作り直す）
        if (prop.hits > hits && scale < maxScale) {
          hits = prop.hits;
          scale = Math.min(maxScale, scale + 0.12);
          const t = prop.body.translation();
          const av = prop.body.angvel();
          const old = prop;
          const half = old.half.y / old.scale;
          g.world.removeProp(old);
          const np = g.world.spawnProp('snowball', { x: t.x, y: t.y - half * scale, z: t.z }, 0, { vel: { x: v.x, y: v.y, z: v.z }, life: 9 - age, scale, hot: 9, dmgMul: 1.6 + 0.3 * L + scale });
          if (!np) return false;
          np.hits = hits;
          np.body.setAngvel(av, true);
          prop = np;
        }
        slowT = spd < 1.2 && age > 1 ? slowT + dt : 0;
        if (age > 7 || slowT > 0.6) {
          shatter();
          return false;
        }
        return true;
      },
    });
    g.audio.thud(0.5);
  }

  /** ピッチングマシン: 置いた場所から、近くの敵へ硬球を撃ち続ける。 */
  private pitching(s: SkillInst): void {
    const g = this.g;
    const L = s.level;
    const E = !!s.evolved;
    const p = g.player.pos;
    s.cd = this.cdOf(12);
    const n = 1 + (L >= 3 ? 1 : 0) + g.stats.amount;
    const life = E ? 14 : 11;
    const gap = E ? 0.16 : 0.75 - 0.08 * L;
    for (let i = 0; i < n; i++) {
      const a = g.player.yaw + Math.PI / 2 + (i - (n - 1) / 2) * 1.4;
      const mx = p.x + Math.sin(a) * 2.2;
      const mz = p.z + Math.cos(a) * 2.2;
      const my = g.world.groundY(mx, mz);
      const grp = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.55, 0.9), new THREE.MeshLambertMaterial({ color: 0x2f6fd0 }));
      body.position.y = 0.45;
      const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.9, 10), new THREE.MeshLambertMaterial({ color: 0xdedede }));
      tube.rotation.x = Math.PI / 2 - 0.35;
      tube.position.set(0, 0.85, 0.25);
      const legs = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.4, 6), new THREE.MeshLambertMaterial({ color: 0x555555 }));
      legs.position.y = 0.1;
      grp.add(body, tube, legs);
      grp.position.set(mx, my, mz);
      grp.traverse((o) => (o.castShadow = true));
      g.world.root.add(grp);
      let t = 0;
      let fire = 0.3 + i * 0.15;
      this.addTask({
        update: (dt) => {
          t += dt;
          if (t > life) return false;
          fire -= dt;
          if (fire > 0) return true;
          fire = gap;
          const from = { x: mx, y: my + 0.95, z: mz };
          const e = g.enemies.nearest(from, 22);
          if (!e) return true;
          grp.rotation.y = Math.atan2(e.x - mx, e.z - mz);
          const dx = e.x - mx;
          const dz = e.z - mz;
          const d = Math.hypot(dx, dz) || 1;
          const sp = 30;
          const ball = g.world.spawnProp('ball', { x: from.x + (dx / d) * 0.6, y: from.y - 0.17, z: from.z + (dz / d) * 0.6 }, 0, { vel: { x: (dx / d) * sp, y: Math.min(6, (e.y - from.y) * 2 + d * 0.12), z: (dz / d) * sp }, life: 2.5, scale: 1.1, hot: 2.5, dmgMul: 2.4 + 0.5 * L, spin: true });
          if (ball) g.audio.shoot();
          return true;
        },
        dispose: () => {
          grp.removeFromParent();
          grp.traverse((o) => {
            const m = o as THREE.Mesh;
            if (m.geometry) m.geometry.dispose();
          });
        },
      });
    }
  }

  /** かんしゃく玉地雷: まわりにまく。踏んだ敵は爆発で打ち上がる。 */
  private landmine(s: SkillInst): void {
    const g = this.g;
    const L = s.level;
    const E = !!s.evolved;
    s.cd = this.cdOf(E ? 3.5 : 4.6 - 0.2 * L);
    const p = g.player.pos;
    const n = (2 + Math.floor(L / 2) + g.stats.amount) * (E ? 2 : 1);
    for (let i = 0; i < n && this.mines.length < 48; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 3 + Math.random() * 7;
      const x = p.x + Math.cos(a) * r;
      const z = p.z + Math.sin(a) * r;
      const sp = this.sprite('🔴', 0.42);
      const gy = g.world.groundY(x, z);
      sp.position.set(x, gy + 0.2, z);
      this.mines.push({ x, z, gy, sp, arm: 0.5, life: 20, L, E, ctx: this.cur });
    }
    g.audio.pop();
  }

  private updateMines(dt: number): void {
    const g = this.g;
    for (let i = this.mines.length - 1; i >= 0; i--) {
      const m = this.mines[i];
      m.life -= dt;
      m.arm -= dt;
      let boom = false;
      if (m.arm <= 0) {
        for (const e of g.enemies.list) {
          if (e.state !== 'walk') continue;
          const dx = e.x - m.x;
          const dz = e.z - m.z;
          if (dx * dx + dz * dz < 1.3 && Math.abs(e.y - m.gy) < 2.5) {
            boom = true;
            break;
          }
        }
      }
      if (!boom && m.life > 0) continue;
      m.sp.removeFromParent();
      this.mines.splice(i, 1);
      if (!boom) continue;
      this.cur = m.ctx;
      const r = this.area(2.2 + 0.2 * m.L);
      const vy = (m.E ? 1.5 : 1) * (12 + 1.5 * m.L);
      for (const e of g.enemies.list) {
        if (e.state === 'dead' || Math.hypot(e.x - m.x, e.z - m.z) > r) continue;
        this.hit(e, 14 + 5 * m.L, undefined, false);
        g.enemies.launch(e, { x: (Math.random() - 0.5) * 3, y: vy * (0.8 + Math.random() * 0.3), z: (Math.random() - 0.5) * 3 });
      }
      g.fx.explosion({ x: m.x, y: m.gy + 0.3, z: m.z }, r * 0.7);
      g.fx.ring({ x: m.x, y: m.gy + 0.1, z: m.z }, 0.3, r, ZONE.ally, 0.3, 0.5);
      g.audio.explode(0.4);
    }
  }

  /** プールの排水口: 群れの足元から、少し遅れて水柱が噴き上がる。 */
  private geyser(s: SkillInst): void {
    const g = this.g;
    const L = s.level;
    const E = !!s.evolved;
    const p = g.player.pos;
    const first = this.aim(22);
    if (!first) {
      s.cd = 0.4;
      return;
    }
    s.cd = this.cdOf(E ? 4 : 5 - 0.25 * L);
    const spots: V3[] = [first];
    if (E) {
      for (let k = 0; k < 2; k++) {
        const e = g.enemies.list[Math.floor(Math.random() * g.enemies.list.length)];
        if (e && e.state !== 'dead' && Math.hypot(e.x - p.x, e.z - p.z) < 22) spots.push({ x: e.x, y: 0, z: e.z });
      }
    }
    const r = this.area(2.6 + 0.25 * L);
    for (const sp of spots) {
      const gy = g.world.groundY(sp.x, sp.z);
      g.fx.ring({ x: sp.x, y: gy + 0.1, z: sp.z }, r * 0.9, r, ZONE.ally, 1.2, 0.7);
      let t = 0;
      let shots = E ? 2 : 1;
      let next = 1.2;
      this.addTask({
        update: (dt) => {
          t += dt;
          if (t < next) {
            if (Math.random() < dt * 20) g.fx.spawn({ pos: { x: sp.x + (Math.random() - 0.5) * r, y: gy + 0.1, z: sp.z + (Math.random() - 0.5) * r }, vel: { x: 0, y: 2, z: 0 }, life: 0.4, size: 0.2, size2: 0.05, color: 0x9fd8ff, shape: 0, alpha: 0.8 });
            return true;
          }
          for (const e of g.enemies.list) {
            if (e.state === 'dead' || Math.hypot(e.x - sp.x, e.z - sp.z) > r) continue;
            this.hit(e, 12 + 5 * L);
            g.enemies.wetIt(e, 4);
            g.enemies.launch(e, { x: (Math.random() - 0.5) * 2, y: 14 + 1.5 * L, z: (Math.random() - 0.5) * 2 });
          }
          for (let k = 0; k < 26; k++) {
            g.fx.spawn({ pos: { x: sp.x + (Math.random() - 0.5) * r * 0.8, y: gy + 0.2, z: sp.z + (Math.random() - 0.5) * r * 0.8 }, vel: { x: (Math.random() - 0.5) * 3, y: 12 + Math.random() * 8, z: (Math.random() - 0.5) * 3 }, life: 0.9, size: 0.5, size2: 0.9, color: 0xcfeeff, color2: 0x6fb8ff, shape: 0, alpha: 0.85 });
          }
          g.fx.element({ x: sp.x, y: gy + 1, z: sp.z }, 'water', 1.6);
          g.audio.splash(1);
          shots--;
          next = t + 0.8;
          return shots > 0;
        },
      });
    }
  }

  /** 段ボールの砦: 敵の通り道に箱を積んで壁にする。崩れた箱は敵にぶつかる。 */
  private cardboard(s: SkillInst): void {
    const g = this.g;
    const L = s.level;
    const E = !!s.evolved;
    const p = g.player.pos;
    const goal = g.enemies.cluster(p, 20);
    if (!goal) {
      s.cd = 0.4;
      return;
    }
    s.cd = this.cdOf(E ? 7 : 8.5 - 0.35 * L);
    const a = Math.atan2(goal.x - p.x, goal.z - p.z);
    const fx = Math.sin(a);
    const fz = Math.cos(a);
    const dist = Math.min(6, Math.hypot(goal.x - p.x, goal.z - p.z) * 0.5 + 1.5);
    const cx = p.x + fx * dist;
    const cz = p.z + fz * dist;
    const cols = (E ? 5 : 4) + Math.floor(L / 2);
    // 自販機の砦は、USDCraft の自販機（無ければ前の自販機）
    const id = E ? (PROPS.u_vending ? 'u_vending' : 'vending') : 'cardbox';
    const w = E ? PROPS[id].fallback[0] + 0.05 : 0.62 * this.g.stats.area;
    const rows = E ? 1 : 2 + (L >= 4 ? 1 : 0);
    const scale = E ? 1 : 1.05 * Math.sqrt(this.g.stats.area);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const o = (c - (cols - 1) / 2) * w + (r % 2 ? w * 0.5 : 0);
        const x = cx + fz * o;
        const z = cz - fx * o;
        const y = g.world.groundY(x, z) + r * 0.52 * scale + 0.02;
        const box = g.world.spawnProp(id, { x, y, z }, a, { life: 14, scale, hot: 14, dmgMul: E ? 2 : 1.2 + 0.2 * L, sleep: true });
        // 砦の自販機は壊れない（壊すと缶とコインが出る自販機なので、コインを稼げないように）
        if (box && E) box.hp = Infinity;
      }
    }
    g.fx.dust({ x: cx, y: g.world.groundY(cx, cz) + 0.2, z: cz }, 1.6, 0xc8a070, 6);
    g.audio.thud(0.6);
  }

  /** 呪いの付箋: 貼った敵から、近くの敵へ雷を飛ばし続ける。宿主が倒れると貼り替わる。 */
  private brand(s: SkillInst): void {
    const g = this.g;
    const L = s.level;
    const E = !!s.evolved;
    const p = g.player.pos;
    const c = g.enemies.list.filter((e) => e.state !== 'dead' && !e.cd?.get('brand') && Math.hypot(e.x - p.x, e.z - p.z) < 20);
    if (!c.length) {
      s.cd = 0.4;
      return;
    }
    s.cd = this.cdOf(E ? 3.5 : 4.5 - 0.2 * L);
    const n = (1 + Math.floor(L / 2) + g.stats.amount) * (E ? 2 : 1);
    const gap = 0.6 - 0.05 * L;
    for (let i = 0; i < n && c.length; i++) {
      let host: Enemy = c.splice(Math.floor(Math.random() * c.length), 1)[0];
      (host.cd ??= new Map()).set('brand', 99);
      const sp = this.sprite('📝', 0.55);
      let t = 0;
      let zap = 0.2;
      this.addTask({
        update: (dt) => {
          t += dt;
          if (t > (E ? 10 : 8)) return false;
          if (!host.alive || host.state === 'dead') {
            // 次の宿主へ貼り替える
            const next = g.enemies.nearest({ x: host.x, y: host.y, z: host.z }, 9, (o) => o === host || !!o.cd?.get('brand'));
            if (!next) return false;
            host = next;
            (host.cd ??= new Map()).set('brand', 99);
            g.fx.bolt({ x: sp.position.x, y: sp.position.y, z: sp.position.z }, { x: host.x, y: host.y + host.halfH + 0.6, z: host.z }, 0xffe14d, 0.18, 0.4, 0.12);
          }
          sp.position.set(host.x, host.y + host.halfH + host.radius + 0.55, host.z);
          zap -= dt;
          if (zap <= 0) {
            zap = gap;
            const tgt = g.enemies.nearest({ x: host.x, y: host.y, z: host.z }, 7, (o) => o === host);
            const to = tgt ?? host;
            g.fx.bolt({ x: host.x, y: host.y + host.halfH + 0.5, z: host.z }, { x: to.x, y: to.y, z: to.z }, 0xffe14d, 0.16, 0.5, 0.1);
            this.hit(to, 8 + 3 * L, undefined, false);
            if (E && to.alive) {
              to.burn = Math.max(to.burn, 2);
              to.burnDps = Math.max(to.burnDps, 6 + g.ap * 0.1);
            }
          }
          return true;
        },
        dispose: () => {
          sp.removeFromParent();
          host.cd?.delete('brand');
        },
      });
    }
    g.audio.thunder();
  }

  /** 全校集会の号令: 範囲にいる敵が多いほど強い衝撃波。 */
  private gourei(s: SkillInst): void {
    const g = this.g;
    const L = s.level;
    const E = !!s.evolved;
    const p = g.player.pos;
    const r = this.area((5 + 0.4 * L) * (E ? 1.6 : 1));
    const inside: Enemy[] = [];
    for (const e of g.enemies.list) if (e.state !== 'dead' && Math.hypot(e.x - p.x, e.z - p.z) < r) inside.push(e);
    if (!inside.length) {
      s.cd = 0.3;
      return;
    }
    s.cd = this.cdOf(4.8 - 0.2 * L);
    const per = E ? 0.15 : 0.08 + 0.01 * L;
    const mult = Math.min(7, 1 + per * inside.length);
    for (const e of inside) {
      const dx = e.x - p.x;
      const dz = e.z - p.z;
      const d = Math.hypot(dx, dz) || 1;
      this.hit(e, (12 + 4 * L) * mult, { x: (dx / d) * 7, y: 6, z: (dz / d) * 7 });
    }
    g.fx.ring({ x: p.x, y: p.y + 0.1, z: p.z }, 0.5, r, ZONE.ally, 0.45, 0.7);
    g.fx.ring({ x: p.x, y: p.y + 0.1, z: p.z }, 0.3, r * 0.6, ZONE.ally, 0.3, 0.5);
    g.fx.shake(mult > 3 ? 'M' : 'S');
    g.audio.shout();
    if (inside.length >= 20) this.comboLog('gourei.many', { n: inside.length, mult: Math.round(mult * 10) / 10 });
  }

  /** がまんの限界: 受けたダメージをためて、たまったら前方（進化後はまわり全体）へトゥルーダメージで吐き出す。 */
  private gaman(s: SkillInst): void {
    const g = this.g;
    const L = s.level;
    const E = !!s.evolved;
    const st = s.st;
    // ダメージを受けなくても、毎秒 4 ずつたまる
    st.store = (st.store ?? 0) + 4 * 0.25;
    s.cd = 0.25;
    const need = 60 + 8 * L;
    const p = g.player.pos;
    if (st.store >= need * 0.8 && Math.random() < 0.3) g.fx.sparkle({ x: p.x, y: p.y + 1.4, z: p.z }, 0xff5050, 2, 0.5);
    if (st.store < need) return;
    if (!g.enemies.nearest(p, 9)) return;
    const dmg = st.store * (1.5 + 0.25 * L);
    st.store = 0;
    s.cd = this.cdOf(1.5);
    const r = this.area(8 + 0.5 * L);
    const f = this.forward();
    let n = 0;
    for (const e of g.enemies.list) {
      if (e.state === 'dead') continue;
      const dx = e.x - p.x;
      const dz = e.z - p.z;
      const d = Math.hypot(dx, dz) || 1;
      if (d > r) continue;
      if (!E && (dx * f.x + dz * f.z) / d < 0.5) continue;
      this.hit(e, dmg, { x: (dx / d) * 12, y: 5, z: (dz / d) * 12 });
      n++;
    }
    g.fx.ring({ x: p.x, y: p.y + 0.1, z: p.z }, 0.5, r, ZONE.ally, 0.4, 0.8);
    g.fx.flash('boom');
    g.fx.shake('M');
    g.audio.shout();
    g.player.emote('smug', 1.2);
    log('skill.gaman', { dmg: Math.round(dmg), n }, { time: Math.round(g.time) });
  }

  /** ノリコがダメージを受けたとき（がまんの限界にためる）。raw は防御で減らす前。 */
  onPlayerHurt(raw: number): void {
    this.third.onPlayerHurt();
    const s = this.get('gaman');
    if (!s) return;
    s.st.store = (s.st.store ?? 0) + raw * (0.8 + 0.1 * s.level) * (s.evolved ? 1.5 : 1);
  }

  /** 敵が倒れたときに呼ばれる（バイオハザード: 毒で倒れた敵から霧が噴き出す）。 */
  onEnemyKilled(e: Enemy, src: string): void {
    this.more.onEnemyKilled(e, src);
    this.third.onEnemyKilled(e);
    if (src !== 'poison') return;
    const s = this.get('bio');
    if (!s?.evolved) return;
    this.addCloud(e.x, e.z, this.area(1.8), 3.5, 22);
  }

  /**
   * スキルを 1 回動かす。限界突破の範囲・待ち時間・数は、動かしている間だけ能力値に掛ける
   * （どのスキルも能力値を見て範囲や数を決めているので、ここで掛ければ全部に効く）。
   */
  private run(s: SkillInst, h: Handler, dt: number): void {
    const st = this.g.stats;
    const bm = s.bm;
    this.cur = s.ctx ?? SKILL_MAP[s.id]?.dmg ?? null;
    if (!bm) {
      h(s, dt);
      return;
    }
    const a0 = st.area;
    const c0 = st.cooldown;
    const n0 = st.amount;
    st.area = a0 * bm.area;
    st.cooldown = c0 * bm.cd;
    st.amount = n0 + bm.amt;
    try {
      h(s, dt);
    } finally {
      st.area = a0;
      st.cooldown = c0;
      st.amount = n0;
    }
  }

  // ---------------------------------------------------------------- 更新
  update(dt: number): void {
    const g = this.g;
    if (this.boomCd > 0) this.boomCd -= dt;
    if (this.slashCd > 0) this.slashCd -= dt;
    if (!g.player.dead) {
      const echo = g.ip('cassette');
      for (const s of this.actives) {
        const h = this.handlers[s.id];
        if (!h) continue;
        if (CONTINUOUS.has(s.id)) {
          this.run(s, h, dt);
          continue;
        }
        s.cd -= dt;
        if (s.cd <= 0) {
          this.run(s, h, dt);
          // 三色ボールペン: 本当に撃ったとき（待ち時間が長く設定されたとき）
          if (s.cd > 0.5) g.itemFx.onSkillCast();
          // カセットテープ: ときどき、もう一度発動する（待ち時間が 0.2 秒より長く設定されたとき＝本当に撃ったとき）
          if (echo > 0 && s.cd > 0.5 && s.id !== 'gaman' && Math.random() < 0.2 * Math.min(2, echo)) this.echoes.push({ s, t: 0.3 });
        }
      }
      for (let i = this.echoes.length - 1; i >= 0; i--) {
        const ec = this.echoes[i];
        ec.t -= dt;
        if (ec.t > 0) continue;
        this.echoes.splice(i, 1);
        const h = this.handlers[ec.s.id];
        if (!h || !this.actives.includes(ec.s)) continue;
        const keep = ec.s.cd;
        this.run(ec.s, h, 0);
        ec.s.cd = keep;
        this.comboLog('echo', { id: ec.s.id });
      }
    }
    if (this.mines.length) this.updateMines(dt);
    this.cur = SKILL_MAP.bio?.dmg ?? null;
    if (this.clouds.length || this.cloudMesh) this.updateClouds(dt);
    if (this.peels.length) this.updatePeels(dt);
    if (this.alarms.length) this.updateAlarms(dt);
    if (this.tramps.length) this.updateTramps(dt);
    this.more.update(dt);
    this.usd.update();
    this.third.update(dt);
    for (let i = this.tasks.length - 1; i >= 0; i--) {
      const t = this.tasks[i];
      let alive = false;
      this.cur = t.ctx ?? null;
      try {
        alive = t.update(dt);
      } catch (err) {
        log('exception.skill', { message: String(err) }, { stack: (err as Error).stack ?? null });
      }
      if (!alive) {
        t.dispose?.();
        this.tasks.splice(i, 1);
      }
    }
  }

  dispose(): void {
    this.more.dispose();
    this.usd.dispose();
    this.third.dispose();
    for (const t of this.tasks) t.dispose?.();
    this.tasks.length = 0;
    for (const p of this.peels) p.sp.removeFromParent();
    this.peels.length = 0;
    for (const m of this.mines) m.sp.removeFromParent();
    this.mines.length = 0;
    this.echoes.length = 0;
    for (const a of this.alarms) a.sp.removeFromParent();
    this.alarms.length = 0;
    for (const t of [...this.tramps]) this.removeTramp(t);
    this.clouds.length = 0;
    if (this.cloudMesh) {
      this.cloudMesh.removeFromParent();
      this.cloudMesh.geometry.dispose();
      (this.cloudMesh.material as THREE.Material).dispose();
      this.cloudMesh = null;
    }
    for (const s of this.actives) {
      const st = s.st;
      st.objs?.forEach((o: THREE.Object3D) => o.removeFromParent());
      st.cats?.forEach((c: { sp: THREE.Sprite }) => c.sp.removeFromParent());
      this.dropBots(st.bots);
      if (st.balls) this.dropFlail(st);
      st.clones?.forEach((c: { rig: NorikoRig; ctx: SwingCtx }) => {
        if (c.ctx.trail) this.g.fx.removeTrail(c.ctx.trail);
        c.rig.dispose();
      });
    }
    void UPV;
  }
}
