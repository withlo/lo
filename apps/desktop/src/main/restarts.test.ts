import { describe, expect, it } from 'vitest';

import { nextAttempt, pastCap, restartDelay } from './restarts.ts';

describe('restartDelay', () => {
  it('doubles from half a second, up to 30 seconds', () => {
    expect([0, 1, 2, 3, 6, 7, 20].map(restartDelay)).toEqual([
      500, 1000, 2000, 4000, 30_000, 30_000, 30_000,
    ]);
  });
});

describe('nextAttempt', () => {
  it('counts exits that come soon after a start', () => {
    expect(nextAttempt(2, 5_000)).toBe(3);
  });

  it('starts over after a minute of running', () => {
    expect(nextAttempt(5, 60_000)).toBe(0);
  });
});

describe('pastCap', () => {
  it('compares kilobytes with a cap in bytes', () => {
    expect(pastCap(2 * 1024 * 1024, 2 * 1024 ** 3)).toBe(false);
    expect(pastCap(2 * 1024 * 1024 + 1, 2 * 1024 ** 3)).toBe(true);
  });
});
