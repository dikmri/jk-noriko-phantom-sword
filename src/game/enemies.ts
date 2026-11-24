import * as THREE from 'three';
import type { Bond } from './skillsThird';
import { G, groups, RAPIER } from '../core/physics';
import { V3 } from '../core/vec';
import { log } from '../log';
import { emojiSprite } from '../core/assets';
import { DmgKind, ELITES, EliteKind, ENEMIES, ENEMY_MODEL_ASSET, EnemyBehavior, EnemyDef, enemyDmgScale, enemyHpScale, TUNE } from './defs';
import { MoreEnemies } from './enemiesMore';
import { mitigate } from './rules';
import { SH, ZONE } from './fx';
import type { Game } from './game';
import { ARENA } from './world';

export type DamageSource = 'weapon' | 'skill' | 'chain' | 'slam' | 'explosion' | 'prop' | 'burn' | 'poison' | 'bleed' | 'fall' | 'drown' | 'traffic';

/** ダメージの出どころから決まる、ふだんの種類。 */
function kindOf(src: DamageSource): DmgKind {
  if (src === 'weapon' || src === 'bleed') return 'phys';
  if (src === 'chain' || src === 'slam' || src === 'prop' || src === 'fall' || src === 'drown' || src === 'traffic') return 'impact';
  return 'magic';
}

export interface Enemy {
  def: EnemyDef;
  body: RAPIER.RigidBody;
  col: RAPIER.Collider;
  hp: number;
  maxHp: number;
  scale: number;
  radius: number;
  halfH: number;
  mass: number;
  state: 'walk' | 'knock' | 'dead' | 'held';
  /** 状態の残り時間 */
  t: number;
  frozen: number;
  yaw: number;
  phase: number;
  flash: number;
  atkCd: number;
  ai: number;
  aiState: number;
  dirX: number;
  dirZ: number;
  seed: number;
  stuck: number;
  sidestep: number;
  prevSpeed: number;
  x: number;
  y: number;
  z: number;
  /** 武器の同じ振りで二重に当たらないための記録 */
  lastSwing: number;
  lastSwingT: number;
  cd: Map<string, number> | null;
  burn: number;
  burnDps: number;
  /** 毒の残り秒数と、毎秒のダメージ（妄想バイオ） */
  poison: number;
  poisonDps: number;
  /** ぬれている残り秒数（水風船・牛乳・池）。雷が伝わりやすく、長く凍る */
  wet: number;
  fuse: number;
  stopShake: number;
  /** 他の敵にぶつけられて吹き飛んでいる（倒れたら「巻き込み」として数える） */
  chained: boolean;
  stagger: number;
  telegraph: number;
  alive: boolean;
  /** 体当たり・弾・自爆の強さ（時間と難易度で上がる） */
  dmg: number;
  /** 歩く速さ（難易度とエリートを反映） */
  speed: number;
  elite: EliteKind | null;
  /** ボスの行動で使う作業用の値 */
  w: Record<string, number>;
  /** 物理防御・魔法防御 */
  armor: number;
  mr: number;
  /** 防御を下げられている割合と残り秒数（酸性雨・わら人形） */
  shredA: number;
  shredAT: number;
  shredM: number;
  shredMT: number;
  /** 出血（物理の継続ダメージ） */
  bleed: number;
  bleedDps: number;
  /** 居残りの刑: 残り秒数・その間に受けたダメージ・追加で受ける割合 */
  markT: number;
  markAcc: number;
  markPct: number;
  /** 遅くなっている割合と残り秒数（かき氷シロップ・体育教師の笛） */
  slow: number;
  slowT: number;
  /** びっくり箱: 怖がっている残り秒数と、驚いた場所。scared は「受けるダメージ +30%」が続く時刻（お化け屋敷） */
  fear?: number;
  fearX?: number;
  fearZ?: number;
  scared?: number;
  /** 連帯責任でつながったまとまり */
  bond?: Bond | null;
  /** 生活指導の「こらーっ！」: ノリコへ向かってくる残り秒数 */
  taunt?: number;
  /** 赤点の答案: 受けるダメージが増える時刻 */
  akaten?: number;
  /** 画面に出す名前（エンドレスで強くなったラスボス） */
  title?: string;
  /** 黒板消しはたき: ふらふら歩く（目をこすっている）時刻まで */
  daze?: number;
}

/** 2 面・3 面の敵の行動（enemiesMore.ts） */
const MORE_BEHAVIORS = new Set<EnemyBehavior>(['roomba', 'roombaq', 'drone', 'vending', 'vendking', 'blink', 'ninjaboss', 'cheer', 'cheerboss', 'tankbear', 'chimera3']);

const SIZE: Record<string, { r: number; hh: number }> = {
  pervert: { r: 0.32, hh: 0.5 },
  terrorist: { r: 0.33, hh: 0.5 },
  bear: { r: 0.52, hh: 0.42 },
  tank: { r: 1.45, hh: 0.1 },
  heli: { r: 1.3, hh: 0.35 },
  robovac: { r: 0.17, hh: 0.01 },
  vending: { r: 0.3, hh: 0.5 },
  drone: { r: 0.14, hh: 0.01 },
};
const FALLBACK: Record<string, [number, number, number, number]> = {
  pervert: [0.6, 1.7, 0.4, 0xc9b28a],
  terrorist: [0.6, 1.7, 0.4, 0x4c5a3a],
  bear: [1.0, 1.9, 0.8, 0x7a4a2a],
  tank: [3.2, 2.2, 5.0, 0x787f54],
  heli: [2.0, 2.4, 5.0, 0xc8b68c],
  robovac: [0.34, 0.1, 0.34, 0x333333],
  vending: [0.6, 1.6, 0.6, 0xc03030],
  drone: [0.32, 0.09, 0.24, 0x888888],
};
const CAP = 280;
/** 歩いている敵がぶつかる相手。吹き飛んでいる間は柵（RAIL）を越える */
const ENEMY_FILTER = G.STATIC | G.CHUNK | G.PROP | G.ENEMY | G.PLAYER | G.DEBRIS | G.RAIL | G.FLAIL;
const FLYING_FILTER = ENEMY_FILTER & ~G.RAIL;
/** ヘリは建物をすり抜ける（高いところを飛ぶので、引っかかって止まらないように） */
const HELI_FILTER = G.STATIC | G.PROP | G.DEBRIS | G.ENEMY | G.FLAIL;
const m4 = new THREE.Matrix4();
const pos = new THREE.Vector3();
const quat = new THREE.Quaternion();
const quat2 = new THREE.Quaternion();
const scl = new THREE.Vector3();
const off = new THREE.Vector3();
const col = new THREE.Color();
const AX_Y = new THREE.Vector3(0, 1, 0);
const AX_Z = new THREE.Vector3(0, 0, 1);

/** ボスの体力を決める時刻の上限。三巨頭が長引いてラスボスが遅れて出ても、ラスボスがさらに硬くならないようにする */
const BOSS_HP_TIME = 640;

/** 射撃する敵の aiState: 撃つ順番を予約済み */
const SHOT_BOOKED = 5;

export class EnemyManager {
  list: Enemy[] = [];
  bosses: Enemy[] = [];
  private meshes: Record<string, THREE.InstancedMesh> = {};
  private counts: Record<string, number> = {};
  /** 全体の時間停止の残り秒数 */
  timeStop = 0;
  timeStopBonus = 1;
  /** 次に敵が射撃してよい時刻（ゲーム内の秒）。射撃の順番の予約に使う */
  private nextShotT = 0;
  /** 敵を引きつける場所（鳴っている目覚まし時計） */
  lures: { x: number; z: number; r: number }[] = [];
  /** 地面を伝わる輪（森のヌシ・ラスボスの着地） */
  private waves: { x: number; z: number; r: number; max: number; speed: number; dmg: number; by: string; hit: boolean }[] = [];
  /** 落ちてくる砲弾・爆弾（着弾点に赤い円を出す） */
  private shells: { from: V3; to: V3; t: number; T: number; h: number; r: number; dmg: number; by: string; sp: THREE.Sprite; mark: number; element?: 'fire' }[] = [];
  private rotor: THREE.InstancedMesh;
  /** 2 面・3 面の敵の行動 */
  private more: MoreEnemies;

  constructor(private g: Game) {
    this.more = new MoreEnemies(g, this);
    for (const [model, asset] of Object.entries(ENEMY_MODEL_ASSET)) {
      const mm = g.assets.model(asset);
      const mesh = new THREE.InstancedMesh(mm.geo, new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: g.assets.toonRamp }), CAP);
      mesh.count = 0;
      mesh.castShadow = true;
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.setColorAt(0, col.setRGB(1, 1, 1));
      g.world.root.add(mesh);
      this.meshes[model] = mesh;
    }
    this.rotor = new THREE.InstancedMesh(new THREE.BoxGeometry(7.4, 0.05, 0.32), new THREE.MeshLambertMaterial({ color: 0x2a2a2e }), 16);
    this.rotor.count = 0;
    this.rotor.frustumCulled = false;
    g.world.root.add(this.rotor);
  }

  static fallback(model: string): [number, number, number, number] {
    return FALLBACK[model];
  }

  spawn(id: string, x: number, z: number, y?: number, elite: EliteKind | null = null): Enemy | null {
    const g = this.g;
    if (this.list.length >= CAP - 4) return null;
    const def = ENEMIES[id];
    if (!def) return null;
    if (def.boss) elite = null;
    const em = elite ? ELITES[elite] : null;
    const diff = g.diff;
    const scale = def.scale * (def.boss ? 1 : g.rule.enemyScale) * (em?.scale ?? 1);
    const sz = SIZE[def.model];
    const radius = sz.r * scale;
    const halfH = sz.hh * scale;
    const foe = g.foe;
    const hp = def.hp * enemyHpScale(def.boss ? Math.min(g.time, BOSS_HP_TIME) : g.time) * (def.boss ? diff.bossHp * foe.bossHp : g.rule.enemyHp * diff.hp * foe.hp) * (em?.hp ?? 1);
    const mass = def.mass * (def.boss ? 1 : g.rule.enemyScale * g.rule.enemyScale) * (em?.mass ?? 1);
    const flyer = def.behavior === 'heli' || def.behavior === 'carrier';
    const gy = g.world.groundY(x, z);
    if (flyer) y = gy + 7;
    const w = g.physics.world;
    const body = w.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y ?? gy + halfH + radius + 0.05, z).setLinearDamping(0.15).setAngularDamping(1.2).lockRotations(),
    );
    const c = w.createCollider(
      RAPIER.ColliderDesc.capsule(halfH, radius).setMass(mass).setFriction(0.35 * g.rule.friction).setRestitution(0.15).setCollisionGroups(groups(G.ENEMY, flyer ? HELI_FILTER : ENEMY_FILTER)),
      body,
    );
    if (flyer) body.setGravityScale(0, true);
    const e: Enemy = {
      def, body, col: c, hp, maxHp: hp, scale, radius, halfH, mass, state: 'walk', t: 0, frozen: 0, yaw: 0, phase: Math.random() * 6, flash: 0,
      atkCd: 0.6, ai: 1.5 + Math.random() * 2, aiState: 0, dirX: 0, dirZ: 1, seed: Math.random() * 100, stuck: 0, sidestep: 0, prevSpeed: 0,
      x, y: y ?? gy + halfH + radius, z, lastSwing: -1, lastSwingT: -10, cd: null, burn: 0, burnDps: 0, poison: 0, poisonDps: 0, wet: 0, fuse: -1, stopShake: 0, chained: false, stagger: 0, telegraph: 0, alive: true,
      dmg: def.damage * enemyDmgScale(g.time) * diff.dmg * foe.dmg * (em?.dmg ?? 1), speed: def.speed * diff.speed * (em?.speed ?? 1), elite, w: {},
      armor: def.armor + (em?.armor ?? 0), mr: def.mr + (em?.mr ?? 0), shredA: 0, shredAT: 0, shredM: 0, shredMT: 0, bleed: 0, bleedDps: 0, markT: 0, markAcc: 0, markPct: 0, slow: 0, slowT: 0,
    };
    g.physics.register(c, { kind: 'enemy', ref: e });
    this.list.push(e);
    if (def.boss) this.bosses.push(e);
    return e;
  }

  /** プレイヤーのまわりの、建物に重ならない位置に出す。 */
  spawnAround(id: string, minR = 24, maxR = 34, elite: EliteKind | null = null): Enemy | null {
    const g = this.g;
    const p = g.player.pos;
    for (let i = 0; i < 6; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = minR + Math.random() * (maxR - minR);
      const x = Math.max(-ARENA + 2, Math.min(ARENA - 2, p.x + Math.cos(a) * r));
      const z = Math.max(-ARENA + 2, Math.min(ARENA - 2, p.z + Math.sin(a) * r));
      if (Math.hypot(x - p.x, z - p.z) < minR * 0.7) continue;
      if (!g.world.spawnOk(x, z)) continue;
      let blocked = false;
      g.physics.querySphere({ x, y: g.world.groundY(x, z) + 1.2, z }, 1.0, G.CHUNK | G.STATIC | G.PROP, () => {
        blocked = true;
      });
      if (!blocked) return this.spawn(id, x, z, undefined, elite);
    }
    return null;
  }

  // ---------------------------------------------------------------- ダメージ
  /**
   * 敵にダメージを与える。impulse は吹き飛ばす向きと強さ（60kg の相手に与える速度変化）。
   * 戻り値: 倒したら true。
   */
  /** いまの物理防御・魔法防御（下げられている分を引いた値）。 */
  armorOf(e: Enemy): number {
    return e.armor * (1 - (e.shredAT > 0 ? e.shredA : 0));
  }

  mrOf(e: Enemy): number {
    return e.mr * (1 - (e.shredMT > 0 ? e.shredM : 0));
  }

  /** 防御を下げる（酸性雨・わら人形）。 */
  shred(e: Enemy, armorPct: number, mrPct: number, sec: number): void {
    if (armorPct > 0) {
      e.shredA = Math.max(e.shredAT > 0 ? e.shredA : 0, armorPct);
      e.shredAT = Math.max(e.shredAT, sec);
    }
    if (mrPct > 0) {
      e.shredM = Math.max(e.shredMT > 0 ? e.shredM : 0, mrPct);
      e.shredMT = Math.max(e.shredMT, sec);
    }
  }

  /** 遅くする（強い方が残る）。 */
  slowIt(e: Enemy, pct: number, sec: number): void {
    if (!e.alive || e.state === 'dead') return;
    e.slow = Math.max(e.slowT > 0 ? e.slow : 0, Math.min(0.7, pct));
    e.slowT = Math.max(e.slowT, sec);
  }

  /** 出血させる（重ねると、長い方・強い方が残る）。 */
  bleedIt(e: Enemy, sec: number, dps: number): void {
    if (!e.alive || e.state === 'dead') return;
    e.bleed = Math.max(e.bleed, sec);
    e.bleedDps = Math.max(e.bleedDps, dps);
  }

  /**
   * 敵にダメージを与える。kind を省くと、出どころ（src）から決まる種類になる。
   * 防御（貫通・防御低下を含む）・衝撃の倍率・アイテムの効果をここでまとめて掛ける。
   */
  damage(e: Enemy, amount: number, src: DamageSource, opts: { impulse?: V3; crit?: boolean; quiet?: boolean; kind?: DmgKind; noCharge?: boolean } = {}): boolean {
    const g = this.g;
    if (!e.alive || e.state === 'dead') {
      if (e.alive && opts.impulse) this.push(e, opts.impulse);
      return false;
    }
    let kind = opts.kind ?? kindOf(src);
    // 錬金術の本（物理 → 魔法）・筋肉で解決（魔法 → 物理）
    if (kind === 'phys' && g.hasItem('renkin')) kind = 'magic';
    else if (kind === 'magic' && g.hasItem('kinniku')) kind = 'phys';
    const st = g.stats;
    const armor = this.armorOf(e);
    const mr = this.mrOf(e);
    let dmg = amount * g.rule.dealt * mitigate(kind, armor, mr, st.armorPen, st.magicPen);
    if (kind === 'impact') dmg *= st.impactMul * g.pinsMul();
    if (src === 'slam') dmg *= st.slamMul;
    if (kind !== 'true' && g.hasItem('tenbin')) dmg *= 1 + ((kind === 'magic' ? mr : armor) / 100) * 0.25 * g.ip('tenbin');
    if (e.bleed > 0) {
      if (g.hasItem('cutter')) dmg *= 1 + 0.3 * g.ip('cutter');
      if (g.skills.get('carve')?.evolved) dmg *= 1.5;
    }
    if (kind === 'magic' && g.hasItem('wara')) this.shred(e, 0, Math.min(0.6, 0.3 * g.ip('wara')), 4);
    // リトマス試験紙: スキルの攻撃が当たると、魔法防御 -20%
    if (src === 'skill' && g.hasItem('litmus')) this.shred(e, 0, Math.min(0.6, 0.2 * g.ip('litmus')), 4);
    if (e.frozen > 0) dmg *= 1.5;
    if (this.timeStop > 0) dmg *= this.timeStopBonus;
    // ゼロ距離: ノリコの近くの敵ほど痛い
    const zk = g.ip('zerokyori');
    if (zk > 0) {
      const d = Math.hypot(e.x - g.player.pos.x, e.z - g.player.pos.z);
      dmg *= d < 4 ? 1 + 0.4 * zk : d > 12 ? 0.8 : 1 + 0.4 * zk - ((d - 4) / 8) * (0.2 + 0.4 * zk);
    }
    // 優勝トロフィー・番狂わせ・陰口・お化け屋敷
    dmg *= g.itemFx.dealtMul(e);
    e.hp -= dmg;
    // 連帯責任: つながったほかの敵にも分ける
    if (e.bond) g.skills.third.onBond(e, dmg);
    if (opts.crit) g.itemFx.onCrit(e);
    if (src === 'skill' || src === 'weapon') g.itemFx.onHitAny(e, dmg, src);
    // 当たったときに働くアイテム
    if (kind === 'phys') {
      const nk = g.ip('noko');
      if (nk > 0) {
        const cur = e.shredAT > 0 ? e.shredA : 0;
        e.shredA = Math.max(cur, Math.min(0.36 * Math.min(1.5, nk), cur + 0.06 * nk));
        e.shredAT = Math.max(e.shredAT, 5);
      }
    } else if (kind === 'magic') {
      const kg = g.ip('kakigori');
      if (kg > 0) this.slowIt(e, Math.min(0.75, 0.35 * kg), 1.5);
      const bn = g.ip('burner');
      if (bn > 0) {
        e.burn = Math.max(e.burn, 3);
        e.burnDps = Math.max(e.burnDps, e.maxHp * (e.def.boss ? 0.0025 : 0.01) * bn);
      }
    }
    if (!opts.noCharge && (src === 'skill' || src === 'weapon')) g.addCharge();
    e.flash = 0.11;
    g.run.damage += dmg;
    if (e.markT > 0) e.markAcc += dmg;
    g.lifesteal(dmg);
    if (!opts.quiet && dmg >= 0.5) {
      g.fx.number({ x: e.x, y: e.y + e.halfH + e.radius + 0.3, z: e.z }, String(Math.max(1, Math.round(dmg))), opts.crit ? 'crit' : kind);
    }
    if (opts.impulse) this.push(e, opts.impulse);
    // 退学届: 体力が 12% を切った敵（ボス以外）は、その場で倒れる
    if (e.hp > 0 && !e.def.boss && e.hp < e.maxHp * 0.12 * Math.min(2.2, g.ip('taigaku'))) {
      g.fx.number({ x: e.x, y: e.y + e.halfH + e.radius + 0.7, z: e.z }, '退学', 'true');
      e.hp = 0;
    }
    if (e.hp <= 0) {
      const over = -e.hp;
      this.kill(e, src);
      // 八つ当たり: 余ったダメージを近くの敵へ
      g.itemFx.onOverkill(e, over);
      return true;
    }
    return false;
  }

  /** 吹き飛ばす。重い敵ほど動きにくい。大きく動かされたら転がる状態になる。 */
  push(e: Enemy, impulse: V3, chained = false): void {
    if (!e.alive) return;
    const k = Math.pow(60 / Math.max(20, e.mass), 0.7) * this.g.rule.knock;
    let dx = impulse.x * k;
    let dy = impulse.y * k;
    let dz = impulse.z * k;
    const mag = Math.hypot(dx, dy, dz);
    if (mag > 46) {
      const s = 46 / mag;
      dx *= s; dy *= s; dz *= s;
    }
    const v = e.body.linvel();
    e.body.setLinvel({ x: v.x + dx, y: Math.max(v.y, 0) + dy, z: v.z + dz }, true);
    if (e.state === 'held') return;
    if (mag >= 2.2 && !e.def.boss) {
      if (e.state === 'walk') {
        e.body.lockRotations(false, true);
        e.col.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
        e.col.setCollisionGroups(groups(G.ENEMY, FLYING_FILTER));
        e.state = 'knock';
        e.chained = chained;
        e.w.peak = e.y;
        if (this.g.hasItem('rubber')) e.col.setRestitution(0.85);
        if (this.g.hasItem('wax') && e.frozen <= 0) e.col.setFriction(0.03);
        else if (this.g.hasItem('sori') && e.frozen <= 0) e.col.setFriction(0.08);
      }
      if (e.state !== 'dead') e.t = Math.max(e.t, Math.min(1.3, 0.3 + mag * 0.055));
      e.body.setAngvel({ x: dz * 0.7 + (Math.random() - 0.5) * 4, y: (Math.random() - 0.5) * 6, z: -dx * 0.7 + (Math.random() - 0.5) * 4 }, true);
      e.prevSpeed = Math.hypot(v.x + dx, v.y + dy, v.z + dz);
    } else {
      e.stagger = Math.max(e.stagger, e.def.boss ? 0.12 : 0.22);
    }
  }

  /**
   * 打ち上げる（重さに関係なく、決まった速さで飛ばす）。ボスは飛ばない。
   * ペットボトルロケット・落とし穴が使う。
   */
  launch(e: Enemy, v: V3): void {
    if (!e.alive || e.state === 'dead' || e.def.boss) return;
    if (e.state === 'walk') {
      e.body.lockRotations(false, true);
      e.col.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
      e.col.setCollisionGroups(groups(G.ENEMY, FLYING_FILTER));
      e.state = 'knock';
      e.chained = false;
    }
    e.body.setLinvel(v, true);
    e.t = Math.max(e.t, 1.2);
    e.w.peak = e.y;
  }

  kill(e: Enemy, src: DamageSource): void {
    const g = this.g;
    if (e.state === 'dead') return;
    const wasWalking = e.state === 'walk' || e.state === 'held';
    e.state = 'dead';
    e.col.setCollisionGroups(groups(G.ENEMY, FLYING_FILTER));
    e.t = e.def.boss ? 2.2 : 1.25;
    e.body.lockRotations(false, true);
    e.body.setGravityScale(1, true);
    e.col.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
    if (wasWalking) {
      const v = e.body.linvel();
      e.body.setLinvel({ x: v.x + (Math.random() - 0.5) * 3, y: 4 + Math.random() * 2, z: v.z + (Math.random() - 0.5) * 3 }, true);
      e.body.setAngvel({ x: (Math.random() - 0.5) * 12, y: (Math.random() - 0.5) * 8, z: (Math.random() - 0.5) * 12 }, true);
    }
    if (e.def.behavior === 'bomber' || e.elite === 'bomb') e.fuse = 0.4;
    // 塩むすび: 棒の攻撃で倒すと回復
    if (src === 'weapon') {
      const sm = g.ip('shiomusubi');
      if (sm > 0) g.addHeal(1.5 * sm);
    }
    // 増える変質者: 倒すと小さいのが 2 人出てくる
    if (e.def.split) {
      for (const s of [-1, 1]) {
        const c = this.spawn(e.def.split, e.x + s * 0.6, e.z + s * 0.3, e.y + 0.2);
        if (c) c.stagger = 0.35;
      }
      g.fx.poof({ x: e.x, y: e.y, z: e.z }, 1, 0xb8f0a0);
    }
    const chain = src === 'chain' || src === 'slam' || src === 'prop' || src === 'drown' || src === 'traffic' || e.chained;
    g.onEnemyKilled(e, chain);
    g.skills.onEnemyKilled(e, src);
    if (e.def.boss) {
      const i = this.bosses.indexOf(e);
      if (i >= 0) this.bosses.splice(i, 1);
      log('enemy.boss.dead', { id: e.def.id, time: Math.round(g.time), src });
    }
  }

  private remove(e: Enemy): void {
    e.alive = false;
    this.g.physics.unregister(e.col);
    this.g.physics.world.removeRigidBody(e.body);
  }

  freeze(e: Enemy, sec: number): void {
    if (!e.alive || e.state === 'dead' || e.def.boss) {
      if (e.def.boss && e.alive) e.stagger = Math.max(e.stagger, sec * 0.3);
      return;
    }
    // ぬれた敵は 2 倍長く凍る（瞬間冷凍）
    if (e.wet > 0) sec *= 2;
    if (e.frozen <= 0) e.col.setFriction(0.0);
    e.frozen = Math.max(e.frozen, sec);
  }

  /** 継続ダメージ 1 フレーム分（防御と継続ダメージの倍率を掛ける）。 */
  private dot(e: Enemy, dps: number, dt: number, kind: DmgKind): number {
    const g = this.g;
    const d = dps * dt * g.rule.dealt * g.stats.dotMul * mitigate(kind, this.armorOf(e), this.mrOf(e), g.stats.armorPen, g.stats.magicPen);
    g.run.damage += d;
    if (e.markT > 0) e.markAcc += d;
    g.lifesteal(d);
    return d;
  }

  /** 居残りの刑の印が切れた: その間に受けたダメージの一部を、トゥルーダメージで受ける。 */
  private popMark(e: Enemy): void {
    const g = this.g;
    const extra = e.markAcc * e.markPct;
    e.markAcc = 0;
    if (extra < 1 || e.state === 'dead') return;
    g.fx.ring({ x: e.x, y: 0.15, z: e.z }, 0.3, 2.2, ZONE.ally, 0.35);
    g.fx.number({ x: e.x, y: e.y + 1.6, z: e.z }, `居残り ${Math.round(extra)}`, 'true');
    this.damage(e, extra, 'skill', { kind: 'true', quiet: true });
    if (g.skills.get('detention')?.evolved) {
      // 永久居残り: 近くの敵へ印が広がる
      let n = 0;
      this.inRadius({ x: e.x, y: 0, z: e.z }, 5, (o) => {
        if (o === e || o.markT > 0 || n >= 3) return;
        n++;
        o.markT = 3;
        o.markAcc = 0;
        o.markPct = 0.6;
      });
    }
  }

  /** 毒を与える（重ねると、長い方・強い方が残る）。 */
  poisonIt(e: Enemy, sec: number, dps: number): void {
    if (!e.alive || e.state === 'dead') return;
    e.poison = Math.max(e.poison, sec);
    e.poisonDps = Math.max(e.poisonDps, dps);
  }

  /** ぬらす。 */
  wetIt(e: Enemy, sec: number): void {
    if (!e.alive || e.state === 'dead') return;
    if (e.wet <= 0 && e.burn > 0) e.burn = 0;
    e.wet = Math.max(e.wet, sec);
  }

  private recover(e: Enemy): void {
    e.state = 'walk';
    e.chained = false;
    e.col.setCollisionGroups(groups(G.ENEMY, ENEMY_FILTER));
    e.col.setRestitution(0.15);
    if (e.frozen <= 0) e.col.setFriction(0.35 * this.g.rule.friction);
    e.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    e.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    e.body.lockRotations(true, true);
    e.col.setActiveEvents(RAPIER.ActiveEvents.NONE);
    e.stagger = 0.25;
  }

  // ---------------------------------------------------------------- 検索
  nearest(p: V3, maxDist: number, skip?: (e: Enemy) => boolean): Enemy | null {
    let best: Enemy | null = null;
    let bd = maxDist * maxDist;
    for (const e of this.list) {
      if (e.state === 'dead') continue;
      if (skip && skip(e)) continue;
      const d = (e.x - p.x) * (e.x - p.x) + (e.z - p.z) * (e.z - p.z);
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    return best;
  }

  /** 範囲内の生きている敵を列挙する（水平距離で判定）。 */
  inRadius(p: V3, r: number, cb: (e: Enemy, dist: number) => void): void {
    for (const e of this.list) {
      if (e.state === 'dead') continue;
      const d = Math.hypot(e.x - p.x, e.z - p.z);
      if (d < r + e.radius) cb(e, d);
    }
  }

  random(p: V3, maxDist: number): Enemy | null {
    const c: Enemy[] = [];
    for (const e of this.list) {
      if (e.state !== 'dead' && Math.hypot(e.x - p.x, e.z - p.z) < maxDist) c.push(e);
    }
    return c.length ? c[Math.floor(Math.random() * c.length)] : null;
  }

  /** 敵がいちばん密集しているあたりの位置（範囲攻撃の狙い先）。 */
  cluster(p: V3, maxDist: number): V3 | null {
    let best: Enemy | null = null;
    let bestN = -1;
    const sample: Enemy[] = [];
    for (const e of this.list) if (e.state !== 'dead' && Math.hypot(e.x - p.x, e.z - p.z) < maxDist) sample.push(e);
    if (!sample.length) return null;
    for (let i = 0; i < Math.min(10, sample.length); i++) {
      const e = sample[Math.floor(Math.random() * sample.length)];
      let n = 0;
      for (const o of sample) if (Math.hypot(o.x - e.x, o.z - e.z) < 4) n++;
      if (n > bestN) {
        bestN = n;
        best = e;
      }
    }
    return best ? { x: best.x, y: 0, z: best.z } : null;
  }

  // ---------------------------------------------------------------- 更新
  update(dt: number): void {
    const g = this.g;
    const pl = g.player;
    const px = pl.pos.x;
    const pz = pl.pos.z;
    const speedMul = g.rule.enemySpeed;
    if (this.timeStop > 0) this.timeStop -= dt;
    const stopped = this.timeStop > 0;
    this.updateHazards(dt);
    for (let i = this.list.length - 1; i >= 0; i--) {
      const e = this.list[i];
      const b = e.body;
      const t = b.translation();
      e.x = t.x; e.y = t.y; e.z = t.z;
      if (e.flash > 0) e.flash -= dt;
      if (e.stopShake > 0) e.stopShake -= dt;
      // 落下ダメージ（歩いていても、吹き飛んでいても）
      if (e.state === 'walk' || e.state === 'knock') this.fallCheck(e, b.linvel().y);
      if (e.cd) for (const [k, v] of e.cd) e.cd.set(k, v - dt);

      if (e.state === 'dead') {
        e.t -= dt;
        const v = b.linvel();
        e.prevSpeed = Math.hypot(v.x, v.y, v.z);
        if (e.fuse >= 0) {
          e.fuse -= dt;
          if (e.fuse < 0) {
            g.explode({ x: e.x, y: e.y, z: e.z }, 3.6, e.dmg * 2.2, { force: 13, struct: 30, hurtPlayer: true, source: 'enemy' });
            e.t = 0;
          }
        }
        // ヘリは落ちて、地面で爆発する
        if ((e.def.behavior === 'heli' || e.def.behavior === 'carrier') && !e.w.crashed) {
          e.t = Math.max(e.t, 0.5);
          if (Math.random() < dt * 20) g.fx.dust({ x: e.x, y: e.y, z: e.z }, 1.2, 0x444444, 1);
          if (e.y - g.world.groundY(e.x, e.z) < e.halfH + e.radius + 0.6) {
            e.w.crashed = 1;
            e.t = 0.6;
            g.explode({ x: e.x, y: g.world.groundY(e.x, e.z) + 1, z: e.z }, 7, 160, { force: 22, struct: 140, source: 'skill' });
            g.fx.flash('boom');
          }
        }
        if (e.t <= 0 || e.y < g.world.groundY(e.x, e.z) - 8) {
          if (e.fuse < 0) g.fx.poof({ x: e.x, y: e.y, z: e.z }, e.radius * 2.2);
          this.remove(e);
          this.list.splice(i, 1);
        }
        continue;
      }
      if (e.y < g.world.groundY(e.x, e.z) - 8 || Math.abs(e.x) > ARENA + 6 || Math.abs(e.z) > ARENA + 6) {
        // 場外へ飛んでいった
        this.kill(e, 'slam');
        continue;
      }
      if (e.shredAT > 0) e.shredAT -= dt;
      if (e.shredMT > 0) e.shredMT -= dt;
      if (e.slowT > 0) e.slowT -= dt;
      if (e.markT > 0) {
        e.markT -= dt;
        if (e.markT <= 0) this.popMark(e);
      }
      if (e.bleed > 0) {
        e.bleed -= dt;
        const d = this.dot(e, e.bleedDps, dt, 'phys');
        e.hp -= d;
        if (Math.random() < dt * 5) g.fx.spawn({ pos: { x: e.x + (Math.random() - 0.5) * 0.4, y: e.y + 0.3, z: e.z + (Math.random() - 0.5) * 0.4 }, vel: { x: 0, y: -2.5, z: 0 }, life: 0.5, size: 0.16, size2: 0.08, color: 0xd81a2a, shape: SH.SOFT, alpha: 0.95 });
        if (e.hp <= 0) {
          this.kill(e, 'bleed');
          continue;
        }
      }
      if (e.burn > 0) {
        e.burn -= dt;
        e.hp -= this.dot(e, e.burnDps, dt, 'magic');
        if (Math.random() < dt * 6) g.fx.element({ x: e.x, y: e.y + 0.3, z: e.z }, 'fire', 0.7);
        if (e.hp <= 0) {
          this.kill(e, 'burn');
          continue;
        }
      }
      if (e.poison > 0) {
        e.poison -= dt;
        e.hp -= this.dot(e, e.poisonDps, dt, 'magic');
        if (Math.random() < dt * 5) g.fx.spawn({ pos: { x: e.x + (Math.random() - 0.5) * 0.5, y: e.y + 0.4, z: e.z + (Math.random() - 0.5) * 0.5 }, vel: { x: 0, y: 1.2, z: 0 }, life: 0.6, size: 0.35, size2: 0.7, color: 0x8fe05a, color2: 0x4a8a2a, shape: SH.PUFF, alpha: 0.8 });
        if (e.hp <= 0) {
          this.kill(e, 'poison');
          continue;
        }
      }
      if (e.wet > 0) {
        e.wet -= dt;
        if (Math.random() < dt * 4) g.fx.spawn({ pos: { x: e.x + (Math.random() - 0.5) * 0.5, y: e.y + 0.2, z: e.z + (Math.random() - 0.5) * 0.5 }, vel: { x: 0, y: -2, z: 0 }, life: 0.35, size: 0.12, size2: 0.06, color: 0x9fd8ff, shape: SH.SOFT, alpha: 0.9 });
      }
      if (e.state === 'knock') {
        e.t -= dt;
        const v = b.linvel();
        e.prevSpeed = Math.hypot(v.x, v.y, v.z);
        if ((e.t <= 0 && e.prevSpeed < 2.5) || e.t < -2.2) this.recover(e);
        continue;
      }
      if (e.state === 'held') continue;
      if (e.frozen > 0 || stopped) {
        if (e.frozen > 0) {
          e.frozen -= dt;
          if (e.frozen <= 0) {
            e.col.setFriction(0.35 * g.rule.friction);
            g.fx.element({ x: e.x, y: e.y, z: e.z }, 'ice');
          }
        }
        if (stopped) {
          const v = b.linvel();
          b.setLinvel({ x: v.x * 0.8, y: v.y, z: v.z * 0.8 }, true);
        }
        continue;
      }
      if (e.stagger > 0) {
        e.stagger -= dt;
        continue;
      }

      // ---- 歩いているときの行動
      const dx = px - e.x;
      const dz = pz - e.z;
      const dist = Math.hypot(dx, dz) || 0.001;
      if (dist > 64 && !e.def.boss && e.w.anchorX === undefined) {
        // 置いていかれた敵は、プレイヤーのまわりへ出し直す
        const a = Math.random() * Math.PI * 2;
        const nx = Math.max(-ARENA + 2, Math.min(ARENA - 2, px + Math.cos(a) * 30));
        const nz = Math.max(-ARENA + 2, Math.min(ARENA - 2, pz + Math.sin(a) * 30));
        if (g.world.spawnOk(nx, nz)) b.setTranslation({ x: nx, y: g.world.groundY(nx, nz) + e.halfH + e.radius + 0.1, z: nz }, true);
        continue;
      }
      let tx = dx / dist;
      let tz = dz / dist;
      let speed = e.speed * speedMul * (e.slowT > 0 ? 1 - e.slow : 1) * ((e.w.pep ?? 0) > g.time ? 1.3 : 1);
      e.telegraph = 0;
      const beh = e.def.behavior;
      // 高低差のあるステージ: 坂道を通って高い所へ登る
      const sv = g.world.stage.steer?.(e, tx, tz);
      if (sv) {
        tx = sv[0];
        tz = sv[1];
      }
      // 目覚まし時計の近くにいる敵は、時計に群がる（撃つ敵とボスは除く）
      if (this.lures.length && !e.def.boss && beh !== 'ranged') {
        for (const l of this.lures) {
          const lx = l.x - e.x;
          const lz = l.z - e.z;
          const ld = Math.hypot(lx, lz);
          if (ld < l.r && ld > 0.7) {
            tx = lx / ld;
            tz = lz / ld;
            break;
          }
        }
      }
      if (beh === 'zigzag') {
        const a = Math.sin(g.time * 2.3 + e.seed) * 0.75;
        const c = Math.cos(a);
        const s = Math.sin(a);
        const ox = tx * c - tz * s;
        tz = tx * s + tz * c;
        tx = ox;
        if (e.def.boss) {
          e.ai -= dt;
          if (e.ai <= 0) {
            e.ai = 8;
            for (let k = 0; k < 5; k++) this.spawn('streaker', e.x + Math.cos(k * 1.26) * 2.2, e.z + Math.sin(k * 1.26) * 2.2);
            g.fx.ring({ x: e.x, y: 0.1, z: e.z }, 0.5, 4, ZONE.enemy, 0.4);
            g.audio.whoosh();
          }
          // 全力疾走: 0.6 秒の予告のあと、まっすぐ突っ込む
          const w = e.w;
          w.dash = (w.dash ?? 5) - dt;
          if (w.dash <= 0.6 && w.dash > 0) {
            if (!w.aimed) {
              w.aimed = 1;
              w.dx = tx;
              w.dz = tz;
            }
            e.telegraph = 1;
            speed = 0;
          } else if (w.dash <= 0) {
            tx = w.dx;
            tz = w.dz;
            speed *= 3.2;
            e.aiState = 2;
            if (w.dash <= -1.0) {
              w.dash = (5.5 + Math.random() * 2) * this.rage(e);
              e.aiState = 0;
              w.aimed = 0;
            }
          }
        }
      } else if (beh === 'ranged') {
        if (dist < 7) {
          tx = -tx; tz = -tz; speed *= 0.55;
        } else if (dist < 13) {
          const ox = -tz;
          tz = tx; tx = ox;
          speed *= 0.4 * (e.seed > 50 ? 1 : -1);
        }
        e.ai -= dt;
        if (dist < 24) {
          // 敵全体で射撃の間隔を空ける。撃つ直前の点滅が始まる時点で順番を予約し、撃つ時刻をその順番まで遅らせる。
          // こうすると、点滅している敵は必ず 0.45 秒以内に撃つ（順番待ちの間、点滅し続けることがない）
          if (!e.def.boss && e.aiState !== SHOT_BOOKED && e.ai < 0.45) {
            if (this.nextShotT - g.time > 4) {
              // 順番待ちが長いときは予約せず、少し後でやり直す（予約した敵が倒されても、長い空白ができない）
              e.ai = 0.5 + Math.random();
            } else {
              const slot = Math.max(this.nextShotT, g.time + Math.max(0, e.ai));
              this.nextShotT = slot + TUNE.enemyShotGap;
              e.ai = slot - g.time;
              e.aiState = SHOT_BOOKED;
            }
          }
          if (e.ai < 0.45) e.telegraph = 1;
          if (e.ai <= 0) {
            e.aiState = 0;
            e.ai = (e.def.boss ? 1.5 : 2.3) + Math.random() * 1.4;
            if (e.def.boss) {
              e.w.shots = (e.w.shots ?? 0) + 1;
              if (e.w.shots % 3 === 0) for (const a of [-0.32, 0.32]) g.projectiles.enemyShot(e, true, a);
            }
            g.projectiles.enemyShot(e, !!e.def.boss);
          }
        } else {
          // 射程の外へ出たら予約を取り消す（その順番は空く）
          e.aiState = 0;
          if (e.ai < 0.6) e.ai = 0.6;
        }
      } else if (beh === 'charger') {
        e.ai -= dt;
        if (e.aiState === 0) {
          if (dist < 14 && e.ai <= 0) {
            e.aiState = 1;
            e.ai = 0.65;
          }
        } else if (e.aiState === 1) {
          speed = 0;
          e.telegraph = 1;
          if (e.ai <= 0) {
            e.aiState = 2;
            e.ai = 1.0;
            e.dirX = tx; e.dirZ = tz;
            e.col.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
            g.audio.whoosh();
          }
        } else if (e.aiState === 2) {
          tx = e.dirX; tz = e.dirZ;
          speed *= 3.4;
          e.prevSpeed = speed;
          if (Math.random() < dt * 20) g.fx.dust({ x: e.x, y: 0.1, z: e.z }, 0.8, 0xcbb89a, 1);
          if (e.ai <= 0) {
            e.aiState = 3;
            e.ai = 0.9;
            e.col.setActiveEvents(RAPIER.ActiveEvents.NONE);
          }
        } else {
          speed *= 0.25;
          if (e.ai <= 0) {
            e.aiState = 0;
            e.ai = 2.2 + Math.random() * 2;
          }
        }
      } else if (MORE_BEHAVIORS.has(beh)) {
        const r = this.more.act(e, dt, dist, tx, tz);
        if (!r) continue;
        tx = r.tx;
        tz = r.tz;
        speed *= r.speed;
      } else if (beh === 'pounder' || beh === 'tank' || beh === 'heli' || beh === 'carrier' || beh === 'chimera') {
        const r = this.bossAct(e, dt, dist, tx, tz);
        if (!r) continue;
        tx = r.tx;
        tz = r.tz;
        speed *= r.speed;
      } else if (beh === 'bomber') {
        if (e.fuse < 0 && dist < 2.2) e.fuse = 0.55;
        if (e.fuse >= 0) {
          e.fuse -= dt;
          e.telegraph = 1;
          speed *= 0.4;
          if (e.fuse < 0) {
            // 先に倒れた扱いにしてから爆発させる（自分の爆発で二重に数えないため）
            e.hp = 0;
            e.fuse = -1;
            e.state = 'dead';
            e.t = 0;
            g.onEnemyKilled(e, false);
            g.explode({ x: e.x, y: e.y, z: e.z }, 3.6, e.dmg * 2.2, { force: 13, struct: 30, hurtPlayer: true, source: 'enemy' });
            continue;
          }
        }
      }
      // 黒板消しはたき: 目をこすって、ふらふら歩く（撃たず、突進もしない）
      if ((e.daze ?? 0) > g.time && !e.def.boss) {
        const a = e.seed + Math.floor(g.time * 2) * 1.7;
        tx = Math.cos(a);
        tz = Math.sin(a);
        speed = e.speed * speedMul * 0.5;
        e.telegraph = 0;
        if (e.aiState !== 0 && beh !== 'drone') {
          e.aiState = 0;
          e.ai = Math.max(e.ai, 0.6);
        }
      }
      // 寄り道の賞金首: ノリコが離れているときは、持ち場（宝のある所）へ戻る
      if (e.w.anchorX !== undefined && dist > 16) {
        const ax = e.w.anchorX - e.x;
        const az = e.w.anchorZ - e.z;
        const ad = Math.hypot(ax, az);
        tx = ad > 0.01 ? ax / ad : 0;
        tz = ad > 0.01 ? az / ad : 0;
        speed = ad > 2 ? e.speed * 0.7 : 0;
        e.telegraph = 0;
      }
      // 生活指導の「こらーっ！」: ノリコへまっすぐ向かってくる（撃たず、突進もしない）
      if ((e.taunt ?? 0) > 0 && !e.def.boss) {
        e.taunt = (e.taunt ?? 0) - dt;
        tx = dx / dist;
        tz = dz / dist;
        speed = e.speed * speedMul * (e.slowT > 0 ? 1 - e.slow : 1);
        e.telegraph = 0;
        if (beh === 'ranged' || beh === 'charger') {
          e.aiState = 0;
          e.ai = Math.max(e.ai, 0.6);
        }
      }
      // びっくり箱: 怖がった敵は、驚いた場所から逃げる（撃たず、突進もしない）
      if ((e.fear ?? 0) > 0 && !e.def.boss) {
        e.fear = (e.fear ?? 0) - dt;
        const fx0 = e.x - (e.fearX ?? px);
        const fz0 = e.z - (e.fearZ ?? pz);
        const fd = Math.hypot(fx0, fz0) || 1;
        tx = fx0 / fd;
        tz = fz0 / fd;
        speed = e.speed * speedMul * 1.15;
        e.telegraph = 0;
        if (beh === 'ranged' || beh === 'charger') {
          e.aiState = 0;
          e.ai = Math.max(e.ai, 0.6);
        }
      }
      // 壁などに引っかかったら、しばらく横へ動く
      const v = b.linvel();
      const hs = Math.hypot(v.x, v.z);
      if (e.sidestep > 0) {
        e.sidestep -= dt;
        const ox = -tz * e.dirX;
        tz = tx * e.dirX;
        tx = ox;
      } else if (speed > 0.5 && hs < speed * 0.25 && dist > 2.5 && e.aiState !== 2) {
        e.stuck += dt;
        if (e.stuck > 0.7) {
          e.stuck = 0;
          e.sidestep = 1.1;
          if (beh !== 'charger') e.dirX = Math.random() < 0.5 ? 1 : -1;
        }
      } else e.stuck = 0;

      // 足元（滑る床・水の中）で、速さと向きの変えやすさが変わる
      const sf = g.world.surface(e.x, e.z);
      speed *= sf.speed;
      const k = Math.min(1, dt * 9 * sf.grip);
      b.setLinvel({ x: v.x + (tx * speed - v.x) * k, y: v.y, z: v.z + (tz * speed - v.z) * k }, true);
      let dyaw = Math.atan2(dx, dz) - e.yaw;
      while (dyaw > Math.PI) dyaw -= Math.PI * 2;
      while (dyaw < -Math.PI) dyaw += Math.PI * 2;
      e.yaw += dyaw * Math.min(1, dt * 8);
      e.phase += dt * (4 + speed * 2.2);

      // 接触ダメージ
      e.atkCd -= dt;
      if (e.atkCd <= 0 && dist < e.radius + 0.62 && Math.abs(pl.pos.y + 0.8 - e.y) < e.halfH + e.radius + 1.0) {
        e.atkCd = 0.85;
        // 画びょう: 体当たりしてきた敵にダメージを返して弾く
        const thorns = g.stats.thorns + (g.hasItem('thornbag') ? g.stats.physDef * 0.6 * g.ip('thornbag') : 0) + (g.shieldActive() ? 15 : 0);
        if (thorns > 0) {
          const inv = 1 / dist;
          this.damage(e, thorns * g.stats.power, 'skill', { kind: 'phys', impulse: { x: -dx * inv * 8, y: 2, z: -dz * inv * 8 } });
        }
        pl.hurt(e.dmg * (e.aiState === 2 || e.aiState === 11 ? 1.5 : 1), { x: e.x, y: e.y, z: e.z }, e.elite ? ELITES[e.elite].name + e.def.name : e.def.name);
      }
    }
  }

  // ---------------------------------------------------------------- ボスの攻撃
  /** 地面を伝わる輪。輪が通るときに地面にいると当たる（ジャンプ中・ダッシュ中は当たらない）。 */
  shockwave(x: number, z: number, max: number, speed: number, dmg: number, by: string): void {
    this.waves.push({ x, z, r: 0.5, max, speed, dmg, by, hit: false });
    // 高低差のあるステージでも、地面の高さに輪を出す
    const gy = this.g.world.groundY(x, z);
    this.g.fx.ring({ x, y: gy + 0.15, z }, 0.5, max, ZONE.enemy, max / speed, 0.95);
    this.g.fx.ring({ x, y: gy + 0.6, z }, 0.5, max, ZONE.enemy, max / speed, 0.45);
  }

  /** 砲弾・爆弾を落とす。着弾点には着弾まで赤い円を出す。h は弧の高さ（0 ならまっすぐ落ちる）。 */
  shell(from: V3, to: { x: number; z: number }, T: number, h: number, r: number, dmg: number, by: string, opts: { emoji?: string; element?: 'fire' } = {}): void {
    const sp = emojiSprite(opts.emoji ?? '💣', 0.9);
    sp.position.set(from.x, from.y, from.z);
    this.g.world.root.add(sp);
    this.shells.push({ from, to: { x: to.x, y: this.g.world.groundY(to.x, to.z) + 0.2, z: to.z }, t: 0, T, h, r, dmg, by, sp, mark: 0, element: opts.element });
  }

  private updateHazards(dt: number): void {
    const g = this.g;
    const pl = g.player;
    for (let i = this.waves.length - 1; i >= 0; i--) {
      const w = this.waves[i];
      w.r += w.speed * dt;
      const d = Math.hypot(pl.pos.x - w.x, pl.pos.z - w.z);
      if (!w.hit && Math.abs(d - w.r) < 0.9 && pl.grounded) {
        w.hit = true;
        pl.hurt(w.dmg, { x: w.x, y: 0, z: w.z }, w.by);
      }
      if (Math.random() < dt * 25) {
        const a = Math.random() * Math.PI * 2;
        const dx = w.x + Math.cos(a) * w.r;
        const dz = w.z + Math.sin(a) * w.r;
        g.fx.dust({ x: dx, y: g.world.groundY(dx, dz) + 0.15, z: dz }, 0.7, 0xd8c8a8, 1);
      }
      if (w.r > w.max) this.waves.splice(i, 1);
    }
    for (let i = this.shells.length - 1; i >= 0; i--) {
      const s = this.shells[i];
      s.t += dt;
      s.mark -= dt;
      if (s.mark <= 0) {
        s.mark = 0.22;
        g.fx.ring(s.to, s.r * 0.85, s.r, ZONE.enemy, 0.2, 0.9);
        g.fx.ring(s.to, 0.2, 0.6, ZONE.enemy, 0.2, 0.9);
      }
      const k = Math.min(1, s.t / s.T);
      const arc = 4 * s.h * k * (1 - k);
      s.sp.position.set(s.from.x + (s.to.x - s.from.x) * k, s.from.y + (s.to.y - s.from.y) * k + arc, s.from.z + (s.to.z - s.from.z) * k);
      if (k >= 1) {
        s.sp.removeFromParent();
        this.shells.splice(i, 1);
        g.explode({ x: s.to.x, y: s.to.y + 0.3, z: s.to.z }, s.r, s.dmg, { force: 14, struct: 60, hurtPlayer: true, source: 'enemy', element: s.element });
      }
    }
  }

  /**
   * 落下ダメージ。吹き飛んだ敵の一番高い位置を覚えておき、着地したら落ちた高さに応じた衝撃ダメージ。
   * ふだんは 3m を超えた分だけ。重力の腕章があると 1m から、もっと痛い。
   */
  private fallCheck(e: Enemy, vy: number): void {
    const w = e.w;
    w.peak = Math.max(w.peak ?? e.y, e.y);
    const was = w.vy ?? 0;
    w.vy = vy;
    if (!(was < -5 && vy > -1.5)) {
      // 地面に接して歩いている・滑っている間は、基準の高さを置き直す（長い坂を滑り降りただけで「落ちた」と数えない）
      if (vy > -5 && e.y - this.g.world.groundY(e.x, e.z) <= e.halfH + e.radius + 0.3) w.peak = e.y;
      return;
    }
    const h = (w.peak ?? e.y) - e.y;
    w.peak = e.y;
    const band = this.g.hasItem('gravityband');
    const over = h - (band ? 1 : 3);
    if (over <= 0) return;
    this.damage(e, over * (band ? 11 * this.g.ip('gravityband') : 6), 'fall');
    if (h > 4) this.g.fx.dust({ x: e.x, y: e.y - e.halfH, z: e.z }, 0.9, 0xd8c8a8, 2);
  }

  /** 新しいボスの行動。null を返したときは、ふつうの歩き（速度の設定）をしない。 */
  private bossAct(e: Enemy, dt: number, dist: number, tx: number, tz: number): { tx: number; tz: number; speed: number } | null {
    const beh = e.def.behavior;
    if (beh === 'heli' || beh === 'carrier') {
      this.heli(e, dt);
      return null;
    }
    if (beh === 'tank') return this.tank(e, dt, dist, tx, tz);
    if (beh === 'pounder') return this.pounder(e, dt, dist, tx, tz, true);
    return this.chimera(e, dt, dist, tx, tz);
  }

  /** 体力が半分を切ると、行動の間隔が縮む。 */
  rage(e: Enemy): number {
    return e.hp < e.maxHp * 0.5 ? 0.7 : 1;
  }

  /** 森のヌシ: 跳び上がり、ノリコのいた所に着地して輪を広げる。ときどき子グマを呼ぶ。 */
  pounder(e: Enemy, dt: number, dist: number, tx: number, tz: number, summon: boolean): { tx: number; tz: number; speed: number } | null {
    const g = this.g;
    const w = e.w;
    if (summon) {
      w.roar = (w.roar ?? 9) - dt;
      if (w.roar <= 0) {
        w.roar = 12 * this.rage(e);
        for (let k = 0; k < 5; k++) this.spawn('cub', e.x + Math.cos(k * 1.26) * 3.5, e.z + Math.sin(k * 1.26) * 3.5);
        g.fx.ring({ x: e.x, y: 0.1, z: e.z }, 1, 7, ZONE.enemy, 0.5);
        g.audio.boss();
      }
    }
    const T = 0.9;
    if (e.aiState === 0) {
      e.ai -= dt;
      if (e.ai <= 0 && dist < 24) {
        e.aiState = 1;
        e.ai = 0.75;
        w.tx = g.player.pos.x;
        w.tz = g.player.pos.z;
        g.fx.ring({ x: w.tx, y: 0.12, z: w.tz }, 3.2, 3.6, ZONE.enemy, 0.75, 0.85);
        g.audio.warn();
      }
      return { tx, tz, speed: 1 };
    }
    if (e.aiState === 1) {
      e.telegraph = 1;
      e.ai -= dt;
      if (e.ai > 0) return { tx, tz, speed: 0 };
      const grav = -TUNE.gravity * g.rule.gravity;
      e.body.setLinvel({ x: (w.tx - e.x) / T, y: (grav * T) / 2, z: (w.tz - e.z) / T }, true);
      e.aiState = 2;
      e.ai = T + 0.5;
      g.audio.whoosh();
      return null;
    }
    if (e.aiState === 2) {
      e.ai -= dt;
      const foot = e.halfH + e.radius;
      if ((e.ai < 0.55 && e.y - g.world.groundY(e.x, e.z) <= foot + 0.4) || e.ai <= 0) {
        // 着地: 地面を伝わる輪と、まわりの建物への衝撃
        this.shockwave(e.x, e.z, 16, 17, e.dmg * 1.1, e.def.name);
        g.world.blast({ x: e.x, y: 0.5, z: e.z }, 4.5, 50, 9, 30);
        g.fx.dust({ x: e.x, y: 0.2, z: e.z }, 3, 0xd8c8a8, 8);
        g.fx.shake('L');
        g.audio.thud(1.6);
        e.aiState = 3;
        e.ai = 0.9;
      }
      return null;
    }
    e.ai -= dt;
    if (e.ai <= 0) {
      e.aiState = 0;
      e.ai = (3.4 + Math.random() * 1.5) * this.rage(e);
    }
    return { tx, tz, speed: 0.25 };
  }

  /** 戦車: 距離をとりながら、ノリコのいる所へ砲弾を落とす。3 回に 1 回は 3 発。 */
  private tank(e: Enemy, dt: number, dist: number, tx: number, tz: number): { tx: number; tz: number; speed: number } {
    const g = this.g;
    const w = e.w;
    e.ai -= dt;
    if (e.ai < 0.6 && e.ai > 0) e.telegraph = 1;
    if (e.ai <= 0) {
      w.vol = (w.vol ?? 0) + 1;
      e.ai = 3 * this.rage(e);
      const n = w.vol % 3 === 0 ? 3 : 1;
      const muzzle = { x: e.x + Math.sin(e.yaw) * 3, y: 2.4, z: e.z + Math.cos(e.yaw) * 3 };
      const p = g.player.pos;
      for (let k = 0; k < n; k++) {
        const a = Math.random() * Math.PI * 2;
        const off = n > 1 ? 1.5 + Math.random() * 3.5 : Math.random() * 1.2;
        this.shell(muzzle, { x: p.x + Math.cos(a) * off, z: p.z + Math.sin(a) * off }, 1.35, 6, 3.4, e.dmg * 2.4, e.def.name);
      }
      g.fx.dust(muzzle, 1.2, 0x888888, 4);
      g.audio.explode(0.5);
      g.fx.shake('S');
    }
    // 近すぎると横へ回る
    if (dist < 9) return { tx: -tz, tz: tx, speed: 0.6 };
    return { tx, tz, speed: 1 };
  }

  /** 攻撃ヘリ: ノリコのまわりを高く飛び、機銃と爆弾。ときどき低く降りて手下を降ろす（そのときだけ殴れる）。 */
  private heli(e: Enemy, dt: number): void {
    const g = this.g;
    const w = e.w;
    const p = g.player.pos;
    w.a = (w.a ?? Math.atan2(e.z - p.z, e.x - p.x)) + dt * 0.35;
    w.drop = (w.drop ?? 10) - dt;
    const ground = g.world.groundY(e.x, e.z);
    let ty = ground + 7;
    let gx = p.x + Math.cos(w.a) * 13;
    let gz = p.z + Math.sin(w.a) * 13;
    if (e.aiState === 1) {
      ty = ground + 2.4;
      gx = w.hx;
      gz = w.hz;
      e.ai -= dt;
      if (e.ai < 2.6 && !w.dropped) {
        w.dropped = 1;
        const carrier = e.def.behavior === 'carrier';
        for (let k = 0; k < (carrier ? 5 : 3); k++) this.spawn(carrier ? 'drone_e' : 'terrorist', e.x + Math.cos(k * 2.1) * 2.5, e.z + Math.sin(k * 2.1) * 2.5);
      }
      if (e.ai <= 0) {
        e.aiState = 0;
        w.drop = 15 * this.rage(e);
      }
    } else if (w.drop <= 0) {
      e.aiState = 1;
      e.ai = 5.5;
      w.dropped = 0;
      const a = Math.random() * Math.PI * 2;
      w.hx = p.x + Math.cos(a) * 5;
      w.hz = p.z + Math.sin(a) * 5;
      g.hud.toast(e.def.behavior === 'carrier' ? '母艦が降りてきた！ 今なら殴れる！' : 'ヘリが降りてきた！ 今なら殴れる！', 'info');
    } else {
      e.ai -= dt;
      if (e.ai <= 0) {
        e.ai = 2.2 * this.rage(e);
        g.projectiles.enemyShot(e, false);
      }
      w.bomb = (w.bomb ?? 4) - dt;
      if (w.bomb <= 0) {
        w.bomb = 5 * this.rage(e);
        w.left = 3;
        w.bt = 0;
      }
      if ((w.left ?? 0) > 0) {
        w.bt -= dt;
        if (w.bt <= 0) {
          w.bt = 0.35;
          w.left--;
          const v = e.body.linvel();
          const T = Math.sqrt((2 * Math.max(1, e.y)) / 22);
          this.shell({ x: e.x, y: e.y - 1, z: e.z }, { x: e.x + v.x * T, z: e.z + v.z * T }, T, 0, 3, e.dmg * 2.2, e.def.name);
        }
      }
    }
    const v = e.body.linvel();
    const k = Math.min(1, dt * 1.6);
    const lim = (n: number) => Math.max(-9, Math.min(9, n));
    const vx = lim((gx - e.x) * 1.2);
    const vz = lim((gz - e.z) * 1.2);
    e.body.setLinvel({ x: v.x + (vx - v.x) * k, y: (ty - e.y) * 2, z: v.z + (vz - v.z) * k }, true);
    let dy = Math.atan2(p.x - e.x, p.z - e.z) - e.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    e.yaw += dy * Math.min(1, dt * 3);
  }

  /** ラスボス: 突進 → ロケット → 地響き → 手下、を順に繰り返す。 */
  chimera(e: Enemy, dt: number, dist: number, tx: number, tz: number): { tx: number; tz: number; speed: number } | null {
    const g = this.g;
    const w = e.w;
    if (e.aiState >= 1 && e.aiState <= 3) {
      const r = this.pounder(e, dt, dist, tx, tz, false);
      if (e.aiState === 0) w.mt = 2 * this.rage(e);
      return r;
    }
    if (e.aiState === 10) {
      // 突進の予告
      e.telegraph = 1;
      e.ai -= dt;
      if (e.ai <= 0) {
        e.aiState = 11;
        e.ai = 1.2;
        g.audio.whoosh();
      }
      return { tx: w.dx, tz: w.dz, speed: 0 };
    }
    if (e.aiState === 11) {
      e.ai -= dt;
      if (Math.random() < dt * 20) g.fx.dust({ x: e.x, y: 0.1, z: e.z }, 1.2, 0xcbb89a, 1);
      if (e.ai <= 0) {
        e.aiState = 0;
        w.mt = 1.8 * this.rage(e);
      }
      return { tx: w.dx, tz: w.dz, speed: 3.4 };
    }
    if (e.aiState === 20) {
      // ロケットを 3 方向へ、3 回
      e.ai -= dt;
      e.telegraph = e.ai < 0.3 ? 1 : 0;
      if (e.ai <= 0) {
        for (const a of [-0.35, 0, 0.35]) g.projectiles.enemyShot(e, true, a);
        w.shots = (w.shots ?? 0) - 1;
        e.ai = 0.6;
        if (w.shots <= 0) {
          e.aiState = 0;
          w.mt = 2 * this.rage(e);
        }
      }
      return { tx, tz, speed: 0.3 };
    }
    w.mt = (w.mt ?? 2) - dt;
    if (w.mt <= 0) {
      w.mode = ((w.mode ?? -1) + 1) % 4;
      if (w.mode === 0) {
        e.aiState = 10;
        e.ai = 0.7;
        w.dx = tx;
        w.dz = tz;
      } else if (w.mode === 1) {
        e.aiState = 20;
        e.ai = 0.5;
        w.shots = 3;
      } else if (w.mode === 2) {
        e.aiState = 0;
        e.ai = 0;
        const r = this.pounder(e, dt, Math.min(dist, 20), tx, tz, false);
        void r;
      } else {
        for (let k = 0; k < 8; k++) this.spawn(k % 2 ? 'streaker' : 'cub', e.x + Math.cos(k * 0.785) * 4, e.z + Math.sin(k * 0.785) * 4);
        g.fx.ring({ x: e.x, y: 0.1, z: e.z }, 1, 8, ZONE.enemy, 0.5);
        g.audio.boss();
        w.mt = 2.5 * this.rage(e);
      }
    }
    return { tx, tz, speed: 1 };
  }

  // ---------------------------------------------------------------- 描画
  render(): void {
    const g = this.g;
    for (const k in this.meshes) this.counts[k] = 0;
    const blink = Math.floor(g.time * 14) % 2 === 0;
    let rotorN = 0;
    for (const e of this.list) {
      const mesh = this.meshes[e.def.model];
      const idx = this.counts[e.def.model]++;
      const foot = e.halfH + e.radius;
      let s = e.scale;
      if (e.state === 'walk' || e.state === 'held') {
        const moving = e.frozen <= 0 && this.timeStop <= 0 && e.state === 'walk';
        const bob = moving ? Math.abs(Math.sin(e.phase)) * 0.07 * e.scale : 0;
        const roll = moving ? Math.sin(e.phase) * 0.14 : 0;
        const lean = e.aiState === 2 ? 0.35 : e.aiState === 1 ? -0.2 : 0.06;
        quat.setFromAxisAngle(AX_Y, e.yaw);
        quat2.setFromAxisAngle(AX_Z, roll);
        quat.multiply(quat2);
        quat2.setFromAxisAngle(off.set(1, 0, 0), lean);
        quat.multiply(quat2);
        pos.set(e.x, e.y - foot + bob, e.z);
        if (e.telegraph > 0) {
          pos.x += (Math.random() - 0.5) * 0.06;
          pos.z += (Math.random() - 0.5) * 0.06;
        }
      } else {
        const r = e.body.rotation();
        quat.set(r.x, r.y, r.z, r.w);
        off.set(0, -foot, 0).applyQuaternion(quat);
        pos.set(e.x + off.x, e.y + off.y, e.z + off.z);
        if (e.state === 'dead' && e.t < 0.25) s *= Math.max(0.02, e.t / 0.25);
      }
      if (e.stopShake > 0) {
        pos.x += (Math.random() - 0.5) * 0.22;
        pos.y += (Math.random() - 0.5) * 0.12;
        pos.z += (Math.random() - 0.5) * 0.22;
      }
      scl.set(s, s, s);
      m4.compose(pos, quat, scl);
      mesh.setMatrixAt(idx, m4);
      const tint = e.def.tint;
      if (e.flash > 0) col.setRGB(3.2, 3.2, 3.2);
      else if (e.frozen > 0) col.setRGB(0.75, 1.25, 2.0);
      else if (this.timeStop > 0) col.setRGB(0.55, 0.55, 0.7);
      else if (e.telegraph > 0 && blink) col.setRGB(2.6, 0.9, 0.5);
      else if (e.state === 'dead') col.setRGB(tint[0] * 0.75, tint[1] * 0.75, tint[2] * 0.75);
      else if (e.elite) {
        const et = ELITES[e.elite].tint;
        const pulse = 0.85 + 0.15 * Math.sin(g.time * 6 + e.seed);
        col.setRGB(tint[0] * et[0] * pulse, tint[1] * et[1] * pulse, tint[2] * et[2] * pulse);
      } else if (e.poison > 0) col.setRGB(tint[0] * 0.75, tint[1] * 1.3, tint[2] * 0.6);
      else if (e.wet > 0) col.setRGB(tint[0] * 0.75, tint[1] * 0.9, tint[2] * 1.4);
      else col.setRGB(tint[0], tint[1], tint[2]);
      mesh.setColorAt(idx, col);
      // ラスボスは、クマの背中に変質者が乗っている
      if (e.def.rider) {
        const rm = this.meshes[e.def.rider];
        const ri = this.counts[e.def.rider]++;
        off.set(0, e.scale * (e.def.riderY ?? 1.25), e.scale * 0.1).applyQuaternion(quat);
        scl.setScalar(e.scale * (e.def.riderS ?? 0.55));
        m4.compose(pos.clone().add(off), quat, scl);
        rm.setMatrixAt(ri, m4);
        rm.setColorAt(ri, col);
      }
      if (e.def.model === 'heli' && rotorN < 15) {
        const top = e.y + e.halfH + 0.6;
        for (let k = 0; k < 2; k++) {
          quat2.setFromAxisAngle(AX_Y, g.time * (e.state === 'dead' ? 8 : 28) + (k * Math.PI) / 2);
          m4.compose(off.set(e.x, top, e.z), quat2, scl.set(1, 1, 1));
          this.rotor.setMatrixAt(rotorN++, m4);
        }
      }
    }
    this.rotor.count = rotorN;
    this.rotor.instanceMatrix.needsUpdate = true;
    for (const k in this.meshes) {
      const mesh = this.meshes[k];
      mesh.count = this.counts[k];
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }

  get count(): number {
    return this.list.length;
  }

  /** いま生きている（倒れていない）敵の数。 */
  get living(): number {
    let n = 0;
    for (const e of this.list) if (e.state !== 'dead') n++;
    return n;
  }
}
