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
import type { IconName } from '../icons.ts';

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
  /**
   * Its review threads, counted as the file tree counts them, when it has any: a comment mark and
   * their number, which stands out while any is unresolved.
   */
  threads?: { readonly total: number; readonly unresolved: number };
  /** Short labels at the header's end, such as "generated", joined by ` · `. */
  tags?: readonly string[];
  /**
   * How the pull request changes the file, drawn as the file tree draws it: its letter, A, D, M, R
   * or T. A deleted file's name is struck through. None draws no letter.
   */
  change?: 'added' | 'deleted' | 'modified' | 'renamed' | 'typeChanged';
  /**
   * Whether it has text changes to count. `false`, as for a binary file or a rename alone, draws no
   * `+N −N`.
   */
  counted?: boolean;
  /**
   * Something done to the file that failed, such as marking it viewed: drawn under the header by
   * the caller, in the element the view makes for it (`RenderProblem`).
   */
  problem?: FileProblem;
}

/**
 * A failure that belongs to a file, not a line: what failed, why, what GitHub or the system said,
 * and the command to try again.
 */
export interface FileProblem {
  readonly title: string;
  readonly reason?: string | undefined;
  /** The raw text behind Details, as it was said. */
  readonly details?: string | undefined;
  /** The command "Try again" runs on the file, as its key would. */
  readonly command: string;
}

/** Why a file's lines couldn't be read, for its `Problem`. */
export interface ReadFailure {
  /** The cause in plain words, where it's known. */
  readonly reason?: string | undefined;
  /** What was said of it, as it was said: behind Details. */
  readonly details?: string | undefined;
}

/** What the caller drew for a file's `Problem`, which the view keeps up to date and takes down. */
export interface ProblemContent {
  /** The problem changed: draw it again. */
  update(problem: FileProblem): void;
  /** The file has no problem anymore: take down what was drawn. */
  destroy(): void;
}

/** What `za` does to a file now (`DiffView.foldOf`). */
export type FileFold = 'collapse' | 'expand' | 'show';

/**
 * Draws file `file`'s problem in `host`, an element the view made for it, which it keeps under the
 * file's header, as the shared `Problem`, its "Try again" running `problem.command` on the file.
 * What's in `host` is the caller's. Draw it at once: the view lays the header out as it's drawn.
 */
export type RenderProblem = (
  host: HTMLElement,
  problem: FileProblem,
  file: string,
) => ProblemContent;

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
  /**
   * Whether it's drawn hidden, behind another view: its place on the page is held only from the
   * first frame after `seen`. Otherwise, from its first frame.
   */
  hidden?: boolean | undefined;
  /** What draws a file's `problem` under its header. Without it, none is drawn. */
  renderProblem?: RenderProblem | undefined;
  /** How it shows review threads: between lines unless said. `setThreadsMode` changes it. */
  threads?: ThreadsMode | undefined;
  /**
   * The old side's share of the width side by side, as the reader keeps it for every side-by-side
   * diff: half with none. `setSides` changes it.
   */
  sides?: number | undefined;
}

/**
 * The side the cursor is on, side by side, as the keys that size what has focus see it: how wide
 * it's drawn, the narrowest and widest the edge between the sides makes it, and the width the two
 * share, in CSS pixels.
 */
export interface SideEdge {
  readonly side: Side;
  readonly width: number;
  readonly min: number;
  readonly max: number;
  readonly room: number;
}

/**
 * A file as a whole, where a comment on the file goes: under the file's header, in a code view that
 * draws one.
 */
export interface OnFile {
  file: string;
}

/**
 * A review thread under a line, or on a file under its header, as a code view places and sizes it.
 * What it says is the caller's: the view makes an element for it, under its line or header, and
 * has the caller draw it there (`RenderThread`).
 */
export interface ThreadView {
  id: string;
  /** The line it's under, or the file whose header it's under. */
  at: Place | OnFile;
  /**
   * Whether it shows open, or collapsed to one line: how it starts, and what it becomes whenever
   * the caller says something other than it said last. `openThread` changes it in between.
   */
  open: boolean;
  /** Changes whenever what the thread shows changes, so the view has the caller draw it again. */
  version: number;
  /**
   * The keyboard is on it: the cursor is on its line, and it's the thread a key there acts on,
   * the one `]t` landed on or the only one under the line. The view sets it; what the caller gives
   * is taken as false.
   */
  focused?: boolean;
  /**
   * How its mark in the code's gutter draws it: a bubble beside its last line, with a bracket up
   * its range. Without it, it's an unresolved thread on its line alone, with no words.
   */
  mark?: ThreadMark | undefined;
}

/**
 * What a review thread's mark in the gutter shows: whether it's resolved, holds comments of the
 * reader's not yet sent, or is out of date, whether a change they asked of it failed, and the lines
 * it covers. Its bubble is amber while it's unresolved or pending, and grey once it's resolved or
 * out of date.
 */
export interface ThreadMark {
  readonly resolved: boolean;
  /**
   * Whether it holds comments of the reader's not yet sent, in their pending review: `some` of its
   * comments, or `all` of them, as a new thread in that review does.
   */
  readonly pending?: 'some' | 'all' | undefined;
  /** Whether its lines changed after it was written: it shows on its revision alone. */
  readonly outdated?: boolean | undefined;
  /**
   * What its card says of a change the reader asked of it that didn't go, or may not have, until
   * they dismiss it or ask again: the note's title, lower case, `resolve not confirmed`. Its bubble
   * has the dot, as for words of theirs not sent, and its name ends with it.
   */
  readonly failed?: string | undefined;
  /**
   * The first line of its range, where it covers more than the line it's under: on that line's
   * side, which for a range from a removed line to an added one is the other side.
   */
  readonly from?: { readonly side: Side; readonly line: number } | undefined;
  /**
   * What a screen reader hears of where it is, after the words for what it is, as the review's
   * `lineRefText` puts them after other words: its lines, `lines 10–35`, and the line it's under
   * alone, `line 35`, each with its revision where that's another, `line 9 · r1`.
   */
  readonly words: { readonly lines: string; readonly line: string };
}

/** What the caller drew for a thread, which the view keeps up to date and takes down. */
export interface ThreadContent {
  /** The thread changed: its version, whether it's open, or where it is. Draw it again. */
  update(thread: ThreadView): void;
  /** The view doesn't show the thread anymore: take down what was drawn. */
  destroy(): void;
}

/**
 * Draws a thread in `host`, an element the view made for it, the first time the view draws the
 * thread. What's in `host` is the caller's. Its height counts as the thread's from the first time
 * it has any. A change after that shows a frame later, cut off until then; one no input asked for,
 * such as an image loading, waits while the thread is on screen. So draw what's known at once.
 */
export type RenderThread = (host: HTMLElement, thread: ThreadView) => ThreadContent;

/**
 * How a code view shows review threads: `beside` its lines, as a mark in a lane of the gutter that
 * opens a popover over the code, so no thread moves a line; or `between` them, in the flow, each
 * under its line with space on the other side, as GitHub draws them.
 */
export type ThreadsMode = 'beside' | 'between';

/**
 * What a thread popover shows: the threads that end on one line, or on a file, in the order they
 * show, unresolved first, and whether it's pinned. A preview is the pinned popover without its
 * Close and key chips, which it keeps the room of, so pinning it moves nothing.
 */
export interface PopoverView {
  readonly threads: readonly ThreadView[];
  readonly pinned: boolean;
  /**
   * What a screen reader calls it: its first thread's mark's name, "Unresolved thread · line 5", or
   * a draft's alone, "Draft · line 5".
   */
  readonly label: string;
  /**
   * The comment box open in it, if one is: in thread `thread`, a reply's in place of the row that
   * offers one, or an edit's in place of comment `edits`; or, in no thread it shows, a new
   * comment's, after the threads. The caller draws the slot the view puts the box in: the reply's
   * (`REPLY_SLOT`), the comment's (`EDIT_SLOT`) or the new comment's (`NEW_SLOT`). A popover may
   * hold the box alone.
   */
  readonly box?: PopoverBox | undefined;
}

/** Where a comment box goes in a popover: see {@link PopoverView.box}. */
export interface PopoverBox {
  /** The thread it's written in, if it's a reply's or an edit's. */
  readonly thread?: string | undefined;
  /** The comment of that thread it edits. */
  readonly edits?: string | undefined;
}

/**
 * Beside lines, a comment not sent, which its lines' mark shows: a new comment's while its box is
 * open, and a draft once its box closed. On lines, or on a file, with no thread there, it's a
 * `message-square-dashed` on its last line, its range bracketed; in a thread, or ending on a line a
 * thread ends on too, the dot on the thread's bubble.
 */
export interface DraftMark {
  /** Where it is: a line, lines, a file, or a thread it's a reply or an edit in. */
  readonly at: Place | Span | OnFile | { readonly thread: string };
  /** Its lines as a mark's name says them, after "Draft": `lines 10–35`, `line 3`, `file`. */
  readonly words: string;
  /**
   * Its box is open, a new comment's: where its lines have no thread its mark is the popover's the
   * box is in, and it puts no dot on a thread's.
   */
  readonly shown?: boolean | undefined;
  /**
   * Opens its box again, focused: a click on its mark or `⏎` on its line does, where the mark is
   * its own, or a thread's that it's in.
   */
  readonly open: () => void;
}

/** What the caller drew in a popover, which the view keeps up to date and takes down. */
export interface PopoverContent {
  /** What it shows changed: draw it again. */
  update(popover: PopoverView): void;
  destroy(): void;
}

/**
 * Draws a popover's threads in `host`, an element the view makes for it in a layer of its own
 * scroll: at once, since the view measures it as it's drawn to place it, and shows it whole in the
 * next frame. Its Close calls `close`, which gives focus to the threads' line.
 */
export type RenderPopover = (
  host: HTMLElement,
  popover: PopoverView,
  close: () => void,
) => PopoverContent;

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
   * `Esc` closed the box, or its handle's `leave()` did: `keep` when it held text, which the
   * caller keeps as the draft for the next box there. With Vim keys on, `Esc` closes it from
   * normal mode, or the preview. A box `createComposer` made stays: closing it is the caller's.
   */
  close(keep: boolean): void;
  /**
   * With Vim keys on, Vim's mode in the box changed, or Vim keys went on or off: for the frame's
   * foot. With them off the box is always written in, which is `insert`.
   */
  mode?(mode: Mode): void;
  /** `⌘⇧V` showed the preview in the editor's place, or the editor again. */
  preview?(on: boolean): void;
  /** `⌘⇧A`: the reader asks to attach files. */
  attach?(): void;
  /** Files dropped on the box or pasted into it. The box inserts nothing for them itself. */
  files?(files: readonly File[]): void;
  /**
   * Files are dragged over the box: how many, or 0 once they're dropped or leave it. The frame's
   * dropzone shows meanwhile.
   */
  dragging?(count: number): void;
}

/** A comment box's handle. */
/** How a box held as text, not as a card, shows. */
export interface HeldText {
  /** What it says where it has no text, as an empty state's row: "No summary". */
  readonly empty: string;
  /** The icon beside it, by its name in `icons.ts`: what's absent. */
  readonly icon: IconName;
}

export interface Composer {
  /** The text so far. */
  readonly text: string;
  /** Vim's mode in the box, or `insert` with Vim keys off, when it's always written in. */
  readonly mode: Mode;
  /** Whether it shows the preview, in the editor's place. */
  readonly previewing: boolean;
  /**
   * Focuses the box, ready to type in, at the end of its text: in insert mode, with Vim keys on.
   * While its preview shows, that takes focus.
   */
  focus(): void;
  /**
   * Types `text` at the cursor as the reader sees it: where it is in insert mode, and after the
   * character it's on otherwise.
   */
  insert(text: string): void;
  /**
   * Puts `text` in place of the text from offset `from` to offset `to`, as an upload's link takes
   * its placeholder's place, wherever the cursor is. With `record` false it's no step of the box's
   * undo history, as for a change Lo makes again each time it's undone: undo goes on past it.
   */
  replace(from: number, to: number, text: string, record?: boolean): void;
  /**
   * Shows the preview in the editor's place, or the editor again. Focus in the box goes with it.
   * With Vim keys on, the preview leaves insert mode, and the editor comes back in it if it was.
   */
  preview(on: boolean): void;
  /**
   * Holds the text as it is, as while it's being sent, so that nothing typed then is lost as the
   * box closes once it's sent: no key changes it, and insert mode ends. While it's held the box
   * shows only its `sent` part, the comment as its card will draw it, as tall as that card, its
   * frame stepping aside where a card or a popover holds it. `Esc` in it then leaves it where it
   * is, and gives focus back to its line. `false` lets it go, and the box is back as it was, with
   * its text.
   *
   * Held with `text`, as a review's summary is while the review is sent, the box stays as it was
   * written, in the room it took, head and foot too: only its text is held, read-only and muted.
   */
  hold(on: boolean, text?: HeldText): void;
  /**
   * Closes the box, as after it was sent: in a code view, taking what comes under its line next as
   * what was sent, at once. On screen, the box stays as it is, held, the comment on it, until the
   * comment's own card is drawn there, which takes its place in one step; or until the reader's
   * next input. With `landed`, that card is drawn already, or about to be: the box goes with it
   * if it's measured in the next two frames, and by itself then. All of it
   * comes with no input of the reader's, so what's on screen stays where it is, and focus does too,
   * unless it was in the box: then it goes to the box's line. A box `createComposer` made is taken
   * away.
   */
  close(landed?: boolean): void;
  /**
   * Closes the box with nothing sent, as a draft discarded or moved elsewhere is: as `Esc` closes
   * it, but without a word to the caller, and leaving its line no claim on what comes there.
   */
  dismiss(): void;
  /**
   * Closes the box as `Esc` does, for a control that does: the caller hears `close`, keeping its
   * draft when it holds text.
   */
  leave(): void;
  /**
   * The box as it is, for another to open as it was ({@link ComposeOptions.kept}), as when the view
   * it's in is about to be drawn anew.
   */
  keep(): KeptBox;
}

/**
 * A comment box as it was, from {@link Composer.keep}: its text, and what a code view opening
 * another as it was reads, its caret and selection, undo history, Vim's mode and its preview.
 */
export interface KeptBox {
  readonly text: string;
  /** The rest, which only a code view reads. */
  readonly editor: unknown;
}

/**
 * The parts of a comment box the caller draws, around its editor: each an element the box makes,
 * which takes no room while it's empty.
 */
export interface BoxParts {
  /** Above the rest: what the comment is on, Write and Preview, and what closes the box. */
  head: HTMLElement;
  /** Under the head: a restored draft, a refusal, a warning. */
  note: HTMLElement;
  /** In the editor's place while the box previews: the text rendered. */
  preview: HTMLElement;
  /**
   * In place of everything else while the box's text is held (`hold`), as from the moment it's
   * sent: the comment as its card will draw it, marked as being sent.
   */
  sent: HTMLElement;
  /** Over the editor, shown while files are dragged over the box. */
  dropzone: HTMLElement;
  /** Under the editor: the files being attached. */
  uploads: HTMLElement;
  /** Last: attaching, discarding the draft, and the buttons that send. */
  foot: HTMLElement;
}

/**
 * Draws a comment box's frame in its parts, as the box opens: the box's handle is `box`. What it
 * returns takes the frame down as the box goes.
 */
export type BoxFrame = (parts: BoxParts, box: Composer) => { destroy(): void };

/** How a comment box opens. */
export interface ComposeOptions {
  /** Whether it takes focus: yes, unless it's false, as for a draft restored. */
  focus?: boolean;
  /**
   * The caller's name for the box: a key in it acts on its line or header with the box named
   * (`box`), so the caller's commands can act on the box, as from its frame's right-click menu. A
   * box named otherwise than one open at its place is a box of its own.
   */
  name?: string;
  /** What the box says while it's empty, naming what the comment is on: "Reply". */
  hint?: string;
  /**
   * The box this one is, as it was before the view was drawn anew: it opens as that one was, with
   * its caret and selection, undo history, Vim's mode and preview, if its text is the draft. That's
   * a change no input asked for, so what's on screen stays where it is, whether it takes focus or
   * not. On a line its file is drawn without, as a file closed as viewed is, or one too large, it
   * goes under the file's header. While the file's lines are still coming, it throws, as for any
   * line not drawn.
   */
  kept?: KeptBox;
  /**
   * The comment of the thread it's written in that it edits, by its id: it opens in the comment's
   * place in the thread's card, which leaves the comment out while it's edited.
   */
  edits?: string;
}

/** A comment box outside a code view, as the timeline's and a review's summary are. */
export interface ComposerInit {
  /** The text it starts with. */
  draft: string;
  /** The nonce the window's content security policy lets the box's style elements carry. */
  nonce: string;
  /** What the editor is called, for screen readers: "Comment" unless given. */
  label?: string;
  /** What the box says while it's empty, naming what the comment is on: "Comment on #264". */
  hint?: string;
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
  /**
   * Passes that ran out of rounds before the rows were level, and went round again the next frame:
   * their frame may draw rows out of step.
   */
  unsettled: number;
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
  /**
   * Says a file asked for with `load` couldn't be loaded, and why, as `failure` has it: its
   * `Problem` says so under its header, and `za` asks again.
   */
  loadFailed(file: string, failure?: ReadFailure): void;
  setHeader(file: string, header: FileHeader): void;
  /**
   * Lays the diff out again, keeping the cursor's line on screen: or, with focus in the peek, the
   * peek's line, where the cursor goes, as it does as the peek closes, and focus stays in the peek.
   * The reader changed it, so focus comes to the code, unless `focus` is false, as when the code
   * goes beside another view: then focus stays where it is. Side by side is drawn only while the
   * box is wide enough for it (`narrow`): until then the diff stays inline.
   */
  setLayout(layout: DiffLayout, options?: { readonly focus?: boolean }): void;
  /**
   * Whether the box is too narrow to draw side by side: under 480 px, twice the narrowest a side is
   * drawn. Meanwhile a diff asked for side by side draws inline, and is side by side again as soon
   * as the box is 480 px, keeping the line at the top of the screen where it is; `narrowed` says
   * when this changes.
   */
  readonly narrow: boolean;
  /**
   * Shares the width between the sides, side by side: the old side `share` of it, or half with
   * none, as the reader keeps it for every side-by-side diff. Each side keeps its minimum, the
   * larger of 240 px and a quarter of the width, and at 480 px they split evenly, with no edge
   * between them; narrower, the diff is inline (`narrow`). The code under the file's header pinned
   * at the top of the screen stays where it is, the rows level as the lines wrap anew.
   */
  setSides(share: number | undefined): void;
  /**
   * The side the cursor is on and the edge beside it, as the keys that size what has focus move it:
   * none inline, out of sight, or where the sides split evenly.
   */
  sideEdge(): SideEdge | undefined;
  /**
   * Draws the edge between the sides pressed, as a key that moved it does, until a key is let go,
   * the pointer moves or the window loses focus.
   */
  pressSides(): void;
  /**
   * Replaces the threads drawn under lines, and under files' headers, each drawn by `render` in an
   * element of its own the first time it's drawn, and kept up to date through what that returns. A
   * file's threads go under its header in the newer column, or in the inline layout's one, whether
   * or not the file shows its lines. A line or header on screen whose threads change keeps those it
   * shows until it's off screen, or until the reader's next wheel, key or click, a key `listen`
   * hands the registry too, so no line on screen moves without them; the rest change now, and
   * what's at the top of the screen stays where it is. A thread drawn on screen that changes size
   * with no input asking, as when an image in it loads, is held at the height it was drawn at the
   * same way, unless a reply's box was closed right after it as its answer came: then it grows into
   * the room the box left, where that's tall enough. What comes with the reader's input leaves what
   * they read where it is: the comment box they write in, or the thread they clicked; or else the
   * cursor's line, while it's on screen; or else the top of the screen. `]t` counts the threads
   * waiting on screen, which come as it's pressed. What the reader does to a thread, such as
   * opening it, keeps its line where it is. With `now`, lines on screen take their threads at once
   * too: for a view the reader hasn't seen yet, as one made in the same task.
   */
  setThreads(
    threads: readonly ThreadView[],
    render: RenderThread,
    options?: { readonly now?: boolean; readonly popover?: RenderPopover },
  ): void;
  /**
   * Shows review threads beside lines or between them, drawn again in one frame, the cursor's row
   * where it is on screen, or else what's at the top of the screen. Beside lines, no thread is
   * drawn in the flow: each has its bubble and bracket in the lane, and opens in one popover over
   * the code, drawn by the `popover` `setThreads` was last given. Its pointer resting on a mark
   * previews its threads, and a click, `pinThread` or `]t` pins them, until `Esc`, Close, a click
   * on the mark again, a press outside, or the cursor leaving their lines closes it. A popover never
   * covers its lines unless they fill the pane. Beside lines a comment box opens in the popover too
   * (`compose`). A box open as the mode changes closes, keeping its draft.
   */
  setThreadsMode(mode: ThreadsMode): void;
  /**
   * Replaces the drafts the marks show beside lines: a new comment's while its box is open, and the
   * words of each comment not sent once its box closed. Nothing on screen moves for them, and
   * between lines nothing draws them.
   */
  setDrafts(drafts: readonly DraftMark[]): void;
  /**
   * Beside lines, opens the box of the draft whose mark is on line `at`, or on thread `thread`'s
   * line, as a click on the mark does: one closed, one in a thread the popover there shows first,
   * else focuses one open there. Says whether there was one. A key's line target says where there
   * is (`draft`).
   */
  openDraft(at: Place | { readonly thread: string }): boolean;
  /**
   * Beside lines, pins the popover of the line thread `id` is on, as a key opens it: under the
   * line, the pane scrolled the least that shows it whole, the cursor on the line. One pinned there
   * already stays as it is. With `focus`, focus goes into it, its first comment ringed; otherwise
   * it stays where it is. Says whether there was one to pin: between lines, or for a thread the
   * view doesn't have, there's none.
   */
  pinThread(id: string, focus?: boolean): boolean;
  /**
   * Moves the cursor to the line thread `id` is on, lands it, and shows the thread: beside lines,
   * its popover pinned under the line, as `pinThread` pins it; between lines, opened, its line put
   * at the top of the screen. Focus stays where it is. A jump the reader asked for. Says whether
   * the view has it.
   */
  showThread(id: string): boolean;
  /**
   * The threads of the popover pinned, by their ids: none while it's closed or a preview, or while
   * it holds a new comment's box alone.
   */
  pinned(): readonly string[];
  /** Whether the popover is pinned, with threads in it or a comment box alone. */
  popoverPinned(): boolean;
  /**
   * Closes the popover, as `Esc` does: focus in it goes to its line. A comment box open in it
   * closes first, keeping its draft. Says whether one was open.
   */
  closePopover(): boolean;
  /**
   * Opens a thread, collapses it, or the other of the two, as the reader asked: the caller draws it
   * again, its line staying where it is. Says whether the view has the thread.
   */
  openThread(id: string, open: boolean | 'toggle'): boolean;
  /**
   * The threads drawn under line `at`, or under file `at`'s header, by their ids, in their order:
   * none while those given there wait to come, as they do while the line is on screen. What a key
   * there can act on.
   */
  threadsDrawn(at: Place | OnFile): readonly string[];
  /**
   * Replaces the marks on lines: overview markers, in a gutter that's there from the start, so
   * marks change no line's width or height, and what's on screen stays where it is; and hints,
   * inside lines. Kinds the diff view doesn't draw, and marks on files it doesn't have, are left
   * out. A note stays open while its mark does, or another from the same block on the same side of
   * the file; one on screen stays as it was, its mark changed or gone, until it's off screen or
   * closed, or in a diff too short to scroll, until the reader's next wheel, key or click. Its link
   * then shows what its mark says now: a note whose mark went closes rather than show a block.
   * Hints that change, which can make lines wrap anew, wait for the reader's next wheel, key or
   * click, and come then, what the reader reads staying where it is, unless the view isn't shown.
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
  /** Whether a note is drawn open, which `closeNote` would close. */
  hasOpenNote(): boolean;
  /**
   * Moves the cursor to what `at` names, and brings it on screen: a line, the last line `v`
   * selected, a header, a file's header on the side the cursor is on, or a thread's line. Says
   * whether it could: a file or a thread the view doesn't have, or a target of another kind, it
   * can't. Not a jump, and focus stays where it is: `focus()` takes it there.
   */
  reveal(at: Target): boolean;
  /**
   * Moves the cursor as `reveal` does, and puts its line or header at the top of the screen in the
   * frame that first draws it there, then holds it as `scrollTo` does: a jump the reader asked for,
   * so it gets there however near the end it is. Says whether the view has it. Focus stays where
   * it is.
   */
  revealAtTop(at: Target): boolean;
  /**
   * Marks the line `at` names with the Land move once the editor has drawn it where it is: where a
   * jump or a link brought the cursor, as `reveal` did. Nothing for a place the view doesn't have.
   */
  land(at: Target): void;
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
   * that goes once it's off screen. Until the reader moves, a box moving down, as when a banner
   * comes over the diff, takes the line down with it. Says whether the view has it. Moves neither
   * the cursor nor focus, and a cursor that a key or `reveal` just moved stays where this leaves
   * it, on screen or off, as after the wheel.
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
  /**
   * What `toggle` does to file `id` now: `collapse` a file drawn, `expand` one closed, `show` one
   * too large to draw unasked, whose lines aren't read or couldn't be, or nothing, as to a binary
   * file or one waited on.
   */
  foldOf(id: string): FileFold | undefined;
  /** The text of a span's lines, as `yy` copies them. */
  lines(span: Span): readonly string[];
  /**
   * Opens a comment box with `draft` in it, under a line, the last line of a span, or a file's
   * header, for a comment on the file, or in a thread, right after it, with `frame` drawn around
   * its editor, and focuses it, unless `focus` is false, as for a draft restored. A box already open
   * there with the same name, or with none, is focused instead, as it is: boxes named otherwise are
   * boxes of their own, as a reply's in a thread is beside a comment on its line. The box's line or
   * header stays where it is as it opens, grows and closes. A box on a file goes where its threads
   * do, whether or not the file shows its lines.
   *
   * Beside lines, nothing opens between lines: the box opens in the popover, pinned under its last
   * line, and no line moves. A new comment's comes after the line's threads, or alone, its lines
   * tinted and bracketed; a reply's takes the place of its thread's row that offers one, and an
   * edit's the comment's. One box is open at a time: one open already closes first, keeping its
   * draft, and so does one in a popover that moves to another line. Opened by the reader, the pane
   * scrolls the least that shows the popover whole; opened for them, as one opened as it was, it
   * scrolls nothing. While a box is open in it, only the box closing closes the popover: a press
   * outside, or the cursor leaving its lines, leaves it be. A new comment's popover, opened for its
   * box, closes with it, unless what it sent is in it. Focus in a box closing goes back where it
   * came from: into the popover, or to its line.
   */
  compose(
    at: Place | Span | { thread: string } | OnFile,
    draft: string,
    on: ComposerEvents,
    frame?: BoxFrame,
    options?: ComposeOptions,
  ): Composer;
  /**
   * The reader acted on thread `id` by a write whose answer will change it, as resolving it or
   * deleting one of its comments: what next comes under its line or header, and its own next
   * changes of size, are their doing, as what comes under a sent comment box's line is. It comes
   * at once, and keeps the line where it is. That lasts until something comes there, the line goes
   * off screen, or the function returned is called, as when the write changed nothing. A thread the
   * view doesn't have gets a function that does nothing.
   */
  claimThread(id: string): () => void;
  /**
   * Shows `peek` under the line at `at`, with `frame` drawn around its code as it opens, or shows
   * what the peek there shows now, its frame kept; or, with `peek` undefined, closes the peek
   * there. A view has one peek at most: one elsewhere closes as this one opens. Each is the
   * reader's asking, as `gd` is: the line stays where it is on screen, and so does all above it, or
   * while the line is off screen, what's at the top of the screen does; side by side the other
   * column makes room level with it, as for threads. Then a peek opened under a line on screen
   * that ends below the screen's foot comes on screen whole, as a jump does, by the least scroll,
   * the cursor on its line: its line goes no higher than the top, where a peek taller than the room
   * under it puts it. Closing it scrolls nothing. Its height comes from its code alone, and what
   * comes later for the answer shown, as its code, never makes it shorter, so nothing moves after
   * it opens without the reader.
   * Focus goes into the peek, a scope of its own (`peek`), from the view's code, and closing it
   * puts focus back on the code, the cursor at `at`. Says whether there was a peek to show or
   * close: there's none under a line not drawn, as of a file closed or kept out, one GitHub's diff
   * left out, or one among collapsed lines, where no cursor is.
   */
  peek(at: Place, peek: PeekView | undefined, frame?: PeekFrame): boolean;
  /**
   * Where the word at `at` is drawn, or the character there outside a word, for a popover over it:
   * none while it isn't on screen.
   */
  anchor(at: Place): Anchor | undefined;
  /**
   * The place at the other end of the moved code `at` is in, if it's in some: line for line, blank
   * lines left out, as the move was found, so a line comes back to itself from its other end. A
   * blank line goes with the next line that isn't. While either end's file has no lines in the
   * view, as one kept out, there's no pairing them: it's the other end's first line.
   */
  otherEnd(at: Place): Place | undefined;
  /**
   * It's on screen, drawn `hidden`: its place on the page is where it is in the next frame, the
   * first it's seen in. Once it's been seen, nothing.
   */
  seen(): void;
  focus(): void;
  /**
   * Focuses the code where `focus` puts it and opens its search there, as `/` does: Vim's prompt
   * with Vim keys on, the search field at the foot of the code with them off.
   */
  find(): void;
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
   * A jump, from one spot to another: a motion that jumps (`G`, `/`, `]f`), `jump` or
   * `otherSide`. The caller records `from` in the tab's history, which `⌃o` walks back with
   * `reveal`.
   */
  jumped(from: Spot, to: Spot): void;
  /** `za` on a file kept out: load its lines, then `setLines`, or `loadFailed`. */
  load(file: string): void;
  /** A right-click: the registry's menu for what was clicked. */
  menu(target: Target, x: number, y: number): void;
  /**
   * The reader moved the edge between the sides somewhere new, side by side, and let go, or put it
   * back with a double-click: keep the old side's share for every side-by-side diff, or the
   * default, half, with none, as for sides let go at even, and hand it back through `setSides`.
   */
  sides?(share: number | undefined): void;
  /**
   * The box became too narrow to draw side by side, and the diff inline if it was side by side, or
   * wide enough again (`narrow`): for what offers the layout, which says why it can't be side by
   * side meanwhile.
   */
  narrowed?(narrow: boolean): void;
  /**
   * Someone else's new thread came to a line on screen, where it waits for the reader's next
   * input with its line marked "New thread": for the host to tell a screen reader, which isn't
   * reading where the mark is.
   */
  arrived?(): void;
  /**
   * "Show in overview" in an overview marker's note: show the overview at the block that
   * explains the lines. `at` is the line the note is under, where the reader was. Without it, notes
   * have no such link.
   */
  explained?(block: string, at: Place): void;
  /** The pointer rested on a word, or left it: see {@link Rested}. */
  rested?: Rested;
  /**
   * A click on the label at one end of moved code: `to` is the first line at its other end, where
   * the label says the code went or came from.
   */
  moved?(to: Place): void;
}

/**
 * The pointer stayed on a word for half a second, as for a type hover: `at` is where the word
 * starts. Then `undefined` once the pointer leaves the word, or the word moves from under it.
 */
export type Rested = (at: Place | undefined) => void;

/** Where a word is drawn, in the window's pixels, as `anchor` finds it. */
export interface Anchor {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * Something a code view marks on a file's lines. A view draws the kinds it knows and leaves out the
 * rest: the whole-file view draws `lines` and `hint`, and the diff view `overview` and `hint`.
 */
export type Mark = LinesMark | OverviewMark | HintMark;

/**
 * A hint drawn inside a line, in the code's place before column `at.column`, as a language server's
 * type of a name, or the name of a call's parameter, is: `.lo-inlay`.
 */
export interface HintMark {
  kind: 'hint';
  /** The line, and the column it's drawn before, from 0; with none, the line's end. */
  at: Place;
  label: string;
  /** Whether it stands a space apart from the code before it, and from the code after it. */
  padding?: { readonly before?: boolean; readonly after?: boolean } | undefined;
}

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
 * rest, and a note under the last that says what the block says about them. An overview explains
 * new lines only: a mark on the old side isn't drawn.
 */
export interface OverviewMark {
  kind: 'overview';
  at: Span;
  /** The caller's id for the block, which `explained` gives back. */
  block: string;
  /**
   * What the note shows: a label, such as the block's section, and the text, plain, which the view
   * sizes the note by and tells one note from another by. `draw` draws the text the caller's way in
   * its place, as rich text.
   */
  note: { label: string; text: string; draw?: DrawNote | undefined };
}

/**
 * Draws a note's text in `into`, an element the view makes for it, in place of its plain text: at
 * once, as the view measures the note as it's drawn. Returns what takes it down.
 */
export type DrawNote = (into: HTMLElement) => () => void;

/** Where a peek's answer came from: a language server, or Lo's own reading of the syntax. */
export type PeekSource = 'server' | 'syntax';

/** One of a peek's answers: a line somewhere in the repository. */
export interface PeekAnswer {
  path: string;
  /** From 1. */
  line: number;
  /** Where its name starts on the line, from 0, when it's known: its code marks the name. */
  column?: number | undefined;
  source: PeekSource;
  /** Where it came from, as its frame says: "TypeScript", "Code index · same name". */
  label?: string | undefined;
}

/** Lines of an answer's file, as a peek shows them, with their highlighting. */
export interface PeekCode {
  /** The first line's number in the file, from 1. */
  first: number;
  lines: readonly string[];
  /** `@lo/syntax`'s triples over `lines` joined with line breaks, when they're ready. */
  tokens?: Uint32Array | undefined;
}

/** The most lines of code a peek is tall: more scroll inside it. */
export const PEEK_LINES = 15;

/**
 * What a peek under a line shows (`gd`, `gr`): its answers, and the code of the one shown, its
 * answer's line marked, near the top.
 */
export interface PeekView {
  answers: readonly PeekAnswer[];
  /** The answer shown, by its place in `answers`. */
  shown: number;
  /** The shown answer's code: none, as for one outside the repository, whose frame says why. */
  code?: PeekCode | undefined;
  /**
   * Whether the shown answer's code is still to come: till then the peek is as tall as its code
   * can be (`PEEK_LINES`), and it stays that tall as the code comes, so nothing moves without the
   * reader.
   */
  waiting?: boolean | undefined;
  /** What it is, for a screen reader: "Definitions of estimateCost". */
  label: string;
}

/**
 * The parts of a peek its caller draws, around its code: each an element the peek makes. The head
 * and foot are as tall as the design has them, and the list as tall as the code beside it, which it
 * scrolls past, whatever is drawn in them, so nothing a frame draws moves what's under the peek.
 */
export interface PeekParts {
  /** Above the rest: what it shows and how many answers, and the way to the whole file. */
  head: HTMLElement;
  /**
   * Beside the code, with more than one answer: the answers, the one shown picked out. What in it
   * takes focus (`tabindex`), as a listbox, is where focus goes as the peek takes it, so a screen
   * reader tells of each answer picked.
   */
  list: HTMLElement;
  /** Under the rest: where the shown answer is, and the peek's keys. */
  foot: HTMLElement;
}

/**
 * Draws a peek's frame in its parts as it opens, at once, and again with `update` as what the peek
 * shows changes. `destroy` takes it down as the peek closes. A key that scrolls, which neither
 * Lo's commands nor the frame take (it prevents its default), scrolls the peek's code, and never
 * what's under the peek, short of one typed in a field the frame draws, or a button's `Space`.
 */
export type PeekFrame = (
  parts: PeekParts,
  peek: PeekView,
) => { update(peek: PeekView): void; destroy(): void };

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
   * Marks the line `at` names with the Land move once the editor has drawn it where it is, as
   * `DiffView.land` does. Nothing for a place the view doesn't have.
   */
  land(at: Target): void;
  /**
   * Scrolls the view's own box, and nothing around it, so line `line` is near the top of what it
   * shows, or as near as the file's end lets it: for a view inside something else that scrolls,
   * such as a walkthrough's code in an overview. Moves neither the cursor nor focus, and isn't a
   * jump.
   */
  showLine(line: number): void;
  /**
   * Shows `peek` under the line at `at`, as the diff view does (`DiffView.peek`), or with `peek`
   * undefined closes it: the line stays where it is on screen, and all above it, or while it's off
   * screen, the first line on screen does; then a peek that ends below the screen's foot comes on
   * screen whole, as it does there. Says whether there was a peek to show or close: there's
   * none under a line of another file or side.
   */
  peek(at: Place, peek: PeekView | undefined, frame?: PeekFrame): boolean;
  /** Where the word at `at` is drawn, as the diff view finds it (`DiffView.anchor`). */
  anchor(at: Place): Anchor | undefined;
  focus(): void;
  /** Focuses the code and opens its search, as the diff view does (`DiffView.find`). */
  find(): void;
  destroy(): void;
}

/** What a whole-file view tells its caller. */
export interface FileEvents {
  /** The cursor moved: for the status bar. */
  cursor(at: Spot): void;
  /** Vim's mode changed in the view's code: for the status bar. */
  mode(mode: Mode): void;
  /**
   * A jump, from one spot to another: a motion that jumps (`G`, `/`, `%`). The caller records
   * `from` in the tab's history, which `⌃o` walks back with `reveal`.
   */
  jumped(from: Spot, to: Spot): void;
  /** A right-click: the registry's menu for what was clicked. */
  menu(target: Target, x: number, y: number): void;
  /** The pointer rested on a word, or left it: see {@link Rested}. */
  rested?: Rested;
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
  /** How it shows review threads: between lines unless said. `setThreadsMode` changes it. */
  threads?: ThreadsMode | undefined;
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
   * Replaces the threads on the lines the excerpt shows. Threads on lines it doesn't show are left
   * out. Between lines each is drawn under its line by `render`, as the diff view's are: once the
   * excerpt has been on the page, threads that would come, go or move on a line on screen wait,
   * until none of the lines they change is on screen, the reader acts in the excerpt, or acts
   * anywhere while no scroll can take those lines off screen, a key `listen` hands the registry
   * counting; then they come together. Beside lines they come at once, as marks, since nothing
   * moves for them, and the popover shows them as `popover` draws them, which stays until another
   * is given.
   */
  setThreads(
    threads: readonly ThreadView[],
    render: RenderThread,
    options?: { readonly popover?: RenderPopover },
  ): void;
  /**
   * Shows review threads beside lines or between them, as the diff view does (`DiffView`'s
   * `setThreadsMode`). Beside lines, the popover is in a layer of the scroll around the excerpt,
   * shared by every excerpt in it, so no excerpt clips it: one open for an excerpt closes another's,
   * and the pointer previews nothing while one is pinned. A box open as the mode changes closes,
   * keeping its draft.
   */
  setThreadsMode(mode: ThreadsMode): void;
  /**
   * Replaces the drafts the marks show beside lines, as the diff view's do (`DiffView`'s
   * `setDrafts`): a new comment's while its box is open, and the words of each comment not sent
   * once its box closed. A click on a draft's own mark runs its command on its line, as `⏎` there
   * does, which the line's target says (`draft`).
   */
  setDrafts(drafts: readonly DraftMark[]): void;
  /**
   * Beside lines, opens the box of the draft whose mark is on line `at`, or on thread `thread`'s
   * line, as a click on the mark does. Says whether there was one.
   */
  openDraft(at: Place | { readonly thread: string }): boolean;
  /**
   * Beside lines, pins the popover of the line thread `id` is on, as a key opens it, the scroll
   * around it scrolled the least that shows it whole, the cursor on the line. With `focus`, focus
   * goes into it, its first comment ringed. Says whether there was one to pin.
   */
  pinThread(id: string, focus?: boolean): boolean;
  /** The threads of its popover pinned, by their ids: none while it's closed or a preview. */
  pinned(): readonly string[];
  /** Whether its popover is pinned. */
  popoverPinned(): boolean;
  /** Closes its popover, as `Esc` does: focus in it goes to its line. Says whether one was open. */
  closePopover(): boolean;
  /** Whether focus is in it: its code, a comment box under its lines, or its popover. */
  hasFocus(): boolean;
  /**
   * Opens a thread, collapses it, or the other of the two; beside lines, closing it closes its
   * popover. Says whether the excerpt has it.
   */
  openThread(id: string, open: boolean | 'toggle'): boolean;
  /**
   * Opens a comment box with `draft` in it, under a line the excerpt shows, the last line of a
   * span, or a thread, with `frame` drawn around its editor, and focuses it unless
   * `options.focus` is false. A box already open there is the one it gives, as it is. Throws for a
   * line the excerpt doesn't show. Between lines, a box closed once its comment was sent
   * (`close()`) on screen keeps its room, as the threads that come there wait; the thread right
   * above it, as a reply's comes, grows into it, where it's tall enough. Beside lines, it opens in
   * the popover, as the diff view's does (`DiffView`'s `compose`): a new comment's under its last
   * line, its lines tinted and bracketed, a reply's in place of its thread's row that offers one,
   * and an edit's, named by `options.edits`, in place of that comment; one at a time in the scroll
   * around it, and no line moves.
   */
  compose(
    at: Place | Span | { thread: string },
    draft: string,
    on: ComposerEvents,
    frame?: BoxFrame,
    options?: ComposeOptions,
  ): Composer;
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
 * The keys of a code view Lo documents as its own (`vim: 'own'` in a feature's `keys.ts`) that a
 * code view runs itself while Vim keys are off, by what each does, in CodeMirror's notation. The
 * others are Vim's alone.
 */
export const plainKeys = {
  down: 'j',
  up: 'k',
  search: '/',
  nextMatch: 'n',
  previousMatch: 'N',
  top: 'g g',
  bottom: 'G',
} as const;

/**
 * Lo's motions the diff view runs, by the ids of the commands that declare them: in a code view,
 * Vim runs them under the keys the registry gives (`setVimKeys`), so counts and visual mode work.
 * A motion the registry gives that isn't here is refused, rather than left a dead key.
 */
/**
 * The commands a diff view's own controls run, by id, on what they're drawn at: the viewed ball in
 * a file's header, the `+` that follows the pointer down the gutter, the button under the header
 * of a file that's closed, or too large to draw unasked, collapsed lines, a thread's bubble in
 * the gutter, which opens or collapses its thread, or its popover beside lines, and a draft's own
 * bubble beside lines, which opens its box. They run through
 * the registry the window's keys go through (`runControl` in `@lo/ui/commands`), so a control does
 * what its key does and says what its command says.
 */
export const viewControls = {
  viewed: 'diff.markViewed',
  comment: 'comments.comment',
  toggle: 'diff.toggleFile',
  open: 'diff.openRun',
  thread: 'diff.toggleThread',
  popover: 'comments.openThread',
  draft: 'comments.openDraft',
} as const;

export const diffMotions: Readonly<Record<string, { to: JumpTo; forward: boolean }>> = {
  'diff.nextChange': { to: 'change', forward: true },
  'diff.previousChange': { to: 'change', forward: false },
  'diff.nextFile': { to: 'file', forward: true },
  'diff.previousFile': { to: 'file', forward: false },
  'diff.nextThread': { to: 'thread', forward: true },
  'diff.previousThread': { to: 'thread', forward: false },
};
