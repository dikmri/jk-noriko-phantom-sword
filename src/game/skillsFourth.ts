import * as THREE from 'three';
import { G, G_ALL, groups, RAPIER } from '../core/physics';
import { V3 } from '../core/vec';
import { log } from '../log';
import type { Enemy } from './enemies';
import { ZONE } from './fx';
import type { Game } from './game';
import type { SkillInst, Skills } from './skills';
import { Prop, PROPS } from './world';

type Handler = (s: SkillInst, dt: number) => void;

/**
 * 第 4 弾の攻撃スキル。
 * 黒板消しはたき（ふらつき）・自転車通学（突進）・理科室の電磁石（物を引き寄せてはじく）・図書室の本の雨・
 * ヘリウム風船（浮かせて落とす）・防火シャッター（壁）・卓球部のスマッシュ（跳ね返る球）・カラオケ大会（音の波）・
 * サッカー部のシュート（敵を蹴って飛ばす）・卒業アルバムの撮影（止めて、受けるダメージを増やす）。
 */
export class FourthSkills {
  constructor(private g: Game, private k: Skills) {}

  handlers(): Record<string, Handler> {
    return {
      kokuban: (s) => this.kokuban(s),
      jitensha: (s) => this.jitensha(s),
      denjishaku: (s) => this.denjishaku(s),
      honnoame: (s) => this.honnoame(s),
      fuusen: (s) => this.fuusen(s),
      shutter: (s) => this.shutter(s),
      pingpong: (s) => this.pingpong(s),
      karaoke: (s) => this.karaoke(s),
      shoot: (s) => this.shoot(s),
      photo: (s) => this.photo(s),
    };
  }

  private gy(x: number, z: number): number {
    return this.g.world.groundY(x, z);
  }

  /** 前方 range m・左右 half rad の扇の中の敵。 */
  private cone(range: number, half: number): Enemy[] {
    const g = this.g;
    const p = g.player.pos;
    const f = this.k.forward();
    const out: Enemy[] = [];
    const cos = Math.cos(half);
    for (const e of g.enemies.list) {
      if (e.state === 'dead') continue;
      const dx = e.x - p.x;
      const dz = e.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d > range + e.radius) continue;
      if (d > 0.8 && (dx * f.x + dz * f.z) / d < cos) continue;
      out.push(e);
    }
    return out;
  }

  // ---------------------------------------------------------------- 黒板消しはたき（チョークの粉で、敵がふらふら歩く）
  private kokuban(s: SkillInst): void {
    const g = this.g;
    const k = this.k;
    const L = s.level;
    const E = !!s.evolved;
    const R = k.area(5.5 + 0.4 * L);
    const hit = this.cone(R, 0.75);
    if (!hit.length) {
      s.cd = 0.4;
      return;
    }
    s.cd = k.cdOf(6.5 - 0.35 * L);
    const p = g.player.pos;
    const f = k.forward();
    const sec = 1.6 + 0.3 * L;
    for (const e of hit) {
      k.hit(e, 18 + 7 * L, { x: f.x * 2, y: 0.5, z: f.z * 2 }, false);
      if (!e.def.boss && e.alive) e.daze = g.time + sec;
    }
    // 粉の煙（白い）
    for (let i = 0; i < 26; i++) {
      const a = (Math.random() - 0.5) * 1.5 + Math.atan2(f.x, f.z);
      const r = Math.random() * R;
      const x = p.x + Math.sin(a) * r;
      const z = p.z + Math.cos(a) * r;
      g.fx.dust({ x, y: this.gy(x, z) + 0.6 + Math.random(), z }, 1.4, 0xf4f4f0, 1);
    }
    g.audio.whoosh();
    if (hit.length >= 6) k.comboLog('kokuban.many', { n: hit.length });
    if (E) {
      // 粉塵爆発: 1 秒後に 3 か所で爆発
      const pts = [0.35, 0.65, 0.95].map((u) => ({ x: p.x + f.x * R * u, z: p.z + f.z * R * u }));
      let t = 0;
      k.addTask({
        update: (dt) => {
          t += dt;
          if (t < 1) return true;
          for (const q of pts) g.explode({ x: q.x, y: this.gy(q.x, q.z) + 0.8, z: q.z }, k.area(2.6), 22 + 8 * L, { source: 'skill', element: 'fire', force: 9, struct: 10 });
          return false;
        },
      });
    }
  }

  // ---------------------------------------------------------------- 自転車通学（後ろから自転車が走り抜け、はね飛ばす）
  private jitensha(s: SkillInst): void {
    const g = this.g;
    const k = this.k;
    const L = s.level;
    const E = !!s.evolved;
    const p = g.player.pos;
    const target = g.enemies.nearest(p, 16);
    if (!target) {
      s.cd = 0.5;
      return;
    }
    s.cd = k.cdOf(7 - 0.3 * L);
    const base = Math.atan2(target.x - p.x, target.z - p.z);
    const angles = E ? [base - 0.35, base, base + 0.35] : [base];
    const speed = 20 + 2 * L;
    const life = 1.6;
    let total = 0;
    for (const a of angles) {
      const dx = Math.sin(a);
      const dz = Math.cos(a);
      let x = p.x - dx * 6;
      let z = p.z - dz * 6;
      let t = 0;
      const done = new Set<Enemy>();
      const bike = PROPS.bike ? g.world.spawnProp('bike', { x, y: this.gy(x, z), z }, a, {}) : null;
      if (bike) {
        bike.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
        bike.rooted = true;
        bike.col.setCollisionGroups(groups(G.PROP, G_ALL & ~G.PLAYER & ~G.ENEMY));
      }
      const sp = bike ? null : k.sprite('🚲', 1.5);
      k.addTask({
        update: (dt) => {
          t += dt;
          x += dx * speed * dt;
          z += dz * speed * dt;
          const y = this.gy(x, z);
          if (bike?.alive) {
            bike.body.setNextKinematicTranslation({ x, y: y + bike.half.y, z });
            bike.body.setNextKinematicRotation({ x: 0, y: Math.sin(a / 2), z: 0, w: Math.cos(a / 2) });
          }
          sp?.position.set(x, y + 0.8, z);
          for (const e of g.enemies.list) {
            if (e.state === 'dead' || done.has(e) || Math.hypot(e.x - x, e.z - z) > 1.3 + e.radius) continue;
            done.add(e);
            total++;
            // 横へはね飛ばす（進む向きにも少し）
            const side = (e.x - x) * dz - (e.z - z) * dx >= 0 ? 1 : -1;
            k.hit(e, 20 + 9 * L, { x: dx * 8 + dz * side * 7, y: 6 + 0.5 * L, z: dz * 8 - dx * side * 7 });
          }
          if (Math.random() < dt * 30) g.fx.dust({ x, y: y + 0.1, z }, 0.6, 0xcbb89a, 1);
          return t < life;
        },
        dispose: () => {
          if (bike?.alive) g.world.removeProp(bike);
          sp?.removeFromParent();
          if (total >= 5 && a === angles[angles.length - 1]) k.comboLog('jitensha.many', { n: total });
        },
      });
    }
    g.audio.ring();
    if (E) {
      // ベルの音: まわりの敵を気絶
      g.enemies.inRadius(p, k.area(4), (e) => {
        if (!e.def.boss) e.stagger = Math.max(e.stagger, 0.8);
      });
      g.fx.ring({ x: p.x, y: p.y + 0.2, z: p.z }, 0.4, k.area(4), ZONE.ally, 0.35, 0.6);
    }
  }

  // ---------------------------------------------------------------- 理科室の電磁石（物と敵を引き寄せて、最後にはじく）
  private denjishaku(s: SkillInst): void {
    const g = this.g;
    const k = this.k;
    const L = s.level;
    const E = !!s.evolved;
    const c = k.aim(20);
    if (!c) {
      s.cd = 0.6;
      return;
    }
    s.cd = k.cdOf(11 - 0.5 * L);
    const R = k.area((7 + 0.6 * L) * (E ? 1.5 : 1));
    const cx = c.x;
    const cz = c.z;
    const cy = this.gy(cx, cz) + 1.2;
    const sp = k.sprite('🧲', 1.8);
    sp.position.set(cx, cy + 0.6, cz);
    let t = 0;
    let pulse = 0;
    let props = 0;
    k.addTask({
      update: (dt) => {
        t += dt;
        pulse -= dt;
        if (pulse <= 0) {
          pulse = 0.35;
          g.fx.ring({ x: cx, y: cy - 1.1, z: cz }, R, 0.6, 0x9fd8ff, 0.35, 0.6);
        }
        // 物を引き寄せる（重い物ほどゆっくり）
        for (const p of g.world.props) {
          if (!p.alive || p.rooted) continue;
          const tr = p.body.translation();
          const dx = cx - tr.x;
          const dz = cz - tr.z;
          const d = Math.hypot(dx, dz);
          if (d > R || d < 0.8) continue;
          const v = p.body.linvel();
          const pull = Math.min(14, 40 / Math.sqrt(Math.max(1, p.mass)));
          p.body.setLinvel({ x: v.x + (dx / d) * pull * dt * 6, y: Math.max(v.y, 1.5), z: v.z + (dz / d) * pull * dt * 6 }, true);
          p.hot = Math.max(p.hot, 1);
        }
        // 敵も引き寄せる
        for (const e of g.enemies.list) {
          if (e.state === 'dead' || e.def.boss) continue;
          const dx = cx - e.x;
          const dz = cz - e.z;
          const d = Math.hypot(dx, dz);
          if (d > R || d < 1) continue;
          const v = e.body.linvel();
          e.body.setLinvel({ x: v.x * 0.8 + (dx / d) * 7, y: v.y, z: v.z * 0.8 + (dz / d) * 7 }, true);
        }
        if (t < 2) return true;
        // 最後に一気にはじく
        for (const p of g.world.props) {
          if (!p.alive || p.rooted) continue;
          const tr = p.body.translation();
          const dx = tr.x - cx;
          const dz = tr.z - cz;
          const d = Math.hypot(dx, dz);
          if (d > R * 0.7) continue;
          props++;
          const f = 16 + 1.5 * L;
          p.body.setLinvel({ x: (dx / (d || 1)) * f, y: 5, z: (dz / (d || 1)) * f }, true);
          p.hot = Math.max(p.hot, 2);
        }
        g.explode({ x: cx, y: cy - 0.6, z: cz }, k.area(3.2), 26 + 10 * L, { source: 'skill', force: 18 + L, struct: 20 });
        if (E) {
          for (const e of k.nearestN(12, 40).filter((o) => Math.hypot(o.x - cx, o.z - cz) < R)) {
            g.fx.bolt({ x: cx, y: cy + 4, z: cz }, { x: e.x, y: e.y, z: e.z }, 0x9fd8ff, 0.3, 0.7, 0.2);
            k.hit(e, 20 + 8 * L);
          }
          g.audio.thunder();
        }
        return false;
      },
      dispose: () => {
        sp.removeFromParent();
        if (props >= 4) k.comboLog('denjishaku.props', { n: props });
      },
    });
    g.audio.whoosh();
  }

  // ---------------------------------------------------------------- 図書室の本の雨
  private honnoame(s: SkillInst): void {
    const g = this.g;
    const k = this.k;
    const L = s.level;
    const E = !!s.evolved;
    const c = k.aim(22);
    if (!c) {
      s.cd = 0.6;
      return;
    }
    s.cd = k.cdOf(8 - 0.3 * L);
    const n = 9 + 2 * L + 2 * ((s.bm?.amt ?? 0) + g.stats.amount);
    const spread = k.area(4.5);
    const r = k.area(E ? 2.6 : 1.6);
    const books = ['📕', '📗', '📘', '📙'];
    let made = 0;
    let t = 0;
    let hits = 0;
    k.addTask({
      update: (dt) => {
        t += dt;
        while (made < n && t > made * (2.4 / n)) {
          made++;
          const a = Math.random() * Math.PI * 2;
          const rr = Math.sqrt(Math.random()) * spread;
          const x = c.x + Math.cos(a) * rr;
          const z = c.z + Math.sin(a) * rr;
          const gy = this.gy(x, z);
          const sp = k.sprite(E ? '📖' : books[made % books.length], E ? 1.6 : 1.0);
          let ft = 0;
          const T = 0.45;
          g.fx.ring({ x, y: gy + 0.08, z }, r * 0.9, r, ZONE.ally, T, 0.6);
          k.addTask({
            update: (dt2) => {
              ft += dt2;
              sp.position.set(x, gy + 10 * (1 - ft / T) + 0.3, z);
              if (ft < T) return true;
              g.enemies.inRadius({ x, y: gy, z }, r, (e) => {
                hits++;
                k.hit(e, (16 + 6 * L) * (E ? 1.6 : 1), { x: 0, y: -2, z: 0 });
                if (E && !e.def.boss && e.alive) e.stagger = Math.max(e.stagger, 0.5);
              });
              g.fx.dust({ x, y: gy + 0.2, z }, 0.9, 0xd8c8a8, 3);
              g.audio.thud(0.25);
              return false;
            },
            dispose: () => sp.removeFromParent(),
          });
        }
        return made < n;
      },
      dispose: () => {
        if (hits >= 20) k.comboLog('honnoame.many', { hits });
      },
    });
  }

  // ---------------------------------------------------------------- ヘリウム風船（浮かせて、落とす）
  private fuusen(s: SkillInst): void {
    const g = this.g;
    const k = this.k;
    const L = s.level;
    const E = !!s.evolved;
    const targets = k.nearestN(12, 14).filter((e) => !e.def.boss && e.state === 'walk').slice(0, 2 + L + (s.bm?.amt ?? 0));
    if (!targets.length) {
      s.cd = 0.5;
      return;
    }
    s.cd = k.cdOf(9 - 0.4 * L);
    for (const e of targets) {
      g.enemies.launch(e, { x: 0, y: 3.5, z: 0 });
      const sp = k.sprite('🎈', 1.1);
      let t = 0;
      k.addTask({
        update: (dt) => {
          t += dt;
          if (!e.alive || e.state === 'dead') return false;
          sp.position.set(e.x, e.y + e.halfH + e.radius + 0.9, e.z);
          if (t < 2) {
            // ふわふわ浮く（重力に逆らう）
            const v = e.body.linvel();
            e.body.setLinvel({ x: v.x * 0.9, y: 3.6, z: v.z * 0.9 }, true);
            e.t = Math.max(e.t, 1);
            return true;
          }
          // 割れる
          g.fx.number({ x: e.x, y: e.y + 1.2, z: e.z }, 'パン！', 'info');
          g.audio.pop();
          e.w.peak = e.y;
          if (E) e.body.setLinvel({ x: 0, y: -26, z: 0 }, true);
          k.hit(e, 10 + 4 * L, undefined, true);
          return false;
        },
        dispose: () => sp.removeFromParent(),
      });
    }
    g.audio.boing();
    if (targets.length >= 5) k.comboLog('fuusen.many', { n: targets.length });
  }

  // ---------------------------------------------------------------- 防火シャッター（つぶして、敵だけを止める壁になる）
  private shutter(s: SkillInst): void {
    const g = this.g;
    const k = this.k;
    const L = s.level;
    const E = !!s.evolved;
    const p = g.player.pos;
    const c = k.aim(16);
    if (!c) {
      s.cd = 0.6;
      return;
    }
    s.cd = k.cdOf(12 - 0.5 * L);
    const dirA = Math.atan2(c.x - p.x, c.z - p.z);
    const W = k.area(5 + 0.6 * L);
    const walls = E ? [dirA + 0.55, dirA - 0.55] : [dirA];
    let crushed = 0;
    for (const a of walls) {
      // 敵の集まった所を、ノリコから見て横切る向きに置く
      const cx = E ? c.x - Math.sin(dirA) * 1.5 + Math.sin(a) * 1.5 : c.x;
      const cz = E ? c.z - Math.cos(dirA) * 1.5 + Math.cos(a) * 1.5 : c.z;
      const yaw = a + Math.PI / 2;
      const gy = this.gy(cx, cz);
      const H = 2.6;
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(W, H, 0.25), new THREE.MeshLambertMaterial({ color: E ? 0x8a8f9a : 0xb8b2a2 }));
      mesh.rotation.y = yaw;
      mesh.castShadow = true;
      g.world.root.add(mesh);
      const w = g.physics.world;
      const body = w.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(cx, gy + H / 2, cz).setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }));
      w.createCollider(RAPIER.ColliderDesc.cuboid(W / 2, H / 2, 0.15).setCollisionGroups(groups(G.PROP, G_ALL & ~G.PLAYER)), body);
      // 落ちてくる
      let t = 0;
      let landed = false;
      const life = 5 + 0.3 * L;
      const touch = new Map<Enemy, number>();
      k.addTask({
        update: (dt) => {
          t += dt;
          const fall = Math.min(1, t / 0.25);
          mesh.position.set(cx, gy + H / 2 + (1 - fall) * 7, cz);
          if (!landed && fall >= 1) {
            landed = true;
            const nx = Math.cos(yaw);
            const nz = -Math.sin(yaw);
            for (const e of g.enemies.list) {
              if (e.state === 'dead') continue;
              const dx = e.x - cx;
              const dz = e.z - cz;
              const along = dx * nx + dz * nz;
              const across = dx * Math.sin(yaw) + dz * Math.cos(yaw);
              if (Math.abs(along) > W / 2 + e.radius || Math.abs(across) > 0.6 + e.radius) continue;
              crushed++;
              k.hit(e, 40 + 15 * L, { x: Math.sign(across || 1) * Math.sin(yaw) * 6, y: 1, z: Math.sign(across || 1) * Math.cos(yaw) * 6 });
              if (!e.def.boss && e.alive) e.stagger = Math.max(e.stagger, 1);
            }
            g.fx.dust({ x: cx, y: gy + 0.2, z: cz }, 2, 0xb8b2a2, 6);
            g.fx.shake('S');
            g.audio.thud(1);
          }
          // 鉄の扉: 触れた敵にダメージ
          if (E && landed) {
            for (const e of g.enemies.list) {
              if (e.state === 'dead') continue;
              const dx = e.x - cx;
              const dz = e.z - cz;
              const along = dx * Math.cos(yaw) - dz * Math.sin(yaw);
              const across = dx * Math.sin(yaw) + dz * Math.cos(yaw);
              if (Math.abs(along) > W / 2 + e.radius || Math.abs(across) > 0.5 + e.radius) continue;
              const last = touch.get(e) ?? -9;
              if (g.time - last < 0.5) continue;
              touch.set(e, g.time);
              k.hit(e, 8 + 3 * L, undefined, true);
            }
          }
          return t < life;
        },
        dispose: () => {
          mesh.removeFromParent();
          mesh.geometry.dispose();
          (mesh.material as THREE.Material).dispose();
          w.removeRigidBody(body);
          g.fx.dust({ x: cx, y: gy + 1, z: cz }, 1.5, 0xb8b2a2, 4);
          if (crushed >= 5 && a === walls[walls.length - 1]) k.comboLog('shutter.crush', { n: crushed });
        },
      });
    }
  }

  // ---------------------------------------------------------------- 卓球部のスマッシュ（敵から敵へ跳ね返る球）
  private pingpong(s: SkillInst): void {
    const g = this.g;
    const k = this.k;
    const L = s.level;
    const E = !!s.evolved;
    const first = g.enemies.nearest(g.player.pos, 15);
    if (!first) {
      s.cd = 0.4;
      return;
    }
    s.cd = k.cdOf(3.6 - 0.15 * L);
    const balls = (E ? 2 : 1) + (s.bm?.amt ?? 0);
    const bounces = (4 + L + g.stats.amount) * (E ? 2 : 1);
    for (let b = 0; b < balls; b++) {
      const sp = k.sprite('🏓', 0.55);
      let from: V3 = k.chest();
      let target: Enemy | null = b === 0 ? first : g.enemies.random(g.player.pos, 15) ?? first;
      const done = new Set<Enemy>();
      let n = 0;
      let u = 0;
      let leg = 0.12;
      k.addTask({
        update: (dt) => {
          if (!target || !target.alive || target.state === 'dead') {
            target = g.enemies.nearest(from, 9, (o) => done.has(o));
            if (!target) return false;
          }
          u += dt / leg;
          const to = { x: target.x, y: target.y + 0.3, z: target.z };
          sp.position.set(from.x + (to.x - from.x) * Math.min(1, u), from.y + (to.y - from.y) * Math.min(1, u) + Math.sin(Math.min(1, u) * Math.PI) * 0.6, from.z + (to.z - from.z) * Math.min(1, u));
          if (u < 1) return true;
          const dx = to.x - from.x;
          const dz = to.z - from.z;
          const d = Math.hypot(dx, dz) || 1;
          k.hit(target, (12 + 5 * L) * (E ? 1 + 0.1 * n : 1), { x: (dx / d) * 3, y: 1.5, z: (dz / d) * 3 });
          g.audio.pop();
          done.add(target);
          n++;
          from = to;
          u = 0;
          target = g.enemies.nearest(from, 9, (o) => done.has(o));
          if (target) leg = Math.max(0.06, Math.hypot(target.x - from.x, target.z - from.z) / 40);
          if (done.size > 6) done.clear();
          return n < bounces && !!target;
        },
        dispose: () => {
          sp.removeFromParent();
          if (n >= 8) k.comboLog('pingpong.rally', { n });
        },
      });
    }
  }

  // ---------------------------------------------------------------- カラオケ大会（音の波で、拍ごとにダメージ。4 拍ごとに敵が踊る）
  private karaoke(s: SkillInst): void {
    const g = this.g;
    const k = this.k;
    const L = s.level;
    const E = !!s.evolved;
    const p = g.player.pos;
    if (!g.enemies.nearest(p, 10)) {
      s.cd = 0.5;
      return;
    }
    s.cd = k.cdOf(13 - 0.5 * L);
    const a = g.player.yaw + Math.PI;
    const x = p.x + Math.sin(a) * 1.8;
    const z = p.z + Math.cos(a) * 1.8;
    const box: Prop | null = PROPS.u_jukebox ? g.world.spawnProp('u_jukebox', { x, y: this.gy(x, z), z }, g.player.yaw, { scale: 1.4 }) : null;
    if (box) {
      box.body.setBodyType(RAPIER.RigidBodyType.Fixed, true);
      box.rooted = true;
      box.col.setCollisionGroups(groups(G.PROP, G_ALL & ~G.PLAYER));
    }
    const sp = box ? null : k.sprite('🎤', 1.4);
    sp?.position.set(x, this.gy(x, z) + 1, z);
    const R = k.area(5 + 0.35 * L);
    const every = E ? 2 : 4;
    let t = 0;
    let beat = 0;
    let next = 0;
    let danced = 0;
    k.addTask({
      update: (dt) => {
        t += dt;
        next -= dt;
        if (next <= 0) {
          next = 0.5;
          beat++;
          const gy = this.gy(x, z);
          const dance = beat % every === 0;
          g.fx.ring({ x, y: gy + 0.3, z }, 0.5, R, dance ? 0xff7ad0 : 0x9fd8ff, 0.4, 0.7);
          g.enemies.inRadius({ x, y: gy, z }, R, (e) => {
            k.hit(e, 6 + 3 * L, undefined, true);
            if (dance && !e.def.boss && e.alive) {
              e.stagger = Math.max(e.stagger, 0.6);
              danced++;
            }
          });
          if (dance) g.fx.number({ x, y: gy + 2.6, z }, '♪ ♪ ♪', 'info');
          g.audio.chime();
        }
        return t < 6;
      },
      dispose: () => {
        if (box?.alive) g.world.shatter(box);
        sp?.removeFromParent();
        if (danced >= 10) k.comboLog('karaoke.dance', { n: danced });
      },
    });
    // 全校カラオケ大会: ジュークボックスの近くでは、棒を振る速さ +20%
    if (E) this.karaokeBuff = { x, z, until: g.time + 6 };
  }

  /** 全校カラオケ大会の、振る速さが上がる場所と時刻 */
  karaokeBuff: { x: number; z: number; until: number } | null = null;

  /** 棒を振る速さの倍率（全校カラオケ大会の近くにいるとき）。 */
  swingMul(): number {
    const b = this.karaokeBuff;
    if (!b || b.until < this.g.time) return 1;
    const p = this.g.player.pos;
    return Math.hypot(p.x - b.x, p.z - b.z) < 6 ? 1.2 : 1;
  }

  // ---------------------------------------------------------------- サッカー部のシュート（敵を蹴り飛ばして、ぶつかった所で爆発）
  private shoot(s: SkillInst): void {
    const g = this.g;
    const k = this.k;
    const L = s.level;
    const E = !!s.evolved;
    const p = g.player.pos;
    const kick = k.nearestN(E ? 2 : 1, 4.5).filter((e) => !e.def.boss && e.state !== 'dead');
    if (!kick.length) {
      s.cd = 0.3;
      return;
    }
    s.cd = k.cdOf(4.5 - 0.2 * L);
    // 蹴る向き: 敵の集まった方（いなければ前）
    const c = g.enemies.cluster(p, 22);
    const f = k.forward();
    let dx = c ? c.x - p.x : f.x;
    let dz = c ? c.z - p.z : f.z;
    const d = Math.hypot(dx, dz) || 1;
    dx /= d;
    dz /= d;
    const sp = 22 + 2 * L;
    for (const e of kick) {
      g.enemies.launch(e, { x: dx * sp, y: 4, z: dz * sp });
      e.chained = true;
      if (E) {
        e.burn = Math.max(e.burn, 3);
        e.burnDps = Math.max(e.burnDps, 10 + 4 * L);
      }
      g.fx.hitMark({ x: e.x, y: e.y, z: e.z }, 1, { x: dx, y: 0, z: dz }, true);
      let t = 0;
      let boomed = false;
      let lastV = sp;
      k.addTask({
        update: (dt) => {
          t += dt;
          if (!e.alive) return false;
          const v = e.body.linvel();
          const now = Math.hypot(v.x, v.z);
          // 急に遅くなったら、何かにぶつかった
          if (!boomed && t > 0.08 && (now < lastV * 0.55 || t > 1.4)) {
            boomed = true;
            g.explode({ x: e.x, y: e.y, z: e.z }, k.area(E ? 3.6 : 2.6), 28 + 12 * L, { source: 'skill', force: 12, struct: 15, element: E ? 'fire' : undefined });
            return false;
          }
          lastV = Math.max(now, lastV * 0.98);
          return t < 1.6;
        },
      });
    }
    g.audio.hit(1);
    g.fx.shake('S');
  }

  // ---------------------------------------------------------------- 卒業アルバムの撮影（止めて、受けるダメージを増やす）
  private photo(s: SkillInst): void {
    const g = this.g;
    const k = this.k;
    const L = s.level;
    const E = !!s.evolved;
    const R = k.area(8 + 0.5 * L);
    if (!this.cone(R, 0.6).length) {
      s.cd = 0.4;
      return;
    }
    s.cd = k.cdOf(9 - 0.4 * L);
    const shots = E ? 3 : 1;
    let n = 0;
    let t = 0;
    let posed = 0;
    k.addTask({
      update: (dt) => {
        t += dt;
        while (n < shots && t >= n * 0.35) {
          n++;
          g.fx.flash('gold');
          g.audio.chime();
          for (const e of this.cone(R, 0.6)) {
            k.hit(e, 10 + 4 * L, undefined, false);
            if (!e.alive) continue;
            e.scared = Math.max(e.scared ?? 0, g.time + 3);
            if (!e.def.boss) {
              e.stagger = Math.max(e.stagger, 0.7 + 0.1 * L);
              posed++;
            }
            g.fx.number({ x: e.x, y: e.y + e.halfH + e.radius + 0.4, z: e.z }, '📸', 'info');
          }
        }
        return n < shots;
      },
      dispose: () => {
        if (posed >= 8) k.comboLog('photo.many', { n: posed });
        log('skill.photo', { posed }, { time: Math.round(g.time) });
      },
    });
  }
}
