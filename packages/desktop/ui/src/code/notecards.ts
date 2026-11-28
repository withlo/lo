// Overview notes open between lines, each a card the caller draws in an element the view makes for
// it and keeps while the note is open: the view puts the element in the block under the note's last
// line, after that line's thread cards, and moves it into whichever editor draws the line, so what
// the caller drew stays drawn from one block to the next. Beside lines a note opens in the threads'
// popover instead (`beside.ts`), and none is drawn in the flow.

import type { NotesContent, NoteView, RenderNotes } from './api.ts';

/** About how tall a card's head is, and each line of its words, before it's been measured. */
const HEAD = 49;
const LINE = 21;

/** One open note's element under its line, and what the caller drew in it. */
export class NoteCard {
  /** The view's name for the note. */
  readonly key: string;
  readonly dom: HTMLElement;
  #note: NoteView;
  #label: string;
  /** Whether the keyboard is on it: the cursor on its lines, where `g o` acts on it. */
  #focused = false;
  #content: NotesContent | undefined;

  /**
   * Draws `note` at once with `render`, as a card that `label` names, whose control that collapses
   * it calls `close`.
   */
  constructor(note: NoteView, label: string, render: RenderNotes, close: () => void) {
    this.key = note.key;
    this.#note = note;
    this.#label = label;
    this.dom = document.createElement('div');
    this.dom.className = 'lo-diffthread__note';
    this.dom.dataset.note = note.key;
    this.dom.dataset.sized = this.sizeKey;
    this.#content = render(this.dom, this.#view(), 'card', close);
  }

  #view() {
    return { notes: [this.#note], focused: this.#focused, label: this.#label };
  }

  get note(): NoteView {
    return this.#note;
  }

  /** Takes what the note says now, drawn again if anything changed. */
  give(note: NoteView, label: string): void {
    if (sameNote(note, this.#note) && label === this.#label) return;
    this.#note = note;
    this.#label = label;
    this.dom.dataset.sized = this.sizeKey;
    this.#content?.update(this.#view());
  }

  /** Says whether the keyboard is on it: its key chips show. It changes no size. */
  setFocused(focused: boolean): void {
    if (focused === this.#focused) return;
    this.#focused = focused;
    this.#content?.update(this.#view());
  }

  /** What the editor's sizes keep its height by: the note, and how long its words are. */
  get sizeKey(): string {
    return `note:${this.key}:${this.#note.text.length}`;
  }

  /**
   * About how tall it is before it's been measured, at `chars` characters to a line of its words.
   */
  guess(chars: number): number {
    return HEAD + Math.max(1, Math.ceil(this.#note.text.length / chars)) * LINE;
  }

  destroy(): void {
    this.#content?.destroy();
    this.#content = undefined;
    this.dom.remove();
  }
}

/** Whether two notes draw the same. */
export function sameNote(a: NoteView, b: NoteView): boolean {
  return (
    a.key === b.key &&
    a.block === b.block &&
    a.label === b.label &&
    a.text === b.text &&
    a.draw === b.draw &&
    a.at.file === b.at.file &&
    a.at.side === b.at.side &&
    a.at.from === b.at.from &&
    a.at.to === b.at.to
  );
}
