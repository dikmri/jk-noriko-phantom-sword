import * as THREE from 'three';
import { G, G_ALL, groups, RAPIER } from '../core/physics';
import { V3 } from '../core/vec';
import { log } from '../log';
import { TUNE } from './defs';
import type { Game } from './game';
import { ZONE } from './fx';
import { findUnsupported, SupportNode } from './rules';
import { createStage, Stage } from './stage';
import { ART } from './usd/catalog';
import { placeUsd } from './usd/place';
import { ArtDef, ArtPose, findJoints, isWheel, jointMatrix, linkCenter, linkMatrices, makePose, stepPose, wheelRadius } from './usd/art';

/** 校庭の半分の広さ（m）。この外には出られない。 */
export const ARENA = 72;

// ------------------------------------------------------------------ まとめ描き
interface Slotted {
  slot: number;
  set: InstancedSet | null;
}

/** 同じ形のものをまとめて描く。追加・削除しても詰めて管理する。 */
export class InstancedSet {
  mesh: THREE.InstancedMesh;
  items: Slotted[] = [];
  private tmp = new THREE.Matrix4();
  private tmpC = new THREE.Color();
  dirty = false;

  constructor(geo: THREE.BufferGeometry, mat: THREE.Material | THREE.Material[], private cap: number, parent: THREE.Object3D, shadow = true) {
    this.mesh = new THREE.InstancedMesh(geo, mat, cap);
    this.mesh.count = 0;
    this.mesh.castShadow = shadow;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    parent.add(this.mesh);
  }

  get full(): boolean {
    return this.items.length >= this.cap;
  }

  add(o: Slotted): boolean {
    if (this.items.length >= this.cap) return false;
    o.slot = this.items.length;
    o.set = this;
    this.items.push(o);
    this.mesh.count = this.items.length;
    return true;
  }

  remove(o: Slotted): void {
    if (o.set !== this) return;
    const last = this.items.pop()!;
    if (last !== o) {
      this.mesh.getMatrixAt(last.slot, this.tmp);
      this.mesh.setMatrixAt(o.slot, this.tmp);
      if (this.mesh.instanceColor) {
        this.mesh.getColorAt(last.slot, this.tmpC);
        this.mesh.setColorAt(o.slot, this.tmpC);
        this.mesh.instanceColor.needsUpdate = true;
      }
      this.items[o.slot] = last;
      last.slot = o.slot;
    }
    o.set = null;
    o.slot = -1;
    this.mesh.count = this.items.length;
    this.dirty = true;
  }

  setMatrix(o: Slotted, m: THREE.Matrix4): void {
    this.mesh.setMatrixAt(o.slot, m);
    this.dirty = true;
  }

  setColor(o: Slotted, c: THREE.Color): void {
    this.mesh.setColorAt(o.slot, c);
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  flush(): void {
    if (this.dirty) {
      this.mesh.instanceMatrix.needsUpdate = true;
      this.dirty = false;
    }
  }
}

// ------------------------------------------------------------------ 建物の部品
export type ChunkKind = 'wall' | 'wallwin' | 'slab' | 'frag';

export interface Chunk extends Slotted {
  kind: ChunkKind;
  pos: THREE.Vector3;
  rot: THREE.Quaternion;
  half: THREE.Vector3;
  hp: number;
  maxHp: number;
  /** これ未満の一撃は傷にならない */
  tough: number;
  state: 'fixed' | 'loose' | 'gone';
  col: RAPIER.Collider | null;
  body: RAPIER.RigidBody | null;
  node: number;
  /** 敵に当たるとダメージになる残り秒数 */
  hot: number;
  age: number;
  prevSpeed: number;
  mass: number;
  building: boolean;
}

// ------------------------------------------------------------------ 小道具
export interface PropDef {
  id: string;
  model: string;
  mass: number;
  /** cylx は X 方向に寝かせた円柱（土管） */
  shape: 'box' | 'cyl' | 'ball' | 'cylx';
  hp?: number;
  explosive?: { r: number; dmg: number };
  fragile?: boolean;
  rooted?: boolean;
  friction?: number;
  restitution?: number;
  /** 壊れると、しばらく勝手に飛び回る（消火器） */
  rocket?: boolean;
  /** 爆発したあとに毒の霧が残る（理科室の薬品） */
  gas?: boolean;
  /** 壊れると中身が飛び散る（ガチャガチャ）。scale は中身の大きさの倍率 */
  spill?: { prop: string; n: number; coins: number; scale?: number };
  /** 壊れると水があふれ出る（給水塔） */
  burst?: 'water';
  /** 叩くとステージの仕掛けが動く（大太鼓） */
  drum?: boolean;
  /** 水に浮く強さ（1 で重さと釣り合う）。無ければ沈む */
  float?: number;
  /** USDCraft の物体（src/game/usd/catalog.ts のキー）。部品ごとに描き、関節が動き、壊れると部品に分かれる */
  art?: string;
  /** 壊れて飛び散った USDCraft の部品（world が作る） */
  part?: { key: string; link: number };
  /**
   * 仕掛け。hydrant: 壊すと水柱が噴き出す / seesaw: 片側を叩く・重い物が落ちると反対側を打ち上げる /
   * spinner: 叩くと回って、まわりの敵を外へ飛ばす / slapper: 叩くと扉が開いて前の敵をはたく /
   * driver: 叩くと前へ走ってフォークで敵をすくい上げる / roller: 叩くとよく転がって敵をはねる
   */
  gimmick?: 'hydrant' | 'seesaw' | 'spinner' | 'slapper' | 'driver' | 'roller';
  /** 壊れると、しばらく飛び回ってから爆発する（ガスボンベ）。explosive と組で使う */
  rocketBoom?: boolean;
  /** 置いてある間、回し続ける関節（名前の一部）と速さ（rad/s）。風車の羽根など */
  idleSpin?: { joint: string; w: number };
  /** 壊れたときに落とすお金 */
  coins?: number;
  /** 地面に固定された円柱の当たり判定の太さ（見た目の幅に対する割合） */
  colR?: number;
  fallback: [number, number, number, number];
}

/** USDCraft の物体の小道具。大きさは目録から決める。 */
function usdProp(id: string, key: string, o: Partial<PropDef> = {}): PropDef {
  const a = ART[key];
  const size = a ? [a.max[0] - a.min[0], a.max[1] - a.min[1], a.max[2] - a.min[2]] : [1, 1, 1];
  return { id, model: `usd/${key}`, mass: Math.round(a?.mass ?? 50), shape: 'box', art: key, fallback: [size[0], size[1], size[2], 0x9a9a9a], ...o };
}

export const PROPS: Record<string, PropDef> = {
  desk: { id: 'desk', model: 'p_desk', mass: 16, shape: 'box', fallback: [0.7, 0.72, 0.45, 0xc9a26b] },
  chair: { id: 'chair', model: 'p_chair', mass: 6, shape: 'box', fallback: [0.42, 0.8, 0.42, 0xb5894f] },
  box: { id: 'box', model: 'p_box', mass: 4, shape: 'box', hp: 14, fragile: true, fallback: [0.6, 0.5, 0.5, 0xb98d5a] },
  barrel: { id: 'barrel', model: 'p_barrel', mass: 30, shape: 'cyl', hp: 20, explosive: { r: 4.2, dmg: 70 }, fallback: [0.6, 0.9, 0.6, 0xc8262b] },
  bike: { id: 'bike', model: 'p_bike', mass: 14, shape: 'box', fallback: [0.5, 1.0, 1.7, 0x3a7bd5] },
  vending: { id: 'vending', model: 'p_vending', mass: 260, shape: 'box', fallback: [1.0, 1.85, 0.75, 0xd03a3a] },
  cone: { id: 'cone', model: 'p_cone', mass: 2, shape: 'cyl', fallback: [0.4, 0.7, 0.4, 0xff7a1a] },
  car: { id: 'car', model: 'p_car', mass: 900, shape: 'box', hp: 240, explosive: { r: 6.5, dmg: 130 }, fallback: [1.8, 1.4, 4.0, 0xf2f2f2] },
  statue: { id: 'statue', model: 'p_statue', mass: 600, shape: 'box', fallback: [0.9, 2.2, 0.9, 0x6c7a5a] },
  goal: { id: 'goal', model: 'p_goal', mass: 110, shape: 'box', fallback: [5.0, 2.2, 1.6, 0xffffff] },
  tree: { id: 'tree', model: 'p_tree', mass: 500, shape: 'cyl', hp: 150, rooted: true, float: 1.4, fallback: [1.2, 5.5, 1.2, 0x3f8f3f] },
  bench: { id: 'bench', model: 'p_bench', mass: 36, shape: 'box', fallback: [1.6, 0.8, 0.5, 0x8a5a30] },
  ball: { id: 'ball', model: 'p_ball', mass: 0.6, shape: 'ball', restitution: 0.88, fallback: [0.34, 0.34, 0.34, 0xffffff] },
  bigstatue: { id: 'bigstatue', model: 'p_statue', mass: 600, shape: 'box', fallback: [0.9, 2.2, 0.9, 0xd8b23a] },
  bowling: { id: 'bowling', model: 'p_bowling', mass: 110, shape: 'ball', friction: 0.5, restitution: 0.1, fallback: [0.56, 0.56, 0.56, 0x2a3a8a] },
  locker: { id: 'locker', model: 'p_locker', mass: 60, shape: 'box', fallback: [0.9, 1.8, 0.5, 0x7896be] },
  piano: { id: 'piano', model: 'p_piano', mass: 350, shape: 'box', fallback: [1.5, 1.5, 1.9, 0x1e1e22] },
  extinguisher: { id: 'extinguisher', model: 'p_extinguisher', mass: 6, shape: 'cyl', hp: 5, rocket: true, fallback: [0.22, 0.62, 0.22, 0xd62c28] },
  flask: { id: 'flask', model: 'p_flask', mass: 1.5, shape: 'cyl', hp: 2, explosive: { r: 2.4, dmg: 36 }, gas: true, fallback: [0.26, 0.37, 0.26, 0x78e65a] },
  shelf: { id: 'shelf', model: 'p_shelf', mass: 90, shape: 'box', fallback: [1.0, 2.0, 0.35, 0x82583a] },
  tobibako: { id: 'tobibako', model: 'p_tobibako', mass: 45, shape: 'box', fallback: [1.0, 0.9, 0.62, 0xc49660] },
  boat: { id: 'boat', model: 'p_boat', mass: 90, shape: 'box', float: 9, fallback: [1.4, 1.0, 2.4, 0xf6f6f4] },
  watertank: { id: 'watertank', model: 'p_watertank', mass: 600, shape: 'cyl', hp: 120, burst: 'water', fallback: [3.2, 2.9, 3.2, 0xc8d6e2] },
  acunit: { id: 'acunit', model: 'p_acunit', mass: 70, shape: 'box', fallback: [0.9, 0.7, 0.36, 0xe2e2dc] },
  wreckball: { id: 'wreckball', model: 'p_wreckball', mass: 1800, shape: 'ball', friction: 0.4, restitution: 0.1, fallback: [2.4, 2.4, 2.4, 0x3c3c42] },
  beam: { id: 'beam', model: 'p_beam', mass: 600, shape: 'box', friction: 0.7, fallback: [6.0, 0.6, 0.5, 0x965432] },
  dokan: { id: 'dokan', model: 'p_dokan', mass: 250, shape: 'cylx', friction: 0.5, fallback: [2.2, 1.6, 1.6, 0xb0aca4] },
  yatai: { id: 'yatai', model: 'p_yatai', mass: 150, shape: 'box', hp: 90, fragile: true, fallback: [2.6, 2.5, 1.8, 0xc49660] },
  taiko: { id: 'taiko', model: 'p_taiko', mass: 200, shape: 'box', rooted: true, drum: true, fallback: [1.8, 2.15, 1.0, 0xdc5032] },
  toro: { id: 'toro', model: 'p_toro', mass: 300, shape: 'box', fallback: [0.9, 1.9, 0.9, 0x96948c] },
  rock: { id: 'rock', model: 'p_rock', mass: 900, shape: 'ball', friction: 0.8, restitution: 0.1, fallback: [2.6, 2.5, 2.5, 0x8c8880] },
  log: { id: 'log', model: 'p_log', mass: 260, shape: 'cylx', friction: 0.6, float: 1.4, fallback: [3.2, 0.9, 0.9, 0x6e4c2e] },
  domino: { id: 'domino', model: 'p_domino', mass: 25, shape: 'box', friction: 0.6, fallback: [0.8, 1.6, 0.22, 0xf4f0e6] },
  blackboard: { id: 'blackboard', model: 'p_blackboard', mass: 40, shape: 'box', fallback: [2.4, 1.3, 0.12, 0x2f5a3a] },
  gacha: { id: 'gacha', model: 'p_gacha', mass: 50, shape: 'box', hp: 22, spill: { prop: 'capsule', n: 7, coins: 2 }, fallback: [0.5, 1.3, 0.45, 0xd62c28] },
  capsule: { id: 'capsule', model: 'p_capsule', mass: 0.3, shape: 'ball', restitution: 0.75, float: 3, fallback: [0.15, 0.15, 0.15, 0xfa96be] },
  sign: { id: 'sign', model: 'p_sign', mass: 8, shape: 'box', float: 1.5, fallback: [0.6, 0.95, 0.5, 0xf6f6f4] },
  trash: { id: 'trash', model: 'p_trash', mass: 12, shape: 'cyl', fallback: [0.54, 0.74, 0.54, 0x3c9650] },
  lamp: { id: 'lamp', model: 'p_lamp', mass: 120, shape: 'cyl', hp: 60, rooted: true, fallback: [0.34, 3.6, 0.34, 0x1e1e22] },
  seesaw: { id: 'seesaw', model: 'p_seesaw', mass: 40, shape: 'box', friction: 0.9, float: 1.5, fallback: [4.0, 0.45, 0.36, 0xfad232] },
  labtable: { id: 'labtable', model: 'p_labtable', mass: 140, shape: 'box', fallback: [1.8, 0.9, 0.9, 0xc49660] },
  mat: { id: 'mat', model: 'p_mat', mass: 8, shape: 'box', friction: 1.0, float: 2, fallback: [2.0, 0.14, 1.0, 0x3a6ed2] },
  // ---- スキル用
  globe: { id: 'globe', model: 'p_globe', mass: 320, shape: 'ball', friction: 0.6, restitution: 0.25, fallback: [1.8, 1.8, 1.8, 0x3a7bd5] },
  jintai: { id: 'jintai', model: 'p_jintai', mass: 45, shape: 'box', fallback: [0.59, 1.6, 0.28, 0xc4504a] },
  cardbox: { id: 'cardbox', model: 'p_box', mass: 35, shape: 'box', hp: 40, fragile: true, fallback: [0.6, 0.5, 0.5, 0xb98d5a] },
  // ---- 採石場（quarry）
  tnt: { id: 'tnt', model: 'p_tnt', mass: 25, shape: 'box', hp: 6, explosive: { r: 5.5, dmg: 95 }, fallback: [0.8, 0.8, 0.8, 0xc8262b] },
  minecart: { id: 'minecart', model: 'p_minecart', mass: 400, shape: 'box', friction: 0.05, restitution: 0.1, fallback: [1.3, 1.1, 2.0, 0x6a6058] },
  // ---- 温泉街（onsen）
  taru: { id: 'taru', model: 'p_taru', mass: 140, shape: 'cylx', hp: 60, friction: 0.5, restitution: 0.15, float: 1.6, fallback: [1.13, 0.97, 0.99, 0xb48a5a] },
  oke: { id: 'oke', model: 'p_oke', mass: 2, shape: 'cyl', float: 3, fallback: [0.5, 0.35, 0.5, 0xc8a070] },
  // ---- 雪山のスキー場（ski）
  snowman: { id: 'snowman', model: 'p_snowman', mass: 70, shape: 'cyl', hp: 18, fallback: [1.0, 1.9, 1.0, 0xf4f8ff] },
  snowball: { id: 'snowball', model: 'p_snowball', mass: 260, shape: 'ball', friction: 0.7, restitution: 0.05, fallback: [1.6, 1.6, 1.6, 0xf4f8ff] },
  pylon: { id: 'pylon', model: 'p_pylon', mass: 400, shape: 'cyl', hp: 160, rooted: true, fallback: [2.8, 6.9, 0.5, 0x6a6a70] },
  pine: { id: 'pine', model: 'p_pine', mass: 450, shape: 'cyl', hp: 140, rooted: true, float: 1.4, fallback: [3.1, 5.5, 3.1, 0x2f5f3f] },
  // ---- USDCraft-10K の物体（部品と関節つき。src/game/usd/catalog.ts、public/models/usd/）
  // スキルでも使う物
  u_piano: usdProp('u_piano', 'piano', { mass: 230, hp: 120 }),
  u_cart: usdProp('u_cart', 'cart', { mass: 25, hp: 60, friction: 0.04, restitution: 0.2, gimmick: 'roller' }),
  u_forklift: usdProp('u_forklift', 'forklift', { mass: 1500, gimmick: 'driver' }),
  u_locker: usdProp('u_locker', 'locker', { mass: 70, hp: 90, gimmick: 'slapper' }),
  u_merrygo: usdProp('u_merrygo', 'merrygo', { mass: 460, shape: 'cyl', rooted: true, gimmick: 'spinner' }),
  u_gascyl: usdProp('u_gascyl', 'gascyl', { mass: 28, shape: 'cyl', hp: 12, explosive: { r: 4.8, dmg: 95 }, rocketBoom: true }),
  u_signal: usdProp('u_signal', 'signal', { mass: 110, shape: 'cyl', hp: 80, rooted: true, colR: 0.25 }),
  u_seesaw: usdProp('u_seesaw', 'seesaw', { mass: 60, rooted: true, gimmick: 'seesaw' }),
  u_robovac: usdProp('u_robovac', 'robovac', { mass: 4, shape: 'cyl', hp: 10 }),
  u_drone: usdProp('u_drone', 'drone', { mass: 1.5, hp: 6, idleSpin: { joint: 'spin', w: 40 } }),
  u_drums: usdProp('u_drums', 'drums', { mass: 85, hp: 50 }),
  u_dumbbell: usdProp('u_dumbbell', 'dumbbell', { mass: 16, restitution: 0.05 }),
  u_vending: usdProp('u_vending', 'vending', { mass: 260, hp: 110, spill: { prop: 'u_can', n: 7, coins: 3, scale: 2.2 } }),
  u_can: usdProp('u_can', 'can', { mass: 0.4, shape: 'cyl', restitution: 0.4 }),
  // 障害物と仕掛け
  u_hydrant: usdProp('u_hydrant', 'hydrant', { mass: 400, shape: 'cyl', hp: 30, gimmick: 'hydrant' }),
  u_schooldesk: usdProp('u_schooldesk', 'schooldesk', { mass: 18, hp: 30 }),
  u_tabletchair: usdProp('u_tabletchair', 'tabletchair', { mass: 9, hp: 20 }),
  u_lectern: usdProp('u_lectern', 'lectern', { mass: 30, hp: 30 }),
  u_trophy: usdProp('u_trophy', 'trophy', { mass: 6, hp: 6, coins: 2 }),
  u_bookcart: usdProp('u_bookcart', 'bookcart', { mass: 21, hp: 40, friction: 0.06, gimmick: 'roller' }),
  u_copier: usdProp('u_copier', 'copier', { mass: 60, hp: 50 }),
  u_wetsign: usdProp('u_wetsign', 'wetsign', { mass: 2, friction: 0.3 }),
  u_hoop: usdProp('u_hoop', 'hoop', { mass: 150, hp: 90, rooted: true, colR: 0.3 }),
  u_pingpong: usdProp('u_pingpong', 'pingpong', { mass: 110, hp: 70 }),
  u_slide: usdProp('u_slide', 'slide', { mass: 300, rooted: true }),
  u_swing: usdProp('u_swing', 'swing', { mass: 110, rooted: true }),
  u_springrider: usdProp('u_springrider', 'springrider', { mass: 40, rooted: true }),
  u_parktrash: usdProp('u_parktrash', 'parktrash', { mass: 36, shape: 'cyl', hp: 30 }),
  u_picnic: usdProp('u_picnic', 'picnic', { mass: 70, hp: 60 }),
  u_hvac: usdProp('u_hvac', 'hvac', { mass: 170, hp: 120, idleSpin: { joint: 'fan', w: 11 } }),
  u_turbine: usdProp('u_turbine', 'turbine', { mass: 90, shape: 'cyl', hp: 90, rooted: true, colR: 0.15, idleSpin: { joint: 'rotor', w: 7 } }),
  u_mixer: usdProp('u_mixer', 'mixer', { mass: 150, hp: 80, idleSpin: { joint: 'cradle_to_drum', w: 2.2 } }),
  u_wheelbarrow: usdProp('u_wheelbarrow', 'wheelbarrow', { mass: 26, hp: 40, friction: 0.12, gimmick: 'roller' }),
  u_oildrum: usdProp('u_oildrum', 'oildrum', { mass: 120, shape: 'cyl', hp: 25, explosive: { r: 4.6, dmg: 85 } }),
  u_barrier: usdProp('u_barrier', 'barrier', { mass: 28, hp: 25 }),
  u_jersey: usdProp('u_jersey', 'jersey', { mass: 1200 }),
  u_generator: usdProp('u_generator', 'generator', { mass: 80, hp: 40, explosive: { r: 3.6, dmg: 60 } }),
  u_toilet: usdProp('u_toilet', 'toilet', { mass: 75, hp: 60 }),
  u_skip: usdProp('u_skip', 'skip', { mass: 850 }),
  u_arcade: usdProp('u_arcade', 'arcade', { mass: 90, hp: 60, coins: 3 }),
  u_pinball: usdProp('u_pinball', 'pinball', { mass: 85, hp: 60, coins: 2 }),
  u_jukebox: usdProp('u_jukebox', 'jukebox', { mass: 70, hp: 50, coins: 1 }),
  u_phonebooth: usdProp('u_phonebooth', 'phonebooth', { mass: 335, hp: 140, coins: 1 }),
  u_mailbox: usdProp('u_mailbox', 'mailbox', { mass: 365, shape: 'cyl', hp: 120 }),
  u_cablereel: usdProp('u_cablereel', 'cablereel', { mass: 240, hp: 90 }),
  u_luggagecart: usdProp('u_luggagecart', 'luggagecart', { mass: 44, hp: 50, friction: 0.05, gimmick: 'roller' }),
  u_popcorn: usdProp('u_popcorn', 'popcorn', { mass: 19, hp: 15 }),
  u_cooler: usdProp('u_cooler', 'cooler', { mass: 11, hp: 20 }),
  u_excavator: usdProp('u_excavator', 'excavator', { mass: 3700 }),
  // 追加（親のスキル・アイテム用。仕掛けは付けない）
  u_fridge: usdProp('u_fridge', 'fridge', { mass: 67, hp: 90 }),
  u_washer: usdProp('u_washer', 'washer', { mass: 60, hp: 80 }),
  u_jackbox: usdProp('u_jackbox', 'jackbox', { mass: 0.8, hp: 6 }),
};

/** ステージで読み込む小道具のモデル名と、読み込めなかったときの代わりの箱（幅・高さ・奥行き・色）。 */
export const PROP_MODELS: [string, [number, number, number, number]][] = [...new Map(Object.values(PROPS).map((d) => [d.model, d.fallback] as const)).entries()];

export interface Prop extends Slotted {
  def: PropDef;
  body: RAPIER.RigidBody;
  col: RAPIER.Collider;
  hp: number;
  hot: number;
  prevSpeed: number;
  life: number;
  scale: number;
  alive: boolean;
  rooted: boolean;
  fuse: number;
  half: THREE.Vector3;
  mass: number;
  /** 敵に当たったときのダメージ倍率（スキルで出した物は高い） */
  dmgMul: number;
  dying: number;
  /** 敵に当たった回数（ボウリングのストライク判定用） */
  hits: number;
  /** 飛び回る残り秒数と向き（消火器） */
  rocket: number;
  rdir: V3;
  /** USDCraft の物体の部品と関節 */
  art?: ArtInst;
}

/** USDCraft の物体の部品 1 つ（部品ごとのまとめ描きの 1 枠）。 */
interface ArtPart extends Slotted {
  li: number;
}

/** USDCraft の物体 1 つぶんの、部品の描画と関節の状態。 */
export interface ArtInst {
  key: string;
  def: ArtDef;
  pose: ArtPose;
  parts: ArtPart[];
  /** 各部品の動き（静止姿勢の物体座標から） */
  mats: THREE.Matrix4[];
  /** 物体座標での箱の中心（剛体の中心に合わせる） */
  center: THREE.Vector3;
  /** 関節の動きの大きさ。0 に近ければ計算を止める */
  act: number;
  /** 回し続ける関節がある（風車など） */
  always: boolean;
  /** 前のフレームの速度（ぶつかった衝撃を見る） */
  lastV: V3;
  /** 車輪の関節と半径 */
  wheels: { j: number; r: number }[];
  /** 仕掛けの待ち時間・走る残り秒数・調べる間隔 */
  cd: number;
  drive: number;
  tick: number;
  /** 走っている間にすくい上げた敵（フォークリフト） */
  lifted: Set<unknown> | null;
}

/** 飛び散った部品の数の上限（重くしない） */
const PIECE_CAP = 60;

const WALL_W = 2.0;
const WALL_H = 1.85;
const WALL_T = 0.4;
const STORY = WALL_H * 2;
const SLAB_T = 0.3;
const m4 = new THREE.Matrix4();
const am = new THREE.Matrix4();
const an = new THREE.Matrix4();
const av = new THREE.Vector3();
const aw = new THREE.Vector3();
const aq = new THREE.Quaternion();
const qv = new THREE.Quaternion();
const pv = new THREE.Vector3();
const sv = new THREE.Vector3();

export interface SkyOpts {
  top: number;
  mid: number;
  fog: number;
  fogNear: number;
  fogFar: number;
  sun: number;
  sunI: number;
  hemiSky: number;
  hemiGround: number;
  hemiI: number;
}

/** 建物の壁の見た目。plain は窓の無い面、win は窓のある面（public/tex のファイル名）。 */
export interface WallStyle {
  plain: string | THREE.Texture;
  win: string | THREE.Texture;
  edge: number;
}

export interface BuildingOpts {
  /** 壁の見た目（registerWallStyle で登録した名前） */
  style?: string;
  /** 部品 1 つの幅と高さ (m) */
  w?: number;
  h?: number;
  /** 1 階あたりの部品の段数 */
  rowsPerFloor?: number;
  /** 床と屋根: all（各階）/ roof（屋根だけ）/ none（無し） */
  slabs?: 'all' | 'roof' | 'none';
  /** 1 階の入口。side の at 列目から width 列ぶん空ける */
  doors?: { side: 'front' | 'back' | 'left' | 'right'; at: number; width?: number }[];
  /** 何段目を窓のある面にするか */
  winRow?: (row: number) => boolean;
  hp?: number;
  /** 建物を建てる地面の高さ（丘の上など） */
  y0?: number;
}

export interface WallLineOpts {
  style?: string;
  w?: number;
  h?: number;
  /** 始点からの距離の範囲 [a, b] は壁を作らない（出入口） */
  openings?: [number, number][];
  win?: boolean;
  hp?: number;
}

/** 足元の状態。speed は歩く速さの倍率、grip は向きや速さを変える効き（小さいほど滑る）。 */
export interface Surface {
  speed: number;
  grip: number;
  water: boolean;
}

export class WorldMap {
  root = new THREE.Group();
  sun!: THREE.DirectionalLight;
  chunks: Chunk[] = [];
  loose: Chunk[] = [];
  props: Prop[] = [];
  nodes: SupportNode[] = [];
  nodeChunk: Chunk[] = [];
  buildingTotal = 0;
  buildingBroken = 0;
  stage: Stage;
  /** ノリコが立つ最初の位置 */
  start: { x: number; z: number };
  private sets = new Map<string, InstancedSet>();
  private wallStyles = new Map<string, WallStyle>([['school', { plain: 'wall_plain.jpg', win: 'wall_window.jpg', edge: 0xcfc6b4 }]]);
  private propGeo = new Map<string, { geo: THREE.BufferGeometry; half: THREE.Vector3 }>();
  private structBody!: RAPIER.RigidBody;
  private staticBody!: RAPIER.RigidBody;
  private supportDirty = false;
  private supportTimer = 0;
  private fragColor = new THREE.Color();
  private surf: Surface = { speed: 1, grip: 1, water: false };
  /** 建物が占める矩形（出現位置や小道具の配置で避ける） */
  blocked: { x0: number; x1: number; z0: number; z1: number }[] = [];
  /** USDCraft の物体: キー -> 部品ごとのまとめ描き */
  private artCache = new Map<string, { sets: InstancedSet[]; half: THREE.Vector3; center: THREE.Vector3 } | null>();
  /** 飛び散った部品の小道具の定義（キー#部品番号） */
  private pieceDefs = new Map<string, PropDef>();
  private pieceCount = 0;
  /** 消火栓の水柱 */
  private spouts: { x: number; y: number; z: number; t: number; tick: number; launched: number }[] = [];

  constructor(private g: Game) {
    g.engine.scene.add(this.root);
    this.structBody = g.physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    this.staticBody = g.physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    this.sets.set('slab', new InstancedSet(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ color: 0xbdb6a8 }), 900, this.root));
    this.sets.set('frag', new InstancedSet(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ color: 0xffffff }), 700, this.root));
    this.stage = createStage(g.stageDef.id, g, this);
    this.start = this.stage.start;
    this.buildSky(this.stage.sky);
    this.stage.build();
    try {
      placeUsd(this, g.stageDef.id, g.rng);
    } catch (err) {
      log('exception.usd.place', { stage: g.stageDef.id, message: String(err) }, { stack: (err as Error).stack ?? null });
    }
    for (const s of this.sets.values()) s.flush();
    log('world.build', { stage: g.stageDef.id, chunks: this.chunks.length, props: this.props.length, nodes: this.nodes.length }, { ok: true });
  }

  // ---------------------------------------------------------------- 空・地面
  private buildSky(o: SkyOpts): void {
    const scene = this.g.engine.scene;
    scene.background = new THREE.Color(o.mid);
    scene.fog = new THREE.Fog(o.fog, o.fogNear, o.fogFar);
    const geo = new THREE.SphereGeometry(300, 24, 12);
    const col = new Float32Array(geo.attributes.position.count * 3);
    const top = new THREE.Color(o.top);
    const mid = new THREE.Color(o.mid);
    const c = new THREE.Color();
    for (let i = 0; i < geo.attributes.position.count; i++) {
      const y = geo.attributes.position.getY(i) / 300;
      c.copy(mid).lerp(top, Math.max(0, Math.min(1, y * 1.4)));
      col.set([c.r, c.g, c.b], i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const sky = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
    sky.renderOrder = -10;
    this.root.add(sky);

    this.root.add(new THREE.HemisphereLight(o.hemiSky, o.hemiGround, o.hemiI));
    this.sun = new THREE.DirectionalLight(o.sun, o.sunI);
    this.sun.position.set(30, 50, 20);
    this.sun.castShadow = true;
    const q = this.g.engine.quality;
    this.sun.shadow.mapSize.set(q === 'high' ? 4096 : 2048, q === 'high' ? 4096 : 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -32; sc.right = 32; sc.top = 32; sc.bottom = -32; sc.near = 1; sc.far = 140;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.04;
    this.root.add(this.sun, this.sun.target);
  }

  /** 床の見た目を貼る（当たり判定は無い）。y を少しずつ上げると、重ねて貼れる。 */
  floor(mat: THREE.Material, w: number, d: number, x = 0, z = 0, y = 0, order = 0): THREE.Mesh {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, y, z);
    m.receiveShadow = true;
    m.renderOrder = order;
    this.root.add(m);
    return m;
  }

  /** 地面の当たり判定（全面）。 */
  groundCollider(friction = 0.9): void {
    const w = this.g.physics.world;
    const gc = w.createCollider(RAPIER.ColliderDesc.cuboid(ARENA + 40, 1, ARENA + 40).setTranslation(0, -1, 0).setCollisionGroups(groups(G.STATIC, G_ALL)).setFriction(friction), this.staticBody);
    this.g.physics.register(gc, { kind: 'static', ref: 'ground' });
  }

  /** 外周の見えない壁と、見える塀。 */
  bounds(mat: THREE.Material, height = 2.6): void {
    const w = this.g.physics.world;
    for (const [x, z, hx, hz] of [[0, ARENA + 1, ARENA + 2, 1], [0, -ARENA - 1, ARENA + 2, 1], [ARENA + 1, 0, 1, ARENA + 2], [-ARENA - 1, 0, 1, ARENA + 2]] as const) {
      const col = w.createCollider(RAPIER.ColliderDesc.cuboid(hx, 30, hz).setTranslation(x, 30, z).setCollisionGroups(groups(G.STATIC, G_ALL)), this.staticBody);
      this.g.physics.register(col, { kind: 'static', ref: 'bound' });
      const fence = new THREE.Mesh(new THREE.BoxGeometry(hx * 2, height, hz * 2), mat);
      fence.position.set(x, height / 2, z);
      fence.receiveShadow = true;
      this.root.add(fence);
    }
  }

  /** 遠くの町並み（見た目だけ）。 */
  skyline(pal: number[], hMin: number, hMax: number, count = 90, emissive = 0): void {
    const town = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ emissive, emissiveIntensity: emissive ? 0.25 : 0 }), count);
    const rng = this.g.rng;
    const tc = new THREE.Color();
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + rng() * 0.05;
      const d = ARENA + 14 + rng() * 40;
      const h = hMin + rng() * (hMax - hMin);
      m4.compose(pv.set(Math.cos(a) * d * 1.3, h / 2, Math.sin(a) * d * 1.3), qv.identity(), sv.set(6 + rng() * 8, h, 6 + rng() * 8));
      town.setMatrixAt(i, m4);
      town.setColorAt(i, tc.setHex(pal[Math.floor(rng() * pal.length)]));
    }
    this.root.add(town);
  }

  /** 動かない箱（当たり判定つき）。mat を渡すと見た目も作る。c は箱の中心。 */
  staticBox(c: V3, half: V3, yaw = 0, mat?: THREE.Material | THREE.Material[], friction = 0.8): THREE.Mesh | null {
    const rot = qv.setFromAxisAngle(pv.set(0, 1, 0), yaw);
    const col = this.g.physics.world.createCollider(
      RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z).setTranslation(c.x, c.y, c.z).setRotation({ x: rot.x, y: rot.y, z: rot.z, w: rot.w }).setCollisionGroups(groups(G.STATIC, G_ALL)).setFriction(friction),
      this.staticBody,
    );
    this.g.physics.register(col, { kind: 'static', ref: 'deco' });
    if (!mat) return null;
    const m = new THREE.Mesh(new THREE.BoxGeometry(half.x * 2, half.y * 2, half.z * 2), mat);
    m.position.set(c.x, c.y, c.z);
    m.rotation.y = yaw;
    m.castShadow = true;
    m.receiveShadow = true;
    this.root.add(m);
    return m;
  }

  /** 動かない円柱（当たり判定つき）。c は底面の中心。 */
  staticCyl(c: V3, r: number, h: number, mat?: THREE.Material, segs = 16): THREE.Mesh | null {
    const col = this.g.physics.world.createCollider(
      RAPIER.ColliderDesc.cylinder(h / 2, r).setTranslation(c.x, c.y + h / 2, c.z).setCollisionGroups(groups(G.STATIC, G_ALL)),
      this.staticBody,
    );
    this.g.physics.register(col, { kind: 'static', ref: 'deco' });
    if (!mat) return null;
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, segs), mat);
    m.position.set(c.x, c.y + h / 2, c.z);
    m.castShadow = true;
    m.receiveShadow = true;
    this.root.add(m);
    return m;
  }

  /** 当たり判定だけの固定物を足す（地面の形・柵など）。 */
  staticCollider(desc: RAPIER.ColliderDesc, ref = 'deco'): RAPIER.Collider {
    const col = this.g.physics.world.createCollider(desc, this.staticBody);
    this.g.physics.register(col, { kind: 'static', ref });
    return col;
  }

  /** 足元の状態（ステージごとの床・水）。返す物は使い回すので、すぐに読むこと。 */
  surface(x: number, z: number): Surface {
    const s = this.surf;
    s.speed = 1;
    s.grip = 1;
    s.water = false;
    this.stage.surface?.(x, z, s);
    return s;
  }

  /** 地面の高さ（高低差のあるステージだけが 0 以外を返す）。 */
  groundY(x: number, z: number): number {
    return this.stage.heightAt ? this.stage.heightAt(x, z) : 0;
  }

  /** 敵を出してよい場所か。 */
  spawnOk(x: number, z: number): boolean {
    return this.stage.spawnOk ? this.stage.spawnOk(x, z) : true;
  }

  // ---------------------------------------------------------------- 建物
  registerWallStyle(name: string, style: WallStyle): void {
    this.wallStyles.set(name, style);
  }

  private chunkSet(kind: ChunkKind, style: string): InstancedSet {
    if (kind === 'slab' || kind === 'frag') return this.sets.get(kind)!;
    const key = `${kind}:${style}`;
    let set = this.sets.get(key);
    if (!set) {
      const st = this.wallStyles.get(style) ?? this.wallStyles.get('school')!;
      const a = this.g.assets;
      const src = kind === 'wallwin' ? st.win : st.plain;
      const face = new THREE.MeshLambertMaterial({ map: typeof src === 'string' ? a.tex(src) : src });
      const edge = new THREE.MeshLambertMaterial({ color: st.edge });
      set = new InstancedSet(new THREE.BoxGeometry(1, 1, 1), [edge, edge, edge, edge, face, face], 1400, this.root);
      this.sets.set(key, set);
    }
    return set;
  }

  private addChunk(kind: ChunkKind, pos: THREE.Vector3, yaw: number, half: THREE.Vector3, hp: number, tough: number, grounded: boolean, span: number, style = 'school'): Chunk | undefined {
    const set = this.chunkSet(kind, style);
    if (set.full) return undefined;
    const rot = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    const ch: Chunk = {
      kind, pos, rot, half, hp, maxHp: hp, tough, state: 'fixed', col: null, body: null, node: this.nodes.length,
      hot: 0, age: 0, prevSpeed: 0, slot: -1, set: null, mass: half.x * half.y * half.z * 8 * 260, building: true,
    };
    const desc = RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z).setTranslation(pos.x, pos.y, pos.z).setRotation(rot).setCollisionGroups(groups(G.CHUNK, G_ALL)).setFriction(0.8);
    ch.col = this.g.physics.world.createCollider(desc, this.structBody);
    this.g.physics.register(ch.col, { kind: 'chunk', ref: ch });
    this.nodes.push({ alive: true, grounded, below: [], side: [], span });
    this.nodeChunk.push(ch);
    this.chunks.push(ch);
    set.add(ch);
    m4.compose(pos, rot, sv.set(half.x * 2, half.y * 2, half.z * 2));
    set.setMatrix(ch, m4);
    this.buildingTotal++;
    return ch;
  }

  /**
   * 箱形の建物を部品に分けて建てる。x0/z0 は角、cols/depth は部品の数、floors は階数。
   * 正面は +Z 側。入口は opts.doors で空ける。
   */
  addBuilding(x0: number, z0: number, cols: number, depth: number, floors: number, opts: BuildingOpts = {}): void {
    const W = opts.w ?? WALL_W;
    const H = opts.h ?? WALL_H;
    const rpf = opts.rowsPerFloor ?? 2;
    const style = opts.style ?? 'school';
    const hp = opts.hp ?? 70;
    const winRow = opts.winRow ?? ((r: number) => r % 2 === 1);
    const doors = opts.doors ?? [];
    const slabs = opts.slabs ?? 'all';
    const isDoor = (side: string, c: number, r: number) => r < rpf && doors.some((d) => d.side === side && c >= d.at && c < d.at + (d.width ?? 2));
    const len = cols * W;
    const dep = depth * W;
    const x1 = x0 + len;
    const z1 = z0 + dep;
    this.blocked.push({ x0: x0 - 1.5, x1: x1 + 1.5, z0: z0 - 1.5, z1: z1 + 1.5 });
    const rows = floors * rpf;
    const link = (a: Chunk | undefined, b: Chunk | undefined) => {
      if (!a || !b) return;
      this.nodes[a.node].side.push(b.node);
      this.nodes[b.node].side.push(a.node);
    };
    const stack = (lower: Chunk | undefined, upper: Chunk | undefined) => {
      if (lower && upper) this.nodes[upper.node].below.push(lower.node);
    };
    const kindOf = (r: number): ChunkKind => (winRow(r) ? 'wallwin' : 'wall');
    const front: (Chunk | undefined)[][] = [];
    const back: (Chunk | undefined)[][] = [];
    const left: (Chunk | undefined)[][] = [];
    const right: (Chunk | undefined)[][] = [];
    const sideLen = (dep - WALL_T * 2) / depth;
    const half = new THREE.Vector3(W / 2, H / 2, WALL_T / 2);
    const sideHalf = new THREE.Vector3(sideLen / 2, H / 2, WALL_T / 2);
    const y0 = opts.y0 ?? 0;
    for (let r = 0; r < rows; r++) {
      const y = y0 + r * H + H / 2;
      front.push([]); back.push([]); left.push([]); right.push([]);
      for (let c = 0; c < cols; c++) {
        const x = x0 + c * W + W / 2;
        front[r].push(isDoor('front', c, r) ? undefined : this.addChunk(kindOf(r), new THREE.Vector3(x, y, z1 - WALL_T / 2), 0, half.clone(), hp, 7, r === 0, 2, style));
        back[r].push(isDoor('back', c, r) ? undefined : this.addChunk(kindOf(r), new THREE.Vector3(x, y, z0 + WALL_T / 2), 0, half.clone(), hp, 7, r === 0, 2, style));
      }
      for (let d = 0; d < depth; d++) {
        const z = z0 + WALL_T + d * sideLen + sideLen / 2;
        left[r].push(isDoor('left', d, r) ? undefined : this.addChunk(kindOf(r), new THREE.Vector3(x0 + WALL_T / 2, y, z), Math.PI / 2, sideHalf.clone(), hp, 7, r === 0, 2, style));
        right[r].push(isDoor('right', d, r) ? undefined : this.addChunk(kindOf(r), new THREE.Vector3(x1 - WALL_T / 2, y, z), Math.PI / 2, sideHalf.clone(), hp, 7, r === 0, 2, style));
      }
      for (let c = 0; c < cols; c++) {
        if (c > 0) {
          link(front[r][c - 1], front[r][c]);
          link(back[r][c - 1], back[r][c]);
        }
        if (r > 0) {
          stack(front[r - 1][c], front[r][c]);
          stack(back[r - 1][c], back[r][c]);
        }
      }
      for (let d = 0; d < depth; d++) {
        if (d > 0) {
          link(left[r][d - 1], left[r][d]);
          link(right[r][d - 1], right[r][d]);
        }
        if (r > 0) {
          stack(left[r - 1][d], left[r][d]);
          stack(right[r - 1][d], right[r][d]);
        }
      }
      // 角のつなぎ
      link(back[r][0], left[r][0]);
      link(back[r][cols - 1], right[r][0]);
      link(front[r][0], left[r][depth - 1]);
      link(front[r][cols - 1], right[r][depth - 1]);
    }
    if (slabs === 'none') return;
    // 床と屋根
    const sx = (len - WALL_T * 2) / cols;
    const sz = (dep - WALL_T * 2) / depth;
    const storyH = H * rpf;
    for (let f = 0; f < floors; f++) {
      if (slabs === 'roof' && f < floors - 1) continue;
      const y = y0 + (f + 1) * storyH - SLAB_T / 2;
      const top = f * rpf + rpf - 1;
      const grid: (Chunk | undefined)[][] = [];
      for (let c = 0; c < cols; c++) {
        grid.push([]);
        for (let d = 0; d < depth; d++) {
          const s = this.addChunk('slab', new THREE.Vector3(x0 + WALL_T + c * sx + sx / 2, y, z0 + WALL_T + d * sz + sz / 2), 0, new THREE.Vector3(sx / 2, SLAB_T / 2, sz / 2), 45, 6, false, 3);
          grid[c].push(s);
          if (c > 0) link(grid[c - 1][d], s);
          if (d > 0) link(grid[c][d - 1], s);
          if (d === 0) stack(back[top][c], s);
          if (d === depth - 1) stack(front[top][c], s);
          if (c === 0) stack(left[top][d], s);
          if (c === cols - 1) stack(right[top][d], s);
        }
      }
    }
  }

  /** まっすぐな壁（教室の仕切りなど）。ax,az から bx,bz まで。 */
  addWallLine(ax: number, az: number, bx: number, bz: number, rows: number, opts: WallLineOpts = {}): Chunk[] {
    const dx = bx - ax;
    const dz = bz - az;
    const len = Math.hypot(dx, dz);
    const n = Math.max(1, Math.round(len / (opts.w ?? WALL_W)));
    const seg = len / n;
    const H = opts.h ?? WALL_H;
    const ux = dx / len;
    const uz = dz / len;
    const yaw = Math.atan2(-dz, dx);
    const grid: (Chunk | undefined)[][] = [];
    const out: Chunk[] = [];
    for (let r = 0; r < rows; r++) {
      grid.push([]);
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) * seg;
        if (opts.openings?.some(([a, b]) => t > a && t < b)) {
          grid[r].push(undefined);
          continue;
        }
        const kind: ChunkKind = opts.win ? 'wallwin' : r % 2 === 1 ? 'wallwin' : 'wall';
        const ch = this.addChunk(kind, new THREE.Vector3(ax + ux * t, r * H + H / 2, az + uz * t), yaw, new THREE.Vector3(seg / 2, H / 2, WALL_T / 2), opts.hp ?? 60, 6, r === 0, 2, opts.style ?? 'school');
        grid[r].push(ch);
        if (ch) out.push(ch);
        if (i > 0 && ch && grid[r][i - 1]) {
          const a = grid[r][i - 1]!;
          this.nodes[a.node].side.push(ch.node);
          this.nodes[ch.node].side.push(a.node);
        }
        if (r > 0 && ch && grid[r - 1][i]) this.nodes[ch.node].below.push(grid[r - 1][i]!.node);
      }
    }
    return out;
  }

  // ---------------------------------------------------------------- 小道具
  private propSet(def: PropDef): { set: InstancedSet; half: THREE.Vector3 } {
    let info = this.propGeo.get(def.model);
    if (!info && def.part) {
      // 飛び散った部品: 部品の形を、部品の箱の中心へ寄せて使う
      const l = ART[def.part.key]?.links[def.part.link];
      const pg = l ? this.g.assets.parts.get('usd/' + def.part.key)?.get(l.n) : undefined;
      if (l && pg) {
        const c = linkCenter(l, new THREE.Vector3());
        const geo = pg.clone();
        geo.translate(-c.x, -c.y, -c.z);
        const half = new THREE.Vector3(Math.max(0.03, (l.max[0] - l.min[0]) / 2), Math.max(0.03, (l.max[1] - l.min[1]) / 2), Math.max(0.03, (l.max[2] - l.min[2]) / 2));
        info = { geo, half };
        this.propGeo.set(def.model, info);
      }
    }
    if (!info) {
      const mm = this.g.assets.merged.get(def.model);
      let geo: THREE.BufferGeometry;
      let half: THREE.Vector3;
      if (mm) {
        geo = mm.geo.clone();
        const cx = (mm.min.x + mm.max.x) / 2;
        const cy = (mm.min.y + mm.max.y) / 2;
        const cz = (mm.min.z + mm.max.z) / 2;
        geo.translate(-cx, -cy, -cz);
        half = mm.size.clone().multiplyScalar(0.5);
      } else {
        const [w, h, d, color] = def.fallback;
        geo = new THREE.BoxGeometry(w, h, d).toNonIndexed();
        const c = new THREE.Color(color);
        const arr = new Float32Array(geo.attributes.position.count * 3);
        for (let i = 0; i < arr.length / 3; i++) arr.set([c.r, c.g, c.b], i * 3);
        geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
        half = new THREE.Vector3(w / 2, h / 2, d / 2);
      }
      info = { geo, half };
      this.propGeo.set(def.model, info);
    }
    let set = this.sets.get('prop:' + def.model);
    if (!set) {
      set = new InstancedSet(info.geo, new THREE.MeshLambertMaterial({ vertexColors: true }), 220, this.root);
      this.sets.set('prop:' + def.model, set);
    }
    return { set, half: info.half };
  }

  /** USDCraft の物体の、部品ごとのまとめ描きを用意する。部品の形が読めていなければ null（ふつうの小道具として描く）。 */
  private artSets(def: PropDef): { sets: InstancedSet[]; half: THREE.Vector3; center: THREE.Vector3 } | null {
    const key = def.art!;
    if (this.artCache.has(key)) return this.artCache.get(key)!;
    const a = ART[key];
    const parts = this.g.assets.parts.get(def.model);
    let out: { sets: InstancedSet[]; half: THREE.Vector3; center: THREE.Vector3 } | null = null;
    if (a && parts && a.links.every((l) => parts.has(l.n))) {
      const center = new THREE.Vector3((a.min[0] + a.max[0]) / 2, (a.min[1] + a.max[1]) / 2, (a.min[2] + a.max[2]) / 2);
      const half = new THREE.Vector3((a.max[0] - a.min[0]) / 2, (a.max[1] - a.min[1]) / 2, (a.max[2] - a.min[2]) / 2);
      const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
      const sets = a.links.map((l) => {
        const geo = parts.get(l.n)!.clone();
        geo.translate(-center.x, -center.y, -center.z);
        const s = new InstancedSet(geo, mat, 120, this.root);
        this.sets.set(`art:${key}:${l.n}`, s);
        return s;
      });
      out = { sets, half, center };
    }
    this.artCache.set(key, out);
    return out;
  }

  /** 飛び散った部品の小道具の定義。 */
  private pieceDef(key: string, li: number): PropDef {
    const id = `${key}#${li}`;
    let d = this.pieceDefs.get(id);
    if (!d) {
      const l = ART[key].links[li];
      d = {
        id, model: `usdpart:${key}:${li}`, mass: Math.min(400, Math.max(0.3, l.m)), shape: 'box', part: { key, link: li },
        friction: 0.6, restitution: 0.2, fallback: [l.max[0] - l.min[0], l.max[1] - l.min[1], l.max[2] - l.min[2], 0x8a8a8a],
      };
      this.pieceDefs.set(id, d);
    }
    return d;
  }

  /**
   * 小道具を置く。pos は底面の中心（centered なら物の中心）。id は PROPS の名前か、定義そのもの。
   * q を渡すと、yaw の代わりにその向きで置く。
   */
  spawnProp(id: string | PropDef, pos: V3, yaw = 0, opts: { vel?: V3; life?: number; scale?: number; sleep?: boolean; dmgMul?: number; hot?: number; spin?: boolean; q?: { x: number; y: number; z: number; w: number }; centered?: boolean } = {}): Prop | null {
    const def = typeof id === 'string' ? PROPS[id] : id;
    const art = def.art ? this.artSets(def) : null;
    const { set, half } = art ? { set: art.sets[0], half: art.half } : this.propSet(def);
    if (set.full) return null;
    if (art && art.sets.some((s) => s.full)) return null;
    if (def.part && this.pieceCount >= PIECE_CAP) return null;
    const scale = opts.scale ?? 1;
    const h = half.clone().multiplyScalar(scale);
    const w = this.g.physics.world;
    const rot = opts.q ? qv.set(opts.q.x, opts.q.y, opts.q.z, opts.q.w) : qv.setFromAxisAngle(pv.set(0, 1, 0), yaw);
    const bd = (def.rooted ? RAPIER.RigidBodyDesc.fixed() : RAPIER.RigidBodyDesc.dynamic())
      .setTranslation(pos.x, opts.centered ? pos.y : pos.y + h.y, pos.z)
      .setRotation({ x: rot.x, y: rot.y, z: rot.z, w: rot.w })
      .setLinearDamping(0.05)
      .setAngularDamping(0.3);
    const body = w.createRigidBody(bd);
    let cd: RAPIER.ColliderDesc;
    if (def.shape === 'ball') cd = RAPIER.ColliderDesc.ball(h.y);
    else if (def.shape === 'cyl') cd = RAPIER.ColliderDesc.cylinder(h.y, Math.max(h.x, h.z) * (def.colR ?? (def.rooted && !def.art ? 0.22 : 0.92)));
    else if (def.shape === 'cylx') {
      // 円柱の軸（Y）を X へ倒す
      const q = qv.setFromAxisAngle(pv.set(0, 0, 1), Math.PI / 2);
      cd = RAPIER.ColliderDesc.cylinder(h.x * 0.97, Math.max(h.y, h.z) * 0.97).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
    }
    else cd = RAPIER.ColliderDesc.cuboid(h.x * 0.97, h.y * 0.97, h.z * 0.97);
    const mass = def.mass * scale * scale * scale;
    cd.setMass(mass).setFriction(def.friction ?? 0.7).setRestitution(def.restitution ?? 0.15).setCollisionGroups(groups(G.PROP, G_ALL));
    const col = w.createCollider(cd, body);
    const p: Prop = {
      def, body, col, hp: def.hp ?? Infinity, hot: opts.hot ?? 0, prevSpeed: 0, life: opts.life ?? Infinity, scale, alive: true,
      rooted: !!def.rooted, fuse: -1, half: h, slot: -1, set: null, mass, dmgMul: opts.dmgMul ?? 1, dying: -1, hits: 0, rocket: 0, rdir: { x: 0, y: 0, z: 0 },
    };
    this.g.physics.register(col, { kind: 'prop', ref: p });
    if (art) {
      const a = ART[def.art!];
      const pose = makePose(a);
      const inst: ArtInst = {
        key: def.art!, def: a, pose, parts: art.sets.map((_, li) => ({ li, slot: -1, set: null })), mats: a.links.map(() => new THREE.Matrix4()),
        center: art.center, act: 1, always: false, lastV: { x: 0, y: 0, z: 0 }, wheels: [], cd: 0, drive: 0, tick: Math.random() * 0.1, lifted: null,
      };
      inst.parts.forEach((pt, i) => art.sets[i].add(pt));
      a.joints.forEach((_, j) => {
        if (isWheel(a, j)) inst.wheels.push({ j, r: wheelRadius(a, j) * scale });
      });
      if (def.idleSpin) {
        for (const j of findJoints(a, def.idleSpin.joint)) {
          if (a.joints[j].t !== 'continuous') continue;
          pose.target[j] = def.idleSpin.w * (0.8 + Math.random() * 0.4);
          pose.v[j] = pose.target[j];
          inst.always = true;
        }
      }
      if (def.gimmick === 'roller') p.dmgMul = Math.max(p.dmgMul, 2.2);
      p.art = inst;
    } else set.add(p);
    if (def.part) this.pieceCount++;
    this.props.push(p);
    if (opts.vel) body.setLinvel(opts.vel, true);
    if (opts.spin) body.setAngvel({ x: (Math.random() - 0.5) * 8, y: (Math.random() - 0.5) * 8, z: (Math.random() - 0.5) * 8 }, true);
    if (p.hot > 0) col.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
    this.syncProp(p);
    if (opts.sleep) body.sleep();
    return p;
  }

  private syncProp(p: Prop): void {
    const t = p.body.translation();
    const r = p.body.rotation();
    let s = p.scale;
    if (p.dying >= 0) s *= Math.max(0.01, p.dying / 0.3);
    m4.compose(pv.set(t.x, t.y, t.z), qv.set(r.x, r.y, r.z, r.w), sv.set(s, s, s));
    const a = p.art;
    if (a) {
      // 剛体の中心 = 物体の箱の中心。部品は「剛体 × 中心へのずれ × 関節の動き」で置く
      m4.multiply(am.makeTranslation(-a.center.x, -a.center.y, -a.center.z));
      for (const pt of a.parts) {
        am.multiplyMatrices(m4, a.mats[pt.li]);
        am.multiply(an.makeTranslation(a.center.x, a.center.y, a.center.z));
        pt.set!.setMatrix(pt, am);
      }
      return;
    }
    p.set!.setMatrix(p, m4);
  }

  /** 小道具を置いてよい場所か（場外・建物・スタート地点の近く・ステージが禁じる場所を除く）。 */
  free(x: number, z: number, margin = 2): boolean {
    if (Math.abs(x) > ARENA - 4 || Math.abs(z) > ARENA - 4) return false;
    if (Math.hypot(x - this.start.x, z - this.start.z) < 9) return false; // スタート地点のまわりは空ける
    for (const b of this.blocked) if (x > b.x0 - margin && x < b.x1 + margin && z > b.z0 - margin && z < b.z1 + margin) return false;
    return this.spawnOk(x, z);
  }

  /** (cx, cz) を中心に minR..maxR の範囲で、置ける場所を探す。 */
  pickSpot(minR: number, maxR: number, margin = 3, cx = 0, cz = -8): { x: number; z: number } {
    const rng = this.g.rng;
    for (let i = 0; i < 40; i++) {
      const a = rng() * Math.PI * 2;
      const r = minR + rng() * (maxR - minR);
      const x = cx + Math.cos(a) * r;
      const z = cz + Math.sin(a) * r;
      if (this.free(x, z, margin)) return { x, z };
    }
    return { x: 30, z: 30 };
  }

  // ---------------------------------------------------------------- 壊す
  /**
   * 建物の部品にダメージを与える。impulse は吹き飛ばす向きと強さ（速度変化 m/s）。
   * 戻り値: 壊れたら true。
   */
  hitChunk(ch: Chunk, dmg: number, impulse: V3, point?: V3): boolean {
    const g = this.g;
    if (ch.state === 'gone') return false;
    if (ch.state === 'loose') {
      if (ch.body) {
        const m = ch.mass;
        ch.body.applyImpulse({ x: impulse.x * m * 0.6, y: impulse.y * m * 0.6, z: impulse.z * m * 0.6 }, true);
        this.heat(ch, 3);
      }
      if (dmg > ch.maxHp * 0.8 && ch.kind !== 'frag') this.shatterChunk(ch, impulse);
      return false;
    }
    const at = point ?? ch.pos;
    if (dmg < ch.tough) {
      g.fx.spawn({ pos: at, life: 0.1, size: 0.5, size2: 1.1, color: 0xffffff, shape: 2 });
      g.audio.clank(0.4);
      return false;
    }
    ch.hp -= dmg;
    g.fx.shards(at, 0xc9c0ae, 3, 4, 0.22);
    if (ch.hp > 0) {
      g.audio.clank(0.9);
      g.fx.dust(at, 0.7, 0xd8d0c0, 2);
      return false;
    }
    const overkill = -ch.hp;
    this.detach(ch);
    if (overkill > ch.maxHp * 0.5 || ch.kind === 'slab') this.shatterChunk(ch, impulse);
    else this.makeLoose(ch, impulse);
    g.audio.crumble(0.8);
    g.fx.dust(ch.pos, 1.6, 0xd8d0c0, 4);
    return true;
  }

  /** 固定されている部品を建物から外す（支えの計算からも外す）。 */
  private detach(ch: Chunk): void {
    if (ch.col) {
      this.g.physics.unregister(ch.col);
      this.g.physics.world.removeCollider(ch.col, true);
      ch.col = null;
    }
    if (ch.node >= 0) this.nodes[ch.node].alive = false;
    if (ch.building && ch.state === 'fixed') {
      this.buildingBroken++;
      this.g.onChunkBroken();
    }
    this.supportDirty = true;
  }

  private makeLoose(ch: Chunk, impulse?: V3): void {
    const w = this.g.physics.world;
    const body = w.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(ch.pos.x, ch.pos.y, ch.pos.z).setRotation({ x: ch.rot.x, y: ch.rot.y, z: ch.rot.z, w: ch.rot.w }).setLinearDamping(0.02).setAngularDamping(0.2),
    );
    const col = w.createCollider(
      RAPIER.ColliderDesc.cuboid(ch.half.x * 0.96, ch.half.y * 0.96, ch.half.z * 0.96).setMass(ch.mass).setFriction(0.8).setRestitution(0.05).setCollisionGroups(groups(G.DEBRIS, G_ALL)).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
      body,
    );
    ch.body = body;
    ch.col = col;
    ch.state = 'loose';
    ch.hot = 4;
    ch.age = 0;
    this.g.physics.register(col, { kind: 'debris', ref: ch });
    if (impulse) {
      body.setLinvel({ x: impulse.x, y: impulse.y, z: impulse.z }, true);
      body.setAngvel({ x: (Math.random() - 0.5) * 5, y: (Math.random() - 0.5) * 5, z: (Math.random() - 0.5) * 5 }, true);
    }
    this.loose.push(ch);
    this.trimDebris();
  }

  /** 部品を小さな破片に砕く。 */
  private shatterChunk(ch: Chunk, impulse: V3): void {
    const g = this.g;
    const n = ch.kind === 'slab' ? 2 : 3;
    const frag = this.sets.get('frag')!;
    const base = ch.body ? ch.body.translation() : ch.pos;
    const rot = ch.body ? ch.body.rotation() : ch.rot;
    for (let i = 0; i < n; i++) {
      if (frag.full) break;
      const k = 0.36 + Math.random() * 0.2;
      const half = new THREE.Vector3(Math.max(0.14, ch.half.x * k), Math.max(0.12, ch.half.y * k), Math.max(0.12, ch.half.z * (0.6 + Math.random() * 0.4)));
      const off = new THREE.Vector3((Math.random() - 0.5) * ch.half.x * 1.2, (Math.random() - 0.5) * ch.half.y * 1.2, 0).applyQuaternion(qv.set(rot.x, rot.y, rot.z, rot.w));
      const f: Chunk = {
        kind: 'frag', pos: new THREE.Vector3(base.x + off.x, base.y + off.y, base.z + off.z), rot: new THREE.Quaternion(rot.x, rot.y, rot.z, rot.w), half,
        hp: 1, maxHp: 1, tough: 0, state: 'fixed', col: null, body: null, node: -1, hot: 0, age: 0, prevSpeed: 0, slot: -1, set: null,
        mass: half.x * half.y * half.z * 8 * 260, building: false,
      };
      frag.add(f);
      this.fragColor.setHSL(0.1, 0.12, 0.62 + Math.random() * 0.18);
      frag.setColor(f, this.fragColor);
      const spread = 2.5;
      this.makeLoose(f, { x: impulse.x * (0.5 + Math.random() * 0.7) + (Math.random() - 0.5) * spread, y: impulse.y * (0.5 + Math.random() * 0.7) + Math.random() * 3, z: impulse.z * (0.5 + Math.random() * 0.7) + (Math.random() - 0.5) * spread });
    }
    g.fx.shards(ch.pos, 0xc9c0ae, 6, 7, 0.35);
    this.removeChunk(ch);
  }

  private removeChunk(ch: Chunk): void {
    if (ch.state === 'gone') return;
    if (ch.col) this.g.physics.unregister(ch.col);
    if (ch.body) this.g.physics.world.removeRigidBody(ch.body);
    else if (ch.col) this.g.physics.world.removeCollider(ch.col, true);
    ch.body = null;
    ch.col = null;
    if (ch.set) ch.set.remove(ch);
    ch.state = 'gone';
    const i = this.loose.indexOf(ch);
    if (i >= 0) this.loose.splice(i, 1);
  }

  private trimDebris(): void {
    while (this.loose.length > TUNE.maxDebris) {
      const old = this.loose[0];
      this.g.fx.dust(old.body ? old.body.translation() : old.pos, 0.8, 0xd8d0c0, 2);
      this.removeChunk(old);
    }
  }

  /** 当たるとダメージになる状態にする（衝突の通知を受け取るようにする）。 */
  heat(o: Chunk | Prop, sec: number): void {
    if (o.hot <= 0 && o.col) o.col.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
    o.hot = Math.max(o.hot, sec);
  }

  /**
   * 小道具を叩く。dv は与える速度変化（重い物ほど動きにくいよう、呼ぶ側で調整済みの値）。
   */
  hitProp(p: Prop, dmg: number, dv: V3, point?: V3): void {
    if (!p.alive) return;
    const g = this.g;
    if (p.def.drum) {
      this.stage.onDrum?.(p);
      return;
    }
    if (p.art) this.artHit(p, dmg, dv, point);
    if (p.rooted) {
      p.hp -= dmg;
      g.fx.shards(point ?? p.body.translation(), 0x6b4a2a, 2, 3, 0.2);
      if (p.hp <= 0) {
        p.rooted = false;
        p.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
        p.body.setLinvel({ x: dv.x * 0.4, y: 1, z: dv.z * 0.4 }, true);
        p.body.setAngvel({ x: dv.z * 0.3, y: 0, z: -dv.x * 0.3 }, true);
        this.heat(p, 5);
        g.audio.crumble(0.6);
        p.life = 20;
      } else g.audio.thud(0.5);
      return;
    }
    const m = p.mass;
    if (point) p.body.applyImpulseAtPoint({ x: dv.x * m, y: dv.y * m, z: dv.z * m }, point, true);
    else p.body.applyImpulse({ x: dv.x * m, y: dv.y * m, z: dv.z * m }, true);
    this.heat(p, 3.5);
    if (p.hp !== Infinity) {
      p.hp -= dmg;
      if (p.hp <= 0) this.breakProp(p);
    }
  }

  private breakProp(p: Prop): void {
    const g = this.g;
    if (p.def.rocketBoom && p.def.explosive) {
      // ガスボンベ: 栓が飛んでしばらく飛び回り、最後に爆発する
      if (p.rocket <= 0 && p.fuse < 0) {
        const a = Math.random() * Math.PI * 2;
        p.rdir = { x: Math.cos(a), y: 0.25, z: Math.sin(a) };
        p.rocket = 1.8;
        p.fuse = 1.8;
        p.dmgMul = Math.max(p.dmgMul, 2.5);
        p.hp = Infinity;
        this.heat(p, 2);
        g.audio.whoosh();
        log('usd.gascyl', { id: p.def.id }, { fuse: 1.8 });
      }
    } else if (p.def.explosive) {
      if (p.fuse < 0) p.fuse = 0.12 + Math.random() * 0.28;
    } else if (p.def.gimmick === 'hydrant') {
      // 消火栓: 壊すと水柱が噴き出す
      const t = p.body.translation();
      const y = this.groundY(t.x, t.z);
      this.spouts.push({ x: t.x, y, z: t.z, t: 5, tick: 0, launched: 0 });
      g.audio.splash(2);
      g.fx.ring({ x: t.x, y: y + 0.1, z: t.z }, 0.3, 2.4, ZONE.ally, 0.4);
      this.shatter(p, { x: 0, y: 6, z: 0 });
      log('usd.hydrant', { x: Math.round(t.x), z: Math.round(t.z) }, { sec: 5 });
    } else if (p.def.rocket) {
      // 消火器: しばらく勝手に飛び回る
      if (p.rocket <= 0) {
        const a = Math.random() * Math.PI * 2;
        p.rdir = { x: Math.cos(a), y: 0.18, z: Math.sin(a) };
        p.rocket = 2.6;
        p.dmgMul = Math.max(p.dmgMul, 2.5);
        p.hp = Infinity;
        p.life = 6;
        g.audio.whoosh();
        log('world.rocket', { id: p.def.id });
      }
    } else if (p.def.burst === 'water') {
      // 給水塔: 中の水があふれ出て、まわりの敵をぬらして押し流す
      const t = p.body.translation();
      const at = { x: t.x, y: 0.5, z: t.z };
      for (let i = 0; i < 40; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = 3 + Math.random() * 8;
        g.fx.spawn({ pos: { x: t.x, y: t.y, z: t.z }, vel: { x: Math.cos(a) * sp, y: 2 + Math.random() * 5, z: Math.sin(a) * sp }, grav: -14, life: 1, size: 0.5, size2: 0.2, color: 0xbfe8ff, shape: 0, alpha: 0.9 });
      }
      g.fx.ring(at, 0.5, 8, ZONE.ally, 0.5);
      g.audio.splash(2.5);
      g.enemies.inRadius(at, 8, (e, d) => {
        g.enemies.wetIt(e, 10);
        const inv = 1 / Math.max(0.5, d);
        g.enemies.push(e, { x: (e.x - at.x) * inv * 9, y: 2, z: (e.z - at.z) * inv * 9 }, true);
      });
      this.removeProp(p);
      log('world.burst', { id: p.def.id });
    } else if (p.def.spill) {
      // ガチャガチャ: 中身が飛び散る
      const t = p.body.translation();
      const sp = p.def.spill;
      for (let i = 0; i < sp.n; i++) {
        const a = Math.random() * Math.PI * 2;
        this.spawnProp(sp.prop, { x: t.x + Math.cos(a) * 0.3, y: t.y + 0.3, z: t.z + Math.sin(a) * 0.3 }, 0, { vel: { x: Math.cos(a) * (3 + Math.random() * 4), y: 4 + Math.random() * 4, z: Math.sin(a) * (3 + Math.random() * 4) }, life: 10, hot: 3, dmgMul: 3, spin: true, scale: sp.scale });
      }
      if (sp.coins > 0) g.pickups.dropItem('coin', { x: t.x, y: t.y, z: t.z }, sp.coins);
      g.fx.shards(t, 0xd62c28, 6, 5, 0.25);
      g.fx.sparkle(t, 0xffe066, 8, 0.8);
      g.audio.coin();
      if (p.art) this.shatter(p);
      else this.removeProp(p);
      log('world.spill', { id: p.def.id }, { n: sp.n });
    } else if (p.def.fragile || p.art) {
      this.shatter(p);
    }
  }

  removeProp(p: Prop): void {
    if (!p.alive) return;
    p.alive = false;
    this.g.physics.unregister(p.col);
    this.g.physics.world.removeRigidBody(p.body);
    if (p.set) p.set.remove(p);
    if (p.art) for (const pt of p.art.parts) pt.set?.remove(pt);
    if (p.def.part) this.pieceCount--;
    const i = this.props.indexOf(p);
    if (i >= 0) this.props.splice(i, 1);
  }

  // ---------------------------------------------------------------- USDCraft の物体（部品と関節）
  /**
   * 小道具を壊す。USDCraft の物体なら部品ごとに分かれて飛び散る（部品は当たると敵にダメージ）。
   * それ以外の小道具は、煙と破片を出して消える。dv は部品に足す速度。
   */
  shatter(p: Prop, dv: V3 = { x: 0, y: 0, z: 0 }): void {
    if (!p.alive) return;
    const g = this.g;
    const t = p.body.translation();
    const a = p.art;
    if (!a) {
      g.fx.poof(t, 0.7, 0xc9a26b);
      g.fx.shards(t, 0xb98d5a, 4, 4, 0.25);
      this.removeProp(p);
      return;
    }
    linkMatrices(a.def, a.pose, a.mats);
    const r = p.body.rotation();
    const v = p.body.linvel();
    const s = p.scale;
    m4.compose(pv.set(t.x, t.y, t.z), qv.set(r.x, r.y, r.z, r.w), sv.set(s, s, s));
    m4.multiply(am.makeTranslation(-a.center.x, -a.center.y, -a.center.z));
    const vol = (i: number) => {
      const l = a.def.links[i];
      return (l.max[0] - l.min[0] + 0.02) * (l.max[1] - l.min[1] + 0.02) * (l.max[2] - l.min[2] + 0.02);
    };
    const order = a.def.links.map((_, i) => i).sort((x, y) => vol(y) - vol(x));
    const room = Math.min(10, PIECE_CAP - this.pieceCount);
    let n = 0;
    for (const li of order.slice(0, Math.max(0, room))) {
      am.multiplyMatrices(m4, a.mats[li]);
      linkCenter(a.def.links[li], av).applyMatrix4(am);
      am.decompose(aw, aq, sv);
      const ox = av.x - t.x;
      const oy = av.y - t.y;
      const oz = av.z - t.z;
      const od = Math.hypot(ox, oy, oz) || 1;
      const k = 2 + Math.random() * 3;
      const piece = this.spawnProp(this.pieceDef(a.key, li), { x: av.x, y: av.y, z: av.z }, 0, {
        q: { x: aq.x, y: aq.y, z: aq.z, w: aq.w }, centered: true, scale: s, spin: true, life: 6 + Math.random() * 3, hot: 2.5, dmgMul: 1.4,
        vel: { x: v.x + (ox / od) * k + dv.x * 0.6, y: v.y + (oy / od) * k * 0.5 + 2 + Math.random() * 3 + dv.y * 0.6, z: v.z + (oz / od) * k + dv.z * 0.6 },
      });
      if (piece) n++;
    }
    this.removeProp(p);
    if (p.def.coins) {
      g.pickups.dropItem('coin', { x: t.x, y: t.y, z: t.z }, p.def.coins);
      g.audio.coin();
    }
    g.fx.dust({ x: t.x, y: t.y, z: t.z }, 1.2, 0xd8d0c0, 4);
    g.audio.crumble(0.7);
    log('usd.shatter', { id: p.def.id }, { pieces: n, live: this.pieceCount });
  }

  /** 名前（関節の名前か、動かす部品の名前の一部）に合う関節の番号。USDCraft の物体でなければ空。 */
  artJoints(p: Prop, name: string): number[] {
    return p.art ? findJoints(p.art.def, name) : [];
  }

  /**
   * 関節を目標へ動かす。扉・引き出し・昇降は位置（ラジアンかメートル）、回し続ける関節は回る速さ（rad/s）。
   * target に null を渡すと、目標を外して静止位置へ戻す。例: driveJoint(p, 'fork_lift', 1.0)、driveJoint(p, 'hub', 6)。
   */
  driveJoint(p: Prop, name: string, target: number | null): void {
    const a = p.art;
    if (!a) return;
    for (const j of findJoints(a.def, name)) a.pose.target[j] = target ?? NaN;
    a.act = Math.max(a.act, 1);
  }

  /** 関節に速さを足す（扉をはじく、回転台を回す）。 */
  kickJoint(p: Prop, name: string, dv: number): void {
    const a = p.art;
    if (!a) return;
    for (const j of findJoints(a.def, name)) a.pose.v[j] += dv;
    a.act = Math.max(a.act, 1);
  }

  /** 関節の今の値（最初に合った関節）。無ければ 0。 */
  jointValue(p: Prop, name: string): number {
    const a = p.art;
    if (!a) return 0;
    const j = findJoints(a.def, name)[0];
    return j === undefined ? 0 : a.pose.q[j];
  }

  /** 部品の今の中心（ワールド座標）。名前は部品名の一部。無ければ null。 */
  linkWorld(p: Prop, name: string, out = new THREE.Vector3()): THREE.Vector3 | null {
    const a = p.art;
    if (!a) return null;
    const li = a.def.links.findIndex((l) => l.n.includes(name));
    if (li < 0) return null;
    this.artBase(p, am);
    am.multiply(a.mats[li]);
    return linkCenter(a.def.links[li], out).applyMatrix4(am);
  }

  /** 物体座標 -> ワールド座標の変換（剛体の位置と向き × 中心へのずれ）。 */
  private artBase(p: Prop, out: THREE.Matrix4): THREE.Matrix4 {
    const t = p.body.translation();
    const r = p.body.rotation();
    const s = p.scale;
    out.compose(aw.set(t.x, t.y, t.z), aq.set(r.x, r.y, r.z, r.w), sv.set(s, s, s));
    return out.multiply(an.makeTranslation(-p.art!.center.x, -p.art!.center.y, -p.art!.center.z));
  }

  /** 物体の正面（+Z）と右（+X）のワールドでの向き。 */
  private artAxes(p: Prop): { fx: number; fz: number; rx: number; rz: number } {
    const r = p.body.rotation();
    aq.set(r.x, r.y, r.z, r.w);
    const f = av.set(0, 0, 1).applyQuaternion(aq);
    const fx = f.x;
    const fz = f.z;
    const fl = Math.hypot(fx, fz) || 1;
    return { fx: fx / fl, fz: fz / fl, rx: fz / fl, rz: -fx / fl };
  }

  /** 叩かれた・ぶつかった衝撃で関節をはじく。 */
  private artKick(p: Prop, s: number): void {
    const a = p.art!;
    const js = a.def.joints;
    for (let j = 0; j < js.length; j++) {
      const jt = js[j];
      if (jt.t === 'continuous') {
        if (a.wheels.some((w) => w.j === j)) continue;
        if (a.always && !Number.isNaN(a.pose.target[j])) continue;
        a.pose.v[j] += (Math.random() - 0.5) * 2 * s;
        continue;
      }
      const rest = Math.min(jt.hi, Math.max(jt.lo, 0));
      const dir = rest <= jt.lo + 1e-4 ? 1 : rest >= jt.hi - 1e-4 ? -1 : Math.random() < 0.5 ? -1 : 1;
      a.pose.v[j] += dir * s * (0.6 + Math.random() * 0.6) * (jt.t === 'prismatic' ? 0.12 : 1);
    }
    a.act = Math.max(a.act, 1);
  }

  /** 叩かれたときの関節と仕掛け。 */
  private artHit(p: Prop, dmg: number, dv: V3, point?: V3): void {
    const a = p.art!;
    const g = this.g;
    const mag = Math.hypot(dv.x, dv.y, dv.z);
    this.artKick(p, Math.min(8, 1.5 + mag * 0.5 + dmg * 0.05));
    const t = p.body.translation();
    switch (p.def.gimmick) {
      case 'roller': {
        // よく転がる: 叩いた向きへ、もうひと押し
        const hl = Math.hypot(dv.x, dv.z);
        if (hl > 0.1) p.body.applyImpulse({ x: dv.x * p.mass * 0.8, y: 0, z: dv.z * p.mass * 0.8 }, true);
        this.heat(p, 4);
        break;
      }
      case 'slapper': {
        if (a.cd > 0) break;
        a.cd = 0.8;
        for (let j = 0; j < a.def.joints.length; j++) if (a.def.joints[j].t === 'revolute') a.pose.v[j] += 10;
        const { fx, fz, rx, rz } = this.artAxes(p);
        const hw = p.half.x + 0.5;
        let n = 0;
        g.enemies.inRadius(t, 3, (e) => {
          const dx = e.x - t.x;
          const dz = e.z - t.z;
          const fwd = dx * fx + dz * fz;
          const side = dx * rx + dz * rz;
          if (fwd < 0 || fwd > p.half.z + 2.2 || Math.abs(side) > hw) return;
          g.enemies.damage(e, 12, 'prop', { impulse: { x: fx * 13, y: 4, z: fz * 13 } });
          n++;
        });
        g.audio.thud(0.7);
        log('usd.slap', { id: p.def.id }, { hit: n });
        break;
      }
      case 'spinner': {
        const j = a.def.joints.findIndex((jt) => jt.t === 'continuous');
        if (j < 0) break;
        const ax = this.jointAxisWorld(p, j);
        const px = (point?.x ?? t.x + 1) - t.x;
        const pz = (point?.z ?? t.z) - t.z;
        let s = Math.sign(px * dv.z - pz * dv.x) || 1; // 上から見て反時計回りが +
        if (ax.y < 0) s = -s;
        const before = Math.abs(a.pose.v[j]);
        a.pose.v[j] = Math.max(-9, Math.min(9, a.pose.v[j] + s * Math.min(6, 1.2 + mag * 0.5 + dmg * 0.04)));
        if (before < 1.2 && Math.abs(a.pose.v[j]) >= 1.2) log('usd.spin', { id: p.def.id }, { w: Math.round(a.pose.v[j] * 10) / 10 });
        break;
      }
      case 'seesaw': {
        if (point) this.seesawFlip(p, this.seesawSide(p, point.x, point.z), Math.min(6, 2 + dmg / 6));
        break;
      }
      case 'driver': {
        if (a.drive > 0 || a.cd > 0 || (dmg < 4 && mag < 3)) break;
        a.drive = 2.4;
        a.cd = 4;
        a.lifted = new Set();
        const fork = a.def.joints.findIndex((jt) => jt.t === 'prismatic');
        if (fork >= 0) a.pose.target[fork] = a.def.joints[fork].hi * 0.9;
        p.body.wakeUp();
        g.audio.whoosh();
        log('usd.forklift', { id: p.def.id }, { drive: 2.4 });
        break;
      }
    }
  }

  /** 関節の軸のワールドでの向き（剛体の向きだけを掛ける）。 */
  private jointAxisWorld(p: Prop, j: number): THREE.Vector3 {
    const x = p.art!.def.joints[j].x;
    const r = p.body.rotation();
    return aw.set(x[0], x[1], x[2]).applyQuaternion(aq.set(r.x, r.y, r.z, r.w));
  }

  /** シーソーの板: 関節の番号、板の長い向き（物体座標）、半分の長さ、+q でどちらの端が下がるか。 */
  private seesawInfo(p: Prop): { j: number; along: 'x' | 'z'; half: number; down: number } | null {
    const a = p.art!;
    const j = a.def.joints.findIndex((jt) => jt.t === 'revolute');
    if (j < 0) return null;
    const jt = a.def.joints[j];
    const l = a.def.links[jt.c];
    const dx = l.max[0] - l.min[0];
    const dz = l.max[2] - l.min[2];
    const along = dx >= dz ? 'x' : 'z';
    const half = Math.max(dx, dz) / 2;
    const c = linkCenter(l, av);
    const end = along === 'x' ? [c.x + half, c.y, c.z] : [c.x, c.y, c.z + half];
    const m = jointMatrix(jt, 0.1, an);
    const y1 = aw.set(end[0], end[1], end[2]).applyMatrix4(m).y;
    return { j, along, half, down: y1 < end[1] ? 1 : -1 };
  }

  /** (x, z) が板のどちらの端の側か（+1 / -1）。 */
  private seesawSide(p: Prop, x: number, z: number): number {
    const info = this.seesawInfo(p);
    if (!info) return 1;
    const { fx, fz, rx, rz } = this.artAxes(p);
    const t = p.body.translation();
    const d = info.along === 'x' ? (x - t.x) * rx + (z - t.z) * rz : (x - t.x) * fx + (z - t.z) * fz;
    return d >= 0 ? 1 : -1;
  }

  /** シーソーの side の端を下げ、反対の端に乗っている敵・小道具・ノリコを打ち上げる。 */
  private seesawFlip(p: Prop, side: number, power: number): void {
    const a = p.art!;
    if (a.cd > 0) return;
    const info = this.seesawInfo(p);
    if (!info) return;
    a.cd = 0.6;
    a.pose.v[info.j] = side * info.down * (6 + power);
    a.act = 1;
    const g = this.g;
    const { fx, fz, rx, rz } = this.artAxes(p);
    const ux = info.along === 'x' ? rx : fx;
    const uz = info.along === 'x' ? rz : fz;
    const t = p.body.translation();
    const L = info.half * p.scale * 0.8;
    const ex = t.x - ux * side * L;
    const ez = t.z - uz * side * L;
    const top = t.y + p.half.y;
    const up = 13 + power * 1.5;
    let n = 0;
    g.enemies.inRadius({ x: ex, y: top, z: ez }, 1.6, (e) => {
      if (e.y > top + 2.5) return;
      g.enemies.launch(e, { x: -ux * side * 2.5, y: up, z: -uz * side * 2.5 });
      n++;
    });
    for (const q of this.props) {
      if (q === p || q.rooted || !q.alive) continue;
      const qt = q.body.translation();
      if (Math.hypot(qt.x - ex, qt.z - ez) > 1.4 || qt.y > top + 2.5) continue;
      q.body.setLinvel({ x: -ux * side * 2, y: up * 0.9, z: -uz * side * 2 }, true);
      this.heat(q, 3);
      n++;
    }
    const pl = g.player;
    if (Math.hypot(pl.pos.x - ex, pl.pos.z - ez) < 1.3 && pl.pos.y < top + 2) {
      pl.launch(-ux * side * 2, 15, -uz * side * 2);
      n++;
    }
    g.audio.thud(0.8);
    g.fx.dust({ x: ex, y: top, z: ez }, 0.8, 0xd8d0c0, 3);
    log('usd.seesaw', { side, power: Math.round(power * 10) / 10 }, { launched: n });
  }

  /** USDCraft の物体の、関節と仕掛けを 1 フレーム進める。描き直しが要るなら true。 */
  private stepArt(p: Prop, dt: number): boolean {
    const a = p.art!;
    const g = this.g;
    const b = p.body;
    if (a.cd > 0) a.cd -= dt;
    const sleeping = b.isSleeping() || p.rooted;
    if (!sleeping) {
      const v = b.linvel();
      const dv = Math.hypot(v.x - a.lastV.x, v.y - a.lastV.y, v.z - a.lastV.z);
      a.lastV.x = v.x;
      a.lastV.y = v.y;
      a.lastV.z = v.z;
      if (dv > 2.2) this.artKick(p, Math.min(6, dv * 0.35));
      // 車輪は進む速さで回す（ω = (v × 上) ・ 軸 / 半径）
      if (a.wheels.length) {
        const r = b.rotation();
        aq.set(r.x, r.y, r.z, r.w);
        for (const w of a.wheels) {
          const x = a.def.joints[w.j].x;
          aw.set(x[0], x[1], x[2]).applyQuaternion(aq);
          a.pose.v[w.j] = (-v.z * aw.x + v.x * aw.z) / w.r;
          a.act = Math.max(a.act, Math.abs(a.pose.v[w.j]));
        }
      }
    }
    // 仕掛け
    const gm = p.def.gimmick;
    if (gm === 'driver' && a.drive > 0) {
      a.drive -= dt;
      const { fx, fz } = this.artAxes(p);
      const v = b.linvel();
      b.setLinvel({ x: fx * 7, y: Math.min(v.y, 2), z: fz * 7 }, true);
      b.setAngvel({ x: 0, y: 0, z: 0 }, true);
      this.heat(p, 0.3);
      p.dmgMul = Math.max(p.dmgMul, 1.3);
      const t = b.translation();
      const reach = p.half.z * 1.1 + 0.5;
      g.enemies.inRadius({ x: t.x + fx * reach, y: t.y, z: t.z + fz * reach }, 1.5, (e) => {
        if (a.lifted!.has(e)) return;
        a.lifted!.add(e);
        g.enemies.launch(e, { x: fx * 4, y: 12 + Math.random() * 3, z: fz * 4 });
        g.enemies.damage(e, 18, 'prop', { quiet: true });
      });
      if (a.drive <= 0) {
        const fork = a.def.joints.findIndex((jt) => jt.t === 'prismatic');
        if (fork >= 0) a.pose.target[fork] = NaN;
        log('usd.forklift.end', { id: p.def.id }, { lifted: a.lifted!.size });
        a.lifted = null;
      }
      a.act = Math.max(a.act, 1);
    } else if (gm === 'spinner') {
      const j = a.def.joints.findIndex((jt) => jt.t === 'continuous');
      const w = j >= 0 ? a.pose.v[j] * this.jointAxisWorld(p, j).y : 0;
      a.tick -= dt;
      if (Math.abs(w) > 1.2 && a.tick <= 0) {
        a.tick = 0.2;
        const t = b.translation();
        const R = Math.max(p.half.x, p.half.z) + 0.7;
        g.enemies.inRadius(t, R, (e) => {
          if (e.y > t.y + p.half.y + 1.8) return;
          const rx = e.x - t.x;
          const rz = e.z - t.z;
          const d = Math.hypot(rx, rz) || 1;
          // 回る床の速さ（ω × r）と、外へ飛ばす力
          g.enemies.push(e, { x: w * rz * 0.9 + (rx / d) * Math.abs(w) * 1.3, y: 1.5 + Math.abs(w) * 0.3, z: -w * rx * 0.9 + (rz / d) * Math.abs(w) * 1.3 });
          g.enemies.damage(e, 1 + Math.abs(w) * 0.9, 'prop', { quiet: true });
        });
      }
    } else if (gm === 'seesaw') {
      // 板の端へ落ちてきた敵や重い物で、反対側を打ち上げる
      a.tick -= dt;
      if (a.tick <= 0 && a.cd <= 0) {
        a.tick = 0.1;
        const info = this.seesawInfo(p);
        if (info) {
          const t = b.translation();
          const top = t.y + p.half.y;
          const L = info.half * p.scale;
          let hit = 0;
          let power = 0;
          g.enemies.inRadius(t, L + 0.5, (e) => {
            if (hit || e.y > top + 2.5 || e.y < top - 1.2) return;
            const vy = e.body.linvel().y;
            if (vy < -4) {
              hit = this.seesawSide(p, e.x, e.z);
              power = Math.min(6, -vy * 0.4);
            }
          });
          if (!hit) {
            for (const q of this.props) {
              if (q === p || q.rooted || !q.alive || q.mass < 15) continue;
              const qt = q.body.translation();
              if (Math.hypot(qt.x - t.x, qt.z - t.z) > L + 0.6 || qt.y > top + 3 || qt.y < top - 1) continue;
              const vy = q.body.linvel().y;
              if (vy < -4) {
                hit = this.seesawSide(p, qt.x, qt.z);
                power = Math.min(8, -vy * 0.3 + Math.sqrt(q.mass) * 0.2);
                break;
              }
            }
          }
          if (hit) this.seesawFlip(p, hit, power);
        }
      }
    }
    if (a.act > 1e-3 || a.always) {
      a.act = stepPose(a.def, a.pose, Math.min(dt, 1 / 30));
      linkMatrices(a.def, a.pose, a.mats);
      return true;
    }
    return false;
  }

  /** 消火栓の水柱を進める。 */
  private updateSpouts(dt: number): void {
    const g = this.g;
    for (let i = this.spouts.length - 1; i >= 0; i--) {
      const s = this.spouts[i];
      s.t -= dt;
      if (s.t <= 0) {
        this.spouts.splice(i, 1);
        log('usd.hydrant.end', { x: Math.round(s.x), z: Math.round(s.z) }, { launched: s.launched });
        continue;
      }
      for (let k = 0; k < 3; k++) {
        g.fx.spawn({ pos: { x: s.x + (Math.random() - 0.5) * 0.3, y: s.y + 0.5, z: s.z + (Math.random() - 0.5) * 0.3 }, vel: { x: (Math.random() - 0.5) * 2.5, y: 13 + Math.random() * 5, z: (Math.random() - 0.5) * 2.5 }, grav: -16, life: 1.3, size: 0.45, size2: 0.25, color: 0xbfe8ff, shape: 0, alpha: 0.85 });
      }
      s.tick -= dt;
      if (s.tick > 0) continue;
      s.tick = 0.2;
      const at = { x: s.x, y: s.y + 0.5, z: s.z };
      g.enemies.inRadius(at, 5, (e, d) => {
        g.enemies.wetIt(e, 8);
        if (d < 2.2 && e.state === 'walk') {
          g.enemies.launch(e, { x: (Math.random() - 0.5) * 3, y: 15 + Math.random() * 4, z: (Math.random() - 0.5) * 3 });
          s.launched++;
        }
      });
      const pl = g.player;
      if (Math.hypot(pl.pos.x - s.x, pl.pos.z - s.z) < 1.4 && pl.pos.y < s.y + 1.5) pl.launch((pl.pos.x - s.x) * 2, 15, (pl.pos.z - s.z) * 2);
    }
  }

  /** 球の範囲にある建物の部品と小道具へ、爆発などのダメージと力を与える。 */
  blast(pos: V3, radius: number, structDmg: number, force: number, propDmg: number): void {
    const hits: { kind: string; ref: Chunk | Prop }[] = [];
    this.g.physics.querySphere(pos, radius, G.CHUNK | G.DEBRIS | G.PROP, (o) => {
      hits.push(o as { kind: string; ref: Chunk | Prop });
    });
    const seen = new Set<unknown>();
    for (const h of hits) {
      if (seen.has(h.ref)) continue;
      seen.add(h.ref);
      if (h.kind === 'prop') {
        const p = h.ref as Prop;
        if (!p.alive) continue;
        const t = p.body.translation();
        const d = Math.hypot(t.x - pos.x, t.y - pos.y, t.z - pos.z);
        const f = Math.max(0.25, 1 - d / (radius + 1));
        const k = (force * f) / Math.pow(Math.max(1, p.mass / 20), 0.55);
        const inv = 1 / Math.max(0.3, d);
        this.hitProp(p, propDmg * f, { x: (t.x - pos.x) * inv * k, y: (Math.max(0, t.y - pos.y) * inv + 0.7) * k, z: (t.z - pos.z) * inv * k });
      } else {
        const ch = h.ref as Chunk;
        const c = ch.body ? ch.body.translation() : ch.pos;
        const d = Math.hypot(c.x - pos.x, c.y - pos.y, c.z - pos.z);
        const f = Math.max(0.3, 1 - d / (radius + 1.5));
        const inv = 1 / Math.max(0.5, d);
        const k = force * f * 0.8;
        this.hitChunk(ch, structDmg * f, { x: (c.x - pos.x) * inv * k, y: ((c.y - pos.y) * inv + 0.5) * k, z: (c.z - pos.z) * inv * k });
      }
    }
  }

  get destruction(): number {
    return this.buildingTotal > 0 ? (this.buildingBroken / this.buildingTotal) * 100 : 0;
  }

  // ---------------------------------------------------------------- 更新
  update(dt: number): void {
    const g = this.g;
    try {
      this.stage.update?.(dt);
    } catch (err) {
      log('exception.stage', { stage: g.stageDef.id, message: String(err) }, { stack: (err as Error).stack ?? null });
    }
    // 支えを失った部品を、少しずつ順に落とす（一気に消えるより崩れて見える）
    if (this.supportDirty) {
      this.supportTimer -= dt;
      if (this.supportTimer <= 0) {
        this.supportTimer = 0.09;
        const un = findUnsupported(this.nodes);
        if (un.length === 0) this.supportDirty = false;
        else {
          let n = 0;
          let cx = 0, cy = 0, cz = 0;
          for (const i of un) {
            const ch = this.nodeChunk[i];
            if (ch.state !== 'fixed') continue;
            this.detach(ch);
            this.makeLoose(ch, { x: (Math.random() - 0.5) * 0.6, y: -0.5, z: (Math.random() - 0.5) * 0.6 });
            cx += ch.pos.x; cy += ch.pos.y; cz += ch.pos.z;
            n++;
          }
          if (n > 0) {
            g.audio.crumble(Math.min(1.5, 0.5 + n * 0.05));
            g.fx.dust({ x: cx / n, y: cy / n, z: cz / n }, 2.2, 0xd8d0c0, Math.min(8, 2 + n));
            const pd = Math.hypot(cx / n - g.player.pos.x, cz / n - g.player.pos.z);
            if (pd < 40) g.fx.shake(n > 8 ? 'L' : 'M');
            log('world.collapse', { count: n }, { destruction: Math.round(this.destruction * 10) / 10 });
          }
        }
      }
    }
    // がれき
    for (let i = this.loose.length - 1; i >= 0; i--) {
      const ch = this.loose[i];
      const b = ch.body!;
      ch.age += dt;
      if (ch.hot > 0) {
        ch.hot -= dt;
        const v = b.linvel();
        ch.prevSpeed = Math.hypot(v.x, v.y, v.z);
        if (ch.hot <= 0 && ch.col) ch.col.setActiveEvents(RAPIER.ActiveEvents.NONE);
      }
      const limit = ch.kind === 'frag' ? 9 : 14;
      const t = b.translation();
      const floorY = this.groundY(t.x, t.z);
      if (ch.age > limit || t.y < floorY - 5) {
        if (t.y > floorY - 5) g.fx.dust(t, 0.9, 0xd8d0c0, 2);
        this.removeChunk(ch);
        continue;
      }
      if (!b.isSleeping()) {
        const r = b.rotation();
        m4.compose(pv.set(t.x, t.y, t.z), qv.set(r.x, r.y, r.z, r.w), sv.set(ch.half.x * 2, ch.half.y * 2, ch.half.z * 2));
        ch.set!.setMatrix(ch, m4);
      }
    }
    // 小道具
    for (let i = this.props.length - 1; i >= 0; i--) {
      const p = this.props[i];
      const b = p.body;
      if (p.hot > 0) {
        p.hot -= dt;
        const v = b.linvel();
        p.prevSpeed = Math.hypot(v.x, v.y, v.z);
        if (p.hot <= 0) p.col.setActiveEvents(RAPIER.ActiveEvents.NONE);
      }
      if (p.fuse >= 0) {
        p.fuse -= dt;
        if (p.fuse < 0) {
          const t = b.translation();
          const ex = p.def.explosive!;
          // USDCraft の物体は部品に分かれ、その部品も爆風で飛ぶ
          if (p.art) this.shatter(p);
          else this.removeProp(p);
          // 薬品は毒の霧を残す。先に霧を置くと、自分の爆発で引火してしまうので、爆発のあとに置く
          g.explode({ x: t.x, y: t.y, z: t.z }, ex.r, ex.dmg, { force: 16, struct: ex.dmg * 0.9, hurtPlayer: true, source: 'prop', element: p.def.gas ? undefined : 'fire', small: p.def.gas });
          if (p.def.gas) g.skills.addCloud(t.x, t.z, 2.2, 6, 14);
          continue;
        }
      }
      if (p.rocket > 0) {
        p.rocket -= dt;
        const m = p.mass;
        // 向きを少しずつ変えながら、押し続ける
        const turn = (Math.random() - 0.5) * 6 * dt;
        const c = Math.cos(turn);
        const s = Math.sin(turn);
        p.rdir = { x: p.rdir.x * c - p.rdir.z * s, y: p.rdir.y, z: p.rdir.x * s + p.rdir.z * c };
        b.applyImpulse({ x: p.rdir.x * m * 30 * dt, y: p.rdir.y * m * 30 * dt + m * 6 * dt, z: p.rdir.z * m * 30 * dt }, true);
        b.setAngvel({ x: 0, y: 9, z: 0 }, true);
        this.heat(p, 0.4);
        if (Math.random() < dt * 40) {
          const t = b.translation();
          g.fx.spawn({ pos: { x: t.x, y: t.y, z: t.z }, vel: { x: -p.rdir.x * 6 + (Math.random() - 0.5) * 2, y: (Math.random() - 0.3) * 2, z: -p.rdir.z * 6 + (Math.random() - 0.5) * 2 }, drag: 2, life: 0.7, size: 0.4, size2: 1.3, color: 0xffffff, color2: 0xe8eef2, shape: 5, alpha: 0.85 });
        }
      }
      if (p.life !== Infinity) {
        p.life -= dt;
        if (p.life <= 0 && p.dying < 0) p.dying = 0.3;
      }
      if (p.dying >= 0) {
        p.dying -= dt;
        if (p.dying <= 0) {
          g.fx.poof(b.translation(), 0.8);
          this.removeProp(p);
          continue;
        }
        this.syncProp(p);
        continue;
      }
      const artDirty = p.art ? this.stepArt(p, dt) : false;
      if (!p.alive) continue;
      if (!b.isSleeping() && !p.rooted) {
        const t = b.translation();
        if (t.y < this.groundY(t.x, t.z) - 6) {
          this.removeProp(p);
          continue;
        }
        this.syncProp(p);
      } else if (artDirty) this.syncProp(p);
    }
    if (this.spouts.length) this.updateSpouts(dt);
    for (const s of this.sets.values()) s.flush();
    // 影を落とす範囲をプレイヤーに合わせる
    const pp = g.player.pos;
    this.sun.position.set(pp.x + 26, pp.y + 46, pp.z + 18);
    this.sun.target.position.set(pp.x, pp.y, pp.z);
  }

  dispose(): void {
    this.stage.dispose?.();
    this.root.removeFromParent();
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
    });
  }
}
