// Overview notes drawn as plain elements, as a code view's caller draws them, for the tests of the
// views that open them: each note its key, a head with its section and, in a popover, its lines,
// its words in the element the view measures them by, and a Close on the first.

import type { NotesView, NoteView, RenderNotes } from '../src/code/api.ts';
import { NOTE_TEXT } from '../src/edits.ts';

/** Draws `note`'s words in `into`: the caller's way, or plain. Returns what takes them down. */
function words(into: HTMLElement, note: NoteView): () => void {
  if (note.draw) return note.draw(into);
  into.textContent = note.text;
  return () => {};
}

/**
 * Draws each note as `test-note`, marked by its key (`data-note-key`), with `test-note__head`
 * saying "Overview · <section>", its lines in a popover, and its words; the first's Close is
 * `test-note__close`. A note's words are drawn once, while it shows the same.
 */
export const plainNotes: RenderNotes = (host, given, how, close) => {
  const drawn = new Map<string, { note: NoteView; card: HTMLElement; undraw: () => void }>();
  const draw = ({ notes, focused, label }: NotesView) => {
    host.dataset.label = label;
    host.toggleAttribute('data-focused', focused);
    const keys = new Set(notes.map((note) => note.key));
    for (const [key, was] of drawn) {
      if (keys.has(key)) continue;
      was.undraw();
      drawn.delete(key);
    }
    const cards = notes.map((note, index) => {
      const was = drawn.get(note.key);
      if (was && was.note.text === note.text && was.note.draw === note.draw) return was.card;
      was?.undraw();
      const card = document.createElement('div');
      card.className = 'test-note';
      card.dataset.noteKey = note.key;
      const head = document.createElement('div');
      head.className = 'test-note__head';
      const lines = how === 'popover' ? ` · lines ${note.at.from}–${note.at.to}` : '';
      head.textContent = `Overview · ${note.label}${lines}`;
      const text = document.createElement('div');
      text.setAttribute(NOTE_TEXT, '');
      card.append(head, text);
      if (index === 0) {
        const button = document.createElement('button');
        button.className = 'test-note__close';
        button.textContent = 'Close';
        button.addEventListener('click', close);
        card.append(button);
      }
      drawn.set(note.key, { note, card, undraw: words(text, note) });
      return card;
    });
    host.replaceChildren(...cards);
  };
  draw(given);
  return {
    update: draw,
    destroy() {
      for (const each of drawn.values()) each.undraw();
      drawn.clear();
    },
  };
};
