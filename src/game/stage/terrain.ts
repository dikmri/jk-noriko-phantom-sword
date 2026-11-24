/**
 * 高低差のある地面。高さを格子に記録しておき、見た目のメッシュと当たり判定（三角形の集まり）を同じ頂点から作る。
 * 実行中の高さの問い合わせ（敵の出現・弾の着地など）は、格子を補間して素早く返す。
 */
import * as THREE from 'three';
import { G, groups, RAPIER } from '../../core/physics';
import type { WorldMap } from '../world';

export class HeightGrid {
  constructor(
    readonly x0: number,
    readonly z0: number,
    readonly step: number,
    readonly nx: number,
    readonly nz: number,
    readonly h: Float32Array,
  ) {}

  /** fn(x, z) で高さを決めた格子を作る。nx, nz は頂点の数。 */
  static build(x0: number, z0: number, x1: number, z1: number, step: number, fn: (x: number, z: number) => number): HeightGrid {
    const nx = Math.round((x1 - x0) / step) + 1;
    const nz = Math.round((z1 - z0) / step) + 1;
    const h = new Float32Array(nx * nz);
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) h[j * nx + i] = fn(x0 + i * step, z0 + j * step);
    return new HeightGrid(x0, z0, step, nx, nz, h);
  }

  /** 高さ（格子の外は端の値）。 */
  at(x: number, z: number): number {
    const fx = Math.min(this.nx - 1.001, Math.max(0, (x - this.x0) / this.step));
    const fz = Math.min(this.nz - 1.001, Math.max(0, (z - this.z0) / this.step));
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const u = fx - i;
    const v = fz - j;
    const a = this.h[j * this.nx + i];
    const b = this.h[j * this.nx + i + 1];
    const c = this.h[(j + 1) * this.nx + i];
    const d = this.h[(j + 1) * this.nx + i + 1];
    return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
  }

  /** 傾き（水平に 1m 進むと何 m 上がるか）。 */
  slope(x: number, z: number): number {
    const e = this.step;
    const dx = (this.at(x + e, z) - this.at(x - e, z)) / (2 * e);
    const dz = (this.at(x, z + e) - this.at(x, z - e)) / (2 * e);
    return Math.hypot(dx, dz);
  }
}

/**
 * 格子から地面を作る。color(x, z, h, slope) で頂点の色（テクスチャに掛ける）を決める。
 */
export function terrainMesh(w: WorldMap, grid: HeightGrid, map: THREE.Texture, uvScale: number, color: (x: number, z: number, h: number, slope: number) => THREE.Color): void {
  const { nx, nz, step, x0, z0 } = grid;
  const pos = new Float32Array(nx * nz * 3);
  const uv = new Float32Array(nx * nz * 2);
  const col = new Float32Array(nx * nz * 3);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      const x = x0 + i * step;
      const z = z0 + j * step;
      const y = grid.h[k];
      pos.set([x, y, z], k * 3);
      uv.set([x / uvScale, -z / uvScale], k * 2);
      const c = color(x, z, y, grid.slope(x, z));
      col.set([c.r, c.g, c.b], k * 3);
    }
  }
  const idx = new Uint32Array((nx - 1) * (nz - 1) * 6);
  let n = 0;
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i;
      const b = a + 1;
      const c = a + nx;
      const d = c + 1;
      idx.set([a, c, b, b, c, d], n);
      n += 6;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map, vertexColors: true }));
  mesh.receiveShadow = true;
  w.root.add(mesh);
  w.staticCollider(RAPIER.ColliderDesc.trimesh(pos, idx).setCollisionGroups(groups(G.STATIC, 0xffff)).setFriction(0.9), 'ground');
}

export function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
