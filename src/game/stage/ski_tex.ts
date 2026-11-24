/**
 * 雪山のスキー場の模様（canvas で描く）。雪面・ロッジの丸太の壁・安全ネット。
 * 繰り返して貼る模様は、上下左右の端がつながるように描く。
 */
import * as THREE from 'three';
import { makeRng } from '../rules';

type Draw = (c: CanvasRenderingContext2D, S: number, rnd: () => number) => void;

const cache = new Map<string, THREE.CanvasTexture>();

function make(key: string, S: number, draw: Draw, repeat: number, transparent = false): THREE.CanvasTexture {
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
  if (transparent) c.clearRect(0, 0, S, S);
  draw(c, S, makeRng(key.length * 7919 + 31));
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  t.repeat.set(repeat, repeat);
  cache.set(key, t);
  return t;
}

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

/** 雪面。少し青みのある白に、うすい影のむらと、きらきらした粒。 */
export function snowTex(repeat: number): THREE.CanvasTexture {
  return make('ski:snow', 512, (c, S, rnd) => {
    c.fillStyle = '#e4ebf3';
    c.fillRect(0, 0, S, S);
    // 影のむらは大きく薄く（丸い模様が目立たないように、たくさん重ねる）
    for (let i = 0; i < 160; i++) wrapDot(c, S, rnd() * S, rnd() * S, 30 + rnd() * 80, `rgba(${175 + rnd() * 25},${192 + rnd() * 20},${222 + rnd() * 18},0.05)`);
    for (let i = 0; i < 120; i++) wrapDot(c, S, rnd() * S, rnd() * S, 20 + rnd() * 60, 'rgba(255,255,255,0.07)');
    // 風紋（細い筋）
    c.strokeStyle = 'rgba(170,190,220,0.18)';
    c.lineWidth = 1.2;
    for (let i = 0; i < 26; i++) {
      const y = rnd() * S;
      c.beginPath();
      c.moveTo(0, y);
      for (let x = 0; x <= S; x += 32) c.lineTo(x, y + Math.sin((x / S) * Math.PI * 2 + i) * 4);
      c.stroke();
    }
    for (let i = 0; i < 1800; i++) wrapDot(c, S, rnd() * S, rnd() * S, 0.5 + rnd() * 1.1, rnd() < 0.7 ? 'rgba(255,255,255,0.9)' : 'rgba(160,182,212,0.45)');
  }, repeat);
}

/** ロッジ・小屋の丸太の壁。win なら窓（中は暖かい明かり、窓枠に雪）。 */
export function lodgeWall(win: boolean): THREE.CanvasTexture {
  return make(`ski:lodge:${win}`, 256, (c, S, rnd) => {
    const rows = 6;
    const h = S / rows;
    for (let r = 0; r < rows; r++) {
      const y = r * h;
      const g = c.createLinearGradient(0, y, 0, y + h);
      const tone = Math.floor(rnd() * 16);
      g.addColorStop(0, `rgb(${96 + tone},${62 + tone},${36 + tone})`);
      g.addColorStop(0.45, `rgb(${150 + tone},${102 + tone},${62 + tone})`);
      g.addColorStop(1, `rgb(${84 + tone},${52 + tone},${30 + tone})`);
      c.fillStyle = g;
      c.fillRect(0, y, S, h);
      c.fillStyle = 'rgba(40,24,12,0.8)';
      c.fillRect(0, y + h - 3, S, 3);
      // 節
      for (let k = 0; k < 2; k++) wrapDot(c, S, rnd() * S, y + h * (0.35 + rnd() * 0.3), 2 + rnd() * 3, 'rgba(60,36,18,0.7)');
    }
    // 木目の筋
    c.strokeStyle = 'rgba(60,36,18,0.25)';
    c.lineWidth = 1;
    for (let i = 0; i < 40; i++) {
      const y = rnd() * S;
      c.beginPath();
      c.moveTo(0, y);
      c.lineTo(S, y + (rnd() - 0.5) * 4);
      c.stroke();
    }
    if (win) {
      const x0 = S * 0.2;
      const y0 = S * 0.18;
      const w = S * 0.6;
      const hh = S * 0.52;
      const glow = c.createLinearGradient(0, y0, 0, y0 + hh);
      glow.addColorStop(0, '#3a4a5a');
      glow.addColorStop(0.55, '#c88a40');
      glow.addColorStop(1, '#f2c070');
      c.fillStyle = glow;
      c.fillRect(x0, y0, w, hh);
      c.strokeStyle = '#f4f0e6';
      c.lineWidth = 7;
      c.strokeRect(x0, y0, w, hh);
      c.lineWidth = 4;
      c.beginPath();
      c.moveTo(x0 + w / 2, y0);
      c.lineTo(x0 + w / 2, y0 + hh);
      c.moveTo(x0, y0 + hh / 2);
      c.lineTo(x0 + w, y0 + hh / 2);
      c.stroke();
      // 窓枠に積もった雪
      c.fillStyle = '#f6f9fc';
      c.beginPath();
      c.ellipse(S / 2, y0 + hh + 6, w * 0.56, 9, 0, 0, Math.PI * 2);
      c.fill();
    }
  }, 1);
}

/** コースの端に張るオレンジの安全ネット（網目の外は透明）。 */
export function netTex(): THREE.CanvasTexture {
  return make('ski:net', 64, (c, S) => {
    c.strokeStyle = 'rgba(255,110,30,0.95)';
    c.lineWidth = 3;
    for (let k = -S; k <= S * 2; k += S / 4) {
      c.beginPath();
      c.moveTo(k, 0);
      c.lineTo(k + S, S);
      c.moveTo(k + S, 0);
      c.lineTo(k, S);
      c.stroke();
    }
    c.fillStyle = 'rgba(255,110,30,0.95)';
    c.fillRect(0, 0, S, 4);
  }, 1, true);
}
