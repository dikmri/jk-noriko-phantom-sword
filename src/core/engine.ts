import * as THREE from 'three';
import { log } from '../log';

export type Quality = 'low' | 'mid' | 'high';

/** 描画まわり（レンダラー・シーン・カメラ）をまとめたもの。 */
export class Engine {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  quality: Quality = 'mid';

  constructor(public canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.1, 400);
    this.scene.add(this.camera);
    this.setQuality('mid');
    window.addEventListener('resize', () => this.resize());
    this.resize();
    const gl = this.renderer.getContext();
    log('engine.init', { quality: this.quality }, { renderer: gl.getParameter(gl.VERSION), maxTex: gl.getParameter(gl.MAX_TEXTURE_SIZE) });
  }

  setQuality(q: Quality): void {
    this.quality = q;
    const cap = q === 'low' ? 1 : q === 'mid' ? 1.5 : 2;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, cap));
    this.renderer.shadowMap.enabled = q !== 'low';
    this.resize();
  }

  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }
}

/** オブジェクト以下のジオメトリとマテリアルを解放する。 */
export function disposeTree(obj: THREE.Object3D): void {
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
    else if (mat) mat.dispose();
  });
}
