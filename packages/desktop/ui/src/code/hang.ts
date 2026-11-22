// Code is drawn as written: a line too long for the view wraps, and what wraps continues four
// columns past the line's own indent, so the wrap reads as the same line and never as a new one at
// the line's edge. Each line the editor draws carries its indent as `--ind`, in columns, which the
// hang rule in `design/css/code.css` (`.lo-hang`) reads.

import { type Extension, RangeSetBuilder } from '@codemirror/state';
import {
  Decoration,
  type DecorationSet,
  type EditorView,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view';

/** The columns a line's leading spaces and tabs take, a tab to the next of `tabSize`'s stops. */
export function indentOf(text: string, tabSize: number): number {
  let columns = 0;
  for (const char of text) {
    if (char === ' ') columns += 1;
    else if (char === '\t') columns += tabSize - (columns % tabSize);
    else break;
  }
  return columns;
}

/** One decoration per indent, shared by every line that has it. */
const marks = new Map<number, Decoration>();

function markOf(indent: number): Decoration {
  let mark = marks.get(indent);
  if (!mark) {
    mark = Decoration.line({ class: 'lo-hang', attributes: { style: `--ind: ${indent}` } });
    marks.set(indent, mark);
  }
  return mark;
}

/** The hang on each line `view` draws. */
function hangs(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const { doc, tabSize } = view.state;
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to;) {
      const line = doc.lineAt(pos);
      builder.add(line.from, line.from, markOf(indentOf(line.text, tabSize)));
      pos = line.to + 1;
    }
  }
  return builder.finish();
}

/** Wrapped lines continue four columns past their own indent, in a code view's editor. */
export function hang(): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = hangs(view);
      }

      update(update: ViewUpdate): void {
        if (update.docChanged || update.viewportChanged) this.decorations = hangs(update.view);
      }
    },
    { decorations: (plugin) => plugin.decorations },
  );
}
