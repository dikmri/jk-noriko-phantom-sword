import * as THREE from 'three';
import { emojiSprite } from '../core/assets';
import { V3 } from '../core/vec';
import { log } from '../log';
import { TUNE } from './defs';
import type { Game } from './game';

interface Gem {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  value: number;
  fly: boolean;
  spin: number;
}

export type ItemKind = 'heart' | 'coin' | 'chest' | 'magnet' | 'bomb';
const ITEM_EMOJI: Record<ItemKind, string> = { heart: '🍙', coin: '🪙', chest: '🎁', magnet: '🧲', bomb: '💣' };

interface Item {
  kind: ItemKind;
  x: number; y: number; z: number;
  vy: number;
  t: number;
  sprite: THREE.Sprite;
  amount: number;
}

const m4 = new THREE.Matrix4();
const q = new THREE.Quaternion();
const p = new THREE.Vector3();
const s = new THREE.Vector3();
const c = new THREE.Color();
const AX = new THREE.Vector3(0, 1, 0);

/** 経験値の結晶と、落ちているアイテム。 */
export class Pickups {
  gems: Gem[] = [];
  items: Item[] = [];
  private mesh: THREE.InstancedMesh;
  /** true の間、すべての結晶がプレイヤーへ飛んでくる */
  private vacuum = 0;

  constructor(private g: Game) {
    const geo = new THREE.OctahedronGeometry(0.2, 0);
    this.mesh = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ emissive: 0x224466, emissiveIntensity: 0.6 }), TUNE.maxGems + 20);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, c.setRGB(1, 1, 1));
    g.world.root.add(this.mesh);
  }

  dropXp(pos: V3, value: number): void {
    if (this.gems.length >= TUNE.maxGems) {
      // 多すぎるときは、既にある結晶へまとめる
      this.gems[Math.floor(Math.random() * this.gems.length)].value += value;
      return;
    }
    const a = Math.random() * Math.PI * 2;
    this.gems.push({ x: pos.x, y: Math.max(0.4, pos.y), z: pos.z, vx: Math.cos(a) * 2, vy: 4 + Math.random() * 2, vz: Math.sin(a) * 2, value, fly: false, spin: Math.random() * 6 });
  }

  dropItem(kind: ItemKind, pos: V3, amount = 1): void {
    const sprite = emojiSprite(ITEM_EMOJI[kind], kind === 'chest' ? 1.5 : 0.85);
    this.g.world.root.add(sprite);
    this.items.push({ kind, x: pos.x, y: Math.max(0.6, pos.y), z: pos.z, vy: 5, t: 0, sprite, amount });
  }

  /** 落ちている宝箱の位置（コンパスに出す）。 */
  chests(): { x: number; z: number }[] {
    return this.items.filter((i) => i.kind === 'chest');
  }

  /** まだ拾っていない経験値の合計と、宝箱の数（面をクリアしたとき、次の面へ持ちこむ）。 */
  leftovers(): { xp: number; chests: number } {
    let xp = 0;
    for (const o of this.gems) xp += o.value;
    return { xp, chests: this.items.filter((i) => i.kind === 'chest').length };
  }

  collectAll(): void {
    this.vacuum = 1.5;
  }

  update(dt: number): void {
    const g = this.g;
    const pl = g.player.pos;
    const py = pl.y + 0.8;
    const range = TUNE.xpMagnet * g.stats.magnet;
    if (this.vacuum > 0) this.vacuum -= dt;
    let n = 0;
    let got = 0;
    let picked = 0;
    for (let i = 0; i < this.gems.length; i++) {
      const o = this.gems[i];
      const dx = pl.x - o.x;
      const dy = py - o.y;
      const dz = pl.z - o.z;
      const d = Math.hypot(dx, dy, dz);
      if (!o.fly && (d < range || this.vacuum > 0) && !g.player.dead) o.fly = true;
      if (o.fly) {
        const sp = Math.max(13, 26 - d);
        const k = Math.min(1, dt * 10);
        o.vx += ((dx / d) * sp - o.vx) * k;
        o.vy += ((dy / d) * sp - o.vy) * k;
        o.vz += ((dz / d) * sp - o.vz) * k;
        if (d < 0.75) {
          got += o.value;
          picked++;
          continue;
        }
      } else {
        o.vy -= 18 * dt;
        o.vx *= 1 - 3 * dt;
        o.vz *= 1 - 3 * dt;
      }
      o.x += o.vx * dt;
      o.y += o.vy * dt;
      o.z += o.vz * dt;
      const gy = g.world.groundY(o.x, o.z);
      if (o.y < gy + 0.35) {
        o.y = gy + 0.35;
        o.vy = 0;
      }
      o.spin += dt * 3;
      this.gems[n] = o;
      const tier = o.value < 2 ? 0 : o.value < 6 ? 1 : o.value < 30 ? 2 : 3;
      const sc = 0.8 + tier * 0.35;
      q.setFromAxisAngle(AX, o.spin);
      m4.compose(p.set(o.x, o.y + Math.sin(o.spin * 1.3) * 0.06, o.z), q, s.set(sc, sc * 1.3, sc));
      this.mesh.setMatrixAt(n, m4);
      this.mesh.setColorAt(n, tier === 0 ? c.setRGB(0.3, 0.85, 1.4) : tier === 1 ? c.setRGB(0.4, 1.4, 0.5) : tier === 2 ? c.setRGB(1.6, 0.9, 0.2) : c.setRGB(1.8, 0.3, 0.7));
      n++;
    }
    this.gems.length = n;
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    if (got > 0) {
      // 早寝早起き: 拾った玉の数だけ回復
      if (g.stats.xpHeal > 0) g.addHeal(picked * g.stats.xpHeal);
      g.addXp(got);
      g.audio.pickup();
    }

    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.t += dt;
      it.vy -= 16 * dt;
      it.y += it.vy * dt;
      const rest = it.kind === 'chest' ? 0.8 : 0.6;
      const restG = rest + g.world.groundY(it.x, it.z);
      if (it.y < restG) {
        it.y = restG;
        it.vy = 0;
      }
      it.sprite.position.set(it.x, it.y + Math.sin(it.t * 3) * 0.1, it.z);
      const d = Math.hypot(pl.x - it.x, pl.z - it.z);
      if (d < (it.kind === 'chest' ? 1.6 : 1.1) && Math.abs(py - it.y) < 2 && !g.player.dead && it.t > 0.25) {
        it.sprite.removeFromParent();
        this.items.splice(i, 1);
        this.take(it);
      } else if (it.t > 60 && it.kind !== 'chest') {
        it.sprite.removeFromParent();
        this.items.splice(i, 1);
      }
    }
  }

  private take(it: Item): void {
    const g = this.g;
    const pos = { x: it.x, y: it.y, z: it.z };
    log('pickup.item', { kind: it.kind, amount: it.amount }, { time: Math.round(g.time) });
    switch (it.kind) {
      case 'heart':
        g.player.heal(g.stats.maxHp * 0.25);
        g.audio.heal();
        g.fx.sparkle(pos, 0x7dff9a, 8, 0.8);
        break;
      case 'coin':
        g.run.coins += it.amount;
        g.audio.coin();
        g.fx.sparkle(pos, 0xffd84a, 4, 0.5);
        break;
      case 'magnet':
        this.collectAll();
        g.audio.heal();
        g.hud.toast('経験値をぜんぶ回収！', 'info');
        break;
      case 'bomb':
        g.explode(pos, 16, 90, { force: 20, struct: 0, source: 'skill' });
        g.fx.flash('boom');
        break;
      case 'chest':
        g.openChest();
        break;
    }
  }

  clear(): void {
    for (const it of this.items) it.sprite.removeFromParent();
    this.items.length = 0;
    this.gems.length = 0;
  }
}
