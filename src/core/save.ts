import { ShopLevels, StatKey, WEAPONS, WeaponDef } from '../game/defs';
import { log } from '../log';
import { isValidMotion, Motion } from '../motion/motion';

const KEY = 'jknoriko.save.v1';

export interface Settings {
  sens: number;
  volume: number;
  bgm: number;
  invertY: boolean;
  quality: 'low' | 'mid' | 'high';
  shake: number;
  /** マウスの移動量を OS の加速を通さずに受け取る */
  rawMouse: boolean;
}

export interface SaveData {
  v: 1;
  coins: number;
  stats: Record<StatKey, number>;
  shop: ShopLevels;
  /** 自作モーション */
  motions: Motion[];
  motionId: string;
  weaponId: string;
  /** 最後に選んだステージ */
  stageId: string;
  /** 最後に選んだ難易度 */
  difficultyId: string;
  /** 最後に選んだ遊び方（3 面通し / エンドレス） */
  modeId: string;
  settings: Settings;
  seenIntro: boolean;
}

export function defaultSave(): SaveData {
  return {
    v: 1,
    coins: 0,
    stats: { bestTime: 0, totalKills: 0, bossKills: 0, chainKills: 0, maxLevel: 0, maxDestruction: 0, clears: 0, runs: 0, hardClears: 0, storyClears: 0, endlessBest: 0, endlessLv: 0 },
    shop: { hp: 0, power: 0, speed: 0, xp: 0, reroll: 0, magnet: 0, revive: 0 },
    motions: [],
    motionId: 'yoko',
    weaponId: 'stick',
    stageId: 'yard',
    difficultyId: 'normal',
    modeId: 'story',
    settings: { sens: 1, volume: 0.7, bgm: 0.5, invertY: false, quality: 'mid', shake: 1, rawMouse: true },
    seenIntro: false,
  };
}

export function loadSave(): SaveData {
  const d = defaultSave();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) {
      log('save.load', {}, { found: false });
      return d;
    }
    const p = JSON.parse(raw) as Partial<SaveData>;
    if (typeof p.coins === 'number' && Number.isFinite(p.coins)) d.coins = Math.max(0, Math.floor(p.coins));
    for (const k of Object.keys(d.stats) as StatKey[]) {
      const v = p.stats?.[k];
      if (typeof v === 'number' && Number.isFinite(v)) d.stats[k] = v;
    }
    for (const k of Object.keys(d.shop) as (keyof ShopLevels)[]) {
      const v = p.shop?.[k];
      if (typeof v === 'number' && Number.isFinite(v)) d.shop[k] = Math.max(0, Math.floor(v));
    }
    if (Array.isArray(p.motions)) d.motions = p.motions.filter(isValidMotion).slice(0, 8);
    if (typeof p.motionId === 'string') d.motionId = p.motionId;
    if (typeof p.weaponId === 'string') d.weaponId = p.weaponId;
    if (typeof p.stageId === 'string') d.stageId = p.stageId;
    if (typeof p.difficultyId === 'string') d.difficultyId = p.difficultyId;
    if (typeof p.modeId === 'string') d.modeId = p.modeId;
    if (p.settings) d.settings = { ...d.settings, ...p.settings };
    d.seenIntro = !!p.seenIntro;
    log('save.load', {}, { found: true, coins: d.coins, runs: d.stats.runs, motions: d.motions.length });
  } catch (e) {
    log('save.load', {}, { error: String(e) });
  }
  return d;
}

export function writeSave(d: SaveData): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(d));
  } catch (e) {
    log('save.write', {}, { error: String(e) });
  }
}

export function isUnlocked(w: WeaponDef, d: SaveData): boolean {
  return !w.unlock || d.stats[w.unlock.stat] >= w.unlock.gte;
}

export function unlockedWeapons(d: SaveData): WeaponDef[] {
  return WEAPONS.filter((w) => isUnlocked(w, d));
}
