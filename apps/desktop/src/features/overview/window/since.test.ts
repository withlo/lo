// @vitest-environment jsdom
// What changed since a tab's overview's commit, as the window keeps it: each file read and diffed
// once for the head on screen, without highlighting, keeping only which lines changed; a newer head
// replaces it all; a block on screen goes first; a file the local copy wasn't ready for is asked
// again; a closed tab's goes; and following maps a place onto the head only for the overview on
// screen and the head it's out of date against. The clock is the test's own, so whether a small file
// is diffed at once or by the diff's job doesn't depend on how fast the machine is.

import { checkArtifact, parseArtifact } from '@lo/artifact';
import { diffText } from '@lo/diff';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { installBridge } from '../../../window/test/bridge.ts';
import type { LocalState, PullView } from '../../tab/contract.ts';
import type { FileSinceText, OverviewCommit, OverviewState, SinceReply } from '../contract.ts';
import { treeEntries } from '../jobs.ts';
import { quickClock } from '../test/clock.ts';
import type { CheckedOverview } from './checking.ts';
import { QUICK_LIMIT } from './files.ts';

const R1 = '1'.repeat(40);
const R2 = '2'.repeat(40);
const R3 = '3'.repeat(40);
const clock = quickClock();

/** What the window asked the diff, the tab's head on screen and its overview, as the test sets them. */
const fake = vi.hoisted(() => ({
  diffed: [] as { path: string; highlight: boolean | undefined }[],
  pull: undefined as PullView | undefined,
  state: undefined as OverviewState | undefined,
  result: undefined as CheckedOverview | undefined,
  /** Each tab's local copy, and who's told as it changes. */
  locals: new Map<string, LocalState>(),
  listeners: new Set<(tab: string, local: LocalState) => void>(),
}));

vi.mock(import('../../diff/window/shared.ts'), async (original) => ({
  ...(await original()),
  diffTexts: (files, _signal, options) => {
    for (const file of files) fake.diffed.push({ path: file.path, highlight: options?.highlight });
    return Promise.resolve(
      files.map((file) => ({
        ok: true as const,
        diff: diffText(file.old ?? undefined, file.new ?? undefined, { whitespace: true }),
        tokens: {},
        changes: { deleted: [], added: [] },
      })),
    );
  },
}));

vi.mock(import('../../tab/window/shared.ts'), async (original) => ({
  ...(await original()),
  pullOf: () => fake.pull,
  localCopyOf: (tab) => fake.locals.get(tab),
  onLocalCopy: (listener) => {
    fake.listeners.add(listener);
    return () => fake.listeners.delete(listener);
  },
}));

/** Tab `tab`'s local copy changes to `local`, as main says. */
function copyIs(local: LocalState): void {
  fake.locals.set(tab, local);
  for (const listener of fake.listeners) listener(tab, local);
}

vi.mock(import('./store.ts'), async (original) => ({
  ...(await original()),
  states: { get: () => fake.state, set() {}, update() {}, subscribe: () => () => {} },
  checked: { get: () => fake.result, set() {}, update() {}, subscribe: () => () => {} },
}));

const { blocksChanged, fileSince, keepSinceOnly, placeOnHead, sinceCount } =
  await import('./since.ts');

/** What main answers for each file, by its path, and for the count. */
const files = new Map<string, FileSinceText>();
let count: SinceReply = { kind: 'read', files: 2 };
/** Holds each file's read until the test lets it go, when set. */
let gate: Promise<void> | undefined;

const bridge = installBridge({
  'overview.since': () => count,
  'overview.sinceFile': async (input) => {
    await gate;
    const path = String(Reflect.get(Object(input), 'path'));
    const found = files.get(path);
    if (!found) throw new Error(`No file at ${path}.`);
    return found;
  },
});

const OLD = 'a\nb\nc\nd\n';
const NOW = 'added\na\nb\nC\nd\n';

let tab = 't0';
let tabs = 0;
beforeEach(() => {
  tabs += 1;
  tab = `t${tabs}`;
  files.clear();
  bridge.calls.length = 0;
  fake.diffed.length = 0;
  gate = undefined;
  count = { kind: 'read', files: 2 };
  files.set('src/a.ts', {
    kind: 'changed',
    path: 'src/b.ts',
    pushed: true,
    texts: { old: OLD, new: NOW },
  });
  files.set('src/same.ts', { kind: 'same', path: 'src/same.ts' });
});

/** What main was asked, as `[channel, what of its input is named `field`]`. */
const asked = (field: string) =>
  bridge.calls.map(([channel, input]) => [channel, Reflect.get(Object(input), field)]);

/** The reads of files main was asked for, as `[channel, input]`. */
const fileReads = () => bridge.calls.filter(([channel]) => channel === 'overview.sinceFile');

/** The local copy, ready at the head. */
const READY: LocalState = {
  kind: 'ready',
  head: R2,
  base: 'b'.repeat(40),
  mergeBase: null,
  offline: false,
};

/** Lets what's under way settle. */
async function settled(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/** A code block's lines. */
function block(path: string, start: number, end: number) {
  return { kind: 'code' as const, path, lines: { start, end } };
}

describe('what changed since', () => {
  it('reads and diffs each file once for the head, keeping no text', async () => {
    const since = await fileSince(tab, R1, R2, 'src/a.ts');
    expect(since).toEqual({
      kind: 'changed',
      path: 'src/b.ts',
      pushed: true,
      changes: [
        { old: { start: 1, end: 1 }, new: { start: 1, end: 2 } },
        { old: { start: 3, end: 4 }, new: { start: 4, end: 5 } },
      ],
    });
    expect(JSON.stringify(since)).not.toContain('added');
    await fileSince(tab, R1, R2, 'src/a.ts');
    expect(fileReads()).toEqual([
      ['overview.sinceFile', { id: tab, commit: R1, head: R2, path: 'src/a.ts' }],
    ]);
    // Small, it's diffed here, at once, rather than by the diff's background job.
    expect(fake.diffed).toEqual([]);
    // A file that's the same isn't diffed.
    expect(await fileSince(tab, R1, R2, 'src/same.ts')).toEqual({
      kind: 'same',
      path: 'src/same.ts',
    });
    expect(fake.diffed).toEqual([]);
  });

  it('diffs a larger file, or one for an overview kept behind, by the diff’s job, without highlighting', async () => {
    const lines = Array.from({ length: QUICK_LIMIT / 8 }, (_, index) => `line ${index}`);
    const old = `${lines.join('\n')}\n`;
    files.set('src/large.ts', {
      kind: 'changed',
      path: 'src/large.ts',
      pushed: true,
      texts: { old, new: old.replace('line 7\n', 'line seven\n') },
    });
    expect(await fileSince(tab, R1, R2, 'src/large.ts')).toEqual({
      kind: 'changed',
      path: 'src/large.ts',
      pushed: true,
      changes: [{ old: { start: 8, end: 9 }, new: { start: 8, end: 9 } }],
    });
    expect(fake.diffed).toEqual([{ path: 'src/large.ts', highlight: false }]);
    // And a small one for an overview kept behind another view.
    await fileSince(tab, R1, R2, 'src/a.ts', { quick: false });
    expect(fake.diffed).toEqual([
      { path: 'src/large.ts', highlight: false },
      { path: 'src/b.ts', highlight: false },
    ]);
  });

  it('diffs a small file by the diff’s job, without highlighting, once the frame’s share is spent, until the next frame', async () => {
    // Each diff takes all of the share, so one spends it for the rest of its frame.
    clock.takes(8);
    for (const path of ['src/first.ts', 'src/second.ts', 'src/third.ts']) {
      files.set(path, { kind: 'changed', path, pushed: true, texts: { old: OLD, new: NOW } });
    }
    const first = await fileSince(tab, R1, R2, 'src/first.ts');
    expect(fake.diffed).toEqual([]);
    expect(await fileSince(tab, R1, R2, 'src/second.ts')).toEqual({
      ...first,
      path: 'src/second.ts',
    });
    expect(fake.diffed).toEqual([{ path: 'src/second.ts', highlight: false }]);
    // The frame over, its share is whole, and a small file is diffed at once again.
    clock.endFrame();
    expect(await fileSince(tab, R1, R2, 'src/third.ts')).toEqual({
      ...first,
      path: 'src/third.ts',
    });
    expect(fake.diffed).toEqual([{ path: 'src/second.ts', highlight: false }]);
  });

  it('works it all out again for a newer head, which replaces the last', async () => {
    await fileSince(tab, R1, R2, 'src/a.ts');
    await sinceCount(tab, R1, R2);
    await fileSince(tab, R1, R3, 'src/a.ts');
    await sinceCount(tab, R1, R3);
    // The last head's was let go, so going back reads it again.
    await fileSince(tab, R1, R2, 'src/a.ts');
    expect(asked('head')).toEqual([
      ['overview.sinceFile', R2],
      ['overview.since', R2],
      ['overview.sinceFile', R3],
      ['overview.since', R3],
      ['overview.sinceFile', R2],
    ]);
  });

  it('counts once, asking again as the local copy changes while it isn’t ready', async () => {
    count = { kind: 'waiting' };
    const counting = sinceCount(tab, R1, R2);
    await settled();
    count = { kind: 'read', files: 4 };
    // Nothing changed of the copy, so it isn't asked again.
    await settled();
    expect(bridge.calls.filter(([channel]) => channel === 'overview.since')).toHaveLength(1);
    copyIs(READY);
    expect(await counting).toEqual({ kind: 'read', files: 4 });
    expect(await sinceCount(tab, R1, R2)).toEqual({ kind: 'read', files: 4 });
    expect(bridge.calls.filter(([channel]) => channel === 'overview.since')).toHaveLength(2);
  });

  it('asks again for a file as the local copy changes, until it’s ready for it', async () => {
    files.set('src/later.ts', { kind: 'waiting' });
    const later = fileSince(tab, R1, R2, 'src/later.ts');
    await settled();
    copyIs({ kind: 'fetching', progress: null, attempt: 1 });
    await settled();
    expect(fileReads()).toHaveLength(2);
    files.set('src/later.ts', { kind: 'deleted' });
    copyIs(READY);
    expect(await later).toEqual({ kind: 'deleted' });
    expect(fileReads()).toHaveLength(3);
    // Known now, it isn't asked again.
    expect(await fileSince(tab, R1, R2, 'src/later.ts')).toEqual({ kind: 'deleted' });
    expect(fileReads()).toHaveLength(3);
  });

  it('stops waiting for the local copy once the head on screen moves on', async () => {
    files.set('src/later.ts', { kind: 'waiting' });
    const later = fileSince(tab, R1, R2, 'src/later.ts');
    await settled();
    files.set('src/later.ts', { kind: 'same', path: 'src/later.ts' });
    expect(await fileSince(tab, R1, R3, 'src/later.ts')).toEqual({
      kind: 'same',
      path: 'src/later.ts',
    });
    expect(await later).toEqual({ kind: 'unknown', why: 'The read was stopped.' });
    expect(fake.listeners.size).toBe(0);
  });

  it('reads two files at a time, a block on screen’s first', async () => {
    let open!: () => void;
    gate = new Promise((resolve) => (open = resolve));
    for (const path of ['f1', 'f2', 'f3', 'f4']) files.set(path, { kind: 'same', path });
    const all = ['f1', 'f2', 'f3'].map((path) => fileSince(tab, R1, R2, path));
    const soon = fileSince(tab, R1, R2, 'f4', { soon: true });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fileReads().map(([, input]) => Reflect.get(Object(input), 'path'))).toEqual([
      'f1',
      'f2',
    ]);
    open();
    await Promise.all([...all, soon]);
    expect(fileReads().map(([, input]) => Reflect.get(Object(input), 'path'))).toEqual([
      'f1',
      'f2',
      'f4',
      'f3',
    ]);
  });

  it('counts the code blocks on lines the pushes since changed', async () => {
    files.set('src/base.ts', {
      kind: 'changed',
      path: 'src/base.ts',
      pushed: false,
      texts: { old: OLD, new: NOW },
    });
    expect(
      await blocksChanged(tab, R1, R2, [
        // Line 3 changed.
        block('src/a.ts', 2, 3),
        // Lines 1–2 moved down, unchanged.
        block('src/a.ts', 1, 2),
        block('src/same.ts', 1, 4),
        // Only the base branch changed it.
        block('src/base.ts', 3, 3),
      ]),
    ).toBe(1);
    // None while how a file changed isn't known.
    files.set('src/later.ts', {
      kind: 'unread',
      why: 'Lo couldn’t tell where the file went since.',
    });
    expect(
      await blocksChanged(tab, R1, R2, [block('src/a.ts', 2, 3), block('src/later.ts', 1, 1)]),
    ).toBeUndefined();
  });

  it('lets a closed tab’s go', async () => {
    await fileSince(tab, R1, R2, 'src/a.ts');
    keepSinceOnly(new Set());
    await fileSince(tab, R1, R2, 'src/a.ts');
    expect(fileReads()).toHaveLength(2);
  });
});

/** The tab's head on screen. */
function at(head: string): void {
  fake.pull = {
    id: tab,
    loading: false,
    acting: null,
    header: null,
    connection: { kind: 'live' },
    problem: null,
    shown: head,
    newer: null,
  };
}

describe('placeOnHead', () => {
  const encoder = new TextEncoder();

  /** Tab `tab`'s overview, written for `commit`, as the window checked it. */
  async function shown(commit: string): Promise<void> {
    const text = encoder.encode(
      `---\nformat: 1\npr: 80\ncommit: ${commit}\n---\n\n## tl;dr\n\nIt.\n`,
    );
    const overview: OverviewCommit = {
      id: 'c'.repeat(40),
      source: 'base',
      repository: { owner: 'o', name: 'r' },
      byline: { login: 'o', name: 'O', at: 0 },
      entries: [{ path: 'artifact.md', kind: 'file', size: text.length, id: 'b'.repeat(40) }],
      truncated: false,
      read: true,
    };
    const parsed = parseArtifact(text);
    const checked = await checkArtifact(
      parsed,
      { entries: treeEntries(overview.entries), read: async () => ({ kind: 'missing' }) },
      async () => ({ kind: 'missing' }),
      { pr: 80 },
    );
    fake.state = {
      id: tab,
      ref: 'refs/lo/pr/80',
      watching: true,
      found: 'commit',
      overview,
      newer: null,
      saved: false,
      problem: null,
      code: 'ready',
    };
    fake.result = {
      kind: 'checked',
      key: 'k',
      commit: overview,
      parsed,
      checked,
      figures: new Map(),
      coming: [],
      code: { kind: 'none' },
    };
  }

  it('maps a place onto the head once its file is known, and keeps what’s written till then', async () => {
    await shown(R1);
    at(R2);
    const lines = { start: 2, end: 4 };
    expect(placeOnHead(tab, 'src/a.ts', lines)).toEqual({
      path: 'src/a.ts',
      line: 2,
      lines: { from: 2, to: 4 },
    });
    await fileSince(tab, R1, R2, 'src/a.ts');
    expect(placeOnHead(tab, 'src/a.ts', lines)).toEqual({
      path: 'src/b.ts',
      line: 3,
      lines: { from: 3, to: 5 },
    });
  });

  it('maps nothing for an overview of the head on screen, or for another head', async () => {
    await shown(R1);
    at(R2);
    await fileSince(tab, R1, R2, 'src/a.ts');
    at(R1);
    expect(placeOnHead(tab, 'src/a.ts', { start: 2, end: 2 })).toMatchObject({
      path: 'src/a.ts',
      line: 2,
    });
    at(R3);
    expect(placeOnHead(tab, 'src/a.ts', { start: 2, end: 2 })).toMatchObject({
      path: 'src/a.ts',
      line: 2,
    });
  });
});
