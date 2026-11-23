import { describe, expect, it } from 'vitest';

import type { Cause } from '../../../ipc/cause.ts';
import { timeOfDay } from '../../../window/explain.ts';
import type { LocalState, PullView } from '../contract.ts';
import { ago, bannersFor, inWords, span, type Clock } from './banners.ts';

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

/** Each banner's id, most urgent first. */
const ids = (pull: PullView, local: LocalState = ready) =>
  bannersFor(pull, local, E2E, clock).map((banner) => banner.id);

describe('a pull request’s banners', () => {
  it('say nothing while all is well', () => {
    expect(ids(view())).toEqual([]);
    expect(ids(view(), { kind: 'waiting' })).toEqual([]);
  });

  it("say a pull request can't be opened, with GitHub's page and a way to close the tab", () => {
    const [banner] = bannersFor(
      view({ problem: { kind: 'notFound', cause: MISSING, details: 'Not Found' } }),
      { kind: 'waiting' },
      E2E,
      clock,
    );
    expect(banner).toEqual({
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
    const [signedOut] = bannersFor(
      view({
        acting: { kind: 'anonymous' },
        problem: { kind: 'notFound', cause: { kind: 'private', signedIn: false } },
      }),
      { kind: 'waiting' },
      E2E,
      clock,
    );
    expect(signedOut).toMatchObject({
      detail: 'It doesn’t exist, or it’s private.',
      actions: [{ label: 'Sign in with GitHub…', do: { kind: 'signIn' } }, {}, {}],
    });
  });

  it('say why reading it failed, and when it tries again, with GitHub’s words behind Details', () => {
    const [failed] = bannersFor(
      view({
        problem: {
          kind: 'failed',
          cause: { kind: 'github' },
          details: '500 Internal Server Error',
          retryAt: clock.now + 20_000,
        },
      }),
      { kind: 'waiting' },
      E2E,
      clock,
    );
    expect(failed).toEqual({
      id: 'failed',
      tone: 'danger',
      title: 'Can’t open #9',
      detail: 'GitHub returned an error. Retrying in 20 s.',
      details: '500 Internal Server Error',
      actions: [{ label: 'Try now', do: { kind: 'retry' } }],
    });
  });

  it('offer what the cause calls for: a sign-in, or nothing while the rate limit holds', () => {
    const failed = (cause: Cause) =>
      bannersFor(
        view({ problem: { kind: 'failed', cause, retryAt: clock.now + 5_000 } }),
        { kind: 'waiting' },
        E2E,
        clock,
      )[0];
    // The reset time is the reason: no countdown to the next try, and nothing to press.
    expect(failed({ kind: 'rateLimit', resets: clock.now + 25 * 60_000 })).toMatchObject({
      detail: `GitHub’s rate limit resets at ${timeOfDay(clock.now + 25 * 60_000)}.`,
      actions: [],
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

  it("offer a layer that can't be opened a way back to the pull request its tab opened on", () => {
    // As for a tab that comes back at a layer whose pull request was deleted since.
    const [banner] = bannersFor(
      view({ problem: { kind: 'notFound', cause: MISSING } }),
      { kind: 'waiting' },
      E2E,
      clock,
      84,
    );
    expect(banner?.actions).toEqual([{ label: 'Show #84', do: { kind: 'layer', number: 84 } }]);
  });

  it("offer GitHub's link to fix single sign-on, and each account that can see it", () => {
    const blocked = bannersFor(
      view({
        problem: {
          kind: 'blocked',
          cause: { kind: 'sso', org: 'rozed-dev' },
          links: [{ label: 'Authorize on GitHub', url: 'https://github.com/orgs/rozed-dev/sso' }],
        },
      }),
      ready,
      E2E,
      clock,
    );
    expect(blocked[0]).toMatchObject({
      title: 'Can’t open #9',
      detail: 'rozed-dev requires single sign-on.',
    });
    expect(blocked[0]?.actions).toEqual([
      {
        label: 'Authorize on GitHub',
        do: { kind: 'link', url: 'https://github.com/orgs/rozed-dev/sso' },
      },
      { label: 'Try again', do: { kind: 'retry' } },
    ]);
    const ask = bannersFor(
      view({ acting: null, problem: { kind: 'ask', logins: ['rozed-bot', 'other-bot'] } }),
      { kind: 'waiting' },
      E2E,
      clock,
    );
    expect(ask[0]).toMatchObject({
      title: 'More than one account can see rozed-dev/e2e.',
      actions: [
        { label: 'Use rozed-bot', do: { kind: 'choose', login: 'rozed-bot' } },
        { label: 'Use other-bot', do: { kind: 'choose', login: 'other-bot' } },
      ],
    });
  });

  it('say how the tab stands with GitHub, with when what it shows was saved', () => {
    const [offline] = bannersFor(
      view({
        connection: {
          kind: 'offline',
          savedAt: clock.now - 2 * 3600_000,
          retryAt: null,
          error: 'x',
        },
      }),
      ready,
      E2E,
      clock,
    );
    expect(offline).toMatchObject({
      tone: 'warn',
      title: "You're offline.",
      detail: 'Showing what Lo saved 2 hours ago.',
    });
    const [limited] = bannersFor(
      view({
        connection: {
          kind: 'rateLimited',
          login: null,
          until: clock.now + 18 * 60_000,
          secondary: false,
        },
      }),
      ready,
      E2E,
      clock,
    );
    expect(limited).toMatchObject({
      title: "GitHub's rate limit without signing in is used up.",
      detail: `Nothing updates until it resets at at ${clock.now + 18 * 60_000}, in 18 minutes.`,
    });
    expect(ids(view({ connection: { kind: 'signedOut', login: 'rozed-bot' } }))).toEqual([
      'signedOut',
    ]);
    // A low limit is the status bar's.
    expect(ids(view({ connection: { kind: 'limitLow', remaining: 9, reset: 1 } }))).toEqual([]);
  });

  it('say what the local copy is doing, and leave a fetch offline stopped to the offline banner', () => {
    expect(
      bannersFor(
        view(),
        { kind: 'fetching', progress: 'receiving objects, 44% of 1234', attempt: 1 },
        E2E,
        clock,
      )[0],
    ).toMatchObject({
      tone: 'info',
      title: 'Fetching a local copy of rozed-dev/e2e.',
      detail: 'Receiving objects, 44% of 1234',
    });
    const retrying: LocalState = {
      kind: 'retrying',
      failure: 'network',
      details: 'fatal: unable to access',
      attempt: 2,
      retryAt: clock.now + 12_000,
    };
    expect(bannersFor(view(), retrying, E2E, clock)[0]).toMatchObject({
      tone: 'warn',
      title: 'Can’t fetch the local copy',
      detail: 'Offline. Retrying in 12 s.',
      details: 'fatal: unable to access',
      actions: [{ label: 'Try now', do: { kind: 'retry' } }],
    });
    const offline = view({
      connection: { kind: 'offline', savedAt: null, retryAt: null, error: 'x' },
    });
    expect(ids(offline, retrying)).toEqual(['offline']);
    expect(ids(view(), { kind: 'failed', failure: 'diskFull' })).toEqual(['local']);
    expect(
      bannersFor(view(), { kind: 'failed', failure: 'diskFull' }, E2E, clock)[0],
    ).toMatchObject({
      title: 'Can’t fetch the local copy',
      detail: 'The disk is full.',
      actions: [{ label: 'Clear cache', do: { kind: 'clearCache' } }],
    });
    // A copy held open says what it waits for, with nothing to press and no time, even while
    // main looks again by itself.
    expect(
      bannersFor(
        view(),
        { kind: 'retrying', failure: 'heldByServers', attempt: 1, retryAt: clock.now + 20_000 },
        E2E,
        clock,
      )[0],
    ).toMatchObject({
      title: 'Can’t use the local copy',
      detail: 'It’s made again once its language servers stop.',
      actions: [],
    });
    expect(
      bannersFor(view(), { kind: 'failed', failure: 'heldByTabs' }, E2E, clock)[0],
    ).toMatchObject({
      title: 'Can’t use the local copy',
      detail: 'It’s made again once every tab of rozed-dev/e2e closes.',
      actions: [],
    });
    const noGit: LocalState = {
      kind: 'noGit',
      git: { status: 'missing', install: { commands: ['xcode-select --install'], page: null } },
    };
    // How to install Git is in the banner, to copy, never only behind Details.
    expect(bannersFor(view(), noGit, E2E, clock)[0]).toMatchObject({
      title: 'Can’t find Git',
      commands: ['xcode-select --install'],
      details: undefined,
      actions: [{ label: 'Check again', do: { kind: 'retry' } }],
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
    expect(bannersFor(view(), old, E2E, clock)[0]).toMatchObject({
      title: 'Can’t use Git 2.30.0',
      detail: 'Version 2.41.0 or newer is required.',
      commands: ['sudo apt install git', 'https://git-scm.com/downloads/linux'],
      details: '/usr/bin/git',
    });
    expect(ids(view(), noGit)).toEqual(['noGit']);
  });

  it('offer the newer push, and keep the most urgent first', () => {
    const newer = view({ shown: FIRST, newer: HEAD });
    expect(bannersFor(newer, ready, E2E, clock)).toEqual([
      {
        id: 'newer',
        tone: 'info',
        title: 'There’s a newer push.',
        detail: "You're reading 45e4f22, and it stays on screen until you load the newer one.",
        actions: [{ label: 'Load the newer push', do: { kind: 'reload' } }],
      },
    ]);
    expect(
      ids(
        view({
          shown: FIRST,
          newer: HEAD,
          connection: { kind: 'offline', savedAt: null, retryAt: null, error: 'x' },
          problem: { kind: 'failed', cause: { kind: 'unknown' }, retryAt: null },
        }),
        { kind: 'failed', failure: 'other' },
      ),
    ).toEqual(['failed', 'offline', 'local', 'newer']);
  });
});

describe('a wait', () => {
  it('reads in seconds under a minute, and in whole minutes or hours after, rounded up', () => {
    expect([0, 999, 12_000, 60_000, 61_000, 3_599_000, 3_600_000, 7_200_000].map(span)).toEqual([
      '1 s',
      '1 s',
      '12 s',
      'a minute',
      '2 minutes',
      'an hour',
      'an hour',
      '2 hours',
    ]);
  });
});

describe('poll state', () => {
  const NOW = 1_000_000_000;
  const at = (seconds: number) => NOW + seconds * 1000;
  const clockAt: Clock = { now: NOW, time: (time) => `at ${time}` };
  const noteFor = (pull: PullView) => bannersFor(pull, ready, E2E, clockAt);

  it('ages read in words', () => {
    const before = (seconds: number) => ago(at(-seconds), NOW);
    expect(before(0)).toBe('just now');
    expect(before(59)).toBe('just now');
    expect(before(60)).toBe('a minute ago');
    expect(before(150)).toBe('2 minutes ago');
    expect(before(3_600)).toBe('an hour ago');
    expect(before(7_300)).toBe('2 hours ago');
    expect(before(86_400 + 3)).toBe('a day ago');
    // A clock that went back.
    expect(ago(at(5), NOW)).toBe('just now');
    expect(inWords(at(30), NOW)).toBe('in a moment');
    expect(inWords(at(300), NOW)).toBe('in 5 minutes');
    expect(inWords(at(-300), NOW)).toBe('in a moment');
  });

  it('polling that goes well says nothing', () => {
    expect(noteFor(view())).toEqual([]);
  });

  it('a signed out account asks to sign in again', () => {
    expect(noteFor(view({ connection: { kind: 'signedOut', login: 'rozed-bot' } }))).toEqual([
      {
        id: 'signedOut',
        tone: 'danger',
        title: 'rozed-bot is signed out.',
        detail: "GitHub refused rozed-bot's token. Sign in to it again to see what's changed.",
        actions: [],
      },
    ]);
  });

  it('a used up rate limit says when it resets', () => {
    const paused = (secondary: boolean) =>
      noteFor(
        view({
          connection: { kind: 'rateLimited', login: 'rozed-bot', until: at(25 * 60), secondary },
        }),
      )[0];
    expect(paused(false)).toMatchObject({
      tone: 'warn',
      title: "GitHub's rate limit for rozed-bot is used up.",
      detail: `Nothing updates until it resets at at ${at(25 * 60)}, in 25 minutes.`,
    });
    expect(paused(true)?.title).toBe('GitHub asked Lo to slow down.');
    // Running low says so in the status bar, not in a banner.
    expect(
      noteFor(view({ connection: { kind: 'limitLow', remaining: 100, reset: at(2 * 3_600) } })),
    ).toEqual([]);
  });

  it('offline says how old the details are and when it tries again', () => {
    const [offline] = noteFor(
      view({
        connection: {
          kind: 'offline',
          savedAt: at(-2 * 3_600),
          retryAt: at(2 * 60),
          error: 'the network is down',
        },
      }),
    );
    expect(offline).toEqual({
      id: 'offline',
      tone: 'warn',
      title: "You're offline.",
      detail: 'Showing what Lo saved 2 hours ago. Lo tries again in 2 minutes.',
      actions: [{ label: 'Try again', do: { kind: 'retry' } }],
    });
  });

  it("a failed poll says why with github's link", () => {
    const [failed] = noteFor(
      view({
        problem: {
          kind: 'blocked',
          cause: { kind: 'sso', org: 'acme' },
          details: 'Resource protected by organization SAML enforcement.',
          links: [
            {
              label: 'Authorize on GitHub',
              url: 'https://github.com/orgs/acme/sso?authorization_request=A1',
            },
          ],
        },
      }),
    );
    expect(failed?.title).toBe('Can’t open #9');
    expect(failed?.details).toBe('Resource protected by organization SAML enforcement.');
    expect(failed?.actions[0]).toEqual({
      label: 'Authorize on GitHub',
      do: { kind: 'link', url: 'https://github.com/orgs/acme/sso?authorization_request=A1' },
    });
  });
});
