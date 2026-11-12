// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { IpcError } from '../../../ipc/contract.ts';
import { notice } from '../../../window/commands/notices.tsx';
import { installBridge } from '../../../window/test/bridge.ts';
import type * as TabShared from '../../tab/window/shared.ts';
import type { Files, PullView } from '../../tab/window/shared.ts';
import { PATH_LIMIT } from '../../tree/contract.ts';
import type { ComparisonView } from '../contract.ts';
import { toggleViewed, viewedMarkOf, viewedMarksOf } from './shared.ts';
import { showView } from './store.ts';
import { takeFiles } from './viewed.ts';

/** A tab of its own for each test, so no write of one is still in another's marks. */
let TAB = 't0';
const HEAD = 'a'.repeat(40);
const OLDER = 'b'.repeat(40);
const NEWER = 'c'.repeat(40);

// What main last said of the tab's pull request and its files; the tab feature isn't loaded.
const said = vi.hoisted(() => ({ pull: undefined as unknown, files: undefined as unknown }));
vi.mock('../../tab/window/shared.ts', async (original) => ({
  ...(await original<typeof TabShared>()),
  pullOf: () => said.pull,
  changedFiles: () => said.files,
}));

const answers: Record<string, (input: unknown) => unknown> = {};
const bridge = installBridge(answers);

/** The tab's pull request at `HEAD`, live, as rozed-bot, with what `changes` changes. */
function pull(changes: Partial<PullView> = {}): PullView {
  return {
    id: TAB,
    loading: false,
    acting: { kind: 'account', login: 'rozed-bot' },
    header: null,
    connection: { kind: 'live' },
    problem: null,
    shown: HEAD,
    newer: null,
    ...changes,
  };
}

/** GitHub's list of the files, each with its mark. */
function files(marks: [string, Files['files'][number]['viewed']][]): Files {
  return { id: TAB, files: marks.map(([path, viewed]) => ({ path, viewed })), total: marks.length };
}

/** The revisions feature's view, comparing `from` with the head. */
function comparing(from: string | null, to = HEAD): ComparisonView {
  return {
    id: TAB,
    status: 'ready',
    revisions: [],
    base: null,
    markers: { review: null, lastSeen: null },
    shown: HEAD,
    comparison: { from, to },
    pending: null,
    offered: null,
    waitingFor: null,
    nothingNewSince: null,
    replay: null,
    conflicted: 0,
    uncertain: false,
    problem: null,
  };
}

/** Main says the files again, as a poll that read them does. */
function listed(list: Files): void {
  said.files = list;
  takeFiles(TAB, list);
}

const mark = (path: string) => viewedMarkOf(viewedMarksOf(TAB), { text: path });
const file = (text: string) => ({ path: { text }, previous: null });

/** Lets the window hear main's answer. */
const answered = () => new Promise((resolve) => setTimeout(resolve, 0));

let tabs = 0;

beforeEach(() => {
  tabs += 1;
  TAB = `t${tabs}`;
  bridge.calls.length = 0;
  said.pull = pull();
  showView(comparing(null));
  answers['revisions.markViewed'] = () => ({ kind: 'done' });
  listed(
    files([
      ['src/a.ts', 'unviewed'],
      ['src/b.ts', 'viewed'],
    ]),
  );
});

describe('e on a file', () => {
  it('marks it viewed at once, and asks main to, at the head the diff shows', async () => {
    expect(toggleViewed(TAB, file('src/a.ts'))).toEqual({ kind: 'marking' });
    expect(mark('src/a.ts')).toBe('viewed');
    expect(viewedMarksOf(TAB).count).toEqual({ viewed: 2, total: 2 });
    await answered();
    expect(bridge.calls).toEqual([
      ['revisions.markViewed', { id: TAB, path: 'src/a.ts', viewed: true, at: HEAD }],
    ]);
    expect(mark('src/a.ts')).toBe('viewed');
  });

  it('clears a viewed file’s mark', async () => {
    expect(toggleViewed(TAB, file('src/b.ts'))).toEqual({ kind: 'clearing' });
    expect(mark('src/b.ts')).toBe('unviewed');
    await answered();
    expect(bridge.calls).toEqual([
      ['revisions.markViewed', { id: TAB, path: 'src/b.ts', viewed: false, at: HEAD }],
    ]);
  });

  it('a finished write shows the new mark until GitHub says otherwise', async () => {
    toggleViewed(TAB, file('src/a.ts'));
    await answered();
    // A list read before the write, said again, doesn't undo it.
    expect(mark('src/a.ts')).toBe('viewed');
    // GitHub's own list after it.
    listed(
      files([
        ['src/a.ts', 'viewed'],
        ['src/b.ts', 'viewed'],
      ]),
    );
    expect(mark('src/a.ts')).toBe('viewed');
    // Cleared elsewhere since: GitHub's say wins.
    listed(
      files([
        ['src/a.ts', 'unviewed'],
        ['src/b.ts', 'viewed'],
      ]),
    );
    expect(mark('src/a.ts')).toBe('unviewed');
  });

  it('a failed write shows GitHub’s mark again, and says why', async () => {
    answers['revisions.markViewed'] = () => {
      throw new IpcError('failed', 'Couldn’t mark src/a.ts viewed: Lo can’t reach GitHub.');
    };
    toggleViewed(TAB, file('src/a.ts'));
    expect(mark('src/a.ts')).toBe('viewed');
    await answered();
    expect(mark('src/a.ts')).toBe('unviewed');
    expect(notice()).toEqual({
      title: 'Mark viewed',
      body: 'Couldn’t mark src/a.ts viewed: Lo can’t reach GitHub.',
    });
  });

  it('main’s refusals in a pause or after a push show GitHub’s mark again', async () => {
    answers['revisions.markViewed'] = () => ({ kind: 'paused', until: Date.now() + 60_000 });
    toggleViewed(TAB, file('src/a.ts'));
    await answered();
    expect(mark('src/a.ts')).toBe('unviewed');
    expect(notice()?.body).toContain('GitHub asked Lo to hold off until');

    answers['revisions.markViewed'] = () => ({ kind: 'moved', latest: NEWER });
    toggleViewed(TAB, file('src/a.ts'));
    await answered();
    expect(mark('src/a.ts')).toBe('unviewed');
    expect(notice()?.body).toContain('There’s a newer push');
  });
});

/** `e` on `path` refused, with nothing sent and no mark changed. */
async function refused(path: string): Promise<string> {
  const before = mark(path);
  const toggled = toggleViewed(TAB, file(path));
  await answered();
  expect(bridge.calls).toEqual([]);
  expect(mark(path)).toBe(before);
  if (toggled.kind !== 'refused') throw new Error(`not refused: ${toggled.kind}`);
  return toggled.why;
}

describe('what e refuses before anything is sent', () => {
  it('marking while there’s a newer push, or a diff of an older revision, but not clearing', async () => {
    said.pull = pull({ newer: NEWER });
    expect(await refused('src/a.ts')).toContain('There’s a newer push');

    said.pull = pull();
    showView(comparing(null, OLDER));
    expect(await refused('src/a.ts')).toContain('older revision than the newest push');

    said.pull = pull({ newer: NEWER });
    expect(toggleViewed(TAB, file('src/b.ts'))).toEqual({ kind: 'clearing' });
  });

  it('either while GitHub has asked Lo to hold off, or can’t be reached', async () => {
    const until = Date.now() + 60_000;
    said.pull = pull({
      connection: { kind: 'rateLimited', login: 'rozed-bot', until, secondary: true },
    });
    expect(await refused('src/a.ts')).toContain('GitHub asked Lo to hold off until');
    expect(await refused('src/b.ts')).toContain('GitHub asked Lo to hold off until');

    said.pull = pull({
      connection: { kind: 'offline', savedAt: null, retryAt: null, error: 'offline' },
    });
    expect(await refused('src/a.ts')).toContain('Lo can’t reach GitHub');
  });

  it('a tab that acts as nobody, a file GitHub doesn’t list, and a path too long', async () => {
    said.pull = pull({ acting: { kind: 'anonymous' } });
    expect(await refused('src/a.ts')).toContain('Sign in to mark files viewed');

    said.pull = pull();
    expect(await refused('src/c.ts')).toContain('GitHub doesn’t list src/c.ts');
    expect(await refused('x'.repeat(PATH_LIMIT + 1))).toContain('paths of up to 1,024 bytes');
  });

  it('keeps GitHub’s marks only for paths short enough to key a map by', () => {
    listed(
      files([
        ['src/a.ts', 'viewed'],
        ['x'.repeat(PATH_LIMIT + 1), 'viewed'],
      ]),
    );
    expect([...viewedMarksOf(TAB).byPath.keys()]).toEqual(['src/a.ts']);
  });
});
