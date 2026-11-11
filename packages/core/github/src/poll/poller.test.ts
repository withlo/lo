import { expect, test } from 'vitest';

import { GithubError, type GithubErrorDetail } from '../errors.ts';
import type { MergeRefusal } from '../merge-writes.ts';
import { answered } from './poller.ts';

/** A merge Lo didn't send because it couldn't read the stack, which failed as `read`. */
function unchecked(read: GithubErrorDetail): MergeRefusal {
  return { refusal: 'unchecked', read };
}

test('a merge lo didnt send for want of a read answered as the read did', () => {
  const offline: GithubErrorDetail = {
    kind: 'network',
    failure: 'offline',
    message: 'connection refused',
  };
  // GitHub never answered the stack read, so Lo is still offline.
  expect(answered({ ok: false, error: new GithubError(offline) })).toBe(false);
  expect(answered({ ok: true, value: unchecked(offline) })).toBe(false);
  // It answered, if only to refuse.
  expect(answered({ ok: true, value: { refusal: 'draft' } satisfies MergeRefusal })).toBe(true);
  const server: GithubErrorDetail = {
    kind: 'api',
    status: 502,
    message: 'Server Error',
    errors: [],
  };
  expect(answered({ ok: true, value: unchecked(server) })).toBe(true);
});
