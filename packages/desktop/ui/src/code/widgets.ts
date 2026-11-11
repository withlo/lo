// The blocks the diff view draws between lines: file headers, with notes on files not shown,
// collapsed code and notes in place of lines, threads and the comment boxes in them, the labels on
// moved code, and the spacers that keep the two sides lined up. A block that starts a row with
// lines on both sides carries the row's key as `data-row`, as the first line of a row does, so the
// alignment drawn on screen can be checked row by row.

import { WidgetType } from '@codemirror/view';

import type { FileHeader, ThreadComment } from './api.ts';

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
    const head = element('div', `lo-filehead lo-diffhead${header.viewed ? ' is-viewed' : ''}`);
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
    const end = [
      ...(header.tags ?? []),
      ...(header.comments ? [`${header.comments} comment${header.comments === 1 ? '' : 's'}`] : []),
    ];
    if (end.length > 0) head.append(element('span', 'lo-filehead__end', end.join(' · ')));
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

/** The average width of a character of the comments' face, in pixels. */
const charWidth = 6.05;

/**
 * What one editor's threads' heights are worked out from before they're drawn: the heights its
 * threads were drawn at, at the width they were drawn at, and how much narrower than the editor's
 * content a comment's text is, for the characters it wraps at. Estimates that are off move what's
 * drawn when CodeMirror measures, which a far jump to a thread can't settle in one measure.
 */
export class ThreadSizes {
  /** The width of the editor's content, in whole pixels; 0 before it's been seen. */
  #width = 0;
  /** How much narrower than the content a comment's text is, once one has been drawn. */
  #inset: number | undefined;
  /** The heights threads were drawn at, by the width and the thread. */
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
        if (target.classList.contains('lo-diffthread__body')) {
          if (this.#width > 0) this.#inset = this.#width - size.inlineSize;
        } else if (target.dataset.thread) {
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

  /** The height the thread `key` was drawn at, at the content's width now, if it was. */
  drawn(key: string): number | undefined {
    return this.#drawn.get(`${this.#width}:${key}`);
  }

  /** The characters a comment's text wraps at: 100 until a thread has been drawn. */
  get charsPerLine(): number {
    if (this.#inset === undefined || this.#width === 0) return 100;
    return Math.max(20, Math.floor((this.#width - this.#inset) / charWidth));
  }

  destroy(): void {
    this.#observer.disconnect();
    this.#drawn.clear();
  }
}

/** A thread as a thread widget draws it. */
export interface ThreadDraw {
  readonly id: string;
  readonly comments: readonly ThreadComment[];
}

/**
 * The review threads under a line, each a card, and the comment box being written there, if there
 * is one, in the last: one block a line, for the same reason as a header's note.
 */
export class ThreadWidget extends WidgetType {
  readonly id: string;
  readonly threads: readonly ThreadDraw[];
  readonly box: BoxHost | undefined;
  readonly drawing: number;
  readonly sizes: ThreadSizes;

  /**
   * `drawing` changes when the box must be drawn again, to move it into another editor; `sizes`
   * are the editor's.
   */
  constructor(
    id: string,
    threads: readonly ThreadDraw[],
    sizes: ThreadSizes,
    box?: BoxHost,
    drawing = 0,
  ) {
    super();
    this.id = id;
    this.threads = threads;
    this.sizes = sizes;
    this.box = box;
    this.drawing = drawing;
  }

  override eq(other: ThreadWidget): boolean {
    return (
      other.id === this.id &&
      other.threads.length === this.threads.length &&
      other.threads.every(
        (thread, index) =>
          thread.id === this.threads[index]?.id && thread.comments === this.threads[index].comments,
      ) &&
      other.box === this.box &&
      other.drawing === this.drawing &&
      other.sizes === this.sizes
    );
  }

  toDOM(): HTMLElement {
    // The space around the card is padding, not margin: the editor measures a block by its box,
    // which leaves margins out.
    const block = element('div', 'lo-diffthread');
    if (!this.box) {
      block.dataset.thread = this.#key;
      this.sizes.observe(block);
    }
    let card: HTMLElement | undefined;
    for (const thread of this.threads) {
      card = element('div', 'lo-diffthread__card');
      card.dataset.threadId = thread.id;
      for (const comment of thread.comments) {
        const item = element('div', 'lo-diffthread__comment');
        item.append(
          element('div', 'lo-diffthread__author', comment.author),
          element('p', 'lo-diffthread__body', comment.body),
        );
        card.append(item);
      }
      block.append(card);
    }
    const body = block.querySelector('.lo-diffthread__body');
    if (body) this.sizes.observe(body);
    if (this.box) {
      if (!card) {
        card = element('div', 'lo-diffthread__card');
        block.append(card);
      }
      this.box.attach(card);
    }
    return block;
  }

  override destroy(dom: HTMLElement): void {
    this.sizes.unobserve(dom);
    const body = dom.querySelector('.lo-diffthread__body');
    if (body) this.sizes.unobserve(body);
  }

  /** The threads' size as drawn, for drawing them again. */
  get #key(): string {
    return `${this.id}:${this.threads.map((thread) => thread.comments.length).join(',')}`;
  }

  /**
   * As tall as it was last drawn in its editor at this width, if it was. Else its comments' lines
   * of 18 pixels, at the characters the editor's threads wrap at, under each comment's author line
   * and padding.
   */
  override get estimatedHeight(): number {
    const drawn = this.box ? undefined : this.sizes.drawn(this.#key);
    if (drawn !== undefined) return drawn;
    let comments = 0;
    for (const thread of this.threads) {
      for (const comment of thread.comments) {
        comments += 36 + Math.max(1, Math.ceil(comment.body.length / this.sizes.charsPerLine)) * 18;
      }
    }
    return 16 + comments + (this.box ? this.box.dom.offsetHeight || 60 : 0);
  }

  /** The box handles its own events. */
  override ignoreEvent(): boolean {
    return true;
  }
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
