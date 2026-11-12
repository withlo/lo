// @vitest-environment jsdom
import { EditorView } from '@codemirror/view';
import { getCM, Vim } from '@replit/codemirror-vim';
import tokenNames from '@lo/design/syntax.json' with { type: 'json' };
import { afterEach, beforeAll, describe, expect, type Mock, test, vi } from 'vitest';

import { findScope, isKeySource } from '../commands/index.ts';
import type { FileEvents, FileInit, FileView, Place, Spot, VimKey } from './api.ts';
import { createFileView } from './file.ts';

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

const lines = Array.from({ length: 40 }, (_, index) => `line ${index + 1}`);

const motions: VimKey[] = [
  { kind: 'motion', command: 'diff.nextChange', keys: ']c' },
  { kind: 'motion', command: 'diff.nextFile', keys: ']f' },
];

let view: FileView | undefined;
let parent: HTMLElement | undefined;

afterEach(() => {
  view?.destroy();
  parent?.remove();
  view = undefined;
});

type Spied<T> = { [K in keyof T]: T[K] extends (...args: never[]) => unknown ? Mock<T[K]> : never };

function events(): Spied<FileEvents> {
  return {
    cursor: vi.fn<FileEvents['cursor']>(),
    mode: vi.fn<FileEvents['mode']>(),
    jumped: vi.fn<FileEvents['jumped']>(),
    menu: vi.fn<FileEvents['menu']>(),
  };
}

/** A whole-file view of `src/a.ts`, as file `a`. */
function open(on: FileEvents = events(), init: Partial<FileInit> = {}): FileView {
  parent = document.createElement('div');
  parent.className = 'lo-app';
  document.body.append(parent);
  view = createFileView(
    parent,
    { id: 'a', path: 'src/a.ts', lines, vimKeys: motions, nonce: 'n', ...init },
    on,
  );
  // jsdom focuses only what it knows can take focus.
  for (const content of parent.querySelectorAll<HTMLElement>('.cm-content')) content.tabIndex = 0;
  return view;
}

/** Vim in the view's editor. */
function vim() {
  const content = parent!.querySelector<HTMLElement>('.cm-content');
  if (!content) throw new Error('The view has no editor.');
  // The editor itself, as only this folder's tests may reach it.
  const editor: unknown = Reflect.get(Reflect.get(Reflect.get(content, 'cmTile'), 'root'), 'view');
  const cm = editor instanceof EditorView ? getCM(editor) : null;
  if (!cm) throw new Error('The editor has no Vim.');
  return {
    content,
    keys(...keys: string[]): void {
      for (const key of keys) Vim.handleKey(cm, key, 'user');
    },
    get mode(): string {
      const state = cm.state.vim!;
      return state.insertMode ? 'insert' : state.visualMode ? 'visual' : 'normal';
    },
    get text(): string {
      return cm.getValue();
    },
    get cursor(): number {
      return cm.indexFromPos(cm.getCursor());
    },
  };
}

function at(line: number, side: 'old' | 'new' = 'new', file = 'a'): Place {
  return { file, side, line };
}

/** The cursor on a line of the file, as the view reports it and `reveal` takes it. */
function onLine(line: number, column?: number, side: 'old' | 'new' = 'new'): Spot {
  return {
    kind: 'line',
    at: column === undefined ? at(line, side) : { ...at(line, side), column },
  };
}

/** Where the cursor is, as a key there sees it. */
function cursorAt(shown: FileView) {
  return shown.keyState().target;
}

/** Each scroll asked of `element`, which jsdom, laying nothing out, never scrolls. */
function scrolled(element: HTMLElement): number[] {
  const sets: number[] = [];
  Object.defineProperty(element, 'scrollTop', {
    configurable: true,
    get: () => 0,
    set: (to: number) => {
      sets.push(to);
    },
  });
  return sets;
}

describe('places', () => {
  test('reveal takes a line, a column on it, or the last line of a span', () => {
    const shown = open();
    expect(shown.reveal(onLine(12))).toBe(true);
    expect(cursorAt(shown)).toEqual({ kind: 'line', at: { ...at(12), column: 0 } });
    shown.reveal(onLine(12, 3));
    expect(cursorAt(shown)).toEqual({ kind: 'line', at: { ...at(12), column: 3 } });
    shown.reveal({ kind: 'line', at: { file: 'a', side: 'new', from: 20, to: 15 } });
    expect(cursorAt(shown)).toMatchObject({ at: at(20) });
    // Past either end, it stops at the file's end.
    shown.reveal(onLine(99));
    expect(cursorAt(shown)).toMatchObject({ at: at(40) });
  });

  test('its header and its file are its first line', () => {
    const shown = open();
    shown.reveal(onLine(30));
    expect(shown.reveal({ kind: 'header', file: 'a', side: 'new' })).toBe(true);
    expect(cursorAt(shown)).toMatchObject({ at: at(1) });
    shown.reveal(onLine(30));
    expect(shown.reveal({ kind: 'file', file: 'a' })).toBe(true);
    expect(cursorAt(shown)).toMatchObject({ at: at(1) });
  });

  test('a place on another file or side, or a target of another kind, is refused', () => {
    const shown = open();
    shown.reveal(onLine(5));
    for (const target of [
      onLine(7, undefined, 'old'),
      { kind: 'line', at: at(7, 'new', 'b') },
      { kind: 'header', file: 'a', side: 'old' },
      { kind: 'file', file: 'b' },
      { kind: 'thread', thread: 't' },
      { kind: 'tab', tab: 'one' },
      { kind: 'none' },
    ] as const) {
      expect(shown.reveal(target)).toBe(false);
    }
    expect(cursorAt(shown)).toMatchObject({ at: at(5) });
  });

  test("the base's version puts its places on the old side", () => {
    const on = events();
    const shown = open(on, { side: 'old' });
    expect(shown.reveal(onLine(8))).toBe(false);
    expect(shown.reveal(onLine(8, undefined, 'old'))).toBe(true);
    shown.focus();
    expect(on.cursor).toHaveBeenLastCalledWith(onLine(8, 0, 'old'));
    expect(cursorAt(shown)).toEqual({ kind: 'line', at: { ...at(8, 'old'), column: 0 } });
  });

  test('a file with no lines has its cursor on its header', () => {
    const on = events();
    const shown = open(on, { lines: [] });
    expect(shown.reveal({ kind: 'file', file: 'a' })).toBe(true);
    expect(shown.reveal(onLine(3))).toBe(true);
    shown.focus();
    expect(on.cursor).toHaveBeenLastCalledWith({ kind: 'header', file: 'a', side: 'new' });
    expect(cursorAt(shown)).toEqual({ kind: 'header', file: 'a', side: 'new' });
    vim().keys('V');
    expect(cursorAt(shown)).toEqual({ kind: 'header', file: 'a', side: 'new' });
    // Its one empty line has no number.
    const numbers = [...parent!.querySelectorAll('.cm-lineNumbers .cm-gutterElement')].map(
      (each) => each.textContent,
    );
    expect(numbers.filter(Boolean)).toEqual([]);
  });

  test('showLine scrolls its own box alone to the line, leaving the cursor, and is no jump', async () => {
    const on = events();
    const shown = open(on);
    shown.reveal(onLine(3));
    const own = scrolled(parent!.querySelector<HTMLElement>('.lo-fileview')!);
    const around = scrolled(parent!);
    const page = scrolled(document.documentElement);
    // The editor scrolls to a line only once it has a height.
    Object.defineProperty(parent!.querySelector('.cm-scroller'), 'clientHeight', { value: 280 });
    shown.showLine(30);
    await vi.waitFor(() => expect(own.length).toBe(1));
    expect([around, page]).toEqual([[], []]);
    expect(cursorAt(shown)).toMatchObject({ at: at(3) });
    expect(on.jumped).not.toHaveBeenCalled();
    // A place revealed after it scrolls as the editor does.
    shown.reveal(onLine(1));
    expect(cursorAt(shown)).toMatchObject({ at: at(1) });
  });

  test('reveal leaves focus where it is, for focus() to move', () => {
    const shown = open();
    const outside = document.createElement('button');
    document.body.append(outside);
    outside.focus();
    shown.reveal(onLine(9));
    expect(document.activeElement).toBe(outside);
    shown.focus();
    expect(document.activeElement).toBe(vim().content);
    outside.remove();
  });
});

describe('jumps', () => {
  test('a jump goes out with its side and file, never into a list of Vim’s', () => {
    const on = events();
    const shown = open(on, { side: 'old' });
    shown.reveal(onLine(10, undefined, 'old'));
    shown.focus();
    const keys = vim();
    keys.keys('G');
    expect(on.jumped).toHaveBeenLastCalledWith(
      onLine(10, undefined, 'old'),
      onLine(40, undefined, 'old'),
    );
    keys.keys('5', 'G');
    expect(on.jumped).toHaveBeenLastCalledWith(
      onLine(40, undefined, 'old'),
      onLine(5, undefined, 'old'),
    );
    // Vim keeps no list of them: its own ⌃o has nowhere to go back to.
    const calls = on.jumped.mock.calls.length;
    const { cursor } = keys;
    keys.keys('<C-o>');
    expect(keys.cursor).toBe(cursor);
    expect(on.jumped).toHaveBeenCalledTimes(calls);
  });

  test("revealing a place isn't a jump, and drops a count typed before it", () => {
    const on = events();
    const shown = open(on);
    shown.reveal(onLine(3));
    vim().keys('2');
    expect(shown.keyState().pending).toBe(true);
    shown.reveal(onLine(30));
    expect(shown.keyState().pending).toBe(false);
    expect(on.jumped).not.toHaveBeenCalled();
  });

  test("Lo's motions, which stop at changes and files, stay put in a whole file", () => {
    const on = events();
    const shown = open(on);
    shown.reveal(onLine(3));
    vim().keys(']', 'c');
    vim().keys(']', 'f');
    expect(cursorAt(shown)).toMatchObject({ at: at(3) });
    expect(on.jumped).not.toHaveBeenCalled();
  });
});

/** Presses `keys` on line 10, and says what became of it. */
function pressing(keys: string[]) {
  const on = events();
  const shown = open(on);
  shown.reveal(onLine(10));
  shown.focus();
  const keyed = vim();
  const before = { text: keyed.text, cursor: keyed.cursor };
  keyed.keys(...keys);
  return { on, shown, keyed, before };
}

/** Each list of keys, titled by the keys it holds. */
function titled(lists: string[][]): (readonly [string, string[]])[] {
  return lists.map((keys) => [keys.join(''), keys] as const);
}

describe('insert mode', () => {
  const normal = [
    ['i'],
    ['I'],
    ['a'],
    ['A'],
    ['o'],
    ['O'],
    ['3', 'o'],
    ['s'],
    ['S'],
    ['C'],
    ['c', 'c'],
    ['c', 'w'],
    ['R'],
    ['g', 'i'],
    ['g', 'I'],
  ];
  const visual = [
    ['v', 'c'],
    ['v', 's'],
    ['V', 'c'],
    ['V', 'R'],
    ['<C-v>', 'I'],
    ['<C-v>', 'A'],
  ];

  test.each(titled(normal))(
    '%s doesn’t enter insert or replace mode in a whole file, nor move',
    (_, keys) => {
      const { on, shown, keyed, before } = pressing(keys);
      expect(keyed.mode).toBe('normal');
      expect(shown.keyState().mode).toBe('normal');
      expect(keyed.text).toBe(before.text);
      expect(keyed.cursor).toBe(before.cursor);
      expect(on.mode).not.toHaveBeenCalledWith('insert');
    },
  );

  test.each(titled(visual))(
    '%s doesn’t enter insert or replace mode from visual mode',
    (_, keys) => {
      const { on, shown, keyed, before } = pressing(keys);
      expect(keyed.mode).not.toBe('insert');
      expect(shown.keyState().mode).not.toBe('insert');
      expect(keyed.text).toBe(before.text);
      expect(on.mode).not.toHaveBeenCalledWith('insert');
    },
  );

  test.each(
    titled([['x'], ['d', 'd'], ['y', 'y', 'p'], ['J'], ['r', 'X'], ['>', '>'], ['~'], ['<C-a>']]),
  )('%s changes no text in a whole file', (_, keys) => {
    const { keyed, before } = pressing(keys);
    expect(keyed.text).toBe(before.text);
  });

  test(':startinsert leaves it in normal mode', () => {
    const { on, keyed } = pressing([':']);
    const prompt = parent!.querySelector('input');
    if (!prompt) throw new Error('Vim opened no prompt.');
    prompt.value = 'startinsert';
    prompt.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true, cancelable: true }),
    );
    expect(keyed.mode).toBe('normal');
    expect(on.mode).not.toHaveBeenCalledWith('insert');
  });
});

describe('keys', () => {
  test('it answers for the file scope, as long as it lasts', () => {
    const shown = open();
    const scope = findScope(vim().content);
    expect(scope.name).toBe('file');
    expect(isKeySource(scope.source) && scope.source).toBe(shown);
    shown.destroy();
    view = undefined;
    expect(parent!.querySelector('.lo-fileview')).toBeNull();
    expect(scope.element && findScope(scope.element).source).toBeUndefined();
  });

  test("keyState says Vim's mode and whether it's in the middle of a command", () => {
    const shown = open();
    shown.reveal(onLine(10));
    expect(shown.keyState()).toMatchObject({ mode: 'normal', pending: false });
    vim().keys('2');
    expect(shown.keyState().pending).toBe(true);
    shown.clearPending();
    expect(shown.keyState().pending).toBe(false);
    vim().keys('d');
    expect(shown.keyState().pending).toBe(true);
    shown.clearPending();
    vim().keys('l');
    // The `d` went: `l` moved alone, where `dl` would have been refused.
    expect(cursorAt(shown)).toEqual({ kind: 'line', at: { ...at(10), column: 1 } });
  });

  test('in visual mode, the target is the lines selected', () => {
    const shown = open();
    shown.reveal(onLine(20));
    // To line 23 by count: jsdom has no layout for `j` to go by.
    vim().keys('V', '2', '3', 'G');
    expect(shown.keyState()).toMatchObject({
      mode: 'visual',
      target: { kind: 'line', at: { file: 'a', side: 'new', from: 20, to: 23 } },
    });
    vim().keys('<Esc>');
    expect(shown.keyState().mode).toBe('normal');
  });

  test('passKeys hands keys to Vim, as if typed', () => {
    const shown = open();
    shown.reveal(onLine(10));
    shown.passKeys(['y', 'w']);
    expect(cursorAt(shown)).toMatchObject({ at: at(10) });
    shown.passKeys(['G']);
    expect(cursorAt(shown)).toMatchObject({ at: at(40) });
  });

  test('cursor and mode events follow the editor', () => {
    const on = events();
    const shown = open(on);
    shown.reveal(onLine(7));
    shown.focus();
    expect(on.cursor).toHaveBeenLastCalledWith(onLine(7, 0));
    vim().keys('w');
    expect(on.cursor).toHaveBeenLastCalledWith(onLine(7, 5));
    vim().keys('v');
    expect(on.mode).toHaveBeenLastCalledWith('visual');
    vim().keys('<Esc>');
    expect(on.mode).toHaveBeenLastCalledWith('normal');
  });
});

/** The numbers of the lines drawn with the class `name`. */
function drawn(name: string): number[] {
  return [...parent!.querySelectorAll(`.cm-line`)]
    .map((line, index) => (line.classList.contains(name) ? index + 1 : 0))
    .filter(Boolean);
}

describe('what it draws', () => {
  test('marks pick out their lines, on its file and side only', () => {
    const shown = open(events(), {
      marks: [{ kind: 'lines', at: { file: 'a', side: 'new', from: 4, to: 2 } }],
    });
    expect(drawn('lo-line-marked')).toEqual([2, 3, 4]);
    shown.setMarks([
      { kind: 'lines', at: { file: 'a', side: 'new', from: 7, to: 7 } },
      { kind: 'lines', at: { file: 'a', side: 'old', from: 9, to: 9 } },
      { kind: 'lines', at: { file: 'b', side: 'new', from: 11, to: 11 } },
    ]);
    expect(drawn('lo-line-marked')).toEqual([7]);
  });

  test("an overview's markers are the diff's, and left out", () => {
    const shown = open();
    shown.setMarks([
      {
        kind: 'overview',
        at: { file: 'a', side: 'new', from: 3, to: 5 },
        block: 'one',
        note: { label: 'Where to look', text: 'Why it changed.' },
      },
      { kind: 'lines', at: { file: 'a', side: 'new', from: 9, to: 9 } },
    ]);
    expect(drawn('lo-line-marked')).toEqual([9]);
    expect(parent!.querySelector('.lo-ov-marker, .lo-ovnote')).toBeNull();
  });

  test('tokens highlight its text, given at first or later', () => {
    const keyword = tokenNames.indexOf('keyword');
    // `line` on lines 1 and 2: each line is 6 characters and a line break, or 7 from line 10 on.
    const triples = Uint32Array.of(0, 4, keyword, 7, 11, keyword);
    const shown = open();
    expect(parent!.querySelectorAll('.lo-syn-keyword')).toHaveLength(0);
    shown.setTokens(triples);
    expect(
      [...parent!.querySelectorAll('.lo-syn-keyword')].map((each) => each.textContent),
    ).toEqual(['line', 'line']);
    shown.destroy();
    parent!.remove();
    open(events(), { tokens: triples });
    expect(parent!.querySelectorAll('.lo-syn-keyword')).toHaveLength(2);
  });

  test("a right-click on the code is its line's menu, or its header's in a file of no lines", () => {
    const click = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    const on = events();
    // jsdom has no layout, so every point is on the first line.
    const shown = open(on);
    parent!.querySelector('.cm-line')!.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    expect(on.menu).toHaveBeenLastCalledWith({ kind: 'line', at: at(1) }, 0, 0);
    shown.destroy();
    parent!.remove();
    open(on, { lines: [] });
    parent!.querySelector('.cm-line')!.dispatchEvent(new MouseEvent('contextmenu', click));
    expect(on.menu).toHaveBeenLastCalledWith({ kind: 'header', file: 'a', side: 'new' }, 0, 0);
  });

  test('a peek is refused until peeks are drawn, and closing none does nothing', () => {
    const shown = open();
    expect(() => shown.peek(at(3), undefined)).not.toThrow();
    expect(() =>
      shown.peek(at(3), { answers: [{ path: 'src/b.ts', line: 4, source: 'syntax' }], shown: 0 }),
    ).toThrow("The whole-file view doesn't draw peeks yet.");
  });
});
