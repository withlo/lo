// Following views' trust: a repository no entry names reads nothing from GitHub, a name that
// matches reads its pull request's repositories once for all its views, and a read that fails
// leaves them untrusted, tried again after a wait that doubles.

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
    ...change,
  };
}

function follow(
  open: Map<string, ViewInfo>,
  read: (view: ViewInfo) => Promise<PullRequestRepositories>,
) {
  const published: Status[] = [];
  const dismissed = new Set<string>();
  const reads = vi.fn<(view: ViewInfo) => Promise<PullRequestRepositories>>(read);
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

  it('reads a named pull request’s repositories once, for every view of it, then trusts them', async () => {
    const open = new Map([
      ['t1', info('t1', 80)],
      ['t2:80', info('t2:80', 80)],
    ]);
    const { views, published, reads } = follow(open, () => Promise.resolve(OWN));
    views.setEntries([ENTRY]);
    views.update('t1');
    views.update('t2:80');
    await settle();
    expect(reads).toHaveBeenCalledTimes(1);
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
