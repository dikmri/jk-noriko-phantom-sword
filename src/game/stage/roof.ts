/**
 * 校舎の屋上。東西の端には柵が無く、吹き飛ばした敵は下へ落ちる。
 * 仕掛け: 敵を落とす（場外）、ときどき吹く突風、壊すと水があふれる給水塔、重い室外機。
 */
import * as THREE from 'three';
import { G, groups, RAPIER } from '../../core/physics';
import { log } from '../../log';
import type { Enemy } from '../enemies';
import type { Game } from '../game';
import type { WorldMap } from '../world';
import { DAY_SKY, Stage } from './index';
import { roofFloor } from './textures';
import { boxPile } from './yard';

/** 屋上の半分の大きさ (m) */
const RX = 46;
const RZ = 34;
/** 下の地面の高さ */
const BELOW = -16;
const S = { sleep: true };

export function roof(g: Game, w: WorldMap): Stage {
  const fell = new WeakSet<Enemy>();
  let falls = 0;
  let gustT = 18;
  let phase: 'calm' | 'warn' | 'blow' = 'calm';
  let dir = 1;
  let pushT = 0;

  return {
    start: { x: 0, z: 0 },
    sky: { ...DAY_SKY, fogNear: 90, fogFar: 230 },
    build() {
      // ---- 屋上の床と、下に見える校舎・校庭
      const map = roofFloor(1);
      map.repeat.set(RX / 3, RZ / 3);
      w.floor(new THREE.MeshLambertMaterial({ map }), RX * 2, RZ * 2);
      w.staticCollider(RAPIER.ColliderDesc.cuboid(RX, 1, RZ).setTranslation(0, -1, 0).setCollisionGroups(groups(G.STATIC, 0xffff)).setFriction(0.85), 'ground');
      const yardTex = g.assets.tex('ground.jpg');
      yardTex.repeat.set(40, 40);
      w.floor(new THREE.MeshLambertMaterial({ map: yardTex, color: 0xd8dcd8 }), 520, 520, 0, 0, BELOW);
      const wallTex = g.assets.tex('wall_window.jpg').clone();
      wallTex.wrapS = wallTex.wrapT = THREE.RepeatWrapping;
      wallTex.repeat.set(RX / 1.5, -BELOW / 3.7);
      wallTex.needsUpdate = true;
      const body = new THREE.Mesh(new THREE.BoxGeometry(RX * 2, -BELOW - 0.2, RZ * 2), new THREE.MeshLambertMaterial({ map: wallTex }));
      body.position.set(0, BELOW / 2 - 0.1, 0);
      w.root.add(body);
      w.skyline([0xf2e6d0, 0xd9e6f2, 0xf2d0d0, 0xe0f0d8, 0xe8e8e8], 4, 30, 90);
      // 遠くの木（見た目だけ）
      const trees = new THREE.InstancedMesh(new THREE.ConeGeometry(2.5, 7, 7), new THREE.MeshLambertMaterial({ color: 0x5a9a4a }), 40);
      const m = new THREE.Matrix4();
      for (let i = 0; i < 40; i++) {
        const a = (i / 40) * Math.PI * 2;
        const r = 70 + (i % 5) * 9;
        m.makeTranslation(Math.cos(a) * r, BELOW + 3.5, Math.sin(a) * r);
        trees.setMatrixAt(i, m);
      }
      w.root.add(trees);

      // ---- 端: 南北は高い金網（すべて止める）、東西は低い手すりだけ（ノリコと歩く敵だけ止める）
      const parapet = new THREE.MeshLambertMaterial({ color: 0xc9c2b2 });
      const fenceTex = g.assets.tex('fence.jpg').clone();
      fenceTex.wrapS = THREE.RepeatWrapping;
      fenceTex.repeat.set(RX / 2, 1);
      fenceTex.needsUpdate = true;
      const fence = new THREE.MeshLambertMaterial({ map: fenceTex, transparent: true, opacity: 0.85 });
      for (const sz of [-1, 1]) {
        w.staticBox({ x: 0, y: 0.35, z: sz * (RZ + 0.2) }, { x: RX + 0.4, y: 0.35, z: 0.2 }, 0, parapet);
        w.staticBox({ x: 0, y: 2.2, z: sz * (RZ + 0.2) }, { x: RX + 0.4, y: 1.5, z: 0.05 }, 0, fence);
      }
      for (const sx of [-1, 1]) {
        const p = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.7, RZ * 2 + 0.8), parapet);
        p.position.set(sx * (RX + 0.2), 0.35, 0);
        w.root.add(p);
        const rail = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, RZ * 2), new THREE.MeshLambertMaterial({ color: 0x9a9a9a }));
        rail.position.set(sx * (RX + 0.2), 1.1, 0);
        w.root.add(rail);
        for (let z = -RZ; z <= RZ; z += 3) {
          const post = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.45, 0.06), rail.material);
          post.position.set(sx * (RX + 0.2), 0.9, z);
          w.root.add(post);
        }
        w.staticCollider(RAPIER.ColliderDesc.cuboid(0.2, 4, RZ + 0.5).setTranslation(sx * (RX + 0.2), 4, 0).setCollisionGroups(groups(G.RAIL, G.PLAYER | G.ENEMY)), 'rail');
      }
      // 東西の端の、危ないことを知らせる黄色い線
      const warnMat = new THREE.MeshBasicMaterial({ color: 0xffd84a, transparent: true, opacity: 0.6, depthWrite: false });
      for (const sx of [-1, 1]) w.floor(warnMat, 0.5, RZ * 2, sx * (RX - 0.6), 0, 0.02, 1);

      // ---- 塔屋（階段の出入口）と給水塔
      w.addBuilding(-24, -6, 5, 3, 1, { doors: [{ side: 'front', at: 2 }] });
      const leg = new THREE.MeshLambertMaterial({ color: 0x7a7e86 });
      for (const [tx, tz] of [[28, 20], [-30, 22]] as const) {
        for (const [lx, lz] of [[-1.3, -1.3], [1.3, -1.3], [-1.3, 1.3], [1.3, 1.3]]) w.staticBox({ x: tx + lx, y: 1.6, z: tz + lz }, { x: 0.15, y: 1.6, z: 0.15 }, 0, leg);
        w.staticBox({ x: tx, y: 3.3, z: tz }, { x: 1.8, y: 0.1, z: 1.8 }, 0, leg);
        w.spawnProp('watertank', { x: tx, y: 3.42, z: tz }, 0, S);
      }
      // ---- 室外機の列・ベンチ・段ボール・アンテナ
      for (let r = 0; r < 3; r++) for (let k = 0; k < 8; k++) w.spawnProp('acunit', { x: -38 + k * 1.1, y: 0.005, z: 10 + r * 2.4 }, 0, S);
      for (let r = 0; r < 2; r++) for (let k = 0; k < 8; k++) w.spawnProp('acunit', { x: 18 + k * 1.1, y: 0.005, z: -24 + r * 2.4 }, Math.PI, S);
      for (let k = 0; k < 4; k++) w.spawnProp('bench', { x: -10 + k * 7, y: 0.005, z: 24 }, 0, S);
      const nBox = Math.round(3 * g.rule.clutter);
      for (let i = 0; i < nBox; i++) boxPile(w, -30 + i * 22, -20, 2);
      const nBarrel = Math.round(3 * g.rule.barrels);
      for (let i = 0; i < nBarrel; i++) w.spawnProp('barrel', { x: 34, y: 0.005, z: 6 + i * 0.75 }, 0, S);
      w.staticCyl({ x: 10, y: 0, z: -14 }, 0.12, 9, new THREE.MeshLambertMaterial({ color: 0xb0b0b8 }), 6);
    },

    spawnOk(x, z) {
      return Math.abs(x) < RX - 3 && Math.abs(z) < RZ - 3;
    },

    update(dt) {
      // ---- 場外: 屋上から外へ出た敵を数える（下に落ちると倒れる）
      for (const e of g.enemies.list) {
        if (!e.alive || fell.has(e)) continue;
        if (Math.abs(e.x) < RX + 0.6 && Math.abs(e.z) < RZ + 0.6) continue;
        fell.add(e);
        falls++;
        if (e.state !== 'dead') g.fx.number({ x: e.x, y: 1.5, z: e.z }, '場外！', 'chain');
        if (falls % 10 === 1) log('roof.fall', {}, { total: falls, time: Math.round(g.time) });
      }
      // ---- 突風: 予告のあと、東か西へ 4 秒吹く
      const pl = g.player;
      gustT -= dt;
      if (phase === 'calm' && gustT <= 0) {
        phase = 'warn';
        gustT = 2.5;
        dir = Math.random() < 0.5 ? -1 : 1;
        g.hud.toast(`突風が来る！（${dir > 0 ? '西' : '東'}へ流される）`, 'warn');
        g.audio.whoosh();
        log('roof.gust', { dir }, { time: Math.round(g.time) });
      } else if (phase === 'warn' && gustT <= 0) {
        phase = 'blow';
        gustT = 4;
      } else if (phase === 'blow') {
        pushT -= dt;
        if (pushT <= 0) {
          pushT = 0.25;
          for (const e of g.enemies.list) {
            if (e.state === 'dead' || e.state === 'held') continue;
            if (e.def.boss) {
              e.stagger = Math.max(e.stagger, 0.2);
              continue;
            }
            g.enemies.push(e, { x: dir * 3.2, y: 0.5, z: 0 });
          }
          for (const p of w.props) {
            if (!p.alive || p.rooted || p.mass > 100) continue;
            p.body.applyImpulse({ x: dir * p.mass * 1.6, y: p.mass * 0.4, z: 0 }, true);
            w.heat(p, 1);
          }
          g.audio.whoosh();
        }
        pl.windX = dir * 2.4;
        if (gustT <= 0) {
          phase = 'calm';
          gustT = 22 + Math.random() * 6;
          pl.windX = 0;
        }
      }
      // 風の筋（予告中は少し、吹いている間は多く）
      if (phase !== 'calm' && Math.random() < dt * (phase === 'blow' ? 60 : 12)) {
        const p = pl.pos;
        g.fx.spawn({ pos: { x: p.x - dir * 14 + (Math.random() - 0.5) * 6, y: 0.5 + Math.random() * 3, z: p.z + (Math.random() - 0.5) * 24 }, vel: { x: dir * 30, y: 0, z: 0 }, life: 0.6, size: 0.25, size2: 0.1, color: 0xffffff, shape: 0, alpha: 0.6 });
      }
    },

    dispose() {
      g.player.windX = 0;
    },
  };
}
