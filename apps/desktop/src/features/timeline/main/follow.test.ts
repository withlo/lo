import {
  PULL_REQUEST_SIDEBAR,
  PullRef,
  type ReadKind,
  TIMELINE,
  type Cached,
  type PollEvent,
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
  };
  return {
    poller,
    listeners,
    /** A poll read the timeline again, as `next`. */
    read(next: PullRequestTimeline) {
      kept.timeline = next;
      for (const listener of listeners) listener({ kind: 'read', pull: PULL, name: TIMELINE.name });
    },
    failed() {
      for (const listener of listeners) {
        listener({
          kind: 'readFailed',
          pull: PULL,
          name: TIMELINE.name,
          error: { kind: 'notFound', message: 'Not Found' },
        });
      }
    },
  };
}

function tabOf(poller: TimelinePoller) {
  const timelines: TimelineView[] = [];
  const sidebars: SidebarView[] = [];
  const asked = vi.fn<(login: string) => Promise<TimelinePoller>>(() => Promise.resolve(poller));
  const tab = new TimelineTab({
    id: 't1',
    github: { poller: asked },
    publish: { timeline: (view) => timelines.push(view), sidebar: (view) => sidebars.push(view) },
    log: () => undefined,
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
    expect(timelines.at(-1)?.problem).toBe('Lo couldn’t read the timeline: GitHub is down');

    polled.read(timeline('At last'));
    expect(timelines.at(-1)).toMatchObject({ status: 'ready', problem: null });
    polled.failed();
    expect(timelines.at(-1)).toMatchObject({ status: 'ready', problem: null });
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
