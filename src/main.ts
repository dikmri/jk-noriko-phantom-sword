import { Assets } from './core/assets';
import { AudioSys } from './core/audio';
import { Engine } from './core/engine';
import { Input } from './core/input';
import { isUnlocked, loadSave, writeSave } from './core/save';
import { DIFFICULTIES, DifficultyId, difficultyUnlocked, GameMode, RULES, StageId, STAGES, WEAPONS, WeaponDef } from './game/defs';
import { nextStageChoices } from './game/rules';
import { PROP_MODELS } from './game/world';
import { Carry, Game, GameHooks } from './game/game';
import { initLog, log } from './log';
import { Motion, PRESET_MOTIONS } from './motion/motion';
import { h } from './ui/dom';
import { MotionEditor } from './ui/motionEditor';
import { showChest, showLevelUp, showNextStage, showPause, showResult, showSettings, showShop, showStageSelect, showStory, showTitle, showWeaponSelect, UiDeps } from './ui/screens';
import { showSkillBook } from './ui/skillInfo';
import './ui/style.css';

initLog();

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ui = document.getElementById('ui') as HTMLDivElement;
const engine = new Engine(canvas);
const input = new Input(canvas, ui);
const audio = new AudioSys();
const assets = new Assets();
const save = loadSave();

let game: Game | null = null;
let editor: MotionEditor | null = null;
let closeScreen: (() => void) | null = null;
let starting = false;

function applySettings(): void {
  if (engine.quality !== save.settings.quality) engine.setQuality(save.settings.quality);
  audio.setVolume(save.settings.volume, save.settings.bgm);
  input.wantRaw = save.settings.rawMouse;
  if (game) game.fx.shakeScale = save.settings.shake;
}

const deps: UiDeps = { root: ui, audio, save, onSettings: applySettings };

function swap(next: (() => void) | null): void {
  closeScreen?.();
  closeScreen = next;
}

function closeEditor(): void {
  editor?.dispose();
  editor = null;
}

function endGame(): void {
  game?.dispose();
  game = null;
  (window as unknown as { __game: Game | null }).__game = null;
}

// ---------------------------------------------------------------- 画面の流れ
function toTitle(): void {
  log('screen', { name: 'title' });
  closeEditor();
  endGame();
  swap(
    showTitle(deps, (a) => {
      if (a === 'start') {
        if (!save.seenIntro) {
          save.seenIntro = true;
          writeSave(save);
          toStory(() => toEditor('sortie'));
        } else toEditor('sortie');
      } else if (a === 'dojo') toEditor('dojo');
      else if (a === 'shop') swap(showShop(deps, toTitle));
      else if (a === 'book') {
        log('screen', { name: 'book' });
        showSkillBook(ui, null, () => {}, (k) => audio.ui(k));
      }
      else if (a === 'story') toStory(toTitle);
      else swap(showSettings(deps, toTitle));
    }),
  );
}

function toStory(next: () => void): void {
  log('screen', { name: 'story' });
  audio.music(['title'], 'title');
  swap(showStory(deps, next));
}

function toEditor(mode: 'sortie' | 'dojo'): void {
  log('screen', { name: 'motion', mode });
  swap(null);
  closeEditor();
  editor = new MotionEditor({ engine, assets, audio, save, root: ui }, {
    mode,
    onBack: toTitle,
    onDone: (m) => {
      if (mode === 'dojo') toTitle();
      else toStages(m);
    },
  });
}

function pickRule(): string {
  // 初めての登校は、特別な決まりなしで始める
  if (save.stats.runs === 0) return 'normal';
  return RULES[Math.floor(Math.random() * RULES.length)].id;
}

function toStages(motion: Motion): void {
  log('screen', { name: 'stages' });
  closeEditor();
  swap(showStageSelect(deps, (s) => toWeapons(motion, s.id), () => toEditor('sortie')));
}

function toWeapons(motion: Motion, stageId: StageId): void {
  log('screen', { name: 'weapons', stage: stageId });
  closeEditor();
  const ruleId = pickRule();
  const rule = RULES.find((r) => r.id === ruleId)!;
  const mode: GameMode = save.modeId === 'endless' ? 'endless' : 'story';
  swap(showWeaponSelect(deps, rule, (w) => void startGame(motion, w, ruleId, stageId, undefined, mode), () => toStages(motion)));
}

const hooks: GameHooks = {
  levelUp: (choices, info) => showLevelUp(deps, choices, info),
  chest: (items, coins) => showChest(deps, items, coins),
  pause: (owned, stats) => showPause(deps, owned, stats),
  result: (r) => {
    const g = game;
    swap(
      showResult(deps, r, () => {
        if (!g) return toTitle();
        const w = WEAPONS.find((x) => x.id === g.weaponDef.id && isUnlocked(x, save)) ?? WEAPONS[0];
        // もう一度: 最初に選んだステージから、同じ遊び方で
        void startGame(g.motion, w, pickRule(), r.route[0]?.id ?? g.stageDef.id, undefined, r.mode);
      }, toTitle),
    );
  },
  stageClear: (next) => {
    const g = game;
    if (!g) return toTitle();
    const choices = nextStageChoices(STAGES.map((s) => s.id), next.visited, Math.random, 3).map((id) => STAGES.find((s) => s.id === id)!);
    log('screen', { name: 'next', stageNo: next.stageNo, choices: choices.map((c) => c.id) });
    swap(
      showNextStage(deps, { cleared: next.stageNo - 1, level: next.level, time: next.time, kills: next.run.kills, choices }, (s) => {
        void startGame(g.motion, g.weaponDef, g.ruleDef.id, s.id, g.diff.id, 'story', next);
      }, () => {
        swap(null);
        g.leaveAfterClear();
      }),
    );
  },
  quit: toTitle,
};

async function startGame(motion: Motion, weapon: WeaponDef, ruleId: string, stageId: StageId, difficultyId?: DifficultyId, mode: GameMode = 'story', carry: Carry | null = null): Promise<void> {
  if (starting) return;
  starting = true;
  log('screen', { name: 'game', weapon: weapon.id, motion: motion.id, rule: ruleId, stage: stageId, mode, stageNo: carry?.stageNo ?? 1 });
  swap(null);
  closeEditor();
  endGame();
  const stage = STAGES.find((s) => s.id === stageId) ?? STAGES[0];
  // 難易度は、選べるもののうち最後に選んだもの
  const saved = DIFFICULTIES.find((d) => d.id === (difficultyId ?? save.difficultyId));
  const diff = saved && difficultyUnlocked(saved, save.stats) ? saved : DIFFICULTIES[0];
  const loading = h('div', { class: 'screen loading' }, carry ? `${carry.stageNo} 面: ${stage.name}へ移動中…` : `${stage.name}へ移動中…`);
  ui.appendChild(loading);
  try {
    input.requestLock();
    game = await Game.create({ engine, input, audio, assets, save, ui, hooks }, { weapon, motion, ruleId, stageId: stage.id, difficultyId: diff.id, seed: (Math.random() * 0xffffffff) >>> 0, mode, carry });
    (window as unknown as { __game: Game }).__game = game;
  } catch (e) {
    log('exception.start', { message: String(e) }, { stack: (e as Error).stack ?? null });
    loading.textContent = `開始できなかった: ${String(e)}`;
    starting = false;
    return;
  }
  loading.remove();
  starting = false;
}

// 動作確認用（?debug=1 のときだけ）: ステージと武器を指定して、すぐに始める
if (new URLSearchParams(location.search).has('debug')) {
  (window as unknown as { __start: (stage: StageId, weapon?: string, diff?: DifficultyId, mode?: GameMode, carry?: Carry | null) => Promise<void> }).__start = (stage, weapon = 'stick', diff = 'normal', mode = 'story', carry = null) => {
    save.stats.clears = Math.max(save.stats.clears, 1);
    save.stats.hardClears = Math.max(save.stats.hardClears, 1);
    return startGame(save.motions[0] ?? PRESET_MOTIONS[0], WEAPONS.find((w) => w.id === weapon) ?? WEAPONS[0], 'normal', stage, diff, mode, carry);
  };
}

input.onLockChange = (locked) => {
  if (!locked && game && game.state === 'playing') void game.pause();
};
canvas.addEventListener('click', () => {
  audio.ensure();
  if (game && game.state === 'playing' && !input.locked) input.requestLock();
});

// ---------------------------------------------------------------- 読み込みと毎フレームの処理
async function boot(): Promise<void> {
  const loading = h('div', { class: 'screen loading' }, '読み込み中…');
  ui.appendChild(loading);
  const t0 = performance.now();
  const merged: [string, [number, number, number, number]][] = [
    ['e_pervert', [0.6, 1.7, 0.4, 0xc9b28a]], ['e_terrorist', [0.6, 1.7, 0.4, 0x4c5a3a]], ['e_bear', [1.0, 1.9, 0.8, 0x7a4a2a]], ['e_tank', [3.2, 2.2, 5.0, 0x787f54]], ['e_heli', [2.0, 2.4, 5.0, 0xc8b68c]],
    ...WEAPONS.map((w) => [w.model, [0.07, w.length, 0.07, 0x8a5a30]] as [string, [number, number, number, number]]),
    ...PROP_MODELS,
  ];
  const faces = ['neutral', 'blink', 'attack', 'hurt', 'happy', 'smug', 'dead'];
  try {
    await Promise.all([
      assets.loadScene('noriko'),
      ...merged.map(([n, f]) => assets.loadMerged(n, f)),
      ...faces.map((f) => assets.loadTexture(`face_${f}.png`, { flipY: false })),
      assets.loadTexture('ground.jpg', { repeat: true, fallback: 0xd9c59a }),
      assets.loadTexture('fence.jpg', { repeat: true, fallback: 0xb9b2a4 }),
      assets.loadTexture('wall_plain.jpg', { fallback: 0xe9dfc8 }),
      assets.loadTexture('wall_window.jpg', { fallback: 0xc9d8e6 }),
      assets.loadTexture('akiba_win.jpg', { fallback: 0x8a7a9a }),
      assets.loadTexture('akiba_shop.jpg', { fallback: 0xd8c8a8 }),
    ]);
  } catch (e) {
    log('exception.boot', { message: String(e) }, { stack: (e as Error).stack ?? null });
    loading.textContent = `読み込みに失敗した: ${String(e)}`;
    return;
  }
  log('boot.loaded', {}, { ms: Math.round(performance.now() - t0), placeholders: [...assets.merged.entries()].filter(([, m]) => m.placeholder).map(([n]) => n) });
  loading.remove();
  applySettings();
  toTitle();
  let last = performance.now();
  const loop = (now: number) => {
    const dt = (now - last) / 1000;
    last = now;
    try {
      if (game) game.frame(dt);
      else if (editor) editor.frame(dt);
    } catch (e) {
      log('exception.frame', { message: String(e) }, { stack: (e as Error).stack ?? null });
      throw e;
    } finally {
      input.endFrame();
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

void boot();
