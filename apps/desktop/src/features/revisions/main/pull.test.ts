import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseOid, type Repo } from '@lo/git';
import {
  type FileViewedState,
  GithubClient,
  PullRef,
  type PollEvent,
  type PullRequest,
  type PushHistory,
  readPushHistory,
  Token,
  unchecked,
} from '@lo/github';
import { replayFetch } from '@lo/testing';
import { APP_PULL, gitProgram, writeAppRemote } from '@lo/testing/git';
import { describe, expect, it, onTestFinished, vi } from 'vitest';

import { openDatabase } from '../../../main/database.ts';
import { createGit } from '../../../main/git.ts';
import { migrate } from '../../../main/migrations.ts';
import type { LocalState } from '../../tab/contract.ts';
import type { PullTabInfo } from '../../tab/service.ts';
import type { ComparisonView } from '../contract.ts';
import type { OnScreen } from '../service.ts';
import { Marks } from './marks.ts';
import { type HistoryPoller, RevisionsTab } from './pull.ts';

const migrations = Object.fromEntries(
  Object.entries(
    import.meta.glob<string>('../migrations/*.sql', {
      eager: true,
      query: '?raw',
      import: 'default',
    }),
  ).map(([path, sql]) => [path.replace(/^\.\.\//, '/src/features/revisions/'), sql]),
);

const PULL = new PullRef(APP_PULL.owner, APP_PULL.repo, APP_PULL.number);
const LOGIN = 'rozed-bot';

function folder(prefix = 'lo-revisions-'): string {
  const path = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  onTestFinished(() => rmSync(path, { recursive: true, force: true }));
  return path;
}

const remotes = new Map<boolean, string>();

/**
 * rozed-dev/e2e's clone in a new cache with #80 fetched into it, from a remote that has the first
 * push, as GitHub does, or doesn't, as if GitHub no longer had it.
 */
async function e2eClone(firstPush = true): Promise<Repo> {
  let remote = remotes.get(firstPush);
  if (remote === undefined) {
    remote = writeAppRemote(realpathSync(mkdtempSync(join(tmpdir(), 'lo-revisions-remote-'))), {
      firstPush,
    });
    remotes.set(firstPush, remote);
  }
  const git = createGit({
    settings: { program: gitProgram(), test: { remote } },
    root: join(folder(), 'cache'),
    env: process.env,
    platform: process.platform,
    log: () => undefined,
    cleanUp: () => Promise.resolve(),
  });
  onTestFinished(() => git.stop());
  await git.check();
  const cache = git.cache;
  if (!cache) throw new Error('the cache is closed');
  const repo = await cache.open('rozed-dev', 'e2e', {});
  onTestFinished(() => repo.close());
  await repo.fetchPull({
    number: APP_PULL.number,
    head: parseOid(APP_PULL.head),
    baseBranch: 'app/base',
    base: parseOid(APP_PULL.base),
  });
  return repo;
}

/** #80's push history, as the poller reads it, from the app's cassette. */
async function e2eHistory(): Promise<PushHistory> {
  const client = new GithubClient({
    fetch: replayFetch('app_e2e'),
    urls: {
      api: 'https://api.github.com',
      web: 'https://github.com',
      uploads: 'https://uploads.github.com',
    },
    token: new Token('gho_FAKE'),
  });
  return readPushHistory(client, PULL, LOGIN);
}

const READY: LocalState = {
  kind: 'ready',
  head: APP_PULL.head,
  base: APP_PULL.base,
  mergeBase: APP_PULL.base,
  offline: false,
};

/** #80's tab, shown at its head, its local copy `local`. */
function e2eInfo(local: LocalState = READY): PullTabInfo {
  return {
    id: 't1',
    repository: { owner: 'rozed-dev', name: 'e2e' },
    number: APP_PULL.number,
    acting: { kind: 'account', login: LOGIN },
    shown: APP_PULL.head,
    latest: APP_PULL.head,
    provisional: false,
    local,
  };
}

/** A poller that has `history` for #80, and the listeners a test can send events to. */
function pollerOf(history: PushHistory | undefined) {
  const listeners = new Set<(event: PollEvent) => void>();
  let kept = history;
  let details: PullRequest | undefined;
  const poller: HistoryPoller = {
    pushHistory: () =>
      Promise.resolve(kept === undefined ? undefined : { value: kept, fetchedAt: Date.now() }),
    cachedRead: () => (kept === undefined ? undefined : { value: kept, fetchedAt: Date.now() }),
    onEvent(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    pullRequest: () =>
      details === undefined ? undefined : { details, fetchedAt: Date.now(), offlineAge: undefined },
    // Writes are viewed.test.ts's.
    writeChanging: () => Promise.reject(new Error('no writes here')),
  };
  return {
    poller,
    /**
     * A poll read #80's details at `head`, its own unless said, with `files`' viewed marks, as the
     * poller says once the tab listens to it.
     */
    async polled(files: [string, FileViewedState][], head: string = APP_PULL.head) {
      await vi.waitFor(() => expect(listeners.size).toBeGreaterThan(0));
      details = unchecked<PullRequest>({
        id: 'PR_e2e',
        headRefOid: head,
        files: {
          totalCount: files.length,
          nodes: files.map(([path, viewerViewedState]) => ({ path, viewerViewedState })),
        },
      });
      for (const listener of listeners) listener({ kind: 'details', pull: PULL, details });
    },
    /** GitHub gave another push history, as a poll that read it again would say. */
    read(next: PushHistory) {
      kept = next;
      for (const listener of listeners) listener({ kind: 'read', pull: PULL, name: 'PushHistory' });
    },
  };
}

/** A tab's revisions, with a fresh database, and what they sent collected. */
function revisionsTab(options: {
  repo: Repo | undefined;
  history: PushHistory | undefined;
  marks?: Marks;
  holdLimit?: number;
}) {
  const database = openDatabase(':memory:');
  migrate(database, migrations);
  const marks = options.marks ?? new Marks(database);
  const sent: ComparisonView[] = [];
  const logged: string[] = [];
  let changes = 0;
  const source = pollerOf(options.history);
  const tab = new RevisionsTab({
    id: 't1',
    github: { poller: () => Promise.resolve(source.poller) },
    clone: () => (options.repo ? Promise.resolve(options.repo) : undefined),
    marks,
    publish: (view) => sent.push(view),
    changed: () => {
      changes += 1;
    },
    log: (line) => logged.push(line),
    holdLimit: options.holdLimit,
  });
  onTestFinished(() => tab.close());
  return {
    tab,
    marks,
    sent,
    logged,
    source,
    get changes() {
      return changes;
    },
    /** The last view sent, once `check` holds of it. */
    settled(check: (view: ComparisonView) => boolean) {
      return vi.waitFor(
        () => {
          const last = sent.at(-1);
          if (!last || !check(last)) throw new Error(`not yet: ${JSON.stringify(last)}`);
          return last;
        },
        { timeout: 20_000, interval: 20 },
      );
    },
    /** What the tab compares, once `check` holds of it. */
    onScreen(check: (screen: OnScreen) => boolean) {
      return vi.waitFor(
        () => {
          const screen = tab.onScreen();
          if (!check(screen)) throw new Error(`not yet: ${screen.kind}`);
          return screen;
        },
        { timeout: 20_000, interval: 20 },
      );
    },
  };
}

/** The files shown from where they left off in `screen`, by group, with their paths. */
function sinceOf(screen: OnScreen) {
  if (screen.kind === 'waiting') return undefined;
  return screen.since?.groups.map(({ label, why, paths }) => ({ label, why, paths }));
}

describe('RevisionsTab', { timeout: 60_000 }, () => {
  it('builds the revisions from the push history, and fetches every head into the local copy', async () => {
    const made = revisionsTab({ repo: await e2eClone(), history: await e2eHistory() });
    made.tab.update(e2eInfo());
    const view = await made.settled((sent) => sent.revisions.some((revision) => revision.rebased));
    expect(view).toMatchObject({
      status: 'ready',
      base: { branch: 'app/base', tip: APP_PULL.base },
      markers: { review: null, lastSeen: null },
      shown: APP_PULL.head,
      comparison: { from: null, to: APP_PULL.head },
      pending: null,
      waitingFor: null,
      nothingNewSince: null,
      problem: null,
    });
    // The first push, then the force-push that rebased it onto the moved base.
    expect(view.revisions).toEqual([
      {
        head: APP_PULL.firstHead,
        number: 1,
        pushedAt: { kind: 'exact', at: expect.any(Number) },
        forced: null,
        pusher: 'rozed-bot',
        rebased: false,
        available: true,
      },
      {
        head: APP_PULL.head,
        number: 2,
        pushedAt: { kind: 'exact', at: expect.any(Number) },
        forced: true,
        pusher: 'rozed-bot',
        rebased: true,
        available: true,
      },
    ]);
    // The whole pull request needs no comparison of revisions.
    expect(made.tab.onScreen()).toEqual({ kind: 'head' });
  });

  it('compares two revisions across a rebase, showing only what the author changed', async () => {
    const made = revisionsTab({ repo: await e2eClone(), history: await e2eHistory() });
    made.tab.update(e2eInfo());
    await made.settled((sent) => sent.status === 'ready');
    made.tab.compare(APP_PULL.firstHead, APP_PULL.head);
    const screen = await made.onScreen((shown) => shown.kind === 'revisions');
    if (screen.kind !== 'revisions') throw new Error('not comparing');
    const { comparing } = screen;
    // Each side starts where it branched off the base as it was when it was pushed.
    expect(comparing.old).toEqual({ head: APP_PULL.firstHead, base: APP_PULL.firstBase });
    expect(comparing.new).toEqual({ head: APP_PULL.head, base: APP_PULL.base });
    const compared = await comparing.compared();
    if ('refused' in compared) throw new Error('refused');
    expect(compared.replay).toEqual({ kind: 'clean' });
    // The README the base changed, and everything the first push already had, don't show.
    expect(compared.files.map((file) => file.path.toString())).toEqual(['src/parser.ts']);
    // Made once, for every feature that shows it.
    expect(comparing.compared()).toBe(comparing.compared());
    const view = await made.settled((sent) => sent.replay !== null);
    expect(view).toMatchObject({
      comparison: { from: APP_PULL.firstHead, to: APP_PULL.head },
      pending: null,
      replay: 'clean',
      conflicted: 0,
      uncertain: false,
    });
  });

  it('opens on what changed since the reader last looked here, and draws nothing before', async () => {
    // A wait long enough for the comparison, however slow the machine.
    const made = revisionsTab({
      repo: await e2eClone(),
      history: await e2eHistory(),
      holdLimit: 30_000,
    });
    made.marks.setLastSeen(LOGIN, PULL, APP_PULL.firstHead, Date.now() - 60_000);
    made.tab.update(e2eInfo({ kind: 'fetching', progress: null, attempt: 1 }));
    // The diff waits rather than draw the whole pull request and then move.
    await made.onScreen((screen) => screen.kind === 'waiting');
    made.tab.update(e2eInfo());
    const screen = await made.onScreen((shown) => shown.kind === 'revisions');
    expect(screen.kind === 'revisions' && screen.comparing.old.head).toBe(APP_PULL.firstHead);
    const view = await made.settled((sent) => sent.comparison?.from === APP_PULL.firstHead);
    expect(view.markers).toEqual({ review: null, lastSeen: APP_PULL.firstHead });
  });

  it('offers what changed since the account last reviewed, which only the push history says', async () => {
    const history = await e2eHistory();
    const reviewed: PushHistory = {
      ...history,
      viewerLastReview: { at: history.openedAt, commit: APP_PULL.firstHead, author: undefined },
    };
    const made = revisionsTab({ repo: await e2eClone(), history: reviewed });
    made.tab.update(e2eInfo());
    // Nothing held the diff for it, so it may be drawn already: the comparison is offered.
    const view = await made.settled((sent) => sent.offered !== null);
    expect(view).toMatchObject({
      markers: { review: APP_PULL.firstHead, lastSeen: null },
      comparison: { from: null, to: APP_PULL.head },
      offered: { from: APP_PULL.firstHead, to: APP_PULL.head },
    });
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(made.tab.onScreen()).toEqual({ kind: 'head' });
    // The reader takes it.
    made.tab.compare(APP_PULL.firstHead, APP_PULL.head);
    await made.onScreen((screen) => screen.kind === 'revisions');
    expect(made.sent.at(-1)?.offered).toBe(null);
  });

  it('shows the whole pull request when a marker is on the head on screen, with nothing new since it', async () => {
    const made = revisionsTab({ repo: await e2eClone(), history: await e2eHistory() });
    made.marks.setLastSeen(LOGIN, PULL, APP_PULL.head, Date.now() - 60_000);
    made.tab.update(e2eInfo());
    const view = await made.settled((sent) => sent.status === 'ready');
    expect(view).toMatchObject({
      comparison: { from: null, to: APP_PULL.head },
      nothingNewSince: APP_PULL.head,
    });
    expect(made.tab.onScreen()).toEqual({ kind: 'head' });
  });

  it('shows a revision GitHub no longer has, and Lo never fetched, as no longer available', async () => {
    const made = revisionsTab({ repo: await e2eClone(false), history: await e2eHistory() });
    made.marks.setLastSeen(LOGIN, PULL, APP_PULL.firstHead, Date.now() - 60_000);
    made.tab.update(e2eInfo());
    const view = await made.settled((sent) => sent.revisions[0]?.available === false);
    expect(view.revisions.map((revision) => revision.available)).toEqual([false, true]);
    // The marker's revision is gone, and none before it is left: the whole pull request shows.
    await made.onScreen((screen) => screen.kind === 'head');
    expect(() => made.tab.compare(APP_PULL.firstHead, APP_PULL.head)).toThrow(
      expect.objectContaining({ code: 'unavailable', message: 'r1 is no longer available.' }),
    );
  });

  it('fetches the heads of revisions built before the local copy was ready, once it is', async () => {
    const made = revisionsTab({ repo: await e2eClone(false), history: await e2eHistory() });
    made.tab.update(e2eInfo({ kind: 'fetching', progress: null, attempt: 1 }));
    await made.settled((sent) => sent.status === 'ready');
    // The copy is ready: the revisions are built again with its commits while their heads fetch.
    made.tab.update(e2eInfo());
    const view = await made.settled((sent) => sent.revisions[0]?.available === false);
    expect(view.revisions.map((revision) => revision.available)).toEqual([false, true]);
  });

  it('refuses a comparison that isn’t from an older revision to a newer one', async () => {
    const made = revisionsTab({ repo: await e2eClone(), history: await e2eHistory() });
    made.tab.update(e2eInfo());
    await made.settled((sent) => sent.status === 'ready');
    expect(() => made.tab.compare(APP_PULL.head, APP_PULL.firstHead)).toThrow(
      expect.objectContaining({ code: 'invalid' }),
    );
    expect(() => made.tab.compare(APP_PULL.head, APP_PULL.head)).toThrow(
      expect.objectContaining({ code: 'invalid' }),
    );
    expect(() => made.tab.compare(null, APP_PULL.base)).toThrow(
      expect.objectContaining({ code: 'invalid' }),
    );
    // The whole pull request up to an older revision is a comparison of revisions too.
    made.tab.compare(null, APP_PULL.firstHead);
    const screen = await made.onScreen((shown) => shown.kind === 'revisions');
    expect(screen.kind === 'revisions' && screen.comparing.old).toEqual({
      head: APP_PULL.firstBase,
      base: APP_PULL.firstBase,
    });
  });

  it('waits for a push history whose head is GitHub’s newest', async () => {
    const history = await e2eHistory();
    const made = revisionsTab({
      repo: await e2eClone(),
      history: { ...history, head: APP_PULL.firstHead },
    });
    made.tab.update(e2eInfo());
    await made.settled((sent) => sent.shown === APP_PULL.head);
    // The history from before the second push, which the poller had, builds nothing.
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(made.sent.at(-1)).toMatchObject({ status: 'loading', revisions: [] });
    made.source.read(history);
    const view = await made.settled((sent) => sent.status === 'ready');
    expect(view.revisions.at(-1)?.head).toBe(APP_PULL.head);
  });

  it('notes the newest revision the reader saw as last seen here, on leaving, never an older one', async () => {
    const made = revisionsTab({ repo: await e2eClone(), history: await e2eHistory() });
    made.tab.update(e2eInfo());
    await made.settled((sent) => sent.status === 'ready');
    made.tab.left();
    // Nothing was drawn, so nothing was seen.
    expect(made.marks.lastSeen(LOGIN, PULL)).toBeUndefined();
    made.tab.drawn(APP_PULL.head);
    made.tab.drawn(APP_PULL.firstHead);
    made.tab.left();
    expect(made.marks.lastSeen(LOGIN, PULL)).toBe(APP_PULL.head);
  });

  it('draws the whole pull request when the comparison last seen asks for comes late, and only offers it', async () => {
    const made = revisionsTab({
      repo: await e2eClone(),
      history: await e2eHistory(),
      holdLimit: 50,
    });
    made.marks.setLastSeen(LOGIN, PULL, APP_PULL.firstHead, Date.now() - 60_000);
    made.tab.update(e2eInfo({ kind: 'fetching', progress: null, attempt: 1 }));
    expect(made.tab.onScreen().kind).toBe('waiting');
    // The local copy is late: the whole pull request is drawn.
    await made.onScreen((screen) => screen.kind === 'head');
    const view = await made.settled((sent) => sent.offered !== null);
    expect(view.offered).toEqual({ from: APP_PULL.firstHead, to: APP_PULL.head });
    // It comes: the comparison is ready to take, but nothing on screen changes by itself.
    made.tab.update(e2eInfo());
    await made.settled((sent) => sent.revisions.some((revision) => revision.rebased));
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(made.tab.onScreen()).toEqual({ kind: 'head' });
    expect(made.sent.at(-1)).toMatchObject({
      comparison: { from: null, to: APP_PULL.head },
      offered: { from: APP_PULL.firstHead, to: APP_PULL.head },
      pending: null,
    });
    // Until the reader asks.
    made.tab.compare(APP_PULL.firstHead, APP_PULL.head);
    await made.onScreen((screen) => screen.kind === 'revisions');
  });

  it('reads no revisions for a tab that acts as nobody', async () => {
    const made = revisionsTab({ repo: undefined, history: undefined });
    made.tab.update({ ...e2eInfo(), acting: { kind: 'anonymous' } });
    const view = await made.settled(() => true);
    expect(view.status).toBe('signIn');
    expect(() => made.tab.compare(null, APP_PULL.head)).toThrow(
      expect.objectContaining({ code: 'refused' }),
    );
  });

  describe('files a push changed since they were viewed', () => {
    it('a viewed file a later push changed shows what changed since it was viewed, across the rebase', async () => {
      const made = revisionsTab({ repo: await e2eClone(), history: await e2eHistory() });
      // Viewed here at the first push; one viewed elsewhere, with no review to go by.
      made.marks.noteViewed(LOGIN, PULL, 'src/parser.ts', APP_PULL.firstHead, Date.now());
      made.tab.update(e2eInfo());
      await made.source.polled([
        ['src/parser.ts', 'DISMISSED'],
        ['src/format.ts', 'DISMISSED'],
        ['src/legacy.ts', 'VIEWED'],
      ]);
      const screen = await made.onScreen((shown) => sinceOf(shown) !== undefined);
      expect(screen.kind).toBe('head');
      expect(sinceOf(screen)).toEqual([{ label: 'r1', why: 'viewed', paths: ['src/parser.ts'] }]);
      if (screen.kind !== 'head' || !screen.since) throw new Error('nothing since');
      const [group] = screen.since.groups;
      // From where the first push branched, onto the base the second rebased onto.
      expect(group?.comparing.old).toEqual({ head: APP_PULL.firstHead, base: APP_PULL.firstBase });
      expect(group?.comparing.new).toEqual({ head: APP_PULL.head, base: APP_PULL.base });
      const compared = await group?.comparing.compared();
      if (!compared || 'refused' in compared) throw new Error('refused');
      expect(compared.replay.kind).toBe('clean');
    });

    it('a file keeps showing from where it left off once it’s marked viewed again', async () => {
      const made = revisionsTab({ repo: await e2eClone(), history: await e2eHistory() });
      made.marks.noteViewed(LOGIN, PULL, 'src/parser.ts', APP_PULL.firstHead, Date.now());
      made.tab.update(e2eInfo());
      await made.source.polled([['src/parser.ts', 'DISMISSED']]);
      const screen = await made.onScreen((shown) => sinceOf(shown) !== undefined);
      const key = screen.kind === 'head' ? screen.since?.key : undefined;

      await made.source.polled([['src/parser.ts', 'VIEWED']]);
      const again = made.tab.onScreen();
      expect(again.kind === 'head' ? again.since?.key : undefined).toBe(key);
    });

    it('only narrows: a comparison that starts where a file was viewed shows it as it is', async () => {
      const made = revisionsTab({ repo: await e2eClone(), history: await e2eHistory() });
      made.marks.noteViewed(LOGIN, PULL, 'src/parser.ts', APP_PULL.firstHead, Date.now());
      made.tab.update(e2eInfo());
      await made.source.polled([['src/parser.ts', 'DISMISSED']]);
      await made.onScreen((shown) => sinceOf(shown) !== undefined);

      made.tab.compare(APP_PULL.firstHead, APP_PULL.head);
      const screen = await made.onScreen((shown) => shown.kind === 'revisions');
      expect(sinceOf(screen)).toBeUndefined();
    });

    it('waits for GitHub’s marks to be of the head on screen', async () => {
      const made = revisionsTab({ repo: await e2eClone(), history: await e2eHistory() });
      made.marks.noteViewed(LOGIN, PULL, 'src/parser.ts', APP_PULL.firstHead, Date.now());
      made.tab.update(e2eInfo());
      // GitHub's details are of a push since, which the tab hasn't heard of yet: its marks say
      // what changed since the file was viewed as of that one.
      await made.source.polled([['src/parser.ts', 'DISMISSED']], 'f'.repeat(40));
      await made.settled((sent) => sent.revisions.some((revision) => revision.rebased));
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(sinceOf(made.tab.onScreen())).toBeUndefined();

      // Once they're of the head on screen, the file shows from where it was viewed.
      await made.source.polled([['src/parser.ts', 'DISMISSED']]);
      await made.onScreen((shown) => sinceOf(shown) !== undefined);
    });
  });
});
