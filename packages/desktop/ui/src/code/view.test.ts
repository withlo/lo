// @vitest-environment jsdom
import { EditorView } from '@codemirror/view';
import { diffText } from '@lo/diff';
import { getCM, Vim } from '@replit/codemirror-vim';
import { afterEach, beforeAll, describe, expect, type Mock, test, vi } from 'vitest';

import { findScope, isKeySource } from '../commands/index.ts';
import type {
  ComposerEvents,
  DiffEvents,
  DiffFile,
  DiffInit,
  DiffView,
  Place,
  VimKey,
} from './api.ts';
import { createDiffView } from './view.ts';

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

const numbered = (count: number, word = 'line'): string[] =>
  Array.from({ length: count }, (_, index) => `${word} ${index + 1}`);

/**
 * File `a`: line 5 changed, two lines added after 20, and line 35 removed. Its changes start on new
 * lines 5, 21 and 37, and three runs of unchanged lines are collapsed: new lines 10 to 17, 27 to 33
 * and 40 to 41.
 */
const aOld = numbered(40);
const aNew = [
  ...aOld.slice(0, 4),
  'line 5, changed',
  ...aOld.slice(5, 20),
  'added one',
  'added two',
  ...aOld.slice(20, 34),
  ...aOld.slice(35),
];

const files: DiffFile[] = [
  {
    id: 'a',
    path: 'src/a.ts',
    change: 'modified',
    lines: { old: aOld, new: aNew },
    header: { additions: 3, deletions: 2 },
  },
  {
    id: 'b',
    path: 'src/b.ts',
    change: 'added',
    lines: { old: [], new: numbered(10, 'b') },
    header: { additions: 10, deletions: 0 },
  },
  {
    id: 'c',
    path: 'src/c.ts',
    change: 'deleted',
    lines: { old: numbered(8, 'c'), new: [] },
    header: { additions: 0, deletions: 8 },
  },
  {
    id: 'd',
    path: 'big.json',
    change: 'modified',
    skip: 'large',
    header: { additions: 9000, deletions: 9000 },
  },
];

const motions: VimKey[] = [
  { kind: 'motion', command: 'diff.nextChange', keys: ']c' },
  { kind: 'motion', command: 'diff.previousChange', keys: '[c' },
  { kind: 'motion', command: 'diff.nextFile', keys: ']f' },
  { kind: 'motion', command: 'diff.previousFile', keys: '[f' },
  { kind: 'motion', command: 'diff.nextThread', keys: ']t' },
  { kind: 'motion', command: 'diff.previousThread', keys: '[t' },
];

let view: DiffView | undefined;
let parent: HTMLElement | undefined;

afterEach(() => {
  view?.destroy();
  parent?.remove();
  view = undefined;
});

type Spied<T> = { [K in keyof T]: T[K] extends (...args: never[]) => unknown ? Mock<T[K]> : never };

function events(): Spied<DiffEvents> {
  return {
    cursor: vi.fn<DiffEvents['cursor']>(),
    mode: vi.fn<DiffEvents['mode']>(),
    file: vi.fn<DiffEvents['file']>(),
    jumped: vi.fn<DiffEvents['jumped']>(),
    load: vi.fn<DiffEvents['load']>(),
    menu: vi.fn<DiffEvents['menu']>(),
  };
}

function composerEvents(): Spied<ComposerEvents> {
  return {
    change: vi.fn<ComposerEvents['change']>(),
    submit: vi.fn<ComposerEvents['submit']>(),
    close: vi.fn<ComposerEvents['close']>(),
  };
}

/** A diff view of the files above, every diff in. */
function open(on: DiffEvents = events(), init: Partial<DiffInit> = {}): DiffView {
  parent = document.createElement('div');
  parent.className = 'lo-app';
  document.body.append(parent);
  view = createDiffView(
    parent,
    { files, layout: 'split', vimKeys: motions, nonce: 'n', ...init },
    on,
  );
  for (const file of files) {
    if (file.lines) view.setDiff(file.id, diffOf(file.lines));
  }
  focusable();
  return view;
}

function diffOf(lines: { old: readonly string[]; new: readonly string[] }) {
  return diffText(textOf(lines.old), textOf(lines.new));
}

function textOf(lines: readonly string[]): string | undefined {
  return lines.length === 0 ? undefined : lines.join('\n');
}

/** jsdom focuses only what it knows can take focus. */
function focusable(): void {
  for (const content of parent!.querySelectorAll<HTMLElement>('.cm-content')) content.tabIndex = 0;
}

/** Vim in the editor labelled `label`: `Before`, `After`, `Changes` or `Comment`. */
function vimIn(label: string) {
  focusable();
  const content = parent!.querySelector<HTMLElement>(`.cm-content[aria-label="${label}"]`);
  if (!content) throw new Error(`No editor is labelled ${label}.`);
  // The editor itself, as only this folder's tests may reach it.
  const editor: unknown = Reflect.get(Reflect.get(Reflect.get(content, 'cmTile'), 'root'), 'view');
  const cm = editor instanceof EditorView ? getCM(editor) : null;
  if (!cm) throw new Error(`The editor labelled ${label} has no Vim.`);
  return {
    content,
    keys(...keys: string[]): void {
      for (const key of keys) Vim.handleKey(cm, key, 'user');
    },
    get mode(): string {
      const vim = cm.state.vim!;
      return vim.insertMode ? 'insert' : vim.visualMode ? 'visual' : 'normal';
    },
    get text(): string {
      return cm.getValue();
    },
    get cursor(): number {
      return cm.indexFromPos(cm.getCursor());
    },
  };
}

/** Presses a key in `element`, as the page sends it. */
function press(element: Element, key: string, modifiers: KeyboardEventInit = {}): void {
  element.dispatchEvent(
    new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...modifiers }),
  );
}

function at(file: string, side: 'old' | 'new', line: number): Place {
  return { file, side, line };
}

/** The collapsed runs drawn in file `a` on the new side. */
function collapsed(): number {
  return parent!.querySelectorAll('.cm-content[aria-label="After"] [data-row^="c:0:"]').length;
}

function notes(): string[] {
  return [...parent!.querySelectorAll('.cm-content[aria-label="After"] .lo-filenote')].map(
    (note) => note.textContent ?? '',
  );
}

describe('places', () => {
  test('a file line goes to its document line and back, on each side and inline', () => {
    const shown = open();
    const places = [at('a', 'new', 22), at('a', 'old', 35), at('b', 'new', 7), at('c', 'old', 3)];
    for (const place of places) {
      shown.reveal(place);
      expect(shown.probe.cursor()?.at).toMatchObject(place);
      expect(shown.keyState().target).toMatchObject({ kind: 'line', at: place });
    }
    shown.setLayout('inline');
    expect(shown.probe.layout).toBe('inline');
    for (const place of [at('a', 'new', 22), at('a', 'old', 35), at('b', 'new', 7)]) {
      shown.reveal(place);
      expect(shown.probe.cursor()).toMatchObject({ at: place, pane: 'inline' });
    }
  });

  test("a file's header is line 0, where revealing the file goes", () => {
    const shown = open();
    shown.reveal({ file: 'b' });
    expect(shown.probe.cursor()?.at).toEqual(at('b', 'new', 0));
    shown.reveal(at('c', 'old', 2));
    shown.reveal({ file: 'a' });
    expect(shown.probe.cursor()?.at).toEqual(at('a', 'old', 0));
  });

  test("a column puts the cursor on the line's character", () => {
    const shown = open();
    shown.reveal({ ...at('a', 'new', 5), column: 7 });
    expect(shown.probe.cursor()?.at).toEqual({ ...at('a', 'new', 5), column: 7 });
  });

  test("lines gives a span's text, either way round", () => {
    const shown = open();
    const added = ['line 20', 'added one', 'added two'];
    expect(shown.lines({ file: 'a', side: 'new', from: 20, to: 22 })).toEqual(added);
    expect(shown.lines({ file: 'a', side: 'new', from: 22, to: 20 })).toEqual(added);
    expect(shown.lines({ file: 'c', side: 'old', from: 7, to: 99 })).toEqual(['c 7', 'c 8']);
    expect(shown.lines({ file: 'b', side: 'old', from: 1, to: 3 })).toEqual([]);
  });

  test("a file the view doesn't have is refused", () => {
    const shown = open();
    expect(() => shown.reveal(at('z', 'new', 1))).toThrow('no file z');
  });
});

describe('jumps', () => {
  test('a count goes that many changes, files or threads, and back where it is negative', () => {
    const shown = open();
    shown.setThreads([
      { id: 't1', at: at('a', 'new', 3), comments: [] },
      { id: 't2', at: at('b', 'new', 4), comments: [] },
    ]);
    shown.reveal(at('a', 'new', 1));
    shown.jump('change', 2);
    expect(shown.probe.cursor()?.at).toMatchObject(at('a', 'new', 21));
    shown.jump('change', -1);
    expect(shown.probe.cursor()?.at).toMatchObject(at('a', 'new', 5));
    // On into the next files, where an added file is one change.
    shown.jump('change', 3);
    expect(shown.probe.cursor()?.at).toMatchObject(at('b', 'new', 1));
    shown.reveal(at('a', 'new', 5));
    // As far as there is: a file deleted is one change at its header on the new side.
    shown.jump('change', 9);
    expect(shown.probe.cursor()?.at).toEqual(at('c', 'new', 0));
    shown.reveal(at('a', 'new', 37));
    shown.jump('file', 2);
    expect(shown.probe.cursor()?.at).toEqual(at('c', 'new', 0));
    shown.jump('file', -1);
    expect(shown.probe.cursor()?.at).toEqual(at('b', 'new', 0));
    shown.jump('thread', -1);
    expect(shown.probe.cursor()?.at).toMatchObject(at('a', 'new', 3));
    shown.jump('thread', 1);
    expect(shown.probe.cursor()?.at).toMatchObject(at('b', 'new', 4));
  });

  test("Vim runs Lo's motions with counts, under the keys it's given", () => {
    const shown = open();
    shown.reveal(at('a', 'new', 1));
    const after = vimIn('After');
    after.keys('2', ']', 'c');
    expect(shown.probe.cursor()?.at).toMatchObject(at('a', 'new', 21));
    after.keys(']', 'f');
    expect(shown.probe.cursor()?.at).toEqual(at('b', 'new', 0));
    shown.setVimKeys([{ kind: 'motion', command: 'diff.nextFile', keys: ']n' }]);
    after.keys(']', 'f');
    expect(shown.probe.cursor()?.at).toEqual(at('b', 'new', 0));
    after.keys(']', 'n');
    expect(shown.probe.cursor()?.at).toEqual(at('c', 'new', 0));
    shown.setVimKeys([...motions, { kind: 'map', mode: 'normal', keys: 'Q', to: 'gg' }]);
    after.keys('Q');
    expect(shown.probe.cursor()?.at).toEqual(at('a', 'new', 0));
  });

  test('a jump goes out with its side and file, never into a list of Vim’s', () => {
    const on = events();
    const shown = open(on);
    shown.reveal(at('a', 'new', 2));
    const after = vimIn('After');
    after.keys(']', 'f');
    expect(on.jumped).toHaveBeenLastCalledWith(at('a', 'new', 2), at('b', 'new', 0));
    after.keys('G');
    expect(on.jumped).toHaveBeenLastCalledWith(at('b', 'new', 0), at('d', 'new', 0));
    shown.reveal(at('a', 'new', 21));
    shown.otherSide();
    expect(on.jumped).toHaveBeenLastCalledWith(at('a', 'new', 21), at('a', 'old', 20));
    expect(shown.probe.cursor()?.at).toMatchObject(at('a', 'old', 20));
    shown.jump('change', 1);
    expect(on.jumped).toHaveBeenLastCalledWith(at('a', 'old', 20), at('a', 'old', 21));
    // Going back is the tab's history's to do: Vim's own `⌃o` has nowhere to go.
    const calls = on.jumped.mock.calls.length;
    vimIn('Before').keys('<C-o>');
    expect(shown.probe.cursor()?.at).toMatchObject(at('a', 'old', 21));
    expect(on.jumped).toHaveBeenCalledTimes(calls);
  });

  test("revealing a place isn't a jump, and drops a count typed before it", () => {
    const on = events();
    const shown = open(on);
    shown.reveal(at('a', 'new', 2));
    vimIn('After').keys('2');
    expect(shown.keyState().pending).toBe(true);
    shown.reveal(at('b', 'new', 3));
    expect(shown.keyState().pending).toBe(false);
    expect(on.jumped).not.toHaveBeenCalled();
  });
});

describe('folds', () => {
  test('open and close take the run at a place, file opens every run, toggle closes the file', () => {
    const shown = open();
    expect(collapsed()).toBe(3);
    shown.fold(at('a', 'new', 12), 'open');
    expect(collapsed()).toBe(2);
    shown.fold(at('a', 'old', 12), 'close');
    expect(collapsed()).toBe(3);
    shown.fold(at('a', 'new', 1), 'file');
    expect(collapsed()).toBe(0);
    shown.fold(at('a', 'new', 0), 'toggle');
    expect(notes()).toEqual(['+3 −2, closed: za opens it']);
    shown.fold(at('a', 'new', 3), 'toggle');
    expect(notes()).toEqual([]);
  });

  test('a file kept out is asked for, and comes in with its lines', () => {
    const on = events();
    const shown = open(on);
    const lines = { old: numbered(4, 'd'), new: [...numbered(4, 'd'), 'd 5'] };
    // Drawn, at the end of the documents.
    shown.reveal({ file: 'd' });
    expect(notes()).toEqual(['18000 changed lines: za loads them']);
    shown.fold(at('d', 'new', 0), 'toggle');
    expect(on.load).toHaveBeenCalledWith('d');
    expect(notes()).toEqual(['Loading the file…']);
    shown.loadFailed('d');
    expect(notes()).toEqual(['The file couldn’t be loaded: za tries again']);
    shown.fold(at('d', 'new', 0), 'toggle');
    expect(on.load).toHaveBeenCalledTimes(2);
    shown.setLines('d', lines);
    shown.setDiff('d', diffOf(lines));
    expect(notes()).toEqual([]);
    shown.reveal(at('d', 'new', 5));
    expect(shown.probe.cursor()?.at).toMatchObject(at('d', 'new', 5));
    expect(shown.lines({ file: 'd', side: 'new', from: 5, to: 5 })).toEqual(['d 5']);
  });
});

describe('targets', () => {
  test("a key's target is the line's only thread, or the one ]t landed on", () => {
    const shown = open();
    shown.setThreads([
      { id: 'alone', at: at('a', 'new', 10), comments: [] },
      { id: 'first', at: at('a', 'new', 25), comments: [] },
      { id: 'second', at: at('a', 'new', 25), comments: [] },
    ]);
    shown.reveal(at('a', 'new', 10));
    expect(shown.keyState().target).toMatchObject({ at: at('a', 'new', 10), thread: 'alone' });
    shown.reveal(at('a', 'new', 25));
    expect(shown.keyState().target).not.toHaveProperty('thread');
    shown.reveal(at('a', 'new', 12));
    vimIn('After').keys(']', 't');
    expect(shown.keyState().target).toMatchObject({ at: at('a', 'new', 25), thread: 'first' });
    vimIn('After').keys('k');
    expect(shown.keyState().target).not.toHaveProperty('thread');
  });

  test('in visual mode, the target is the lines selected', () => {
    const shown = open();
    shown.reveal(at('a', 'new', 20));
    const after = vimIn('After');
    // To document line 23, file line 22, by count: jsdom has no layout for `j` to go by.
    after.keys('V', '2', '3', 'G');
    expect(shown.keyState()).toMatchObject({
      mode: 'visual',
      target: { kind: 'line', at: { file: 'a', side: 'new', from: 20, to: 22 } },
    });
    after.keys('<Esc>');
    expect(shown.keyState().mode).toBe('normal');
  });

  test('a right-click on a thread is its menu', () => {
    const on = events();
    const shown = open(on);
    shown.setThreads([
      { id: 'right', at: at('a', 'new', 10), comments: [{ author: 'you', body: 'Hi' }] },
    ]);
    const card = parent!.querySelector('[data-thread-id="right"]')!;
    card.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    expect(on.menu).toHaveBeenCalledWith({ kind: 'thread', thread: 'right' }, 0, 0);
  });
});

/** Presses `keys` on a line of a diff, and says what became of it. */
function pressing(keys: string[]) {
  const on = events();
  const shown = open(on);
  shown.reveal(at('a', 'new', 10));
  const after = vimIn('After');
  const before = { text: after.text, cursor: after.cursor };
  after.keys(...keys);
  return { on, shown, after, before };
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

  test.each(normal)('%s doesn’t enter insert or replace mode in a diff, nor move', (...keys) => {
    const { on, shown, after, before } = pressing(keys);
    expect(after.mode).toBe('normal');
    expect(shown.keyState().mode).toBe('normal');
    expect(after.text).toBe(before.text);
    expect(after.cursor).toBe(before.cursor);
    expect(on.mode).not.toHaveBeenCalledWith('insert');
  });

  test.each(visual)('%s doesn’t enter insert or replace mode from visual mode', (...keys) => {
    const { on, shown, after, before } = pressing(keys);
    expect(after.mode).not.toBe('insert');
    expect(shown.keyState().mode).not.toBe('insert');
    expect(after.text).toBe(before.text);
    expect(on.mode).not.toHaveBeenCalledWith('insert');
  });

  test.each([['x'], ['d', 'd'], ['y', 'y', 'p'], ['J'], ['r', 'X'], ['>', '>'], ['~'], ['<C-a>']])(
    '%s changes no text in a diff',
    (...keys) => {
      open();
      view!.reveal(at('a', 'new', 10));
      const after = vimIn('After');
      const { text } = after;
      after.keys(...keys);
      expect(after.text).toBe(text);
    },
  );
});

describe('comment boxes', () => {
  test('a box opens with its draft, in insert mode, as a scope of its own', () => {
    const shown = open();
    const on = composerEvents();
    const box = shown.compose(at('a', 'new', 10), 'A draft', on);
    expect(box.text).toBe('A draft');
    const comment = vimIn('Comment');
    expect(comment.mode).toBe('insert');
    box.insert('!');
    expect(box.text).toBe('A draft!');
    expect(on.change).toHaveBeenLastCalledWith('A draft!');
    box.insert(' More.');
    expect(box.text).toBe('A draft! More.');
    const scope = findScope(comment.content);
    expect(scope.name).toBe('box');
    expect(isKeySource(scope.source) && scope.source.keyState()).toMatchObject({
      mode: 'insert',
      target: { kind: 'line', at: at('a', 'new', 10) },
    });
    expect(findScope(vimIn('After').content).name).toBe('diff');
  });

  test('a box under a thread, or the last line of a span, acts on them', () => {
    const shown = open();
    shown.setThreads([{ id: 'here', at: at('a', 'new', 10), comments: [] }]);
    shown.compose({ thread: 'here' }, '', composerEvents());
    const scope = findScope(vimIn('Comment').content);
    expect(isKeySource(scope.source) && scope.source.keyState().target).toEqual({
      kind: 'line',
      at: at('a', 'new', 10),
      thread: 'here',
    });
    const span = { file: 'a', side: 'old', from: 2, to: 4 } as const;
    const second = shown.compose(span, 'On three lines', composerEvents());
    expect(second.text).toBe('On three lines');
    expect(parent!.querySelectorAll('.lo-diffcomposer')).toHaveLength(2);
  });

  test('⌘⏎ adds to the review, ⌥⏎ posts now, and Esc Esc closes, keeping the draft', () => {
    const shown = open();
    const on = composerEvents();
    shown.compose(at('a', 'new', 10), 'Hello', on);
    const { content } = vimIn('Comment');
    // jsdom isn't a Mac, so `⌘` is Ctrl.
    press(content, 'Enter', { ctrlKey: true });
    expect(on.submit).toHaveBeenLastCalledWith('review');
    press(content, 'Enter', { altKey: true });
    expect(on.submit).toHaveBeenLastCalledWith('now');
    press(content, 'Escape');
    expect(vimIn('Comment').mode).toBe('normal');
    press(content, 'Escape');
    expect(on.close).toHaveBeenCalledWith(true);
    expect(parent!.querySelector('.lo-diffcomposer')).toBeNull();
    expect(shown.probe.cursor()?.at).toMatchObject(at('a', 'new', 10));
  });

  test('an empty box closes with nothing to keep, and close() closes it quietly', () => {
    const shown = open();
    const on = composerEvents();
    shown.compose(at('a', 'new', 10), '', on);
    const { content } = vimIn('Comment');
    press(content, 'Escape');
    press(content, 'Escape');
    expect(on.close).toHaveBeenCalledWith(false);
    const quiet = composerEvents();
    shown.compose(at('a', 'new', 12), 'x', quiet).close();
    expect(quiet.close).not.toHaveBeenCalled();
    expect(parent!.querySelector('.lo-diffcomposer')).toBeNull();
  });

  test("a box keeps its own jumps, which aren't the diff's", () => {
    const on = events();
    const shown = open(on);
    shown.compose(at('a', 'new', 10), 'one\ntwo\nthree\nfour', composerEvents());
    const comment = vimIn('Comment');
    comment.keys('<Esc>', 'g', 'g', '3', 'G');
    const line = () => comment.text.slice(0, comment.cursor).split('\n').length;
    expect(line()).toBe(3);
    comment.keys('<C-o>');
    expect(line()).toBe(1);
    comment.keys('<C-o>');
    expect(line()).toBe(4);
    comment.keys('<C-i>');
    expect(line()).toBe(1);
    expect(on.jumped).not.toHaveBeenCalled();
  });

  test('a box opened where one is open is the same box', () => {
    const shown = open();
    const first = shown.compose(at('a', 'new', 10), 'First', composerEvents());
    const again = shown.compose(at('a', 'new', 10), 'Second', composerEvents());
    expect(again).toBe(first);
    expect(again.text).toBe('First');
  });

  test("a box goes only under a line that's shown", () => {
    const shown = open();
    const shownLine = 'A comment box goes under a line of a file that is shown.';
    expect(() => shown.compose(at('a', 'new', 0), '', composerEvents())).toThrow(shownLine);
    expect(() => shown.compose(at('d', 'new', 1), '', composerEvents())).toThrow(shownLine);
  });
});

describe('keys', () => {
  test("keyState says Vim's mode and whether it's in the middle of a command", () => {
    const shown = open();
    shown.reveal(at('a', 'new', 10));
    const after = vimIn('After');
    expect(shown.keyState()).toMatchObject({ mode: 'normal', pending: false });
    after.keys('2');
    expect(shown.keyState().pending).toBe(true);
    shown.clearPending();
    expect(shown.keyState().pending).toBe(false);
    after.keys('d');
    expect(shown.keyState().pending).toBe(true);
    shown.clearPending();
    after.keys('l');
    // The `d` went: `l` moved alone, where `dl` would have been refused.
    expect(shown.probe.cursor()?.at).toEqual({ ...at('a', 'new', 10), column: 1 });
    after.keys('v');
    expect(shown.keyState()).toMatchObject({ mode: 'visual', pending: false });
    shown.clearPending();
    expect(shown.keyState().mode).toBe('visual');
  });

  test('passKeys hands keys to Vim, as if typed', () => {
    const shown = open();
    shown.reveal(at('a', 'new', 10));
    shown.passKeys(['y', 'w']);
    expect(shown.probe.cursor()?.at).toMatchObject(at('a', 'new', 10));
    shown.passKeys(['g', 'g']);
    expect(shown.probe.cursor()?.at).toEqual(at('a', 'new', 0));
  });

  test('cursor and mode events follow the focused editor', () => {
    const on = events();
    const shown = open(on);
    shown.reveal(at('a', 'old', 7));
    expect(on.cursor).toHaveBeenLastCalledWith({ ...at('a', 'old', 7), column: 0 });
    vimIn('Before').keys('v');
    expect(on.mode).toHaveBeenLastCalledWith('visual');
    vimIn('Before').keys('<Esc>');
    expect(on.mode).toHaveBeenLastCalledWith('normal');
  });
});

describe('the file on screen', () => {
  test('is said once the editor has measured, and again only when it changes', async () => {
    const on = events();
    open(on);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(on.file.mock.calls).toEqual([['a']]);
  });
});

describe('headers and notes', () => {
  test("a header shows what it's given", () => {
    const shown = open();
    shown.reveal({ file: 'b' });
    shown.setHeader('b', { additions: 10, deletions: 0, viewed: true, comments: 2, tags: ['new'] });
    const header = parent!.querySelector('.cm-content[aria-label="After"] [data-row="h:1"]')!;
    expect(header.classList.contains('is-viewed')).toBe(true);
    expect(header.textContent).toContain('new · 2 comments');
  });

  test('a note on the comparison sits above the sides', () => {
    open(events(), { note: { text: 'r3 → r5, since you last looked', tone: 'info' } });
    const note = parent!.querySelector('.lo-diffview > .lo-diffnote--info');
    expect(note?.textContent).toBe('r3 → r5, since you last looked');
  });
});
