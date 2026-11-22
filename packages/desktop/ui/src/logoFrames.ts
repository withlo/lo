import { LOGO } from './logoKeys.ts';

/** A logo animation the app plays: the unmeld, the meld loop or the kiss. */
export type LogoPlay = keyof typeof LOGO.animations;

type Ease = keyof typeof LOGO.easing;

interface Key {
  readonly t: number;
  readonly ease: Ease;
}

interface PoolKey extends Key {
  readonly level: number | 'full' | 'empty';
}

interface BallKey extends Key {
  readonly x: number;
  readonly y: number;
  readonly rx: number;
  readonly ry: number;
}

interface NeckKey extends Key {
  readonly neck: null | {
    readonly backLength: number;
    readonly backHalfWidth: number;
    readonly poolLength: number;
    readonly poolHalfWidth: number;
  };
}

interface Animation {
  readonly from: number;
  readonly to: number;
  readonly loop: boolean;
  readonly pool: readonly PoolKey[];
  readonly neck: readonly NeckKey[];
  readonly ball: readonly BallKey[];
}

/** The ball as drawn: an ellipse turned 45° about its center, `rx` along the way it travels. */
export interface LogoBall {
  x: number;
  y: number;
  rx: number;
  ry: number;
}

/** One frame of a logo animation: the paths of the pool and the neck, and the ball. */
export interface LogoFrame {
  /** The pool's path, the part of the corner that hasn't drained. Empty once it has. */
  pool: string;
  /** The neck's path, drawn turned 45° about the socket's center, under the blur only. */
  neck: string;
  ball: LogoBall;
}

const { socket } = LOGO;

// The triangle the pool fills: its left and bottom edges, and its rounded corner about the socket's
// center. The brand's file gives these in a sentence, and the generator checks they're still there.
const LEFT = 27.4;
const BOTTOM = 72.6;
const CORNER = 28.6;
/** The pool's level, along the way the ball travels from the socket's center, when it's full. */
const FULL = 0.515;
/** The level at which the pool has drained to nothing. */
const DRAINED = -CORNER;
/** The level the neck is drawn from once the pool has drained: the socket's own edge. */
const SOCKET_EDGE = -socket.radius;

/** Where a neck that isn't there is drawn, so one can grow from it and shrink back to it. */
const NO_NECK: readonly number[] = Array.from({ length: 20 }, (_, index) =>
  index % 2 === 0 ? socket.x - 20 : socket.y,
);

/** A cubic bezier from 0 to 1 through the control values `a` and `b`, at `s` along it. */
const bezier = (a: number, b: number, s: number) =>
  3 * a * s * (1 - s) ** 2 + 3 * b * s * s * (1 - s) + s ** 3;

/** The easing function of a cubic bezier, found by halving: its x only grows. */
function curve([x1, y1, x2, y2]: readonly [number, number, number, number]) {
  if (x1 === y1 && x2 === y2) return (progress: number) => progress;
  return (progress: number) => {
    if (progress <= 0) return 0;
    if (progress >= 1) return 1;
    let low = 0;
    let high = 1;
    let s = progress;
    for (let step = 0; step < 32; step += 1) {
      const x = bezier(x1, x2, s);
      if (Math.abs(x - progress) < 1e-6) break;
      if (x < progress) low = s;
      else high = s;
      s = (low + high) / 2;
    }
    return bezier(y1, y2, s);
  };
}

const EASE: Readonly<Record<Ease, (progress: number) => number>> = {
  linear: curve(LOGO.easing.linear),
  inOut: curve(LOGO.easing.inOut),
  in: curve(LOGO.easing.in),
  out: curve(LOGO.easing.out),
};

/**
 * The two keys `t` falls between and how far it is from the first to the second, eased as the
 * second key says: a key's easing is that of the stretch ending at it.
 */
function between<K extends Key>(keys: readonly K[], t: number): readonly [K, K, number] {
  const first = keys[0];
  if (first === undefined) throw new Error('A track has no keys.');
  if (t <= first.t) return [first, first, 0];
  for (let index = 1; index < keys.length; index += 1) {
    const from = keys[index - 1];
    const to = keys[index];
    if (from === undefined || to === undefined) break;
    if (t <= to.t) return [from, to, EASE[to.ease]((t - from.t) / (to.t - from.t))];
  }
  const last = keys[keys.length - 1] ?? first;
  return [last, last, 0];
}

const mix = (from: number, to: number, progress: number) => from + (to - from) * progress;

function ballAt(keys: readonly BallKey[], t: number): LogoBall {
  const [from, to, progress] = between(keys, t);
  return {
    x: mix(from.x, to.x, progress),
    y: mix(from.y, to.y, progress),
    rx: mix(from.rx, to.rx, progress),
    ry: mix(from.ry, to.ry, progress),
  };
}

function levelAt(keys: readonly PoolKey[], t: number, empty: number): number {
  const level = (key: PoolKey) =>
    key.level === 'full' ? FULL : key.level === 'empty' ? empty : key.level;
  const [from, to, progress] = between(keys, t);
  return mix(level(from), level(to), progress);
}

const round = (value: number) => String(Math.round(value * 100) / 100);

/**
 * The pool at a level: the triangle's fill, cut off across the way the ball travels. Above the
 * rounded corner the cut runs from the bottom edge to the left one. Inside the corner it's a chord
 * of the corner's circle, which shrinks to nothing as the pool drains.
 */
export function poolPath(level: number): string {
  const at = Math.min(level, FULL);
  if (at <= DRAINED) return '';
  // The cut is the line x − y = cut.
  const cut = socket.x - socket.y + at * Math.SQRT2;
  // Past where the corner's curve ends, on the bottom edge and the left one alike.
  if (cut >= socket.x - BOTTOM) {
    return `M${round(cut + BOTTOM)} ${BOTTOM}H${socket.x}A${CORNER} ${CORNER} 0 0 1 ${LEFT} ${socket.y}V${round(LEFT - cut)}Z`;
  }
  const half = Math.sqrt(CORNER ** 2 - at ** 2);
  const x1 = socket.x + (at + half) / Math.SQRT2;
  const y1 = socket.y + (half - at) / Math.SQRT2;
  const x2 = socket.x + (at - half) / Math.SQRT2;
  const y2 = socket.y - (at + half) / Math.SQRT2;
  return `M${round(x1)} ${round(y1)}A${CORNER} ${CORNER} 0 0 1 ${round(x2)} ${round(y2)}Z`;
}

/**
 * The points of the neck at one of its keys, in the frame turned so the ball travels along x: a
 * cone trailing from the back of the ball, and one rising from the pool to meet it.
 */
function neckPoints(animation: Animation, key: NeckKey): readonly number[] {
  if (key.neck === null) return NO_NECK;
  const ball = ballAt(animation.ball, key.t);
  const level = levelAt(animation.pool, key.t, SOCKET_EDGE);
  const y = socket.y;
  // The back of the ball, along the way it travels.
  const back = socket.x + (ball.x - socket.x) * Math.SQRT2 - ball.rx;
  const from = back + 3;
  const tip = back - key.neck.backLength;
  const wide = key.neck.backHalfWidth;
  const base = socket.x + level - 3;
  const peak = socket.x + level + key.neck.poolLength;
  const broad = key.neck.poolHalfWidth;
  const waist = 0.45;
  // Each cone: out along one side to its tip, and back along the other.
  const trail = [from, y + wide, (from + tip) / 2, y + waist * wide, tip, y];
  const trailHome = [(from + tip) / 2, y - waist * wide, from, y - wide];
  const rise = [base, y - broad, (base + peak) / 2, y - waist * broad, peak, y];
  const riseHome = [(base + peak) / 2, y + waist * broad, base, y + broad];
  return trail.concat(trailHome, rise, riseHome);
}

const necks = new WeakMap<Animation, readonly (readonly number[])[]>();

function neckPath(animation: Animation, t: number): string {
  let points = necks.get(animation);
  if (!points) {
    points = animation.neck.map((key) => neckPoints(animation, key));
    necks.set(animation, points);
  }
  const [from, to, progress] = between(animation.neck, t);
  const start = points[animation.neck.indexOf(from)] ?? NO_NECK;
  const end = points[animation.neck.indexOf(to)] ?? NO_NECK;
  const p = start.map((value, index) => round(mix(value, end[index] ?? value, progress)));
  return `M${p[0]} ${p[1]}Q${p[2]} ${p[3]} ${p[4]} ${p[5]}Q${p[6]} ${p[7]} ${p[8]} ${p[9]}ZM${p[10]} ${p[11]}Q${p[12]} ${p[13]} ${p[14]} ${p[15]}Q${p[16]} ${p[17]} ${p[18]} ${p[19]}Z`;
}

/** How long a logo animation plays, in seconds: once through, or one turn of the loop. */
export function logoSeconds(play: LogoPlay): number {
  const animation: Animation = LOGO.animations[play];
  return animation.to - animation.from;
}

/** Whether a logo animation repeats. Only the meld loop does. */
export function logoLoops(play: LogoPlay): boolean {
  return LOGO.animations[play].loop;
}

/**
 * The frame of a logo animation `seconds` into its play. A loop comes round again; anything else
 * holds its last frame, which is the mark at rest.
 */
export function logoFrame(play: LogoPlay, seconds: number): LogoFrame {
  const animation: Animation = LOGO.animations[play];
  const length = animation.to - animation.from;
  const into = animation.loop ? seconds % length : Math.min(seconds, length);
  const t = animation.from + Math.max(into, 0);
  return {
    pool: poolPath(levelAt(animation.pool, t, DRAINED)),
    neck: neckPath(animation, t),
    ball: ballAt(animation.ball, t),
  };
}
