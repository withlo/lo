// Following views' trust: a repository no entry names reads nothing from GitHub, a name that
// matches reads its pull request's repositories for its views, read again for a view that opens
// later and once it's pushed to or reloaded, and a read that fails leaves them untrusted, tried
// again after a wait that doubles.

import type { PullRequestRepositories } from '@lo/github';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Status } from '../contract.ts';
import type { TrustEntry } from '../settings.ts';
import { RETRY_FIRST, TrustViews, type ViewInfo } from './views.ts';

const E2E = { id: 'R_kgDOVleUfQ', name: 'rozed-dev/e2e' };
const OWN: PullRequestRepositories = { base: E2E, head: E2E, isCrossRepository: false };
const ENTRY: TrustEntry = { kind: 'repo', repo: 'rozed-dev/e2e', id: E2E.id };

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

/** A view of rozed-dev/e2e's pull request `number`, ready, with `change`. */
function info(id: string, number: number, change: Partial<ViewInfo> = {}): ViewInfo {
  return {
    id,
    repo: 'rozed-dev/e2e',
    number,
    noGit: false,
    local: true,
    fork: null,
    canRead: true,
    heads: 'c0ffee c0ffee',
    ...change,
  };
}

function follow(
  open: Map<string, ViewInfo>,
  read: (view: ViewInfo) => Promise<PullRequestRepositories>,
) {
  const published: Status[] = [];
  const dismissed = new Set<string>();
  const reads = vi.fn<
    (
      view: ViewInfo,
      priority: 'foreground' | 'background',
      signal: AbortSignal | undefined,
    ) => Promise<PullRequestRepositories>
  >((view) => read(view));
  const views = new TrustViews({
    view: (id) => open.get(id),
    read: reads,
    dismissed: (repo) => dismissed.has(repo.toLowerCase()),
    publish: (status) => published.push(status),
    log: () => undefined,
  });
  return { views, published, reads, dismissed };
}

/** Lets what's waiting on promises settle. */
async function settle(): Promise<void> {
  for (let round = 0; round < 20; round++) await Promise.resolve();
}

describe('following views', () => {
  it('waits for the settings file, then reads nothing for a repository no entry names', async () => {
    const open = new Map([['t1', info('t1', 80)]]);
    const { views, published, reads } = follow(open, () => Promise.resolve(OWN));
    views.update('t1');
    expect(published.at(-1)?.trust).toEqual({ kind: 'checking' });
    views.setEntries([{ kind: 'repo', repo: 'rozed-dev/other', id: 'R_x' }]);
    await settle();
    expect(published.at(-1)).toEqual({
      view: 't1',
      repo: 'rozed-dev/e2e',
      pull: 80,
      head: { kind: 'base' },
      trust: { kind: 'untrusted', why: 'unnamed' },
      dismissed: false,
    });
    expect(reads).not.toHaveBeenCalled();
  });

  it('reads a named pull request’s repositories for each view as it opens, then trusts them', async () => {
    const open = new Map([
      ['t1', info('t1', 80)],
      ['t2:80', info('t2:80', 80)],
    ]);
    const { views, published, reads } = follow(open, () => Promise.resolve(OWN));
    views.setEntries([ENTRY]);
    views.update('t1');
    views.update('t2:80');
    await settle();
    // t2:80 opened after t1's read had started.
    expect(reads).toHaveBeenCalledTimes(2);
    expect(views.status('t1')?.trust).toEqual({ kind: 'trusted', by: 'repo' });
    expect(views.status('t2:80')?.trust).toEqual({ kind: 'trusted', by: 'repo' });
    expect(views.decision('t1')?.by).toEqual(ENTRY);
    // Each change once: checking, then trusted.
    expect(
      published.filter((status) => status.view === 't1').map((status) => status.trust.kind),
    ).toEqual(['checking', 'trusted']);
  });

  it('leaves a view untrusted while its read fails, and tries again after a wait that doubles', async () => {
    const open = new Map([['t1', info('t1', 80)]]);
    let fails = 2;
    const { views, reads } = follow(open, () =>
      fails-- > 0 ? Promise.reject(new Error('offline')) : Promise.resolve(OWN),
    );
    views.setEntries([ENTRY]);
    views.update('t1');
    await settle();
    expect(views.status('t1')?.trust).toMatchObject({ kind: 'untrusted', why: 'unread' });
    expect(reads).toHaveBeenCalledTimes(1);
    // Asked again meanwhile, it waits its turn.
    views.update('t1');
    await vi.advanceTimersByTimeAsync(RETRY_FIRST - 1);
    expect(reads).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(reads).toHaveBeenCalledTimes(2);
    expect(views.status('t1')?.trust).toMatchObject({ kind: 'untrusted', why: 'unread' });
    await vi.advanceTimersByTimeAsync(RETRY_FIRST * 2);
    expect(reads).toHaveBeenCalledTimes(3);
    expect(views.status('t1')?.trust).toEqual({ kind: 'trusted', by: 'repo' });
  });

  it('stops trying once no view needs the read', async () => {
    const open = new Map([['t1', info('t1', 80)]]);
    const { views, reads } = follow(open, () => Promise.reject(new Error('offline')));
    views.setEntries([ENTRY]);
    views.update('t1');
    await settle();
    views.setEntries([]);
    await vi.advanceTimersByTimeAsync(RETRY_FIRST * 4);
    expect(reads).toHaveBeenCalledTimes(1);
    views.stop();
  });

  it('decides again as the entries change, and says when the banner was dismissed', async () => {
    const open = new Map([['t1', info('t1', 80)]]);
    const { views, published, dismissed } = follow(open, () => Promise.resolve(OWN));
    views.setEntries([ENTRY]);
    views.update('t1');
    await settle();
    expect(published.at(-1)?.trust.kind).toBe('trusted');
    views.setEntries([]);
    expect(published.at(-1)?.trust).toEqual({ kind: 'untrusted', why: 'unnamed' });
    dismissed.add('rozed-dev/e2e');
    views.updateAll();
    expect(published.at(-1)?.dismissed).toBe(true);
  });

  it('never trusts by IDs read before a view opened, as when another repository takes the name', async () => {
    // rozed-dev/e2e as trusted, then a repository of someone else's under the same name.
    const TAKEN: PullRequestRepositories = {
      base: { id: 'R_someoneElse', name: 'rozed-dev/e2e' },
      head: { id: 'R_someoneElse', name: 'rozed-dev/e2e' },
      isCrossRepository: false,
    };
    const open = new Map([['t1', info('t1', 5)]]);
    let answer = OWN;
    let answering: ((repositories: PullRequestRepositories) => void) | undefined;
    const { views, reads } = follow(
      open,
      () =>
        new Promise((resolve) => {
          answering = resolve;
        }),
    );
    views.setEntries([ENTRY]);
    views.update('t1');
    await settle();
    answering?.(answer);
    await settle();
    expect(views.status('t1')?.trust).toEqual({ kind: 'trusted', by: 'repo' });
    // The name changes hands while t1 is open, and t2 opens on #5 of the new repository: it reads
    // again, and isn't trusted meanwhile.
    answer = TAKEN;
    open.set('t2', info('t2', 5));
    views.update('t2');
    await settle();
    expect(reads).toHaveBeenCalledTimes(2);
    expect(views.status('t2')?.trust).toEqual({ kind: 'checking' });
    answering?.(answer);
    await settle();
    expect(views.status('t2')?.trust).toEqual({ kind: 'untrusted', why: 'other' });
    expect(views.status('t1')?.trust).toEqual({ kind: 'untrusted', why: 'other' });
    // Every view closed, and one opened again: what was read is forgotten, and read again.
    open.clear();
    views.update('t1');
    views.update('t2');
    answer = OWN;
    open.set('t3', info('t3', 5));
    views.update('t3');
    await settle();
    expect(reads).toHaveBeenCalledTimes(3);
    expect(views.status('t3')?.trust).toEqual({ kind: 'checking' });
  });

  it('reads again once the pull request is pushed to or reloaded, trusting nothing meanwhile', async () => {
    const open = new Map([['t1', info('t1', 80)]]);
    const { views, reads } = follow(open, () => Promise.resolve(OWN));
    views.setEntries([ENTRY]);
    views.update('t1');
    await settle();
    expect(reads).toHaveBeenCalledTimes(1);
    // A newer push.
    open.set('t1', info('t1', 80, { heads: 'decade c0ffee' }));
    views.update('t1');
    expect(views.status('t1')?.trust).toEqual({ kind: 'checking' });
    await settle();
    expect(reads).toHaveBeenCalledTimes(2);
    expect(views.status('t1')?.trust).toEqual({ kind: 'trusted', by: 'repo' });
    // Reloaded, to show it.
    open.set('t1', info('t1', 80, { heads: 'decade decade' }));
    views.update('t1');
    await settle();
    expect(reads).toHaveBeenCalledTimes(3);
    // Nothing changed: nothing read.
    views.update('t1');
    await settle();
    expect(reads).toHaveBeenCalledTimes(3);
  });

  it('says which entry trusts a view, even while it’s checked again after a push', async () => {
    const fork = { id: 'R_fork', name: 'rozed-bot/e2e' };
    const pull: TrustEntry = {
      kind: 'pull',
      repo: 'rozed-dev/e2e',
      id: E2E.id,
      pull: 97,
      from: fork.name,
      fromId: fork.id,
    };
    const open = new Map([['t1', info('t1', 97, { fork: fork.name })]]);
    let answer: ((repositories: PullRequestRepositories) => void) | undefined;
    const { views } = follow(
      open,
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    views.setEntries([ENTRY, pull]);
    views.update('t1');
    await settle();
    expect(views.trustedBy('t1')).toBeUndefined();
    answer?.({ base: E2E, head: fork, isCrossRepository: true });
    await settle();
    expect(views.trustedBy('t1')).toEqual(pull);
    // A newer push, still fetching: checked again, and still the pull request's entry, never the
    // repository's.
    open.set('t1', info('t1', 97, { fork: fork.name, heads: 'decade c0ffee', local: false }));
    views.update('t1');
    expect(views.status('t1')?.trust.kind).not.toBe('trusted');
    expect(views.trustedBy('t1')).toEqual(pull);
  });

  it('keeps a read made as the reader asks to trust, for the views of its pull request', async () => {
    const open = new Map([['t1', info('t1', 80)]]);
    const { views, reads } = follow(open, () => Promise.resolve(OWN));
    views.setEntries([]);
    views.update('t1');
    expect(reads).not.toHaveBeenCalled();
    const signal = new AbortController().signal;
    await views.readNow('t1', signal);
    // The reader waits on it, so it goes ahead of polls, until nobody does.
    expect(reads).toHaveBeenLastCalledWith(open.get('t1'), 'foreground', signal);
    views.setEntries([ENTRY]);
    expect(views.status('t1')?.trust).toEqual({ kind: 'trusted', by: 'repo' });
    expect(reads).toHaveBeenCalledTimes(1);
  });

  it('reads for an entry that names a view as polls do, since nobody waits on it', async () => {
    const open = new Map([['t1', info('t1', 80)]]);
    const { views, reads } = follow(open, () => Promise.resolve(OWN));
    views.setEntries([ENTRY]);
    views.update('t1');
    await settle();
    expect(reads).toHaveBeenLastCalledWith(open.get('t1'), 'background', undefined);
  });

  it('says how far trusting a view has got, until it’s over', () => {
    const open = new Map([['t1', info('t1', 80)]]);
    const { views, published } = follow(open, () => Promise.resolve(OWN));
    views.setEntries([]);
    views.setTrusting('t1', 'reading');
    expect(published.at(-1)).toMatchObject({ view: 't1', trusting: 'reading' });
    views.setTrusting('t1', 'saving');
    expect(published.at(-1)).toMatchObject({ trusting: 'saving' });
    // A window loaded meanwhile asks, and hears it too.
    expect(views.status('t1')).toMatchObject({ trusting: 'saving' });
    views.setTrusting('t1', undefined);
    expect(published.at(-1)).not.toHaveProperty('trusting');
    expect(views.status('t1')).not.toHaveProperty('trusting');
  });

  it('forgets a view once its tab closes', () => {
    const open = new Map([['t1', info('t1', 80)]]);
    const { views } = follow(open, () => Promise.resolve(OWN));
    views.setEntries([]);
    expect(views.status('t1')).toBeDefined();
    open.delete('t1');
    expect(views.status('t1')).toBeUndefined();
    expect(views.decision('t1')).toBeUndefined();
  });
});
