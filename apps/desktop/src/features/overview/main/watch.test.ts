// A pull request's tab's overview in main: the ref watched with ETags, base then fork, on the tab's
// cadence; commits read whole before they're shown or offered, with their limits checked before
// any file comes; files kept only once they hash to their IDs; and what was read shown at once the
// next time, offline too.

import { ARTIFACT_READ, LIMITS, SIZE_ONLY } from '@lo/artifact';
import { GithubClient, Token } from '@lo/github';
import { cassette, Replay, replayFetch } from '@lo/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Acting } from '../../tab/contract.ts';
import type { PullTabInfo } from '../../tab/service.ts';
import type { OverviewState } from '../contract.ts';
import { Blobs } from './blobs.ts';
import { SavedRefs } from './saved.ts';
import {
  artifactText,
  database,
  FakeGithub,
  fakeId,
  idOf,
  notFound,
  overview,
  type Item,
} from './test/support.ts';
import { BACKGROUND_EVERY, FOREGROUND_EVERY, OverviewTab } from './watch.ts';

const ROZED: Acting = { kind: 'account', login: 'rozed-bot' };

/** #80's overview, as `testing/fixtures/app.sh` writes it and GitHub served it. */
const E2E = {
  commit: 'ad1cfa3d053a10b8fc8e46ad786f284509e4b8a9',
  artifact: 'a481067b4846c72fa4b637d20e40108b20985b66',
  figure: '9e34eac2018965ce2375440252619e90d6b45b33',
};

/** A pull request's tab as the tab feature tells it, on rozed-dev/e2e. */
function info(overrides: Partial<PullTabInfo> = {}): PullTabInfo {
  return {
    id: 't1',
    repository: { owner: 'rozed-dev', name: 'e2e' },
    number: 5,
    acting: ROZED,
    head: { fork: null },
    shown: fakeId('head'),
    latest: fakeId('head'),
    provisional: false,
    local: { kind: 'waiting' },
    ...overrides,
  };
}

/** A tab's overview reading with `client`, keeping what it reads in `db`, with what it sends. */
function tabWith(client: GithubClient, db = database()) {
  const sent: OverviewState[] = [];
  const lines: string[] = [];
  const blobs = new Blobs(db);
  const saved = new SavedRefs(db);
  const tab = new OverviewTab({
    id: 't1',
    reads: { github: (_acting, request) => request(client), blobs, saved },
    publish: (state) => sent.push(state),
    log: (line) => lines.push(line),
  });
  return { tab, sent, lines, blobs, saved, db, last: () => sent.at(-1) };
}

/** Lets what the tab started run: its reads, and the timers due by now. */
async function settle(): Promise<void> {
  for (let round = 0; round < 5; round++) await vi.advanceTimersByTimeAsync(0);
}

const signedIn = (fetch: typeof globalThis.fetch) =>
  new GithubClient({ fetch, token: new Token('gho_FAKE') });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  vi.setSystemTime(new Date('2026-11-12T00:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('watching', () => {
  it("reads #80's overview, then asks again with its ETag, which costs nothing", async () => {
    const recorded = [cassette('rest_overview_refs_e2e'), cassette('rest_overview_e2e')];
    const fetch = replayFetch(
      new Replay(
        'overview',
        recorded.flatMap(({ interactions }) => interactions.map(({ interaction }) => interaction)),
      ),
    );
    const { tab, last } = tabWith(signedIn(fetch));
    tab.update(info({ number: 80 }), true, true);
    await settle();

    expect(last()).toEqual({
      id: 't1',
      ref: 'refs/lo/pr/80',
      watching: true,
      found: 'commit',
      overview: {
        id: E2E.commit,
        source: 'base',
        repository: { owner: 'rozed-dev', name: 'e2e' },
        byline: { login: 'rozed-bot', name: 'rozed-bot', at: Date.parse('2026-11-11T09:30:00Z') },
        entries: [
          { path: 'artifact.md', kind: 'file', size: 2016, id: E2E.artifact },
          {
            path: 'figures',
            kind: 'folder',
            size: null,
            id: 'ab0d16cb3f2e36a7b0bce947f0f7641ec18817e8',
          },
          { path: 'figures/flow.svg', kind: 'file', size: 1389, id: E2E.figure },
        ],
        truncated: false,
        read: true,
      },
      newer: null,
      saved: false,
      problem: null,
      code: 'waiting',
    });
    const urls = () =>
      fetch.seen.map(({ url }) => url.replace('https://api.github.com/repos/', ''));
    expect(urls()).toEqual([
      'rozed-dev/e2e/git/matching-refs/lo/pr/80',
      `rozed-dev/e2e/commits/${E2E.commit}`,
      'rozed-dev/e2e/git/trees/3691c0b1986fa31d3bca412d2f4d6c1d3379edde?recursive=1',
      `rozed-dev/e2e/git/blobs/${E2E.artifact}`,
    ]);
    expect(fetch.seen.at(-1)?.headers.get('accept')).toBe('application/vnd.github.raw+json');

    // GitHub asked for 5 minutes between reads: then the ref is asked about with its ETag, and
    // GitHub says nothing changed.
    await vi.advanceTimersByTimeAsync(5 * 60_000 - 1);
    expect(urls()).toHaveLength(4);
    await vi.advanceTimersByTimeAsync(1);
    await settle();
    expect(urls()).toHaveLength(5);
    expect(fetch.seen.at(-1)?.headers.get('if-none-match')).toMatch(/^W\/"/);
    expect(last()?.found).toBe('commit');

    // The figure comes once asked for; artifact.md is kept.
    const files = await tab.files(E2E.commit, ['artifact.md', 'figures/flow.svg']);
    expect(files.map((file) => (file.kind === 'file' ? file.size : file.kind))).toEqual([
      2016, 1389,
    ]);
    expect(urls().at(-1)).toBe(`rozed-dev/e2e/git/blobs/${E2E.figure}`);
    expect(urls()).toHaveLength(6);
    tab.close();
  });

  it('reads every 30 s on screen in front, every 5 minutes behind, and not at all hidden', async () => {
    const github = new FakeGithub();
    github.push('rozed-dev/e2e', 5, overview('one', { 'artifact.md': artifactText(5) }));
    const { tab } = tabWith(github.client);
    const reads = () => github.paths().filter((path) => path.includes('matching-refs')).length;

    // Nothing is read until the tab's on screen.
    tab.update(info(), false, true);
    await settle();
    expect(reads()).toBe(0);
    tab.update(info(), true, true);
    await settle();
    expect(reads()).toBe(1);
    await vi.advanceTimersByTimeAsync(FOREGROUND_EVERY - 1);
    expect(reads()).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    await settle();
    expect(reads()).toBe(2);
    // Every one after the first sends its ETag.
    expect(github.asked.filter(({ path }) => path.includes('matching-refs')).at(-1)?.etag).toMatch(
      /^"/,
    );

    // Behind another window, every 5 minutes.
    tab.setForeground(false);
    await vi.advanceTimersByTimeAsync(BACKGROUND_EVERY - 1);
    expect(reads()).toBe(2);
    await vi.advanceTimersByTimeAsync(1);
    await settle();
    expect(reads()).toBe(3);
    // Brought to the front 10 s after a read, it's read 30 s after it.
    await vi.advanceTimersByTimeAsync(10_000);
    tab.setForeground(true);
    await vi.advanceTimersByTimeAsync(FOREGROUND_EVERY - 10_001);
    expect(reads()).toBe(3);
    await vi.advanceTimersByTimeAsync(1);
    await settle();
    expect(reads()).toBe(4);
    // Brought to the front a minute after one, it's read at once.
    tab.setForeground(false);
    await vi.advanceTimersByTimeAsync(60_000);
    tab.setForeground(true);
    await settle();
    expect(reads()).toBe(5);

    // Hidden, it's left alone; shown again, it's read at once.
    tab.update(info(), false, true);
    await vi.advanceTimersByTimeAsync(10 * BACKGROUND_EVERY);
    expect(reads()).toBe(5);
    tab.update(info(), true, true);
    await settle();
    expect(reads()).toBe(6);
    tab.close();
    await vi.advanceTimersByTimeAsync(10 * BACKGROUND_EVERY);
    expect(reads()).toBe(6);
  });

  it("reads no sooner than GitHub's x-poll-interval asks, but at once when shown or in front", async () => {
    const github = new FakeGithub();
    github.pollInterval = '300';
    github.push('rozed-dev/e2e', 5, overview('slow', { 'artifact.md': artifactText(5) }));
    const { tab, last } = tabWith(github.client);
    const reads = () => github.paths().filter((path) => path.includes('matching-refs')).length;
    tab.update(info(), true, true);
    await settle();
    expect(reads()).toBe(1);

    // In front, 5 minutes rather than 30 s; the `304` that follows doesn't say it again, and
    // still counts.
    for (const read of [2, 3]) {
      await vi.advanceTimersByTimeAsync(5 * 60_000 - 1);
      expect(reads()).toBe(read - 1);
      await vi.advanceTimersByTimeAsync(1);
      await settle();
      expect(reads()).toBe(read);
    }
    expect(github.asked.at(-1)?.etag).toMatch(/^"/);

    // A new overview pushed meanwhile still arrives at once as Lo comes to the front, or as the
    // tab is shown.
    const pushed = overview('pushed', { 'artifact.md': artifactText(5, '## tl;dr\n\nNew.\n') });
    github.push('rozed-dev/e2e', 5, pushed);
    tab.setForeground(false);
    await vi.advanceTimersByTimeAsync(60_000);
    tab.setForeground(true);
    await settle();
    expect(reads()).toBe(4);
    expect(last()?.newer?.id).toBe(pushed.commit);
    // Coming to the front again at once reads nothing more.
    tab.setForeground(false);
    tab.setForeground(true);
    await settle();
    expect(reads()).toBe(4);
    tab.update(info(), false, true);
    tab.update(info(), true, true);
    await settle();
    expect(reads()).toBe(5);

    // Once GitHub no longer asks, it's every 30 s again.
    github.pollInterval = undefined;
    github.push('rozed-dev/e2e', 5, overview('again', { 'artifact.md': artifactText(5, 'x') }));
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    await settle();
    expect(reads()).toBe(6);
    await vi.advanceTimersByTimeAsync(FOREGROUND_EVERY);
    await settle();
    expect(reads()).toBe(7);
    tab.close();
  });

  it('waits to read until the tab knows who it acts as and where its head is', async () => {
    const github = new FakeGithub();
    const { tab, last } = tabWith(github.client);
    tab.update(info({ acting: undefined, head: undefined }), true, true);
    tab.update(info({ head: undefined }), true, true);
    await settle();
    expect(github.paths()).toEqual([]);
    expect(last()?.found).toBe('unknown');
    tab.update(info(), true, true);
    await settle();
    expect(github.paths()).toEqual(['rozed-dev/e2e/git/matching-refs/lo/pr/5']);
    expect(last()?.found).toBe('none');
    tab.close();
  });

  it("asks the fork only when the pull request's repository has none", async () => {
    const github = new FakeGithub();
    const fromFork = overview('fork', { 'artifact.md': artifactText(5) });
    github.push('contributor/e2e', 5, fromFork);
    const { tab, last } = tabWith(github.client);
    const forked = info({ head: { fork: { owner: 'contributor', name: 'e2e' } } });
    tab.update(forked, true, true);
    await settle();
    expect(last()?.overview).toMatchObject({
      id: fromFork.commit,
      source: 'fork',
      repository: { owner: 'contributor', name: 'e2e' },
    });
    expect(github.paths()).toEqual([
      'rozed-dev/e2e/git/matching-refs/lo/pr/5',
      'contributor/e2e/git/matching-refs/lo/pr/5',
      `contributor/e2e/commits/${fromFork.commit}`,
      `contributor/e2e/git/trees/${fromFork.tree}?recursive=1`,
      `contributor/e2e/git/blobs/${idOf(artifactText(5))}`,
    ]);

    // Once the repository has one, the fork isn't asked, and the repository's is offered.
    const fromBase = overview('base', { 'artifact.md': artifactText(5, '## tl;dr\n\nNewer.\n') });
    github.push('rozed-dev/e2e', 5, fromBase);
    const before = github.asked.length;
    await vi.advanceTimersByTimeAsync(FOREGROUND_EVERY);
    await settle();
    expect(github.paths().slice(before)[0]).toBe('rozed-dev/e2e/git/matching-refs/lo/pr/5');
    expect(
      github
        .paths()
        .slice(before)
        .some((path) => path.startsWith('contributor/')),
    ).toBe(false);
    expect(last()?.overview?.id).toBe(fromFork.commit);
    expect(last()?.newer).toMatchObject({ id: fromBase.commit, source: 'base' });

    // A fork GitHub no longer has holds none.
    const gone = tabWith(github.client);
    github.answer.set('gone/e2e/git/matching-refs/lo/pr/6', notFound);
    gone.tab.update(
      info({ number: 6, head: { fork: { owner: 'gone', name: 'e2e' } } }),
      true,
      true,
    );
    await settle();
    expect(gone.last()).toMatchObject({ found: 'none', overview: null, problem: null });
    tab.close();
    gone.tab.close();
  });

  it('offers a newer commit, read whole first, and never puts it in place until loaded', async () => {
    const github = new FakeGithub();
    const first = overview('first', { 'artifact.md': artifactText(5) });
    github.push('rozed-dev/e2e', 5, first);
    const { tab, last, saved } = tabWith(github.client);
    tab.update(info(), true, true);
    await settle();
    expect(last()?.overview?.id).toBe(first.commit);

    const second = overview('second', { 'artifact.md': artifactText(5, '## tl;dr\n\nAgain.\n') });
    github.push('rozed-dev/e2e', 5, second);
    await vi.advanceTimersByTimeAsync(FOREGROUND_EVERY);
    await settle();
    expect(last()).toMatchObject({
      overview: { id: first.commit },
      newer: { id: second.commit, read: true },
    });
    // Its text came before it was offered, and it's what's kept for next time.
    expect(github.paths()).toContain(
      `rozed-dev/e2e/git/blobs/${idOf(artifactText(5, '## tl;dr\n\nAgain.\n'))}`,
    );
    expect(saved.get({ repository: 'rozed-dev/e2e', number: 5 })?.id).toBe(second.commit);
    // Either commit's files can be asked for; no other's.
    expect(await tab.files(first.commit, ['artifact.md'])).toMatchObject([{ kind: 'file' }]);
    await expect(tab.files(fakeId('another'), ['artifact.md'])).rejects.toMatchObject({
      code: 'moved',
    });

    tab.load();
    expect(last()).toMatchObject({ overview: { id: second.commit }, newer: null });
    await expect(tab.files(first.commit, ['artifact.md'])).rejects.toMatchObject({
      code: 'moved',
    });

    // The ref going back to the one on screen takes the offer away.
    const third = overview('third', { 'artifact.md': artifactText(5, '## tl;dr\n\nThird.\n') });
    github.push('rozed-dev/e2e', 5, third);
    await vi.advanceTimersByTimeAsync(FOREGROUND_EVERY);
    await settle();
    expect(last()?.newer?.id).toBe(third.commit);
    github.push('rozed-dev/e2e', 5, second);
    await vi.advanceTimersByTimeAsync(FOREGROUND_EVERY);
    await settle();
    expect(last()).toMatchObject({ overview: { id: second.commit }, newer: null });
    tab.close();
  });

  it('keeps the overview on screen when the ref holds none any more, and forgets it for next time', async () => {
    const github = new FakeGithub();
    const made = overview('kept', { 'artifact.md': artifactText(5) });
    github.push('rozed-dev/e2e', 5, made);
    const { tab, last, saved } = tabWith(github.client);
    tab.update(info(), true, true);
    await settle();
    github.remove('rozed-dev/e2e', 5);
    await vi.advanceTimersByTimeAsync(FOREGROUND_EVERY);
    await settle();
    expect(last()).toMatchObject({ found: 'none', overview: { id: made.commit }, newer: null });
    expect(saved.get({ repository: 'rozed-dev/e2e', number: 5 })).toBeUndefined();
    tab.close();
  });

  it('takes a ref that holds a tag, a tree or a blob for no overview, and reads nothing of it', async () => {
    for (const type of ['tag', 'tree', 'blob']) {
      const github = new FakeGithub();
      github.point('rozed-dev/e2e', 5, fakeId(type), type);
      // Were it asked, the fork would have one.
      github.push('contributor/e2e', 5, overview('fork', { 'artifact.md': artifactText(5) }));
      const { tab, last } = tabWith(github.client);
      tab.update(info({ head: { fork: { owner: 'contributor', name: 'e2e' } } }), true, true);
      await settle();
      expect(last()).toMatchObject({ found: 'notCommit', overview: null, problem: null });
      expect(github.paths()).toEqual(['rozed-dev/e2e/git/matching-refs/lo/pr/5']);
      tab.close();
    }
  });

  it('reads a public pull request once without an account, and never watches it', async () => {
    const github = new FakeGithub();
    github.push('rozed-dev/e2e', 5, overview('public', { 'artifact.md': artifactText(5) }));
    const { tab, last } = tabWith(github.client);
    tab.update(info({ acting: { kind: 'anonymous' } }), true, true);
    await settle();
    expect(last()).toMatchObject({ watching: false, found: 'commit' });
    const asked = github.asked.length;
    await vi.advanceTimersByTimeAsync(10 * BACKGROUND_EVERY);
    tab.update(info({ acting: { kind: 'anonymous' } }), false, true);
    tab.update(info({ acting: { kind: 'anonymous' } }), true, true);
    await settle();
    expect(github.asked.length).toBe(asked);
    tab.close();
  });
});

describe('failing', () => {
  it('tries again after 5 s, doubling to 5 minutes, saying why, while the tab is on screen', async () => {
    const github = new FakeGithub();
    github.answer.set('rozed-dev/e2e/git/matching-refs/lo/pr/5', () => {
      throw new TypeError('fetch failed', {
        cause: Object.assign(new Error('x'), { code: 'ENOTFOUND' }),
      });
    });
    const { tab, last } = tabWith(github.client);
    tab.update(info(), true, true);
    await settle();
    expect(last()?.problem).toEqual({
      kind: 'offline',
      message: expect.stringContaining('fetch failed'),
      retryAt: Date.now() + 5_000,
    });
    const counts: number[] = [];
    for (const wait of [5_000, 10_000, 20_000, 40_000, 80_000, 160_000, 300_000, 300_000]) {
      await vi.advanceTimersByTimeAsync(wait - 1);
      counts.push(github.asked.length);
      await vi.advanceTimersByTimeAsync(1);
      await settle();
      counts.push(github.asked.length);
    }
    expect(counts).toEqual([1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9]);

    // Hidden, it waits; asked to, it tries now, from 5 s again.
    tab.update(info(), false, true);
    await vi.advanceTimersByTimeAsync(10 * BACKGROUND_EVERY);
    expect(github.asked.length).toBe(9);
    tab.update(info(), true, true);
    await settle();
    expect(github.asked.length).toBe(10);
    tab.retry();
    await settle();
    expect(github.asked.length).toBe(11);
    expect(last()?.problem?.retryAt).toBe(Date.now() + 5_000);

    // Once it reads, the problem goes.
    github.answer.delete('rozed-dev/e2e/git/matching-refs/lo/pr/5');
    await vi.advanceTimersByTimeAsync(5_000);
    await settle();
    expect(last()).toMatchObject({ found: 'none', problem: null });
    tab.close();
  });

  it('says an account is signed out, an organization blocks it, or the rate limit is used up', async () => {
    const path = 'rozed-dev/e2e/git/matching-refs/lo/pr/5';
    const cases: [() => Response, unknown][] = [
      [
        () => Response.json({ message: 'Bad credentials' }, { status: 401 }),
        { kind: 'signedOut', login: 'rozed-bot', retryAt: Date.now() + 5_000 },
      ],
      [
        () =>
          Response.json(
            { message: 'Resource protected by organization SAML enforcement.' },
            {
              status: 403,
              headers: {
                'x-github-sso':
                  'required; url=https://github.com/orgs/rozed-dev/sso?authorization_request=x',
              },
            },
          ),
        {
          kind: 'blocked',
          message: 'Resource protected by organization SAML enforcement.',
          links: [
            {
              label: 'Authorize on GitHub',
              url: 'https://github.com/orgs/rozed-dev/sso?authorization_request=x',
            },
          ],
          retryAt: Date.now() + 5_000,
        },
      ],
      [
        () =>
          Response.json(
            { message: 'API rate limit exceeded' },
            {
              status: 403,
              headers: {
                'x-ratelimit-remaining': '0',
                'x-ratelimit-reset': String(Math.round(Date.now() / 1000) + 600),
              },
            },
          ),
        {
          kind: 'rateLimited',
          secondary: false,
          retryAt: (Math.round(Date.now() / 1000) + 600) * 1000,
        },
      ],
      [
        () => Response.json({ message: 'Server Error' }, { status: 502 }),
        {
          kind: 'failed',
          message: 'GitHub answered 502: Server Error',
          retryAt: Date.now() + 5_000,
        },
      ],
    ];
    for (const [answer, problem] of cases) {
      const github = new FakeGithub();
      github.answer.set(path, answer);
      const { tab, last } = tabWith(github.client);
      tab.update(info(), true, true);
      await settle();
      expect(last()?.problem).toEqual(problem);
      tab.close();
    }
  });

  it('waits as long as the rate limit asks before reading again', async () => {
    const github = new FakeGithub();
    const path = 'rozed-dev/e2e/git/matching-refs/lo/pr/5';
    github.answer.set(path, () =>
      Response.json(
        { message: 'You have exceeded a secondary rate limit.' },
        {
          status: 403,
          headers: { 'retry-after': '120' },
        },
      ),
    );
    const { tab, last } = tabWith(github.client);
    tab.update(info(), true, true);
    await settle();
    expect(last()?.problem).toEqual({
      kind: 'rateLimited',
      secondary: true,
      retryAt: Date.now() + 120_000,
    });
    await vi.advanceTimersByTimeAsync(119_999);
    expect(github.asked).toHaveLength(1);
    github.answer.delete(path);
    await vi.advanceTimersByTimeAsync(1);
    await settle();
    expect(github.asked).toHaveLength(2);
    expect(last()?.problem).toBeNull();
    tab.close();
  });
});

/** What the tab read of `made`, pushed as #5's overview, and what it asked GitHub. */
async function fetched(made: ReturnType<typeof overview>, options?: { truncated?: boolean }) {
  const github = new FakeGithub();
  github.push('rozed-dev/e2e', 5, made, options);
  const opened = tabWith(github.client);
  opened.tab.update(info(), true, true);
  await settle();
  const blobs = github.paths().filter((path) => path.includes('/git/blobs/'));
  return { ...opened, github, blobs };
}

describe('fetching', () => {
  it('refuses an overview by its listing before any of its files comes', async () => {
    const text = artifactText(5);
    const many: Record<string, string> = { 'artifact.md': text };
    for (let at = 0; at < LIMITS.entries - 1; at++) many[`figures/f${at}.svg`] = `<svg>${at}</svg>`;
    const large = overview('large', { 'artifact.md': text }, [
      {
        path: 'figures/huge.png',
        mode: '100644',
        type: 'blob',
        sha: fakeId('huge'),
        size: LIMITS.commit,
      },
      { path: 'figures', mode: '040000', type: 'tree', sha: fakeId('figures') },
    ]);
    const long: Item[] = [
      {
        path: 'artifact.md',
        mode: '100644',
        type: 'blob',
        sha: fakeId('long'),
        size: ARTIFACT_READ + 1,
      },
    ];
    const cases = [
      // 501 files and folders: 499 figures, their folder and artifact.md.
      { made: overview('many', many), options: undefined },
      { made: large, options: undefined },
      { made: { ...overview('long', {}), items: long }, options: undefined },
      { made: overview('truncated', { 'artifact.md': text }), options: { truncated: true } },
    ];
    for (const { made, options } of cases) {
      const { tab, last, blobs } = await fetched(made, options);
      expect(last()).toMatchObject({ found: 'commit', overview: { id: made.commit, read: false } });
      expect(blobs).toEqual([]);
      // And none comes when asked for.
      expect(await tab.files(made.commit, ['artifact.md', 'figures/f1.svg'])).toEqual([
        { kind: 'refused' },
        { kind: 'refused' },
      ]);
      expect(blobs).toEqual([]);
      tab.close();
    }
  });

  it('lists only one past the most an overview may hold, with artifact.md wherever it is', async () => {
    const items: Item[] = Array.from({ length: 3 * LIMITS.entries }, (_, at) => ({
      path: `figures/f${String(at).padStart(4, '0')}.svg`,
      mode: '100644',
      type: 'blob',
      sha: fakeId(`f${at}`),
      size: 10,
    }));
    items.push({ path: 'artifact.md', mode: '100644', type: 'blob', sha: fakeId('a'), size: 10 });
    const { last, blobs, tab } = await fetched({ ...overview('wide', {}), items });
    const entries = last()?.overview?.entries ?? [];
    expect(entries).toHaveLength(LIMITS.entries + 2);
    expect(entries.at(-1)?.path).toBe('artifact.md');
    expect(blobs).toEqual([]);
    tab.close();
  });

  it("reads no artifact.md that isn't a file, and takes no overview without one", async () => {
    const link: Item[] = [
      { path: 'artifact.md', mode: '120000', type: 'blob', sha: fakeId('link'), size: 9 },
    ];
    for (const made of [
      overview('none', { 'figures/a.svg': '<svg/>' }),
      { ...overview('link', {}), items: link },
    ]) {
      const { last, blobs, tab } = await fetched(made);
      expect(last()?.overview).toMatchObject({ read: false });
      expect(blobs).toEqual([]);
      tab.close();
    }
  });

  it("refuses a file that doesn't hash to its ID as it arrives, and tries again", async () => {
    const made = overview('bad', { 'artifact.md': artifactText(5) });
    const github = new FakeGithub();
    github.push('rozed-dev/e2e', 5, made);
    const [id] = [...made.files.keys()];
    github.blobs.set(id ?? '', new TextEncoder().encode(artifactText(5).replace('It', 'He')));
    const { tab, last, blobs } = tabWith(github.client);
    tab.update(info(), true, true);
    await settle();
    expect(last()).toMatchObject({
      overview: null,
      problem: {
        kind: 'failed',
        message: "GitHub sent a file of the overview that isn't the one its ID names.",
      },
    });
    expect(blobs.has(id ?? '')).toBe(false);

    github.blobs.set(id ?? '', new TextEncoder().encode(artifactText(5)));
    await vi.advanceTimersByTimeAsync(5_000);
    await settle();
    expect(last()).toMatchObject({ overview: { id: made.commit, read: true }, problem: null });
    expect(blobs.has(id ?? '')).toBe(true);
    tab.close();
  });

  it("reads a kept file again from GitHub when its bytes aren't its ID's any more", async () => {
    const figure = '<svg viewBox="0 0 1 1"/>';
    const made = overview('kept', { 'artifact.md': artifactText(5), 'figures/a.svg': figure });
    const { tab, github, db } = await fetched(made);
    expect(await tab.files(made.commit, ['figures/a.svg'])).toMatchObject([{ kind: 'file' }]);
    const before = github.asked.length;
    db.prepare('UPDATE overview_blobs SET bytes = ? WHERE id = ?').run(
      new TextEncoder().encode('<svg/>'),
      idOf(figure),
    );
    const [answer] = await tab.files(made.commit, ['figures/a.svg']);
    expect(
      answer?.kind === 'file' ? new TextDecoder().decode(answer.bytes ?? undefined) : answer,
    ).toBe(figure);
    expect(github.paths().slice(before)).toEqual([`rozed-dev/e2e/git/blobs/${idOf(figure)}`]);
    tab.close();
  });

  it('answers each file as a reader would, reading only what an overview shows', async () => {
    const figure = '<svg viewBox="0 0 1 1"/>';
    const made = overview(
      'files',
      {
        'artifact.md': artifactText(5),
        'figures/a.svg': figure,
        'notes.txt': "not an overview's",
      },
      [
        { path: 'figures/link.svg', mode: '120000', type: 'blob', sha: fakeId('link'), size: 6 },
        {
          path: 'figures/big.png',
          mode: '100644',
          type: 'blob',
          sha: fakeId('big'),
          size: SIZE_ONLY + 1,
        },
        { path: 'figures/sub.svg', mode: '160000', type: 'commit', sha: fakeId('sub') },
        // A name GitHub wrote for bytes that weren't UTF-8.
        {
          path: 'figures/caf\uFFFD.svg',
          mode: '100644',
          type: 'blob',
          sha: idOf(figure),
          size: figure.length,
        },
      ],
    );
    const { tab, github, last } = await fetched(made);
    // A name GitHub mangled is only a stray entry: the text is still read.
    expect(last()?.overview?.read).toBe(true);
    const before = github.asked.length;
    expect(
      await tab.files(made.commit, [
        'figures/a.svg',
        'figures/missing.svg',
        'figures/link.svg',
        'figures/sub.svg',
        'figures/big.png',
        'notes.txt',
        'figures/caf\uFFFD.svg',
        'figures/a.svg',
      ]),
    ).toEqual([
      { kind: 'file', size: figure.length, bytes: new TextEncoder().encode(figure) },
      { kind: 'missing' },
      { kind: 'notFile', is: 'link' },
      { kind: 'notFile', is: 'submodule' },
      { kind: 'file', size: SIZE_ONLY + 1, bytes: null },
      { kind: 'refused' },
      { kind: 'refused' },
      { kind: 'file', size: figure.length, bytes: new TextEncoder().encode(figure) },
    ]);
    // Only the figure that's there and small enough was asked for, once.
    expect(github.paths().slice(before)).toEqual([`rozed-dev/e2e/git/blobs/${idOf(figure)}`]);
    tab.close();
  });

  it('shows what was kept at once, offline too, and its files from the table', async () => {
    const db = database();
    const made = overview('kept', { 'artifact.md': artifactText(5) });
    const online = new FakeGithub();
    online.push('rozed-dev/e2e', 5, made);
    const first = tabWith(online.client, db);
    first.tab.update(info(), true, true);
    await settle();
    first.tab.close();

    const offline = new FakeGithub();
    offline.answer.set('rozed-dev/e2e/git/matching-refs/lo/pr/5', () => {
      throw new TypeError('fetch failed');
    });
    const again = tabWith(offline.client, db);
    // Before GitHub is asked, from what was kept.
    again.tab.update(info({ head: undefined }), true, true);
    expect(again.last()).toMatchObject({ overview: { id: made.commit }, saved: true });
    again.tab.update(info(), true, true);
    await settle();
    expect(again.last()).toMatchObject({
      overview: { id: made.commit },
      saved: true,
      problem: { kind: 'offline' },
    });
    expect(await again.tab.files(made.commit, ['artifact.md'])).toMatchObject([
      { kind: 'file', size: artifactText(5).length },
    ]);
    expect(offline.paths()).toEqual(['rozed-dev/e2e/git/matching-refs/lo/pr/5']);

    // Once GitHub says the ref holds it, it isn't only what was kept.
    offline.answer.clear();
    offline.push('rozed-dev/e2e', 5, made);
    await vi.advanceTimersByTimeAsync(5_000);
    await settle();
    expect(again.last()).toMatchObject({
      overview: { id: made.commit },
      saved: false,
      problem: null,
    });
    expect(offline.paths().filter((path) => !path.includes('matching-refs'))).toEqual([]);
    again.tab.close();
  });
});

describe('the code', () => {
  it('says whether the code an overview names can be read, as the local copy comes', () => {
    const github = new FakeGithub();
    const { tab, sent } = tabWith(github.client);
    const ready = { kind: 'ready', head: fakeId('head'), base: fakeId('base'), mergeBase: null };
    // Hidden, the tab reads nothing, and says only what changed.
    tab.update(info(), false, true);
    expect(sent.at(-1)?.code).toBe('waiting');
    tab.update(info({ local: { kind: 'fetching', progress: null, attempt: 1 } }), false, true);
    expect(sent).toHaveLength(1);
    tab.update(info({ local: { ...ready, kind: 'ready', offline: true } }), false, true);
    expect(sent.at(-1)?.code).toBe('offline');
    tab.update(info({ local: { ...ready, kind: 'ready', offline: false } }), false, true);
    expect(sent.at(-1)?.code).toBe('ready');
    tab.update(
      info({ local: { kind: 'noGit', message: 'No git.', install: 'Install git.' } }),
      false,
      true,
    );
    expect(sent.at(-1)?.code).toBe('noGit');
    expect(sent).toHaveLength(4);
    expect(github.asked).toEqual([]);
    tab.close();
  });

  it('stops reading the code as the tab closes, and reads none after', async () => {
    const github = new FakeGithub();
    const { tab } = tabWith(github.client);
    let stopped = false;
    const reading = tab.readCode(
      'a',
      (signal) =>
        new Promise((resolve) => {
          signal.addEventListener('abort', () => {
            stopped = true;
            resolve({ kind: 'failed', why: 'stopped' });
          });
        }),
    );
    tab.close();
    await reading;
    expect(stopped).toBe(true);
    expect(() => tab.readCode('a', () => Promise.resolve({ kind: 'waiting' }))).toThrow(
      "There's no pull request's tab with that id.",
    );
  });
});
