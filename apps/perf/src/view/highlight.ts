// Syntax highlighting from the background process's tokens: each file's `[from, to, token]`
// triples, decorated only where the editor draws, so a long file costs only what's on screen.

import { RangeSetBuilder, StateEffect, StateField } from '@codemirror/state';
import {
  Decoration,
  type DecorationSet,
  type EditorView,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view';
import { tokens as tokenNames } from '@lo/syntax/tokens';

import type { Layout, Side } from './layout.ts';

/** A file's tokens on this side, as triples of offsets into its text and token numbers. */
export const setTokens = StateEffect.define<{ file: number; tokens: Uint32Array }>();

/** Each file's tokens, by its index. */
export const tokensField = StateField.define<readonly (Uint32Array | undefined)[]>({
  create: () => [],
  update(value, transaction) {
    let next = value;
    for (const effect of transaction.effects) {
      if (!effect.is(setTokens)) continue;
      const copy = [...next];
      copy[effect.value.file] = effect.value.tokens;
      next = copy;
    }
    return next;
  },
});

const marks = tokenNames.map((name) => Decoration.mark({ class: `lo-syn-${name}` }));

/** Highlights what `view` draws, from the tokens in `tokensField`. */
export function highlighting(
  layout: Layout,
  side: Side,
): ViewPlugin<{ decorations: DecorationSet }> {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = build(view, layout, side);
      }

      update(update: ViewUpdate): void {
        const tokensChanged =
          update.startState.field(tokensField) !== update.state.field(tokensField);
        if (update.viewportChanged || update.docChanged || tokensChanged) {
          this.decorations = build(update.view, layout, side);
        }
      }
    },
    { decorations: (plugin) => plugin.decorations },
  );
}

function build(view: EditorView, layout: Layout, side: Side): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const all = view.state.field(tokensField);
  const doc = view.state.doc;
  for (const { from, to } of view.visibleRanges) {
    for (
      let index = layout.fileAt(side, doc.lineAt(from).number);
      index < layout.files.length;
      index++
    ) {
      const lines = layout.files[index]![side];
      const header = doc.line(lines.header);
      if (header.from > to) break;
      const tokens = all[index];
      if (!tokens || lines.count === 0) continue;
      // Offsets in the file's text count from its first line.
      const base = header.to + 1;
      const end = doc.line(lines.header + lines.count).to;
      const low = Math.max(from, base) - base;
      const high = Math.min(to, end) - base;
      for (let at = firstEndingAfter(tokens, low) * 3; at < tokens.length; at += 3) {
        const start = tokens[at]!;
        if (start >= high) break;
        const stop = Math.min(tokens[at + 1]!, high);
        const mark = marks[tokens[at + 2]!];
        if (mark && stop > Math.max(start, low)) {
          builder.add(base + Math.max(start, low), base + stop, mark);
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
