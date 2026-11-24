/**
 * 校舎の中（1 階）。中央の廊下（ワックスがけ）と、十字に交わる廊下。まわりに教室・体育館・図書室など。
 * 仕掛け: 滑る廊下、飛び回る消火器、毒ガスが出る薬品、ドミノ倒しの本棚とロッカー、跳ね上げるロイター板。
 */
import * as THREE from 'three';
import type { Enemy } from '../enemies';
import type { Game } from '../game';
import { ARENA, WorldMap } from '../world';
import type { Stage } from './index';
import { corridorFloor, woodFloor } from './textures';
import { boxPile } from './yard';

/** 廊下の半分の幅 (m) */
const HALL = 5;
/** ワックスがけの廊下での「向きや速さを変える効き」（小さいほど滑る） */
const WAX_GRIP = 0.12;

const S = { sleep: true };

type Side = 's' | 'n' | 'w' | 'e';

export function campus(g: Game, w: WorldMap): Stage {
  const onWax = new Set<Enemy>();
  let waxT = 0;
  const boards: { x: number; z: number; cd: number }[] = [];
  const wax = (x: number, z: number) => Math.abs(z) < HALL && Math.abs(x) < ARENA;

  /** 四角い部屋の壁。open は各辺の、始点からの距離（出入口の中心）。 */
  const room = (x0: number, z0: number, x1: number, z1: number, open: Partial<Record<Side, number[]>>) => {
    const op = (arr?: number[]) => (arr ?? []).map((t) => [t - 2.2, t + 2.2] as [number, number]);
    w.addWallLine(x0, z0, x1, z0, 1, { win: true, openings: op(open.s) });
    w.addWallLine(x0, z1, x1, z1, 1, { win: true, openings: op(open.n) });
    w.addWallLine(x0, z0, x0, z1, 1, { win: true, openings: op(open.w) });
    w.addWallLine(x1, z0, x1, z1, 1, { win: true, openings: op(open.e) });
  };

  /** 普通教室: 机といすを 5×5 に並べ、黒板と教卓を置く。board は黒板のある辺（東か西）。 */
  const classroom = (x0: number, z0: number, x1: number, z1: number, board: 'w' | 'e') => {
    const cz = (z0 + z1) / 2;
    const dir = board === 'w' ? -1 : 1;
    const bx = board === 'w' ? x0 + 0.5 : x1 - 0.5;
    w.spawnProp('blackboard', { x: bx, y: 0.6, z: cz }, Math.PI / 2, S);
    w.spawnProp('desk', { x: bx - dir * 3, y: 0.005, z: cz }, Math.PI / 2, { sleep: true, scale: 1.4 });
    for (let i = 0; i < 5; i++) {
      for (let j = 0; j < 5; j++) {
        const x = bx - dir * (7 + i * 3.6);
        const z = cz + (j - 2) * 4.2;
        // 机は黒板の方を向く。いすはその後ろ
        w.spawnProp('desk', { x, y: 0.005, z }, Math.PI / 2, S);
        w.spawnProp('chair', { x: x - dir * 0.8, y: 0.005, z }, dir > 0 ? -Math.PI / 2 : Math.PI / 2, S);
      }
    }
  };

  return {
    start: { x: 0, z: 0 },
    sky: { top: 0x7fb6e8, mid: 0xdcecf8, fog: 0xe6eef4, fogNear: 60, fogFar: 170, sun: 0xfff3e0, sunI: 2.1, hemiSky: 0xffffff, hemiGround: 0xc9b89a, hemiI: 1.35 },
    build() {
      // ---- 床
      w.floor(new THREE.MeshLambertMaterial({ map: woodFloor(36) }), ARENA * 2 + 60, ARENA * 2 + 60);
      const hall = new THREE.MeshLambertMaterial({ map: corridorFloor(1), color: 0xffffff });
      (hall.map as THREE.Texture).repeat.set(ARENA, 2);
      w.floor(hall, ARENA * 2, HALL * 2, 0, 0, 0.02, 1);
      const hall2 = new THREE.MeshLambertMaterial({ map: corridorFloor(1) });
      (hall2.map as THREE.Texture).repeat.set(2, ARENA);
      w.floor(hall2, HALL * 2, ARENA * 2, 0, 0, 0.015, 1);
      // ワックスのつや（廊下の上に、光る帯を重ねる）
      const shine = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.18, depthWrite: false });
      w.floor(shine, ARENA * 2, HALL * 1.2, 0, 0, 0.03, 2);
      gymFloor(w);
      w.groundCollider(0.7);
      w.bounds(new THREE.MeshLambertMaterial({ color: 0xe9dfc8 }), 3.7);
      w.skyline([0xf2e6d0, 0xe8e8e8, 0xd9e6f2], 6, 16, 60);

      // ---- 部屋（北西: 教室 2 つと図書室、北東: 体育館、南西: 理科室・音楽室・教室、南東: 教室 2 つと昇降口）
      room(-68, 7, -38, 37, { s: [6, 24], e: [15], n: [15] });
      room(-36, 7, -7, 37, { s: [5, 23], w: [15], e: [8, 22] });
      room(-68, 41, -7, 68, { s: [10, 30, 50], e: [13] });
      room(7, 7, 68, 68, { s: [10, 30, 50], w: [10, 30, 50] });
      room(-68, -37, -38, -7, { n: [6, 24], e: [15] });
      room(-36, -37, -7, -7, { n: [5, 23], w: [15], e: [15] });
      room(-68, -68, -7, -41, { n: [10, 30, 50], e: [13] });
      room(7, -37, 37, -7, { n: [6, 24], w: [15], e: [15] });
      room(39, -37, 68, -7, { n: [6, 23], w: [15] });
      room(7, -68, 68, -41, { n: [10, 30, 50], w: [13] });

      // ---- 教室
      classroom(-68, 7, -38, 37, 'w');
      classroom(-36, 7, -7, 37, 'e');
      classroom(7, -37, 37, -7, 'w');
      classroom(39, -37, 68, -7, 'e');
      // 1-C（横に長い教室）
      for (let i = 0; i < 8; i++) {
        for (let j = 0; j < 4; j++) {
          const x = -62 + i * 6.6;
          const z = -63 + j * 5.4;
          w.spawnProp('desk', { x, y: 0.005, z }, 0, S);
          w.spawnProp('chair', { x, y: 0.005, z: z - 0.8 }, 0, S);
        }
      }
      w.spawnProp('blackboard', { x: -37, y: 0.6, z: -41.6 }, Math.PI, S);

      // ---- 理科室: 実験台と、割れると毒ガスが出る薬品
      for (let i = 0; i < 2; i++) {
        for (let j = 0; j < 3; j++) {
          const x = -60 + i * 13;
          const z = -30 + j * 8.5;
          w.spawnProp('labtable', { x, y: 0.005, z }, 0, S);
          for (let k = 0; k < 3; k++) w.spawnProp('flask', { x: x - 0.55 + k * 0.5, y: 0.93, z: z + (k % 2) * 0.2 - 0.1 }, 0, S);
        }
      }
      for (let k = 0; k < 3; k++) w.spawnProp('barrel', { x: -66, y: 0.005, z: -35 + k * 0.75 }, 0, S);

      // ---- 音楽室: グランドピアノ（重い。吹き飛ばすと凶器）
      w.spawnProp('piano', { x: -14, y: 0.005, z: -30 }, Math.PI * 0.85, S);
      w.spawnProp('piano', { x: -30, y: 0.005, z: -14 }, Math.PI * 0.3, S);
      for (let i = 0; i < 4; i++) for (let j = 0; j < 5; j++) w.spawnProp('chair', { x: -31 + j * 4, y: 0.005, z: -28 + i * 3.6 }, Math.PI, S);

      // ---- 図書室: 本棚の列（ドミノ倒し）
      for (let r = 0; r < 4; r++) {
        for (let k = 0; k < 9; k++) w.spawnProp('shelf', { x: -62 + k * 1.15, y: 0.005, z: 47 + r * 5.2 }, 0, S);
        for (let k = 0; k < 9; k++) w.spawnProp('shelf', { x: -34 + k * 1.15, y: 0.005, z: 47 + r * 5.2 }, 0, S);
      }
      for (let k = 0; k < 4; k++) w.spawnProp('desk', { x: -14 + (k % 2) * 3, y: 0.005, z: 50 + Math.floor(k / 2) * 6 }, 0, { sleep: true, scale: 1.4 });

      // ---- 体育館: ゴール・ボール・跳び箱・マット・ロイター板
      hoop(w, 9, 37.5, 1);
      hoop(w, 66, 37.5, -1);
      for (let k = 0; k < 12; k++) w.spawnProp('ball', { x: 20 + (k % 4) * 9, y: 0.02, z: 20 + Math.floor(k / 4) * 13 }, 0, S);
      for (let k = 0; k < 4; k++) w.spawnProp('tobibako', { x: 22 + k * 8, y: 0.005, z: 58 }, 0, S);
      for (let k = 0; k < 6; k++) w.spawnProp('mat', { x: 20 + (k % 3) * 12, y: 0.005, z: 14 + Math.floor(k / 3) * 3 }, 0, S);
      for (const [x, z] of [[24, 44], [44, 26], [54, 52]]) {
        boards.push({ x, z, cd: 0 });
        springboard(w, x, z);
      }

      // ---- 昇降口: 下駄箱（ロッカー）の列と自販機。ロッカーは USDCraft の物（叩くと扉が開いて前の敵をはたく）
      for (let r = 0; r < 3; r++) for (let k = 0; k < 11; k++) w.spawnProp('u_locker', { x: 14 + k * 0.92 + r * 14, y: 0.005, z: -52 + (r % 2) * 5 }, Math.PI, S);
      w.spawnProp('vending', { x: 64, y: 0.005, z: -60 }, -Math.PI / 2, S);
      w.spawnProp('vending', { x: 64, y: 0.005, z: -62.6 }, -Math.PI / 2, S);

      // ---- 廊下: 消火器と「清掃中」の看板、段ボール
      for (let x = -63; x <= 63; x += 14) {
        if (Math.abs(x) < 8) continue;
        w.spawnProp('extinguisher', { x, y: 0.005, z: HALL - 0.4 }, 0, S);
        w.spawnProp('extinguisher', { x: x + 7, y: 0.005, z: -HALL + 0.4 }, 0, S);
      }
      for (let z = -63; z <= 63; z += 14) {
        if (Math.abs(z) < 8) continue;
        w.spawnProp('extinguisher', { x: HALL - 0.4, y: 0.005, z }, 0, S);
        w.spawnProp('extinguisher', { x: -HALL + 0.4, y: 0.005, z: z + 7 }, 0, S);
      }
      for (const x of [-30, 18, 50]) w.spawnProp('sign', { x, y: 0.005, z: 1.5 }, Math.PI / 2, S);
      const nBox = Math.round(3 * g.rule.clutter);
      for (let i = 0; i < nBox; i++) boxPile(w, -50 + i * 33, 3, 2);
      const nBarrel = Math.round(2 * g.rule.barrels) - 2;
      for (let i = 0; i < nBarrel; i++) w.spawnProp('barrel', { x: -20 + i * 12, y: 0.005, z: -2 }, 0, S);
    },

    surface(x, z, out) {
      if (wax(x, z)) out.grip = WAX_GRIP;
    },

    update(dt) {
      // ワックスの上では、吹き飛んだ敵もよく滑る（摩擦を下げる）
      waxT -= dt;
      if (waxT <= 0) {
        waxT = 0.1;
        const base = 0.35 * g.rule.friction;
        for (const e of g.enemies.list) {
          if (!e.alive) continue;
          const inside = wax(e.x, e.z);
          if (inside && !onWax.has(e)) {
            onWax.add(e);
            if (e.frozen <= 0) e.col.setFriction(0.02);
          } else if (!inside && onWax.has(e)) {
            onWax.delete(e);
            if (e.frozen <= 0) e.col.setFriction(base);
          }
        }
        for (const e of onWax) if (!e.alive) onWax.delete(e);
      }
      // ロイター板: 踏んだ敵（とノリコ）を跳ね上げる
      for (const b of boards) {
        if (b.cd > 0) b.cd -= dt;
        for (const e of g.enemies.list) {
          if (e.state !== 'walk' || e.def.boss) continue;
          if (Math.hypot(e.x - b.x, e.z - b.z) > 1.1 + e.radius) continue;
          if (e.cd && (e.cd.get('board') ?? 0) > 0) continue;
          (e.cd ??= new Map()).set('board', 1.5);
          const v = e.body.linvel();
          const sp = Math.hypot(v.x, v.z) || 1;
          g.enemies.push(e, { x: (v.x / sp) * 5, y: 17, z: (v.z / sp) * 5 });
          g.fx.number({ x: e.x, y: e.y + 1.2, z: e.z }, 'ぴょーん', 'info');
          g.audio.jump();
          b.cd = 0.15;
        }
        const p = g.player;
        if (p.grounded && b.cd <= 0 && Math.hypot(p.pos.x - b.x, p.pos.z - b.z) < 1.1) {
          p.vy = 15;
          p.grounded = false;
          b.cd = 0.6;
          g.audio.jump();
        }
      }
    },

    dispose() {
      onWax.clear();
    },
  };
}

/** 体育館の床（明るい板の床に、コートの線）。 */
function gymFloor(w: WorldMap): void {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 1024;
  const c = cv.getContext('2d')!;
  c.fillStyle = 'rgba(255,236,190,0.35)';
  c.fillRect(0, 0, 1024, 1024);
  c.lineWidth = 6;
  c.strokeStyle = 'rgba(230,60,60,0.9)';
  c.strokeRect(80, 80, 864, 864);
  c.beginPath();
  c.moveTo(512, 80);
  c.lineTo(512, 944);
  c.stroke();
  c.beginPath();
  c.arc(512, 512, 110, 0, Math.PI * 2);
  c.stroke();
  c.strokeStyle = 'rgba(40,110,220,0.9)';
  for (const x of [80, 944]) {
    c.beginPath();
    c.arc(x, 512, 300, x < 512 ? -Math.PI / 2 : Math.PI / 2, x < 512 ? Math.PI / 2 : Math.PI * 1.5);
    c.stroke();
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  w.floor(new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false }), 60, 60, 37.5, 37.5, 0.025, 1);
}

/** バスケットゴール（動かない）。dir はボードが向く側（+1 で +X）。 */
function hoop(w: WorldMap, x: number, z: number, dir: number): void {
  const white = new THREE.MeshLambertMaterial({ color: 0xf4f4f4 });
  const red = new THREE.MeshLambertMaterial({ color: 0xe04020 });
  w.staticBox({ x: x - dir * 0.6, y: 1.6, z }, { x: 0.1, y: 1.6, z: 0.1 }, 0, new THREE.MeshLambertMaterial({ color: 0x404048 }));
  w.staticBox({ x, y: 3.3, z }, { x: 0.05, y: 0.6, z: 0.9 }, 0, white);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.025, 6, 16), red);
  ring.rotation.x = Math.PI / 2;
  ring.position.set(x + dir * 0.35, 3.0, z);
  w.root.add(ring);
}

/** ロイター板（踏み切り板）の見た目。当たり判定は無く、update で踏んだかを調べる。 */
function springboard(w: WorldMap, x: number, z: number): void {
  const geo = new THREE.BoxGeometry(1.6, 0.16, 1.0);
  const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: 0xd9a35a }));
  m.position.set(x, 0.1, z);
  m.rotation.z = 0.08;
  m.receiveShadow = true;
  w.root.add(m);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.62, 0.02, 0.12), new THREE.MeshLambertMaterial({ color: 0xffffff }));
  stripe.position.set(x, 0.19, z);
  w.root.add(stripe);
}
