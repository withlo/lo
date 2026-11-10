// The blocks the diff view draws between lines: file headers, with notes on files not shown,
// collapsed code and notes in place of lines, threads and the comment boxes in them, the labels on
// moved code, and the spacers that keep the two sides lined up. A block that starts a row with
// lines on both sides carries the row's key as `data-row`, as the first line of a row does, so the
// alignment drawn on screen can be checked row by row.

import { WidgetType } from '@codemirror/view';

/** What a file header shows. */
export interface HeaderInfo {
  path: string;
  previousPath?: string | undefined;
  additions: number;
  deletions: number;
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
    return other.file === this.file && other.note === this.note;
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
    const head = element('div', 'lo-filehead lo-diffhead');
    head.dataset.row = `h:${this.file}`;
    const path = element('span', 'lo-path');
    if (this.info.previousPath && this.info.previousPath !== this.info.path) {
      path.append(element('span', 'lo-path--old', this.info.previousPath), ' → ');
    }
    const slash = this.info.path.lastIndexOf('/') + 1;
    path.append(this.info.path.slice(0, slash), element('b', '', this.info.path.slice(slash)));
    const stat = element('span', 'lo-stat');
    stat.append(
      element('span', 'add', `+${this.info.additions}`),
      element('span', 'del', `−${this.info.deletions}`),
    );
    head.append(path, stat);
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

/** Sentences to fill a comment with, since the recordings keep only each comment's length. */
const filler = [
  'This reads well, but the error path still needs a test.',
  'Could we keep the old name for one release, so callers have time to move?',
  'Nit: the comment above no longer matches what the function does.',
  'I think this check belongs before the loop, not inside it.',
  'Does this hold when the list is empty?',
  'Good catch. The cache would have gone stale here.',
];

/** Text of exactly `length` characters, made of whole sentences where it can be. */
export function fillerText(length: number, seed: number): string {
  let text = '';
  for (let index = seed; text.length < length; index++) {
    text += `${text ? ' ' : ''}${filler[index % filler.length]}`;
  }
  return text.slice(0, length);
}

/** A comment in a thread: its length, for a recorded one, or its text. */
export type ThreadComment = number | string;

/** What a thread widget needs from the comment box it holds. */
export interface BoxHost {
  /** The box's element, which moves into each widget that draws it. */
  readonly dom: HTMLElement;
  /** Puts the box in `parent`, keeping its focus. */
  attach(parent: HTMLElement): void;
}

/**
 * A review thread under a line, and the comment box being written there, if there is one: one
 * block a line, for the same reason as a header's note.
 */
export class ThreadWidget extends WidgetType {
  readonly id: string;
  readonly comments: readonly ThreadComment[];
  readonly box: BoxHost | undefined;
  readonly drawing: number;

  /** `drawing` changes when the box must be drawn again, to move it into another editor. */
  constructor(id: string, comments: readonly ThreadComment[], box?: BoxHost, drawing = 0) {
    super();
    this.id = id;
    this.comments = comments;
    this.box = box;
    this.drawing = drawing;
  }

  override eq(other: ThreadWidget): boolean {
    return (
      other.id === this.id &&
      other.comments.length === this.comments.length &&
      other.box === this.box &&
      other.drawing === this.drawing
    );
  }

  toDOM(): HTMLElement {
    // The space around the card is padding, not margin: the editor measures a block by its box,
    // which leaves margins out.
    const block = element('div', 'lo-diffthread');
    const thread = element('div', 'lo-diffthread__card');
    block.append(thread);
    this.comments.forEach((comment, index) => {
      const item = element('div', 'lo-diffthread__comment');
      const text = typeof comment === 'string' ? comment : fillerText(comment, index);
      item.append(
        element(
          'div',
          'lo-diffthread__author',
          typeof comment === 'string' ? 'you' : index === 0 ? 'reviewer' : 'author',
        ),
        element('p', 'lo-diffthread__body', text),
      );
      thread.append(item);
    });
    if (this.box) this.box.attach(thread);
    return block;
  }

  /** About 90 characters a line of 20 pixels, plus each comment's author line and padding. */
  override get estimatedHeight(): number {
    const comments = this.comments.reduce<number>(
      (total, comment) =>
        total + 38 + Math.ceil((typeof comment === 'string' ? comment.length : comment) / 90) * 20,
      0,
    );
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
