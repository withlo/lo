// Syntax highlighting from the background process's tokens: each file's `[from, to, token]`
// triples over each version's text, decorated only on the lines the editor draws, so a long file
// costs only what's on screen. A document says what each of its lines is, so the same highlighting
// serves a side's document and the inline one.

import { RangeSetBuilder, StateEffect } from '@codemirror/state';
import {
  Decoration,
  type DecorationSet,
  type EditorView,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view';
import { tokens as tokenNames } from '@lo/syntax/tokens';

import type { Side } from './layout.ts';

/** Some file's tokens arrived: draw the highlighting again. */
export const tokensChanged = StateEffect.define();

/** A version's tokens, and where each of its lines starts in its text. */
export interface FileTokens {
  tokens: Uint32Array;
  starts: Int32Array;
}

/** Where a document's highlighting comes from. */
export interface TokenSource {
  /** The file line document line `line` shows, if it shows one. */
  lineAt(line: number): { file: number; side: Side; line: number } | undefined;
  tokens(file: number, side: Side): FileTokens | undefined;
}

const marks = tokenNames.map((name) => Decoration.mark({ class: `lo-syn-${name}` }));

/** Highlights what `view` draws, from `source`. */
export function highlighting(source: TokenSource): ViewPlugin<{ decorations: DecorationSet }> {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = build(view, source);
      }

      update(update: ViewUpdate): void {
        const arrived = update.transactions.some((transaction) =>
          transaction.effects.some((effect) => effect.is(tokensChanged)),
        );
        if (update.viewportChanged || update.docChanged || arrived) {
          this.decorations = build(update.view, source);
        }
      }
    },
    { decorations: (plugin) => plugin.decorations },
  );
}

function build(view: EditorView, source: TokenSource): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const doc = view.state.doc;
  // Ranges either side of a collapsed block can meet on one line.
  let done = 0;
  for (const { from, to } of view.visibleRanges) {
    const last = doc.lineAt(to).number;
    for (let number = Math.max(doc.lineAt(from).number, done + 1); number <= last; number++) {
      done = number;
      const shown = source.lineAt(number);
      if (!shown) continue;
      const file = source.tokens(shown.file, shown.side);
      if (!file) continue;
      const line = doc.line(number);
      const start = file.starts[shown.line - 1];
      if (start === undefined) continue;
      const end = start + line.length;
      const { tokens } = file;
      for (let at = firstEndingAfter(tokens, start) * 3; at < tokens.length; at += 3) {
        const tokenFrom = tokens[at]!;
        if (tokenFrom >= end) break;
        const mark = marks[tokens[at + 2]!];
        const markFrom = Math.max(tokenFrom, start);
        const markTo = Math.min(tokens[at + 1]!, end);
        if (mark && markTo > markFrom) {
          builder.add(line.from + markFrom - start, line.from + markTo - start, mark);
        }
      }
    }
  }
  return builder.finish();
}

/** The index of the first triple that ends after `offset`. Triples are in order and don't overlap. */
function firstEndingAfter(tokens: Uint32Array, offset: number): number {
  let low = 0;
  let high = tokens.length / 3;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (tokens[middle * 3 + 1]! <= offset) low = middle + 1;
    else high = middle;
  }
  return low;
}

/** Where each of `lines` starts in their text, joined with `\n`. */
export function lineStarts(lines: readonly string[]): Int32Array {
  const starts = new Int32Array(lines.length);
  let at = 0;
  lines.forEach((line, index) => {
    starts[index] = at;
    at += line.length + 1;
  });
  return starts;
}
