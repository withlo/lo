// @vitest-environment jsdom
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { describe, expect, it } from 'vitest';

import { hang, indentOf } from './hang.ts';

describe('the hang of a wrapped line', () => {
  it('is past the line’s own indent, in columns, a tab to its next stop', () => {
    expect(indentOf('return x;', 4)).toBe(0);
    expect(indentOf('    if (a) {', 4)).toBe(4);
    expect(indentOf('\tif (a) {', 4)).toBe(4);
    expect(indentOf('  \tx', 4)).toBe(4);
    expect(indentOf('\t\t', 2)).toBe(4);
    expect(indentOf('', 4)).toBe(0);
  });

  it('is on every line the editor draws, as --ind', () => {
    const parent = document.createElement('div');
    const view = new EditorView({
      parent,
      state: EditorState.create({ doc: 'a\n    b\n\tc', extensions: hang() }),
    });
    const lines = [...view.contentDOM.querySelectorAll<HTMLElement>('.cm-line')];
    expect(lines.map((line) => line.classList.contains('lo-hang'))).toEqual([true, true, true]);
    expect(lines.map((line) => line.style.getPropertyValue('--ind'))).toEqual(['0', '4', '4']);
    view.destroy();
  });
});
