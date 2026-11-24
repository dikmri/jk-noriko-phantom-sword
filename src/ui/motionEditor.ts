import * as THREE from 'three';
import { Assets } from '../core/assets';
import { AudioSys } from '../core/audio';
import { Engine } from '../core/engine';
import { isUnlocked, SaveData, writeSave } from '../core/save';
import { clamp } from '../core/vec';
import { TUNE, WEAPONS, WeaponDef } from '../game/defs';
import { Fx, Trail } from '../game/fx';
import { GUARD, lerpSample, NorikoRig } from '../game/rig';
import { effectiveSpeed, speedFactor } from '../game/rules';
import { log } from '../log';
import { weaponPose } from '../motion/arm';
import { cloneMotion, Motion, MotionKey, MotionSample, PITCH_MAX, PITCH_MIN, PRESET_MOTIONS, sampleKeys, sampleMotion, swingTiming, YAW_LIMIT } from '../motion/motion';
import { buildKeys, MAX_INK, pathLength, RawPoint } from '../motion/path';
import { button, clear, h } from './dom';

export interface EditorDeps {
  engine: Engine;
  assets: Assets;
  audio: AudioSys;
  save: SaveData;
  root: HTMLElement;
}

interface MotionStats {
  duration: number;
  peak: number;
  avg: number;
  yawSpan: number;
  pitchSpan: number;
  dps: number;
}

const PAD_W = 460;
const PAD_H = 250;
const MAX_CUSTOM = 8;

/** モーションの性能の目安を計算する。 */
export function motionStats(m: Motion, w: WeaponDef, spec: NorikoRig['spec']): MotionStats {
  const { duration } = swingTiming(m, w.swingSpeed);
  const N = 60;
  let prev = weaponPose({ x: 0, y: 0, z: 0 }, 0, sampleMotion(m, 0), spec, w.length);
  let peak = 0;
  let sum = 0;
  let ymin = Infinity, ymax = -Infinity, pmin = Infinity, pmax = -Infinity;
  const dt = duration / N;
  for (let i = 1; i <= N; i++) {
    const s = sampleMotion(m, i / N);
    const cur = weaponPose({ x: 0, y: 0, z: 0 }, 0, s, spec, w.length);
    const vx = (cur.tip.x - prev.tip.x) / dt;
    const vy = (cur.tip.y - prev.tip.y) / dt;
    const vz = (cur.tip.z - prev.tip.z) / dt;
    const ax = vx * cur.dir.x + vy * cur.dir.y + vz * cur.dir.z;
    const perp = Math.hypot(vx - ax * cur.dir.x, vy - ax * cur.dir.y, vz - ax * cur.dir.z);
    const f = speedFactor(effectiveSpeed(perp, ax), w.refSpeed);
    peak = Math.max(peak, f);
    sum += f;
    ymin = Math.min(ymin, s.yaw); ymax = Math.max(ymax, s.yaw);
    pmin = Math.min(pmin, s.pitch); pmax = Math.max(pmax, s.pitch);
    prev = cur;
  }
  const avg = sum / N;
  const cycle = TUNE.windup + duration + TUNE.followThrough + w.cooldown;
  return { duration, peak, avg, yawSpan: ((ymax - ymin) * 180) / Math.PI, pitchSpan: ((pmax - pmin) * 180) / Math.PI, dps: (w.damage * avg) / cycle };
}

export class MotionEditor {
  private el: HTMLDivElement;
  private group = new THREE.Group();
  private rig: NorikoRig;
  private fx: Fx;
  private trail: Trail;
  private pad: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private chips: HTMLDivElement;
  private statsEl: HTMLDivElement;
  private inkEl: HTMLDivElement;
  private nameInput: HTMLInputElement;
  private easeInput: HTMLInputElement;
  private msgEl: HTMLDivElement;
  private saveBtn: HTMLButtonElement;
  private delBtn: HTMLButtonElement;
  private motion: Motion;
  private points: RawPoint[] = [];
  private drawing = false;
  private stroke = 0;
  private brushReach = 1;
  private lastReachPoint = 1;
  private shift = false;
  private cursor: MotionSample = { yaw: 0, pitch: 0, reach: 1 };
  private weapon: WeaponDef;
  private t = 0;
  private time = 0;
  private phase: 'windup' | 'swing' | 'hold' | 'recover' | 'wait' = 'wait';
  private sample: MotionSample = { ...GUARD };
  private from: MotionSample = { ...GUARD };
  private dur = 0.3;
  private progress = 0;
  private inkWarned = false;
  private disposed = false;
  private prevBg: THREE.Color | THREE.Texture | null;
  private onKey: (e: KeyboardEvent) => void;
  private onKeyUp: (e: KeyboardEvent) => void;

  constructor(private d: EditorDeps, private opts: { mode: 'sortie' | 'dojo'; onDone: (m: Motion) => void; onBack: () => void }) {
    const { engine, save } = d;
    this.weapon = WEAPONS.find((w) => w.id === save.weaponId && isUnlocked(w, save)) ?? WEAPONS[0];
    const all = [...PRESET_MOTIONS, ...save.motions];
    this.motion = cloneMotion(all.find((m) => m.id === save.motionId) ?? PRESET_MOTIONS[0]);

    // ---- 3D の試し振り
    this.prevBg = engine.scene.background as THREE.Color | null;
    engine.scene.background = new THREE.Color(0xf3ead8);
    engine.scene.add(this.group);
    this.group.add(new THREE.HemisphereLight(0xffffff, 0xc8b89a, 1.5));
    const sun = new THREE.DirectionalLight(0xffffff, 1.8);
    sun.position.set(3, 6, -4);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -4; sun.shadow.camera.right = 4; sun.shadow.camera.top = 4; sun.shadow.camera.bottom = -4;
    this.group.add(sun);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(4.2, 48), new THREE.MeshLambertMaterial({ color: 0xe2d4b6 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.group.add(floor);
    const ringM = new THREE.Mesh(new THREE.RingGeometry(1.9, 1.96, 64), new THREE.MeshBasicMaterial({ color: 0xc9b48a }));
    ringM.rotation.x = -Math.PI / 2;
    ringM.position.y = 0.01;
    this.group.add(ringM);
    this.rig = new NorikoRig(d.assets, this.group);
    this.rig.setWeapon(this.weapon);
    this.fx = new Fx(this.group, engine.camera, d.root);
    this.trail = this.fx.makeTrail(0xffffff);
    this.trail.life = 0.35;

    // ---- 右側のパネル
    this.pad = h('canvas', { class: 'me-pad', width: PAD_W * 2, height: PAD_H * 2, style: `width:${PAD_W}px;height:${PAD_H}px` });
    this.ctx = this.pad.getContext('2d')!;
    this.chips = h('div', { class: 'me-chips' });
    this.statsEl = h('div', { class: 'me-stats' });
    this.inkEl = h('div', { class: 'me-ink' }, h('div', { class: 'me-ink-fill' }));
    this.msgEl = h('div', { class: 'me-msg' });
    this.nameInput = h('input', { class: 'me-name', type: 'text', maxLength: 12, placeholder: 'モーションの名前' });
    this.easeInput = h('input', {
      type: 'range', min: '0', max: '1', step: '0.05',
      oninput: () => {
        this.motion.ease = Number(this.easeInput.value);
        this.restart();
        this.refreshStats();
      },
      onchange: () => log('ui.motion.ease', { ease: this.motion.ease }),
    });
    this.saveBtn = button('保存する', 'motion.save', () => this.saveCustom(), 'btn');
    this.delBtn = button('削除', 'motion.delete', () => this.deleteCustom(), 'btn ghost');
    this.el = h('div', { class: 'screen me' },
      h('div', { class: 'me-left' },
        h('div', { class: 'me-left-title' }, opts.mode === 'sortie' ? 'まず、攻撃のモーションを決めよう' : 'モーション道場'),
        h('div', { class: 'me-left-note', html: '左クリックで出る攻撃が、ここで決めた腕の動きになる。<br>大きく振ると広く当たるが時間がかかる。小さく鋭い動きは速い。<br><b>棒の先が速く動く瞬間ほど強い。</b>' }),
      ),
      h('div', { class: 'me-panel' },
        h('div', { class: 'me-h' }, 'えらぶ'),
        this.chips,
        h('div', { class: 'me-h' }, 'じぶんで描く', h('span', { class: 'me-hint' }, '枠の中をドラッグ。Shift を押している間は腕を引き、離すと突き出す')),
        h('div', { class: 'me-pad-wrap' }, this.pad, h('div', { class: 'me-pad-l' }, '← 左'), h('div', { class: 'me-pad-r' }, '右 →'), h('div', { class: 'me-pad-u' }, '上'), h('div', { class: 'me-pad-d' }, '下')),
        h('div', { class: 'me-row' }, h('span', { class: 'me-label' }, 'インク'), this.inkEl,
          button('1 筆もどす', 'motion.undo', () => this.undoStroke(), 'btn small ghost'),
          button('描き直す', 'motion.clear', () => this.clearDraw(), 'btn small ghost')),
        h('div', { class: 'me-row' }, h('span', { class: 'me-label' }, 'タメ'), this.easeInput, h('span', { class: 'me-hint' }, '強いほど出だしが遅く、最後が速い')),
        this.msgEl,
        this.statsEl,
        h('div', { class: 'me-row' }, this.nameInput, this.saveBtn, this.delBtn),
        h('div', { class: 'me-foot' },
          button('◀ もどる', 'motion.back', () => opts.onBack(), 'btn ghost'),
          button(opts.mode === 'sortie' ? 'このモーションで出撃！ ▶' : 'これを使う', 'motion.done', () => this.done(), 'btn primary'),
        ),
      ),
    );
    d.root.appendChild(this.el);

    this.pad.addEventListener('pointerdown', (e) => this.padDown(e));
    this.pad.addEventListener('pointermove', (e) => this.padMove(e));
    const up = (e: PointerEvent) => this.padUp(e);
    this.pad.addEventListener('pointerup', up);
    this.pad.addEventListener('pointercancel', up);
    this.pad.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.brushReach = clamp(this.brushReach - Math.sign(e.deltaY) * 0.1, 0, 1);
    }, { passive: false });
    this.onKey = (e) => {
      if (e.key === 'Shift') this.shift = true;
    };
    this.onKeyUp = (e) => {
      if (e.key === 'Shift') this.shift = false;
    };
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('keyup', this.onKeyUp);

    this.renderChips();
    this.loadMotion(this.motion, false);
    log('ui.motion.open', { mode: opts.mode, motion: this.motion.id, weapon: this.weapon.id });
  }

  // ---------------------------------------------------------------- 一覧
  private renderChips(): void {
    clear(this.chips);
    const add = (m: Motion, custom: boolean) => {
      const c = h('div', { class: `me-chip${custom ? ' custom' : ''}${m.id === this.motion.id ? ' sel' : ''}` }, custom ? `✎ ${m.name}` : m.name);
      c.addEventListener('click', () => {
        this.d.audio.ensure();
        this.d.audio.ui('move');
        log('ui.motion.select', { id: m.id, name: m.name });
        this.loadMotion(cloneMotion(m), true);
      });
      this.chips.appendChild(c);
    };
    PRESET_MOTIONS.forEach((m) => add(m, false));
    this.d.save.motions.forEach((m) => add(m, true));
  }

  private loadMotion(m: Motion, user: boolean): void {
    this.motion = m;
    this.points = [];
    this.stroke = 0;
    this.easeInput.value = String(m.ease);
    this.nameInput.value = m.custom ? m.name : '';
    this.delBtn.style.display = m.custom && this.d.save.motions.some((x) => x.id === m.id) ? '' : 'none';
    this.msg(m.custom ? '' : 'プリセットを選択中。枠に描くと、自分だけのモーションになる。');
    this.renderChips();
    this.refreshStats();
    this.restart();
    if (user) this.d.audio.swing(0.6);
  }

  private msg(text: string, warn = false): void {
    this.msgEl.textContent = text;
    this.msgEl.classList.toggle('warn', warn);
  }

  // ---------------------------------------------------------------- 描く
  private padSample(e: PointerEvent): MotionSample {
    const r = this.pad.getBoundingClientRect();
    const u = clamp((e.clientX - r.left) / r.width, 0, 1);
    const v = clamp((e.clientY - r.top) / r.height, 0, 1);
    return { yaw: (u * 2 - 1) * YAW_LIMIT, pitch: PITCH_MAX - v * (PITCH_MAX - PITCH_MIN), reach: this.brushReach };
  }

  private padDown(e: PointerEvent): void {
    this.d.audio.ensure();
    this.pad.setPointerCapture(e.pointerId);
    // プリセットや保存済みを選んでいるときは、新しい下書きとして描き始める
    if (!this.motion.custom || this.points.length === 0) {
      this.points = [];
      this.stroke = 0;
      this.motion = { id: `draft-${Date.now()}`, name: this.nameInput.value || 'じぶん流', keys: this.motion.keys, ease: Number(this.easeInput.value), custom: true };
      this.delBtn.style.display = 'none';
    } else this.stroke++;
    this.drawing = true;
    this.inkWarned = false;
    this.brushReach = this.shift ? 0.05 : this.brushReach;
    const s = this.padSample(e);
    this.cursor = s;
    this.points.push({ ...s, stroke: this.stroke });
    this.lastReachPoint = s.reach;
    this.trail.life = 0.5;
    log('ui.motion.stroke.start', { stroke: this.stroke, yaw: s.yaw, pitch: s.pitch, reach: s.reach });
  }

  private addPoint(s: MotionSample): void {
    if (pathLength(this.points) >= MAX_INK) {
      if (!this.inkWarned) {
        this.inkWarned = true;
        this.d.audio.ui('error');
        this.msg('インクが切れた。これ以上は長くできない。', true);
      }
      return;
    }
    this.points.push({ ...s, stroke: this.stroke });
    this.lastReachPoint = s.reach;
  }

  private padMove(e: PointerEvent): void {
    if (!this.drawing) return;
    const s = this.padSample(e);
    this.cursor = s;
    const last = this.points[this.points.length - 1];
    if (Math.hypot(s.yaw - last.yaw, s.pitch - last.pitch) > 0.03) this.addPoint(s);
  }

  private padUp(e: PointerEvent): void {
    if (!this.drawing) return;
    this.drawing = false;
    try {
      this.pad.releasePointerCapture(e.pointerId);
    } catch {
      /* 既に解放されている */
    }
    this.commit();
  }

  private commit(): void {
    const keys = buildKeys(this.points);
    if (!keys) {
      this.msg('もう少し長く描いてね。', true);
      log('ui.motion.stroke.end', { points: this.points.length }, { ok: false });
      if (this.points.length < 2) this.points = [];
      return;
    }
    this.motion.keys = keys;
    this.motion.custom = true;
    if (!this.nameInput.value) this.nameInput.value = `じぶん流${this.d.save.motions.length + 1}`;
    this.motion.name = this.nameInput.value;
    this.msg('描けた。気に入ったら名前をつけて保存しよう。続けて描くと、動きがつながる。');
    log('ui.motion.stroke.end', { points: this.points.length }, { ok: true, keys: keys.length, length: pathLength(this.points) });
    this.renderChips();
    this.refreshStats();
    this.restart();
  }

  private undoStroke(): void {
    if (!this.points.length) return;
    const last = this.points[this.points.length - 1].stroke;
    this.points = this.points.filter((p) => p.stroke !== last);
    this.stroke = Math.max(0, last - 1);
    if (this.points.length >= 2) this.commit();
    else this.clearDraw();
  }

  private clearDraw(): void {
    this.points = [];
    this.stroke = 0;
    this.msg('枠の中をドラッグして描こう。');
    this.refreshStats();
  }

  private saveCustom(): void {
    const save = this.d.save;
    if (!this.motion.custom) {
      this.msg('プリセットは保存できない。枠に描いてから保存しよう。', true);
      this.d.audio.ui('error');
      return;
    }
    const name = (this.nameInput.value || 'じぶん流').trim().slice(0, 12);
    const idx = save.motions.findIndex((m) => m.id === this.motion.id);
    if (idx < 0 && save.motions.length >= MAX_CUSTOM) {
      this.msg(`保存できるのは ${MAX_CUSTOM} 個まで。どれかを削除してから保存しよう。`, true);
      this.d.audio.ui('error');
      log('ui.motion.save', { name }, { ok: false, reason: 'full' });
      return;
    }
    if (idx < 0) this.motion.id = `custom-${Date.now()}`;
    this.motion.name = name;
    const copy = cloneMotion(this.motion);
    if (idx >= 0) save.motions[idx] = copy;
    else save.motions.push(copy);
    save.motionId = copy.id;
    writeSave(save);
    this.d.audio.ui('ok');
    this.msg(`「${name}」を保存した。`);
    this.delBtn.style.display = '';
    this.renderChips();
    log('ui.motion.save', { name, id: copy.id }, { ok: true, keys: copy.keys.length, total: save.motions.length });
  }

  private deleteCustom(): void {
    const save = this.d.save;
    const idx = save.motions.findIndex((m) => m.id === this.motion.id);
    if (idx < 0) return;
    const name = save.motions[idx].name;
    save.motions.splice(idx, 1);
    if (save.motionId === this.motion.id) save.motionId = 'yoko';
    writeSave(save);
    log('ui.motion.delete', { name }, { total: save.motions.length });
    this.d.audio.ui('cancel');
    this.loadMotion(cloneMotion(PRESET_MOTIONS[0]), false);
    this.msg(`「${name}」を削除した。`);
  }

  private done(): void {
    const save = this.d.save;
    if (this.motion.keys.length < 2) {
      this.msg('モーションを選ぶか、描いてね。', true);
      return;
    }
    // 未保存の自作モーションは、その場で保存してから使う（枠が埋まっていれば今回だけ使う）
    if (this.motion.custom && !save.motions.some((m) => m.id === this.motion.id) && save.motions.length < MAX_CUSTOM) this.saveCustom();
    if (!this.motion.custom || save.motions.some((m) => m.id === this.motion.id)) {
      save.motionId = this.motion.id;
      writeSave(save);
    }
    this.d.audio.ui('ok');
    log('ui.motion.done', { id: this.motion.id, name: this.motion.name, keys: this.motion.keys.length, ease: this.motion.ease });
    this.opts.onDone(cloneMotion(this.motion));
  }

  // ---------------------------------------------------------------- 表示
  private refreshStats(): void {
    const st = motionStats(this.motion, this.weapon, this.rig.spec);
    const used = this.points.length ? pathLength(this.points) / MAX_INK : 0;
    (this.inkEl.firstElementChild as HTMLElement).style.width = `${Math.max(0, (1 - used) * 100).toFixed(0)}%`;
    const row = (k: string, v: string, note = '') => h('div', { class: 'me-stat' }, h('span', null, k), h('b', null, v), h('i', null, note));
    clear(this.statsEl);
    this.statsEl.append(
      row('1 回の時間', `${st.duration.toFixed(2)} 秒`, st.duration < 0.2 ? '速い' : st.duration > 0.6 ? '隙が大きい' : ''),
      row('いちばん強い瞬間', `×${st.peak.toFixed(2)}`, st.peak > 1.6 ? '強烈' : st.peak < 0.6 ? '弱い' : ''),
      row('横の広さ', `${st.yawSpan.toFixed(0)}°`, st.yawSpan > 200 ? '体ごと回る' : ''),
      row('縦の広さ', `${st.pitchSpan.toFixed(0)}°`),
      row('攻撃力の目安', `${st.dps.toFixed(1)} / 秒`, `${this.weapon.emoji} ${this.weapon.name.replace(/「.*」/, '')}`),
    );
  }

  private toPad(yaw: number, pitch: number): [number, number] {
    return [((yaw / YAW_LIMIT) * 0.5 + 0.5) * PAD_W * 2, ((PITCH_MAX - pitch) / (PITCH_MAX - PITCH_MIN)) * PAD_H * 2];
  }

  private drawPad(): void {
    const c = this.ctx;
    const W = PAD_W * 2;
    const H = PAD_H * 2;
    c.clearRect(0, 0, W, H);
    c.fillStyle = '#fffaf0';
    c.fillRect(0, 0, W, H);
    // 腕だけでは届かず、体ごと回る範囲
    const [xl] = this.toPad(-1.9, 0);
    const [xr] = this.toPad(1.9, 0);
    c.fillStyle = 'rgba(120,150,220,0.13)';
    c.fillRect(0, 0, xl, H);
    c.fillRect(xr, 0, W - xr, H);
    c.strokeStyle = 'rgba(120,90,50,0.18)';
    c.lineWidth = 2;
    for (let d = -150; d <= 150; d += 30) {
      const [x] = this.toPad((d * Math.PI) / 180, 0);
      c.beginPath(); c.moveTo(x, 0); c.lineTo(x, H); c.stroke();
    }
    for (let d = -60; d <= 80; d += 20) {
      const [, y] = this.toPad(0, (d * Math.PI) / 180);
      c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke();
    }
    const [cx, cy] = this.toPad(0, 0);
    c.strokeStyle = 'rgba(120,90,50,0.5)';
    c.lineWidth = 3;
    c.beginPath(); c.moveTo(cx, 0); c.lineTo(cx, H); c.moveTo(0, cy); c.lineTo(W, cy); c.stroke();
    c.fillStyle = 'rgba(120,90,50,0.6)';
    c.font = '22px sans-serif';
    c.textAlign = 'center';
    c.fillText('正面', cx, cy - 10);
    c.fillText('体ごと回る', xl / 2, 30);
    c.fillText('体ごと回る', (xr + W) / 2, 30);

    // 軌跡
    const keys = this.motion.keys;
    if (keys.length >= 2) {
      const N = 90;
      let prev = sampleKeys(keys, 0);
      for (let i = 1; i <= N; i++) {
        const cur = sampleKeys(keys, i / N);
        const [x0, y0] = this.toPad(prev.yaw, prev.pitch);
        const [x1, y1] = this.toPad(cur.yaw, cur.pitch);
        const t = i / N;
        c.strokeStyle = `hsl(${140 - t * 140},85%,${45 - t * 5}%)`;
        c.lineWidth = 5 + cur.reach * 12;
        c.lineCap = 'round';
        c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke();
        prev = cur;
      }
      const s0 = sampleKeys(keys, 0);
      const s1 = sampleKeys(keys, 1);
      const [ax, ay] = this.toPad(s0.yaw, s0.pitch);
      const [bx, by] = this.toPad(s1.yaw, s1.pitch);
      c.fillStyle = '#1f9d4d';
      c.beginPath(); c.arc(ax, ay, 16, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#d6332a';
      c.beginPath(); c.arc(bx, by, 16, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#fff';
      c.font = 'bold 20px sans-serif';
      c.fillText('始', ax, ay + 7);
      c.fillText('終', bx, by + 7);
    }
    // いまの手の位置
    const cur = this.drawing ? this.cursor : this.sample;
    const [px, py] = this.toPad(cur.yaw, cur.pitch);
    c.strokeStyle = '#2a2a2a';
    c.lineWidth = 4;
    c.beginPath(); c.arc(px, py, 10 + cur.reach * 16, 0, Math.PI * 2); c.stroke();
    if (this.drawing) {
      c.fillStyle = 'rgba(40,40,40,0.75)';
      c.font = '22px sans-serif';
      c.fillText(this.shift ? '腕を引いている' : '', px, py - 36);
    }
  }

  private restart(): void {
    this.phase = 'wait';
    this.t = 0.15;
    this.dur = swingTiming(this.motion, this.weapon.swingSpeed).duration;
  }

  /** 毎フレーム呼ぶ。試し振りを進めて描画する。 */
  frame(real: number): void {
    if (this.disposed) return;
    const dt = Math.min(real, 0.05);
    this.time += dt;
    const eng = this.d.engine;
    let swing = 0;
    if (this.drawing) {
      // 描いている間は、腕がカーソルに付いてくる
      const target = this.shift ? 0.05 : 1;
      const before = this.brushReach;
      this.brushReach += clamp(target - this.brushReach, -dt * 5, dt * 5);
      this.cursor.reach = this.brushReach;
      if (Math.abs(this.brushReach - this.lastReachPoint) > 0.04 && before !== this.brushReach) this.addPoint({ ...this.cursor });
      this.sample = lerpSample(this.sample, this.cursor, Math.min(1, dt * 30));
      swing = 0.5;
    } else if (this.motion.keys.length >= 2) {
      this.t -= dt;
      if (this.phase === 'wait') {
        this.sample = lerpSample(this.sample, GUARD, Math.min(1, dt * 10));
        if (this.t <= 0) {
          this.phase = 'windup';
          this.t = 0.2;
          this.from = { ...this.sample };
        }
      } else if (this.phase === 'windup') {
        const k = 1 - Math.max(0, this.t) / 0.2;
        this.sample = lerpSample(this.from, sampleMotion(this.motion, 0), 1 - (1 - k) * (1 - k));
        if (this.t <= 0) {
          this.phase = 'swing';
          this.t = this.dur;
          this.d.audio.swing(0.5);
        }
      } else if (this.phase === 'swing') {
        this.progress = 1 - Math.max(0, this.t) / this.dur;
        this.sample = sampleMotion(this.motion, this.progress);
        swing = 1;
        if (this.t <= 0) {
          this.phase = 'hold';
          this.t = 0.3;
        }
      } else if (this.phase === 'hold') {
        swing = 1;
        if (this.t <= 0) {
          this.phase = 'recover';
          this.t = 0.3;
          this.from = { ...this.sample };
        }
      } else {
        const k = 1 - Math.max(0, this.t) / 0.3;
        this.sample = lerpSample(this.from, GUARD, k * k * (3 - 2 * k));
        if (this.t <= 0) {
          this.phase = 'wait';
          this.t = 0.45;
        }
      }
    }
    const pose = this.rig.pose({ pos: { x: 0, y: 0, z: 0 }, yaw: 0, sample: this.sample, weaponLen: this.weapon.length, run: 0, phase: 0, air: false, time: this.time, swing });
    if (this.phase === 'swing' || this.drawing) this.trail.push(pose.hand, pose.tip);
    this.rig.setFace(this.phase === 'swing' || this.phase === 'hold' ? 'attack' : this.drawing ? 'smug' : 'neutral');
    this.fx.update(dt, dt);
    // 画面の左側にノリコが来るよう、注視点を右へずらす（キャラの右は -X）
    const cam = eng.camera;
    const aspect = cam.aspect;
    const shift = aspect > 1.2 ? -1.7 : 0;
    cam.position.set(0.6 + shift, 2.35, -4.6);
    cam.lookAt(shift, 1.05, 0.9);
    if (cam.fov !== 50) {
      cam.fov = 50;
      cam.updateProjectionMatrix();
    }
    this.drawPad();
    eng.render();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('keyup', this.onKeyUp);
    this.fx.dispose();
    this.rig.dispose();
    this.group.removeFromParent();
    this.d.engine.scene.background = this.prevBg;
    this.el.remove();
  }
}

export type { MotionKey };
