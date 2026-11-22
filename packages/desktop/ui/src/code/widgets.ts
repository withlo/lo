// The blocks the diff view draws between lines: file headers, with notes on files not shown,
// collapsed code and notes in place of lines, threads and the comment boxes in them, overview
// markers' notes, the labels on moved code, and the spacers that keep the two sides lined up. A
// block that starts a row with lines on both sides carries the row's key as `data-row`, as the
// first line of a row does, so the alignment drawn on screen can be checked row by row.

import { WidgetType } from '@codemirror/view';

import { COMMENT_PATH, threadWords } from '../counts.ts';
import { type DrawNote, type FileHeader, viewControls } from './api.ts';
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
  return { ball, tag };
}

/** What a file header shows. */
export interface HeaderInfo {
  path: string;
  previousPath?: string | undefined;
  header: FileHeader;
}

/**
 * What goes under a file's header on one side: the threads on the file, each in the element the
 * caller draws it in, with the boxes written in each after it, and the comment boxes on the file
 * being written, last. Like a line's threads, they're elements that outlive the block, and move
 * into whichever block draws them last.
 */
export interface UnderHeader {
  readonly threads: readonly ThreadHost[];
  readonly boxes: readonly BoxHost[];
  /** Changes when the threads and the boxes must be drawn again, to move them into another editor. */
  readonly drawing: number;
  /** Has the caller draw a thread the first time it's drawn. */
  readonly draw: (thread: ThreadHost) => void;
}

/**
 * A file's header, the same on both sides, with a note under it on why a file with no lines isn't
 * shown, and under that the threads and comment boxes on the file, on the side they're on. Both are
 * part of the header's block, not blocks after it: CodeMirror's decoration cursor can lose a block
 * that sits after another at the same place when a chunk of decorations ends between them, and
 * then draws it where it shouldn't, above the lines it draws.
 */
export class HeaderWidget extends WidgetType {
  readonly file: number;
  readonly info: HeaderInfo;
  readonly note: string | undefined;
  readonly under: UnderHeader | undefined;
  readonly act: boolean;

  /** With `act`, its note is a button, which shows the file's lines. */
  constructor(file: number, info: HeaderInfo, note?: string, under?: UnderHeader, act = false) {
    super();
    this.file = file;
    this.info = info;
    this.note = note;
    this.under = under;
    this.act = act;
  }

  override eq(other: HeaderWidget): boolean {
    return (
      other.file === this.file &&
      other.note === this.note &&
      other.act === this.act &&
      other.info === this.info &&
      sameUnder(other.under, this.under)
    );
  }

  toDOM(): HTMLElement {
    const head = this.#head();
    if (this.note === undefined && !this.under) return head;
    const block = element('div', 'lo-fileblock');
    block.append(head);
    if (this.note !== undefined) {
      const note = fileNote(this.note, this.act);
      note.dataset.row = `n:${this.file}`;
      block.append(note);
    }
    if (this.under) {
      // As under a line: the space around the cards is padding, which the editor measures.
      const threads = element('div', 'lo-diffthread');
      drawUnder(threads, this.under.threads, this.under.boxes, this.under.draw);
      block.append(threads);
    }
    return block;
  }

  #head(): HTMLElement {
    const { header } = this.info;
    const head = element(
      'div',
      `lo-filehead lo-diffhead${header.viewed === 'viewed' ? ' is-viewed' : ''}`,
    );
    head.dataset.row = `h:${this.file}`;
    const path = element('span', 'lo-path');
    if (this.info.previousPath && this.info.previousPath !== this.info.path) {
      path.append(element('span', 'lo-path--old', this.info.previousPath), ' → ');
    }
    const slash = this.info.path.lastIndexOf('/') + 1;
    path.append(this.info.path.slice(0, slash), element('b', '', this.info.path.slice(slash)));
    const stat = element('span', 'lo-stat');
    stat.append(
      element('span', 'add', `+${header.additions}`),
      element('span', 'del', `−${header.deletions}`),
    );
    head.append(path, stat);
    const end = header.tags ?? [];
    const threads = header.threads && header.threads.total > 0 ? header.threads : undefined;
    if (end.length > 0 || threads || header.viewed) {
      const after = element('span', 'lo-filehead__end', end.join(' · '));
      if (threads) after.append(threadCount(threads.total, threads.unresolved));
      if (header.viewed) {
        const { ball, tag } = viewedBall(header.viewed);
        if (tag) after.append(tag);
        after.append(ball);
      }
      head.append(after);
    }
    return head;
  }

  override get estimatedHeight(): number {
    let height = this.note === undefined ? 38 : 66;
    const { under } = this;
    if (under) {
      const parts = under.threads.length + under.boxes.length;
      height += BLOCK_PADDING + Math.max(0, parts - 1) * BLOCK_GAP;
      for (const thread of under.threads) height += thread.estimate;
      height += boxesHeight(under.boxes);
    }
    return height;
  }

  /** The header's own events are the editor's; the threads and the boxes under it handle theirs. */
  override ignoreEvent(event: Event): boolean {
    const { target } = event;
    return target instanceof Element && target.closest('.lo-diffthread') !== null;
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

/** Unchanged lines collapsed into one block, or a whole file that isn't shown yet or at all. */
export class CollapsedWidget extends WidgetType {
  readonly key: string;
  readonly text: string;
  readonly range: string;
  readonly row: string | undefined;

  /** `key` tells blocks apart: equal keys draw the same. `row` is its row's key, if it has one. */
  constructor(key: string, text: string, range = '', row?: string) {
    super();
    this.key = key;
    this.text = text;
    this.range = range;
    this.row = row;
  }

  override eq(other: CollapsedWidget): boolean {
    return other.key === this.key;
  }

  toDOM(): HTMLElement {
    const block = element('div', 'lo-collapsed');
    if (this.row) block.dataset.row = this.row;
    if (this.range) block.append(element('span', 'lo-collapsed__range', this.range));
    block.append(element('span', '', this.text));
    return block;
  }

  override get estimatedHeight(): number {
    return 28;
  }
}

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
    return 26;
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
  /** Puts the box in `parent`, keeping its focus. */
  attach(parent: HTMLElement): void;
}

/**
 * Puts `threads` in `parent`, each drawn the first time it is, and `boxes`: those written in a
 * thread right after it, and the rest last.
 */
function drawUnder(
  parent: HTMLElement,
  threads: readonly ThreadHost[],
  boxes: readonly BoxHost[],
  draw: (thread: ThreadHost) => void,
): void {
  const ids = new Set(threads.map((thread) => thread.id));
  for (const thread of threads) {
    draw(thread);
    parent.append(thread.dom);
    for (const box of boxes) if (box.thread === thread.id) box.attach(parent);
  }
  for (const box of boxes) {
    if (box.thread === undefined || !ids.has(box.thread)) box.attach(parent);
  }
}

/** How tall `boxes` are, or about as tall before they're drawn. */
function boxesHeight(boxes: readonly BoxHost[]): number {
  let height = 0;
  for (const box of boxes) height += box.dom.offsetHeight || 120;
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
  readonly #observer: ResizeObserver;

  constructor(content: HTMLElement) {
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
        if (target.classList.contains('lo-ovnote__text')) {
          if (this.#width > 0 && size.inlineSize > 0) this.#inset = this.#width - size.inlineSize;
        } else if (target.dataset.thread && size.blockSize > 0) {
          this.#drawn.set(`${this.#width}:${target.dataset.thread}`, size.blockSize);
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
    return this.#drawn.get(`${this.#width}:${key}`);
  }

  /** The characters a note's text wraps at: 100 until a note has been drawn. */
  get charsPerLine(): number {
    if (this.#inset === undefined || this.#width === 0) return 100;
    return Math.max(20, Math.floor((this.#width - this.#inset) / charWidth));
  }

  destroy(): void {
    this.#observer.disconnect();
    this.#drawn.clear();
  }
}

/** An overview marker's note, open under the last line the marker covers. */
export interface NoteDraw {
  /** Which marker's it is. */
  readonly key: string;
  /** The overview's block that explains the lines, which "Read it in the overview" names. */
  readonly block: string;
  readonly label: string;
  /** Its text, plain, which sizes it before it's drawn, and which it shows unless `draw` draws it. */
  readonly text: string;
  /** What draws its text in its place, the caller's way. */
  readonly draw?: DrawNote | undefined;
  /** Whether it links back to the overview. */
  readonly link: boolean;
}

/** What takes down the text a caller drew in a note, by the element it drew it in. */
const drawnNotes = new WeakMap<Element, () => void>();

/** The attribute on a note's link that names the overview's block it shows. */
export const NOTE_BLOCK_ATTRIBUTE = 'data-note-block';

/** The room a block of threads, notes and boxes takes around them, and between each. */
const BLOCK_PADDING = 16;
const BLOCK_GAP = 8;

/** What a thread widget needs from a peek it holds: as from a box, and how tall it is. */
export interface PeekHost extends BoxHost {
  readonly height: number;
}

/**
 * What goes under a line: a peek opened there, the notes of the overview markers that end there,
 * the review threads there, each in the element the caller draws it in (`threads.ts`), with the
 * boxes written in each after it, and the comment boxes being written on the line, last. One block
 * a line, for the same reason as a header's note. A peek, threads and boxes are elements that
 * outlive the block, and move into whichever block draws them last.
 */
export class ThreadWidget extends WidgetType {
  readonly id: string;
  readonly threads: readonly ThreadHost[];
  readonly boxes: readonly BoxHost[];
  readonly drawing: number;
  readonly sizes: ThreadSizes;
  readonly notes: readonly NoteDraw[];
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
    notes: readonly NoteDraw[] = [],
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
      other.notes.every((note, index) => sameNote(note, this.notes[index]))
    );
  }

  toDOM(): HTMLElement {
    // The space around the card is padding, not margin: the editor measures a block by its box,
    // which leaves margins out.
    const block = element('div', 'lo-diffthread');
    if (this.#notesOnly) {
      block.dataset.thread = this.#key;
      this.sizes.observe(block);
    }
    // Right under the line, which it's about.
    this.peek?.attach(block);
    for (const note of this.notes) {
      const drawn = noteElement(note);
      block.append(drawn);
      this.sizes.observe(drawn.querySelector('.lo-ovnote__text')!);
    }
    drawUnder(block, this.threads, this.boxes, this.#draw);
    return block;
  }

  override destroy(dom: HTMLElement): void {
    this.sizes.unobserve(dom);
    for (const text of dom.querySelectorAll('.lo-ovnote__text')) {
      this.sizes.unobserve(text);
      drawnNotes.get(text)?.();
      drawnNotes.delete(text);
    }
  }

  /** Whether it holds notes alone, whose size as drawn is kept for drawing them again. */
  get #notesOnly(): boolean {
    return this.threads.length === 0 && this.boxes.length === 0 && !this.peek;
  }

  /** The notes' size as drawn, for drawing them again. */
  get #key(): string {
    const notes = this.notes.map((note) => `${note.key}:${note.text.length}`).join(',');
    return `${this.id}:${notes}`;
  }

  /**
   * Notes alone, as tall as they were last drawn in its editor at this width, if they were. Else
   * the peek as tall as it is, its notes' lines of 21 pixels, at the characters the editor's notes
   * wrap at, between a label and a foot, its threads as tall as each was drawn, or about as tall,
   * and the boxes as they are.
   */
  override get estimatedHeight(): number {
    const drawn = this.#notesOnly ? this.sizes.drawn(this.#key) : undefined;
    if (drawn !== undefined) return drawn;
    let height = BLOCK_PADDING + (this.peek?.height ?? 0);
    const parts = this.notes.length + this.threads.length + this.boxes.length + (this.peek ? 1 : 0);
    height += Math.max(0, parts - 1) * BLOCK_GAP;
    for (const note of this.notes) {
      height += 70 + Math.max(1, Math.ceil(note.text.length / this.sizes.charsPerLine)) * 21;
    }
    for (const thread of this.threads) height += thread.estimate;
    return height + boxesHeight(this.boxes);
  }

  /** The threads and the boxes handle their own events. */
  override ignoreEvent(): boolean {
    return true;
  }
}

function sameNote(a: NoteDraw, b: NoteDraw | undefined): boolean {
  return (
    b !== undefined &&
    a.key === b.key &&
    a.block === b.block &&
    a.label === b.label &&
    a.text === b.text &&
    a.link === b.link
  );
}

/**
 * An overview marker's note: its label, its text, as the caller draws it or else plain, and a foot
 * with the way back to the overview.
 */
function noteElement(note: NoteDraw): HTMLElement {
  const box = element('div', 'lo-ovnote');
  box.setAttribute('role', 'note');
  box.dataset.note = note.key;
  const label = element('div', 'lo-ovnote__label');
  label.append(element('span', 'lo-ov-dot'), note.label ? `Overview · ${note.label}` : 'Overview');
  const foot = element('div', 'lo-ovnote__foot');
  if (note.link) {
    const link = element('button', 'lo-ovnote__read', 'Read it in the overview');
    link.type = 'button';
    link.setAttribute(NOTE_BLOCK_ATTRIBUTE, note.block);
    foot.append(link);
  }
  foot.append(element('span', '', 'Esc closes it'));
  const text = element('div', 'lo-ovnote__text');
  if (note.draw) drawnNotes.set(text, note.draw(text));
  else text.textContent = note.text;
  box.append(label, text, foot);
  return box;
}

/**
 * What's under the header of a file whose lines aren't drawn: a label, or with `act`, a button that
 * shows them, as `za` there does.
 */
function fileNote(text: string, act: boolean): HTMLElement {
  const note = element('div', 'lo-collapsed lo-filenote', text);
  if (!act) return note;
  note.classList.add('is-act');
  note.setAttribute('role', 'button');
  note.dataset.command = viewControls.toggle;
  // Its tooltip names what a click does here, with the command's key.
  note.dataset.tip = text;
  return note;
}

/**
 * A note in place of a file's lines: too many to show, while they load or its diff is worked out,
 * or while it's closed. Where a file has no lines, its header holds the note.
 */
export class FileNoteWidget extends WidgetType {
  readonly file: number;
  readonly text: string;
  readonly paired: boolean;
  readonly act: boolean;

  /**
   * `paired` when both sides draw it, so it's a row to check the alignment of. With `act`, it's a
   * button, which shows the file's lines.
   */
  constructor(file: number, text: string, paired: boolean, act = false) {
    super();
    this.file = file;
    this.text = text;
    this.paired = paired;
    this.act = act;
  }

  override eq(other: FileNoteWidget): boolean {
    return (
      other.file === this.file &&
      other.text === this.text &&
      other.paired === this.paired &&
      other.act === this.act
    );
  }

  toDOM(): HTMLElement {
    const note = fileNote(this.text, this.act);
    if (this.paired) note.dataset.row = `n:${this.file}`;
    return note;
  }

  override get estimatedHeight(): number {
    return 28;
  }
}

/** Empty space that keeps a row's lines level with the other side's. */
export class SpacerWidget extends WidgetType {
  readonly height: number;

  constructor(height: number) {
    super();
    this.height = height;
  }

  override eq(other: SpacerWidget): boolean {
    return other.height === this.height;
  }

  toDOM(): HTMLElement {
    const spacer = element('div', 'lo-spacer');
    spacer.style.height = `${this.height}px`;
    return spacer;
  }

  override updateDOM(dom: HTMLElement): boolean {
    dom.style.height = `${this.height}px`;
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
  count.title = said;
  count.setAttribute('role', 'img');
  count.setAttribute('aria-label', said);
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.setAttribute('class', 'lo-i lo-i--xs');
  icon.setAttribute('viewBox', '0 0 16 16');
  icon.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', COMMENT_PATH);
  icon.append(path);
  count.append(icon, String(total));
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
