import { describe, expect, it } from 'vitest';

import type { Cause } from '../../../ipc/cause.ts';
import { timeOfDay } from '../../../window/explain.ts';
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
      // Another account may see it: signing in with one works out the tab's account again.
      actions: [
        { label: 'Sign in with GitHub…', do: { kind: 'signIn' } },
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

  it('offers what the cause calls for: a sign-in, or nothing while the rate limit holds an account', () => {
    const failed = (cause: Cause) =>
      failureOf(view({ problem: { kind: 'failed', cause, retryAt: clock.now + 5_000 } }), E2E);
    // The reset time is the reason: no countdown to the next try, and nothing to press.
    expect(failed({ kind: 'rateLimit', resets: clock.now + 25 * 60_000 })).toMatchObject({
      detail: `GitHub’s rate limit resets at ${timeOfDay(clock.now + 25 * 60_000)}.`,
      retryAt: undefined,
      actions: [],
    });
    // Read as nobody, a sign-in reads past it, under the account's own limit.
    const nobody = failureOf(
      view({
        acting: { kind: 'anonymous' },
        problem: {
          kind: 'failed',
          cause: { kind: 'rateLimit', resets: clock.now + 25 * 60_000 },
          retryAt: clock.now + 25 * 60_000,
        },
      }),
      E2E,
    );
    expect(nobody).toMatchObject({
      detail: `GitHub’s rate limit resets at ${timeOfDay(clock.now + 25 * 60_000)}.`,
      retryAt: undefined,
      actions: [{ label: 'Sign in with GitHub…', do: { kind: 'signIn' } }],
    });
    expect(failed({ kind: 'signedOut', login: 'rozed-bot' })).toMatchObject({
      detail: 'rozed-bot is signed out.',
      actions: [{ label: 'Sign in again', do: { kind: 'signIn' } }],
    });
    expect(failed({ kind: 'hidden', login: 'rozed-bot' })).toMatchObject({
      detail: 'It doesn’t exist, or rozed-bot can’t see it.',
      actions: [{ label: 'Sign in with GitHub…', do: { kind: 'signIn' } }],
    });
  });

  it('asks which account to open it as, when several can see it, rather than failing', () => {
    const asking = view({
      acting: null,
      problem: { kind: 'ask', logins: ['rozed-bot', 'other'] },
    });
    expect(failureOf(asking, E2E)).toBe(undefined);
    expect(accountChoice(asking, E2E)).toEqual({
      title: 'Choose an account for #9',
      line: '2 of your accounts can see it. The choice is remembered for every rozed-dev repo.',
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
      kind: 'signedOut',
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
      kind: 'rateLimited',
      tone: 'warn',
      label: 'Rate limit reached',
      line: `GitHub’s rate limit resets at at ${at(25 * 60)}.`,
    });
    expect(paused(true, null)).toEqual(paused(false, 'rozed-bot'));
  });

  it('says offline, and when it tries again', () => {
    expect(
      connectionNote(
        { kind: 'offline', retryAt: at(2 * 60), cause: { kind: 'offline' }, error: 'ENOTFOUND' },
        clockAt,
      ),
    ).toEqual({
      kind: 'offline',
      tone: 'warn',
      label: 'Offline',
      line: 'Offline.',
      retryAt: at(2 * 60),
      details: 'ENOTFOUND',
      action: { label: 'Try now', do: { kind: 'retry' } },
    });
    expect(
      connectionNote(
        { kind: 'offline', retryAt: null, cause: { kind: 'offline' }, error: '' },
        clockAt,
      ),
    ).toEqual({
      kind: 'offline',
      tone: 'warn',
      label: 'Offline',
      line: 'Offline.',
      action: { label: 'Try again', do: { kind: 'retry' } },
    });
  });

  it('says “No response” where GitHub took a read and never answered, and why else it gave none', () => {
    const unanswered = (cause: Cause) =>
      connectionNote(
        { kind: 'offline', retryAt: at(20), cause, error: "the answer didn't begin within 15 s" },
        clockAt,
      );
    expect(unanswered({ kind: 'timeout' })).toEqual({
      kind: 'failed',
      tone: 'warn',
      label: 'No response',
      line: 'GitHub didn’t respond.',
      retryAt: at(20),
      details: "the answer didn't begin within 15 s",
      action: { label: 'Try now', do: { kind: 'retry' } },
    });
    // Nothing reached GitHub: offline, with the reason that kept it away.
    expect(unanswered({ kind: 'proxy', why: 'refused' })).toMatchObject({
      kind: 'offline',
      label: 'Offline',
      line: 'The proxy couldn’t connect to GitHub.',
    });
    expect(unanswered({ kind: 'certificate' })).toMatchObject({
      label: 'Offline',
      line: 'GitHub’s certificate couldn’t be verified.',
    });
    // A sign-in that can't be read, and a failure Lo can't name, are no connection lost.
    expect(unanswered({ kind: 'unreadable', login: 'rozed-bot' })).toMatchObject({
      kind: 'failed',
      label: 'Can’t read the sign-in',
    });
    expect(unanswered({ kind: 'unknown' })).toMatchObject({
      kind: 'failed',
      label: 'Can’t reach GitHub',
      line: undefined,
    });
  });
});

/** The local copy's item for #9, as `pull` stands. */
const local = (state: LocalState | undefined, pull: PullView = view()) =>
  localNote(state, pull, E2E);

describe('the local copy’s item', () => {
  it('is a ring until it fetches, then counts, then is filled at its head', () => {
    expect(local(undefined)).toBe(undefined);
    expect(local({ kind: 'waiting' })).toEqual({ ball: 'off', label: 'Local copy' });
    // Its details name what it fetches, with what Git said behind Details.
    expect(
      local({ kind: 'fetching', progress: 'Receiving objects: 44% (543/1234)', attempt: 1 }),
    ).toEqual({
      ball: 'working',
      label: 'Fetching local copy · 44%',
      line: 'Fetching rozed-dev/e2e · 44%',
      said: 'Receiving objects: 44% (543/1234)',
    });
    expect(local({ kind: 'fetching', progress: 'Enumerating objects: 12', attempt: 1 })).toEqual({
      ball: 'working',
      label: 'Fetching local copy…',
      line: 'Fetching rozed-dev/e2e…',
      said: 'Enumerating objects: 12',
    });
    expect(local({ kind: 'fetching', progress: null, attempt: 1 })).toEqual({
      ball: 'working',
      label: 'Fetching local copy…',
      line: 'Fetching rozed-dev/e2e…',
    });
    expect(local(ready)).toEqual({ ball: 'ready', label: 'Local copy', at: '5530830' });
    // Offline, it's there all the same: only the header's chip says offline.
    expect(local({ ...ready, offline: true })).toEqual(local(ready));
  });

  it('says it can’t fetch for as long as it can’t, with why, the one thing to do and Git’s words', () => {
    // Amber while it waits to try again, or for what holds it; red once it failed.
    const retrying: LocalState = {
      kind: 'retrying',
      failure: 'timedOut',
      details: 'fatal: the remote end hung up',
      attempt: 2,
      retryAt: clock.now + 12_000,
    };
    expect(local(retrying)).toEqual({
      ball: 'warn',
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
    expect(local({ kind: 'failed', failure: 'diskFull' })).toMatchObject({ ball: 'failed' });
    expect(local({ kind: 'failed', failure: 'diskFull' })?.problem).toMatchObject({
      detail: 'The disk is full.',
      actions: [{ label: 'Clear cache', do: { kind: 'clearCache' } }],
    });
    expect(local({ kind: 'failed', failure: 'repoNotFound' })?.problem).toMatchObject({
      detail: 'rozed-dev/e2e doesn’t exist, or rozed-bot can’t see it.',
      actions: [{ label: 'Try again', do: { kind: 'retry' } }],
    });
    // A fetch that failed for a reason Git didn't name is GitHub's; one on this computer has no
    // reason line, and Git's words are behind Details.
    expect(
      local({ kind: 'failed', failure: 'other', details: 'fatal: bad pack header' }),
    ).toMatchObject({
      ball: 'failed',
      problem: { detail: 'GitHub returned an error.', details: 'fatal: bad pack header' },
    });
    expect(local({ kind: 'failed', failure: 'local' })?.problem?.detail).toBe(undefined);
    expect(local({ kind: 'failed', failure: 'auth' })?.problem?.actions).toEqual([
      { label: 'Sign in with GitHub…', do: { kind: 'signIn' } },
    ]);
    // A copy held open says what it waits for, with nothing to press and no time, even while
    // main looks again by itself.
    expect(
      local({
        kind: 'retrying',
        failure: 'heldByServers',
        attempt: 1,
        retryAt: clock.now + 20_000,
      }),
    ).toMatchObject({ ball: 'warn' });
    expect(
      local({ kind: 'retrying', failure: 'heldByServers', attempt: 1, retryAt: clock.now + 20_000 })
        ?.problem,
    ).toMatchObject({
      title: 'Can’t use the local copy',
      detail: 'It’s made again once its language servers stop.',
      retryAt: undefined,
      actions: [],
    });
    expect(local({ kind: 'failed', failure: 'heldByTabs' })).toMatchObject({
      ball: 'warn',
      label: 'Can’t use the local copy',
      problem: {
        tone: 'warn',
        title: 'Can’t use the local copy',
        detail: 'It’s made again once every tab of rozed-dev/e2e closes.',
        actions: [],
      },
    });
    const noGit: LocalState = {
      kind: 'noGit',
      git: { status: 'missing', install: { commands: ['xcode-select --install'], page: null } },
    };
    // How to install Git is in the item's details, to copy, never only behind Details.
    expect(local(noGit)).toMatchObject({
      ball: 'failed',
      label: 'Can’t find Git',
      problem: {
        title: 'Can’t find Git',
        commands: ['xcode-select --install'],
        details: undefined,
        actions: [{ label: 'Check again', do: { kind: 'retry' } }],
      },
    });
    const old: LocalState = {
      kind: 'noGit',
      git: {
        status: 'tooOld',
        program: '/usr/bin/git',
        version: '2.30.0',
        minimum: '2.41.0',
        check: 'version',
        install: {
          commands: ['sudo apt install git'],
          page: 'https://git-scm.com/downloads/linux',
        },
      },
    };
    expect(local(old)?.problem).toMatchObject({
      title: 'Can’t use Git 2.30.0',
      detail: 'Version 2.41.0 or newer is required.',
      commands: ['sudo apt install git', 'https://git-scm.com/downloads/linux'],
      details: '/usr/bin/git',
    });
  });

  it('leaves a fetch that stopped offline to the header, which says offline already: it waits', () => {
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
        view({
          connection: { kind: 'offline', retryAt: null, cause: { kind: 'offline' }, error: 'x' },
        }),
      ),
    ).toEqual({ ball: 'warn', label: 'Local copy' });
    expect(local(retrying)?.problem?.detail).toBe('Offline.');
  });
});

describe('the tab’s banner', () => {
  it('says nothing while the push on screen is the newest', () => {
    expect(bannersFor(view())).toEqual([]);
    expect(bannersFor(undefined)).toEqual([]);
  });

  it('says who pushed which revision, with a way to show it, until it’s dismissed', () => {
    const newer = view({ shown: FIRST, newer: HEAD });
    const revisions = [
      { head: FIRST, number: 4, pusher: 'mira-chen' },
      { head: HEAD.toUpperCase(), number: 5, pusher: 'ravi-k' },
    ];
    expect(bannersFor(newer, null, revisions)).toEqual([
      {
        id: 'newer',
        tone: 'info',
        title: 'ravi-k pushed r5',
        actions: [{ label: 'Show r5', do: { kind: 'reload' } }],
      },
    ]);
    expect(bannersFor(newer, HEAD, revisions)).toEqual([]);
    // A push newer than the one dismissed is news again.
    expect(bannersFor(newer, FIRST, revisions)).toHaveLength(1);
  });

  it('says the revision shown is out of date where it can’t say who pushed which', () => {
    const newer = view({ shown: FIRST, newer: HEAD });
    const outOfDate = [
      {
        id: 'newer',
        tone: 'info',
        title: 'This revision is out of date',
        actions: [{ label: 'Show latest', do: { kind: 'reload' } }],
      },
    ];
    // Not yet among the revisions, as before it's loaded.
    expect(bannersFor(newer)).toEqual(outOfDate);
    expect(bannersFor(newer, null, [{ head: FIRST, number: 4, pusher: 'mira-chen' }])).toEqual(
      outOfDate,
    );
    // GitHub doesn't say who pushed it, or it has no number.
    expect(bannersFor(newer, null, [{ head: HEAD, number: 5, pusher: null }])).toEqual(outOfDate);
    expect(bannersFor(newer, null, [{ head: HEAD, number: null, pusher: 'ravi-k' }])).toEqual(
      outOfDate,
    );
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
