// @vitest-environment jsdom
// The comment boxes of a view's diff and its overview's code blocks: opened from `c`, `C` and `s`,
// refused where GitHub takes no comment, restored from main's drafts where they were written, saved
// as they're typed in, and closed once what they sent is on GitHub.

import type {
  BoxFrame,
  Composer,
  ComposerEvents,
  ComposeOptions,
  OnFile,
  Place,
  Span,
} from '@lo/ui/code';
import type { LineTarget } from '@lo/ui/commands';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { notice } from '../../../window/commands/notices.tsx';
import { installBridge } from '../../../window/test/bridge.ts';
import type { DrawnDiff, WritingDiff } from '../../diff/window/shared.ts';
import type * as OverviewShared from '../../overview/window/shared.ts';
import {
  blockKey,
  type CommentOnHead,
  type DrawnBlock,
  type WritingBlock,
} from '../../overview/window/shared.ts';
import type * as TabShared from '../../tab/window/shared.ts';
import type { PullTab, PullView } from '../../tab/window/shared.ts';
import type {
  ActOutcome,
  ActRow,
  Commentable,
  DraftHomeRow,
  DraftPlaceRow,
  DraftRow,
  SendOutcome,
  ThreadRow,
} from '../contract.ts';
import * as acts from './acts.ts';
import {
  act,
  canWrite,
  comment,
  commentOnBlock,
  frameWith,
  keepBoxesOf,
  offering,
  restore,
  SAVE_AFTER,
  send,
  takeDrafts,
  takeOffer,
  replying,
  type Box,
} from './boxes.ts';
import { landed } from './landed.ts';
import * as threads from './threads.ts';
import { NEW_SIDE_ONLY, NO_LINES, NOT_IN_DIFF } from './writing.ts';

const HEAD = 'a'.repeat(40);
const OLDER = 'b'.repeat(40);
let VIEW = 'v0';

const said = vi.hoisted(() => ({ pull: undefined as unknown, run: undefined as unknown }));
vi.mock('../../tab/window/shared.ts', async (original) => ({
  ...(await original<typeof TabShared>()),
  pullOf: () => said.pull,
  runOf: () => said.run,
}));

/** A box the fake diff drew, with the events it was given. */
interface Drawn {
  at: unknown;
  on: ComposerEvents;
  options: ComposeOptions | undefined;
  composer: Composer & {
    text: string;
    held: boolean;
    /** How many times it was focused. */
    focused: number;
    closed?: 'close' | 'dismiss';
  };
}

const diff = vi.hoisted(() => ({
  current: undefined as unknown,
  keys: true,
  shown: [] as string[],
}));
vi.mock('../../diff/window/shared.ts', () => ({
  writingDiff: (_view: string, keys = false) => (keys && !diff.keys ? undefined : diff.current),
  showDiff: (view: string) => diff.shown.push(view),
  diffStateOf: () => undefined,
}));

const overview = vi.hoisted(() => ({
  /** The blocks drawn, by their keys. */
  blocks: new Map<string, unknown>(),
  /** What `c` on a block names: the block and its lines. */
  found: undefined as unknown,
  /** Where the lines are at the head on screen. */
  onHead: undefined as unknown,
}));
vi.mock('../../overview/window/shared.ts', async (original) => ({
  ...(await original<typeof OverviewShared>()),
  blockLines: () => overview.found,
  commentOnHead: () => Promise.resolve(overview.onHead),
  writingBlock: (_tab: string, key: string) => overview.blocks.get(key),
  revisionName: (_tab: string, commit: string) => (commit === HEAD ? 'r2' : 'r1'),
}));

/** A box drawn in a fake diff or block, which says how it was focused and closed. */
function composerOf(draft: string, on: ComposerEvents): Drawn['composer'] {
  const composer = {
    text: draft,
    mode: 'insert' as const,
    previewing: false,
    focused: 0,
    focus() {
      composer.focused += 1;
    },
    insert: vi.fn<(text: string) => void>(),
    replace(from: number, to: number, text: string) {
      composer.text = composer.text.slice(0, from) + text + composer.text.slice(to);
      on.change(composer.text);
    },
    preview: vi.fn<(on: boolean) => void>(),
    held: false,
    hold(held: boolean) {
      composer.held = held;
    },
    close() {
      composer.closed = 'close';
    },
    dismiss() {
      composer.closed = 'dismiss';
    },
  } as Drawn['composer'];
  return composer;
}

/** A diff that draws boxes, as the code view does, but for lines it doesn't draw yet. */
function fakeDiff(missing: (at: unknown) => boolean = () => false) {
  const drawn: Drawn[] = [];
  /** The threads claimed, and those of them let go since. */
  const claimed: string[] = [];
  const released: string[] = [];
  const toggled: string[] = [];
  /** The threads drawn under each line or header, by `where`. */
  const onScreen = new Map<string, string[]>();
  const vim = vi.fn<(keys: readonly string[]) => void>();
  const shown: DrawnDiff = {
    at: HEAD,
    comparison: null,
    compareFrom: null,
    files: [
      {
        id: 'f0',
        key: 'src/backoff.ts',
        path: 'src/backoff.ts',
        old: 'src/backoff.ts',
        since: false,
      },
    ],
  };
  const writing: WritingDiff = {
    drawn: () => shown,
    lines: (span) =>
      Array.from({ length: span.to - span.from + 1 }, (_, at) => `line ${span.from + at}`),
    compose(at, draft, on, frame?: BoxFrame, options?: ComposeOptions) {
      if (missing(at)) throw new Error('A comment box goes under a line of a file that is shown.');
      const open = drawn.find(
        (each) => JSON.stringify(each.at) === JSON.stringify(at) && !each.composer.closed,
      );
      if (open) return open.composer;
      const composer = composerOf(draft, on);
      drawn.push({ at, on, options, composer });
      return composer;
    },
    toTop: () => true,
    vim,
    openThread: (id) => {
      toggled.push(id);
      return true;
    },
    claimThread: (id) => {
      claimed.push(id);
      return () => released.push(id);
    },
    threadsDrawn: (at) => onScreen.get(where(at)) ?? [],
  };
  diff.current = writing;
  return { drawn, writing, vim, claimed, released, toggled, onScreen };
}

/** A line or header, as a key. */
function where(at: Place | OnFile): string {
  return 'line' in at ? `${at.file}:${at.side}:${at.line}` : at.file;
}

const PATH = 'src/backoff.ts';

/**
 * A code block of the overview at `OLDER`, on `src/backoff.ts`'s lines 3 to 9, that draws boxes as
 * an excerpt does: one under a line, which `c` there again gives.
 */
function fakeBlock() {
  const drawn: Drawn[] = [];
  const block: DrawnBlock = {
    tab: VIEW,
    key: blockKey(OLDER, PATH, 3, 9),
    block: 'b0',
    file: 'x0',
    path: PATH,
    commit: OLDER,
    from: null,
    lines: { start: 3, end: 9 },
  };
  const writing: WritingBlock = {
    block,
    compose(at, draft, on, _frame, options) {
      const open = drawn.find((each) => lineOf(each.at) === lineOf(at) && !each.composer.closed);
      if (open) {
        if (options?.focus !== false) open.composer.focus();
        return open.composer;
      }
      const composer = composerOf(draft, on);
      drawn.push({ at, on, options, composer });
      return composer;
    },
  };
  overview.blocks.set(block.key, writing);
  return { drawn, writing, block };
}

/** The line a box on `at`, a line or a span, goes under: its last. */
function lineOf(at: unknown): number | undefined {
  if (typeof at !== 'object' || at === null) return undefined;
  if ('line' in at && typeof at.line === 'number') return at.line;
  return 'to' in at && typeof at.to === 'number' ? at.to : undefined;
}

/** `c` on the fake block's line `line`, or lines `from` to `to`, which are at `onHead` at the head. */
async function onBlock(
  writing: WritingBlock,
  lines: { from: number; to: number },
  onHead: CommentOnHead,
  how: 'review' | 'now' = 'review',
): Promise<void> {
  const { from, to } = lines;
  const at: Place | Span =
    from === to ? { file: 'x0', side: 'new', line: to } : { file: 'x0', side: 'new', from, to };
  overview.found = { writing, at };
  overview.onHead = onHead;
  const target: LineTarget = { kind: 'line', at };
  await commentOnBlock(tab(), target, how);
}

/** The home of a draft written from the fake block's lines `from` to `to`. */
function blockHome(from: number, to = from): DraftHomeRow {
  return { commit: OLDER, path: PATH, block: { start: 3, end: 9 }, at: { side: 'new', from, to } };
}

/** A box the reader shut with `Esc Esc`, keeping its text, or not. */
function shut(drawn: Drawn, keep: boolean): void {
  drawn.composer.closed = 'close';
  drawn.on.close(keep);
}

const answers: Record<string, (input: unknown) => unknown> = {};
const bridge = installBridge(answers);

function pull(changes: Partial<PullView> = {}): PullView {
  return {
    id: VIEW,
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

function tab(): PullTab {
  return { kind: 'pull', id: VIEW, owner: 'rozed-dev', repo: 'e2e', number: 94 };
}

/** One hunk from line 3: two unchanged, one deleted, two added, one unchanged. */
const IN_DIFF: Commentable = { kind: 'diff', hunks: [{ old: 2, new: 2, kinds: '  -++ ' }] };

function onLines(start: number | null, end: number): DraftPlaceRow {
  return {
    kind: 'thread',
    commit: HEAD,
    path: 'src/backoff.ts',
    lines: {
      start: start === null ? null : { side: 'RIGHT', number: start },
      end: { side: 'RIGHT', number: end },
    },
  };
}

function row(place: DraftPlaceRow, text: string, changes: Partial<DraftRow> = {}): DraftRow {
  return {
    place,
    text,
    savedAt: 0,
    restored: false,
    sending: null,
    sent: null,
    base: null,
    home: null,
    ...changes,
  };
}

/** The requests to `channel` made so far. */
function asked(channel: string): unknown[] {
  return bridge.calls.filter(([name]) => name === channel).map(([, input]) => input);
}

let views = 0;

/** Each box as it's drawn: the frame it'd get is where its state is read. */
const boxesSeen: Box[] = [];
frameWith((box) => {
  boxesSeen.push(box);
  return undefined;
});

beforeEach(() => {
  VIEW = `v${++views}`;
  said.pull = pull();
  said.run = undefined;
  diff.keys = true;
  bridge.calls.length = 0;
  answers['comments.commentable'] = () => IN_DIFF;
  answers['comments.draft'] = () => undefined;
  answers['comments.discard'] = () => undefined;
  overview.blocks.clear();
});

afterEach(() => {
  keepBoxesOf(new Set());
  vi.useRealTimers();
});

describe('opening a box', () => {
  test('`c` on a line of the diff opens a focused box under it, where GitHub puts the thread', async () => {
    const { drawn } = fakeDiff();
    await comment(tab(), { kind: 'line', at: { file: 'f0', side: 'new', line: 5 } }, 'review');
    expect(drawn).toHaveLength(1);
    expect(drawn[0]!.at).toEqual({ file: 'f0', side: 'new', line: 5 });
    expect(drawn[0]!.options).toEqual({ focus: true, name: expect.any(String) });
    expect(asked('comments.commentable')).toEqual([
      { id: VIEW, commit: HEAD, path: 'src/backoff.ts', previous: null },
    ]);
  });

  test('`v` then `c` opens it under the range’s last line; `c` on a header, on the file', async () => {
    const { drawn } = fakeDiff();
    await comment(
      tab(),
      { kind: 'line', at: { file: 'f0', side: 'new', from: 6, to: 4 } },
      'review',
    );
    await comment(tab(), { kind: 'header', file: 'f0', side: 'old' }, 'now');
    expect(drawn.map((each) => each.at)).toEqual([
      { file: 'f0', side: 'new', from: 4, to: 6 },
      { file: 'f0' },
    ]);
  });

  test('a line GitHub takes no comment on says so, and then `⏎` comments on the file', async () => {
    const { drawn, vim } = fakeDiff();
    await comment(tab(), { kind: 'line', at: { file: 'f0', side: 'new', line: 40 } }, 'review');
    expect(drawn).toEqual([]);
    expect(notice()?.body).toBe(NOT_IN_DIFF);
    expect(takeOffer(tab())).toBe(true);
    await vi.waitFor(() => expect(drawn.map((each) => each.at)).toEqual([{ file: 'f0' }]));
    // Once taken, `⏎` is Vim's again.
    expect(takeOffer(tab())).toBe(false);
    expect(vim).not.toHaveBeenCalled();
  });

  test('a file whose lines Lo couldn’t read says so, `⏎` comments on the file, and it asks again', async () => {
    const { drawn } = fakeDiff();
    answers['comments.commentable'] = () => ({ kind: 'unknown' });
    const line = { kind: 'line', at: { file: 'f0', side: 'new', line: 5 } } as const;
    await comment(tab(), line, 'review');
    expect(drawn).toEqual([]);
    expect(notice()?.body).toBe(NO_LINES);
    expect(takeOffer(tab())).toBe(true);
    await vi.waitFor(() => expect(drawn.map((each) => each.at)).toEqual([{ file: 'f0' }]));
    // Main can tell now: the line takes its comment.
    answers['comments.commentable'] = () => IN_DIFF;
    await comment(tab(), line, 'review');
    expect(drawn.map((each) => each.at)).toEqual([
      { file: 'f0' },
      { file: 'f0', side: 'new', line: 5 },
    ]);
  });

  test('`s` opens the lines in a suggestion block; on the older side it refuses', async () => {
    const { drawn } = fakeDiff();
    await comment(
      tab(),
      { kind: 'line', at: { file: 'f0', side: 'new', from: 4, to: 5 } },
      'review',
      true,
    );
    expect(drawn[0]!.composer.text).toBe('```suggestion\nline 4\nline 5\n```');
    await comment(
      tab(),
      { kind: 'line', at: { file: 'f0', side: 'old', line: 5 } },
      'review',
      true,
    );
    expect(notice()?.body).toBe(NEW_SIDE_ONLY);
    expect(drawn).toHaveLength(1);
  });

  test('a view acting as nobody, or a run of layers, can’t write', () => {
    expect(canWrite(VIEW)).toBe(true);
    said.pull = pull({ acting: { kind: 'anonymous' } });
    expect(canWrite(VIEW)).toBe('Sign in to comment');
    said.pull = pull();
    said.run = { layers: [1, 2] };
    expect(canWrite(VIEW)).toBe('Comment in a layer');
  });
});

describe('drafts', () => {
  test('typing saves 300 ms after it stops; Esc Esc saves at once and keeps the box shut', async () => {
    vi.useFakeTimers();
    const { drawn } = fakeDiff();
    await comment(tab(), { kind: 'line', at: { file: 'f0', side: 'new', line: 5 } }, 'review');
    const { on } = drawn[0]!;
    on.change('Hel');
    on.change('Hello');
    vi.advanceTimersByTime(SAVE_AFTER - 1);
    expect(asked('comments.draft')).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(asked('comments.draft')).toEqual([
      { id: VIEW, place: onLines(null, 5), text: 'Hello', home: null },
    ]);
    on.change('Hello there');
    on.close(true);
    expect(asked('comments.draft')).toHaveLength(2);
    restore(VIEW);
    expect(drawn).toHaveLength(1);
  });

  test('a box closed with nothing in it takes its draft with it', async () => {
    const { drawn } = fakeDiff();
    await comment(tab(), { kind: 'line', at: { file: 'f0', side: 'new', line: 5 } }, 'review');
    drawn[0]!.on.close(false);
    expect(asked('comments.draft')).toEqual([
      { id: VIEW, place: onLines(null, 5), text: '', home: null },
    ]);
  });

  test('a draft restored as Lo started reopens unfocused once its line is drawn', async () => {
    vi.useFakeTimers();
    let ready = false;
    const { drawn } = fakeDiff(() => !ready);
    takeDrafts({ id: VIEW, drafts: [row(onLines(4, 6), 'Kept', { restored: true, savedAt: 1 })] });
    expect(drawn).toEqual([]);
    ready = true;
    await vi.advanceTimersByTimeAsync(500);
    expect(drawn).toHaveLength(1);
    expect(drawn[0]).toMatchObject({
      at: { file: 'f0', side: 'new', from: 4, to: 6 },
      options: { focus: false },
    });
    expect(drawn[0]!.composer.text).toBe('Kept');
  });

  test('“Discard” on a restored draft drops it and its box, which sent nothing', () => {
    const { drawn } = fakeDiff();
    takeDrafts({
      id: VIEW,
      drafts: [row(onLines(null, 5), 'Old', { restored: true, savedAt: 1 })],
    });
    const box = boxIn(drawn[0]!);
    expect(box.state.restored).toBe(1);
    act(box, 'discard');
    expect(drawn[0]!.composer.closed).toBe('dismiss');
    expect(asked('comments.discard')).toEqual([{ id: VIEW, place: onLines(null, 5) }]);
    // Drafts main sent before it heard still hold it; they don't bring it back.
    takeDrafts({
      id: VIEW,
      drafts: [row(onLines(null, 5), 'Old', { restored: true, savedAt: 1 })],
    });
    expect(drawn).toHaveLength(1);
    // Once main says it's gone, a draft there later is a new one.
    takeDrafts({ id: VIEW, drafts: [] });
    takeDrafts({
      id: VIEW,
      drafts: [row(onLines(null, 5), 'New', { restored: true, savedAt: 2 })],
    });
    expect(drawn).toHaveLength(2);
    expect(drawn[1]!.composer.text).toBe('New');
  });

  test('after the window loads again, each draft’s box comes back, unfocused, saying so', () => {
    const { drawn } = fakeDiff();
    takeDrafts({ id: VIEW, drafts: [row(onLines(null, 5), 'Kept', { savedAt: 1 })] });
    expect(drawn).toHaveLength(1);
    expect(drawn[0]).toMatchObject({
      at: { file: 'f0', side: 'new', line: 5 },
      options: { focus: false },
    });
    expect(boxIn(drawn[0]!).state.restored).toBe(1);
    // A draft heard of after, as one kept with `Esc Esc` in another tab, stays shut.
    takeDrafts({
      id: VIEW,
      drafts: [
        row(onLines(null, 5), 'Kept', { savedAt: 1 }),
        row(onLines(null, 7), 'Shut', { savedAt: 2 }),
      ],
    });
    expect(drawn).toHaveLength(1);
  });

  test('what a box’s notes offer is a command on the box, there only while it offers it', () => {
    const { drawn } = fakeDiff();
    takeDrafts({
      id: VIEW,
      drafts: [row(onLines(null, 5), 'Old', { restored: true, savedAt: 1 })],
    });
    const target = { kind: 'box', box: boxIn(drawn[0]!).id } as const;
    const discard = offering('discard');
    const sendAnyway = offering('sendAnyway');
    expect(discard.listed?.(target)).toBe(true);
    expect(discard.enabled?.(target)).toBe(true);
    expect(sendAnyway.listed?.(target)).toBe(false);
    expect(sendAnyway.enabled?.(target)).toBe('“Send it anyway” isn’t offered in this box now.');
    void discard.run(target);
    expect(drawn[0]!.composer.closed).toBe('dismiss');
    expect(asked('comments.discard')).toEqual([{ id: VIEW, place: onLines(null, 5) }]);
    // The box is gone, and so is what it offered.
    expect(discard.listed?.(target)).toBe(false);
  });

  test('a box the diff took down as it was drawn again opens again with it', async () => {
    const first = fakeDiff();
    await comment(tab(), { kind: 'line', at: { file: 'f0', side: 'new', line: 5 } }, 'review');
    first.drawn[0]!.on.change('Mine');
    // The diff drew its boxes' frames; the fake has none, so it's taken down by hand.
    const box = boxIn(first.drawn[0]!);
    box.composer = undefined;
    const second = fakeDiff();
    restore(VIEW);
    expect(second.drawn.map((each) => each.composer.text)).toEqual(['Mine']);
  });
});

/** The box behind a box the fake diff drew, through the frame it'd get. */
function boxIn(drawn: Drawn): Box {
  let found: Box | undefined;
  for (const each of boxesSeen) if (each.composer === drawn.composer) found = each;
  if (!found) throw new Error('No box has that composer.');
  return found;
}

/** A box opened with `c` on a line, with text in it. */
async function opened() {
  const fake = fakeDiff();
  await comment(tab(), { kind: 'line', at: { file: 'f0', side: 'new', line: 5 } }, 'review');
  fake.drawn[0]!.on.change('Ship it?');
  return { ...fake, box: boxIn(fake.drawn[0]!) };
}

describe('a box on a code block', () => {
  test('`c` on a block’s line opens a box under it, on those lines at the head, kept with the block', async () => {
    const { drawn, writing } = fakeBlock();
    await onBlock(
      writing,
      { from: 5, to: 5 },
      { kind: 'lines', path: PATH, side: 'new', from: 5, to: 5 },
    );
    expect(drawn).toHaveLength(1);
    expect(drawn[0]).toMatchObject({
      at: { file: 'x0', side: 'new', line: 5 },
      options: { focus: true },
    });
    const box = boxIn(drawn[0]!);
    expect(box.state.place).toEqual(onLines(null, 5));
    // The block shows r1; the comment goes on the lines at r2, and its head says so.
    expect(box.state.where).toBe('On line 5, new side, at r2');
    drawn[0]!.on.change('Mine');
    shut(drawn[0]!, true);
    expect(asked('comments.draft')).toEqual([
      { id: VIEW, place: onLines(null, 5), text: 'Mine', home: blockHome(5) },
    ]);
  });

  test('it goes on the file, or the pull request, saying why, where it can’t go on the lines', async () => {
    const { drawn, writing } = fakeBlock();
    await onBlock(writing, { from: 4, to: 4 }, { kind: 'file', path: PATH, why: 'changed' });
    expect(boxIn(drawn[0]!).state).toMatchObject({
      place: { kind: 'thread', commit: HEAD, path: PATH, lines: null },
      where: 'On the file, since these lines changed after r1',
    });
    // The pull request deletes the file: GitHub still takes a comment on it, by its old path.
    await onBlock(writing, { from: 6, to: 6 }, { kind: 'gone', path: 'src/old.ts' });
    expect(boxIn(drawn[1]!).state).toMatchObject({
      place: { kind: 'thread', path: 'src/old.ts', lines: null },
      where: 'On the file, which this pull request deletes',
    });
    expect(asked('comments.commentable')).toContainEqual({
      id: VIEW,
      commit: HEAD,
      path: 'src/old.ts',
      previous: null,
    });
    // It leaves the file alone: the comment goes on the pull request.
    answers['comments.commentable'] = () => ({ kind: 'notInDiff' });
    await onBlock(
      writing,
      { from: 8, to: 8 },
      { kind: 'lines', path: 'docs/usage.md', side: 'new', from: 8, to: 8 },
    );
    expect(boxIn(drawn[2]!).state).toMatchObject({
      place: { kind: 'conversation' },
      where: 'On the pull request, since it doesn’t change this file',
    });
  });

  test('`c` on a line a box is open on, as one on a range ending there, focuses that box', async () => {
    const { drawn, writing } = fakeBlock();
    const onRange = { kind: 'lines', path: PATH, side: 'new', from: 4, to: 6 } as const;
    await onBlock(writing, { from: 4, to: 6 }, onRange);
    const first = drawn[0]!;
    const focused = first.composer.focused;
    await onBlock(writing, { from: 6, to: 6 }, { ...onRange, from: 6 });
    expect(drawn).toHaveLength(1);
    expect(first.composer.focused).toBe(focused + 1);
    // Once it's shut, `c` there opens one of its own.
    shut(first, true);
    await onBlock(writing, { from: 6, to: 6 }, { ...onRange, from: 6 });
    expect(drawn).toHaveLength(2);
    expect(boxIn(drawn[1]!).state.place).toEqual(onLines(null, 6));
    // And so in the diff.
    const onDiff = fakeDiff();
    const span = { kind: 'line', at: { file: 'f0', side: 'new', from: 4, to: 6 } } as const;
    await comment(tab(), span, 'review');
    const before = onDiff.drawn[0]!.composer.focused;
    await comment(tab(), { kind: 'line', at: { file: 'f0', side: 'new', line: 6 } }, 'review');
    expect(onDiff.drawn).toHaveLength(1);
    expect(onDiff.drawn[0]!.composer.focused).toBe(before + 1);
  });

  test('a box moves between its block and the diff with its text, and its draft’s home with it', async () => {
    const block = fakeBlock();
    const onDiff = fakeDiff();
    const onLine = { kind: 'lines', path: PATH, side: 'new', from: 5, to: 5 } as const;
    await onBlock(block.writing, { from: 5, to: 5 }, onLine);
    block.drawn[0]!.on.change('Mine');
    await comment(tab(), { kind: 'line', at: { file: 'f0', side: 'new', line: 5 } }, 'review');
    expect(block.drawn[0]!.composer.closed).toBe('dismiss');
    expect(onDiff.drawn.map((each) => each.composer.text)).toEqual(['Mine']);
    expect(asked('comments.draft').at(-1)).toEqual({
      id: VIEW,
      place: onLines(null, 5),
      text: 'Mine',
      home: null,
    });
    await onBlock(block.writing, { from: 5, to: 5 }, onLine);
    expect(onDiff.drawn[0]!.composer.closed).toBe('dismiss');
    expect(block.drawn).toHaveLength(2);
    expect(block.drawn[1]!.composer.text).toBe('Mine');
    expect(asked('comments.draft').at(-1)).toMatchObject({ text: 'Mine', home: blockHome(5) });
  });

  test('after a restart, a draft written from a block reopens under it, whatever its place', async () => {
    const block = fakeBlock();
    const onDiff = fakeDiff();
    takeDrafts({
      id: VIEW,
      drafts: [
        row(onLines(null, 5), 'On the line', { savedAt: 1, restored: true, home: blockHome(5) }),
        row({ kind: 'conversation' }, 'On the pull request', {
          savedAt: 2,
          restored: true,
          home: blockHome(7),
        }),
      ],
    });
    await Promise.resolve();
    expect(onDiff.drawn).toEqual([]);
    expect(
      block.drawn.map(({ at, options, composer }) => [at, options?.focus, composer.text]),
    ).toEqual([
      [{ file: 'x0', side: 'new', line: 5 }, false, 'On the line'],
      [{ file: 'x0', side: 'new', line: 7 }, false, 'On the pull request'],
    ]);
  });

  test('a draft on the pull request with no block stays kept, shut and unsent', async () => {
    vi.useFakeTimers();
    const onDiff = fakeDiff();
    takeDrafts({
      id: VIEW,
      drafts: [row({ kind: 'conversation' }, 'Kept', { savedAt: 1, restored: true })],
    });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(onDiff.drawn).toEqual([]);
    expect(bridge.calls.map(([name]) => name)).not.toContain('comments.draft');
    expect(bridge.calls.map(([name]) => name)).not.toContain('comments.send');
  });

  test('sent, a comment that won’t show under its block says where it went', async () => {
    const { drawn, writing } = fakeBlock();
    answers['comments.send'] = (): SendOutcome => ({
      kind: 'sent',
      pending: true,
      joined: false,
      thread: null,
      landedOn: null,
    });
    await onBlock(writing, { from: 4, to: 4 }, { kind: 'file', path: PATH, why: 'unknown' });
    drawn[0]!.on.change('On the file.');
    await send(boxIn(drawn[0]!), 'review');
    expect(drawn[0]!.composer.closed).toBe('close');
    expect(notice()).toMatchObject({
      title: 'Added to your review, on the file',
      body: 'src/backoff.ts. It shows under the file’s header in the diff.',
    });
    answers['comments.commentable'] = () => ({ kind: 'notInDiff' });
    answers['comments.send'] = (): SendOutcome => ({
      kind: 'sent',
      pending: false,
      joined: false,
      thread: null,
      landedOn: null,
    });
    await onBlock(
      writing,
      { from: 6, to: 6 },
      { kind: 'lines', path: 'docs/usage.md', side: 'new', from: 6, to: 6 },
      'now',
    );
    drawn[1]!.on.change('On the pull request.');
    await send(boxIn(drawn[1]!), 'now');
    expect(notice()).toMatchObject({
      title: 'Posted on the pull request',
      body: 'It shows in the timeline.',
    });
  });
});

describe('sending', () => {
  test('sent, the box closes as after a send, and a thread on a newer push is marked', async () => {
    const { drawn, box } = await opened();
    const outcome: SendOutcome = {
      kind: 'sent',
      pending: true,
      joined: false,
      thread: 'T_1',
      landedOn: { head: null },
    };
    answers['comments.send'] = () => outcome;
    await send(box, 'review');
    expect(asked('comments.send')).toEqual([
      { id: VIEW, place: onLines(null, 5), text: 'Ship it?', how: 'review' },
    ]);
    expect(drawn[0]!.composer.closed).toBe('close');
    expect(landed.get(VIEW).has('T_1')).toBe(true);
  });

  test('while it’s sent, and until Lo knows whether it posted, its text is held', async () => {
    const { drawn, box } = await opened();
    let answer!: (outcome: SendOutcome) => void;
    answers['comments.send'] = () =>
      new Promise<SendOutcome>((resolve) => {
        answer = resolve;
      });
    const sending = send(box, 'review');
    expect(drawn[0]!.composer.held).toBe(true);
    answer({ kind: 'refused', refusal: { kind: 'paused', until: 1 } });
    await sending;
    expect(drawn[0]!.composer.held).toBe(false);
    takeDrafts({
      id: VIEW,
      drafts: [row(onLines(null, 5), 'Ship it?', { sending: 'checking', sent: 'Ship it?' })],
    });
    expect(drawn[0]!.composer.held).toBe(true);
  });

  test('refused, the box stays with why; offline, nothing sends', async () => {
    const { drawn, box } = await opened();
    answers['comments.send'] = () => ({ kind: 'refused', refusal: { kind: 'notInDiff' } });
    await send(box, 'now');
    expect(box.state.refusal).toEqual({ kind: 'notInDiff' });
    expect(drawn[0]!.composer.closed).toBeUndefined();
    said.pull = pull({ connection: { kind: 'offline', savedAt: null, retryAt: null, error: '' } });
    await send(box, 'review');
    expect(asked('comments.send')).toHaveLength(1);
  });

  test('“Comment on the file” moves the text to a box on the file', async () => {
    const { drawn, box } = await opened();
    act(box, 'onFile');
    expect(drawn[0]!.composer.closed).toBe('dismiss');
    expect(drawn[1]!.at).toEqual({ file: 'f0' });
    expect(drawn[1]!.composer.text).toBe('Ship it?');
  });

  test('once main finds what a lost answer was to on GitHub, the box closes', async () => {
    const { drawn } = await opened();
    takeDrafts({
      id: VIEW,
      drafts: [row(onLines(null, 5), 'Ship it?', { sending: 'checking', sent: 'Ship it?' })],
    });
    expect(drawn[0]!.composer.closed).toBeUndefined();
    takeDrafts({ id: VIEW, drafts: [] });
    expect(drawn[0]!.composer.closed).toBe('close');
  });
});

/** A comment of a thread main sent, by `author`. */
function threadComment(id: string, author: string, body: string): ThreadRow['comments'][number] {
  return {
    id,
    author,
    authorType: 'User',
    body,
    state: 'SUBMITTED',
    createdAt: '2026-11-13T11:00:00Z',
    url: 'https://github.com/rozed-dev/e2e/pull/94#discussion_r1',
    hidden: null,
    viewerCanUpdate: author === 'rozed-bot',
    viewerCanDelete: author === 'rozed-bot',
  };
}

/** Thread `id` on new line `line` of src/backoff.ts, open, with rozed-bot's comment. */
function threadRow(id: string, line: number, changes: Partial<ThreadRow> = {}): ThreadRow {
  return {
    id,
    path: 'src/backoff.ts',
    subject: 'LINE',
    side: 'RIGHT',
    startSide: null,
    line,
    startLine: null,
    originalLine: line,
    originalStartLine: null,
    outdated: false,
    resolved: false,
    currentOn: HEAD,
    writtenOn: HEAD,
    comments: [threadComment(`${id}_C1`, 'rozed-bot', 'Start a little higher?\nIt waits.')],
    viewerCanReply: true,
    viewerCanResolve: true,
    viewerCanUnresolve: false,
    ...changes,
  };
}

/** Resolving thread T2, as it stands. */
function standing(stands: ActRow['stands']): ActRow {
  return { thread: 'T2', comment: null, change: 'resolve', stands };
}

/** The diff, with `rows`, the threads main sent, placed in it and drawn. */
function withThreads(...rows: ThreadRow[]) {
  const fake = fakeDiff();
  threads.held.set(VIEW, {
    threads: {
      id: VIEW,
      status: 'ready',
      threads: rows,
      missing: 0,
      compared: null,
      problem: null,
    },
  });
  threads.placedIn(VIEW, fake.writing.drawn());
  for (const { id } of rows) {
    const at = threads.shownAt(VIEW, id);
    if (!at) continue;
    fake.onScreen.set(where(at), [...(fake.onScreen.get(where(at)) ?? []), id]);
  }
  return fake;
}

describe('acting on a thread', () => {
  const ON_TWO = { kind: 'line', at: { file: 'f0', side: 'new', line: 2 } } as const;
  const ON_FIVE = { kind: 'line', at: { file: 'f0', side: 'new', line: 5 } } as const;

  test('`r` opens a reply box right after the only thread on the line, opening it first', () => {
    const { drawn, toggled } = withThreads(
      threadRow('T2', 2),
      threadRow('T5a', 5),
      threadRow('T5b', 5),
    );
    acts.reply(tab(), ON_TWO);
    expect(toggled).toEqual(['T2']);
    expect(drawn.map((each) => each.at)).toEqual([{ thread: 'T2' }]);
    expect(replying.get(VIEW).has('T2')).toBe(true);
    // Two threads on a line: `]t` picks one.
    acts.reply(tab(), ON_FIVE);
    expect(notice()?.body).toBe('There are 2 threads here. Press ]t to pick one.');
    acts.reply(tab(), { kind: 'line', at: { file: 'f0', side: 'new', line: 9 } });
    expect(notice()?.body).toBe('There’s no thread on this line.');
    // One `]t` landed on is the one.
    acts.reply(tab(), { ...ON_FIVE, thread: 'T5b' });
    expect(drawn.map((each) => each.at)).toEqual([{ thread: 'T2' }, { thread: 'T5b' }]);
  });

  test('a thread placed under a line but not drawn there yet is no key’s to act on', async () => {
    const { drawn, onScreen } = withThreads(threadRow('T2', 2));
    onScreen.clear();
    answers['comments.resolve'] = (): ActOutcome => ({ kind: 'done' });
    acts.resolve(tab(), ON_TWO);
    expect(notice()?.body).toBe('There’s no thread on this line.');
    acts.reply(tab(), ON_TWO);
    await acts.edit(tab(), ON_TWO);
    acts.remove(tab(), ON_TWO);
    expect(notice()?.body).toBe('There’s no thread on this line.');
    expect(drawn).toEqual([]);
    expect(acts.deleteAsking()).toBeUndefined();
    expect(asked('comments.resolve')).toEqual([]);
    expect(asked('comments.editing')).toEqual([]);
  });

  test('a reply box closed and kept lets the card offer “Reply…” again', () => {
    const { drawn } = withThreads(threadRow('T2', 2));
    acts.reply(tab(), ON_TWO);
    expect(replying.get(VIEW).has('T2')).toBe(true);
    drawn[0]!.on.close(true);
    expect(replying.get(VIEW).has('T2')).toBe(false);
  });

  test('a thread GitHub takes no reply on says so', () => {
    const { drawn } = withThreads(threadRow('T2', 2, { viewerCanReply: false }));
    acts.reply(tab(), ON_TWO);
    expect(drawn).toEqual([]);
    expect(notice()?.body).toBe('GitHub doesn’t let you reply to this thread.');
  });

  test('`x` claims the thread and resolves it; a refusal says why and lets the claim go', async () => {
    const { claimed, released } = withThreads(threadRow('T2', 2));
    answers['comments.resolve'] = (): ActOutcome => ({ kind: 'done' });
    acts.resolve(tab(), ON_TWO);
    await vi.waitFor(() =>
      expect(asked('comments.resolve')).toEqual([{ id: VIEW, thread: 'T2', resolved: true }]),
    );
    expect(claimed).toEqual(['T2']);
    expect(released).toEqual([]);
    answers['comments.resolve'] = (): ActOutcome => ({
      kind: 'refused',
      refusal: { kind: 'paused', until: new Date(2026, 10, 13, 14, 5).getTime() },
    });
    acts.resolve(tab(), ON_TWO);
    await vi.waitFor(() => expect(released).toEqual(['T2']));
    expect(notice()?.body).toMatch(/^GitHub asked Lo to hold off until .+\. Resolve it then\.$/);
  });

  test('`x` where GitHub doesn’t let you, or offline, sends nothing', () => {
    withThreads(threadRow('T2', 2, { viewerCanResolve: false }), threadRow('T5', 5));
    acts.resolve(tab(), ON_TWO);
    expect(notice()?.body).toMatch(/^GitHub doesn’t let you resolve this thread\./);
    said.pull = pull({
      connection: { kind: 'offline', savedAt: null, retryAt: null, error: 'down' },
    });
    acts.resolve(tab(), ON_FIVE);
    expect(notice()?.body).toBe('Offline. Try again once GitHub can be reached.');
    expect(asked('comments.resolve')).toEqual([]);
  });

  test('`i` starts an edit of your newest comment from its text, in a box after the thread', async () => {
    const mine = threadComment('C_mine', 'rozed-bot', 'Mine.');
    const { drawn } = withThreads(
      threadRow('T2', 2, { comments: [threadComment('C_old', 'rozed-bot', 'Older.'), mine] }),
      threadRow('T5', 5, { comments: [threadComment('C_theirs', 'ravi-k', 'Theirs.')] }),
    );
    answers['comments.editing'] = (): ActOutcome => ({ kind: 'done' });
    answers['comments.edit'] = (): ActOutcome => ({ kind: 'done' });
    await acts.edit(tab(), ON_TWO);
    const place = { kind: 'edit', thread: 'T2', comment: 'C_mine' };
    expect(asked('comments.editing')).toEqual([{ id: VIEW, place, base: 'Mine.' }]);
    expect(drawn.map((each) => [each.at, each.composer.text])).toEqual([
      [{ thread: 'T2' }, 'Mine.'],
    ]);
    drawn[0]!.composer.replace(0, 5, 'Mine, edited.');
    drawn[0]!.on.submit('review');
    await vi.waitFor(() =>
      expect(asked('comments.edit')).toEqual([{ id: VIEW, place, text: 'Mine, edited.' }]),
    );
    await vi.waitFor(() => expect(drawn[0]!.composer.closed).toBe('close'));
    // Someone else's is refused in Lo's words.
    await acts.edit(tab(), ON_FIVE);
    expect(notice()?.body).toBe(
      'None of this thread’s comments are yours. You can edit and delete only your own.',
    );
    await acts.edit(tab(), { kind: 'thread', thread: 'T5' }, 'C_theirs');
    expect(notice()?.body).toBe('It’s ravi-k’s comment. You can edit and delete only your own.');
  });

  test('an edit closed with no text is discarded, as is one edited on GitHub since', async () => {
    const { drawn } = withThreads(threadRow('T2', 2));
    answers['comments.editing'] = (): ActOutcome => ({ kind: 'done' });
    await acts.edit(tab(), ON_TWO);
    drawn[0]!.composer.replace(0, drawn[0]!.composer.text.length, '');
    drawn[0]!.on.close(false);
    expect(asked('comments.discard')).toEqual([
      { id: VIEW, place: { kind: 'edit', thread: 'T2', comment: 'T2_C1' } },
    ]);
  });

  test('`dd` asks first, and Delete deletes the comment as the question showed it', async () => {
    const { claimed } = withThreads(threadRow('T2', 2));
    answers['comments.remove'] = (): ActOutcome => ({ kind: 'done' });
    acts.remove(tab(), ON_TWO);
    expect(acts.deleteAsking()).toMatchObject({
      thread: 'T2',
      comment: 'T2_C1',
      pending: false,
      onlyComment: true,
    });
    expect(asked('comments.remove')).toEqual([]);
    acts.cancelDelete();
    expect(acts.deleteAsking()).toBeUndefined();
    acts.remove(tab(), ON_TWO);
    await acts.confirmDelete();
    expect(acts.deleteAsking()).toBeUndefined();
    expect(asked('comments.remove')).toEqual([
      {
        id: VIEW,
        thread: 'T2',
        comment: 'T2_C1',
        asked: { body: 'Start a little higher?\nIt waits.', pending: false, onlyComment: true },
      },
    ]);
    expect(claimed).toEqual(['T2']);
  });

  test('`dd` offline says so at once, asking nothing', () => {
    withThreads(threadRow('T2', 2));
    said.pull = pull({
      connection: { kind: 'offline', savedAt: null, retryAt: null, error: 'down' },
    });
    acts.remove(tab(), ON_TWO);
    expect(acts.deleteAsking()).toBeUndefined();
    expect(notice()?.body).toBe('Offline. Try again once GitHub can be reached.');
  });

  test('a change whose answer was lost says Lo is checking, or that it didn’t go, until the thread shows it', () => {
    const unresolved = threadRow('T2', 2);
    expect(acts.actNote(standing('sending'), unresolved, false)).toBeUndefined();
    expect(acts.actNote(standing('checking'), unresolved, false)).toEqual({
      text: 'GitHub’s answer was lost. Lo is checking whether it resolved the thread.',
      again: false,
      checking: true,
    });
    expect(acts.actNote(standing('notDone'), unresolved, false)).toMatchObject({ again: true });
    expect(acts.actNote(standing('unknown'), unresolved, false)?.text).toBe(
      'GitHub’s answer was lost, and Lo can’t tell whether it resolved the thread.',
    );
    expect(
      acts.actNote(standing('unknown'), { ...unresolved, resolved: true }, false),
    ).toBeUndefined();
    expect(acts.actNote(standing('unknown'), unresolved, true)).toBeUndefined();
  });
});
