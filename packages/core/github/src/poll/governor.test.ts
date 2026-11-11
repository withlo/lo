import { expect, test } from 'vitest';

import { RateLimits } from '../rate-limit.ts';
import {
  backoff,
  interval,
  pollConfig,
  rateLimitState,
  type Cooldown,
  type LowLimit,
  type RateLimitState,
  type Tier,
} from './governor.ts';

const RESET = 1_800_000_000;

function at(seconds: number): number {
  return seconds * 1000;
}

function limits(pairs: [string, number][]): RateLimits {
  const recorded = new RateLimits();
  for (const [resource, remaining] of pairs) {
    recorded.record(resource, { limit: 5000, remaining, used: 5000 - remaining, reset: RESET });
  }
  return recorded;
}

function state(pairs: [string, number][]): RateLimitState {
  return rateLimitState(limits(pairs), undefined, at(RESET - 600), pollConfig());
}

function low(resource: string, remaining: number): LowLimit {
  return { resource, remaining, limit: 5000, reset: at(RESET) };
}

test('slows under 20 percent and polls only the open pr under 5', () => {
  expect(state([])).toEqual({ kind: 'normal' });
  expect(state([['core', 1000]])).toEqual({ kind: 'normal' });
  expect(state([['core', 999]])).toEqual({ kind: 'slowed', low: low('core', 999) });
  expect(state([['graphql', 250]])).toEqual({ kind: 'slowed', low: low('graphql', 250) });
  expect(state([['graphql', 249]])).toEqual({ kind: 'openOnly', low: low('graphql', 249) });
  expect(state([['core', 1]])).toEqual({ kind: 'openOnly', low: low('core', 1) });
});

test('pauses until the reset when used up', () => {
  expect(state([['core', 0]])).toEqual({
    kind: 'paused',
    until: at(RESET),
    reason: { kind: 'usedUp', resource: 'core' },
  });
});

test('a reset too far off isnt waited for', () => {
  const now = at(RESET - 600);
  const config = pollConfig();
  const far = new RateLimits();
  far.record('core', { limit: 5000, remaining: 0, used: 5000, reset: 2 ** 64 });
  expect(rateLimitState(far, undefined, now, config)).toEqual({ kind: 'normal' });
  // Two hours off, as with a clock an hour behind GitHub's, neither.
  const hours = new RateLimits();
  hours.record('core', { limit: 5000, remaining: 0, used: 5000, reset: RESET + 7200 });
  expect(rateLimitState(hours, undefined, now, config)).toEqual({ kind: 'normal' });
});

test('the worst resource wins', () => {
  expect(
    state([
      ['core', 900],
      ['graphql', 100],
    ]),
  ).toEqual({ kind: 'openOnly', low: low('graphql', 100) });
  expect(
    state([
      ['core', 0],
      ['graphql', 100],
    ]),
  ).toEqual({ kind: 'paused', until: at(RESET), reason: { kind: 'usedUp', resource: 'core' } });
});

test('other resources dont count', () => {
  expect(state([['search', 0]])).toEqual({ kind: 'normal' });
});

test('a window that has reset counts as new', () => {
  const usedUp = limits([['core', 0]]);
  const config = pollConfig();
  expect(rateLimitState(usedUp, undefined, at(RESET - 1), config).kind).toBe('paused');
  expect(rateLimitState(usedUp, undefined, at(RESET), config)).toEqual({ kind: 'normal' });
});

test('a cooldown pauses until it ends', () => {
  const config = pollConfig();
  const cooldown: Cooldown = { until: at(RESET + 60), reason: { kind: 'secondary' } };
  // The later of the two pauses wins.
  expect(rateLimitState(limits([['core', 0]]), cooldown, at(RESET - 600), config)).toEqual({
    kind: 'paused',
    until: at(RESET + 60),
    reason: { kind: 'secondary' },
  });
  expect(rateLimitState(new RateLimits(), cooldown, at(RESET + 60), config)).toEqual({
    kind: 'normal',
  });
});

test('intervals by tier window and rate limit', () => {
  const config = pollConfig();
  const seconds = (tier: Tier, foreground: boolean, limit: RateLimitState) => {
    const every = interval(tier, foreground, limit, config);
    return every === undefined ? undefined : every / 1000;
  };
  const normal: RateLimitState = { kind: 'normal' };
  expect(seconds('open', true, normal)).toBe(20);
  expect(seconds('watched', true, normal)).toBe(120);
  expect(seconds('open', false, normal)).toBe(300);
  expect(seconds('watched', false, normal)).toBe(300);

  const slowed: RateLimitState = { kind: 'slowed', low: low('core', 900) };
  expect(seconds('open', true, slowed)).toBe(40);
  expect(seconds('watched', true, slowed)).toBe(240);
  expect(seconds('open', false, slowed)).toBe(600);

  const openOnly: RateLimitState = { kind: 'openOnly', low: low('core', 100) };
  expect(seconds('open', true, openOnly)).toBe(120);
  expect(seconds('open', false, openOnly)).toBe(300);
  expect(seconds('watched', true, openOnly)).toBeUndefined();

  const paused: RateLimitState = {
    kind: 'paused',
    until: at(RESET),
    reason: { kind: 'secondary' },
  };
  expect(seconds('open', true, paused)).toBeUndefined();
  expect(seconds('watched', false, paused)).toBeUndefined();
});

test('backoff doubles up to the most less some jitter', () => {
  const first = 20_000;
  const max = 300_000;
  const waits = [1, 2, 3, 4, 5, 6, 7].map((attempt) => backoff(attempt, first, max, 0.2, 0) / 1000);
  expect(waits).toEqual([20, 40, 80, 160, 300, 300, 300]);
  expect(backoff(1, first, max, 0.2, 0.5)).toBe(18_000);
  expect(Math.floor(backoff(5, first, max, 0.2, 0.999) / 1000)).toBe(240);
  // Attempt 0 is treated as the first; huge attempts don't overflow.
  expect(backoff(0, first, max, 0, 0)).toBe(first);
  expect(backoff(200, first, max, 0, 0)).toBe(max);
});
