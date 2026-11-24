import { G, G_ALL, groups, RAPIER } from '../core/physics';
import { V3 } from '../core/vec';
import { log } from '../log';
import type { Enemy } from './enemies';
import { ZONE } from './fx';
import type { Game } from './game';
import type { SkillInst, Skills } from './skills';
import { Prop, PROPS } from './world';

type Handler = (s: SkillInst, dt: number) => void;
type SpawnOpts = { vel?: V3; life?: number; scale?: number; sleep?: boolean; dmgMul?: number; hot?: number; spin?: boolean };

/** 小物の向き: 地面に平行な向き dir に、小物の正面（+Z）を合わせる回転。 */
function yawOf(dir: { x: number; z: number }): number {
  return Math.atan2(dir.x, dir.z);
}

/** 平面での正規化。長さ 0 なら fallback。 */
function norm2(x: number, z: number, fx = 0, fz = 1): { x: number; z: number } {
  const d = Math.hypot(x, z);
  return d > 1e-4 ? { x: x / d, z: z / d } : { x: fx, z: fz };
}

/**
 * 第 2 弾の攻撃スキルのうち、本物の形の物体（NVIDIA USDCraft-10K を変換したもの）を使うもの。
 * 物体を出す・壊す・関節を動かす処理は spawnU・shatter・joint にまとめてある。
 */
export class UsdSkills {
  /** ドローン部のドローン（スキルを手放したときに片付けるため、ここでも持つ） */
  private drones: { p: Prop | null; a: number; fire: number }[] = [];

  constructor(private g: Game, private k: Skills) {}

  handlers(): Record<string, Handler> {
    return {
      piano: (s) => this.piano(s),
      forklift: (s) => this.forklift(s),
      lockers: (s) => this.lockers(s),
      merrygo: (s) => this.merrygo(s),
      gascyl: (s) => this.gascyl(s),
      carts: (s) => this.carts(s),
      seesaw: (s) => this.seesaw(s),
      drums: (s) => this.drums(s),
      drone: (s, dt) => this.drone(s, dt),
    };
  }

  // ---------------------------------------------------------------- World の USD 小物の操作
  /** 小物を出す。モデルの定義が無ければ null（スキルは何もしない）。pos は底面の中心。 */
  private spawnU(id: string, pos: V3, yaw: number, opts: SpawnOpts = {}): Prop | null {
    if (!PROPS[id]) return null;
    return this.g.world.spawnProp(id, pos, yaw, opts);
  }

  /** 部品ごとにばらばらにする（部品は当たると敵にダメージ）。 */
  private shatter(p: Prop, dv?: V3): void {
    if (p.alive) this.g.world.shatter(p, dv);
  }

  /** 関節を目標へ動かす。名前は関節か部品の名前の一部。扉・昇降は角度（rad）か距離（m）、回り続ける関節は回る速さ（rad/s）。 */
  private joint(p: Prop, name: string, target: number): void {
    if (p.alive) this.g.world.driveJoint(p, name, target);
  }

  /** 関節に速さを足す（扉がばたつく・鍵盤が沈む）。 */
  private kick(p: Prop, name: string, dv: number): void {
    if (p.alive) this.g.world.kickJoint(p, name, dv);
  }

  /** 物理で動かず、プレイヤーにも当たらない置き物にする（敵は止める）。 */
  private pin(p: Prop, ghostPlayer: boolean): void {
    p.body.setBodyType(RAPIER.RigidBodyType.Fixed, true);
    p.rooted = true;
    if (ghostPlayer) p.col.setCollisionGroups(groups(G.PROP, G_ALL & ~G.PLAYER));
  }

  private gy(x: number, z: number): number {
    return this.g.world.groundY(x, z);
  }

  // ---------------------------------------------------------------- 音楽室のピアノ（落とし物 + LoL ソナの音符）
  private piano(s: SkillInst): void {
    const g = this.g;
    const k = this.k;
    const L = s.level;
    const E = !!s.evolved;
    const c = k.aim(20);
    if (!c) {
      s.cd = 0.5;
      return;
    }
    s.cd = k.cdOf(E ? 9 : 11 - 0.5 * L);
    const drops = E ? 2 : 1;
    for (let d = 0; d < drops; d++) {
      const a = Math.random() * Math.PI * 2;
      const x = c.x + (d ? Math.cos(a) * 3.5 : 0);
      const z = c.z + (d ? Math.sin(a) * 3.5 : 0);
      const gy = this.gy(x, z);
      g.fx.ring({ x, y: gy + 0.1, z }, 0.5, 3.2, ZONE.ally, 0.8, 0.7);
      const p = this.spawnU('u_piano', { x, y: gy + 10 + d * 2, z }, Math.random() * Math.PI * 2, { vel: { x: 0, y: -16, z: 0 }, hot: 4, dmgMul: 3 });
      if (!p) continue;
      let t = 0;
      let landed = false;
      let tick = 0;
      let ang = Math.random() * 6;
      k.addTask({
        update: (dt) => {
          if (!p.alive) return false;
          t += dt;
          const tr = p.body.translation();
          if (!landed) {
            const vy = p.body.linvel().y;
            if ((t > 0.15 && vy > -1.5) || t > 2.5) {
              landed = true;
              t = 0;
              const R = k.area(3.5);
              g.enemies.inRadius({ x: tr.x, y: tr.y, z: tr.z }, R, (e) => {
                const n = norm2(e.x - tr.x, e.z - tr.z);
                k.hit(e, 30 + 12 * L, { x: n.x * 8, y: 6, z: n.z * 8 });
              });
              g.fx.ring({ x: tr.x, y: this.gy(tr.x, tr.z) + 0.1, z: tr.z }, 0.5, R, ZONE.ally, 0.4, 0.8);
              g.fx.shake('M');
              g.audio.thud(1);
              g.audio.chime();
              this.joint(p, 'fallboard', 1.6);
            }
            return true;
          }
          // ひとりでに鳴って、音符を四方へ飛ばす
          tick -= dt;
          if (tick <= 0 && t < 2.5) {
            tick = 0.22;
            const n = 2 + Math.floor(L / 2) + (E ? 1 : 0) + g.stats.amount;
            for (let i = 0; i < n; i++) {
              const b = ang + (i * Math.PI * 2) / n;
              const tgt = E ? g.enemies.nearest({ x: tr.x + Math.sin(b) * 4, y: tr.y, z: tr.z + Math.cos(b) * 4 }, 10) : null;
              g.projectiles.fire({ emoji: Math.random() < 0.5 ? '🎵' : '🎶', size: 0.7, pos: { x: tr.x, y: tr.y + 0.7, z: tr.z }, vel: { x: Math.sin(b) * 12, y: 1.2, z: Math.cos(b) * 12 }, r: 0.4, dmg: 10 + 4 * L, life: 1.1, pierce: 1, knock: 2, homing: E ? 5 : 0, target: tgt });
            }
            ang += 0.35;
            this.kick(p, 'key', -0.4);
            g.audio.pop();
          }
          if (t < 2.6) return true;
          this.shatter(p, { x: 0, y: 6, z: 0 });
          return false;
        },
        dispose: () => this.shatter(p),
      });
    }
  }

  // ---------------------------------------------------------------- フォークリフト暴走（LoL シオンの R）
  private forklift(s: SkillInst): void {
    const g = this.g;
    const k = this.k;
    const L = s.level;
    const E = !!s.evolved;
    const c = k.aim(22);
    if (!c) {
      s.cd = 0.5;
      return;
    }
    s.cd = k.cdOf(E ? 8 : 10 - 0.5 * L);
    const pp = g.player.pos;
    const f = k.forward();
    const base = norm2(c.x - pp.x, c.z - pp.z, f.x, f.z);
    const lanes = E ? 2 : 1;
    for (let li = 0; li < lanes; li++) {
      const rot = E ? (li === 0 ? 0.6 : -0.6) : 0;
      const dir = { x: base.x * Math.cos(rot) - base.z * Math.sin(rot), z: base.x * Math.sin(rot) + base.z * Math.cos(rot) };
      const sx = c.x - dir.x * 11;
      const sz = c.z - dir.z * 11;
      const p = this.spawnU('u_forklift', { x: sx, y: this.gy(sx, sz) + 0.05, z: sz }, yawOf(dir), { hot: 3, dmgMul: 1.5 });
      if (!p) continue;
      p.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
      p.rooted = true;
      const half = p.half;
      const speed = 11 + L;
      const scooped = new Set<Enemy>();
      let t = 0;
      let x = sx;
      let z = sz;
      g.audio.horn();
      k.addTask({
        update: (dt) => {
          if (!p.alive) return false;
          t += dt;
          x += dir.x * speed * dt;
          z += dir.z * speed * dt;
          p.body.setNextKinematicTranslation({ x, y: this.gy(x, z) + half.y + 0.05, z });
          this.joint(p, 'fork_lift', Math.min(1.2, t * 0.8));
          // フォークの先にいる敵をすくい上げて放り投げる
          const fx = x + dir.x * (half.z + 0.5);
          const fz = z + dir.z * (half.z + 0.5);
          for (const e of g.enemies.list) {
            if (e.state === 'dead' || scooped.has(e) || Math.hypot(e.x - fx, e.z - fz) > 1.8 + half.x * 0.5) continue;
            scooped.add(e);
            k.hit(e, 12 + 5 * L, { x: dir.x * 8, y: 4, z: dir.z * 8 });
            g.enemies.launch(e, { x: dir.x * (6 + (E ? 4 : 0)), y: 11 + 1.2 * L + (E ? 4 : 0), z: dir.z * (6 + (E ? 4 : 0)) });
          }
          if (Math.random() < dt * 20) g.fx.dust({ x, y: this.gy(x, z) + 0.1, z }, 1, 0xcbb89a, 1);
          if (t < 2.4) return true;
          if (scooped.size >= 6) k.comboLog('forklift.many', { n: scooped.size });
          p.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
          this.shatter(p, { x: dir.x * 4, y: 3, z: dir.z * 4 });
          return false;
        },
        dispose: () => this.shatter(p),
      });
    }
  }

  // ---------------------------------------------------------------- ロッカーの闘技場（LoL ジャーヴァン IV の R・Dota マーズのアリーナ）
  private lockers(s: SkillInst): void {
    const g = this.g;
    const k = this.k;
    const L = s.level;
    const E = !!s.evolved;
    const pp = g.player.pos;
    if (!g.enemies.nearest(pp, 10)) {
      s.cd = 0.5;
      return;
    }
    s.cd = k.cdOf(E ? 16 : 20 - 0.8 * L);
    const cx = pp.x;
    const cz = pp.z;
    const R = k.area(E ? 7.5 : 5.5);
    const n = Math.min(52, Math.ceil((Math.PI * 2 * R) / 0.95));
    const ring: Prop[] = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const x = cx + Math.cos(a) * R;
      const z = cz + Math.sin(a) * R;
      // 扉（正面）を輪の内側へ向ける
      const p = this.spawnU('u_locker', { x, y: this.gy(x, z), z }, yawOf({ x: cx - x, z: cz - z }), {});
      if (!p) break;
      this.pin(p, true);
      ring.push(p);
    }
    if (!ring.length) return;
    g.audio.thud(1);
    g.fx.ring({ x: cx, y: pp.y + 0.1, z: cz }, R - 0.4, R + 0.4, ZONE.ally, 0.6, 0.8);
    const dur = 6 + 0.5 * L;
    const gap = E ? 0.5 : 1;
    let t = 0;
    let slam = 0.6;
    let hits = 0;
    k.addTask({
      update: (dt) => {
        t += dt;
        slam -= dt;
        if (slam <= 0 && t < dur) {
          slam = gap;
          // 3 つに 1 つのロッカーの扉が開いて、近くの敵をはたく
          for (const p of ring) {
            if (!p.alive || Math.random() > 0.34) continue;
            this.kick(p, 'door', 7);
            const tr = p.body.translation();
            const inx = (cx - tr.x) / R;
            const inz = (cz - tr.z) / R;
            g.enemies.inRadius({ x: tr.x + inx * 0.8, y: tr.y, z: tr.z + inz * 0.8 }, 1.6, (e) => {
              k.hit(e, 15 + 6 * L, { x: inx * 6, y: 3, z: inz * 6 });
              hits++;
            });
          }
          g.audio.clank();
        }
        if (t < dur) return true;
        // 終わり: 外へ倒れて壊れる
        let i = 0;
        for (const p of ring) {
          if (!p.alive) continue;
          const tr = p.body.translation();
          const ox = (tr.x - cx) / R;
          const oz = (tr.z - cz) / R;
          p.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
          p.rooted = false;
          if (E || i++ % 3 === 0) this.shatter(p, { x: ox * (E ? 9 : 5), y: 4, z: oz * (E ? 9 : 5) });
          else {
            p.body.applyImpulse({ x: ox * p.mass * 3, y: p.mass * 1.5, z: oz * p.mass * 3 }, true);
            p.life = 2.5;
            g.world.heat(p, 2);
          }
        }
        log('skill.lockers', { n: ring.length }, { hits, time: Math.round(g.time) });
        return false;
      },
      dispose: () => {
        for (const p of ring) if (p.alive && p.rooted) g.world.removeProp(p);
      },
    });
  }

  // ---------------------------------------------------------------- 回転遊具（Dota ジャガーノートのブレードフューリー）
  private merrygo(s: SkillInst): void {
    const g = this.g;
    const k = this.k;
    const L = s.level;
    const E = !!s.evolved;
    const c = k.aim(16);
    if (!c) {
      s.cd = 0.5;
      return;
    }
    s.cd = k.cdOf(E ? 9 : 11 - 0.5 * L);
    const scale = E ? 1.6 : 1;
    const gy = this.gy(c.x, c.z);
    const p = this.spawnU('u_merrygo', { x: c.x, y: gy, z: c.z }, 0, { scale });
    const plat = (p ? Math.max(p.half.x, p.half.z) : 1.2) + 0.5;
    const pull = k.area(5) * scale;
    const dur = 4 + 0.4 * L;
    const fling = (8 + L) * (E ? 2 : 1);
    let t = 0;
    let tick = 0;
    let flung = 0;
    if (p) this.joint(p, 'hub', E ? 7 : 5);
    g.audio.whoosh();
    k.addTask({
      update: (dt) => {
        t += dt;
        tick -= dt;
        if (tick <= 0) {
          tick = 0.15;
          g.enemies.inRadius({ x: c.x, y: gy, z: c.z }, pull, (e, d) => {
            if (e.def.boss) return;
            const rx = (e.x - c.x) / (d || 1);
            const rz = (e.z - c.z) / (d || 1);
            if (d > plat) {
              // 吸い寄せる
              g.enemies.push(e, { x: -rx * 2.2, y: 0, z: -rz * 2.2 });
            } else {
              // 回る勢いで外へ放り出す
              g.enemies.push(e, { x: -rz * fling + rx * 6, y: 3, z: rx * fling + rz * 6 });
              k.hit(e, 5 + 2 * L, undefined, true);
              flung++;
            }
          });
          if (Math.random() < 0.5) g.fx.ring({ x: c.x, y: gy + 0.1, z: c.z }, plat * 0.6, plat, ZONE.ally, 0.2, 0.4);
        }
        if (t < dur) return true;
        if (flung >= 10) k.comboLog('merrygo.many', { n: flung });
        if (p) this.shatter(p, { x: 0, y: 4, z: 0 });
        return false;
      },
      dispose: () => {
        if (p) this.shatter(p);
      },
    });
  }

  // ---------------------------------------------------------------- ガスボンベ・ロケット（LoL ジンクスの R・Dota ジャイロコプターのホーミングミサイル）
  private gascyl(s: SkillInst): void {
    const g = this.g;
    const k = this.k;
    const L = s.level;
    const E = !!s.evolved;
    const pp = g.player.pos;
    if (!g.enemies.nearest(pp, 18)) {
      s.cd = 0.5;
      return;
    }
    s.cd = k.cdOf(5 - 0.25 * L);
    const n = 1 + g.stats.amount;
    const f = k.forward();
    for (let i = 0; i < n; i++) {
      const side = (i - (n - 1) / 2) * 1.2;
      this.rocket({ x: pp.x - f.z * side + f.x, y: pp.y + 0.8, z: pp.z + f.x * side + f.z }, { x: f.x * 8, y: 4, z: f.z * 8 }, 1, L, E, 2.2);
    }
    g.audio.whoosh();
  }

  /** ガスボンベを飛ばす。scale は大きさ（小さいボンベは 0.6）、life は爆発するまでの秒数。 */
  private rocket(pos: V3, vel: V3, scale: number, L: number, E: boolean, life: number): void {
    const g = this.g;
    const k = this.k;
    const p = this.spawnU('u_gascyl', pos, Math.random() * Math.PI * 2, { vel, spin: true, hot: 3, dmgMul: 2, scale });
    if (!p) return;
    let t = 0;
    const wob = Math.random() * 6;
    this.joint(p, 'handwheel', 25);
    const boom = () => {
      const tr = p.body.translation();
      const at = { x: tr.x, y: tr.y, z: tr.z };
      if (p.alive) g.world.removeProp(p);
      g.explode(at, k.area((3.5 + 0.2 * L) * scale), (30 + 10 * L) * scale, { source: 'skill', force: 14, struct: 20 * scale, element: 'fire' });
      if (E && scale >= 1) {
        for (let j = 0; j < 3; j++) {
          const a = Math.random() * Math.PI * 2;
          this.rocket({ x: at.x, y: at.y + 0.5, z: at.z }, { x: Math.cos(a) * 7, y: 6, z: Math.sin(a) * 7 }, 0.6, L, E, 0.8 + Math.random() * 0.5);
        }
      }
    };
    k.addTask({
      update: (dt) => {
        if (!p.alive) return false;
        t += dt;
        const tr = p.body.translation();
        // 近い敵へ向かって、ふらふら加速する
        const e = g.enemies.nearest({ x: tr.x, y: tr.y, z: tr.z }, 16);
        const dir = e ? norm2(e.x - tr.x, e.z - tr.z) : norm2(Math.cos(t * 3 + wob), Math.sin(t * 3 + wob));
        const w = Math.sin(t * 9 + wob) * 0.6;
        const ax = dir.x * Math.cos(w) - dir.z * Math.sin(w);
        const az = dir.x * Math.sin(w) + dir.z * Math.cos(w);
        const m = p.mass;
        p.body.applyImpulse({ x: ax * m * 26 * dt, y: m * (tr.y - this.gy(tr.x, tr.z) < 1.2 ? 14 : 4) * dt, z: az * m * 26 * dt }, true);
        if (Math.random() < dt * 40) g.fx.spawn({ pos: { x: tr.x, y: tr.y, z: tr.z }, vel: { x: -ax * 2, y: 0.5, z: -az * 2 }, life: 0.5, size: 0.3 * scale, size2: 0.7 * scale, color: 0xd8d8d8, shape: 0, alpha: 0.7 });
        const hitE = e && Math.hypot(e.x - tr.x, e.z - tr.z) < 1.1 + 0.4 * scale;
        if (!hitE && t < life) return true;
        boom();
        return false;
      },
      dispose: () => {
        if (p.alive) g.world.removeProp(p);
      },
    });
  }

  // ---------------------------------------------------------------- 閉店セール（Dota クンカのゴーストシップ）
  private carts(s: SkillInst): void {
    const g = this.g;
    const k = this.k;
    const L = s.level;
    const E = !!s.evolved;
    const c = k.aim(20);
    if (!c) {
      s.cd = 0.5;
      return;
    }
    s.cd = k.cdOf(7 - 0.3 * L);
    const pp = g.player.pos;
    const toC = norm2(c.x - pp.x, c.z - pp.z);
    // ノリコから見て横切る向き
    const lanes = E ? [{ x: -toC.z, z: toC.x }, { x: toC.x, z: toC.z }] : [{ x: -toC.z, z: toC.x }];
    const per = (3 + L + g.stats.amount) * (E ? 2 : 1);
    for (const dir of lanes) {
      const side = Math.random() < 0.5 ? 1 : -1;
      const sx = c.x + dir.z * 3 * side;
      const sz = c.z - dir.x * 3 * side;
      const sig = this.spawnU('u_signal', { x: sx, y: this.gy(sx, sz), z: sz }, yawOf(dir), { life: 4 });
      if (sig) this.pin(sig, true);
      let t = 0;
      let made = 0;
      let next = 0.8;
      k.addTask({
        update: (dt) => {
          t += dt;
          if (t > 0.6 && t < 0.9 && sig?.alive) {
            const tr = sig.body.translation();
            g.fx.sparkle({ x: tr.x, y: tr.y + 1.2, z: tr.z }, 0xff2a2a, 2, 0.2);
          }
          if (t < next) return true;
          if (made >= Math.ceil(per / lanes.length)) return false;
          next = t + 0.16;
          const off = (Math.random() - 0.5) * 2.4;
          const x = c.x - dir.x * 14 + -dir.z * off;
          const z = c.z - dir.z * 14 + dir.x * off;
          const cart = this.spawnU('u_cart', { x, y: this.gy(x, z) + 0.05, z }, yawOf(dir), { vel: { x: dir.x * (15 + L), y: 0, z: dir.z * (15 + L) }, hot: 3.5, dmgMul: 2.5, life: 4 });
          if (cart) made++;
          else return false;
          return true;
        },
      });
    }
    g.audio.horn();
  }

  // ---------------------------------------------------------------- シーソー・カタパルト（Dota タイニーのトス）
  private seesaw(s: SkillInst): void {
    const g = this.g;
    const k = this.k;
    const L = s.level;
    const E = !!s.evolved;
    const c = k.aim(18);
    if (!c) {
      s.cd = 0.5;
      return;
    }
    s.cd = k.cdOf(9 - 0.4 * L);
    const pp = g.player.pos;
    const dir = norm2(c.x - pp.x, c.z - pp.z);
    const fb = PROPS.u_seesaw?.fallback ?? [3.6, 0.6, 0.4, 0];
    // 板の長い向き（モデルの X か Z）を dir に合わせる
    const alongX = fb[0] >= fb[2];
    const len = Math.max(fb[0], fb[2]);
    const yaw = alongX ? Math.atan2(-dir.z, dir.x) : yawOf(dir);
    const cx = c.x - dir.x * len * 0.42;
    const cz = c.z - dir.z * len * 0.42;
    const far = { x: cx + dir.x * len * 0.42, z: cz + dir.z * len * 0.42 };
    const near = { x: cx - dir.x * len * 0.42, z: cz - dir.z * len * 0.42 };
    const saw = this.spawnU('u_seesaw', { x: cx, y: this.gy(cx, cz), z: cz }, yaw, { life: 4 });
    if (saw) {
      this.pin(saw, true);
      // はじめは群れの側（遠い端）が下がっている
      this.joint(saw, 'pivot', 0.35);
    }
    g.fx.ring({ x: far.x, y: this.gy(far.x, far.z) + 0.1, z: far.z }, 0.4, k.area(2.6), ZONE.ally, 0.7, 0.7);
    let t = 0;
    let bell: Prop | null = null;
    let fired = false;
    let flying: Enemy[] = [];
    k.addTask({
      update: (dt) => {
        t += dt;
        if (!bell && t > 0.3) {
          bell = this.spawnU('u_dumbbell', { x: near.x, y: this.gy(near.x, near.z) + 7, z: near.z }, yaw, { vel: { x: 0, y: -12, z: 0 }, hot: 2, dmgMul: 2, life: 4 });
          if (!bell) t = 1.2;
        }
        if (!fired) {
          const landed = bell ? t > 0.5 && (bell.body.linvel().y > -1.5 || bell.body.translation().y < this.gy(near.x, near.z) + 0.8) : t > 1.2;
          if (!landed && t < 2) return true;
          fired = true;
          if (saw) this.joint(saw, 'pivot', -0.35);
          const R = k.area(2.6);
          g.enemies.inRadius({ x: far.x, y: this.gy(far.x, far.z), z: far.z }, R, (e) => {
            k.hit(e, 10 + 4 * L, undefined, true);
            g.enemies.launch(e, { x: dir.x * 3, y: 15 + 1.5 * L + (E ? 8 : 0), z: dir.z * 3 });
            flying.push(e);
          });
          g.fx.shake('S');
          g.audio.boing();
          if (flying.length >= 5) k.comboLog('seesaw.many', { n: flying.length });
          if (!E) return false;
          t = 0;
          return true;
        }
        // シーソーの大砲: 打ち上げた敵が落ちた所で爆発
        flying = flying.filter((e) => {
          if (!e.alive || t < 0.5) return e.alive;
          if (e.state === 'knock' && e.y - this.gy(e.x, e.z) > e.halfH + e.radius + 0.6) return true;
          g.explode({ x: e.x, y: e.y, z: e.z }, k.area(2.4), 20 + 6 * L, { source: 'skill', force: 9, struct: 6, small: true });
          return false;
        });
        return flying.length > 0 && t < 5;
      },
    });
  }

  // ---------------------------------------------------------------- 軽音部のドラム（LoL ソナのパワーコード・PoE のアフターショック）
  private drums(s: SkillInst): void {
    const g = this.g;
    const k = this.k;
    const L = s.level;
    const E = !!s.evolved;
    const pp = g.player.pos;
    if (!g.enemies.nearest(pp, 14)) {
      s.cd = 0.5;
      return;
    }
    s.cd = k.cdOf(14 - 0.6 * L);
    const f = k.forward();
    const x = pp.x - f.x * 1.8;
    const z = pp.z - f.z * 1.8;
    const p = this.spawnU('u_drums', { x, y: this.gy(x, z), z }, yawOf({ x: f.x, z: f.z }), {});
    if (p) this.pin(p, true);
    const dur = 6 + 0.5 * L;
    const beat = E ? 0.3 : 0.5;
    let t = 0;
    let next = 0.2;
    let count = 0;
    k.addTask({
      update: (dt) => {
        t += dt;
        if (t < next) return true;
        if (t > dur) return false;
        next += beat;
        count++;
        const big = count % 4 === 0;
        const tr = p?.alive ? p.body.translation() : { x, y: this.gy(x, z), z };
        const cy = this.gy(tr.x, tr.z);
        const R = k.area((4 + 0.3 * L) * (big ? 1.5 : 1));
        g.fx.ring({ x: tr.x, y: cy + 0.1, z: tr.z }, R * 0.2, R, ZONE.ally, 0.25, big ? 0.8 : 0.45);
        g.enemies.inRadius({ x: tr.x, y: cy, z: tr.z }, R, (e, d) => {
          const n = norm2(e.x - tr.x, e.z - tr.z);
          const kb = big ? 8 : 3;
          k.hit(e, (8 + 3 * L) * (big ? 3 : 1), { x: n.x * kb, y: big && E ? 8 : 1, z: n.z * kb }, !big);
          if (big && e.alive && e.state !== 'dead') e.stagger = Math.max(e.stagger, e.def.boss ? 0.2 : 0.6);
          void d;
        });
        if (p) this.kick(p, big ? 'crash' : 'hihat', 6);
        g.audio.thud(big ? 1 : 0.45);
        return true;
      },
      dispose: () => {
        if (p?.alive) this.shatter(p, { x: 0, y: 3, z: 0 });
      },
    });
  }

  // ---------------------------------------------------------------- ドローン部（PoE の召喚・LoL ハイマーディンガーの砲台）
  private drone(s: SkillInst, dt: number): void {
    const g = this.g;
    const k = this.k;
    const L = s.level;
    const E = !!s.evolved;
    // 毎フレーム動かす（待ち時間 0）
    s.cd = 0;
    const pp = g.player.pos;
    const want = Math.min(6, E ? 6 : 1 + Math.floor(L / 2) + g.stats.amount);
    this.drones = this.drones.filter((d) => d.p?.alive);
    while (this.drones.length < want) {
      const p = this.spawnU('u_drone', { x: pp.x, y: pp.y + 2.4, z: pp.z }, 0, {});
      if (!p) return;
      p.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
      p.rooted = true;
      p.col.setCollisionGroups(groups(G.PROP, 0));
      this.drones.push({ p, a: Math.random() * Math.PI * 2, fire: 0.3 + this.drones.length * 0.15 });
    }
    const gap = E ? 0.45 : 0.9 - 0.08 * L;
    const n = this.drones.length;
    for (let i = 0; i < n; i++) {
      const d = this.drones[i];
      const p = d.p!;
      d.a += dt * 1.6;
      const a = d.a + (i * Math.PI * 2) / n;
      const pos = { x: pp.x + Math.cos(a) * 2.3, y: pp.y + 2.5 + Math.sin(g.time * 3 + i) * 0.2, z: pp.z + Math.sin(a) * 2.3 };
      p.body.setNextKinematicTranslation(pos);
      d.fire -= dt;
      if (d.fire > 0) continue;
      const e = g.enemies.nearest(pos, 14);
      if (!e) {
        d.fire = 0.2;
        continue;
      }
      d.fire = gap;
      g.fx.bolt(pos, { x: e.x, y: e.y + 0.4, z: e.z }, 0x5ad8ff, 0.12, 0, 0.1);
      k.hit(e, 8 + 3 * L, undefined, true);
    }
    // ドローン編隊: ときどき 1 台が群れへ突っ込んで爆発する
    if (!E) return;
    s.st.kam = (s.st.kam ?? 6) - dt;
    if (s.st.kam > 0 || !n) return;
    const c = g.enemies.cluster(pp, 16);
    if (!c) return;
    s.st.kam = 6;
    const d = this.drones.shift()!;
    const p = d.p!;
    const from = p.body.translation();
    const to = { x: c.x, y: this.gy(c.x, c.z) + 0.5, z: c.z };
    let t = 0;
    k.addTask({
      update: (dt2) => {
        t += dt2;
        const u = Math.min(1, t / 0.5);
        if (p.alive) p.body.setNextKinematicTranslation({ x: from.x + (to.x - from.x) * u, y: from.y + (to.y - from.y) * u, z: from.z + (to.z - from.z) * u });
        if (u < 1) return true;
        if (p.alive) g.world.removeProp(p);
        g.explode(to, k.area(3.2), 35 + 10 * L, { source: 'skill', force: 12, struct: 10, element: 'fire' });
        return false;
      },
      dispose: () => {
        if (p.alive) g.world.removeProp(p);
      },
    });
  }

  /** ドローン部を手放した・登校が終わったとき。 */
  dispose(): void {
    for (const d of this.drones) if (d.p?.alive) this.g.world.removeProp(d.p);
    this.drones.length = 0;
  }

  /** ドローン部を持っていないのにドローンが残っていたら片付ける。 */
  update(): void {
    if (this.drones.length && !this.k.get('drone')) this.dispose();
  }
}
