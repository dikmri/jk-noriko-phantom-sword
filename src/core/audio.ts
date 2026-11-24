import { log } from '../log';
import { SongId, SONGS, songEvents } from './songs';

export type SynthBgm = 'none' | 'title' | 'battle' | 'boss' | SongId;

/**
 * BGM の音声ファイル（プロジェクト直下の bgm/ フォルダー）。ファイル名が場面の名前になる。
 * 同じ場面の曲を複数置くときは「yard-2.mp3」「boss_2.mp3」のように、末尾に番号を付ける。
 * 開発サーバーで動かしている間にファイルを足すと、ページが読み直されて使えるようになる。
 */
const FILES = import.meta.glob('/bgm/*.{mp3,ogg,m4a,wav,opus,flac,MP3,OGG,M4A,WAV}', { query: '?url', import: 'default', eager: true }) as Record<string, string>;

/** 場面の名前 → 曲の URL の一覧 */
export const TRACKS = new Map<string, string[]>();
for (const [path, url] of Object.entries(FILES)) {
  const base = path.split('/').pop()!.replace(/\.[^.]+$/, '').toLowerCase();
  const key = base.replace(/[-_ ]\d+$/, '');
  const list = TRACKS.get(key) ?? [];
  list.push(url);
  TRACKS.set(key, list);
}

/** 音声ファイルの曲の音量（合成音の BGM と同じくらいに聞こえる値） */
const FILE_GAIN = 0.55;
/** 曲を入れ替えるときのフェードの秒数 */
const FADE = 1.2;

/**
 * 効果音と BGM。効果音は WebAudio で合成する。
 * BGM は bgm/ フォルダーに曲があればそれを流し、無い場面は合成音で鳴らす。
 * 効果音は「出だしを強く、残響は短く」。同じ音が重なりすぎないよう、種類ごとに最短間隔を設ける。
 */
export class AudioSys {
  ctx?: AudioContext;
  private master?: GainNode;
  private sfxBus?: GainNode;
  private bgmBus?: GainNode;
  private noiseBuf?: AudioBuffer;
  private last = new Map<string, number>();
  private bgmTimer?: number;
  private bgmStep = 0;
  private bgmNext = 0;
  private bgmKind: SynthBgm = 'none';
  /** 音声ファイルの曲 */
  private file: { el: HTMLAudioElement; src: MediaElementAudioSourceNode; gain: GainNode; key: string; url: string } | null = null;
  /** いま流したい曲（AudioContext ができる前に頼まれた分も覚えておく） */
  private want: { keys: string[]; synth: SynthBgm } | null = null;
  volume = 0.7;
  bgmVolume = 0.5;

  /** 最初のユーザー操作で呼ぶ（ブラウザの自動再生制限のため）。 */
  ensure(): boolean {
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
      } catch (e) {
        log('audio.init', {}, { error: String(e) });
        return false;
      }
      const c = this.ctx;
      this.master = c.createGain();
      this.master.gain.value = this.volume;
      const comp = c.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 6;
      this.master.connect(comp).connect(c.destination);
      this.sfxBus = c.createGain();
      this.sfxBus.connect(this.master);
      this.bgmBus = c.createGain();
      this.bgmBus.gain.value = this.bgmVolume * 0.5;
      this.bgmBus.connect(this.master);
      const len = c.sampleRate;
      this.noiseBuf = c.createBuffer(1, len, c.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      log('audio.init', { sampleRate: c.sampleRate }, { state: c.state, tracks: [...TRACKS.entries()].map(([k, v]) => `${k}:${v.length}`) });
      if (this.want) this.music(this.want.keys, this.want.synth);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return true;
  }

  setVolume(v: number, bgm: number): void {
    this.volume = v;
    this.bgmVolume = bgm;
    if (this.master) this.master.gain.value = v;
    if (this.bgmBus) this.bgmBus.gain.value = bgm * 0.5;
  }

  private gate(key: string, minGap: number): boolean {
    if (!this.ctx) return false;
    const now = this.ctx.currentTime;
    const prev = this.last.get(key) ?? -1;
    if (now - prev < minGap) return false;
    this.last.set(key, now);
    return true;
  }

  private tone(freq: number, dur: number, type: OscillatorType, vol: number, slideTo?: number, delay = 0, bus?: GainNode): void {
    // 音の準備（最初のクリック）が済むまでは鳴らさない
    if (!this.ctx) return;
    const c = this.ctx;
    const t = c.currentTime + delay;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo !== undefined) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(bus ?? this.sfxBus!);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private noise(dur: number, vol: number, freq: number, type: BiquadFilterType = 'lowpass', slideTo?: number, delay = 0, q = 0.8): void {
    if (!this.ctx || !this.noiseBuf) return;
    const c = this.ctx;
    const t = c.currentTime + delay;
    const s = c.createBufferSource();
    s.buffer = this.noiseBuf!;
    s.loop = true;
    const f = c.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(freq, t);
    if (slideTo !== undefined) f.frequency.exponentialRampToValueAtTime(Math.max(30, slideTo), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(this.sfxBus!);
    s.start(t, Math.random() * 0.5);
    s.stop(t + dur + 0.02);
  }

  // ---------------------------------------------------------------- 効果音
  swing(power = 1): void {
    if (!this.gate('swing', 0.05)) return;
    this.noise(0.13, 0.22 * power, 900, 'bandpass', 2600, 0, 1.6);
  }

  /** 攻撃が当たった音。strength 0..1 で重さが変わる。 */
  hit(strength = 0.5, crit = false): void {
    if (!this.gate('hit', 0.028)) return;
    const s = Math.min(1, strength);
    this.noise(0.05 + 0.06 * s, 0.5 + 0.3 * s, 2200 - 900 * s, 'lowpass', 300, 0, 0.7);
    this.tone(190 - 70 * s, 0.09 + 0.07 * s, 'square', 0.22 + 0.2 * s, 60);
    if (crit) {
      this.tone(1320, 0.12, 'triangle', 0.3, 660);
      this.noise(0.12, 0.3, 5000, 'highpass');
    }
  }

  /** 硬い物（壁・机）を叩いた音。 */
  clank(strength = 0.5): void {
    if (!this.gate('clank', 0.05)) return;
    this.tone(520 + Math.random() * 120, 0.09, 'square', 0.14 + 0.1 * strength, 300);
    this.noise(0.05, 0.25, 3200, 'bandpass', 1500, 0, 2);
  }

  thud(strength = 0.5): void {
    if (!this.gate('thud', 0.06)) return;
    this.tone(110, 0.14, 'sine', 0.35 + 0.3 * strength, 45);
    this.noise(0.08, 0.2 + 0.2 * strength, 500, 'lowpass');
  }

  explode(size = 1): void {
    if (!this.gate('explode', 0.07)) return;
    const s = Math.min(2.2, size);
    this.noise(0.35 + 0.3 * s, 0.75, 1800, 'lowpass', 90, 0, 0.5);
    this.tone(120, 0.4 + 0.25 * s, 'sine', 0.7, 28);
    this.noise(0.08, 0.5, 6000, 'highpass');
  }

  crumble(size = 1): void {
    if (!this.gate('crumble', 0.09)) return;
    for (let i = 0; i < 4; i++) this.noise(0.12 + Math.random() * 0.1, 0.3 * size, 500 + Math.random() * 900, 'bandpass', 200, i * 0.045, 1.2);
    this.tone(70, 0.3, 'sine', 0.35 * size, 35);
  }

  pickup(): void {
    if (!this.gate('pickup', 0.035)) return;
    this.tone(1180 + Math.random() * 240, 0.07, 'square', 0.07);
  }

  coin(): void {
    if (!this.gate('coin', 0.05)) return;
    this.tone(1568, 0.06, 'square', 0.1);
    this.tone(2093, 0.14, 'square', 0.1, undefined, 0.06);
  }

  heal(): void {
    [523, 659, 784].forEach((f, i) => this.tone(f, 0.16, 'triangle', 0.22, undefined, i * 0.07));
  }

  levelup(): void {
    if (!this.gate('levelup', 0.3)) return;
    // 短いファンファーレ（歓声の代わり）
    const seq = [523, 523, 523, 523, 415, 466, 523, 466, 523];
    const dur = [0.09, 0.09, 0.09, 0.26, 0.26, 0.26, 0.17, 0.09, 0.5];
    let t = 0;
    seq.forEach((f, i) => {
      this.tone(f, dur[i] * 0.95, 'square', 0.16, undefined, t);
      this.tone(f / 2, dur[i] * 0.95, 'triangle', 0.2, undefined, t);
      t += dur[i];
    });
  }

  evolve(): void {
    [392, 523, 659, 784, 1047, 1319].forEach((f, i) => this.tone(f, 0.3, 'sawtooth', 0.14, undefined, i * 0.08));
    this.noise(0.9, 0.2, 800, 'highpass', 6000, 0.1);
  }

  hurt(): void {
    if (!this.gate('hurt', 0.12)) return;
    this.tone(320, 0.2, 'sawtooth', 0.35, 90);
    this.noise(0.1, 0.4, 1200);
  }

  ui(kind: 'move' | 'ok' | 'cancel' | 'error' = 'move'): void {
    if (!this.ctx) return;
    if (kind === 'move') this.tone(880, 0.045, 'square', 0.08);
    else if (kind === 'ok') {
      this.tone(988, 0.06, 'square', 0.1);
      this.tone(1319, 0.12, 'square', 0.1, undefined, 0.06);
    } else if (kind === 'cancel') this.tone(440, 0.1, 'square', 0.09, 300);
    else this.tone(140, 0.18, 'square', 0.14);
  }

  dash(): void {
    if (!this.gate('dash', 0.1)) return;
    this.noise(0.18, 0.3, 500, 'bandpass', 3000, 0, 1.2);
  }

  jump(): void {
    if (!this.gate('jump', 0.1)) return;
    this.tone(330, 0.12, 'square', 0.08, 660);
  }

  thunder(): void {
    if (!this.gate('thunder', 0.08)) return;
    this.noise(0.28, 0.55, 5000, 'highpass', 600);
    this.tone(90, 0.3, 'sawtooth', 0.4, 40);
  }

  freeze(): void {
    if (!this.gate('freeze', 0.2)) return;
    [2093, 2637, 3136, 3951].forEach((f, i) => this.tone(f, 0.18, 'sine', 0.1, undefined, i * 0.03));
  }

  shoot(): void {
    if (!this.gate('shoot', 0.04)) return;
    this.tone(700, 0.07, 'square', 0.07, 240);
  }

  enemyShoot(): void {
    if (!this.gate('eshoot', 0.08)) return;
    this.noise(0.07, 0.3, 1500, 'bandpass', 500, 0, 2);
  }

  /** 画面に見えていない弾が当たりそうなときの、小さめの警告音（短い高音を 2 回）。 */
  warn(): void {
    if (!this.gate('warn', 0.22)) return;
    this.tone(1480, 0.05, 'square', 0.055);
    this.tone(1480, 0.05, 'square', 0.055, undefined, 0.09);
  }

  parry(): void {
    this.tone(1760, 0.16, 'triangle', 0.35, 880);
    this.noise(0.06, 0.4, 6000, 'highpass');
  }

  whoosh(): void {
    if (!this.gate('whoosh', 0.1)) return;
    this.noise(0.4, 0.25, 300, 'bandpass', 1800, 0, 1);
  }

  boss(): void {
    for (let i = 0; i < 3; i++) {
      this.tone(196, 0.25, 'sawtooth', 0.28, 185, i * 0.34);
      this.tone(98, 0.25, 'square', 0.2, 92, i * 0.34);
    }
  }

  death(): void {
    [392, 330, 262, 196, 131].forEach((f, i) => this.tone(f, 0.26, 'square', 0.16, undefined, i * 0.16));
  }

  clear(): void {
    [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => this.tone(f, 0.22, 'square', 0.16, undefined, i * 0.13));
  }

  cat(): void {
    if (!this.gate('cat', 0.4)) return;
    this.tone(700, 0.22, 'sawtooth', 0.08, 1100);
  }

  /** 学校のチャイム（キーンコーンカーンコーン）。 */
  chime(): void {
    if (!this.gate('chime', 2)) return;
    [659, 523, 587, 392, 392, 587, 659, 523].forEach((f, i) => this.tone(f, 0.5, 'sine', 0.16, undefined, i * 0.32));
  }

  /** つるっと滑る。 */
  slip(): void {
    if (!this.gate('slip', 0.08)) return;
    this.tone(420, 0.16, 'triangle', 0.12, 1400);
  }

  /** 水しぶき。 */
  splash(size = 1): void {
    if (!this.gate('splash', 0.06)) return;
    this.noise(0.35 + size * 0.15, Math.min(0.4, 0.14 + size * 0.1), 1600, 'bandpass', 500, 0, 0.7);
  }

  /** 目覚まし時計のベル。 */
  ring(): void {
    if (!this.gate('ring', 0.3)) return;
    for (let i = 0; i < 4; i++) this.tone(2100, 0.04, 'square', 0.05, undefined, i * 0.06);
  }

  /** 大声（メガホン）。 */
  shout(): void {
    if (!this.gate('shout', 0.3)) return;
    this.tone(260, 0.5, 'sawtooth', 0.12, 200);
    this.noise(0.45, 0.25, 900, 'bandpass', 600, 0, 1.2);
  }

  /** シャボン玉が割れる。 */
  pop(): void {
    if (!this.gate('pop', 0.06)) return;
    this.tone(900, 0.06, 'sine', 0.12, 1600);
  }

  /** トランポリン。 */
  boing(): void {
    if (!this.gate('boing', 0.08)) return;
    this.tone(180, 0.3, 'sine', 0.2, 520);
  }

  /** 消火器の噴射。 */
  spray(): void {
    if (!this.gate('spray', 0.2)) return;
    this.noise(0.5, 0.3, 5000, 'highpass', 2500, 0, 0.7);
  }

  /** 車のクラクション。 */
  horn(): void {
    if (!this.gate('horn', 0.6)) return;
    this.tone(415, 0.5, 'square', 0.09);
    this.tone(523, 0.5, 'square', 0.07);
  }

  // ---------------------------------------------------------------- BGM
  /**
   * 場面の曲を流す。keys は bgm/ のファイル名の候補（前から順に探す）。
   * どれも無ければ synth の合成音を鳴らす。同じ曲が流れているときは何もしない。
   */
  music(keys: string[], synth: SynthBgm): void {
    this.want = { keys, synth };
    if (!this.ctx || !this.bgmBus) return;
    const key = keys.find((k) => TRACKS.get(k)?.length);
    if (!key) {
      this.stopFile();
      this.synth(synth);
      return;
    }
    if (this.file?.key === key) return;
    this.synth('none');
    const urls = TRACKS.get(key)!;
    this.playFile(key, urls[Math.floor(Math.random() * urls.length)], urls.length > 1);
  }

  /** BGM を止める（音声ファイルの曲も合成音も）。 */
  bgm(kind: SynthBgm): void {
    if (kind === 'none') {
      this.want = null;
      this.stopFile();
      this.synth('none');
      return;
    }
    this.music([], kind);
  }

  private playFile(key: string, url: string, variants: boolean): void {
    const c = this.ctx!;
    const el = new Audio(url);
    el.preload = 'auto';
    // 曲が 1 つしか無い場面は繰り返す。複数あれば、終わるたびに別の曲へ
    el.loop = !variants;
    const src = c.createMediaElementSource(el);
    const gain = c.createGain();
    const t = c.currentTime;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(FILE_GAIN, t + FADE);
    src.connect(gain).connect(this.bgmBus!);
    el.addEventListener('ended', () => {
      if (this.file?.el !== el) return;
      const urls = TRACKS.get(key) ?? [url];
      const others = urls.filter((u) => u !== url);
      const next = others.length ? others[Math.floor(Math.random() * others.length)] : url;
      this.file = null;
      this.playFile(key, next, variants);
    });
    el.addEventListener('error', () => log('audio.music.error', { key, url }, { code: el.error?.code ?? null }));
    el.play().catch((e) => log('audio.music.error', { key, url }, { error: String(e) }));
    this.stopFile();
    this.file = { el, src, gain, key, url };
    log('audio.music', { key }, { file: decodeURIComponent(url.split('/').pop() ?? url) });
  }

  /** 流れている曲をフェードアウトして止める。 */
  private stopFile(): void {
    const f = this.file;
    if (!f || !this.ctx) return;
    this.file = null;
    const t = this.ctx.currentTime;
    f.gain.gain.cancelScheduledValues(t);
    f.gain.gain.setValueAtTime(f.gain.gain.value, t);
    f.gain.gain.linearRampToValueAtTime(0, t + FADE);
    window.setTimeout(() => {
      f.el.pause();
      f.src.disconnect();
      f.gain.disconnect();
      f.el.removeAttribute('src');
      f.el.load();
    }, FADE * 1000 + 100);
  }

  /** 合成音の BGM。 */
  private synth(kind: SynthBgm): void {
    if (this.bgmKind === kind) return;
    this.bgmKind = kind;
    this.bgmStep = 0;
    if (this.bgmTimer !== undefined) {
      clearInterval(this.bgmTimer);
      this.bgmTimer = undefined;
    }
    if (kind === 'none' || !this.ctx) return;
    this.bgmNext = this.ctx.currentTime + 0.1;
    this.bgmTimer = window.setInterval(() => this.bgmTick(), 60);
    log('audio.bgm', { kind }, { song: kind in SONGS ? SONGS[kind as SongId].name : kind });
  }

  private bgmTick(): void {
    const c = this.ctx;
    if (!c || !this.bgmBus) return;
    const song = SONGS[this.bgmKind as SongId];
    const bpm = song ? song.bpm : this.bgmKind === 'title' ? 92 : this.bgmKind === 'boss' ? 168 : 150;
    const stepDur = 60 / bpm / 4;
    while (this.bgmNext < c.currentTime + 0.2) {
      const delay = Math.max(0, this.bgmNext - c.currentTime);
      this.bgmNote(this.bgmStep, delay, stepDur);
      this.bgmStep++;
      this.bgmNext += stepDur;
    }
  }

  private bgmNote(step: number, delay: number, sd: number): void {
    const bus = this.bgmBus!;
    const N = (semi: number) => 220 * Math.pow(2, semi / 12);
    // 2 面・3 面・2 面以降のボス・エンドレスの曲（songs.ts）
    const song = SONGS[this.bgmKind as SongId];
    if (song) {
      for (const e of songEvents(song, step)) {
        if (e.t === 'tone') this.tone(N(e.semi), sd * e.len, e.wave, e.vol, undefined, delay, bus);
        else if (e.t === 'kick') this.tone(70, 0.1, 'sine', 0.4, 35, delay, bus);
        else if (e.t === 'snare') this.bgmNoise(delay, 0.09, 0.16, 1800);
        else if (e.t === 'hat') this.bgmNoise(delay, 0.03, 0.06, 7000);
        else this.bgmNoise(delay, 0.14, 0.06, 6000);
      }
      return;
    }
    if (this.bgmKind === 'title') {
      // ハープ風の上り下りのアルペジオ（Am - F - C - G）
      const chords = [[0, 3, 7, 12], [-4, 0, 5, 8], [3, 7, 10, 15], [-2, 2, 7, 10]];
      const bar = Math.floor(step / 16) % 4;
      const i = step % 16;
      const ch = chords[bar];
      const up = i < 8 ? i : 15 - i;
      const semi = ch[up % 4] + 12 * Math.floor(up / 4);
      this.tone(N(semi), sd * 3.2, 'triangle', 0.16, undefined, delay, bus);
      if (i === 0) this.tone(N(ch[0] - 12), sd * 15, 'sine', 0.14, undefined, delay, bus);
      return;
    }
    const boss = this.bgmKind === 'boss';
    const prog = boss ? [0, 0, 1, 0, 3, 3, 1, -2] : [0, 0, -4, -2, 0, 0, 5, 3];
    const bar = Math.floor(step / 16) % prog.length;
    const i = step % 16;
    const root = prog[bar];
    // ベース（8分で刻む）
    if (i % 2 === 0) this.tone(N(root - 24 + (i % 8 === 6 ? 7 : 0)), sd * 1.7, 'triangle', 0.3, undefined, delay, bus);
    // ドラム代わりのノイズ
    if (i % 8 === 4) this.bgmNoise(delay, 0.09, 0.16, 1800);
    if (i % 4 === 2) this.bgmNoise(delay, 0.03, 0.07, 7000);
    if (i % 8 === 0) this.tone(70, 0.1, 'sine', 0.4, 35, delay, bus);
    // メロディ
    const mel = boss
      ? [12, -1, 15, 12, 10, -1, 12, 15, 17, -1, 15, 12, 10, 8, 7, -1]
      : [12, -1, 12, 15, 17, -1, 15, 12, 19, -1, 17, 15, 12, 10, 12, -1];
    const alt = [7, -1, 10, 12, 15, 12, 10, 7, 12, -1, 15, -1, 17, 15, 12, -1];
    const line = bar % 4 === 3 ? alt : mel;
    const s = line[i];
    if (s >= 0) this.tone(N(root + s), sd * 1.5, 'square', 0.085, undefined, delay, bus);
    if (i % 4 === 0) this.tone(N(root + 7), sd * 3.5, 'sawtooth', 0.035, undefined, delay, bus);
  }

  private bgmNoise(delay: number, dur: number, vol: number, freq: number): void {
    const c = this.ctx!;
    const t = c.currentTime + delay;
    const s = c.createBufferSource();
    s.buffer = this.noiseBuf!;
    const f = c.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = freq;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(this.bgmBus!);
    s.start(t, Math.random() * 0.5);
    s.stop(t + dur + 0.02);
  }
}
