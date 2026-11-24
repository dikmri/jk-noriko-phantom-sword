import * as THREE from 'three';
import { emojiSprite } from '../core/assets';
import { G } from '../core/physics';
import { log } from '../log';
import { ELITES, EliteKind } from './defs';
import type { Enemy } from './enemies';
import { ZONE } from './fx';
import type { Game } from './game';
import { detourScore, screenBearing } from './rules';
import { ARENA } from './world';

/**
 * 寄り道: マップのあちこちに、行くと得をする目的地を出す（その場でぐるぐる回るだけより、動き回った方が得になるように）。
 * - 🎁 落とし物: たどり着くと、スキルが強くなる小さな宝箱
 * - 🚩 陣取り: 円の中に合計 8 秒いると、たくさんの経験値と回復
 * - 👑 賞金首: 宝を守る強いエリートを倒すと、アイテムを選べる
 * - ⭐ 星集め: 散らばった星を全部拾うと、しばらく「やる気満々」（与えるダメージ・移動速度アップ）
 * もう 1 つ、避難訓練: ときどきノリコのいる場所が立入禁止になる（赤い円の外へ出ないと痛い）。
 */
type Kind = 'chest' | 'hold' | 'bounty' | 'stars';

/** how: すること / reward: ごほうび（どちらも、始まったときと案内の欄に出す） */
const KIND: Record<Kind, { emoji: string; name: string; color: number; life: number; how: string; reward: string }> = {
  chest: { emoji: '🎁', name: '落とし物', color: 0xffd23a, life: 75, how: '光の柱の根もとまで行く', reward: 'スキルが 1〜2 つ強くなる宝箱' },
  hold: { emoji: '🚩', name: '陣取り', color: 0x5ad8ff, life: 80, how: '光の柱の青い円の中に、合計 8 秒いる', reward: '経験値（約 1 レベル分）と HP 30% 回復' },
  bounty: { emoji: '👑', name: '賞金首', color: 0xff6a3a, life: 100, how: '光の柱で宝を守る、強いエリートを倒す', reward: 'アイテムを 1 つ選べる' },
  stars: { emoji: '⭐', name: '星集め', color: 0xfff27a, life: 70, how: '光の柱のまわりに散らばった星を 5 つ拾う', reward: '40 秒間 与えるダメージ +25%・移動 +12%' },
};

const HOLD_R = 5;
const HOLD_T = 8;

interface Star {
  x: number;
  y: number;
  z: number;
  sp: THREE.Sprite;
  got: boolean;
}

interface Detour {
  kind: Kind;
  x: number;
  z: number;
  gy: number;
  t: number;
  hold: number;
  target: Enemy | null;
  stars: Star[];
  group: THREE.Group;
  icon: THREE.Sprite;
}

/** 遊んでいる間、画面に出す寄り道の案内。 */
export interface DetourInfo {
  emoji: string;
  name: string;
  how: string;
  reward: string;
  /** いますること（進み具合の数つき。例: 「円の中に 3 / 8 秒」） */
  step: string;
  /** 目的地の近くにいるか */
  near: boolean;
  /** 向かう先（コンパスに出す） */
  x: number;
  z: number;
  dist: number;
  /** 画面の中心から見た向き（上が正面） */
  bearing: number;
  left: number;
  /** 陣取りの進み具合・拾った星の数など（0〜1） */
  progress: number;
}

export class Detours {
  private cur: Detour | null = null;
  private nextT = 40;
  private recent: { x: number; z: number }[] = [];
  private lastKind: Kind | null = null;
  private count = 0;
  /** 星集めのごほうび「やる気満々」の残り秒数 */
  buffT = 0;
  /** 避難訓練 */
  private drill: { x: number; z: number; gy: number; r: number; warn: number; on: number; tick: number; mark: number; disc: THREE.Mesh } | null = null;
  private drillT: number;
  private beamGeo = new THREE.CylinderGeometry(0.55, 0.55, 46, 12, 1, true);
  private ringGeo = new THREE.RingGeometry(0.85, 1, 48);

  constructor(private g: Game) {
    this.drillT = g.stageNo >= 2 ? 100 : 170;
  }

  // ---------------------------------------------------------------- 毎フレーム
  update(dt: number): void {
    if (this.buffT > 0) this.buffT -= dt;
    this.updateDrill(dt);
    const d = this.cur;
    if (!d) {
      this.nextT -= dt;
      if (this.nextT <= 0) this.start();
      return;
    }
    d.t -= dt;
    const g = this.g;
    const p = g.player.pos;
    const dist = Math.hypot(p.x - d.x, p.z - d.z);
    // 目印をゆっくり回し、アイコンを上下させる
    d.group.rotation.y += dt * 0.8;
    d.icon.position.y = d.gy + 4.2 + Math.sin(g.time * 2.4) * 0.3;
    let done = false;
    if (d.kind === 'chest') done = dist < 2.6 && Math.abs(p.y - d.gy) < 3;
    else if (d.kind === 'hold') {
      const inside = dist < HOLD_R && Math.abs(p.y - d.gy) < 3;
      d.hold = inside ? d.hold + dt : Math.max(0, d.hold - dt * 0.5);
      if (inside && Math.random() < dt * 8) g.fx.sparkle({ x: p.x, y: p.y + 1, z: p.z }, 0x5ad8ff, 2, 0.8);
      done = d.hold >= HOLD_T;
    } else if (d.kind === 'bounty') {
      done = !!d.target && (!d.target.alive || d.target.state === 'dead');
    } else {
      for (const s of d.stars) {
        if (s.got) continue;
        s.sp.position.y = s.y + Math.sin(g.time * 3 + s.x) * 0.25;
        if (Math.hypot(p.x - s.x, p.z - s.z) < 1.9 && Math.abs(p.y + 0.8 - s.y) < 2.6) {
          s.got = true;
          s.sp.removeFromParent();
          g.fx.sparkle({ x: s.x, y: s.y, z: s.z }, 0xfff27a, 10, 1);
          g.audio.coin();
        }
      }
      done = d.stars.every((s) => s.got);
    }
    if (done) this.reward(d);
    else if (d.t <= 0) {
      g.hud.banner(`${KIND[d.kind].emoji} ${KIND[d.kind].name}は時間切れ`, '次の寄り道を待とう', 'miss');
      log('detour.miss', { kind: d.kind }, { time: Math.round(g.time) });
      this.end(d);
    }
  }

  /** 画面に出す案内（寄り道が出ていなければ null）。 */
  info(): DetourInfo | null {
    const d = this.cur;
    if (!d) return null;
    const g = this.g;
    const p = g.player.pos;
    let tx = d.x;
    let tz = d.z;
    let progress = 0;
    if (d.kind === 'hold') progress = d.hold / HOLD_T;
    else if (d.kind === 'stars') {
      progress = d.stars.filter((s) => s.got).length / d.stars.length;
      // いちばん近い、まだ拾っていない星を指す
      let best = Infinity;
      for (const s of d.stars) {
        if (s.got) continue;
        const sd = Math.hypot(s.x - p.x, s.z - p.z);
        if (sd < best) {
          best = sd;
          tx = s.x;
          tz = s.z;
        }
      }
    } else if (d.kind === 'bounty' && d.target?.alive) {
      tx = d.target.x;
      tz = d.target.z;
    }
    const k = KIND[d.kind];
    const dist = Math.hypot(tx - p.x, tz - p.z);
    let near = dist < 6;
    let step: string;
    if (d.kind === 'chest') step = near ? 'もう少し！ 根もとの 🎁 に触れる' : `光の柱まで あと ${Math.round(dist)}m`;
    else if (d.kind === 'hold') {
      const inside = Math.hypot(d.x - p.x, d.z - p.z) < HOLD_R;
      near = inside || near;
      step = inside ? `円の中にとどまる　${d.hold.toFixed(1)} / ${HOLD_T} 秒` : d.hold > 0 ? `円に戻る（外にいると減る）　${d.hold.toFixed(1)} / ${HOLD_T} 秒` : `青い円まで あと ${Math.round(dist)}m`;
    } else if (d.kind === 'bounty') step = d.target?.alive ? `${d.target.title ?? '賞金首'}を倒す　あと ${Math.round(dist)}m` : '倒した！';
    else step = `星 ${d.stars.filter((s) => s.got).length} / ${d.stars.length}　いちばん近い星まで ${Math.round(dist)}m`;
    return { emoji: k.emoji, name: k.name, how: k.how, reward: k.reward, step, near, x: tx, z: tz, dist, bearing: screenBearing(tx - p.x, tz - p.z, g.player.camYaw), left: d.t, progress };
  }

  /** 「やる気満々」のあいだ、与えるダメージ +25%。 */
  dealtMul(): number {
    return this.buffT > 0 ? 1.25 : 1;
  }

  /** 「やる気満々」のあいだ、移動速度 +12%。 */
  moveMul(): number {
    return this.buffT > 0 ? 1.12 : 1;
  }

  // ---------------------------------------------------------------- 出す・終わる
  /** ノリコから 26〜64m の、最近の寄り道から離れた所（ステージの仕掛けの近くを少し好む）。 */
  private pickSpot(): { x: number; z: number } | null {
    const g = this.g;
    const p = g.player.pos;
    let best: { x: number; z: number } | null = null;
    let bestS = -Infinity;
    for (let i = 0; i < 48; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 26 + Math.random() * 36;
      const x = p.x + Math.cos(a) * r;
      const z = p.z + Math.sin(a) * r;
      if (Math.abs(x) > ARENA - 8 || Math.abs(z) > ARENA - 8) continue;
      let sc = detourScore({ x, z }, p, this.recent);
      if (sc === -Infinity || sc <= bestS - 8) continue;
      if (!g.world.spawnOk(x, z)) continue;
      let blocked = false;
      // 地面に触れない高さで、建物や崖に重ならないかを見る（球の下端は地面から 0.6m 上）
      g.physics.querySphere({ x, y: g.world.groundY(x, z) + 1.6, z }, 1.0, G.STATIC | G.CHUNK, () => {
        blocked = true;
      });
      if (blocked) continue;
      // 爆発物や仕掛けのある物の近くなら少し良い（寄り道の途中でギミックに触れてもらう）
      for (const pr of g.world.props) {
        if (!pr.alive || !(pr.def.explosive || pr.def.gimmick)) continue;
        const t = pr.body?.translation();
        if (t && Math.hypot(t.x - x, t.z - z) < 9) {
          sc += 8;
          break;
        }
      }
      if (sc > bestS) {
        bestS = sc;
        best = { x, z };
      }
    }
    return best;
  }

  private start(): void {
    const g = this.g;
    const spot = this.pickSpot();
    if (!spot) {
      this.nextT = 5;
      return;
    }
    const kinds = (['chest', 'hold', 'bounty', 'stars'] as Kind[]).filter((k) => k !== this.lastKind);
    const kind = this.count === 0 ? 'chest' : kinds[Math.floor(Math.random() * kinds.length)];
    const k = KIND[kind];
    const gy = g.world.groundY(spot.x, spot.z);
    const group = new THREE.Group();
    group.position.set(spot.x, gy, spot.z);
    // 遠くからでも見える光の柱と、地面の輪
    const beam = new THREE.Mesh(this.beamGeo, new THREE.MeshBasicMaterial({ color: k.color, transparent: true, opacity: 0.32, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    beam.position.y = 23;
    group.add(beam);
    const ring = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ color: k.color, transparent: true, opacity: 0.75, depthWrite: false, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.08;
    const rr = kind === 'hold' ? HOLD_R : kind === 'stars' ? 1.6 : 2.4;
    ring.scale.set(rr, rr, 1);
    group.add(ring);
    g.world.root.add(group);
    const icon = emojiSprite(k.emoji, 2.4);
    icon.position.set(spot.x, gy + 4.2, spot.z);
    g.world.root.add(icon);
    const d: Detour = { kind, x: spot.x, z: spot.z, gy, t: k.life, hold: 0, target: null, stars: [], group, icon };
    if (kind === 'bounty') d.target = this.spawnBounty(spot.x, spot.z);
    if (kind === 'stars') {
      for (let i = 0; i < 5; i++) {
        for (let tries = 0; tries < 8; tries++) {
          const a = Math.random() * Math.PI * 2;
          const r = i === 0 ? 0 : 4 + Math.random() * 9;
          const x = spot.x + Math.cos(a) * r;
          const z = spot.z + Math.sin(a) * r;
          if (Math.abs(x) > ARENA - 3 || Math.abs(z) > ARENA - 3 || !g.world.spawnOk(x, z)) continue;
          const y = g.world.groundY(x, z) + 1.3;
          const sp = emojiSprite('⭐', 1.1);
          sp.position.set(x, y, z);
          g.world.root.add(sp);
          d.stars.push({ x, y, z, sp, got: false });
          break;
        }
      }
      if (!d.stars.length) d.kind = 'chest';
    }
    this.cur = d;
    this.lastKind = kind;
    this.count++;
    this.recent.push(spot);
    if (this.recent.length > 4) this.recent.shift();
    g.hud.banner(`📢 寄り道ミッション　${k.emoji} ${k.name}`, `${k.how}（${k.life} 秒以内）\nごほうび: ${k.reward}`, 'start');
    g.audio.chime();
    log('detour.start', { kind: d.kind, x: Math.round(spot.x), z: Math.round(spot.z) }, { dist: Math.round(Math.hypot(spot.x - g.player.pos.x, spot.z - g.player.pos.z)), time: Math.round(g.time), stage: g.stageDef.id });
  }

  /** 宝を守る、強いエリート。持ち場からあまり離れない。 */
  private spawnBounty(x: number, z: number): Enemy | null {
    const g = this.g;
    const pool = g.stageNo >= 3 ? ['vending_e', 'polar', 'ninja'] : g.stageNo === 2 ? ['vending_e', 'bear', 'polar'] : ['bear', 'shield', 'polar'];
    const id = pool[Math.floor(Math.random() * pool.length)];
    const kinds: EliteKind[] = ['tough', 'swift', 'bomb'];
    const ek = kinds[Math.floor(Math.random() * kinds.length)];
    const e = g.enemies.spawn(id, x, z, undefined, ek);
    if (!e) return null;
    e.hp = e.maxHp = e.maxHp * 4;
    e.w.anchorX = x;
    e.w.anchorZ = z;
    e.title = `👑 賞金首: ${ELITES[ek].name}${e.def.name}`;
    return e;
  }

  private reward(d: Detour): void {
    const g = this.g;
    const p = g.player.pos;
    const k = KIND[d.kind];
    g.fx.flash('gold');
    g.fx.sparkle({ x: p.x, y: p.y + 1.5, z: p.z }, k.color, 16, 1.4);
    g.audio.evolve();
    g.hud.banner(`${k.emoji} ${k.name} 成功！`, `ごほうび: ${k.reward}`, 'done');
    if (d.kind === 'chest') {
      g.openChest('small');
    } else if (d.kind === 'hold') {
      g.addXp(g.xpNeed * 1.2);
      g.player.heal(g.stats.maxHp * 0.3);
      g.run.coins += 15;
    } else if (d.kind === 'bounty') {
      g.openChest('item');
    } else {
      this.buffT = 40;
      g.addXp(g.xpNeed * 0.6);
    }
    log('detour.done', { kind: d.kind }, { left: Math.round(d.t), time: Math.round(g.time), level: g.level });
    this.end(d);
  }

  private end(d: Detour): void {
    d.group.removeFromParent();
    for (const c of d.group.children) ((c as THREE.Mesh).material as THREE.Material).dispose();
    d.icon.removeFromParent();
    for (const s of d.stars) s.sp.removeFromParent();
    // 賞金首は持ち場から解き放つ
    if (d.target?.alive) {
      delete d.target.w.anchorX;
      delete d.target.w.anchorZ;
    }
    this.cur = null;
    this.nextT = 14 + Math.random() * 10;
  }

  // ---------------------------------------------------------------- 避難訓練
  /** ときどき、ノリコのいる場所が立入禁止になる。5 秒の予告のあと、12 秒間、赤い円の中にいるとダメージ。 */
  private updateDrill(dt: number): void {
    const g = this.g;
    const dr = this.drill;
    if (!dr) {
      this.drillT -= dt;
      // 陣取りの最中は始めない
      if (this.drillT <= 0 && !(this.cur?.kind === 'hold' && this.cur.hold > 0)) {
        this.drillT = g.stageNo >= 2 ? 95 : 135;
        const p = g.player.pos;
        const gy = g.world.groundY(p.x, p.z);
        const disc = new THREE.Mesh(new THREE.CircleGeometry(1, 48), new THREE.MeshBasicMaterial({ color: 0xff2a1a, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
        disc.rotation.x = -Math.PI / 2;
        const r = 10;
        disc.scale.set(r, r, 1);
        disc.position.set(p.x, gy + 0.1, p.z);
        g.world.root.add(disc);
        this.drill = { x: p.x, z: p.z, gy, r, warn: 5, on: 12, tick: 0, mark: 0, disc };
        g.hud.toast('📢 避難訓練です！ 赤い円の外へ出てください', 'warn');
        g.audio.warn();
        log('drill.start', { x: Math.round(p.x), z: Math.round(p.z) }, { time: Math.round(g.time) });
      }
      return;
    }
    const mat = dr.disc.material as THREE.MeshBasicMaterial;
    dr.mark -= dt;
    if (dr.warn > 0) {
      dr.warn -= dt;
      mat.opacity = 0.12 + 0.12 * Math.abs(Math.sin(g.time * 6));
      if (dr.mark <= 0) {
        dr.mark = 0.5;
        g.fx.ring({ x: dr.x, y: dr.gy + 0.15, z: dr.z }, dr.r * 0.96, dr.r, ZONE.enemy, 0.5, 0.95);
      }
      return;
    }
    dr.on -= dt;
    mat.opacity = 0.3;
    if (dr.mark <= 0) {
      dr.mark = 0.35;
      for (let i = 0; i < 3; i++) {
        const a = Math.random() * Math.PI * 2;
        const rr = Math.sqrt(Math.random()) * dr.r;
        g.fx.dust({ x: dr.x + Math.cos(a) * rr, y: dr.gy + 0.3, z: dr.z + Math.sin(a) * rr }, 1.2, 0xff8a6a, 1);
      }
    }
    const p = g.player.pos;
    dr.tick -= dt;
    if (dr.tick <= 0 && Math.hypot(p.x - dr.x, p.z - dr.z) < dr.r) {
      dr.tick = 0.5;
      g.player.hurt(g.stats.maxHp * 0.035, { x: dr.x, y: dr.gy, z: dr.z }, '避難訓練', undefined, 'magic');
    }
    if (dr.on <= 0) {
      dr.disc.removeFromParent();
      mat.dispose();
      dr.disc.geometry.dispose();
      this.drill = null;
    }
  }

  dispose(): void {
    if (this.cur) this.end(this.cur);
    if (this.drill) {
      this.drill.disc.removeFromParent();
      (this.drill.disc.material as THREE.Material).dispose();
      this.drill.disc.geometry.dispose();
      this.drill = null;
    }
    this.beamGeo.dispose();
    this.ringGeo.dispose();
  }
}

export type { Kind as DetourKind };
