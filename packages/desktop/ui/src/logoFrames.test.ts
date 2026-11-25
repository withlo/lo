import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { logoFrame, logoLoops, logoSeconds, poolPath, type LogoPlay } from './logoFrames.ts';
import { LOGO } from './logoKeys.ts';

/** The brand's preview of each animation, which the app's drawing has to match. */
const PREVIEWS: Readonly<Record<LogoPlay, string>> = {
  unmeld: 'unmeld-chalk.svg',
  meld: 'meld-loop-chalk.svg',
  kiss: 'kiss-chalk.svg',
};

const numbers = (text: string) => [...text.matchAll(/-?\d+(?:\.\d+)?/g)].map(Number);

/** A preview's keyframes for the pool and the neck: each key's time in seconds and its path. */
function preview(play: LogoPlay) {
  const here = import.meta.url;
  const svg = readFileSync(new URL(`../../../../brand/motion/${PREVIEWS[play]}`, here), 'utf8');
  const tracks = [...svg.matchAll(/<animate\b[^>]*attributeName="d"[^>]*>/g)].map(([tag]) => {
    const read = (name: string) => new RegExp(`${name}="([^"]*)"`).exec(tag)?.[1] ?? '';
    const seconds = Number.parseFloat(read('dur'));
    const times = read('keyTimes').split(';').map(Number);
    return read('values')
      .split(';')
      .map((path, index) => ({ t: (times[index] ?? 0) * seconds, path }));
  });
  const neck = tracks.find((keys) => keys[0]?.path.includes('Q'));
  const pool = tracks.find((keys) => !keys[0]?.path.includes('Q'));
  if (!neck || !pool) throw new Error(`${PREVIEWS[play]} has no pool or no neck.`);
  return { pool, neck };
}

/** The keys the app plays: those from where its play starts to where it ends. */
function played<K extends { t: number }>(play: LogoPlay, keys: readonly K[]): K[] {
  const { from, to } = LOGO.animations[play];
  return keys.filter((key) => key.t >= from - 1e-6 && key.t <= to + 1e-6);
}

describe.each(['unmeld', 'meld', 'kiss'] as const)('%s', (play) => {
  const { from } = LOGO.animations[play];

  it('draws the neck the brand’s preview draws, at each of its keys', () => {
    const keys = played(play, preview(play).neck);
    expect(keys.length).toBeGreaterThan(2);
    for (const key of keys) {
      const drawn = numbers(logoFrame(play, key.t - from).neck);
      const meant = numbers(key.path);
      expect(drawn).toHaveLength(meant.length);
      // The preview's numbers are written to one decimal place.
      for (const [index, value] of meant.entries()) {
        expect(Math.abs((drawn[index] ?? NaN) - value)).toBeLessThan(0.11);
      }
    }
  });

  it('cuts the pool where the brand’s preview cuts it, wherever the cut can be seen', () => {
    const keys = played(play, preview(play).pool);
    let seen = 0;
    for (const key of keys) {
      const meant = numbers(key.path);
      const [x = 0, y = 0] = meant;
      const [endX = 0, endY = 0] = meant.slice(-2);
      // Below the socket's wall the pool is under the L, where the preview keeps a sliver.
      const level = (x - y - (LOGO.socket.x - LOGO.socket.y)) / Math.SQRT2;
      if (level < -LOGO.socket.radius) continue;
      seen += 1;
      const drawn = numbers(logoFrame(play, key.t - from).pool);
      expect(Math.abs((drawn[0] ?? NaN) - x)).toBeLessThan(0.11);
      expect(Math.abs((drawn[1] ?? NaN) - y)).toBeLessThan(0.11);
      // The cut's other end: the last number of a straight cut, which ends on the left edge, and
      // the last two of a chord.
      const last = drawn.slice(-2);
      // A straight cut ends going up the left edge, so its path gives no last x of its own.
      const lastX = Math.abs(endX - 27.4) < 0.01 ? 27.4 : (last[0] ?? NaN);
      expect(Math.abs(lastX - endX)).toBeLessThan(0.11);
      expect(Math.abs((last[1] ?? NaN) - endY)).toBeLessThan(0.11);
    }
    expect(seen).toBeGreaterThan(1);
  });

  it('ends on the mark at rest, or comes round to where it began', () => {
    const end = logoFrame(play, logoSeconds(play));
    // A loop comes round, and anything else holds its end.
    const later = logoFrame(play, logoSeconds(play) + 0.5);
    expect(later).toEqual(logoLoops(play) ? logoFrame(play, 0.5) : end);
    if (logoLoops(play)) return;
    expect(end.ball).toEqual({ ...LOGO.rest, radius: undefined, rx: 21, ry: 21 });
    expect(end.pool).toBe('');
    // Past its end it holds there.
    expect(logoFrame(play, logoSeconds(play) + 5)).toEqual(end);
  });
});

describe('the pool', () => {
  it('is the whole corner when full, and nothing once drained', () => {
    expect(poolPath(0.515)).toBe('M85.33 72.6H56A28.6 28.6 0 0 1 27.4 44V14.67Z');
    expect(poolPath(3)).toBe(poolPath(0.515));
    expect(poolPath(-28.6)).toBe('');
    expect(poolPath(-40)).toBe('');
  });
});
