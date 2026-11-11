import { expect, test } from 'vitest';

import { cut, DEFAULT_LIMITS, resolveLimits } from './limits.ts';

test('the cut counts characters and never splits a pair', () => {
  expect(cut('abc', 3)).toEqual({ text: 'abc', cut: false });
  expect(cut('abcd', 3)).toEqual({ text: 'abc', cut: true });
  expect(cut('😀😀😀', 2)).toEqual({ text: '😀😀', cut: true });
  // Three code points in six units: not cut.
  expect(cut('😀😀😀', 3)).toEqual({ text: '😀😀😀', cut: false });
  // A lone surrogate counts as one.
  expect(cut('\ud800\ud800x', 2)).toEqual({ text: '\ud800\ud800', cut: true });
});

test('the cut reads no further than it keeps', () => {
  const huge = 'a'.repeat(50_000_000);
  const started = performance.now();
  expect(cut(huge, 10).text).toBe('a'.repeat(10));
  expect(performance.now() - started).toBeLessThan(50);
});

test('a limit is a whole number up to its ceiling, or its default', () => {
  expect(resolveLimits(undefined)).toEqual(DEFAULT_LIMITS);
  expect(resolveLimits({ depth: 8, images: 3 })).toEqual({
    ...DEFAULT_LIMITS,
    depth: 8,
    images: 3,
  });
  expect(resolveLimits({ depth: 1e9 }).depth).toBe(64);
  // Room for the plain text shown for what didn't fit, and for a footnote's.
  expect(resolveLimits({ nodes: 3 }).nodes).toBe(16);
  expect(resolveLimits({ depth: 1 }).depth).toBe(3);
  const values = [0, -5, 2.5, Number.NaN, Infinity];
  expect(values.map((nodes) => resolveLimits({ nodes }).nodes)).toEqual(
    values.map(() => DEFAULT_LIMITS.nodes),
  );
  // Whatever a caller passes at run time.
  expect(resolveLimits(JSON.parse('{"nodes": "9"}')).nodes).toBe(DEFAULT_LIMITS.nodes);
});
