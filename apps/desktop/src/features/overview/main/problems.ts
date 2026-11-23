// What reading an overview ran into, as the tab says it, and when to try again: sorted as a pull
// request's tab sorts what reading it ran into. Nothing here calls Electron or keeps state.

import { causeOf, githubErrorIn, saidBy } from '@lo/github';

import { githubCause } from '../../../ipc/cause.ts';

import type { Acting } from '../../tab/contract.ts';
import type { Problem } from '../contract.ts';

/** The first wait before reading again after a failure, in milliseconds. */
export const FIRST_RETRY = 5_000;
/** The longest wait between tries. */
export const LAST_RETRY = 5 * 60_000;

/** How long to wait after the `failures`th failure in a row: 5 s, doubling, 5 minutes at most. */
export function retryWait(failures: number): number {
  return Math.min(FIRST_RETRY * 2 ** Math.max(0, failures - 1), LAST_RETRY);
}

/**
 * What `error` was, for a tab acting as `acting`, at `now`, after `failures` failures in a row,
 * counting it, reading the overview of a pull request in `owner`'s repository: the problem to say,
 * and how long to wait before reading again. A refusal for the rate limit waits as long as GitHub
 * asked, and anything else {@link retryWait}. An organization that blocks the read is the one
 * GitHub names, else `owner`. Each problem's `message` is what GitHub or the system said, for
 * Details.
 */
export function problemOf(
  error: unknown,
  acting: Acting,
  failures: number,
  now: number,
  owner: string,
): { problem: Problem; wait: number } {
  const github = githubErrorIn(error);
  const wait = retryWait(failures);
  const retryAt = Math.round(now + wait);
  if (github) {
    const { detail } = github;
    if (detail.kind === 'rateLimited') {
      const until =
        detail.retryAfter !== undefined
          ? now + detail.retryAfter * 1000
          : detail.reset !== undefined
            ? detail.reset * 1000
            : now + 60_000;
      const asked = Math.max(wait, until - now);
      return {
        problem: {
          kind: 'rateLimited',
          secondary: detail.secondary,
          retryAt: Math.round(now + asked),
        },
        wait: asked,
      };
    }
    if (detail.kind === 'unauthorized' && acting.kind === 'account') {
      return { problem: { kind: 'signedOut', login: acting.login, retryAt }, wait };
    }
    const link = github.helpLink();
    if (link) {
      const approval = detail.kind === 'oauthAppRestricted';
      return {
        problem: {
          kind: 'blocked',
          why: approval ? 'approval' : 'sso',
          org: (approval ? detail.org : undefined) ?? owner,
          message: github.said(),
          links: [link],
          retryAt,
        },
        wait,
      };
    }
    if (detail.kind === 'network' || detail.kind === 'tokenUnavailable') {
      const login = acting.kind === 'account' ? acting.login : undefined;
      const cause = githubCause(causeOf(error, { login, owner }));
      return { problem: { kind: 'offline', cause, message: github.said(), retryAt }, wait };
    }
  }
  return { problem: { kind: 'failed', message: saidBy(error), retryAt }, wait };
}
