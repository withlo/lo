// What crosses into and out of the code views: every type here is Lo's own, and none names the
// editor underneath. Features hand a view Lo's data, call its methods, and hear back through its
// events, in places (a file's id, a side, a line), never in editors or document positions.

import type { FileDiff, MovedBlock } from '@lo/diff';

import type { KeySource, Mode, Place, Side, Span, Target, VimKey } from '../commands/index.ts';

export type { FileDiff, KeySource, Mode, MovedBlock, Place, Side, Span, Target, VimKey };

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
}

/** A note at the top of the view, on what's being compared. */
export interface DiffNote {
  text: string;
  tone: 'plain' | 'info' | 'warn';
}

export interface DiffInit {
  /**
   * The files in the left panel's order. A new order is a new view. A move's files
   * (`MovedBlock`'s `file`) are positions in this list.
   */
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
  at: Place;
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
  setMoves(moves: readonly MovedBlock[]): void;
  /** Highlights a side of a file from `@lo/syntax`'s `[from, to, token]` triples over its text. */
  setTokens(file: string, side: Side, triples: Uint32Array): void;
  /** Brings in the lines of a file kept out, as after `load`. Its diff follows with `setDiff`. */
  setLines(file: string, lines: { old: readonly string[]; new: readonly string[] }): void;
  /** Says a file asked for with `load` couldn't be loaded: its note says so, and `za` asks again. */
  loadFailed(file: string): void;
  setHeader(file: string, header: FileHeader): void;
  /** Lays the diff out again, keeping the cursor's line on screen. */
  setLayout(layout: DiffLayout): void;
  /** Replaces the threads drawn under lines. */
  setThreads(threads: readonly ThreadView[]): void;
  /** Moves the cursor to a place, or a file's header, and brings it on screen. Not a jump. */
  reveal(at: Place | { file: string }): void;
  /** `]c` and kin: `count` changes, files or threads on, or back where it's negative. */
  jump(to: JumpTo, count: number): void;
  /** `Tab`: the cursor goes to its row on the other side. A jump. */
  otherSide(): void;
  fold(at: Place, how: Fold): void;
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
  cursor(at: Place): void;
  /** Vim's mode changed in the view's code: for the status bar. */
  mode(mode: Mode): void;
  /** The file at the top of the screen changed: the tree follows. */
  file(id: string): void;
  /**
   * A jump, from one place to another: a Vim motion that jumps (`G`, `/`, `]f`), `jump` or
   * `otherSide`. The caller records `from` in the tab's history, which `⌃o` walks back with
   * `reveal`. A place on a file's header has line 0.
   */
  jumped(from: Place, to: Place): void;
  /** `za` on a file kept out: load its lines, then `setLines`, or `loadFailed`. */
  load(file: string): void;
  /** A right-click: the registry's menu for what was clicked. */
  menu(target: Target, x: number, y: number): void;
}

/**
 * Lo's motions the diff view runs, by the ids of the commands that declare them: in a code view,
 * Vim runs them under the keys the registry gives (`setVimKeys`), so counts and visual mode work.
 */
export const diffMotions: Readonly<Record<string, { to: JumpTo; forward: boolean }>> = {
  'diff.nextChange': { to: 'change', forward: true },
  'diff.previousChange': { to: 'change', forward: false },
  'diff.nextFile': { to: 'file', forward: true },
  'diff.previousFile': { to: 'file', forward: false },
  'diff.nextThread': { to: 'thread', forward: true },
  'diff.previousThread': { to: 'thread', forward: false },
};
