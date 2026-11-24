/**
 * USDCraft の物体（u_*）を各ステージへ置く。ステージを作り終えたあとに world から 1 回呼ぶ。
 * 校舎の中は部屋に合わせて手で置き、ほかのステージは空き地を探して散らす。
 */
import type { StageId } from '../defs';
import { log } from '../../log';
import type { WorldMap } from '../world';

type Rng = () => number;

/** 手で置く物: [id, x, z, 向き] */
type Fixed = [string, number, number, number];
/** 散らす物: [id, 数, 中心からの最小・最大の距離] */
type Scatter = [string, number, number?, number?];

const S = { sleep: true };
const PI = Math.PI;

const FIXED: Partial<Record<StageId, Fixed[]>> = {
  campus: [
    // 音楽室: ドラムセットとアップライトピアノ
    ['u_drums', -10.5, -11, PI * 1.25],
    ['u_piano', -35.4, -24, PI / 2],
    // 教室の後ろのロッカー
    ...[30, 30.9, 31.8, 32.7].map((z): Fixed => ['u_locker', -38.5, z, -PI / 2]),
    ...[30, 30.9, 31.8, 32.7].map((z): Fixed => ['u_locker', -35.5, z, PI / 2]),
    ...[-20, -19.1, -18.2, -17.3].map((x): Fixed => ['u_locker', x, -67.5, 0]),
    // 図書室のブックカート（叩くと転がる）
    ['u_bookcart', -46, 50, 0],
    ['u_bookcart', -46, 62, PI / 2],
    // 体育館: 卓球台、壇上の教卓とトロフィー
    ['u_pingpong', 33.5, 39.5, 0],
    ['u_pingpong', 60, 25, PI / 2],
    ['u_lectern', 37.5, 64, PI],
    ['u_trophy', 41, 64.5, PI],
    ['u_trophy', 42.2, 64.5, PI],
    // 昇降口のコピー機、廊下の自販機と「清掃中」の看板（ワックスで滑る）
    ['u_copier', 58, -44, PI],
    ['u_vending', -6.45, 60, PI / 2],
    ['u_vending', -6.45, 61, PI / 2],
    ['u_wetsign', -44, -1.5, 0.4],
    ['u_wetsign', 34, 1.5, 2.1],
    ['u_wetsign', 1.5, 34, 1.2],
    ['u_wetsign', -1.5, -40, 3.0],
  ],
  yard: [['u_vending', -11.8, -40.6, 0]],
};

const SCATTER: Partial<Record<StageId, Scatter[]>> = {
  yard: [['u_hoop', 2, 14, 34], ['u_hydrant', 2, 18, 50], ['u_parktrash', 3], ['u_wheelbarrow', 1], ['u_picnic', 1]],
  park: [['u_merrygo', 1, 12, 30], ['u_seesaw', 2, 12, 34], ['u_swing', 1, 14, 36], ['u_slide', 1, 14, 36], ['u_springrider', 2, 12, 34], ['u_picnic', 2], ['u_parktrash', 3], ['u_hydrant', 1]],
  roof: [['u_hvac', 2, 10, 40], ['u_turbine', 2, 14, 44], ['u_generator', 1], ['u_gascyl', 2]],
  site: [
    ['u_forklift', 1, 12, 30], ['u_mixer', 1], ['u_wheelbarrow', 2], ['u_oildrum', 3], ['u_barrier', 4], ['u_jersey', 2], ['u_generator', 1],
    ['u_toilet', 1], ['u_skip', 1, 16, 50], ['u_gascyl', 3], ['u_cablereel', 1], ['u_excavator', 1, 18, 50],
  ],
  matsuri: [['u_popcorn', 2], ['u_cooler', 3], ['u_picnic', 2], ['u_parktrash', 2], ['u_vending', 1], ['u_hydrant', 1]],
  hill: [['u_picnic', 2], ['u_cooler', 1], ['u_wheelbarrow', 1], ['u_parktrash', 1], ['u_turbine', 1, 20, 50]],
  akiba: [
    ['u_arcade', 3], ['u_pinball', 2], ['u_jukebox', 1], ['u_vending', 2], ['u_phonebooth', 1], ['u_signal', 3], ['u_mailbox', 1],
    ['u_cart', 2, 10, 26], ['u_hydrant', 1],
  ],
  quarry: [
    ['u_forklift', 1, 12, 30], ['u_excavator', 1, 18, 50], ['u_skip', 1], ['u_oildrum', 3], ['u_gascyl', 3], ['u_cablereel', 2], ['u_generator', 1],
    ['u_toilet', 1], ['u_jersey', 2], ['u_barrier', 2], ['u_wheelbarrow', 1],
  ],
  onsen: [
    ['u_vending', 2], ['u_pingpong', 2], ['u_luggagecart', 1], ['u_phonebooth', 1], ['u_mailbox', 1], ['u_arcade', 1], ['u_cooler', 1], ['u_parktrash', 1],
    ['u_hydrant', 1],
  ],
  ski: [['u_cooler', 2], ['u_picnic', 1], ['u_generator', 1], ['u_oildrum', 1], ['u_gascyl', 1], ['u_toilet', 1], ['u_turbine', 1, 20, 50], ['u_vending', 1]],
};

/** (x, z) のまわり r 以内に、小道具や建物の部品が無いか。 */
function clear(w: WorldMap, x: number, z: number, r: number): boolean {
  for (const p of w.props) {
    const t = p.body.translation();
    if (Math.hypot(t.x - x, t.z - z) < r + Math.max(p.half.x, p.half.z)) return false;
  }
  for (const ch of w.chunks) {
    if (ch.state !== 'fixed') continue;
    if (Math.abs(ch.pos.x - x) < r + ch.half.x + 0.3 && Math.abs(ch.pos.z - z) < r + ch.half.z + 0.3 && ch.pos.y < w.groundY(x, z) + 4) return false;
  }
  return true;
}

export function placeUsd(w: WorldMap, stage: StageId, rng: Rng): void {
  let n = 0;
  let miss = 0;
  for (const [id, x, z, yaw] of FIXED[stage] ?? []) {
    if (w.spawnProp(id, { x, y: w.groundY(x, z) + 0.005, z }, yaw, S)) n++;
  }
  for (const [id, count, rmin = 6, rmax = 54] of SCATTER[stage] ?? []) {
    for (let k = 0; k < count; k++) {
      let ok = false;
      for (let tries = 0; tries < 14 && !ok; tries++) {
        const { x, z } = w.pickSpot(rmin, rmax, 2.5, w.start.x, w.start.z);
        if (Math.abs(x) > 66 || Math.abs(z) > 66 || !clear(w, x, z, 2)) continue;
        ok = !!w.spawnProp(id, { x, y: w.groundY(x, z) + 0.005, z }, rng() * PI * 2, S);
      }
      if (ok) n++;
      else miss++;
    }
  }
  log('usd.place', { stage }, { placed: n, missed: miss });
}
