import * as THREE from 'three';
import { G, G_ALL, groups, RAPIER } from '../core/physics';
import { V3 } from '../core/vec';
import { log } from '../log';
import { SkillDmg } from './defs';
import type { Enemy } from './enemies';
import { ZONE } from './fx';
import type { Game } from './game';
import { angleSwept, miyageDmg } from './rules';
import type { SkillInst, Skills } from './skills';
import { Prop, PROPS } from './world';

type Handler = (s: SkillInst, dt: number) => void;

function norm2(x: number, z: number, fx = 0, fz = 1): { x: number; z: number } {
  const d = Math.hypot(x, z);
  return d > 1e-4 ? { x: x / d, z: z / d } : { x: fx, z: fz };
}

/** 連帯責任でつながった敵のまとまり */
export interface Bond {
  ms: Enemy[];
  t: number;
  pct: number;
  E: boolean;
  zap: number;
}

interface Cracker {
  e: Enemy;
  t: number;
  ch: number;
  sp: THREE.Sprite;
  L: number;
  E: boolean;
  ctx: SkillDmg | null;
  x: number;
  y: number;
  z: number;
}

interface Spark {
  x: number;
  z: number;
  dx: number;
  dz: number;
  t: number;
  turn: number;
  sp: THREE.Sprite;
  L: number;
  E: boolean;
  ctx: SkillDmg | null;
}

const UP = new THREE.Vector3(0, 1, 0);
const tv = new THREE.Vector3();

/**
 * 第 3 弾の攻撃スキル（LoL・Dota・PoE の仕組みを学校風に）。
 * 冷蔵庫・洗濯機・バスケットゴールは NVIDIA USDCraft-10K を変換した物体。人体模型は Blender で作った物。
 */
export class ThirdSkills {
  private bonds: Bond[] = [];
  private sharing = false;
  private crackers: Cracker[] = [];
  private sparks: Spark[] = [];
  /** 置き土産: 最近倒れた敵の場所と最大 HP */
  private deaths: { x: number; y: number; z: number; mhp: number; t: number }[] = [];
  /** 生活指導の「こらーっ！」: 残り秒数、回転斬りの待ち時間 */
  private koraT = 0;
  private koraCd = 0;
  private koraSpin = 0;
  private koraS: SkillInst | null = null;
  private koraCtx: SkillDmg | null = null;

  constructor(private g: Game, private k: Skills) {}

  handlers(): Record<string, Handler> {
    return {
      nawatobi: (s) => this.nawatobi(s),
      rentai: (s) => this.rentai(s),
      jintai: (s) => this.jintai(s),
      senbazuru: (s) => this.senbazuru(s),
      cracker: (s) => this.cracker(s),
      straw: (s) => this.straw(s),
      miyage: (s) => this.miyage(s),
      nezumi: (s) => this.nezumi(s),
      kora: (s) => this.kora(s),
      reizouko: (s) => this.reizouko(s),
      sentakuki: (s) => this.sentakuki(s),
      dunk: (s) => this.dunk(s),
    };
  }

  private gy(x: number, z: number): number {
    return this.g.world.groundY(x, z);
  }

  /** USDCraft の小物などを出す。定義が無ければ null。 */
  private spawnU(id: string, pos: V3, yaw: number, opts: { scale?: number; life?: number } = {}): Prop | null {
    if (!PROPS[id]) return null;
    return this.g.world.spawnProp(id, pos, yaw, opts);
  }

  /** 物理で動かず、ノリコにだけ当たらない置き物にする（敵は止める）。 */
  private pin(p: Prop): void {
    p.body.setBodyType(RAPIER.RigidBodyType.Fixed, true);
    p.rooted = true;
    p.col.setCollisionGroups(groups(G.PROP, G_ALL & ~G.PLAYER));
  }

  // ---------------------------------------------------------------- 大縄跳び（LoL ダリウスの Q のように、まわりを薙ぐ）
  private nawatobi(s: SkillInst): void {
    const g = this.g;
    const k = this.k;
    const L = s.level;
    const E = !!s.evolved;
    const p = g.player.pos;
    if (!g.enemies.nearest(p, 9)) {
      s.cd = 0.5;
      return;
    }
    s.cd = k.cdOf(9 - 0.4 * L);
    const R = k.area(5 + 0.4 * L);
    const r0 = 1.0;
    const ropes = E ? 2 : 1;
    for (let ri = 0; ri < ropes; ri++) {
      const dir = ri === 0 ? 1 : -1;
      const w = (2.6 + 0.2 * L) * dir;
      let a = Math.random() * Math.PI * 2;
      let t = 0;
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1, 6), new THREE.MeshLambertMaterial({ color: ri ? 0xff5a8a : 0xffd23a }));
      mesh.castShadow = true;
      g.world.root.add(mesh);
      let hits = 0;
      k.addTask({
        update: (dt) => {
          t += dt;
          const c = g.player.pos;
          const a1 = a + w * dt;
          const y = c.y + 0.35 + Math.abs(Math.sin(t * 6)) * 0.25;
          const mid = (r0 + R) / 2;
          tv.set(Math.cos(a1), 0, Math.sin(a1));
          mesh.quaternion.setFromUnitVectors(UP, tv);
          mesh.scale.set(1, R - r0, 1);
          mesh.position.set(c.x + tv.x * mid, y, c.z + tv.z * mid);
          for (const e of g.enemies.list) {
            if (e.state === 'dead') continue;
            const dx = e.x - c.x;
            const dz = e.z - c.z;
            const d = Math.hypot(dx, dz);
            if (d < r0 - e.radius || d > R + e.radius) continue;
            if (!angleSwept(a, a1, Math.atan2(dz, dx))) continue;
            if ((e.cd?.get('nawa') ?? 0) > g.time) continue;
            (e.cd ??= new Map()).set('nawa', g.time + 0.5);
            // 縄の進む向き（接線）へはじく
            const tx = -Math.sin(a1) * dir;
            const tz = Math.cos(a1) * dir;
            k.hit(e, 10 + 4 * L, { x: tx * 4, y: 2, z: tz * 4 });
            g.enemies.launch(e, { x: tx * 3, y: 9 + L, z: tz * 3 });
            hits++;
          }
          a = a1;
          return t < 4;
        },
        dispose: () => {
          mesh.removeFromParent();
          mesh.geometry.dispose();
          (mesh.material as THREE.Material).dispose();
          if (hits >= 8) this.k.comboLog('nawatobi.many', { hits });
        },
      });
    }
    g.audio.whoosh();
  }

  // ---------------------------------------------------------------- 連帯責任（Dota ウォーロックのフェイタルボンド）
  private rentai(s: SkillInst): void {
    const g = this.g;
    const k = this.k;
    const L = s.level;
    const E = !!s.evolved;
    const p = g.player.pos;
    const e0 = g.enemies.nearest(p, 12, (o) => !!o.bond);
    if (!e0) {
      s.cd = 0.5;
      return;
    }
    const n = Math.min(10, 3 + L + g.stats.amount);
    const near = g.enemies.list
      .filter((o) => o.state !== 'dead' && !o.bond && Math.hypot(o.x - e0.x, o.z - e0.z) < 8)
      .sort((a, b) => Math.hypot(a.x - e0.x, a.z - e0.z) - Math.hypot(b.x - e0.x, b.z - e0.z))
      .slice(0, n);
    if (near.length < 2) {
      s.cd = 0.5;
      return;
    }
    s.cd = k.cdOf(9 - 0.3 * L);
    const b: Bond = { ms: near, t: 6, pct: E ? 0.8 : 0.35 + 0.05 * L, E, zap: 0 };
    for (const e of near) {
      e.bond = b;
      k.hit(e, 8 + 3 * L, undefined, true);
    }
    this.bonds.push(b);
    g.audio.clank();
  }

  /** つながった敵がダメージを受けたとき（enemies.damage から呼ぶ）。ほかの敵へ分ける。 */
  onBond(e: Enemy, dmg: number): void {
    const b = e.bond;
    if (!b || this.sharing || dmg <= 0) return;
    const g = this.g;
    this.sharing = true;
    try {
      for (const o of b.ms) {
        if (o === e || !o.alive || o.state === 'dead') continue;
        const share = dmg * b.pct;
        o.hp -= share;
        o.flash = 0.11;
        g.run.damage += share;
        if (share >= 2 && Math.random() < 0.25) g.fx.number({ x: o.x, y: o.y + o.halfH + o.radius + 0.3, z: o.z }, String(Math.round(share)), 'true');
        if (o.hp <= 0) g.enemies.kill(o, 'skill');
      }
    } finally {
      this.sharing = false;
    }
  }

  private updateBonds(dt: number): void {
    const g = this.g;
    for (let i = this.bonds.length - 1; i >= 0; i--) {
      const b = this.bonds[i];
      b.t -= dt;
      b.zap -= dt;
      const live = b.ms.filter((o) => o.alive && o.state !== 'dead');
      if (b.zap <= 0 && live.length > 1) {
        b.zap = 0.25;
        for (let j = 1; j < live.length; j++) {
          const a = live[j - 1];
          const c = live[j];
          g.fx.bolt({ x: a.x, y: a.y + 0.5, z: a.z }, { x: c.x, y: c.y + 0.5, z: c.z }, 0x9a9aa8, 0.08, 0.15, 0.26);
        }
      }
      if (b.t > 0 && live.length > 1) continue;
      for (const o of b.ms) if (o.bond === b) o.bond = null;
      this.bonds.splice(i, 1);
    }
  }

  // ---------------------------------------------------------------- 理科室の人体模型（Dota ウォーロックのゴーレム・LoL アニーのティバーズ）
  private jintai(s: SkillInst): void {
    const g = this.g;
    const k = this.k;
    const L = s.level;
    const E = !!s.evolved;
    const p = g.player.pos;
    if (!g.enemies.nearest(p, 14)) {
      s.cd = 0.5;
      return;
    }
    s.cd = k.cdOf(22 - L);
    const n = E ? 2 : 1;
    const life = 10 + L;
    for (let i = 0; i < n; i++) {
      const a = g.player.yaw + (i ? -1 : 1) * 0.9;
      let x = p.x + Math.sin(a) * 2;
      let z = p.z + Math.cos(a) * 2;
      const body = this.spawnU('jintai', { x, y: this.gy(x, z), z }, a, {});
      if (body) {
        body.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
        body.rooted = true;
        body.col.setCollisionGroups(groups(G.PROP, G_ALL & ~G.PLAYER));
      }
      const sp = body ? null : k.sprite('🫀', 1.6);
      const lure = { x, z, r: 9 };
      g.enemies.lures.push(lure);
      let t = 0;
      let hop = 0.2;
      let hx = x;
      let hz = z;
      let tx = x;
      let tz = z;
      let yaw = a;
      let punches = 0;
      k.addTask({
        update: (dt) => {
          t += dt;
          hop -= dt;
          if (hop <= 0) {
            hop = 0.55;
            hx = x;
            hz = z;
            const e = g.enemies.nearest({ x, y: 0, z }, 14);
            if (e) {
              const d = Math.hypot(e.x - x, e.z - z);
              yaw = Math.atan2(e.x - x, e.z - z);
              if (d < 1.9) {
                // 殴る
                const nx = (e.x - x) / (d || 1);
                const nz = (e.z - z) / (d || 1);
                for (const o of g.enemies.list) {
                  if (o.state === 'dead' || Math.hypot(o.x - (x + nx), o.z - (z + nz)) > 1.6) continue;
                  k.hit(o, 14 + 6 * L, { x: nx * 9, y: 4, z: nz * 9 });
                  punches++;
                }
                if (E) g.player.heal(g.stats.maxHp * 0.005);
                g.fx.hitMark({ x: x + nx, y: this.gy(x, z) + 1.1, z: z + nz }, 0.7);
                g.audio.thud(0.5);
                tx = x;
                tz = z;
              } else {
                const step = Math.min(2.2, d - 1.2);
                tx = x + ((e.x - x) / d) * step;
                tz = z + ((e.z - z) / d) * step;
              }
            } else {
              // 敵がいなければノリコのそばへ戻る
              const pp = g.player.pos;
              const d = Math.hypot(pp.x - x, pp.z - z);
              if (d > 3) {
                tx = x + ((pp.x - x) / d) * 2;
                tz = z + ((pp.z - z) / d) * 2;
              }
            }
          }
          // 跳ねて動く
          const u = 1 - Math.max(0, hop) / 0.55;
          x = hx + (tx - hx) * Math.min(1, u * 1.6);
          z = hz + (tz - hz) * Math.min(1, u * 1.6);
          const y = this.gy(x, z) + Math.sin(Math.min(1, u * 1.6) * Math.PI) * 0.6;
          if (body?.alive) {
            body.body.setNextKinematicTranslation({ x, y: y + body.half.y, z });
            body.body.setNextKinematicRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) });
          }
          if (sp) sp.position.set(x, y + 0.9, z);
          lure.x = x;
          lure.z = z;
          return t < life;
        },
        dispose: () => {
          const li = g.enemies.lures.indexOf(lure);
          if (li >= 0) g.enemies.lures.splice(li, 1);
          if (body?.alive) g.world.shatter(body);
          sp?.removeFromParent();
          log('skill.jintai', { punches }, { time: Math.round(g.time) });
        },
      });
    }
    g.audio.boing();
  }

  // ---------------------------------------------------------------- 千羽鶴（LoL ミス・フォーチュンの R）
  private senbazuru(s: SkillInst): void {
    const g = this.g;
    const k = this.k;
    const L = s.level;
    const E = !!s.evolved;
    const c = k.aim(18);
    if (!c) {
      s.cd = 0.5;
      return;
    }
    s.cd = k.cdOf(10 - 0.5 * L);
    const dur = E ? 4 : 2;
    const per = 4 + L + g.stats.amount;
    let t = 0;
    let next = 0;
    k.addTask({
      update: (dt) => {
        t += dt;
        if (t < next) return true;
        if (t > dur) return false;
        next += 0.25;
        const p = g.player.pos;
        const base = Math.atan2(c.x - p.x, c.z - p.z);
        const from = k.chest();
        for (let i = 0; i < per; i++) {
          const a = E ? (i / per) * Math.PI * 2 + Math.random() * 0.4 : base + (Math.random() - 0.5) * 0.9;
          g.projectiles.fire({ emoji: '🕊️', size: 0.55, pos: { ...from }, vel: { x: Math.sin(a) * 18, y: 0.5, z: Math.cos(a) * 18 }, r: 0.35, dmg: 6 + 2 * L, life: E ? 1.1 : 0.9, pierce: 1, knock: 2, aim: true });
        }
        return true;
      },
    });
    g.audio.whoosh();
  }

  // ---------------------------------------------------------------- パーティークラッカー（LoL トリスターナの E）
  private cracker(s: SkillInst): void {
    const g = this.g;
    const k = this.k;
    const L = s.level;
    const E = !!s.evolved;
    const p = g.player.pos;
    const n = E ? 3 : 1;
    let made = 0;
    for (let i = 0; i < n; i++) {
      const e = g.enemies.nearest(p, 10, (o) => this.crackers.some((c) => c.e === o));
      if (!e) break;
      this.crackers.push({ e, t: 4, ch: 0, sp: k.sprite('🎉', 0.7), L, E, ctx: k.cur, x: e.x, y: e.y, z: e.z });
      made++;
    }
    s.cd = made ? k.cdOf(5 - 0.25 * L) : 0.5;
  }

  /** クラッカーにたまった火薬のうち、いちばん多い数（スキル欄に出す）。 */
  crackerCharge(): number {
    let m = 0;
    for (const c of this.crackers) m = Math.max(m, c.ch);
    return m;
  }

  private boomCracker(c: Cracker): void {
    const g = this.g;
    const k = this.k;
    const r = k.area(2.5 + 0.2 * c.L) * (c.E ? 1.5 : 1);
    g.explode({ x: c.x, y: c.y + 0.4, z: c.z }, r, (20 + 8 * c.L) * (1 + 0.3 * c.ch), { source: 'skill', force: 10, struct: 8, ctx: c.ctx ?? undefined });
    for (const col of [0xff5a8a, 0xffd23a, 0x5ad8ff, 0x8fe05a]) g.fx.sparkle({ x: c.x, y: c.y + 1, z: c.z }, col, 5, 1.2);
    if (c.ch >= 4) k.comboLog('cracker.full', { ch: c.ch });
  }

  private updateCrackers(dt: number): void {
    for (let i = this.crackers.length - 1; i >= 0; i--) {
      const c = this.crackers[i];
      c.t -= dt;
      const alive = c.e.alive && c.e.state !== 'dead';
      if (alive) {
        c.x = c.e.x;
        c.y = c.e.y;
        c.z = c.e.z;
        c.sp.position.set(c.x, c.y + c.e.halfH + c.e.radius + 0.6, c.z);
        c.sp.scale.setScalar(0.7 + 0.12 * c.ch);
      }
      if (alive && c.t > 0 && c.ch < 4) continue;
      c.sp.removeFromParent();
      this.crackers.splice(i, 1);
      this.boomCracker(c);
    }
  }

  // ---------------------------------------------------------------- ストロー吸引（Dota プーニャのライフドレイン）
  private straw(s: SkillInst): void {
    const g = this.g;
    const k = this.k;
    const L = s.level;
    const E = !!s.evolved;
    // 0.25 秒ごとに吸う（0.5 秒より短いので「発動した」とは数えない）
    s.cd = 0.25;
    const p = g.player.pos;
    const list: Enemy[] = (s.st.list ??= []);
    const n = (1 + Math.floor(L / 2) + g.stats.amount) * (E ? 2 : 1);
    for (let i = list.length - 1; i >= 0; i--) {
      const e = list[i];
      if (!e.alive || e.state === 'dead' || Math.hypot(e.x - p.x, e.z - p.z) > 10) list.splice(i, 1);
    }
    while (list.length < n) {
      const e = g.enemies.nearest(p, 7, (o) => list.includes(o));
      if (!e) break;
      list.push(e);
    }
    if (!list.length) return;
    const from = k.chest();
    const dmg = 4 + 1.5 * L;
    for (const e of list) {
      g.fx.bolt(from, { x: e.x, y: e.y + 0.5, z: e.z }, 0xff7ab0, 0.07, 0.05, 0.27);
      k.hit(e, dmg, undefined, true);
    }
    g.addHeal(dmg * list.length * g.scaleFor(k.cur) * (E ? 0.5 : 0.3));
  }

  // ---------------------------------------------------------------- 置き土産（PoE のディトネイト・デッド）
  private miyage(s: SkillInst): void {
    const g = this.g;
    const k = this.k;
    const L = s.level;
    const E = !!s.evolved;
    const p = g.player.pos;
    const now = g.time;
    this.deaths = this.deaths.filter((d) => now - d.t < 5);
    const near = this.deaths.filter((d) => Math.hypot(d.x - p.x, d.z - p.z) < 16);
    if (!near.length) {
      s.cd = 0.4;
      return;
    }
    s.cd = k.cdOf(3 - 0.15 * L);
    const take = near.slice(-(3 + L + g.stats.amount));
    this.deaths = this.deaths.filter((d) => !take.includes(d));
    const ctx = k.cur;
    let t = 0;
    let i = 0;
    k.addTask({
      update: (dt) => {
        t += dt;
        while (i < take.length && t >= i * 0.08) {
          const d = take[i++];
          g.explode({ x: d.x, y: d.y + 0.4, z: d.z }, k.area(2.6), miyageDmg(L, d.mhp), { source: 'skill', force: 9, struct: 6, element: 'dark', ctx: ctx ?? undefined });
          if (E) k.addCloud(d.x, d.z, k.area(1.8), 4, 15 + 3 * L);
        }
        return i < take.length;
      },
    });
  }

  // ---------------------------------------------------------------- ねずみ花火（PoE のスパーク）
  private nezumi(s: SkillInst): void {
    const g = this.g;
    const k = this.k;
    const L = s.level;
    const E = !!s.evolved;
    const p = g.player.pos;
    if (!g.enemies.nearest(p, 14)) {
      s.cd = 0.5;
      return;
    }
    s.cd = k.cdOf(6 - 0.3 * L);
    const n = Math.min(12, 3 + L + g.stats.amount);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      this.sparks.push({ x: p.x, z: p.z, dx: Math.sin(a), dz: Math.cos(a), t: 2.5 + 0.3 * L, turn: 0, sp: k.sprite('🎇', E ? 1 : 0.6), L, E, ctx: k.cur });
    }
    while (this.sparks.length > 40) this.sparks.shift()!.sp.removeFromParent();
    g.audio.pop();
  }

  private updateSparks(dt: number): void {
    const g = this.g;
    const k = this.k;
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i];
      s.t -= dt;
      s.turn -= dt;
      if (s.turn <= 0) {
        s.turn = 0.25 + Math.random() * 0.3;
        const e = Math.random() < 0.45 ? g.enemies.random({ x: s.x, y: 0, z: s.z }, 8) : null;
        const n = e ? norm2(e.x - s.x, e.z - s.z) : norm2(Math.random() - 0.5, Math.random() - 0.5);
        s.dx = n.x;
        s.dz = n.z;
      }
      const sp = s.E ? 8 : 7;
      s.x += s.dx * sp * dt;
      s.z += s.dz * sp * dt;
      const gy = this.gy(s.x, s.z);
      s.sp.position.set(s.x, gy + 0.35, s.z);
      s.sp.material.rotation += dt * 20;
      if (Math.random() < dt * 25) g.fx.spawn({ pos: { x: s.x, y: gy + 0.3, z: s.z }, vel: { x: (Math.random() - 0.5) * 3, y: 2 + Math.random() * 2, z: (Math.random() - 0.5) * 3 }, grav: -10, life: 0.35, size: 0.12, size2: 0.04, color: 0xffb03a, shape: 0, alpha: 1 });
      const keep = k.cur;
      k.cur = s.ctx;
      for (const e of g.enemies.list) {
        if (e.state === 'dead' || Math.hypot(e.x - s.x, e.z - s.z) > e.radius + (s.E ? 1.2 : 0.8)) continue;
        if ((e.cd?.get('nez') ?? 0) > g.time) continue;
        (e.cd ??= new Map()).set('nez', g.time + 0.35);
        // 倒れなかった敵は燃える
        if (!k.hit(e, 6 + 2 * s.L, { x: s.dx * 2, y: 1.5, z: s.dz * 2 }, true)) {
          e.burn = Math.max(e.burn, 2);
          e.burnDps = Math.max(e.burnDps, 3 + s.L + g.ap * 0.05);
        }
      }
      k.cur = keep;
      if (s.t > 0) continue;
      s.sp.removeFromParent();
      this.sparks.splice(i, 1);
      if (s.E) g.explode({ x: s.x, y: gy + 0.4, z: s.z }, k.area(2.2), 15 + 5 * s.L, { source: 'skill', force: 7, struct: 4, small: true, element: 'fire', ctx: s.ctx ?? undefined });
    }
  }

  // ---------------------------------------------------------------- 生活指導の「こらーっ！」（Dota アックスのバーサーカーズコール・カウンターヘリックス）
  private kora(s: SkillInst): void {
    const g = this.g;
    const k = this.k;
    const L = s.level;
    const p = g.player.pos;
    const near = g.enemies.list.filter((e) => e.state !== 'dead' && Math.hypot(e.x - p.x, e.z - p.z) < 8);
    if (!near.length) {
      s.cd = 0.5;
      return;
    }
    s.cd = k.cdOf(12 - 0.5 * L);
    this.koraT = 4;
    this.koraS = s;
    this.koraCtx = k.cur;
    this.koraSpin = 0.5;
    g.shieldT = Math.max(g.shieldT, 4);
    g.shieldDef = Math.max(g.shieldDef, 40);
    for (const e of near) if (!e.def.boss) e.taunt = 4;
    g.fx.number({ x: p.x, y: p.y + 2.4, z: p.z }, '😠 こらーっ！', 'hurt');
    g.fx.ring({ x: p.x, y: p.y + 0.1, z: p.z }, 0.5, 8, 0xff4a4a, 0.4, 0.6);
    g.fx.shake('S');
    g.audio.shout();
    log('skill.kora', { n: near.length }, { time: Math.round(g.time) });
  }

  /** 回転斬り（カウンター）。 */
  private spin(): void {
    const g = this.g;
    const k = this.k;
    const s = this.koraS;
    if (!s) return;
    const L = s.level;
    const p = g.player.pos;
    const R = k.area(3 + 0.2 * L);
    const keep = k.cur;
    k.cur = this.koraCtx;
    g.enemies.inRadius(p, R, (e, d) => {
      const n = norm2(e.x - p.x, e.z - p.z);
      k.hit(e, 15 + 6 * L, { x: n.x * 8, y: 3, z: n.z * 8 });
      void d;
    });
    k.cur = keep;
    g.fx.ring({ x: p.x, y: p.y + 0.6, z: p.z }, R * 0.4, R, 0xffb04a, 0.2, 0.7);
    g.audio.swing(1);
  }

  /** ノリコがダメージを受けたとき（こらーっ！の間はやり返す）。 */
  onPlayerHurt(): void {
    if (this.koraT <= 0 || this.koraCd > 0) return;
    this.koraCd = 0.25;
    this.spin();
  }

  // ---------------------------------------------------------------- 業務用冷蔵庫（Dota ジャキロのアイスパス）
  private reizouko(s: SkillInst): void {
    const g = this.g;
    const k = this.k;
    const L = s.level;
    const E = !!s.evolved;
    const c = k.aim(16);
    if (!c) {
      s.cd = 0.5;
      return;
    }
    s.cd = k.cdOf(13 - 0.5 * L);
    const p = g.player.pos;
    const dir = norm2(c.x - p.x, c.z - p.z);
    const x = p.x + dir.x * 1.6;
    const z = p.z + dir.z * 1.6;
    const box = this.spawnU('u_fridge', { x, y: this.gy(x, z), z }, Math.atan2(dir.x, dir.z), { scale: 1.2 });
    if (box) this.pin(box);
    const blasts = 4 + Math.floor(L / 2);
    const R = k.area(7 + 0.4 * L) * (E ? 2 : 1);
    let t = 0;
    let next = 0.4;
    let done = 0;
    let open = false;
    let closeAt = 0;
    k.addTask({
      update: (dt) => {
        t += dt;
        // 吹き出す 0.5 秒前に扉を開け、吹き出した 0.35 秒後に閉める
        const want = t > next - 0.5 || t < closeAt;
        if (box?.alive && want !== open) {
          open = want;
          g.world.driveJoint(box, 'hinge', want ? 1.7 : null);
        }
        if (t < next) return true;
        if (done >= blasts) return false;
        done++;
        next += 1.0;
        let n = 0;
        for (const e of g.enemies.list) {
          if (e.state === 'dead') continue;
          const dx = e.x - x;
          const dz = e.z - z;
          const d = Math.hypot(dx, dz);
          if (d > R || (dx * dir.x + dz * dir.z) / (d || 1) < 0.5) continue;
          k.hit(e, 12 + 5 * L, { x: dir.x * 4, y: 1, z: dir.z * 4 });
          g.enemies.freeze(e, 1 + 0.1 * L);
          n++;
        }
        for (let j = 0; j < 22; j++) {
          const a = Math.atan2(dir.x, dir.z) + (Math.random() - 0.5) * 1.0;
          const sp = 8 + Math.random() * 8;
          g.fx.spawn({ pos: { x, y: this.gy(x, z) + 1, z }, vel: { x: Math.sin(a) * sp, y: (Math.random() - 0.3) * 2, z: Math.cos(a) * sp }, life: R / 14, size: 0.4, size2: 1.1, color: 0xeaf6ff, shape: 0, alpha: 0.7 });
        }
        closeAt = t + 0.35;
        g.audio.freeze();
        void n;
        return true;
      },
      dispose: () => {
        if (box?.alive) g.world.shatter(box, { x: dir.x * 2, y: 3, z: dir.z * 2 });
      },
    });
  }

  // ---------------------------------------------------------------- 洗濯機の脱水（LoL タム・ケンチの R: 飲みこんで吐き出す）
  private sentakuki(s: SkillInst): void {
    const g = this.g;
    const k = this.k;
    const L = s.level;
    const E = !!s.evolved;
    const c = k.aim(16);
    if (!c) {
      s.cd = 0.5;
      return;
    }
    s.cd = k.cdOf(12 - 0.5 * L);
    const gy = this.gy(c.x, c.z);
    const scale = 1.6;
    const box = this.spawnU('u_washer', { x: c.x, y: gy, z: c.z }, Math.random() * Math.PI * 2, { scale });
    if (box) this.pin(box);
    const cap = (E ? 6 : 4) + L;
    const pullR = k.area(5) * (E ? 1.4 : 1);
    const rounds = E ? 2 : 1;
    const held: Enemy[] = [];
    const center = { x: c.x, y: gy + 0.6 * scale, z: c.z };
    let t = 0;
    let round = 0;
    let ang = 0;
    let tick = 0;
    let thrown = 0;
    const release = (e: Enemy) => {
      if (!e.alive || e.state !== 'held') return;
      e.body.setGravityScale(1, true);
      e.state = 'walk';
    };
    k.addTask({
      update: (dt) => {
        t += dt;
        ang += dt * 18;
        if (t < 1.4) {
          // 吸いこむ
          for (const e of g.enemies.list) {
            if (e.state === 'dead' || e.state === 'held' || e.def.boss) continue;
            const dx = center.x - e.x;
            const dz = center.z - e.z;
            const d = Math.hypot(dx, dz);
            if (d > pullR) continue;
            if (d < 1.4 && held.length < cap) {
              e.state = 'held';
              e.body.setGravityScale(0, true);
              held.push(e);
              continue;
            }
            const v = e.body.linvel();
            e.body.setLinvel({ x: v.x * 0.8 + (dx / d) * 4, y: v.y, z: v.z * 0.8 + (dz / d) * 4 }, true);
          }
        } else if (t < 2.6) {
          // 脱水
          if (box?.alive) g.world.driveJoint(box, 'drum', 30);
          tick -= dt;
          const hit = tick <= 0;
          if (hit) tick = 0.3;
          for (const e of held) {
            if (e.state !== 'held') continue;
            if (hit) k.hit(e, 6 + 2 * L, undefined, true);
          }
          if (Math.random() < dt * 30) g.fx.spawn({ pos: { ...center }, vel: { x: (Math.random() - 0.5) * 6, y: 3 + Math.random() * 3, z: (Math.random() - 0.5) * 6 }, grav: -12, life: 0.6, size: 0.25, size2: 0.1, color: 0xbfe8ff, shape: 0, alpha: 0.8 });
        } else {
          // 吐き出す
          if (box?.alive) g.world.driveJoint(box, 'drum', null);
          for (const e of held) {
            if (!e.alive || e.state !== 'held') continue;
            release(e);
            const a = Math.random() * Math.PI * 2;
            const sp = (14 + L) * (E ? 1.1 : 1);
            e.body.setTranslation({ x: center.x + Math.cos(a) * 1.2, y: center.y + 0.6, z: center.z + Math.sin(a) * 1.2 }, true);
            g.enemies.push(e, { x: Math.cos(a) * sp, y: 6, z: Math.sin(a) * sp }, true);
            e.stagger = Math.max(e.stagger, 1.2);
            thrown++;
          }
          held.length = 0;
          g.audio.whoosh();
          round++;
          if (round < rounds) {
            t = 0;
            return true;
          }
          if (thrown >= 5) k.comboLog('sentakuki.many', { n: thrown });
          return false;
        }
        // 吸いこんだ敵は、ドラムの中で回る
        held.forEach((e, i) => {
          if (e.state !== 'held') return;
          const a = ang + (i * Math.PI * 2) / Math.max(1, held.length);
          e.body.setTranslation({ x: center.x + Math.cos(a) * 0.5, y: center.y, z: center.z + Math.sin(a) * 0.5 }, true);
          e.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        });
        return true;
      },
      dispose: () => {
        for (const e of held) release(e);
        if (box?.alive) g.world.shatter(box, { x: 0, y: 3, z: 0 });
      },
    });
  }

  // ---------------------------------------------------------------- ダンクシュート（LoL アリスターの W・Q: 打ち上げてたたきつける）
  private dunk(s: SkillInst): void {
    const g = this.g;
    const k = this.k;
    const L = s.level;
    const E = !!s.evolved;
    const c = k.aim(16);
    if (!c) {
      s.cd = 0.5;
      return;
    }
    s.cd = k.cdOf(11 - 0.5 * L);
    const p = g.player.pos;
    const yaw = Math.atan2(p.x - c.x, p.z - c.z);
    const gy = this.gy(c.x, c.z);
    const hoop = this.spawnU('u_hoop', { x: c.x, y: gy, z: c.z }, yaw, {});
    if (hoop) this.pin(hoop);
    // 輪はゴールの正面（+Z）側、高さ約 3m
    const rim = { x: c.x + Math.sin(yaw) * 0.5, y: gy + 3.05, z: c.z + Math.cos(yaw) * 0.5 };
    const grav = Math.abs(g.physics.world.gravity.y) || 20;
    const gap = Math.max(0.35, 0.9 - 0.06 * L);
    const thrown = new Set<Enemy>();
    let t = 0;
    let next = 0.3;
    let dunks = 0;
    const T = 0.7;
    const ctx = k.cur;
    k.addTask({
      update: (dt) => {
        t += dt;
        if (t < next) return t < 6.5;
        if (t > 6) return false;
        next += gap;
        for (let j = 0; j < (E ? 2 : 1); j++) {
          const e = g.enemies.nearest(rim, 7, (o) => thrown.has(o) || !!o.def.boss);
          if (!e) break;
          thrown.add(e);
          // 輪へ放物線で投げこむ
          const vx = (rim.x - e.x) / T;
          const vz = (rim.z - e.z) / T;
          const vy = (rim.y + 0.4 - e.y) / T + 0.5 * grav * T;
          g.enemies.launch(e, { x: vx, y: vy, z: vz });
          let u = 0;
          let slammed = false;
          k.addTask({
            update: (dt2) => {
              u += dt2;
              if (!e.alive) return false;
              if (!slammed && u >= T) {
                slammed = true;
                e.body.setLinvel({ x: 0, y: -26, z: 0 }, true);
                g.fx.sparkle({ x: rim.x, y: rim.y, z: rim.z }, 0xff8a3a, 6, 0.5);
              }
              if (!slammed) return true;
              const low = e.y - this.gy(e.x, e.z) < e.halfH + e.radius + 0.5;
              if (!low && u < T + 1.2) return true;
              const at = { x: e.x, y: this.gy(e.x, e.z) + 0.3, z: e.z };
              const keep = k.cur;
              k.cur = ctx;
              k.hit(e, 20 + 8 * L);
              g.enemies.inRadius(at, 2.5, (o, d) => {
                if (o === e) return;
                const n = norm2(o.x - at.x, o.z - at.z);
                k.hit(o, (20 + 8 * L) * 0.5, { x: n.x * 6, y: 3, z: n.z * 6 });
                void d;
              });
              k.cur = keep;
              if (E) g.explode(at, k.area(2.8), 15 + 5 * L, { source: 'skill', force: 9, struct: 6, small: true, ctx: ctx ?? undefined });
              g.fx.ring(at, 0.3, 2.5, ZONE.ally, 0.3, 0.6);
              g.fx.shake('S');
              g.audio.thud(0.8);
              dunks++;
              return false;
            },
          });
        }
        return true;
      },
      dispose: () => {
        if (hoop?.alive) g.world.shatter(hoop, { x: 0, y: 3, z: 0 });
        if (dunks >= 4) log('skill.dunk', { dunks }, { time: Math.round(g.time) });
      },
    });
  }

  // ---------------------------------------------------------------- 呼び出し
  /** 武器が敵に当たったとき（パーティークラッカーに火薬をためる）。 */
  onWeaponHit(e: Enemy): void {
    for (const c of this.crackers) {
      if (c.e !== e || c.ch >= 4) continue;
      c.ch++;
      this.g.fx.number({ x: e.x, y: e.y + e.halfH + e.radius + 1.1, z: e.z }, `🎉${c.ch}`, 'info');
    }
  }

  /** 敵が倒れたとき（置き土産の跡を覚える・一蓮托生の気絶）。 */
  onEnemyKilled(e: Enemy): void {
    if (this.k.get('miyage')) {
      this.deaths.push({ x: e.x, y: e.y, z: e.z, mhp: e.maxHp, t: this.g.time });
      if (this.deaths.length > 40) this.deaths.shift();
    }
    const b = e.bond;
    if (b?.E) {
      for (const o of b.ms) if (o !== e && o.alive && o.state !== 'dead') o.stagger = Math.max(o.stagger, o.def.boss ? 0.2 : 0.6);
    }
  }

  update(dt: number): void {
    if (this.bonds.length) this.updateBonds(dt);
    if (this.crackers.length) this.updateCrackers(dt);
    if (this.sparks.length) this.updateSparks(dt);
    if (this.koraT > 0) {
      this.koraT -= dt;
      this.koraCd -= dt;
      if (this.koraS?.evolved) {
        this.koraSpin -= dt;
        if (this.koraSpin <= 0) {
          this.koraSpin = 0.5;
          this.spin();
        }
      }
    }
  }

  dispose(): void {
    for (const c of this.crackers) c.sp.removeFromParent();
    this.crackers.length = 0;
    for (const s of this.sparks) s.sp.removeFromParent();
    this.sparks.length = 0;
    for (const b of this.bonds) for (const o of b.ms) if (o.bond === b) o.bond = null;
    this.bonds.length = 0;
  }
}
