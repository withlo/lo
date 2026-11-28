// Draws the overview's notes in the elements a pull request's diff makes for them, each a React root
// of its own, which the view keeps up to date and takes down: beside lines, the notes that end on a
// line in the view's popover over the code, the first with the popover's Close; between lines, a
// note's card under its last line, whose collapse closes it. A note's words are drawn as the
// overview draws them, in the slot its `Note` leaves, once the note itself is drawn.

import { Note, ThreadPopover } from '@lo/ui';
import type { NotesView, NoteView, RenderNotes } from '@lo/ui/code';
import { keyLabels } from '@lo/ui/commands';
import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';

import { registry } from '../../../window/commands/registry.ts';
import { noteLines } from './explained.ts';

/** The attribute on the slot a note's words are drawn in, which holds the note's key. */
const WORDS = 'data-note-words';

/** The first keys `id` has now, as this system shows them, if it has any. */
function keysOf(id: string): string[] | undefined {
  const [first] = registry().keysOf(id);
  return first && keyLabels(first, registry().system);
}

/** What's drawn in a note's slot: its words, and what takes them down. */
interface Drawn {
  readonly slot: Element;
  readonly note: NoteView;
  readonly undraw: () => void;
}

/**
 * Draws `note`'s words in `slot`: as the overview draws them, or else as plain text, in an element
 * of their own each time, as what was drawn before may still be going.
 */
function drawWords(slot: HTMLElement, note: NoteView): () => void {
  const into = document.createElement('div');
  slot.replaceChildren(into);
  if (note.draw) return note.draw(into);
  into.textContent = note.text;
  return () => {};
}

/** Whether two notes' words draw the same. */
function sameWords(a: NoteView, b: NoteView): boolean {
  return a.text === b.text && a.draw === b.draw;
}

/**
 * What draws the overview's notes in a pull request's diff: in the popover, the notes that end on
 * a line, each with its lines and section in its head, the first with Close; or as a card under
 * the line. Each has "Show in overview", which runs `diff.showInOverview` on it.
 */
export const renderNotes: RenderNotes = (host, given, how, close) => {
  const root = createRoot(host);
  const drawn = new Map<string, Drawn>();
  const draw = ({ notes, focused, label }: NotesView) => {
    const popover = how === 'popover';
    const cards = notes.map((note, index) => {
      const target = {
        kind: 'note',
        at: { file: note.at.file, side: note.at.side, line: note.at.to },
        note: note.key,
      } as const;
      const card = createElement(
        Note,
        {
          variant: how,
          label: `Overview note, ${noteLines(note.at.from, note.at.to, true)}`,
          section: note.label,
          lines: popover ? noteLines(note.at.from, note.at.to) : undefined,
          focused,
          show: { command: 'diff.showInOverview', target },
          onClose: !popover || index === 0 ? close : undefined,
          closeKeys: popover ? keysOf('comments.closeThread') : undefined,
        },
        createElement('div', { [WORDS]: note.key }),
      );
      return { key: note.key, card };
    });
    root.render(
      popover ? createElement(ThreadPopover, { label, threads: [], notes: cards }) : cards[0]?.card,
    );
  };
  /** Draws each note's words in its slot, where they aren't drawn as they are now. */
  const fill = ({ notes }: NotesView) => {
    const keys = new Set(notes.map((note) => note.key));
    for (const [key, was] of drawn) {
      if (keys.has(key)) continue;
      was.undraw();
      drawn.delete(key);
    }
    for (const note of notes) {
      const slot = host.querySelector<HTMLElement>(`[${WORDS}="${CSS.escape(note.key)}"]`);
      const was = drawn.get(note.key);
      if (!slot || (was?.slot === slot && sameWords(was.note, note))) continue;
      was?.undraw();
      drawn.set(note.key, { slot, note, undraw: drawWords(slot, note) });
    }
  };
  // At once, as the view measures what it draws.
  flushSync(() => draw(given));
  fill(given);
  let gone = false;
  return {
    update(next) {
      if (gone) return;
      flushSync(() => draw(next));
      fill(next);
    },
    destroy() {
      gone = true;
      for (const each of drawn.values()) each.undraw();
      drawn.clear();
      // Not while React may be rendering, as when the view takes notes down in an effect.
      queueMicrotask(() => root.unmount());
    },
  };
};
