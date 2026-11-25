// @vitest-environment jsdom
import { EditorState } from '@codemirror/state';
import { Decoration, EditorView, WidgetType } from '@codemirror/view';
import { afterEach, expect, test } from 'vitest';

import { lineBeside } from './lanes.ts';

class Block extends WidgetType {
  toDOM(): HTMLElement {
    return document.createElement('div');
  }
}

let view: EditorView | undefined;

afterEach(() => {
  view?.destroy();
  view = undefined;
});

test('a block on an empty line is before or after it as it’s drawn, as on a line with text', () => {
  const doc = 'one\n\nthree';
  const blank = 4;
  view = new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc,
      extensions: EditorView.decorations.of(
        Decoration.set(
          [
            Decoration.widget({ widget: new Block(), block: true, side: -1 }).range(blank),
            Decoration.widget({ widget: new Block(), block: true, side: 1 }).range(blank),
            Decoration.widget({ widget: new Block(), block: true, side: 1 }).range(3),
            Decoration.widget({ widget: new Block(), block: true, side: -1 }).range(5),
          ],
          true,
        ),
      ),
    }),
  });
  // The blocks drawn beside line `line`, as the gutters are given them.
  const blocks = (line: number) => {
    const { from, to } = view!.state.doc.line(line);
    return view!.viewportLineBlocks
      .flatMap((block) => (Array.isArray(block.type) ? block.type : [block]))
      .filter((block) => block.widget && block.from >= from && block.to <= to);
  };
  expect(blocks(2).map((block) => lineBeside(view!, block))).toEqual([
    { line: 2, after: false },
    { line: 2, after: true },
  ]);
  expect(blocks(1).map((block) => lineBeside(view!, block))).toEqual([{ line: 1, after: true }]);
  expect(blocks(3).map((block) => lineBeside(view!, block))).toEqual([{ line: 3, after: false }]);
});
