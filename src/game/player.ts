import * as THREE from 'three';
import { G, G_ALL, groups, RAPIER } from '../core/physics';
import { clamp, segSegDist, V3 } from '../core/vec';
import { log } from '../log';
import { WeaponPose, weaponPose } from '../motion/arm';
import { Motion, MotionSample, sampleMotion, swingTiming } from '../motion/motion';
import { TUNE, WeaponDef } from './defs';
import type { Enemy } from './enemies';
import { ZONE, type Trail } from './fx';
import type { Game } from './game';
import { GUARD, lerpSample, NorikoRig } from './rig';
import { camFloorY, camFollowY, camLiftSearch, damageTaken, effectiveSpeed, weaponHit } from './rules';
import type { Chunk, Prop } from './world';

const HALF_H = 0.42;
/** ステージの仕掛け（安全ヘルメットで減る）の名前 */
const ENV_DAMAGE = new Set(['解体用の鉄球', '落ちてきた鉄骨', '暴走車', 'ネオン看板', 'がれき', '落石', '花火の火の粉', '雪崩', '雪玉', '酒樽', '暴走トロッコ']);
const RADIUS = 0.3;
const UP = new THREE.Vector3(0, 1, 0);
const tq = new THREE.Quaternion();
const tv = new THREE.Vector3();

export interface SwingCtx {
  /** 振りごとの通し番号（同じ振りで二重に当てないため） */
  id: number;
  dmgMul: number;
  hitBodies: Set<unknown>;
  trail?: Trail;
  clone: boolean;
}

/**
 * 武器が prev から cur へ動いた区間の当たり判定。敵・小道具・建物に当てる。
 * 本体と分身の両方から使う。戻り値は、この区間で発生したヒットストップの秒数。
 */
export function sweepWeapon(g: Game, prev: WeaponPose, cur: WeaponPose, dt: number, ctx: SwingCtx): number {
  const w = g.player.weapon;
  const len = g.player.weaponLen;
  const st = g.stats;
  const tvx = (cur.tip.x - prev.tip.x) / dt;
  const tvy = (cur.tip.y - prev.tip.y) / dt;
  const tvz = (cur.tip.z - prev.tip.z) / dt;
  const axial = tvx * cur.dir.x + tvy * cur.dir.y + tvz * cur.dir.z;
  const px = tvx - axial * cur.dir.x;
  const py = tvy - axial * cur.dir.y;
  const pz = tvz - axial * cur.dir.z;
  const perp = Math.hypot(px, py, pz);
  const eff = effectiveSpeed(perp, axial);
  if (ctx.trail) ctx.trail.push(cur.hand, cur.tip);
  if (eff < 1.5) return 0;
  const tsp = Math.hypot(tvx, tvy, tvz) || 1;
  const vdx = tvx / tsp;
  const vdy = tvy / tsp;
  const vdz = tvz / tsp;
  const reach = len + 2.2;
  const pad = w.radius + TUNE.hitPadding;
  let stop = 0;
  let hits = 0;
  let strong = false;

  for (const e of g.enemies.list) {
    if (!e.alive) continue;
    const ddx = e.x - cur.hand.x;
    const ddz = e.z - cur.hand.z;
    if (ddx * ddx + ddz * ddz > (reach + e.radius) * (reach + e.radius)) continue;
    if (e.lastSwing === ctx.id && g.time - e.lastSwingT < TUNE.rehitInterval) continue;
    const a = { x: e.x, y: e.y - e.halfH, z: e.z };
    const b = { x: e.x, y: e.y + e.halfH, z: e.z };
    const lim = e.radius + pad;
    if (segSegDist(cur.hand, cur.tip, a, b) > lim && segSegDist(prev.tip, cur.tip, a, b) > lim) continue;
    e.lastSwing = ctx.id;
    e.lastSwingT = g.time;
    // 先端に近いほど速い（先で当てると強い）
    const along = clamp(((e.x - cur.hand.x) * cur.dir.x + (e.y - cur.hand.y) * cur.dir.y + (e.z - cur.hand.z) * cur.dir.z) / Math.max(0.1, len), 0, 1);
    const local = eff * (0.45 + 0.55 * along);
    const res = weaponHit(w, st, local, Math.random(), ctx.dmgMul, g.weaponPower - w.damage);
    // 吹き飛ぶ向き: 武器の動いた向きを主に、プレイヤーから離れる向きを少し足す
    const od = Math.hypot(e.x - g.player.pos.x, e.z - g.player.pos.z) || 1;
    let kx = vdx * 0.78 + ((e.x - g.player.pos.x) / od) * 0.36;
    let kz = vdz * 0.78 + ((e.z - g.player.pos.z) / od) * 0.36;
    let ky = Math.max(0.14, vdy * 0.95 + 0.26);
    const kn = Math.hypot(kx, ky, kz) || 1;
    kx /= kn; ky /= kn; kz /= kn;
    const dead = e.state === 'dead';
    const killed = g.enemies.damage(e, res.damage, 'weapon', { impulse: { x: kx * res.impulse, y: ky * res.impulse, z: kz * res.impulse }, crit: res.crit });
    if (!dead) {
      const strength = clamp(res.damage / 45, 0.1, 1);
      const hp = { x: e.x - kx * e.radius * 0.6, y: clamp(cur.hand.y + cur.dir.y * len * along, e.y - e.halfH, e.y + e.halfH + e.radius), z: e.z - kz * e.radius * 0.6 };
      g.fx.hitMark(hp, strength, { x: kx, y: ky, z: kz }, res.crit);
      g.audio.hit(strength, res.crit);
      e.stopShake = res.hitStop + 0.05;
      stop = Math.max(stop, res.hitStop);
      hits++;
      if (res.crit || strength > 0.6) strong = true;
      g.skills.onWeaponHit(e, hp, res.damage, killed, ctx.clone);
      if (g.hasItem('nailbat')) g.enemies.bleedIt(e, 3, g.ad * 0.2 * g.ip('nailbat'));
      if (g.hasItem('redpen') && !ctx.clone && ++g.redpenHits % 3 === 0 && e.alive && e.state !== 'dead') {
        g.enemies.damage(e, e.maxHp * (e.def.boss ? 0.015 : 0.06) * g.ip('redpen'), 'skill', { kind: 'true' });
        g.fx.ring({ x: e.x, y: e.y, z: e.z }, 0.2, 1.4, 0xffffff, 0.2);
      }
    }
  }

  // 建物と小道具
  const mid = { x: (cur.hand.x + cur.tip.x) / 2, y: (cur.hand.y + cur.tip.y) / 2, z: (cur.hand.z + cur.tip.z) / 2 };
  tq.setFromUnitVectors(UP, tv.set(cur.dir.x, cur.dir.y, cur.dir.z));
  const shape = g.player.weaponShape;
  const found: { kind: string; ref: unknown }[] = [];
  g.physics.queryShape(mid, tq, shape, G.CHUNK | G.PROP | G.DEBRIS, (o) => {
    if (!ctx.hitBodies.has(o.ref)) found.push(o);
  });
  if (found.length) {
    const base = w.mass * st.weaponMass * Math.max(eff, w.refSpeed * 0.5) * TUNE.knockScale * st.knockback * ctx.dmgMul;
    const ky = Math.max(0.15, vdy * 0.9 + 0.3);
    for (const o of found) {
      if (ctx.hitBodies.has(o.ref)) continue;
      ctx.hitBodies.add(o.ref);
      if (o.kind === 'prop') {
        const p = o.ref as Prop;
        if (!p.alive) continue;
        const k = Math.min(26, (base * 1.7) / Math.pow(Math.max(1, p.mass / 20), 0.55));
        const t = p.body.translation();
        // シーソーは当たった所を押す（片側を叩くと反対側が跳ね上がる）。ほかの物は中心を押す
        const at = p.def.id === 'seesaw' ? { x: cur.tip.x, y: t.y, z: cur.tip.z } : { x: t.x, y: t.y + p.half.y * 0.3, z: t.z };
        g.world.hitProp(p, g.weaponPower * st.power * ctx.dmgMul, { x: vdx * k, y: ky * k, z: vdz * k }, at);
        g.fx.hitMark(cur.tip, 0.3);
        g.audio.thud(clamp(base / 30, 0.2, 1));
        stop = Math.max(stop, 0.02);
        hits++;
      } else {
        const ch = o.ref as Chunk;
        const k = Math.min(15, base * 0.55);
        const broke = g.world.hitChunk(ch, base * 0.6 * Math.sqrt(st.power), { x: vdx * k, y: ky * k, z: vdz * k }, cur.tip);
        if (broke) {
          stop = Math.max(stop, 0.06);
          strong = true;
        }
        hits++;
      }
    }
  }
  if (hits > 0 && !ctx.clone) g.fx.shake(strong ? 'M' : 'S', vdx, vdy);
  return stop;
}

export class Player {
  pos: V3 = { x: 0, y: 0, z: -28 };
  yaw = 0;
  camYaw = 0;
  camPitch = 0.32;
  vy = 0;
  grounded = true;
  hp: number;
  inv = 0;
  dead = false;
  revives = 0;
  rig: NorikoRig;
  weapon: WeaponDef;
  motion: Motion;
  weaponLen: number;
  weaponShape: RAPIER.Capsule;
  sample: MotionSample = { ...GUARD };
  /** 振っている最中の武器の位置（敵の弾を打ち返す判定に使う）。振っていなければ null。 */
  swingSegment: { hand: V3; tip: V3 } | null = null;
  atk: 'idle' | 'windup' | 'swing' | 'follow' | 'recover' = 'idle';
  swingCount = 0;
  /** 直近の振りの進み具合 0..1（分身が同じ動きをするために読む） */
  swingS = 0;
  private atkT = 0;
  private atkFrom: MotionSample = { ...GUARD };
  private swingDur = 0.3;
  private cd = 0;
  private ctx: SwingCtx;
  private prevPose: WeaponPose | null = null;
  private body: RAPIER.RigidBody;
  col: RAPIER.Collider;
  private ctrl: RAPIER.KinematicCharacterController;
  private dashT = 0;
  dashCd = 0;
  /** 続けて使えるダッシュの残り（韋駄天） */
  dashLeft = 1;
  private dashX = 0;
  private dashZ = 1;
  private phase = 0;
  private run = 0;
  private swingBlend = 0;
  private camTarget = new THREE.Vector3();
  /** 後ろが崖や壁のとき、カメラを上へ持ち上げている角度（ラジアン） */
  private camLift = 0;
  private faceT = 0;
  private blinkT = 2;
  private velX = 0;
  private velZ = 0;
  private trail: Trail;
  private stepT = 0;
  /** 自動操作（動作確認用）。true の間は入力の代わりに自分で動いて攻撃する。 */
  auto = false;
  /** 「棒、育つ」で増えた武器の威力（この登校のあいだ残る） */
  weaponBonus = 0;
  /** 風などで流される速さ (m/s)。ステージが毎フレーム設定する */
  windX = 0;
  windZ = 0;

  constructor(private g: Game) {
    this.pos = { x: g.world.start.x, y: 0, z: g.world.start.z };
    this.weapon = g.weaponDef;
    this.motion = g.motion;
    this.hp = g.stats.maxHp;
    this.revives = g.stats.revive;
    this.weaponLen = this.weapon.length * g.stats.weaponLength;
    this.weaponShape = new RAPIER.Capsule(this.weaponLen / 2, this.weapon.radius + 0.07);
    this.rig = new NorikoRig(g.assets, g.world.root);
    this.rig.setWeapon(this.weapon, g.stats.weaponLength);
    this.trail = g.fx.makeTrail(0xffffff);
    this.ctx = { id: 0, dmgMul: 1, hitBodies: new Set(), trail: this.trail, clone: false };
    const w = g.physics.world;
    this.pos.y = g.world.groundY(this.pos.x, this.pos.z);
    this.body = w.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(this.pos.x, this.pos.y + HALF_H + RADIUS + 0.02, this.pos.z));
    this.col = w.createCollider(
      RAPIER.ColliderDesc.capsule(HALF_H, RADIUS).setCollisionGroups(groups(G.PLAYER, G.STATIC | G.CHUNK | G.PROP | G.ENEMY | G.DEBRIS | G.RAIL)).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
      this.body,
    );
    g.physics.register(this.col, { kind: 'player', ref: this });
    this.ctrl = w.createCharacterController(0.03);
    this.ctrl.enableAutostep(0.45, 0.2, true);
    this.ctrl.enableSnapToGround(0.3);
    this.ctrl.setApplyImpulsesToDynamicBodies(true);
    this.ctrl.setCharacterMass(55);
    this.ctrl.setMaxSlopeClimbAngle((50 * Math.PI) / 180);
    this.camTarget.set(this.pos.x, this.pos.y + 1.3, this.pos.z);
  }

  /** 能力値が変わったとき（レベルアップなど）に呼ぶ。 */
  refreshStats(): void {
    const st = this.g.stats;
    this.weaponLen = this.weapon.length * st.weaponLength;
    this.weaponShape = new RAPIER.Capsule(this.weaponLen / 2, this.weapon.radius + 0.07);
    this.rig.setWeapon(this.weapon, st.weaponLength);
    this.hp = Math.min(this.hp, st.maxHp);
  }

  /** 跳んでいる間のいちばん高い位置（着地したときに、落ちた高さを求める） */
  private airPeak = 0;

  /** 着地したとき。ホッピング: 落ちた高さに応じて、まわりの敵を吹き飛ばす。 */
  private landed(fall: number): void {
    const g = this.g;
    const pw = g.ip('hopping');
    if (pw <= 0 || fall < 1.2) return;
    const r = Math.min(9, 2.2 + fall * 0.45);
    const p = this.pos;
    for (const e of g.enemies.list) {
      if (e.state === 'dead') continue;
      const dx = e.x - p.x;
      const dz = e.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d > r) continue;
      const f = 1 - d / r;
      g.enemies.damage(e, (6 + fall * 5) * pw * g.stats.power * (0.5 + f * 0.5), 'skill', { kind: 'impact', impulse: { x: (dx / (d || 1)) * (8 + fall) * f, y: 6 + fall * 0.6, z: (dz / (d || 1)) * (8 + fall) * f } });
    }
    g.fx.ring({ x: p.x, y: p.y + 0.1, z: p.z }, 0.5, r, ZONE.ally, 0.35, 0.6);
    g.fx.dust({ x: p.x, y: p.y + 0.1, z: p.z }, 1.2 + fall * 0.1, 0xe6dcc8, 6);
    g.fx.shake(fall > 5 ? 'M' : 'S');
    g.audio.thud(Math.min(1, fall / 8));
  }

  heal(n: number): void {
    if (this.dead) return;
    const before = this.hp;
    n *= this.g.itemFx?.healMul() ?? 1;
    this.hp = Math.min(this.g.stats.maxHp, this.hp + n);
    if (this.hp - before >= 1) this.g.fx.number({ x: this.pos.x, y: this.pos.y + 1.9, z: this.pos.z }, `+${Math.round(this.hp - before)}`, 'heal');
  }

  get dashing(): boolean {
    return this.dashT > 0;
  }

  /** info はログに足す補足（弾なら、警告を出したか・画面に見えていたか）。 */
  hurt(raw: number, from: V3, by: string, info?: Record<string, unknown>, kind: 'phys' | 'magic' = 'phys'): void {
    const g = this.g;
    if (this.dead || this.inv > 0 || this.dashT > 0 || g.debug.god) return;
    // 生徒会長の盾の間は防御が上がる。ステージの仕掛けからのダメージは安全ヘルメットで減る
    const st = g.shieldActive() ? { ...g.stats, physDef: g.stats.physDef + g.shieldDef, magicDef: g.stats.magicDef + g.shieldDef } : g.stats;
    let d = damageTaken(raw, st, g.rule.taken, kind);
    if (ENV_DAMAGE.has(by)) d = Math.max(1, d * (1 - g.stats.envResist));
    // 学級日誌・番長の学ラン・防災ずきん
    d = g.itemFx.mitigate(d);
    this.hp -= d;
    this.inv = TUNE.invincibleAfterHit;
    g.run.damageTaken += d;
    g.onPlayerHurt(raw * g.rule.taken);
    // 仮病の診断書: HP が 25% を切ったら、1 度だけ踏みとどまって無敵になる（60 秒に 1 回）
    if (this.hp < g.stats.maxHp * 0.25 && g.tryShindansho()) {
      this.hp = Math.max(1, this.hp);
      this.inv = 2.5;
    }
    g.fx.number({ x: this.pos.x, y: this.pos.y + 1.9, z: this.pos.z }, `-${Math.round(d)}`, 'hurt');
    g.fx.flash('hurt');
    g.fx.shake('M', this.pos.x - from.x, 0.3);
    g.audio.hurt();
    this.rig.setFace('hurt');
    this.faceT = 0.45;
    log('player.hurt', { by, kind, raw: Math.round(raw * 10) / 10, dmg: Math.round(d * 10) / 10, ...info }, { hp: Math.round(this.hp), time: Math.round(g.time) });
    if (this.hp <= 0) {
      if (this.revives > 0) {
        this.revives--;
        this.hp = g.stats.maxHp * 0.5;
        this.inv = 2.5;
        g.explode({ x: this.pos.x, y: 0.8, z: this.pos.z }, 7, 40, { force: 22, struct: 0, source: 'skill' });
        g.hud.toast('根性で起き上がった！', 'gold');
        g.fx.flash('gold');
        log('player.revive', {}, { hp: Math.round(this.hp), left: this.revives });
      } else {
        this.hp = 0;
        this.dead = true;
        this.rig.setFace('dead');
        g.onPlayerDead(by);
      }
    }
  }

  private startSwing(): void {
    const g = this.g;
    this.atk = 'windup';
    this.atkT = 0;
    this.atkFrom = { ...this.sample };
    this.swingDur = swingTiming(this.motion, this.weapon.swingSpeed * g.stats.attackSpeed * g.itemFx.swingMul()).duration;
  }

  /**
   * マウスの移動をカメラの向きへ反映する。ヒットストップで時間を止めている間も毎フレーム呼ぶ。
   * update() の中で行うと、止めている間のマウスの移動が捨てられ、視点が手の動きについてこなくなる。
   */
  look(): void {
    const g = this.g;
    const inp = g.input;
    if (inp.mouseDX === 0 && inp.mouseDY === 0) return;
    const sens = g.save.settings.sens;
    this.camYaw -= inp.mouseDX * 0.0026 * sens;
    this.camPitch = clamp(this.camPitch + inp.mouseDY * 0.0022 * sens * (g.save.settings.invertY ? -1 : 1), -0.35, 1.25);
  }

  update(dt: number): void {
    const g = this.g;
    const inp = g.input;
    const st = g.stats;
    if (this.inv > 0) this.inv -= dt;
    if (this.dashCd > 0) this.dashCd -= dt;
    if (this.cd > 0) this.cd -= dt;
    if (st.regen > 0 && !this.dead && this.hp < st.maxHp) this.hp = Math.min(st.maxHp, this.hp + st.regen * dt);

    // ---- 視点（カメラの向きは look() が毎フレーム更新する。ここでは体の向きを合わせる）
    if (!this.dead) this.yaw = this.camYaw;

    // ---- 移動
    let mx = 0;
    let mz = 0;
    let wantAttack = false;
    let wantJump = false;
    let wantDash = false;
    if (this.dead) {
      // 入力を受けない
    } else if (this.auto) {
      // 自動操作: いちばん近い敵の方を向き、近ければ攻撃、遠ければ近づく
      const e = g.enemies.nearest(this.pos, 60);
      if (e) {
        const want = Math.atan2(e.x - this.pos.x, e.z - this.pos.z);
        let d = want - this.camYaw;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        this.camYaw += d * Math.min(1, dt * 7);
        this.yaw = this.camYaw;
        const dist = Math.hypot(e.x - this.pos.x, e.z - this.pos.z);
        if (dist > this.weaponLen + 1.0) mz = 1;
        else if (dist < 1.0) mz = -1;
        mx = Math.sin(g.time * 0.9) * 0.6;
        wantAttack = dist < this.weaponLen + 2.2;
      }
    } else {
      if (inp.down('KeyW') || inp.down('ArrowUp')) mz += 1;
      if (inp.down('KeyS') || inp.down('ArrowDown')) mz -= 1;
      if (inp.down('KeyA') || inp.down('ArrowLeft')) mx += 1;
      if (inp.down('KeyD') || inp.down('ArrowRight')) mx -= 1;
      wantAttack = inp.buttons.has(0) || inp.down('KeyJ');
      wantJump = inp.hit('Space');
      wantDash = inp.hit('ShiftLeft') || inp.hit('ShiftRight') || inp.clicked.has(2);
    }
    const ml = Math.hypot(mx, mz);
    const sy = Math.sin(this.yaw);
    const cy = Math.cos(this.yaw);
    let wx = 0;
    let wz = 0;
    if (ml > 0) {
      // 前 = (sin, cos)、左 = (cos, -sin)
      wx = ((sy * mz + cy * mx) / ml);
      wz = ((cy * mz - sy * mx) / ml);
    }
    // 足元（滑る床・水の中）で、速さと加速の効きが変わる。ノリコは敵ほどは滑らない
    const sf = g.world.surface(this.pos.x, this.pos.z);
    const grip = Math.sqrt(sf.grip);
    const speed = TUNE.playerSpeed * st.moveSpeed * g.itemFx.moveMul() * (this.atk === 'swing' ? 0.82 : 1) * sf.speed;
    if (wantDash && this.dashCd <= 0) {
      this.dashT = TUNE.dashTime;
      // 韋駄天: 残りがあれば少しの間をおいて続けて使える。使い切ったら、ふだんの待ち時間
      if (this.dashLeft > 1) {
        this.dashLeft--;
        this.dashCd = Math.max(0.25, TUNE.dashTime + 0.05);
      } else {
        this.dashLeft = st.dashCharges;
        this.dashCd = TUNE.dashCooldown * st.dashCooldown;
      }
      this.dashX = ml > 0 ? wx : sy;
      this.dashZ = ml > 0 ? wz : cy;
      g.audio.dash();
      g.fx.dust({ x: this.pos.x, y: 0.1, z: this.pos.z }, 1.0, 0xe6dcc8, 4);
      log('player.dash', {}, { x: Math.round(this.pos.x), z: Math.round(this.pos.z) });
      g.itemFx.onDash(this.dashX, this.dashZ);
    }
    let tvx = wx * speed;
    let tvz = wz * speed;
    if (this.dashT > 0) {
      this.dashT -= dt;
      tvx = this.dashX * speed * TUNE.dashSpeedMul * st.dashSpeed;
      tvz = this.dashZ * speed * TUNE.dashSpeedMul * st.dashSpeed;
      if (Math.random() < dt * 40) g.fx.sparkle({ x: this.pos.x, y: this.pos.y + 0.8, z: this.pos.z }, 0xffffff, 1, 0.3);
      if (st.dashBump > 0) this.dashBump(st.dashBump);
    }
    const acc = Math.min(1, dt * (this.grounded ? 16 * grip : 6));
    this.velX += (tvx - this.velX) * acc;
    this.velZ += (tvz - this.velZ) * acc;
    if (wantJump && this.grounded) {
      // ホッピング: ジャンプ +35%
      this.vy = TUNE.playerJump * (g.hasItem('hopping') ? 1.35 : 1);
      this.grounded = false;
      g.audio.jump();
    }
    this.vy += TUNE.gravity * g.rule.gravity * dt * (this.vy < 0 ? 1.35 : 1);
    if (this.vy < -40) this.vy = -40;
    const cur = this.body.translation();
    this.ctrl.computeColliderMovement(this.col, { x: (this.velX + this.windX) * dt, y: this.vy * dt, z: (this.velZ + this.windZ) * dt }, undefined, groups(G_ALL, G.STATIC | G.CHUNK | G.PROP | G.DEBRIS | G.RAIL));
    const mv = this.ctrl.computedMovement();
    const wasGround = this.grounded;
    this.grounded = this.ctrl.computedGrounded();
    if (!this.grounded) this.airPeak = Math.max(this.airPeak, this.pos.y);
    if (this.grounded && this.vy < 0) {
      if (!wasGround && this.vy < -9) g.fx.dust({ x: this.pos.x, y: this.pos.y + 0.1, z: this.pos.z }, 0.8, 0xe6dcc8, 3);
      if (!wasGround) this.landed(this.airPeak - this.pos.y);
      this.airPeak = this.pos.y;
      this.vy = -2;
    }
    const nx = cur.x + mv.x;
    let ny = cur.y + mv.y;
    const nz = cur.z + mv.z;
    // 地面を突き抜けて落ちたら、地面の上へ戻す
    const floorY = g.world.groundY(nx, nz);
    if (ny < floorY - 20) ny = floorY + 3;
    this.body.setNextKinematicTranslation({ x: nx, y: ny, z: nz });
    this.pos.x = nx;
    this.pos.y = ny - (HALF_H + RADIUS);
    this.pos.z = nz;
    const moved = Math.hypot(mv.x, mv.z) / Math.max(1e-5, dt);
    this.run += (clamp(moved / (TUNE.playerSpeed * 0.9), 0, 1) - this.run) * Math.min(1, dt * 10);
    this.phase += dt * (5 + moved * 1.5);
    if (this.grounded && moved > 2) {
      this.stepT -= dt * moved;
      if (this.stepT <= 0) {
        this.stepT = 2.3;
        g.fx.dust({ x: this.pos.x, y: 0.05, z: this.pos.z }, 0.35, 0xe6dcc8, 1);
      }
    }

    // ---- 攻撃
    this.swingSegment = null;
    let hitStop = 0;
    const wl = this.weaponLen;
    if (this.dead) {
      this.sample = lerpSample(this.sample, { yaw: 0.2, pitch: -1.0, reach: 0.9 }, Math.min(1, dt * 6));
    } else if (this.atk === 'idle') {
      const sway = Math.sin(g.time * 2.1) * 0.03;
      this.sample = lerpSample(this.sample, { yaw: GUARD.yaw, pitch: GUARD.pitch + sway - this.run * 0.15, reach: GUARD.reach }, Math.min(1, dt * 12));
      if (wantAttack && this.cd <= 0) this.startSwing();
    } else if (this.atk === 'windup') {
      // 構え: 入力した直後に、最初の姿勢へすばやく移る
      this.atkT += dt;
      const k = Math.min(1, this.atkT / TUNE.windup);
      this.sample = lerpSample(this.atkFrom, sampleMotion(this.motion, 0), 1 - (1 - k) * (1 - k));
      if (k >= 1) {
        this.atk = 'swing';
        this.atkT = 0;
        this.swingS = 0;
        this.swingCount++;
        this.ctx.id = g.nextSwingId();
        this.ctx.hitBodies.clear();
        this.prevPose = weaponPose(this.pos, this.yaw, this.sample, this.rig.spec, wl);
        g.audio.swing(0.7 + this.weapon.mass * 0.08);
        this.rig.setFace('attack');
        this.faceT = this.swingDur + 0.2;
      }
    } else if (this.atk === 'swing') {
      const s0 = this.swingS;
      this.atkT += dt;
      const s1 = Math.min(1, this.atkT / this.swingDur);
      this.swingS = s1;
      // 速い振りでもすり抜けないよう、区間を細かく分けて判定する
      const n = clamp(Math.ceil((s1 - s0) * 26), 1, 8);
      const sub = dt / n;
      for (let i = 1; i <= n; i++) {
        const sm = sampleMotion(this.motion, s0 + ((s1 - s0) * i) / n);
        const pose = weaponPose(this.pos, this.yaw, sm, this.rig.spec, wl);
        if (this.prevPose) hitStop = Math.max(hitStop, sweepWeapon(g, this.prevPose, pose, sub, this.ctx));
        this.prevPose = pose;
        this.sample = sm;
      }
      this.swingSegment = this.prevPose ? { hand: this.prevPose.hand, tip: this.prevPose.tip } : null;
      if (s1 >= 1) {
        this.atk = 'follow';
        this.atkT = 0;
        if (this.prevPose) g.skills.onSwingEnd(this.prevPose);
      }
    } else if (this.atk === 'follow') {
      // フォロースルー: 振り抜いた姿勢を少し保つ
      this.atkT += dt;
      if (this.atkT >= TUNE.followThrough) {
        this.atk = 'recover';
        this.atkT = 0;
        this.atkFrom = { ...this.sample };
        this.cd = this.weapon.cooldown / (st.attackSpeed * g.itemFx.swingMul());
      }
    } else {
      this.atkT += dt;
      const k = Math.min(1, this.atkT / TUNE.recover);
      this.sample = lerpSample(this.atkFrom, GUARD, k * k * (3 - 2 * k));
      if (wantAttack && this.cd <= 0) this.startSwing();
      else if (k >= 1) this.atk = 'idle';
    }
    if (hitStop > 0) g.hitStop(hitStop);
    this.swingBlend += ((this.atk === 'swing' || this.atk === 'follow' ? 1 : 0) - this.swingBlend) * Math.min(1, dt * 14);

    // ---- 表情
    if (!this.dead) {
      if (this.faceT > 0) {
        this.faceT -= dt;
        if (this.faceT <= 0) this.rig.setFace('neutral');
      } else {
        this.blinkT -= dt;
        if (this.blinkT <= 0) {
          this.rig.setFace('blink');
          this.faceT = 0.1;
          this.blinkT = 2 + Math.random() * 3;
        }
      }
    }
  }

  /** 外から勢いをつける（車にはねられる、噴水で打ち上がる）。 */
  launch(vx: number, vy: number, vz: number): void {
    this.velX = vx;
    this.velZ = vz;
    this.vy = vy;
    this.grounded = false;
  }

  /** 反復横跳び: ダッシュ中にぶつかった敵を、進む向きの横へ弾き飛ばす。 */
  private dashBump(k: number): void {
    const g = this.g;
    for (const e of g.enemies.list) {
      if (e.state === 'dead' || e.state === 'held') continue;
      const dx = e.x - this.pos.x;
      const dz = e.z - this.pos.z;
      const rr = e.radius + RADIUS + 0.45;
      if (dx * dx + dz * dz > rr * rr) continue;
      if (e.cd && (e.cd.get('dash') ?? 0) > 0) continue;
      (e.cd ??= new Map()).set('dash', 0.5);
      // 進む向きに対して、敵がいる側へ弾く
      const side = dx * this.dashZ - dz * this.dashX >= 0 ? 1 : -1;
      const sx = this.dashZ * side;
      const sz = -this.dashX * side;
      g.enemies.damage(e, (4 + k * 0.5) * g.stats.power, 'skill', { kind: 'phys', impulse: { x: (sx + this.dashX * 0.5) * k, y: 3, z: (sz + this.dashZ * 0.5) * k } });
      g.fx.hitMark({ x: e.x, y: e.y, z: e.z }, 0.3);
      g.audio.hit(0.35);
    }
  }

  /** 喜ぶ・得意げなどの表情を一定時間出す。 */
  emote(face: 'happy' | 'smug', sec: number): void {
    if (this.dead) return;
    this.rig.setFace(face);
    this.faceT = sec;
  }

  /** 見た目とカメラの更新。ヒットストップ中も呼ぶ。 */
  render(real: number): void {
    const g = this.g;
    const rp = { ...this.pos };
    if (this.dead) rp.y += 0.05;
    this.rig.pose({ pos: rp, yaw: this.yaw, sample: this.sample, weaponLen: this.weaponLen, run: this.run, phase: this.phase, air: !this.grounded, time: g.time, swing: this.swingBlend });
    if (this.dead) this.rig.holder.rotation.x = Math.min(1.5, this.rig.holder.rotation.x + real * 6);
    else this.rig.holder.rotation.x = 0;
    this.rig.setVisible(this.inv <= 0 || this.dead || Math.floor(g.time * 18) % 2 === 0);

    // カメラ: 注視点はキャラに密着させない。縦の追従は弱め、進む方向へ少し先回りする
    const cam = g.engine.camera;
    const sy = Math.sin(this.camYaw);
    const cy = Math.cos(this.camYaw);
    const tx = this.pos.x + this.velX * 0.14 - cy * 0.45;
    const tz = this.pos.z + this.velZ * 0.14 + sy * 0.45;
    const ty = this.pos.y + TUNE.cameraHeight;
    const k = Math.min(1, real * 12);
    this.camTarget.x += (tx - this.camTarget.x) * k;
    this.camTarget.z += (tz - this.camTarget.z) * k;
    // 高さは遅れを 0.8m までに抑える（落下や打ち上げで、真上や真下から映さないように）
    this.camTarget.y = camFollowY(this.camTarget.y, ty, real);
    const dirOf = (pitch: number) => {
      const c = Math.cos(pitch);
      return { x: -sy * c, y: Math.sin(pitch), z: -cy * c };
    };
    // 後ろが崖や壁なら、近づける前に、まず上へ持ち上げて見通しを確保する
    const want = camLiftSearch(this.camPitch, (pitch) => g.physics.raycast(this.camTarget, dirOf(pitch), TUNE.cameraDist + 0.3, G.STATIC | G.CHUNK)?.dist ?? Infinity, TUNE.cameraDist);
    this.camLift += (want.lift - this.camLift) * Math.min(1, real * (want.lift > this.camLift ? 6 : 2.5));
    const d = dirOf(this.camPitch + this.camLift);
    let dist = TUNE.cameraDist;
    const hit = g.physics.raycast(this.camTarget, d, dist + 0.3, G.STATIC | G.CHUNK);
    if (hit) dist = Math.max(1.3, hit.dist - 0.3);
    const cx = this.camTarget.x + d.x * dist;
    const cz = this.camTarget.z + d.z * dist;
    // 地面の下に入らないようにする（基準は海抜 0 ではなく、その場所の地面の高さ）
    cam.position.set(cx, camFloorY(this.camTarget.y + d.y * dist, g.world.groundY(cx, cz)), cz);
    cam.lookAt(this.camTarget.x + sy * 2.2, this.camTarget.y - 0.1, this.camTarget.z + cy * 2.2);
    const fov = 62 + (this.dashT > 0 ? 7 : 0);
    if (Math.abs(cam.fov - fov) > 0.05) {
      cam.fov += (fov - cam.fov) * Math.min(1, real * 10);
      cam.updateProjectionMatrix();
    }
    g.fx.applyShake(cam);
  }

  dispose(): void {
    this.g.fx.removeTrail(this.trail);
    this.rig.dispose();
  }
}

export type { Enemy };
