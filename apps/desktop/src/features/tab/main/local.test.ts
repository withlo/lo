import { renameSync } from 'node:fs';
import { join } from 'node:path';

import { GitError, parseOid, type GitStatus, type PullRequestRefs } from '@lo/git';
import { APP_PULL, git, writeAppRemote } from '@lo/testing/git';
import { describe, expect, it } from 'vitest';

import type { LocalGit } from '../../../main/git.ts';
import type { LocalState } from '../contract.ts';
import { describeActivity, failureOf, LocalCopy, retryWait } from './local.ts';
import { appRemote, folder, testGit } from './test/support.ts';

const REFS: PullRequestRefs = {
  number: APP_PULL.number,
  head: parseOid(APP_PULL.head),
  baseBranch: 'app/base',
  base: parseOid(APP_PULL.base),
};

/** A local copy of the e2e pull request in `git`'s cache, with what it says collected. */
function copyIn(localGit: LocalGit, token?: () => Promise<string | undefined>) {
  const states: LocalState[] = [];
  const lines: string[] = [];
  const local = new LocalCopy({
    git: localGit,
    repository: { owner: 'rozed-dev', name: 'e2e' },
    number: APP_PULL.number,
    token,
    changed: (state) => states.push(state),
    log: (line) => lines.push(line),
  });
  return { local, states, lines, last: () => states.at(-1) };
}

describe('retryWait', () => {
  it('waits 5 s after the first failure, doubling to 5 minutes', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 20].map(retryWait)).toEqual([
      5_000, 10_000, 20_000, 40_000, 80_000, 160_000, 300_000, 300_000, 300_000,
    ]);
  });
});

/** A fetch that failed as @lo/git says. */
const fetchFailing = (failure: 'network' | 'auth' | 'refNotFound' | 'timedOut') =>
  new GitError({ kind: 'fetch', what: 'pull request #1', failure, message: 'fatal: …' });

describe('failureOf', () => {
  it('tries again when waiting may help, as @lo/git says', () => {
    expect(failureOf(fetchFailing('network'))).toMatchObject({ failure: 'network', retry: true });
    expect(failureOf(fetchFailing('timedOut'))).toMatchObject({ failure: 'timedOut', retry: true });
    expect(failureOf(new GitError({ kind: 'busy', message: 'held' }))).toMatchObject({
      failure: 'other',
      retry: true,
    });
    expect(failureOf(new Error('something else'))).toEqual({
      failure: 'other',
      message: 'something else',
      retry: true,
    });
  });

  it("doesn't when it can't: an account that can't see it, a missing ref, a full disk, a lost commit", () => {
    expect(failureOf(fetchFailing('auth'))).toMatchObject({ failure: 'auth', retry: false });
    expect(failureOf(fetchFailing('refNotFound'))).toMatchObject({ retry: false });
    expect(failureOf(new GitError({ kind: 'diskFull' }))).toMatchObject({
      failure: 'diskFull',
      retry: false,
    });
    expect(failureOf(new GitError({ kind: 'unavailable', oid: APP_PULL.head }))).toMatchObject({
      failure: 'unavailable',
      retry: false,
    });
  });
});

describe('describeActivity', () => {
  it('says what git is doing, in a few words', () => {
    expect(describeActivity({ kind: 'connecting', elapsed: 10 })).toBe('connecting to GitHub');
    expect(describeActivity({ kind: 'preparing', elapsed: 10 })).toBe('GitHub is preparing it');
    expect(
      describeActivity({
        kind: 'transferring',
        elapsed: 10,
        progress: { stage: 'Receiving objects', done: 555, total: 1234 },
      }),
    ).toBe('receiving objects, 44% of 1234');
    expect(describeActivity({ kind: 'waitingForLock', waited: 10, holder: 'repacking' })).toBe(
      'waiting while Lo is repacking',
    );
  });
});

describe('a local copy', { timeout: 60_000 }, () => {
  it('fetches the pull request and says the head on screen is ready, with its base', async () => {
    const localGit = await testGit();
    const asked: string[] = [];
    const { local, states, last } = copyIn(localGit, () => {
      asked.push('token');
      return Promise.resolve('gho_FAKE_TOKEN');
    });
    local.want(REFS);
    local.show(APP_PULL.head);

    await expect.poll(last, { timeout: 40_000 }).toEqual({
      kind: 'ready',
      head: APP_PULL.head,
      base: APP_PULL.base,
      mergeBase: APP_PULL.base,
      offline: false,
    });
    expect(states[0]).toEqual({ kind: 'fetching', progress: null, attempt: 1 });
    // The token is read as the fetch starts, and only for it.
    expect(asked).toEqual(['token']);
    const clone = localGit.cache?.repoFolder('rozed-dev', 'e2e') ?? '';
    expect(git(clone, 'rev-parse', `refs/lo/pull/${APP_PULL.number}/head`)).toBe(APP_PULL.head);

    // Asked again for what it has, it fetches nothing more.
    const said = states.length;
    local.want(REFS);
    expect(states.length).toBe(said);
    local.close();
  });

  it('finds where a merged pull request branched from GitHub’s base, not the branch it merged into', async () => {
    // The base branch fast-forwarded to the head, as a merge can leave it.
    const remote = writeAppRemote(folder());
    git(
      join(new URL(remote).pathname, 'rozed-dev', 'e2e.git'),
      'update-ref',
      'refs/heads/app/base',
      APP_PULL.head,
    );
    const localGit = await testGit(remote);
    const { local, last } = copyIn(localGit);
    local.want(REFS);
    local.show(APP_PULL.head);

    await expect.poll(last, { timeout: 40_000 }).toEqual({
      kind: 'ready',
      head: APP_PULL.head,
      base: APP_PULL.head,
      mergeBase: APP_PULL.base,
      offline: false,
    });
    local.close();
  });

  it('fetches a merged pull request’s base by its ID when its branch no longer holds it', async () => {
    // The base branch fast-forwarded to the head, and GitHub's base, a commit after the one the
    // pull request branched from, kept only by a ref no fetch of the branch brings.
    const remote = writeAppRemote(folder());
    const bare = join(new URL(remote).pathname, 'rozed-dev', 'e2e.git');
    const tree = git(bare, 'rev-parse', `${APP_PULL.base}^{tree}`);
    const githubBase = git(
      bare,
      'commit-tree',
      tree,
      '-p',
      APP_PULL.base,
      '-m',
      'later on the base',
    );
    git(bare, 'update-ref', 'refs/kept/base', githubBase);
    git(bare, 'update-ref', 'refs/heads/app/base', APP_PULL.head);
    const localGit = await testGit(remote);
    const { local, last } = copyIn(localGit);
    local.want({ ...REFS, base: parseOid(githubBase) });
    local.show(APP_PULL.head);

    await expect.poll(last, { timeout: 40_000 }).toEqual({
      kind: 'ready',
      head: APP_PULL.head,
      base: APP_PULL.head,
      mergeBase: APP_PULL.base,
      offline: false,
    });
    local.close();
  });

  it('fetches a head GitHub has moved on from by its ID, and shows it once asked', async () => {
    const localGit = await testGit();
    const { local, last } = copyIn(localGit);
    local.want(REFS);
    local.show(APP_PULL.firstHead);

    await expect.poll(last, { timeout: 40_000 }).toEqual({
      kind: 'ready',
      head: APP_PULL.firstHead,
      base: APP_PULL.base,
      mergeBase: APP_PULL.firstBase,
      offline: false,
    });
    local.show(APP_PULL.head);
    await expect.poll(last).toMatchObject({ kind: 'ready', head: APP_PULL.head });
    local.close();
  });

  it("waits for git, and says when there's none to fetch with", () => {
    const status: GitStatus = {
      status: 'missing',
      message: "Lo can't find git.",
      install: 'Get it.',
    };
    const noGit: LocalGit = {
      status,
      cache: undefined,
      onStatus: () => undefined,
      onCache: () => () => undefined,
      check: () => Promise.resolve(status),
      setCap: () => Promise.resolve(),
    };
    const { local, last } = copyIn(noGit);
    local.want(REFS);
    local.show(APP_PULL.head);
    expect(local.state).toEqual({
      kind: 'noGit',
      message: "Lo can't find git.",
      install: 'Get it.',
    });
    expect(last()).toEqual(local.state);
    local.close();
  });

  it("says a pull request the remote doesn't have failed, and tries again only when asked", async () => {
    // A remote with the base branch, and no pull request.
    const remote = folder();
    const url = writeAppRemote(remote);
    git(join(remote, 'rozed-dev', 'e2e.git'), 'update-ref', '-d', 'refs/pull/78/head');
    const localGit = await testGit(url);
    const { local, last, states } = copyIn(localGit);
    local.want(REFS);
    local.show(APP_PULL.head);

    await expect.poll(() => last()?.kind, { timeout: 40_000 }).toBe('failed');
    expect(last()).toEqual({
      kind: 'failed',
      failure: 'refNotFound',
      message: expect.stringContaining("can't fetch pull request #78"),
    });
    const said = states.length;
    local.retry();
    await expect.poll(() => states.length).toBeGreaterThan(said);
    expect(states[said]).toEqual({ kind: 'fetching', progress: null, attempt: 1 });
    await expect.poll(() => last()?.kind, { timeout: 40_000 }).toBe('failed');
    local.close();
  });

  it('tries again after a failure waiting may fix, and reads what it fetched before meanwhile', async () => {
    const remote = folder();
    const url = writeAppRemote(remote);
    const localGit = await testGit(url);
    const first = copyIn(localGit);
    first.local.want(REFS);
    first.local.show(APP_PULL.head);
    await expect.poll(first.last, { timeout: 40_000 }).toMatchObject({ kind: 'ready' });
    first.local.close();

    // The remote's gone; a fetch then fails as git's own does, which waiting may fix.
    renameSync(join(remote, 'rozed-dev'), join(remote, 'away'));
    const failing = copyIn(localGit, () =>
      Promise.reject(
        new GitError({ kind: 'fetch', what: 'x', failure: 'network', message: 'down' }),
      ),
    );
    const before = Date.now();
    failing.local.want(REFS);
    failing.local.show(APP_PULL.head);

    await expect.poll(failing.last, { timeout: 40_000 }).toEqual({
      kind: 'ready',
      head: APP_PULL.head,
      base: APP_PULL.base,
      mergeBase: APP_PULL.base,
      offline: true,
    });
    expect(failing.states).toContainEqual({ kind: 'fetching', progress: null, attempt: 1 });
    expect(failing.lines.join('\n')).toContain('down');
    expect(Date.now() - before).toBeLessThan(5_000);
    failing.local.close();
  });

  it('closes without a word, and fetches nothing after', async () => {
    const localGit = await testGit(appRemote());
    const { local, states } = copyIn(localGit);
    local.close();
    local.want(REFS);
    local.show(APP_PULL.head);
    local.retry();
    expect(states).toEqual([]);
  });
});
