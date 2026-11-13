import { renameSync } from 'node:fs';
import { join } from 'node:path';

import {
  type Activity,
  type FetchedPull,
  GitError,
  type GitStatus,
  type Oid,
  type OpenOptions,
  parseOid,
  type PullRequestRefs,
} from '@lo/git';
import { APP_PULL, git, STACK_PULLS, writeAppRemote, writeStackRemote } from '@lo/testing/git';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { LocalGit } from '../../../main/git.ts';
import type { LocalState } from '../contract.ts';
import {
  type Clone,
  type CopyGit,
  describeActivity,
  failureOf,
  LocalCopy,
  paced,
  PROGRESS_EVERY,
  retryWait,
} from './local.ts';
import { appRemote, folder, testGit } from './test/support.ts';

const REFS: PullRequestRefs = {
  number: APP_PULL.number,
  head: parseOid(APP_PULL.head),
  baseBranch: 'app/base',
  base: parseOid(APP_PULL.base),
};

/**
 * A local copy of the e2e pull request, or the pull request numbered `number`, in `git`'s cache,
 * with what it says collected.
 */
function copyIn<R extends Clone>(
  localGit: CopyGit<R>,
  token?: () => Promise<string | undefined>,
  number: number = APP_PULL.number,
) {
  const states: LocalState[] = [];
  const lines: string[] = [];
  const local = new LocalCopy({
    git: localGit,
    repository: { owner: 'rozed-dev', name: 'e2e' },
    number,
    token,
    changed: (state) => states.push(state),
    log: (line) => lines.push(line),
  });
  return { local, states, lines, last: () => states.at(-1) };
}

/**
 * Git with a clone that stands in for one: it hands the copy what git is doing as `tell` says,
 * ends its fetch once `fetched` is resolved, and finds where the head branched once `branched` is.
 */
function fakeGit() {
  const fetched = Promise.withResolvers<FetchedPull>();
  const branched = Promise.withResolvers<Oid | undefined>();
  let progress: OpenOptions['progress'];
  const clone: Clone = {
    offline: false,
    fetchPull: () => fetched.promise,
    fetchCommit: () => Promise.resolve(),
    fetchCommits: () => Promise.resolve([]),
    branchBase: () => Promise.resolve(undefined),
    hasCommit: () => Promise.resolve(true),
    mergeBase: () => branched.promise,
    isAncestor: () => Promise.resolve(false),
    close: () => undefined,
  };
  const localGit: CopyGit<Clone> = {
    status: undefined,
    cache: {
      open: (_owner, _name, options) => {
        progress = options.progress;
        return Promise.resolve(clone);
      },
    },
  };
  const tell = (...activities: Activity[]): void => {
    for (const activity of activities) progress?.(activity);
  };
  return { localGit, fetched, branched, tell };
}

const connecting: Activity = { kind: 'connecting', elapsed: 10 };

/** Git receiving objects, `percent` of the way. */
const receiving = (percent: number): Activity => ({
  kind: 'transferring',
  elapsed: 10,
  progress: { stage: 'Receiving objects', done: percent, total: 100 },
});

/** What git was doing, as each state said while fetching said it. */
const progressIn = (states: readonly LocalState[]): (string | null)[] =>
  states.flatMap((state) => (state.kind === 'fetching' ? [state.progress] : []));

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

describe('paced', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('says calls made together once, with the last, and calls within the wait once it’s up', async () => {
    vi.useFakeTimers();
    let line = '';
    const said: string[] = [];
    const say = paced(100, () => said.push(line));
    for (line of ['a', 'b', 'c']) say();
    expect(said).toEqual([]);
    await vi.advanceTimersByTimeAsync(0);
    expect(said).toEqual(['c']);

    line = 'd';
    say();
    await vi.advanceTimersByTimeAsync(40);
    line = 'e';
    say();
    await vi.advanceTimersByTimeAsync(59);
    expect(said).toEqual(['c']);
    await vi.advanceTimersByTimeAsync(1);
    expect(said).toEqual(['c', 'e']);

    // Longer than the wait after the last said, a call is said once the code making it is done.
    await vi.advanceTimersByTimeAsync(100);
    line = 'f';
    say();
    await vi.advanceTimersByTimeAsync(0);
    expect(said).toEqual(['c', 'e', 'f']);
  });

  it('keeps time as the wall clock steps back', async () => {
    vi.useFakeTimers();
    let said = 0;
    const say = paced(100, () => (said += 1));
    say();
    await vi.advanceTimersByTimeAsync(0);
    vi.setSystemTime(Date.now() - 60 * 60_000);
    await vi.advanceTimersByTimeAsync(100);
    say();
    await vi.advanceTimersByTimeAsync(0);
    expect(said).toBe(2);
  });
});

/** A local copy fetching from a stand-in clone, on fake timers, with what it has said settled. */
async function fetching() {
  vi.useFakeTimers();
  const fake = fakeGit();
  const copy = copyIn(fake.localGit);
  copy.local.want(REFS);
  copy.local.show(APP_PULL.head);
  await vi.advanceTimersByTimeAsync(0);
  expect(copy.states).toEqual([{ kind: 'fetching', progress: null, attempt: 1 }]);
  return { ...fake, ...copy };
}

describe('a local copy saying what git is doing', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it(`says it at most every ${PROGRESS_EVERY} ms, with the latest`, async () => {
    const { tell, states } = await fetching();
    // What git did since the copy last heard comes together: the latest is said.
    tell(connecting, receiving(10), receiving(20));
    await vi.advanceTimersByTimeAsync(0);
    expect(progressIn(states)).toEqual([null, 'receiving objects, 20% of 100']);

    tell(receiving(30));
    await vi.advanceTimersByTimeAsync(40);
    tell(receiving(40));
    await vi.advanceTimersByTimeAsync(PROGRESS_EVERY - 41);
    expect(progressIn(states)).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(progressIn(states)).toEqual([
      null,
      'receiving objects, 20% of 100',
      'receiving objects, 40% of 100',
    ]);
  });

  it('gives the tab what it last said, not what’s waiting to be said', async () => {
    const { tell, local, last } = await fetching();
    tell(connecting);
    await vi.advanceTimersByTimeAsync(0);
    tell(receiving(10));
    // The tab, sending the copy's state for reasons of its own, sends what the window has.
    expect(local.state).toEqual(last());
    tell(connecting);
    await vi.advanceTimersByTimeAsync(PROGRESS_EVERY);
    expect(local.state).toEqual(last());
    expect(last()).toMatchObject({ kind: 'fetching', progress: 'connecting to GitHub' });
  });

  it('says nothing between the fetch ending and the head on screen being ready', async () => {
    const { tell, fetched, branched, states, last } = await fetching();
    tell(connecting);
    await vi.advanceTimersByTimeAsync(0);
    // A line still waiting to be said as the fetch ends, and working out where the head branched
    // taking longer than the wait.
    tell(receiving(50));
    fetched.resolve({
      head: parseOid(APP_PULL.head),
      headSource: { kind: 'pullRef' },
      baseTip: parseOid(APP_PULL.base),
      baseSource: 'branch',
    });
    await vi.advanceTimersByTimeAsync(PROGRESS_EVERY * 3);
    expect(states.map((state) => state.kind)).toEqual(['fetching', 'fetching']);

    branched.resolve(parseOid(APP_PULL.base));
    await vi.advanceTimersByTimeAsync(0);
    expect(last()).toEqual({
      kind: 'ready',
      head: APP_PULL.head,
      base: APP_PULL.base,
      mergeBase: APP_PULL.base,
      offline: false,
    });
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
    git(join(remote, 'rozed-dev', 'e2e.git'), 'update-ref', '-d', 'refs/pull/80/head');
    const localGit = await testGit(url);
    const { local, last, states } = copyIn(localGit);
    local.want(REFS);
    local.show(APP_PULL.head);

    await expect.poll(() => last()?.kind, { timeout: 40_000 }).toBe('failed');
    expect(last()).toEqual({
      kind: 'failed',
      failure: 'refNotFound',
      message: expect.stringContaining("can't fetch pull request #80"),
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

describe("a stack's layer's local copy", { timeout: 60_000 }, () => {
  /** #C, on #B by the commits they share, into `stack/root`. */
  const C: PullRequestRefs = {
    number: STACK_PULLS.c.number,
    head: parseOid(STACK_PULLS.c.head),
    baseBranch: 'stack/root',
    base: parseOid(STACK_PULLS.root),
  };

  /** A local copy of #C fetched from the stacks' remote, `remote`, ready at its head. */
  async function readyC(remote = writeStackRemote(folder())) {
    const made = copyIn(await testGit(remote), undefined, C.number);
    made.local.want(C);
    made.local.show(STACK_PULLS.c.head);
    await expect.poll(made.last, { timeout: 40_000 }).toMatchObject({
      kind: 'ready',
      mergeBase: STACK_PULLS.root,
    });
    return made;
  }

  it('starts at the commit it’s compared with, which its head holds, and back at its base branch', async () => {
    const { local, last } = await readyC();
    local.compareFrom(STACK_PULLS.b.head);
    await expect.poll(last).toEqual({
      kind: 'ready',
      head: STACK_PULLS.c.head,
      base: STACK_PULLS.root,
      mergeBase: STACK_PULLS.b.head,
      from: { commit: STACK_PULLS.b.head, missing: false },
      offline: false,
    });
    local.compareFrom(undefined);
    await expect.poll(last).toEqual({
      kind: 'ready',
      head: STACK_PULLS.c.head,
      base: STACK_PULLS.root,
      mergeBase: STACK_PULLS.root,
      offline: false,
    });
    local.close();
  });

  it('fetches the commit by its ID when the copy lacks it, and starts where the head meets it', async () => {
    // A commit on #A's head that no branch or pull request holds, which no fetch of #C brings.
    const remote = writeStackRemote(folder());
    const bare = join(new URL(remote).pathname, 'rozed-dev', 'e2e.git');
    const tree = git(bare, 'rev-parse', `${STACK_PULLS.a.head}^{tree}`);
    const later = git(bare, 'commit-tree', tree, '-p', STACK_PULLS.a.head, '-m', 'later on #A');
    git(bare, 'update-ref', 'refs/kept/a', later);
    const { local, last } = await readyC(remote);
    local.compareFrom(later);
    await expect.poll(last, { timeout: 40_000 }).toMatchObject({
      mergeBase: STACK_PULLS.a.head,
      from: { commit: later, missing: false },
    });
    local.close();
  });

  it('starts at its base branch when GitHub no longer has the commit, and says so', async () => {
    const { local, last, lines } = await readyC();
    const gone = 'f'.repeat(40);
    local.compareFrom(gone);
    await expect.poll(last, { timeout: 40_000 }).toMatchObject({
      mergeBase: STACK_PULLS.root,
      from: { commit: gone, missing: true },
    });
    expect(lines.join('\n')).toContain(gone);
    local.close();
  });

  it('is compared with the commit it was made with from its first ready', async () => {
    const localGit = await testGit(writeStackRemote(folder()));
    const states: LocalState[] = [];
    const local = new LocalCopy({
      git: localGit,
      repository: { owner: 'rozed-dev', name: 'e2e' },
      number: C.number,
      from: STACK_PULLS.b.head,
      changed: (state) => states.push(state),
      log: () => undefined,
    });
    local.want(C);
    local.show(STACK_PULLS.c.head);
    await expect.poll(() => states.at(-1)?.kind, { timeout: 40_000 }).toBe('ready');
    expect(states.filter((state) => state.kind === 'ready')).toEqual([
      expect.objectContaining({ mergeBase: STACK_PULLS.b.head }),
    ]);
    local.close();
  });
});
