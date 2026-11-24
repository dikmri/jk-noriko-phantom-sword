import RAPIER from '@dimforge/rapier3d-compat';
import { log } from '../log';

export { RAPIER };

/** 衝突グループ（所属ビット）。 */
export const G = {
  STATIC: 1,
  CHUNK: 2,
  PROP: 4,
  ENEMY: 8,
  PLAYER: 16,
  DEBRIS: 32,
  /** 柵（池のまわりなど）。ノリコと歩いている敵だけを止める。吹き飛んでいる敵や物は越えていく */
  RAIL: 64,
  /** チェーン鉄球（ノリコの移動の判定には入れない） */
  FLAIL: 128,
};
export const G_ALL = 0xffff;
export const G_SOLID = G.STATIC | G.CHUNK | G.PROP | G.DEBRIS;

export function groups(member: number, filter: number): number {
  return ((member & 0xffff) << 16) | (filter & 0xffff);
}

export type OwnerKind = 'static' | 'chunk' | 'prop' | 'enemy' | 'player' | 'debris';
export interface Owner {
  kind: OwnerKind;
  ref: any;
}

const IDENT = { x: 0, y: 0, z: 0, w: 1 };
/** WASM の初期化はページごとに 1 回だけ行う（やり直すと、前の世界の物が壊れる）。 */
let initOnce: Promise<void> | null = null;

export class Physics {
  world!: RAPIER.World;
  events!: RAPIER.EventQueue;
  owners = new Map<number, Owner>();
  private ball = new Map<number, RAPIER.Ball>();

  static async create(gravity: number): Promise<Physics> {
    const t0 = performance.now();
    if (!initOnce) initOnce = RAPIER.init();
    await initOnce;
    const p = new Physics();
    p.world = new RAPIER.World({ x: 0, y: gravity, z: 0 });
    p.events = new RAPIER.EventQueue(true);
    log('physics.init', { gravity }, { ms: Math.round(performance.now() - t0), version: RAPIER.version() });
    return p;
  }

  step(dt: number): void {
    this.world.timestep = dt;
    this.world.step(this.events);
  }

  register(col: RAPIER.Collider, owner: Owner): void {
    this.owners.set(col.handle, owner);
  }

  unregister(col: RAPIER.Collider): void {
    this.owners.delete(col.handle);
  }

  ownerOf(col: RAPIER.Collider | null | undefined): Owner | undefined {
    return col ? this.owners.get(col.handle) : undefined;
  }

  ownerOfHandle(handle: number): Owner | undefined {
    return this.owners.get(handle);
  }

  /** 球と重なっているコライダーの持ち主を列挙する。mask は相手の所属ビット。 */
  querySphere(pos: { x: number; y: number; z: number }, radius: number, mask: number, cb: (owner: Owner, col: RAPIER.Collider) => void): void {
    const key = Math.round(radius * 100);
    let shape = this.ball.get(key);
    if (!shape) {
      shape = new RAPIER.Ball(radius);
      this.ball.set(key, shape);
    }
    this.collect(pos, IDENT, shape, mask, cb);
  }

  /**
   * 重なっているコライダーを先に集めてから、まとめて cb を呼ぶ。
   * Rapier の問い合わせの最中に、物を動かしたり消したりする関数を呼ぶと失敗する。
   * しかもその失敗は Rapier の内部で握りつぶされて見えない。そのため問い合わせが終わってから処理する。
   */
  private collect(pos: { x: number; y: number; z: number }, rot: { x: number; y: number; z: number; w: number }, shape: RAPIER.Shape, mask: number, cb: (owner: Owner, col: RAPIER.Collider) => void): void {
    const found: { o: Owner; col: RAPIER.Collider }[] = [];
    this.world.intersectionsWithShape(pos, rot, shape, (col) => {
      const o = this.owners.get(col.handle);
      if (o) found.push({ o, col });
      return true;
    }, undefined, groups(G_ALL, mask));
    for (const f of found) cb(f.o, f.col);
  }

  /** 任意の形と重なっているコライダーの持ち主を列挙する。 */
  queryShape(pos: { x: number; y: number; z: number }, rot: { x: number; y: number; z: number; w: number }, shape: RAPIER.Shape, mask: number, cb: (owner: Owner, col: RAPIER.Collider) => void): void {
    this.collect(pos, rot, shape, mask, cb);
  }

  /** 直前の物理ステップで起きた「ぶつかり始め」の組を取り出す。処理は呼び出し側が、取り出し終えてから行う。 */
  drainStarted(): number[] {
    const pairs: number[] = [];
    this.events.drainCollisionEvents((h1, h2, started) => {
      if (started) pairs.push(h1, h2);
    });
    return pairs;
  }

  /** 線分上で最初に当たるコライダー。当たらなければ null。 */
  raycast(from: { x: number; y: number; z: number }, dir: { x: number; y: number; z: number }, maxDist: number, mask: number): { dist: number; owner?: Owner; col: RAPIER.Collider } | null {
    const ray = new RAPIER.Ray(from, dir);
    const hit = this.world.castRay(ray, maxDist, true, undefined, groups(G_ALL, mask));
    if (!hit) return null;
    return { dist: hit.timeOfImpact, owner: this.owners.get(hit.collider.handle), col: hit.collider };
  }

  dispose(): void {
    try {
      this.events.free();
      this.world.free();
    } catch {
      /* 二重解放は無視する */
    }
    this.owners.clear();
  }
}
