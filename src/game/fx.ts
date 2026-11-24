import * as THREE from 'three';
import { V3 } from '../core/vec';

/**
 * 画面の手応えを作る部品。パーティクル、ヒットマーク、爆発、地面の輪、稲妻、ダメージ数字、画面の揺れ、斬撃の軌跡。
 * 方針: はっきりした形を主体にする（ぼやけた加算合成に頼らない）、寿命は短く、数は絞って 1 枚を大きく。
 */

const SHAPES = 8;
/**
 * 攻撃の範囲を示す輪・円の色。ノリコの攻撃は青、敵（と、ノリコに当たる仕掛け）の攻撃は赤にそろえる。
 */
export const ZONE = { ally: 0x3aa8ff, enemy: 0xff2a2a };

export const SH = { SOFT: 0, DISC: 1, BURST: 2, RING: 3, SPARK: 4, PUFF: 5, SHARD: 6, STAR: 7 };

function makeAtlas(): THREE.CanvasTexture {
  const S = 128;
  const cv = document.createElement('canvas');
  cv.width = S * SHAPES;
  cv.height = S;
  const c = cv.getContext('2d')!;
  const at = (i: number, fn: () => void) => {
    c.save();
    c.translate(i * S + S / 2, S / 2);
    fn();
    c.restore();
  };
  const outline = 'rgba(20,12,8,0.85)';
  at(SH.SOFT, () => {
    const g = c.createRadialGradient(0, 0, 0, 0, 0, 60);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.55, 'rgba(255,255,255,0.75)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.fillRect(-64, -64, 128, 128);
  });
  at(SH.DISC, () => {
    c.beginPath();
    c.arc(0, 0, 50, 0, Math.PI * 2);
    c.fillStyle = '#fff';
    c.fill();
    c.lineWidth = 7;
    c.strokeStyle = outline;
    c.stroke();
  });
  at(SH.BURST, () => {
    c.beginPath();
    const n = 11;
    for (let i = 0; i < n * 2; i++) {
      const r = i % 2 === 0 ? 58 : 22 + (i % 4) * 3;
      const a = (i / (n * 2)) * Math.PI * 2;
      c.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    c.closePath();
    c.fillStyle = '#fff';
    c.fill();
    c.lineWidth = 5;
    c.lineJoin = 'round';
    c.strokeStyle = outline;
    c.stroke();
  });
  at(SH.RING, () => {
    c.beginPath();
    c.arc(0, 0, 50, 0, Math.PI * 2);
    c.lineWidth = 12;
    c.strokeStyle = outline;
    c.stroke();
    c.lineWidth = 7;
    c.strokeStyle = '#fff';
    c.stroke();
  });
  at(SH.SPARK, () => {
    c.beginPath();
    c.moveTo(-60, 0);
    c.lineTo(0, -9);
    c.lineTo(60, 0);
    c.lineTo(0, 9);
    c.closePath();
    c.fillStyle = '#fff';
    c.fill();
    c.lineWidth = 3;
    c.strokeStyle = outline;
    c.stroke();
  });
  at(SH.PUFF, () => {
    const blobs: [number, number, number][] = [[-22, 8, 28], [16, 12, 30], [0, -16, 30], [-6, 4, 34]];
    c.fillStyle = outline;
    for (const [x, y, r] of blobs) {
      c.beginPath();
      c.arc(x, y, r + 5, 0, Math.PI * 2);
      c.fill();
    }
    c.fillStyle = '#fff';
    for (const [x, y, r] of blobs) {
      c.beginPath();
      c.arc(x, y, r, 0, Math.PI * 2);
      c.fill();
    }
  });
  at(SH.SHARD, () => {
    c.beginPath();
    c.moveTo(-40, 34);
    c.lineTo(8, -50);
    c.lineTo(44, 26);
    c.closePath();
    c.fillStyle = '#fff';
    c.fill();
    c.lineWidth = 6;
    c.lineJoin = 'round';
    c.strokeStyle = outline;
    c.stroke();
  });
  at(SH.STAR, () => {
    c.beginPath();
    for (let i = 0; i < 8; i++) {
      const r = i % 2 === 0 ? 58 : 12;
      const a = (i / 8) * Math.PI * 2;
      c.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    c.closePath();
    c.fillStyle = '#fff';
    c.fill();
  });
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

interface Particle {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  grav: number; drag: number;
  life: number; max: number;
  s0: number; s1: number;
  rot: number; rv: number;
  r: number; g: number; b: number;
  r2: number; g2: number; b2: number;
  a: number;
  shape: number;
}

export interface ParticleInit {
  pos: V3;
  vel?: V3;
  grav?: number;
  drag?: number;
  life: number;
  size: number;
  size2?: number;
  rot?: number;
  rotVel?: number;
  color: number;
  color2?: number;
  alpha?: number;
  shape: number;
}

const MAX_P = 1400;
const tmpC = new THREE.Color();
const tmpC2 = new THREE.Color();

class Trail {
  mesh: THREE.Mesh;
  private pts: { hx: number; hy: number; hz: number; tx: number; ty: number; tz: number; age: number }[] = [];
  private pos: Float32Array;
  private col: Float32Array;
  private readonly N = 28;
  life = 0.17;

  constructor(parent: THREE.Object3D, color: number) {
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(this.N * 2 * 3);
    this.col = new Float32Array(this.N * 2 * 4);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 4));
    const idx: number[] = [];
    for (let i = 0; i < this.N - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    geo.setIndex(idx);
    const mat = new THREE.MeshBasicMaterial({ color, vertexColors: true, transparent: true, side: THREE.DoubleSide, depthWrite: false, fog: false });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 8;
    parent.add(this.mesh);
  }

  setColor(color: number): void {
    (this.mesh.material as THREE.MeshBasicMaterial).color.setHex(color);
  }

  push(hand: V3, tip: V3): void {
    // 手元まで帯にすると体が隠れるので、根元は少し先から始める
    const k = 0.3;
    this.pts.unshift({ hx: hand.x + (tip.x - hand.x) * k, hy: hand.y + (tip.y - hand.y) * k, hz: hand.z + (tip.z - hand.z) * k, tx: tip.x, ty: tip.y, tz: tip.z, age: 0 });
    if (this.pts.length > this.N) this.pts.length = this.N;
  }

  update(dt: number): void {
    for (const p of this.pts) p.age += dt;
    while (this.pts.length && this.pts[this.pts.length - 1].age > this.life) this.pts.pop();
    const n = this.pts.length;
    const geo = this.mesh.geometry;
    for (let i = 0; i < this.N; i++) {
      const p = this.pts[Math.min(i, n - 1)];
      const o = i * 6;
      const c = i * 8;
      if (!p) {
        this.pos.fill(0, o, o + 6);
        this.col.fill(0, c, c + 8);
        continue;
      }
      this.pos[o] = p.hx; this.pos[o + 1] = p.hy; this.pos[o + 2] = p.hz;
      this.pos[o + 3] = p.tx; this.pos[o + 4] = p.ty; this.pos[o + 5] = p.tz;
      const a = i < n ? Math.max(0, 1 - p.age / this.life) : 0;
      this.col[c] = 1; this.col[c + 1] = 1; this.col[c + 2] = 1; this.col[c + 3] = a * 0.35;
      this.col[c + 4] = 1; this.col[c + 5] = 1; this.col[c + 6] = 1; this.col[c + 7] = a * 0.9;
    }
    geo.attributes.position.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
    this.mesh.visible = n >= 2;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

export type { Trail };

interface RingFx { mesh: THREE.Mesh; t: number; dur: number; r0: number; r1: number; a: number }
interface BoltFx { mesh: THREE.Mesh; t: number; dur: number }
interface NumFx { el: HTMLDivElement; x: number; y: number; z: number; t: number; dur: number; vy: number }

export class Fx {
  private particles: Particle[] = [];
  private geo: THREE.InstancedBufferGeometry;
  private iPos: THREE.InstancedBufferAttribute;
  private iData: THREE.InstancedBufferAttribute;
  private iColor: THREE.InstancedBufferAttribute;
  private points: THREE.Mesh;
  private rings: RingFx[] = [];
  private ringPool: THREE.Mesh[] = [];
  private bolts: BoltFx[] = [];
  private nums: NumFx[] = [];
  private numPool: HTMLDivElement[] = [];
  private trails: Trail[] = [];
  private shakeT = 0;
  private shakeDur = 0;
  private shakeAmp = 0;
  private shakeKind: 'S' | 'M' | 'L' = 'S';
  private shakeDir = new THREE.Vector2(1, 0);
  private shakeSeed = 0;
  shakeScale = 1;
  private v = new THREE.Vector3();
  private flashEl: HTMLDivElement;
  private numLayer: HTMLDivElement;
  private ringGeo = new THREE.RingGeometry(0.86, 1, 40);

  constructor(private root: THREE.Object3D, private camera: THREE.PerspectiveCamera, ui: HTMLElement) {
    const base = new THREE.PlaneGeometry(1, 1);
    this.geo = new THREE.InstancedBufferGeometry();
    this.geo.index = base.index;
    this.geo.setAttribute('position', base.attributes.position);
    this.geo.setAttribute('uv', base.attributes.uv);
    this.iPos = new THREE.InstancedBufferAttribute(new Float32Array(MAX_P * 3), 3);
    this.iData = new THREE.InstancedBufferAttribute(new Float32Array(MAX_P * 4), 4);
    this.iColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_P * 3), 3);
    this.iPos.setUsage(THREE.DynamicDrawUsage);
    this.iData.setUsage(THREE.DynamicDrawUsage);
    this.iColor.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('iPos', this.iPos);
    this.geo.setAttribute('iData', this.iData);
    this.geo.setAttribute('iColor', this.iColor);
    this.geo.instanceCount = 0;
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: makeAtlas() }, uCols: { value: SHAPES } },
      vertexShader: `
        attribute vec3 iPos; attribute vec4 iData; attribute vec3 iColor;
        uniform float uCols;
        varying vec2 vUv; varying vec4 vColor;
        void main() {
          vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
          float c = cos(iData.y), s = sin(iData.y);
          vec2 q = position.xy;
          q = vec2(q.x * c - q.y * s, q.x * s + q.y * c) * iData.x;
          mv.xy += q;
          gl_Position = projectionMatrix * mv;
          vUv = vec2((uv.x + iData.z) / uCols, uv.y);
          vColor = vec4(iColor, iData.w);
        }`,
      fragmentShader: `
        uniform sampler2D map;
        varying vec2 vUv; varying vec4 vColor;
        void main() {
          vec4 t = texture2D(map, vUv);
          gl_FragColor = vec4(t.rgb * vColor.rgb, t.a * vColor.a);
          if (gl_FragColor.a < 0.01) discard;
          #include <colorspace_fragment>
        }`,
      transparent: true,
      depthWrite: false,
    });
    this.points = new THREE.Mesh(this.geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
    root.add(this.points);

    this.flashEl = document.createElement('div');
    this.flashEl.className = 'fx-flash';
    ui.appendChild(this.flashEl);
    this.numLayer = document.createElement('div');
    this.numLayer.className = 'fx-nums';
    ui.appendChild(this.numLayer);
  }

  // ---------------------------------------------------------------- パーティクル
  spawn(p: ParticleInit): void {
    if (this.particles.length >= MAX_P) return;
    tmpC.setHex(p.color);
    tmpC2.setHex(p.color2 ?? p.color);
    this.particles.push({
      x: p.pos.x, y: p.pos.y, z: p.pos.z,
      vx: p.vel?.x ?? 0, vy: p.vel?.y ?? 0, vz: p.vel?.z ?? 0,
      grav: p.grav ?? 0, drag: p.drag ?? 0,
      life: 0, max: p.life,
      s0: p.size, s1: p.size2 ?? p.size,
      rot: p.rot ?? 0, rv: p.rotVel ?? 0,
      r: tmpC.r, g: tmpC.g, b: tmpC.b,
      r2: tmpC2.r, g2: tmpC2.g, b2: tmpC2.b,
      a: p.alpha ?? 1,
      shape: p.shape,
    });
  }

  private rnd(a: number): number {
    return (Math.random() * 2 - 1) * a;
  }

  /** 攻撃が当たった瞬間の印。strength 0..1。dir は吹き飛ぶ方向。 */
  hitMark(pos: V3, strength: number, dir?: V3, crit = false): void {
    const s = 0.7 + strength * 1.5;
    this.spawn({ pos, life: 0.11, size: s * 0.7, size2: s * 1.9, rot: Math.random() * 6, color: crit ? 0xffe14d : 0xffffff, color2: crit ? 0xff8a1e : 0xffe9a8, shape: SH.BURST });
    this.spawn({ pos, life: 0.2, size: s * 0.5, size2: s * 2.6, color: 0xffffff, alpha: 0.9, shape: SH.RING });
    const n = 3 + Math.round(strength * 4);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 5 + Math.random() * 7 * (0.6 + strength);
      const vx = Math.cos(a) * sp + (dir?.x ?? 0) * 5;
      const vz = Math.sin(a) * sp + (dir?.z ?? 0) * 5;
      const vy = 2 + Math.random() * 6 + (dir?.y ?? 0) * 4;
      this.spawn({ pos, vel: { x: vx, y: vy, z: vz }, grav: -18, drag: 2.5, life: 0.22 + Math.random() * 0.12, size: 0.5 * s, size2: 0.1, rot: Math.atan2(vy, Math.hypot(vx, vz)), color: crit ? 0xfff07a : 0xfff4c2, color2: 0xff7a1a, shape: SH.SPARK });
    }
  }

  /** 爆発。閃光 → 爆炎 → 黒煙 → 収束 の順に見せる。 */
  explosion(pos: V3, radius: number): void {
    const r = radius;
    this.spawn({ pos, life: 0.07, size: r * 2.2, size2: r * 3.0, color: 0xffffff, shape: SH.SOFT });
    this.spawn({ pos, life: 0.16, size: r * 0.8, size2: r * 2.6, rot: Math.random() * 6, color: 0xfff1a0, color2: 0xff7a1a, shape: SH.BURST });
    const n = Math.min(9, 4 + Math.round(r));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + this.rnd(0.4);
      const d = r * (0.25 + Math.random() * 0.4);
      const p = { x: pos.x + Math.cos(a) * d, y: pos.y + Math.random() * r * 0.4, z: pos.z + Math.sin(a) * d };
      this.spawn({ pos: p, vel: { x: Math.cos(a) * r * 1.6, y: r * (0.8 + Math.random()), z: Math.sin(a) * r * 1.6 }, drag: 3, life: 0.3 + Math.random() * 0.12, size: r * 0.7, size2: r * 1.3, rot: Math.random() * 6, rotVel: this.rnd(2), color: 0xffd23c, color2: 0xd9340b, shape: SH.PUFF });
      // 黒煙は画面を覆いすぎないよう、数を半分にして小さめにする
      if (i % 2 === 0) this.spawn({ pos: p, vel: { x: Math.cos(a) * r * 0.7, y: r * (1.4 + Math.random()), z: Math.sin(a) * r * 0.7 }, drag: 1.8, life: 0.55 + Math.random() * 0.25, size: r * 0.4, size2: r * 0.85, rot: Math.random() * 6, rotVel: this.rnd(1.2), color: 0x4a443f, color2: 0x1c1815, alpha: 0.7, shape: SH.PUFF });
    }
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = r * (3 + Math.random() * 4);
      this.spawn({ pos, vel: { x: Math.cos(a) * sp, y: r * (2 + Math.random() * 3), z: Math.sin(a) * sp }, grav: -20, life: 0.45 + Math.random() * 0.3, size: 0.25 + Math.random() * 0.2, color: 0xffb347, color2: 0x4a2a12, rot: Math.random() * 6, rotVel: this.rnd(10), shape: SH.SHARD });
    }
    this.ring(pos, r * 0.3, r * 1.25, 0xfff0c0, 0.28);
  }

  /** 土ぼこり・煙。 */
  /** 地面に描く物の高さ。0 付近の高さは「地面の上」として、地形の高さに直す。 */
  private groundLevel(pos: V3): number {
    const gy = this.groundAt ? this.groundAt(pos.x, pos.z) : 0;
    return Math.abs(pos.y) < 0.3 ? gy + 0.06 : Math.max(pos.y, gy + 0.06);
  }

  dust(pos: V3, size: number, color = 0xcbb89a, count = 4): void {
    const y0 = this.groundLevel(pos) - 0.06;
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      this.spawn({ pos: { x: pos.x + this.rnd(size * 0.3), y: y0 + 0.1, z: pos.z + this.rnd(size * 0.3) }, vel: { x: Math.cos(a) * size * 1.5, y: 0.6 + Math.random() * size, z: Math.sin(a) * size * 1.5 }, drag: 2.5, life: 0.4 + Math.random() * 0.25, size: size * 0.5, size2: size * 1.3, rot: Math.random() * 6, rotVel: this.rnd(1.5), color, color2: color, alpha: 0.8, shape: SH.PUFF });
    }
  }

  /** 破片。壁や小道具が壊れたとき。 */
  shards(pos: V3, color: number, count: number, speed = 6, size = 0.3): void {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = speed * (0.4 + Math.random());
      this.spawn({ pos, vel: { x: Math.cos(a) * sp, y: 2 + Math.random() * speed, z: Math.sin(a) * sp }, grav: -20, life: 0.5 + Math.random() * 0.4, size: size * (0.6 + Math.random()), rot: Math.random() * 6, rotVel: this.rnd(12), color, color2: color, shape: SH.SHARD });
    }
  }

  /** 敵が消えるときの「ぽふっ」。 */
  poof(pos: V3, size: number, color = 0xffffff): void {
    this.spawn({ pos, life: 0.16, size: size * 0.6, size2: size * 2, color: 0xffffff, alpha: 0.9, shape: SH.RING });
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.random();
      this.spawn({ pos, vel: { x: Math.cos(a) * size * 3, y: 1.5 + Math.random() * 2, z: Math.sin(a) * size * 3 }, drag: 4, life: 0.32, size: size * 0.8, size2: size * 0.2, rot: Math.random() * 6, color, color2: color, shape: SH.PUFF });
    }
  }

  /** きらめき（経験値・レベルアップ・回復）。 */
  sparkle(pos: V3, color: number, count = 5, spread = 0.6): void {
    for (let i = 0; i < count; i++) {
      this.spawn({ pos: { x: pos.x + this.rnd(spread), y: pos.y + this.rnd(spread), z: pos.z + this.rnd(spread) }, vel: { x: this.rnd(1), y: 1.5 + Math.random() * 2, z: this.rnd(1) }, life: 0.35 + Math.random() * 0.25, size: 0.35, size2: 0.05, rot: Math.random() * 6, rotVel: this.rnd(6), color, color2: 0xffffff, shape: SH.STAR });
    }
  }

  /** 属性つきの小さな弾け（炎・氷・雷）。 */
  element(pos: V3, kind: 'fire' | 'ice' | 'elec' | 'dark' | 'water', size = 1): void {
    const cols = { fire: [0xffc23c, 0xd9340b], ice: [0xe8fbff, 0x5ac8ff], elec: [0xfffbb0, 0xffd400], dark: [0x7a3cff, 0x180830], water: [0xffffff, 0xbfe8ff] }[kind];
    const shape = kind === 'ice' ? SH.SHARD : kind === 'elec' ? SH.SPARK : SH.PUFF;
    for (let i = 0; i < 4; i++) {
      const a = Math.random() * Math.PI * 2;
      this.spawn({ pos, vel: { x: Math.cos(a) * 3 * size, y: 1 + Math.random() * 4 * size, z: Math.sin(a) * 3 * size }, drag: 3, grav: kind === 'ice' ? -14 : 0, life: 0.3 + Math.random() * 0.2, size: 0.55 * size, size2: 0.15 * size, rot: Math.random() * 6, rotVel: this.rnd(5), color: cols[0], color2: cols[1], shape });
    }
  }

  // ---------------------------------------------------------------- 地面の輪・稲妻
  /** 地形の高さ（高低差のあるステージ）。ゲームが設定する */
  groundAt: ((x: number, z: number) => number) | null = null;

  ring(pos: V3, r0: number, r1: number, color: number, dur = 0.3, alpha = 0.9): void {
    let m = this.ringPool.pop();
    if (!m) {
      m = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false }));
      m.rotation.x = -Math.PI / 2;
      m.renderOrder = 6;
    }
    (m.material as THREE.MeshBasicMaterial).color.setHex(color);
    // 地面に描く輪は、地形の高さより下に埋もれないようにする。
    // 高さを 0 付近（0.1 など）で渡されたときは「地面の上」の意味なので、地形の高さに置く（穴の底で浮かないように）
    m.position.set(pos.x, this.groundLevel(pos), pos.z);
    this.root.add(m);
    this.rings.push({ mesh: m, t: 0, dur, r0, r1, a: alpha });
  }

  /** 稲妻・レーザーなどの折れ線。カメラへ向いた帯で描く。 */
  bolt(from: V3, to: V3, color = 0xfff7a0, width = 0.35, jitter = 0.8, dur = 0.14): void {
    const segs = 9;
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const j = i === 0 || i === segs ? 0 : jitter;
      pts.push(new THREE.Vector3(from.x + (to.x - from.x) * t + this.rnd(j), from.y + (to.y - from.y) * t + this.rnd(j * 0.4), from.z + (to.z - from.z) * t + this.rnd(j)));
    }
    const pos = new Float32Array((segs + 1) * 2 * 3);
    const cam = this.camera.position;
    const side = new THREE.Vector3();
    const view = new THREE.Vector3();
    const dir = new THREE.Vector3();
    for (let i = 0; i <= segs; i++) {
      dir.subVectors(pts[Math.min(segs, i + 1)], pts[Math.max(0, i - 1)]).normalize();
      view.subVectors(cam, pts[i]).normalize();
      side.crossVectors(dir, view).normalize().multiplyScalar(width * 0.5);
      pos.set([pts[i].x + side.x, pts[i].y + side.y, pts[i].z + side.z, pts[i].x - side.x, pts[i].y - side.y, pts[i].z - side.z], i * 6);
    }
    const idx: number[] = [];
    for (let i = 0; i < segs; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setIndex(idx);
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false }));
    m.frustumCulled = false;
    m.renderOrder = 9;
    this.root.add(m);
    this.bolts.push({ mesh: m, t: 0, dur });
  }

  // ---------------------------------------------------------------- 数字
  number(pos: V3, text: string, kind: 'dmg' | 'crit' | 'hurt' | 'heal' | 'chain' | 'info' | 'phys' | 'magic' | 'true' | 'impact' = 'dmg'): void {
    if (this.nums.length > 46) return;
    let el = this.numPool.pop();
    if (!el) {
      el = document.createElement('div');
      this.numLayer.appendChild(el);
    }
    el.className = `fx-num fx-num-${kind}`;
    el.textContent = text;
    el.style.display = 'block';
    this.nums.push({ el, x: pos.x + this.rnd(0.25), y: pos.y, z: pos.z + this.rnd(0.25), t: 0, dur: kind === 'dmg' || kind === 'phys' || kind === 'magic' || kind === 'impact' ? 0.55 : 0.85, vy: kind === 'dmg' || kind === 'phys' || kind === 'magic' || kind === 'impact' ? 2.2 : 1.6 });
  }

  // ---------------------------------------------------------------- 画面の揺れ・閃光
  /** 大中小で揺れ方そのものを変える。最初が強く、収束していく。 */
  shake(kind: 'S' | 'M' | 'L', dirX = 0, dirY = 1): void {
    const amp = kind === 'S' ? 0.05 : kind === 'M' ? 0.16 : 0.48;
    const remain = this.shakeDur > 0 ? this.shakeAmp * (1 - this.shakeT / this.shakeDur) : 0;
    if (amp < remain) return;
    this.shakeKind = kind;
    this.shakeAmp = amp;
    this.shakeDur = kind === 'S' ? 0.11 : kind === 'M' ? 0.24 : 0.6;
    this.shakeT = 0;
    this.shakeDir.set(dirX, dirY);
    if (this.shakeDir.lengthSq() < 1e-6) this.shakeDir.set(0, 1);
    this.shakeDir.normalize();
    this.shakeSeed = Math.random() * 100;
  }

  /** カメラの位置を決めたあとに呼ぶ。揺れの分だけカメラをずらす。 */
  applyShake(cam: THREE.PerspectiveCamera): void {
    if (this.shakeDur <= 0 || this.shakeT >= this.shakeDur) return;
    const k = 1 - this.shakeT / this.shakeDur;
    const a = this.shakeAmp * this.shakeScale;
    const t = this.shakeT;
    let ox = 0;
    let oy = 0;
    let roll = 0;
    if (this.shakeKind === 'S') {
      ox = this.rnd(a) * k;
      oy = this.rnd(a) * k;
    } else if (this.shakeKind === 'M') {
      const w = Math.sin(t * 95) * a * k * k;
      ox = this.shakeDir.x * w + this.rnd(a * 0.2) * k;
      oy = this.shakeDir.y * w;
    } else {
      const kk = k * k;
      oy = Math.sin(t * 46 + this.shakeSeed) * a * kk;
      ox = Math.sin(t * 31 + this.shakeSeed * 2) * a * 0.7 * kk;
      roll = Math.sin(t * 38) * 0.035 * kk * this.shakeScale;
    }
    cam.translateX(ox);
    cam.translateY(oy);
    cam.rotateZ(roll);
  }

  /** 画面全体の色かぶせ。kind: hurt = 赤い縁、boom = 白→暗の明滅、gold = 金色。 */
  flash(kind: 'hurt' | 'boom' | 'gold' | 'ice' | 'dark'): void {
    const el = this.flashEl;
    el.className = 'fx-flash';
    void el.offsetWidth;
    el.className = `fx-flash fx-flash-${kind}`;
  }

  makeTrail(color = 0xffffff): Trail {
    const t = new Trail(this.root, color);
    this.trails.push(t);
    return t;
  }

  removeTrail(t: Trail): void {
    const i = this.trails.indexOf(t);
    if (i >= 0) this.trails.splice(i, 1);
    t.dispose();
  }

  // ---------------------------------------------------------------- 更新
  /** dt: ゲーム内時間、real: 実時間（ヒットストップ中も進む）。 */
  update(dt: number, real: number): void {
    const P = this.particles;
    let n = 0;
    const pos = this.iPos.array as Float32Array;
    const data = this.iData.array as Float32Array;
    const col = this.iColor.array as Float32Array;
    for (let i = 0; i < P.length; i++) {
      const p = P[i];
      p.life += dt;
      if (p.life >= p.max) continue;
      const k = p.life / p.max;
      const dr = Math.max(0, 1 - p.drag * dt);
      p.vx *= dr; p.vy *= dr; p.vz *= dr;
      p.vy += p.grav * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      p.rot += p.rv * dt;
      P[n] = p;
      pos[n * 3] = p.x; pos[n * 3 + 1] = p.y; pos[n * 3 + 2] = p.z;
      data[n * 4] = p.s0 + (p.s1 - p.s0) * (1 - (1 - k) * (1 - k));
      data[n * 4 + 1] = p.rot;
      data[n * 4 + 2] = p.shape;
      data[n * 4 + 3] = p.a * (k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4);
      col[n * 3] = p.r + (p.r2 - p.r) * k;
      col[n * 3 + 1] = p.g + (p.g2 - p.g) * k;
      col[n * 3 + 2] = p.b + (p.b2 - p.b) * k;
      n++;
    }
    P.length = n;
    this.geo.instanceCount = n;
    this.iPos.needsUpdate = true;
    this.iData.needsUpdate = true;
    this.iColor.needsUpdate = true;

    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.t += dt;
      const k = Math.min(1, r.t / r.dur);
      const s = r.r0 + (r.r1 - r.r0) * (1 - (1 - k) * (1 - k));
      r.mesh.scale.setScalar(s);
      (r.mesh.material as THREE.MeshBasicMaterial).opacity = r.a * (1 - k);
      if (k >= 1) {
        r.mesh.removeFromParent();
        this.ringPool.push(r.mesh);
        this.rings.splice(i, 1);
      }
    }
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i];
      b.t += dt;
      const k = b.t / b.dur;
      (b.mesh.material as THREE.MeshBasicMaterial).opacity = 1 - k;
      b.mesh.visible = Math.floor(b.t * 60) % 3 !== 2;
      if (k >= 1) {
        b.mesh.removeFromParent();
        b.mesh.geometry.dispose();
        (b.mesh.material as THREE.Material).dispose();
        this.bolts.splice(i, 1);
      }
    }
    for (const t of this.trails) t.update(dt);
    if (this.shakeDur > 0) this.shakeT += real;

    const w = window.innerWidth;
    const h = window.innerHeight;
    for (let i = this.nums.length - 1; i >= 0; i--) {
      const m = this.nums[i];
      m.t += real;
      m.y += m.vy * real;
      m.vy *= 1 - 3 * real;
      const k = m.t / m.dur;
      if (k >= 1) {
        m.el.style.display = 'none';
        this.numPool.push(m.el);
        this.nums.splice(i, 1);
        continue;
      }
      this.v.set(m.x, m.y, m.z).project(this.camera);
      if (this.v.z > 1 || this.v.z < -1) {
        m.el.style.opacity = '0';
        continue;
      }
      const sx = (this.v.x * 0.5 + 0.5) * w;
      const sy = (-this.v.y * 0.5 + 0.5) * h;
      const pop = k < 0.15 ? 0.6 + (k / 0.15) * 0.7 : 1.3 - Math.min(0.3, (k - 0.15) * 1.5);
      m.el.style.transform = `translate(${sx.toFixed(1)}px,${sy.toFixed(1)}px) translate(-50%,-50%) scale(${pop.toFixed(2)})`;
      m.el.style.opacity = k > 0.7 ? String(1 - (k - 0.7) / 0.3) : '1';
    }
  }

  get particleCount(): number {
    return this.particles.length;
  }

  dispose(): void {
    for (const t of this.trails) t.dispose();
    this.trails.length = 0;
    this.points.removeFromParent();
    this.geo.dispose();
    (this.points.material as THREE.ShaderMaterial).dispose();
    for (const r of this.rings) r.mesh.removeFromParent();
    for (const b of this.bolts) b.mesh.removeFromParent();
    this.flashEl.remove();
    this.numLayer.remove();
  }
}
