// Marking files viewed from a pull request's tab, in main: through the account's poller, which
// sends the write, against GitHub's recorded answers on rozed-dev/playground#2.

import {
  type FileViewedState,
  GithubClient,
  Poller,
  type PollEvent,
  PullRef,
  type PullRequest,
  Token,
  unchecked,
} from '@lo/github';
import { MemoryPollCache, replayFetch } from '@lo/testing';
import { describe, expect, it, onTestFinished, vi } from 'vitest';

import { openDatabase } from '../../../main/database.ts';
import { migrate } from '../../../main/migrations.ts';
import type { PullTabInfo } from '../../tab/service.ts';
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

/** rozed-dev/playground#2, as the viewed cassettes recorded it: its node ID, head and one file. */
const PULL = new PullRef('rozed-dev', 'playground', 2);
const ID = 'PR_kwDOVk6v9M8AAAABNQwF5A';
const HEAD = 'd712aa7652cc723fee5fd9b3eba867b0480d40da';
const NEWER = 'e'.repeat(40);
const OLDER = 'a'.repeat(40);
const FILE = 'stack-b.md';
const LOGIN = 'rozed-bot';

/** The pull request's details as a poll reads them, at `head`, with `files`' marks. */
function details(files: [string, FileViewedState][], head = HEAD): PullRequest {
  return unchecked<PullRequest>({
    id: ID,
    headRefOid: head,
    files: {
      totalCount: files.length,
      pageInfo: { hasNextPage: false, endCursor: null },
      nodes: files.map(([path, viewerViewedState]) => ({ path, viewerViewedState })),
    },
  });
}

/** #2's tab, shown at `shown`, GitHub's newest head `latest`, as `acting`. */
function info(overrides: Partial<PullTabInfo> = {}): PullTabInfo {
  return {
    id: 't1',
    repository: { owner: 'rozed-dev', name: 'playground' },
    number: 2,
    acting: { kind: 'account', login: LOGIN },
    shown: HEAD,
    latest: HEAD,
    provisional: false,
    local: { kind: 'waiting' },
    ...overrides,
  };
}

/** The GraphQL operation a request's body names, if it names one. */
function operationOf(body: string): string | undefined {
  if (body === '') return undefined;
  const parsed: unknown = JSON.parse(body);
  return typeof parsed === 'object' &&
    parsed !== null &&
    'operationName' in parsed &&
    typeof parsed.operationName === 'string'
    ? parsed.operationName
    : undefined;
}

/** The operation names of the viewed-mark writes `fetch` sent, in order. */
async function writesSent(seen: readonly { body: Uint8Array }[]): Promise<string[]> {
  return seen.flatMap((request) => {
    const operation = operationOf(new TextDecoder().decode(request.body));
    return operation?.endsWith('FileAsViewed') ? [operation] : [];
  });
}

/**
 * #2's tab's revisions, marking through a real poller whose client answers from `fetch`: the
 * poller's queue, pauses and writes are GitHub's as Lo meets them. The rest of the poller, its
 * details and events, is the test's.
 */
function viewedTab(fetch: typeof globalThis.fetch, tabInfo = info()) {
  const database = openDatabase(':memory:');
  migrate(database, migrations);
  const marks = new Marks(database);
  const client = new GithubClient({
    fetch,
    urls: {
      api: 'https://api.github.com',
      web: 'https://github.com',
      uploads: 'https://uploads.github.com',
    },
    token: new Token('gho_FAKE'),
  });
  const real = new Poller({
    accounts: {
      client: () => Promise.resolve(client),
      account: () => ({}),
      isSignedOut: () => false,
      onChange: () => () => undefined,
    },
    login: LOGIN,
    cache: new MemoryPollCache(),
  });
  onTestFinished(() => real.stop());
  const listeners = new Set<(event: PollEvent) => void>();
  let read: PullRequest | undefined = details([[FILE, 'UNVIEWED']]);
  const poller: HistoryPoller = {
    pushHistory: () => Promise.resolve(undefined),
    cachedRead: () => undefined,
    onEvent(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    pullRequest: () =>
      read === undefined
        ? undefined
        : { details: read, fetchedAt: Date.now(), offlineAge: undefined },
    writeChanging: (targets, request, options) => real.writeChanging(targets, request, options),
  };
  const logged: string[] = [];
  const tab = new RevisionsTab({
    id: 't1',
    github: { poller: () => Promise.resolve(poller) },
    clone: () => undefined,
    marks,
    publish: () => undefined,
    changed: () => undefined,
    log: (line) => logged.push(line),
  });
  onTestFinished(() => tab.close());
  tab.update(tabInfo);
  return {
    tab,
    marks,
    logged,
    /**
     * A poll read the pull request's details: what `pullRequest` has, and its event, once the tab
     * listens to the poller.
     */
    polled: async (next: PullRequest) => {
      await vi.waitFor(() => expect(listeners.size).toBeGreaterThan(0));
      read = next;
      for (const listener of listeners) listener({ kind: 'details', pull: PULL, details: next });
    },
  };
}

describe('marking files viewed', { timeout: 10_000 }, () => {
  it('marks a file viewed through the account’s poller, and notes the head it was marked at', async () => {
    const fetch = replayFetch('graphql_viewed_marks');
    const { tab, marks } = viewedTab(fetch);

    expect(await tab.markViewed(FILE, true, HEAD)).toEqual({ kind: 'done' });
    expect(marks.viewed(LOGIN, PULL)).toEqual([{ path: FILE, head: HEAD }]);

    // Clearing it forgets where it was viewed.
    expect(await tab.markViewed(FILE, false, HEAD)).toEqual({ kind: 'done' });
    expect(marks.viewed(LOGIN, PULL)).toEqual([]);
    expect(await writesSent(fetch.seen)).toEqual(['MarkFileAsViewed', 'UnmarkFileAsViewed']);
  });

  it('refuses to mark while GitHub’s newest head isn’t the one the diff shows, but clears', async () => {
    const fetch = replayFetch('graphql_viewed_marks');
    const { tab, marks } = viewedTab(fetch, info({ latest: NEWER }));

    // GitHub marks a file as of its newest head, which the reader hasn't seen.
    expect(await tab.markViewed(FILE, true, HEAD)).toEqual({ kind: 'moved', latest: NEWER });
    // Nor a comparison up to an older revision than the newest.
    expect(await tab.markViewed(FILE, true, OLDER)).toEqual({ kind: 'moved', latest: NEWER });
    expect(await writesSent(fetch.seen)).toEqual([]);
    expect(marks.viewed(LOGIN, PULL)).toEqual([]);

    // Clearing a mark needs no head.
    marks.noteViewed(LOGIN, PULL, FILE, OLDER, Date.now());
    expect(await tab.markViewed(FILE, false, HEAD)).toEqual({ kind: 'done' });
    expect(await writesSent(fetch.seen)).toEqual(['UnmarkFileAsViewed']);
    expect(marks.viewed(LOGIN, PULL)).toEqual([]);
  });

  it('refuses both while GitHub has asked Lo to hold off, rather than send them later', async () => {
    const replay = replayFetch('graphql_viewed_marks');
    let sent = 0;
    // GitHub turns the first write away with its secondary rate limit, for a minute.
    const fetch = Object.assign(
      async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const request = new Request(input, init);
        const operation = operationOf(await request.clone().text());
        if (operation?.endsWith('FileAsViewed')) sent += 1;
        if (operation === 'MarkFileAsViewed' && sent === 1) {
          return new Response(
            JSON.stringify({
              message:
                'You have exceeded a secondary rate limit. Please wait a few minutes before you try again.',
            }),
            {
              status: 403,
              headers: {
                'content-type': 'application/json',
                'retry-after': '60',
                'x-ratelimit-remaining': '4990',
              },
            },
          );
        }
        return replay(request);
      },
      { seen: replay.seen },
    );
    const { tab, marks } = viewedTab(fetch);

    await expect(tab.markViewed(FILE, true, HEAD)).rejects.toMatchObject({
      code: 'failed',
      message: expect.stringContaining('GitHub asked Lo to slow down'),
    });
    const now = Date.now();
    const paused = await tab.markViewed(FILE, true, HEAD);
    expect(paused).toMatchObject({ kind: 'paused' });
    expect(paused.kind === 'paused' && paused.until).toBeGreaterThan(now + 30_000);
    expect(await tab.markViewed(FILE, false, HEAD)).toMatchObject({ kind: 'paused' });
    // Only the first was sent.
    expect(sent).toBe(1);
    expect(marks.viewed(LOGIN, PULL)).toEqual([]);
  });

  it('a write GitHub refuses fails with why, and notes nothing', async () => {
    const { tab, marks, logged } = viewedTab(
      replayFetch('graphql_mark_file_as_viewed_unlisted_path'),
    );
    await expect(tab.markViewed('not-in-this-pull-request.md', true, HEAD)).rejects.toMatchObject({
      code: 'failed',
      message: expect.stringContaining(
        "GitHub doesn't list not-in-this-pull-request.md in this pull request",
      ),
    });
    expect(marks.viewed(LOGIN, PULL)).toEqual([]);
    expect(logged.join('\n')).toContain('not-in-this-pull-request.md');
  });

  it('a tab that acts as nobody marks nothing', async () => {
    const fetch = replayFetch('graphql_viewed_marks');
    const { tab } = viewedTab(fetch, info({ acting: { kind: 'anonymous' } }));
    await expect(tab.markViewed(FILE, true, HEAD)).rejects.toMatchObject({ code: 'refused' });
    expect(await writesSent(fetch.seen)).toEqual([]);
  });

  it('follows marks set elsewhere at the head a poll read them at, and forgets cleared ones', async () => {
    const { marks, polled } = viewedTab(replayFetch('graphql_viewed_marks'));
    marks.noteViewed(LOGIN, PULL, 'cleared.md', OLDER, Date.now());
    marks.noteViewed(LOGIN, PULL, 'changed.md', OLDER, Date.now());
    marks.noteViewed(LOGIN, PULL, 'again.md', OLDER, Date.now());

    await polled(
      details([
        ['elsewhere.md', 'VIEWED'],
        ['cleared.md', 'UNVIEWED'],
        // Changed since it was viewed: where it was viewed is where it shows from.
        ['changed.md', 'DISMISSED'],
        // Viewed again since, elsewhere.
        ['again.md', 'VIEWED'],
        ['never.md', 'UNVIEWED'],
      ]),
    );

    expect(marks.viewed(LOGIN, PULL)).toEqual([
      { path: 'again.md', head: HEAD },
      { path: 'changed.md', head: OLDER },
      { path: 'elsewhere.md', head: HEAD },
    ]);
  });
});
