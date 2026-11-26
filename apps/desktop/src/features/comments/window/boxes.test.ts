// @vitest-environment jsdom
// The comment boxes of a view's diff and its overview's code blocks: opened from `c`, `C` and `s`,
// refused where GitHub takes no comment, restored from main's drafts where they were written, saved
// as they're typed in, closed once what they sent is on GitHub, and held while a file attached to
// them is on its way in.

import type {
  BoxFrame,
  Composer,
  ComposerEvents,
  ComposeOptions,
  OnFile,
  Place,
  Span,
} from '@lo/ui/code';
import {
  commandsOf,
  defineCommands,
  type LineTarget,
  listen,
  NO_TARGET,
  Registry,
} from '@lo/ui/commands';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';

import { runFromBar } from '../../../window/commands/bar.ts';
import { notice } from '../../../window/commands/notices.tsx';
import { createRegistry } from '../../../window/commands/registry.ts';
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
  UploadOutcome,
} from '../contract.ts';
import type { PrepareInput, Prepared } from '../jobs.ts';
import * as acts from './acts.ts';
import {
  act,
  canWrite,
  comment,
  commentOnBlock,
  frameWith,
  keepBoxesOf,
  keptAway,
  keptCount,
  keptOpen,
  LAND_WAIT,
  landBoxes,
  discardable,
  discarding,
  lastDiscarded,
  undiscard,
  undiscarding,
  UNDO_TIME,
  offering,
  restore,
  SAVE_AFTER,
  send,
  sendingNow,
  showKeptDrafts,
  reopenAll,
  takeDrafts,
  takeJoined,
  takenDown,
  takeOffer,
  editing,
  replying,
  timelineBox,
  timelineBoxes,
  type Box,
} from './boxes.ts';
import { landed } from './landed.ts';
import type * as Main from './main.ts';
import type * as SaidModule from './Said.tsx';
import * as threads from './threads.ts';
import { NEW_SIDE_ONLY, NO_LINES, NOT_IN_DIFF, offersOf } from './writing.ts';

const HEAD = 'a'.repeat(40);
const OLDER = 'b'.repeat(40);
const NEWER = 'c'.repeat(40);
let VIEW = 'v0';

// The background process prepares each file attached as it is.
/** What a screen reader was told, in order. */
const heard = vi.hoisted((): string[] => []);
vi.mock('./Said.tsx', async (original) => {
  const actual = await original<typeof SaidModule>();
  return {
    ...actual,
    tell: (text: string): void => {
      heard.push(text);
      actual.tell(text);
    },
  };
});

vi.mock('./main.ts', async (original) => ({
  ...(await original<typeof Main>()),
  commentsJobs: () => ({
    prepare: ({ name, bytes }: PrepareInput): Promise<Prepared> =>
      Promise.resolve({
        kind: 'prepared',
        name,
        bytes: new Uint8Array(bytes ?? []),
        metadata: { kind: 'image', removed: { location: false, other: false, embedded: false } },
        paidPlan: false,
      }),
  }),
}));

const said = vi.hoisted(() => ({
  pull: undefined as unknown,
  run: undefined as unknown,
  /** The view on screen. */
  screen: undefined as string | undefined,
}));
vi.mock('../../tab/window/shared.ts', async (original) => ({
  ...(await original<typeof TabShared>()),
  pullOf: () => said.pull,
  runOf: () => said.run,
  activeTab: () => (said.screen === undefined ? undefined : { kind: 'pull', id: said.screen }),
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
    closed?: 'close' | 'landed' | 'dismiss';
  };
}

const diff = vi.hoisted(() => ({
  current: undefined as unknown,
  shown: [] as string[],
}));
vi.mock('../../diff/window/shared.ts', () => ({
  writingDiff: () => diff.current,
  showDiff: (view: string) => diff.shown.push(view),
  diffStateOf: () => undefined,
}));

const overview = vi.hoisted(() => ({
  /** The blocks drawn, by their keys. */
  blocks: new Map<string, unknown>(),
  /** Whether the tab's overview has each block, by its key, drawn or not; else, whether it's drawn. */
  has: new Map<string, boolean | 'unknown'>(),
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
  blockInOverview: (_tab: string, key: string) => overview.has.get(key) ?? overview.blocks.has(key),
  revisionName: (_tab: string, commit: string) => (commit === HEAD ? 'r2' : 'r1'),
}));

/** Presses letter `key` with nothing focused, as the system would. */
function press(key: string): void {
  const init = { key, code: `Key${key.toUpperCase()}`, bubbles: true, cancelable: true };
  document.body.dispatchEvent(new KeyboardEvent('keydown', init));
}

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
    hold(sent: boolean) {
      composer.held = sent;
    },
    close(drawn?: boolean) {
      composer.closed = drawn ? 'landed' : 'close';
    },
    leave() {
      on.close(true);
    },
    dismiss() {
      composer.closed = 'dismiss';
    },
    keep: () => ({ text: composer.text, editor: 'as it was' }),
  } as Drawn['composer'];
  return composer;
}

/**
 * A diff that draws boxes, as the code view does, but for lines it doesn't draw yet. Its file is
 * `since` a commit other than the base, where it has no older side to comment on.
 */
function fakeDiff(missing: (at: unknown) => boolean = () => false, since = false) {
  const drawn: Drawn[] = [];
  /** The threads claimed, and those of them let go since. */
  const claimed: string[] = [];
  const released: string[] = [];
  const toggled: string[] = [];
  /** The threads drawn under each line or header, by `where`. */
  const onScreen = new Map<string, string[]>();
  const vim = vi.fn<(keys: readonly string[]) => void>();
  const shown: { -readonly [K in keyof DrawnDiff]: DrawnDiff[K] } = {
    at: HEAD,
    comparison: null,
    compareFrom: null,
    files: [
      {
        id: 'f0',
        key: 'src/backoff.ts',
        path: 'src/backoff.ts',
        old: 'src/backoff.ts',
        since,
      },
    ],
  };
  const writing: WritingDiff = {
    drawn: () => shown,
    lines: (span) =>
      Array.from({ length: span.to - span.from + 1 }, (_, at) => `line ${span.from + at}`),
    compose(at, draft, on, frame?: BoxFrame, options?: ComposeOptions) {
      if (missing(at)) throw new Error('A comment box goes under a line of a file that is shown.');
      // A box named otherwise than one open there is a box of its own.
      const open = drawn.find(
        (each) =>
          JSON.stringify(each.at) === JSON.stringify(at) &&
          each.options?.name === options?.name &&
          !each.composer.closed,
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
    hasFocus: () => false,
  };
  diff.current = writing;
  return { drawn, writing, vim, claimed, released, toggled, onScreen, shown };
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
    named: { start: 3, end: 9 },
  };
  const writing: WritingBlock = {
    block,
    compose(at, draft, on, _frame, options) {
      const open = drawn.find(
        (each) =>
          sideOf(each.at) === at.side && lineOf(each.at) === lineOf(at) && !each.composer.closed,
      );
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

/** The side of a box's line or span. */
function sideOf(at: unknown): unknown {
  return typeof at === 'object' && at !== null && 'side' in at ? at.side : undefined;
}

/** The line a box on `at`, a line or a span, goes under: its last. */
function lineOf(at: unknown): number | undefined {
  if (typeof at !== 'object' || at === null) return undefined;
  if ('line' in at && typeof at.line === 'number') return at.line;
  return 'to' in at && typeof at.to === 'number' ? at.to : undefined;
}

/**
 * `c` on the fake block's line `line`, or lines `from` to `to`, on `side`, which are at `onHead` at
 * the head.
 */
async function onBlock(
  writing: WritingBlock,
  lines: { from: number; to: number; side?: 'old' | 'new' },
  onHead: CommentOnHead,
  how: 'review' | 'now' = 'review',
): Promise<void> {
  const { from, to, side = 'new' } = lines;
  const at: Place | Span =
    from === to ? { file: 'x0', side, line: to } : { file: 'x0', side, from, to };
  overview.found = { writing, at };
  overview.onHead = onHead;
  const target: LineTarget = { kind: 'line', at };
  await commentOnBlock(tab(), target, how);
}

/** The home of a draft written from the fake block's lines `from` to `to`. */
function blockHome(
  from: number,
  to = from,
  why: DraftHomeRow['why'] = null,
  side: 'old' | 'new' = 'new',
): DraftHomeRow {
  return {
    commit: OLDER,
    path: PATH,
    block: { start: 3, end: 9 },
    at: { side, from, to },
    why,
    head: HEAD,
  };
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

/** A comment on line `end` of `src/backoff.ts`'s older side, at `HEAD`. */
function onOldLine(end: number): DraftPlaceRow {
  return {
    kind: 'thread',
    commit: HEAD,
    path: 'src/backoff.ts',
    lines: { start: null, end: { side: 'LEFT', number: end } },
  };
}

/** A comment on `src/backoff.ts` as a whole, at `HEAD`. */
function onTheFile(): DraftPlaceRow {
  return { kind: 'thread', commit: HEAD, path: 'src/backoff.ts', lines: null };
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
/** How many times Lo's commands on `e` and `z a` ran, from the window's key listener. */
let commanded = 0;
let stopKeys: () => void = () => {};

// The window's registry and key listener, as they start before anything else listens for keys: a
// key one of Lo's commands takes goes no further than its `keydown`.
beforeAll(() => {
  const keys = defineCommands('test', {
    act: { label: 'Act', group: 'Review', keys: ['e'] },
    fold: { label: 'Fold', group: 'Review', keys: ['z a'] },
  });
  const handler = {
    run() {
      commanded += 1;
    },
  };
  const commands = commandsOf(keys).map((command) => ({ ...command, handler }));
  stopKeys = listen(window, createRegistry(commands, 'mac'));
});

afterAll(() => stopKeys());

frameWith((box) => {
  boxesSeen.push(box);
  return undefined;
});

beforeEach(() => {
  VIEW = `v${++views}`;
  said.pull = pull();
  said.run = undefined;
  said.screen = VIEW;
  bridge.calls.length = 0;
  answers['comments.commentable'] = () => IN_DIFF;
  answers['comments.draft'] = () => undefined;
  answers['comments.discard'] = () => undefined;
  overview.blocks.clear();
  overview.has.clear();
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
    expect(notice()?.title).toBe(NOT_IN_DIFF);
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
    expect(notice()?.title).toBe(NO_LINES);
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
    expect(notice()?.title).toBe(NEW_SIDE_ONLY);
    expect(drawn).toHaveLength(1);
  });

  test('a view acting as nobody, or a run of layers, can’t write', () => {
    expect(canWrite(VIEW)).toBe(true);
    said.pull = pull({ acting: { kind: 'anonymous' } });
    expect(canWrite(VIEW)).toBe('Sign in to comment');
    said.pull = pull();
    said.run = { layers: [1, 2] };
    expect(canWrite(VIEW)).toBe('Show a single layer to comment');
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

  test('“Undo” brings a discarded draft back, in its box where it was, and saves it again', () => {
    vi.useFakeTimers();
    try {
      const { drawn } = fakeDiff();
      takeDrafts({
        id: VIEW,
        drafts: [row(onLines(4, 6), 'Old', { restored: true, savedAt: 1 })],
      });
      act(boxIn(drawn[0]!), 'discard');
      expect(lastDiscarded()).toMatchObject({ view: VIEW, place: onLines(4, 6), text: 'Old' });
      expect(undiscarding.enabled?.(NO_TARGET)).toBe(true);
      undiscard();
      // The box is open again on its lines, focused, with the text, and nothing more to undo.
      expect(drawn).toHaveLength(2);
      expect(drawn[1]).toMatchObject({
        at: { file: 'f0', side: 'new', from: 4, to: 6 },
        options: { focus: true },
      });
      expect(drawn[1]!.composer.text).toBe('Old');
      expect(lastDiscarded()).toBeUndefined();
      expect(undiscarding.enabled?.(NO_TARGET)).toBe('Nothing to undo');
      // Main's drafts from before it heard of either leave the box be, and then it's saved again.
      takeDrafts({ id: VIEW, drafts: [] });
      expect(drawn[1]!.composer.closed).toBeUndefined();
      vi.advanceTimersByTime(SAVE_AFTER);
      expect(asked('comments.draft').at(-1)).toMatchObject({ place: onLines(4, 6), text: 'Old' });

      // The offer runs out by itself, and a box with no text has nothing to discard.
      act(boxIn(drawn[1]!), 'discard');
      expect(lastDiscarded()?.text).toBe('Old');
      vi.advanceTimersByTime(UNDO_TIME);
      expect(lastDiscarded()).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  test('a box with no text has nothing to discard, and one being sent is held', async () => {
    const { drawn, box } = await opened();
    const target = { kind: 'box', box: box.id } as const;
    expect(discardable(box.state)).toBe(true);
    drawn[0]!.on.change(' ');
    expect(discardable(box.state)).toBe('Nothing to discard');
    expect(discarding.enabled?.(target)).toBe('Nothing to discard');
    void discarding.run(target);
    expect(drawn[0]!.composer.closed).toBeUndefined();
    expect(discardable({ ...box.state, text: 'Text', busy: true })).toBe('Sending…');
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

  test('“Discard draft” is a command on any box, and what its notes offer only while they do', () => {
    const { drawn } = fakeDiff();
    takeDrafts({
      id: VIEW,
      drafts: [row(onLines(null, 5), 'Old', { restored: true, savedAt: 1 })],
    });
    const target = { kind: 'box', box: boxIn(drawn[0]!).id } as const;
    const discard = discarding;
    const sendAgain = offering('sendAgain');
    expect(discard.listed?.(target)).toBe(true);
    expect(discard.enabled?.(target)).toBe(true);
    expect(sendAgain.listed?.(target)).toBe(false);
    expect(sendAgain.enabled?.(target)).toBe('');
    void discard.run(target);
    expect(drawn[0]!.composer.closed).toBe('dismiss');
    expect(asked('comments.discard')).toEqual([{ id: VIEW, place: onLines(null, 5) }]);
    // The box is gone, and so is what there was to discard.
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
    expect(box.state.where).toEqual({ head: 'Line 5 · r2' });
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
      where: { head: 'File', why: 'These lines changed since r1.' },
    });
    // The pull request deletes the file: GitHub still takes a comment on it, by its old path.
    await onBlock(writing, { from: 6, to: 6 }, { kind: 'gone', path: 'src/old.ts' });
    expect(boxIn(drawn[1]!).state).toMatchObject({
      place: { kind: 'thread', path: 'src/old.ts', lines: null },
      where: { head: 'File', why: 'This pull request deletes this file.' },
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
      where: { head: 'Pull request', why: 'This pull request doesn’t change this file.' },
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

  test('after a restart, a draft says again why it goes where it does', async () => {
    const block = fakeBlock();
    takeDrafts({
      id: VIEW,
      drafts: [
        row(onTheFile(), 'On the file', { savedAt: 1, home: blockHome(6, 6, 'changed') }),
        row({ kind: 'conversation' }, 'On the pull request', {
          savedAt: 2,
          home: blockHome(8, 8, 'untouched'),
        }),
      ],
    });
    await Promise.resolve();
    expect(block.drawn.map((each) => boxIn(each).state.where)).toEqual([
      { head: 'File', why: 'These lines changed since r1.' },
      { head: 'Pull request', why: 'This pull request doesn’t change this file.' },
    ]);
  });

  test('a draft whose block the overview no longer has opens where one with none would', async () => {
    const block = fakeBlock();
    const onDiff = fakeDiff();
    takeDrafts({
      id: VIEW,
      drafts: [
        row(onLines(null, 5), 'On the line', { savedAt: 1, home: blockHome(5) }),
        row(onTheFile(), 'On the file', { savedAt: 2, home: blockHome(6, 6, 'changed') }),
        row({ kind: 'conversation' }, 'On the pull request', {
          savedAt: 3,
          home: blockHome(7, 7, 'untouched'),
        }),
      ],
    });
    await Promise.resolve();
    expect(block.drawn.map((each) => lineOf(each.at))).toEqual([5, 6, 7]);
    expect(onDiff.drawn).toEqual([]);
    // The overview moves to a newer push: its block, a newer one's, isn't this one, which goes with
    // its boxes. Lines and a file open in the diff; the pull request's is the timeline's.
    overview.blocks.clear();
    overview.has.set(block.block.key, false);
    for (const each of block.drawn) takenDown(boxIn(each), each.composer);
    await Promise.resolve();
    expect(onDiff.drawn.map(({ at, composer }) => [at, composer.text])).toEqual([
      [{ file: 'f0', side: 'new', line: 5 }, 'On the line'],
      [{ file: 'f0' }, 'On the file'],
    ]);
    expect(block.drawn).toHaveLength(3);
    // Each in one box only: its block drawn again, the boxes stay where they are.
    const again = fakeBlock();
    reopenAll();
    await Promise.resolve();
    expect(again.drawn).toEqual([]);
    expect(onDiff.drawn).toHaveLength(2);
  });

  test('drawn again with no input, the diff keeps a box open in it on its line, focused, though its block is back', async () => {
    const onDiff = fakeDiff();
    const key = blockKey(OLDER, PATH, 3, 9);
    overview.has.set(key, false);
    takeDrafts({
      id: VIEW,
      drafts: [row(onLines(null, 5), 'On the line', { savedAt: 1, home: blockHome(5) })],
    });
    await Promise.resolve();
    const [first] = onDiff.drawn;
    const box = boxIn(first!);
    // Focus is in it, and the overview has its block again, drawn: it stays where it is.
    box.set({ focused: true });
    overview.has.delete(key);
    const block = fakeBlock();
    reopenAll();
    await Promise.resolve();
    expect(block.drawn).toEqual([]);
    // The diff is drawn again, as when the local copy's files take the place of GitHub's: its
    // frame goes, and the diff drawn anew draws it on its line, focused, and nowhere else.
    takenDown(box, first!.composer);
    const again = fakeDiff();
    restore(VIEW);
    reopenAll();
    await Promise.resolve();
    expect(
      again.drawn.map(({ at, options, composer }) => [at, options?.focus, composer.text]),
    ).toEqual([[{ file: 'f0', side: 'new', line: 5 }, true, 'On the line']]);
    // As it was, which the code view reads.
    expect(again.drawn[0]!.options?.kept).toEqual({ text: 'On the line', editor: 'as it was' });
    expect(block.drawn).toEqual([]);
  });

  test('drawn again after a key, the diff opens a box that had focus without it', async () => {
    const { box, drawn } = await opened();
    box.set({ focused: true });
    takenDown(box, drawn[0]!.composer);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'j' }));
    const again = fakeDiff();
    restore(VIEW);
    expect(again.drawn.map(({ at, options }) => [at, options?.focus])).toEqual([
      [{ file: 'f0', side: 'new', line: 5 }, false],
    ]);
  });

  test('drawn again with its lines still coming, a box that had focus opens without it after a key Lo’s command took', async () => {
    const { box, drawn } = await opened();
    box.set({ focused: true });
    takenDown(box, drawn[0]!.composer);
    let coming = true;
    const again = fakeDiff(() => coming);
    restore(VIEW);
    expect(again.drawn).toEqual([]);
    // `e` in the diff, as a press sends it: Lo's command takes it.
    const before = commanded;
    for (const type of ['keydown', 'keyup']) {
      const init = { key: 'e', code: 'KeyE', bubbles: true, cancelable: true };
      document.body.dispatchEvent(new KeyboardEvent(type, init));
    }
    expect(commanded).toBe(before + 1);
    // The lines come, and the box opens on them, as it was, unfocused.
    coming = false;
    restore(VIEW);
    expect(again.drawn.map(({ at, options }) => [at, options?.focus])).toEqual([
      [{ file: 'f0', side: 'new', line: 5 }, false],
    ]);
  });

  test('drawn again with its lines still coming, a box that had focus opens without it after a command chosen in the app menu', async () => {
    const { box, drawn } = await opened();
    box.set({ focused: true });
    takenDown(box, drawn[0]!.composer);
    let coming = true;
    const again = fakeDiff(() => coming);
    restore(VIEW);
    // A click in the macOS menu bar makes no event in the page; the command it chose runs.
    const menu = defineCommands('menu', {
      act: {
        label: 'Act',
        group: 'Review',
        keys: [],
        bar: { menu: 'View', section: 'diff', order: 10 },
      },
    });
    let ran = 0;
    const handler = {
      run() {
        ran += 1;
      },
    };
    const commands = commandsOf(menu).map((command) => ({ ...command, handler }));
    expect(
      runFromBar(new Registry({ system: 'mac', commands }), 'menu.act', { kind: 'none' }),
    ).toBe(true);
    expect(ran).toBe(1);
    coming = false;
    restore(VIEW);
    expect(again.drawn.map(({ at, options }) => [at, options?.focus])).toEqual([
      [{ file: 'f0', side: 'new', line: 5 }, false],
    ]);
  });

  test('drawn again with its lines still coming, a box that had focus opens without it while a key Lo’s command took is held', async () => {
    const { box, drawn } = await opened();
    box.set({ focused: true });
    takenDown(box, drawn[0]!.composer);
    let coming = true;
    const again = fakeDiff(() => coming);
    restore(VIEW);
    // `e` pressed and held: Lo's command takes it, and it isn't let go yet.
    const init = { key: 'e', code: 'KeyE', bubbles: true, cancelable: true };
    const before = commanded;
    document.body.dispatchEvent(new KeyboardEvent('keydown', init));
    expect(commanded).toBe(before + 1);
    // The lines come meanwhile, and the box opens on them unfocused.
    coming = false;
    restore(VIEW);
    expect(again.drawn.map(({ at, options }) => [at, options?.focus])).toEqual([
      [{ file: 'f0', side: 'new', line: 5 }, false],
    ]);
    document.body.dispatchEvent(new KeyboardEvent('keyup', init));
  });

  test('drawn again with its lines still coming, a box that had focus opens without it while the first key of Lo’s sequence waits for the rest', async () => {
    const { box, drawn } = await opened();
    box.set({ focused: true });
    takenDown(box, drawn[0]!.composer);
    let coming = true;
    const again = fakeDiff(() => coming);
    restore(VIEW);
    // `z` of `z a`, which is the reader's input only as the sequence ends.
    press('z');
    // The lines come meanwhile, and the box opens on them unfocused, so `a` ends the sequence.
    coming = false;
    restore(VIEW);
    expect(again.drawn.map(({ at, options }) => [at, options?.focus])).toEqual([
      [{ file: 'f0', side: 'new', line: 5 }, false],
    ]);
    const before = commanded;
    press('a');
    expect(commanded).toBe(before + 1);
  });

  test('drawn again without its line, a box opens under its file’s header there, still on its line, though its block is back', async () => {
    const key = blockKey(OLDER, PATH, 3, 9);
    overview.has.set(key, false);
    const onDiff = fakeDiff();
    takeDrafts({
      id: VIEW,
      drafts: [
        row(onOldLine(4), 'From the block', { savedAt: 1, home: blockHome(4, 4, null, 'old') }),
        row(onOldLine(6), 'Written in the diff', { savedAt: 2 }),
      ],
    });
    await Promise.resolve();
    expect(onDiff.drawn.map(({ composer }) => composer.text)).toEqual([
      'From the block',
      'Written in the diff',
    ]);
    // The overview has the first's block again, and the diff is drawn again with no older side.
    overview.has.delete(key);
    const block = fakeBlock();
    for (const each of onDiff.drawn) takenDown(boxIn(each), each.composer);
    const again = fakeDiff(() => false, true);
    restore(VIEW);
    reopenAll();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(again.drawn.map(({ at, composer }) => [at, composer.text])).toEqual([
      [{ file: 'f0' }, 'From the block'],
      [{ file: 'f0' }, 'Written in the diff'],
    ]);
    expect(block.drawn).toEqual([]);
    // It says where it goes, as its place does: on its line.
    expect(boxIn(again.drawn[1]!).state.place).toEqual(onOldLine(6));
  });

  test('drawn again with neither its line nor its file, a box opens under its block if the overview has it, else nowhere, saying so, until its line is drawn', async () => {
    const onDiff = fakeDiff();
    takeDrafts({
      id: VIEW,
      drafts: [
        row(onLines(null, 4), 'From the block', { savedAt: 1, home: blockHome(4) }),
        row(onLines(5, 6), 'Written in the diff', { savedAt: 2 }),
      ],
    });
    // The overview has no block yet.
    await Promise.resolve();
    for (const each of onDiff.drawn) {
      boxIn(each).set({ focused: true });
      takenDown(boxIn(each), each.composer);
    }
    // The diff drawn anew is of another push, and the overview has the first's block now.
    const block = fakeBlock();
    const other = fakeDiff();
    other.shown.at = OLDER;
    restore(VIEW);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(other.drawn).toEqual([]);
    expect(block.drawn.map(({ at, options }) => [at, options?.focus])).toEqual([
      [{ file: 'x0', side: 'new', line: 4 }, false],
    ]);
    // The other is in no box, and the status bar says so, once.
    expect(keptAway.get(VIEW).map((kept) => kept.where)).toEqual(['backoff.ts · lines 5–6 · r2']);
    restore(VIEW);
    expect(keptAway.get(VIEW)).toHaveLength(1);
    // The next diff with its lines opens it there, unfocused, as a draft restored.
    const back = fakeDiff();
    restore(VIEW);
    expect(back.drawn.map(({ at, options, composer }) => [at, options, composer.text])).toEqual([
      [
        { file: 'f0', side: 'new', from: 5, to: 6 },
        { focus: false, name: boxIn(back.drawn[0]!).id },
        'Written in the diff',
      ],
    ]);
    expect(keptAway.get(VIEW)).toEqual([]);
  });

  test('a box the diff takes down is counted as kept at once, and a diff drawn over the last one opens it as the last goes', async () => {
    const { box, drawn } = await opened();
    // The diff drawn anew is drawn over the last one, which still holds the box: nothing opens.
    const again = fakeDiff();
    restore(VIEW);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(again.drawn).toEqual([]);
    expect(keptAway.get(VIEW)).toEqual([]);
    // The last one goes with the box: it's in no box, and the status bar counts it at once.
    takenDown(box, drawn[0]!.composer);
    expect(keptAway.get(VIEW).map((kept) => kept.where)).toEqual(['backoff.ts · line 5 · r2']);
    // The diff drawn anew opens it on its line, as it was, and the status bar says no more.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(again.drawn.map(({ at, composer }) => [at, composer.text])).toEqual([
      [{ file: 'f0', side: 'new', line: 5 }, 'Ship it?'],
    ]);
    expect(keptAway.get(VIEW)).toEqual([]);
  });

  test('a box taken down by another comparison without its file is counted as kept, with nothing drawn again after', async () => {
    const { box, drawn } = await opened();
    // Another comparison, without the box's file, is drawn over the last one before that goes.
    const other = fakeDiff();
    other.shown.files = [];
    restore(VIEW);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(keptAway.get(VIEW)).toEqual([]);
    takenDown(box, drawn[0]!.composer);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(other.drawn).toEqual([]);
    expect(keptAway.get(VIEW).map((kept) => kept.where)).toEqual(['backoff.ts · line 5 · r2']);
    expect(keptCount(keptAway.get(VIEW))).toBe('1 kept draft');
  });

  test('a box open in a tab left is counted only once the diff drawn as the tab is shown again has nowhere to open it', async () => {
    const { box, drawn } = await opened();
    // Another tab is shown, and this one's diff goes with it: the box is kept, uncounted, and
    // nothing opens it meanwhile.
    said.screen = 'other';
    takenDown(box, drawn[0]!.composer);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(keptAway.get(VIEW)).toEqual([]);
    expect(drawn).toHaveLength(1);
    // Shown again, without the box's file: the diff drawn has nowhere to open it, and counts it.
    said.screen = VIEW;
    const again = fakeDiff();
    again.shown.files = [];
    restore(VIEW);
    expect(again.drawn).toEqual([]);
    expect(keptAway.get(VIEW).map((kept) => kept.where)).toEqual(['backoff.ts · line 5 · r2']);
  });

  test('a box open in a tab left opens as it was in the diff drawn as the tab is shown again', async () => {
    const { box, drawn } = await opened();
    said.screen = 'other';
    takenDown(box, drawn[0]!.composer);
    await new Promise((resolve) => setTimeout(resolve, 0));
    said.screen = VIEW;
    const again = fakeDiff();
    restore(VIEW);
    expect(again.drawn.map(({ at, composer }) => [at, composer.text])).toEqual([
      [{ file: 'f0', side: 'new', line: 5 }, 'Ship it?'],
    ]);
    expect(keptAway.get(VIEW)).toEqual([]);
  });

  test('a box open as its tab closes is neither counted nor opened again', async () => {
    const { box, drawn } = await opened();
    // Its boxes are forgotten as the tab closes, before its diff goes.
    keepBoxesOf(new Set());
    takenDown(box, drawn[0]!.composer);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(keptAway.get(VIEW)).toEqual([]);
    expect(drawn).toHaveLength(1);
  });

  test('boxes the diff takes down together are placed in one go, each with all its tries', async () => {
    const fake = fakeDiff();
    for (const line of [3, 5, 6]) {
      await comment(tab(), { kind: 'line', at: { file: 'f0', side: 'new', line } }, 'review');
      fake.drawn.at(-1)!.on.change(`On line ${line}`);
    }
    const boxes = fake.drawn.map((each) => boxIn(each));
    expect(boxes.every((each) => each.open)).toBe(true);
    // The diff drawn anew doesn't have their lines yet, and they wait for them.
    const again = fakeDiff(() => true);
    for (const [at, each] of fake.drawn.entries()) takenDown(boxes[at]!, each.composer);
    await Promise.resolve();
    expect(boxes.map((each) => each.retries)).toEqual([1, 1, 1]);
    expect(again.drawn).toEqual([]);
  });

  test('drafts the diff drawn again had nowhere to open have one item in the status bar, whose list says where each is', async () => {
    const onDiff = fakeDiff();
    takeDrafts({
      id: VIEW,
      drafts: [
        row(onLines(5, 6), 'One', { savedAt: 1 }),
        row(onLines(null, 8), 'Two', { savedAt: 2 }),
      ],
    });
    await Promise.resolve();
    for (const each of onDiff.drawn) takenDown(boxIn(each), each.composer);
    // The diff drawn anew is of another push.
    const other = fakeDiff();
    other.shown.at = OLDER;
    restore(VIEW);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(other.drawn).toEqual([]);
    expect(keptAway.get(VIEW).map((kept) => kept.where)).toEqual([
      'backoff.ts · lines 5–6 · r2',
      'backoff.ts · line 8 · r2',
    ]);
    expect(keptCount(keptAway.get(VIEW))).toBe('2 kept drafts');
    expect(keptCount(keptAway.get(VIEW).slice(1))).toBe('1 kept draft');
    expect(keptCount([])).toBeUndefined();
    // Its click, and its command, open the list of them.
    expect(keptOpen.get(VIEW)).toBe(false);
    showKeptDrafts(VIEW);
    expect(keptOpen.get(VIEW)).toBe(true);
  });

  test('a draft counted with nowhere to open counts on as main moves it to a newer push', async () => {
    const onDiff = fakeDiff();
    takeDrafts({ id: VIEW, drafts: [row(onLines(5, 6), 'One', { savedAt: 1 })] });
    await Promise.resolve();
    for (const each of onDiff.drawn) takenDown(boxIn(each), each.composer);
    // The diff drawn anew is of another push, with nowhere to open it.
    const other = fakeDiff();
    other.shown.at = OLDER;
    restore(VIEW);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(keptAway.get(VIEW).map((kept) => kept.where)).toEqual(['backoff.ts · lines 5–6 · r2']);
    // Main moves it to a newer push, on the same lines: it's counted still, where it is now.
    const moved = { ...onLines(5, 6), commit: NEWER };
    takeDrafts({ id: VIEW, drafts: [row(moved, 'One', { savedAt: 1 })] });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(other.drawn).toEqual([]);
    expect(keptAway.get(VIEW)).toHaveLength(1);
    expect(keptCount(keptAway.get(VIEW))).toBe('1 kept draft');
  });

  test('a box the diff drawn again had nowhere to open is kept nowhere: its block takes it once the overview has it', async () => {
    const key = blockKey(OLDER, PATH, 3, 9);
    overview.has.set(key, false);
    const onDiff = fakeDiff();
    takeDrafts({
      id: VIEW,
      drafts: [row(onLines(null, 4), 'From the block', { savedAt: 1, home: blockHome(4) })],
    });
    await Promise.resolve();
    const [first] = onDiff.drawn;
    boxIn(first!).set({ focused: true });
    takenDown(boxIn(first!), first!.composer);
    // Drawn anew without its file, at the same push.
    const without = fakeDiff();
    without.shown.files = [];
    restore(VIEW);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(without.drawn).toEqual([]);
    expect(keptAway.get(VIEW).map((kept) => kept.where)).toEqual(['backoff.ts · line 4 · r2']);
    // The overview has its block now: it opens there, unfocused, and the status bar says no more.
    overview.has.delete(key);
    const block = fakeBlock();
    reopenAll();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(block.drawn.map(({ at, options }) => [at, options?.focus])).toEqual([
      [{ file: 'x0', side: 'new', line: 4 }, false],
    ]);
    expect(without.drawn).toEqual([]);
    expect(keptAway.get(VIEW)).toEqual([]);
  });

  test('the pull request’s draft from a block opens in the timeline’s box, once, as the overview moves past the block', async () => {
    const block = fakeBlock();
    takeDrafts({
      id: VIEW,
      drafts: [
        row({ kind: 'conversation' }, 'On the pull request', {
          savedAt: 3,
          home: blockHome(7, 7, 'untouched'),
        }),
      ],
    });
    await Promise.resolve();
    expect(block.drawn.map((each) => each.composer.text)).toEqual(['On the pull request']);
    expect(timelineBoxes.get(VIEW)).toMatchObject({ own: undefined, away: 'block' });
    // The overview moves to a newer push, whose blocks this one isn't.
    overview.blocks.clear();
    overview.has.set(block.block.key, false);
    for (const each of block.drawn) takenDown(boxIn(each), each.composer);
    await Promise.resolve();
    const own = timelineBoxes.get(VIEW).own;
    expect(own?.state.text).toBe('On the pull request');
    expect(timelineBoxes.get(VIEW).away).toBeUndefined();
    expect(timelineBox(VIEW, { kind: 'conversation' })).toBe(own);
    // Once: nowhere else, however often the overview changes.
    reopenAll();
    await Promise.resolve();
    expect(block.drawn).toHaveLength(1);
    expect(timelineBoxes.get(VIEW).own).toBe(own);
  });

  test('the pull request’s draft whose block the overview has never shows in the timeline', async () => {
    const block = fakeBlock();
    // The timeline drew its box first, empty.
    const empty = timelineBox(VIEW, { kind: 'conversation' });
    expect(empty).toBeDefined();
    takeDrafts({
      id: VIEW,
      drafts: [
        row({ kind: 'conversation' }, 'On the pull request', {
          savedAt: 3,
          restored: true,
          home: blockHome(7, 7, 'untouched'),
        }),
      ],
    });
    await Promise.resolve();
    expect(block.drawn.map((each) => each.composer.text)).toEqual(['On the pull request']);
    expect(timelineBoxes.get(VIEW)).toMatchObject({ own: undefined, away: 'block' });
    expect(timelineBox(VIEW, { kind: 'conversation' })).toBeUndefined();
    // Still unknown while the overview is read again: it waits, and isn't the timeline's either.
    overview.has.set(block.block.key, 'unknown');
    overview.blocks.clear();
    reopenAll();
    await Promise.resolve();
    expect(timelineBoxes.get(VIEW)).toMatchObject({ own: undefined, away: 'waits' });
  });

  test('a draft waits while Lo can’t tell whether the overview has its block', async () => {
    const onDiff = fakeDiff();
    const key = blockKey(OLDER, PATH, 3, 9);
    overview.has.set(key, 'unknown');
    takeDrafts({
      id: VIEW,
      drafts: [row(onLines(null, 5), 'On the line', { savedAt: 1, home: blockHome(5) })],
    });
    await Promise.resolve();
    expect(onDiff.drawn).toEqual([]);
    // The overview, checked, has another commit's blocks.
    overview.has.set(key, false);
    reopenAll();
    expect(onDiff.drawn.map((each) => each.composer.text)).toEqual(['On the line']);
  });

  test('a box on a line of one side doesn’t take `c` on that number on the other', async () => {
    const { drawn, writing } = fakeBlock();
    await onBlock(
      writing,
      { from: 6, to: 6 },
      { kind: 'lines', path: PATH, side: 'new', from: 6, to: 6 },
    );
    await onBlock(
      writing,
      { from: 6, to: 6, side: 'old' },
      { kind: 'file', path: PATH, why: 'older' },
    );
    expect(drawn.map((each) => each.at)).toEqual([
      { file: 'x0', side: 'new', line: 6 },
      { file: 'x0', side: 'old', line: 6 },
    ]);
    expect(boxIn(drawn[1]!).state.where).toEqual({
      head: 'File',
      why: 'Removed lines can’t be followed to r2.',
    });
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
    expect(notice()).toMatchObject({ title: 'Added comment on backoff.ts to review', body: '' });
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
    expect(notice()?.title).toMatch(/^Sent comment on #\d+$/);
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
    heard.length = 0;
    await send(box, 'review');
    expect(asked('comments.send')).toEqual([
      { id: VIEW, place: onLines(null, 5), text: 'Ship it?', how: 'review' },
    ]);
    expect(landed.get(VIEW).has('T_1')).toBe(true);
    // A screen reader hears it go, and that it went.
    expect(heard).toEqual(['Sending…', 'Added comment to review']);
    // The box shows the comment, held, until its thread's card comes, and goes with it.
    expect(drawn[0]!.composer.closed).toBeUndefined();
    expect(drawn[0]!.composer.held).toBe(true);
    threadsCome(threadRow('T_other', 5));
    expect(drawn[0]!.composer.closed).toBeUndefined();
    threadsCome(threadRow('T_other', 5), threadRow('T_1', 5));
    expect(drawn[0]!.composer.closed).toBe('close');
    // Still the comment as it was sent, for as long as the diff keeps it drawn.
    expect(sendingNow(box.state)).toBe(true);
  });

  test('sent, a box whose comment’s card doesn’t come closes anyway, and one whose card is there closes at once', async () => {
    const { drawn, box } = await opened();
    answers['comments.send'] = (): SendOutcome => ({
      kind: 'sent',
      pending: true,
      joined: false,
      thread: 'T_1',
      landedOn: null,
    });
    vi.useFakeTimers();
    await send(box, 'review');
    await vi.advanceTimersByTimeAsync(LAND_WAIT - 1);
    expect(drawn[0]!.composer.closed).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(drawn[0]!.composer.closed).toBe('close');
    vi.useRealTimers();
    await comment(tab(), { kind: 'line', at: { file: 'f0', side: 'new', line: 6 } }, 'review');
    drawn[1]!.on.change('Here too.');
    threadsCome(threadRow('T_1', 6));
    await send(boxIn(drawn[1]!), 'review');
    expect(drawn[1]!.composer.closed).toBe('landed');
  });

  test('a reply’s box closes as its thread holds one more comment', async () => {
    const reply = threadRow('T2', 2);
    const { drawn } = withThreads(reply);
    answers['comments.send'] = (): SendOutcome => ({
      kind: 'sent',
      pending: false,
      joined: false,
      thread: 'T2',
      landedOn: null,
    });
    acts.reply(tab(), { kind: 'line', at: { file: 'f0', side: 'new', line: 2 } });
    await vi.waitFor(() => expect(drawn).toHaveLength(1));
    drawn[0]!.on.change('Agreed.');
    await send(boxIn(drawn[0]!), 'now');
    threadsCome(reply);
    expect(drawn[0]!.composer.closed).toBeUndefined();
    threadsCome({
      ...reply,
      comments: [...reply.comments, threadComment('C_reply', 'rozed-bot', 'Agreed.')],
    });
    expect(drawn[0]!.composer.closed).toBe('close');
  });

  test('drafts that say a comment was taken before its answer comes close its box once, said once', async () => {
    const { drawn, box } = await opened();
    let answer!: (outcome: SendOutcome) => void;
    answers['comments.send'] = () =>
      new Promise<SendOutcome>((resolve) => {
        answer = resolve;
      });
    heard.length = 0;
    vi.useFakeTimers();
    try {
      const sending = send(box, 'review');
      // Main marks the draft sent, then takes it, before it answers.
      takeDrafts({
        id: VIEW,
        drafts: [row(onLines(null, 5), 'Ship it?', { sending: 'sending', sent: 'Ship it?' })],
      });
      takeDrafts({ id: VIEW, drafts: [] });
      expect(heard).toEqual(['Sending…']);
      answer({ kind: 'sent', pending: true, joined: false, thread: 'T_1', landedOn: null });
      await sending;
      expect(heard).toEqual(['Sending…', 'Added comment to review']);
      // It waits for the thread the answer named, and for one wait.
      threadsCome(
        threadRow('T_other', 5, { comments: [threadComment('C', 'rozed-bot', 'Ship it?')] }),
      );
      expect(drawn[0]!.composer.closed).toBeUndefined();
      await vi.advanceTimersByTimeAsync(LAND_WAIT);
      expect(drawn[0]!.composer.closed).toBe('close');
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  test('a box still held closes as the threads draw its comment, before its answer', async () => {
    const { drawn, box } = await opened();
    let answer!: (outcome: SendOutcome) => void;
    answers['comments.send'] = () =>
      new Promise<SendOutcome>((resolve) => {
        answer = resolve;
      });
    heard.length = 0;
    const sending = send(box, 'now');
    // Somebody else's comment on the line, or yours with other words, isn't it.
    threadsCome(
      threadRow('T_theirs', 5, { comments: [threadComment('C1', 'octocat', 'Ship it?')] }),
      threadRow('T_other', 5, { comments: [threadComment('C2', 'rozed-bot', 'Not yet.')] }),
    );
    expect(drawn[0]!.composer.closed).toBeUndefined();
    threadsCome(
      threadRow('T_new', 5, { comments: [threadComment('C3', 'rozed-bot', 'Ship it?')] }),
    );
    expect(drawn[0]!.composer.closed).toBe('close');
    // Main's draft of it brings no box back, and its answer says it went, once.
    takeDrafts({
      id: VIEW,
      drafts: [row(onLines(null, 5), 'Ship it?', { sending: 'sending', sent: 'Ship it?' })],
    });
    expect(drawn).toHaveLength(1);
    answer({ kind: 'sent', pending: false, joined: false, thread: 'T_new', landedOn: null });
    await sending;
    expect(heard).toEqual(['Sending…', 'Sent comment']);
  });

  test('a note, or a look for a comment, takes focus only from a reader still in the box', async () => {
    const { drawn, box } = await opened();
    const lost = row(onLines(null, 5), 'Ship it?', { sending: 'unknown', sent: 'Ship it?' });
    const looking = { ...lost, sending: 'checking' } as const;
    const focused = (): number => drawn[0]!.composer.focused;
    const before = focused();
    // Focus nowhere: the box takes it, for its note and for the look.
    takeDrafts({ id: VIEW, drafts: [lost] });
    expect(focused()).toBe(before + 1);
    takeDrafts({ id: VIEW, drafts: [looking] });
    expect(focused()).toBe(before + 2);
    // The reader has gone on to the code: neither takes them back.
    const code = document.createElement('button');
    document.body.append(code);
    code.focus();
    try {
      takeDrafts({ id: VIEW, drafts: [lost] });
      takeDrafts({ id: VIEW, drafts: [looking] });
      expect(focused()).toBe(before + 2);
      expect(box.state.sending).toBe('checking');
    } finally {
      code.remove();
    }
  });

  test('⌥⏎ into your pending review says so, once the box has closed', async () => {
    const { drawn, box } = await opened();
    answers['comments.send'] = (): SendOutcome => ({
      kind: 'sent',
      pending: true,
      joined: true,
      thread: 'T_1',
      landedOn: null,
    });
    await send(box, 'now');
    expect(notice()).toMatchObject({ title: 'Added to pending review', body: '' });
    threadsCome(threadRow('T_1', 5));
    expect(drawn[0]!.composer.closed).toBe('close');
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

  test('not confirmed, nothing sends it again: “Check again” asks main to look, and sends nothing', async () => {
    const { drawn, box } = await opened();
    takeDrafts({
      id: VIEW,
      drafts: [row(onLines(null, 5), 'Ship it?', { sending: 'unknown', sent: 'Ship it?' })],
    });
    // The open box again, with its text, and its note said.
    expect(drawn[0]!.composer.held).toBe(false);
    expect(offersOf(box.state)).toEqual(['checkAgain']);
    expect(heard.at(-1)).toBe('Comment not confirmed. GitHub didn’t respond.');
    await send(box, 'now');
    act(box, 'sendAgain');
    expect(asked('comments.send')).toEqual([]);
    act(box, 'checkAgain');
    expect(asked('comments.check')).toEqual([{ id: VIEW, place: onLines(null, 5) }]);
    // Main looks: the box is the comment's card meanwhile.
    takeDrafts({
      id: VIEW,
      drafts: [row(onLines(null, 5), 'Ship it?', { sending: 'checking', sent: 'Ship it?' })],
    });
    expect(drawn[0]!.composer.held).toBe(true);
    // It didn't post: now it can go again.
    takeDrafts({
      id: VIEW,
      drafts: [row(onLines(null, 5), 'Ship it?', { sending: 'notPosted' })],
    });
    expect(drawn[0]!.composer.held).toBe(false);
    expect(offersOf(box.state)).toEqual(['sendAgain']);
    act(box, 'sendAgain');
    expect(asked('comments.send')).toHaveLength(1);
  });

  test('refused, the box stays with why; offline, nothing sends', async () => {
    const { drawn, box } = await opened();
    answers['comments.send'] = () => ({ kind: 'refused', refusal: { kind: 'notInDiff' } });
    await send(box, 'now');
    expect(box.state.refusal).toEqual({ kind: 'notInDiff' });
    expect(drawn[0]!.composer.closed).toBeUndefined();
    said.pull = pull({
      connection: { kind: 'offline', retryAt: null, cause: { kind: 'offline' }, error: '' },
    });
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
    // Its box shows the comment until the thread it's in is drawn.
    takeDrafts({ id: VIEW, drafts: [] });
    expect(drawn[0]!.composer.closed).toBeUndefined();
    expect(drawn[0]!.composer.held).toBe(true);
    threadsCome(
      threadRow('T_found', 5, { comments: [threadComment('C_found', 'rozed-bot', 'Ship it?')] }),
    );
    expect(drawn[0]!.composer.closed).toBe('close');
  });

  test('when main finds a comment sent to post at once in your pending review, the box says so', async () => {
    await opened();
    takeDrafts({
      id: VIEW,
      drafts: [row(onLines(null, 5), 'Ship it?', { sending: 'checking', sent: 'Ship it?' })],
    });
    takeJoined({ id: VIEW, place: onLines(null, 5) });
    expect(notice()).toMatchObject({ title: 'Added to pending review', body: '' });
  });

  test('a comment main says joined it that no box here sent says nothing', async () => {
    await opened();
    const before = notice();
    // The box was never sent: its draft isn't marked sent. And there's none at all at the other.
    takeJoined({ id: VIEW, place: onLines(null, 5) });
    takeJoined({ id: VIEW, place: onLines(null, 9) });
    expect(notice()).toBe(before);
  });
});

/** The window's name for each upload main was asked for. */
function uploadIds(): unknown[] {
  return asked('comments.upload').map((input) =>
    typeof input === 'object' && input !== null && 'upload' in input ? input.upload : undefined,
  );
}

/** A PNG's first bytes, as a file dropped on a box. */
function png(): File {
  return new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], 'shot.png');
}

describe('files attached', () => {
  /** Each upload's answer, given by the test once main is asked. */
  const uploads: ((outcome: UploadOutcome) => void)[] = [];

  beforeEach(() => {
    uploads.length = 0;
    answers['comments.attachable'] = () => ({ kind: 'open', login: 'rozed-bot' });
    answers['comments.upload'] = () =>
      new Promise<UploadOutcome>((resolve) => {
        uploads.push(resolve);
      });
    answers['comments.cancelUpload'] = () => undefined;
    answers['comments.send'] = () => ({ kind: 'refused', refusal: { kind: 'notInDiff' } });
  });

  test('nothing is sent while one is on its way in, by `⌘⏎` or a button, and it goes once it’s in', async () => {
    const { drawn, box } = await opened();
    drawn[0]!.on.files?.([png()]);
    await vi.waitFor(() => expect(uploadIds()).toHaveLength(1));
    drawn[0]!.on.submit('review');
    await send(box, 'now');
    expect(asked('comments.send')).toEqual([]);
    uploads[0]!({ kind: 'uploaded', markdown: '![shot](https://example.com/a.png)', viaGh: false });
    await vi.waitFor(async () => {
      await send(box, 'review');
      expect(asked('comments.send')).toHaveLength(1);
    });
  });

  test('a restored draft holding a placeholder whose upload isn’t under way is sent without it', async () => {
    const { drawn } = fakeDiff();
    // As Lo wrote it before it quit, and partly edited.
    const placeholder = '![Uploading shot.png…](lo-upload:9f86d081884c7d65)';
    const edited = '[Uploading old.png…](lo-upload:0123456789abcdef';
    const text = `Repro: ${placeholder}`;
    takeDrafts({
      id: VIEW,
      drafts: [
        row(onLines(null, 5), text, { savedAt: 1 }),
        row(onLines(null, 7), `Before: ${edited}`, { savedAt: 1 }),
      ],
    });
    const [box, other] = [boxIn(drawn[0]!), boxIn(drawn[1]!)];
    await send(box, 'review');
    await send(other, 'review');
    // Lo takes what's left of each out: none goes to GitHub, and none holds its comment back.
    expect(asked('comments.send')).toMatchObject([{ text: 'Repro: ' }, { text: 'Before: ' }]);
  });

  test('text that only reads like a placeholder is sent as it is', async () => {
    const { drawn } = fakeDiff();
    const texts = [
      'Retries stall while uploading big files… then time out.',
      '[notes](uploading guide.md)',
      '```suggestion\nlog.info("uploading %d files…", count);\n```',
    ];
    takeDrafts({
      id: VIEW,
      drafts: texts.map((text, at) => row(onLines(null, 3 + at), text, { savedAt: 1 })),
    });
    for (const each of drawn) await send(boxIn(each), 'review');
    const sent = asked('comments.send').map((input) =>
      typeof input === 'object' && input !== null && 'text' in input ? input.text : undefined,
    );
    expect(sent).toEqual(texts);
  });

  test('a box closed with nothing in it gives up what’s uploading, and nothing goes into its draft', async () => {
    const { drawn } = await opened();
    drawn[0]!.on.files?.([png()]);
    await vi.waitFor(() => expect(uploadIds()).toHaveLength(1));
    drawn[0]!.on.change('');
    drawn[0]!.on.close(false);
    expect(asked('comments.cancelUpload')).toEqual([{ id: VIEW, upload: uploadIds()[0] }]);
    uploads[0]!({ kind: 'uploaded', markdown: '![shot](https://example.com/a.png)', viaGh: false });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(asked('comments.draft')).toEqual([
      { id: VIEW, place: onLines(null, 5), text: '', home: null },
    ]);
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

/** Main sends `rows` as the view's threads, and they're drawn: the boxes that waited for them go. */
function threadsCome(...rows: ThreadRow[]): void {
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
  landBoxes(VIEW);
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
    expect(notice()?.title).toBe('Go to one of the 2 threads first');
    acts.reply(tab(), { kind: 'line', at: { file: 'f0', side: 'new', line: 9 } });
    expect(notice()?.title).toBe('No thread on this line');
    // One `]t` landed on is the one.
    acts.reply(tab(), { ...ON_FIVE, thread: 'T5b' });
    expect(drawn.map((each) => each.at)).toEqual([{ thread: 'T2' }, { thread: 'T5b' }]);
  });

  test('a thread placed under a line but not drawn there yet is no key’s to act on', async () => {
    const { drawn, onScreen } = withThreads(threadRow('T2', 2));
    onScreen.clear();
    answers['comments.resolve'] = (): ActOutcome => ({ kind: 'done' });
    acts.resolve(tab(), ON_TWO);
    expect(notice()?.title).toBe('No thread on this line');
    acts.reply(tab(), ON_TWO);
    await acts.edit(tab(), ON_TWO);
    acts.remove(tab(), ON_TWO);
    expect(notice()?.title).toBe('No thread on this line');
    expect(drawn).toEqual([]);
    expect(acts.deleteAsking()).toBeUndefined();
    expect(asked('comments.resolve')).toEqual([]);
    expect(asked('comments.editing')).toEqual([]);
  });

  test('a change GitHub took stays as asked until the threads show it, or the wait ends', () => {
    vi.useFakeTimers();
    try {
      const going = { thread: 'T2', comment: null, change: 'resolve', stands: 'sending' } as const;
      withThreads(threadRow('T2', 2));
      heard.length = 0;
      acts.takeActs({ id: VIEW, acts: [going] });
      // Main is done as GitHub answers; the threads still say unresolved.
      acts.takeActs({ id: VIEW, acts: [] });
      expect(acts.acting.get(VIEW).get('T2')).toEqual(going);
      // Their next read shows it: the card is its threads' again.
      threadsCome(threadRow('T2', 2, { resolved: true }));
      acts.settleActs(VIEW);
      expect(acts.acting.get(VIEW).size).toBe(0);
      expect(heard).toEqual(['Resolving…', 'Resolved thread']);
      // One the threads don't show in time: its control is its own again as the wait ends, and
      // its card still shows what was asked, never what the threads said before.
      const back = { ...going, change: 'unresolve' } as const;
      const resolved = threadRow('T2', 2, { resolved: true });
      acts.takeActs({ id: VIEW, acts: [back] });
      acts.takeActs({ id: VIEW, acts: [] });
      acts.settleActs(VIEW);
      expect(acts.acting.get(VIEW).get('T2')).toEqual(back);
      expect(acts.atWork(VIEW, 'T2')).toBe('Unresolving…');
      vi.advanceTimersByTime(acts.SETTLE_WAIT);
      expect(acts.acting.get(VIEW).get('T2')).toEqual(back);
      expect(acts.atWork(VIEW, 'T2')).toBeUndefined();
      expect(acts.resolvedNow(VIEW, resolved)).toBe(false);
      expect(heard.at(-1)).toBe('Unresolved thread');
      // The threads read again are what it is, whatever they say.
      acts.settleActs(VIEW);
      expect(acts.acting.get(VIEW).size).toBe(0);
      expect(acts.unshown.get(VIEW).size).toBe(0);
      expect(acts.resolvedNow(VIEW, resolved)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  test('a note closed stays closed while main says the same, and comes back when it changes', () => {
    withThreads(threadRow('T2', 2));
    const lost = { thread: 'T2', comment: null, change: 'resolve', stands: 'unknown' } as const;
    acts.takeActs({ id: VIEW, acts: [lost] });
    acts.closeAct(VIEW, lost);
    // Main says it again, as it does with every change of another thread's.
    acts.takeActs({ id: VIEW, acts: [{ ...lost }] });
    expect(acts.closedActs.get(VIEW).has(acts.noteKey(lost))).toBe(true);
    acts.takeActs({ id: VIEW, acts: [{ ...lost, stands: 'notDone' }] });
    expect(acts.closedActs.get(VIEW).size).toBe(0);
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
    expect(notice()?.title).toMatch(/ can’t reply to this thread$/);
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
    expect(notice()?.title).toMatch(/^GitHub’s rate limit resets at [^.]+$/);
  });

  test('while a change to a thread is at work, nothing else is asked of it', async () => {
    const thread = threadRow('T2', 2);
    withThreads(thread);
    acts.takeActs({
      id: VIEW,
      acts: [{ thread: 'T2', comment: null, change: 'resolve', stands: 'sending' }],
    });
    // Its card shows it resolved, and its commands say what's at work.
    expect(acts.atWork(VIEW, 'T2')).toBe('Resolving…');
    expect(acts.resolvedNow(VIEW, thread)).toBe(true);
    await acts.resolveThread(tab(), thread);
    acts.remove(tab(), ON_TWO);
    expect(asked('comments.resolve')).toEqual([]);
    expect(acts.deleteAsking()).toBeUndefined();
  });

  test('`x` where GitHub doesn’t let you, or offline, sends nothing', () => {
    withThreads(threadRow('T2', 2, { viewerCanResolve: false }), threadRow('T5', 5));
    acts.resolve(tab(), ON_TWO);
    expect(notice()?.title).toMatch(/ can’t resolve this thread$/);
    said.pull = pull({
      connection: { kind: 'offline', retryAt: null, cause: { kind: 'offline' }, error: 'down' },
    });
    acts.resolve(tab(), ON_FIVE);
    expect(notice()?.title).toBe('Offline');
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
    // The box is the comment from here: its card draws without it.
    expect([...editing.get(VIEW)]).toEqual(['C_mine']);
    drawn[0]!.composer.replace(0, 5, 'Mine, edited.');
    drawn[0]!.on.submit('review');
    await vi.waitFor(() =>
      expect(asked('comments.edit')).toEqual([{ id: VIEW, place, text: 'Mine, edited.' }]),
    );
    // The box shows the new text until the comment's card does.
    await vi.waitFor(() => expect(boxIn(drawn[0]!).state.landing).toBe(true));
    expect(drawn[0]!.composer.closed).toBeUndefined();
    expect([...editing.get(VIEW)]).toEqual(['C_mine']);
    threadsCome(
      threadRow('T2', 2, {
        comments: [
          threadComment('C_old', 'rozed-bot', 'Older.'),
          { ...mine, body: 'Mine, edited.' },
        ],
      }),
      threadRow('T5', 5, { comments: [threadComment('C_theirs', 'ravi-k', 'Theirs.')] }),
    );
    expect(drawn[0]!.composer.closed).toBe('close');
    expect(editing.get(VIEW).size).toBe(0);
    // Someone else's is refused in Lo's words.
    await acts.edit(tab(), ON_FIVE);
    expect(notice()?.title).toBe('None of these comments are yours');
    await acts.edit(tab(), { kind: 'thread', thread: 'T5' }, 'C_theirs');
    expect(notice()?.title).toBe('This comment isn’t yours');
  });

  test('a reply and an edit the diff drawn again has nowhere to open are drafts kept, which say what they are and where their threads are', async () => {
    const rows = [threadRow('T2', 2), threadRow('T5', 5, { startLine: 3 })];
    const { drawn } = withThreads(...rows);
    answers['comments.editing'] = (): ActOutcome => ({ kind: 'done' });
    await acts.edit(tab(), ON_TWO);
    acts.reply(tab(), ON_FIVE);
    for (const each of drawn) takenDown(boxIn(each), each.composer);
    // Drawn anew without the threads, which main still has.
    withThreads();
    threads.held.set(VIEW, { threads: { ...threads.held.get(VIEW).threads!, threads: rows } });
    restore(VIEW);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(keptAway.get(VIEW).map((kept) => kept.where)).toEqual([
      'Edit · backoff.ts · line 2',
      'Reply · backoff.ts · lines 3–5',
    ]);
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
      connection: { kind: 'offline', retryAt: null, cause: { kind: 'offline' }, error: 'down' },
    });
    acts.remove(tab(), ON_TWO);
    expect(acts.deleteAsking()).toBeUndefined();
    expect(notice()?.title).toBe('Offline');
  });

  test('a change on its way says nothing on the card, whose control is at work; one that didn’t go, or may not have, says so until the thread shows it', () => {
    const unresolved = threadRow('T2', 2);
    for (const stands of ['waiting', 'sending', 'checking'] as const) {
      expect(acts.underWay(standing(stands))).toBe(true);
      expect(acts.actNote(standing(stands), unresolved, false)).toBeUndefined();
    }
    expect(acts.actNote(standing('notDone'), unresolved, false)).toEqual({
      title: 'Couldn’t resolve the thread',
      text: 'GitHub didn’t respond.',
      again: 'try',
    });
    // Nobody knows whether it went: only a look is offered.
    expect(acts.actNote(standing('unknown'), unresolved, false)?.again).toBe('check');
    expect(acts.underWay(standing('notDone'))).toBe(false);
    expect(acts.actNote(standing('unknown'), unresolved, false)?.title).toBe(
      'Resolve not confirmed',
    );
    expect(
      acts.actNote(standing('unknown'), { ...unresolved, resolved: true }, false),
    ).toBeUndefined();
    expect(acts.actNote(standing('unknown'), unresolved, true)).toBeUndefined();
  });
});
