// @vitest-environment jsdom
// An open note's card between lines: measured by the editor whose block holds it, and by that one
// alone, as it moves from one editor's block to another's.

import { describe, expect, test } from 'vitest';

import { plainNotes } from '../../test/notes.ts';
import type { NoteView } from './api.ts';
import { type CardWatcher, NoteCard } from './notecards.ts';

const NOTE: NoteView = {
  key: 'n1',
  at: { file: 'a', side: 'new', from: 4, to: 6 },
  block: 'one',
  label: 'Where to look',
  text: 'A query over the plan’s ceiling is refused before it touches the bucket.',
};

/** An editor's measuring, which says what it measures now. */
function watcher(): CardWatcher & { readonly watching: Element[] } {
  const watching: Element[] = [];
  return {
    watching,
    observe: (target) => {
      if (!watching.includes(target)) watching.push(target);
    },
    unobserve: (target) => {
      const at = watching.indexOf(target);
      if (at !== -1) watching.splice(at, 1);
    },
  };
}

describe('NoteCard', () => {
  test('is measured by the editor whose block holds it, and stops being by the one it left', () => {
    const card = new NoteCard(NOTE, 'Overview note, lines 4–6', plainNotes, () => {});
    const text = card.dom.querySelector('[data-note-text]')!;
    const split = watcher();
    const inline = watcher();
    card.watch(split);
    // Drawn again in the same editor: nothing changes.
    card.watch(split);
    expect(split.watching).toEqual([card.dom, text]);
    // Moved into the other layout's editor.
    card.watch(inline);
    expect(split.watching).toEqual([]);
    expect(inline.watching).toEqual([card.dom, text]);
    card.unwatch();
    expect(inline.watching).toEqual([]);
    // Closed while it's held.
    card.watch(split);
    card.destroy();
    expect(split.watching).toEqual([]);
  });
});
