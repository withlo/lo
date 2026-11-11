import { expect, test } from 'vitest';

import { DEFAULT_FETCH_LIMITS, formatDuration, startLimit } from './limits.ts';

test('a first fetch may take longer to start', () => {
  expect(startLimit(DEFAULT_FETCH_LIMITS, false)).toBe(120_000);
  expect(startLimit(DEFAULT_FETCH_LIMITS, true)).toBe(600_000);
});

test('writes durations as people read them', () => {
  const cases: [number, string][] = [
    [300, '0.3 s'],
    [1_500, '1.5 s'],
    [5, '5 ms'],
    [0, '0 ms'],
    [1_000, '1 s'],
    [5_000, '5 s'],
    [30_000, '30 s'],
    [30_400, '30 s'],
    [120_000, '2 min'],
    [125_000, '2 min 5 s'],
    [600_000, '10 min'],
  ];
  expect(cases.map(([duration]) => [duration, formatDuration(duration)])).toEqual(cases);
});
