/**
 * ステージ（マップ）の共通の形と、作り分け。
 * 地面・建物・小道具を置く build() と、ステージだけの仕掛けを動かす update() を持つ。
 */
import type { StageId } from '../defs';
import type { Enemy } from '../enemies';
import type { Game } from '../game';
import type { Prop, SkyOpts, Surface, WorldMap } from '../world';
import { akiba } from './akiba';
import { campus } from './campus';
import { hill } from './hill';
import { matsuri } from './matsuri';
import { onsen } from './onsen';
import { park } from './park';
import { quarry } from './quarry';
import { roof } from './roof';
import { site } from './site';
import { ski } from './ski';
import { yard } from './yard';

export interface Stage {
  /** ノリコが立つ最初の位置 */
  start: { x: number; z: number };
  sky: SkyOpts;
  build(): void;
  update?(dt: number): void;
  /** 足元の状態を out に書く（呼ぶ前に speed=1, grip=1, water=false にしてある） */
  surface?(x: number, z: number, out: Surface): void;
  /** 地面の高さ（高低差のあるステージ） */
  heightAt?(x: number, z: number): number;
  /** 敵を出してよい場所か */
  spawnOk?(x: number, z: number): boolean;
  /** 歩く敵の向きを変える（坂道を通って高い所へ登らせるなど）。変えないときは null */
  steer?(e: Enemy, tx: number, tz: number): [number, number] | null;
  /** 叩くと仕掛けが動く物（大太鼓）を叩いたとき */
  onDrum?(p: Prop): void;
  dispose?(): void;
}

export type StageMaker = (g: Game, w: WorldMap) => Stage;

const MAKERS: Record<StageId, StageMaker> = { yard, campus, park, akiba, roof, site, matsuri, hill, quarry, onsen, ski };

export function createStage(id: StageId, g: Game, w: WorldMap): Stage {
  return (MAKERS[id] ?? yard)(g, w);
}

/** 昼の空（校庭・公園）。 */
export const DAY_SKY: SkyOpts = { top: 0x3d9bff, mid: 0xbfe6ff, fog: 0xcfeaff, fogNear: 70, fogFar: 190, sun: 0xfff1d6, sunI: 2.4, hemiSky: 0xffffff, hemiGround: 0xc4beb4, hemiI: 1.25 };
