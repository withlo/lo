import {
  PULL_REQUEST_SIDEBAR,
  PullRef,
  type ReadKind,
  TIMELINE,
  type Cached,
  type GithubErrorDetail,
  type PollEvent,
  type PollStatus,
  type PullRequestSidebar,
  type PullRequestTimeline,
} from '@lo/github';
import { describe, expect, it, vi } from 'vitest';

import type { PullTabInfo } from '../../tab/service.ts';
import type { SidebarView, TimelineView } from '../contract.ts';
import { TimelineTab, type TimelinePoller } from './follow.ts';

const PULL = new PullRef('rozed-dev', 'e2e', 23);
const AT = '2026-11-06T12:00:00Z';

function info(change: Partial<PullTabInfo> = {}): PullTabInfo {
  return {
    id: 't1',
    repository: { owner: 'rozed-dev', name: 'e2e' },
    number: 23,
    acting: { kind: 'account', login: 'rozed-bot' },
    head: { fork: null },
    shown: undefined,
    latest: undefined,
    provisional: false,
    local: { kind: 'waiting' },
    compareFrom: undefined,
    drawn: false,
    run: undefined,
    ...change,
  };
}

function timeline(body: string): PullRequestTimeline {
  return {
    description: { author: undefined, body, createdAt: AT, lastEditedAt: undefined },
    items: [],
    leftOut: 0,
    count: 0,
    shownUpdatedAt: AT,
    readInFullAt: AT,
  };
}

const SIDEBAR: PullRequestSidebar = {
  isDraft: false,
  labels: [{ name: 'api', color: '2700af' }],
  requested: [],
  reviews: [],
  assignees: [],
};

function cached<T>(value: T | undefined): Cached<T> | undefined {
  return value === undefined ? undefined : { value, fetchedAt: 0 };
}

/** A poller that reads what a test keeps in it, and the events a test sends as its polls. */
function pollerOf(first: PullRequestTimeline | Error) {
  const listeners = new Set<(event: PollEvent) => void>();
  const observers = new Set<() => void>();
  let status: PollStatus = { rateLimit: { kind: 'normal' }, offline: undefined, signedOut: false };
  let retryAt: number | undefined;
  const kept: { timeline?: PullRequestTimeline; sidebar?: PullRequestSidebar } = {
    sidebar: SIDEBAR,
  };
  if (!(first instanceof Error)) kept.timeline = first;
  function cachedRead(
    pull: PullRef,
    kind: ReadKind<PullRequestTimeline>,
  ): Cached<PullRequestTimeline> | undefined;
  function cachedRead(
    pull: PullRef,
    kind: ReadKind<PullRequestSidebar>,
  ): Cached<PullRequestSidebar> | undefined;
  function cachedRead(_: PullRef, kind: { name: string }) {
    return cached(kind.name === PULL_REQUEST_SIDEBAR.name ? kept.sidebar : kept.timeline);
  }
  const readAfresh = vi.fn<TimelinePoller['readAfresh']>(() => ({ read: 1, generation: 1 }));
  const poller: TimelinePoller = {
    timeline: vi.fn<TimelinePoller['timeline']>(() =>
      first instanceof Error ? Promise.reject(first) : Promise.resolve(cached(kept.timeline)),
    ),
    pullRequestSidebar: vi.fn<TimelinePoller['pullRequestSidebar']>(() =>
      Promise.resolve(cached(kept.sidebar)),
    ),
    onEvent(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    cachedRead,
    readAfresh,
    readRetryAt: () => retryAt,
    onChange(observer) {
      observers.add(observer);
      return () => observers.delete(observer);
    },
    status: () => status,
  };
  /** Something the poller holds changed, which those observing it hear. */
  const changed = () => {
    for (const observer of observers) observer();
  };
  return {
    poller,
    listeners,
    observers,
    readAfresh,
    /** Polling goes as `next` says from now. */
    goes(next: Partial<PollStatus>) {
      status = { ...status, ...next };
      changed();
    },
    /** The timeline's failed read is tried again at `at`, or isn't waiting. */
    retries(at: number | undefined) {
      retryAt = at;
      changed();
    },
    /** A poll read the timeline again, as `next`. */
    read(next: PullRequestTimeline) {
      kept.timeline = next;
      for (const listener of listeners) listener({ kind: 'read', pull: PULL, name: TIMELINE.name });
    },
    failed(error: GithubErrorDetail = { kind: 'notFound', message: 'Not Found' }) {
      for (const listener of listeners) {
        listener({ kind: 'readFailed', pull: PULL, name: TIMELINE.name, error });
      }
    },
  };
}

function tabOf(poller: TimelinePoller, readWait?: number) {
  const timelines: TimelineView[] = [];
  const sidebars: SidebarView[] = [];
  const asked = vi.fn<(login: string) => Promise<TimelinePoller>>(() => Promise.resolve(poller));
  const tab = new TimelineTab({
    id: 't1',
    github: { poller: asked },
    publish: { timeline: (view) => timelines.push(view), sidebar: (view) => sidebars.push(view) },
    log: () => undefined,
    readWait,
  });
  return { tab, timelines, sidebars, asked };
}

describe('TimelineTab', () => {
  it('reads nothing until the timeline is first shown, then keeps it current', async () => {
    const polled = pollerOf(timeline('First'));
    const { tab, timelines, sidebars, asked } = tabOf(polled.poller);
    tab.update(info());
    expect(asked).not.toHaveBeenCalled();
    expect(tab.show().timeline).toMatchObject({ status: 'loading', timeline: null });
    await vi.waitFor(() => expect(timelines.at(-1)?.status).toBe('ready'));
    expect(asked).toHaveBeenCalledWith('rozed-bot');
    expect(timelines.at(-1)?.timeline?.description.body).toBe('First');
    expect(sidebars.at(-1)?.sidebar?.labels).toEqual([{ name: 'api', color: '2700af' }]);

    tab.show();
    expect(polled.poller.timeline).toHaveBeenCalledTimes(1);
    polled.read(timeline('Edited'));
    expect(timelines.at(-1)?.timeline?.description.body).toBe('Edited');

    tab.close();
    expect(polled.listeners.size).toBe(0);
  });

  it('asks a tab that acts as nobody to sign in, and reads a run’s nothing', () => {
    const polled = pollerOf(timeline('First'));
    const { tab, asked } = tabOf(polled.poller);
    tab.update(info({ acting: { kind: 'anonymous' } }));
    expect(tab.show().timeline).toMatchObject({ status: 'signIn' });
    tab.update(info({ run: [23, 24] }));
    expect(tab.show().timeline).toMatchObject({ status: 'run' });
    expect(asked).not.toHaveBeenCalled();
  });

  it('says why a timeline it never read failed, until a poll reads it', async () => {
    const polled = pollerOf(new Error('GitHub is down'));
    const { tab, timelines } = tabOf(polled.poller);
    tab.update(info());
    tab.show();
    await vi.waitFor(() => expect(timelines.at(-1)?.status).toBe('failed'));
    expect(timelines.at(-1)).toMatchObject({
      cause: 'failed',
      problem: 'Lo couldn’t read the timeline: GitHub is down',
      retryAt: null,
    });
    // The poller says when it reads it again, which the window counts down to.
    polled.retries(1_000_000);
    expect(timelines.at(-1)).toMatchObject({ status: 'failed', retryAt: 1_000_000 });
    const told = timelines.length;
    polled.goes({});
    expect(timelines.length, 'nothing new, nothing said').toBe(told);
    // GitHub can't be reached, as the poller says, not a read: no read fails for it.
    polled.goes({ offline: { since: 0, retryAt: 2_000_000, error: 'getaddrinfo ENOTFOUND.' } });
    expect(timelines.at(-1)).toMatchObject({
      status: 'failed',
      cause: 'offline',
      problem: 'Lo couldn’t read the timeline: getaddrinfo ENOTFOUND.',
      retryAt: 2_000_000,
    });
    polled.goes({ offline: undefined });
    expect(timelines.at(-1)).toMatchObject({ cause: 'failed', retryAt: 1_000_000 });

    polled.read(timeline('At last'));
    expect(timelines.at(-1)).toMatchObject({ status: 'ready', cause: null, problem: null });
    polled.failed();
    expect(timelines.at(-1)).toMatchObject({ status: 'ready', cause: null, problem: null });
  });

  it('reads a failed timeline again at once when asked, answering once the read has', async () => {
    const polled = pollerOf(new Error('GitHub is down'));
    const { tab, timelines } = tabOf(polled.poller);
    tab.update(info());
    tab.show();
    await vi.waitFor(() => expect(timelines.at(-1)?.status).toBe('failed'));
    let answered = false;
    const retried = tab.retry().then(() => {
      answered = true;
    });
    expect(polled.readAfresh).toHaveBeenCalledWith(PULL, TIMELINE);
    await Promise.resolve();
    expect(answered).toBe(false);
    // Failing again answers too: Try again rests, and the reason stays.
    polled.failed();
    await retried;
    expect(timelines.at(-1)?.status).toBe('failed');
    const again = tab.retry();
    polled.read(timeline('At last'));
    await again;
    expect(timelines.at(-1)?.status).toBe('ready');
  });

  it('stops waiting for the read it asked for once the poller stalls, or after a while', async () => {
    const polled = pollerOf(new Error('GitHub is down'));
    const { tab, timelines } = tabOf(polled.poller, 50);
    tab.update(info());
    tab.show();
    await vi.waitFor(() => expect(timelines.at(-1)?.status).toBe('failed'));
    // GitHub goes unreachable while it waits: no read will answer.
    const offline = tab.retry();
    polled.goes({ offline: { since: 0, retryAt: 2_000_000, error: 'Offline.' } });
    await offline;
    // Stalled, it asks for nothing.
    polled.readAfresh.mockClear();
    await tab.retry();
    expect(polled.readAfresh).not.toHaveBeenCalled();
    polled.goes({
      offline: undefined,
      rateLimit: { kind: 'paused', until: 0, reason: { kind: 'secondary' } },
    });
    await tab.retry();
    polled.goes({ rateLimit: { kind: 'normal' }, signedOut: true });
    await tab.retry();
    expect(polled.readAfresh).not.toHaveBeenCalled();
    // A read that gets no answer at all is given up on after the wait.
    polled.goes({ signedOut: false });
    await tab.retry();
    expect(polled.readAfresh).toHaveBeenCalledOnce();
    expect(polled.observers.size, 'what waited stops listening').toBe(1);
  });

  it('reads anew as another account', async () => {
    const polled = pollerOf(timeline('First'));
    const { tab, timelines, asked } = tabOf(polled.poller);
    tab.update(info());
    tab.show();
    await vi.waitFor(() => expect(timelines.at(-1)?.status).toBe('ready'));
    tab.update(info({ acting: { kind: 'account', login: 'mona' } }));
    expect(timelines.at(-1)).toMatchObject({ status: 'loading', timeline: null });
    await vi.waitFor(() => expect(asked).toHaveBeenLastCalledWith('mona'));
    expect(polled.listeners.size).toBe(1);
  });
});
