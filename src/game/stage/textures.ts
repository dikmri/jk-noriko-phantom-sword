/**
 * 床や道路の模様を canvas で描く。繰り返して貼るので、上下左右の端がつながるように描く。
 * 同じ種（seed）からは同じ模様になる。
 */
import * as THREE from 'three';
import { makeRng } from '../rules';

type Draw = (c: CanvasRenderingContext2D, S: number, rnd: () => number) => void;

const cache = new Map<string, THREE.CanvasTexture>();

function make(key: string, S: number, draw: Draw, repeat: number): THREE.CanvasTexture {
  const hit = cache.get(key);
  if (hit) {
    const t = hit.clone();
    t.repeat.set(repeat, repeat);
    t.needsUpdate = true;
    return t;
  }
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const c = cv.getContext('2d')!;
  draw(c, S, makeRng(key.length * 7919 + 13));
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  t.repeat.set(repeat, repeat);
  cache.set(key, t);
  return t;
}

/** 端をまたいで描く（繰り返したときに継ぎ目が出ないように、はみ出た分を反対側にも描く）。 */
function wrapDot(c: CanvasRenderingContext2D, S: number, x: number, y: number, r: number, color: string): void {
  c.fillStyle = color;
  for (const ox of [-S, 0, S]) {
    for (const oy of [-S, 0, S]) {
      const px = x + ox;
      const py = y + oy;
      if (px + r < 0 || px - r > S || py + r < 0 || py - r > S) continue;
      c.beginPath();
      c.arc(px, py, r, 0, Math.PI * 2);
      c.fill();
    }
  }
}

/** 校舎の木の床（板を互い違いに張る）。 */
export function woodFloor(repeat: number): THREE.CanvasTexture {
  return make('wood', 512, (c, S, rnd) => {
    const rows = 8;
    const h = S / rows;
    for (let r = 0; r < rows; r++) {
      const off = (r % 2) * (S / 4);
      for (let k = -1; k < 3; k++) {
        const x = off + k * (S / 2);
        const tone = 150 + Math.floor(rnd() * 30);
        c.fillStyle = `rgb(${tone + 40},${tone - 2},${tone - 60})`;
        c.fillRect(x, r * h, S / 2, h);
        // 木目
        c.strokeStyle = `rgba(90,50,20,${0.08 + rnd() * 0.08})`;
        c.lineWidth = 1;
        for (let g = 0; g < 5; g++) {
          const y = r * h + 4 + rnd() * (h - 8);
          c.beginPath();
          c.moveTo(x, y);
          c.bezierCurveTo(x + S / 8, y + (rnd() - 0.5) * 6, x + S / 4, y + (rnd() - 0.5) * 6, x + S / 2, y);
          c.stroke();
        }
        c.fillStyle = 'rgba(60,35,15,0.55)';
        c.fillRect(x, r * h, 2, h);
      }
      c.fillStyle = 'rgba(60,35,15,0.5)';
      c.fillRect(0, r * h, S, 2);
    }
  }, repeat);
}

/** 廊下（ワックスがけで、つやのある薄緑の床）。 */
export function corridorFloor(repeat: number): THREE.CanvasTexture {
  return make('corridor', 256, (c, S, rnd) => {
    c.fillStyle = '#cfe3d2';
    c.fillRect(0, 0, S, S);
    for (let i = 0; i < 300; i++) wrapDot(c, S, rnd() * S, rnd() * S, 1 + rnd() * 2, `rgba(120,150,125,${0.15 + rnd() * 0.15})`);
    c.strokeStyle = 'rgba(110,140,115,0.45)';
    c.lineWidth = 2;
    c.strokeRect(1, 1, S - 2, S - 2);
    // 光の反射
    const g = c.createLinearGradient(0, 0, S, S);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.25)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, S, S);
  }, repeat);
}

/** 公園の芝生。 */
export function grass(repeat: number): THREE.CanvasTexture {
  return make('grass', 512, (c, S, rnd) => {
    c.fillStyle = '#7fb455';
    c.fillRect(0, 0, S, S);
    for (let i = 0; i < 90; i++) wrapDot(c, S, rnd() * S, rnd() * S, 18 + rnd() * 40, `rgba(${90 + rnd() * 40},${150 + rnd() * 40},${60 + rnd() * 30},0.25)`);
    for (let i = 0; i < 4000; i++) {
      const x = rnd() * S;
      const y = rnd() * S;
      const l = 3 + rnd() * 6;
      c.strokeStyle = rnd() < 0.5 ? `rgba(60,110,40,${0.3 + rnd() * 0.3})` : `rgba(170,210,110,${0.25 + rnd() * 0.3})`;
      c.lineWidth = 1;
      c.beginPath();
      c.moveTo(x, y);
      c.lineTo(x + (rnd() - 0.5) * 3, y - l);
      c.stroke();
    }
    for (let i = 0; i < 40; i++) wrapDot(c, S, rnd() * S, rnd() * S, 2.2, rnd() < 0.5 ? 'rgba(255,255,255,0.8)' : 'rgba(255,230,90,0.8)');
  }, repeat);
}

/** 公園の砂利道。 */
export function gravel(repeat: number): THREE.CanvasTexture {
  return make('gravel', 256, (c, S, rnd) => {
    c.fillStyle = '#d9c9a4';
    c.fillRect(0, 0, S, S);
    for (let i = 0; i < 900; i++) {
      const t = 150 + rnd() * 80;
      wrapDot(c, S, rnd() * S, rnd() * S, 1 + rnd() * 2.6, `rgba(${t},${t - 15},${t - 40},0.7)`);
    }
  }, repeat);
}

/** アスファルト。 */
export function asphalt(repeat: number): THREE.CanvasTexture {
  return make('asphalt', 512, (c, S, rnd) => {
    c.fillStyle = '#5a5c60';
    c.fillRect(0, 0, S, S);
    for (let i = 0; i < 5000; i++) {
      const t = 60 + rnd() * 70;
      wrapDot(c, S, rnd() * S, rnd() * S, 0.6 + rnd() * 1.4, `rgba(${t},${t},${t + 4},0.6)`);
    }
    for (let i = 0; i < 12; i++) wrapDot(c, S, rnd() * S, rnd() * S, 20 + rnd() * 50, 'rgba(40,40,44,0.12)');
  }, repeat);
}

/** 歩道のタイル。 */
export function sidewalk(repeat: number): THREE.CanvasTexture {
  return make('sidewalk', 256, (c, S, rnd) => {
    const n = 4;
    const w = S / n;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const t = 190 + Math.floor(rnd() * 25);
        c.fillStyle = (i + j) % 2 ? `rgb(${t},${t - 8},${t - 20})` : `rgb(${t - 30},${t - 40},${t - 50})`;
        c.fillRect(i * w, j * w, w, w);
      }
    }
    c.strokeStyle = 'rgba(80,70,60,0.5)';
    c.lineWidth = 2;
    for (let i = 0; i <= n; i++) {
      c.beginPath();
      c.moveTo(i * w, 0);
      c.lineTo(i * w, S);
      c.moveTo(0, i * w);
      c.lineTo(S, i * w);
      c.stroke();
    }
  }, repeat);
}

/** 池の水面（揺らぎの模様）。 */
export function water(repeat: number): THREE.CanvasTexture {
  return make('water', 256, (c, S, rnd) => {
    c.fillStyle = '#3d8fb0';
    c.fillRect(0, 0, S, S);
    for (let i = 0; i < 60; i++) wrapDot(c, S, rnd() * S, rnd() * S, 10 + rnd() * 30, `rgba(${80 + rnd() * 40},${170 + rnd() * 40},${210 + rnd() * 30},0.18)`);
    c.strokeStyle = 'rgba(230,250,255,0.35)';
    c.lineWidth = 2;
    for (let i = 0; i < 40; i++) {
      const x = rnd() * S;
      const y = rnd() * S;
      c.beginPath();
      c.arc(x, y, 6 + rnd() * 14, Math.PI * 1.1, Math.PI * 1.9);
      c.stroke();
    }
  }, repeat);
}

/** ネオン看板（縦書き／横書きの文字）。 */
export function neonSign(text: string, color: string, vertical: boolean): THREE.CanvasTexture {
  const key = `neon:${text}:${color}:${vertical}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const cv = document.createElement('canvas');
  const n = [...text].length;
  cv.width = vertical ? 128 : 128 * n + 64;
  cv.height = vertical ? 128 * n + 64 : 160;
  const c = cv.getContext('2d')!;
  c.fillStyle = '#16121e';
  c.fillRect(0, 0, cv.width, cv.height);
  c.strokeStyle = color;
  c.lineWidth = 6;
  c.strokeRect(6, 6, cv.width - 12, cv.height - 12);
  c.font = `900 96px "Yu Gothic UI", "Meiryo", sans-serif`;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.shadowColor = color;
  c.shadowBlur = 24;
  c.fillStyle = '#fff';
  const chars = [...text];
  chars.forEach((ch, i) => {
    const x = vertical ? cv.width / 2 : 32 + 128 * i + 64;
    const y = vertical ? 32 + 128 * i + 64 : cv.height / 2;
    c.fillText(ch, x, y);
    c.fillText(ch, x, y);
  });
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  cache.set(key, t);
  return t;
}

/** 工事現場の土。 */
export function dirt(repeat: number): THREE.CanvasTexture {
  return make('dirt', 512, (c, S, rnd) => {
    c.fillStyle = '#9a7a56';
    c.fillRect(0, 0, S, S);
    for (let i = 0; i < 70; i++) wrapDot(c, S, rnd() * S, rnd() * S, 15 + rnd() * 45, `rgba(${110 + rnd() * 50},${85 + rnd() * 40},${55 + rnd() * 30},0.3)`);
    for (let i = 0; i < 2500; i++) {
      const t = 80 + rnd() * 90;
      wrapDot(c, S, rnd() * S, rnd() * S, 0.8 + rnd() * 1.8, `rgba(${t + 30},${t + 10},${t - 15},0.6)`);
    }
    // タイヤの跡
    c.strokeStyle = 'rgba(70,52,34,0.25)';
    c.lineWidth = 10;
    for (let k = 0; k < 3; k++) {
      const y = rnd() * S;
      c.beginPath();
      c.moveTo(0, y);
      c.bezierCurveTo(S / 3, y + (rnd() - 0.5) * 80, (S * 2) / 3, y + (rnd() - 0.5) * 80, S, y);
      c.stroke();
    }
  }, repeat);
}

/** 打ちっぱなしのコンクリート（工事中のビルの壁）。win なら窓の穴が開いている。 */
export function concreteWall(win: boolean): THREE.CanvasTexture {
  return make(`concrete:${win}`, 256, (c, S, rnd) => {
    c.fillStyle = '#b4b0a6';
    c.fillRect(0, 0, S, S);
    for (let i = 0; i < 400; i++) wrapDot(c, S, rnd() * S, rnd() * S, 0.6 + rnd() * 1.5, `rgba(90,88,84,${0.2 + rnd() * 0.3})`);
    c.fillStyle = 'rgba(80,78,74,0.5)';
    for (const x of [S / 4, (S * 3) / 4]) for (const y of [S / 4, (S * 3) / 4]) wrapDot(c, S, x, y, 3, 'rgba(70,68,64,0.6)');
    if (win) {
      c.fillStyle = '#2a2c30';
      c.fillRect(S * 0.18, S * 0.22, S * 0.64, S * 0.5);
      c.strokeStyle = '#d8d0b8';
      c.lineWidth = 6;
      c.strokeRect(S * 0.18, S * 0.22, S * 0.64, S * 0.5);
    }
  }, 1);
}

/** 足場にかける青いシート。 */
export function tarp(): THREE.CanvasTexture {
  return make('tarp', 256, (c, S, rnd) => {
    c.fillStyle = '#3a6ad2';
    c.fillRect(0, 0, S, S);
    for (let i = 0; i < 12; i++) {
      c.fillStyle = `rgba(20,40,120,${0.1 + rnd() * 0.15})`;
      c.fillRect(rnd() * S, 0, 6 + rnd() * 20, S);
    }
    c.strokeStyle = 'rgba(255,255,255,0.5)';
    c.lineWidth = 3;
    c.strokeRect(3, 3, S - 6, S - 6);
    c.fillStyle = 'rgba(255,255,255,0.8)';
    for (const [x, y] of [[10, 10], [S - 10, 10], [10, S - 10], [S - 10, S - 10]]) wrapDot(c, S, x, y, 4, 'rgba(240,240,240,0.9)');
  }, 1);
}

/** 神社の壁（朱色の柱と白い壁）。win なら格子窓。 */
export function shrineWall(win: boolean): THREE.CanvasTexture {
  return make(`shrine:${win}`, 256, (c, S) => {
    c.fillStyle = '#f2ead6';
    c.fillRect(0, 0, S, S);
    c.fillStyle = '#c8402a';
    c.fillRect(0, 0, S * 0.12, S);
    c.fillRect(S * 0.88, 0, S * 0.12, S);
    c.fillRect(0, S * 0.86, S, S * 0.14);
    c.fillRect(0, 0, S, S * 0.08);
    if (win) {
      c.fillStyle = '#5a3a22';
      c.fillRect(S * 0.24, S * 0.2, S * 0.52, S * 0.5);
      c.strokeStyle = '#d8b06a';
      c.lineWidth = 4;
      for (let k = 1; k < 5; k++) {
        c.beginPath();
        c.moveTo(S * 0.24 + (S * 0.52 * k) / 5, S * 0.2);
        c.lineTo(S * 0.24 + (S * 0.52 * k) / 5, S * 0.7);
        c.stroke();
      }
    }
  }, 1);
}

/** 屋上の床（防水シートの継ぎ目）。 */
export function roofFloor(repeat: number): THREE.CanvasTexture {
  return make('roof', 256, (c, S, rnd) => {
    c.fillStyle = '#a9b0a8';
    c.fillRect(0, 0, S, S);
    for (let i = 0; i < 900; i++) wrapDot(c, S, rnd() * S, rnd() * S, 0.6 + rnd() * 1.2, `rgba(120,128,120,${0.2 + rnd() * 0.3})`);
    for (let i = 0; i < 8; i++) wrapDot(c, S, rnd() * S, rnd() * S, 10 + rnd() * 25, 'rgba(90,100,95,0.08)');
    c.strokeStyle = 'rgba(80,88,82,0.6)';
    c.lineWidth = 2;
    c.strokeRect(1, 1, S - 2, S - 2);
  }, repeat);
}
