// The suite's overview notes, drawn as plain text through the diff view's `renderNotes`, as the
// app draws them: each note its head and its words, in the element the view measures them by.

import type { NotesView, RenderNotes } from '@lo/ui/code';

/** The attribute on the element a note's words are drawn in (`NOTE_TEXT` in `@lo/ui`). */
const NOTE_TEXT = 'data-note-text';

/** Draws each note as a head with its section and a paragraph of its words, drawn again as asked. */
export const plainNotes: RenderNotes = (host, given) => {
  const draw = ({ notes }: NotesView): void => {
    host.replaceChildren(
      ...notes.map((note) => {
        const card = document.createElement('div');
        card.dataset.noteKey = note.key;
        const head = document.createElement('div');
        head.textContent = `Overview · ${note.label}`;
        const words = document.createElement('p');
        words.setAttribute(NOTE_TEXT, '');
        words.textContent = note.text;
        card.append(head, words);
        return card;
      }),
    );
  };
  draw(given);
  return { update: draw, destroy: () => host.replaceChildren() };
};
