import { AudioSys } from '../core/audio';
import { isUnlocked, SaveData, writeSave } from '../core/save';
import { DIFFICULTIES, difficultyUnlocked, ENEMIES, GameMode, ITEM_MAP, MODES, RuleDef, SHOP, SKILL_MAP, StageDef, STAGES, STORY_STAGES, TIERS, WEAPONS, WeaponDef } from '../game/defs';
import { fmtTime } from '../game/hud';
import type { LevelUpAnswer, ResultData } from '../game/game';
import { BREAK_INFO, Choice, itemPow, PASSIVE_UNLIMITED } from '../game/rules';
import { log } from '../log';
import { button, clear, h } from './dom';
import { cardSynergy, dmgBadge, itemCardSynergy, ownedPanel, OwnedSkills, scopeBadge, scopeBadgeOf, scopeLegend, showSkillBook, statsPanel } from './skillInfo';

const BASE = import.meta.env.BASE_URL;

export interface UiDeps {
  root: HTMLElement;
  audio: AudioSys;
  save: SaveData;
  onSettings: () => void;
}

/** 画面全体を覆うレイヤーを 1 枚作る。 */
function layer(root: HTMLElement, cls: string): HTMLDivElement {
  const d = h('div', { class: `screen ${cls}` });
  root.appendChild(d);
  return d;
}

// ====================================================================== タイトル
export type TitleAction = 'start' | 'dojo' | 'shop' | 'book' | 'story' | 'settings';

export function showTitle(d: UiDeps, onPick: (a: TitleAction) => void): () => void {
  const el = layer(d.root, 'title');
  const s = d.save.stats;
  const items: [TitleAction, string][] = [
    ['start', 'はじめる'],
    ['dojo', 'モーション道場'],
    ['shop', '購買部'],
    ['book', 'スキル図鑑'],
    ['story', 'あらすじ'],
    ['settings', 'せってい'],
  ];
  let sel = 0;
  const menu = h('div', { class: 'title-menu' });
  const rows = items.map(([id, label], i) =>
    h('div', {
      class: 'title-item',
      onmouseenter: () => {
        if (sel !== i) {
          sel = i;
          d.audio.ui('move');
          refresh();
        }
      },
      onclick: () => choose(i),
    }, h('span', { class: 'title-cursor' }, '👉'), label),
  );
  rows.forEach((r) => menu.appendChild(r));
  const refresh = () => rows.forEach((r, i) => r.classList.toggle('sel', i === sel));
  const choose = (i: number) => {
    d.audio.ensure();
    d.audio.ui('ok');
    log('ui.title.pick', { item: items[i][0] });
    onPick(items[i][0]);
  };
  refresh();
  el.append(
    h('div', { class: 'title-art', style: `background-image:url(${BASE}img/title.jpg)` }),
    h('div', { class: 'title-logo' },
      h('div', { class: 'title-sub' }, 'JK ノリコ の'),
      h('div', { class: 'title-main' }, 'ファントム・ソード'),
      h('div', { class: 'title-en' }, 'P H A N T O M   S W O R D   o f   J K   N O R I K O'),
    ),
    menu,
    h('div', { class: 'title-record' }, s.runs > 0 ? `最長 ${fmtTime(s.bestTime)}　累計 ${s.totalKills} 体　登校 ${s.runs} 回　🪙 ${d.save.coins}` : '木の棒を拾った。もう何も怖くない。'),
    h('div', { class: 'title-copy' }, '© 妄想 ノリコ　※この物語はフィクションであり、木の棒で戦うことを推奨しません'),
  );
  const key = (e: KeyboardEvent) => {
    if (e.code === 'ArrowDown' || e.code === 'KeyS') {
      sel = (sel + 1) % items.length;
      d.audio.ensure();
      d.audio.ui('move');
      refresh();
    } else if (e.code === 'ArrowUp' || e.code === 'KeyW') {
      sel = (sel + items.length - 1) % items.length;
      d.audio.ensure();
      d.audio.ui('move');
      refresh();
    } else if (e.code === 'Enter' || e.code === 'Space') choose(sel);
  };
  window.addEventListener('keydown', key);
  // 音は最初のクリックのあとで出せる（ブラウザの自動再生の制限）
  el.addEventListener('pointerdown', () => {
    if (d.audio.ensure()) d.audio.music(['title'], 'title');
  }, { once: true });
  d.audio.music(['title'], 'title');
  return () => {
    window.removeEventListener('keydown', key);
    el.remove();
  };
}

// ====================================================================== あらすじ
const STORY: { img?: string; lines: string[] }[] = [
  { img: 'story1.jpg', lines: ['ノリコ、17歳。', 'ちょっと妄想が多めの女子高生。'] },
  { img: 'story1.jpg', lines: ['ある日の帰り道、彼女は運命の出会いをする。', '──木の棒である。'] },
  { img: 'story2.jpg', lines: ['「これは……伝説の剣、ファントム・ソード……！」', 'ひとしきり振り回して、彼女は確信した。'] },
  { img: 'story2.jpg', lines: ['「学校にテロリストとクマと変質者が来ても、', '　コイツでボコボコにできる！」'] },
  { img: 'story3.jpg', lines: ['翌日。5時間目の授業中。', '廊下から悲鳴が聞こえた。'] },
  { img: 'story3.jpg', lines: ['「テロリスト軍団とクマの群れと変質者グループが、', '　学校に襲ってきたぞ！！」'] },
  { img: 'story3.jpg', lines: ['教室は大パニック。', 'だが、ノリコだけは違った。'] },
  { img: 'story2.jpg', lines: ['なぜなら、カバンの中に──', '昨日拾った木の棒が入っていたからだ！'] },
];

/** あらすじ。クリックで次へ、いつでもスキップできる。 */
export function showStory(d: UiDeps, onDone: () => void): () => void {
  const el = layer(d.root, 'story');
  let page = 0;
  const img = h('div', { class: 'story-img' });
  const text = h('div', { class: 'story-text' });
  const hint = h('div', { class: 'story-hint' }, 'クリック / Space で次へ');
  const finish = () => {
    log('ui.story.end', { page });
    cleanup();
    onDone();
  };
  const render = () => {
    const p = STORY[page];
    img.style.backgroundImage = p.img ? `url(${BASE}img/${p.img})` : 'none';
    clear(text);
    p.lines.forEach((l, i) => text.appendChild(h('div', { class: 'story-line', style: `animation-delay:${i * 0.5}s` }, l)));
  };
  const next = () => {
    d.audio.ensure();
    d.audio.ui('move');
    page++;
    if (page >= STORY.length) finish();
    else render();
  };
  const key = (e: KeyboardEvent) => {
    if (e.code === 'Space' || e.code === 'Enter') next();
    else if (e.code === 'Escape') finish();
  };
  el.append(img, text, hint, button('スキップ ▶▶', 'story.skip', finish, 'btn story-skip'));
  el.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('button')) return;
    next();
  });
  window.addEventListener('keydown', key);
  const cleanup = () => {
    window.removeEventListener('keydown', key);
    el.remove();
  };
  render();
  log('ui.story.open', {});
  return cleanup;
}

// ====================================================================== 武器えらび
function bar(label: string, v: number, max: number): HTMLElement {
  return h('div', { class: 'stat-bar' }, h('span', { class: 'stat-label' }, label), h('span', { class: 'stat-track' }, h('span', { class: 'stat-fill', style: `width:${Math.min(100, (v / max) * 100).toFixed(0)}%` })));
}

export function showWeaponSelect(d: UiDeps, rule: RuleDef, onPick: (w: WeaponDef) => void, onBack: () => void): () => void {
  const el = layer(d.root, 'panel-screen weapons');
  const grid = h('div', { class: 'weapon-grid' });
  for (const w of WEAPONS) {
    const open = isUnlocked(w, d.save);
    const card = h('div', { class: `weapon-card${open ? '' : ' locked'}${d.save.weaponId === w.id && open ? ' sel' : ''}` },
      h('div', { class: 'weapon-emoji' }, open ? w.emoji : '🔒'),
      h('div', { class: 'weapon-name' }, open ? w.name : '？？？'),
      open ? h('div', { class: 'weapon-desc' }, w.desc) : h('div', { class: 'weapon-desc' }, `解放条件: ${w.unlock!.text}`),
      open ? h('div', { class: 'weapon-stats' }, bar('威力', w.damage, 42), bar('重さ', w.mass, 8), bar('長さ', w.length, 1.6), bar('速さ', w.swingSpeed, 26)) : null,
    );
    if (open) {
      card.addEventListener('click', () => {
        d.audio.ui('ok');
        log('ui.weapon.pick', { id: w.id });
        d.save.weaponId = w.id;
        writeSave(d.save);
        onPick(w);
      });
    }
    grid.appendChild(card);
  }
  el.append(
    h('div', { class: 'panel-title' }, '武器をえらぶ'),
    h('div', { class: 'rule-box' }, h('b', null, `本日の校則: ${rule.name}`), h('span', null, rule.desc)),
    grid,
    h('div', { class: 'panel-foot' }, button('◀ もどる', 'weapon.back', onBack, 'btn ghost')),
  );
  return () => el.remove();
}

// ====================================================================== ステージえらび
export function showStageSelect(d: UiDeps, onPick: (s: StageDef) => void, onBack: () => void): () => void {
  const el = layer(d.root, 'panel-screen stages');
  const title = h('div', { class: 'panel-title' });
  const sub = h('div', { class: 'panel-sub' });
  // 遊び方（3 面通し / エンドレス）
  const modeRow = h('div', { class: 'diff-row mode-row' });
  const modeOf = (): GameMode => (d.save.modeId === 'endless' ? 'endless' : 'story');
  const modeButtons = MODES.map((m) => {
    const best = m.id === 'endless' && d.save.stats.endlessBest > 0 ? `自己ベスト ${fmtTime(d.save.stats.endlessBest)}（Lv ${d.save.stats.endlessLv}）` : '';
    const b = h('div', { class: `diff-card mode-card mode-${m.id}`, 'data-click': '1' },
      h('div', { class: 'diff-name' }, `${m.emoji} ${m.name}`),
      h('div', { class: 'diff-desc' }, m.desc),
      ...(best ? [h('div', { class: 'mode-best' }, best)] : []),
    );
    b.addEventListener('click', () => {
      d.audio.ui('ok');
      d.save.modeId = m.id;
      writeSave(d.save);
      log('ui.mode.pick', { id: m.id });
      refreshMode();
    });
    modeRow.appendChild(b);
    return { m, b };
  });
  const refreshMode = () => {
    const cur = modeOf();
    for (const x of modeButtons) x.b.classList.toggle('sel', x.m.id === cur);
    title.textContent = cur === 'story' ? '最初の現場はどこ？' : 'どこで耐える？';
    sub.textContent = cur === 'story'
      ? `育てたまま ${STORY_STAGES} つのステージを回る。1 面をクリアすると、次の現場を選べる。ステージごとに、物理で遊べる仕掛けがある。`
      : 'ラスボスを倒したあとも、強くなったラスボスが次々に来る。倒れるまでの時間が記録になる。';
  };
  refreshMode();
  // 難易度（選べないものは鍵つきで、条件を出す）
  const diffRow = h('div', { class: 'diff-row' });
  const diffButtons = DIFFICULTIES.map((df) => {
    const open = difficultyUnlocked(df, d.save.stats);
    const b = h('div', { class: `diff-card diff-${df.id}${open ? '' : ' locked'}`, 'data-click': open ? '1' : undefined },
      h('div', { class: 'diff-name' }, open ? `${df.emoji} ${df.name}` : `🔒 ${df.name}`),
      h('div', { class: 'diff-desc' }, open ? df.desc : `解放条件: ${df.unlock?.text ?? ''}`),
    );
    if (open) {
      b.addEventListener('click', () => {
        d.audio.ui('ok');
        d.save.difficultyId = df.id;
        writeSave(d.save);
        log('ui.difficulty.pick', { id: df.id });
        refresh();
      });
    }
    diffRow.appendChild(b);
    return { df, b, open };
  });
  const refresh = () => {
    const cur = diffButtons.find((x) => x.open && x.df.id === d.save.difficultyId) ?? diffButtons[0];
    for (const x of diffButtons) x.b.classList.toggle('sel', x === cur);
  };
  refresh();
  const grid = h('div', { class: 'stage-grid' });
  for (const s of STAGES) {
    const card = h('div', { class: `stage-card stage-${s.id}${d.save.stageId === s.id ? ' sel' : ''}`, 'data-click': '1' },
      h('div', { class: 'stage-head' }, h('span', { class: 'stage-emoji' }, s.emoji), h('span', { class: 'stage-name' }, s.name)),
      h('div', { class: 'stage-desc' }, s.desc),
      h('ul', { class: 'stage-gimmicks' }, ...s.gimmicks.map((t) => h('li', null, t))),
    );
    card.addEventListener('click', () => {
      d.audio.ui('ok');
      log('ui.stage.pick', { id: s.id });
      d.save.stageId = s.id;
      writeSave(d.save);
      onPick(s);
    });
    card.addEventListener('mouseenter', () => d.audio.ui('move'));
    grid.appendChild(card);
  }
  el.append(
    title,
    sub,
    modeRow,
    diffRow,
    grid,
    h('div', { class: 'panel-foot' }, button('◀ もどる', 'stage.back', onBack, 'btn ghost')),
  );
  return () => el.remove();
}

// ====================================================================== レベルアップ
export function describeChoice(c: Choice): { emoji: string; name: string; tag: string; desc: string; cls: string } {
  if (c.kind === 'bonus') {
    return c.id === 'heal'
      ? { emoji: '🍙', name: 'おにぎり', tag: 'おまけ', desc: 'HP を 30% 回復する。', cls: 'bonus' }
      : { emoji: '🪙', name: 'おこづかい', tag: 'おまけ', desc: 'コインを 10 枚もらう。', cls: 'bonus' };
  }
  if (c.kind === 'item') {
    const it = ITEM_MAP[c.id];
    return { emoji: it.emoji, name: it.name, tag: 'アイテム', desc: it.desc, cls: `item ${it.rarity}` };
  }
  if (c.kind === 'itemup') {
    const it = ITEM_MAP[c.id];
    return { emoji: it.emoji, name: it.name, tag: `★${c.level - 1} → ★${c.level}`, desc: `効果が ×${itemPow(c.level).toFixed(1)} になる（短所は増えない）。\n${it.desc}`, cls: 'item up' };
  }
  if (c.kind === 'weapon') {
    return { emoji: '🔨', name: '棒を鍛える', tag: `Lv ${c.level - 1} → ${c.level}`, desc: '【棒の攻撃】のダメージ +10%（何回でも選べる）。振る速さも少し上がる（+30% まで）。\n棒の威力は AD に足されるので、AD で強くなるスキルも少し強くなる。', cls: 'up weapon' };
  }
  const def = SKILL_MAP[c.id];
  if (c.kind === 'break') {
    const evo = def.kind === 'active' && def.evo && def.evo.emoji ? def.evo : null;
    const name = evo && def.evo ? def.evo.name : def.name;
    if (def.kind === 'active' && c.sub) {
      return { emoji: evo ? evo.emoji : def.emoji, name, tag: `限界突破 +${c.level}`, desc: `${BREAK_INFO[c.sub].text}（このスキルだけ）。\n威力の突破は何回でもできる（待ち時間と範囲は 6 回、数は 3 回まで）。`, cls: 'break' };
    }
    return { emoji: def.emoji, name: def.name, tag: `限界突破 +${c.level}`, desc: `「${def.up}」の半分の効果が、もう 1 回付く。${PASSIVE_UNLIMITED.has(def.id) ? '\nこの強化は、何回でも突破できる。' : ''}`, cls: 'break' };
  }
  if (c.kind === 'evolve' && def.evo) return { emoji: def.evo.emoji, name: def.evo.name, tag: '進化！', desc: def.evo.desc, cls: 'evolve' };
  if (c.kind === 'new') {
    const evo = def.evo ? `\n（最大まで育てて「${SKILL_MAP[def.evo.with].name}」を持つと進化）` : '';
    return { emoji: def.emoji, name: def.name, tag: def.kind === 'active' ? 'あたらしい攻撃' : 'あたらしい強化', desc: def.desc + evo, cls: `new ${def.rarity}` };
  }
  return { emoji: def.emoji, name: def.name, tag: `Lv ${c.level - 1} → ${c.level}`, desc: def.up, cls: 'up' };
}

/** レベルアップ画面を開いてから、選択を受け付けるまでの時間 (ms) */
const LEVELUP_GUARD_MS = 450;

export function showLevelUp(d: UiDeps, choices: Choice[], info: { level: number; rerolls: number; banishes: number; owned: OwnedSkills; mode: 'skill' | 'item' }): Promise<LevelUpAnswer> {
  return new Promise((resolve) => {
    const el = layer(d.root, 'overlay levelup guard');
    let banishMode = false;
    let closeBook: (() => void) | null = null;
    const panel = ownedPanel(info.owned);
    const openBook = () => {
      if (closeBook) return;
      d.audio.ui('ok');
      closeBook = showSkillBook(d.root, info.owned, () => {
        closeBook = null;
      }, (k) => d.audio.ui(k));
    };
    // 開いた直後は入力を受けない。攻撃で左クリックを連打していると、開いた瞬間にそのまま選んでしまうため
    const openAt = performance.now();
    const guarded = (): boolean => performance.now() - openAt < LEVELUP_GUARD_MS;
    const guardTimer = window.setTimeout(() => el.classList.remove('guard'), LEVELUP_GUARD_MS);
    el.addEventListener('click', (e) => {
      if (!guarded()) return;
      e.stopPropagation();
      log('levelup.guard', { ms: Math.round(performance.now() - openAt) }, { ignored: 'click' });
    }, true);
    const done = (a: LevelUpAnswer) => {
      window.clearTimeout(guardTimer);
      window.removeEventListener('keydown', key);
      closeBook?.();
      el.remove();
      resolve(a);
    };
    const cards = h('div', { class: 'lv-cards' });
    const pick = (i: number) => {
      const c = choices[i];
      if (!c) return;
      if (guarded()) {
        log('levelup.guard', { ms: Math.round(performance.now() - openAt) }, { ignored: 'key' });
        return;
      }
      if (banishMode) {
        if (c.kind !== 'new') {
          d.audio.ui('error');
          return;
        }
        d.audio.ui('cancel');
        done({ banish: c });
        return;
      }
      d.audio.ui('ok');
      done({ pick: c });
    };
    choices.forEach((c, i) => {
      const t = describeChoice(c);
      // 進化のカードは、それ自体がシナジーの結果なので、つながりの欄を付けない
      const syn = c.kind === 'new' || c.kind === 'up' ? cardSynergy(c.id, info.owned) : c.kind === 'item' || c.kind === 'itemup' ? itemCardSynergy(c.id, info.owned) : null;
      cards.appendChild(
        h('div', {
          class: `lv-card ${t.cls}${syn ? ' has-syn' : ''}`, style: `animation-delay:${i * 0.06}s`, onclick: () => pick(i),
          onmouseenter: () => {
            d.audio.ui('move');
            panel.highlight(syn ? syn.links : null);
          },
          onmouseleave: () => panel.highlight(null),
        },
          h('div', { class: 'lv-key' }, String(i + 1)),
          syn ? h('div', { class: 'lv-syn-badge' }, `シナジー ${syn.links.length}`) : null,
          h('div', { class: 'lv-emoji' }, t.emoji),
          h('div', { class: 'lv-tag' }, t.tag),
          h('div', { class: 'lv-name' }, t.name),
          c.kind === 'new' || c.kind === 'up' || c.kind === 'break' ? dmgBadge(c.id) : null,
          c.kind !== 'bonus' && c.kind !== 'evolve' && c.kind !== 'weapon' ? scopeBadge(c.id) : c.kind === 'weapon' ? scopeBadgeOf(['weapon']) : null,
          h('div', { class: 'lv-desc' }, t.desc),
          syn ? syn.el : null,
        ),
      );
    });
    const banishBtn = button(`除外する（残り ${info.banishes}）`, 'levelup.banish', () => {
      banishMode = !banishMode;
      el.classList.toggle('banish', banishMode);
    }, 'btn ghost');
    banishBtn.disabled = info.banishes <= 0;
    const rerollBtn = button(`選び直す（残り ${info.rerolls}）`, 'levelup.reroll', () => done({ action: 'reroll' }), 'btn ghost');
    rerollBtn.disabled = info.rerolls <= 0;
    el.append(
      h('div', { class: 'lv-title' }, info.mode === 'item' ? `アイテムを選ぶ！  Lv ${info.level}` : `レベルアップ！  Lv ${info.level}`),
      // メニュー用のカーソルは、毎回この行の中央から始まる（下にボタンが無い場所）
      h('div', { class: 'lv-sub', 'data-cursor-home': '1' }, 'ひとつ選ぶ（1 / 2 / 3 キーでも選べる）。カードに乗せると、つながる持ちスキルが左で光る'),
      h('div', { class: 'lv-main' }, panel.el, cards),
      scopeLegend(),
      h('div', { class: 'lv-foot' }, rerollBtn, banishBtn, button('えらばない', 'levelup.skip', () => done({ action: 'skip' }), 'btn ghost'), button('📖 スキル図鑑（Tab）', 'levelup.book', openBook, 'btn ghost')),
      h('div', { class: 'lv-banish-note' }, '除外するスキルをクリック（この回はもう出なくなる）'),
    );
    const key = (e: KeyboardEvent) => {
      if (e.code === 'Tab') {
        e.preventDefault();
        openBook();
        return;
      }
      const m = /^(Digit|Numpad)([1-9])$/.exec(e.code);
      if (m) pick(Number(m[2]) - 1);
    };
    window.addEventListener('keydown', key);
  });
}

export function showChest(d: UiDeps, items: Choice[], coins: number): Promise<void> {
  return new Promise((resolve) => {
    const el = layer(d.root, 'overlay chest');
    const list = h('div', { class: 'chest-list' });
    items.forEach((c, i) => {
      const t = describeChoice(c);
      list.appendChild(h('div', { class: `chest-item ${t.cls}`, style: `animation-delay:${0.3 + i * 0.25}s` }, h('span', { class: 'chest-emoji' }, t.emoji), h('span', null, `${t.name}　${t.tag}`)));
    });
    list.appendChild(h('div', { class: 'chest-item', style: `animation-delay:${0.3 + items.length * 0.25}s` }, h('span', { class: 'chest-emoji' }, '🪙'), h('span', null, `コイン ${coins} 枚`)));
    const close = () => {
      window.removeEventListener('keydown', key);
      el.remove();
      resolve();
    };
    const key = (e: KeyboardEvent) => {
      if (e.code === 'Enter' || e.code === 'Space') close();
    };
    el.append(h('div', { class: 'chest-box' }, '🎁'), h('div', { class: 'lv-title', 'data-cursor-home': '1' }, 'ボスの落とし物！'), list, button('もらう', 'chest.ok', close, 'btn primary'));
    window.setTimeout(() => window.addEventListener('keydown', key), 600);
  });
}

// ====================================================================== 一時停止・設定
function settingsBody(d: UiDeps): HTMLElement {
  const st = d.save.settings;
  const row = (label: string, input: HTMLElement) => h('label', { class: 'set-row' }, h('span', null, label), input);
  const range = (key: 'sens' | 'volume' | 'bgm' | 'shake', min: number, max: number, step: number) =>
    h('input', {
      type: 'range', min: String(min), max: String(max), step: String(step), value: String(st[key]),
      oninput: (e: Event) => {
        st[key] = Number((e.target as HTMLInputElement).value);
        writeSave(d.save);
        d.onSettings();
      },
      onchange: () => log('ui.settings', { key, value: st[key] }),
    });
  const quality = h('select', {
    onchange: (e: Event) => {
      st.quality = (e.target as HTMLSelectElement).value as 'low' | 'mid' | 'high';
      writeSave(d.save);
      d.onSettings();
      log('ui.settings', { key: 'quality', value: st.quality });
    },
  }, h('option', { value: 'low' }, '軽い'), h('option', { value: 'mid' }, 'ふつう'), h('option', { value: 'high' }, 'きれい'));
  quality.value = st.quality;
  const invert = h('input', {
    type: 'checkbox', checked: st.invertY,
    onchange: (e: Event) => {
      st.invertY = (e.target as HTMLInputElement).checked;
      writeSave(d.save);
      log('ui.settings', { key: 'invertY', value: st.invertY });
    },
  });
  const rawMouse = h('input', {
    type: 'checkbox', checked: st.rawMouse,
    onchange: (e: Event) => {
      st.rawMouse = (e.target as HTMLInputElement).checked;
      writeSave(d.save);
      d.onSettings();
      log('ui.settings', { key: 'rawMouse', value: st.rawMouse });
    },
  });
  return h('div', { class: 'set-body' },
    row('マウス感度', range('sens', 0.3, 2.5, 0.05)),
    row('マウスの加速を使わない（視点が飛ぶときはオン）', rawMouse),
    row('効果音の音量', range('volume', 0, 1, 0.05)),
    row('BGM の音量', range('bgm', 0, 1, 0.05)),
    row('画面の揺れ', range('shake', 0, 1.5, 0.05)),
    row('上下の視点を反転', invert),
    row('画質', quality),
    h('div', { class: 'set-keys', html: '<b>W A S D</b> 移動　<b>マウス</b> 視点　<b>左クリック</b> 攻撃　<b>Shift / 右クリック</b> ダッシュ　<b>Space</b> ジャンプ　<b>Esc</b> 一時停止' }),
  );
}

export function showPause(d: UiDeps, owned: OwnedSkills, stats: [string, string][]): Promise<'resume' | 'quit'> {
  return new Promise((resolve) => {
    const el = layer(d.root, 'overlay pause');
    let closeBook: (() => void) | null = null;
    const done = (a: 'resume' | 'quit') => {
      window.removeEventListener('keydown', key);
      closeBook?.();
      el.remove();
      resolve(a);
    };
    const openBook = () => {
      if (closeBook) return;
      d.audio.ui('ok');
      closeBook = showSkillBook(d.root, owned, () => {
        closeBook = null;
      }, (k) => d.audio.ui(k));
    };
    const key = (e: KeyboardEvent) => {
      if (e.code === 'Escape') done('resume');
      else if (e.code === 'Tab') {
        e.preventDefault();
        openBook();
      }
    };
    el.append(
      h('div', { class: 'lv-title' }, 'ひとやすみ'),
      h('div', { class: 'pause-main' }, ownedPanel(owned).el, statsPanel(stats), settingsBody(d)),
      h('div', { class: 'lv-foot' }, button('つづける', 'pause.resume', () => done('resume'), 'btn primary'), button('📖 スキル図鑑（Tab）', 'pause.book', openBook, 'btn ghost'), button('あきらめて下校する', 'pause.quit', () => done('quit'), 'btn ghost')),
    );
    window.setTimeout(() => window.addEventListener('keydown', key), 200);
  });
}

export function showSettings(d: UiDeps, onBack: () => void): () => void {
  const el = layer(d.root, 'panel-screen');
  el.append(h('div', { class: 'panel-title' }, 'せってい'), settingsBody(d), h('div', { class: 'panel-foot' }, button('◀ もどる', 'settings.back', onBack, 'btn ghost')));
  return () => el.remove();
}

// ====================================================================== 購買部
export function showShop(d: UiDeps, onBack: () => void): () => void {
  const el = layer(d.root, 'panel-screen shop');
  const coins = h('div', { class: 'shop-coins' });
  const grid = h('div', { class: 'shop-grid' });
  const render = () => {
    coins.textContent = `🪙 ${d.save.coins}`;
    clear(grid);
    for (const it of SHOP) {
      const lv = d.save.shop[it.id];
      const maxed = lv >= it.max;
      const cost = it.cost(lv);
      const can = !maxed && d.save.coins >= cost;
      const card = h('div', { class: `shop-card${maxed ? ' maxed' : can ? '' : ' poor'}` },
        h('div', { class: 'weapon-emoji' }, it.emoji),
        h('div', { class: 'weapon-name' }, it.name),
        h('div', { class: 'weapon-desc' }, it.desc),
        h('div', { class: 'shop-lv' }, '●'.repeat(lv) + '○'.repeat(it.max - lv)),
        h('div', { class: 'shop-cost' }, maxed ? 'これ以上は買えない' : `🪙 ${cost}`),
      );
      card.addEventListener('click', () => {
        if (!can) {
          d.audio.ui('error');
          log('ui.shop.buy', { id: it.id }, { ok: false, coins: d.save.coins, cost, maxed });
          return;
        }
        d.save.coins -= cost;
        d.save.shop[it.id] = lv + 1;
        writeSave(d.save);
        d.audio.coin();
        log('ui.shop.buy', { id: it.id }, { ok: true, level: lv + 1, coins: d.save.coins });
        render();
      });
      grid.appendChild(card);
    }
  };
  render();
  el.append(h('div', { class: 'panel-title' }, '購買部'), h('div', { class: 'panel-sub' }, '集めたコインで、次の登校からずっと効く強化を買える。'), coins, grid, h('div', { class: 'panel-foot' }, button('◀ もどる', 'shop.back', onBack, 'btn ghost')));
  return () => el.remove();
}

// ====================================================================== 結果
export function showResult(d: UiDeps, r: ResultData, onRetry: () => void, onTitle: () => void): () => void {
  const endless = r.mode === 'endless';
  const full = r.clear && r.mode === 'story' && r.stagesCleared >= STORY_STAGES;
  const good = r.clear || (endless && r.endlessLv > 0);
  const el = layer(d.root, `overlay result ${good ? 'clear' : 'over'}`);
  const stat = (k: string, v: string) => h('div', { class: 'res-stat' }, h('span', null, k), h('b', null, v));
  const praise = full ? '学校は守られた。校舎は……まあ、うん。' : r.clear ? '今日はここまで。続きはまた明日。' : r.time < 60 ? 'まだ妄想が足りなかった。' : r.time < 240 ? 'ファントム・ソードは、まだ応えてくれる。' : '惜しい。あと少しで伝説になれた。';
  const title = endless ? `${fmtTime(r.time)} 耐えた！` : full ? '学 校 を 守 り き っ た ！' : r.clear ? `${r.stagesCleared} 面 ク リ ア ！` : 'ノリコは 力尽きた…';
  const sub = endless
    ? `${r.killedBy ? `「${r.killedBy}」にやられた。` : ''}${r.newBest ? '自己ベスト更新！' : `自己ベストは ${fmtTime(d.save.stats.endlessBest)}。`}`
    : r.clear ? praise : `${r.killedBy ? `「${r.killedBy}」にやられた。` : ''}${praise}`;
  el.append(
    h('div', { class: 'res-title' }, title),
    h('div', { class: `res-sub${endless && r.newBest ? ' best' : ''}` }, sub),
    h('div', { class: 'res-grid' },
      stat(endless ? '耐えた時間（合計）' : '生き残った時間（合計）', fmtTime(r.time)),
      endless ? stat('エンドレス', r.endlessLv > 0 ? `Lv ${r.endlessLv}` : 'ラスボスの前') : stat('たどり着いた面', `${r.stageNo} / ${STORY_STAGES} 面`),
      stat('回ったステージ', r.route.map((s) => s.emoji).join(' → ')),
      stat('レベル', String(r.level)),
      stat('倒した数', String(r.run.kills)),
      stat('巻き込みで倒した数', String(r.run.chainKills)),
      stat('最大の巻き込み', `×${r.run.bestCombo}`),
      stat('ボス', String(r.run.bossKills)),
      stat('打ち返した弾', String(r.run.parries)),
      stat('校舎の破壊率', `${r.destruction.toFixed(1)}%`),
      stat('難易度', `${r.difficulty.emoji} ${r.difficulty.name}`),
      stat('本日の校則', r.rule.name),
      stat('もらったコイン', `🪙 ${r.coinsEarned}`),
    ),
    h('div', { class: 'res-skills' }, ...r.skills.map((s) => h('span', { class: 'res-skill', title: s.name }, s.emoji, h('i', null, s.level)))),
    ...(r.newWeapons.length ? [h('div', { class: 'res-unlock' }, ...r.newWeapons.map((w) => h('div', null, `🔓 あたらしい武器: ${w.emoji} ${w.name}`)))] : []),
    h('div', { class: 'lv-foot' }, button('もう一度登校する', 'result.retry', onRetry, 'btn primary'), button('タイトルへ', 'result.title', onTitle, 'btn ghost')),
  );
  return () => el.remove();
}

// ====================================================================== 次の面を選ぶ（3 面通し）
/** k 面目（0 始まり）で初めて出てくる敵とボスの名前。 */
export function freshFoes(k: number): { foes: string[]; bosses: string[] } {
  const seen = new Set<string>();
  for (let i = 0; i < k; i++) {
    for (const w of TIERS[i].waves) for (const [id] of w.mix) seen.add(id);
    for (const b of TIERS[i].bosses) for (const id of b.ids) seen.add(id);
    seen.add(TIERS[i].final);
  }
  const t = TIERS[k];
  const foes = [...new Set(t.waves.flatMap((w) => w.mix.map(([id]) => id)))].filter((id) => !seen.has(id));
  const bosses = [...new Set([...t.bosses.flatMap((b) => b.ids), t.final])].filter((id) => !seen.has(id));
  return { foes: foes.map((id) => ENEMIES[id].name), bosses: bosses.map((id) => ENEMIES[id].name) };
}

export function showNextStage(d: UiDeps, info: { cleared: number; level: number; time: number; kills: number; choices: StageDef[] }, onPick: (s: StageDef) => void, onQuit: () => void): () => void {
  const el = layer(d.root, 'panel-screen stages next-stage');
  const next = info.cleared + 1;
  const tier = TIERS[next - 1];
  const fresh = freshFoes(next - 1);
  const grid = h('div', { class: 'stage-grid' });
  for (const s of info.choices) {
    const card = h('div', { class: `stage-card stage-${s.id}`, 'data-click': '1' },
      h('div', { class: 'stage-head' }, h('span', { class: 'stage-emoji' }, s.emoji), h('span', { class: 'stage-name' }, s.name)),
      h('div', { class: 'stage-desc' }, s.desc),
      h('ul', { class: 'stage-gimmicks' }, ...s.gimmicks.map((t) => h('li', null, t))),
    );
    card.addEventListener('click', () => {
      d.audio.ui('ok');
      log('ui.next.pick', { id: s.id, stageNo: next });
      onPick(s);
    });
    card.addEventListener('mouseenter', () => d.audio.ui('move'));
    grid.appendChild(card);
  }
  el.append(
    h('div', { class: 'panel-title', 'data-cursor-home': '1' }, `${info.cleared} 面クリア！`),
    h('div', { class: 'panel-sub' }, `Lv ${info.level}・${fmtTime(info.time)}・${info.kills} 体。育てたスキルとアイテムはそのまま、HP は全回復して ${next} 面へ。`),
    h('div', { class: 'next-warn' },
      h('div', { class: 'next-warn-head' }, `⚠️ ${next} 面は、敵の体力 ×${tier.hp}・攻撃 ×${tier.dmg}・ボスの体力 ×${tier.bossHp}`),
      ...(fresh.foes.length ? [h('div', null, `新しい敵: ${fresh.foes.join('、')}`)] : []),
      ...(fresh.bosses.length ? [h('div', null, `新しいボス: ${fresh.bosses.join('、')}`)] : []),
    ),
    h('div', { class: 'panel-sub' }, '次の現場を選ぶ'),
    grid,
    h('div', { class: 'panel-foot' }, button('ここで下校する（結果を見る）', 'next.quit', onQuit, 'btn ghost')),
  );
  return () => el.remove();
}
