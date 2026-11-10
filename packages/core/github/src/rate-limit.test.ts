import { expect, test } from 'vitest';

import { fractionLeft, RateLimits, resetTime, type RateLimit } from './rate-limit.ts';

test('a reset too far off isnt recorded', () => {
  const limits = new RateLimits();
  const date = 'Mon, 09 Nov 2026 12:00:00 GMT';
  // Two hours and half an hour after the date, 2026-11-09 12:00 UTC.
  const [two, half] = ['1794232800', '1794227400'];
  const headers = (remaining: string, reset: string) =>
    new Headers({
      date,
      'x-ratelimit-limit': '5000',
      'x-ratelimit-remaining': remaining,
      'x-ratelimit-reset': reset,
    });
  limits.recordHeaders(headers('0', '18446744073709551615'));
  expect(limits.core()).toBeUndefined();
  limits.recordHeaders(headers('0', two));
  expect(limits.core()).toBeUndefined();
  // A genuine one after it is recorded, not taken for an earlier window.
  limits.recordHeaders(headers('4999', half));
  expect(limits.core()?.remaining).toBe(4999);
  // A reset that can't be a time still reads as one.
  const nonsense: RateLimit = {
    limit: 5000,
    remaining: 0,
    used: 5000,
    reset: Number.MAX_SAFE_INTEGER,
  };
  expect(resetTime(nonsense)).toEqual(new Date((2 ** 32 - 1) * 1000));
});

test('reads the headers per resource', () => {
  const limits = new RateLimits();
  limits.recordHeaders(
    new Headers({
      'x-ratelimit-limit': '5000',
      'x-ratelimit-remaining': '4990',
      'x-ratelimit-used': '10',
      'x-ratelimit-reset': '1762419600',
      'x-ratelimit-resource': 'graphql',
    }),
  );
  expect(limits.graphql()).toEqual({ limit: 5000, remaining: 4990, used: 10, reset: 1762419600 });
  expect(limits.core()).toBeUndefined();
});

test('headers without a resource are core', () => {
  const limits = new RateLimits();
  limits.recordHeaders(
    new Headers({
      'x-ratelimit-limit': '60',
      'x-ratelimit-remaining': '59',
      'x-ratelimit-reset': '1762419600',
    }),
  );
  const core = limits.core();
  expect([core?.remaining, core?.used]).toEqual([59, 1]);
});

test('missing headers change nothing', () => {
  const limits = new RateLimits();
  limits.recordHeaders(new Headers({ 'x-ratelimit-limit': '5000' }));
  expect(limits).toEqual(new RateLimits());
  expect(limits.core()).toBeUndefined();
});

/** A limit of 5000 with `remaining` left, `used` used, resetting at `reset`. */
function limitOf(remaining: number, used: number, reset: number): RateLimit {
  return { limit: 5000, remaining, used, reset };
}

/** A limit of 5000 with `remaining` left, resetting at `reset`. */
function left(remaining: number, reset: number): RateLimit {
  return limitOf(remaining, 5000 - remaining, reset);
}

test('keeps the lowest remaining within a window', () => {
  const limits = new RateLimits();
  const at = limitOf;
  limits.record('core', at(4977, 23, 100));
  limits.record('core', at(4999, 1, 100));
  expect(limits.core()).toEqual(at(4977, 23, 100));
  limits.record('core', at(4975, 25, 100));
  expect(limits.core()).toEqual(at(4975, 25, 100));
  // A new window starts over.
  limits.record('core', at(4999, 1, 200));
  expect(limits.core()).toEqual(at(4999, 1, 200));
});

test('ignores a late answer from a window that has reset', () => {
  const limits = new RateLimits();
  const at = left;
  limits.record('core', at(0, 100));
  limits.record('core', at(4999, 3700));
  // A server that hasn't seen the reset yet still answers with the old window.
  limits.record('core', at(0, 100));
  expect(limits.core()).toEqual(at(4999, 3700));
});

test('answers a second apart are one window', () => {
  const limits = new RateLimits();
  const at = left;
  limits.record('graphql', at(4990, 100));
  limits.record('graphql', at(4995, 101));
  expect(limits.graphql()).toEqual(at(4990, 101));
  limits.record('graphql', at(4980, 100));
  expect(limits.graphql()).toEqual(at(4980, 101));
});

test('reads the graphql field', () => {
  const limits = new RateLimits();
  limits.recordGraphQLField({
    cost: 1,
    limit: 5000,
    remaining: 4998,
    used: 2,
    resetAt: '2026-11-06T09:00:00Z',
  });
  expect(limits.lastGraphQLCost).toBe(1);
  const graphql = limits.graphql();
  expect(graphql?.remaining).toBe(4998);
  expect(graphql?.reset).toBe(1_793_955_600);
  expect(graphql && fractionLeft(graphql)).toBeCloseTo(0.9996, 9);
});
