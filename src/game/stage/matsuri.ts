/**
 * 夏祭りの神社（夜）。南の鳥居から北の拝殿まで参道が通り、両側に屋台、まん中にやぐら。
 * 仕掛け: 叩くと音の波が出る大太鼓、敵が踊り出す盆踊り、火の粉が降る花火大会、ぬれる金魚すくいの水槽。
 */
import * as THREE from 'three';
import { log } from '../../log';
import { ZONE } from '../fx';
import type { Game } from '../game';
import { ARENA, WorldMap } from '../world';
import type { Stage } from './index';
import { gravel, shrineWall, sidewalk, water } from './textures';

const YAGURA = { x: 0, z: 6 };
const POOLS: [number, number, number, number][] = [[-22, -12, 3.2, 1.6], [22, 18, 3.2, 1.6]];
const S = { sleep: true };

export function matsuri(g: Game, w: WorldMap): Stage {
  let odoriT = 25;
  let odori = 0;
  let beatT = 0;
  let showT = 45;
  let show = 0;
  let sparkT = 0;
  let drumCd = 0;
  let wetT = 0;
  const inPool = (x: number, z: number) => POOLS.some(([px, pz, hx, hz]) => Math.abs(x - px) < hx && Math.abs(z - pz) < hz);

  return {
    start: { x: 0, z: -46 },
    sky: { top: 0x070c26, mid: 0x231c46, fog: 0x1a1632, fogNear: 45, fogFar: 160, sun: 0x9ab0ff, sunI: 0.9, hemiSky: 0x8a86c0, hemiGround: 0x40283a, hemiI: 1.0 },
    build() {
      // ---- 地面: 砂利の境内と、石畳の参道
      w.floor(new THREE.MeshLambertMaterial({ map: gravel(40), color: 0xb8aa90 }), ARENA * 2 + 60, ARENA * 2 + 60);
      const pave = sidewalk(1);
      pave.repeat.set(2, 60);
      w.floor(new THREE.MeshLambertMaterial({ map: pave, color: 0xc8c0b0 }), 6, 120, 0, -10, 0.02, 1);
      const plaza = new THREE.Mesh(new THREE.CircleGeometry(14, 40), new THREE.MeshLambertMaterial({ color: 0xa89878 }));
      plaza.rotation.x = -Math.PI / 2;
      plaza.position.set(YAGURA.x, 0.025, YAGURA.z);
      w.root.add(plaza);
      w.groundCollider(0.85);
      w.bounds(new THREE.MeshLambertMaterial({ color: 0x3a2a1c }), 2.4);
      w.skyline([0x2a2438, 0x342c48, 0x262036], 4, 14, 90, 0x352040);

      // ---- 拝殿（壊せる）と鳥居
      w.registerWallStyle('shrine', { plain: shrineWall(false), win: shrineWall(true), edge: 0x6a3a22 });
      w.addBuilding(-12, 46, 12, 6, 1, { style: 'shrine', hp: 60, doors: [{ side: 'front', at: 5 }] });
      const red = new THREE.MeshLambertMaterial({ color: 0xd04a2a });
      const black = new THREE.MeshLambertMaterial({ color: 0x1e1a1a });
      for (const tz of [-62, -24, 30]) {
        for (const sx of [-1, 1]) w.staticCyl({ x: sx * 3.6, y: 0, z: tz }, 0.32, 6.2, red, 10);
        const top = new THREE.Mesh(new THREE.BoxGeometry(10, 0.5, 0.7), black);
        top.position.set(0, 6.5, tz);
        const nuki = new THREE.Mesh(new THREE.BoxGeometry(8.6, 0.35, 0.4), red);
        nuki.position.set(0, 5.3, tz);
        w.root.add(top, nuki);
      }

      // ---- 屋台（参道の両側。ところどころプロパンのドラム缶）
      let k = 0;
      for (let z = -54; z <= 26; z += 6.5) {
        if (Math.abs(z - YAGURA.z) < 12 || Math.abs(z + 24) < 2 || Math.abs(z - 30) < 2) continue;
        for (const sx of [-1, 1]) {
          w.spawnProp('yatai', { x: sx * 7.2, y: 0.005, z }, sx > 0 ? Math.PI / 2 : -Math.PI / 2, S);
          if (k++ % 3 === 0) w.spawnProp('barrel', { x: sx * 9.4, y: 0.005, z: z + 0.8 }, 0, S);
        }
      }
      // ---- 石灯籠と提灯
      for (let z = -58; z <= 40; z += 12) for (const sx of [-1, 1]) w.spawnProp('toro', { x: sx * 4.6, y: 0.005, z }, 0, S);
      lanterns(w);
      // ---- やぐらと大太鼓
      const wood = new THREE.MeshLambertMaterial({ color: 0x7a5232 });
      for (const [lx, lz] of [[-2.6, -2.6], [2.6, -2.6], [-2.6, 2.6], [2.6, 2.6]]) w.staticBox({ x: YAGURA.x + lx, y: 1.6, z: YAGURA.z + lz }, { x: 0.2, y: 1.6, z: 0.2 }, 0, wood);
      w.staticBox({ x: YAGURA.x, y: 3.25, z: YAGURA.z }, { x: 3, y: 0.15, z: 3 }, 0, wood);
      const curtain = new THREE.Mesh(new THREE.BoxGeometry(6.1, 0.9, 6.1), new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x402020 }));
      curtain.position.set(YAGURA.x, 2.75, YAGURA.z);
      w.root.add(curtain);
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(6.15, 0.25, 6.15), red);
      stripe.position.set(YAGURA.x, 2.75, YAGURA.z);
      w.root.add(stripe);
      w.spawnProp('taiko', { x: YAGURA.x, y: 0.005, z: YAGURA.z - 5.2 }, 0, {});
      // ---- 金魚すくいの水槽
      const wtex = water(1);
      wtex.repeat.set(2, 1);
      for (const [px, pz, hx, hz] of POOLS) {
        const rim = new THREE.Mesh(new THREE.BoxGeometry(hx * 2 + 0.3, 0.3, hz * 2 + 0.3), new THREE.MeshLambertMaterial({ color: 0x3a7ad2 }));
        rim.position.set(px, 0.12, pz);
        w.root.add(rim);
        w.floor(new THREE.MeshLambertMaterial({ map: wtex, color: 0xcfefff, emissive: 0x102040 }), hx * 2, hz * 2, px, pz, 0.28, 2);
        for (let f = 0; f < 6; f++) {
          const fish = new THREE.Mesh(new THREE.SphereGeometry(0.1, 6, 4), new THREE.MeshBasicMaterial({ color: 0xff6a2a }));
          fish.scale.set(1.6, 0.6, 0.8);
          fish.position.set(px + (Math.random() - 0.5) * hx * 1.6, 0.25, pz + (Math.random() - 0.5) * hz * 1.6);
          w.root.add(fish);
        }
      }
      // ---- 明かり（やぐらと拝殿のまわりだけ）
      const l1 = new THREE.PointLight(0xffa860, 60, 30, 1.6);
      l1.position.set(YAGURA.x, 5, YAGURA.z);
      const l2 = new THREE.PointLight(0xffb070, 50, 28, 1.6);
      l2.position.set(0, 5, 38);
      const l3 = new THREE.PointLight(0xffa860, 40, 26, 1.6);
      l3.position.set(0, 4, -30);
      w.root.add(l1, l2, l3);
    },

    surface(x, z, out) {
      if (inPool(x, z)) {
        out.water = true;
        out.speed = 0.65;
        out.grip = 0.8;
      }
    },

    spawnOk(x, z) {
      return !inPool(x, z) && Math.hypot(x - YAGURA.x, z - YAGURA.z) > 4.5;
    },

    onDrum(p) {
      if (drumCd > 0) return;
      drumCd = 1.2;
      const t = p.body.translation();
      const at = { x: t.x, y: 0.5, z: t.z };
      let n = 0;
      g.enemies.inRadius(at, 10, (e, d) => {
        const inv = 1 / Math.max(0.6, d);
        const k = (1 - d / 12) * 14;
        g.enemies.damage(e, 12 * g.stats.power, 'skill', { impulse: { x: (e.x - at.x) * inv * k, y: 4, z: (e.z - at.z) * inv * k } });
        n++;
      });
      g.fx.ring(at, 1, 10, ZONE.ally, 0.45);
      g.fx.ring({ x: at.x, y: 1.5, z: at.z }, 1, 8, ZONE.ally, 0.35, 0.5);
      g.fx.shake('M');
      g.audio.thud(1.6);
      g.fx.number({ x: t.x, y: t.y + 2.5, z: t.z }, 'ドーン！', 'info');
      log('matsuri.drum', {}, { hit: n, time: Math.round(g.time) });
    },

    update(dt) {
      drumCd -= dt;
      // ---- 金魚すくいの水槽: 入った敵はぬれる
      wetT -= dt;
      if (wetT <= 0) {
        wetT = 0.2;
        for (const e of g.enemies.list) if (e.state !== 'dead' && inPool(e.x, e.z)) g.enemies.wetIt(e, 5);
      }
      // ---- 盆踊り: まわりの敵が踊り出して動けなくなる
      odoriT -= dt;
      if (odoriT <= 0 && odori <= 0) {
        odori = 4.5;
        odoriT = 34 + Math.random() * 6;
        g.hud.toast('盆踊りの時間です！ 敵が踊り出した！', 'praise');
        log('matsuri.odori', {}, { time: Math.round(g.time) });
      }
      if (odori > 0) {
        odori -= dt;
        beatT -= dt;
        if (beatT <= 0) {
          beatT = 0.5;
          g.audio.thud(0.5);
        }
        g.enemies.inRadius({ x: g.player.pos.x, y: 0, z: g.player.pos.z }, 30, (e) => {
          if (e.def.boss) return;
          e.stagger = Math.max(e.stagger, 0.15);
          e.stopShake = 0.1;
          if (Math.random() < dt * 2) g.fx.sparkle({ x: e.x, y: e.y + 1, z: e.z }, 0xffd0f0, 1, 0.3);
        });
      }
      // ---- 花火大会: 拝殿の奥から打ち上がり、ノリコのまわりに火の粉が降る（赤い円に入ると熱い）
      showT -= dt;
      if (showT <= 0 && show <= 0) {
        show = 7;
        showT = 40 + Math.random() * 8;
        g.hud.toast('花火大会が始まった！ 赤い円の火の粉に注意！', 'warn');
        log('matsuri.hanabi', {}, { time: Math.round(g.time) });
      }
      if (show > 0) {
        show -= dt;
        sparkT -= dt;
        if (sparkT <= 0) {
          sparkT = 0.45;
          const colors = [0xff5a8a, 0xffd84a, 0x6ad0ff, 0x9aff6a];
          const sky = { x: (Math.random() - 0.5) * 40, y: 26 + Math.random() * 8, z: 50 + Math.random() * 10 };
          const c = colors[Math.floor(Math.random() * colors.length)];
          for (let i = 0; i < 30; i++) {
            const a = Math.random() * Math.PI * 2;
            const b = Math.acos(Math.random() * 2 - 1);
            const sp = 9 + Math.random() * 3;
            g.fx.spawn({ pos: sky, vel: { x: Math.sin(b) * Math.cos(a) * sp, y: Math.cos(b) * sp, z: Math.sin(b) * Math.sin(a) * sp }, grav: -5, drag: 1.2, life: 1.2, size: 0.9, size2: 0.2, color: c, color2: 0xffffff, shape: 7, alpha: 1 });
          }
          g.audio.explode(0.3);
          const p = g.player.pos;
          for (let k = 0; k < 2; k++) {
            const near = k === 0 && Math.random() < 0.4;
            const a = Math.random() * Math.PI * 2;
            const r = near ? Math.random() * 2 : 3 + Math.random() * 11;
            g.enemies.shell(sky, { x: p.x + Math.cos(a) * r, z: p.z + Math.sin(a) * r }, 1.3, 2, 2.4, 22, '花火の火の粉', { emoji: '✨', element: 'fire' });
          }
        }
      }
    },
  };
}

/** 参道に沿って、提灯を吊った綱を張る（見た目だけ）。 */
function lanterns(w: WorldMap): void {
  const n = 120;
  const mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.28, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff }), n);
  const m = new THREE.Matrix4();
  const c = new THREE.Color();
  const pole = new THREE.MeshLambertMaterial({ color: 0x5a4030 });
  let i = 0;
  for (const sx of [-1, 1]) {
    for (let z = -60; z <= 40; z += 10) {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 4.4, 6), pole);
      p.position.set(sx * 10.5, 2.2, z);
      w.root.add(p);
      for (let k = 0; k < 5 && i < n; k++) {
        const zz = z + k * 2;
        const sag = Math.sin((k / 5) * Math.PI) * 0.5;
        m.makeScale(1, 1.3, 1).setPosition(sx * 10.5, 4.1 - sag, zz);
        mesh.setMatrixAt(i, m);
        mesh.setColorAt(i, c.setHex(k % 2 ? 0xffffff : 0xff4a3a));
        i++;
      }
    }
  }
  mesh.count = i;
  w.root.add(mesh);
}
