import { renameSync } from 'node:fs';
import { join } from 'node:path';

import { GithubError, type PullSummary } from '@lo/github';
import { MemoryPollCache } from '@lo/testing';
import { APP_PULL, writeAppRemote } from '@lo/testing/git';
import { describe, expect, it } from 'vitest';

import { PullTab, type Kept } from './pull.ts';
import { folder, published, replayGithub, testGit, TOKEN } from './test/support.ts';

const E2E = { owner: 'rozed-dev', repo: 'e2e', number: APP_PULL.number };
const TITLE = "App: the pull request Lo's end-to-end tests open";

/** A tab for `link`, as the watcher makes one, with what it keeps and sends collected. */
function tabFor(options: {
  link?: { owner: string; repo: string; number: number };
  github: ReturnType<typeof replayGithub>['github'];
  git: Awaited<ReturnType<typeof testGit>>;
  login?: string;
  repository?: string;
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
  });
  return { tab, sent, kept, lines };
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
    tab.show();
    await expect
      .poll(() => sent.pull?.problem)
      .toEqual({
        kind: 'ask',
        logins: ['rozed-bot', 'other-bot'],
      });

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
    });
    after.tab.show();

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
    await expect.poll(() => after.sent.pull?.connection.kind).toBe('offline');
    expect(after.sent.pull?.connection).toMatchObject({ savedAt: expect.any(Number) });
    expect(after.sent.pull?.problem).toBe(null);
    after.tab.close();
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
