import { describe, expect, it } from 'vitest';

import type { LocalState, PullView } from '../contract.ts';
import { ago, bannersFor, inWords, span, type Clock } from './banners.ts';

const HEAD = '5530830f535b2947f1b50a184dc58a9c7b2845ad';
const FIRST = '45e4f22d09ea29631f43d3f8c1e05b7fb4001099';

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
  bannersFor(pull, local, 'rozed-dev/e2e', clock).map((banner) => banner.id);

describe('a pull request’s banners', () => {
  it('say nothing while all is well', () => {
    expect(ids(view())).toEqual([]);
    expect(ids(view(), { kind: 'waiting' })).toEqual([]);
  });

  it("say a pull request can't be opened, with a way to try again", () => {
    const [banner] = bannersFor(
      view({
        problem: { kind: 'notFound', message: 'GitHub has no pull request rozed-dev/e2e#9.' },
      }),
      { kind: 'waiting' },
      'rozed-dev/e2e',
      clock,
    );
    expect(banner).toEqual({
      id: 'notFound',
      tone: 'danger',
      title: "Lo can't open this pull request.",
      detail: 'GitHub has no pull request rozed-dev/e2e#9.',
      actions: [{ label: 'Try again', do: { kind: 'retry' } }],
    });
  });

  it("offer GitHub's link to fix single sign-on, and each account that can see it", () => {
    const blocked = bannersFor(
      view({
        problem: {
          kind: 'blocked',
          message: 'The rozed-dev organization needs single sign-on.',
          links: [{ label: 'Authorize on GitHub', url: 'https://github.com/orgs/rozed-dev/sso' }],
        },
      }),
      ready,
      'rozed-dev/e2e',
      clock,
    );
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
      'rozed-dev/e2e',
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
      'rozed-dev/e2e',
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
      'rozed-dev/e2e',
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
        'rozed-dev/e2e',
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
      message: "can't fetch pull request #78: the network failed",
      attempt: 2,
      retryAt: clock.now + 12_000,
    };
    expect(bannersFor(view(), retrying, 'rozed-dev/e2e', clock)[0]).toMatchObject({
      tone: 'warn',
      detail:
        "Can't fetch pull request #78: the network failed. Lo tries again in 12 s, attempt 3.",
      actions: [{ label: 'Retry now', do: { kind: 'retry' } }],
    });
    const offline = view({
      connection: { kind: 'offline', savedAt: null, retryAt: null, error: 'x' },
    });
    expect(ids(offline, retrying)).toEqual(['offline']);
    expect(
      ids(view(), { kind: 'failed', failure: 'diskFull', message: 'the disk is full' }),
    ).toEqual(['local']);
    expect(
      bannersFor(
        view(),
        { kind: 'failed', failure: 'diskFull', message: 'x' },
        'rozed-dev/e2e',
        clock,
      )[0]?.title,
    ).toBe("The disk is full, so Lo can't save the local copy.");
    expect(
      bannersFor(
        view(),
        { kind: 'failed', failure: 'diskFull', message: 'x' },
        'rozed-dev/e2e',
        clock,
      )[0]?.actions,
    ).toEqual([
      { label: 'Clear the cache', do: { kind: 'clearCache' } },
      { label: 'Try again', do: { kind: 'retry' } },
    ]);
    expect(
      bannersFor(
        view(),
        { kind: 'noGit', message: "Lo can't find git.", install: 'Get it.' },
        'rozed-dev/e2e',
        clock,
      )[0]?.actions,
    ).toEqual([{ label: 'Check again', do: { kind: 'retry' } }]);
    expect(
      ids(view(), { kind: 'noGit', message: "Lo can't find git.", install: 'Get it.' }),
    ).toEqual(['noGit']);
  });

  it('offer the newer push, and keep the most urgent first', () => {
    const newer = view({ shown: FIRST, newer: HEAD });
    expect(bannersFor(newer, ready, 'rozed-dev/e2e', clock)).toEqual([
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
          problem: { kind: 'failed', message: 'x', retryAt: null },
        }),
        { kind: 'failed', failure: 'other', message: 'x' },
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
  const noteFor = (pull: PullView) => bannersFor(pull, ready, 'rozed-dev/e2e', clockAt);

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
          message: 'Resource protected by organization SAML enforcement.',
          links: [
            {
              label: 'Authorize on GitHub',
              url: 'https://github.com/orgs/acme/sso?authorization_request=A1',
            },
          ],
        },
      }),
    );
    expect(failed?.title).toBe('Resource protected by organization SAML enforcement.');
    expect(failed?.actions[0]).toEqual({
      label: 'Authorize on GitHub',
      do: { kind: 'link', url: 'https://github.com/orgs/acme/sso?authorization_request=A1' },
    });
  });
});
