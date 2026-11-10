// The blocks the diff view draws between lines: file headers, collapsed code, threads, the labels
// on moved code, and the spacers that keep the two sides lined up.

import { WidgetType } from '@codemirror/view';

/** What a file header shows. */
export interface HeaderInfo {
  path: string;
  previousPath?: string | undefined;
  additions: number;
  deletions: number;
}

/** A file's header, the same on both sides. */
export class HeaderWidget extends WidgetType {
  readonly file: number;
  readonly info: HeaderInfo;

  constructor(file: number, info: HeaderInfo) {
    super();
    this.file = file;
    this.info = info;
  }

  override eq(other: HeaderWidget): boolean {
    return other.file === this.file;
  }

  toDOM(): HTMLElement {
    const head = element('div', 'lo-filehead lo-diffhead');
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
    return 38;
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

  /** `key` tells blocks apart: equal keys draw the same. */
  constructor(key: string, text: string, range = '') {
    super();
    this.key = key;
    this.text = text;
    this.range = range;
  }

  override eq(other: CollapsedWidget): boolean {
    return other.key === this.key;
  }

  toDOM(): HTMLElement {
    const block = element('div', 'lo-collapsed');
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

/** A review thread under a line, with its comments' lengths. */
export class ThreadWidget extends WidgetType {
  readonly id: string;
  readonly comments: readonly number[];

  constructor(id: string, comments: readonly number[]) {
    super();
    this.id = id;
    this.comments = comments;
  }

  override eq(other: ThreadWidget): boolean {
    return other.id === this.id;
  }

  toDOM(): HTMLElement {
    // The space around the card is padding, not margin: the editor measures a block by its box,
    // which leaves margins out.
    const block = element('div', 'lo-diffthread');
    const thread = element('div', 'lo-diffthread__card');
    block.append(thread);
    this.comments.forEach((length, index) => {
      const comment = element('div', 'lo-diffthread__comment');
      comment.append(
        element('div', 'lo-diffthread__author', index === 0 ? 'reviewer' : 'author'),
        element('p', 'lo-diffthread__body', fillerText(length, index)),
      );
      thread.append(comment);
    });
    return block;
  }

  /** About 90 characters a line of 20 pixels, plus each comment's author line and padding. */
  override get estimatedHeight(): number {
    return (
      16 + this.comments.reduce((total, length) => total + 38 + Math.ceil(length / 90) * 20, 0)
    );
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
