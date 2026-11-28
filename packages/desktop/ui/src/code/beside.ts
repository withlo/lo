// A code view's review threads beside its lines: each thread a mark in the lane between the line
// numbers and the code, a bubble on its last line with a bracket up its range, that opens one
// popover over the code (`popover.ts`). The pointer resting on a mark previews its threads, and a
// click, a key or a jump pins them. A comment box opens in the popover too, one at a time, and no
// line of code moves for any of it. The marks of drafts not sent, a new comment's dashed bubble or
// the dot on a thread's, open their boxes again.
//
// Between lines the same lane draws the same marks, the threads under their lines, so what each
// lane shows of a file is worked out here in either mode (`lane`).
//
// A code view keeps its threads by where they are, says where its lines are drawn (`BesideHost`),
// and hands this the reader's pointer and the cursor's moves.

import { type BlockInfo, BlockType, type EditorView } from '@codemirror/view';

import {
  type HeaderTarget,
  KEY_EVENT,
  type LineTarget,
  type ThreadTarget,
} from '../commands/index.ts';
import { NEW_SLOT, REPLY_SLOT } from '../edits.ts';
import { land } from '../motion.ts';
import type {
  BoxFrame,
  ComposeOptions,
  Composer,
  ComposerEvents,
  DraftMark,
  OnFile,
  Place,
  PopoverView,
  RenderPopover,
  Side,
  ThreadsMode,
  ThreadView,
} from './api.ts';
import { bubbleOf, rangeTone, Tones } from './bubbles.ts';
import { CommentBox } from './comments.ts';
import type { HeaderThreads } from './decorations.ts';
import { endSelection } from './keys.ts';
import { besideMarker, type LaneBubble } from './lanes.ts';
import type { Popover, PopHost, PopLines, PopRoom } from './popover.ts';
import { type LaneRange, type Lights, type LitRange, rangeUnder, sameRange } from './ranges.ts';
import { commentIn } from './threads.ts';
import { editSlot, HeaderWidget, SpacerWidget } from './widgets.ts';

/** An editor of a code view: one side's, side by side, or the one with both sides' lines. */
export type Pane = Side | 'inline';

/** Where the pointer is: what it's on, and how far across the window. */
export interface Pointed {
  readonly target: EventTarget | null;
  readonly clientX: number;
}

/** A file's line on one side, by the file's index: line 0 is its header. */
export interface At {
  file: number;
  side: Side;
  line: number;
}

/**
 * Where the threads' popover opens, beside lines: the line threads end on, or a file's header
 * (line 0) for its own, by its `waitKey`.
 */
export interface PopPlace extends At {
  readonly key: string;
}

/**
 * The document lines a range covers in a pane, as its stem draws them, and whether it ticks there
 * and has its mark there.
 */
export type LaneLines = Pick<LaneRange, 'from' | 'to' | 'tick' | 'foot'>;

/** The name a draft's range has in the lane: by its file and its lines. */
export function draftKey(file: number, side: Side, from: number, to: number): string {
  return `draft:${file}|${side}:${from}-${to}`;
}

/** Whether `key` names a draft's range in the lane, not a thread's. */
export function isDraftKey(key: string): boolean {
  return key.startsWith('draft:');
}

/** A file's threads' marks in one pane, by document line: their ranges, and each line's bubble. */
export interface FileLane {
  readonly ranges: readonly LaneRange[];
  readonly bubbles: ReadonlyMap<number, LaneBubble>;
}

/** A line of a file, by the file's index and where in it (`side:line`), as a view keys its lines. */
export function waitKey(file: number, key: string): string {
  return `${file}|${key}`;
}

/** The file and the place a `waitKey` names. */
export function splitKey(each: string): { file: number; key: string } {
  const bar = each.indexOf('|');
  return { file: Number(each.slice(0, bar)), key: each.slice(bar + 1) };
}

/**
 * Where in its file a thread is: under a line, or, for a thread on the file, under its header in
 * the newer column, as line 0.
 */
export function placeOf(at: Place | OnFile): { side: Side; line: number } {
  return 'line' in at ? { side: at.side, line: at.line } : { side: 'new', line: 0 };
}

/** 1 for a resolved thread, which a popover lists after the unresolved, else 0. */
function resolvedRank(thread: ThreadView): number {
  return Number(thread.mark?.resolved ?? false);
}

/** Threads in the order a popover lists them: unresolved first, then in the order they came. */
export function listed(threads: readonly ThreadView[]): ThreadView[] {
  return threads.toSorted((a, b) => resolvedRank(a) - resolvedRank(b));
}

/** Whether two lists of threads under a line are the same threads, in the same order. */
export function sameIds(
  before: readonly ThreadView[] | undefined,
  after: readonly ThreadView[] | undefined,
): boolean {
  const a = before ?? [];
  const b = after ?? [];
  return a.length === b.length && a.every((thread, index) => thread.id === b[index]!.id);
}

/** Whether two lists of threads are the same threads, each at the same version. */
function sameVersions(
  a: readonly ThreadView[] | undefined,
  b: readonly ThreadView[] | undefined,
): boolean {
  return (
    sameIds(a, b) && (b ?? []).every((thread, index) => thread.version === a?.[index]?.version)
  );
}

/**
 * The draft a mark beside `threads` shows, of `drafts` ending there: with no thread, the first,
 * whose own mark it is; with threads, the first whose box is closed, which puts the dot on theirs.
 */
function markedDraft<T extends { readonly shown?: boolean | undefined }>(
  threads: readonly unknown[],
  drafts: readonly T[],
): T | undefined {
  return threads.length === 0 ? drafts[0] : drafts.find((draft) => draft.shown !== true);
}

/** A draft's mark at the line it ends on: its words, its range's name, and its box's state. */
interface DraftEnd {
  readonly words: string;
  readonly key: string;
  readonly open: boolean;
  readonly shown?: boolean | undefined;
}

/** The thread a draft is in, where it's in one. */
function threadOf(draft: DraftMark): string {
  return 'thread' in draft.at ? draft.at.thread : '';
}

/** Whether two lists of drafts' marks draw the same marks: what each one opens isn't drawn. */
function sameDrafts(before: readonly DraftMark[], after: readonly DraftMark[]): boolean {
  return (
    before.length === after.length &&
    before.every((draft, index) => {
      const other = after[index]!;
      return (
        draft.words === other.words &&
        (draft.shown ?? false) === (other.shown ?? false) &&
        JSON.stringify(draft.at) === JSON.stringify(other.at)
      );
    })
  );
}

/**
 * Where a line's own row is in its block, from the document's top: its text, or a file's header
 * band, with what's drawn under it, as a comment box, but not the room that lines the sides up.
 */
function rowOf(block: BlockInfo): { top: number; bottom: number } {
  const parts = Array.isArray(block.type) ? (block.type as readonly BlockInfo[]) : [block];
  const own = parts.findIndex(
    (part) => part.type === BlockType.Text || part.widget instanceof HeaderWidget,
  );
  if (own < 0) return { top: block.top, bottom: block.bottom };
  let bottom = parts[own]!.bottom;
  for (const part of parts.slice(own + 1)) {
    if (part.widget instanceof SpacerWidget) break;
    bottom = part.bottom;
  }
  return { top: parts[own]!.top, bottom };
}

/** Whether document line `line` is in `span`, if there's one. */
function inSpan(span: { from: number; to: number } | undefined, line: number): boolean {
  return span !== undefined && line >= span.from && line <= span.to;
}

/**
 * Beside lines, the comment box open in the popover, one at a time: where it is, and how it came.
 */
interface PopBox {
  readonly box: CommentBox;
  /** Its key among the view's boxes: its place, and its caller's name for it. */
  readonly key: string;
  /** Its line, or its span's last line, or its file's header (line 0). */
  readonly place: At;
  /** Its span's first line, where it's on more than one. */
  readonly from: { readonly side: Side; readonly line: number } | undefined;
  /** The popover it's in: its place's. */
  readonly at: PopPlace;
  /**
   * Whether the popover opened for it, a new comment's: one that did closes with it, unless what it
   * sent is in it. A reply's or an edit's stays as its box closes, showing its thread.
   */
  readonly opened: boolean;
  /** Whether focus came to it from inside the popover, where it goes back to as it closes. */
  readonly within: boolean;
  /** How it takes focus once it's in its slot: at its text's end, as it was, or not at all. */
  focus: 'end' | 'shown' | false;
  /**
   * Its comment sent and the box closed, so it's that comment, held, until what was sent comes
   * into the popover in its place, or the reader's next input.
   */
  sent: boolean;
  /**
   * The threads at its place as they were before it was held, as while what it sent was on its
   * way: once they've changed, what it sent has come.
   */
  seen: readonly ThreadView[] | undefined;
}

/** Where a comment box opens beside lines, as the view works it out from what it was asked. */
export interface BoxWhere {
  /** Its key among the view's boxes: its place, and its caller's name for it. */
  readonly key: string;
  /** Its line, or its span's last line, or its file's header (line 0). */
  readonly place: At;
  /** Its span's first line, where it's on more than one. */
  readonly from: PopBox['from'];
  /** What a key in it acts on. */
  readonly target: LineTarget | HeaderTarget;
  /** The thread it's written in, a reply's or an edit's. */
  readonly written: string | undefined;
}

/**
 * What threads beside lines ask of the code view they're in: its threads, where its lines are
 * drawn, and the changes they make to it.
 */
export interface BesideHost {
  /** What the view draws in, where its marks are. */
  readonly root: HTMLElement;
  /** The box that scrolls, whose content the popover's layer is in. */
  readonly scroller: HTMLElement;
  /** The nonce the window's content security policy lets a comment box's style elements carry. */
  readonly nonce: string;
  /**
   * The view's popover, made as it's first needed, for `pop` to place and fill: one of its own, or
   * its handle on one it shares with the views in its scroll.
   */
  popover(pop: PopHost<PopPlace>): Popover<PopPlace>;
  /**
   * Opens the registry's menu of `target` at `x`, `y`, where a right-click in the popover isn't the
   * view's own to hear, as in the one an overview's code blocks share, out in their scroll.
   */
  menu?: ((target: ThreadTarget, x: number, y: number) => void) | undefined;
  /** How the view shows threads now. */
  mode(): ThreadsMode;
  /** The threads drawn in file `file`, by where they are (`side:line`, or `new:0` on the file). */
  threadsIn(file: number): ReadonlyMap<string, readonly ThreadView[]> | undefined;
  /** The index of the file the caller names `id`, if the view has it. */
  fileOf(id: string): number | undefined;
  /** The line thread `id` is under, or line 0 for its file's header, if the view has it. */
  threadPlace(id: string): At | undefined;
  /** Between lines, whether thread `id` is drawn open. */
  threadOpen(id: string): boolean;
  /** The panes the layout shows. */
  panes(): readonly Pane[];
  /** The panes with an editor, each with a lane. */
  lanePanes(): readonly Pane[];
  /** The pane keys go to: the one with focus, or the one that had it last. */
  activePane(): Pane;
  /** The pane whose lane has `at`'s bubble. */
  popPane(at: At): Pane;
  viewOf(pane: Pane): EditorView;
  /** Whether `pane` draws file `file`'s lines. */
  hasLines(pane: Pane, file: number): boolean;
  /** Whether `at`'s file draws its line, rather than something in its lines' place. */
  drawsLine(at: At): boolean;
  /** The document line of `at` in `pane`. */
  docLine(pane: Pane, at: At): number;
  /** The file line at document line `line` of `pane`, or the header's place (line 0). */
  placeAt(pane: Pane, line: number): At;
  /** The other pane's document line in the row of document line `line` of `pane`, side by side. */
  otherRow(pane: Pane, line: number): { pane: Pane; line: number } | undefined;
  /**
   * The document lines of `pane` a range of file `file`'s lines covers, from `from` to `end`, as
   * its bracket draws it, if it has any there.
   */
  laneRange(
    pane: Pane,
    file: number,
    from: { side: Side; line: number },
    end: { side: Side; line: number },
  ): LaneLines | undefined;
  /** The pane the popover is placed in, as it is now. */
  room(): PopRoom;
  /** Scrolls the pane by `by`, down or up, as the view's own scroll. */
  scrollBy(by: number): void;
  /** Puts the cursor on document line `line` of `pane`, bringing nothing on screen. */
  putCursor(pane: Pane, line: number): void;
  /** Gives focus to line `at`, the cursor on it, bringing nothing on screen. */
  focusLine(at: At): void;
  /** Files' marks changed: those of `files` in the lanes, and of `headers` in their headers. */
  marksChanged(files: Iterable<number>, headers: Iterable<number>): void;
  /** What lights the view's ranges may have changed, as the popover opened, moved or closed. */
  relight(): void;
  /** The lines file `file` keeps shown changed, as a comment box's line no longer is. */
  keep(file: number): void;
  /** Keeps line `at` shown, as a comment box's: out of its fold, the line staying where it is. */
  showLine(at: At): void;
  /** A comment box put itself where it is: nothing holds the line it left. */
  boxShown(): void;
}

/**
 * A code view's threads beside its lines: their marks, the popover they open, and the comment box
 * open in it. Between lines it draws the lanes' marks alone.
 */
export class Beside {
  /** The colour each bubble was drawn in last, so one whose thread changes state tints. */
  readonly tones = new Tones();
  readonly #host: BesideHost;
  /** The threads' popover, beside lines, once something has needed it. */
  #pop: Popover<PopPlace> | undefined;
  /** What draws the popover's threads, as the caller gave it. */
  #render: RenderPopover | undefined;
  /** Threads drawn since the last frame, with the view seen: their marks fade in. */
  readonly #arriving = new Set<string>();
  /** Where the popover was last shown open, whose lines and marks say so. */
  #shownAt: PopPlace | undefined;
  /** Counts the popovers asked to open once a jump's scroll is done, so only the latest opens. */
  #popping = 0;
  /** Beside lines, the comment box open in the popover, if one is. */
  #box: PopBox | undefined;
  /** Above 0 while the popover lets its box go, as it closes or moves: the popover's own doing. */
  #releasing = 0;
  /** The drafts the caller gave last, which beside lines the marks show. */
  #drafts: readonly DraftMark[] = [];
  /** Stops waiting for the reader's next input, which lets a sent box in the popover go. */
  #sentWait: (() => void) | undefined;
  /** The popover's card the pointer is on, or its first where it's in the popover on none. */
  #pointedCard: LitRange | undefined;
  /** Stops following the pointer in the popover. */
  #unpoint: (() => void) | undefined;

  constructor(host: BesideHost) {
    this.#host = host;
  }

  /**
   * The popover, made as it's first needed: until a thread shows, the view makes nothing. The card
   * the pointer is on in it lights its thread's range.
   */
  #popover(): Popover<PopPlace> {
    if (this.#pop) return this.#pop;
    const pop = this.#host.popover(this.#popHost());
    this.#pop = pop;
    const point = (event: PointerEvent): void => {
      const { target } = event;
      const next =
        event.type === 'pointerleave' || !(target instanceof Element)
          ? undefined
          : (this.cardUnder(target) ?? undefined);
      if (sameRange(next, this.#pointedCard)) return;
      this.#pointedCard = next;
      this.#host.relight();
    };
    pop.dom.addEventListener('pointermove', point, { passive: true });
    pop.dom.addEventListener('pointerleave', point, { passive: true });
    this.#unpoint = () => {
      pop.dom.removeEventListener('pointermove', point);
      pop.dom.removeEventListener('pointerleave', point);
    };
    return pop;
  }

  /** The popover's card the pointer is on, while it's open at the view's lines. */
  get pointedCard(): LitRange | undefined {
    return this.#pop?.open ? this.#pointedCard : undefined;
  }

  /** What draws the popover's threads: what it shows is drawn anew as it changes. */
  set render(render: RenderPopover | undefined) {
    if (render === this.#render) return;
    this.#render = render;
    this.#pop?.redraw();
  }

  /** Places the popover again by its lines as they're drawn now, as tall as the pane lets it be. */
  place(): void {
    this.#pop?.place();
  }

  /** Whether focus is in the popover, open at the view's lines. */
  hasFocus(): boolean {
    return this.#pop?.hasFocus() ?? false;
  }

  /** Closes the popover, the comment box in it first, keeping its draft. */
  close(): void {
    this.#pop?.close();
  }

  /** The line of the popover's comment box, if one is open. */
  get boxPlace(): At | undefined {
    return this.#box?.place;
  }

  /** Thread `id` came to a line: its mark fades in as it's drawn, in the next frame. */
  arrive(id: string): void {
    if (this.#arriving.size === 0) {
      requestAnimationFrame(() => requestAnimationFrame(() => this.#arriving.clear()));
    }
    this.#arriving.add(id);
  }

  /**
   * File `file`'s threads' marks in `pane`: a bubble on each line threads are drawn under, on that
   * line's side, and each range's bracket in the lane of each side it has lines on. Inline, an
   * unchanged line's threads on both sides share its bubble. A file's own threads have theirs in
   * its header.
   */
  lane(pane: Pane, file: number): FileLane {
    const host = this.#host;
    const ranges: LaneRange[] = [];
    const bubbles = new Map<number, LaneBubble>();
    const drawn = host.threadsIn(file);
    const drafts = this.#draftsIn(pane, file);
    if ((!drawn || drawn.size === 0) && drafts.size === 0) return { ranges, bubbles };
    if (!host.hasLines(pane, file)) return { ranges, bubbles };
    // Beside lines, the threads whose popover is open: their bubble says so.
    const shown = this.#shownAt;
    const popped =
      host.mode() === 'beside'
        ? new Set(shown?.file === file ? this.#poppedThreads(shown).map((thread) => thread.id) : [])
        : undefined;
    const ending = new Map<number, ThreadView[]>();
    for (const [key, threads] of drawn ?? []) {
      if (key === 'new:0' || threads.length === 0) continue;
      const end = placeOf(threads[0]!.at);
      if (pane === 'inline' || end.side === pane) {
        const line = host.docLine(pane, { file, ...end });
        ending.set(line, [...(ending.get(line) ?? []), ...threads]);
      }
      for (const thread of threads) {
        const from = thread.mark?.from;
        if (!from || (from.side === end.side && from.line === end.line)) continue;
        const range = host.laneRange(pane, file, from, end);
        if (range) {
          ranges.push({
            ...range,
            key: thread.id,
            tone: rangeTone(thread),
            arriving: this.#arriving.has(thread.id),
          });
        }
      }
    }
    // A draft's range, on lines with no thread, bracketed as a thread's is.
    ranges.push(...drafts.ranges);
    for (const line of new Set([...ending.keys(), ...drafts.bubbles.keys()])) {
      const threads = ending.get(line) ?? [];
      const marked = drafts.bubbles.get(line) ?? [];
      const draft = markedDraft(threads, marked);
      if (threads.length === 0 && !draft) continue;
      const bubble = bubbleOf(popped ? listed(threads) : threads, draft);
      const key = threads.length > 0 ? bubble.thread : `draft:${line}`;
      bubbles.set(line, {
        bubble,
        keys:
          threads.length > 0
            ? listed(threads).map((thread) => thread.id)
            : marked.map((each) => each.key),
        open:
          threads.length === 0
            ? (draft?.open ?? false)
            : popped
              ? threads.some((thread) => popped.has(thread.id))
              : host.threadOpen(bubble.thread),
        arriving: threads.some((thread) => this.#arriving.has(thread.id)),
        was: this.tones.was(`${pane}:${key}`, bubble.tone),
      });
    }
    return { ranges, bubbles };
  }

  /**
   * Beside lines, the marks of file `file`'s drafts in `pane`: by the document line each ends on,
   * those there, each with its words, and whether the popover at its line is open; and the brackets
   * of those on more than one line, muted. A file's own are in its header.
   */
  #draftsIn(
    pane: Pane,
    file: number,
  ): {
    bubbles: Map<number, DraftEnd[]>;
    ranges: LaneRange[];
    size: number;
  } {
    const host = this.#host;
    const bubbles = new Map<number, DraftEnd[]>();
    const ranges: LaneRange[] = [];
    const none = { bubbles, ranges, size: 0 };
    if (host.mode() !== 'beside') return none;
    if (!host.hasLines(pane, file)) return none;
    for (const draft of this.#drafts) {
      const at = this.#draftAt(draft);
      if (!at || at.end.file !== file || at.end.line === 0) continue;
      const open = this.#shownAt?.key === this.#popKey(at.end);
      const key = at.key ?? '';
      const range = at.from && host.laneRange(pane, file, at.from, at.end);
      if (range) ranges.push({ ...range, key, tone: 'muted' });
      if (pane !== 'inline' && at.end.side !== pane) continue;
      const line = host.docLine(pane, at.end);
      const mark = { words: draft.words, open, shown: draft.shown, key };
      bubbles.set(line, [...(bubbles.get(line) ?? []), mark]);
    }
    return { bubbles, ranges, size: bubbles.size + ranges.length };
  }

  /**
   * File `file`'s own threads, which its header's bubble draws beside lines, with a draft on the
   * file, whose bubble it is where the file has no thread of its own.
   */
  headerThreads(file: number): HeaderThreads | undefined {
    const threads = this.#host.threadsIn(file)?.get('new:0') ?? [];
    const at: PopPlace = { file, side: 'new', line: 0, key: waitKey(file, 'new:0') };
    const draft = markedDraft(threads, this.#draftsAt(at));
    if (threads.length === 0 && !draft) return undefined;
    const open = this.#shownAt?.file === file && this.#shownAt.line === 0;
    return { threads: listed(threads), open, beside: true, draft };
  }

  /**
   * Beside lines, the thread at `at`: of those whose bubble is on its line, the first the popover
   * lists, or else the one with the shortest range over it.
   */
  threadAt(at: At): string | undefined {
    const host = this.#host;
    const drawn = host.threadsIn(at.file);
    const ending = drawn?.get(at.line === 0 ? 'new:0' : `${at.side}:${at.line}`);
    if (ending?.length) return listed(ending)[0]!.id;
    if (at.line === 0) return undefined;
    const pane = host.popPane(at);
    if (!host.hasLines(pane, at.file)) return undefined;
    const line = host.docLine(pane, at);
    let best: { id: string; lines: number } | undefined;
    for (const [key, threads] of drawn ?? []) {
      if (key === 'new:0') continue;
      for (const thread of threads) {
        const from = thread.mark?.from;
        const range = from && host.laneRange(pane, at.file, from, placeOf(thread.at));
        if (!range || line < range.from || line > range.to) continue;
        const lines = range.to - range.from;
        if (!best || lines < best.lines) best = { id: thread.id, lines };
      }
    }
    return best?.id;
  }

  /**
   * Threads change at their places, as `change` puts them: a sent box in the popover is what it
   * sent until the threads at its place change, which bring that, and it goes as they come, in the
   * same drawing. A box being written in sees what comes at its place.
   */
  takeThreads(change: () => void): void {
    const sent = this.#box?.sent ? this.#box : undefined;
    const sentWas = sent && this.#threadsAt(sent.at);
    change();
    if (sent && this.#box === sent) {
      if (!sameVersions(sentWas, this.#threadsAt(sent.at))) this.#dropBox(false);
    }
    // Once it's sent, what comes is its own.
    const writing = this.#box;
    if (writing && !writing.sent && !writing.box.held) writing.seen = this.#threadsAt(writing.at);
  }

  /** What the popover shows changed, as its threads did: drawn again, and placed again. */
  refresh(): void {
    this.#pop?.refresh();
  }

  /**
   * Threads are to show another way: a box open in the popover closes, keeping its draft. Between
   * lines nothing opens the popover, so what it built ahead goes with it.
   */
  switching(mode: ThreadsMode): void {
    this.#pop?.close();
    this.#releaseBox();
    if (mode === 'between') this.#pop?.clear();
  }

  /**
   * Beside lines a thread opens in the popover, which closing it closes, and nothing else. Says
   * whether the view has it.
   */
  openThread(id: string, open: boolean | 'toggle'): boolean {
    const at = this.#popOf(id);
    if (at && open === false && this.#pop?.at?.key === at.key) this.#pop.close();
    return at !== undefined;
  }

  // The threads' popover, beside lines --------------------------------------------------------

  pinThread(id: string, focus = false): boolean {
    const at = this.#host.mode() === 'beside' ? this.#popOf(id) : undefined;
    if (!at || !this.#popLines(at)) return false;
    const pop = this.#popover();
    pop.pin(at);
    if (focus) pop.focus();
    return pop.at?.key === at.key;
  }

  pinned(): readonly string[] {
    const at = this.#pop?.pinned ? this.#pop.at : undefined;
    return at ? this.#poppedThreads(at).map((thread) => thread.id) : [];
  }

  popoverPinned(): boolean {
    return this.#pop?.pinned ?? false;
  }

  closePopover(): boolean {
    if (!this.#pop?.open) return false;
    this.#pop.close();
    return true;
  }

  /** What the popover asks of the view: where its lines are, what it shows, and what it changes. */
  #popHost(): PopHost<PopPlace> {
    const host = this.#host;
    return {
      scroller: host.scroller,
      render: () => this.#render,
      lines: (at) => this.#popLines(at),
      room: () => host.room(),
      view: (at, pinned): PopoverView => {
        const threads = this.#poppedThreads(at);
        const label = bubbleOf(threads, markedDraft(threads, this.#draftsAt(at))).name;
        const popBox = this.#box?.at.key === at.key ? this.#box.box : undefined;
        if (!popBox) return { threads, pinned, label };
        // A box in a thread the popover doesn't show, as one deleted, goes after the rest.
        const inThread = threads.some((thread) => thread.id === popBox.thread);
        const box = inThread ? { thread: popBox.thread, edits: popBox.edits } : {};
        return { threads, pinned, label, box };
      },
      shown: (at) => this.#popShown(at),
      focusLine: (at) => {
        const pane = host.activePane();
        const view = host.viewOf(pane);
        const line = view.state.doc.lineAt(view.state.selection.main.head).number;
        if (this.#onPopLines(at, pane, line)) view.focus();
        else host.focusLine(at);
      },
      scrollBy: (by) => host.scrollBy(by),
      onMark: (event, at) => this.markOf(event)?.at.key === at.key,
      holds: (at) => this.#box?.at.key === at.key && !this.#box.sent,
      release: (at) => {
        if (this.#box?.at.key === at.key) this.#releaseBox();
      },
      drawn: () => this.placeBox(),
      menu: (target, x, y) => this.#popMenu(target, x, y),
    };
  }

  /**
   * A right-click in the popover that the view doesn't hear itself, at `target`: the menu of the
   * thread it's on, or of your comment there, whose Edit and Delete act on it. A comment box is text,
   * which the system's own menu serves. Says whether it opened one.
   */
  #popMenu(target: Element, x: number, y: number): boolean {
    const menu = this.#host.menu;
    if (!menu || target.closest('.lo-diffcomposer')) return false;
    const card = target.closest<HTMLElement>('[data-thread-id]');
    const thread = card?.dataset['threadId'];
    if (!card || thread === undefined) return false;
    const comment = commentIn(card, target);
    menu({ kind: 'thread', thread, ...(comment === undefined ? {} : { comment }) }, x, y);
    return true;
  }

  setDrafts(drafts: readonly DraftMark[]): void {
    const was = this.#drafts;
    this.#drafts = drafts;
    // The same marks, as each time a draft is saved while it's typed: nothing to draw again.
    if (this.#host.mode() !== 'beside' || sameDrafts(was, drafts)) return;
    const files = new Set<number>();
    const heads = new Set<number>();
    for (const each of [...was, ...drafts]) {
      const at = this.#draftAt(each);
      if (!at) continue;
      files.add(at.end.file);
      if (at.end.line === 0) heads.add(at.end.file);
    }
    // A file's own draft's bubble is in its header, which draws the same height with or without.
    this.#host.marksChanged(files, heads);
    // What the popover is called names the draft in it.
    if (this.#pop?.open) this.#pop.refresh();
  }

  openDraft(at: Place | { readonly thread: string }): boolean {
    let place: At | undefined;
    if ('thread' in at) place = this.#popOf(at.thread);
    else {
      const file = this.#host.fileOf(at.file);
      if (file !== undefined) place = { file, ...placeOf(at) };
    }
    const draft = place && this.draftOn(place);
    draft?.open();
    return draft !== undefined;
  }

  /**
   * Beside lines, the draft whose mark is on line `at`, its own or the dot on its thread's: one
   * whose box is closed, one in a thread the popover there shows first, else one open there, whose
   * box it focuses.
   */
  draftOn(at: At): DraftMark | undefined {
    if (this.#host.mode() !== 'beside') return undefined;
    const drafts = this.#draftsAt({ ...at, key: this.#popKey(at) });
    return drafts.find((each) => each.shown !== true) ?? drafts[0];
  }

  /**
   * Where draft `draft` is: the line it ends on, or its file's header, as its thread's if it's in
   * one, and its range's first line, where it's on lines with no thread and more than one of them.
   * Nowhere for a file or a thread the view doesn't have.
   */
  #draftAt(
    draft: DraftMark,
  ): { end: At; from?: { side: Side; line: number }; thread?: string; key?: string } | undefined {
    const { at } = draft;
    if ('thread' in at) {
      const end = this.#host.threadPlace(at.thread);
      return end && { end, thread: at.thread };
    }
    const file = this.#host.fileOf(at.file);
    if (file === undefined) return undefined;
    if ('from' in at) {
      const first = Math.min(at.from, at.to);
      const last = Math.max(at.from, at.to);
      const end = { file, side: at.side, line: last };
      const key = draftKey(file, at.side, first, last);
      return first === last ? { end, key } : { end, from: { side: at.side, line: first }, key };
    }
    const end = { file, ...placeOf(at) };
    return { end, key: draftKey(file, end.side, end.line, end.line) };
  }

  /**
   * The drafts the popover at `at` shows the mark of: those in its threads first, in their order,
   * then those on lines, or its file, ending where it is.
   */
  #draftsAt(at: PopPlace): DraftMark[] {
    const threads = this.#poppedThreads(at).map((thread) => thread.id);
    const inThreads: DraftMark[] = [];
    const ending: DraftMark[] = [];
    for (const draft of this.#drafts) {
      const where = this.#draftAt(draft);
      if (!where) continue;
      if (where.thread !== undefined) {
        if (threads.includes(where.thread)) inThreads.push(draft);
      } else if (this.#popKey(where.end) === at.key) {
        ending.push(draft);
      }
    }
    inThreads.sort((a, b) => threads.indexOf(threadOf(a)) - threads.indexOf(threadOf(b)));
    return [...inThreads, ...ending];
  }

  /** Where the popover of the line thread `id` ends on opens, if the view has the thread. */
  #popOf(id: string): PopPlace | undefined {
    const place = this.#host.threadPlace(id);
    if (!place) return undefined;
    const key = place.line === 0 ? 'new:0' : `${place.side}:${place.line}`;
    return { ...place, key: waitKey(place.file, key) };
  }

  /** The threads the popover at `at` shows, as it lists them. */
  #poppedThreads(at: PopPlace): ThreadView[] {
    const key = at.line === 0 ? 'new:0' : `${at.side}:${at.line}`;
    return listed(this.#host.threadsIn(at.file)?.get(key) ?? []);
  }

  /**
   * The document lines of `pane` the threads of the popover at `at` are on, first to last, from the
   * first line of the longest range: a file's header, for its own.
   */
  #poppedSpan(pane: Pane, at: PopPlace): { from: number; to: number } | undefined {
    const host = this.#host;
    if (!host.hasLines(pane, at.file)) return undefined;
    if (at.line === 0) {
      const header = host.docLine(pane, at);
      return { from: header, to: header };
    }
    let span: { from: number; to: number } | undefined;
    const ranges: { from: { side: Side; line: number }; end: { side: Side; line: number } }[] =
      this.#poppedThreads(at).map((thread) => {
        const end = placeOf(thread.at);
        return { from: thread.mark?.from ?? end, end };
      });
    // A comment box's lines, in it.
    const popBox = this.#box?.at.key === at.key ? this.#box : undefined;
    if (popBox) ranges.push({ from: popBox.from ?? popBox.place, end: popBox.place });
    for (const { from, end } of ranges) {
      const range = host.laneRange(pane, at.file, from, end);
      if (!range) continue;
      span = span
        ? { from: Math.min(span.from, range.from), to: Math.max(span.to, range.to) }
        : { from: range.from, to: range.to };
    }
    return span;
  }

  /** Whether document line `line` of `pane` is one of the popover's lines, or the row beside one. */
  #onPopLines(at: PopPlace, pane: Pane, line: number): boolean {
    if (inSpan(this.#poppedSpan(pane, at), line)) return true;
    const other = this.#host.otherRow(pane, line);
    return other !== undefined && inSpan(this.#poppedSpan(other.pane, at), other.line);
  }

  /**
   * Where the popover at `at`'s lines and lane are drawn, in the scroll's content: none while its
   * file draws no lines.
   */
  #popLines(at: PopPlace): PopLines | undefined {
    const host = this.#host;
    if (!host.drawsLine(at)) return undefined;
    const pane = host.popPane(at);
    const view = host.viewOf(pane);
    const span = this.#poppedSpan(pane, at);
    const lane = view.dom.querySelector('.lo-threadlane')?.getBoundingClientRect();
    if (!span || !lane) return undefined;
    const { scroller } = host;
    const box = scroller.getBoundingClientRect();
    const top = box.top + scroller.clientTop - scroller.scrollTop - view.documentTop;
    const left = box.left + scroller.clientLeft - scroller.scrollLeft;
    const first = rowOf(view.lineBlockAt(view.state.doc.line(span.from).from));
    const last = rowOf(view.lineBlockAt(view.state.doc.line(span.to).from));
    return { first: first.top - top, last: last.bottom - top, lane: lane.left - left };
  }

  /**
   * The popover opened at `at`, moved there, or closed: its marks say so, what it lights changes,
   * and pinned, the cursor goes to its bubble's line unless it's on its lines already.
   */
  #popShown(at: PopPlace | undefined): void {
    const host = this.#host;
    const was = this.#shownAt;
    this.#shownAt = at;
    const files = [was, at].flatMap((each) => (each ? [each.file] : []));
    // A file's own threads' bubble is in its header.
    const heads = new Set([was, at].flatMap((each) => (each?.line === 0 ? [each.file] : [])));
    host.marksChanged(files, heads);
    host.relight();
    if (at && this.#pop?.pinned) this.#cursorOnto(at);
  }

  /** Puts the cursor on the bubble's line of the popover at `at`, unless it's on its lines. */
  #cursorOnto(at: PopPlace): void {
    const host = this.#host;
    const active = host.activePane();
    const view = host.viewOf(active);
    const line = view.state.doc.lineAt(view.state.selection.main.head).number;
    if (this.#onPopLines(at, active, line)) return;
    const pane = host.popPane(at);
    host.putCursor(pane, host.docLine(pane, at));
  }

  /**
   * The cursor came to document line `line` of `pane`, at `at`: a pinned popover whose lines it
   * left closes, and the popover of the line it's on is drawn ahead, to open whole.
   */
  cursorMoved(pane: Pane, line: number, at: At): void {
    const open = this.#pop?.at;
    // One holding a comment box being written stays: only the box closing closes it.
    const holds = open !== undefined && this.#box?.at.key === open.key && !this.#box.sent;
    if (open && this.#pop?.pinned && !holds && !this.#onPopLines(open, pane, line)) {
      this.#pop.close();
    }
    const key = at.line === 0 ? 'new:0' : `${at.side}:${at.line}`;
    const ending = this.#host.threadsIn(at.file)?.get(key);
    if (ending?.length) this.#popover().build({ ...at, key: waitKey(at.file, key) });
  }

  /**
   * Beside lines, the thread mark the pointer `event` is on, a bubble or a cell in the lane: the
   * bubble's thread, or else the one whose stem is nearest the pointer, and where its popover
   * opens.
   */
  markOf(event: Pointed): { at: PopPlace; thread: string } | undefined {
    const host = this.#host;
    const { target } = event;
    if (host.mode() !== 'beside' || !(target instanceof Element)) return undefined;
    if (!host.root.contains(target) || this.#pop?.dom.contains(target)) return undefined;
    // A draft's own bubble is a control of its own, which opens its box again.
    if (target.closest('.lo-bubble[data-draft]') !== null) return undefined;
    let thread = target.closest<HTMLElement>('.lo-bubble[data-beside]')?.dataset.thread;
    if (thread === undefined && besideMarker(target)) {
      // A draft's range opens nothing from the lane: its own bubble opens its box.
      const under = rangeUnder(event, (key) => !isDraftKey(key));
      if (under?.kind === 'threads') thread = under.key;
    }
    const at = thread === undefined ? undefined : this.#popOf(thread);
    return at && thread !== undefined ? { at, thread } : undefined;
  }

  // What lights the view's ranges ---------------------------------------------------------------

  /**
   * What the popover lights while it's pinned: its cards' threads, in its order, or a new
   * comment's box open in it, whose lines count as pinned, with its draft's range.
   */
  pinnedLight(): Lights['pinned'] {
    const pop = this.#pop;
    if (!pop?.pinned || !pop.at) return undefined;
    const box = this.pickedBox();
    if (box) {
      const first = box.from?.line ?? box.place.line;
      const key = draftKey(box.place.file, box.place.side, first, box.place.line);
      return { picked: { lane: 'threads', key } };
    }
    const cards = this.#poppedThreads(pop.at).map((thread): LitRange => ({
      lane: 'threads',
      key: thread.id,
    }));
    return cards.length > 0 ? { cards } : undefined;
  }

  /**
   * The lines range `key` covers, a thread's or a draft's: its file, its first line and its last,
   * as its stem and mark draw them. None for one the view doesn't have, or on a file.
   */
  linesOf(key: string): { file: number; from: { side: Side; line: number }; end: At } | undefined {
    for (const draft of this.#drafts) {
      const at = this.#draftAt(draft);
      if (at?.key === key && at.end.line > 0) {
        return { file: at.end.file, from: at.from ?? at.end, end: at.end };
      }
    }
    const end = this.#host.threadPlace(key);
    if (!end || end.line === 0) return undefined;
    const threads = this.#host.threadsIn(end.file)?.get(`${end.side}:${end.line}`);
    const from = threads?.find((thread) => thread.id === key)?.mark?.from;
    return { file: end.file, from: from ?? end, end };
  }

  /**
   * The lines of the new comment's box open in the popover, being written: its last line, and its
   * first where it's on more than one.
   */
  pickedBox(): { place: At; from: { side: Side; line: number } | undefined } | undefined {
    const box = this.#box;
    if (!box || box.sent || box.box.thread !== undefined || box.place.line === 0) return undefined;
    if (!this.#pop?.pinned || this.#pop.at?.key !== box.at.key) return undefined;
    return { place: box.place, from: box.from };
  }

  /** The thread of the card in the popover the keyboard is on, if focus is in one. */
  focusedCard(): LitRange | undefined {
    const pop = this.#pop;
    const active = pop?.dom.ownerDocument.activeElement;
    if (!pop?.open || !(active instanceof Element) || !pop.dom.contains(active)) return undefined;
    const id = active.closest<HTMLElement>('[data-thread-id]')?.dataset.threadId;
    return id === undefined ? undefined : { lane: 'threads', key: id };
  }

  /**
   * The thread of the popover's card `target` is on, or its first card's where it's in the
   * popover but on none of them; `null` where it isn't in the popover.
   */
  cardUnder(target: Element): LitRange | undefined | null {
    const pop = this.#pop;
    if (!pop?.open || !pop.dom.contains(target)) return null;
    const card =
      target.closest<HTMLElement>('[data-thread-id]') ??
      pop.dom.querySelector<HTMLElement>('[data-thread-id]');
    const id = card?.dataset.threadId;
    return id === undefined ? undefined : { lane: 'threads', key: id };
  }

  /** The pointer came over something, or left the view: a mark it rests on previews its popover. */
  hover(event: PointerEvent): void {
    if (this.#host.mode() !== 'beside') return;
    const at = event.type === 'pointerleave' ? undefined : this.markOf(event)?.at;
    // Off a mark, with no popover made, there's nothing to tell.
    if (at === undefined && !this.#pop) return;
    this.#popover().hover(at);
  }

  /**
   * A click on the mark of the popover at `at` pins it, and takes focus into it, or closes it. A
   * draft there opens in its box again: one in a thread it shows first.
   */
  clicked(at: PopPlace): void {
    const pop = this.#popover();
    if (!pop.clicked(at)) return;
    pop.focus(false);
    this.#draftsAt(at)
      .find((draft) => draft.shown !== true)
      ?.open();
  }

  /**
   * Lands on thread `id`, as `]t` does: its popover is pinned once the jump's scroll is done, focus
   * staying where it was, which in a popover is in the one pinned next.
   */
  land(id: string): void {
    this.pinAfterScroll(id, this.hasFocus());
  }

  /**
   * Pins the popover of the line thread `id` is on once the editor has brought the cursor's line on
   * screen, as it does when it next measures, and lands the line: a jump to it. With `focus`, focus
   * goes into it.
   */
  pinAfterScroll(id: string, focus: boolean): void {
    const asked = ++this.#popping;
    // The frame the editor scrolls in, after it has: its measure is asked for as the cursor moves.
    queueMicrotask(() =>
      requestAnimationFrame(() => {
        if (asked !== this.#popping || this.#host.mode() !== 'beside') return;
        const at = this.#popOf(id);
        if (!at) return;
        const pop = this.#popover();
        pop.pin(at);
        if (focus && pop.at?.key === at.key) pop.focus();
        this.#landLine(at);
      }),
    );
  }

  /** The bubble's line of the popover at `at` takes Land's tint. */
  #landLine(at: PopPlace): void {
    if (at.line === 0) return;
    const pane = this.#host.popPane(at);
    const view = this.#host.viewOf(pane);
    const { node } = view.domAtPos(view.state.doc.line(this.#host.docLine(pane, at)).from);
    const element = node instanceof Element ? node : node.parentElement;
    const line = element?.closest('.cm-line');
    if (line) land(line);
  }

  // Comments ---------------------------------------------------------------------------------

  /**
   * Beside lines, opens a comment box in the popover at its place, pinned, as `compose` says: under
   * the last line it's on, or its file's header, and no line moves. `written` is the thread it's
   * written in, a reply's or an edit's. One open there already with the same key is it, focused.
   */
  compose(
    where: BoxWhere,
    draft: string,
    on: ComposerEvents,
    frame: BoxFrame | undefined,
    options: ComposeOptions,
  ): Composer {
    const host = this.#host;
    const { key, place, from, target, written } = where;
    const focus = options.focus !== false;
    const { kept } = options;
    const pop = this.#popover();
    const was = this.#box;
    if (was && was.key === key && !was.sent) {
      if (focus) {
        pop.pin(was.at);
        was.box.focus();
      }
      return was.box.composer;
    }
    const at: PopPlace = { ...place, key: this.#popKey(place) };
    // A popover open for a new comment's box that this one takes the place of is still open for
    // one.
    const opened =
      written === undefined &&
      (was !== undefined && !was.sent && was.at.key === at.key
        ? was.opened
        : !(pop.pinned && pop.at?.key === at.key));
    const within = pop.hasFocus();
    // One box at a time: the one open closes first, keeping its draft, and what one sent goes.
    this.#releaseBox();
    const box = new CommentBox({
      target,
      thread: written,
      edits: written === undefined ? undefined : options.edits,
      draft,
      on,
      frame,
      nonce: host.nonce,
      hint: options.hint,
      kept,
      escape: (closed) => {
        const keep = closed.text.trim() !== '';
        this.#closeBox(closed, false);
        on.close(keep);
      },
      // Held, as while what it sent is on its way, the box stays, and focus goes to its line.
      leave: (left) => {
        if (left.hasFocus) host.focusLine(place);
      },
      close: (closed, landed) => this.#closeBox(closed, landed ? 'landed' : 'sent'),
      dismiss: (closed) => this.#closeBox(closed, false),
      // Where the box put itself is where things belong: nothing holds the line it left.
      shown: () => host.boxShown(),
    });
    const popBox: PopBox = {
      box,
      key,
      place,
      from,
      at,
      opened,
      within,
      focus: focus ? (kept ? 'shown' : 'end') : false,
      sent: false,
      seen: this.#threadsAt(at),
    };
    this.#box = popBox;
    // The lines `v` selected are the box's now, where the reader opened it.
    if (focus && !kept) endSelection(host.viewOf(host.activePane()));
    // Its line stays shown while the box is open, as a thread's does: one that's folded away, as
    // a draft's can be, comes out of its fold, the line staying where it is.
    host.showLine(place);
    // Opened by the reader, the pane scrolls the least that shows it whole; opened for them, as
    // one opened as it was, nothing on screen moves.
    if (pop.pinned && pop.at?.key === at.key) pop.refresh();
    else pop.pin(at, focus && !kept);
    if (this.#box !== popBox || pop.at?.key !== at.key || !box.dom.isConnected) {
      if (this.#box === popBox) this.#box = undefined;
      box.destroy();
      host.keep(place.file);
      throw new Error('A comment box goes under a line of a file that is shown.');
    }
    // Shown now, it takes focus, as it asked.
    this.placeBox();
    host.marksChanged([place.file], []);
    return box.composer;
  }

  /** The threads drawn at the popover's place `at`: under its line, or its file's header. */
  #threadsAt(at: PopPlace): readonly ThreadView[] | undefined {
    return this.#host.threadsIn(at.file)?.get(splitKey(at.key).key);
  }

  /** The `waitKey` of the line, or the file's header, the popover at `at` is under. */
  #popKey(at: At): string {
    return waitKey(at.file, at.line === 0 ? 'new:0' : `${at.side}:${at.line}`);
  }

  /**
   * Puts the popover's comment box in the slot the caller drew for it, as what it shows is drawn,
   * and focuses it there the first time, as it asked: a reply's in place of its thread's row that
   * offers one, an edit's in place of its comment, and a new comment's after the threads. Until its
   * slot is drawn, it's in the new comment's, where there's one.
   */
  placeBox(): void {
    const popBox = this.#box;
    const pop = this.#pop;
    if (!popBox || !pop || pop.at?.key !== popBox.at.key) return;
    const { box } = popBox;
    const slot = this.#popSlot(pop, box) ?? pop.dom.querySelector<HTMLElement>(`[${NEW_SLOT}]`);
    if (!slot) return;
    if (box.dom.parentElement !== slot) box.attach(slot);
    const { focus } = popBox;
    // Not while the popover is laid out unseen, as it's measured: nothing there takes focus.
    if (focus === false || !box.dom.isConnected || pop.dom.hidden) return;
    if (pop.dom.style.visibility === 'hidden') return;
    popBox.focus = false;
    if (focus === 'shown') box.focusShown();
    else box.focus();
  }

  /** The slot in popover `popover` the caller drew for `box`, if it's drawn. */
  #popSlot(popover: Popover<PopPlace>, box: CommentBox): HTMLElement | undefined {
    const pop = popover.dom;
    if (box.thread === undefined) {
      return pop.querySelector<HTMLElement>(`[${NEW_SLOT}]`) ?? undefined;
    }
    for (const card of pop.querySelectorAll<HTMLElement>('[data-thread-id]')) {
      if (card.dataset.threadId !== box.thread) continue;
      if (box.edits !== undefined) return editSlot(card, box);
      for (const slot of card.querySelectorAll<HTMLElement>(`[${REPLY_SLOT}]`)) {
        if (slot.getAttribute(REPLY_SLOT) === box.thread) return slot;
      }
    }
    return undefined;
  }

  /**
   * Closes the popover's comment box `box`. Closed with nothing sent, it goes now: a new comment's
   * popover that opened for it closes with it, and otherwise it's drawn without the box, as a
   * reply's or an edit's is, its thread still shown. Focus in the box goes back where it came from,
   * into the popover, or to its line. Closed once its comment was sent, it stays as that comment,
   * held, until what was sent comes into the popover in its place (at once, with `landed`, or as
   * it came while the box was held), and focus in it goes to its line. While the popover lets it go
   * as it closes or moves, it goes, and the rest is the popover's.
   */
  #closeBox(box: CommentBox, how: false | 'sent' | 'landed'): void {
    const popBox = this.#box;
    if (popBox?.box !== box) return;
    const document = box.dom.ownerDocument;
    const active = document.activeElement;
    const nowhere = active === null || active === document.body;
    const inBox = box.hasFocus;
    const { place } = popBox;
    if (this.#releasing > 0) {
      this.#box = undefined;
      box.destroy();
      this.#boxDropped(place);
      return;
    }
    if (how !== false) {
      if (inBox) this.#host.focusLine(place);
      // What it sent is there already, as when it came while it was on its way.
      if (how === 'landed' || !sameVersions(popBox.seen, this.#threadsAt(popBox.at))) {
        this.#dropBox();
        return;
      }
      popBox.sent = true;
      this.#waitForInput();
      return;
    }
    const back = inBox || nowhere;
    this.#box = undefined;
    box.destroy();
    this.#boxDropped(place);
    // A box is in the popover, made as the box opened.
    const pop = this.#popover();
    const here = pop.open && pop.at?.key === popBox.at.key;
    if (here && popBox.opened) {
      pop.close(false);
      if (back) this.#host.focusLine(place);
      return;
    }
    if (here) pop.refresh();
    if (!back) return;
    if (popBox.within && pop.open && pop.at?.key === popBox.at.key) {
      const comment = box.edits === undefined ? undefined : this.#popComment(box.edits);
      if (comment) comment.focus({ preventScroll: true });
      else pop.focus(false);
    } else {
      this.#host.focusLine(place);
    }
  }

  /** The comment `id` in the popover, as its card draws it, if it's drawn. */
  #popComment(id: string): HTMLElement | undefined {
    for (const comment of this.#popover().dom.querySelectorAll<HTMLElement>('[data-comment]')) {
      if (comment.dataset.comment === id) return comment;
    }
    return undefined;
  }

  /** The popover's box went, from place `place`: its line is free to fold, and its marks change. */
  #boxDropped(place: At): void {
    this.#sentWait?.();
    this.#host.keep(place.file);
    this.#host.marksChanged([place.file], []);
  }

  /**
   * The comment a sent box in the popover holds goes, as what it sent came in its place, or the
   * reader moved on: the popover is drawn again without it, and closes if it then shows nothing.
   * Unless `redraw` is false, as when the caller draws it again itself.
   */
  #dropBox(redraw = true): void {
    const popBox = this.#box;
    if (!popBox) return;
    this.#box = undefined;
    popBox.box.destroy();
    this.#boxDropped(popBox.place);
    if (redraw) this.#pop?.refresh();
  }

  /**
   * Lets the popover's comment box go, as the popover closes or moves to another line, or another
   * box opens: one being written closes, keeping its draft; what one sent goes. Focus is for what
   * let it go to move.
   */
  #releaseBox(): void {
    const popBox = this.#box;
    if (!popBox) return;
    if (popBox.sent) {
      this.#dropBox();
      return;
    }
    this.#releasing++;
    try {
      popBox.box.composer.leave();
    } finally {
      this.#releasing--;
    }
    // A box that wouldn't leave, as one whose caller kept it, goes all the same.
    if (this.#box === popBox) {
      this.#box = undefined;
      popBox.box.destroy();
      this.#boxDropped(popBox.place);
    }
  }

  /**
   * The reader's next key, press or wheel outside the popover lets go of the comment a sent box in
   * it holds, if what it sent hasn't come in its place by then.
   */
  #waitForInput(): void {
    this.#sentWait?.();
    const page = this.#host.root.ownerDocument;
    const moved = (event: Event): void => {
      const { target } = event;
      if (target instanceof Node && this.#pop?.dom.contains(target)) return;
      if (this.#box?.sent) this.#dropBox();
      else stop();
    };
    const types = [KEY_EVENT, 'pointerdown', 'wheel'] as const;
    const stop = (): void => {
      for (const type of types) page.removeEventListener(type, moved, true);
      if (this.#sentWait === stop) this.#sentWait = undefined;
    };
    for (const type of types) page.addEventListener(type, moved, true);
    this.#sentWait = stop;
  }

  /** Takes it all down: nothing it asked to open later opens, and its box and popover go. */
  destroy(): void {
    this.#popping++;
    this.#sentWait?.();
    this.#unpoint?.();
    this.#box?.box.destroy();
    this.#box = undefined;
    this.#pop?.destroy();
    this.#pop = undefined;
  }
}
