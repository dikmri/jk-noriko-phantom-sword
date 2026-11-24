/**
 * 温泉街の模様（canvas で描く）。旅館の板張りの壁と障子窓、石垣、石段、石畳、のれん付きの看板。
 */
import * as THREE from 'three';
import { makeRng } from '../rules';

type Draw = (c: CanvasRenderingContext2D, W: number, H: number, rnd: () => number) => void;

const cache = new Map<string, THREE.CanvasTexture>();

function make(key: string, W: number, H: number, draw: Draw, wrap = true): THREE.CanvasTexture {
  const hit = cache.get(key);
  if (hit) return hit;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const c = cv.getContext('2d')!;
  draw(c, W, H, makeRng(key.length * 104729 + 7));
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  if (wrap) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  cache.set(key, t);
  return t;
}

/** 旅館の壁: 黒い焼杉の板張り。win なら障子窓（夕方なので内側の明かりで少し黄色い）。 */
export function ryokanWall(win: boolean): THREE.CanvasTexture {
  return make(`ryokan:${win}`, 256, 256, (c, W, H, rnd) => {
    // 板張り（縦の板）
    for (let x = 0; x < W; x += 16) {
      const t = 34 + Math.floor(rnd() * 16);
      c.fillStyle = `rgb(${t + 6},${t},${t - 4})`;
      c.fillRect(x, 0, 16, H);
      c.fillStyle = 'rgba(0,0,0,0.45)';
      c.fillRect(x, 0, 2, H);
      for (let k = 0; k < 6; k++) {
        c.fillStyle = `rgba(90,70,50,${0.12 + rnd() * 0.1})`;
        c.fillRect(x + 3 + rnd() * 10, rnd() * H, 1, 20 + rnd() * 40);
      }
    }
    // 柱と腰の横木（明るい木）
    c.fillStyle = '#7a5434';
    c.fillRect(0, 0, 14, H);
    c.fillRect(W - 14, 0, 14, H);
    c.fillRect(0, H - 22, W, 12);
    c.fillRect(0, 0, W, 10);
    if (win) {
      const x0 = W * 0.2;
      const y0 = H * 0.18;
      const ww = W * 0.6;
      const hh = H * 0.52;
      c.fillStyle = '#fff0c8';
      c.fillRect(x0, y0, ww, hh);
      // 明かりのにじみ
      const gr = c.createRadialGradient(W / 2, y0 + hh / 2, 4, W / 2, y0 + hh / 2, ww * 0.6);
      gr.addColorStop(0, 'rgba(255,214,140,0.55)');
      gr.addColorStop(1, 'rgba(255,214,140,0)');
      c.fillStyle = gr;
      c.fillRect(x0, y0, ww, hh);
      // 障子の桟
      c.strokeStyle = '#6a4a2c';
      c.lineWidth = 3;
      for (let k = 1; k < 4; k++) {
        c.beginPath();
        c.moveTo(x0 + (ww * k) / 4, y0);
        c.lineTo(x0 + (ww * k) / 4, y0 + hh);
        c.stroke();
      }
      for (let k = 1; k < 5; k++) {
        c.beginPath();
        c.moveTo(x0, y0 + (hh * k) / 5);
        c.lineTo(x0 + ww, y0 + (hh * k) / 5);
        c.stroke();
      }
      c.lineWidth = 7;
      c.strokeStyle = '#5a3a20';
      c.strokeRect(x0, y0, ww, hh);
    }
  });
}

/** 石垣（大きさの違う石を積む）。u が横、v が縦。 */
export function ishigaki(): THREE.CanvasTexture {
  return make('ishigaki', 256, 256, (c, W, H, rnd) => {
    c.fillStyle = '#5c5850';
    c.fillRect(0, 0, W, H);
    const rows = 5;
    const rh = H / rows;
    for (let r = 0; r < rows; r++) {
      let x = r % 2 ? -rh * 0.5 : 0;
      while (x < W) {
        const w = rh * (0.9 + rnd() * 0.9);
        const t = 128 + Math.floor(rnd() * 50);
        c.fillStyle = `rgb(${t},${t - 4},${t - 14})`;
        const pad = 3;
        // 端をまたぐ石は反対側にも描く（繰り返したときに継ぎ目が出ないように）
        for (const ox of [0, W, -W]) {
          c.beginPath();
          c.moveTo(x + ox + pad + 4, r * rh + pad);
          c.lineTo(x + ox + w - pad, r * rh + pad + 2);
          c.lineTo(x + ox + w - pad - 2, (r + 1) * rh - pad);
          c.lineTo(x + ox + pad, (r + 1) * rh - pad - 3);
          c.closePath();
          c.fill();
        }
        c.fillStyle = 'rgba(255,255,255,0.08)';
        c.fillRect(x + pad + 4, r * rh + pad, w - 12, 5);
        x += w;
      }
    }
    // 苔
    for (let i = 0; i < 40; i++) {
      c.fillStyle = `rgba(80,110,50,${0.12 + rnd() * 0.15})`;
      c.beginPath();
      c.arc(rnd() * W, rnd() * H, 4 + rnd() * 10, 0, Math.PI * 2);
      c.fill();
    }
  });
}

/** 石段（v 方向に段が並ぶ。1 枚で 4 段）。 */
export function stoneStairs(): THREE.CanvasTexture {
  return make('stairs', 128, 256, (c, W, H, rnd) => {
    const n = 4;
    const sh = H / n;
    for (let k = 0; k < n; k++) {
      const t = 150 + Math.floor(rnd() * 25);
      c.fillStyle = `rgb(${t},${t - 6},${t - 18})`;
      c.fillRect(0, k * sh, W, sh);
      // 段の角（影）
      c.fillStyle = 'rgba(40,34,28,0.55)';
      c.fillRect(0, k * sh, W, 5);
      c.fillStyle = 'rgba(255,255,255,0.15)';
      c.fillRect(0, k * sh + 5, W, 3);
      for (let i = 0; i < 50; i++) {
        c.fillStyle = `rgba(70,64,56,${0.15 + rnd() * 0.2})`;
        c.fillRect(rnd() * W, k * sh + 8 + rnd() * (sh - 10), 2, 2);
      }
    }
    c.fillStyle = 'rgba(60,54,46,0.6)';
    c.fillRect(0, 0, 6, H);
    c.fillRect(W - 6, 0, 6, H);
  });
}

/** 石畳（大通り）。 */
export function cobble(): THREE.CanvasTexture {
  return make('cobble', 256, 256, (c, W, H, rnd) => {
    c.fillStyle = '#4a4640';
    c.fillRect(0, 0, W, H);
    const n = 6;
    const s = W / n;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const ox = j % 2 ? s / 2 : 0;
        const t = 140 + Math.floor(rnd() * 40);
        c.fillStyle = `rgb(${t},${t - 8},${t - 22})`;
        for (const wx of [0, -W]) c.fillRect(i * s + ox + wx + 2, j * s + 2, s - 4, s - 4);
      }
    }
    for (let i = 0; i < 300; i++) {
      c.fillStyle = `rgba(60,56,50,${0.1 + rnd() * 0.2})`;
      c.fillRect(rnd() * W, rnd() * H, 2, 2);
    }
  });
}

/** 文字を書いた看板（縦書き）。 */
export function signBoard(text: string, bg: string, fg: string): THREE.CanvasTexture {
  return make(`sign:${text}:${bg}`, 128, 64 * text.length + 32, (c, W, H) => {
    c.fillStyle = bg;
    c.fillRect(0, 0, W, H);
    c.strokeStyle = fg;
    c.lineWidth = 6;
    c.strokeRect(6, 6, W - 12, H - 12);
    c.fillStyle = fg;
    c.font = 'bold 60px "Yu Mincho", "Hiragino Mincho ProN", serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    for (let i = 0; i < text.length; i++) c.fillText(text[i], W / 2, 16 + 64 * i + 34);
  }, false);
}
