// The blocks the diff view draws between lines: file headers, with notes on files not shown,
// collapsed code and notes in place of lines, threads and the comment boxes in them, overview
// markers' notes, the labels on moved code, and the spacers that keep the two sides lined up. A
// block that starts a row with lines on both sides carries the row's key as `data-row`, as the
// first line of a row does, so the alignment drawn on screen can be checked row by row.

import { WidgetType } from '@codemirror/view';

import { COMMENT_PATH, threadWords } from '../counts.ts';
import type { FileHeader } from './api.ts';
import type { ThreadHost } from './threads.ts';

/** How each viewed mark is drawn: a ring, a filled ball, or an amber ring with a dot. */
const BALLS: Record<NonNullable<FileHeader['viewed']>, { className: string; title: string }> = {
  unviewed: { className: '', title: 'Not viewed' },
  viewed: { className: ' is-viewed', title: 'Viewed' },
  stale: { className: ' is-stale', title: 'Changed since you viewed it' },
};

/** What a file header shows. */
export interface HeaderInfo {
  path: string;
  previousPath?: string | undefined;
  header: FileHeader;
}

/**
 * A file's header, the same on both sides, with a note under it on why a file with no lines isn't
 * shown. The note is part of the header's block, not a block after it: CodeMirror's decoration
 * cursor can lose a block that sits after another at the same place when a chunk of decorations
 * ends between them, and then draws it where it shouldn't, above the lines it draws.
 */
export class HeaderWidget extends WidgetType {
  readonly file: number;
  readonly info: HeaderInfo;
  readonly note: string | undefined;

  constructor(file: number, info: HeaderInfo, note?: string) {
    super();
    this.file = file;
    this.info = info;
    this.note = note;
  }

  override eq(other: HeaderWidget): boolean {
    return other.file === this.file && other.note === this.note && other.info === this.info;
  }

  toDOM(): HTMLElement {
    const head = this.#head();
    if (this.note === undefined) return head;
    const block = element('div', 'lo-fileblock');
    const note = element('div', 'lo-collapsed lo-filenote', this.note);
    note.dataset.row = `n:${this.file}`;
    block.append(head, note);
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
        const { className, title } = BALLS[header.viewed];
        const ball = element('span', `lo-diffhead__ball${className}`);
        ball.title = title;
        ball.setAttribute('role', 'img');
        ball.setAttribute('aria-label', title);
        after.append(ball);
      }
      head.append(after);
    }
    return head;
  }

  override get estimatedHeight(): number {
    return this.note === undefined ? 38 : 66;
  }

  override ignoreEvent(): boolean {
    return false;
  }
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

/** The label at each end of moved code, naming where the block went or came from. */
export class MovedLabelWidget extends WidgetType {
  readonly text: string;
  readonly place: string;

  constructor(text: string, place: string) {
    super();
    this.text = text;
    this.place = place;
  }

  override eq(other: MovedLabelWidget): boolean {
    return other.text === this.text && other.place === this.place;
  }

  toDOM(): HTMLElement {
    const label = element('div', 'lo-movedlabel');
    label.append(element('span', '', this.text), element('a', '', this.place));
    return label;
  }

  override get estimatedHeight(): number {
    return 26;
  }
}

/** What a thread widget needs from the comment box it holds. */
export interface BoxHost {
  /** The box's element, which moves into each widget that draws it. */
  readonly dom: HTMLElement;
  /** Puts the box in `parent`, keeping its focus. */
  attach(parent: HTMLElement): void;
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
  readonly text: string;
  /** Whether it links back to the overview. */
  readonly link: boolean;
}

/** The attribute on a note's link that names the overview's block it shows. */
export const NOTE_BLOCK_ATTRIBUTE = 'data-note-block';

/** The room a block of threads, notes and a box takes around them, and between each. */
const BLOCK_PADDING = 16;
const BLOCK_GAP = 8;

/**
 * What goes under a line: the notes of the overview markers that end there, the review threads
 * there, each in the element the caller draws it in (`threads.ts`), and the comment box being
 * written there, if there is one, last. One block a line, for the same reason as a header's note.
 * Threads and the box are elements that outlive the block, and move into whichever block draws
 * them last.
 */
export class ThreadWidget extends WidgetType {
  readonly id: string;
  readonly threads: readonly ThreadHost[];
  readonly box: BoxHost | undefined;
  readonly drawing: number;
  readonly sizes: ThreadSizes;
  readonly notes: readonly NoteDraw[];
  readonly #draw: (thread: ThreadHost) => void;

  /**
   * `draw` has the caller draw a thread the first time it's drawn. `drawing` changes when the
   * threads and the box must be drawn again, to move them into another editor; `sizes` are the
   * editor's.
   */
  constructor(
    id: string,
    threads: readonly ThreadHost[],
    sizes: ThreadSizes,
    draw: (thread: ThreadHost) => void,
    box?: BoxHost,
    drawing = 0,
    notes: readonly NoteDraw[] = [],
  ) {
    super();
    this.id = id;
    this.threads = threads;
    this.sizes = sizes;
    this.#draw = draw;
    this.box = box;
    this.drawing = drawing;
    this.notes = notes;
  }

  override eq(other: ThreadWidget): boolean {
    return (
      other.id === this.id &&
      other.threads.length === this.threads.length &&
      other.threads.every((thread, index) => thread === this.threads[index]) &&
      other.box === this.box &&
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
    for (const note of this.notes) {
      const drawn = noteElement(note);
      block.append(drawn);
      this.sizes.observe(drawn.querySelector('.lo-ovnote__text')!);
    }
    for (const thread of this.threads) {
      this.#draw(thread);
      block.append(thread.dom);
    }
    this.box?.attach(block);
    return block;
  }

  override destroy(dom: HTMLElement): void {
    this.sizes.unobserve(dom);
    for (const text of dom.querySelectorAll('.lo-ovnote__text')) this.sizes.unobserve(text);
  }

  /** Whether it holds notes alone, whose size as drawn is kept for drawing them again. */
  get #notesOnly(): boolean {
    return this.threads.length === 0 && !this.box;
  }

  /** The notes' size as drawn, for drawing them again. */
  get #key(): string {
    const notes = this.notes.map((note) => `${note.key}:${note.text.length}`).join(',');
    return `${this.id}:${notes}`;
  }

  /**
   * Notes alone, as tall as they were last drawn in its editor at this width, if they were. Else
   * its notes' lines of 21 pixels, at the characters the editor's notes wrap at, between a label
   * and a foot, its threads as tall as each was drawn, or about as tall, and the box as it is.
   */
  override get estimatedHeight(): number {
    const drawn = this.#notesOnly ? this.sizes.drawn(this.#key) : undefined;
    if (drawn !== undefined) return drawn;
    let height = BLOCK_PADDING;
    const parts = this.notes.length + this.threads.length + (this.box ? 1 : 0);
    height += Math.max(0, parts - 1) * BLOCK_GAP;
    for (const note of this.notes) {
      height += 70 + Math.max(1, Math.ceil(note.text.length / this.sizes.charsPerLine)) * 21;
    }
    for (const thread of this.threads) height += thread.estimate;
    if (this.box) height += this.box.dom.offsetHeight || 120;
    return height;
  }

  /** The threads and the box handle their own events. */
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
 * An overview marker's note: its label, its text, and a foot with the way back to the overview,
 * all plain text.
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
  box.append(label, element('div', 'lo-ovnote__text', note.text), foot);
  return box;
}

/**
 * A note in place of a file's lines: too many to show, while they load or its diff is worked out,
 * or while it's closed. Where a file has no lines, its header holds the note.
 */
export class FileNoteWidget extends WidgetType {
  readonly file: number;
  readonly text: string;
  readonly paired: boolean;

  /** `paired` when both sides draw it, so it's a row to check the alignment of. */
  constructor(file: number, text: string, paired: boolean) {
    super();
    this.file = file;
    this.text = text;
    this.paired = paired;
  }

  override eq(other: FileNoteWidget): boolean {
    return other.file === this.file && other.text === this.text && other.paired === this.paired;
  }

  toDOM(): HTMLElement {
    const note = element('div', 'lo-collapsed lo-filenote', this.text);
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
