/**
 * 工事現場。建てかけのビルと、クレーンに吊られた解体用の鉄球。
 * 仕掛け: 赤い線の上を往復する鉄球、クレーンが落とす鉄骨、転がる土管、もろいビル。
 */
import * as THREE from 'three';
import { RAPIER } from '../../core/physics';
import { log } from '../../log';
import type { Game } from '../game';
import { ARENA, Prop, WorldMap } from '../world';
import { DAY_SKY, Stage } from './index';
import { concreteWall, dirt, tarp } from './textures';

/** 鉄球を吊る点と、ロープの長さ */
const PIVOT = { x: 0, y: 19, z: 6 };
const ROPE = 17.2;
/** 鉄球を最初に引き上げておく角度（ラジアン）。建物の無い西側（-X）へ引き上げる */
const START_ANGLE = -0.95;
/** 一番下を通るときの速さ (m/s)。これより遅くなったら押し足す */
const BALL_SPEED = 15;
const S = { sleep: true };

export function site(g: Game, w: WorldMap): Stage {
  let ball: Prop | null = null;
  let rope: THREE.Mesh | null = null;
  let ballCd = 0;
  /** 鉄球が止まっている秒数（建物に引っかかったら押し出す） */
  let stillT = 0;
  let dropT = 20;
  const drops: { x: number; z: number; yaw: number; t: number; mark: THREE.Mesh; beam: Prop | null; landed: boolean }[] = [];

  return {
    start: { x: 0, z: -34 },
    sky: { ...DAY_SKY, mid: 0xd8e6f0, fog: 0xe8dcc8, fogNear: 60, fogFar: 180 },
    build() {
      w.floor(new THREE.MeshLambertMaterial({ map: dirt(26) }), ARENA * 2 + 60, ARENA * 2 + 60);
      w.groundCollider(0.85);
      w.bounds(new THREE.MeshLambertMaterial({ color: 0xeeeeea }), 3);
      w.skyline([0xe8e8e8, 0xd9e6f2, 0xf2e6d0, 0xc8ccd4], 8, 34, 90);
      w.registerWallStyle('site', { plain: concreteWall(false), win: concreteWall(true), edge: 0x9a968e });
      w.registerWallStyle('tarp', { plain: tarp(), win: tarp(), edge: 0x2a4a9a });

      // ---- 建てかけのビル（もろい）と、青いシートの足場
      w.addBuilding(8, 0, 6, 5, 3, { style: 'site', hp: 40, doors: [{ side: 'front', at: 1 }, { side: 'back', at: 3 }, { side: 'left', at: 1 }, { side: 'right', at: 2 }] });
      w.addBuilding(-28, -6, 5, 4, 4, { style: 'tarp', hp: 32, doors: [{ side: 'front', at: 2 }] });
      w.addBuilding(30, -40, 4, 3, 2, { style: 'site', hp: 40, doors: [{ side: 'back', at: 1 }] });

      // ---- クレーン（見た目と、塔の当たり判定）
      const yellow = new THREE.MeshLambertMaterial({ color: 0xf2c418 });
      w.staticBox({ x: PIVOT.x, y: 10.5, z: 26 }, { x: 0.9, y: 10.5, z: 0.9 }, 0, yellow);
      const jib = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 26), yellow);
      jib.position.set(PIVOT.x, 20.6, 15);
      w.root.add(jib);
      const cab = new THREE.Mesh(new THREE.BoxGeometry(2, 1.6, 2), new THREE.MeshLambertMaterial({ color: 0xdedede }));
      cab.position.set(PIVOT.x, 19.6, 26);
      w.root.add(cab);
      // 遠くのクレーン（鉄骨を落とす係）
      w.staticBox({ x: 44, y: 14, z: 40 }, { x: 0.9, y: 14, z: 0.9 }, 0, yellow);
      const jib2 = new THREE.Mesh(new THREE.BoxGeometry(30, 0.8, 0.8), yellow);
      jib2.position.set(36, 28.4, 40);
      w.root.add(jib2);

      // ---- 鉄球: 吊り点に回転の関節でつなぐ（振り子）
      const cx = PIVOT.x + Math.sin(START_ANGLE) * ROPE;
      const cy = PIVOT.y - Math.cos(START_ANGLE) * ROPE;
      ball = w.spawnProp('wreckball', { x: cx, y: cy - 1.3, z: PIVOT.z }, 0, { hot: 1, dmgMul: 1.4 });
      if (ball) {
        const t = ball.body.translation();
        const pivot = g.physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(PIVOT.x, PIVOT.y, PIVOT.z));
        const jd = RAPIER.JointData.spherical({ x: 0, y: 0, z: 0 }, { x: PIVOT.x - t.x, y: PIVOT.y - t.y, z: PIVOT.z - t.z });
        g.physics.world.createImpulseJoint(jd, pivot, ball.body, true);
        ball.body.setLinearDamping(0);
        ball.body.setAngularDamping(0.5);
      }
      rope = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1, 6), new THREE.MeshLambertMaterial({ color: 0x303034 }));
      w.root.add(rope);
      // 鉄球の通り道（地面の赤い帯）
      const path = new THREE.MeshBasicMaterial({ color: 0xff3a2a, transparent: true, opacity: 0.22, depthWrite: false });
      w.floor(path, Math.abs(Math.sin(START_ANGLE)) * ROPE * 2 + 2, 3, PIVOT.x, PIVOT.z, 0.03, 1);

      // ---- 土管の山（崩すと転がる）・鉄骨の山・資材
      for (const [px, pz] of [[-40, 22], [32, -18], [-12, -50]] as const) {
        for (let row = 0; row < 3; row++) {
          for (let k = 0; k < 3 - row; k++) {
            const z = pz + (k - (2 - row) / 2) * 1.62;
            w.spawnProp('dokan', { x: px, y: row * 1.39 + 0.005, z }, 0, S);
          }
        }
      }
      for (const [bx, bz] of [[-46, -26], [44, 12]] as const) {
        for (let k = 0; k < 4; k++) w.spawnProp('beam', { x: bx, y: k * 0.62 + 0.005, z: bz + (k % 2) * 0.3 }, Math.PI / 2, S);
      }
      for (let k = 0; k < 16; k++) w.spawnProp('cone', { x: -20 + k * 2.6, y: 0.005, z: -18 }, 0, S);
      const nBarrel = Math.round(5 * g.rule.barrels);
      for (let i = 0; i < nBarrel; i++) {
        const { x, z } = w.pickSpot(14, 60, 3, 0, -6);
        w.spawnProp('barrel', { x, y: 0.005, z }, 0, S);
      }
      const nBox = Math.round(5 * g.rule.clutter);
      for (let i = 0; i < nBox; i++) {
        const { x, z } = w.pickSpot(10, 60, 3, 0, -6);
        for (let k = 0; k < 4; k++) w.spawnProp('box', { x: x + (k % 2) * 0.62, y: Math.floor(k / 2) * 0.505 + 0.005, z }, 0, S);
      }
      w.spawnProp('car', { x: -50, y: 0.005, z: -46 }, 0.3, S);
      w.spawnProp('car', { x: 52, y: 0.005, z: -10 }, -0.2, S);
    },

    update(dt) {
      // ---- 鉄球: いつも当たると痛い状態にし、一番下で勢いを足して振れ幅を保つ
      if (ball && ball.alive && rope) {
        const b = ball.body;
        const t = b.translation();
        const v = b.linvel();
        const sp = Math.hypot(v.x, v.y, v.z);
        w.heat(ball, 1);
        if (Math.abs(t.x - PIVOT.x) < 1.5 && sp < BALL_SPEED && t.y < PIVOT.y - ROPE * 0.8) {
          const dx = Math.abs(v.x) > 0.5 ? Math.sign(v.x) : 1;
          b.applyImpulse({ x: dx * ball.mass * Math.min(4, BALL_SPEED - sp) * 0.5, y: 0, z: 0 }, true);
        }
        // 引っかかって止まったら、一番下の方へ押し出す
        stillT = sp < 0.6 ? stillT + dt : 0;
        if (stillT > 1.5) {
          stillT = 0;
          const back = t.x > PIVOT.x ? -1 : 1;
          b.applyImpulse({ x: back * ball.mass * 7, y: ball.mass * 2, z: 0 }, true);
          log('site.ball.kick', {}, { x: Math.round(t.x), y: Math.round(t.y) });
        }
        // 振り子の面（x-y）からずれたら戻す
        if (Math.abs(t.z - PIVOT.z) > 0.3) b.setLinvel({ x: v.x, y: v.y, z: v.z * 0.9 - (t.z - PIVOT.z) * 0.5 }, true);
        // ロープの見た目
        const mx = (PIVOT.x + t.x) / 2;
        const my = (PIVOT.y + t.y + ball.half.y) / 2;
        const mz = (PIVOT.z + t.z) / 2;
        const len = Math.hypot(PIVOT.x - t.x, PIVOT.y - (t.y + ball.half.y), PIVOT.z - t.z);
        rope.position.set(mx, my, mz);
        rope.scale.set(1, len, 1);
        rope.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(PIVOT.x - t.x, PIVOT.y - t.y - ball.half.y, PIVOT.z - t.z).normalize());
        // ノリコに当たる
        ballCd -= dt;
        const p = g.player;
        const d = Math.hypot(p.pos.x - t.x, p.pos.y + 0.9 - t.y, p.pos.z - t.z);
        if (ballCd <= 0 && sp > 4 && d < ball.half.y + 0.6) {
          ballCd = 1;
          p.hurt(30, { x: t.x, y: t.y, z: t.z }, '解体用の鉄球');
          p.launch(v.x * 0.7, 8, v.z * 0.7 + (p.pos.z - t.z) * 3);
          log('site.ball.hit.player', {}, { speed: Math.round(sp), time: Math.round(g.time) });
        }
      }
      // ---- 鉄骨の落下: 赤い四角で予告し、1.6 秒後に落とす
      dropT -= dt;
      if (dropT <= 0) {
        dropT = 22 + Math.random() * 8;
        const p = g.player.pos;
        const a = Math.random() * Math.PI * 2;
        const r = Math.random() * 6;
        const x = p.x + Math.cos(a) * r;
        const z = p.z + Math.sin(a) * r;
        const yaw = Math.random() * Math.PI;
        const mark = w.floor(new THREE.MeshBasicMaterial({ color: 0xff2020, transparent: true, opacity: 0.4, depthWrite: false }), 6.6, 1.2, x, z, 0.04, 3);
        mark.rotation.z = yaw;
        drops.push({ x, z, yaw, t: 0, mark, beam: null, landed: false });
        g.hud.toast('鉄骨が落ちてくる！ 赤い四角から離れろ！', 'warn');
        g.audio.warn();
        log('site.beam', {}, { time: Math.round(g.time) });
      }
      for (let i = drops.length - 1; i >= 0; i--) {
        const dr = drops[i];
        dr.t += dt;
        (dr.mark.material as THREE.MeshBasicMaterial).opacity = 0.25 + 0.25 * Math.abs(Math.sin(dr.t * 10));
        if (dr.t >= 1.6 && !dr.beam) {
          // 鉄骨の長い向きを、赤い四角の長い向きにそろえる
          dr.beam = w.spawnProp('beam', { x: dr.x, y: 13, z: dr.z }, dr.yaw, { vel: { x: 0, y: -20, z: 0 }, hot: 4, dmgMul: 3, life: 45 });
        }
        if (dr.beam && !dr.landed && (dr.t > 2.4 || (dr.beam.alive && dr.beam.body.translation().y < 1.2))) {
          dr.landed = true;
          g.fx.dust({ x: dr.x, y: 0.2, z: dr.z }, 2.5, 0xb0a080, 8);
          g.fx.shake('M');
          g.audio.clank(1);
          // 四角の中にいたら当たる
          const p = g.player.pos;
          const lx = (p.x - dr.x) * Math.cos(dr.yaw) - (p.z - dr.z) * Math.sin(dr.yaw);
          const lz = (p.x - dr.x) * Math.sin(dr.yaw) + (p.z - dr.z) * Math.cos(dr.yaw);
          if (Math.abs(lx) < 3.4 && Math.abs(lz) < 0.9) g.player.hurt(28, { x: dr.x, y: 1, z: dr.z }, '落ちてきた鉄骨');
        }
        if (dr.t > 3) {
          dr.mark.removeFromParent();
          drops.splice(i, 1);
        }
      }
    },

    dispose() {
      drops.length = 0;
    },
  };
}
