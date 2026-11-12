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

/**
 * What's at the top of the screen: the line or header there, and how far above the screen's top
 * its own top is, in pixels.
 */
export interface Viewport {
  at: Spot;
  offset: number;
}

/** How a diff is laid out: the two sides next to each other, or one column of both. */
export type DiffLayout = 'split' | 'inline';

/** What a file's header shows besides its path: plain data, which `setHeader` replaces. */
export interface FileHeader {
  additions: number;
  deletions: number;
  /**
   * Its viewed mark, drawn as a ball: `viewed` (its name dims too), `unviewed`, or `stale`, changed
   * since it was viewed. None for a file with no mark, as when nobody's signed in.
   */
  viewed?: 'viewed' | 'unviewed' | 'stale';
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
  /** Its diff, when it's known as the view is made: as `setDiff` gives it, but drawn at once. */
  diff?: FileDiff;
  /** Its highlighting, when it's known as the view is made, as `setTokens` gives it. */
  tokens?: { old?: Uint32Array | undefined; new?: Uint32Array | undefined };
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
 * every run of them in the `file` (`zR`), with those its lines and diff bring later, until the
 * reader closes one, or `toggle` the file (`za`): load it if it's kept out, or close it into one
 * block, or open it again.
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
  /**
   * The line of text or header drawn at height `y` on the page, on the side that follows the
   * screen, if one is there.
   */
  spotAt(y: number): Spot | undefined;
  /** How far down the page a line or header is drawn, if it's drawn. */
  spotTop(spot: Spot): number | undefined;
  /** How far down the page a line or header ends, if it's drawn. */
  spotBottom(spot: Spot): number | undefined;
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
   * place of what it showed, its gaps filled, as when the local copy replaces GitHub's diff. When
   * the new lines hold every old one at the same place, gaps aside, with any more after them, only
   * the lines that differ change, so the cursor keeps its line and the scroll its place; otherwise
   * every line is replaced, and the cursor goes to the nearest line with the text it was on.
   * `diff`, given, shows with the new lines at once: pass it when swapping a shown file. Without
   * it, a kept-out file's diff follows with `setDiff`, and a shown file keeps its own only while
   * its lines outside its gaps stay as they were, and as many, and otherwise waits for `setDiff`.
   * Highlighting follows with `setTokens`.
   */
  setLines(
    file: string,
    lines: { old: readonly string[]; new: readonly string[] },
    diff?: FileDiff,
  ): void;
  /**
   * Whether `setLines` with these lines and diff would draw a shown file in the rows it has now,
   * each a line or a collapsed run, on the same sides: so swapping it in moves nothing on screen.
   */
  keepsShape(
    file: string,
    lines: { old: readonly string[]; new: readonly string[] },
    diff: FileDiff,
  ): boolean;
  /** Says a file asked for with `load` couldn't be loaded: its note says so, and `za` asks again. */
  loadFailed(file: string): void;
  setHeader(file: string, header: FileHeader): void;
  /** Lays the diff out again, keeping the cursor's line on screen. */
  setLayout(layout: DiffLayout): void;
  /** Replaces the threads drawn under lines. */
  setThreads(threads: readonly ThreadView[]): void;
  /**
   * Replaces the marks on lines: overview markers, in a gutter that's there from the start, so
   * marks change no line's width or height, and what's on screen stays where it is. Kinds the diff
   * view doesn't draw, and marks on files it doesn't have, are left out. A note stays open while
   * its mark does, or another from the same block on the same side of the file; one on screen stays
   * as it was, its mark changed or gone, until it's off screen or closed.
   */
  setMarks(marks: readonly Mark[]): void;
  /** Whether `openNote` would open a note at `at`: an overview marker's on its line, drawn. */
  hasNote(at: Place): boolean;
  /**
   * Opens the notes of the overview markers on `at`'s line, each under its last line, as a click on
   * a marker's ball does. Says whether there was one to open: a note that wouldn't be drawn, as on
   * a file kept out, past a file's end or on lines GitHub's diff left out, isn't. What's at the top
   * of the screen stays where it is; not a jump, and focus stays where it is.
   */
  openNote(at: Place): boolean;
  /**
   * Closes the note opened last of those drawn, as `Esc` does in the diff's code. Says whether one
   * was open. What's at the top of the screen stays where it is.
   */
  closeNote(): boolean;
  /**
   * Moves the cursor to what `at` names, and brings it on screen: a line, the last line `v`
   * selected, a header, a file's header on the side the cursor is on, or a thread's line. Says
   * whether it could: a file or a thread the view doesn't have, or a target of another kind, it
   * can't. Not a jump, and focus stays where it is: `focus()` takes it there.
   */
  reveal(at: Target): boolean;
  /**
   * Closes a shown file into one block, as `za` does, or opens it again; a file kept out or not
   * shown as a diff has nothing to close. Not a jump, and the cursor stays.
   */
  setCollapsed(file: string, collapsed: boolean): void;
  /**
   * The files with any of their rows on screen, first to last, as the next frame shows them: with
   * a cursor a key or `reveal` just moved on screen, though the editor hasn't scrolled to it yet.
   */
  filesOnScreen(): readonly string[];
  /** What's at the top of the screen as the next frame shows it, as `filesOnScreen` reads it. */
  viewport(): Viewport;
  /**
   * Scrolls so `viewport`'s line or header is at the top of the screen as it was, its own top
   * `offset` pixels above the screen's, and holds it there while the editors measure: as a jump the
   * reader asked for, it gets there however near the end it is, with room after the last file
   * that goes once it's off screen. Says whether the view has it. Moves neither the cursor nor
   * focus, and a cursor that a key or `reveal` just moved stays where this leaves it, on screen or
   * off, as after the wheel.
   */
  scrollTo(viewport: Viewport): boolean;
  /**
   * Holds `viewport`, as `viewport()` read it before a change to what the view draws, at the top of
   * the screen while the change is measured, as `scrollTo` does. Unlike `scrollTo`, it keeps the
   * page through the change and doesn't choose where the reader is: a cursor a key just moved stays
   * where the key took the screen, which is what `viewport()` reads, and side by side the spacer
   * pass keeps it on screen, as after any key.
   */
  holdTop(viewport: Viewport): boolean;
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
  /**
   * "Read it in the overview" in an overview marker's note: show the overview at the block that
   * explains the lines. Without it, notes have no such link.
   */
  explained?(block: string): void;
}

/**
 * Something a code view marks on a file's lines. A view draws the kinds it knows and leaves out the
 * rest: the whole-file view draws `lines`, and the diff view `overview`.
 */
export type Mark = LinesMark | OverviewMark;

/**
 * Lines picked out, as those a definition or an overview's block points at are when the whole file
 * opens on them.
 */
export interface LinesMark {
  kind: 'lines';
  at: Span;
}

/**
 * Lines a block of the pull request's overview explains: a ball on the first, a rail down the
 * rest, and a note under the last that says what the block says about them.
 */
export interface OverviewMark {
  kind: 'overview';
  at: Span;
  /** The caller's id for the block, which `explained` gives back. */
  block: string;
  /** What the note shows, as plain text: a label, such as the block's section, and the text. */
  note: { label: string; text: string };
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
  /**
   * Replaces its marks. Kinds it doesn't draw, and marks on another file or on its other side, are
   * left out.
   */
  setMarks(marks: readonly Mark[]): void;
  /**
   * Moves the cursor to what `at` names, and brings it on screen: a line, the last line `v`
   * selected, its header or its file, which are its first line. Says whether it could: a place on
   * another file or side, or a target of another kind, it can't. Not a jump, and focus stays where
   * it is: `focus()` takes it there.
   */
  reveal(at: Target): boolean;
  /**
   * Scrolls the view's own box, and nothing around it, so line `line` is near the top of what it
   * shows, or as near as the file's end lets it: for a view inside something else that scrolls,
   * such as a walkthrough's code in an overview. Moves neither the cursor nor focus, and isn't a
   * jump.
   */
  showLine(line: number): void;
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
 * A range of a file's lines at one commit, as an excerpt shows it: an overview's code block, say,
 * as an inline diff from the base.
 */
export interface ExcerptInit {
  /** The caller's name for the file, which every place and event uses. */
  id: string;
  path: string;
  /**
   * The file's lines at the commit (`new`) and at the base (`old`): none on a side the file isn't
   * on.
   */
  lines: { old: readonly string[]; new: readonly string[] };
  /**
   * The diff from the base to the commit, whose changes show inline, a change's deleted lines
   * before its added ones. Without it, only `range`'s side's lines show, as plain lines, as for a
   * file the pull request leaves alone.
   */
  diff?: FileDiff;
  /**
   * The lines shown: `from` to `to` on `side`, numbered as in the file, with the other side's lines
   * in the rows between them, and where `to` ends a change, the rest of that change. It stops at
   * the file's ends.
   */
  range: { side: Side; from: number; to: number };
  /** Each side's highlighting, when it's ready: `setTokens` brings it later. */
  tokens?: { old?: Uint32Array | undefined; new?: Uint32Array | undefined };
  /** Lines on `range`'s side that changed since, whose numbers say so. */
  stale?: readonly number[];
  /** The keys Vim runs Lo's motions with, and the keymap's `vim` lines, from the registry. */
  vimKeys: readonly VimKey[];
  /** The nonce the window's content security policy lets the view's style elements carry. */
  nonce: string;
}

/**
 * An excerpt: a range of a file at one commit, read-only. Its places are on the file, on the side
 * each line is on: a deleted line's on the old side, an added line's on the new, and an unchanged
 * line's on the range's side. Its cursor shows only while it has focus.
 */
export interface ExcerptView extends KeySource {
  /** Highlights a side from `@lo/syntax`'s `[from, to, token]` triples over its whole text. */
  setTokens(side: Side, triples: Uint32Array): void;
  /** Replaces the lines on the range's side marked as changed since. */
  setStale(lines: readonly number[]): void;
  /**
   * Moves the cursor to what `at` names, and brings it on screen: a line the excerpt shows, the
   * last line `v` selected, or its file, which is its first line. Says whether it could. Not a
   * jump, and focus stays where it is: `focus()` takes it there.
   */
  reveal(at: Target): boolean;
  focus(): void;
  /**
   * How tall the excerpt is with its lines as they're laid out: as tall as it is once on screen,
   * which a code view far from the window, whose lines it hasn't measured, may not be yet.
   */
  height(): number;
  destroy(): void;
}

/** What an excerpt tells its caller, as a whole-file view does. */
export type ExcerptEvents = FileEvents;

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
