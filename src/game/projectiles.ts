import * as THREE from 'three';
import { emojiSprite } from '../core/assets';
import { G } from '../core/physics';
import { segSegDist, V3 } from '../core/vec';
import { TUNE } from './defs';
import type { Enemy } from './enemies';
import { SH } from './fx';
import type { Game } from './game';
import { farShotMul, shotThreat } from './rules';
import type { SkillDmg } from './defs';
import type { Chunk } from './world';

export interface ProjInit {
  emoji: string;
  size: number;
  pos: V3;
  vel: V3;
  r: number;
  dmg: number;
  life: number;
  owner?: 'player' | 'enemy';
  pierce?: number;
  /** 敵に当たるたびに、近くの別の敵へ跳ねる回数 */
  bounce?: number;
  grav?: number;
  /** 追尾の強さ（向きを変える速さ rad/s） */
  homing?: number;
  target?: Enemy | null;
  explode?: { r: number; dmg: number; force: number; struct: number };
  knock?: number;
  spin?: number;
  /** 行って戻ってくる。out は行きの秒数 */
  boomerang?: number;
  /** 壁に当たったときに建物へ与えるダメージ */
  struct?: number;
  /** 壁をすり抜ける */
  ghost?: boolean;
  element?: 'fire' | 'ice' | 'elec' | 'dark' | 'water';
  onEnd?: (pos: V3) => void;
  onHit?: (e: Enemy) => void;
  reflectable?: boolean;
  /** 進行方向へ絵を向ける */
  aim?: boolean;
  /** 通り道の建物を削る強さ（壁をすり抜ける斬撃用） */
  carve?: number;
}

interface Proj extends Required<Pick<ProjInit, 'r' | 'dmg' | 'life' | 'owner' | 'pierce' | 'bounce' | 'grav' | 'homing' | 'knock' | 'spin' | 'struct' | 'ghost'>> {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  age: number;
  target: Enemy | null;
  explode?: ProjInit['explode'];
  boomerang: number;
  element?: ProjInit['element'];
  onEnd?: ProjInit['onEnd'];
  onHit?: ProjInit['onHit'];
  reflectable: boolean;
  obj: THREE.Sprite;
  hit: Set<Enemy>;
  speed: number;
  dead: boolean;
  carve: number;
  carveT: number;
  /** 画面の外から当たりそうだと、すでに知らせたか */
  warned: boolean;
  /** 尾を引く粒を次に出すまでの秒数 */
  trailT: number;
  /** 撃ったスキルのダメージの種類と反映率 */
  ctx: SkillDmg | null;
  /** 分かれる・跳ね返るときに、同じ見た目で撃ち直すための情報 */
  emoji: string;
  size: number;
  /** 給食のフォークで分かれたか（分かれた弾は、もう分かれない） */
  forked: boolean;
  /** クリップの鎖で跳ね返ったか */
  clipped: boolean;
}

export class Projectiles {
  list: Proj[] = [];
  /** 画面に見えていないのに当たりそうな敵の弾の位置。HUD が方向の印を出すのに使う */
  threats: V3[] = [];
  private group = new THREE.Group();
  private tmp = new THREE.Vector3();

  constructor(private g: Game) {
    g.world.root.add(this.group);
  }

  fire(i: ProjInit): void {
    if (this.list.length > 260) return;
    const g = this.g;
    const mine = (i.owner ?? 'player') === 'player';
    // 団子の串: 飛び道具の貫通 +2（★で増える）。爆発する弾には付けない
    const kushi = mine && !i.explode && g.items?.length ? Math.round(2 * g.ip('kushi')) : 0;
    const obj = emojiSprite(i.emoji, i.size);
    obj.position.set(i.pos.x, i.pos.y, i.pos.z);
    this.group.add(obj);
    // ソフトボール部の肩: まっすぐ飛ぶ弾は速く、よく吹き飛ばす（山なりの弾は届く場所が変わるので速くしない）
    const ps = mine && g.stats && !i.grav ? g.stats.projSpeed : 1;
    const pk = mine && g.stats ? g.stats.projKnock : 1;
    this.list.push({
      x: i.pos.x, y: i.pos.y, z: i.pos.z, vx: i.vel.x * ps, vy: i.vel.y * ps, vz: i.vel.z * ps, r: i.r, dmg: i.dmg, life: i.life, age: 0,
      owner: i.owner ?? 'player', pierce: (i.pierce ?? 0) + kushi, bounce: i.bounce ?? 0, grav: i.grav ?? 0, homing: i.homing ?? 0, target: i.target ?? null,
      explode: i.explode, knock: (i.knock ?? 3) * pk, spin: i.spin ?? 0, boomerang: i.boomerang ?? 0, struct: i.struct ?? 0, ghost: i.ghost ?? false,
      element: i.element, onEnd: i.onEnd, onHit: i.onHit, reflectable: i.reflectable ?? false, obj, hit: new Set(),
      speed: Math.hypot(i.vel.x, i.vel.y, i.vel.z) * ps, dead: false, carve: i.carve ?? 0, carveT: 0, warned: false, trailT: 0,
      ctx: (i.owner ?? 'player') === 'player' ? (this.g.skills?.cur ?? null) : null,
      emoji: i.emoji, size: i.size, forked: false, clipped: false,
    });
  }

  /** 敵の弾を、近くの敵（いなければ来た方向）へ打ち返す。mul は威力の倍率。 */
  private reflect(p: Proj, mul: number): void {
    const g = this.g;
    p.owner = 'player';
    p.ctx = { kind: 'phys', ad: 0.8 };
    p.hit.clear();
    const tgt = g.enemies.nearest(p, 40);
    let dx = -p.vx;
    let dy = -p.vy;
    let dz = -p.vz;
    if (tgt) {
      dx = tgt.x - p.x; dy = tgt.y - p.y; dz = tgt.z - p.z;
    }
    const d = Math.hypot(dx, dy, dz) || 1;
    p.speed *= 2.2;
    p.vx = (dx / d) * p.speed; p.vy = (dy / d) * p.speed; p.vz = (dz / d) * p.speed;
    p.dmg *= mul;
    p.pierce = 3;
    p.knock = 9;
    p.age = 0;
    if (p.explode) p.explode = { ...p.explode, dmg: p.explode.dmg * mul * 0.8 };
  }

  /** 置き傘ガード: c から半径 r の中へ入った敵の弾を跳ね返す。跳ね返した数を返す。 */
  reflectNear(c: V3, r: number, mul: number): number {
    let n = 0;
    for (const p of this.list) {
      if (p.dead || p.owner !== 'enemy' || !p.reflectable) continue;
      if (Math.hypot(p.x - c.x, p.z - c.z) > r || Math.abs(p.y - c.y) > r) continue;
      this.reflect(p, mul);
      n++;
    }
    return n;
  }

  /** 給食のフォーク: 弾を左右 2 本に分ける。分かれた弾は、当たった敵には当たらない。 */
  private fork(p: Proj, e: Enemy): void {
    const sp = Math.hypot(p.vx, p.vz) || 1;
    const base = Math.atan2(p.vx, p.vz);
    for (const da of [-0.45, 0.45]) {
      const a = base + da;
      this.fire({ emoji: p.emoji, size: p.size * 0.85, pos: { x: p.x, y: p.y, z: p.z }, vel: { x: Math.sin(a) * sp, y: p.vy, z: Math.cos(a) * sp }, r: p.r, dmg: p.dmg, life: Math.max(0.6, p.life - p.age), knock: p.knock, spin: p.spin, struct: p.struct, ghost: p.ghost, element: p.element });
      const q = this.list[this.list.length - 1];
      if (q && q.emoji === p.emoji) {
        q.forked = true;
        q.ctx = p.ctx;
        q.hit.add(e);
      }
    }
  }

  /** 敵の射撃。boss はロケット弾（着弾で爆発）。どちらも武器で打ち返せる。 */
  enemyShot(e: Enemy, boss: boolean, yawOffset = 0, opts: { emoji?: string; dmgMul?: number; speedMul?: number; size?: number } = {}): void {
    const g = this.g;
    const p = g.player.pos;
    const from = { x: e.x, y: e.y + e.halfH * 0.4, z: e.z };
    let dx = p.x - from.x;
    const dy = p.y + 0.9 - from.y;
    let dz = p.z - from.z;
    if (yawOffset) {
      const c = Math.cos(yawOffset);
      const sn = Math.sin(yawOffset);
      const ox = dx * c - dz * sn;
      dz = dx * sn + dz * c;
      dx = ox;
    }
    const d = Math.hypot(dx, dy, dz) || 1;
    const sp = (boss ? TUNE.bossShotSpeed : TUNE.enemyShotSpeed) * (opts.speedMul ?? 1);
    g.audio.enemyShoot();
    g.shotCount++;
    this.fire({
      emoji: opts.emoji ?? (boss ? '🚀' : '🔴'), size: opts.size ?? (boss ? 1.3 : TUNE.enemyShotSize), pos: from, vel: { x: (dx / d) * sp, y: (dy / d) * sp, z: (dz / d) * sp }, r: boss ? 0.45 : 0.2,
      dmg: e.dmg * (opts.dmgMul ?? 1), life: 4, owner: 'enemy', reflectable: true, aim: boss,
      explode: boss ? { r: 3.2, dmg: e.dmg * 1.2, force: 12, struct: 40 } : undefined,
    });
  }

  /** 弾がいまの画面に映っているか。カメラの後ろと、画面の端より外は「見えていない」。 */
  private onScreen(p: Proj): boolean {
    const v = this.tmp.set(p.x, p.y, p.z).project(this.g.engine.camera);
    return v.z > -1 && v.z < 1 && Math.abs(v.x) < 0.92 && Math.abs(v.y) < 0.92;
  }

  /**
   * 敵の弾が「画面に見えていないのに、もうすぐ当たる」状態かを調べる。
   * 当てはまれば方向の印の対象にし、その弾で初めてなら画面の点滅と警告音を出す。
   */
  private checkThreat(p: Proj): void {
    const g = this.g;
    const pl = g.player;
    const th = shotThreat({ x: pl.pos.x - p.x, y: pl.pos.y + 0.9 - p.y, z: pl.pos.z - p.z }, { x: p.vx, y: p.vy, z: p.vz });
    if (!th || th.t > TUNE.shotWarnTime) return;
    if (th.miss > Math.max(TUNE.shotWarnMiss, p.explode ? p.explode.r : 0)) return;
    if (this.onScreen(p)) return;
    this.threats.push({ x: p.x, y: p.y, z: p.z });
    if (!p.warned) {
      p.warned = true;
      g.warnShot(p, th.t, th.miss);
    }
  }

  private end(p: Proj, explode = true): void {
    if (p.dead) return;
    p.dead = true;
    const g = this.g;
    const pos = { x: p.x, y: Math.max(0.1, p.y), z: p.z };
    if (explode && p.explode) g.explode(pos, p.explode.r, p.explode.dmg, { force: p.explode.force, struct: p.explode.struct, hurtPlayer: p.owner === 'enemy', source: p.owner === 'enemy' ? 'enemy' : 'skill', element: p.element, ctx: p.ctx ?? undefined });
    else if (p.element) g.fx.element(pos, p.element);
    if (p.onEnd) p.onEnd(pos);
  }

  update(dt: number): void {
    const g = this.g;
    const pl = g.player;
    const sg = g.items?.length ? g.ip('sougankyo') : 0;
    const enemies = g.enemies.list;
    this.threats.length = 0;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      p.age += dt;
      if (p.age >= p.life) this.end(p, !!p.explode && p.grav !== 0);
      if (p.dead) {
        p.obj.removeFromParent();
        this.list.splice(i, 1);
        continue;
      }
      // 追尾
      if (p.homing > 0) {
        if (!p.target || p.target.state === 'dead' || !p.target.alive) p.target = g.enemies.nearest(p, 30, (e) => p.hit.has(e));
        if (p.target) {
          const tx = p.target.x - p.x;
          const ty = p.target.y - p.y;
          const tz = p.target.z - p.z;
          const td = Math.hypot(tx, ty, tz) || 1;
          const k = Math.min(1, p.homing * dt);
          p.vx += ((tx / td) * p.speed - p.vx) * k;
          p.vy += ((ty / td) * p.speed - p.vy) * k;
          p.vz += ((tz / td) * p.speed - p.vz) * k;
        }
      }
      if (p.boomerang > 0 && p.age > p.boomerang) {
        // 戻り: プレイヤーへ向かって加速する
        const tx = pl.pos.x - p.x;
        const ty = pl.pos.y + 0.9 - p.y;
        const tz = pl.pos.z - p.z;
        const td = Math.hypot(tx, ty, tz) || 1;
        const k = Math.min(1, 6 * dt);
        const sp = p.speed * 1.3;
        p.vx += ((tx / td) * sp - p.vx) * k;
        p.vy += ((ty / td) * sp - p.vy) * k;
        p.vz += ((tz / td) * sp - p.vz) * k;
        if (td < 0.9) {
          this.end(p, false);
          continue;
        }
        if (p.age > p.boomerang + 0.05 && p.hit.size && p.age - p.boomerang < 0.1) p.hit.clear();
      }
      p.vy += p.grav * dt;
      const ox = p.x;
      const oy = p.y;
      const oz = p.z;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;

      // 壁・地面
      if (!p.ghost) {
        const sx = p.x - ox;
        const sy = p.y - oy;
        const sz = p.z - oz;
        const sd = Math.hypot(sx, sy, sz);
        if (sd > 1e-5) {
          const hit = g.physics.raycast({ x: ox, y: oy, z: oz }, { x: sx / sd, y: sy / sd, z: sz / sd }, sd + p.r * 0.5, G.STATIC | G.CHUNK);
          if (hit) {
            p.x = ox + (sx / sd) * hit.dist;
            p.y = oy + (sy / sd) * hit.dist;
            p.z = oz + (sz / sd) * hit.dist;
            if (hit.owner?.kind === 'chunk' && p.struct > 0 && !p.explode) {
              g.world.hitChunk(hit.owner.ref as Chunk, p.struct, { x: (sx / sd) * 4, y: 1, z: (sz / sd) * 4 }, { x: p.x, y: p.y, z: p.z });
            }
            if (p.boomerang > 0 && p.age <= p.boomerang) {
              p.age = p.boomerang;
              continue;
            }
            this.end(p);
            continue;
          }
        }
      }
      const gy = g.world.groundY(p.x, p.z);
      if (p.y < gy + p.r * 0.5) {
        if (p.grav !== 0 || p.explode) {
          p.y = gy + p.r * 0.5;
          this.end(p);
          continue;
        }
        p.y = gy + p.r * 0.5;
        p.vy = Math.abs(p.vy) * 0.3;
      }

      // 当たり判定
      if (p.owner === 'player') {
        for (const e of enemies) {
          if (e.state === 'dead' || p.hit.has(e)) continue;
          const dx = e.x - p.x;
          const dz = e.z - p.z;
          const rr = e.radius + p.r;
          if (dx * dx + dz * dz > rr * rr) continue;
          if (Math.abs(e.y - p.y) > e.halfH + e.radius + p.r) continue;
          p.hit.add(e);
          if (p.explode) {
            this.end(p);
            break;
          }
          const sp = Math.hypot(p.vx, p.vz) || 1;
          const crit = Math.random() < g.stats.crit;
          const k = p.knock * g.stats.knockback;
          // 双眼鏡: 遠くまで飛んだ弾ほど強い
          const far = sg > 0 ? farShotMul(p.age * p.speed, sg) : 1;
          g.enemies.damage(e, p.dmg * g.scaleFor(p.ctx) * (crit ? g.stats.critDmg : 1) * far, 'skill', { kind: p.ctx?.kind ?? 'phys', impulse: { x: (p.vx / sp) * k, y: k * 0.35, z: (p.vz / sp) * k }, crit });
          if (p.element) g.fx.element({ x: e.x, y: e.y, z: e.z }, p.element, 0.8);
          else g.fx.hitMark({ x: p.x, y: p.y, z: p.z }, 0.15);
          g.audio.hit(0.25);
          if (p.onHit) p.onHit(e);
          if (!p.forked && !p.boomerang && g.hasItem('fork')) {
            p.forked = true;
            this.fork(p, e);
          }
          if (p.bounce > 0) {
            p.bounce--;
            const next = g.enemies.nearest(p, 12, (o) => p.hit.has(o));
            if (next) {
              const nx = next.x - p.x;
              const ny = next.y - p.y;
              const nz = next.z - p.z;
              const nd = Math.hypot(nx, ny, nz) || 1;
              p.vx = (nx / nd) * p.speed;
              p.vy = (ny / nd) * p.speed;
              p.vz = (nz / nd) * p.speed;
              p.life = Math.max(p.life, p.age + 1.2);
              continue;
            }
          }
          if (p.pierce > 0) p.pierce--;
          else if (p.boomerang <= 0) {
            // クリップの鎖: 消える前に、近くの別の敵へ 1 回跳ね返る
            if (!p.clipped && g.hasItem('clip')) {
              p.clipped = true;
              const next = g.enemies.nearest(p, 10, (o) => p.hit.has(o));
              if (next) {
                const nx = next.x - p.x;
                const ny = next.y - p.y;
                const nz = next.z - p.z;
                const nd = Math.hypot(nx, ny, nz) || 1;
                p.vx = (nx / nd) * p.speed;
                p.vy = (ny / nd) * p.speed;
                p.vz = (nz / nd) * p.speed;
                p.life = Math.max(p.life, p.age + 1);
                continue;
              }
            }
            this.end(p);
            break;
          }
        }
      } else {
        // 敵の弾: 振っている武器に触れたら打ち返す
        const sw = pl.swingSegment;
        if (p.reflectable && sw && segSegDist(sw.hand, sw.tip, { x: ox, y: oy, z: oz }, p) < p.r + 0.55) {
          this.reflect(p, 5);
          g.audio.parry();
          g.fx.hitMark({ x: p.x, y: p.y, z: p.z }, 0.7, undefined, true);
          g.fx.number({ x: p.x, y: p.y + 0.5, z: p.z }, '打ち返し！', 'info');
          g.hitStop(0.05);
          g.run.parries++;
        } else {
          const dx = pl.pos.x - p.x;
          const dz = pl.pos.z - p.z;
          const dy = pl.pos.y + 0.8 - p.y;
          if (dx * dx + dz * dz < (p.r + 0.38) * (p.r + 0.38) && Math.abs(dy) < 1.0 + p.r) {
            if (p.explode) this.end(p);
            else {
              pl.hurt(p.dmg, { x: p.x - p.vx, y: p.y, z: p.z - p.vz }, '弾', { warned: p.warned, seen: this.onScreen(p) });
              this.end(p, false);
            }
            continue;
          }
          this.checkThreat(p);
          // 赤い尾を引かせて、飛んでくる向きを読み取りやすくする
          p.trailT -= dt;
          if (p.trailT <= 0) {
            p.trailT = 0.03;
            g.fx.spawn({ pos: { x: p.x, y: p.y, z: p.z }, life: 0.22, size: p.r * 2.6, size2: p.r * 0.6, color: 0xff5a3c, color2: 0xffd27a, alpha: 0.75, shape: SH.SOFT });
          }
        }
      }
      if (p.dead) continue;
      if (p.carve > 0) {
        p.carveT -= dt;
        if (p.carveT <= 0) {
          p.carveT = 0.1;
          g.world.blast({ x: p.x, y: p.y, z: p.z }, p.r + 0.4, p.carve, 6, p.carve * 0.5);
        }
      }
      p.obj.position.set(p.x, p.y, p.z);
      if (p.spin) p.obj.material.rotation += p.spin * dt;
      if (p.element && Math.random() < dt * 30) g.fx.element({ x: p.x, y: p.y, z: p.z }, p.element, 0.5);
    }
  }

  clear(): void {
    for (const p of this.list) p.obj.removeFromParent();
    this.list.length = 0;
  }
}
