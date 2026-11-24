/**
 * 調整用の数値とデータ定義。ゲームの手ざわりを変えたいときは、まずこのファイルの値を変える。
 * （開発サーバーで動かしている間は、保存すると実行中のゲームに反映される）
 */

// ------------------------------------------------------------------ 全体
export const TUNE = {
  gravity: -22,
  playerSpeed: 6.2,
  playerJump: 8.6,
  dashSpeedMul: 3.0,
  dashTime: 0.2,
  dashCooldown: 1.1,
  playerHp: 100,
  invincibleAfterHit: 0.55,
  /** 構え（入力の直後に待機ポーズから最初のキーへ移る時間） */
  windup: 0.055,
  /** フォロースルー（振り終わりの姿勢を保つ時間） */
  followThrough: 0.09,
  /** 振り終わってから待機ポーズへ戻る時間 */
  recover: 0.16,
  /** 同じ敵に連続で当たるまでの最短間隔（長いモーション用） */
  rehitInterval: 0.28,
  /** 当たり判定を見た目より広げる量(m) */
  hitPadding: 0.22,
  /** 突き方向の速さを、斬る方向の速さの何倍として数えるか */
  thrustWeight: 7.0,
  speedFactorMin: 0.35,
  speedFactorMax: 2.4,
  /** ヒットストップ: 基本秒数 + ダメージ比例。上限あり */
  hitStopBase: 0.022,
  hitStopPerDamage: 0.0011,
  hitStopMax: 0.11,
  /** 吹き飛ばしの強さ（武器の重さ × 先端の速さ × これ） */
  knockScale: 0.42,
  /** 吹き飛んだ敵が別の敵にぶつかったときのダメージ係数 */
  chainDamage: 1.25,
  chainMinSpeed: 4.5,
  /** 敵が壁にたたきつけられたときのダメージ係数 */
  slamDamage: 1.6,
  slamMinSpeed: 7,
  /** 小道具が敵にぶつかったときのダメージ係数（速さ × 重さの平方根 × これ） */
  propDamage: 0.55,
  propMinSpeed: 3.5,
  /** 敵の弾の速さ (m/s)。遅いほど避けやすい */
  enemyShotSpeed: 10.5,
  /** ボスのロケット弾の速さ (m/s) */
  bossShotSpeed: 9,
  /** 敵の弾の見た目の大きさ (m) */
  enemyShotSize: 0.58,
  /** 敵全体で、射撃と射撃のあいだに空ける最短の秒数。弾がまとまって飛んでこないようにする */
  enemyShotGap: 0.5,
  /** 画面に見えていない弾を、当たる何秒前から知らせるか */
  shotWarnTime: 0.8,
  /** 弾の通り道がプレイヤーからこの距離 (m) 以内なら「当たりそう」と見なす */
  shotWarnMiss: 1.5,
  xpMagnet: 2.6,
  cameraDist: 6.4,
  cameraHeight: 1.55,
  maxEnemies: 250,
  maxDebris: 260,
  maxGems: 500,
  runLength: 600,
};

// ------------------------------------------------------------------ 武器
export interface WeaponDef {
  id: string;
  name: string;
  emoji: string;
  desc: string;
  /** 基準の速さで当てたときのダメージ */
  damage: number;
  /** 重さ。吹き飛ばす力と、壁を壊す力に効く */
  mass: number;
  /** 長さ(m) */
  length: number;
  /** 当たり判定の半径(m) */
  radius: number;
  /** 腕を振る速さ（ラジアン/秒）。大きいほどモーションが早く終わる */
  swingSpeed: number;
  /** 振り終わってから次に振れるまでの秒数 */
  cooldown: number;
  /** ダメージが基準値になる先端の速さ(m/s) */
  refSpeed: number;
  model: string;
  unlock?: { stat: StatKey; gte: number; text: string };
}

export type StatKey = 'bestTime' | 'totalKills' | 'bossKills' | 'chainKills' | 'maxLevel' | 'maxDestruction' | 'clears' | 'runs' | 'hardClears' | 'storyClears' | 'endlessBest' | 'endlessLv';

export const WEAPONS: WeaponDef[] = [
  {
    id: 'stick', name: '木の棒「ファントム・ソード」', emoji: '🪵',
    desc: '帰り道で拾った運命の一振り。威力は低いが、軽くて次の一撃が早い。',
    damage: 10, mass: 1.0, length: 1.0, radius: 0.09, swingSpeed: 15, cooldown: 0.16, refSpeed: 20, model: 'w_stick',
  },
  {
    id: 'shinai', name: '剣道部の竹刀', emoji: '🎋',
    desc: '長くて素直。棒より少し重い。',
    damage: 14, mass: 1.4, length: 1.2, radius: 0.09, swingSpeed: 13.5, cooldown: 0.22, refSpeed: 21, model: 'w_shinai',
    unlock: { stat: 'totalKills', gte: 300, text: '累計 300 体を倒す' },
  },
  {
    id: 'mop', name: '掃除当番のモップ', emoji: '🧹',
    desc: '長い。先が太くて当てやすい。振りは遅め。',
    damage: 11, mass: 1.8, length: 1.55, radius: 0.16, swingSpeed: 11, cooldown: 0.28, refSpeed: 21, model: 'w_mop',
    unlock: { stat: 'bestTime', gte: 180, text: '3 分間生き残る' },
  },
  {
    id: 'bat', name: '野球部の金属バット', emoji: '⚾',
    desc: '重くて強い。よく飛ぶ。振り終わりの隙が大きい。',
    damage: 24, mass: 3.4, length: 0.92, radius: 0.11, swingSpeed: 10, cooldown: 0.4, refSpeed: 13, model: 'w_bat',
    unlock: { stat: 'bossKills', gte: 1, text: 'ボスを 1 体倒す' },
  },
  {
    id: 'harisen', name: '巨大ハリセン', emoji: '🪭',
    desc: 'ダメージはほぼ無い。そのかわり敵が信じられないほど飛ぶ。',
    damage: 4, mass: 11, length: 0.85, radius: 0.2, swingSpeed: 16, cooldown: 0.22, refSpeed: 19, model: 'w_harisen',
    unlock: { stat: 'chainKills', gte: 100, text: '巻き込みで累計 100 体を倒す' },
  },
  {
    id: 'ruler', name: '30cm 定規', emoji: '📏',
    desc: '短い。とにかく速い。',
    damage: 6, mass: 0.4, length: 0.5, radius: 0.08, swingSpeed: 26, cooldown: 0.05, refSpeed: 22, model: 'w_ruler',
    unlock: { stat: 'maxLevel', gte: 20, text: 'レベル 20 に到達する' },
  },
  {
    id: 'pipe', name: '工事現場の鉄パイプ', emoji: '🔩',
    desc: 'とても重い。壁も壊せる。振りは遅い。',
    damage: 36, mass: 6.0, length: 1.35, radius: 0.1, swingSpeed: 7.5, cooldown: 0.55, refSpeed: 13, model: 'w_pipe',
    unlock: { stat: 'maxDestruction', gte: 30, text: '校舎を 30% 壊す' },
  },
  {
    id: 'excalibur', name: '本物の伝説の剣', emoji: '🗡️',
    desc: '校庭に刺さっていた。なぜ。',
    damage: 42, mass: 3.2, length: 1.45, radius: 0.12, swingSpeed: 13, cooldown: 0.28, refSpeed: 23, model: 'w_excalibur',
    unlock: { stat: 'clears', gte: 1, text: '10 分間生き残る' },
  },
];

// ------------------------------------------------------------------ 敵
export type EnemyBehavior =
  | 'chase' | 'zigzag' | 'ranged' | 'charger' | 'bomber' | 'pounder' | 'tank' | 'heli' | 'chimera'
  // 2 面・3 面の敵（enemiesMore.ts）
  | 'roomba' | 'drone' | 'vending' | 'blink' | 'cheer'
  | 'vendking' | 'roombaq' | 'carrier' | 'tankbear' | 'ninjaboss' | 'cheerboss' | 'chimera3';

export type EnemyModel = 'pervert' | 'terrorist' | 'bear' | 'tank' | 'heli' | 'robovac' | 'vending' | 'drone';

/** 敵のモデルの読み込み名（usd/ は NVIDIA USDCraft-10K から変換した物体） */
export const ENEMY_MODEL_ASSET: Record<EnemyModel, string> = {
  pervert: 'e_pervert', terrorist: 'e_terrorist', bear: 'e_bear', tank: 'e_tank', heli: 'e_heli',
  robovac: 'usd/robovac', vending: 'usd/vending', drone: 'usd/drone',
};

export interface EnemyDef {
  id: string;
  name: string;
  model: EnemyModel;
  /** 上に乗せて描く別のモデル（合体ラスボス） */
  rider?: EnemyModel;
  /** 乗せるモデルの高さと大きさ（本体の大きさに対する割合。省くとクマの背中の位置） */
  riderY?: number;
  riderS?: number;
  /** 倒すと分かれて出てくる敵 */
  split?: string;
  /** 浮いて飛ぶ高さ（地面から。ドローン） */
  hover?: number;
  scale: number;
  tint: [number, number, number];
  hp: number;
  speed: number;
  damage: number;
  mass: number;
  /** 物理防御と魔法防御（100 でそれぞれのダメージが半分） */
  armor: number;
  mr: number;
  xp: number;
  coin: number;
  behavior: EnemyBehavior;
  boss?: boolean;
  /** 一言で言える特徴（図鑑・調整メモ用） */
  trait: string;
}

export const ENEMIES: Record<string, EnemyDef> = {
  pervert: { id: 'pervert', name: '変質者', model: 'pervert', scale: 1, tint: [1, 1, 1], hp: 14, speed: 3.3, damage: 5, mass: 55, armor: 10, mr: 10, xp: 1, coin: 0, behavior: 'zigzag', trait: 'ふらふら寄ってくる。弱い' },
  streaker: { id: 'streaker', name: '全力疾走の変質者', model: 'pervert', scale: 0.95, tint: [1.15, 0.75, 0.9], hp: 10, speed: 6.6, damage: 7, mass: 45, armor: 0, mr: 0, xp: 2, coin: 0, behavior: 'chase', trait: '速い。軽いのでよく飛ぶ' },
  terrorist: { id: 'terrorist', name: 'テロリスト', model: 'terrorist', scale: 1, tint: [1, 1, 1], hp: 22, speed: 2.6, damage: 8, mass: 75, armor: 40, mr: 10, xp: 2, coin: 0, behavior: 'ranged', trait: '離れて撃ってくる。弾は打ち返せる' },
  bomber: { id: 'bomber', name: '自爆テロリスト', model: 'terrorist', scale: 0.95, tint: [1.5, 0.45, 0.4], hp: 16, speed: 4.4, damage: 26, mass: 65, armor: 20, mr: 20, xp: 3, coin: 0, behavior: 'bomber', trait: '近づいて爆発する。群れへ打ち返すと得' },
  shield: { id: 'shield', name: '重装テロリスト', model: 'terrorist', scale: 1.2, tint: [0.5, 0.55, 0.7], hp: 70, speed: 2.1, damage: 12, mass: 190, armor: 120, mr: 25, xp: 5, coin: 1, behavior: 'chase', trait: '重くて硬い。なかなか飛ばない' },
  cub: { id: 'cub', name: '子グマ', model: 'bear', scale: 0.5, tint: [0.78, 0.58, 0.4], hp: 11, speed: 4.7, damage: 5, mass: 30, armor: 15, mr: 15, xp: 1, coin: 0, behavior: 'chase', trait: '小さい。群れで来る' },
  bear: { id: 'bear', name: 'クマ', model: 'bear', scale: 1, tint: [0.62, 0.42, 0.28], hp: 75, speed: 2.8, damage: 16, mass: 230, armor: 50, mr: 20, xp: 6, coin: 1, behavior: 'charger', trait: '突進する。重い' },
  polar: { id: 'polar', name: 'シロクマ', model: 'bear', scale: 1.3, tint: [1.15, 1.15, 1.2], hp: 170, speed: 2.6, damage: 22, mass: 380, armor: 70, mr: 60, xp: 12, coin: 2, behavior: 'charger', trait: 'さらに重い。壁を壊しながら来る' },
  boss_pervert: { id: 'boss_pervert', name: '変質者キング', model: 'pervert', scale: 2.3, tint: [1.2, 0.9, 1.3], hp: 620, speed: 4.2, damage: 18, mass: 520, armor: 30, mr: 70, xp: 60, coin: 25, behavior: 'zigzag', boss: true, trait: '大きいのに速い。手下を呼ぶ' },
  boss_bear: { id: 'boss_bear', name: 'ヒグマ番長', model: 'bear', scale: 2.7, tint: [0.42, 0.27, 0.2], hp: 1500, speed: 3.0, damage: 30, mass: 1500, armor: 90, mr: 30, xp: 120, coin: 40, behavior: 'charger', boss: true, trait: '突進で校舎を壊す' },
  boss_terror: { id: 'boss_terror', name: 'テロリスト隊長', model: 'terrorist', scale: 2.1, tint: [0.45, 0.45, 0.5], hp: 1200, speed: 2.4, damage: 22, mass: 700, armor: 90, mr: 40, xp: 120, coin: 40, behavior: 'ranged', boss: true, trait: 'ロケット弾を撃つ。3 発に 1 回は 3 方向。打ち返せる' },
  boss_nushi: { id: 'boss_nushi', name: '森のヌシ', model: 'bear', scale: 3.3, tint: [0.42, 0.5, 0.3], hp: 2000, speed: 2.6, damage: 26, mass: 2600, armor: 60, mr: 90, xp: 140, coin: 45, behavior: 'pounder', boss: true, trait: '跳び上がって着地し、地面を揺らす輪を広げる。輪はジャンプかダッシュでよける' },
  boss_tank: { id: 'boss_tank', name: 'テロリスト戦車', model: 'tank', scale: 1, tint: [1, 1, 1], hp: 1900, speed: 1.7, damage: 30, mass: 6000, armor: 220, mr: 20, xp: 160, coin: 50, behavior: 'tank', boss: true, trait: '赤い円に砲弾を落とす。建物も壊す。吹き飛ばない' },
  boss_heli: { id: 'boss_heli', name: '攻撃ヘリ', model: 'heli', scale: 1, tint: [1, 1, 1], hp: 1100, speed: 7, damage: 22, mass: 1500, armor: 60, mr: 60, xp: 160, coin: 50, behavior: 'heli', boss: true, trait: '空から爆弾を落とす。手下を降ろすときだけ低く飛ぶので、そこを殴る' },
  boss_chimera: { id: 'boss_chimera', name: '合体怪人ヘンタイクマテロ', model: 'bear', rider: 'pervert', scale: 3.0, tint: [0.75, 0.45, 0.85], hp: 2600, speed: 3.2, damage: 32, mass: 4000, armor: 110, mr: 110, xp: 400, coin: 120, behavior: 'chimera', boss: true, trait: '三巨頭が倒れると現れるラスボス。突進・ロケット・地響き・手下を順に使う' },
  // ---- 2 面から出る敵
  robovac: { id: 'robovac', name: '暴走ルンバ', model: 'robovac', scale: 2.6, tint: [1, 1, 1], hp: 18, speed: 5.4, damage: 7, mass: 40, armor: 30, mr: 10, xp: 2, coin: 0, behavior: 'roomba', trait: '一直線に走ってくる。曲がるのが下手' },
  splitter: { id: 'splitter', name: '増える変質者', model: 'pervert', scale: 1.1, tint: [0.8, 1.3, 0.75], hp: 30, speed: 3.4, damage: 7, mass: 60, armor: 15, mr: 15, xp: 3, coin: 0, behavior: 'zigzag', split: 'mini_pervert', trait: '倒すと 2 人に分かれる' },
  mini_pervert: { id: 'mini_pervert', name: 'ちび変質者', model: 'pervert', scale: 0.62, tint: [0.8, 1.3, 0.75], hp: 8, speed: 5.6, damage: 4, mass: 25, armor: 0, mr: 0, xp: 1, coin: 0, behavior: 'chase', trait: '増える変質者が分かれたもの。小さくて速い' },
  drone_e: { id: 'drone_e', name: '偵察ドローン', model: 'drone', scale: 4.2, tint: [1, 1, 1], hp: 16, speed: 5.6, damage: 8, mass: 25, armor: 10, mr: 30, xp: 2, coin: 0, behavior: 'drone', hover: 1.7, trait: '浮いて回りこみ、急降下してくる。叩き落とせる' },
  vending_e: { id: 'vending_e', name: '暴走自販機', model: 'vending', scale: 1.05, tint: [1.4, 0.55, 0.5], hp: 160, speed: 1.8, damage: 14, mass: 420, armor: 110, mr: 40, xp: 9, coin: 2, behavior: 'vending', trait: '缶を 3 方向へ撃つ。とても重くて硬い' },
  // ---- 3 面から出る敵
  ninja: { id: 'ninja', name: '忍者テロリスト', model: 'terrorist', scale: 1, tint: [0.3, 0.3, 0.38], hp: 40, speed: 4.2, damage: 13, mass: 65, armor: 30, mr: 60, xp: 4, coin: 0, behavior: 'blink', trait: '煙とともに、ノリコのすぐ横へ回りこむ' },
  cheer: { id: 'cheer', name: '応援団員', model: 'pervert', scale: 1.15, tint: [1.55, 0.5, 0.5], hp: 55, speed: 2.8, damage: 6, mass: 70, armor: 20, mr: 50, xp: 6, coin: 1, behavior: 'cheer', trait: 'まわりの敵の体力を回復して、速くする。先に倒したい' },
  // ---- 2 面・3 面のボス
  boss_vending: { id: 'boss_vending', name: '自販機の王様', model: 'vending', scale: 2.6, tint: [1.5, 1.15, 0.35], hp: 1700, speed: 1.6, damage: 24, mass: 5000, armor: 160, mr: 60, xp: 130, coin: 45, behavior: 'vendking', boss: true, trait: '缶を扇状にばらまき、空から缶の雨を降らせる。ルンバを呼ぶ' },
  boss_robovac: { id: 'boss_robovac', name: 'ルンバの女王', model: 'robovac', scale: 7.5, tint: [1.25, 1.1, 0.75], hp: 1500, speed: 2.5, damage: 26, mass: 3000, armor: 80, mr: 80, xp: 130, coin: 45, behavior: 'roombaq', boss: true, trait: '赤い線の上を一直線に突っ込む。手下のルンバを放つ' },
  boss_carrier: { id: 'boss_carrier', name: 'ドローン母艦', model: 'drone', scale: 11, tint: [0.75, 0.8, 0.95], hp: 1300, speed: 6, damage: 22, mass: 1500, armor: 60, mr: 60, xp: 160, coin: 50, behavior: 'carrier', boss: true, trait: '空から爆弾を落とし、偵察ドローンを放つ。降りてきたときに殴る' },
  boss_tankbear: { id: 'boss_tankbear', name: 'ヒグマ戦車', model: 'tank', rider: 'bear', riderY: 1.9, riderS: 1.05, scale: 1.15, tint: [0.95, 0.82, 0.6], hp: 3200, speed: 1.9, damage: 34, mass: 8000, armor: 200, mr: 80, xp: 450, coin: 140, behavior: 'tankbear', boss: true, trait: '2 面のラスボス。砲撃・突進・地響き・手下を順に使う。吹き飛ばない' },
  boss_ninja: { id: 'boss_ninja', name: '忍者頭領', model: 'terrorist', scale: 2.3, tint: [0.25, 0.22, 0.32], hp: 1800, speed: 3.6, damage: 26, mass: 900, armor: 70, mr: 120, xp: 160, coin: 50, behavior: 'ninjaboss', boss: true, trait: '消えては現れ、手裏剣を 5 方向へ投げる。分身（忍者）を呼ぶ' },
  boss_cheer: { id: 'boss_cheer', name: '応援団総長', model: 'pervert', scale: 2.6, tint: [1.5, 0.42, 0.42], hp: 2200, speed: 2.4, damage: 26, mass: 2000, armor: 90, mr: 90, xp: 160, coin: 50, behavior: 'cheerboss', boss: true, trait: '大声で手下を回復・強化する。跳び上がって地面を揺らす' },
  boss_chimera3: { id: 'boss_chimera3', name: '真・合体怪人ヘンタイクマテロ', model: 'bear', rider: 'terrorist', scale: 3.5, tint: [0.55, 0.3, 0.62], hp: 4200, speed: 3.4, damage: 38, mass: 6000, armor: 140, mr: 140, xp: 600, coin: 200, behavior: 'chimera3', boss: true, trait: '3 面のラスボス。突進・ロケット・地響き・瞬間移動・ドローンを順に使う' },
};

/** 強い個体（エリート）。2 分半から、ふつうの敵の代わりに少しずつ混ざる。 */
export type EliteKind = 'tough' | 'swift' | 'bomb';

export const ELITES: Record<EliteKind, { name: string; hp: number; dmg: number; speed: number; scale: number; mass: number; armor: number; mr: number; tint: [number, number, number] }> = {
  tough: { name: '頑丈な', hp: 4, dmg: 1.4, speed: 0.9, scale: 1.25, mass: 2.5, armor: 60, mr: 30, tint: [1.7, 1.35, 0.45] },
  swift: { name: '俊足の', hp: 2.2, dmg: 1.2, speed: 1.6, scale: 1.05, mass: 1, armor: 0, mr: 0, tint: [0.5, 1.4, 1.7] },
  bomb: { name: '爆弾持ちの', hp: 2.5, dmg: 1.3, speed: 1.1, scale: 1.12, mass: 1.2, armor: 10, mr: 40, tint: [1.8, 0.6, 0.3] },
};

/** 三巨頭が倒れたあとに現れるラスボス。倒すとクリア。 */
export const FINAL_BOSS = 'boss_chimera';

export interface WaveDef {
  /** 開始時刻（秒） */
  from: number;
  /** 1 回の出現までの間隔（秒） */
  interval: number;
  /** 1 回に出る数 */
  batch: [number, number];
  /** 同時に出ていられる上限 */
  cap: number;
  /** 敵の種類と重み */
  mix: [string, number][];
}

export const WAVES: WaveDef[] = [
  { from: 0, interval: 1.0, batch: [1, 2], cap: 26, mix: [['pervert', 1]] },
  { from: 30, interval: 0.9, batch: [2, 3], cap: 42, mix: [['pervert', 3], ['terrorist', 1]] },
  { from: 75, interval: 0.8, batch: [2, 4], cap: 62, mix: [['pervert', 3], ['terrorist', 2], ['cub', 3]] },
  { from: 130, interval: 0.7, batch: [3, 5], cap: 84, mix: [['pervert', 2], ['terrorist', 2], ['cub', 3], ['streaker', 1]] },
  { from: 195, interval: 0.62, batch: [3, 5], cap: 105, mix: [['pervert', 2], ['terrorist', 2], ['bear', 1], ['streaker', 2], ['cub', 2]] },
  { from: 270, interval: 0.56, batch: [3, 6], cap: 128, mix: [['terrorist', 2], ['bear', 1.5], ['streaker', 2], ['bomber', 1.5], ['cub', 2]] },
  { from: 375, interval: 0.5, batch: [4, 7], cap: 155, mix: [['terrorist', 2], ['bear', 2], ['bomber', 2], ['shield', 1.2], ['streaker', 2], ['polar', 0.5]] },
  { from: 450, interval: 0.45, batch: [4, 7], cap: 180, mix: [['bear', 2], ['bomber', 2], ['shield', 2], ['streaker', 3], ['polar', 1], ['cub', 3], ['terrorist', 1.5]] },
  { from: 555, interval: 0.38, batch: [5, 8], cap: 215, mix: [['bear', 2], ['bomber', 3], ['shield', 2], ['streaker', 3], ['polar', 1.5], ['terrorist', 2.5]] },
  { from: 640, interval: 0.32, batch: [6, 9], cap: 240, mix: [['bear', 2], ['bomber', 3], ['shield', 3], ['streaker', 3], ['polar', 2], ['terrorist', 3]] },
];

export interface BossEvent {
  at: number;
  ids: string[];
  text: string;
}

export const BOSSES: BossEvent[] = [
  { at: 150, ids: ['boss_pervert'], text: '変質者キングが現れた！' },
  { at: 270, ids: ['boss_nushi'], text: '森のヌシが現れた！ 地面の揺れはジャンプでよけろ！' },
  { at: 360, ids: ['boss_bear'], text: 'ヒグマ番長が現れた！' },
  { at: 450, ids: ['boss_tank'], text: 'テロリスト戦車が来た！ 赤い円から離れろ！' },
  { at: 540, ids: ['boss_terror', 'boss_heli'], text: 'テロリスト隊長と攻撃ヘリが現れた！' },
  { at: 600, ids: ['boss_pervert', 'boss_bear', 'boss_terror'], text: '三巨頭、そろい踏み！' },
];

/** 2 面の敵の出方。最初から 1 面の中盤くらいの数が出る（育ったノリコで始まるため） */
export const WAVES2: WaveDef[] = [
  { from: 0, interval: 0.8, batch: [2, 4], cap: 60, mix: [['pervert', 2], ['robovac', 2], ['splitter', 1.5], ['terrorist', 1.5]] },
  { from: 45, interval: 0.72, batch: [3, 5], cap: 85, mix: [['robovac', 2], ['splitter', 2], ['terrorist', 2], ['drone_e', 1.5], ['cub', 2]] },
  { from: 120, interval: 0.64, batch: [3, 6], cap: 110, mix: [['robovac', 2], ['splitter', 2], ['drone_e', 2], ['bear', 1], ['bomber', 1.5], ['vending_e', 0.6]] },
  { from: 210, interval: 0.56, batch: [4, 6], cap: 135, mix: [['robovac', 2], ['splitter', 2], ['drone_e', 2], ['vending_e', 1], ['shield', 1], ['streaker', 2]] },
  { from: 320, interval: 0.5, batch: [4, 7], cap: 165, mix: [['robovac', 2.5], ['drone_e', 2.5], ['vending_e', 1.2], ['bomber', 2], ['polar', 0.8], ['splitter', 2]] },
  { from: 450, interval: 0.43, batch: [5, 8], cap: 195, mix: [['robovac', 3], ['drone_e', 3], ['vending_e', 1.5], ['bear', 2], ['shield', 2], ['splitter', 2.5], ['terrorist', 2]] },
  { from: 560, interval: 0.37, batch: [5, 9], cap: 225, mix: [['robovac', 3], ['drone_e', 3], ['vending_e', 2], ['bear', 2], ['shield', 2], ['splitter', 3], ['polar', 1.5], ['bomber', 2]] },
];

export const BOSSES2: BossEvent[] = [
  { at: 150, ids: ['boss_vending'], text: '自販機の王様が現れた！ 缶の雨に気をつけろ！' },
  { at: 270, ids: ['boss_robovac'], text: 'ルンバの女王が現れた！ 赤い線の上から離れろ！' },
  { at: 360, ids: ['boss_nushi'], text: '森のヌシが戻ってきた！ 前より手ごわいぞ！' },
  { at: 450, ids: ['boss_carrier'], text: 'ドローン母艦が来た！ 降りてきたら殴れ！' },
  { at: 540, ids: ['boss_vending', 'boss_tank'], text: '自販機の王様とテロリスト戦車が現れた！' },
  { at: 600, ids: ['boss_robovac', 'boss_carrier', 'boss_bear'], text: '新・三巨頭、そろい踏み！' },
];

/** 3 面の敵の出方 */
export const WAVES3: WaveDef[] = [
  { from: 0, interval: 0.75, batch: [3, 5], cap: 80, mix: [['ninja', 1.5], ['robovac', 2], ['splitter', 2], ['drone_e', 1.5], ['streaker', 2]] },
  { from: 45, interval: 0.68, batch: [3, 6], cap: 105, mix: [['ninja', 2], ['robovac', 2], ['splitter', 2], ['drone_e', 2], ['cheer', 0.6], ['terrorist', 1.5]] },
  { from: 120, interval: 0.6, batch: [4, 6], cap: 130, mix: [['ninja', 2], ['cheer', 0.8], ['vending_e', 1], ['drone_e', 2], ['bear', 1.5], ['bomber', 1.5]] },
  { from: 210, interval: 0.53, batch: [4, 7], cap: 155, mix: [['ninja', 2.5], ['cheer', 1], ['vending_e', 1.2], ['drone_e', 2.5], ['splitter', 2], ['shield', 1.5]] },
  { from: 320, interval: 0.46, batch: [5, 8], cap: 185, mix: [['ninja', 3], ['cheer', 1.2], ['vending_e', 1.5], ['drone_e', 3], ['polar', 1], ['robovac', 2.5], ['bomber', 2]] },
  { from: 450, interval: 0.4, batch: [5, 9], cap: 210, mix: [['ninja', 3], ['cheer', 1.4], ['vending_e', 2], ['drone_e', 3], ['polar', 1.5], ['robovac', 3], ['splitter', 2.5]] },
  { from: 560, interval: 0.34, batch: [6, 9], cap: 240, mix: [['ninja', 3.5], ['cheer', 1.5], ['vending_e', 2], ['drone_e', 3.5], ['polar', 2], ['robovac', 3], ['bear', 2], ['bomber', 2.5]] },
];

export const BOSSES3: BossEvent[] = [
  { at: 150, ids: ['boss_ninja'], text: '忍者頭領が現れた！ 背後に気をつけろ！' },
  { at: 270, ids: ['boss_cheer'], text: '応援団総長が現れた！ 手下が元気になる前に倒せ！' },
  { at: 360, ids: ['boss_vending', 'boss_robovac'], text: '自販機の王様とルンバの女王が現れた！' },
  { at: 450, ids: ['boss_carrier', 'boss_tank'], text: 'ドローン母艦とテロリスト戦車が来た！' },
  { at: 540, ids: ['boss_ninja', 'boss_cheer'], text: '忍者頭領と応援団総長が手を組んだ！' },
  { at: 600, ids: ['boss_heli', 'boss_ninja', 'boss_bear'], text: '最後の三巨頭、そろい踏み！' },
];

/** エンドレスの、ラスボスのあとに出る敵（全種類が混ざる） */
export const ENDLESS_MIX: [string, number][] = [
  ['ninja', 3], ['cheer', 1.2], ['vending_e', 2], ['drone_e', 3], ['polar', 2], ['robovac', 3], ['bear', 2], ['bomber', 2.5], ['splitter', 2.5], ['shield', 2], ['terrorist', 2], ['streaker', 2],
];

// ------------------------------------------------------------------ 遊び方（通し・エンドレス）と、面ごとの強さ
export type GameMode = 'story' | 'endless';

export const MODES: { id: GameMode; name: string; emoji: string; desc: string }[] = [
  { id: 'story', name: '3 面通し', emoji: '🎒', desc: '育てたまま 3 つの現場を回る。面が進むと、新しい敵と新しいボスが出る。' },
  { id: 'endless', name: 'エンドレス', emoji: '♾️', desc: 'ラスボスを倒しても終わらない。強くなったラスボスが次々に来る。どこまで耐えられるか。' },
];

/** 通しで回る面の数 */
export const STORY_STAGES = 3;

export interface TierDef {
  /** 面の番号（1〜3） */
  no: number;
  /** 敵の体力・攻撃力・出る数・ボスの体力の倍率（面の中の時間による伸びに掛ける） */
  hp: number;
  dmg: number;
  spawn: number;
  bossHp: number;
  /** エリートが出る確率に足す分 */
  elite: number;
  waves: WaveDef[];
  bosses: BossEvent[];
  final: string;
  finalText: string;
}

export const TIERS: TierDef[] = [
  { no: 1, hp: 1, dmg: 1, spawn: 1, bossHp: 1, elite: 0, waves: WAVES, bosses: BOSSES, final: FINAL_BOSS, finalText: '三巨頭が合体した！ ラスボス出現！' },
  { no: 2, hp: 2.4, dmg: 1.4, spawn: 1.12, bossHp: 2.0, elite: 0.06, waves: WAVES2, bosses: BOSSES2, final: 'boss_tankbear', finalText: '新・三巨頭が合体した！ ヒグマ戦車、出撃！' },
  { no: 3, hp: 4.5, dmg: 1.85, spawn: 1.25, bossHp: 3.4, elite: 0.12, waves: WAVES3, bosses: BOSSES3, final: 'boss_chimera3', finalText: '最後の合体！ 真・合体怪人、降臨！' },
];

/** エンドレスで、強くなって出てくるラスボスの順番 */
export const ENDLESS_FINALS = ['boss_chimera', 'boss_tankbear', 'boss_chimera3'];

/**
 * 時間による敵の体力の倍率。前半はゆるやかで、後半ほど大きく伸びる
 * （育ったノリコでも、終盤の敵が一撃では倒れないようにする）。
 */
export function enemyHpScale(time: number): number {
  return 1 + (time / 60) * 0.16 + Math.pow(time / 600, 2) * 2.6;
}

/** 時間による敵の攻撃力の倍率（体当たり・弾・自爆）。10 分で約 1.9 倍。 */
export function enemyDmgScale(time: number): number {
  return 1 + (time / 600) * 0.9;
}

/** 強い個体（エリート）が出る確率。2 分半から出始め、時間とともに増える。mul は難易度の倍率。 */
export function eliteChance(time: number, mul: number): number {
  if (time < 150) return 0;
  return Math.min(0.35, ((time - 150) / 450) * 0.1 * mul);
}

/** レベル n から n+1 に上がるのに必要な経験値。序盤は早く上がるようにしてある。 */
export function xpForLevel(level: number): number {
  return Math.floor(4 + level * 3.2 + Math.pow(level, 1.55) * 0.9);
}

// ------------------------------------------------------------------ スキル
export type Rarity = 'common' | 'rare' | 'epic';

/**
 * スキルの性質。強化（パッシブ）のうち、どれがこのスキルに効くかを決める（STAT_LINKS を参照）。
 * amount: 数が増える（コピー機） / area: 範囲が広がる（妄想力） / knock: 吹き飛ばす（厚底ローファー）
 * swing: 武器を振ると発動する（早弁・厨二病） / launch: 敵を空へ打ち上げる（重力の腕章）
 */
export type SkillTag = 'amount' | 'area' | 'knock' | 'swing' | 'launch';

/**
 * ダメージの種類。phys: 物理（物理防御で減る・AD で伸びる） / magic: 魔法（魔法防御で減る・AP で伸びる）
 * true: トゥルー（防御で減らない） / impact: 衝撃（ふっ飛んだ敵や物がぶつかった。物理防御が半分だけ効く）
 */
export type DmgKind = 'phys' | 'magic' | 'true' | 'impact';

export const DMG_KINDS: Record<DmgKind, { name: string; icon: string; color: string; desc: string }> = {
  phys: { name: '物理', icon: '⚔️', color: '#ffb04a', desc: '物理防御で減る。AD（物理攻撃力）で伸びる。AD は「棒の威力 + 強化とアイテムの AD」。' },
  magic: { name: '魔法', icon: '🔮', color: '#c39bff', desc: '魔法防御で減る。AP（魔法攻撃力）で伸びる。' },
  true: { name: 'トゥルー', icon: '💠', color: '#ffffff', desc: '防御で減らない。硬い敵に強い。' },
  impact: { name: '衝撃', icon: '💥', color: '#ffe14d', desc: 'ふっ飛んだ敵や物がぶつかったときのダメージ。ぶつかる速さと重さで決まる。物理防御が半分だけ効く。' },
};

/** スキルのダメージ。ad/ap は反映率（AD・AP が 1 上がるごとに威力が何 % 上がるか）。dot は与える継続ダメージ */
export interface SkillDmg {
  kind: DmgKind;
  ad?: number;
  ap?: number;
  dot?: 'burn' | 'poison' | 'bleed';
  /** 限界突破による威力の倍率（スキルごとに付ける） */
  mul?: number;
}

/**
 * 効果が効く範囲（アイテムと強化のカードに印を出す）。説明文でも同じ言葉を【】で囲んで使う。
 * - weapon: 【棒の攻撃】ノリコが棒を振って敵に当てた攻撃（通常攻撃）
 * - skill: 【スキルの攻撃】攻撃スキルが出す攻撃（弾・爆発・設置物など）
 * - all: 【すべての攻撃】棒・スキル・巻き込み・物・爆発・燃焼など、敵に与えるダメージ全部
 */
export type Scope = 'weapon' | 'skill' | 'all' | 'impact' | 'dot' | 'guard' | 'heal' | 'move' | 'grow';

export const SCOPE_INFO: Record<Scope, { icon: string; name: string; desc: string }> = {
  weapon: { icon: '🗡️', name: '棒の攻撃', desc: 'ノリコが棒を振って敵に当てた攻撃（通常攻撃）だけに効く' },
  skill: { icon: '✨', name: 'スキルの攻撃', desc: '攻撃スキルが出す攻撃（弾・爆発・設置物など）だけに効く' },
  all: { icon: '💥', name: 'すべての攻撃', desc: '棒・スキル・巻き込み・物・爆発など、敵に当たったダメージ全部に効く（燃焼・毒・出血の毎秒のダメージは除く）' },
  impact: { icon: '🧱', name: '衝撃', desc: '吹き飛んだ敵や物がぶつかったとき（巻き込み・たたきつけ・落下）に効く' },
  dot: { icon: '🩸', name: '継続ダメージ', desc: '燃焼・毒・出血に効く' },
  guard: { icon: '🛡️', name: '守り', desc: '受けるダメージを減らす・防ぐ・返す' },
  heal: { icon: '💚', name: '回復', desc: 'HP を回復する' },
  move: { icon: '👟', name: '移動', desc: '移動・ダッシュ・ジャンプに効く' },
  grow: { icon: '📈', name: '成長', desc: '経験値・コイン・運・選択肢に効く' },
};

export interface SkillDef {
  id: string;
  name: string;
  emoji: string;
  kind: 'active' | 'passive';
  rarity: Rarity;
  max: number;
  /** 取得時の説明 */
  desc: string;
  /** レベルが上がるごとの説明 */
  up: string;
  evo?: { with: string; name: string; emoji: string; desc: string };
  tags?: SkillTag[];
  dmg?: SkillDmg;
  /** 強化: 効く範囲（カードに印を出す） */
  scope?: Scope[];
}

export const SKILLS: SkillDef[] = [
  // ---- 攻撃スキル
  { id: 'chalk', name: 'チョーク投げ', emoji: '🖍️', kind: 'active', rarity: 'common', max: 5, tags: ['amount'], desc: '近くの敵へチョークを投げる。', up: '本数・威力・貫通が増える', evo: { with: 'shuuchuu', name: 'チョーク・ガトリング', emoji: '🖍️', desc: '先生の怒りが乗り移る。止まらない連射。' } },
  { id: 'eraser', name: '跳ねる消しゴム', emoji: '🧽', kind: 'active', rarity: 'common', max: 5, tags: ['amount'], desc: '敵から敵へ跳ね返る消しゴムを投げる。', up: '跳ねる回数と威力が増える', evo: { with: 'copy', name: '無限消しゴム', emoji: '🧽', desc: '3 個が 20 回跳ね回る。' } },
  { id: 'uwabaki', name: '上履きブーメラン', emoji: '👟', kind: 'active', rarity: 'common', max: 5, tags: ['amount'], desc: '上履きが飛んで戻ってくる。通り道の敵をすべて叩く。', up: '数・大きさ・威力が増える', evo: { with: 'dash', name: '上履きストーム', emoji: '👟', desc: '8 方向へ同時に飛ぶ。' } },
  { id: 'pencil', name: 'ロケットえんぴつ', emoji: '✏️', kind: 'active', rarity: 'common', max: 5, tags: ['amount'], desc: '向いている方向へ、貫通するえんぴつを撃つ。', up: '本数と威力が増える', evo: { with: 'hayaben', name: 'えんぴつ流星群', emoji: '🌠', desc: '空から降りそそぐ。' } },
  { id: 'fire', name: '妄想ファイア', emoji: '🔥', kind: 'active', rarity: 'common', max: 5, tags: ['amount', 'area'], desc: '「ファイア！」と叫ぶと本当に出る。着弾して爆発する。', up: '爆発の範囲と威力が増える', evo: { with: 'mousou', name: '妄想メテオ', emoji: '☄️', desc: '隕石が降る。校舎ごと吹き飛ぶ。' } },
  { id: 'thunder', name: '妄想サンダー', emoji: '⚡', kind: 'active', rarity: 'common', max: 5, tags: ['amount'], desc: '敵に雷が落ち、近くの敵へ伝わる。ぬれた敵にはよく伝わる。', up: '落ちる数と伝わる数が増える', evo: { with: 'kiai', name: '神鳴り', emoji: '🌩️', desc: '雷が降りやまない。' } },
  { id: 'blizzard', name: '妄想ブリザド', emoji: '❄️', kind: 'active', rarity: 'rare', max: 5, tags: ['area'], desc: 'まわりの敵を凍らせる。凍った敵はよく滑り、よく砕ける。', up: '範囲と凍る時間が増える', evo: { with: 'hoken', name: '絶対零度', emoji: '🧊', desc: '弱った敵は凍った瞬間に砕け散る。' } },
  { id: 'gravity', name: '妄想グラビデ', emoji: '🌀', kind: 'active', rarity: 'rare', max: 5, tags: ['area'], desc: '敵と物を吸い寄せる渦を作る。最後に弾ける。', up: '範囲と吸う力が増える', evo: { with: 'jishaku', name: 'ブラックホール', emoji: '🕳️', desc: '校舎のがれきまで吸い込む。' } },
  { id: 'desk', name: '机バリア', emoji: '🪑', kind: 'active', rarity: 'common', max: 5, tags: ['area', 'knock'], desc: '机がノリコのまわりを回り、敵を弾き飛ばす。', up: '机の数と威力が増える', evo: { with: 'atsuzoko', name: '机トルネード', emoji: '🌪️', desc: '6 台が高速で回る。触れた敵は空へ。' } },
  { id: 'compass', name: 'コンパスカッター', emoji: '📐', kind: 'active', rarity: 'common', max: 5, tags: ['amount', 'area'], desc: '小さな刃が足元を回り続ける。', up: '刃の数と回る速さが増える', evo: { with: 'hayaben', name: '分度器ソーサー', emoji: '🥏', desc: '大きな円盤が広い範囲を刈る。' } },
  { id: 'milk', name: '牛乳瓶グレネード', emoji: '🥛', kind: 'active', rarity: 'common', max: 5, tags: ['amount', 'area'], desc: '敵の群れへ牛乳瓶を投げる。爆発して、床が滑るようになる。上を通った敵はぬれる。', up: '個数・範囲・威力が増える', evo: { with: 'kyushoku', name: '給食カレー爆撃', emoji: '🍛', desc: '熱々のカレーが 5 発降る。跡地は燃える。' } },
  { id: 'randoseru', name: 'ランドセルミサイル', emoji: '🎒', kind: 'active', rarity: 'rare', max: 5, tags: ['amount', 'area'], desc: '敵を追いかけるミサイルを撃つ。', up: '発射数と威力が増える', evo: { with: 'naishin', name: '修学旅行ミサイル群', emoji: '🚀', desc: '一度に 8 発。' } },
  { id: 'statue', name: '金次郎メテオ', emoji: '🗿', kind: 'active', rarity: 'rare', max: 5, tags: ['area'], desc: '二宮金次郎像が空から落ちてくる。落ちた像は棒で叩いて飛ばせる。', up: '落ちる数と衝撃が増える', evo: { with: 'kintore', name: '校長先生降臨', emoji: '👴', desc: '巨大な校長像。落ちた場所には何も残らない。' } },
  { id: 'ball', name: 'ドッジボール乱舞', emoji: '🏐', kind: 'active', rarity: 'common', max: 5, tags: ['amount'], desc: 'よく弾むボールを撃ち出す。跳ね返りながら敵に当たり続ける。', up: 'ボールの数と速さが増える', evo: { with: 'un', name: 'スーパーボール地獄', emoji: '🔴', desc: '20 個のスーパーボールが止まらない。' } },
  { id: 'wave', name: 'ノリコ波', emoji: '🌊', kind: 'active', rarity: 'rare', max: 5, tags: ['area'], desc: '両手から波動を出す（出ると信じている）。前方の敵を押し流す。', up: '太さ・長さ・威力が増える', evo: { with: 'taisougi', name: '極太ノリコ砲', emoji: '💫', desc: '壁ごと貫く。' } },
  { id: 'tornado', name: 'つむじ風', emoji: '🌪️', kind: 'active', rarity: 'rare', max: 5, tags: ['area', 'knock'], desc: '竜巻が敵と物を巻き上げて、どこかへ放り投げる。', up: '大きさと持続時間が増える', evo: { with: 'chuuni', name: '大竜巻', emoji: '🌀', desc: '校舎の壁まで引きはがす。' } },
  { id: 'stomp', name: '地団駄', emoji: '🦶', kind: 'active', rarity: 'common', max: 5, tags: ['area', 'knock'], desc: '地面を踏み鳴らし、まわりの敵を打ち上げる。', up: '範囲と打ち上げる高さが増える', evo: { with: 'konjou', name: '震度7', emoji: '🫨', desc: '校庭全体が揺れる。建物も崩れる。' } },
  { id: 'clone', name: '妄想分身', emoji: '👥', kind: 'active', rarity: 'rare', max: 5, tags: ['swing'], desc: '分身が現れ、あなたが決めたモーションで一緒に攻撃する。', up: '分身の数と威力が増える', evo: { with: 'mousou', name: '影分身の術', emoji: '🥷', desc: '6 体の分身がまわりを囲む。' } },
  { id: 'slashwave', name: '斬撃波', emoji: '🌙', kind: 'active', rarity: 'common', max: 5, tags: ['swing'], desc: '棒を振り終わると、斬撃が前へ飛ぶ（【スキルの攻撃】）。威力は棒の威力で決まる。', up: '大きさ・貫通・威力が増える', evo: { with: 'chuuni', name: '次元斬', emoji: '🌌', desc: '壁もまとめて斬る、巨大な斬撃。' } },
  { id: 'boomsword', name: '爆裂剣', emoji: '💥', kind: 'active', rarity: 'rare', max: 5, tags: ['swing', 'area'], desc: '攻撃が当たると、ときどき爆発する。', up: '爆発する確率と範囲が増える', evo: { with: 'kiai', name: '連鎖爆裂', emoji: '🎆', desc: '必ず爆発する。爆発で倒すとまた爆発する。' } },
  { id: 'ufo', name: 'UFO召喚', emoji: '🛸', kind: 'active', rarity: 'rare', max: 5, desc: 'UFO が敵をさらい、高いところから落とす。', up: 'さらう数が増え、間隔が縮む', evo: { with: 'jishaku', name: '母船襲来', emoji: '👽', desc: '一度に 8 体をさらう。' } },
  { id: 'cat', name: '野良ネコ軍団', emoji: '🐈', kind: 'active', rarity: 'common', max: 5, tags: ['amount', 'knock'], desc: 'エサをあげていた野良ネコが助けに来る。', up: 'ネコの数と攻撃力が増える', evo: { with: 'un', name: '化け猫', emoji: '🐅', desc: '巨大化して敵を跳ね飛ばす。' } },
  { id: 'laser', name: '衛星レーザー', emoji: '🛰️', kind: 'active', rarity: 'epic', max: 5, tags: ['area'], desc: '宇宙からレーザーが降りそそぎ、地面をなぞる。', up: '太さ・時間・威力が増える', evo: { with: 'shuuchuu', name: '衛星砲フルバースト', emoji: '🔆', desc: '3 本同時に撃つ。' } },
  { id: 'timestop', name: 'ザ・授業中', emoji: '⏱️', kind: 'active', rarity: 'epic', max: 5, desc: '授業中の 5 分は永遠。敵の時間が止まる。', up: '止まる時間が延び、間隔が縮む', evo: { with: 'naishin', name: '永遠の5時間目', emoji: '😴', desc: '止まっている敵へのダメージが 2 倍。' } },
  { id: 'nuke', name: '理科室の禁薬', emoji: '☢️', kind: 'active', rarity: 'epic', max: 5, tags: ['area'], desc: '混ぜてはいけない薬品を混ぜる。大爆発。', up: '間隔が縮み、範囲が広がる' },
  { id: 'bio', name: '妄想バイオ', emoji: '☠️', kind: 'active', rarity: 'common', max: 5, tags: ['area'], desc: '歩いた跡に毒の霧が残る（と本人は思っている。実際に残る）。霧に入った敵は毒でじわじわ弱る。', up: '霧の大きさ・毒の強さ・残る時間が増える', evo: { with: 'yokotobi', name: 'バイオハザード', emoji: '☣️', desc: '霧が倍の大きさになる。毒で倒れた敵からも霧が噴き出す。' } },
  { id: 'grow', name: '棒、育つ', emoji: '🌱', kind: 'active', rarity: 'rare', max: 5, tags: ['swing'], desc: '【棒の攻撃】が当たるたびに、棒の威力が +1 される（分身の振りでも増える）。この登校のあいだ、ずっと残る。', up: '【棒の攻撃】でとどめを刺したとき、さらに威力が上がる', evo: { with: 'hayaben', name: '伝説の棒（自称）', emoji: '🌳', desc: '【棒の攻撃】が当たるたびに +3。とどめを刺すと、さらに +6。' } },
  { id: 'banana', name: 'バナナの皮', emoji: '🍌', kind: 'active', rarity: 'common', max: 5, tags: ['amount', 'knock'], desc: 'まわりにバナナの皮をばらまく。踏んだ敵は派手に転んで、どこかへ飛んでいく。', up: '皮の数と、転んだときの勢いが増える', evo: { with: 'atsuzoko', name: 'バナナ地獄', emoji: '🍌', desc: '皮が 3 回まで踏める。転んだ敵は 2 倍飛ぶ。' } },
  { id: 'bowling', name: 'ボウリング部の勧誘', emoji: '🎳', kind: 'active', rarity: 'common', max: 5, tags: ['amount'], desc: '重いボウリング球を前へ転がす。並んだ敵がピンのように倒れる。', up: '球の大きさ・重さ・数が増える', evo: { with: 'jishaku', name: 'マグネット・ストライク', emoji: '🧲', desc: '3 つの球が、敵の多い方へ曲がっていく。' } },
  { id: 'poltergeist', name: 'ポルターガイスト', emoji: '👻', kind: 'active', rarity: 'rare', max: 5, tags: ['amount', 'area'], desc: '近くの机・いす・がれきが宙に浮き、敵へ飛んでいく。物が多い場所ほど強い。', up: '投げる数・範囲・威力が増える', evo: { with: 'mousou', name: '騒霊大行進', emoji: '🏚️', desc: '建物の壁まではがして投げつける。' } },
  { id: 'swing', name: 'ジャイアントスイング', emoji: '🤼', kind: 'active', rarity: 'rare', max: 5, tags: ['knock'], desc: 'いちばん近い敵をつかんで振り回し、まわりをなぎ倒してから投げ飛ばす。', up: '回す速さ・威力・投げる勢いが増える', evo: { with: 'omoi', name: '人間ハンマー投げ', emoji: '🔨', desc: '3 体まとめてつかむ。投げた敵は落ちた所で爆発する。' } },
  { id: 'chime', name: '下校のチャイム', emoji: '🔔', kind: 'active', rarity: 'epic', max: 5, tags: ['area'], desc: 'ときどきチャイムが鳴る。弱った敵は家に帰る（倒れる）。まわりの敵はひるむ。', up: '帰る敵の範囲が広がり、間隔が縮む', evo: { with: 'naishin', name: '強制下校', emoji: '🏫', desc: '体力が半分以下の敵は、全員帰る。ボスにも大きく効く。' } },
  { id: 'hanabi', name: '打ち上げ花火', emoji: '🎆', kind: 'active', rarity: 'common', max: 5, tags: ['amount', 'area'], desc: '花火を打ち上げる。空で開いて、火の粉が広く降りそそぐ（火の粉は炎の爆発）。', up: '花火の数・範囲・威力が増える', evo: { with: 'shuuchuu', name: 'スターマイン', emoji: '🎇', desc: '花火が次々に打ち上がり、空を埋めつくす。' } },
  { id: 'alarm', name: '目覚まし時計爆弾', emoji: '⏰', kind: 'active', rarity: 'rare', max: 5, tags: ['area'], desc: '鳴りつづける目覚まし時計を投げる。まわりの敵は時計に群がり、最後に爆発する。', up: '引きつける範囲と、爆発の威力が増える', evo: { with: 'jishaku', name: '強力磁石目覚まし', emoji: '🧲', desc: '敵を力ずくで吸い寄せる。2 個同時に投げる。' } },
  { id: 'bubble', name: 'シャボン玉', emoji: '🫧', kind: 'active', rarity: 'common', max: 5, tags: ['amount'], desc: '大きなシャボン玉が敵を包んで、空へ浮かべる。割れると落ちて、地面にたたきつけられる。包まれた敵はぬれる。', up: '玉の数と、浮かぶ高さが増える', evo: { with: 'hoken', name: 'ふわふわ天国', emoji: '☁️', desc: '玉が大きくなり、1 つで 4 体まで包む。' } },
  { id: 'roomba', name: 'お掃除ロボ', emoji: '🤖', kind: 'active', rarity: 'rare', max: 5, tags: ['amount', 'knock'], desc: 'お掃除ロボが走り回る。落ちている経験値を集めてくれて、敵にはぶつかっていく。', up: 'ロボの数・速さ・威力が増える', evo: { with: 'kyushoku', name: '給食当番ロボ', emoji: '🍽️', desc: '弱った敵を吸い込んで、ほかの敵へ撃ち出す。' } },
  { id: 'domino', name: 'ドミノ倒し', emoji: '🧱', kind: 'active', rarity: 'common', max: 5, tags: ['knock'], desc: '敵の方へドミノを並べて、端を押す。倒れていくドミノが敵を押しつぶす。', up: '枚数と重さが増える', evo: { with: 'kintore', name: '巨石ドミノ', emoji: '🪨', desc: 'ドミノが大きな石板になる。倒れると建物まで壊す。' } },
  { id: 'megaphone', name: '放送委員の絶叫', emoji: '📢', kind: 'active', rarity: 'common', max: 5, tags: ['area', 'knock'], desc: '前方へ大声を浴びせる。敵はひるんで、吹き飛ぶ。', up: '届く範囲と、ひるむ時間が増える', evo: { with: 'konjou', name: '魂の叫び', emoji: '🗣️', desc: 'まわり全体に届く。建物の壁もびりびり崩れる。' } },
  { id: 'trampoline', name: '体育館のトランポリン', emoji: '🤸', kind: 'active', rarity: 'rare', max: 5, tags: ['area'], desc: 'トランポリンを置く。乗った敵は高く跳ね上がり、地面にたたきつけられる。ノリコが乗ると大ジャンプ。', up: '数と跳ねる高さが増える', evo: { with: 'dash', name: 'スーパートランポリン', emoji: '🎪', desc: '跳ねた敵は、落ちた所で爆発する。' } },
  { id: 'foam', name: '消火器ブラスト', emoji: '🧯', kind: 'active', rarity: 'common', max: 5, tags: ['area', 'knock'], desc: '前方へ消火器の泡を吹きつける。敵は押し戻され、泡でぬれて少し動けなくなる。', up: '届く距離と押す力が増える', evo: { with: 'taisougi', name: '消防車の放水', emoji: '🚒', desc: 'まわり全体へ、消防車なみの勢いで放水する。' } },
  { id: 'carve', name: '彫刻刀ラッシュ', emoji: '🔪', kind: 'active', rarity: 'common', max: 5, tags: ['area'], desc: '前方を彫刻刀で何度も切りつける。切られた敵は出血する（物理の継続ダメージ）。', up: '切る回数・範囲・出血が増える', evo: { with: 'kiai', name: '版画の鬼', emoji: '🖼️', desc: 'まわり全体を切り刻む。出血している敵へのダメージが 1.5 倍。' } },
  { id: 'detention', name: '居残りの刑', emoji: '⏲️', kind: 'active', rarity: 'epic', max: 5, desc: '敵に「居残り」の印を付ける。3 秒後、その間に受けたダメージの 35% をトゥルーダメージで追加で受ける。', up: '印の数と、追加の割合が増える', evo: { with: 'naishin', name: '永久居残り', emoji: '🔒', desc: '割合が 60% になり、印は近くの敵へ広がる。' } },
  { id: 'acid', name: '酸性雨', emoji: '🧪', kind: 'active', rarity: 'rare', max: 5, tags: ['area'], desc: '酸の雨を降らせる。浴びた敵は物理防御と魔法防御が 30% 下がり、毒も受ける。', up: '範囲・下がる量・毒が増える', evo: { with: 'hoken', name: '王水', emoji: '☣️', desc: '防御が 60% 下がる。雨が長く続く。' } },
  { id: 'rocket', name: 'ペットボトルロケット', emoji: '🧴', kind: 'active', rarity: 'common', max: 5, tags: ['amount', 'launch'], desc: '敵にペットボトルロケットを付けて、空高く打ち上げる。落ちてきたときに、高さに応じた衝撃ダメージ。', up: '数と打ち上げる高さが増える', evo: { with: 'chuuni', name: '有人ロケット', emoji: '🚀', desc: 'さらに高く飛ぶ。落ちた所で爆発する。' } },
  { id: 'billiard', name: 'ビリヤード部の勧誘', emoji: '🎱', kind: 'active', rarity: 'common', max: 5, tags: ['knock'], desc: '手球を打つ。当たった敵は勢いよく弾かれて、次の敵へ玉突きのようにぶつかる（衝撃）。', up: '球の数と、弾く勢いが増える', evo: { with: 'atsuzoko', name: 'ブレイクショット', emoji: '💫', desc: '9 個の球を一度に打つ。' } },
  { id: 'pitfall', name: '落とし穴', emoji: '🕳️', kind: 'active', rarity: 'rare', max: 5, tags: ['launch'], desc: '地面に落とし穴を掘る。踏んだ敵は穴に落ちて動けなくなり、しばらくして空へ吐き出される。', up: '穴の数と、吐き出す勢いが増える', evo: { with: 'konjou', name: '奈落', emoji: '⚫', desc: '穴が大きくなり、落ちた敵は 2 倍高く吐き出される。' } },
  { id: 'flail', name: 'チェーン鉄球', emoji: '⛓️', kind: 'active', rarity: 'rare', max: 5, tags: ['knock'], desc: '鎖でつないだ鉄球を引きずって歩く。振り回されて当たった敵に衝撃ダメージ。本当に物理で動く。', up: '鉄球が重く・大きくなる', evo: { with: 'omoi', name: '解体屋', emoji: '🏗️', desc: '鉄球が 2 つになり、建物も砕く。' } },
  { id: 'shield', name: '生徒会長の盾', emoji: '🛡️', kind: 'active', rarity: 'rare', max: 5, desc: 'しばらくの間、物理防御と魔法防御が上がる。体当たりしてきた敵を押し返す。', up: '上がる防御と、続く時間が増える', evo: { with: 'taisougi', name: '鉄壁の生徒会', emoji: '🏰', desc: '盾が切れる瞬間に、まわりの敵を大きく吹き飛ばす。' } },
  // ---- 攻撃スキル（LoL・Dota・PoE の仕組みを学校風に）
  { id: 'hook', name: '釣り部のフック', emoji: '🎣', kind: 'active', rarity: 'rare', max: 5, tags: ['knock'], desc: '遠くの敵に釣り針を引っかけて、手元へ一気に引き寄せる。引かれた敵は、途中の敵を巻き込む。', up: '引っかける数・威力・引く勢いが増える', evo: { with: 'omoi', name: '一本釣り', emoji: '🐟', desc: '3 本同時に投げる。釣った敵は頭上で振り回して、地面にたたきつける。' } },
  { id: 'globe', name: '転がる地球儀', emoji: '🌍', kind: 'active', rarity: 'common', max: 5, tags: ['amount', 'knock'], desc: '大きな地球儀を前へ転がす。本当に物理で転がるので、坂では速くなる。ひいた敵に衝撃ダメージ。', up: '大きさ・重さ・数が増える', evo: { with: 'kintore', name: '地球最後の日', emoji: '🌋', desc: '燃える巨大な地球儀が 3 個転がる。通った跡が燃える。' } },
  { id: 'snowball', name: '雪だるま転がし', emoji: '⛄', kind: 'active', rarity: 'rare', max: 5, tags: ['area', 'knock'], desc: '雪玉を転がす。敵をひくたびに大きく重くなり、最後に砕けてまわりを凍らせる。', up: '大きくなる量と、砕けたときの範囲が増える', evo: { with: 'kyushoku', name: '雪だるま大王', emoji: '☃️', desc: '最初から大きい。砕けると、まわりの敵がまとめて凍る。' } },
  { id: 'pitching', name: 'ピッチングマシン', emoji: '⚾', kind: 'active', rarity: 'common', max: 5, tags: ['amount'], desc: 'ピッチングマシンを置く。近くの敵へ硬球を撃ち続ける。球は物理で跳ね回る。', up: '置ける数と、撃つ速さが増える', evo: { with: 'megane', name: '千本ノック', emoji: '🥎', desc: '球を雨のように撃ち続ける。' } },
  { id: 'landmine', name: 'かんしゃく玉地雷', emoji: '💣', kind: 'active', rarity: 'common', max: 5, tags: ['amount', 'launch'], desc: 'まわりにかんしゃく玉をまく。踏んだ敵は爆発で空高く打ち上がる。', up: '数・威力・打ち上げる高さが増える', evo: { with: 'un', name: '地雷原', emoji: '💥', desc: '数が倍になり、1.5 倍高く打ち上げる。' } },
  { id: 'geyser', name: 'プールの排水口', emoji: '⛲', kind: 'active', rarity: 'rare', max: 5, tags: ['area', 'launch'], desc: '敵の群れの足元に印を付ける。1.2 秒後に水柱が噴き上がり、敵を打ち上げてぬらす。', up: '範囲・威力・打ち上げる高さが増える', evo: { with: 'mousou', name: '大噴泉', emoji: '🌊', desc: '3 か所同時に、2 回ずつ噴き上がる。' } },
  { id: 'cardboard', name: '段ボールの砦', emoji: '📦', kind: 'active', rarity: 'common', max: 5, tags: ['area'], desc: '敵の通り道に段ボール箱を積んで壁を作る。敵は壁で止まり、吹き飛ばした敵が当たると崩れてぶつかる。', up: '箱の数と丈夫さが増える', evo: { with: 'hizageri', name: '自販機の砦', emoji: '🏧', desc: '重い自動販売機を並べる。倒れると、下の敵を押しつぶす。' } },
  { id: 'brand', name: '呪いの付箋', emoji: '📝', kind: 'active', rarity: 'rare', max: 5, tags: ['amount'], desc: '敵に付箋を貼る。付箋は近くの敵へ小さな雷を飛ばし続け、貼られた敵が倒れると次の敵へ貼り替わる。', up: '付箋の数・雷の速さ・威力が増える', evo: { with: 'yofukashi', name: '怨念の付箋', emoji: '📜', desc: '雷を受けた敵が燃える。付箋が 2 枚ずつ増える。' } },
  { id: 'gourei', name: '全校集会の号令', emoji: '📣', kind: 'active', rarity: 'rare', max: 5, tags: ['area', 'knock'], desc: '「気をつけ！」の号令で地面を揺らす。範囲にいる敵が多いほど強い（1 体ごとに +10%）。', up: '範囲と、1 体ごとに増える割合が増える', evo: { with: 'kakemochi', name: '全校生徒の号令', emoji: '🏫', desc: '範囲が 1.6 倍になり、1 体ごとに +15%。' } },
  { id: 'gaman', name: 'がまんの限界', emoji: '😤', kind: 'active', rarity: 'epic', max: 5, tags: ['area'], desc: '受けたダメージ（防御で減らした分も含む）をためておき、たまったら前方へトゥルーダメージで吐き出す。', up: 'ためる割合と、吐き出す範囲が増える', evo: { with: 'taisougi', name: '堪忍袋の緒が切れた', emoji: '💢', desc: 'まわり全体へ吐き出す。ためる量 1.5 倍。' } },
  { id: 'balloon', name: '水風船', emoji: '🎈', kind: 'active', rarity: 'common', max: 5, tags: ['amount', 'area'], desc: '敵の群れへ水風船を投げる。割れると敵がびしょぬれになり、少し押し流される。', up: '数・範囲・威力が増える', evo: { with: 'taisougi', name: 'プール開き', emoji: '🏊', desc: '空から大量の水が降ってきて、まわりの敵をまとめて押し流す。' } },
  // ---- 攻撃スキル（第 2 弾: LoL・Dota・PoE の仕組みを学校風に）
  { id: 'yuutai', name: '幽体離脱', emoji: '👻', kind: 'active', rarity: 'rare', max: 5, desc: 'ノリコの魂が体から抜け出し、近くの敵の間を飛び回って次々に斬りつける。魂が斬っている間も、体は動ける。', up: '斬る回数と威力が増える', evo: { with: 'norinori', name: '百鬼夜行', emoji: '👹', desc: '12 回斬る。斬って倒すたびに回数が 2 増える。威力 1.5 倍。' } },
  { id: 'hikouki', name: '紙飛行機の遠投', emoji: '✈️', kind: 'active', rarity: 'common', max: 5, tags: ['amount'], desc: '遠くの敵へ紙飛行機を投げる。長く飛んでから当たるほど、威力と気絶する時間が増える（最大 3 倍）。', up: '数・威力・貫通が増える', evo: { with: 'kata', name: 'ジャンボ紙飛行機', emoji: '🛩️', desc: '大きな紙飛行機がすべての敵を貫き、最後に爆発する。' } },
  { id: 'nukiuchi', name: '抜き打ちテスト', emoji: '📃', kind: 'active', rarity: 'epic', max: 5, desc: '「今から抜き打ちテストをします」。まわり 40m のすべての敵の頭に「！」が出て、1.6 秒後にまとめて魔法ダメージを受け、少し動けなくなる。体力が 30% を切った敵は 2 倍。', up: '威力が増え、間隔が縮む', evo: { with: 'naishin', name: '期末テスト', emoji: '🏫', desc: '2 回続けて出題する。動けなくなる時間 2 倍。' } },
  { id: 'shimei', name: '学級委員の指名', emoji: '☝️', kind: 'active', rarity: 'rare', max: 5, desc: 'いちばん体力の多い敵（ボス・エリートが先）を指名して、遠くから狙い撃つ。この攻撃で倒すたびに、威力が 2% ずつ上がる（この登校のあいだ残る）。', up: '威力が増え、間隔が縮む', evo: { with: 'bankuruwase', name: '生徒会長の指名', emoji: '👑', desc: '体力の多い順に 3 体を続けて撃つ。倒したときに上がる威力も 2 倍。' } },
  { id: 'omikuji', name: 'おみくじ', emoji: '⛩️', kind: 'active', rarity: 'common', max: 5, tags: ['area'], desc: 'おみくじを引く。大吉は雷の雨、吉は花火、小吉は回復と小さな爆発。凶が出ると、まわりの敵が呪われて防御が下がる。', up: '威力が増え、間隔が縮む', evo: { with: 'un', name: '大大吉', emoji: '🎴', desc: '凶が出なくなり、大吉が出やすくなる。' } },
  { id: 'purinto', name: 'プリント配布', emoji: '📑', kind: 'active', rarity: 'common', max: 5, tags: ['amount'], desc: '近くで敵が倒れると、ときどきプリントが舞い上がり、近くの敵へ飛んでいって切りつける（出血）。', up: '飛ぶ確率・枚数・威力が増える', evo: { with: 'yatsuatari', name: 'テスト返却', emoji: '💯', desc: '倒れた敵から必ず 2 枚飛ぶ。赤点のプリントは当たると小さく爆発する。' } },
  { id: 'asagao', name: '観察日記の朝顔', emoji: '🌺', kind: 'active', rarity: 'rare', max: 5, tags: ['area'], desc: '朝顔の鉢を置く。時間とともにつるが伸び、まわりの敵を叩いて遅くする。最後に花が咲いて、種を四方へ飛ばす。', up: '大きく育ち、種が増える', evo: { with: 'hoken', name: 'ひまわり畑', emoji: '🌻', desc: '鉢を 3 つ置く。ノリコが近くにいると、毎秒 HP が 1% 回復する。' } },
  { id: 'kasa', name: '置き傘ガード', emoji: '☂️', kind: 'active', rarity: 'rare', max: 5, tags: ['area'], desc: '傘を広げる。開いている間、まわりへ飛んでくる敵の弾を、撃った敵の方へ跳ね返す（5 倍の威力）。傘にぶつかった敵は押し返される。', up: '開いている時間と範囲が増える', evo: { with: 'taisougi', name: 'ビニール傘の結界', emoji: '🌂', desc: 'ずっと開いている。跳ね返した弾は 8 倍の威力。' } },
  { id: 'bikkuri', name: 'びっくり箱', emoji: '🎁', kind: 'active', rarity: 'common', max: 5, tags: ['amount'], desc: 'まわりにびっくり箱を置く。敵が近づくと飛び出して、まわりの敵を叩き、しばらく怖がらせて逃げ回らせる（ボスは怖がらない）。', up: '箱の数・威力・怖がる時間が増える', evo: { with: 'chuuni', name: 'お化け屋敷', emoji: '🏚️', desc: '箱が 3 回まで飛び出す。怖がった敵は、受けるダメージが 30% 増える。' } },
  // ---- 攻撃スキル（第 2 弾: 本物の形の物体を使うもの。モデルは NVIDIA USDCraft-10K）
  { id: 'piano', name: '音楽室のピアノ', emoji: '🎹', kind: 'active', rarity: 'epic', max: 5, tags: ['area'], desc: '敵の群れの上へピアノを落とす。落ちたピアノは 2.5 秒間ひとりでに鳴り、音符を四方へ飛ばす。最後はばらばらに壊れて、部品が飛び散る。', up: '音符の数と威力が増える', evo: { with: 'mahou', name: 'ピアノ協奏曲', emoji: '🎼', desc: 'ピアノを 2 台落とす。音符は敵を追いかける。' } },
  { id: 'forklift', name: 'フォークリフト暴走', emoji: '🚜', kind: 'active', rarity: 'rare', max: 5, tags: ['knock', 'launch'], desc: 'フォークリフトが敵の群れへまっすぐ突っ込む。フォークにすくわれた敵は持ち上げられ、高く放り投げられる。', up: '速さと持ち上げる高さが増える', evo: { with: 'omoi', name: 'フォークリフト二台', emoji: '🏗️', desc: '2 台が交差するように突っ込む。ぶつかった敵はさらに遠くへ飛ぶ。' } },
  { id: 'lockers', name: 'ロッカーの闘技場', emoji: '🗄️', kind: 'active', rarity: 'epic', max: 5, tags: ['area'], desc: 'ノリコのまわりにロッカーを輪に並べて、敵を閉じこめる。扉がときどき開いて、近くの敵をはたく。終わるとロッカーは外へ倒れて壊れる。', up: '続く時間と、はたく威力が増える', evo: { with: 'gabyou', name: '鉄格子の闘技場', emoji: '⛓️', desc: '輪が大きくなり、扉が倍の速さで開く。最後は外へはじけ飛ぶ。' } },
  { id: 'merrygo', name: '回転遊具', emoji: '🎠', kind: 'active', rarity: 'rare', max: 5, tags: ['area', 'knock'], desc: '敵の群れのそばに回転遊具を置いて回す。近くの敵は吸い寄せられ、回る勢いで外へ放り出される（衝撃）。', up: '回る時間と勢いが増える', evo: { with: 'atsuzoko', name: '大回転', emoji: '🌀', desc: '遊具が大きくなり、放り出す勢いが倍になる。' } },
  { id: 'gascyl', name: 'ガスボンベ・ロケット', emoji: '⛽', kind: 'active', rarity: 'common', max: 5, tags: ['amount', 'area'], desc: 'ガスボンベの栓を折って放つ。ボンベは敵へ向かってふらふら飛び回り、最後に爆発する。', up: '数と爆発の威力が増える', evo: { with: 'kiai', name: 'プロパン連鎖', emoji: '🔥', desc: '爆発すると、小さなボンベが 3 本飛び出して、それぞれ爆発する。' } },
  { id: 'carts', name: '閉店セール', emoji: '🛒', kind: 'active', rarity: 'common', max: 5, tags: ['amount', 'knock'], desc: '信号が赤になると、ショッピングカートの列が敵の群れを突っ切る。はねられた敵に衝撃ダメージ。', up: 'カートの数と速さが増える', evo: { with: 'dash', name: '在庫一掃セール', emoji: '🏷️', desc: '十字に 2 列が突っ切る。カートの数 2 倍。' } },
  { id: 'seesaw', name: 'シーソー・カタパルト', emoji: '🛝', kind: 'active', rarity: 'rare', max: 5, tags: ['launch'], desc: '敵の群れにシーソーの片側を差しこみ、反対側へダンベルを落とす。群れは空高く打ち上げられ、落ちたときに衝撃ダメージ。', up: '打ち上げる高さと範囲が増える', evo: { with: 'kintore', name: 'シーソーの大砲', emoji: '🎯', desc: 'さらに高く打ち上げ、打ち上げた敵は落ちた所で爆発する。' } },
  { id: 'drums', name: '軽音部のドラム', emoji: '🥁', kind: 'active', rarity: 'rare', max: 5, tags: ['area'], desc: 'ドラムセットを置く。拍に合わせて衝撃波が広がり、4 拍目は大きな波で敵をひるませる。', up: '叩く時間と波の大きさが増える', evo: { with: 'shuuchuu', name: 'ドラムソロ', emoji: '🎸', desc: '拍が速くなり、4 拍目の波で敵が浮き上がる。' } },
  { id: 'drone', name: 'ドローン部', emoji: '🚁', kind: 'active', rarity: 'rare', max: 5, tags: ['amount'], desc: 'ドローンがノリコのまわりを飛び、近くの敵をレーザーで撃つ。', up: 'ドローンの数と撃つ速さが増える', evo: { with: 'kata', name: 'ドローン編隊', emoji: '🛸', desc: 'ドローンが 6 台になり、ときどき 1 台が群れへ突っ込んで爆発する（すぐに補充される）。' } },
  // ---- 攻撃スキル（第 3 弾）
  { id: 'nawatobi', name: '大縄跳び', emoji: '🪢', kind: 'active', rarity: 'rare', max: 5, tags: ['area', 'launch'], desc: 'ノリコのまわりで大縄が回る。縄に当たった敵は跳べずに打ち上げられる。', up: '縄の長さ・回る速さ・威力が増える', evo: { with: 'idaten', name: '二重跳び', emoji: '➰', desc: '縄が 2 本になり、逆向きにも回る。' } },
  { id: 'rentai', name: '連帯責任', emoji: '⛓️', kind: 'active', rarity: 'rare', max: 5, tags: ['amount'], desc: '近くの敵を鎖でつなぐ。つながった敵がダメージを受けると、ほかの敵も 40% のダメージを受ける（トゥルー）。', up: 'つなぐ数と分け合う割合が増える', evo: { with: 'zekkouchou', name: '一蓮托生', emoji: '🔗', desc: '分け合う割合が 80% になる。つながった敵が倒れると、ほかの敵が少し気絶する。' } },
  { id: 'jintai', name: '理科室の人体模型', emoji: '🫀', kind: 'active', rarity: 'epic', max: 5, tags: ['knock'], desc: '人体模型が動き出し、跳ねながら敵を殴る。まわりの敵は人体模型に群がり、ノリコから離れる。', up: '続く時間と殴る威力が増える', evo: { with: 'hoken', name: '保健室の骨格標本', emoji: '🩻', desc: '2 体になる。殴るたびに、ノリコの HP が少し回復する。' } },
  { id: 'senbazuru', name: '千羽鶴', emoji: '🕊️', kind: 'active', rarity: 'rare', max: 5, tags: ['amount', 'area'], desc: '前方へ折り鶴の群れを 2 秒間放ち続ける。扇形の敵を何度も切りつける。', up: '鶴の数と威力が増える', evo: { with: 'kata', name: '万羽鶴', emoji: '🦢', desc: '4 秒間、まわり全方向へ放つ。' } },
  { id: 'cracker', name: 'パーティークラッカー', emoji: '🎉', kind: 'active', rarity: 'common', max: 5, tags: ['swing', 'area'], desc: '近くの敵にクラッカーを貼る。貼った敵に【棒の攻撃】を当てるたびに火薬がたまり（最大 4 回）、4 秒後か 4 回目で破裂する。たまった分だけ威力が上がる。', up: '威力と破裂の範囲が増える', evo: { with: 'hayaben', name: '大入りクラッカー', emoji: '🎊', desc: '3 体に貼る。破裂の範囲 1.5 倍。' } },
  { id: 'straw', name: 'ストロー吸引', emoji: '🥤', kind: 'active', rarity: 'rare', max: 5, tags: ['amount'], desc: '近くの敵にストローを刺して、体力を吸い取る。吸った分の 30% だけ HP が回復する。離れすぎると外れる。', up: '吸う敵の数と速さが増える', evo: { with: 'kyushoku', name: '特大ストロー', emoji: '🧋', desc: '吸う敵が 2 倍になり、回復が 50% になる。' } },
  { id: 'miyage', name: '置き土産', emoji: '💀', kind: 'active', rarity: 'rare', max: 5, tags: ['area'], desc: '倒れた敵の跡が、少しあとで破裂する。倒れた敵の最大 HP が大きいほど強い。', up: '破裂する数と威力が増える', evo: { with: 'yofukashi', name: '百物語', emoji: '🕯️', desc: '破裂した場所に毒の霧が残る。' } },
  { id: 'nezumi', name: 'ねずみ花火', emoji: '🎇', kind: 'active', rarity: 'common', max: 5, tags: ['amount'], desc: 'ねずみ花火をまく。火花を散らしながら地面を走り回り、触れた敵を焼く。', up: '数・走る時間・威力が増える', evo: { with: 'mousou', name: '大ねずみ花火', emoji: '🎡', desc: '花火が大きくなり、最後に破裂する。' } },
  { id: 'kora', name: '生活指導の「こらーっ！」', emoji: '😠', kind: 'active', rarity: 'rare', max: 5, tags: ['area', 'knock'], desc: '「こらーっ！」と叫ぶ。まわり 8m の敵はノリコへ向かってきて（撃つ敵も撃たずに寄ってくる）、ノリコは 4 秒間 物理防御と魔法防御 +40。その間、敵に殴られるたびに回転斬りでやり返す（【スキルの攻撃】）。', up: '回転斬りの威力と範囲が増える', evo: { with: 'gabyou', name: '鬼の生活指導', emoji: '👺', desc: '回転斬りが 0.5 秒ごとにも出る。' } },
  { id: 'reizouko', name: '業務用冷蔵庫', emoji: '🥶', kind: 'active', rarity: 'rare', max: 5, tags: ['area'], desc: '冷蔵庫を置く。扉が開くたびに冷気が前へ吹き出し、扇形の敵を凍らせる。最後は壊れて部品が飛び散る。', up: '吹き出す回数と範囲が増える', evo: { with: 'hayaoki', name: '業務用冷凍庫', emoji: '🧊', desc: '冷気が 2 倍の範囲に届き、凍った敵は受けるダメージが 30% 増える。' } },
  { id: 'sentakuki', name: '洗濯機の脱水', emoji: '🧺', kind: 'active', rarity: 'rare', max: 5, tags: ['knock'], desc: '敵の群れに洗濯機を置く。近くの敵を吸いこんで脱水し、目を回した敵を四方へ吐き出す（衝撃）。', up: '吸いこむ数と吐き出す勢いが増える', evo: { with: 'yokotobi', name: '全自動洗濯機', emoji: '🌀', desc: '吸いこむ範囲が広がり、2 回続けて脱水する。' } },
  { id: 'dunk', name: 'ダンクシュート', emoji: '🏀', kind: 'active', rarity: 'common', max: 5, tags: ['launch'], desc: 'バスケットゴールを置く。近くの敵を 1 体ずつつかんでゴールへ放りこみ、地面へたたきつける。', up: '投げる間隔が短くなり、威力が増える', evo: { with: 'udetate', name: 'アリウープ', emoji: '⛹️', desc: '2 体ずつ放りこみ、たたきつけた場所が爆発する。' } },

  // ---- 強化（パッシブ）
  // ---- 第 4 弾
  { id: 'kokuban', name: '黒板消しはたき', emoji: '🧽', kind: 'active', rarity: 'common', max: 5, tags: ['area'], desc: '前方へ黒板消しをはたいて、チョークの粉を浴びせる。粉を浴びた敵は目をこすって、しばらくふらふら歩く（ボスは除く）。', up: '粉が広く、ふらつく時間が長くなる', evo: { with: 'mousou', name: 'チョークの粉塵爆発', emoji: '💨', desc: '粉が 1 秒後に 3 か所で爆発する。' } },
  { id: 'jitensha', name: '自転車通学', emoji: '🚲', kind: 'active', rarity: 'common', max: 5, tags: ['launch'], desc: 'ノリコの後ろから自転車が走り抜け、通り道の敵をはね飛ばす。', up: '自転車が速くなり、はねる力が強くなる', evo: { with: 'dash', name: '暴走自転車部', emoji: '🚴', desc: '3 台が扇形に走り抜け、ベルの音でまわりの敵を気絶させる。' } },
  { id: 'denjishaku', name: '理科室の電磁石', emoji: '🧲', kind: 'active', rarity: 'rare', max: 5, tags: ['area', 'knock'], desc: '敵の集まった所に電磁石を置く。まわりの物と敵を 2 秒間引き寄せ、最後に一気にはじき飛ばす。', up: '引き寄せる範囲と、はじく力が大きくなる', evo: { with: 'omoi', name: '超電磁石', emoji: '⚡', desc: '引き寄せる範囲が 1.5 倍になり、はじくときに雷が落ちる。' } },
  { id: 'honnoame', name: '図書室の本の雨', emoji: '📚', kind: 'active', rarity: 'common', max: 5, tags: ['area', 'amount'], desc: '敵の集まった所へ、空から本を降らせる。当たった敵は倒れこむ。', up: '本が増え、威力が上がる', evo: { with: 'anki', name: '百科事典の雨', emoji: '📖', desc: '分厚い百科事典になり、当たった範囲が広く、敵を 0.5 秒気絶させる。' } },
  { id: 'fuusen', name: 'ヘリウム風船', emoji: '🎈', kind: 'active', rarity: 'rare', max: 5, tags: ['launch'], desc: '近くの敵に風船を結びつけて、空へ浮かせる。2 秒後に風船が割れ、敵は地面へ落ちて落下ダメージを受ける（ボスは除く）。', up: '浮かせる数が増える', evo: { with: 'atsuzoko', name: '熱気球', emoji: '🎈', desc: '割れた瞬間、敵を地面へたたきつける（落下ダメージが大きくなる）。' } },
  { id: 'shutter', name: '防火シャッター', emoji: '🚪', kind: 'active', rarity: 'rare', max: 5, tags: ['area'], desc: '敵の集まった所へ防火シャッターを落とす。下にいた敵はつぶれ、シャッターは 5 秒間、敵だけを止める壁になる。', up: 'シャッターが広く、重くなる', evo: { with: 'taisougi', name: '鉄の扉', emoji: '🛡️', desc: '2 枚の扉が V 字に落ち、扉に触れた敵はダメージを受ける。' } },
  { id: 'pingpong', name: '卓球部のスマッシュ', emoji: '🏓', kind: 'active', rarity: 'common', max: 5, tags: ['amount'], desc: 'ピンポン球を打つ。球は敵から敵へ跳ね返りながら当たる。', up: '跳ね返る回数と威力が増える', evo: { with: 'kata', name: 'ラリーの鬼', emoji: '🏓', desc: '球が 2 つになり、跳ね返るたびに威力が 10% ずつ増える。' } },
  { id: 'karaoke', name: 'カラオケ大会', emoji: '🎤', kind: 'active', rarity: 'rare', max: 5, tags: ['area'], desc: 'ノリコの近くにジュークボックスを置く。6 秒間、音の波でまわりの敵にダメージを与え、4 拍ごとに敵を踊らせて止める。', up: '音の波が広く、強くなる', evo: { with: 'norinori', name: '全校カラオケ大会', emoji: '🎶', desc: '2 拍ごとに敵を踊らせる。ジュークボックスの近くでは、棒を振る速さ +20%。' } },
  { id: 'shoot', name: 'サッカー部のシュート', emoji: '⚽', kind: 'active', rarity: 'common', max: 5, tags: ['knock'], desc: '近くの敵を、敵の集まった方へ思い切り蹴り飛ばす。飛んだ敵がぶつかった所で爆発する（ボスは蹴れない）。', up: '蹴る力と爆発の威力が上がる', evo: { with: 'asaren', name: '超次元シュート', emoji: '🔥', desc: '2 体を蹴り、蹴った敵が燃えながら飛ぶ。爆発が大きくなる。' } },
  { id: 'photo', name: '卒業アルバムの撮影', emoji: '📸', kind: 'active', rarity: 'common', max: 5, tags: ['area'], desc: '前方をフラッシュで撮影する。写った敵はポーズを取って少し止まり、3 秒間【すべての攻撃】から受けるダメージが 30% 増える。', up: '止まる時間が長く、撮れる範囲が広くなる', evo: { with: 'megane', name: '連写', emoji: '📷', desc: '3 回続けて撮影する。' } },
  { id: 'kintore', name: '筋トレ', emoji: '💪', kind: 'passive', rarity: 'common', max: 5, desc: '【棒の攻撃】と【スキルの攻撃】のダメージ +12%。', up: '【棒の攻撃】と【スキルの攻撃】のダメージ +12%', scope: ['weapon', 'skill'] },
  { id: 'hayaben', name: '早弁', emoji: '🍱', kind: 'passive', rarity: 'common', max: 5, desc: '棒を振る速さ +9%（【棒の攻撃】が速くなる）。', up: '振る速さ +9%', scope: ['weapon'] },
  { id: 'dash', name: '上履きダッシュ', emoji: '🏃', kind: 'passive', rarity: 'common', max: 5, desc: '移動速度 +8%。', up: '移動速度 +8%', scope: ['move'] },
  { id: 'kyushoku', name: '給食おかわり', emoji: '🍚', kind: 'passive', rarity: 'common', max: 5, desc: '最大 HP +20。その場で 20 回復。', up: '最大 HP +20', scope: ['heal'] },
  { id: 'hoken', name: '保健室のベッド', emoji: '🛏️', kind: 'passive', rarity: 'common', max: 5, desc: 'HP が毎秒 0.6 回復する。', up: '回復量 +0.6/秒', scope: ['heal'] },
  { id: 'jishaku', name: 'U字磁石', emoji: '🧲', kind: 'passive', rarity: 'common', max: 5, desc: '経験値を拾える範囲 +35%。', up: '範囲 +35%', scope: ['grow'] },
  { id: 'mousou', name: '妄想力', emoji: '💭', kind: 'passive', rarity: 'common', max: 5, desc: '攻撃スキルの範囲 +10%。', up: '範囲 +10%', scope: ['skill'] },
  { id: 'shuuchuu', name: '集中力', emoji: '📖', kind: 'passive', rarity: 'common', max: 5, desc: '攻撃スキルの待ち時間 -7%。', up: '待ち時間 -7%', scope: ['skill'] },
  { id: 'kiai', name: '気合', emoji: '🔥', kind: 'passive', rarity: 'common', max: 5, desc: '【棒の攻撃】と【スキルの攻撃】（直接当てたものと弾）が 6% の確率で会心になる（会心ダメージは 2 倍から）。', up: '会心率 +6%', scope: ['weapon', 'skill'] },
  { id: 'atsuzoko', name: '厚底ローファー', emoji: '👞', kind: 'passive', rarity: 'common', max: 5, desc: '【棒の攻撃】と【スキルの攻撃】の吹き飛ばす力 +20%。', up: '吹き飛ばし +20%', scope: ['weapon', 'skill'] },
  { id: 'naishin', name: '内申点', emoji: '📝', kind: 'passive', rarity: 'common', max: 5, desc: 'もらえる経験値 +10%。', up: '経験値 +10%', scope: ['grow'] },
  { id: 'copy', name: 'コピー機', emoji: '🖨️', kind: 'passive', rarity: 'epic', max: 2, desc: '攻撃スキルの出る数 +1（弾・設置物・ネコなど）。', up: '出る数 +1', scope: ['skill'] },
  { id: 'un', name: '幸運のお守り', emoji: '🍀', kind: 'passive', rarity: 'rare', max: 5, desc: '運 +15%。珍しいスキルや回復アイテムが出やすく、宝箱の中身も増えやすい。', up: '運 +15%', scope: ['grow'] },
  { id: 'taisougi', name: '体操着', emoji: '🎽', kind: 'passive', rarity: 'common', max: 5, desc: '物理防御 +15、魔法防御 +10。受けるダメージが減る。', up: '物理防御 +15、魔法防御 +10', scope: ['guard'] },
  { id: 'konjou', name: '根性', emoji: '❤️‍🔥', kind: 'passive', rarity: 'epic', max: 1, desc: '力尽きても 1 度だけ起き上がる。起き上がるとき、まわりを爆発で吹き飛ばす。', up: '', scope: ['guard'] },
  { id: 'chuuni', name: '厨二病', emoji: '🗡️', kind: 'passive', rarity: 'rare', max: 5, desc: '棒が 12% 長くなる（【棒の攻撃】が届きやすくなる。と本人は感じている。実際に伸びる）。', up: '棒の長さ +12%', scope: ['weapon'] },
  { id: 'omoi', name: '置き勉しない主義', emoji: '📚', kind: 'passive', rarity: 'common', max: 5, desc: '教科書を全部持ち歩くので、棒が重くなる（重さ +25%）。【棒の攻撃】で敵がよく飛び、壁もよく壊れる。', up: '棒の重さ +25%', scope: ['weapon'] },
  { id: 'tomato', name: 'トマトジュース', emoji: '🍅', kind: 'passive', rarity: 'rare', max: 5, desc: '敵を 12 体倒すごとに、HP が 2 回復する。', up: '回復する量 +2', scope: ['heal'] },
  { id: 'gabyou', name: '画びょう', emoji: '📌', kind: 'passive', rarity: 'common', max: 5, desc: '体当たりしてきた敵に画びょうが刺さり、ダメージを返して弾き飛ばす。', up: '返すダメージ +8', scope: ['guard'] },
  { id: 'udetate', name: '腕立て伏せ', emoji: '🏋️', kind: 'passive', rarity: 'common', max: 5, desc: 'AD（物理攻撃力）+6。【棒の攻撃】と、AD で強くなる【スキルの攻撃】が強くなる。', up: 'AD +6', scope: ['weapon', 'skill'] },
  { id: 'mahou', name: '魔法少女ごっこ', emoji: '🪄', kind: 'passive', rarity: 'common', max: 5, desc: 'AP（魔法攻撃力）+12。AP で強くなる【スキルの攻撃】（魔法スキル）が強くなる。', up: 'AP +12', scope: ['skill'] },
  { id: 'hizageri', name: 'ひざ蹴り', emoji: '🦵', kind: 'passive', rarity: 'common', max: 5, desc: '【衝撃】ダメージ（巻き込み・たたきつけ・物・落下） +12%。', up: '衝撃ダメージ +12%', scope: ['impact'] },
  { id: 'yofukashi', name: '夜ふかし', emoji: '🌙', kind: 'passive', rarity: 'common', max: 5, desc: '継続ダメージ（燃焼・毒・出血）+12%。', up: '継続ダメージ +12%', scope: ['dot'] },
  { id: 'megane', name: '伊達メガネ', emoji: '👓', kind: 'passive', rarity: 'common', max: 5, desc: '【棒の攻撃】と【スキルの攻撃】の会心率 +2%、会心ダメージ +15%。', up: '会心率 +2%、会心ダメージ +15%', scope: ['weapon', 'skill'] },
  { id: 'kakemochi', name: '部活の掛け持ち', emoji: '🏅', kind: 'passive', rarity: 'rare', max: 5, desc: 'アイテムの数値の効果 +6%。', up: 'アイテムの効果 +6%', scope: ['grow'] },
  { id: 'kata', name: 'ソフトボール部の肩', emoji: '🥎', kind: 'passive', rarity: 'common', max: 5, desc: '弾（スキルの弾）の速さ +12%、弾が敵を吹き飛ばす力 +15%。', up: '速さ +12%、吹き飛ばし +15%', scope: ['skill'] },
  { id: 'bankuruwase', name: '番狂わせ', emoji: '👊', kind: 'passive', rarity: 'common', max: 5, desc: 'エリートとボスへの【すべての攻撃】のダメージ +10%。', up: 'エリートとボスへのダメージ +10%', scope: ['all'] },
  { id: 'norinori', name: 'ノリノリ', emoji: '🎧', kind: 'passive', rarity: 'common', max: 5, desc: '敵を倒すと 3 秒間、棒を振る速さと移動速度 +2%（最大 10 回重なる）。', up: '1 回あたり +2%', scope: ['weapon', 'move'] },
  { id: 'yatsuatari', name: '八つ当たり', emoji: '💢', kind: 'passive', rarity: 'common', max: 5, desc: 'とどめを刺したときに余ったダメージの 40% を、近くの敵（4m 以内）に与える（燃焼・毒・出血でのとどめは除く）。', up: '余ったダメージの割合 +10%', scope: ['all'] },
  { id: 'idaten', name: '韋駄天', emoji: '💨', kind: 'passive', rarity: 'rare', max: 2, desc: 'ダッシュを続けて 2 回使える。ダッシュの速さ +10%。', up: 'ダッシュの回数 +1、速さ +10%', scope: ['move'] },
  { id: 'hayaoki', name: '早寝早起き', emoji: '🌞', kind: 'passive', rarity: 'common', max: 5, desc: '経験値の玉を拾うたびに、HP が 0.3 回復する。', up: '回復する量 +0.3', scope: ['heal'] },
  { id: 'anki', name: '暗記パン', emoji: '🍞', kind: 'passive', rarity: 'common', max: 5, desc: '【スキルの攻撃】のダメージ +8%。', up: '【スキルの攻撃】のダメージ +8%', scope: ['skill'] },
  { id: 'asaren', name: '部活の朝練', emoji: '🌅', kind: 'passive', rarity: 'common', max: 5, desc: '【棒の攻撃】のダメージ +10%。', up: '【棒の攻撃】のダメージ +10%', scope: ['weapon'] },
  { id: 'zekkouchou', name: '絶好調', emoji: '😎', kind: 'passive', rarity: 'common', max: 5, desc: 'HP が 80% 以上のとき、【すべての攻撃】のダメージ +8%。', up: 'HP が多いときのダメージ +8%', scope: ['all'] },
  { id: 'yokotobi', name: '反復横跳び', emoji: '↔️', kind: 'passive', rarity: 'common', max: 5, desc: 'ダッシュの待ち時間 -15%。ダッシュでぶつかった敵に物理ダメージを与えて弾き飛ばす。', up: '待ち時間 -15%、弾く力が増える', scope: ['move'] },
];

/** スキルごとのダメージの種類と反映率。 */
const SKILL_DMG: Record<string, SkillDmg> = {
  chalk: { kind: 'phys', ad: 0.5 }, eraser: { kind: 'phys', ad: 0.5 }, uwabaki: { kind: 'phys', ad: 0.6 }, pencil: { kind: 'phys', ad: 0.6 },
  fire: { kind: 'magic', ap: 0.9 }, thunder: { kind: 'magic', ap: 0.8 }, blizzard: { kind: 'magic', ap: 0.7 }, gravity: { kind: 'magic', ap: 0.8 },
  desk: { kind: 'phys', ad: 0.7 }, compass: { kind: 'phys', ad: 0.6 }, milk: { kind: 'magic', ap: 0.6, dot: 'burn' }, randoseru: { kind: 'magic', ap: 0.7 },
  statue: { kind: 'phys', ad: 0.8 }, ball: { kind: 'impact' }, wave: { kind: 'magic', ap: 1.0 }, tornado: { kind: 'magic', ap: 0.7 },
  stomp: { kind: 'phys', ad: 0.7 }, clone: { kind: 'phys', ad: 1.0 }, slashwave: { kind: 'phys', ad: 1.0 }, boomsword: { kind: 'phys', ad: 0.6 },
  ufo: { kind: 'impact' }, cat: { kind: 'phys', ad: 0.6 }, laser: { kind: 'magic', ap: 1.0 }, nuke: { kind: 'magic', ap: 1.2 },
  bio: { kind: 'magic', ap: 0.6, dot: 'poison' }, grow: { kind: 'phys', ad: 1.0 }, banana: { kind: 'phys', ad: 0.6 }, bowling: { kind: 'impact' },
  poltergeist: { kind: 'impact' }, swing: { kind: 'phys', ad: 0.8 }, chime: { kind: 'true' }, balloon: { kind: 'magic', ap: 0.5 },
  hanabi: { kind: 'magic', ap: 0.8 }, alarm: { kind: 'magic', ap: 0.8 }, bubble: { kind: 'magic', ap: 0.6 }, roomba: { kind: 'phys', ad: 0.5 },
  domino: { kind: 'impact' }, megaphone: { kind: 'magic', ap: 0.6 }, trampoline: { kind: 'impact' }, foam: { kind: 'magic', ap: 0.5 },
  carve: { kind: 'phys', ad: 0.9, dot: 'bleed' }, detention: { kind: 'true' }, acid: { kind: 'magic', ap: 0.7, dot: 'poison' }, rocket: { kind: 'impact' },
  billiard: { kind: 'impact' }, pitfall: { kind: 'impact' }, flail: { kind: 'impact' }, shield: { kind: 'phys', ad: 0.5 },
  hook: { kind: 'phys', ad: 0.8 }, globe: { kind: 'impact' }, snowball: { kind: 'impact' }, pitching: { kind: 'impact' },
  landmine: { kind: 'magic', ap: 0.6 }, geyser: { kind: 'magic', ap: 0.7 }, cardboard: { kind: 'impact' }, brand: { kind: 'magic', ap: 0.6 },
  gourei: { kind: 'phys', ad: 0.8 }, gaman: { kind: 'true' },
  yuutai: { kind: 'phys', ad: 1.0 }, hikouki: { kind: 'phys', ad: 0.8 }, nukiuchi: { kind: 'magic', ap: 1.0 }, shimei: { kind: 'phys', ad: 1.2 },
  omikuji: { kind: 'magic', ap: 0.8 }, purinto: { kind: 'phys', ad: 0.5, dot: 'bleed' }, asagao: { kind: 'magic', ap: 0.6 }, kasa: { kind: 'phys', ad: 0.6 },
  bikkuri: { kind: 'phys', ad: 0.6 },
  nawatobi: { kind: 'phys', ad: 0.7 }, rentai: { kind: 'magic', ap: 0.5 }, jintai: { kind: 'phys', ad: 0.8 }, senbazuru: { kind: 'phys', ad: 0.4 },
  cracker: { kind: 'phys', ad: 0.9 }, straw: { kind: 'magic', ap: 0.6 }, miyage: { kind: 'magic', ap: 0.7 }, nezumi: { kind: 'magic', ap: 0.5, dot: 'burn' },
  kora: { kind: 'phys', ad: 0.8 }, reizouko: { kind: 'magic', ap: 0.7 }, sentakuki: { kind: 'impact' }, dunk: { kind: 'impact' },
  kokuban: { kind: 'magic', ap: 0.5 }, jitensha: { kind: 'impact' }, denjishaku: { kind: 'impact' }, honnoame: { kind: 'phys', ad: 0.6 }, fuusen: { kind: 'impact' },
  shutter: { kind: 'impact' }, pingpong: { kind: 'phys', ad: 0.5 }, karaoke: { kind: 'magic', ap: 0.7 }, shoot: { kind: 'impact' }, photo: { kind: 'magic', ap: 0.4 },
  piano: { kind: 'magic', ap: 0.8 }, forklift: { kind: 'impact' }, lockers: { kind: 'phys', ad: 0.7 }, merrygo: { kind: 'impact' },
  gascyl: { kind: 'magic', ap: 0.9 }, carts: { kind: 'impact' }, seesaw: { kind: 'impact' }, drums: { kind: 'magic', ap: 0.7 }, drone: { kind: 'magic', ap: 0.5 },
};
for (const sk of SKILLS) sk.dmg ??= SKILL_DMG[sk.id];
/** 敵を打ち上げるスキル */
for (const id of ['stomp', 'tornado', 'ufo', 'bubble', 'trampoline', 'swing']) {
  const sk = SKILLS.find((x) => x.id === id);
  if (sk) (sk.tags ??= []).push('launch');
}

export const SKILL_MAP: Record<string, SkillDef> = Object.fromEntries(SKILLS.map((s) => [s.id, s]));

/**
 * コンボ: 2 つのスキルを両方持っていると起きる追加の効果。どれもゲームの中で実際に起きる
 * （スキル側のコードが相手を持っているか確かめる、または相手が作る状態に反応する）。
 * 同じ効果を複数の組み合わせで起こせるときは、id を共有して行を分ける。
 */
export interface ComboDef {
  id: string;
  a: string;
  b: string;
  name: string;
  desc: string;
}

export const COMBOS: ComboDef[] = [
  { id: 'ignite', a: 'bio', b: 'fire', name: '引火', desc: '炎の爆発が毒の霧に触れると、霧が次々に爆発する。' },
  { id: 'ignite', a: 'bio', b: 'randoseru', name: '引火', desc: 'ミサイルの爆発が毒の霧に触れると、霧が次々に爆発する。' },
  { id: 'shock', a: 'thunder', b: 'balloon', name: '感電', desc: 'ぬれた敵に雷が落ちると、近くのぬれた敵すべてに伝わる。' },
  { id: 'shock', a: 'thunder', b: 'milk', name: '感電', desc: '牛乳でぬれた敵に雷が落ちると、近くのぬれた敵すべてに伝わる。' },
  { id: 'icebahn', a: 'blizzard', b: 'milk', name: 'アイスバーン', desc: '牛乳の水たまりが凍る。上を通った敵は凍って、よく滑る。' },
  { id: 'flashfreeze', a: 'blizzard', b: 'balloon', name: '瞬間冷凍', desc: 'ぬれた敵は 2 倍長く凍る。' },
  { id: 'flashfreeze', a: 'blizzard', b: 'milk', name: '瞬間冷凍', desc: '牛乳でぬれた敵は 2 倍長く凍る。' },
  { id: 'icerink', a: 'blizzard', b: 'bowling', name: 'アイスリンク', desc: '凍った敵は床との摩擦がない。ボウリング球に当たると遠くまで滑っていく。' },
  { id: 'slapstick', a: 'banana', b: 'milk', name: 'すべり芸', desc: '牛乳の水たまりの上でバナナを踏んだ敵は、3 倍の勢いで飛ぶ。' },
  { id: 'growslash', a: 'grow', b: 'slashwave', name: '育つ斬撃', desc: '斬撃波の威力も、育った分だけ上がる。' },
  { id: 'growclone', a: 'grow', b: 'clone', name: '分身も育てる', desc: '分身の振りが当たっても、棒の威力が上がる。' },
  { id: 'growboom', a: 'grow', b: 'boomsword', name: '育つ爆発', desc: '爆裂剣の爆発に、育った威力の 30% が乗る。' },
  { id: 'kinjiro', a: 'poltergeist', b: 'statue', name: '金次郎、飛ぶ', desc: '落ちた金次郎像を、ポルターガイストが真っ先に投げつける。' },
  { id: 'gather', a: 'gravity', b: 'fire', name: '一網打尽', desc: '妄想ファイアが、グラビデの渦の中心を狙う。' },
  { id: 'gather', a: 'gravity', b: 'nuke', name: '一網打尽', desc: '理科室の禁薬が、グラビデの渦の中心に落ちる。' },
  { id: 'gather', a: 'gravity', b: 'statue', name: '一網打尽', desc: '金次郎像が、グラビデの渦の中心に落ちる。' },
  { id: 'ignite', a: 'bio', b: 'hanabi', name: '引火', desc: '花火の火の粉が毒の霧に落ちると、霧が次々に爆発する。' },
  { id: 'lure', a: 'alarm', b: 'bowling', name: 'ストライクの準備', desc: 'ボウリング球を、敵が群がっている目覚まし時計へ向けて転がす。' },
  { id: 'pythagora', a: 'alarm', b: 'domino', name: 'ピタゴラ装置', desc: 'ドミノを、敵が群がっている目覚まし時計へ向けて並べる。' },
  { id: 'shock', a: 'thunder', b: 'bubble', name: '感電', desc: 'シャボン玉で包まれた敵はぬれる。雷が近くのぬれた敵すべてに伝わる。' },
  { id: 'broadcast', a: 'megaphone', b: 'chime', name: '校内放送', desc: '下校のチャイムが 1.5 倍遠くまで届く。' },
  { id: 'jumpfest', a: 'trampoline', b: 'stomp', name: '大ジャンプ大会', desc: '地団駄を踏むと、トランポリンに乗っている敵が 2 倍高く跳ねる。' },
  { id: 'dryice', a: 'foam', b: 'blizzard', name: 'ドライアイス', desc: '消火器の泡が凍り、浴びた敵が凍る。' },
  { id: 'shock', a: 'thunder', b: 'foam', name: '感電', desc: '泡でぬれた敵に雷が落ちると、近くのぬれた敵すべてに伝わる。' },
  { id: 'shock', a: 'thunder', b: 'geyser', name: '感電', desc: '水柱でぬれた敵に雷が落ちると、近くのぬれた敵すべてに伝わる。' },
  { id: 'flashfreeze', a: 'blizzard', b: 'geyser', name: '瞬間冷凍', desc: '水柱でぬれた敵は 2 倍長く凍る。' },
];

/** 強化（パッシブ）が、どの性質のスキルに効くか。 */
export const STAT_LINKS: { passive: string; tag: SkillTag; text: string }[] = [
  { passive: 'copy', tag: 'amount', text: '出る数が 1 つ増える' },
  { passive: 'mousou', tag: 'area', text: '効果の範囲が広がる' },
  { passive: 'atsuzoko', tag: 'knock', text: '敵がもっと遠くへ飛ぶ' },
  { passive: 'hayaben', tag: 'swing', text: '振る回数が増えるので、発動も増える' },
  { passive: 'chuuni', tag: 'swing', text: '棒が長いので、当てやすい' },
  { passive: 'kata', tag: 'amount', text: '弾が速く飛び、よく吹き飛ばす' },
];
export const MAX_ACTIVES = 6;
export const MAX_PASSIVES = 6;

// ------------------------------------------------------------------ アイテム
/** アイテムが上げる能力値。cooldown・area・moveSpeed・weaponMass・knockback・power・damageTaken・〜Mul は割合（0.12 で 12%） */
export type ItemStat = 'ad' | 'ap' | 'armorPen' | 'magicPen' | 'physDef' | 'magicDef' | 'crit' | 'critDmg' | 'impactMul' | 'dotMul' | 'slamMul' | 'lifesteal' | 'envResist' | 'coinMul' | 'cooldown' | 'area' | 'moveSpeed' | 'weaponMass' | 'knockback' | 'skillMul' | 'apMul' | 'power' | 'damageTaken' | 'amount' | 'maxHp' | 'regen' | 'attackSpeed' | 'luck' | 'weaponMul' | 'xpGain';

export interface ItemDef {
  id: string;
  name: string;
  emoji: string;
  rarity: Rarity;
  desc: string;
  stats?: Partial<Record<ItemStat, number>>;
  /** 引き換えの短所（★や部活の掛け持ちでは大きくならない） */
  cost?: Partial<Record<ItemStat, number>>;
  /** false なら★を上げられない（効果が「ある・なし」だけのもの） */
  star?: false;
  /** 相性のよいスキル（図鑑とアイテム選びに出す）。kinds: ダメージの種類 / tags: スキルの性質 / dot: 継続ダメージを与えるもの */
  link?: { kinds?: DmgKind[]; tags?: SkillTag[]; dot?: boolean; text: string };
  /** 効く範囲（カードに印を出す） */
  scope?: Scope[];
}

export const ITEM_SLOTS = 6;

export const ITEMS: ItemDef[] = [
  // ---- 物理
  { id: 'nailbat', name: '釘バット', emoji: '🔨', rarity: 'common', desc: 'AD +15（【棒の攻撃】と【スキルの攻撃】が強くなる）。【棒の攻撃】が当たった敵は出血する（3 秒で AD の 60% の物理ダメージ）。', stats: { ad: 15 }, link: { kinds: ['phys'], text: 'AD で物理スキルも伸びる' }, scope: ['weapon', 'skill'] },
  { id: 'setsquare', name: '三角定規の刃', emoji: '📐', rarity: 'rare', desc: '物理防御を 35% 貫通する。【すべての攻撃】のうち、物理と衝撃のダメージに効く（出血にも効く）。重装の敵や戦車に。', stats: { armorPen: 0.35 }, link: { kinds: ['phys'], text: '物理の攻撃が防御を貫く' }, scope: ['all'] },
  { id: 'darts', name: 'ダーツの矢', emoji: '🎯', rarity: 'common', desc: '会心率 +15%、会心ダメージ +50%。会心は【棒の攻撃】と【スキルの攻撃】（直接当てたものと弾）で出る。爆発では出ない。', stats: { crit: 0.15, critDmg: 0.5 }, link: { kinds: ['phys', 'magic'], text: '会心は、直接当てるスキルと弾で出る' }, scope: ['weapon', 'skill'] },
  { id: 'cutter', name: 'カッターナイフ', emoji: '🗡️', rarity: 'common', desc: 'AD +10。出血している敵へは、【すべての攻撃】のダメージ +30%。', stats: { ad: 10 }, link: { kinds: ['phys'], dot: true, text: '出血させるスキルと組む' }, scope: ['weapon', 'skill', 'all'] },
  // ---- 魔法
  { id: 'sankosho', name: '分厚い参考書', emoji: '📕', rarity: 'common', desc: 'AP +40（【スキルの攻撃】のうち、AP で強くなる魔法スキルが強くなる）。', stats: { ap: 40 }, link: { kinds: ['magic'], text: 'AP で魔法スキルが伸びる' }, scope: ['skill'] },
  { id: 'crystal', name: '占いの水晶玉', emoji: '🔮', rarity: 'rare', desc: 'AP +20。魔法防御を 35% 貫通する（【すべての攻撃】のうち魔法のダメージに効く。燃焼・毒にも効く）。', stats: { ap: 20, magicPen: 0.35 }, link: { kinds: ['magic'], text: '魔法の攻撃が防御を貫く' }, scope: ['skill', 'all'] },
  { id: 'wara', name: '呪いのわら人形', emoji: '🪆', rarity: 'rare', desc: '【すべての攻撃】のうち魔法のダメージを与えた敵は、4 秒間 魔法防御が 30% 下がる。', link: { kinds: ['magic'], text: '魔法を当てるほど、次の魔法が通る' }, scope: ['all'] },
  { id: 'lamp', name: 'アルコールランプ', emoji: '🪔', rarity: 'common', desc: '継続ダメージ（燃焼・毒・出血）+50%。炎の爆発（スキル・ドラム缶・TNT など）に当たった敵は燃える。', stats: { dotMul: 0.5 }, link: { dot: true, text: '継続ダメージを伸ばす' }, scope: ['dot'] },
  // ---- トゥルー
  { id: 'redpen', name: '先生の赤ペン', emoji: '🖊️', rarity: 'epic', desc: '【棒の攻撃】を 3 回当てるごとに、敵の最大 HP の 6%（ボスは 1.5%）のトゥルーダメージ。', link: { kinds: ['phys'], tags: ['swing'], text: '【棒の攻撃】を当てるほど働く' }, scope: ['weapon'] },
  { id: 'tenbin', name: '生徒会の天秤', emoji: '⚖️', rarity: 'rare', desc: '敵の防御が高いほど、【すべての攻撃】のダメージが増える（防御 100 ごとに +25%）。', link: { kinds: ['phys', 'magic'], text: '硬い敵ほど、ダメージが増える' }, scope: ['all'] },
  // ---- 物理演算
  { id: 'getta', name: '鉄下駄', emoji: '🩴', rarity: 'common', desc: '【衝撃】ダメージ（巻き込み・たたきつけ・物・落下） ×1.6。衝撃の種類のスキル（ドッジボールなど）にも効く。', stats: { impactMul: 0.6 }, link: { kinds: ['impact'], tags: ['knock'], text: 'ぶつけるほど強い' }, scope: ['impact'] },
  { id: 'rubber', star: false, name: 'スーパーボールの鞄', emoji: '🎾', rarity: 'rare', desc: '吹き飛んだ敵がよく跳ね返る。壁や敵に何度もぶつかって、【衝撃】ダメージを与え続ける。', link: { kinds: ['impact'], tags: ['knock'], text: '跳ね返って、何度もぶつかる' }, scope: ['impact'] },
  { id: 'gravityband', name: '重力の腕章', emoji: '🪂', rarity: 'rare', desc: '吹き飛んだ敵が地面に落ちたときの落下ダメージ（【衝撃】）が増える。ふだんは 3m を超えた落下から 1m あたり 6。持っていると 1m を超えた落下から 1m あたり 11。', link: { tags: ['launch'], text: '打ち上げるほど痛い' }, scope: ['impact'] },
  { id: 'firecracker', name: '爆竹のポーチ', emoji: '🧨', rarity: 'rare', desc: '吹き飛んだ敵がほかの敵にぶつかると（巻き込み）、小さく爆発する（魔法・AP 反映 60%）。', link: { tags: ['knock'], kinds: ['impact'], text: '巻き込むたびに爆発' }, scope: ['impact'] },
  { id: 'pins', name: 'ボウリングのピン', emoji: '🎳', rarity: 'common', desc: '巻き込み・たたきつけ・物で倒すたびに、2 秒間 【衝撃】ダメージ +15%（最大 +150%）。', link: { kinds: ['impact'], tags: ['knock'], text: '巻き込みを続けるほど強い' }, scope: ['impact'] },
  { id: 'leadbag', name: '鉛入りの通学カバン', emoji: '🎒', rarity: 'common', desc: '棒の重さ +40%（【棒の攻撃】でよく吹き飛ぶ）。【棒の攻撃】と【スキルの攻撃】の吹き飛ばす力 +30%。移動速度 -6%。', stats: { weaponMass: 0.4, knockback: 0.3 }, cost: { moveSpeed: -0.06 }, link: { tags: ['knock'], text: 'よく飛ばす' }, scope: ['weapon', 'skill'] },
  { id: 'kabedon', name: '壁ドンの極意', emoji: '🧱', rarity: 'rare', desc: '敵を壁・建物・地面にたたきつけたダメージ ×2.5（落下ダメージには効かない）。', stats: { slamMul: 1.5 }, link: { tags: ['knock', 'launch'], text: 'たたきつけるほど痛い' }, scope: ['impact'] },
  { id: 'wax', star: false, name: 'ワックス缶', emoji: '🧴', rarity: 'common', desc: '吹き飛んだ敵が床で滑る。遠くまで転がって、【衝撃】ダメージを与え続ける。', link: { tags: ['knock'], kinds: ['impact'], text: '滑って、ぶつかり続ける' }, scope: ['impact'] },
  // ---- 守り
  { id: 'vest', name: '体操服の下の防弾ベスト', emoji: '🦺', rarity: 'common', desc: '物理防御 +40。受ける物理ダメージ（体当たり・弾・鉄骨・地響き）が減る。', stats: { physDef: 40 }, scope: ['guard'] },
  { id: 'omamori', name: '合格祈願のお守り', emoji: '🧿', rarity: 'common', desc: '魔法防御 +40。受ける魔法ダメージ（爆発・花火・避難訓練）が減る。', stats: { magicDef: 40 }, scope: ['guard'] },
  { id: 'helmet', name: '安全ヘルメット', emoji: '⛑️', rarity: 'common', desc: 'ステージの仕掛け（鉄球・鉄骨・車・落石・がれき・看板）から受けるダメージ -60%。', stats: { envResist: 0.6 }, scope: ['guard'] },
  { id: 'thornbag', name: 'トゲトゲのリュック', emoji: '🦔', rarity: 'rare', desc: '物理防御 +20。体当たりしてきた敵に、物理防御の 60% を物理ダメージで返す。', stats: { physDef: 20 }, scope: ['guard'] },
  // ---- そのほか
  { id: 'bloodjuice', name: '謎の赤いジュース', emoji: '🧃', rarity: 'epic', desc: '【すべての攻撃】で与えたダメージの 1.5% だけ HP が回復する（燃焼・毒・出血のダメージも含む）。', stats: { lifesteal: 0.015 }, scope: ['all', 'heal'] },
  { id: 'sandglass', name: '砂時計', emoji: '⏳', rarity: 'common', desc: '攻撃スキルの待ち時間 -12%。', stats: { cooldown: -0.12 }, scope: ['skill'] },
  { id: 'goldshoe', name: '金の上履き', emoji: '👟', rarity: 'common', desc: 'もらえるコイン +60%、移動速度 +6%。', stats: { coinMul: 0.6, moveSpeed: 0.06 }, scope: ['grow', 'move'] },
  { id: 'magnifier', name: '虫眼鏡', emoji: '🔍', rarity: 'common', desc: '攻撃スキルの範囲 +15%。', stats: { area: 0.15 }, link: { tags: ['area'], text: '範囲が広がる' }, scope: ['skill'] },
  // ---- 物理（追加）
  { id: 'noko', name: '工作室のノコギリ', emoji: '🪚', rarity: 'rare', desc: 'AD +12。【すべての攻撃】のうち物理のダメージを与えるたびに、その敵の物理防御 -6%（5 秒、最大 -36%）。', stats: { ad: 12 }, link: { kinds: ['phys'], text: '物理で削るほど、物理が通る' }, scope: ['weapon', 'skill', 'all'] },
  { id: 'senpuki', name: '扇風機の羽根', emoji: '🌀', rarity: 'common', desc: 'AD +8。【棒の攻撃】が当たると、その敵のまわり 2.5m の敵にも 50% の物理ダメージ。', stats: { ad: 8 }, link: { kinds: ['phys'], tags: ['swing'], text: '【棒の攻撃】が広がる' }, scope: ['weapon'] },
  { id: 'piko', name: 'ピコピコハンマー', emoji: '🔨', rarity: 'common', desc: '【棒の攻撃】が当たると 20% の確率で、敵を 1.2 秒 気絶させる（ボスは 0.3 秒）。', link: { tags: ['swing'], text: '【棒の攻撃】を当てるほど働く' }, scope: ['weapon'] },
  { id: 'taigaku', name: '退学届', emoji: '📄', rarity: 'epic', desc: '【すべての攻撃】で体力が 12% を切った敵（ボス以外）は、その場で倒れる。', link: { kinds: ['phys', 'magic', 'impact'], text: 'とどめが早くなる' }, scope: ['all'] },
  { id: 'protein', name: 'プロテイン', emoji: '🥤', rarity: 'rare', desc: 'エリートを倒すたびに AD +1・最大 HP +3（ボスなら 10 倍）。AD は【棒の攻撃】と【スキルの攻撃】を強くする。この登校のあいだ、ずっと残る。', link: { kinds: ['phys'], text: '倒すほど育つ' }, scope: ['weapon', 'skill'] },
  // ---- 魔法（追加）
  { id: 'kakuboushi', name: '卒業式の角帽', emoji: '🎓', rarity: 'epic', desc: 'AP +25。さらに AP を 30% 増やす（【スキルの攻撃】のうち、魔法スキルが強くなる）。', stats: { ap: 25, apMul: 0.3 }, link: { kinds: ['magic'], text: 'AP を大きく伸ばす' }, scope: ['skill'] },
  { id: 'burner', name: 'ガスバーナー', emoji: '🕯️', rarity: 'rare', desc: '【すべての攻撃】のうち魔法のダメージを与えた敵は 3 秒燃える（毎秒、最大 HP の 1%。ボスは 0.25%）。', link: { kinds: ['magic'], dot: true, text: '硬くて体力の多い敵に効く' }, scope: ['all', 'dot'] },
  { id: 'cassette', name: 'カセットテープ', emoji: '📼', rarity: 'epic', desc: '攻撃スキルが 20% の確率で、0.3 秒後にもう一度発動する（出しっぱなしのスキルは除く）。', link: { kinds: ['phys', 'magic', 'impact'], text: 'どのスキルも 2 回出ることがある' }, scope: ['skill'] },
  { id: 'kakigori', name: 'かき氷シロップ', emoji: '🍧', rarity: 'common', desc: 'AP +15。【すべての攻撃】のうち魔法のダメージを与えた敵は、1.5 秒間 35% 遅くなる。', stats: { ap: 15 }, link: { kinds: ['magic'], text: '魔法で足止め' }, scope: ['skill', 'all'] },
  { id: 'techo', name: '優等生の手帳', emoji: '📒', rarity: 'rare', desc: '敵を 30 体倒すごとに AP +2（上限 +120）。AP は【スキルの攻撃】のうち魔法スキルを強くする。この登校のあいだ、ずっと残る。', link: { kinds: ['magic'], text: '倒すほど育つ' }, scope: ['skill'] },
  { id: 'shitajiki', name: '静電気の下敷き', emoji: '⚡', rarity: 'rare', desc: '【棒の攻撃】と【スキルの攻撃】（直接当てたものと弾）が当たるたびに電気がたまり、20 回で近くの敵 6 体へ雷が伝わる（魔法、30 + AP の 40%）。ぬれた敵には 1.5 倍。', link: { kinds: ['phys', 'magic'], text: '当てる回数が多いほど働く' }, scope: ['weapon', 'skill'] },
  // ---- スキルを変えるもの（PoE のサポートジェム風）
  { id: 'suisen', star: false, name: '校長の推薦状', emoji: '📜', rarity: 'epic', desc: '進化に必要な強化を持っていなくても、最大レベルの攻撃スキルを進化できる。', scope: ['grow'] },
  { id: 'battery', name: 'モバイルバッテリー', emoji: '🔋', rarity: 'rare', desc: '30 秒ごとに、攻撃スキルの待ち時間がすぐ終わる。', scope: ['skill'] },
  { id: 'lupe', name: '集光ルーペ', emoji: '🔎', rarity: 'rare', desc: '【スキルの攻撃】のダメージ +35%。かわりに攻撃スキルの範囲 -25%。', stats: { skillMul: 0.35 }, cost: { area: -0.25 }, link: { tags: ['area'], text: '狭く強く' }, scope: ['skill'] },
  { id: 'kushi', name: '団子の串', emoji: '🍡', rarity: 'common', desc: '弾（スキルの弾）が、敵を 2 体多く貫通する。', link: { tags: ['amount'], text: '弾が貫通する' }, scope: ['skill'] },
  { id: 'fork', star: false, name: '給食のフォーク', emoji: '🍴', rarity: 'rare', desc: '弾（スキルの弾と、打ち返した弾）が初めて敵に当たったとき、左右の 2 本に分かれる。', link: { tags: ['amount'], text: '弾が分かれる' }, scope: ['skill'] },
  { id: 'clip', star: false, name: 'クリップの鎖', emoji: '📎', rarity: 'rare', desc: '弾（スキルの弾と、打ち返した弾）が消える前に、近くの別の敵へ 1 回跳ね返る。', link: { tags: ['amount'], text: '弾が跳ね返る' }, scope: ['skill'] },
  { id: 'hakogai', name: '業務用の箱買い', emoji: '🛒', rarity: 'rare', desc: '攻撃スキルの出る数 +2（弾・設置物・ネコなど）。かわりに【スキルの攻撃】のダメージ -25%。', stats: { amount: 2 }, cost: { skillMul: -0.25 }, link: { tags: ['amount'], text: '数で押す' }, scope: ['skill'] },
  { id: 'renkin', star: false, name: '錬金術の本', emoji: '📗', rarity: 'rare', desc: '【すべての攻撃】の物理ダメージが、すべて魔法ダメージになる（【棒の攻撃】も魔法になる。伸びは AD のまま）。物理防御の高い敵に。', link: { kinds: ['phys'], text: '物理スキルが魔法防御で計算される' }, scope: ['all'] },
  { id: 'kinniku', star: false, name: '筋肉で解決', emoji: '🥋', rarity: 'rare', desc: '【すべての攻撃】の魔法ダメージが、すべて物理ダメージになる（伸びは AP のまま）。魔法防御の高い敵に。', link: { kinds: ['magic'], text: '魔法スキルが物理防御で計算される' }, scope: ['all'] },
  { id: 'zerokyori', name: 'ゼロ距離', emoji: '🥊', rarity: 'common', desc: 'ノリコの近くの敵ほど、【すべての攻撃】のダメージが増える（4m 以内で +40%。12m より遠いと -20%）。', scope: ['all'] },
  { id: 'hachimaki', name: '背水の鉢巻き', emoji: '🎌', rarity: 'rare', desc: '【棒の攻撃】と【スキルの攻撃】のダメージ +40%。かわりに受けるダメージ +40%。', stats: { power: 0.4 }, cost: { damageTaken: 0.4 }, scope: ['weapon', 'skill'] },
  { id: 'note', name: '几帳面なノート', emoji: '📓', rarity: 'rare', desc: '会心が出なくなる。かわりに【棒の攻撃】と【スキルの攻撃】のダメージ +30%。', stats: { power: 0.3 }, scope: ['weapon', 'skill'] },
  // ---- 物理演算（追加）
  { id: 'chanko', name: 'ちゃんこ鍋', emoji: '🍲', rarity: 'rare', desc: '巻き込まれた敵も勢いが落ちにくく、次の敵を強く押す。巻き込みの連鎖が長く続く。', link: { kinds: ['impact'], tags: ['knock'], text: '巻き込みが長く続く' }, scope: ['impact'] },
  { id: 'kusudama', name: '文化祭のくす玉', emoji: '🎊', rarity: 'rare', desc: '巻き込み・たたきつけ・物で倒した敵が破裂する（魔法・AP 反映 60%、半径 2.5m）。', link: { tags: ['knock', 'launch'], kinds: ['impact'], text: '倒すたびに破裂' }, scope: ['impact'] },
  { id: 'sensu', name: '日本舞踊の扇子', emoji: '🪭', rarity: 'rare', desc: '8 秒ごとに、近くのいちばん大きな群れを竜巻で打ち上げる（落ちたときに落下ダメージ。ボスは打ち上がらない）。', link: { tags: ['launch'], text: '打ち上げる回数が増える' }, scope: ['impact'] },
  { id: 'hopping', name: 'ホッピング', emoji: '🦘', rarity: 'common', desc: 'ジャンプ +35%。着地したとき、落ちた高さに応じて、まわりの敵を吹き飛ばす（【衝撃】）。', link: { kinds: ['impact'], text: '高い所から飛び降りるほど強い' }, scope: ['move', 'impact'] },
  // ---- 守り（追加）
  { id: 'kairo', name: '使い捨てカイロ', emoji: '🧤', rarity: 'common', desc: '物理防御 +15、魔法防御 +15。まわり 3.5m の敵に毎秒、魔法ダメージ（8 + 物理防御と魔法防御の合計の 12%）。', stats: { physDef: 15, magicDef: 15 }, scope: ['guard'] },
  { id: 'bento', name: '母の手作り弁当', emoji: '🍙', rarity: 'rare', desc: '最大 HP +80。4 秒間ダメージを受けないと、毎秒 最大 HP の 2% 回復する。', stats: { maxHp: 80 }, scope: ['heal'] },
  { id: 'shindansho', name: '仮病の診断書', emoji: '🩺', rarity: 'epic', desc: 'HP が 25% を切ると、2.5 秒間 無敵になり、まわりを吹き飛ばして魔法ダメージを与える（60 秒に 1 回）。', scope: ['guard'] },
  { id: 'whistle', name: '体育教師の笛', emoji: '📯', rarity: 'common', desc: '魔法防御 +20。6 秒ごとに、冷たい波がまわり 7m へ広がる（魔法ダメージ、遅くする。広さは攻撃スキルの範囲で増える）。', stats: { magicDef: 20 }, scope: ['guard'] },
  // ---- 第 2 弾: 武器で殴ると働くもの（LoL・Dota の「当たったときの効果」）
  { id: 'horeizai', name: '保冷剤', emoji: '🧊', rarity: 'rare', desc: '物理防御 +10。【棒の攻撃】で同じ敵を 4 回殴ると、1 秒 凍らせる（ボスは少しひるむ）。', stats: { physDef: 10 }, link: { tags: ['swing'], text: '【棒の攻撃】を当てるほど働く' }, scope: ['weapon', 'guard'] },
  { id: 'sanshoku', name: '三色ボールペン', emoji: '🖊️', rarity: 'epic', desc: '攻撃スキルが発動したあと、次の【棒の攻撃】に AD の 100% の物理ダメージを追加する（1.5 秒に 1 回）。', link: { kinds: ['phys'], tags: ['swing'], text: 'スキルと【棒の攻撃】を交互に' }, scope: ['weapon'] },
  { id: 'hotchkiss', name: '三連ホチキス', emoji: '🗜️', rarity: 'common', desc: '【棒の攻撃】が当たると、近くの別の敵 2 体へ針が飛ぶ（AD の 40% の物理ダメージ）。', link: { kinds: ['phys'], tags: ['swing'], text: '【棒の攻撃】が広がる' }, scope: ['weapon'] },
  { id: 'sokudoku', name: '速読の教本', emoji: '📕', rarity: 'rare', desc: '【棒の攻撃】が当たるたびに、攻撃スキルの待ち時間が 0.15 秒 進む。', link: { tags: ['swing'], text: '棒で殴るほどスキルが回る' }, scope: ['weapon', 'skill'] },
  { id: 'katatataki', name: '肩たたき券', emoji: '🎫', rarity: 'rare', desc: '同じ敵に【棒の攻撃】を 3 回当てるごとに、トゥルーダメージ（20 + AD の 25%）を追加する。', link: { kinds: ['true'], tags: ['swing'], text: '硬い敵にも通る' }, scope: ['weapon'] },
  { id: 'stick', name: 'おもちゃのステッキ', emoji: '🌟', rarity: 'rare', desc: 'AP +20。【棒の攻撃】が当たると、魔法ダメージ（15 + AP の 20%）を追加する。', stats: { ap: 20 }, link: { kinds: ['magic'], tags: ['swing'], text: 'AP で【棒の攻撃】も強くなる' }, scope: ['weapon'] },
  { id: 'tsukimi', name: '月見団子', emoji: '🌕', rarity: 'common', desc: '棒を振る速さ +20%（【棒の攻撃】が速くなる）。', stats: { attackSpeed: 0.2 }, link: { tags: ['swing'], text: '振る回数が増える' }, scope: ['weapon'] },
  // ---- 倒すと働くもの
  { id: 'midas', name: '金のシャーペン', emoji: '✒️', rarity: 'rare', desc: '25 秒ごとに、次に倒した敵の経験値が 3 倍になり、コインを 3 枚落とす。', scope: ['grow'] },
  { id: 'kaminari', name: '雷おこし', emoji: '🍘', rarity: 'rare', desc: 'ぬれた敵か凍った敵を倒すと、雷が近くの 4 体へ伝わる（魔法、25 + AP の 60%）。', link: { kinds: ['magic'], text: 'ぬらす・凍らせるスキルと組む' }, scope: ['skill'] },
  { id: 'gakuran', name: '番長の学ラン', emoji: '🧥', rarity: 'epic', desc: 'エリートを倒すと、その力を 20 秒もらう（頑丈: 受けるダメージ -25% ／ 俊足: 移動速度と振る速さ +25% ／ 爆弾持ち: 【棒の攻撃】が当たると爆発）。', scope: ['weapon', 'guard', 'move'] },
  { id: 'trophy', name: '優勝トロフィー', emoji: '🏆', rarity: 'epic', desc: 'エリートを倒すと 1、ボスを倒すと 5 たまる。1 つにつき、【すべての攻撃】のダメージ +2%（最大 25）。', scope: ['all'] },
  // ---- スキルを発動させるもの（PoE の「〜したときに発動」）
  { id: 'hirameki', name: 'ひらめきメモ', emoji: '💡', rarity: 'epic', desc: '【棒の攻撃】と【スキルの攻撃】で会心が出ると 25% の確率で、持っている攻撃スキルを 1 つ、すぐに発動する（2 秒に 1 回まで）。', link: { kinds: ['phys', 'magic'], text: '会心率を上げると働く' }, scope: ['weapon', 'skill'] },
  { id: 'omajinai', name: 'おまじないのシール', emoji: '🌈', rarity: 'rare', desc: 'ダメージを合計 50 受けるたびに、持っている攻撃スキルを 1 つ、すぐに発動する。', scope: ['skill'] },
  // ---- まわりの敵に効くもの
  { id: 'fuuki', name: '風紀委員のバッジ', emoji: '📛', rarity: 'rare', desc: '物理防御 +15。まわり 6m の敵は、物理防御が 25% 下がる（物理と衝撃のダメージが通りやすくなる）。', stats: { physDef: 15 }, link: { kinds: ['phys'], text: '近くの敵が柔らかくなる' }, scope: ['guard', 'all'] },
  { id: 'kageguchi', name: '陰口', emoji: '🤫', rarity: 'rare', desc: 'まわり 7m の敵は、【すべての攻撃】から受けるダメージ +15%。', scope: ['all'] },
  // ---- 守り（第 2 弾）
  { id: 'bansoko', name: '絆創膏', emoji: '🩹', rarity: 'common', desc: '回復する量 +30%（毎秒の回復は除く）。HP が毎秒 0.5 回復する。', stats: { regen: 0.5 }, scope: ['heal'] },
  { id: 'zukin', name: '防災ずきん', emoji: '⛑️', rarity: 'rare', desc: 'ステージの仕掛けから受けるダメージ -20%。HP が 35% を切ると、最大 HP の 35% のシールドを 6 秒 張る（60 秒に 1 回）。', stats: { envResist: 0.2 }, scope: ['guard'] },
  { id: 'nisshi', name: '学級日誌', emoji: '📔', rarity: 'rare', desc: '物理防御 +10、魔法防御 +10。最大 HP の 10% を超える一撃は、超えた分が 50% 減る。', stats: { physDef: 10, magicDef: 10 }, scope: ['guard'] },
  { id: 'roller', name: 'ローラースケート', emoji: '🛼', rarity: 'rare', desc: '移動速度 +6%。ダッシュすると、前へ 5 本の魔法の矢を放つ（20 + AP の 50%）。', stats: { moveSpeed: 0.06 }, link: { kinds: ['magic'], text: 'ダッシュが攻撃になる' }, scope: ['move'] },
  { id: 'chirashi', name: 'スーパーの特売チラシ', emoji: '📰', rarity: 'rare', desc: '14 秒ごとに、ショッピングカートがいちばん大きな敵の群れへ突っ込む（【衝撃】）。', link: { kinds: ['impact'], text: '物理演算でひいていく' }, scope: ['impact'] },
  // ---- 第 3 弾（LoL・Dota・PoE のアイテムを学校風に）
  { id: 'tekagami', name: '手鏡', emoji: '🪞', rarity: 'rare', desc: 'ダメージを受けると 4 秒間、受けたダメージの 2 倍を、まわり 3.5m の敵へ返す（トゥルー。20 秒に 1 回）。', scope: ['guard'] },
  { id: 'akaten', name: '赤点の答案', emoji: '📉', rarity: 'rare', desc: '【棒の攻撃】と【スキルの攻撃】で会心を出した敵に「赤点」を付ける。赤点の敵は 4 秒間、【すべての攻撃】から受けるダメージ +25%。', link: { kinds: ['phys', 'magic'], text: '会心率を上げると働く' }, scope: ['all'] },
  { id: 'fuurin', name: '風鈴の守り', emoji: '🎐', rarity: 'rare', desc: '15 秒ごとに、次に受けるダメージを 1 回だけ防ぐ。', scope: ['guard'] },
  { id: 'controller', name: 'ゲームのコントローラー', emoji: '🎮', rarity: 'epic', desc: '【棒の攻撃】が当たるたびに 3 秒間、振る速さ +5%（最大 8 回）。8 回たまると、【棒の攻撃】に AD の 30% の魔法ダメージが加わる。', link: { tags: ['swing'], text: '棒で殴り続けるほど速くなる' }, scope: ['weapon'] },
  { id: 'kaban', name: '重い学生カバン', emoji: '💼', rarity: 'rare', desc: '最大 HP +80。【棒の攻撃】が当たると、最大 HP の 2.5% の物理ダメージを追加する。', stats: { maxHp: 80 }, link: { tags: ['swing'], text: 'HP で【棒の攻撃】が強くなる' }, scope: ['weapon'] },
  { id: 'katsudon', name: '勝負かつ丼', emoji: '🥘', rarity: 'common', desc: '最大 HP +200。かわりに移動速度 -5%。', stats: { maxHp: 200 }, cost: { moveSpeed: -0.05 }, scope: ['guard'] },
  { id: 'energy', name: 'エナジードリンク', emoji: '🥫', rarity: 'rare', desc: '攻撃スキルの待ち時間 -12%。スキルが直接当てたダメージ（爆発と物は除く）の 3% だけ HP が回復する。', stats: { cooldown: -0.12 }, scope: ['skill', 'heal'] },
  { id: 'sougankyo', name: '双眼鏡', emoji: '🔭', rarity: 'rare', desc: '弾（スキルの弾と、打ち返した弾）が遠くまで飛ぶほど強くなる（20m で +40%）。', link: { tags: ['amount'], text: '遠くの敵を撃つほど強い' }, scope: ['skill'] },
  { id: 'gyunyu', name: '賞味期限切れの牛乳', emoji: '🧃', rarity: 'common', desc: '【棒の攻撃】と【スキルの攻撃】（直接当てたものと弾）が当たると 20% の確率で、敵が 3 秒 毒になる（毎秒 5 + AP の 10%）。毒の敵へは、【すべての攻撃】のダメージ +10%。', link: { dot: true, text: '毒のスキルと組む' }, scope: ['all', 'dot'] },
  { id: 'ouendan', name: '応援団の旗', emoji: '🚩', rarity: 'rare', desc: '【棒の攻撃】が当たるたびに守りが 1 たまる（最大 20、4 秒で消える）。1 つにつき、受けるダメージ -1%。', link: { tags: ['swing'], text: '棒で殴りながら守る' }, scope: ['weapon', 'guard'] },
  { id: 'sunglasses', name: 'サングラス', emoji: '🕶️', rarity: 'rare', desc: '物理防御の貫通 +15%。体力の多い敵ほど、【すべての攻撃】のダメージが増える（最大 +20%。ボスはさらに +10%）。', stats: { armorPen: 0.15 }, link: { kinds: ['phys'], text: '硬くて大きい敵に' }, scope: ['all'] },
  { id: 'dice', name: '幸運のサイコロ', emoji: '🎲', rarity: 'common', desc: '運 +25%（珍しいスキルや回復アイテムが出やすく、宝箱の中身も増えやすい。運が 45% 以上なら、レベルアップの選択肢 +1）。', stats: { luck: 0.25 }, scope: ['grow'] },
  { id: 'glove', name: 'ボクシンググローブ', emoji: '🥊', rarity: 'common', desc: '【棒の攻撃】のダメージ +20%。', stats: { weaponMul: 0.2 }, scope: ['weapon'], link: { tags: ['swing'], text: '棒で殴るほど強くなるスキルと相性がよい' } },
  { id: 'bell', name: '自転車のベル', emoji: '🔔', rarity: 'rare', desc: '【棒の攻撃】を 6 回当てるごとに、ノリコのまわり 3.5m の敵へ衝撃波（衝撃ダメージ 25 + AD の 30%）。敵は 0.5 秒気絶する。', scope: ['weapon'] },
  { id: 'shiomusubi', name: '塩むすび', emoji: '🍙', rarity: 'common', desc: '【棒の攻撃】で敵を倒すたびに、HP が 1.5 回復する。', scope: ['weapon', 'heal'] },
  { id: 'kandenchi', name: '予備の乾電池', emoji: '🔋', rarity: 'common', desc: '【スキルの攻撃】のダメージ +15%。', stats: { skillMul: 0.15 }, scope: ['skill'] },
  { id: 'antenna', name: '放送部のアンテナ', emoji: '📡', rarity: 'common', desc: '攻撃スキルの範囲 +15%（【スキルの攻撃】の当たる広さ）。', stats: { area: 0.15 }, scope: ['skill'] },
  { id: 'litmus', name: 'リトマス試験紙', emoji: '🧪', rarity: 'rare', desc: '【スキルの攻撃】が当たった敵は、4 秒間 魔法防御が 20% 下がる。', scope: ['skill'], link: { kinds: ['magic'], text: '魔法ダメージのスキルが通りやすくなる' } },
  { id: 'ramune', name: 'ラムネ菓子', emoji: '🍬', rarity: 'common', desc: '【すべての攻撃】のダメージ +8%。移動速度 +5%。', stats: { moveSpeed: 0.05 }, scope: ['all', 'move'] },
  { id: 'ikari', name: '怒りマーク', emoji: '💢', rarity: 'rare', desc: 'HP が 50% 以下のとき、【すべての攻撃】のダメージ +30%。', scope: ['all'] },
  { id: 'sori', name: '雪遊びのソリ', emoji: '🛷', rarity: 'common', desc: '【衝撃】ダメージ（巻き込み・たたきつけ・物・落下） +25%。吹き飛んだ敵がよく滑る。', stats: { impactMul: 0.25 }, scope: ['impact'], link: { tags: ['knock', 'launch'], text: '吹き飛ばすスキルと相性がよい' } },
  { id: 'jersey', name: '学校指定ジャージ', emoji: '🧥', rarity: 'common', desc: '受けるダメージ -10%。移動速度 +4%。', stats: { damageTaken: -0.1, moveSpeed: 0.04 }, scope: ['guard', 'move'] },
  { id: 'suitou', name: '麦茶の水筒', emoji: '🫖', rarity: 'common', desc: '10 秒ごとに、HP が最大 HP の 4% 回復する。', scope: ['heal'] },
  { id: 'seiseki', name: '成績表', emoji: '📈', rarity: 'rare', desc: 'もらえる経験値 +15%。「棒を鍛える」を選ぶと、ときどき（25%）2 段上がる。', stats: { xpGain: 0.15 }, scope: ['grow'] },
  // ---- 成長
  { id: 'aikagi', star: false, name: '職員室の合鍵', emoji: '🗝️', rarity: 'epic', desc: 'レベルアップの選択肢が 1 枚増える（4 枚）。', scope: ['grow'] },
];

export const ITEM_MAP: Record<string, ItemDef> = Object.fromEntries(ITEMS.map((i) => [i.id, i]));

// ------------------------------------------------------------------ 能力値
export interface Stats {
  power: number;
  attackSpeed: number;
  moveSpeed: number;
  maxHp: number;
  regen: number;
  magnet: number;
  area: number;
  cooldown: number;
  crit: number;
  knockback: number;
  xpGain: number;
  /** 【棒の攻撃】のダメージの倍率（部活の朝練・ボクシンググローブ） */
  weaponMul: number;
  amount: number;
  luck: number;
  revive: number;
  weaponLength: number;
  damageTaken: number;
  /** 武器の重さの倍率（吹き飛ばしと建物を壊す力に効く） */
  weaponMass: number;
  /** ダッシュの待ち時間の倍率 */
  dashCooldown: number;
  /** ダッシュでぶつかった敵を弾く強さ（0 なら弾かない） */
  dashBump: number;
  /** 敵を 12 体倒すごとに回復する量 */
  killHeal: number;
  /** 体当たりしてきた敵に返すダメージ */
  thorns: number;
  /** 追加の AD（物理攻撃力。武器の威力に足す）と AP（魔法攻撃力） */
  ad: number;
  ap: number;
  /** 物理防御・魔法防御の貫通（0..1、割合） */
  armorPen: number;
  magicPen: number;
  /** ノリコの物理防御・魔法防御 */
  physDef: number;
  magicDef: number;
  /** 会心のときのダメージ倍率 */
  critDmg: number;
  /** 衝撃・継続・たたきつけダメージの倍率 */
  impactMul: number;
  dotMul: number;
  slamMul: number;
  /** 与えたダメージのうち回復する割合 */
  lifesteal: number;
  /** ステージの仕掛け（鉄球・鉄骨・車など）から受けるダメージの軽減（0..1） */
  envResist: number;
  coinMul: number;
  /** スキルだけの威力の倍率（武器には効かない） */
  skillMul: number;
  /** AP の倍率 */
  apMul: number;
  /** 飛び道具の速さと、飛び道具の吹き飛ばしの倍率（ソフトボール部の肩） */
  projSpeed: number;
  projKnock: number;
  /** エリートとボスへのダメージの倍率（番狂わせ） */
  bigMul: number;
  /** 敵を倒したときの、振る速さと移動速度の上がり幅（1 回あたり。ノリノリ） */
  momentum: number;
  /** とどめで余ったダメージを近くの敵へ与える割合（八つ当たり） */
  overkill: number;
  /** ダッシュを続けて使える回数と、ダッシュの速さの倍率（韋駄天） */
  dashCharges: number;
  dashSpeed: number;
  /** 経験値の玉 1 つで回復する HP（早寝早起き） */
  xpHeal: number;
  /** HP が 80% 以上のときの、与えるダメージの上がり幅（絶好調） */
  fullHp: number;
}

export interface ShopItem {
  id: keyof ShopLevels;
  name: string;
  emoji: string;
  desc: string;
  max: number;
  cost: (level: number) => number;
}

export interface ShopLevels {
  hp: number;
  power: number;
  speed: number;
  xp: number;
  reroll: number;
  magnet: number;
  revive: number;
}

export const SHOP: ShopItem[] = [
  { id: 'hp', name: '朝ごはん', emoji: '🍙', desc: '最大 HP +10', max: 5, cost: (l) => 40 + l * 40 },
  { id: 'power', name: '素振り', emoji: '🏋️', desc: '威力 +5%', max: 5, cost: (l) => 60 + l * 60 },
  { id: 'speed', name: '登校ダッシュ', emoji: '🚲', desc: '移動速度 +3%', max: 5, cost: (l) => 50 + l * 50 },
  { id: 'xp', name: '予習', emoji: '📚', desc: '経験値 +5%', max: 5, cost: (l) => 60 + l * 60 },
  { id: 'reroll', name: '選び直し', emoji: '🎲', desc: 'レベルアップの選び直し回数 +1', max: 5, cost: (l) => 80 + l * 80 },
  { id: 'magnet', name: '落とし物係', emoji: '🧺', desc: '拾える範囲 +10%', max: 3, cost: (l) => 70 + l * 70 },
  { id: 'revive', name: '替えの制服', emoji: '👔', desc: '1 度だけ復活できる', max: 1, cost: () => 600 },
];

// ------------------------------------------------------------------ 難易度
export type DifficultyId = 'normal' | 'hard' | 'oni';

export interface DifficultyDef {
  id: DifficultyId;
  name: string;
  emoji: string;
  desc: string;
  /** 敵の体力・攻撃力・出る数・速さ・ボスの体力・エリートの出やすさ・もらえるコインの倍率 */
  hp: number;
  dmg: number;
  spawn: number;
  speed: number;
  bossHp: number;
  elite: number;
  coins: number;
  /** 選べるようになる条件（無ければ最初から） */
  unlock?: { stat: StatKey; gte: number; text: string };
}

export const DIFFICULTIES: DifficultyDef[] = [
  { id: 'normal', name: 'ふつう', emoji: '🙂', desc: '後半は敵が硬く、痛くなる。ボスも本気を出す。', hp: 1, dmg: 1, spawn: 1, speed: 1, bossHp: 1, elite: 1, coins: 1 },
  { id: 'hard', name: 'むずかしい', emoji: '😤', desc: '敵が硬くて痛い。数も多い。コイン 1.5 倍。', hp: 1.6, dmg: 1.45, spawn: 1.3, speed: 1.08, bossHp: 1.7, elite: 1.7, coins: 1.5, unlock: { stat: 'clears', gte: 1, text: '1 回クリアする' } },
  { id: 'oni', name: '鬼の補習', emoji: '👹', desc: 'すべてが限界。エリートだらけ。コイン 2.2 倍。', hp: 2.5, dmg: 2.0, spawn: 1.6, speed: 1.15, bossHp: 2.8, elite: 2.6, coins: 2.2, unlock: { stat: 'hardClears', gte: 1, text: '「むずかしい」でクリアする' } },
];

export function difficultyUnlocked(d: DifficultyDef, stats: Record<StatKey, number>): boolean {
  return !d.unlock || (stats[d.unlock.stat] ?? 0) >= d.unlock.gte;
}

// ------------------------------------------------------------------ ステージ
export type StageId = 'yard' | 'campus' | 'park' | 'akiba' | 'roof' | 'site' | 'matsuri' | 'hill' | 'quarry' | 'onsen' | 'ski';

export interface StageDef {
  id: StageId;
  name: string;
  emoji: string;
  desc: string;
  /** そのステージだけの仕掛け（選ぶ画面に出す） */
  gimmicks: string[];
}

export const STAGES: StageDef[] = [
  { id: 'yard', name: '校庭', emoji: '🏫', desc: 'いつもの校庭。校舎と体育倉庫がある。', gimmicks: ['校舎は殴って壊せる。崩れたがれきは武器になる', 'ドラム缶は爆発する', '自転車置き場はドミノ倒しになる'] },
  { id: 'campus', name: '校舎の中', emoji: '🚪', desc: '1 階の廊下と教室。机といすが山ほどある。', gimmicks: ['ワックスがけの廊下は、敵もノリコもつるつる滑る', '消火器は叩くと、ロケットのように飛び回る', '理科室の薬品は割れると毒ガスが出る（火で引火する）', '図書室の本棚はドミノ倒しになる', '体育館のロイター板を踏んだ敵は、高く跳ね上がる'] },
  { id: 'park', name: '森林公園', emoji: '🦆', desc: '大きな池のある公園。桜並木と遊具もある。', gimmicks: ['池に吹き飛ばした敵は沈む。池の中では敵もノリコも遅い', '池に入った敵はぬれる（雷がよく伝わり、長く凍る）', '噴水がときどき噴き上がり、上にいる物を打ち上げる', 'シーソーの片側を叩くと、反対側が跳ね上がる', 'スワンボートと丸太は水に浮く'] },
  { id: 'roof', name: '校舎の屋上', emoji: '🌬️', desc: '柵の無い屋上。落ちたら終わり（敵が）。', gimmicks: ['東西の端には柵が無い。吹き飛ばした敵は下へ落ちる', 'ときどき突風が吹き、敵を端へ押し流す（ノリコも少し流される）', '給水塔のタンクを壊すと、水があふれて敵を押し流す', '室外機は重い。ぶつけると痛い'] },
  { id: 'site', name: '工事現場', emoji: '🏗️', desc: '建てかけのビルと、解体用の鉄球。', gimmicks: ['鉄球が地面の赤い線の上を往復し、通り道の敵も壁も砕く（ノリコも当たると痛い）', 'クレーンがときどき鉄骨を落とす。落ちる場所に赤い四角が出る', '積まれた土管は、崩すと転がっていく', '建てかけのビルは、もろくて崩れやすい'] },
  { id: 'matsuri', name: '夏祭りの神社', emoji: '🏮', desc: '夜の境内。屋台と提灯が並ぶ。', gimmicks: ['大太鼓を叩くと音の波が広がり、まわりの敵を吹き飛ばす', 'ときどき盆踊りが始まり、まわりの敵が踊り出して動けなくなる', '花火大会が始まると火の粉が降る。赤い円に入ると熱い（敵も）', '金魚すくいの水槽に入ると、ぬれて遅くなる'] },
  { id: 'hill', name: '学校の裏山', emoji: '⛰️', desc: '段々の丘と崖。高い所と低い所がある。', gimmicks: ['段の境目は崖。吹き飛ばして落とすと、落ちた高さに応じた落下ダメージ', 'らせんの山道を登ってくる敵を、上から狙える', 'ときどき頂上から大岩が転がり落ちてくる（敵もノリコもひく）', '丸太の山や切り倒した木は、崩すと坂を転がり落ちる'] },
  { id: 'quarry', name: '採石場', emoji: '⛏️', desc: '擂り鉢状の深い採掘穴。段々の崖と、底まで降りるらせんの運搬路。', gimmicks: ['穴へ吹き飛ばすと、落ちた高さに応じた落下ダメージ', 'TNT の箱は叩くと爆発する。並んだ箱は連鎖する', 'トロッコは叩くと運搬路を走り下り、敵をひく。ときどき上から暴走トロッコが来る（赤い帯から離れる）', 'ときどき発破がある。赤い円の中は爆発し、岩の柱が崩れて大岩が転がり落ちる'] },
  { id: 'onsen', name: '温泉街', emoji: '♨️', desc: '夕暮れの温泉街。段々の町並みを、石畳の坂道がつらぬく。', gimmicks: ['段の境目は石垣の崖。吹き飛ばして落とすと落下ダメージ。大通りの坂と東西の石段で上り下りできる', '間欠泉がときどき噴き上がる（赤い輪で予告）。上にいる敵もノリコも高く打ち上がる', '上の通りの酒樽は、叩くと坂を転がり落ちる。ときどき上から勝手に転がってくる（ノリコもひかれる）', '露天風呂に入った敵はぬれて、熱いお湯でじわじわ燃える。湯の川と風呂では、敵もノリコも遅くなる'] },
  { id: 'ski', name: '雪山のスキー場', emoji: '🏂', desc: 'ふもとから頂上のロッジまで、高さ 24m の長いゲレンデ。', gimmicks: ['雪面は滑る。坂の下へ吹き飛ばした敵は、遠くまで滑り落ちる', 'ときどき雪崩が起き、頂上から大きな雪玉が転がってくる。赤い帯から離れろ（敵もひかれる）', 'ジャンプ台に滑り込んだ敵は高く飛び、落ちた高さに応じた落下ダメージ。ノリコが乗っても跳べる', '雪だるまを壊すと、中から雪玉が転がり出る。リフトの支柱は倒せる'] },
  { id: 'akiba', name: '秋葉原', emoji: '🗼', desc: '夕方の電気街。高いビルが並ぶ。', gimmicks: ['歩行者天国が終わると、中央通りを車が走り抜ける（敵もノリコもはねる）', 'ガチャガチャを壊すと、カプセルが飛び散る', 'ビルが崩れると、ネオン看板も落ちてくる', '高架を電車が通ると、まわりが揺れる'] },
];

// ------------------------------------------------------------------ 今日の校則
export interface RuleDef {
  id: string;
  name: string;
  desc: string;
}

export const RULES: RuleDef[] = [
  { id: 'normal', name: '平常授業', desc: '特別な決まりはない。' },
  { id: 'lowgrav', name: '体育館の床がトランポリン', desc: '重力が半分。敵も物もよく飛ぶ。' },
  { id: 'fast', name: '遅刻厳禁', desc: '敵が 25% 速い。経験値は 1.5 倍。' },
  { id: 'boom', name: '火気厳禁（守られていない）', desc: '爆発の範囲が 1.6 倍。ドラム缶が 3 倍置かれる。' },
  { id: 'giant', name: '給食の食べすぎ', desc: '敵が大きくて硬い。数は少ない。経験値は多い。' },
  { id: 'mini', name: '全校集会', desc: '敵が小さくて弱い。数は 1.6 倍。' },
  { id: 'glass', name: 'ガラスのハート', desc: '与えるダメージも、受けるダメージも 2 倍。' },
  { id: 'clutter', name: '大掃除の日', desc: '机・椅子・段ボールが 3 倍置かれる。' },
  { id: 'rich', name: '購買部セール', desc: 'コインが 2 倍落ちる。回復アイテムは落ちない。' },
  { id: 'slippery', name: 'ワックスがけ直後', desc: '敵がよく滑る。吹き飛ばす力 1.5 倍。' },
];

export interface RuleEffect {
  gravity: number;
  enemySpeed: number;
  enemyHp: number;
  enemyScale: number;
  spawn: number;
  xp: number;
  explosion: number;
  barrels: number;
  clutter: number;
  dealt: number;
  taken: number;
  coins: number;
  heals: number;
  knock: number;
  friction: number;
}

export function ruleEffect(id: string): RuleEffect {
  const e: RuleEffect = { gravity: 1, enemySpeed: 1, enemyHp: 1, enemyScale: 1, spawn: 1, xp: 1, explosion: 1, barrels: 1, clutter: 1, dealt: 1, taken: 1, coins: 1, heals: 1, knock: 1, friction: 1 };
  switch (id) {
    case 'lowgrav': e.gravity = 0.5; break;
    case 'fast': e.enemySpeed = 1.25; e.xp = 1.5; break;
    case 'boom': e.explosion = 1.6; e.barrels = 3; break;
    case 'giant': e.enemyScale = 1.45; e.enemyHp = 2.4; e.spawn = 0.5; e.xp = 2.4; break;
    case 'mini': e.enemyScale = 0.7; e.enemyHp = 0.55; e.spawn = 1.6; e.xp = 0.7; break;
    case 'glass': e.dealt = 2; e.taken = 2; break;
    case 'clutter': e.clutter = 3; break;
    case 'rich': e.coins = 2; e.heals = 0; break;
    case 'slippery': e.friction = 0.15; e.knock = 1.5; break;
  }
  return e;
}
