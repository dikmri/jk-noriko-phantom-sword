import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { log } from '../log';

/** 1 つのジオメトリにまとめたモデル（大量に描くもの用）。色は頂点カラーに焼き込む。 */
export interface MergedModel {
  geo: THREE.BufferGeometry;
  min: THREE.Vector3;
  max: THREE.Vector3;
  size: THREE.Vector3;
  placeholder: boolean;
}

const BASE = import.meta.env.BASE_URL;

function mergeScene(root: THREE.Object3D): THREE.BufferGeometry {
  root.updateMatrixWorld(true);
  const geos: THREE.BufferGeometry[] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    let g = m.geometry.clone();
    g.applyMatrix4(m.matrixWorld);
    if (g.index) g = g.toNonIndexed();
    if (!g.attributes.normal) g.computeVertexNormals();
    const mat = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.MeshStandardMaterial;
    const col = mat.color ?? new THREE.Color(1, 1, 1);
    const n = g.attributes.position.count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      arr[i * 3] = col.r;
      arr[i * 3 + 1] = col.g;
      arr[i * 3 + 2] = col.b;
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', g.attributes.position);
    out.setAttribute('normal', g.attributes.normal);
    out.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    geos.push(out);
  });
  const merged = mergeGeometries(geos, false);
  if (!merged) throw new Error('merge failed');
  return merged;
}

function placeholderGeo(w: number, h: number, d: number, color: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
  g.translate(0, h / 2, 0);
  const c = new THREE.Color(color);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) arr.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  g.deleteAttribute('uv');
  return g;
}

export class Assets {
  scenes = new Map<string, THREE.Group>();
  merged = new Map<string, MergedModel>();
  /** 部品ごとに分けたモデル（usd/ の物体）。モデル名 -> ノード名 -> 形（物体座標のまま、頂点カラーつき） */
  parts = new Map<string, Map<string, THREE.BufferGeometry>>();
  textures = new Map<string, THREE.Texture>();
  toonRamp: THREE.DataTexture;
  private gltf = new GLTFLoader();
  private texLoader = new THREE.TextureLoader();

  constructor() {
    // トゥーン調の陰影（3 段階）
    const ramp = new Uint8Array([120, 120, 120, 255, 200, 200, 200, 255, 255, 255, 255, 255]);
    this.toonRamp = new THREE.DataTexture(ramp, 3, 1, THREE.RGBAFormat);
    this.toonRamp.minFilter = THREE.NearestFilter;
    this.toonRamp.magFilter = THREE.NearestFilter;
    this.toonRamp.needsUpdate = true;
  }

  /** 関節つきのまま使うモデル（ノリコ）を読む。 */
  async loadScene(name: string): Promise<void> {
    const t0 = performance.now();
    try {
      const g = await this.gltf.loadAsync(`${BASE}models/${name}.glb`);
      g.scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const src = m.material as THREE.MeshStandardMaterial;
        const mat = new THREE.MeshToonMaterial({ color: src.color, map: src.map ?? null, gradientMap: this.toonRamp });
        mat.name = src.name;
        m.material = mat;
        m.castShadow = true;
      });
      this.scenes.set(name, g.scene);
      log('asset.scene', { name }, { ok: true, ms: Math.round(performance.now() - t0) });
    } catch (e) {
      log('asset.scene', { name }, { ok: false, error: String(e) });
      throw e;
    }
  }

  /** 1 ジオメトリにまとめるモデルを読む。読めなければ箱で代用する。 */
  async loadMerged(name: string, fallback: [number, number, number, number] = [0.6, 1.6, 0.5, 0x8888aa]): Promise<void> {
    const t0 = performance.now();
    let geo: THREE.BufferGeometry;
    let placeholder = false;
    try {
      const g = await this.gltf.loadAsync(`${BASE}models/${name}.glb`);
      geo = mergeScene(g.scene);
      if (name.startsWith('usd/')) {
        // 部品（ノード）ごとの形も残す。関節で動かしたり、壊れて飛び散ったりするのに使う
        g.scene.updateMatrixWorld(true);
        const parts = new Map<string, THREE.BufferGeometry>();
        for (const child of g.scene.children) {
          let has = false;
          child.traverse((o) => {
            if ((o as THREE.Mesh).isMesh) has = true;
          });
          if (has) parts.set(child.name, mergeScene(child));
        }
        this.parts.set(name, parts);
      }
    } catch (e) {
      placeholder = true;
      geo = placeholderGeo(fallback[0], fallback[1], fallback[2], fallback[3]);
      log('asset.merged', { name }, { ok: false, error: String(e), fallback: 'box' });
    }
    geo.computeBoundingBox();
    const bb = geo.boundingBox!;
    const size = new THREE.Vector3();
    bb.getSize(size);
    this.merged.set(name, { geo, min: bb.min.clone(), max: bb.max.clone(), size, placeholder });
    if (!placeholder) log('asset.merged', { name }, { ok: true, verts: geo.attributes.position.count, size: [size.x, size.y, size.z], ms: Math.round(performance.now() - t0) });
  }

  /** テクスチャを読む。読めなければ単色で代用する。 */
  async loadTexture(name: string, opts: { repeat?: boolean; flipY?: boolean; fallback?: number } = {}): Promise<void> {
    let tex: THREE.Texture;
    try {
      tex = await this.texLoader.loadAsync(`${BASE}tex/${name}`);
      log('asset.texture', { name }, { ok: true, w: (tex.image as HTMLImageElement).width, h: (tex.image as HTMLImageElement).height });
    } catch (e) {
      const cv = document.createElement('canvas');
      cv.width = cv.height = 64;
      const c = cv.getContext('2d')!;
      const col = new THREE.Color(opts.fallback ?? 0x999999);
      c.fillStyle = `#${col.getHexString()}`;
      c.fillRect(0, 0, 64, 64);
      for (let i = 0; i < 220; i++) {
        c.fillStyle = `rgba(0,0,0,${Math.random() * 0.08})`;
        c.fillRect(Math.random() * 64, Math.random() * 64, 3, 3);
      }
      tex = new THREE.CanvasTexture(cv);
      log('asset.texture', { name }, { ok: false, error: String(e), fallback: 'color' });
    }
    tex.colorSpace = THREE.SRGBColorSpace;
    if (opts.repeat) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    if (opts.flipY === false) tex.flipY = false;
    tex.anisotropy = 4;
    tex.needsUpdate = true;
    this.textures.set(name, tex);
  }

  tex(name: string): THREE.Texture {
    const t = this.textures.get(name);
    if (!t) throw new Error(`texture not loaded: ${name}`);
    return t;
  }

  model(name: string): MergedModel {
    const m = this.merged.get(name);
    if (!m) throw new Error(`model not loaded: ${name}`);
    return m;
  }
}

const emojiCache = new Map<string, THREE.Texture>();

/** 絵文字 1 文字をテクスチャにする（飛び道具やアイテムの見た目に使う）。 */
export function emojiTexture(emoji: string): THREE.Texture {
  let t = emojiCache.get(emoji);
  if (t) return t;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const c = cv.getContext('2d')!;
  c.font = '96px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText(emoji, 64, 70);
  t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  emojiCache.set(emoji, t);
  return t;
}

const spriteMats = new Map<string, THREE.SpriteMaterial>();

export function emojiSprite(emoji: string, size: number): THREE.Sprite {
  let m = spriteMats.get(emoji);
  if (!m) {
    m = new THREE.SpriteMaterial({ map: emojiTexture(emoji), transparent: true, depthWrite: false });
    spriteMats.set(emoji, m);
  }
  const s = new THREE.Sprite(m);
  s.scale.set(size, size, 1);
  return s;
}
