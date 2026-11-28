// The merge queues' tabs in main: a queue opens as the account its pull request's tab acts as, and
// never from a tab that reads without signing in; its pull requests open as the queue's account;
// only the tab on screen is read, and a tab stops being read as it closes; and an account's queues
// aren't read while it's signed out or Lo doesn't have it, and are again as soon as it's back.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AccountState, GithubEvent } from '../../accounts/service.ts';
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

/** An account Lo has, signed in. */
function account(login: string): Pick<AccountState, 'account' | 'signedOut'> {
  return {
    account: { login, userId: 1, source: 'deviceFlow', scopes: [], addedAt: 0 },
    signedOut: undefined,
  };
}

/**
 * Lo's tabs, its accounts and GitHub, as the merge queues see them: pull requests' tabs acting as
 * `pulls` says, tabs opened as the window would show them, tess-okafor and rozed-bot signed in, and
 * each read noted. No poller reads as either account: the queues are all that do.
 */
function harness(pulls: Readonly<Record<string, Acting | undefined>> = {}) {
  let value: Tabs = { tabs: [RECENT], active: 'recent' };
  const tabListeners = new Set<(tabs: Tabs) => void>();
  const eventListeners = new Set<(event: GithubEvent) => void>();
  const changeListeners = new Set<() => void>();
  let accounts = [account('tess-okafor'), account('rozed-bot')];
  /** While checks are held, each read of the accounts answers only when `answer` says. */
  const checks = { held: false, waiting: [] as (() => void)[] };
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
      accounts: () => {
        // What the accounts are as they're read, whenever the answer comes.
        const now = accounts;
        if (!checks.held) return Promise.resolve(now);
        return new Promise((resolve) => checks.waiting.push(() => resolve(now)));
      },
      onEvent(listener) {
        eventListeners.add(listener);
        return () => eventListeners.delete(listener);
      },
      onChange(listener) {
        changeListeners.add(listener);
        return () => changeListeners.delete(listener);
      },
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
      removal: () => Promise.reject(new Error('Nothing left the queue here.')),
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
    /** Holds each read of the accounts from now on, until `answer` lets the oldest one answer. */
    holdChecks: () => {
      checks.held = true;
    },
    answerCheck: () => checks.waiting.shift()?.(),
    /** Signs `login` out, as GitHub refusing its token does: the event, then the change. */
    signOut: (login: string) => {
      accounts = accounts.map((each) =>
        each.account.login === login ? { ...each, signedOut: 'refused' } : each,
      );
      for (const listener of eventListeners) listener({ kind: 'signedOut', login, why: 'refused' });
      for (const listener of changeListeners) listener();
    },
    /** Signs `login` in again, or adds it, which changes the accounts and sends no event. */
    signIn: (login: string) => {
      accounts = [...accounts.filter((each) => each.account.login !== login), account(login)];
      for (const listener of changeListeners) listener();
    },
    /** Removes `login`, as signing out of it in Lo does: the change, then the event. */
    remove: (login: string) => {
      accounts = accounts.filter((each) => each.account.login !== login);
      for (const listener of changeListeners) listener();
      for (const listener of eventListeners) listener({ kind: 'removed', login });
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
    expect(() => queues.show('anonymous', 'main')).toThrow('Sign in to open the merge queue');
    expect(() => queues.show('choosing', 'main')).toThrow(
      'Lo is still working out which account this tab uses.',
    );
    expect(() => queues.show('closed', 'main')).toThrow(
      'There’s no pull request’s tab with that id.',
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
    expect(() => queues.open('recent', 150)).toThrow('There’s no merge queue’s tab with that id.');
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

  it('reads the queue and those waiting to join again when asked to look, begun since', async () => {
    const { queues, asked, setTabs } = harness();
    setTabs({ tabs: [RECENT, queueTab('q', 'main')], active: 'q' });
    queues.start();
    await vi.advanceTimersByTimeAsync(1_000);
    asked.length = 0;
    // Read a moment ago, both are read again all the same.
    const looking = queues.look('q');
    await vi.advanceTimersByTimeAsync(0);
    // What it read is in its answer, as the tab has it: what's on `queue` can come after.
    expect(await looking).toEqual({ read: queues.state('q')?.read, failed: undefined });
    expect(asked).toEqual(['q view main', 'q waiting main']);
    expect(await queues.look('closed')).toEqual({ read: undefined, failed: undefined });
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
  it('isn’t read while it’s signed out, and is again once it’s signed in, though only its queue read as it', async () => {
    const { queues, asked, setTabs, signOut, signIn } = harness();
    setTabs({
      tabs: [RECENT, queueTab('q', 'main'), queueTab('r', 'main', 'rozed-bot')],
      active: 'q',
    });
    queues.start();
    await vi.advanceTimersByTimeAsync(0);
    signOut('tess-okafor');
    await vi.advanceTimersByTimeAsync(0);
    expect(queues.state('q')?.failure).toEqual({
      message: 'tess-okafor is signed out.',
      retryAt: null,
    });
    // Another account's queue isn't held.
    expect(queues.state('r')?.failure).toBeNull();
    asked.length = 0;
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(asked).toEqual([]);

    // No poller saw it signed out: the accounts saying it's signed in again is enough.
    signIn('tess-okafor');
    await vi.advanceTimersByTimeAsync(0);
    expect(asked).toEqual(['q view main', 'q waiting main']);
    expect(queues.state('q')?.failure).toBeNull();
  });

  it('isn’t read once it’s removed, and is again once it’s added back', async () => {
    const { queues, asked, setTabs, remove, signIn } = harness();
    setTabs({ tabs: [RECENT, queueTab('q', 'main')], active: 'q' });
    queues.start();
    await vi.advanceTimersByTimeAsync(0);
    asked.length = 0;
    remove('tess-okafor');
    expect(asked).toEqual(['q forgets its poller']);
    await vi.advanceTimersByTimeAsync(0);
    expect(queues.state('q')?.failure?.message).toBe('tess-okafor is signed out.');
    asked.length = 0;
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(asked).toEqual([]);

    signIn('tess-okafor');
    await vi.advanceTimersByTimeAsync(0);
    expect(asked).toEqual(['q view main', 'q waiting main']);
  });

  it('isn’t read when its tab comes back with Lo while it’s signed out, or Lo doesn’t have it', async () => {
    const { queues, asked, setTabs, signOut, signIn } = harness();
    signOut('tess-okafor');
    setTabs({
      tabs: [RECENT, queueTab('q', 'main'), queueTab('s', 'main', 'sam-lee')],
      active: 'q',
    });
    queues.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(asked).toEqual([]);
    expect(queues.state('q')?.failure?.message).toBe('tess-okafor is signed out.');

    setTabs({
      tabs: [RECENT, queueTab('q', 'main'), queueTab('s', 'main', 'sam-lee')],
      active: 's',
    });
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(asked).toEqual([]);
    expect(queues.state('s')?.failure?.message).toBe('sam-lee is signed out.');
    signIn('sam-lee');
    await vi.advanceTimersByTimeAsync(0);
    expect(asked).toEqual(['s view main', 's waiting main']);
  });

  it('reads again only the queues of the account that’s back, not another’s still away', async () => {
    const { queues, asked, setTabs, signOut, signIn } = harness();
    const both = [RECENT, queueTab('q', 'main'), queueTab('r', 'main', 'rozed-bot')];
    setTabs({ tabs: both, active: 'q' });
    queues.start();
    await vi.advanceTimersByTimeAsync(0);
    signOut('tess-okafor');
    signOut('rozed-bot');
    await vi.advanceTimersByTimeAsync(0);
    asked.length = 0;

    signIn('tess-okafor');
    await vi.advanceTimersByTimeAsync(0);
    expect(asked).toEqual(['q view main', 'q waiting main']);
    expect(queues.state('r')?.failure?.message).toBe('rozed-bot is signed out.');
    asked.length = 0;
    setTabs({ tabs: both, active: 'r' });
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(asked).toEqual([]);
  });

  it('drops a check of the accounts begun before an account was signed out', async () => {
    const { queues, asked, setTabs, signOut, signIn, holdChecks, answerCheck } = harness();
    setTabs({ tabs: [RECENT, queueTab('q', 'main')], active: 'q' });
    queues.start();
    await vi.advanceTimersByTimeAsync(0);
    holdChecks();
    // A check begins while tess-okafor is signed in, and answers only after it's signed out.
    signIn('sam-lee');
    signOut('tess-okafor');
    answerCheck();
    await vi.advanceTimersByTimeAsync(0);
    const signedOut = 'tess-okafor is signed out.';
    expect(queues.state('q')?.failure?.message).toBe(signedOut);
    asked.length = 0;
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(asked).toEqual([]);

    // The check the sign-out began agrees.
    answerCheck();
    await vi.advanceTimersByTimeAsync(0);
    expect(queues.state('q')?.failure?.message).toBe(signedOut);
  });
});
