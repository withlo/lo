// What crosses into and out of the code views: every type here is Lo's own, and none names the
// editor underneath. Features hand a view Lo's data, call its methods, and hear back through its
// events, in places (a file's id, a side, a line), never in editors or document positions.

import type { FileDiff, WordRange } from '@lo/diff';

import type {
  HeaderTarget,
  KeySource,
  LineTarget,
  Mode,
  Place,
  Side,
  Span,
  Target,
  VimKey,
} from '../commands/index.ts';

export type {
  FileDiff,
  HeaderTarget,
  KeySource,
  LineTarget,
  Mode,
  Place,
  Side,
  Span,
  Target,
  VimKey,
  WordRange,
};

/** Where a code view's cursor can be: on a file's line, or on its header. */
export type Spot = { kind: 'line'; at: Place } | HeaderTarget;

/** How a diff is laid out: the two sides next to each other, or one column of both. */
export type DiffLayout = 'split' | 'inline';

/** What a file's header shows besides its path: plain data, which `setHeader` replaces. */
export interface FileHeader {
  additions: number;
  deletions: number;
  /** Marked viewed: its name dims. */
  viewed?: boolean;
  /** How many comments its threads hold, when it has any. */
  comments?: number;
  /** Short labels after its counts, such as "generated". */
  tags?: readonly string[];
}

/** A changed file, as a diff view is given it. */
export interface DiffFile {
  /** The caller's name for the file, which every place and event uses. */
  id: string;
  path: string;
  previousPath?: string;
  change: 'added' | 'modified' | 'deleted';
  /**
   * Each side's lines, none on a side the file isn't on. Absent, the file is kept out of the view
   * until it's loaded: `za` asks for it with the `load` event, and `setLines` brings it.
   */
  lines?: { old: readonly string[]; new: readonly string[] };
  /** Why the file isn't shown as a diff: its note says so in place of its lines. */
  skip?: 'binary' | 'large' | 'generated' | 'empty';
  /** Starts closed into one block, as a viewed or generated file does; `za` opens it. */
  collapsed?: boolean;
  header: FileHeader;
  /**
   * Lines, first to last, that `lines` holds only as placeholders, as GitHub's diff leaves out the
   * unchanged lines between its hunks. They stay collapsed, and `zo` and `zR` don't open them,
   * until `setLines` brings the whole file.
   */
  gaps?: readonly { side: Side; from: number; to: number }[];
}

/** One end of moved code: a file's lines, first to last, on the side it's on. */
export interface MovedEnd {
  file: string;
  first: number;
  last: number;
}

/** Code the pull request moves: deleted at `from`, on the old side, and added at `to`. */
export interface MovedCode {
  from: MovedEnd;
  to: MovedEnd;
  /** The words edited on the way, on each side's lines. */
  words: { old: readonly WordRange[]; new: readonly WordRange[] };
}

/** A note at the top of the view, on what's being compared. */
export interface DiffNote {
  text: string;
  tone: 'plain' | 'info' | 'warn';
}

export interface DiffInit {
  /** The files in the left panel's order. A new order is a new view. */
  files: readonly DiffFile[];
  note?: DiffNote;
  layout: DiffLayout;
  /** The keys Vim runs Lo's motions with, and the keymap's `vim` lines, from the registry. */
  vimKeys: readonly VimKey[];
  /** The nonce the window's content security policy lets the view's style elements carry. */
  nonce: string;
}

/** A comment in a thread, as plain text. */
export interface ThreadComment {
  author: string;
  body: string;
}

/** A review thread under a line. */
export interface ThreadView {
  id: string;
  /** The line it's under. */
  at: Place;
  comments: readonly ThreadComment[];
}

/** Where a jump goes: the next change, file or thread, counted from the cursor. */
export type JumpTo = 'change' | 'file' | 'thread';

/**
 * What `fold` does at a place: `open` or `close` the unchanged lines there (`zo`, `zc`), open
 * every run of them in the `file` (`zR`), or `toggle` the file (`za`): load it if it's kept out,
 * or close it into one block, or open it again.
 */
export type Fold = 'open' | 'close' | 'file' | 'toggle';

/** How a comment box's text is sent: added to the pending review, or posted now. */
export type Send = 'review' | 'now';

/** What a comment box tells its caller. */
export interface ComposerEvents {
  /** The text changed. */
  change(text: string): void;
  /** `⌘⏎` adds the comment to the review; `⌥⏎` posts it now. The box stays until it's closed. */
  submit(how: Send): void;
  /**
   * `Esc` in normal mode closed the box: `keep` when it held text, which the caller keeps as the
   * draft for the next box there.
   */
  close(keep: boolean): void;
}

/** A comment box's handle. */
export interface Composer {
  /** The text so far. */
  readonly text: string;
  /** Focuses the box in insert mode, at the end of its text. */
  focus(): void;
  /** Types `text` at the cursor. */
  insert(text: string): void;
  /** Closes the box, as after it was sent, and gives focus back to the line it was on. */
  close(): void;
}

/** How level the rows on screen are, as drawn. */
export interface Misalignment {
  /** Rows with something on both sides whose start is on screen on either side. */
  rows: number;
  /** How far apart the worst one's tops are on the two sides, in pixels. */
  worst: number;
  /** Rows drawn on one side only, with the other side blank there. */
  blank: number;
  /** The worst row's key. */
  at?: string;
}

/** How far what's on screen moved since the last reading, against what the input asked. */
export interface Movement {
  asked: number;
  old?: number;
  new?: number;
}

/** What the spacer pass has cost so far. */
export interface PassStats {
  passes: number;
  /** Passes that changed a spacer. */
  changed: number;
  totalMs: number;
  maxMs: number;
  /** The longest an editor took to forget a chunk of heights, while the page was idle. */
  forgetMaxMs: number;
}

/** Where the cursor is, and where it's drawn, in the window's pixels. */
export interface CursorReading {
  at: Spot;
  /** The column it's in: a side, or the inline layout's one. */
  pane: Side | 'inline';
  top: number;
  bottom: number;
  /** Whether it's drawn wholly inside the box that scrolls. */
  onScreen: boolean;
}

/** Readings for measurements and tests, cheap enough to take every frame. */
export interface Probe {
  /** How level the rows on screen are now, as drawn. Zero rows inline. */
  misalignment(): Misalignment;
  /**
   * How far what's on screen moved since the last call, against what the wheel or a moved cursor
   * asked, on each side; with nothing else moving them, each equals `asked`. Call it every frame.
   */
  movement(): Movement;
  readonly passStats: PassStats;
  /** How many spacers each side holds, drawn or not. */
  readonly spacers: { old: number; new: number };
  readonly layout: DiffLayout;
  /** The focused code editor's cursor, or the one focus last left. */
  cursor(): CursorReading | undefined;
}

/** A pull request's diff, both sides in one scroll. */
export interface DiffView extends KeySource {
  /** Shows a file's diff. Its lines must be in the view already. */
  setDiff(file: string, diff: FileDiff): void;
  /** Shows the code the pull request moves. */
  setMoves(moves: readonly MovedCode[]): void;
  /** Highlights a side of a file from `@lo/syntax`'s `[from, to, token]` triples over its text. */
  setTokens(file: string, side: Side, triples: Uint32Array): void;
  /**
   * Brings in a file's lines: those of a file kept out, as after `load`, or the whole of one in
   * place of what it showed, its gaps filled. Its diff and highlighting follow with `setDiff` and
   * `setTokens`.
   */
  setLines(file: string, lines: { old: readonly string[]; new: readonly string[] }): void;
  /** Says a file asked for with `load` couldn't be loaded: its note says so, and `za` asks again. */
  loadFailed(file: string): void;
  setHeader(file: string, header: FileHeader): void;
  /** Lays the diff out again, keeping the cursor's line on screen. */
  setLayout(layout: DiffLayout): void;
  /** Replaces the threads drawn under lines. */
  setThreads(threads: readonly ThreadView[]): void;
  /**
   * Moves the cursor to what `at` names, and brings it on screen: a line, the last line `v`
   * selected, a header, a file's header on the side the cursor is on, or a thread's line. Says
   * whether it could: a file or a thread the view doesn't have, or a target of another kind, it
   * can't. Not a jump, and focus stays where it is: `focus()` takes it there.
   */
  reveal(at: Target): boolean;
  /** `]c` and kin: `count` changes, files or threads on, or back where it's negative. */
  jump(to: JumpTo, count: number): void;
  /** `Tab`: the cursor goes to its row on the other side. A jump. */
  otherSide(): void;
  /** `open` and `close` act on a line; `file` and `toggle` on a line's file, a header's or a file. */
  fold(at: Target, how: Fold): void;
  /** The text of a span's lines, as `yy` copies them. */
  lines(span: Span): readonly string[];
  /**
   * Opens a comment box with `draft` in it, under a line, the last line of a span, or a thread,
   * and focuses it. A box already open there is focused instead, as it is.
   */
  compose(at: Place | Span | { thread: string }, draft: string, on: ComposerEvents): Composer;
  focus(): void;
  destroy(): void;
  readonly probe: Probe;
}

/** What a diff view tells its caller. */
export interface DiffEvents {
  /** The cursor moved, in a side or inline: for the status bar. */
  cursor(at: Spot): void;
  /** Vim's mode changed in the view's code: for the status bar. */
  mode(mode: Mode): void;
  /** The file at the top of the screen changed: the tree follows. */
  file(id: string): void;
  /**
   * A jump, from one spot to another: a Vim motion that jumps (`G`, `/`, `]f`), `jump` or
   * `otherSide`. The caller records `from` in the tab's history, which `⌃o` walks back with
   * `reveal`.
   */
  jumped(from: Spot, to: Spot): void;
  /** `za` on a file kept out: load its lines, then `setLines`, or `loadFailed`. */
  load(file: string): void;
  /** A right-click: the registry's menu for what was clicked. */
  menu(target: Target, x: number, y: number): void;
}

/**
 * Something a code view marks on a file's lines. One kind so far: lines picked out, as those a
 * definition or an overview's block points at are when the whole file opens on them.
 */
export interface Mark {
  kind: 'lines';
  at: Span;
}

/** Where a peek's answer came from: a language server, or Lo's own reading of the syntax. */
export type PeekSource = 'server' | 'syntax';

/** One of a peek's answers: a line somewhere in the repository. */
export interface PeekAnswer {
  path: string;
  /** From 1. */
  line: number;
  source: PeekSource;
}

/** What a peek under a line shows (`gd`, `gr`): its answers, and the one whose code shows. */
export interface PeekView {
  answers: readonly PeekAnswer[];
  /** The answer shown, by its place in `answers`. */
  shown: number;
}

/** A file shown whole and read-only, as a whole-file view is given it. */
export interface FileInit {
  /** The caller's name for the file, which every place and event uses. */
  id: string;
  path: string;
  /**
   * Which version it is, and so the side its places are on: the head's, `new`, unless it's the
   * base's, `old`, as for a file the pull request deletes.
   */
  side?: Side;
  lines: readonly string[];
  /** `@lo/syntax`'s triples over its text, when they're ready; `setTokens` brings them later. */
  tokens?: Uint32Array;
  marks?: readonly Mark[];
  /** The keys Vim runs Lo's motions with, and the keymap's `vim` lines, from the registry. */
  vimKeys: readonly VimKey[];
  /** The nonce the window's content security policy lets the view's style elements carry. */
  nonce: string;
}

/**
 * A whole file, read-only: an unchanged file, a file `gf` opens, a definition's file. Its places
 * are on its file and side, and its cursor is on a line, or on its header when it has no lines.
 */
export interface FileView extends KeySource {
  /** Highlights it from `@lo/syntax`'s `[from, to, token]` triples over its text. */
  setTokens(triples: Uint32Array): void;
  /** Replaces its marks. Marks on another file, or on its other side, are left out. */
  setMarks(marks: readonly Mark[]): void;
  /**
   * Moves the cursor to what `at` names, and brings it on screen: a line, the last line `v`
   * selected, its header or its file, which are its first line. Says whether it could: a place on
   * another file or side, or a target of another kind, it can't. Not a jump, and focus stays where
   * it is: `focus()` takes it there.
   */
  reveal(at: Target): boolean;
  /** Shows a peek under the line at `at`, or closes the one there when `peek` is undefined. */
  peek(at: Place, peek: PeekView | undefined): void;
  focus(): void;
  destroy(): void;
}

/** What a whole-file view tells its caller. */
export interface FileEvents {
  /** The cursor moved: for the status bar. */
  cursor(at: Spot): void;
  /** Vim's mode changed in the view's code: for the status bar. */
  mode(mode: Mode): void;
  /**
   * A jump, from one spot to another: a Vim motion that jumps (`G`, `/`, `%`). The caller records
   * `from` in the tab's history, which `⌃o` walks back with `reveal`.
   */
  jumped(from: Spot, to: Spot): void;
  /** A right-click: the registry's menu for what was clicked. */
  menu(target: Target, x: number, y: number): void;
}

/**
 * Lo's motions the diff view runs, by the ids of the commands that declare them: in a code view,
 * Vim runs them under the keys the registry gives (`setVimKeys`), so counts and visual mode work.
 * A motion the registry gives that isn't here is refused, rather than left a dead key.
 */
export const diffMotions: Readonly<Record<string, { to: JumpTo; forward: boolean }>> = {
  'diff.nextChange': { to: 'change', forward: true },
  'diff.previousChange': { to: 'change', forward: false },
  'diff.nextFile': { to: 'file', forward: true },
  'diff.previousFile': { to: 'file', forward: false },
  'diff.nextThread': { to: 'thread', forward: true },
  'diff.previousThread': { to: 'thread', forward: false },
};
