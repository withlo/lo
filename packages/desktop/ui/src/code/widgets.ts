// The blocks the diff view draws between lines: file headers, each one band across both sides,
// with the row under it for what belongs to the file; collapsed code; threads and the comment boxes
// in them; the cards of overview notes; the labels on moved code; and the spacers that keep the two
// sides lined up. Everything that isn't code sits on one flat ground, quieter than the code. A
// block that starts a row with lines on both sides carries the row's key as `data-row`, as the
// first line of a row does, so the alignment drawn on screen can be checked row by row.

import { WidgetType } from '@codemirror/view';

import { threadWords } from '../counts.ts';
import { resizing } from '../drag.ts';
import { EDIT_SLOT, NOTE_TEXT } from '../edits.ts';
import { giveUp } from '../giveUp.ts';
import { glyphNodes, iconElement } from '../iconElement.ts';
import { type FileHeader, viewControls } from './api.ts';
import { type Bubble, bubbleElement, type LaneTone, sameBubble } from './bubbles.ts';
import type { NoteCard } from './notecards.ts';
import type { ThreadHost } from './threads.ts';

/** How each viewed mark is drawn: a ring, a filled ball, or an amber ring with a dot. */
const BALLS: Record<NonNullable<FileHeader['viewed']>, string> = {
  unviewed: '',
  viewed: ' is-viewed',
  stale: ' is-stale',
};

/** What the viewed ball is named: a checkbox, so unchecked it reads "Viewed, not checked". */
export const VIEWED = 'Viewed';
/** What a header says of a file a push changed after it was marked viewed. */
export const CHANGED_SINCE = 'Changed since viewed';
/** What the ball's tooltip says while its file is viewed, in place of its command's label. */
export const UNMARK_VIEWED = 'Unmark viewed';

/**
 * A file's viewed ball: a control, with a checkbox's semantics, drawn as the ball and never as a
 * box. A click runs "Mark viewed" on its file, as `e` does. A file changed since it was viewed
 * isn't viewed, so its ball is unchecked, and `tag`, beside it, says what the amber ring means.
 */
function viewedBall(viewed: NonNullable<FileHeader['viewed']>): {
  ball: HTMLElement;
  tag: HTMLElement | undefined;
} {
  const ball = element('span', `lo-diffhead__ball${BALLS[viewed]}`);
  ball.setAttribute('role', 'checkbox');
  ball.setAttribute('aria-checked', viewed === 'viewed' ? 'true' : 'false');
  ball.setAttribute('aria-label', VIEWED);
  ball.dataset.command = viewControls.viewed;
  if (viewed === 'viewed') ball.dataset.tip = UNMARK_VIEWED;
  if (viewed !== 'stale') return { ball, tag: undefined };
  // The words beside it say why it isn't checked, to a screen reader too.
  const tag = element('span', 'lo-diffhead__changed', CHANGED_SINCE);
  // Part of the header's note: narrow, it's given up from sight, and still heard.
  tag.dataset.gives = 'note';
  return { ball, tag };
}

/** What a file header shows. */
export interface HeaderInfo {
  path: string;
  previousPath?: string | undefined;
  header: FileHeader;
}

/**
 * Which of a header's two groups a column draws. A file's header is one band across both sides:
 * the left column draws its start, the path and the counts, and the right column its end, from the
 * tags to the `⋯`. One column, inline, draws both.
 */
export type HeaderPart = 'start' | 'end' | 'both';

/**
 * The file whose header the keyboard is on, shared by every column's headers and kept by the view:
 * that header's band takes the ring, whichever column the cursor is in. None while the keys aren't
 * the code's, or the cursor is on a line.
 */
export interface HeaderRing {
  file: number | undefined;
}

/** The class that rings the band of the file the keyboard is on. */
export const RING_CLASS = 'is-keyed';

/** The row's key a file's header carries, which the ring and the pinned row find it by. */
export function headerRow(file: number): string {
  return `h:${file}`;
}

/** The letters the file tree marks a change with, and what each is named. */
const LETTERS: Record<NonNullable<FileHeader['change']>, { letter: string; word: string }> = {
  added: { letter: 'A', word: 'Added' },
  deleted: { letter: 'D', word: 'Deleted' },
  modified: { letter: 'M', word: 'Modified' },
  renamed: { letter: 'R', word: 'Renamed' },
  typeChanged: { letter: 'T', word: 'Changed type' },
};

/** What the `⋯` at a header's end is named, with the file's name. */
export function moreLabel(path: string): string {
  return `More actions for ${path.slice(path.lastIndexOf('/') + 1)}`;
}

/**
 * A header's start: the path, the folder in `lo-fg-muted` and the name whole, then its note: a
 * rename's old path and the counts. Narrow, it gives up its note, then its folder (`headerSteps`).
 */
function headerStart(info: HeaderInfo): HTMLElement[] {
  const { header } = info;
  const parts: HTMLElement[] = [];
  const path = element('span', 'lo-path');
  // Its tooltip is the whole path, only while part of it is cut, or given up.
  path.dataset.tip = info.path;
  path.dataset.tipCut = '';
  const slash = info.path.lastIndexOf('/') + 1;
  if (slash > 0) {
    const folder = element('span', 'lo-path__dir', info.path.slice(0, slash));
    folder.dataset.gives = 'folders';
    path.append(folder);
  }
  path.append(element('b', '', info.path.slice(slash)));
  parts.push(path);
  if (info.previousPath && info.previousPath !== info.path) {
    // As the file tree writes it: the new path first, then where it was.
    const was = element('span', 'lo-path__was');
    was.append(...glyphNodes(`← ${info.previousPath}`));
    was.dataset.tip = `Renamed from ${info.previousPath}`;
    was.dataset.gives = 'note';
    parts.push(was);
  }
  if (header.counted !== false) {
    const stat = element('span', 'lo-stat');
    stat.append(
      element('span', 'add', `+${header.additions.toLocaleString('en-US')}`),
      element('span', 'del', `−${header.deletions.toLocaleString('en-US')}`),
    );
    stat.dataset.gives = 'note';
    parts.push(stat);
  }
  return parts;
}

/**
 * A header's end, in this order: its tags, "Changed since viewed", its threads, the tree's letter
 * for its change, its viewed ball and the `⋯` that opens its menu. It never wraps. Its tags and
 * "Changed since viewed" are part of the header's note, which it gives up first; the rest is never
 * cut.
 */
function headerEnd(info: HeaderInfo): HTMLElement {
  const { header } = info;
  const end = element('span', 'lo-filehead__end');
  const tags = header.tags ?? [];
  if (tags.length > 0) {
    // A binary file's sizes read with their arrow drawn as an icon: `1 KB → 2 KB`.
    const said = element('span', 'lo-diffhead__tags');
    said.append(...glyphNodes(tags.join(' · ')));
    said.dataset.gives = 'note';
    end.append(said);
  }
  const threads = header.threads && header.threads.total > 0 ? header.threads : undefined;
  const ball = header.viewed && viewedBall(header.viewed);
  if (ball?.tag) end.append(ball.tag);
  if (threads) end.append(threadCount(threads.total, threads.unresolved));
  if (header.change) {
    const { letter, word } = LETTERS[header.change];
    const mark = element('span', 'lo-diffhead__letter', letter);
    mark.dataset.change = header.change;
    // A mark, not a control: its name is its tooltip and what a screen reader reads.
    mark.setAttribute('role', 'img');
    mark.setAttribute('aria-label', word);
    mark.dataset.tip = word;
    end.append(mark);
  }
  if (ball) end.append(ball.ball);
  const more = element('button', 'lo-diffhead__more');
  more.type = 'button';
  more.tabIndex = -1;
  const label = moreLabel(info.path);
  more.setAttribute('aria-label', label);
  more.setAttribute('aria-haspopup', 'menu');
  more.dataset.tip = label;
  more.append(iconElement('ellipsis', 16));
  end.append(more);
  return end;
}

/**
 * What a header gives up where it's too narrow for all it draws, a step at a time, each step whole
 * (`design/css/code.css`): its note (the counts, a rename's old path, its tags and "Changed since
 * viewed"); then its folder, which is cut short first, keeping `min-w-cut`; and only then is its
 * name cut. The end group, from the threads to the `⋯`, is never cut.
 */
const HEADER_STEPS = ['note', 'folders'] as const;

/**
 * Fits a header to its band, as each is drawn and as its room changes: side by side, the pinned
 * copy's two halves each in its column, as each column's own header is, and otherwise the whole
 * band at once, so an inline header gives up its tags with its counts.
 */
export function fitHeader(head: HTMLElement): void {
  if (!head.isConnected) return;
  const parts = [...head.querySelectorAll<HTMLElement>(':scope > [data-fit]')];
  const halves = head.parentElement?.classList.contains('is-split') === true;
  for (const each of halves ? [head] : parts) each.removeAttribute('data-gave-up');
  for (const each of halves ? parts : [head]) giveUp(each, HEADER_STEPS);
}

/**
 * Every header drawn, fitted again as its band, or a half of it, changes width: one observer for
 * all of them, which a header leaves as it's taken down (`unwatchHeader`).
 */
const resized =
  typeof ResizeObserver === 'undefined'
    ? undefined
    : new ResizeObserver((entries) => {
        const heads = new Set<HTMLElement>();
        for (const { target } of entries) {
          const head = target.closest<HTMLElement>('.lo-diffhead');
          if (head) heads.add(head);
        }
        for (const head of heads) fitHeader(head);
      });

/** Fits `head` from the frame it's first laid out in, and each time its room changes after. */
function watchHeader(head: HTMLElement): void {
  if (!resized) return;
  resized.observe(head);
  // The pinned copy's halves change width with the sides, inside a band that doesn't.
  for (const part of head.querySelectorAll(':scope > [data-fit]')) resized.observe(part);
}

/** Stops fitting a header that's taken down. */
export function unwatchHeader(head: HTMLElement): void {
  if (!resized) return;
  resized.unobserve(head);
  for (const part of head.querySelectorAll(':scope > [data-fit]')) resized.unobserve(part);
}

/**
 * A file's header band, or the part of it one column draws. `pinned` for the copy the view pins
 * under its bar, which takes no row's key, so nothing lines it up or rings it. It fits itself to its
 * band from the frame it's first laid out in (`fitHeader`), until `unwatchHeader`.
 */
export function drawHeader(
  file: number,
  info: HeaderInfo,
  part: HeaderPart,
  pinned = false,
): HTMLElement {
  const { header } = info;
  const head = element('div', `lo-filehead lo-diffhead lo-diffhead--${part}`);
  if (header.viewed === 'viewed') head.classList.add('is-viewed');
  if (header.change === 'deleted') head.classList.add('is-deleted');
  if (!pinned) head.dataset.row = headerRow(file);
  head.dataset.file = String(file);
  // Each half names its file, though only the left draws the path.
  head.dataset.path = info.path;
  // Each group draws what it holds whole, or what it gives up gives way: never cut past its end.
  if (part !== 'end') {
    const start = element('span', 'lo-diffhead__start');
    start.dataset.fit = '';
    start.append(...headerStart(info));
    head.append(start);
  }
  if (part !== 'start') {
    const end = headerEnd(info);
    end.dataset.fit = '';
    head.append(end);
  }
  watchHeader(head);
  return head;
}

/**
 * The row under a file's header, for what belongs to the file and not to a line: a button that
 * shows its lines, a wait, or a label. It's one row across both sides: the left column draws its
 * words, and the right column its ground alone (`quiet`). A `Problem` with the file is the
 * caller's, drawn above it (`HeaderProblem`).
 */
export interface FileRow {
  /** What it says. */
  readonly text: string;
  /** A button that runs `za` on the file, as "Show 5,001 lines" and "Expand file" do. */
  readonly act?: boolean | undefined;
  /** At work: a spinner before its words, and it takes no press. */
  readonly busy?: boolean | undefined;
  /** Its tooltip, where it says more than its words. */
  readonly tip?: string | undefined;
}

/** Whether two rows draw the same. */
function sameRow(a: FileRow | undefined, b: FileRow | undefined): boolean {
  if (!a || !b) return a === b;
  return a.text === b.text && a.act === b.act && a.busy === b.busy && a.tip === b.tip;
}

/** The row's height, as the design has it: a button, a wait or a label. */
const ROW_HEIGHT = 24;
/** About how tall a `Problem` is with a reason, until it's drawn. */
const PROBLEM_HEIGHT = 70;

/**
 * The row under file `file`'s header. `quiet` draws its ground alone, the right column's half of
 * it, which a click acts on as the left's does.
 */
function drawRow(file: number, row: FileRow, quiet: boolean): HTMLElement {
  const drawn = element('div', `lo-filerow${quiet ? ' is-quiet' : ''}`);
  drawn.dataset.row = `n:${file}`;
  if (row.busy) {
    drawn.classList.add('is-busy');
    drawn.setAttribute('aria-busy', 'true');
    if (!quiet) drawn.append(element('span', 'inline-block spinner size-12'));
  } else if (row.act) {
    // The whole row is the button, across both sides; a click runs `za` there.
    drawn.classList.add('is-act');
    drawn.setAttribute('role', 'button');
    drawn.dataset.command = viewControls.toggle;
    drawn.dataset.tip = row.text;
  } else if (row.tip !== undefined) {
    drawn.dataset.tip = row.tip;
  }
  if (quiet) drawn.setAttribute('aria-hidden', 'true');
  else drawn.append(element('span', 'lo-filerow__words', row.text));
  return drawn;
}

/** The threads and comment boxes on a file, drawn under its header on the side they're on. */
export interface UnderHeader {
  readonly threads: readonly ThreadHost[];
  readonly boxes: readonly BoxHost[];
  /** Changes when the threads and the boxes must be drawn again, to move them into another editor. */
  readonly drawing: number;
  /** Has the caller draw a thread the first time it's drawn. */
  readonly draw: (thread: ThreadHost) => void;
}

/**
 * A file's `Problem` as its header draws it: the element the caller drew it in, which outlives the
 * block, and `drawing`, which changes when it must be drawn again, to move it into the editor
 * showing.
 */
export interface HeaderProblem {
  readonly dom: HTMLElement;
  readonly drawing: number;
}

/**
 * The bubble of a file's own threads, which its header draws in the threads' lane, over the band
 * there, and whether its thread is drawn open.
 */
export interface FileBubble {
  readonly bubble: Bubble;
  readonly open: boolean;
  /** Whether threads show beside lines, where it opens the threads' popover. */
  readonly beside?: boolean | undefined;
  /** The colour it was drawn in last, where that's changed: it tints from it, the first time. */
  readonly was?: LaneTone | undefined;
}

/**
 * A file's header, or the part of it its column draws, with the row under it where the file has
 * no lines on this side to put it in place of, and under that the threads and comment boxes on the
 * file, on the side they're on. A `Problem` with the file comes first under the header, in the
 * element the caller drew it in, which moves into whichever block draws it last. Each is part of
 * the header's block, not a block after it: CodeMirror's decoration cursor can lose a block that
 * sits after another at the same place when a chunk of decorations ends between them, and then
 * draws it where it shouldn't, above the lines it draws. The column that draws the path draws the
 * bubble of the file's threads, in the lane its band covers.
 */
export class HeaderWidget extends WidgetType {
  readonly file: number;
  readonly info: HeaderInfo;
  readonly part: HeaderPart;
  readonly row: FileRow | undefined;
  readonly under: UnderHeader | undefined;
  readonly ring: HeaderRing;
  readonly problem: HeaderProblem | undefined;
  readonly bubble: FileBubble | undefined;
  /** Whether its bubble tints from the colour it had, which it does the first time it's drawn. */
  #tinting = true;

  constructor(
    file: number,
    info: HeaderInfo,
    part: HeaderPart,
    ring: HeaderRing,
    row?: FileRow,
    under?: UnderHeader,
    problem?: HeaderProblem,
    bubble?: FileBubble,
  ) {
    super();
    this.file = file;
    this.info = info;
    this.part = part;
    this.ring = ring;
    this.row = row;
    this.under = under;
    this.problem = problem;
    this.bubble = bubble;
  }

  override eq(other: HeaderWidget): boolean {
    return (
      other.file === this.file &&
      other.part === this.part &&
      other.info === this.info &&
      other.ring === this.ring &&
      other.problem?.dom === this.problem?.dom &&
      other.problem?.drawing === this.problem?.drawing &&
      sameRow(other.row, this.row) &&
      sameUnder(other.under, this.under) &&
      sameBubble(other.bubble?.bubble, this.bubble?.bubble) &&
      other.bubble?.open === this.bubble?.open &&
      other.bubble?.beside === this.bubble?.beside
    );
  }

  toDOM(): HTMLElement {
    const head = drawHeader(this.file, this.info, this.part);
    if (this.ring.file === this.file) head.classList.add(RING_CLASS);
    const { bubble } = this;
    if (bubble) {
      const control = bubbleElement(bubble.bubble, {
        open: bubble.open,
        className: 'lo-diffhead__bubble',
        was: this.#tinting ? bubble.was : undefined,
        beside: bubble.beside,
      });
      this.#tinting = false;
      // A press on it leaves the cursor and focus where they are; its click is the view's.
      control.addEventListener('mousedown', (event) => event.preventDefault());
      head.append(control);
    }
    const { problem } = this;
    const row = this.row && drawRow(this.file, this.row, this.part === 'end');
    if (!problem && !row && !this.under) return head;
    const block = element('div', 'lo-fileblock');
    block.append(head);
    if (problem) block.append(problem.dom);
    if (row) block.append(row);
    if (this.under) {
      // As under a line: the space around the cards is padding, which the editor measures.
      const threads = element('div', 'lo-diffthread');
      drawUnder(threads, this.under.threads, this.under.boxes, this.under.draw);
      block.append(threads);
    }
    return block;
  }

  /** Its header stops fitting itself as it's taken down. */
  override destroy(dom: HTMLElement): void {
    const head = dom.matches('.lo-diffhead')
      ? dom
      : dom.querySelector<HTMLElement>(':scope > .lo-diffhead');
    if (head) unwatchHeader(head);
  }

  override get estimatedHeight(): number {
    let height = 38;
    const { problem } = this;
    // As tall as it was last drawn, or about as tall as one with a reason.
    if (problem) height += problem.dom.offsetHeight || PROBLEM_HEIGHT;
    if (this.row) height += ROW_HEIGHT;
    const { under } = this;
    if (under) {
      const parts = under.threads.length + under.boxes.length;
      height += BLOCK_PADDING + Math.max(0, parts - 1) * BLOCK_GAP;
      for (const thread of under.threads) height += thread.estimate;
      height += boxesHeight(under.boxes, under.threads);
    }
    return height;
  }

  /**
   * The header's own events are the editor's; the `Problem`, the threads and the boxes under it,
   * and the bubble of the file's threads, handle theirs.
   */
  override ignoreEvent(event: Event): boolean {
    const { target } = event;
    return (
      target instanceof Element &&
      target.closest('.lo-diffthread, .lo-fileproblem, .lo-diffhead__bubble') !== null
    );
  }
}

/** Whether two headers draw the same threads and boxes under them. */
function sameUnder(a: UnderHeader | undefined, b: UnderHeader | undefined): boolean {
  if (!a || !b) return a === b;
  return (
    sameBoxes(a.boxes, b.boxes) &&
    a.drawing === b.drawing &&
    a.threads.length === b.threads.length &&
    a.threads.every((thread, index) => thread === b.threads[index])
  );
}

/**
 * Unchanged lines collapsed into one row on both sides: its words in the left column, "18
 * unchanged lines", and its ground alone in the right (`quiet`). A click shows them, as `zo` does.
 * Lines the view has only as placeholders, as GitHub's diff leaves out between its hunks, are
 * dimmed, with the reason as the tooltip: nothing can show them until the whole file comes.
 */
export class CollapsedWidget extends WidgetType {
  readonly key: string;
  readonly text: string;
  readonly row: string | undefined;
  readonly quiet: boolean;
  readonly missing: boolean;

  /**
   * `key` tells blocks apart: equal keys draw the same. `row` is its row's key, if it has one.
   * `missing` lines are placeholders; `quiet` draws the ground alone.
   */
  constructor(key: string, text: string, row?: string, quiet = false, missing = false) {
    super();
    this.key = key;
    this.text = text;
    this.row = row;
    this.quiet = quiet;
    this.missing = missing;
  }

  override eq(other: CollapsedWidget): boolean {
    return other.key === this.key && other.quiet === this.quiet && other.text === this.text;
  }

  toDOM(): HTMLElement {
    const block = element('div', `lo-collapsed${this.quiet ? ' is-quiet' : ''}`);
    if (this.row) block.dataset.row = this.row;
    if (this.missing) {
      block.classList.add('is-missing');
      block.dataset.tip = NOT_IN_DIFF;
    } else {
      block.dataset.command = viewControls.open;
    }
    if (this.quiet) block.setAttribute('aria-hidden', 'true');
    else block.append(element('span', '', this.text));
    return block;
  }

  override get estimatedHeight(): number {
    return 20;
  }
}

/** Why lines a fold holds can't be shown: GitHub's diff left them out. */
export const NOT_IN_DIFF = 'Not in GitHub’s diff';

/**
 * The attribute on a moved label's button that names the line at the other end: the file's index
 * in the view, its side and the line, as `0:new:12`.
 */
export const MOVED_ATTRIBUTE = 'data-moved-to';

/** The other end of moved code, by the file's index in the view. */
export interface MovedTo {
  file: number;
  side: 'old' | 'new';
  line: number;
}

/** The other end a moved label's button names, from its attribute. */
export function movedTo(written: string | null): MovedTo | undefined {
  const [file, side, line] = (written ?? '').split(':');
  if (side !== 'old' && side !== 'new') return undefined;
  return { file: Number(file), side, line: Number(line) };
}

/**
 * The label at each end of moved code, naming where the block went or came from, on a button that
 * goes there.
 */
export class MovedLabelWidget extends WidgetType {
  readonly text: string;
  readonly place: string;
  readonly to: MovedTo;

  constructor(text: string, place: string, to: MovedTo) {
    super();
    this.text = text;
    this.place = place;
    this.to = to;
  }

  override eq(other: MovedLabelWidget): boolean {
    return (
      other.text === this.text &&
      other.place === this.place &&
      other.to.file === this.to.file &&
      other.to.side === this.to.side &&
      other.to.line === this.to.line
    );
  }

  toDOM(): HTMLElement {
    const label = element('div', 'lo-movedlabel');
    const button = element('button', 'lo-movedlabel__to', this.place);
    button.type = 'button';
    // Named as the label reads: "Moved from src/text/wrap.ts:1". `gm` is the way there by key.
    button.setAttribute('aria-label', `${this.text} ${this.place}`);
    button.tabIndex = -1;
    const { file, side, line } = this.to;
    button.setAttribute(MOVED_ATTRIBUTE, `${file}:${side}:${line}`);
    label.append(element('span', '', this.text), button);
    return label;
  }

  override get estimatedHeight(): number {
    return 20;
  }
}

/** What a thread widget needs from a comment box it holds. */
export interface BoxHost {
  /** The box's element, which moves into each widget that draws it. */
  readonly dom: HTMLElement;
  /**
   * The thread it's written in, as a reply's box is, by its id: it's drawn right after that
   * thread. Nothing for a box on the line or the file, which is drawn after every thread there.
   */
  readonly thread?: string | undefined;
  /**
   * The comment of the thread it edits, by its id: it's drawn in the comment's place in the
   * thread's card, which leaves the comment out while it's edited and draws an empty slot there.
   */
  readonly edits?: string | undefined;
  /** Puts the box in `parent`, keeping its focus. */
  attach(parent: HTMLElement): void;
}

/**
 * Where the box editing a comment goes in `thread`'s card: the slot drawn in the comment's place,
 * once the card has drawn it.
 */
export function editSlot(thread: HTMLElement, box: BoxHost): HTMLElement | undefined {
  if (box.edits === undefined) return undefined;
  for (const slot of thread.querySelectorAll<HTMLElement>(`[${EDIT_SLOT}]`)) {
    if (slot.getAttribute(EDIT_SLOT) === box.edits) return slot;
  }
  return undefined;
}

/**
 * Puts `threads` in `parent`, each drawn the first time it is, and `boxes`: one editing a comment
 * in the comment's place in its thread's card, once the card has drawn the slot for it; the rest
 * written in a thread right after it; and the others last.
 */
function drawUnder(
  parent: HTMLElement,
  threads: readonly ThreadHost[],
  boxes: readonly BoxHost[],
  draw: (thread: ThreadHost) => void,
  notes: readonly NoteCard[] = [],
): void {
  const ids = new Set(threads.map((thread) => thread.id));
  for (const thread of threads) {
    draw(thread);
    parent.append(thread.dom);
    for (const box of boxes) {
      if (box.thread !== thread.id) continue;
      box.attach(editSlot(thread.dom, box) ?? parent);
    }
  }
  for (const note of notes) parent.append(note.dom);
  for (const box of boxes) {
    if (box.thread === undefined || !ids.has(box.thread)) box.attach(parent);
  }
}

/**
 * How tall `boxes` are, or about as tall before they're drawn. One editing a comment of one of
 * `threads` is in its card, which the thread's own height takes in.
 */
function boxesHeight(boxes: readonly BoxHost[], threads: readonly ThreadHost[] = []): number {
  let height = 0;
  for (const box of boxes) {
    if (box.edits !== undefined && threads.some((thread) => thread.id === box.thread)) continue;
    height += box.dom.offsetHeight || 120;
  }
  return height;
}

function sameBoxes(a: readonly BoxHost[], b: readonly BoxHost[]): boolean {
  return a.length === b.length && a.every((box, index) => box === b[index]);
}

/** The average width of a character of the notes' face, in pixels. */
const charWidth = 6.05;

/**
 * What one editor's notes' heights are worked out from before they're drawn: the heights blocks of
 * notes alone were drawn at, at the width they were drawn at, and how much narrower than the
 * editor's content a note's text is, for the characters it wraps at. Estimates that are off move
 * what's drawn when CodeMirror measures, which a far jump can't settle in one measure. Threads keep
 * their own heights (`threads.ts`).
 */
export class ThreadSizes {
  /** The width of the editor's content, in whole pixels; 0 before it's been seen. */
  #width = 0;
  /** How much narrower than the content a note's text is, once one has been drawn. */
  #inset: number | undefined;
  /** The heights blocks were drawn at, by the width and the block. */
  readonly #drawn = new Map<string, number>();
  /**
   * While an edge is dragged, each block's latest height and the width it was drawn at, kept in
   * `#drawn` once the drag is over: the widths it passes through aren't kept.
   */
  readonly #passing = new Map<string, { width: number; height: number }>();
  readonly #document: Document;
  readonly #observer: ResizeObserver;

  constructor(content: HTMLElement) {
    this.#document = content.ownerDocument;
    this.#observer = new ResizeObserver((entries) => {
      // The content's width first, which the others' sizes are kept by.
      for (const entry of entries) {
        const size = entry.borderBoxSize[0];
        if (size && entry.target === content) this.#width = Math.round(size.inlineSize);
      }
      for (const entry of entries) {
        const { target } = entry;
        const size = entry.borderBoxSize[0];
        if (!size || target === content || !(target instanceof HTMLElement)) continue;
        const key = target.dataset.thread ?? target.dataset.sized;
        if (target.hasAttribute(NOTE_TEXT)) {
          if (this.#width > 0 && size.inlineSize > 0) this.#inset = this.#width - size.inlineSize;
        } else if (key && size.blockSize > 0) {
          if (resizing(this.#document)) {
            this.#passing.set(key, { width: this.#width, height: size.blockSize });
          } else {
            this.#settle();
            this.#drawn.set(`${this.#width}:${key}`, size.blockSize);
          }
        }
      }
    });
    this.#observer.observe(content);
  }

  observe(target: Element): void {
    this.#observer.observe(target);
  }

  unobserve(target: Element): void {
    this.#observer.unobserve(target);
  }

  /** The height the block `key` was drawn at, at the content's width now, if it was. */
  drawn(key: string): number | undefined {
    if (resizing(this.#document)) {
      const passing = this.#passing.get(key);
      if (passing?.width === this.#width) return passing.height;
    } else {
      this.#settle();
    }
    return this.#drawn.get(`${this.#width}:${key}`);
  }

  /** Keeps what a drag that's over left each block at: the width it ended at. */
  #settle(): void {
    for (const [key, { width, height }] of this.#passing)
      this.#drawn.set(`${width}:${key}`, height);
    this.#passing.clear();
  }

  /** The characters a note's text wraps at: 100 until a note has been drawn. */
  get charsPerLine(): number {
    if (this.#inset === undefined || this.#width === 0) return 100;
    return Math.max(20, Math.floor((this.#width - this.#inset) / charWidth));
  }

  destroy(): void {
    this.#observer.disconnect();
    this.#drawn.clear();
    this.#passing.clear();
  }
}

/** The room a block of threads, notes and boxes takes around them, and between each. */
const BLOCK_PADDING = 16;
const BLOCK_GAP = 8;

/** What a thread widget needs from a peek it holds: as from a box, and how tall it is. */
export interface PeekHost extends BoxHost {
  readonly height: number;
}

/**
 * What goes under a line: a peek opened there, the review threads there, each in the element the
 * caller draws it in (`threads.ts`), with the boxes written in each after it, then the cards of the
 * overview notes open that end there (`notecards.ts`), and the comment boxes being written on the
 * line, last. One block a line, for the same reason as a header's note. A peek, threads, notes and
 * boxes are elements that outlive the block, and move into whichever block draws them last.
 */
export class ThreadWidget extends WidgetType {
  readonly id: string;
  readonly threads: readonly ThreadHost[];
  readonly boxes: readonly BoxHost[];
  readonly drawing: number;
  readonly sizes: ThreadSizes;
  readonly notes: readonly NoteCard[];
  readonly peek: PeekHost | undefined;
  readonly #draw: (thread: ThreadHost) => void;

  /**
   * `draw` has the caller draw a thread the first time it's drawn. `drawing` changes when the
   * threads, the boxes and the peek must be drawn again, to move them into another editor; `sizes`
   * are the editor's.
   */
  constructor(
    id: string,
    threads: readonly ThreadHost[],
    sizes: ThreadSizes,
    draw: (thread: ThreadHost) => void,
    boxes: readonly BoxHost[] = [],
    drawing = 0,
    notes: readonly NoteCard[] = [],
    peek?: PeekHost,
  ) {
    super();
    this.id = id;
    this.threads = threads;
    this.sizes = sizes;
    this.#draw = draw;
    this.boxes = boxes;
    this.drawing = drawing;
    this.notes = notes;
    this.peek = peek;
  }

  override eq(other: ThreadWidget): boolean {
    return (
      other.id === this.id &&
      other.peek === this.peek &&
      other.threads.length === this.threads.length &&
      other.threads.every((thread, index) => thread === this.threads[index]) &&
      sameBoxes(other.boxes, this.boxes) &&
      other.drawing === this.drawing &&
      other.sizes === this.sizes &&
      other.notes.length === this.notes.length &&
      other.notes.every((note, index) => note === this.notes[index])
    );
  }

  toDOM(): HTMLElement {
    // The space around the card is padding, not margin: the editor measures a block by its box,
    // which leaves margins out.
    const block = element('div', 'lo-diffthread');
    // Right under the line, which it's about.
    this.peek?.attach(block);
    drawUnder(block, this.threads, this.boxes, this.#draw, this.notes);
    // Each card's height, as drawn at the editor's width, and what its words wrap at.
    for (const note of this.notes) note.watch(this.sizes);
    return block;
  }

  override destroy(dom: HTMLElement): void {
    // A card that's moved into another block is that block's to watch.
    for (const note of this.notes) {
      const parent = note.dom.parentElement;
      if (parent === null || parent === dom) note.unwatch();
    }
  }

  /**
   * The peek as tall as it is, its threads and its notes' cards as tall as each was drawn at the
   * editor's width, or about as tall, a card's words in lines of 21 pixels at the characters the
   * editor's notes wrap at, and the boxes as they are.
   */
  override get estimatedHeight(): number {
    let height = BLOCK_PADDING + (this.peek?.height ?? 0);
    const parts = this.notes.length + this.threads.length + this.boxes.length + (this.peek ? 1 : 0);
    height += Math.max(0, parts - 1) * BLOCK_GAP;
    for (const note of this.notes) {
      height += this.sizes.drawn(note.sizeKey) ?? note.guess(this.sizes.charsPerLine);
    }
    for (const thread of this.threads) height += thread.estimate;
    return height + boxesHeight(this.boxes, this.threads);
  }

  /** The threads and the boxes handle their own events. */
  override ignoreEvent(): boolean {
    return true;
  }
}

/**
 * The row under a file's header in place of its lines: too many to show, while they're read or
 * compared, or while the file is closed. Where a side has none of the file's lines, its header
 * holds the row. `quiet` draws its ground alone, the right column's half of it.
 */
export class FileNoteWidget extends WidgetType {
  readonly file: number;
  readonly row: FileRow;
  readonly quiet: boolean;
  readonly paired: boolean;

  /** `paired` when both sides draw it, so it's a row to check the alignment of. */
  constructor(file: number, row: FileRow, quiet: boolean, paired: boolean) {
    super();
    this.file = file;
    this.row = row;
    this.quiet = quiet;
    this.paired = paired;
  }

  override eq(other: FileNoteWidget): boolean {
    return (
      other.file === this.file &&
      other.quiet === this.quiet &&
      other.paired === this.paired &&
      sameRow(other.row, this.row)
    );
  }

  toDOM(): HTMLElement {
    const drawn = drawRow(this.file, this.row, this.quiet);
    if (!this.paired) delete drawn.dataset.row;
    return drawn;
  }

  override get estimatedHeight(): number {
    return ROW_HEIGHT;
  }
}

/** The tallest run of empty space that keeps its hatch: three lines. */
export const HATCHED = 60;

/**
 * How empty space is drawn: flat on the diff's ground, hatched where it's a short gap beside
 * lines, or `under` a file's header, where it's the right column's half of the row there and its
 * ground reaches through the gutter as the row's does.
 */
export type SpacerLook = 'flat' | 'hatched' | 'under';

/** Empty space that keeps a row's lines level with the other side's. */
export class SpacerWidget extends WidgetType {
  readonly height: number;
  readonly look: SpacerLook;

  constructor(height: number, look: SpacerLook = 'flat') {
    super();
    this.height = height;
    this.look = look;
  }

  override eq(other: SpacerWidget): boolean {
    return other.height === this.height && other.look === this.look;
  }

  toDOM(): HTMLElement {
    const spacer = element('div', 'lo-spacer');
    this.updateDOM(spacer);
    return spacer;
  }

  override updateDOM(dom: HTMLElement): boolean {
    dom.style.height = `${this.height}px`;
    dom.classList.toggle('is-hatched', this.look === 'hatched');
    dom.classList.toggle('is-under', this.look === 'under');
    return true;
  }

  override get estimatedHeight(): number {
    return this.height;
  }
}

/**
 * A hint inside a line, as a language server's type of a name: a space apart from the code before
 * it, or after it, where it says.
 */
export class HintWidget extends WidgetType {
  readonly label: string;
  readonly before: boolean;
  readonly after: boolean;

  constructor(label: string, before: boolean, after: boolean) {
    super();
    this.label = label;
    this.before = before;
    this.after = after;
  }

  override eq(other: HintWidget): boolean {
    return other.label === this.label && other.before === this.before && other.after === this.after;
  }

  toDOM(): HTMLElement {
    const padding = `${this.before ? ' lo-inlay--before' : ''}${this.after ? ' lo-inlay--after' : ''}`;
    return element('span', `lo-inlay${padding}`, this.label);
  }
}

/** What the marker says on a line where someone else's new thread waits. */
export const NEW_THREAD = 'New thread';
/** What a click on the marker does, as its name and its tooltip. */
export const SHOW_NEW_THREAD = 'Show new thread';

/**
 * Someone else's new thread on a line on screen, which waits there so nothing moves under the
 * reader: the line says so at its end, over the code, taking no room. It's a button, named for
 * what pressing it does: a click or a key, as any input of the reader's, lets what waits in, and
 * the view puts the cursor on its line as it goes.
 */
export class ArrivedWidget extends WidgetType {
  override eq(): boolean {
    return true;
  }

  toDOM(): HTMLElement {
    const marker = element('button', 'lo-arrived', NEW_THREAD);
    marker.type = 'button';
    marker.setAttribute('aria-label', SHOW_NEW_THREAD);
    marker.dataset.tip = SHOW_NEW_THREAD;
    return marker;
  }
}

/** A file's threads as the file tree counts them: a comment mark and their number. */
function threadCount(total: number, unresolved: number): HTMLElement {
  const said = threadWords(total, unresolved);
  const count = element('span', `lo-count lo-num${unresolved > 0 ? ' is-open' : ''}`);
  // A mark, not a control: its name is its tooltip and what a screen reader reads.
  count.dataset.tip = said;
  count.setAttribute('role', 'img');
  count.setAttribute('aria-label', said);
  count.append(iconElement('message-square', 12), String(total));
  return count;
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
