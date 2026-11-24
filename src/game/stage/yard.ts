/**
 * 校庭（最初からあるステージ）。校舎・体育倉庫・プレハブと、机のバリケードやドラム缶。
 */
import * as THREE from 'three';
import type { Game } from '../game';
import { ARENA, WorldMap } from '../world';
import { DAY_SKY, Stage } from './index';

export function yard(g: Game, w: WorldMap): Stage {
  return {
    start: { x: 0, z: -28 },
    sky: DAY_SKY,
    build() {
      ground(g, w);
      w.addBuilding(-20, -52, 20, 5, 3, { doors: [{ side: 'front', at: 9 }] });
      w.addBuilding(34, -22, 5, 3, 1, { doors: [{ side: 'front', at: 2 }] });
      w.addBuilding(-48, 6, 4, 4, 2, { doors: [{ side: 'front', at: 1 }] });
      props(g, w);
    },
  };
}

function ground(g: Game, w: WorldMap): void {
  const tex = g.assets.tex('ground.jpg');
  tex.repeat.set(36, 36);
  w.floor(new THREE.MeshLambertMaterial({ map: tex, color: 0xdfe3e6 }), ARENA * 2 + 60, ARENA * 2 + 60);

  // 校庭の白線（トラックとセンターサークル）
  const cv = document.createElement('canvas');
  cv.width = cv.height = 1024;
  const c = cv.getContext('2d')!;
  c.strokeStyle = 'rgba(255,255,255,0.85)';
  c.lineWidth = 5;
  const S = 1024 / 110;
  const cx = 512;
  const cy = 512 - 12 * S;
  for (const r of [22, 25.5]) {
    c.beginPath();
    c.moveTo(cx - 18 * S, cy - r * S);
    c.lineTo(cx + 18 * S, cy - r * S);
    c.arc(cx + 18 * S, cy, r * S, -Math.PI / 2, Math.PI / 2);
    c.lineTo(cx - 18 * S, cy + r * S);
    c.arc(cx - 18 * S, cy, r * S, Math.PI / 2, Math.PI * 1.5);
    c.stroke();
  }
  c.beginPath();
  c.arc(cx, cy, 6 * S, 0, Math.PI * 2);
  c.stroke();
  c.beginPath();
  c.moveTo(cx, cy - 22 * S);
  c.lineTo(cx, cy + 22 * S);
  c.stroke();
  const lt = new THREE.CanvasTexture(cv);
  lt.colorSpace = THREE.SRGBColorSpace;
  lt.anisotropy = 8;
  w.floor(new THREE.MeshBasicMaterial({ map: lt, transparent: true, depthWrite: false }), 110, 110, 0, 0, 0.03, 1);

  w.groundCollider();
  const wallTex = g.assets.tex('fence.jpg');
  wallTex.repeat.set(ARENA / 2, 1);
  w.bounds(new THREE.MeshLambertMaterial({ map: wallTex }));
  w.skyline([0xf2e6d0, 0xd9e6f2, 0xf2d0d0, 0xe0f0d8, 0xe8e8e8, 0xf5e0b8], 4, 18);
}

function props(g: Game, w: WorldMap): void {
  const rng = g.rng;
  const rule = g.rule;
  const S = { sleep: true };
  // 机と椅子のバリケード（積んである。崩せる）
  const nDesk = Math.round(6 * rule.clutter);
  for (let i = 0; i < nDesk; i++) {
    const { x, z } = w.pickSpot(10, 58);
    const yaw = rng() * Math.PI;
    const cs = Math.cos(yaw);
    const sn = Math.sin(yaw);
    const n = 2 + Math.floor(rng() * 2);
    for (let l = 0; l < 3; l++) {
      for (let k = 0; k < n - l; k++) {
        const off = (k - (n - l - 1) / 2) * 0.76;
        w.spawnProp('desk', { x: x + cs * off, y: l * 0.73 + 0.005, z: z - sn * off }, yaw, S);
      }
    }
    for (let k = 0; k < 2; k++) w.spawnProp('chair', { x: x + sn * 0.9 + cs * (k - 0.5) * 0.6, y: 0.005, z: z + cs * 0.9 - sn * (k - 0.5) * 0.6 }, yaw + Math.PI, S);
  }
  // 段ボールの山
  const nBox = Math.round(6 * rule.clutter);
  for (let i = 0; i < nBox; i++) {
    const { x, z } = w.pickSpot(8, 60);
    boxPile(w, x, z, 2 + Math.floor(rng() * 2));
  }
  // ドラム缶（爆発する）
  const nBarrel = Math.round(7 * rule.barrels);
  for (let i = 0; i < nBarrel; i++) {
    const { x, z } = w.pickSpot(12, 62);
    const n = 2 + Math.floor(rng() * 3);
    for (let k = 0; k < n; k++) w.spawnProp('barrel', { x: x + (k % 2) * 0.7, y: 0.005, z: z + Math.floor(k / 2) * 0.7 }, rng() * 6, S);
  }
  // 自転車置き場（ドミノ倒しになる）
  for (const bx of [-46, 46]) {
    for (let k = 0; k < 9; k++) w.spawnProp('bike', { x: bx, y: 0.005, z: -30 + k * 0.72 }, Math.PI / 2, S);
  }
  // 自販機
  for (const vx of [-17, -14.5, 15]) w.spawnProp('vending', { x: vx, y: 0.005, z: -40.6 }, 0, S);
  // コーン
  for (let k = 0; k < 14; k++) w.spawnProp('cone', { x: -24 + k * 3.7, y: 0.005, z: 6 + (k % 2) * 14 }, 0, S);
  // 先生の車
  for (let k = 0; k < 4; k++) w.spawnProp('car', { x: 52, y: 0.005, z: 14 + k * 5.2 }, Math.PI / 2 + (rng() - 0.5) * 0.1, S);
  // 二宮金次郎像
  w.spawnProp('statue', { x: 10, y: 0.005, z: -36 }, Math.PI, S);
  // サッカーゴール
  w.spawnProp('goal', { x: -30, y: 0.005, z: -12 }, Math.PI / 2, S);
  w.spawnProp('goal', { x: 30, y: 0.005, z: -12 }, -Math.PI / 2, S);
  // ベンチとボール
  for (let k = 0; k < 5; k++) {
    const { x, z } = w.pickSpot(20, 60);
    w.spawnProp('bench', { x, y: 0.005, z }, rng() * 6, S);
  }
  for (let k = 0; k < 8; k++) {
    const { x, z } = w.pickSpot(6, 40);
    w.spawnProp('ball', { x, y: 0.02, z }, 0, S);
  }
  // 木
  treeRing(g, w, 22, 1);
}

/** 段ボールを四角錐に積む。 */
export function boxPile(w: WorldMap, x: number, z: number, n: number): void {
  for (let l = 0; l < n + 1; l++) {
    for (let a = 0; a < n - l; a++) {
      for (let b = 0; b < n - l; b++) {
        w.spawnProp('box', { x: x + (a - (n - l - 1) / 2) * 0.62, y: l * 0.505 + 0.005, z: z + (b - (n - l - 1) / 2) * 0.52 }, 0, { sleep: true });
      }
    }
  }
}

/** 外周に沿って木を植える。 */
export function treeRing(g: Game, w: WorldMap, n: number, ringMul: number): void {
  const rng = g.rng;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2;
    const x = Math.cos(a) * (ARENA - 6) * ringMul * (0.86 + rng() * 0.12);
    const z = Math.sin(a) * (ARENA - 6) * ringMul * (0.86 + rng() * 0.12);
    if (w.free(x, z, 1)) w.spawnProp('tree', { x, y: 0, z }, rng() * 6, { scale: 0.85 + rng() * 0.4 });
  }
}
