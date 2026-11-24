import { ITEM_MAP, SKILL_MAP } from './defs';
import type { Game } from './game';
import { screenBearing, starText } from './rules';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent: HTMLElement, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent.appendChild(e);
  return e;
}

/** スキル欄のアイコンに出す「たまっている数」と、その効果（スタック）。 */
export interface StackInfo {
  /** どのアイコンに付けるか: 'a:<id>' 攻撃スキル / 'p:<id>' 強化 / 'i:<id>' アイテム */
  key: string;
  /** アイコンの左上に出す短い数 */
  badge: string;
  /** 上限に対するたまり具合（0〜1）。上限が無いものは省く */
  fill?: number;
  /** 一覧に出す説明（何がどれだけ強くなっているか）。省くとアイコンの数だけ出す */
  text?: string;
}

function fmtTime(t: number): string {
  const s = Math.max(0, Math.floor(t));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** コンパスに出す印の数の上限 */
const COMPASS_MARKS = 8;

/** コンパスに出すボスの印（モデルごと） */
const BOSS_ICON: Record<string, string> = { pervert: '🧥', terrorist: '💂', bear: '🐻', tank: '🪖', heli: '🚁', robovac: '🤖', vending: '🥫', drone: '🛸' };

/** 遊んでいる間の画面表示。常に出す情報は絞り、必要なときだけ出すものは出し入れする。 */
export class Hud {
  root: HTMLDivElement;
  private xpFill: HTMLDivElement;
  private level: HTMLDivElement;
  private timer: HTMLDivElement;
  private kills: HTMLDivElement;
  private coins: HTMLDivElement;
  private hpFill: HTMLDivElement;
  private hpText: HTMLDivElement;
  private dash: HTMLDivElement;
  /** 「棒、育つ」で増えた武器の威力 */
  private grow: HTMLDivElement;
  private growShown = -1;
  private skills: HTMLDivElement;
  /** スキル欄のアイコンの並び（持っているものが変わるたびに作り直す） */
  private skillRows: HTMLDivElement;
  /** たまっている数の一覧（スキル欄の上） */
  private stackList: HTMLDivElement;
  /** アイコン（'a:<id>' など）→ 要素 */
  private iconOf = new Map<string, HTMLDivElement>();
  private stackSig = '';
  private stackT = 0;
  private bosses: HTMLDivElement;
  private toasts: HTMLDivElement;
  private hint: HTMLDivElement;
  private debug: HTMLDivElement;
  private rule: HTMLDivElement;
  /** 何面か（エンドレスはレベル） */
  private stageLbl: HTMLDivElement;
  private stageShown = '';
  /** 寄り道の案内（向き・距離・残り時間） */
  private mission: HTMLDivElement;
  private missionArrow: HTMLSpanElement;
  private missionText: HTMLDivElement;
  private missionStep: HTMLDivElement;
  private missionHow: HTMLDivElement;
  private missionBar: HTMLProgressElement;
  private missionSig = '';
  /** 寄り道の始まり・成功・時間切れを、画面の中央に大きく出す */
  private bannerEl: HTMLDivElement;
  private bannerTitle: HTMLDivElement;
  private bannerSub: HTMLDivElement;
  private bannerTimer = 0;
  /** 画面上のコンパス: 東西南北と、ボス・寄り道の目的地・宝箱の向き */
  private compass: HTMLDivElement;
  private compassDirs: HTMLDivElement[] = [];
  private compassMarks: { el: HTMLDivElement; icon: HTMLSpanElement; dist: HTMLSpanElement; sig: string }[] = [];
  private compassW = 0;
  private compassWT = 0;
  private clickMsg: HTMLDivElement;
  /** 画面の縁の点滅（画面に見えていない弾が当たりそうなとき） */
  private danger: HTMLDivElement;
  /** 弾が来る方向の印。同時に 3 つまで */
  private dangerDirs: HTMLDivElement[] = [];
  private skillSig = '';
  private bossSig = '';
  private last = { kills: -1, coins: -1, level: -1, time: -1, hp: -1 };
  private frames = 0;
  private fpsT = 0;
  fps = 60;
  private hintDone = { move: false, attack: false, dash: false };

  constructor(private g: Game, ui: HTMLElement) {
    this.root = el('div', 'hud', ui);
    this.danger = el('div', 'hud-danger', this.root);
    for (let i = 0; i < 3; i++) this.dangerDirs.push(el('div', 'hud-danger-dir', this.root));
    const top = el('div', 'hud-top', this.root);
    const xp = el('div', 'hud-xp', top);
    this.xpFill = el('div', 'hud-xp-fill', xp);
    this.level = el('div', 'hud-level', xp, 'Lv 1');
    const row = el('div', 'hud-row', top);
    this.rule = el('div', 'hud-rule', row);
    this.stageLbl = el('div', 'hud-stageno', this.rule);
    const ruleTxt = el('div', 'hud-ruletext', this.rule);
    this.timer = el('div', 'hud-timer', row, '0:00');
    const right = el('div', 'hud-right', row);
    this.kills = el('div', 'hud-stat', right, '💥 0');
    this.coins = el('div', 'hud-stat', right, '🪙 0');
    this.compass = el('div', 'hud-compass', this.root);
    for (const name of ['北', '東', '南', '西']) this.compassDirs.push(el('div', 'hud-compass-dir', this.compass, name));
    el('div', 'hud-compass-center', this.compass);
    for (let i = 0; i < COMPASS_MARKS; i++) {
      const m = el('div', 'hud-cmark', this.compass);
      const icon = el('span', 'hud-cmark-icon', m);
      const dist = el('span', 'hud-cmark-dist', m);
      m.style.display = 'none';
      this.compassMarks.push({ el: m, icon, dist, sig: '' });
    }
    this.bosses = el('div', 'hud-bosses', this.root);
    this.toasts = el('div', 'hud-toasts', this.root);
    const bottom = el('div', 'hud-bottom', this.root);
    const hp = el('div', 'hud-hp', bottom);
    this.hpFill = el('div', 'hud-hp-fill', hp);
    this.hpText = el('div', 'hud-hp-text', hp);
    this.dash = el('div', 'hud-dash', bottom);
    this.grow = el('div', 'hud-dash hud-grow', bottom);
    this.grow.style.display = 'none';
    this.skills = el('div', 'hud-skills', this.root);
    this.stackList = el('div', 'hud-stacklist', this.skills);
    this.skillRows = el('div', 'hud-skill-rows', this.skills);
    this.hint = el('div', 'hud-hint', this.root);
    this.debug = el('div', 'hud-debug', this.root);
    this.clickMsg = el('div', 'hud-click', this.root, '画面をクリックすると操作できます');
    ruleTxt.textContent = g.ruleDef.id === 'normal' ? '' : `本日の校則: ${g.ruleDef.name}`;
    this.mission = el('div', 'hud-mission', this.root);
    this.missionArrow = el('span', 'hud-mission-arrow', this.mission, '▲');
    const mb = el('div', 'hud-mission-body', this.mission);
    this.missionText = el('div', 'hud-mission-text', mb);
    this.missionStep = el('div', 'hud-mission-step', mb);
    this.missionHow = el('div', 'hud-mission-how', mb);
    this.missionBar = document.createElement('progress');
    this.missionBar.className = 'hud-mission-bar';
    this.missionBar.max = 1;
    this.missionBar.setAttribute('aria-label', '寄り道の進み具合');
    mb.appendChild(this.missionBar);
    this.mission.style.display = 'none';
    this.bannerEl = el('div', 'hud-banner', this.root);
    // 読み上げにも伝える（内容は右上の案内の欄にも残る）
    this.bannerEl.setAttribute('role', 'status');
    this.bannerEl.setAttribute('aria-live', 'polite');
    this.bannerTitle = el('div', 'hud-banner-title', this.bannerEl);
    this.bannerSub = el('div', 'hud-banner-sub', this.bannerEl);
    this.renderHint();
  }

  /** 画面の中央に大きく出す（寄り道の始まり・成功・時間切れ）。3.5 秒で消える。 */
  banner(title: string, sub: string, kind: 'start' | 'done' | 'miss'): void {
    const b = this.bannerEl;
    this.bannerTitle.textContent = title;
    this.bannerSub.textContent = sub;
    b.className = `hud-banner ${kind}`;
    void b.offsetWidth;
    b.classList.add('on');
    window.clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => b.classList.remove('on'), kind === 'miss' ? 2200 : 3500);
  }

  /**
   * 画面上のコンパス。正面を中心に左右 100 度ぶんを並べる。それより後ろのものは端に寄せ、矢印を付ける。
   * 出すもの: ボス（赤）・寄り道の目的地（金）・拾っていない宝箱（白）。近い順に COMPASS_MARKS 個まで。
   */
  private updateCompass(real: number): void {
    const g = this.g;
    const p = g.player.pos;
    const yaw = g.player.camYaw;
    this.compassWT -= real;
    if (this.compassWT <= 0 || this.compassW <= 0) {
      this.compassWT = 0.5;
      this.compassW = this.compass.clientWidth;
    }
    const half = this.compassW / 2;
    const FOV = (100 * Math.PI) / 180;
    const place = (b: number) => Math.max(-1, Math.min(1, b / FOV)) * (half - 14);
    // 東西南北（正面が北のとき、東は右）
    const dirs: [number, number][] = [[0, 1], [-1, 0], [0, -1], [1, 0]];
    for (let i = 0; i < 4; i++) {
      const b = screenBearing(dirs[i][0], dirs[i][1], yaw);
      const d = this.compassDirs[i];
      const show = Math.abs(b) < FOV;
      d.style.display = show ? 'block' : 'none';
      if (show) d.style.transform = `translateX(${place(b).toFixed(1)}px)`;
    }
    const marks: { kind: 'boss' | 'goal' | 'chest'; icon: string; x: number; z: number; d: number }[] = [];
    const info = g.state === 'playing' ? g.detours.info() : null;
    if (info) marks.push({ kind: 'goal', icon: info.emoji, x: info.x, z: info.z, d: info.dist });
    for (const e of g.enemies.bosses) {
      if (!e.alive || e.state === 'dead') continue;
      marks.push({ kind: 'boss', icon: BOSS_ICON[e.def.model] ?? '👹', x: e.x, z: e.z, d: Math.hypot(e.x - p.x, e.z - p.z) });
    }
    for (const c of g.pickups.chests()) marks.push({ kind: 'chest', icon: '🎁', x: c.x, z: c.z, d: Math.hypot(c.x - p.x, c.z - p.z) });
    // 目的地を先に、そのあとは近い順
    marks.sort((a, b) => (a.kind === 'goal' ? -1 : b.kind === 'goal' ? 1 : a.d - b.d));
    for (let i = 0; i < this.compassMarks.length; i++) {
      const m = this.compassMarks[i];
      const k = marks[i];
      if (!k) {
        if (m.el.style.display !== 'none') m.el.style.display = 'none';
        continue;
      }
      const b = screenBearing(k.x - p.x, k.z - p.z, yaw);
      const behind = Math.abs(b) > FOV;
      m.el.style.display = 'flex';
      m.el.style.transform = `translateX(${place(b).toFixed(1)}px)`;
      const sig = `${k.kind}|${k.icon}|${Math.round(k.d)}|${behind ? (b < 0 ? 'L' : 'R') : ''}`;
      if (sig === m.sig) continue;
      m.sig = sig;
      m.el.className = `hud-cmark ${k.kind}${behind ? ' behind' : ''}`;
      m.icon.textContent = behind ? (b < 0 ? `◀${k.icon}` : `${k.icon}▶`) : k.icon;
      m.dist.textContent = `${Math.round(k.d)}m`;
    }
  }

  private renderHint(): void {
    const d = this.hintDone;
    const parts: string[] = [];
    if (!d.move) parts.push('<b>W A S D</b> 移動　<b>マウス</b> 視点');
    if (!d.attack) parts.push('<b>左クリック</b> 攻撃（押しっぱなしで連続）');
    if (!d.dash) parts.push('<b>Shift</b> ダッシュ（無敵）　<b>Space</b> ジャンプ');
    this.hint.innerHTML = parts.join('<br>');
    this.hint.style.display = parts.length ? 'block' : 'none';
  }

  /** 操作の案内は、その操作をした時点で消す。 */
  noteAction(kind: 'move' | 'attack' | 'dash'): void {
    if (this.hintDone[kind]) return;
    this.hintDone[kind] = true;
    this.renderHint();
  }

  toast(text: string, kind: 'info' | 'warn' | 'gold' | 'praise' = 'info'): void {
    const t = el('div', `hud-toast hud-toast-${kind}`, this.toasts, text);
    while (this.toasts.children.length > 3) this.toasts.firstElementChild!.remove();
    window.setTimeout(() => t.classList.add('out'), 1700);
    window.setTimeout(() => t.remove(), 2200);
  }

  /** 画面の縁を 2 回点滅させる。 */
  dangerFlash(): void {
    const d = this.danger;
    d.classList.remove('on');
    void d.offsetWidth;
    d.classList.add('on');
  }

  /** 画面に見えていない弾の方向へ印を出す。画面の中心から見て、上が正面・下が真後ろ。 */
  private updateDanger(): void {
    const g = this.g;
    const th = g.state === 'playing' ? g.projectiles.threats : [];
    for (let i = 0; i < this.dangerDirs.length; i++) {
      const d = this.dangerDirs[i];
      const t = th[i];
      if (!t) {
        if (d.style.display !== 'none') d.style.display = 'none';
        continue;
      }
      const a = screenBearing(t.x - g.player.pos.x, t.z - g.player.pos.z, g.player.camYaw);
      d.style.display = 'block';
      d.style.transform = `rotate(${a.toFixed(3)}rad)`;
    }
  }

  update(real: number): void {
    const g = this.g;
    this.updateDanger();
    this.frames++;
    this.fpsT += real;
    if (this.fpsT >= 0.5) {
      this.fps = this.frames / this.fpsT;
      this.frames = 0;
      this.fpsT = 0;
      if (g.debug.on) {
        this.debug.textContent = `${this.fps.toFixed(0)}fps  敵${g.enemies.count}  がれき${g.world.loose.length}  物${g.world.props.length}  粒${g.fx.particleCount}  弾${g.projectiles.list.length}  破壊${g.world.destruction.toFixed(1)}%${g.debug.god ? '  無敵' : ''}${g.player.auto ? '  自動' : ''}`;
      } else if (this.debug.textContent) this.debug.textContent = '';
    }
    // マウスが画面に固定されていない間は、クリックを促す
    const needClick = g.state === 'playing' && !g.input.locked && !g.input.dragLook && !g.player.auto;
    this.clickMsg.style.display = needClick ? 'block' : 'none';
    this.xpFill.style.width = `${Math.min(100, (g.xp / g.xpNeed) * 100).toFixed(1)}%`;
    const L = this.last;
    if (L.level !== g.level) {
      L.level = g.level;
      this.level.textContent = `Lv ${g.level}`;
    }
    const sec = Math.floor(g.time);
    if (L.time !== sec) {
      L.time = sec;
      this.timer.textContent = fmtTime(g.time);
    }
    if (L.kills !== g.run.kills) {
      L.kills = g.run.kills;
      this.kills.textContent = `💥 ${g.run.kills}`;
    }
    if (L.coins !== g.run.coins) {
      L.coins = g.run.coins;
      this.coins.textContent = `🪙 ${g.run.coins}`;
    }
    const hp = Math.ceil(g.player.hp);
    const max = g.stats.maxHp;
    this.hpFill.style.width = `${Math.max(0, (g.player.hp / max) * 100).toFixed(1)}%`;
    if (L.hp !== hp) {
      L.hp = hp;
      this.hpText.textContent = `${hp} / ${Math.round(max)}`;
      this.hpFill.classList.toggle('low', g.player.hp / max < 0.3);
    }
    this.dash.style.opacity = g.player.dashCd > 0 ? '0.35' : '1';
    this.dash.textContent = g.player.dashCd > 0 ? '💨' : '💨 Shift';
    // 棒の威力（「棒、育つ」と「棒を鍛える」で増えたとき）
    const power = Math.round(g.weaponPower);
    if (power !== this.growShown) {
      this.growShown = power;
      const grown = g.player.weaponBonus > 0 || g.weaponLv > 0;
      this.grow.style.display = grown ? 'block' : 'none';
      this.grow.textContent = `🗡️ 棒の威力 ${power}${g.weaponLv > 0 ? `（鍛えた Lv ${g.weaponLv}）` : ''}`;
    }

    const sig = g.skills.actives.map((a) => `${a.id}${a.level}${a.evolved ? 'e' : ''}${a.brk ?? 0}`).join(',') + '|' + g.skills.passives.map((p) => `${p.id}${p.level}${p.brk ?? 0}`).join(',') + '|' + g.items.map((id) => `${id}${g.itemLv[id] ?? 1}`).join(',');
    if (sig !== this.skillSig) {
      this.skillSig = sig;
      this.skillRows.innerHTML = '';
      this.iconOf.clear();
      const a = el('div', 'hud-skill-row', this.skillRows);
      for (const s of g.skills.actives) {
        const d = SKILL_MAP[s.id];
        const b = el('div', `hud-skill${s.evolved ? ' evo' : ''}`, a, s.evolved && d.evo ? d.evo.emoji : d.emoji);
        b.title = s.evolved && d.evo ? d.evo.name : d.name;
        el('span', 'hud-skill-lv', b, (s.evolved ? '★' : String(s.level)) + (s.brk ? `+${s.brk}` : ''));
        this.iconOf.set(`a:${s.id}`, b);
      }
      const p = el('div', 'hud-skill-row small', this.skillRows);
      for (const s of g.skills.passives) {
        const d = SKILL_MAP[s.id];
        const b = el('div', 'hud-skill passive', p, d.emoji);
        b.title = d.name;
        el('span', 'hud-skill-lv', b, String(s.level) + (s.brk ? `+${s.brk}` : ''));
        this.iconOf.set(`p:${s.id}`, b);
      }
      if (g.items.length) {
        const r = el('div', 'hud-skill-row small items', this.skillRows);
        for (const id of g.items) {
          const it = ITEM_MAP[id];
          const b = el('div', 'hud-skill item', r, it.emoji);
          b.title = it.name;
          const lv = g.itemLv[id] ?? 1;
          if (lv > 1) el('span', 'hud-skill-lv', b, starText(lv));
          this.iconOf.set(`i:${id}`, b);
        }
      }
      // アイコンを作り直したので、たまっている数も付け直す
      this.stackSig = '';
      this.stackT = 0;
    }
    this.stackT -= real;
    if (this.stackT <= 0) {
      this.stackT = 0.2;
      this.renderStacks();
    }
    // 何面か・エンドレスのレベル
    const lbl = g.mode === 'story' ? `${g.stageNo} / 3 面　${g.stageDef.emoji} ${g.stageDef.name}` : g.endless ? `♾️ エンドレス ${g.endlessLv > 0 ? `Lv ${g.endlessLv}` : '開始'}　計 ${fmtTime(g.totalTime)}` : `♾️ エンドレス　${g.stageDef.emoji} ${g.stageDef.name}`;
    if (lbl !== this.stageShown) {
      this.stageShown = lbl;
      this.stageLbl.textContent = lbl;
    }
    this.updateMission();
    this.updateCompass(real);
    const bs = g.enemies.bosses;
    const bsig = bs.map((b) => b.def.id).join(',');
    if (bsig !== this.bossSig) {
      this.bossSig = bsig;
      this.bosses.innerHTML = '';
      for (const b of bs) {
        const w = el('div', 'hud-boss', this.bosses);
        // 防御が高い方の種類が効きにくい。見て、どの種類で攻めるか決められるようにする
        el('div', 'hud-boss-name', w, `${b.title ?? b.def.name}　🛡️${Math.round(b.armor)}　🧿${Math.round(b.mr)}`);
        const bar = el('div', 'hud-boss-bar', w);
        el('div', 'hud-boss-fill', bar);
      }
    }
    for (let i = 0; i < bs.length; i++) {
      const fill = this.bosses.children[i]?.querySelector('.hud-boss-fill') as HTMLDivElement | null;
      if (fill) fill.style.width = `${Math.max(0, (bs[i].hp / bs[i].maxHp) * 100).toFixed(1)}%`;
    }
  }

  /** 寄り道の案内: 向き（画面の上が正面）・距離・残り時間・進み具合。 */
  private updateMission(): void {
    const info = this.g.state === 'playing' ? this.g.detours.info() : null;
    if (!info) {
      if (this.mission.style.display !== 'none') this.mission.style.display = 'none';
      this.missionSig = '';
      return;
    }
    this.mission.style.display = 'flex';
    this.missionArrow.style.transform = `rotate(${info.bearing.toFixed(3)}rad)`;
    const sig = `${info.emoji}${info.name}|${info.step}|${Math.ceil(info.left)}|${info.progress.toFixed(2)}|${info.near}`;
    if (sig === this.missionSig) return;
    this.missionSig = sig;
    this.mission.classList.toggle('near', info.near);
    this.mission.classList.toggle('hurry', info.left < 15);
    this.missionText.textContent = `${info.emoji} 寄り道ミッション: ${info.name}　のこり ${Math.ceil(info.left)} 秒`;
    this.missionStep.textContent = `${info.near ? '👉 ' : ''}${info.step}`;
    this.missionHow.textContent = `ごほうび: ${info.reward}`;
    this.missionBar.style.display = info.progress > 0 ? 'block' : 'none';
    this.missionBar.value = info.progress;
  }

  /** たまっている数を、アイコンの左上の数・下のバー・スキル欄の上の一覧に出す。変わったときだけ書き換える。 */
  private renderStacks(): void {
    const list = this.g.stackInfo();
    const sig = list.map((s) => `${s.key}=${s.badge}|${s.fill === undefined ? '' : s.fill.toFixed(2)}|${s.text ?? ''}`).join(';');
    if (sig === this.stackSig) return;
    this.stackSig = sig;
    for (const icon of this.iconOf.values()) {
      icon.querySelector('.hud-stack')?.remove();
      icon.querySelector('.hud-stack-bar')?.remove();
      icon.classList.remove('stacked');
    }
    this.stackList.textContent = '';
    for (const s of list) {
      const icon = this.iconOf.get(s.key);
      if (icon) {
        icon.classList.add('stacked');
        el('span', 'hud-stack', icon, s.badge);
        if (s.fill !== undefined) {
          const bar = document.createElement('progress');
          bar.className = `hud-stack-bar${s.fill >= 0.999 ? ' full' : ''}`;
          bar.max = 1;
          bar.value = Math.max(0, Math.min(1, s.fill));
          bar.setAttribute('aria-label', `${icon.title} のたまり具合`);
          icon.appendChild(bar);
        }
      }
      if (s.text) el('div', 'hud-stackline', this.stackList, s.text);
    }
  }

  setVisible(v: boolean): void {
    this.root.style.display = v ? 'block' : 'none';
  }

  dispose(): void {
    this.root.remove();
  }
}

export { fmtTime };
