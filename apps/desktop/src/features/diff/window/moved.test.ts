// @vitest-environment jsdom
import { diffText } from '@lo/diff';
import {
  createDiffView,
  type DiffEvents,
  type DiffFile,
  type DiffView,
  type Target,
} from '@lo/ui/code';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { followLabel, type Going, movedNow, NOT_MOVED, toOtherEnd } from './moved.ts';

const noRects = (): DOMRectList => Object.assign([], { item: () => null });

/** jsdom has no fonts, no resize observer and no layout: the view needs only that they exist. */
beforeAll(() => {
  if (!('fonts' in document)) {
    Object.defineProperty(document, 'fonts', {
      value: { addEventListener() {}, removeEventListener() {} },
    });
  }
  if (!('getClientRects' in Range.prototype)) {
    Object.defineProperty(Range.prototype, 'getClientRects', { value: noRects });
    Object.defineProperty(Range.prototype, 'getBoundingClientRect', { value: () => new DOMRect() });
  }
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
});

let view: DiffView | undefined;
let parent: HTMLElement | undefined;
/** The files the diff was told the reader acted on, as `za` tells it, in order. */
const acted: string[] = [];
afterEach(() => {
  view?.destroy();
  parent?.remove();
  view = undefined;
  acted.length = 0;
});

/** The diff `made` is drawn in, as the keys and a label's click act on it. */
function going(made: DiffView): Going {
  return { view: made, acted: (file) => acted.push(file) };
}

/** A block of four lines, which `a` deletes and `b` adds. */
const block = ['function wrap(text) {', '  const lines = [];', '  return lines;', '}'];
const aOld = ['import a;', '', ...block, '', 'export { a };'];
const aNew = ['import a;', '', 'export { a };'];

function textOf(lines: readonly string[]): string | undefined {
  return lines.length === 0 ? undefined : `${lines.join('\n')}\n`;
}

/**
 * `a` and `b`, the code `a` deletes moved to `b`, which starts closed, as a viewed file does. A
 * label's click goes to the other end, `record`ing the place it leaves.
 */
function shown(record: (left: Target) => void = () => {}): DiffView {
  const files: DiffFile[] = [
    {
      id: 'a',
      path: 'src/a.ts',
      change: 'modified',
      lines: { old: aOld, new: aNew },
      header: { additions: 0, deletions: 5 },
    },
    {
      id: 'b',
      path: 'src/b.ts',
      change: 'added',
      lines: { old: [], new: block },
      header: { additions: 4, deletions: 0 },
      collapsed: true,
    },
  ];
  parent = document.createElement('div');
  document.body.append(parent);
  const on: DiffEvents = {
    cursor() {},
    mode() {},
    file() {},
    jumped() {},
    load() {},
    menu() {},
    moved: (to) => followLabel(going(made), to, record),
  };
  const made = createDiffView(parent, { files, layout: 'split', vimKeys: [], nonce: '' }, on);
  view = made;
  for (const file of files) {
    if (file.lines) made.setDiff(file.id, diffText(textOf(file.lines.old), textOf(file.lines.new)));
  }
  for (const content of parent.querySelectorAll<HTMLElement>('.cm-content')) content.tabIndex = 0;
  made.setMoves([
    {
      from: { file: 'a', first: 3, last: 6 },
      to: { file: 'b', first: 1, last: 4 },
      words: { old: [], new: [] },
    },
  ]);
  return made;
}

/** The notes drawn in place of files' lines on the new side. */
function notes(): string[] {
  return [...parent!.querySelectorAll('.cm-content[aria-label="After"] .lo-filenote')].map(
    (note) => note.textContent ?? '',
  );
}

describe('the other end of moved code', () => {
  it('is there from a moved line, and not from any other', () => {
    const diff = shown();
    expect(movedNow(diff, { file: 'a', side: 'old', line: 4 })).toBe(true);
    expect(movedNow(diff, { file: 'a', side: 'old', line: 1 })).toBe(NOT_MOVED);
    expect(movedNow(diff, { file: 'a', side: 'new', line: 3 })).toBe(NOT_MOVED);
  });

  it('is the same line in the other file, acted on as za does, opened if it’s closed, with the cursor and focus', () => {
    const diff = shown();
    diff.reveal({ kind: 'line', at: { file: 'a', side: 'old', line: 4 } });
    expect(notes()).toEqual(['+4 −0, closed: za opens it']);
    const to = diff.otherEnd({ file: 'a', side: 'old', line: 4 });
    expect(to).toEqual({ file: 'b', side: 'new', line: 2 });
    toOtherEnd(going(diff), to!);
    expect(acted).toEqual(['b']);
    expect(notes()).toEqual([]);
    expect(diff.keyState().target).toMatchObject({
      kind: 'line',
      at: { file: 'b', side: 'new', line: 2 },
    });
    expect(parent!.contains(document.activeElement)).toBe(true);
    // And back, to a file that's open: it stays as it is.
    toOtherEnd(going(diff), diff.otherEnd({ file: 'b', side: 'new', line: 2 })!);
    expect(diff.keyState().target).toMatchObject({
      kind: 'line',
      at: { file: 'a', side: 'old', line: 4 },
    });
    expect(notes()).toEqual([]);
  });
});

describe('a moved label’s click', () => {
  it('goes to the first line at the other end, from the label’s own line', () => {
    const left: Target[] = [];
    const diff = shown((at) => left.push(at));
    diff.reveal({ kind: 'line', at: { file: 'a', side: 'old', line: 1 } });
    const button = parent!.querySelector<HTMLElement>(
      '.cm-content[aria-label="Before"] .lo-movedlabel button',
    );
    expect(button?.textContent).toBe('src/b.ts:1');
    button!.click();
    expect(left).toEqual([{ kind: 'line', at: { file: 'a', side: 'old', line: 3 } }]);
    expect(acted).toEqual(['b']);
    expect(diff.keyState().target).toMatchObject({
      kind: 'line',
      at: { file: 'b', side: 'new', line: 1 },
    });
    expect(notes()).toEqual([]);
  });
});
