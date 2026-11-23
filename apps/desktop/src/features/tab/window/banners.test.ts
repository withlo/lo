import { describe, expect, it } from 'vitest';

import type { LocalState, PullView } from '../contract.ts';
import {
  accountChoice,
  ago,
  bannersFor,
  connectionNote,
  failureOf,
  localNote,
  span,
  type Clock,
} from './banners.ts';

const HEAD = '5530830f535b2947f1b50a184dc58a9c7b2845ad';
const FIRST = '45e4f22d09ea29631f43d3f8c1e05b7fb4001099';

/** The pull request the tab shows. */
const E2E = { owner: 'rozed-dev', repo: 'e2e', number: 9 };

/** What GitHub has no such pull request, or hides from rozed-bot, comes to. */
const MISSING = { kind: 'hidden', login: 'rozed-bot' } as const;

const clock: Clock = {
  now: 1_000_000,
  time: (at) => `at ${at}`,
};

const view = (change: Partial<PullView> = {}): PullView => ({
  id: 't1',
  loading: false,
  acting: { kind: 'account', login: 'rozed-bot' },
  header: null,
  connection: { kind: 'live' },
  problem: null,
  shown: HEAD,
  newer: null,
  ...change,
});

const ready: LocalState = {
  kind: 'ready',
  head: HEAD,
  base: HEAD,
  mergeBase: null,
  offline: false,
};

describe('a pull request’s tab that can’t show it', () => {
  it('says nothing while it can', () => {
    expect(failureOf(view(), E2E)).toBe(undefined);
    expect(failureOf(undefined, E2E)).toBe(undefined);
  });

  it("says it can't open the pull request, with GitHub's page and a way to close the tab", () => {
    expect(
      failureOf(view({ problem: { kind: 'notFound', cause: MISSING, details: 'Not Found' } }), E2E),
    ).toEqual({
      id: 'notFound',
      tone: 'danger',
      title: 'Can’t open #9',
      detail: 'It doesn’t exist, or rozed-bot can’t see it.',
      details: 'Not Found',
      actions: [
        {
          label: 'Open on GitHub',
          do: { kind: 'link', url: 'https://github.com/rozed-dev/e2e/pull/9' },
        },
        { label: 'Close tab', do: { kind: 'close' } },
      ],
    });
    // With nobody signed in, signing in may show it.
    expect(
      failureOf(
        view({
          acting: { kind: 'anonymous' },
          problem: { kind: 'notFound', cause: { kind: 'private', signedIn: false } },
        }),
        E2E,
      ),
    ).toMatchObject({
      detail: 'It doesn’t exist, or it’s private.',
      actions: [{ label: 'Sign in with GitHub…', do: { kind: 'signIn' } }, {}, {}],
    });
  });

  it("offers a layer that can't be opened a way back to the pull request its tab opened on", () => {
    // As for a tab that comes back at a layer whose pull request was deleted since.
    const failed = failureOf(view({ problem: { kind: 'notFound', cause: MISSING } }), E2E, 84);
    expect(failed?.actions).toEqual([{ label: 'Show #84', do: { kind: 'layer', number: 84 } }]);
  });

  it("offers GitHub's link to fix single sign-on first", () => {
    const blocked = failureOf(
      view({
        problem: {
          kind: 'blocked',
          cause: { kind: 'sso', org: 'rozed-dev' },
          details: 'Resource protected by organization SAML enforcement.',
          links: [{ label: 'Authorize on GitHub', url: 'https://github.com/orgs/rozed-dev/sso' }],
        },
      }),
      E2E,
    );
    expect(blocked).toMatchObject({
      title: 'Can’t open #9',
      detail: 'rozed-dev requires single sign-on.',
      details: 'Resource protected by organization SAML enforcement.',
    });
    expect(blocked?.actions).toEqual([
      {
        label: 'Authorize on GitHub',
        do: { kind: 'link', url: 'https://github.com/orgs/rozed-dev/sso' },
      },
      { label: 'Try again', do: { kind: 'retry' } },
    ]);
  });

  it('counts down to the next try, offers to try now meanwhile, and keeps GitHub’s words for Details', () => {
    expect(
      failureOf(
        view({
          problem: {
            kind: 'failed',
            cause: { kind: 'github' },
            details: '500 Internal Server Error',
            retryAt: 1_020_000,
          },
        }),
        E2E,
      ),
    ).toEqual({
      id: 'failed',
      tone: 'danger',
      title: 'Can’t open #9',
      detail: 'GitHub returned an error.',
      retryAt: 1_020_000,
      details: '500 Internal Server Error',
      actions: [{ label: 'Try now', do: { kind: 'retry' } }],
    });
    const stopped = failureOf(
      view({ problem: { kind: 'failed', cause: { kind: 'unknown' }, retryAt: null } }),
      E2E,
    );
    expect(stopped?.retryAt).toBe(undefined);
    expect(stopped?.actions).toEqual([{ label: 'Try again', do: { kind: 'retry' } }]);
  });

  it('asks which account to open it as, when several can see it, rather than failing', () => {
    const asking = view({
      acting: null,
      problem: { kind: 'ask', logins: ['rozed-bot', 'other'] },
    });
    expect(failureOf(asking, E2E)).toBe(undefined);
    expect(accountChoice(asking, E2E)).toEqual({
      title: 'Choose an account for #9',
      line: '2 of your accounts can see it. Remembered for every rozed-dev repo.',
      logins: ['rozed-bot', 'other'],
    });
    expect(accountChoice(view(), E2E)).toBe(undefined);
  });
});

describe('how a tab stands with GitHub', () => {
  const NOW = 1_000_000_000;
  const at = (seconds: number) => NOW + seconds * 1000;
  const clockAt: Clock = { now: NOW, time: (time) => `at ${time}` };

  it('says nothing while all is well, or while the rate limit only runs low', () => {
    expect(connectionNote({ kind: 'live' }, clockAt)).toBe(undefined);
    expect(connectionNote(undefined, clockAt)).toBe(undefined);
    expect(connectionNote({ kind: 'limitLow', remaining: 9, reset: 1 }, clockAt)).toBe(undefined);
  });

  it('says an account is signed out, and offers to sign in again', () => {
    expect(connectionNote({ kind: 'signedOut', login: 'rozed-bot' }, clockAt)).toEqual({
      tone: 'danger',
      label: 'Signed out',
      line: 'rozed-bot is signed out.',
      action: { label: 'Sign in again', do: { kind: 'signIn' } },
    });
  });

  it('says when a used up rate limit resets, in one wording whoever it’s for', () => {
    const paused = (secondary: boolean, login: string | null) =>
      connectionNote({ kind: 'rateLimited', login, until: at(25 * 60), secondary }, clockAt);
    expect(paused(false, 'rozed-bot')).toEqual({
      tone: 'warn',
      label: 'Rate limit reached',
      line: `GitHub’s rate limit resets at at ${at(25 * 60)}.`,
    });
    expect(paused(true, null)).toEqual(paused(false, 'rozed-bot'));
  });

  it('says offline, when it last heard from GitHub, and when it tries again', () => {
    expect(
      connectionNote(
        { kind: 'offline', savedAt: at(-2 * 3_600), retryAt: at(2 * 60), error: 'ENOTFOUND' },
        clockAt,
      ),
    ).toEqual({
      tone: 'warn',
      label: 'Offline',
      line: 'Offline.',
      retryAt: at(2 * 60),
      checked: at(-2 * 3_600),
      details: 'ENOTFOUND',
      action: { label: 'Try now', do: { kind: 'retry' } },
    });
    expect(
      connectionNote({ kind: 'offline', savedAt: null, retryAt: null, error: '' }, clockAt),
    ).toEqual({
      tone: 'warn',
      label: 'Offline',
      line: 'Offline.',
      action: { label: 'Try again', do: { kind: 'retry' } },
    });
  });
});

describe('the local copy’s item', () => {
  const local = (state: LocalState | undefined, pull: PullView = view()) =>
    localNote(state, pull, E2E);

  it('is a ring until it fetches, then counts, then is filled at its head', () => {
    expect(local(undefined)).toBe(undefined);
    expect(local({ kind: 'waiting' })).toEqual({ ball: 'off', label: 'Local copy' });
    expect(
      local({ kind: 'fetching', progress: 'receiving objects, 44% of 1234', attempt: 1 }),
    ).toEqual({ ball: 'working', label: 'Fetching local copy · 44%' });
    expect(local({ kind: 'fetching', progress: 'connecting to GitHub', attempt: 1 })).toEqual({
      ball: 'working',
      label: 'Fetching local copy…',
    });
    expect(local(ready)).toEqual({ ball: 'ready', label: 'Local copy', at: '5530830' });
    expect(local({ ...ready, offline: true })).toMatchObject({
      ball: 'warn',
      label: 'Local copy · offline',
    });
  });

  it('says it can’t fetch for as long as it can’t, with why, the one thing to do and Git’s words', () => {
    const retrying: LocalState = {
      kind: 'retrying',
      failure: 'timedOut',
      details: 'fatal: the remote end hung up',
      attempt: 2,
      retryAt: clock.now + 12_000,
    };
    expect(local(retrying)).toEqual({
      ball: 'failed',
      label: 'Can’t fetch the local copy',
      problem: {
        id: 'local',
        tone: 'warn',
        title: 'Can’t fetch the local copy',
        detail: 'GitHub didn’t respond.',
        retryAt: clock.now + 12_000,
        details: 'fatal: the remote end hung up',
        actions: [{ label: 'Try now', do: { kind: 'retry' } }],
      },
    });
    expect(local({ kind: 'failed', failure: 'diskFull' })?.problem).toMatchObject({
      detail: 'The disk is full.',
      actions: [{ label: 'Clear cache', do: { kind: 'clearCache' } }],
    });
    expect(local({ kind: 'failed', failure: 'repoNotFound' })?.problem).toMatchObject({
      detail: 'rozed-dev/e2e doesn’t exist, or rozed-bot can’t see it.',
      actions: [{ label: 'Try again', do: { kind: 'retry' } }],
    });
    expect(local({ kind: 'failed', failure: 'auth' })?.problem?.actions).toEqual([
      { label: 'Sign in with GitHub…', do: { kind: 'signIn' } },
    ]);
    // A copy held open says what it waits for, with nothing to press.
    expect(local({ kind: 'failed', failure: 'heldByTabs' })).toMatchObject({
      label: 'Can’t use the local copy',
      problem: {
        title: 'Can’t use the local copy',
        detail: 'It’s made again once every tab of rozed-dev/e2e closes.',
        actions: [],
      },
    });
    const noGit: LocalState = {
      kind: 'noGit',
      git: { status: 'missing', install: { commands: ['xcode-select --install'], page: null } },
    };
    expect(local(noGit)).toMatchObject({
      ball: 'failed',
      label: 'Can’t find Git',
      problem: {
        title: 'Can’t find Git',
        details: 'xcode-select --install',
        actions: [{ label: 'Check again', do: { kind: 'retry' } }],
      },
    });
  });

  it('leaves a fetch that stopped offline to the header, which says offline already', () => {
    const retrying: LocalState = {
      kind: 'retrying',
      failure: 'network',
      details: 'fatal: unable to access',
      attempt: 2,
      retryAt: clock.now + 12_000,
    };
    expect(
      local(
        retrying,
        view({ connection: { kind: 'offline', savedAt: null, retryAt: null, error: 'x' } }),
      ),
    ).toEqual({ ball: 'warn', label: 'Local copy · offline' });
    expect(local(retrying)?.problem?.detail).toBe('Offline.');
  });
});

describe('the tab’s banner', () => {
  it('says nothing while the push on screen is the newest', () => {
    expect(bannersFor(view())).toEqual([]);
    expect(bannersFor(undefined)).toEqual([]);
  });

  it('says there’s a newer push in one line, with a way to show it, until it’s dismissed', () => {
    const newer = view({ shown: FIRST, newer: HEAD });
    expect(bannersFor(newer)).toEqual([
      {
        id: 'newer',
        tone: 'info',
        title: 'There’s a newer push',
        actions: [{ label: 'Show latest', do: { kind: 'reload' } }],
      },
    ]);
    expect(bannersFor(newer, HEAD)).toEqual([]);
    // A push newer than the one dismissed is news again.
    expect(bannersFor(newer, FIRST)).toHaveLength(1);
  });
});

describe('a wait', () => {
  it('reads in seconds under a minute, and in whole minutes or hours after, rounded up', () => {
    expect([0, 999, 12_000, 60_000, 61_000, 3_599_000, 3_600_000, 7_200_000].map(span)).toEqual([
      '1 s',
      '1 s',
      '12 s',
      '1 min',
      '2 min',
      '1 h',
      '1 h',
      '2 h',
    ]);
  });

  it('reads how long ago in the same units', () => {
    const NOW = 1_000_000_000;
    const before = (seconds: number) => ago(NOW - seconds * 1000, NOW);
    expect(before(0)).toBe('just now');
    expect(before(59)).toBe('just now');
    expect(before(60)).toBe('1 min ago');
    expect(before(150)).toBe('2 min ago');
    expect(before(3_600)).toBe('1 h ago');
    expect(before(7_300)).toBe('2 h ago');
    expect(before(86_400 + 3)).toBe('1 d ago');
    // A clock that went back.
    expect(ago(NOW + 5000, NOW)).toBe('just now');
  });
});
