// @vitest-environment jsdom
import { diffPullRequest, diffText } from '@lo/diff';
import {
  createDiffView,
  type DiffEvents,
  type DiffFile,
  type DiffView,
  type MovedCode,
  type Place,
  type Target,
} from '@lo/ui/code';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { followLabel, fromMoved, type Going, movedNow, NOT_MOVED } from './moved.ts';

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
/** The files the reader went into, as the diff was told, in order. */
const entered: string[] = [];
afterEach(() => {
  view?.destroy();
  parent?.remove();
  view = undefined;
  entered.length = 0;
});

function textOf(lines: readonly string[]): string | undefined {
  return lines.length === 0 ? undefined : `${lines.join('\n')}\n`;
}

const header = { additions: 1, deletions: 1 };

/** A diff to go in, with its view as made. */
type Shown = Going & { readonly view: DiffView };

/**
 * A diff of `files` showing `moves`, where going into a file calls `enter` too, as the drawing
 * brings in its lines, and a label's click `record`s the place it leaves.
 */
function shown(
  files: readonly DiffFile[],
  moves: readonly MovedCode[],
  {
    enter = () => {},
    record = () => {},
  }: {
    enter?: (made: DiffView, file: string) => void;
    record?: (left: Target) => void;
  } = {},
): Shown {
  parent = document.createElement('div');
  document.body.append(parent);
  const on: DiffEvents = {
    cursor() {},
    mode() {},
    file() {},
    jumped() {},
    load() {},
    menu() {},
    moved: (to) => followLabel(diff, to, record),
  };
  const made = createDiffView(
    parent,
    { files: [...files], layout: 'split', vimKeys: [], nonce: '' },
    on,
  );
  view = made;
  const diff: Shown = {
    view: made,
    enter(file) {
      entered.push(file);
      enter(made, file);
    },
  };
  for (const file of files) {
    if (file.lines) made.setDiff(file.id, diffText(textOf(file.lines.old), textOf(file.lines.new)));
  }
  for (const content of parent.querySelectorAll<HTMLElement>('.cm-content')) content.tabIndex = 0;
  made.setMoves(moves);
  return diff;
}

/** The notes drawn in place of files' lines on the new side. */
function notes(): string[] {
  return [...parent!.querySelectorAll('.cm-content[aria-label="After"] .lo-filenote')].map(
    (note) => note.textContent ?? '',
  );
}

function line(file: string, side: 'old' | 'new', number: number): Place {
  return { file, side, line: number };
}

/** Where the cursor is. */
function cursor(diff: Shown): Target {
  return diff.view.keyState().target;
}

/** A block of four lines, which `a` deletes and `b` adds. */
const block = ['function wrap(text) {', '  const lines = [];', '  return lines;', '}'];

/** `a` deleting `block`, and `b` adding it, starting closed, as a viewed file does, or kept out. */
function aToB(b: 'closed' | 'out'): DiffFile[] {
  return [
    {
      id: 'a',
      path: 'src/a.ts',
      change: 'modified',
      lines: { old: ['import a;', '', ...block, '', 'export { a };'], new: ['import a;'] },
      header,
    },
    b === 'closed'
      ? {
          id: 'b',
          path: 'src/b.ts',
          change: 'added',
          lines: { old: [], new: block },
          header: { additions: 4, deletions: 0 },
          collapsed: true,
        }
      : { id: 'b', path: 'src/b.ts', change: 'added', skip: 'large', header },
  ];
}

/** `block`, from `a`'s old lines 3 to 6 to `b`'s new lines from `first`. */
function aToBMoves(first = 1): MovedCode[] {
  return [
    {
      from: { file: 'a', first: 3, last: 6 },
      to: { file: 'b', first, last: first + 3 },
      words: { old: [], new: [] },
    },
  ];
}

describe('the other end of moved code', () => {
  it('is there from a moved line, and not from any other', () => {
    const diff = shown(aToB('closed'), aToBMoves());
    expect(movedNow(diff.view, line('a', 'old', 4))).toBe(true);
    expect(movedNow(diff.view, line('a', 'old', 1))).toBe(NOT_MOVED);
    expect(movedNow(diff.view, line('a', 'new', 1))).toBe(NOT_MOVED);
  });

  it('is the same line in the other file, gone into, opened if it’s closed, with the cursor and focus', () => {
    const diff = shown(aToB('closed'), aToBMoves());
    diff.view.reveal({ kind: 'line', at: line('a', 'old', 4) });
    expect(notes()).toEqual(['+4 −0, closed: za opens it']);
    expect(fromMoved(diff, line('a', 'old', 4))).toBe(true);
    expect(entered).toEqual(['b']);
    expect(notes()).toEqual([]);
    expect(cursor(diff)).toMatchObject({ kind: 'line', at: line('b', 'new', 2) });
    expect(parent!.contains(document.activeElement)).toBe(true);
    // And back, to a file that's open: it stays as it is.
    expect(fromMoved(diff, line('b', 'new', 2))).toBe(true);
    expect(cursor(diff)).toMatchObject({ kind: 'line', at: line('a', 'old', 4) });
    expect(notes()).toEqual([]);
    expect(fromMoved(diff, line('a', 'old', 1))).toBe(false);
  });

  it('pairs the lines of ends that differ in blank lines, an edited one too, and comes back', () => {
    const before = [
      'export function wrap(text: string): string[] {',
      '  const lines: string[] = [];',
      '',
      '  for (const word of text.split(" ")) {',
      '    lines.push(word);',
      '  }',
      '  return lines;',
      '}',
    ];
    // Moved to b, the blank line after `const` gone, one before `return` added, one line edited.
    const after = [
      ...before.slice(0, 2),
      before[3]!,
      '    lines.push(word.trim());',
      before[5]!,
      '',
      ...before.slice(6),
    ];
    const files: DiffFile[] = [
      {
        id: 'a',
        path: 'src/a.ts',
        change: 'modified',
        lines: { old: ['import x;', '', ...before], new: ['import x;'] },
        header,
      },
      {
        id: 'b',
        path: 'src/b.ts',
        change: 'modified',
        lines: { old: ['// b'], new: ['// b', ...after] },
        header,
      },
    ];
    const found = diffPullRequest(
      files.map((file) => ({
        path: file.path,
        old: textOf(file.lines!.old),
        new: textOf(file.lines!.new),
      })),
    );
    const id = (index: number) => files[index]!.id;
    const moves = found.moves.map((move) => ({
      from: { file: id(move.from.file), first: move.from.first, last: move.from.last },
      to: { file: id(move.to.file), first: move.to.first, last: move.to.last },
      words: move.words,
    }));
    expect(moves.map(({ from, to }) => [from, to])).toEqual([
      [
        { file: 'a', first: 3, last: 10 },
        { file: 'b', first: 2, last: 9 },
      ],
    ]);
    const diff = shown(files, moves);
    // `for` to `for`, the edited line to the edited line, `return` to `return`, and back.
    for (const [old, added] of [
      [6, 4],
      [7, 5],
      [9, 8],
    ] as const) {
      fromMoved(diff, line('a', 'old', old));
      expect(cursor(diff)).toMatchObject({ kind: 'line', at: line('b', 'new', added) });
      fromMoved(diff, line('b', 'new', added));
      expect(cursor(diff)).toMatchObject({ kind: 'line', at: line('a', 'old', old) });
    }
  });

  it('in a file kept out, takes the lines that come as it’s gone into, or else the block’s first line', () => {
    const lines = { old: [], new: ['// b', ...block] };
    // The lines come as the drawing brings them in.
    const brought = shown(aToB('out'), aToBMoves(2), {
      enter(made, file) {
        made.setLines(file, lines, diffText(undefined, textOf(lines.new)));
      },
    });
    fromMoved(brought, line('a', 'old', 5));
    expect(cursor(brought)).toMatchObject({ kind: 'line', at: line('b', 'new', 4) });
    brought.view.destroy();
    parent!.remove();

    // None come: the block's first line, which a file kept out shows as its header.
    const out = shown(aToB('out'), aToBMoves(2));
    const revealed = vi.spyOn(out.view, 'reveal');
    fromMoved(out, line('a', 'old', 5));
    expect(revealed).toHaveBeenLastCalledWith({ kind: 'line', at: line('b', 'new', 2) });
    expect(cursor(out)).toMatchObject({ kind: 'header', file: 'b' });
  });
});

describe('a moved label’s click', () => {
  it('goes to the first line at the other end, gone into, from the label’s own line', () => {
    const left: Target[] = [];
    const diff = shown(aToB('closed'), aToBMoves(), { record: (at) => left.push(at) });
    diff.view.reveal({ kind: 'line', at: line('a', 'old', 1) });
    const button = parent!.querySelector<HTMLElement>(
      '.cm-content[aria-label="Before"] .lo-movedlabel button',
    );
    expect(button?.textContent).toBe('src/b.ts:1');
    button!.click();
    expect(entered).toEqual(['b']);
    expect(left).toEqual([{ kind: 'line', at: line('a', 'old', 3) }]);
    expect(cursor(diff)).toMatchObject({ kind: 'line', at: line('b', 'new', 1) });
    expect(notes()).toEqual([]);
  });
});
