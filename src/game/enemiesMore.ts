import { G, RAPIER } from '../core/physics';
import { log } from '../log';
import type { Enemy, EnemyManager } from './enemies';
import { ZONE } from './fx';
import type { Game } from './game';
import { ARENA } from './world';

/** 歩く向きと速さの倍率。null のときは、ふつうの歩き（速度の設定）をしない。 */
type Steer = { tx: number; tz: number; speed: number } | null;

/**
 * 2 面・3 面の敵とボスの行動。EnemyManager の歩きの処理から呼ぶ。
 * - 暴走ルンバ / ルンバの女王: 一直線に突っ込む
 * - 偵察ドローン: 浮いて回りこみ、急降下する
 * - 暴走自販機 / 自販機の王様: 缶を撃つ・缶の雨
 * - 忍者テロリスト / 忍者頭領: 煙とともに横へ回りこむ
 * - 応援団員 / 応援団総長: まわりの敵を回復・強化する
 * - ヒグマ戦車（2 面のラスボス）・真・合体怪人（3 面のラスボス）
 */
export class MoreEnemies {
  constructor(
    private g: Game,
    private m: EnemyManager,
  ) {}

  act(e: Enemy, dt: number, dist: number, tx: number, tz: number): Steer {
    switch (e.def.behavior) {
      case 'roomba':
        return this.roomba(e, dt, tx, tz);
      case 'roombaq':
        return this.roombaQueen(e, dt, dist, tx, tz);
      case 'drone':
        return this.drone(e, dt, dist, tx, tz);
      case 'vending':
        return this.vending(e, dt, dist, tx, tz);
      case 'vendking':
        return this.vendKing(e, dt, dist, tx, tz);
      case 'blink':
        return this.blink(e, dt, dist, tx, tz);
      case 'ninjaboss':
        return this.ninjaBoss(e, dt, dist, tx, tz);
      case 'cheer':
        return this.cheer(e, dt, dist, tx, tz);
      case 'cheerboss':
        return this.cheerBoss(e, dt, dist, tx, tz);
      case 'tankbear':
        return this.tankBear(e, dt, dist, tx, tz);
      case 'chimera3':
        return this.chimera3(e, dt, dist, tx, tz);
    }
    return { tx, tz, speed: 1 };
  }

  // ---------------------------------------------------------------- 共通
  /** 敵を (x, z) へ移す。建物に重なる・場外のときは移さない。移せたら true。 */
  private teleport(e: Enemy, x: number, z: number): boolean {
    const g = this.g;
    x = Math.max(-ARENA + 2, Math.min(ARENA - 2, x));
    z = Math.max(-ARENA + 2, Math.min(ARENA - 2, z));
    if (!g.world.spawnOk(x, z)) return false;
    let blocked = false;
    const gy = g.world.groundY(x, z);
    // 建物と崖だけを見る（机などの小道具は、現れたときに押しのける）
    g.physics.querySphere({ x, y: gy + e.halfH + e.radius + 0.1, z }, e.radius + 0.1, G.STATIC | G.CHUNK, () => {
      blocked = true;
    });
    if (blocked) return false;
    g.fx.poof({ x: e.x, y: e.y, z: e.z }, e.radius * 3, 0x55555f);
    e.body.setTranslation({ x, y: gy + e.halfH + e.radius + 0.1, z }, true);
    e.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    e.x = x;
    e.y = gy + e.halfH + e.radius + 0.1;
    e.z = z;
    g.fx.poof({ x, y: e.y, z }, e.radius * 3, 0x55555f);
    return true;
  }

  /** ノリコのまわり、向いている方向の横か後ろの場所（忍者が回りこむ先）。e がいれば、e から遠い場所を先にする。 */
  private flank(r: number, e?: Enemy): { x: number; z: number }[] {
    const p = this.g.player;
    const out: { x: number; z: number }[] = [];
    for (const a of [Math.PI * 0.6, -Math.PI * 0.6, Math.PI, Math.PI * 0.35, -Math.PI * 0.35]) {
      const yaw = p.yaw + a + (Math.random() - 0.5) * 0.4;
      out.push({ x: p.pos.x + Math.sin(yaw) * r, z: p.pos.z + Math.cos(yaw) * r });
    }
    if (e) out.sort((u, v) => Math.hypot(v.x - e.x, v.z - e.z) - Math.hypot(u.x - e.x, u.z - e.z));
    return out;
  }

  /** 缶などの弾を、ノリコの方向から yaw だけずらして撃つ。 */
  private can(e: Enemy, yaw: number, emoji = '🥫', dmgMul = 1): void {
    this.g.projectiles.enemyShot(e, false, yaw, { emoji, dmgMul, size: 0.7 });
  }

  // ---------------------------------------------------------------- 暴走ルンバ
  /** 少し止まって向きを決め、その方向へまっすぐ走る。走っている間は曲がらない。 */
  private roomba(e: Enemy, dt: number, tx: number, tz: number): Steer {
    const w = e.w;
    w.go = (w.go ?? Math.random()) - dt;
    if (e.aiState === 0) {
      if (w.go <= 0) {
        e.aiState = 1;
        const j = (Math.random() - 0.5) * 0.5;
        const c = Math.cos(j);
        const s = Math.sin(j);
        w.dx = tx * c - tz * s;
        w.dz = tx * s + tz * c;
        w.go = 1.3 + Math.random() * 0.6;
      }
      return { tx, tz, speed: 0.35 };
    }
    if (w.go <= 0) {
      e.aiState = 0;
      w.go = 0.35;
    }
    return { tx: w.dx, tz: w.dz, speed: 1.35 };
  }

  /** ルンバの女王: 赤い線で予告して、一直線に突っ込む。走りながら手下のルンバを落とし、3 回に 1 回は手下を放つ。 */
  private roombaQueen(e: Enemy, dt: number, dist: number, tx: number, tz: number): Steer {
    const g = this.g;
    const w = e.w;
    e.ai -= dt;
    if (e.aiState === 0) {
      if (e.ai <= 0 && dist < 34) {
        e.aiState = 1;
        e.ai = 0.95;
        w.dx = tx;
        w.dz = tz;
        const len = Math.min(40, dist + 12);
        const gy = g.world.groundY(e.x, e.z) + 0.15;
        g.fx.bolt({ x: e.x, y: gy, z: e.z }, { x: e.x + tx * len, y: g.world.groundY(e.x + tx * len, e.z + tz * len) + 0.15, z: e.z + tz * len }, 0xff3030, e.radius * 1.6, 0, 0.95);
        g.audio.warn();
      }
      return { tx, tz, speed: 0.55 };
    }
    if (e.aiState === 1) {
      e.telegraph = 1;
      if (e.ai <= 0) {
        e.aiState = 2;
        e.ai = 1.5;
        w.drop = 0;
        e.col.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
        g.audio.whoosh();
      }
      return { tx: w.dx, tz: w.dz, speed: 0 };
    }
    if (e.aiState === 2) {
      e.prevSpeed = e.speed * 4;
      w.drop -= dt;
      if (w.drop <= 0) {
        w.drop = 0.4;
        this.m.spawn('robovac', e.x - w.dx * (e.radius + 1), e.z - w.dz * (e.radius + 1));
      }
      if (Math.random() < dt * 20) g.fx.dust({ x: e.x, y: e.y - e.halfH, z: e.z }, 1.4, 0xcbb89a, 1);
      if (e.ai <= 0) {
        e.aiState = 3;
        e.ai = 1.1;
        e.col.setActiveEvents(RAPIER.ActiveEvents.NONE);
        w.n = (w.n ?? 0) + 1;
        if (w.n % 3 === 0) {
          for (let k = 0; k < 5; k++) this.m.spawn('robovac', e.x + Math.cos(k * 1.26) * (e.radius + 1.5), e.z + Math.sin(k * 1.26) * (e.radius + 1.5));
          g.fx.ring({ x: e.x, y: g.world.groundY(e.x, e.z) + 0.1, z: e.z }, 1, 7, ZONE.enemy, 0.5);
        }
      }
      return { tx: w.dx, tz: w.dz, speed: 4 };
    }
    if (e.ai <= 0) {
      e.aiState = 0;
      e.ai = (1.6 + Math.random()) * this.m.rage(e);
    }
    return { tx, tz, speed: 0.2 };
  }

  // ---------------------------------------------------------------- 偵察ドローン
  /** ノリコのまわりを回りながら近づき、予告のあと急降下して体当たりする。叩くと落ちる（吹き飛んでいる間は浮かない）。 */
  private drone(e: Enemy, dt: number, dist: number, tx: number, tz: number): Steer {
    const g = this.g;
    const w = e.w;
    const p = g.player.pos;
    const ground = g.world.groundY(e.x, e.z);
    let hover = e.def.hover ?? 1.5;
    let steer: Steer;
    e.ai -= dt;
    if (e.aiState === 0) {
      w.a = (w.a ?? Math.atan2(e.z - p.z, e.x - p.x)) + dt * (e.seed > 50 ? 0.9 : -0.9);
      const gx = p.x + Math.cos(w.a) * 6 - e.x;
      const gz = p.z + Math.sin(w.a) * 6 - e.z;
      const gd = Math.hypot(gx, gz) || 1;
      steer = { tx: gx / gd, tz: gz / gd, speed: Math.min(1.2, gd / 3) };
      if (e.ai <= 0 && dist < 11) {
        e.aiState = 1;
        e.ai = 0.6;
      }
    } else if (e.aiState === 1) {
      e.telegraph = 1;
      steer = { tx, tz, speed: 0 };
      if (e.ai <= 0) {
        e.aiState = 2;
        e.ai = 0.75;
        w.dx = tx;
        w.dz = tz;
        g.audio.whoosh();
      }
    } else if (e.aiState === 2) {
      hover = 0.9;
      steer = { tx: w.dx, tz: w.dz, speed: 3 };
      if (e.ai <= 0) {
        e.aiState = 3;
        e.ai = 0.8;
      }
    } else {
      steer = { tx: -tx, tz: -tz, speed: 0.6 };
      if (e.ai <= 0) {
        e.aiState = 0;
        e.ai = 2.6 + Math.random() * 1.8;
      }
    }
    // 浮く高さへ近づける（重力に逆らう分も足す）
    const v = e.body.linvel();
    const want = ground + hover + e.halfH + e.radius;
    e.body.setLinvel({ x: v.x, y: Math.max(-6, Math.min(6, (want - e.y) * 4)) + 0.37, z: v.z }, true);
    return steer;
  }

  // ---------------------------------------------------------------- 暴走自販機
  /** 間合いを取りながら、缶を 3 方向へ撃つ。 */
  private vending(e: Enemy, dt: number, dist: number, tx: number, tz: number): Steer {
    e.ai -= dt;
    if (e.ai < 0.5 && dist < 22) e.telegraph = 1;
    if (e.ai <= 0) {
      e.ai = 3 + Math.random() * 1.4;
      if (dist < 22) for (const a of [-0.3, 0, 0.3]) this.can(e, a);
    }
    if (dist < 6) return { tx: -tx, tz: -tz, speed: 0.5 };
    return { tx, tz, speed: dist < 11 ? 0.3 : 1 };
  }

  /** 自販機の王様: 缶の扇・空からの缶の雨・ルンバを呼ぶ・缶の連射を順に使う。 */
  private vendKing(e: Enemy, dt: number, dist: number, tx: number, tz: number): Steer {
    const g = this.g;
    const w = e.w;
    // 連射の途中
    if ((w.burst ?? 0) > 0) {
      w.bt -= dt;
      if (w.bt <= 0) {
        w.bt = 0.35;
        w.burst--;
        for (const a of [-0.12, 0.12]) this.can(e, a, '🥫', 1.2);
      }
      return { tx, tz, speed: 0 };
    }
    e.ai -= dt;
    if (e.ai < 0.6) e.telegraph = 1;
    if (e.ai <= 0) {
      e.ai = 2.6 * this.m.rage(e);
      w.mode = ((w.mode ?? -1) + 1) % 4;
      const p = g.player.pos;
      if (w.mode === 0) {
        for (let k = -3; k <= 3; k++) this.can(e, k * 0.2, '🥫', 1.1);
      } else if (w.mode === 1) {
        // 缶の雨: ノリコのまわりに赤い円を出し、空から落とす
        for (let k = 0; k < 7; k++) {
          const a = Math.random() * Math.PI * 2;
          const r = k === 0 ? 0 : 2 + Math.random() * 6;
          this.m.shell({ x: p.x, y: p.y + 14, z: p.z }, { x: p.x + Math.cos(a) * r, z: p.z + Math.sin(a) * r }, 1.3 + k * 0.08, 0, 2.2, e.dmg * 1.6, e.def.name, { emoji: '🥫' });
        }
        g.hud.toast('缶の雨だ！ 赤い円から出ろ！', 'warn');
      } else if (w.mode === 2) {
        for (let k = 0; k < 6; k++) this.m.spawn('robovac', e.x + Math.cos(k * 1.05) * (e.radius + 1.6), e.z + Math.sin(k * 1.05) * (e.radius + 1.6));
        g.fx.ring({ x: e.x, y: g.world.groundY(e.x, e.z) + 0.1, z: e.z }, 1, 7, ZONE.enemy, 0.5);
        g.audio.boss();
      } else {
        w.burst = 6;
        w.bt = 0;
      }
    }
    if (dist < 7) return { tx: -tx, tz: -tz, speed: 0.6 };
    return { tx, tz, speed: dist < 13 ? 0.3 : 0.9 };
  }

  // ---------------------------------------------------------------- 忍者
  /** 歩いて近づき、ときどき煙とともにノリコの横か後ろへ移り、少し構えてから斬りかかる。 */
  private blink(e: Enemy, dt: number, dist: number, tx: number, tz: number): Steer {
    const w = e.w;
    // 最初の回りこみは早めに
    if (w.init === undefined) {
      w.init = 1;
      e.ai = 0.8 + Math.random() * 1.2;
    }
    e.ai -= dt;
    if (e.aiState === 0) {
      if (e.ai <= 0 && dist > 4 && dist < 24) {
        e.aiState = 1;
        e.ai = 0.45;
      }
      return { tx, tz, speed: 1 };
    }
    if (e.aiState === 1) {
      e.telegraph = 1;
      if (e.ai > 0) return { tx, tz, speed: 0 };
      let moved = false;
      for (const c of this.flank(2.6)) if ((moved = this.teleport(e, c.x, c.z))) break;
      e.aiState = moved ? 4 : 0;
      e.ai = moved ? 0.32 : 2;
      this.g.audio.whoosh();
      return null;
    }
    if (e.aiState === 4) {
      // 現れた直後の構え（ここで逃げられる）
      e.telegraph = 1;
      if (e.ai <= 0) {
        e.aiState = 2;
        e.ai = 0.5;
        w.dx = tx;
        w.dz = tz;
      }
      return { tx, tz, speed: 0 };
    }
    if (e.aiState === 2) {
      if (e.ai <= 0) {
        e.aiState = 0;
        e.ai = 4 + Math.random() * 2.5;
      }
      return { tx: w.dx, tz: w.dz, speed: 2 };
    }
    e.aiState = 0;
    return { tx, tz, speed: 1 };
  }

  /** 忍者頭領: 横へ回りこんで手裏剣を 5 方向へ投げる。3 回に 1 回は分身（忍者）を呼ぶ。 */
  private ninjaBoss(e: Enemy, dt: number, dist: number, tx: number, tz: number): Steer {
    const g = this.g;
    const w = e.w;
    e.ai -= dt;
    if (e.aiState === 0) {
      if (e.ai <= 0) {
        e.aiState = 1;
        e.ai = 0.55;
      }
      return { tx, tz, speed: dist < 8 ? -0.6 : 0.9 };
    }
    if (e.aiState === 1) {
      e.telegraph = 1;
      if (e.ai > 0) return { tx, tz, speed: 0 };
      for (const c of this.flank(7.5, e)) if (this.teleport(e, c.x, c.z)) break;
      e.aiState = 2;
      e.ai = 0.4;
      g.audio.whoosh();
      return null;
    }
    if (e.aiState === 2) {
      e.telegraph = 1;
      if (e.ai > 0) return { tx, tz, speed: 0 };
      for (let k = -2; k <= 2; k++) g.projectiles.enemyShot(e, false, k * 0.22, { emoji: '✴️', dmgMul: 1.3, speedMul: 1.25, size: 0.8 });
      w.n = (w.n ?? 0) + 1;
      if (w.n % 3 === 0) {
        for (let k = 0; k < 4; k++) this.m.spawn('ninja', e.x + Math.cos(k * 1.57) * 3, e.z + Math.sin(k * 1.57) * 3);
        g.fx.ring({ x: e.x, y: g.world.groundY(e.x, e.z) + 0.1, z: e.z }, 1, 6, ZONE.enemy, 0.5);
        g.hud.toast('忍者頭領が分身を呼んだ！', 'warn');
      }
      e.aiState = 0;
      e.ai = (2.4 + Math.random()) * this.m.rage(e);
      return { tx, tz, speed: 0 };
    }
    e.aiState = 0;
    return { tx, tz, speed: 1 };
  }

  // ---------------------------------------------------------------- 応援団
  /** まわりの敵を回復し、しばらく速くする。 */
  private rally(e: Enemy, r: number, healPct: number, sec: number): number {
    const g = this.g;
    let n = 0;
    for (const o of this.m.list) {
      if (o === e || o.state === 'dead' || !o.alive) continue;
      if (Math.hypot(o.x - e.x, o.z - e.z) > r) continue;
      o.hp = Math.min(o.maxHp, o.hp + o.maxHp * (o.def.boss ? healPct * 0.2 : healPct));
      o.w.pep = g.time + sec;
      n++;
    }
    const gy = g.world.groundY(e.x, e.z);
    g.fx.ring({ x: e.x, y: gy + 0.1, z: e.z }, 0.5, r, 0x6ae06a, 0.45, 0.6);
    g.fx.number({ x: e.x, y: e.y + e.halfH + e.radius + 0.8, z: e.z }, '📣 フレー！', 'heal');
    return n;
  }

  /** 応援団員: 前に出ず、少し離れた所から仲間を応援する。 */
  private cheer(e: Enemy, dt: number, dist: number, tx: number, tz: number): Steer {
    const w = e.w;
    w.cheer = (w.cheer ?? 1.5 + Math.random() * 2) - dt;
    if (w.cheer <= 0) {
      w.cheer = 3.5;
      this.rally(e, 8, 0.15, 4);
    }
    if (dist < 8) return { tx: -tx, tz: -tz, speed: 0.6 };
    return { tx, tz, speed: dist < 12 ? 0.25 : 1 };
  }

  /** 応援団総長: 跳び上がって地面を揺らし、大声で手下を回復・強化する。ときどき手下を呼ぶ。 */
  private cheerBoss(e: Enemy, dt: number, dist: number, tx: number, tz: number): Steer {
    const g = this.g;
    const w = e.w;
    w.cheer = (w.cheer ?? 4) - dt;
    if (w.cheer <= 0 && e.aiState === 0) {
      w.cheer = 7 * this.m.rage(e);
      const n = this.rally(e, 18, 0.25, 6);
      w.k = (w.k ?? 0) + 1;
      if (w.k % 2 === 1) {
        for (let k = 0; k < 6; k++) this.m.spawn(k < 2 ? 'cheer' : 'streaker', e.x + Math.cos(k * 1.05) * 4, e.z + Math.sin(k * 1.05) * 4);
      }
      g.audio.boss();
      log('enemy.cheer', { n }, { time: Math.round(g.time) });
    }
    return this.m.pounder(e, dt, dist, tx, tz, false);
  }

  // ---------------------------------------------------------------- ラスボス
  /** ヒグマ戦車（2 面のラスボス）: 合体怪人の行動に、ときどき砲撃を足す（5 発をノリコのまわりへ）。 */
  private tankBear(e: Enemy, dt: number, dist: number, tx: number, tz: number): Steer {
    const g = this.g;
    const w = e.w;
    w.gun = (w.gun ?? 3) - dt;
    if (w.gun < 0.6 && w.gun > 0) e.telegraph = 1;
    if (w.gun <= 0 && (e.aiState === 0 || e.aiState === 20)) {
      w.gun = 6 * this.m.rage(e);
      const p = g.player.pos;
      const muzzle = { x: e.x + Math.sin(e.yaw) * 3, y: e.y + 2.2, z: e.z + Math.cos(e.yaw) * 3 };
      for (let k = 0; k < 5; k++) {
        const a = Math.random() * Math.PI * 2;
        const r = k === 0 ? 0 : 2 + Math.random() * 4;
        this.m.shell(muzzle, { x: p.x + Math.cos(a) * r, z: p.z + Math.sin(a) * r }, 1.3 + k * 0.1, 6, 3.2, e.dmg * 2, e.def.name);
      }
      g.fx.dust(muzzle, 1.4, 0x888888, 5);
      g.audio.explode(0.6);
      g.fx.shake('S');
    }
    return this.m.chimera(e, dt, dist, tx, tz);
  }

  /** 真・合体怪人（3 面のラスボス）: 合体怪人の行動に、瞬間移動とドローンの群れを足す。 */
  private chimera3(e: Enemy, dt: number, dist: number, tx: number, tz: number): Steer {
    const g = this.g;
    const w = e.w;
    // 待ち時間は、ほかの行動の最中も進める（行動の合間に使う）
    w.blink = (w.blink ?? 8) - dt;
    w.swarm = (w.swarm ?? 12) - dt;
    if (e.aiState === 0) {
      if (w.blink <= 0) {
        w.blink = 9 * this.m.rage(e);
        for (const c of this.flank(8, e)) if (this.teleport(e, c.x, c.z)) break;
        // 現れた場所で地響き
        this.m.shockwave(e.x, e.z, 14, 16, e.dmg * 1.1, e.def.name);
        g.fx.shake('M');
        g.audio.thud(1.4);
      }
      if (w.swarm <= 0) {
        w.swarm = 14 * this.m.rage(e);
        for (let k = 0; k < 5; k++) this.m.spawn('drone_e', e.x + Math.cos(k * 1.26) * 4, e.z + Math.sin(k * 1.26) * 4);
        g.hud.toast('ドローンの群れが来た！', 'warn');
      }
    }
    return this.m.chimera(e, dt, dist, tx, tz);
  }
}
