// Marks on the lines an editor draws: changed lines and words, moved lines and their edits, and
// each row's key on its first line. Only what's drawn is marked, so the decorations a transaction
// goes through stay as few as the lines on screen, whatever the pull request's size.

import { type Range, StateEffect, type Text } from '@codemirror/state';
import {
  Decoration,
  type DecorationSet,
  type EditorView,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view';

/** Some file's marks changed, as when its diff or the moves arrive: mark again. */
export const marksChanged = StateEffect.define();

/** Where an editor's marks come from: those on document lines `first` to `last` of `doc`. */
export type MarkSource = (doc: Text, first: number, last: number) => Range<Decoration>[];

/** Marks what `view` draws, from `source`. */
export function marking(source: MarkSource): ViewPlugin<{ decorations: DecorationSet }> {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = build(view, source);
      }

      update(update: ViewUpdate): void {
        const changed = update.transactions.some((transaction) =>
          transaction.effects.some((effect) => effect.is(marksChanged)),
        );
        if (update.viewportChanged || update.docChanged || changed) {
          this.decorations = build(update.view, source);
        }
      }
    },
    { decorations: (plugin) => plugin.decorations },
  );
}

function build(view: EditorView, source: MarkSource): DecorationSet {
  const { doc } = view.state;
  const { from, to } = view.viewport;
  return Decoration.set(source(doc, doc.lineAt(from).number, doc.lineAt(to).number), true);
}

/** A row's key on its first line, for checking what's drawn row by row. */
export function rowKey(key: string): Decoration {
  return Decoration.line({ attributes: { 'data-row': key } });
}
