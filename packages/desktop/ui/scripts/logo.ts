// Writes src/logoKeys.ts, the keys of the logo animations the app plays, from
// brand/motion/motion.json: the unmeld, the meld loop and the kiss, with the shapes, the goo filter
// and the easing curves they're drawn with. The brand's file stays the one place they're written.
//
//   pnpm nx run ui:codegen

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

type Ease = 'linear' | 'inOut' | 'in' | 'out';

interface PoolKey {
  t: number;
  ease: Ease;
  level: number | 'full' | 'empty';
}

interface NeckKey {
  t: number;
  ease: Ease;
  neck: null | {
    ball: string;
    backLength: number;
    backHalfWidth: number;
    poolLength: number;
    poolHalfWidth: number;
  };
}

interface BallKey {
  t: number;
  ease: Ease;
  x: number;
  y: number;
  rx: number;
  ry: number;
  angle: number;
  opacity: number;
}

interface Animation {
  starts?: number;
  settled?: number;
  loop?: number;
  tracks: { pool: PoolKey[]; neck: NeckKey[]; b1: BallKey[]; b2?: BallKey[] };
}

export interface MotionFile {
  geometry: {
    lShape: string;
    socketCentre: [number, number];
    socketRadius: number;
    ballAtRest: { centre: [number, number]; radius: number };
    triangleFill: string;
    pool: string;
  };
  goo: { blurSigma: number; svg: string };
  easing: Record<Ease, [number, number, number, number]>;
  animations: Record<string, Animation>;
}

/** The animations the app plays, by the name it gives each, and the brand's name for it. */
const PLAYED = { unmeld: 'unmeld', meld: 'meldLoop', kiss: 'kiss' } as const;

/**
 * The numbers the brand's file gives in a sentence, which the drawing code holds as constants: the
 * triangle fill's edges and corner, and the pool's full level. Each must still be in its sentence,
 * so a change to the brand's file stops the build here, not on screen.
 */
const SAID = {
  triangleFill: ['27.4', '72.6', '12.728', '28.6'],
  pool: ['0.515'],
} as const;

function fail(why: string): never {
  throw new Error(`brand/motion/motion.json: ${why}`);
}

/** The keys of one animation, as the app holds them. */
function keys(name: string, animation: Animation) {
  const { pool, neck, b1, b2 } = animation.tracks;
  if (b2) fail(`${name} has a second ball, which the app's drawing has no place for.`);
  for (const key of b1) {
    // The drawing turns the ball by the angle every key has, and never fades it.
    if (key.angle !== -45) fail(`${name} turns its ball to ${key.angle}, not -45.`);
    if (key.opacity !== 1) fail(`${name} fades its ball.`);
  }
  for (const key of neck) {
    if (key.neck && key.neck.ball !== 'b1') fail(`${name} has a neck to ${key.neck.ball}.`);
  }
  const from = animation.loop === undefined ? animation.starts : 0;
  const to = animation.loop ?? animation.settled;
  if (from === undefined || to === undefined) fail(`${name} doesn't say when it starts and ends.`);
  return {
    from,
    to,
    loop: animation.loop !== undefined,
    pool: pool.map(({ t, ease, level }) => ({ t, ease, level })),
    neck: neck.map(({ t, ease, neck: shape }) => ({
      t,
      ease,
      neck: shape && {
        backLength: shape.backLength,
        backHalfWidth: shape.backHalfWidth,
        poolLength: shape.poolLength,
        poolHalfWidth: shape.poolHalfWidth,
      },
    })),
    ball: b1.map(({ t, ease, x, y, rx, ry }) => ({ t, ease, x, y, rx, ry })),
  };
}

/** The module the app's logo animations read, as text. */
export function logoKeys(file: MotionFile): string {
  for (const part of ['triangleFill', 'pool'] as const) {
    const sentence = file.geometry[part];
    for (const number of SAID[part]) {
      if (!sentence.includes(number)) fail(`geometry.${part} no longer says ${number}.`);
    }
  }
  const matrix = /alpha row 0 0 0 (-?[\d.]+) (-?[\d.]+)/.exec(file.goo.svg);
  if (!matrix) fail('goo.svg no longer gives the alpha row of its color matrix.');
  const data = {
    l: file.geometry.lShape,
    socket: {
      x: file.geometry.socketCentre[0],
      y: file.geometry.socketCentre[1],
      radius: file.geometry.socketRadius,
    },
    rest: {
      x: file.geometry.ballAtRest.centre[0],
      y: file.geometry.ballAtRest.centre[1],
      radius: file.geometry.ballAtRest.radius,
    },
    goo: { blur: file.goo.blurSigma, slope: Number(matrix[1]), offset: Number(matrix[2]) },
    easing: file.easing,
    animations: Object.fromEntries(
      Object.entries(PLAYED).map(([name, brand]) => {
        const animation = file.animations[brand];
        if (!animation) fail(`there's no ${brand} animation.`);
        return [name, keys(brand, animation)];
      }),
    ),
  };
  return [
    '// The logo animations the app plays, generated from brand/motion/motion.json by',
    "// scripts/logo.ts. Don't edit it: change the brand's file and run `pnpm nx run ui:codegen`.",
    '',
    `export const LOGO = ${JSON.stringify(data, null, 2)} as const;`,
    '',
  ].join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const source = new URL('../../../../brand/motion/motion.json', import.meta.url);
  const file: MotionFile = JSON.parse(readFileSync(source, 'utf8'));
  writeFileSync(new URL('../src/logoKeys.ts', import.meta.url), logoKeys(file));
}
