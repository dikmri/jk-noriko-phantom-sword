/**
 * 合成音の曲（2 面・3 面・2 面以降のボス・エンドレス）。音の高さは 220Hz（ラ）を 0 とした半音で書く。
 * 1 小節は 16 ステップ（16 分音符）。小節ごとに prog の根音へ移調する。
 * 鳴らす処理は AudioSys が持ち、ここは「どのステップで何を鳴らすか」だけを決める（音を出さずに確かめられる）。
 */
export type SongId = 'battle2' | 'battle3' | 'boss2' | 'endless';

export interface Song {
  /** 曲名（ログに出す） */
  name: string;
  bpm: number;
  /** 小節ごとの根音 */
  prog: number[];
  /** ベース（根音から 2 オクターブ下を 0 とした半音。null は休み） */
  bass: (number | null)[];
  bassWave: OscillatorType;
  bassVol: number;
  /** メロディのパターン（根音からの半音）と、小節ごとにどのパターンを使うか */
  mel: (number | null)[][];
  melOrder: number[];
  melWave: OscillatorType;
  melVol: number;
  /** 和音の刻み（鳴らすステップと、根音からの半音） */
  chord?: { at: number[]; semis: number[]; wave: OscillatorType; vol: number; len: number };
  /** アルペジオ（根音からの半音を順に、every ステップごと） */
  arp?: { semis: number[]; every: number; wave: OscillatorType; vol: number };
  /** ドラム（16 文字）: k キック / s スネア / h ハイハット / o オープンハイハット / . 休み。1 行が 1 つの音 */
  drums: string[];
}

export type SongEvent =
  | { t: 'tone'; semi: number; len: number; wave: OscillatorType; vol: number }
  | { t: 'kick' }
  | { t: 'snare' }
  | { t: 'hat' }
  | { t: 'open' };

const _ = null;

export const SONGS: Record<SongId, Song> = {
  // 2 面「放課後ファンク」: はねるベースと裏拍の和音。Dm - G - C - A
  battle2: {
    name: '放課後ファンク',
    bpm: 156,
    prog: [5, 5, 10, 10, 3, 3, 0, 0],
    bass: [0, _, 12, 0, _, 0, 12, _, 0, _, 10, _, 7, _, 12, _],
    bassWave: 'triangle',
    bassVol: 0.3,
    mel: [
      [12, _, 15, 17, _, 15, 12, _, 19, _, 17, 15, 17, _, 12, _],
      [24, _, 22, 19, _, 17, 15, _, 17, 19, _, 15, 12, _, _, _],
      [_, _, 12, 12, 15, _, 12, _, _, _, 10, 12, _, _, _, _],
    ],
    melOrder: [0, 2, 0, 1, 0, 2, 1, 1],
    melWave: 'square',
    melVol: 0.075,
    chord: { at: [2, 6, 10, 14], semis: [10, 15, 19], wave: 'triangle', vol: 0.035, len: 1 },
    drums: ['k.....k..k......', '....s.......s..s', 'h.hhh.hhh.hhh.ho'],
  },
  // 3 面「決戦前夜」: 刻むベースと流れるアルペジオ。Em - C - D - Am - B
  battle3: {
    name: '決戦前夜',
    bpm: 172,
    prog: [7, 7, 3, 5, 7, 7, 0, 2],
    bass: [0, _, 0, _, 0, _, 0, _, 0, _, 0, _, 0, _, 12, _],
    bassWave: 'sawtooth',
    bassVol: 0.16,
    mel: [
      [19, _, _, 17, 19, _, 22, _, 24, _, 22, _, 19, _, 17, _],
      [24, _, 26, 27, _, 26, 24, _, 22, _, 19, _, 22, _, _, _],
      [_, _, _, _, 12, 14, 15, 17, 19, _, _, _, _, _, _, _],
    ],
    melOrder: [0, 0, 1, 2, 0, 0, 1, 1],
    melWave: 'square',
    melVol: 0.08,
    arp: { semis: [12, 19, 24, 27, 24, 19], every: 1, wave: 'triangle', vol: 0.032 },
    drums: ['k...k...k...k...', '....s.......s.s.', 'hhhhhhhhhhhhhhhh'],
  },
  // 2 面以降のボス「強敵、再び」: 半音でにじり寄る低音と、増 4 度の和音
  boss2: {
    name: '強敵、再び',
    bpm: 176,
    prog: [0, 0, 1, 1, 0, 0, -2, -1],
    bass: [0, 0, 12, 0, 0, 12, 0, 0, 1, 0, 12, 0, 0, 13, 0, 12],
    bassWave: 'sawtooth',
    bassVol: 0.13,
    mel: [
      [12, _, 13, _, 12, _, 18, _, 17, _, 13, _, 12, _, _, _],
      [24, _, 23, 24, _, 18, _, 17, 15, _, 13, _, 12, _, 13, _],
    ],
    melOrder: [0, 0, 1, 0, 0, 1, 1, 1],
    melWave: 'sawtooth',
    melVol: 0.06,
    chord: { at: [0, 3, 6], semis: [12, 18], wave: 'square', vol: 0.03, len: 2 },
    drums: ['k..k..k.k..k..k.', '....s.......s...', 'h.h.h.h.h.h.h.hh'],
  },
  // エンドレス「終わらない放課後」: 速いテンポで、終わりの来ない上り下り。F#m - D - E - C#
  endless: {
    name: '終わらない放課後',
    bpm: 184,
    prog: [9, 9, 5, 7, 9, 9, 5, 4],
    bass: [0, _, 0, 12, _, 0, 0, _, 0, _, 0, 12, _, 0, 7, _],
    bassWave: 'triangle',
    bassVol: 0.3,
    mel: [
      [12, 15, 19, 24, _, 22, 19, _, 17, _, 15, _, 12, _, 14, 15],
      [24, _, 24, 22, 19, _, 22, _, 27, _, 26, 24, 22, _, 19, _],
    ],
    melOrder: [0, 1, 0, 1, 0, 1, 1, 0],
    melWave: 'square',
    melVol: 0.075,
    arp: { semis: [0, 3, 7, 12, 7, 3], every: 1, wave: 'triangle', vol: 0.03 },
    drums: ['k...k...k...k...', '....s..s....s...', 'h.hhh.hhh.hhh.hh', '..............o.'],
  },
};

const DRUM: Record<string, SongEvent> = { k: { t: 'kick' }, s: { t: 'snare' }, h: { t: 'hat' }, o: { t: 'open' } };

/** step（曲の頭からの 16 分音符の番号）で鳴らす音。 */
export function songEvents(song: Song, step: number): SongEvent[] {
  const out: SongEvent[] = [];
  const bar = Math.floor(step / 16) % song.prog.length;
  const i = step % 16;
  const root = song.prog[bar];
  const b = song.bass[i];
  if (b !== null) out.push({ t: 'tone', semi: root - 24 + b, len: 1.7, wave: song.bassWave, vol: song.bassVol });
  const m = song.mel[song.melOrder[bar % song.melOrder.length]][i];
  if (m !== null) out.push({ t: 'tone', semi: root + m, len: 1.5, wave: song.melWave, vol: song.melVol });
  const c = song.chord;
  if (c && c.at.includes(i)) for (const s of c.semis) out.push({ t: 'tone', semi: root + s, len: c.len, wave: c.wave, vol: c.vol });
  const a = song.arp;
  if (a && i % a.every === 0) out.push({ t: 'tone', semi: root + a.semis[(i / a.every) % a.semis.length], len: a.every * 0.9, wave: a.wave, vol: a.vol });
  for (const row of song.drums) {
    const d = DRUM[row[i]];
    if (d) out.push(d);
  }
  return out;
}
