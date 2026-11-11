import { renameSync } from 'node:fs';
import { join } from 'node:path';

import {
  GithubClient,
  GithubError,
  Poller,
  Token,
  type GitHubUrls,
  type PullSummary,
  type RepoAccount,
} from '@lo/github';
import { MemoryPollCache, replayFetch } from '@lo/testing';
import { APP_PULL, writeAppRemote } from '@lo/testing/git';
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';

import type { LocalGit } from '../../../main/git.ts';
import { PullTab, type Kept, type TabGithub } from './pull.ts';
import { folder, published, replayGithub, testGit, TOKEN } from './test/support.ts';

const E2E = { owner: 'rozed-dev', repo: 'e2e', number: APP_PULL.number };
const TITLE = "App: the pull request Lo's end-to-end tests open";

/** A tab for `link`, as the watcher makes one, with what it keeps and sends collected. */
function tabFor(options: {
  link?: { owner: string; repo: string; number: number };
  github: TabGithub;
  git: Awaited<ReturnType<typeof testGit>>;
  login?: string;
  repository?: string;
  offlineAfter?: number;
}) {
  const sent = published();
  const kept: Kept[] = [];
  const lines: string[] = [];
  const tab = new PullTab({
    id: 't1',
    link: options.link ?? E2E,
    login: options.login,
    repository: options.repository,
    github: options.github,
    git: options.git,
    publish: sent.publish,
    keep: (change) => kept.push(change),
    log: (line) => lines.push(line),
    offlineAfter: options.offlineAfter,
  });
  return { tab, sent, kept, lines };
}

/** Points every head and base a poller kept in `cache` at the first push's, as before the second. */
function keptFromTheFirstPush(cache: MemoryPollCache): number {
  let changed = 0;
  for (const entry of cache.entries.values()) {
    const value: unknown = entry.value;
    if (typeof value !== 'object' || value === null) continue;
    if ('headRefOid' in value && 'baseRefOid' in value) {
      Object.assign(value, { headRefOid: APP_PULL.firstHead, baseRefOid: APP_PULL.firstBase });
      changed += 1;
    }
    if ('head' in value && 'base' in value) {
      Object.assign(value, {
        head: { ref: 'app/head', sha: APP_PULL.firstHead },
        base: { ref: 'app/base', sha: APP_PULL.firstBase },
      });
      changed += 1;
    }
  }
  return changed;
}

/**
 * A cache from a run that opened the pull request, as before the last push when `stale`, and
 * git with the clone that run fetched.
 */
async function saved(stale: boolean) {
  const cache = new MemoryPollCache();
  const first = replayGithub('app_e2e', { cache });
  const git = await testGit();
  const before = tabFor({ github: first.github, git });
  before.tab.show();
  await expect.poll(() => before.sent.local, { timeout: 40_000 }).toMatchObject({ kind: 'ready' });
  before.tab.close();
  for (const poller of first.pollers.values()) poller.stop();
  if (stale) keptFromTheFirstPush(cache);
  // The repository's list would be asked about with its ETag, which the cassette never was.
  for (const key of cache.entries.keys()) {
    if (!key.split(' ')[1]?.includes('#')) cache.entries.delete(key);
  }
  return { cache, git };
}

/** A tab restored on `cache`, whose first ask for the account's client fails with `error`. */
function restored(cache: MemoryPollCache, git: Awaited<ReturnType<typeof testGit>>, error: Error) {
  const replay = replayGithub('app_e2e', { cache });
  let calls = 0;
  const github: TabGithub = {
    ...replay.github,
    client: (login) => {
      calls += 1;
      return calls === 1 ? Promise.reject(error) : replay.github.client(login);
    },
  };
  const opened = tabFor({ github, git, login: 'rozed-bot', repository: 'rozed-dev/e2e' });
  opened.tab.show();
  return { ...opened, calls: () => calls };
}

/** GitHub's answer to a token it refuses. */
function badCredentials(): Response {
  return new Response(JSON.stringify({ message: 'Bad credentials' }), {
    status: 401,
    headers: { 'content-type': 'application/json' },
  });
}

/** A replay of `cassette` that answers nothing until it's opened. */
function gated(cassette: string) {
  const replay = replayFetch(cassette);
  let opened = false;
  const waiting: (() => void)[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    if (!opened) await new Promise<void>((resolve) => waiting.push(resolve));
    return replay(input, init);
  };
  return {
    fetch,
    open() {
      opened = true;
      for (const resume of waiting.splice(0)) resume();
    },
  };
}

describe('a pull request’s tab', { timeout: 60_000 }, () => {
  it('opens as the account that can see it, with its header, files and local copy at the head it opened at', async () => {
    const { github } = replayGithub('app_e2e');
    const git = await testGit();
    const { tab, sent, kept } = tabFor({ github, git });

    // Nothing is read until it's shown.
    await tab.watch();
    expect(sent.pulls).toEqual([]);
    tab.show();
    expect(sent.pull?.loading).toBe(true);

    await expect.poll(() => sent.local, { timeout: 40_000 }).toMatchObject({ kind: 'ready' });
    expect(sent.local).toEqual({
      kind: 'ready',
      head: APP_PULL.head,
      base: APP_PULL.base,
      // The second push merged the moved base in.
      mergeBase: APP_PULL.base,
      offline: false,
    });
    await expect.poll(() => sent.pull?.header?.author).toBe('rozed-bot');
    expect(sent.pull).toEqual({
      id: 't1',
      loading: false,
      acting: { kind: 'account', login: 'rozed-bot' },
      header: {
        title: TITLE,
        state: 'open',
        author: 'rozed-bot',
        head: { branch: 'app/head', fork: null },
        base: { branch: 'app/base' },
      },
      connection: { kind: 'live' },
      problem: null,
      shown: APP_PULL.head,
      newer: null,
    });
    // What it fetched with is kept with the tab, as is what the strip shows.
    expect(kept).toContainEqual({ login: 'rozed-bot' });
    expect(kept).toContainEqual({ repository: 'rozed-dev/e2e' });
    expect(kept).toContainEqual({ title: TITLE, state: 'open' });
    await expect.poll(() => sent.files.at(-1)?.total).toBe(7);
    expect(
      sent.files
        .at(-1)
        ?.files.map(({ path }) => path)
        .toSorted(),
    ).toEqual([
      'assets/mark.png',
      'data/numbers.txt',
      'pnpm-lock.yaml',
      'src/format.ts',
      'src/legacy.ts',
      'src/parser.ts',
      'src/text/wrap.ts',
    ]);
    // Each is sent once for each change, and never with the token.
    expect(new Set(sent.pulls.map((view) => JSON.stringify(view))).size).toBe(sent.pulls.length);
    expect(JSON.stringify([sent.pulls, sent.files, sent.locals, kept])).not.toContain(TOKEN);
    tab.close();
  });

  it("says a pull request GitHub doesn't have can't be opened, and fetches nothing", async () => {
    const { github } = replayGithub('app_e2e');
    const git = await testGit();
    const { tab, sent } = tabFor({ github, git, link: { ...E2E, number: 9999 } });
    tab.show();
    await expect
      .poll(() => sent.pull?.problem)
      .toEqual({
        kind: 'notFound',
        message: "GitHub has no pull request rozed-dev/e2e#9999, or rozed-bot can't see it.",
      });
    expect(sent.pull?.loading).toBe(false);
    expect(sent.pull?.header).toBe(null);
    expect(sent.local).toEqual({ kind: 'waiting' });
    tab.close();
  });

  it('reads a repository no account can see without signing in, and says when GitHub has no such pull request', async () => {
    const { github } = replayGithub('app_e2e');
    const git = await testGit();
    const { tab, sent, kept } = tabFor({
      github,
      git,
      link: { owner: 'rozed-dev', repo: 'gone', number: 1 },
    });
    tab.show();
    await expect.poll(() => sent.pull?.problem?.kind).toBe('notFound');
    expect(sent.pull?.acting).toEqual({ kind: 'anonymous' });
    expect(sent.pull?.problem).toMatchObject({
      message: expect.stringContaining('GitHub has no public pull request rozed-dev/gone#1'),
    });
    // Nobody is remembered for it.
    expect(kept.filter((change) => change.login !== undefined)).toEqual([]);
    tab.close();
  });

  it('asks which account to use when several can see the repository, and opens as the one chosen', async () => {
    const { github, remembered } = replayGithub('app_e2e', { logins: ['rozed-bot', 'other-bot'] });
    const git = await testGit();
    const { tab, sent, kept } = tabFor({ github, git });
    // Before it asks, nothing is chosen.
    await expect(tab.choose('rozed-bot')).rejects.toThrow("isn't asking");
    tab.show();
    await expect
      .poll(() => sent.pull?.problem)
      .toEqual({
        kind: 'ask',
        logins: ['rozed-bot', 'other-bot'],
      });
    // Only an account it asked about.
    await expect(tab.choose('someone-else')).rejects.toThrow("isn't asking");
    expect(remembered.size).toBe(0);

    await tab.choose('rozed-bot');

    expect(remembered.get('rozed-dev')).toBe('rozed-bot');
    expect(kept).toContainEqual({ login: 'rozed-bot' });
    await expect.poll(() => sent.pull?.header?.title).toBe(TITLE);
    expect(sent.pull?.problem).toBe(null);
    expect(sent.pull?.acting).toEqual({ kind: 'account', login: 'rozed-bot' });
    tab.close();
  });

  it('opens offline as it was: what the poller saved, and what the local copy fetched before', async () => {
    const root = join(folder(), 'cache');
    const cache = new MemoryPollCache();
    const first = replayGithub('app_e2e', { cache });
    const remote = folder();
    const remoteUrl = writeAppRemote(remote);
    const git = await testGit(remoteUrl, root);
    const before = tabFor({ github: first.github, git });
    before.tab.show();
    await expect
      .poll(() => before.sent.local, { timeout: 40_000 })
      .toMatchObject({ kind: 'ready' });
    await expect.poll(() => before.sent.pull?.header?.author).toBe('rozed-bot');
    before.tab.close();
    for (const poller of first.pollers.values()) poller.stop();
    await git.stop();

    // GitHub can't be reached, nor the remote.
    const offline = replayGithub('app_e2e', {
      cache,
      fetch: () => Promise.reject(new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } })),
    });
    renameSync(join(remote, 'rozed-dev'), join(remote, 'away'));
    const gone = await testGit(remoteUrl, root);
    const after = tabFor({
      github: offline.github,
      git: gone,
      login: 'rozed-bot',
      repository: 'rozed-dev/e2e',
      offlineAfter: 2_000,
    });
    after.tab.show();
    // Not at once: one failed poll in a blip says nothing.
    await expect.poll(() => offline.pollers.get('rozed-bot')?.status().offline).toBeDefined();
    expect(after.sent.pull?.connection.kind).toBe('live');

    await expect
      .poll(() => after.sent.local, { timeout: 40_000 })
      .toEqual({
        kind: 'ready',
        head: APP_PULL.head,
        base: APP_PULL.base,
        mergeBase: APP_PULL.base,
        offline: true,
      });
    expect(after.sent.pull?.header?.title).toBe(TITLE);
    expect(after.sent.pull?.shown).toBe(APP_PULL.head);
    await expect.poll(() => after.sent.pull?.connection.kind, { timeout: 10_000 }).toBe('offline');
    expect(after.sent.pull?.connection).toMatchObject({ savedAt: expect.any(Number) });
    expect(after.sent.pull?.problem).toBe(null);
    after.tab.close();
  });

  it("opens at GitHub's head, not the older one a cache from before the last push has", async () => {
    const cache = new MemoryPollCache();
    const first = replayGithub('app_e2e', { cache });
    const git = await testGit();
    const before = tabFor({ github: first.github, git });
    before.tab.show();
    await expect.poll(() => before.sent.pull?.header?.author).toBe('rozed-bot');
    before.tab.close();
    for (const poller of first.pollers.values()) poller.stop();
    expect(keptFromTheFirstPush(cache)).toBeGreaterThan(0);
    // The repository's list too would be asked about with its ETag, which the cassette never was.
    for (const key of cache.entries.keys()) {
      if (!key.split(' ')[1]?.includes('#')) cache.entries.delete(key);
    }

    const again = replayGithub('app_e2e', { cache });
    const after = tabFor({
      github: again.github,
      git,
      login: 'rozed-bot',
      repository: 'rozed-dev/e2e',
    });
    after.tab.show();

    await expect
      .poll(() => after.sent.local, { timeout: 40_000 })
      .toMatchObject({
        kind: 'ready',
        head: APP_PULL.head,
      });
    expect(after.sent.pull?.shown).toBe(APP_PULL.head);
    expect(after.sent.pull?.newer).toBe(null);
    // The cached head was never on screen, nor fetched to be.
    expect(after.sent.pulls.filter(({ shown }) => shown === APP_PULL.firstHead)).toEqual([]);
    expect(
      after.sent.locals.filter(
        ({ state }) => state.kind === 'ready' && state.head !== APP_PULL.head,
      ),
    ).toEqual([]);
    expect(after.sent.pull?.header?.title).toBe(TITLE);
    after.tab.close();
  });

  describe('when the first read of it fails', () => {
    it('shows what it fetched before when the token is refused, and reads again once it works', async () => {
      const { cache, git } = await saved(false);
      const refused = new GithubError({ kind: 'unauthorized', message: 'Bad credentials' });
      const { tab, sent, calls } = restored(cache, git, refused);

      await expect.poll(() => sent.pull?.shown, { timeout: 10_000 }).toBe(APP_PULL.head);
      await expect
        .poll(() => sent.local, { timeout: 40_000 })
        .toMatchObject({ kind: 'ready', head: APP_PULL.head });
      // Read again after a wait, which works now.
      await expect.poll(calls, { timeout: 20_000 }).toBeGreaterThan(1);
      await expect.poll(() => sent.pull?.header?.author, { timeout: 10_000 }).toBe('rozed-bot');
      expect(sent.pull).toMatchObject({ shown: APP_PULL.head, newer: null, problem: null });
      tab.close();
    });

    for (const [why, error] of [
      [
        'a rate limit',
        new GithubError({
          kind: 'rateLimited',
          message: 'slow down',
          secondary: true,
          retryAfter: 1,
        }),
      ],
      [
        'GitHub out of reach',
        new GithubError({ kind: 'network', failure: 'offline', message: 'offline' }),
      ],
    ] as const) {
      it(`shows the cache's older head through ${why}, then GitHub's once it answers, without a newer push`, async () => {
        const { cache, git } = await saved(true);
        const { tab, sent } = restored(cache, git, error);

        await expect.poll(() => sent.pull?.shown, { timeout: 20_000 }).toBe(APP_PULL.head);
        await expect
          .poll(() => sent.local, { timeout: 40_000 })
          .toMatchObject({ kind: 'ready', head: APP_PULL.head });
        // The older head stood in while GitHub couldn't be asked, and went quietly.
        expect(sent.pulls.some(({ shown }) => shown === APP_PULL.firstHead)).toBe(true);
        expect(sent.pulls.filter(({ newer }) => newer !== null)).toEqual([]);
        tab.close();
      });
    }
  });

  it('keeps the head it opened at on screen when GitHub says another, until that one is loaded', async () => {
    const replay = replayGithub('app_e2e');
    const git = await testGit();
    const { tab, sent } = tabFor({ github: replay.github, git });
    tab.show();
    await expect.poll(() => sent.local, { timeout: 40_000 }).toMatchObject({ kind: 'ready' });

    // A poll that brings another head: here, the first push's.
    const poller = replay.pollers.get('rozed-bot');
    const summary: PullSummary = {
      number: APP_PULL.number,
      title: TITLE,
      state: 'open',
      draft: false,
      updated_at: '2026-11-11T14:00:00Z',
      head: { ref: 'app/head', sha: APP_PULL.firstHead },
      base: { ref: 'app/base', sha: APP_PULL.firstBase },
    };
    expect(poller?.watches(tab.pull)).toBe(true);
    replay.pollEvent('rozed-bot', { kind: 'summary', pull: tab.pull, summary });

    await expect.poll(() => sent.pull?.newer).toBe(APP_PULL.firstHead);
    expect(sent.pull?.shown).toBe(APP_PULL.head);
    expect(sent.local).toMatchObject({ kind: 'ready', head: APP_PULL.head });

    tab.reload();

    await expect
      .poll(() => sent.local)
      .toEqual({
        kind: 'ready',
        head: APP_PULL.firstHead,
        base: expect.any(String),
        mergeBase: APP_PULL.firstBase,
        offline: false,
      });
    expect(sent.pull?.shown).toBe(APP_PULL.firstHead);
    expect(sent.pull?.newer).toBe(null);
    tab.close();
  });

  it('keeps a head from the cache on screen once its diff is drawn, and offers GitHub’s as a newer push', async () => {
    const { cache, git } = await saved(true);
    const gate = gated('app_e2e');
    const replay = replayGithub('app_e2e', { cache, fetch: gate.fetch });
    let calls = 0;
    const github: TabGithub = {
      ...replay.github,
      client: (login) => {
        calls += 1;
        return calls === 1 ? Promise.reject(unanswered()) : replay.github.client(login);
      },
    };
    const { tab, sent } = tabFor({ github, git, login: 'rozed-bot', repository: 'rozed-dev/e2e' });
    tab.show();

    // GitHub can't be asked yet: the cache's older head stands in, and the diff is drawn at it.
    await expect.poll(() => sent.pull?.shown, { timeout: 20_000 }).toBe(APP_PULL.firstHead);
    tab.drawn(APP_PULL.firstHead);
    gate.open();

    // GitHub's answer no longer replaces it: it's a newer push to load.
    await expect.poll(() => sent.pull?.newer, { timeout: 40_000 }).toBe(APP_PULL.head);
    expect(sent.pull?.shown).toBe(APP_PULL.firstHead);
    expect(sent.pulls.some(({ shown }) => shown === APP_PULL.head)).toBe(false);
    tab.close();
  });

  it('shows the head a poll brought before it was shown, when it opens while GitHub can’t be reached', async () => {
    // GitHub never answers this test: the poll below is the only head it hears of.
    const replay = replayGithub('app_e2e', { fetch: gated('app_e2e').fetch });
    const github: TabGithub = { ...replay.github, client: () => Promise.reject(unanswered()) };
    const git = await testGit();
    const { tab, sent } = tabFor({ github, git, login: 'rozed-bot', repository: 'rozed-dev/e2e' });
    await tab.watch();
    replay.pollEvent('rozed-bot', {
      kind: 'summary',
      pull: tab.pull,
      summary: {
        number: APP_PULL.number,
        title: TITLE,
        state: 'open',
        draft: false,
        updated_at: '2026-11-11T14:00:00Z',
        head: { ref: 'app/head', sha: APP_PULL.firstHead },
        base: { ref: 'app/base', sha: APP_PULL.firstBase },
      },
    });

    tab.show();

    await expect.poll(() => sent.pull?.shown, { timeout: 10_000 }).toBe(APP_PULL.firstHead);
    tab.close();
  });

  it('reads again once its poller is signed in again after GitHub refuses the token, not on a timer of its own', async () => {
    const replay = replayFetch('app_e2e');
    let answering = false;
    let signedOut = true;
    const fetch: typeof globalThis.fetch = (input, init) =>
      answering ? replay(input, init) : Promise.resolve(badCredentials());
    const client = new GithubClient({
      fetch,
      urls: {
        api: 'https://api.github.com',
        web: 'https://github.com',
        uploads: 'https://uploads.github.com',
      },
      token: new Token(TOKEN),
    });
    const listeners = new Set<() => void>();
    const poller = new Poller({
      accounts: {
        client: () => Promise.resolve(client),
        account: () => ({}),
        isSignedOut: () => signedOut,
        onChange: (listener) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      },
      login: 'rozed-bot',
      cache: new MemoryPollCache(),
    });
    onTestFinished(() => poller.stop());
    let reads = 0;
    const github: TabGithub = {
      ...replayGithub('app_e2e').github,
      client: () => {
        reads += 1;
        return Promise.resolve(client);
      },
      poller: () => Promise.resolve(poller),
    };
    const git = await testGit();
    const { tab, sent } = tabFor({ github, git, login: 'rozed-bot', repository: 'rozed-dev/e2e' });
    tab.show();

    await expect.poll(() => reads, { timeout: 10_000 }).toBe(1);
    await expect.poll(() => poller.status().signedOut, { timeout: 10_000 }).toBe(true);
    // Past the first wait a read of its own would have taken, nothing more is asked.
    await new Promise((resolve) => setTimeout(resolve, 6_500));
    expect(reads).toBe(1);

    // Signed in again: the tab reads at once, and again as the poller hears the pull request.
    answering = true;
    signedOut = false;
    for (const listener of listeners) listener();
    await expect.poll(() => reads, { timeout: 10_000 }).toBeGreaterThanOrEqual(2);
    await expect.poll(() => sent.pull?.header?.author, { timeout: 20_000 }).toBe('rozed-bot');
    tab.close();
  });

  it('works out its account again when the one it acted as is removed', async () => {
    const replay = replayGithub('app_e2e');
    const git = await testGit();
    const { tab, sent, kept } = tabFor({ github: replay.github, git });
    tab.show();
    await expect.poll(() => sent.pull?.header?.title).toBe(TITLE);

    const poller = replay.pollers.get('rozed-bot');
    replay.removeAccount('rozed-bot');
    tab.accountGone('ROZED-BOT');

    expect(kept).toContainEqual({ login: null });
    expect(poller?.watches(tab.pull)).toBe(false);
    // It opens again: with no account left, without signing in, as a public repository.
    await expect.poll(() => sent.pull?.acting).toEqual({ kind: 'anonymous' });
    await expect.poll(() => sent.pull?.header?.title).toBe(TITLE);
    tab.close();
  });

  it('says what reading it ran into, and an organization’s link to fix it', async () => {
    const replay = replayGithub('app_e2e');
    const git = await testGit();
    const { tab, sent } = tabFor({ github: replay.github, git });
    tab.show();
    await expect.poll(() => sent.pull?.header?.title).toBe(TITLE);

    replay.pollEvent('rozed-bot', {
      kind: 'failed',
      target: tab.pull,
      error: new GithubError({
        kind: 'ssoRequired',
        message: 'Resource protected by organization SAML enforcement.',
        url: 'https://github.com/orgs/rozed-dev/sso?authorization_request=x',
      }).detail,
    });

    await expect
      .poll(() => sent.pull?.problem)
      .toEqual({
        kind: 'blocked',
        message: expect.stringContaining('SAML'),
        links: [
          {
            label: 'Authorize on GitHub',
            url: 'https://github.com/orgs/rozed-dev/sso?authorization_request=x',
          },
        ],
      });
    tab.close();
  });
});

/** What a request GitHub never answered fails with. */
function unanswered(): GithubError {
  return new GithubError({
    kind: 'network',
    failure: 'offline',
    message: 'GitHub can’t be reached',
  });
}

/** Does nothing: what a promise not yet settled is settled with. */
function nothing(): void {
  // Replaced once the promise exists.
}

describe('working out the account while GitHub doesn’t answer', () => {
  const URLS: GitHubUrls = {
    api: 'https://api.github.com',
    web: 'https://github.com',
    uploads: 'https://uploads.github.com',
  };
  const status = { status: 'missing', message: "Lo can't find git.", install: 'Get it.' } as const;
  const noGit: LocalGit = {
    status,
    cache: undefined,
    onStatus: () => undefined,
    onCache: () => () => undefined,
    check: () => Promise.resolve(status),
    setCap: () => Promise.resolve(),
  };

  /** GitHub with one account, whose check of the repository `check` answers, counting calls. */
  function lookingUp(check: () => Promise<RepoAccount>) {
    const asked = { count: 0 };
    const github: TabGithub = {
      anonymous: new GithubClient({ fetch: () => Promise.reject(unanswered()), urls: URLS }),
      accounts: () =>
        Promise.resolve([
          {
            account: {
              login: 'rozed-bot',
              userId: 1,
              source: 'deviceFlow',
              scopes: [],
              addedAt: 0,
            },
            signedOut: undefined,
            cantSave: false,
            needsKeyring: false,
          },
        ]),
      client: () => Promise.reject(unanswered()),
      poller: () => Promise.reject(new Error('no poller in this test')),
      accountForRepo: () => {
        asked.count += 1;
        return check();
      },
      rememberAccountForOwner: () => Promise.resolve(),
    };
    return { github, asked };
  }

  /** A tab of the e2e pull request on `github`, with no git. */
  function tabOn(github: TabGithub) {
    const sent = published();
    const tab = new PullTab({
      id: 't1',
      link: E2E,
      github,
      git: noGit,
      publish: sent.publish,
      keep: () => undefined,
      log: () => undefined,
    });
    return { tab, sent };
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  it('asks again after 5 s, doubling each time it gets no answer', async () => {
    vi.useFakeTimers();
    const { github, asked } = lookingUp(() => Promise.reject(unanswered()));
    const { tab, sent } = tabOn(github);
    tab.show();
    await vi.advanceTimersByTimeAsync(0);
    expect(asked.count).toBe(1);
    expect(sent.pull?.problem).toMatchObject({ kind: 'failed', retryAt: Date.now() + 5_000 });

    const counts: number[] = [];
    for (const wait of [5_000, 10_000, 20_000, 40_000]) {
      await vi.advanceTimersByTimeAsync(wait - 1);
      counts.push(asked.count);
      await vi.advanceTimersByTimeAsync(1);
      counts.push(asked.count);
    }
    expect(counts).toEqual([1, 2, 2, 3, 3, 4, 4, 5]);
    tab.close();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(asked.count).toBe(5);
  });

  it('asks nothing more once the tab closes while it waits for an answer', async () => {
    vi.useFakeTimers();
    let fail: (error: unknown) => void = nothing;
    const { github, asked } = lookingUp(
      () =>
        new Promise<RepoAccount>((_resolve, reject) => {
          fail = reject;
        }),
    );
    const { tab } = tabOn(github);
    tab.show();
    await vi.advanceTimersByTimeAsync(0);
    expect(asked.count).toBe(1);

    tab.close();
    fail(unanswered());
    await vi.advanceTimersByTimeAsync(10 * 60_000);

    expect(asked.count).toBe(1);
  });
});
