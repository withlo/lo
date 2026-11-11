import { expect, test } from 'vitest';

import { MAX_RETRY_AFTER, type GithubErrorDetail } from './errors.ts';
import { rateLimitWait, retryOf } from './merge-jobs.ts';

/** The time, in seconds since the epoch, and the wall clock then in milliseconds. */
const NOW = 1_794_100_000;
const WALL = NOW * 1000;

function limited(
  secondary: boolean,
  reset: number | undefined,
  retryAfter: number | undefined,
): GithubErrorDetail {
  return {
    kind: 'rateLimited',
    message: 'API rate limit exceeded',
    secondary,
    reset,
    retryAfter,
    resource: 'core',
  };
}

/** How long a rate limit asks to wait, at least, before asking again. */
function atLeast(detail: GithubErrorDetail): number | undefined {
  const retry = retryOf(detail, WALL);
  if (retry.kind === 'never') throw new Error(`given up on ${JSON.stringify(detail)}`);
  return retry.atLeast;
}

test('a nonsense reset waits an hour at most', () => {
  const nonsense = limited(false, Number.MAX_SAFE_INTEGER, undefined);
  expect(rateLimitWait(nonsense, WALL)).toBe(MAX_RETRY_AFTER * 1000);
  const far = limited(false, NOW + 10 * 3600, undefined);
  expect(rateLimitWait(far, WALL)).toBe(MAX_RETRY_AFTER * 1000);
});

test('a locked keychain is waited out not lost', () => {
  const locked: GithubErrorDetail = {
    kind: 'tokenUnavailable',
    message: 'the Keychain is locked',
  };
  expect(retryOf(locked, WALL)).toEqual({ kind: 'later', atLeast: undefined });
  const gone: GithubErrorDetail = { kind: 'notFound', message: 'Not Found' };
  expect(retryOf(gone, WALL)).toEqual({ kind: 'never' });
  const refused: GithubErrorDetail = { kind: 'unauthorized', message: 'Bad credentials' };
  expect(retryOf(refused, WALL)).toEqual({ kind: 'never' });
});

test('a rate limit is waited out until github says', () => {
  expect(atLeast(limited(true, NOW + 600, 60))).toBe(60_000);
  expect(atLeast(limited(false, NOW + 600, undefined))).toBe(600_000);
  // A secondary limit that says nothing waits a minute.
  expect(atLeast(limited(true, undefined, undefined))).toBe(60_000);
  // A reset in the past waits nothing more.
  expect(atLeast(limited(false, NOW - 5, undefined))).toBe(0);
});
