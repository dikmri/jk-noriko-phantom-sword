import * as THREE from 'three';
import { V3 } from '../core/vec';
import { log } from '../log';
import { SKILL_MAP, SkillDmg } from './defs';
import type { Enemy } from './enemies';
import { ZONE } from './fx';
import type { Game } from './game';
import { omikujiDraw, planeScale, planeStun } from './rules';
import type { SkillInst, Skills } from './skills';
import { G, groups, RAPIER } from '../core/physics';
import { PROPS, type Prop } from './world';

type Handler = (s: SkillInst, dt: number) => void;

/** びっくり箱 */
interface JackBox {
  x: number;
  z: number;
  gy: number;
  sp: THREE.Sprite;
  life: number;
  uses: number;
  cd: number;
  L: number;
  E: boolean;
  ctx: SkillDmg | null;
  /** USDCraft のびっくり箱（無ければ絵文字だけ） */
  prop: Prop | null;
  open: boolean;
}

const OMIKUJI_TEXT = { daikichi: '⛩️ 大吉！', kichi: '⛩️ 吉', shokichi: '⛩️ 小吉', kyo: '⛩️ 凶…' } as const;

/**
 * 第 2 弾の攻撃スキル（LoL・Dota・PoE の仕組みを学校風に）。
 * Skills の補助（hit・addTask・aim など）を使い、Skills.update から毎フレーム呼ばれる。
 */
export class MoreSkills {
  /** 置いてあるびっくり箱 */
  private boxes: JackBox[] = [];
  /** 開いている傘（置き傘ガード） */
  private umb: { t: number; r: number; mul: number; sp: THREE.Sprite; push: number; logT: number; n: number } | null = null;
  /** プリント配布: この 1 秒に飛ばした枚数 */
  private papers = 0;
  private paperT = 0;

  constructor(private g: Game, private k: Skills) {}

  handlers(): Record<string, Handler> {
    return {
      yuutai: (s) => this.yuutai(s),
      hikouki: (s) => this.hikouki(s),
      nukiuchi: (s) => this.nukiuchi(s),
      shimei: (s) => this.shimei(s),
      omikuji: (s) => this.omikuji(s),
      // プリント配布は敵が倒れたときに働く（onEnemyKilled）
      // 待ち時間を 0.5 秒より短くして、「発動した」と数えない（三色ボールペン・カセットテープ）
      purinto: (s) => {
        s.cd = 0.45;
      },
      asagao: (s) => this.asagao(s),
      kasa: (s) => this.kasa(s),
      bikkuri: (s) => this.bikkuri(s),
    };
  }

  // ---------------------------------------------------------------- 幽体離脱（Dota のオムニスラッシュ）
  /** ノリコの魂が抜け出し、近くの敵の間を飛び回って斬る。体は動かせる。 */
  private yuutai(s: SkillInst): void {
    const g = this.g;
    const k = this.k;
    const L = s.level;
    const E = !!s.evolved;
    const p = g.player.pos;
    let cur = g.enemies.nearest(p, 14);
    if (!cur) {
      s.cd = 0.4;
      return;
    }
    s.cd = k.cdOf(E ? 7 : 9 - 0.4 * L);
    let hops = (E ? 12 : 3 + L) + g.stats.amount;
    let extra = 0;
    const dmg = (14 + 6 * L) * (E ? 1.5 : 1);
    const ghost = k.sprite(E ? '👹' : '👻', E ? 1.6 : 1.3);
    let from: V3 = { x: p.x, y: p.y + 1.1, z: p.z };
    ghost.position.set(from.x, from.y, from.z);
    const done = new Set<Enemy>();
    let wait = 0.05;
    let kills = 0;
    g.audio.whoosh();
    k.addTask({
      update: (dt) => {
        wait -= dt;
        if (wait > 0) return true;
        if (hops <= 0) return false;
        if (!cur || !cur.alive || cur.state === 'dead') cur = g.enemies.nearest(from, 9, (o) => done.has(o)) ?? g.enemies.nearest(from, 9);
        if (!cur) return false;
        const to = { x: cur.x, y: cur.y + 0.5, z: cur.z };
        g.fx.bolt(from, to, E ? 0xff6a6a : 0xbfe6ff, 0.3, 0.05, 0.12);
        ghost.position.set(to.x + (Math.random() - 0.5) * 0.8, to.y + 0.7, to.z + (Math.random() - 0.5) * 0.8);
        const dx = to.x - from.x;
        const dz = to.z - from.z;
        const d = Math.hypot(dx, dz) || 1;
        const killed = k.hit(cur, dmg, { x: (dx / d) * 4, y: 3, z: (dz / d) * 4 });
        g.fx.hitMark(to, 0.6);
        g.audio.swing();
        done.add(cur);
        if (killed) {
          kills++;
          // 百鬼夜行: 斬って倒すたびに 2 回増える（増えるのは 20 回まで）
          if (E && extra < 20) {
            hops += 2;
            extra += 2;
          }
        }
        hops--;
        from = to;
        wait = 0.09;
        cur = g.enemies.nearest(to, 7, (o) => done.has(o)) ?? g.enemies.nearest(to, 7);
        return true;
      },
      dispose: () => {
        ghost.removeFromParent();
        if (kills >= 5) this.k.comboLog('yuutai.many', { kills });
      },
    });
  }

  // ---------------------------------------------------------------- 紙飛行機の遠投（Dota ミラナのセイクリッドアロー）
  /** 遠くの敵へ投げる。長く飛ぶほど威力と気絶が増える。 */
  private hikouki(s: SkillInst): void {
    const g = this.g;
    const k = this.k;
    const L = s.level;
    const E = !!s.evolved;
    const p = g.player.pos;
    const cand: { e: Enemy; d: number }[] = [];
    for (const e of g.enemies.list) {
      if (e.state === 'dead') continue;
      const d = Math.hypot(e.x - p.x, e.z - p.z);
      if (d < 28) cand.push({ e, d });
    }
    if (!cand.length) {
      s.cd = 0.4;
      return;
    }
    // 遠い敵から狙う（長く飛ぶほど強いので）
    cand.sort((a, b) => b.d - a.d);
    s.cd = k.cdOf(E ? 2.2 : 3.2 - 0.15 * L);
    const n = 1 + g.stats.amount;
    const ctx = k.cur;
    const base = (16 + 7 * L) * (E ? 1.6 : 1);
    const from = k.chest();
    for (let i = 0; i < n; i++) {
      const t = cand[i % cand.length].e;
      const spread = (i - (n - 1) / 2) * 0.12;
      const a = Math.atan2(t.x - from.x, t.z - from.z) + (i >= cand.length ? spread : 0);
      const sp = 20;
      const start = { x: from.x, z: from.z };
      g.projectiles.fire({
        emoji: E ? '🛩️' : '✈️', size: E ? 2.2 : 1.0, pos: { ...from }, vel: { x: Math.sin(a) * sp, y: Math.max(-2, Math.min(2, (t.y + 0.4 - from.y) * 0.6)), z: Math.cos(a) * sp },
        r: E ? 1.2 : 0.5, dmg: base, life: E ? 2.2 : 1.8, pierce: E ? 99 : L >= 3 ? 1 : 0, knock: 5, aim: true,
        onHit: (e) => {
          const d = Math.hypot(e.x - start.x, e.z - start.z);
          const sc = planeScale(d);
          if (sc > 1.05 && e.state !== 'dead') g.enemies.damage(e, base * (sc - 1) * g.scaleFor(ctx), 'skill', { kind: ctx?.kind ?? 'phys', noCharge: true });
          if (e.alive && e.state !== 'dead') e.stagger = Math.max(e.stagger, planeStun(d, !!e.def.boss));
          if (d > 15) g.fx.number({ x: e.x, y: e.y + e.halfH + e.radius + 0.9, z: e.z }, `✈️ ${Math.round(d)}m`, 'info');
        },
        onEnd: E
          ? (pos) => {
              g.explode(pos, k.area(3.5), base * 1.5, { source: 'skill', force: 12, struct: 10, ctx: ctx ?? undefined });
            }
          : undefined,
      });
    }
    g.audio.whoosh();
  }

  // ---------------------------------------------------------------- 抜き打ちテスト（LoL カーサスの R）
  /** まわり 40m のすべての敵に、少し遅れて魔法ダメージ。弱った敵は 2 倍。 */
  private nukiuchi(s: SkillInst): void {
    const g = this.g;
    const k = this.k;
    const L = s.level;
    const E = !!s.evolved;
    const p = g.player.pos;
    const list = g.enemies.list.filter((e) => e.state !== 'dead' && Math.hypot(e.x - p.x, e.z - p.z) < 40).slice(0, 90);
    if (list.length < 3) {
      s.cd = 0.6;
      return;
    }
    s.cd = k.cdOf(26 - 1.2 * L);
    const marks = list.slice(0, 40).map((e) => ({ e, sp: k.sprite('❗', 0.7) }));
    g.hud.toast(E ? '🏫 期末テスト、始め！' : '📃 抜き打ちテストをします！', 'praise');
    g.audio.chime();
    let t = 0;
    let round = 0;
    const rounds = E ? 2 : 1;
    const dmg = 30 + 12 * L;
    const stun = (E ? 1.2 : 0.6);
    let kills = 0;
    k.addTask({
      update: (dt) => {
        t += dt;
        for (const m of marks) if (m.e.alive && m.e.state !== 'dead') m.sp.position.set(m.e.x, m.e.y + m.e.halfH + m.e.radius + 0.8 + Math.sin(t * 12) * 0.08, m.e.z);
        const at = 1.6 + round * 1.5;
        if (t < at) return true;
        for (const e of list) {
          if (!e.alive || e.state === 'dead') continue;
          const weak = e.hp < e.maxHp * 0.3;
          if (k.hit(e, dmg * (weak ? 2 : 1))) kills++;
          else e.stagger = Math.max(e.stagger, stun * (e.def.boss ? 0.3 : 1));
          if (Math.random() < 0.3) g.fx.sparkle({ x: e.x, y: e.y + 0.8, z: e.z }, 0xff4a4a, 3, 0.4);
        }
        g.fx.flash('gold');
        g.audio.ring();
        round++;
        if (round >= rounds) {
          log('skill.nukiuchi', { n: list.length, rounds }, { kills, time: Math.round(g.time) });
          return false;
        }
        return true;
      },
      dispose: () => {
        for (const m of marks) m.sp.removeFromParent();
      },
    });
  }

  // ---------------------------------------------------------------- 学級委員の指名（Dota ライオンのフィンガー・オブ・デス）
  /** いちばん体力の多い敵を狙い撃つ。倒すたびに威力が上がる。 */
  private shimei(s: SkillInst): void {
    const g = this.g;
    const k = this.k;
    const L = s.level;
    const E = !!s.evolved;
    const p = g.player.pos;
    const cand = g.enemies.list.filter((e) => e.state !== 'dead' && Math.hypot(e.x - p.x, e.z - p.z) < 35);
    if (!cand.length) {
      s.cd = 0.5;
      return;
    }
    const score = (e: Enemy) => (e.def.boss ? 1e7 : e.elite ? 1e6 : 0) + e.hp;
    cand.sort((a, b) => score(b) - score(a));
    s.cd = k.cdOf(E ? 5 : 7 - 0.4 * L);
    const shots = Math.min(cand.length, E ? 3 : 1);
    const st = s.st;
    for (let i = 0; i < shots; i++) {
      const e = cand[i];
      let t = -i * 0.35;
      let fired = false;
      k.addTask({
        update: (dt) => {
          t += dt;
          if (!e.alive || e.state === 'dead') return false;
          const from = this.k.chest();
          const to = { x: e.x, y: e.y + e.halfH * 0.5, z: e.z };
          if (t < 0) return true;
          if (t < 0.5) {
            // 予告の赤い線
            if (Math.random() < dt * 30) g.fx.bolt(from, to, 0xff3030, 0.05, 0, 0.06);
            return true;
          }
          if (fired) return false;
          fired = true;
          const dx = to.x - from.x;
          const dz = to.z - from.z;
          const d = Math.hypot(dx, dz) || 1;
          g.fx.bolt(from, to, 0xffffff, 0.35, 0, 0.15);
          g.fx.hitMark(to, 1, { x: dx / d, y: 0, z: dz / d }, true);
          g.audio.shoot();
          const dmg = (40 + 18 * L) * (1 + 0.02 * (st.stacks ?? 0));
          if (this.k.hit(e, dmg, { x: (dx / d) * 6, y: 2, z: (dz / d) * 6 })) {
            st.stacks = Math.min(100, (st.stacks ?? 0) + (E ? 2 : 1));
            if (st.stacks % 10 === 0 || (E && st.stacks % 10 === 1)) log('skill.shimei', { stacks: st.stacks }, { time: Math.round(g.time) });
          }
          return false;
        },
      });
    }
  }

  // ---------------------------------------------------------------- おみくじ（LoL ツイステッド・フェイトのカード）
  private omikuji(s: SkillInst): void {
    const g = this.g;
    const k = this.k;
    const L = s.level;
    const E = !!s.evolved;
    const p = g.player.pos;
    if (!g.enemies.nearest(p, 16)) {
      s.cd = 0.5;
      return;
    }
    s.cd = k.cdOf(6 - 0.3 * L);
    const r = omikujiDraw(Math.random(), g.stats.luck, E);
    g.fx.number({ x: p.x, y: p.y + 2.4, z: p.z }, OMIKUJI_TEXT[r], r === 'kyo' ? 'hurt' : 'info');
    if (r === 'daikichi') {
      // 雷の雨
      const near = g.enemies.list.filter((e) => e.state !== 'dead' && Math.hypot(e.x - p.x, e.z - p.z) < 18);
      for (let i = 0; i < 8 && near.length; i++) {
        const e = near.splice(Math.floor(Math.random() * near.length), 1)[0];
        g.fx.bolt({ x: e.x + (Math.random() - 0.5) * 2, y: e.y + 12, z: e.z }, { x: e.x, y: e.y, z: e.z }, 0xffe14d, 0.5, 1, 0.22);
        k.hit(e, 40 + 10 * L);
        if (e.alive && e.state !== 'dead') e.stagger = Math.max(e.stagger, e.def.boss ? 0.15 : 0.5);
      }
      g.pickups.dropItem('coin', { x: p.x, y: p.y + 1, z: p.z }, 2);
      g.fx.flash('gold');
      g.audio.thunder();
    } else if (r === 'kichi') {
      const c = k.aim(18) ?? { x: p.x, y: 0, z: p.z };
      const gy = g.world.groundY(c.x, c.z);
      g.explode({ x: c.x, y: gy + 0.8, z: c.z }, k.area(4), 25 + 8 * L, { source: 'skill', force: 11, struct: 8, element: 'fire' });
      for (const col of [0xff5a8a, 0xffe14d, 0x5ad8ff]) g.fx.sparkle({ x: c.x, y: gy + 2.5, z: c.z }, col, 8, 2);
    } else if (r === 'shokichi') {
      g.player.heal(g.stats.maxHp * 0.05);
      g.audio.heal();
      g.explode({ x: p.x, y: p.y + 0.6, z: p.z }, k.area(3), 15 + 5 * L, { source: 'skill', force: 8, struct: 2, small: true });
    } else {
      // 凶: まわりの敵が呪われて、防御が下がる
      g.enemies.inRadius(p, k.area(10), (e) => {
        g.enemies.shred(e, 0.4, 0.4, 6);
        g.fx.sparkle({ x: e.x, y: e.y + 1, z: e.z }, 0x7a3aff, 2, 0.4);
      });
      g.fx.ring({ x: p.x, y: p.y + 0.1, z: p.z }, 0.5, k.area(10), 0x7a3aff, 0.5, 0.5);
    }
    log('skill.omikuji', { r }, { time: Math.round(g.time) });
  }

  // ---------------------------------------------------------------- プリント配布（PoE のヘラルド）
  /** 近くで敵が倒れたら、ときどきプリントが飛ぶ。 */
  onEnemyKilled(e: Enemy, src: string): void {
    const g = this.g;
    const k = this.k;
    const s = k.get('purinto');
    if (!s) return;
    void src;
    const p = g.player.pos;
    if (Math.hypot(e.x - p.x, e.z - p.z) > 15 || this.papers >= 10) return;
    const L = s.level;
    const E = !!s.evolved;
    if (!E && Math.random() > 0.3 + 0.05 * L) return;
    const n = (E ? 2 : 1 + (L >= 4 ? 1 : 0)) + Math.floor(g.stats.amount / 2);
    const keep = k.cur;
    k.cur = s.ctx ?? SKILL_MAP.purinto.dmg ?? null;
    try {
      const done = new Set<Enemy>([e]);
      for (let i = 0; i < n && this.papers < 10; i++) {
        const t = g.enemies.nearest({ x: e.x, y: e.y, z: e.z }, 10, (o) => done.has(o));
        if (!t) break;
        done.add(t);
        this.papers++;
        const dx = t.x - e.x;
        const dz = t.z - e.z;
        const d = Math.hypot(dx, dz) || 1;
        g.projectiles.fire({
          emoji: E ? '💯' : '📄', size: 0.6, pos: { x: e.x, y: e.y + 0.8, z: e.z }, vel: { x: (dx / d) * 6, y: 7, z: (dz / d) * 6 }, r: 0.45, dmg: 8 + 4 * L, life: 1.8, homing: 9, target: t, knock: 2, spin: 8,
          onHit: (h) => {
            g.enemies.bleedIt(h, 3, 3 + L);
            if (E && Math.random() < 0.5) g.explode({ x: h.x, y: h.y + 0.4, z: h.z }, 1.6, 10 + 3 * L, { source: 'skill', small: true, quietFx: true, force: 5, struct: 2 });
          },
        });
      }
    } finally {
      k.cur = keep;
    }
  }

  // ---------------------------------------------------------------- 観察日記の朝顔（LoL ザイラの植物）
  private asagao(s: SkillInst): void {
    const g = this.g;
    const k = this.k;
    const L = s.level;
    const E = !!s.evolved;
    const p = g.player.pos;
    if (!g.enemies.nearest(p, 18)) {
      s.cd = 0.5;
      return;
    }
    s.cd = k.cdOf(14 - 0.8 * L);
    const pots = E ? 3 : 1;
    const f = k.forward();
    for (let i = 0; i < pots; i++) {
      const a = Math.atan2(f.x, f.z) + i * ((Math.PI * 2) / 3);
      const x = p.x + Math.sin(a) * 2.6;
      const z = p.z + Math.cos(a) * 2.6;
      const gy = g.world.groundY(x, z);
      const pot = k.sprite('🪴', 0.9);
      pot.position.set(x, gy + 0.45, z);
      const bloom = k.sprite('🌱', 0.6);
      bloom.position.set(x, gy + 1.0, z);
      const life = 10 + 0.4 * L;
      let t = 0;
      let whip = 0.4;
      k.addTask({
        update: (dt) => {
          t += dt;
          const grow = Math.min(1, t / 8);
          const R = k.area((2 + 3 * grow) * (1 + 0.08 * L));
          bloom.scale.setScalar(0.6 + 1.2 * grow);
          bloom.position.y = gy + 1.0 + grow * 0.6;
          whip -= dt;
          if (whip <= 0) {
            whip = 0.7;
            g.fx.ring({ x, y: gy + 0.1, z }, R * 0.3, R, ZONE.ally, 0.3, 0.45);
            g.enemies.inRadius({ x, y: gy, z }, R, (e) => {
              k.hit(e, (8 + 3 * L) * (0.6 + 0.6 * grow), undefined, true);
              g.enemies.slowIt(e, 0.3, 1.2);
            });
            // ひまわり畑: 近くのノリコを回復
            const pp = g.player.pos;
            if (E && Math.hypot(pp.x - x, pp.z - z) < R) g.player.heal(g.stats.maxHp * 0.01 * 0.7);
          }
          if (t < life) return true;
          // 花が咲いて、種を四方へ飛ばす
          const seeds = 8 + 2 * L + g.stats.amount;
          for (let j = 0; j < seeds; j++) {
            const b = (j / seeds) * Math.PI * 2;
            g.projectiles.fire({ emoji: '🌰', size: 0.45, pos: { x, y: gy + 0.8, z }, vel: { x: Math.sin(b) * 14, y: 1, z: Math.cos(b) * 14 }, r: 0.35, dmg: 12 + 5 * L, life: 0.9, pierce: 1, knock: 3 });
          }
          g.fx.sparkle({ x, y: gy + 1.4, z }, E ? 0xffd23a : 0xff6ad5, 14, 1.2);
          g.audio.pop();
          return false;
        },
        dispose: () => {
          pot.removeFromParent();
          bloom.removeFromParent();
        },
      });
    }
  }

  // ---------------------------------------------------------------- 置き傘ガード（LoL ヤスオの風殺の壁）
  private kasa(s: SkillInst): void {
    const g = this.g;
    const k = this.k;
    const L = s.level;
    const E = !!s.evolved;
    const p = g.player.pos;
    if (!E && !g.enemies.nearest(p, 22)) {
      s.cd = 0.5;
      return;
    }
    const r = k.area(4 + 0.3 * L);
    const dur = E ? 0.8 : 3 + 0.3 * L;
    s.cd = E ? 0.5 : k.cdOf(9 - 0.5 * L);
    if (!this.umb) {
      this.umb = { t: dur, r, mul: E ? 8 : 5, sp: k.sprite(E ? '🌂' : '☂️', 1.6), push: 0, logT: 0, n: 0 };
      if (!E) g.audio.whoosh();
    } else {
      this.umb.t = Math.max(this.umb.t, dur);
      this.umb.r = r;
      this.umb.mul = E ? 8 : 5;
    }
  }

  private updateUmbrella(dt: number): void {
    const u = this.umb;
    if (!u) return;
    const g = this.g;
    u.t -= dt;
    const p = g.player.pos;
    u.sp.position.set(p.x, p.y + 2.3, p.z);
    if (u.t <= 0 || g.player.dead) {
      u.sp.removeFromParent();
      if (u.n > 0) log('skill.kasa', { reflected: u.n }, { time: Math.round(g.time) });
      this.umb = null;
      return;
    }
    const c = { x: p.x, y: p.y + 1, z: p.z };
    const n = g.projectiles.reflectNear(c, u.r, u.mul);
    if (n > 0) {
      u.n += n;
      g.fx.ring({ x: p.x, y: p.y + 0.8, z: p.z }, u.r * 0.4, u.r, 0x9fd8ff, 0.25, 0.6);
      g.audio.parry();
      this.k.comboLog('kasa.reflect', { n });
    }
    // 傘にぶつかった敵は押し返される
    u.push -= dt;
    if (u.push <= 0) {
      u.push = 0.3;
      g.enemies.inRadius(p, 1.7, (e) => {
        if (e.def.boss) return;
        const dx = e.x - p.x;
        const dz = e.z - p.z;
        const d = Math.hypot(dx, dz) || 1;
        g.enemies.push(e, { x: (dx / d) * 6, y: 1.5, z: (dz / d) * 6 });
      });
    }
  }

  // ---------------------------------------------------------------- びっくり箱（LoL シャコのびっくり箱）
  private bikkuri(s: SkillInst): void {
    const g = this.g;
    const k = this.k;
    const L = s.level;
    const E = !!s.evolved;
    const p = g.player.pos;
    s.cd = k.cdOf(7 - 0.4 * L);
    const n = 2 + Math.floor(L / 2) + g.stats.amount;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 2.5 + Math.random() * 3;
      const x = p.x + Math.cos(a) * r;
      const z = p.z + Math.sin(a) * r;
      const gy = g.world.groundY(x, z);
      const sp = k.sprite('🎁', 0.8);
      sp.position.set(x, gy + 0.4, z);
      // 本物の形のびっくり箱（14cm と小さいので 4 倍にする）。物理では動かさず、何にも当たらない
      const prop = PROPS.u_jackbox ? g.world.spawnProp('u_jackbox', { x, y: gy, z }, Math.random() * Math.PI * 2, { scale: 4 }) : null;
      if (prop) {
        prop.body.setBodyType(RAPIER.RigidBodyType.Fixed, true);
        prop.rooted = true;
        prop.hp = Infinity;
        prop.col.setCollisionGroups(groups(G.PROP, 0));
        sp.visible = false;
      }
      this.boxes.push({ x, z, gy, sp, life: 15, uses: E ? 3 : 1, cd: 0.5, L, E, ctx: k.cur, prop, open: false });
    }
    while (this.boxes.length > 24) this.dropBox(this.boxes.shift()!);
  }

  private updateBoxes(dt: number): void {
    const g = this.g;
    const k = this.k;
    for (let i = this.boxes.length - 1; i >= 0; i--) {
      const b = this.boxes[i];
      b.life -= dt;
      if (b.cd > 0) b.cd -= dt;
      let pop = false;
      if (b.cd <= 0) {
        const e = g.enemies.nearest({ x: b.x, y: b.gy, z: b.z }, 2.2);
        if (e) pop = true;
      }
      if (pop) {
        const keep = k.cur;
        k.cur = b.ctx;
        const R = k.area(3);
        let n = 0;
        g.enemies.inRadius({ x: b.x, y: b.gy, z: b.z }, R, (e) => {
          const dx = e.x - b.x;
          const dz = e.z - b.z;
          const d = Math.hypot(dx, dz) || 1;
          k.hit(e, 15 + 6 * b.L, { x: (dx / d) * 6, y: 5, z: (dz / d) * 6 });
          if (!e.def.boss && e.alive && e.state !== 'dead') {
            e.fear = 2 + 0.2 * b.L;
            e.fearX = b.x;
            e.fearZ = b.z;
            if (b.E) e.scared = g.time + e.fear + 2;
          }
          n++;
        });
        k.cur = keep;
        g.fx.number({ x: b.x, y: b.gy + 1.6, z: b.z }, '🤡 バァ！', 'info');
        if (b.prop?.alive) {
          g.world.driveJoint(b.prop, 'lid', 1.9);
          g.world.driveJoint(b.prop, 'platform', 0.08);
          b.open = true;
        }
        g.fx.ring({ x: b.x, y: b.gy + 0.1, z: b.z }, 0.3, R, ZONE.ally, 0.3, 0.6);
        g.fx.sparkle({ x: b.x, y: b.gy + 0.8, z: b.z }, 0xff5ad8, 8, 0.8);
        g.audio.boing();
        b.uses--;
        b.cd = 1;
        if (n >= 6) k.comboLog('bikkuri.many', { n });
      }
      // 何度も飛び出す箱（お化け屋敷）は、次に備えてふたを閉める
      if (b.open && b.uses > 0 && b.cd < 0.4 && b.prop?.alive) {
        g.world.driveJoint(b.prop, 'lid', null);
        g.world.driveJoint(b.prop, 'platform', null);
        b.open = false;
      }
      if (b.uses <= 0 || b.life <= 0) {
        this.boxes.splice(i, 1);
        // 飛び出し終わった箱は少し見せてから消す
        if (b.uses <= 0 && b.prop?.alive) b.prop.life = 1.2;
        else this.dropBox(b);
        b.sp.removeFromParent();
      }
    }
  }

  // ---------------------------------------------------------------- 更新
  update(dt: number): void {
    this.paperT -= dt;
    if (this.paperT <= 0) {
      this.paperT = 1;
      this.papers = 0;
    }
    if (this.boxes.length) this.updateBoxes(dt);
    if (this.umb) this.updateUmbrella(dt);
  }

  private dropBox(b: JackBox): void {
    b.sp.removeFromParent();
    if (b.prop?.alive) this.g.world.removeProp(b.prop);
  }

  dispose(): void {
    for (const b of this.boxes) this.dropBox(b);
    this.boxes.length = 0;
    if (this.umb) this.umb.sp.removeFromParent();
    this.umb = null;
  }
}
