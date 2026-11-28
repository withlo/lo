import {
  GithubError,
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
  type ReadPriorityNow,
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
    head: { fork: null, forked: false },
    state: 'open',
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
    pushHistory: vi.fn<TimelinePoller['pushHistory']>(() => Promise.resolve(undefined)),
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
    /** The cache holds no timeline, nor does GitHub answer one yet. */
    empty() {
      delete kept.timeline;
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
  const screen: { on: string | undefined } = { on: 't1' };
  const tab = new TimelineTab({
    id: 't1',
    github: { poller: asked },
    onScreen: () => screen.on,
    publish: { timeline: (view) => timelines.push(view), sidebar: (view) => sidebars.push(view) },
    log: () => undefined,
    readWait,
  });
  return { tab, timelines, sidebars, asked, screen };
}

/** A read's priority as it stands now, as the poller takes it whenever the queue comes free. */
function now(first: ReadPriorityNow | undefined): string | undefined {
  return typeof first === 'function' ? first() : first;
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

  it('reads the timeline and what goes beside it ahead of polls while its tab is on screen, then the push history', async () => {
    const polled = pollerOf(timeline('First'));
    polled.empty();
    const { tab, screen } = tabOf(polled.poller);
    tab.update(info());
    tab.show();
    await vi.waitFor(() => expect(polled.poller.pullRequestSidebar).toHaveBeenCalled());
    const read = vi.mocked(polled.poller.timeline).mock.calls[0]?.[1];
    const beside = vi.mocked(polled.poller.pullRequestSidebar).mock.calls[0]?.[1];
    const pushes = vi.mocked(polled.poller.pushHistory).mock.calls[0]?.[1];
    expect([now(read), now(beside), now(pushes)]).toEqual([
      'foreground',
      'foreground',
      'background',
    ]);
    // The rows split pushes by revision: the push history goes once they can draw, as the newest
    // page of a long timeline comes, ahead of its older pages, or once the timeline is in.
    const onNewest = vi.mocked(polled.poller.timeline).mock.calls[0]?.[2];
    onNewest?.({ ...timeline('First'), leftOut: 120 });
    expect(now(pushes)).toBe('foreground');
    polled.read(timeline('First'));
    expect(now(pushes)).toBe('foreground');
    // Another tab on screen: nobody's waiting on any of them.
    screen.on = 't2';
    expect([now(read), now(beside), now(pushes)]).toEqual([
      'background',
      'background',
      'background',
    ]);
    tab.close();
  });

  it('draws a long timeline’s newest page while its older pages are read', async () => {
    const polled = pollerOf(timeline('First'));
    polled.empty();
    const { tab, timelines } = tabOf(polled.poller);
    tab.update(info());
    tab.show();
    await vi.waitFor(() => expect(polled.poller.timeline).toHaveBeenCalled());
    const onNewest = vi.mocked(polled.poller.timeline).mock.calls[0]?.[2];
    onNewest?.({ ...timeline('First'), leftOut: 120 });
    expect(timelines.at(-1)).toMatchObject({
      status: 'loading',
      timeline: { leftOut: 120, description: { body: 'First' } },
    });
    // The whole timeline takes its place.
    polled.read(timeline('First'));
    expect(timelines.at(-1)).toMatchObject({ status: 'ready', timeline: { leftOut: 0 } });
    // A later read's newest page changes nothing.
    const count = timelines.length;
    onNewest?.({ ...timeline('Later'), leftOut: 120 });
    expect(timelines).toHaveLength(count);
    tab.close();
  });

  it('draws nothing of a pull request the tab has left', async () => {
    const polled = pollerOf(timeline('First'));
    polled.empty();
    const left = Promise.withResolvers<Cached<PullRequestTimeline> | undefined>();
    vi.mocked(polled.poller.timeline).mockImplementationOnce(() => left.promise);
    const { tab, timelines } = tabOf(polled.poller);
    tab.update(info());
    tab.show();
    await vi.waitFor(() => expect(polled.poller.timeline).toHaveBeenCalled());
    const onNewest = vi.mocked(polled.poller.timeline).mock.calls[0]?.[2];
    // The tab goes to #24 as the same account, so the same poller reads it.
    tab.update(info({ number: 24 }));
    await vi.waitFor(() => expect(polled.poller.timeline).toHaveBeenCalledTimes(2));
    const count = timelines.length;
    // #23's newest page, then the whole of it.
    onNewest?.({ ...timeline('First'), leftOut: 120 });
    left.resolve(cached(timeline('First')));
    await new Promise((resolve) => setTimeout(resolve));
    expect(timelines).toHaveLength(count);
    expect(timelines.at(-1)).toMatchObject({ status: 'loading', timeline: null });
    tab.close();
  });

  it('says why a long timeline failed after its newest page came', async () => {
    const polled = pollerOf(timeline('First'));
    polled.empty();
    const { tab, timelines } = tabOf(polled.poller);
    tab.update(info());
    tab.show();
    await vi.waitFor(() => expect(polled.poller.timeline).toHaveBeenCalled());
    vi.mocked(polled.poller.timeline).mock.calls[0]?.[2]?.({ ...timeline('First'), leftOut: 120 });
    polled.failed({ kind: 'api', status: 502, message: 'Server Error', errors: [] });
    expect(timelines.at(-1)).toMatchObject({ status: 'failed', timeline: null });
    tab.close();
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
    const polled = pollerOf(
      new GithubError({ kind: 'api', status: 502, message: 'Server Error', errors: [] }),
    );
    const { tab, timelines } = tabOf(polled.poller);
    tab.update(info());
    tab.show();
    await vi.waitFor(() => expect(timelines.at(-1)?.status).toBe('failed'));
    // GitHub's cause, which the window words, and only what GitHub said for Details.
    expect(timelines.at(-1)).toMatchObject({
      cause: { kind: 'github' },
      details: '502 Bad Gateway\nServer Error',
      retryAt: null,
      stalled: false,
    });
    // The poller says when it reads it again, which the window counts down to.
    polled.retries(1_000_000);
    expect(timelines.at(-1)).toMatchObject({ status: 'failed', retryAt: 1_000_000 });
    const told = timelines.length;
    polled.goes({});
    polled.goes({});
    expect(timelines.length, 'nothing new, nothing said').toBe(told);
    // GitHub can't be reached, as the poller says, not a read: no read fails for it. The tab's
    // banner says the wait, so no time is said here.
    polled.goes({
      offline: {
        since: 0,
        retryAt: 2_000_000,
        cause: { kind: 'offline' },
        error: 'getaddrinfo ENOTFOUND.',
      },
    });
    expect(timelines.at(-1)).toMatchObject({
      status: 'failed',
      cause: { kind: 'offline' },
      details: 'getaddrinfo ENOTFOUND.',
      retryAt: null,
      stalled: true,
    });
    // Nor while the rate limit holds every read, or the account is signed out.
    polled.goes({
      offline: undefined,
      rateLimit: { kind: 'paused', until: 0, reason: { kind: 'secondary' } },
    });
    const github = { cause: { kind: 'github' }, retryAt: null, stalled: true };
    expect(timelines.at(-1)).toMatchObject(github);
    polled.goes({ rateLimit: { kind: 'normal' }, signedOut: true });
    expect(timelines.at(-1)).toMatchObject(github);
    polled.goes({ signedOut: false });
    expect(timelines.at(-1)).toMatchObject({ ...github, retryAt: 1_000_000, stalled: false });

    polled.read(timeline('At last'));
    expect(timelines.at(-1)).toMatchObject({ status: 'ready', cause: null, details: null });
    polled.failed();
    expect(timelines.at(-1)).toMatchObject({ status: 'ready', cause: null, details: null });
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
    polled.goes({
      offline: { since: 0, retryAt: 2_000_000, cause: { kind: 'offline' }, error: 'Offline.' },
    });
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

  it('shows what it saved when it opens offline, failing only once that has been read', async () => {
    const polled = pollerOf(timeline('Saved'));
    polled.goes({
      offline: { since: 0, retryAt: 2_000_000, cause: { kind: 'offline' }, error: 'Offline.' },
    });
    const { tab, timelines } = tabOf(polled.poller);
    tab.update(info());
    expect(tab.show().timeline.status).toBe('loading');
    await vi.waitFor(() => expect(timelines.at(-1)?.status).toBe('ready'));
    expect(timelines.map((view) => view.status)).not.toContain('failed');

    // With nothing saved, it says so once the cache has answered.
    const empty = pollerOf(timeline('Saved'));
    empty.empty();
    empty.goes({
      offline: {
        since: 0,
        retryAt: 2_000_000,
        cause: { kind: 'timeout' },
        error: 'read ECONNRESET',
      },
    });
    const opened = tabOf(empty.poller);
    opened.tab.update(info());
    opened.tab.show();
    await vi.waitFor(() => expect(opened.timelines.at(-1)?.status).toBe('failed'));
    expect(opened.timelines.at(-1)).toMatchObject({
      cause: { kind: 'timeout' },
      details: 'read ECONNRESET',
      stalled: true,
    });
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
