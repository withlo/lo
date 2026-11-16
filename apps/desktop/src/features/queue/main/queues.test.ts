// The merge queues' tabs in main: a queue opens as the account its pull request's tab acts as, and
// never from a tab that reads without signing in; its pull requests open as the queue's account;
// only the tab on screen is read, and a tab stops being read as it closes; and an account's queues
// aren't read while it's signed out or once it's removed, until it's back.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { GithubEvent } from '../../accounts/service.ts';
import type { Acting, Opening, QueueOpening, QueueTab, Tab, Tabs } from '../../tab/contract.ts';
import { Queues, type QueuesOptions, type TabSource } from './queues.ts';

beforeEach(() => {
  vi.useFakeTimers({ now: 1_000_000 });
});

afterEach(() => {
  vi.useRealTimers();
});

const RECENT: Tab = { id: 'recent', kind: 'recent' };

function queueTab(id: string, branch: string, login = 'tess-okafor'): QueueTab {
  return { id, kind: 'queue', owner: 'rozed-dev', repo: 'e2e', branch, login };
}

/** What a queue is read as, and nothing of it. */
function emptyView(branch: string) {
  return { branch, viewerPermission: 'WRITE' as const, queue: undefined, leftOut: [] };
}

/**
 * Lo's tabs, its accounts and GitHub, as the merge queues see them: pull requests' tabs acting as
 * `pulls` says, tabs opened as the window would show them, and each read and poller change noted.
 */
function harness(pulls: Readonly<Record<string, Acting | undefined>> = {}) {
  let value: Tabs = { tabs: [RECENT], active: 'recent' };
  const tabListeners = new Set<(tabs: Tabs) => void>();
  const eventListeners = new Set<(event: GithubEvent) => void>();
  const pollerListeners = new Set<() => void>();
  const poller = { signedOut: false };
  const opened: [Opening | QueueOpening, { login: string } | undefined][] = [];
  const asked: string[] = [];
  let made = 0;
  const setTabs = (next: Tabs) => {
    value = next;
    for (const listener of tabListeners) listener(value);
  };
  const options: QueuesOptions = {
    tabs: {
      list: () => value,
      onTabs(listener) {
        tabListeners.add(listener);
        return () => tabListeners.delete(listener);
      },
      pull: (id) =>
        Object.hasOwn(pulls, id)
          ? { repository: { owner: 'rozed-dev', name: 'e2e' }, acting: pulls[id] }
          : undefined,
      open(opening, as) {
        opened.push([opening, as]);
        if (opening.kind !== 'queue') return 'pull';
        const same = value.tabs.find(
          (tab) => tab.kind === 'queue' && tab.repo === opening.repo && tab.login === opening.login,
        );
        const id = same?.id ?? `q${++made}`;
        const tab = queueTab(id, opening.branch, opening.login);
        const tabs = same
          ? value.tabs.map((each) => (each.id === id ? tab : each))
          : [...value.tabs, tab];
        setTabs({ tabs, active: id });
        return id;
      },
    },
    github: {
      onEvent(listener) {
        eventListeners.add(listener);
        return () => eventListeners.delete(listener);
      },
      poller: async () => ({
        status: () => ({ signedOut: poller.signedOut }),
        onChange(listener) {
          pollerListeners.add(listener);
          return () => pollerListeners.delete(listener);
        },
      }),
    },
    sourceFor: (tab): TabSource => ({
      async view(branch) {
        asked.push(`${tab.id} view ${branch}`);
        return emptyView(branch);
      },
      async waiting(branch) {
        asked.push(`${tab.id} waiting ${branch}`);
        return { branch, pullRequests: [], total: 0, leftOut: [] };
      },
      repository: () => ({ list: undefined, rules: undefined }),
      forget: () => asked.push(`${tab.id} forgets its poller`),
    }),
    publish: () => undefined,
  };
  const queues = new Queues(options);
  return {
    queues,
    opened,
    asked,
    setTabs,
    emit: (event: GithubEvent) => {
      for (const listener of eventListeners) listener(event);
    },
    /** The account's poller says whether it's signed out. */
    setSignedOut: (signedOut: boolean) => {
      poller.signedOut = signedOut;
      for (const listener of pollerListeners) listener();
    },
  };
}

describe('opening a merge queue', () => {
  it('opens the queue as the account the pull request’s tab acts as', () => {
    const { queues, opened } = harness({ p: { kind: 'account', login: 'tess-okafor' } });
    queues.start();
    expect(queues.show('p', 'main')).toBe('q1');
    expect(opened).toEqual([
      [
        { kind: 'queue', owner: 'rozed-dev', repo: 'e2e', branch: 'main', login: 'tess-okafor' },
        undefined,
      ],
    ]);
  });

  it('refuses a tab that reads without signing in, or hasn’t chosen its account yet', () => {
    const { queues, opened } = harness({ anonymous: { kind: 'anonymous' }, choosing: undefined });
    queues.start();
    expect(() => queues.show('anonymous', 'main')).toThrow(
      'Lo reads a merge queue as a signed-in account. This tab reads without signing in.',
    );
    expect(() => queues.show('choosing', 'main')).toThrow(
      'Lo is still working out which account this tab uses.',
    );
    expect(() => queues.show('closed', 'main')).toThrow(
      "There's no pull request's tab with that id.",
    );
    expect(opened).toEqual([]);
  });

  it('shows another branch in a queue’s tab as the queue’s own account', () => {
    const { queues, opened, setTabs } = harness();
    setTabs({ tabs: [RECENT, queueTab('q', 'main', 'rozed-bot')], active: 'q' });
    queues.start();
    queues.show('q', 'e4/queued');
    expect(opened.at(-1)?.[0]).toMatchObject({ branch: 'e4/queued', login: 'rozed-bot' });
  });

  it('opens a queue’s pull request in a tab as the queue’s account', () => {
    const { queues, opened, setTabs } = harness();
    setTabs({ tabs: [RECENT, queueTab('q', 'main', 'rozed-bot')], active: 'q' });
    queues.start();
    queues.open('q', 150);
    expect(opened).toEqual([
      [{ kind: 'pull', owner: 'rozed-dev', repo: 'e2e', number: 150 }, { login: 'rozed-bot' }],
    ]);
    expect(() => queues.open('recent', 150)).toThrow("There's no merge queue's tab with that id.");
  });
});

describe('reading the queues', () => {
  it('reads only the tab on screen, at the branch it shows, and stops as its tab closes', async () => {
    const { queues, asked, setTabs } = harness();
    setTabs({ tabs: [RECENT, queueTab('q', 'main')], active: 'recent' });
    queues.start();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(asked).toEqual([]);
    expect(queues.state('q')).toMatchObject({ branch: 'main', read: { kind: 'reading' } });

    setTabs({ tabs: [RECENT, queueTab('q', 'main')], active: 'q' });
    await vi.advanceTimersByTimeAsync(0);
    expect(asked).toEqual(['q view main', 'q waiting main']);

    asked.length = 0;
    setTabs({ tabs: [RECENT, queueTab('q', 'release/2.8')], active: 'q' });
    await vi.advanceTimersByTimeAsync(0);
    expect(asked).toEqual(['q view release/2.8', 'q waiting release/2.8']);

    asked.length = 0;
    setTabs({ tabs: [RECENT], active: 'recent' });
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(asked).toEqual([]);
    expect(queues.state('q')).toBeUndefined();
  });

  it('reads nothing once Lo quits', async () => {
    const { queues, asked, setTabs } = harness();
    setTabs({ tabs: [RECENT, queueTab('q', 'main')], active: 'q' });
    queues.start();
    await vi.advanceTimersByTimeAsync(0);
    queues.stop();
    asked.length = 0;
    setTabs({ tabs: [RECENT, queueTab('q', 'dev')], active: 'q' });
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(asked).toEqual([]);
  });
});

describe('an account that goes away', () => {
  it('isn’t read while it’s signed out, and is again once its poller says it’s signed in', async () => {
    const { queues, asked, setTabs, emit, setSignedOut } = harness();
    setTabs({
      tabs: [RECENT, queueTab('q', 'main'), queueTab('r', 'main', 'rozed-bot')],
      active: 'q',
    });
    queues.start();
    await vi.advanceTimersByTimeAsync(0);
    emit({ kind: 'signedOut', login: 'Tess-Okafor', why: 'refused' });
    expect(queues.state('q')?.failure).toEqual({
      message: 'Tess-Okafor is signed out. Lo reads the queue again once you sign in to it.',
      retryAt: null,
    });
    // Another account's queue isn't held.
    expect(queues.state('r')?.failure).toBeNull();
    setSignedOut(true);
    asked.length = 0;
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(asked).toEqual([]);

    setSignedOut(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(asked).toEqual(['q view main', 'q waiting main']);
    expect(queues.state('q')?.failure).toBeNull();
  });

  it('isn’t read once it’s removed, until a pull request’s tab acting as it opens the queue again', async () => {
    const { queues, asked, setTabs, emit } = harness({
      p: { kind: 'account', login: 'tess-okafor' },
    });
    setTabs({ tabs: [RECENT, queueTab('q', 'main')], active: 'q' });
    queues.start();
    await vi.advanceTimersByTimeAsync(0);
    asked.length = 0;
    emit({ kind: 'removed', login: 'tess-okafor' });
    expect(asked).toEqual(['q forgets its poller']);
    expect(queues.state('q')?.failure?.message).toBe(
      'You signed out of tess-okafor. Open the queue again from a pull request’s tab.',
    );
    asked.length = 0;
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(asked).toEqual([]);

    queues.show('p', 'main');
    await vi.advanceTimersByTimeAsync(0);
    expect(asked).toEqual(['q view main', 'q waiting main']);
  });
});
