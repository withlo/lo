// @vitest-environment jsdom
import { StateEffect } from '@codemirror/state';
import { BlockInfo, EditorView } from '@codemirror/view';
import { diffText } from '@lo/diff';
import { getCM, Vim } from '@replit/codemirror-vim';
import { afterEach, beforeAll, describe, expect, type Mock, test, vi } from 'vitest';

import { findScope, isKeySource } from '../commands/index.ts';
import type {
  BoxFrame,
  ComposerEvents,
  DiffEvents,
  DiffFile,
  DiffInit,
  DiffView,
  Mark,
  Place,
  RenderThread,
  Spot,
  ThreadView,
  VimKey,
} from './api.ts';
import { Aligner } from './aligner.ts';
import { createComposer } from './composer.ts';
import { editsText } from './keys.ts';
import { focusedMode } from './mode.ts';
import { swapping } from './lines.ts';
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
  for (const file of init.files ?? files) {
    if (file.lines) view.setDiff(file.id, diffOf(file.lines));
  }
  focusable();
  return view;
}

function diffOf(lines: { old: readonly string[]; new: readonly string[] }) {
  return diffText(textOf(lines.old), textOf(lines.new));
}

function textOf(lines: readonly string[]): string | undefined {
  // A line break ends every line, so blank lines at the end count.
  return lines.length === 0 ? undefined : `${lines.join('\n')}\n`;
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

/** A thread under the line at `place`, open unless it says. */
function thread(id: string, place: Place, opened = true, version = 1): ThreadView {
  return { id, at: place, open: opened, version };
}

/** A thread on file `file`, under its header. */
function onFile(id: string, file: string): ThreadView {
  return { id, at: { file }, open: true, version: 1 };
}

/** A thread as `plain` draws it: what it shows. */
function shownAs(shown: ThreadView): string {
  return `${shown.id}: ${shown.open ? 'open' : 'collapsed'}, version ${shown.version}`;
}

/**
 * A caller's threads, drawn as one line of plain text each, which say what they show, with what it
 * was asked to do in turn.
 */
function plain() {
  const asked: string[] = [];
  const render: RenderThread = (host, shown) => {
    asked.push(`draw ${shown.id}`);
    host.textContent = shownAs(shown);
    return {
      update(next) {
        asked.push(`update ${next.id}`);
        host.textContent = shownAs(next);
      },
      destroy() {
        asked.push(`destroy ${shown.id}`);
      },
    };
  };
  return { render, asked };
}

/** The cursor on a file's line, as the view reports it and `reveal` takes it. */
function onLine(file: string, side: 'old' | 'new', line: number, column?: number): Spot {
  return {
    kind: 'line',
    at: column === undefined ? at(file, side, line) : { ...at(file, side, line), column },
  };
}

/** The cursor on a file's header. */
function onHeader(file: string, side: 'old' | 'new'): Spot {
  return { kind: 'header', file, side };
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

/** Each list of keys, titled by the keys it holds. */
function titled(lists: string[][]): (readonly [string, string[]])[] {
  return lists.map((keys) => [keys.join(''), keys] as const);
}

/** The labels on moved code drawn in the editor labelled `label`. */
function labels(label: string): (string | null)[] {
  return [...parent!.querySelectorAll(`.cm-content[aria-label="${label}"] .lo-movedlabel`)].map(
    (each) => each.textContent,
  );
}

/** Lines 7 to 24 of `lines` as placeholders, as GitHub's diff leaves them out. */
function placeholders(lines: string[]): string[] {
  return lines.map((each, index) => (index >= 6 && index <= 23 ? '' : each));
}

/** Lines 7 to 24 of `lines` left out, not held as placeholders. */
function leftOut(lines: string[]): string[] {
  return [...lines.slice(0, 6), ...lines.slice(24)];
}

/** The last of ten lines as a placeholder. */
function lastBlank(lines: string[]): string[] {
  return lines.map((each, index) => (index === 9 ? '' : each));
}

/** Lines 1 and 9 on of `lines` as placeholders. */
function blank(lines: string[]): string[] {
  return lines.map((each, index) => (index === 0 || index >= 8 ? '' : each));
}

/** What each block of collapsed lines drawn on the new side says. */
function runs(): string[] {
  return [...parent!.querySelectorAll('.cm-content[aria-label="After"] .lo-collapsed')].map(
    (each) => each.lastElementChild?.textContent ?? '',
  );
}

describe('places', () => {
  test('a file line goes to its document line and back, on each side and inline', () => {
    const shown = open();
    const places = [at('a', 'new', 22), at('a', 'old', 35), at('b', 'new', 7), at('c', 'old', 3)];
    for (const place of places) {
      shown.reveal({ kind: 'line', at: place });
      expect(shown.probe.cursor()?.at).toMatchObject({ kind: 'line', at: place });
      expect(shown.keyState().target).toMatchObject({ kind: 'line', at: place });
    }
    shown.setLayout('inline');
    expect(shown.probe.layout).toBe('inline');
    for (const place of [at('a', 'new', 22), at('a', 'old', 35), at('b', 'new', 7)]) {
      shown.reveal({ kind: 'line', at: place });
      expect(shown.probe.cursor()).toMatchObject({
        at: { kind: 'line', at: place },
        pane: 'inline',
      });
    }
  });

  test("a file's header is a target of its own, on the side the cursor was on", () => {
    const shown = open();
    shown.reveal({ kind: 'file', file: 'b' });
    expect(shown.probe.cursor()?.at).toEqual(onHeader('b', 'new'));
    expect(shown.keyState().target).toEqual(onHeader('b', 'new'));
    shown.reveal(onLine('c', 'old', 2));
    shown.reveal({ kind: 'file', file: 'a' });
    expect(shown.probe.cursor()?.at).toEqual(onHeader('a', 'old'));
    shown.reveal(onHeader('a', 'new'));
    expect(shown.keyState().target).toEqual(onHeader('a', 'new'));
  });

  test("the cursor on a header draws no letter of the path the header's line holds", () => {
    const shown = open();
    const after = parent?.querySelectorAll('.cm-editor')[1];
    shown.reveal({ kind: 'file', file: 'b' });
    expect(after?.classList.contains('lo-onheader')).toBe(true);
    shown.reveal(onLine('a', 'new', 5));
    expect(after?.classList.contains('lo-onheader')).toBe(false);
  });

  test("reveal takes a thread's line, and says whether it could", () => {
    const shown = open();
    shown.setThreads([thread('here', at('b', 'new', 6))], plain().render);
    expect(shown.reveal({ kind: 'thread', thread: 'here' })).toBe(true);
    expect(shown.probe.cursor()?.at).toMatchObject(onLine('b', 'new', 6));
    expect(shown.reveal({ kind: 'thread', thread: 'gone' })).toBe(false);
    expect(shown.reveal(onLine('z', 'new', 1))).toBe(false);
    expect(shown.reveal({ kind: 'tab', tab: 'pull' })).toBe(false);
    expect(shown.probe.cursor()?.at).toMatchObject(onLine('b', 'new', 6));
  });

  test('reveal leaves focus where it is, for focus() to move', () => {
    const shown = open();
    const elsewhere = document.createElement('button');
    document.body.append(elsewhere);
    elsewhere.focus();
    shown.reveal(onLine('a', 'old', 12));
    expect(document.activeElement).toBe(elsewhere);
    shown.focus();
    expect(document.activeElement).toBe(vimIn('Before').content);
    // Revealed on the other side, focus follows it there, not to the editor that has it.
    shown.reveal(onLine('a', 'new', 12));
    expect(document.activeElement).toBe(vimIn('Before').content);
    shown.focus();
    expect(document.activeElement).toBe(vimIn('After').content);
    elsewhere.remove();
  });

  test("a column puts the cursor on the line's character", () => {
    const shown = open();
    shown.reveal(onLine('a', 'new', 5, 7));
    expect(shown.probe.cursor()?.at).toEqual(onLine('a', 'new', 5, 7));
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
    expect(() => shown.setDiff('z', diffOf({ old: [], new: ['z'] }))).toThrow('no file z');
  });
});

describe('jumps', () => {
  test('a count goes that many changes, files or threads, and back where it is negative', () => {
    const shown = open();
    shown.setThreads(
      [thread('t1', at('a', 'new', 3)), thread('t2', at('b', 'new', 4))],
      plain().render,
    );
    shown.reveal(onLine('a', 'new', 1));
    shown.jump('change', 2);
    expect(shown.probe.cursor()?.at).toMatchObject(onLine('a', 'new', 21));
    shown.jump('change', -1);
    expect(shown.probe.cursor()?.at).toMatchObject(onLine('a', 'new', 5));
    // On into the next files, where an added file is one change.
    shown.jump('change', 3);
    expect(shown.probe.cursor()?.at).toMatchObject(onLine('b', 'new', 1));
    shown.reveal(onLine('a', 'new', 5));
    // As far as there is: a file deleted is one change at its header on the new side.
    shown.jump('change', 9);
    expect(shown.probe.cursor()?.at).toEqual(onHeader('c', 'new'));
    shown.reveal(onLine('a', 'new', 37));
    shown.jump('file', 2);
    expect(shown.probe.cursor()?.at).toEqual(onHeader('c', 'new'));
    shown.jump('file', -1);
    expect(shown.probe.cursor()?.at).toEqual(onHeader('b', 'new'));
    shown.jump('thread', -1);
    expect(shown.probe.cursor()?.at).toMatchObject(onLine('a', 'new', 3));
    shown.jump('thread', 1);
    expect(shown.probe.cursor()?.at).toMatchObject(onLine('b', 'new', 4));
  });

  test('side by side, a thread under the other column’s line is a stop beside it, and acts there', () => {
    const shown = open();
    shown.setThreads(
      [
        thread('t1', at('a', 'new', 3)),
        thread('old', at('a', 'old', 5)),
        thread('t2', at('b', 'new', 4)),
      ],
      plain().render,
    );
    shown.reveal(onLine('a', 'new', 1));
    const after = vimIn('After');
    after.keys(']', 't');
    expect(shown.probe.cursor()?.at).toMatchObject(onLine('a', 'new', 3));
    after.keys(']', 't');
    expect(shown.probe.cursor()?.at).toMatchObject(onLine('a', 'new', 5));
    expect(shown.keyState().target).toMatchObject({ kind: 'line', thread: 'old' });
    shown.jump('thread', 1);
    expect(shown.probe.cursor()?.at).toMatchObject(onLine('b', 'new', 4));
    shown.jump('thread', -1);
    expect(shown.keyState().target).toMatchObject({ kind: 'line', thread: 'old' });
    // From the old column, the new column's threads are stops beside their lines.
    shown.reveal(onLine('a', 'new', 1));
    shown.otherSide();
    shown.jump('thread', 1);
    expect(shown.probe.cursor()?.at).toMatchObject(onLine('a', 'old', 3));
    expect(shown.keyState().target).toMatchObject({ kind: 'line', thread: 't1' });
  });

  test("Vim runs Lo's motions with counts, under the keys it's given", () => {
    const shown = open();
    shown.reveal(onLine('a', 'new', 1));
    const after = vimIn('After');
    after.keys('2', ']', 'c');
    expect(shown.probe.cursor()?.at).toMatchObject(onLine('a', 'new', 21));
    after.keys(']', 'f');
    expect(shown.probe.cursor()?.at).toEqual(onHeader('b', 'new'));
    shown.setVimKeys([{ kind: 'motion', command: 'diff.nextFile', keys: ']n' }]);
    after.keys(']', 'f');
    expect(shown.probe.cursor()?.at).toEqual(onHeader('b', 'new'));
    after.keys(']', 'n');
    expect(shown.probe.cursor()?.at).toEqual(onHeader('c', 'new'));
    shown.setVimKeys([...motions, { kind: 'map', mode: 'normal', keys: 'Q', to: 'gg' }]);
    after.keys('Q');
    expect(shown.probe.cursor()?.at).toEqual(onHeader('a', 'new'));
  });

  test('a jump goes out with its side and file, never into a list of Vim’s', () => {
    const on = events();
    const shown = open(on);
    shown.reveal(onLine('a', 'new', 2));
    const after = vimIn('After');
    after.keys(']', 'f');
    expect(on.jumped).toHaveBeenLastCalledWith(onLine('a', 'new', 2), onHeader('b', 'new'));
    after.keys('G');
    expect(on.jumped).toHaveBeenLastCalledWith(onHeader('b', 'new'), onHeader('d', 'new'));
    shown.reveal(onLine('a', 'new', 21));
    shown.otherSide();
    expect(on.jumped).toHaveBeenLastCalledWith(onLine('a', 'new', 21), onLine('a', 'old', 20));
    expect(shown.probe.cursor()?.at).toMatchObject(onLine('a', 'old', 20));
    shown.jump('change', 1);
    expect(on.jumped).toHaveBeenLastCalledWith(onLine('a', 'old', 20), onLine('a', 'old', 21));
    // Going back is the tab's history's to do: Vim's own `⌃o` has nowhere to go.
    const calls = on.jumped.mock.calls.length;
    vimIn('Before').keys('<C-o>');
    expect(shown.probe.cursor()?.at).toMatchObject(onLine('a', 'old', 21));
    expect(on.jumped).toHaveBeenCalledTimes(calls);
  });

  test("revealing a place isn't a jump, and drops a count typed before it", () => {
    const on = events();
    const shown = open(on);
    shown.reveal(onLine('a', 'new', 2));
    vimIn('After').keys('2');
    expect(shown.keyState().pending).toBe(true);
    shown.reveal(onLine('b', 'new', 3));
    expect(shown.keyState().pending).toBe(false);
    expect(on.jumped).not.toHaveBeenCalled();
  });
});

describe('folds', () => {
  test('open and close take the run at a place, file opens every run, toggle closes the file', () => {
    const shown = open();
    expect(collapsed()).toBe(3);
    shown.fold(onLine('a', 'new', 12), 'open');
    expect(collapsed()).toBe(2);
    shown.fold(onLine('a', 'old', 12), 'close');
    expect(collapsed()).toBe(3);
    shown.fold(onLine('a', 'new', 1), 'file');
    expect(collapsed()).toBe(0);
    shown.fold(onHeader('a', 'new'), 'toggle');
    expect(notes()).toEqual(['+3 −2, closed: za opens it']);
    shown.fold(onLine('a', 'new', 3), 'toggle');
    expect(notes()).toEqual([]);
  });

  test('a file kept out is asked for, and comes in with its lines', () => {
    const on = events();
    const shown = open(on);
    const lines = { old: numbered(4, 'd'), new: [...numbered(4, 'd'), 'd 5'] };
    // Drawn, at the end of the documents.
    shown.reveal({ kind: 'file', file: 'd' });
    expect(notes()).toEqual(['18000 changed lines: za loads them']);
    shown.fold(onHeader('d', 'new'), 'toggle');
    expect(on.load).toHaveBeenCalledWith('d');
    expect(notes()).toEqual(['Loading the file…']);
    shown.loadFailed('d');
    expect(notes()).toEqual(['The file couldn’t be loaded: za tries again']);
    shown.fold(onHeader('d', 'new'), 'toggle');
    expect(on.load).toHaveBeenCalledTimes(2);
    shown.setLines('d', lines);
    shown.setDiff('d', diffOf(lines));
    expect(notes()).toEqual([]);
    shown.reveal(onLine('d', 'new', 5));
    expect(shown.probe.cursor()?.at).toMatchObject(onLine('d', 'new', 5));
    expect(shown.lines({ file: 'd', side: 'new', from: 5, to: 5 })).toEqual(['d 5']);
  });
});

describe('targets', () => {
  test("a key's target is the line's only thread, or the one ]t landed on", () => {
    const shown = open();
    shown.setThreads(
      [
        thread('alone', at('a', 'new', 10)),
        thread('first', at('a', 'new', 25)),
        thread('second', at('a', 'new', 25)),
      ],
      plain().render,
    );
    shown.reveal(onLine('a', 'new', 10));
    expect(shown.keyState().target).toMatchObject({ at: at('a', 'new', 10), thread: 'alone' });
    shown.reveal(onLine('a', 'new', 25));
    expect(shown.keyState().target).not.toHaveProperty('thread');
    shown.reveal(onLine('a', 'new', 12));
    vimIn('After').keys(']', 't');
    expect(shown.keyState().target).toMatchObject({ at: at('a', 'new', 25), thread: 'first' });
    vimIn('After').keys('k');
    expect(shown.keyState().target).not.toHaveProperty('thread');
  });

  test('in visual mode, the target is the lines selected', () => {
    const shown = open();
    shown.reveal(onLine('a', 'new', 20));
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

  test('lines selected across files are the cursor’s line, with each file’s lines across', () => {
    const shown = open();
    shown.reveal(onLine('a', 'new', 40));
    const after = vimIn('After');
    // To document line 45, file b's line 2, past b's header.
    after.keys('V', '4', '5', 'G');
    expect(shown.keyState().target).toMatchObject({
      kind: 'line',
      at: { file: 'b', side: 'new', line: 2 },
      across: [
        { file: 'a', side: 'new', from: 40, to: 41 },
        { file: 'b', side: 'new', from: 1, to: 2 },
      ],
    });
    // Up from a line to the header of its own file: its lines alone.
    after.keys('<Esc>', 'V', '4', '3', 'G');
    expect(shown.keyState().target).toEqual({
      kind: 'line',
      at: { file: 'b', side: 'new', from: 1, to: 2 },
    });
  });

  test('inline, lines selected on one side take the other side’s between them, as they show', () => {
    const shown = open(events(), { layout: 'inline' });
    shown.reveal(onLine('a', 'new', 36));
    const changes = vimIn('Changes');
    const row = changes.text.slice(0, changes.cursor).split('\n').length;
    // Down past the line deleted after new line 36, to new line 37.
    changes.keys('V', ...String(row + 2).split(''), 'G');
    expect(shown.keyState().target).toEqual({
      kind: 'line',
      at: { file: 'a', side: 'new', from: 36, to: 37 },
      across: [
        { file: 'a', side: 'new', from: 36, to: 36 },
        { file: 'a', side: 'old', from: 35, to: 35 },
        { file: 'a', side: 'new', from: 37, to: 37 },
      ],
    });
  });

  test('a count takes that many lines from the cursor’s as they show, as v does', () => {
    const shown = open(events(), { layout: 'inline' });
    shown.reveal(onLine('a', 'old', 35));
    const changes = vimIn('Changes');
    const row = changes.text.slice(0, changes.cursor).split('\n').length;
    changes.keys('3');
    const counted = shown.keyState().target;
    expect(counted).toMatchObject({
      at: { file: 'a', side: 'old', line: 35 },
      across: [
        { file: 'a', side: 'old', from: 35, to: 35 },
        { file: 'a', side: 'new', from: 37, to: 38 },
      ],
    });
    shown.clearPending();
    changes.keys('V', ...String(row + 2).split(''), 'G');
    const across = 'across' in counted ? counted.across : undefined;
    expect(across).toHaveLength(2);
    expect(shown.keyState().target).toMatchObject({ across });
  });

  test('a right-click on a thread is its menu', () => {
    const on = events();
    const shown = open(on);
    shown.setThreads([thread('right', at('a', 'new', 10))], plain().render);
    const card = parent!.querySelector('[data-thread-id="right"]')!;
    card.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    expect(on.menu).toHaveBeenCalledWith({ kind: 'thread', thread: 'right' }, 0, 0);
  });
});

/** Presses `keys` on a line of a diff, and says what became of it. */
function pressing(keys: string[]) {
  const on = events();
  const shown = open(on);
  shown.reveal(onLine('a', 'new', 10));
  shown.focus();
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

  test.each(titled(normal))(
    '%s doesn’t enter insert or replace mode in a diff, nor move',
    (_, keys) => {
      const { on, shown, after, before } = pressing(keys);
      expect(after.mode).toBe('normal');
      expect(shown.keyState().mode).toBe('normal');
      expect(after.text).toBe(before.text);
      expect(after.cursor).toBe(before.cursor);
      expect(on.mode).not.toHaveBeenCalledWith('insert');
    },
  );

  test.each(titled(visual))(
    '%s doesn’t enter insert or replace mode from visual mode',
    (_, keys) => {
      const { on, shown, after, before } = pressing(keys);
      expect(after.mode).not.toBe('insert');
      expect(shown.keyState().mode).not.toBe('insert');
      expect(after.text).toBe(before.text);
      expect(on.mode).not.toHaveBeenCalledWith('insert');
    },
  );

  test.each(
    titled([['x'], ['d', 'd'], ['y', 'y', 'p'], ['J'], ['r', 'X'], ['>', '>'], ['~'], ['<C-a>']]),
  )('%s changes no text in a diff', (_, keys) => {
    open();
    view!.reveal(onLine('a', 'new', 10));
    const after = vimIn('After');
    const { text } = after;
    after.keys(...keys);
    expect(after.text).toBe(text);
  });
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

  test('focus() puts the cursor at the end of the text, in insert mode, from either mode', () => {
    const shown = open();
    const box = shown.compose(at('a', 'new', 10), 'First\nSecond', composerEvents());
    const comment = vimIn('Comment');
    box.replace(0, box.text.length, 'One\nTwo\nThree');
    box.focus();
    expect(comment.mode).toBe('insert');
    expect(comment.cursor).toBe(box.text.length);
    press(comment.content, 'Escape');
    comment.keys('g', 'g');
    box.focus();
    expect(comment.mode).toBe('insert');
    expect(comment.cursor).toBe(box.text.length);
  });

  test('a box under a thread, or the last line of a span, acts on them', () => {
    const shown = open();
    shown.setThreads([thread('here', at('a', 'new', 10))], plain().render);
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
    expect(shown.probe.cursor()?.at).toMatchObject(onLine('a', 'new', 10));
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

  test("a frame draws in the box's parts, and is taken down with the box", () => {
    const shown = open();
    const destroy = vi.fn<() => void>();
    const frame = vi.fn<BoxFrame>((parts) => {
      parts.head.textContent = 'Writing';
      parts.foot.textContent = 'Add to the review';
      return { destroy };
    });
    const box = shown.compose(at('a', 'new', 10), '', composerEvents(), frame);
    expect(frame).toHaveBeenCalledWith(expect.anything(), box);
    const drawn = parent!.querySelector('.lo-diffcomposer')!;
    expect([...drawn.children].map((part) => part.className)).toEqual([
      'lo-diffcomposer__head',
      'lo-diffcomposer__note',
      'lo-diffcomposer__body',
      'lo-diffcomposer__uploads',
      'lo-diffcomposer__foot',
    ]);
    expect(drawn.querySelector('.lo-diffcomposer__head')!.textContent).toBe('Writing');
    box.close();
    expect(destroy).toHaveBeenCalledOnce();
  });

  test('⌘⇧V shows the preview in the editor’s place, out of insert mode, where the box’s keys still work', () => {
    const shown = open();
    const on = boxEvents();
    const box = shown.compose(at('a', 'new', 10), 'Hello', on);
    const comment = vimIn('Comment');
    press(comment.content, 'v', { ctrlKey: true, shiftKey: true });
    expect(on.preview).toHaveBeenLastCalledWith(true);
    expect(box.previewing).toBe(true);
    expect(comment.mode).toBe('normal');
    const preview = parent!.querySelector<HTMLElement>('.lo-diffcomposer__preview')!;
    expect(preview.hidden).toBe(false);
    expect(parent!.querySelector<HTMLElement>('.lo-diffcomposer .cm-editor')!.hidden).toBe(true);
    expect(document.activeElement).toBe(preview);
    press(preview, 'Enter', { ctrlKey: true });
    expect(on.submit).toHaveBeenLastCalledWith('review');
    press(preview, 'v', { ctrlKey: true, shiftKey: true });
    expect(on.preview).toHaveBeenLastCalledWith(false);
    expect(preview.hidden).toBe(true);
    box.preview(true);
    press(preview, 'Escape');
    expect(on.close).toHaveBeenCalledWith(true);
    expect(parent!.querySelector('.lo-diffcomposer')).toBeNull();
  });

  test('⌘⇧A asks for files, and files dropped or pasted go to the caller, not into the text', () => {
    const shown = open();
    const on = boxEvents();
    const box = shown.compose(at('a', 'new', 10), 'Hello', on);
    const { content } = vimIn('Comment');
    press(content, 'a', { ctrlKey: true, shiftKey: true });
    expect(on.attach).toHaveBeenCalledOnce();
    const file = new File(['png'], 'shot.png', { type: 'image/png' });
    const dropzone = parent!.querySelector<HTMLElement>('.lo-diffcomposer__dropzone')!;
    content.dispatchEvent(carrying('dragenter', file));
    expect(on.dragging).toHaveBeenLastCalledWith(1);
    expect(dropzone.hidden).toBe(false);
    content.dispatchEvent(carrying('drop', file));
    expect(on.files).toHaveBeenLastCalledWith([file]);
    expect(on.dragging).toHaveBeenLastCalledWith(0);
    expect(dropzone.hidden).toBe(true);
    const paste = new Event('paste', { bubbles: true, cancelable: true });
    content.dispatchEvent(Object.assign(paste, { clipboardData: { files: [file] } }));
    expect(on.files).toHaveBeenCalledTimes(2);
    expect(box.text).toBe('Hello');
  });

  test('insert types at the cursor as it shows, and the preview gives back the mode it took', () => {
    const box = open().compose(at('a', 'new', 10), 'Hello', composerEvents());
    const comment = vimIn('Comment');
    // In normal mode the cursor is on the `o`: the text goes after it.
    comment.keys('<Esc>');
    box.insert('!');
    expect(box.text).toBe('Hello!');
    expect(comment.mode).toBe('normal');
    // Insert mode at the start, through the preview and back.
    comment.keys('0', 'i');
    box.preview(true);
    expect(comment.mode).toBe('normal');
    box.preview(false);
    expect(comment.mode).toBe('insert');
    box.insert('> ');
    expect(box.text).toBe('> Hello!');
    comment.keys('<Esc>');
    box.preview(true);
    box.preview(false);
    expect(comment.mode).toBe('normal');
  });

  test('insert and replace change the draft where they say, inside it', () => {
    const box = open().compose(at('a', 'new', 10), 'Hello world', composerEvents());
    box.replace(6, 11, 'there');
    expect(box.text).toBe('Hello there');
    box.replace(99, -1, 'Gone');
    expect(box.text).toBe('Gone');
  });

  test('a box outside any view tells the caller of Esc Esc, and goes on close()', () => {
    parent = document.createElement('div');
    document.body.append(parent);
    const on = composerEvents();
    const destroy = vi.fn<() => void>();
    const box = createComposer(parent, { draft: 'Kept', nonce: 'n', label: 'Reply' }, on, () => ({
      destroy,
    }));
    box.focus();
    const reply = vimIn('Reply');
    expect(reply.mode).toBe('insert');
    press(reply.content, 'Escape');
    press(reply.content, 'Escape');
    expect(on.close).toHaveBeenCalledWith(true);
    expect(parent.querySelector('.lo-diffcomposer')).not.toBeNull();
    box.close();
    expect(parent.querySelector('.lo-diffcomposer')).toBeNull();
    expect(destroy).toHaveBeenCalledOnce();
  });
});

/** A box's events, with those a frame hears. */
function boxEvents() {
  return {
    ...composerEvents(),
    preview: vi.fn<NonNullable<ComposerEvents['preview']>>(),
    attach: vi.fn<NonNullable<ComposerEvents['attach']>>(),
    files: vi.fn<NonNullable<ComposerEvents['files']>>(),
    dragging: vi.fn<NonNullable<ComposerEvents['dragging']>>(),
  };
}

/** A drag event of `type` carrying `file`, as jsdom has none. */
function carrying(type: string, file: File): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  const dataTransfer = { types: ['Files'], items: [{ kind: 'file' }], files: [file] };
  return Object.assign(event, { dataTransfer });
}

describe('threads', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    for (const undo of restore.splice(0)) undo();
  });

  test('the caller draws each thread once, under its line, and again as what it shows changes', () => {
    const shown = open();
    const { render, asked } = plain();
    shown.setThreads([thread('one', at('a', 'new', 4)), thread('two', at('a', 'old', 3))], render);
    expect(asked.toSorted()).toEqual(['draw one', 'draw two']);
    expect(said('one')).toBe('one: open, version 1');
    shown.setThreads([thread('one', at('a', 'new', 4)), thread('two', at('a', 'old', 3))], render);
    expect(asked).toHaveLength(2);
    shown.setThreads([thread('one', at('a', 'new', 4), true, 2)], render);
    expect(asked.slice(2).toSorted()).toEqual(['destroy two', 'update one']);
    expect(said('one')).toBe('one: open, version 2');
    expect(drawnThreads()).toEqual(['one']);
  });

  test('openThread opens, collapses or toggles one, and the caller’s say stands once it changes', () => {
    const shown = open();
    const { render, asked } = plain();
    const here = at('a', 'new', 4);
    shown.setThreads([thread('one', here)], render);
    expect(shown.openThread('one', 'toggle')).toBe(true);
    expect(said('one')).toBe('one: collapsed, version 1');
    expect(shown.openThread('one', false)).toBe(true);
    expect(shown.openThread('none', true)).toBe(false);
    shown.setThreads([thread('one', here, true, 2)], render);
    expect(said('one')).toBe('one: collapsed, version 2');
    shown.setThreads([thread('one', here, false, 2)], render);
    shown.setThreads([thread('one', here, true, 2)], render);
    expect(said('one')).toBe('one: open, version 2');
    expect(asked).toEqual(['draw one', 'update one', 'update one', 'update one']);
  });

  test('a line on screen waits for threads that come or go there until it’s off screen', () => {
    const shown = open();
    const screen = onScreen(['line 4']);
    const { render, asked } = plain();
    const below = thread('below', at('a', 'new', 22));
    shown.setThreads([thread('here', at('a', 'new', 4)), below], render);
    expect(drawnThreads()).toEqual(['below']);
    screen.lines.clear();
    scroller().dispatchEvent(new Event('scroll'));
    expect(drawnThreads()).toEqual(['here', 'below']);
    // What a thread there says changes at once.
    screen.lines.add('line 4');
    shown.setThreads([thread('here', at('a', 'new', 4), true, 2), below], render);
    expect(asked.at(-1)).toBe('update here');
    shown.setThreads([below], render);
    expect(drawnThreads()).toEqual(['here', 'below']);
    screen.lines.clear();
    scroller().dispatchEvent(new Event('scroll'));
    expect(drawnThreads()).toEqual(['below']);
    expect(asked.at(-1)).toBe('destroy here');
  });

  test('with now, a line on screen takes its threads at once, as in a view not yet seen', () => {
    const shown = open();
    onScreen(['line 4']);
    shown.setThreads([thread('here', at('a', 'new', 4))], plain().render, { now: true });
    expect(drawnThreads()).toEqual(['here']);
  });

  test('a line takes its threads at once while the view is hidden, as behind another view', () => {
    const shown = open();
    onScreen(['line 4']);
    Object.assign(scroller(), { checkVisibility: () => false });
    shown.setThreads([thread('here', at('a', 'new', 4))], plain().render);
    expect(drawnThreads()).toEqual(['here']);
  });

  test('a thread on screen that changes size of its own is held as it was until it’s off screen', () => {
    const sizes = observers();
    const shown = open();
    shown.setThreads([thread('grows', at('a', 'new', 4))], plain().render);
    const screen = onScreen([], ['grows']);
    const card = parent!.querySelector<HTMLElement>('[data-thread-id="grows"]')!;
    const content = card.querySelector('.lo-diffthread__host')!;
    sizes.resize(content, 40);
    sizes.resize(content, 90);
    expect(card.style.height).toBe('40px');
    expect(card.classList).toContain('is-held');
    screen.threads.clear();
    scroller().dispatchEvent(new Event('scroll'));
    expect(card.style.height).toBe('90px');
    expect(card.classList).not.toContain('is-held');
  });

  test('one the reader acts on, or that wraps again, takes its new size next frame', async () => {
    const sizes = observers();
    const shown = open();
    shown.setThreads([thread('grows', at('a', 'new', 4))], plain().render);
    onScreen([], ['grows']);
    const card = parent!.querySelector<HTMLElement>('[data-thread-id="grows"]')!;
    const content = card.querySelector('.lo-diffthread__host')!;
    sizes.resize(content, 90);
    shown.openThread('grows', false);
    sizes.resize(content, 36);
    // Cut off as it was until then.
    expect(card.style.height).toBe('90px');
    await nextFrame();
    expect(card.style.height).toBe('36px');
    expect(card.classList).not.toContain('is-held');
    sizes.resize(content, 50);
    await nextFrame();
    expect(card.classList).toContain('is-held');
    // A click in one held lets it go.
    content.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(card.style.height).toBe('50px');
    expect(card.classList).not.toContain('is-held');
    sizes.resize(content, 70);
    await nextFrame();
    expect(card.style.height).toBe('70px');
    // Its text wrapped again, as the window changed width.
    sizes.resize(content, 120, 300);
    await nextFrame();
    expect(card.style.height).toBe('120px');
  });

  test('what comes under a comment box’s line, open or closed after it was sent, comes at once', () => {
    const shown = open();
    const { render } = plain();
    const first = shown.compose(at('a', 'new', 4), 'Mine', composerEvents());
    // New line 22 says `added two`.
    onScreen(['line 4', 'line 6', 'added two']);
    // As the reader sends it, the box open.
    shown.setThreads([thread('mine', at('a', 'new', 4))], render);
    expect(drawnThreads()).toEqual(['mine']);
    first.close();
    // Closed as after it was sent, and then what they sent comes.
    shown.compose(at('a', 'new', 22), 'Another', composerEvents()).close();
    const mine = thread('mine', at('a', 'new', 4));
    shown.setThreads([mine, thread('sent', at('a', 'new', 22))], render);
    expect(drawnThreads()).toEqual(['mine', 'sent']);
    // Once it's come, the line is anyone's again.
    const sent = thread('sent', at('a', 'new', 22));
    shown.setThreads([mine, sent, thread('late', at('a', 'new', 22))], render);
    expect(drawnThreads()).toEqual(['mine', 'sent']);
    // Esc Esc sends nothing: a thread coming there after, with no input, waits as any does.
    shown.compose(at('a', 'new', 6), 'Not sent', composerEvents());
    const { content } = vimIn('Comment');
    press(content, 'Escape');
    press(content, 'Escape');
    shown.setThreads([mine, sent, thread('theirs', at('a', 'new', 6))], render);
    expect(drawnThreads()).toEqual(['mine', 'sent']);
    // Nor does a box dismissed, as a draft discarded is, and its caller hears nothing of it.
    const on = composerEvents();
    shown.compose(at('a', 'new', 4), 'Discarded', on).dismiss();
    expect(parent!.querySelector('.lo-diffcomposer')).toBeNull();
    expect(on.close).not.toHaveBeenCalled();
    shown.setThreads([mine, sent, thread('later', at('a', 'new', 4))], render);
    expect(drawnThreads()).toEqual(['mine', 'sent']);
  });

  test('a reply under a box on a thread on screen grows in full, at once', async () => {
    const sizes = observers();
    const shown = open();
    const { render } = plain();
    shown.setThreads([thread('one', at('a', 'new', 4))], render);
    onScreen(['line 4'], ['one']);
    const card = parent!.querySelector<HTMLElement>('[data-thread-id="one"]')!;
    const content = card.querySelector('.lo-diffthread__host')!;
    sizes.resize(content, 40);
    const box = shown.compose({ thread: 'one' }, 'A reply', composerEvents());
    shown.setThreads([thread('one', at('a', 'new', 4), true, 2)], render);
    box.close();
    sizes.resize(content, 90);
    await nextFrame();
    expect(card.style.height).toBe('90px');
    expect(card.classList).not.toContain('is-held');
    // What the caller changes there of its own accord, after, is held.
    shown.setThreads([thread('one', at('a', 'new', 4), true, 3)], render);
    sizes.resize(content, 120);
    await nextFrame();
    expect(card.classList).toContain('is-held');
  });

  test('boxes named apart are boxes of their own: one in a thread goes right after it', () => {
    const shown = open();
    const both = [thread('one', at('a', 'new', 4)), thread('two', at('a', 'new', 4))];
    shown.setThreads(both, plain().render);
    const named = (name: string) => ({ name });
    const line = shown.compose(
      at('a', 'new', 4),
      'On the line',
      composerEvents(),
      undefined,
      named('line'),
    );
    const reply = shown.compose(
      { thread: 'one' },
      'A reply',
      composerEvents(),
      undefined,
      named('reply'),
    );
    const edit = shown.compose(
      { thread: 'one' },
      'An edit',
      composerEvents(),
      undefined,
      named('edit'),
    );
    // The same name is the same box.
    expect(shown.compose({ thread: 'one' }, '', composerEvents(), undefined, named('reply'))).toBe(
      reply,
    );
    const block = parent!.querySelector('.lo-diffthread')!;
    const order = [...block.children].map((each) =>
      each instanceof HTMLElement && each.dataset.threadId !== undefined
        ? each.dataset.threadId
        : (each.querySelector('.cm-content')?.textContent ?? ''),
    );
    expect(order).toEqual(['one', 'A reply', 'An edit', 'two', 'On the line']);
    for (const box of [reply, edit, line]) box.dismiss();
    expect(parent!.querySelector('.lo-diffcomposer')).toBeNull();
  });

  test('what comes under a thread the reader wrote to comes at once, until it comes or the claim goes', async () => {
    const sizes = observers();
    const shown = open();
    const { render } = plain();
    shown.setThreads([thread('one', at('a', 'new', 4))], render);
    onScreen(['line 4'], ['one']);
    const card = parent!.querySelector<HTMLElement>('[data-thread-id="one"]')!;
    const content = card.querySelector('.lo-diffthread__host')!;
    sizes.resize(content, 90);
    // Resolved, as the reader asked: it collapses at once, its line kept.
    shown.claimThread('one');
    const resolved = thread('one', at('a', 'new', 4), false, 2);
    shown.setThreads([resolved], render);
    sizes.resize(content, 36);
    await nextFrame();
    expect(card.style.height).toBe('36px');
    expect(card.classList).not.toContain('is-held');
    // Once it's come, what comes next waits, as any change does.
    shown.setThreads([resolved, thread('late', at('a', 'new', 4))], render);
    expect(drawnThreads()).toEqual(['one']);
    // A claim let go, as when the write changed nothing, leaves the line as it was.
    shown.setThreads([resolved], render);
    const letGo = shown.claimThread('one');
    letGo();
    shown.setThreads([thread('one', at('a', 'new', 4), false, 3)], render);
    sizes.resize(content, 50);
    await nextFrame();
    expect(card.classList).toContain('is-held');
    // A thread the view doesn't have claims nothing.
    expect(() => shown.claimThread('none')()).not.toThrow();
  });

  test("a file's threads go under its header, in the newer column, whether or not its lines show", () => {
    const shown = open();
    const { render, asked } = plain();
    shown.setThreads([onFile('on a', 'a'), thread('line', at('a', 'new', 4))], render);
    expect(asked.toSorted()).toEqual(['draw line', 'draw on a']);
    const header = () => parent!.querySelector('[data-thread-id="on a"]')?.closest('.lo-fileblock');
    expect(header()?.textContent).toContain('src/a.ts');
    // The header's block in the newer column holds it; the older column's draws the header alone.
    const [before, after] = parent!.querySelectorAll('.cm-editor');
    expect(after!.querySelector('[data-thread-id="on a"]')).not.toBeNull();
    expect(before!.querySelector('[data-thread-id="on a"]')).toBeNull();
    // Closed into one block, the file keeps it under its header.
    shown.setCollapsed('a', true);
    expect(drawnThreads()).toEqual(['on a']);
    expect(header()?.textContent).toContain('src/a.ts');
    expect(shown.reveal({ kind: 'thread', thread: 'on a' })).toBe(true);
    expect(shown.probe.cursor()?.at).toEqual(onHeader('a', 'new'));
  });

  test("a file's header on screen waits for threads that come or go there, as a line does", () => {
    const shown = open();
    const screen = onScreen(['src/a.ts']);
    const { render } = plain();
    const below = thread('below', at('a', 'new', 22));
    shown.setThreads([onFile('here', 'a'), below], render);
    expect(drawnThreads()).toEqual(['below']);
    screen.lines.clear();
    scroller().dispatchEvent(new Event('scroll'));
    expect(drawnThreads()).toEqual(['here', 'below']);
    screen.lines.add('src/a.ts');
    shown.setThreads([below], render);
    expect(drawnThreads()).toEqual(['here', 'below']);
  });

  test('a box on a file goes under its header, after its threads, and acts on the header', () => {
    const shown = open();
    shown.setThreads([onFile('first', 'a')], plain().render);
    const on = composerEvents();
    shown.compose({ file: 'a' }, 'On the file', on);
    const block = parent!.querySelector('.lo-fileblock')!;
    expect(block.querySelectorAll('[data-thread-id], .lo-diffcomposer')).toHaveLength(2);
    expect(block.lastElementChild!.lastElementChild!.className).toContain('lo-diffcomposer');
    const scope = findScope(vimIn('Comment').content);
    expect(isKeySource(scope.source) && scope.source.keyState().target).toEqual(
      onHeader('a', 'new'),
    );
    // A box on a thread on the file is the same box; the file closed, it stays.
    expect(shown.compose({ thread: 'first' }, 'x', composerEvents()).text).toBe('On the file');
    shown.setCollapsed('a', true);
    expect(parent!.querySelectorAll('.lo-fileblock .lo-diffcomposer')).toHaveLength(1);
    // What the reader sent comes at once, the header on screen.
    onScreen(['src/a.ts']);
    shown.compose({ file: 'a' }, '', on).close();
    shown.setThreads([onFile('first', 'a'), onFile('sent', 'a')], plain().render);
    expect(drawnThreads()).toEqual(['first', 'sent']);
  });

  test('a key in a box its caller named acts on its line with the box named', () => {
    const shown = open();
    shown.compose(at('a', 'new', 10), '', composerEvents(), undefined, { name: 'mine' });
    const scope = findScope(vimIn('Comment').content);
    expect(isKeySource(scope.source) && scope.source.keyState().target).toEqual({
      kind: 'line',
      at: at('a', 'new', 10),
      box: 'mine',
    });
  });

  test('a box opened unfocused leaves focus where it was', () => {
    const shown = open();
    shown.reveal(onLine('a', 'new', 10));
    shown.focus();
    const before = document.activeElement;
    const box = shown.compose(at('a', 'new', 4), 'Restored', composerEvents(), undefined, {
      focus: false,
    });
    expect(box.text).toBe('Restored');
    expect(document.activeElement).toBe(before);
    expect(parent!.querySelector('.lo-diffcomposer')).not.toBeNull();
  });

  test('a box opened or grown with no input keeps what’s on screen, and one typed in its line', () => {
    const shown = open();
    shown.reveal(onLine('a', 'new', 10));
    shown.focus();
    const line = vi.spyOn(Aligner.prototype, 'anchorAt');
    const top = vi.spyOn(Aligner.prototype, 'anchorTop');
    // A draft restored opens for the reader: nothing they did asked for it.
    const restored = shown.compose(at('a', 'new', 4), 'Restored', composerEvents(), undefined, {
      focus: false,
    });
    expect(line).not.toHaveBeenCalled();
    expect(top).toHaveBeenCalled();
    // Each change to the box's text makes it a little taller.
    let height = 40;
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: Element,
    ) {
      return this.classList.contains('lo-diffcomposer')
        ? new DOMRect(0, 0, 400, (height += 20))
        : new DOMRect();
    });
    top.mockClear();
    restored.replace(0, 0, 'Filled in ');
    expect(line).not.toHaveBeenCalled();
    expect(top).toHaveBeenCalled();
    // Typed in, it keeps its line, as one the reader opens does.
    restored.focus();
    restored.insert(' and typed');
    expect(line).toHaveBeenCalled();
    line.mockClear();
    shown.compose(at('a', 'new', 6), '', composerEvents());
    expect(line).toHaveBeenCalled();
  });

  test('a box its caller closes, as its answer came, keeps what’s on screen, and focus where it was', () => {
    const shown = open();
    shown.reveal(onLine('a', 'new', 10));
    shown.focus();
    const answered = shown.compose(at('a', 'new', 4), 'Sent', composerEvents());
    shown.compose(at('a', 'new', 6), 'Typing', composerEvents());
    const typing = document.activeElement;
    expect(typing?.closest('.lo-diffcomposer')?.textContent).toContain('Typing');
    const line = vi.spyOn(Aligner.prototype, 'anchorAt');
    const top = vi.spyOn(Aligner.prototype, 'anchorTop');
    answered.close();
    expect(line).not.toHaveBeenCalled();
    expect(top).toHaveBeenCalled();
    expect(document.activeElement).toBe(typing);
    // What was sent comes under its line, with no input either.
    line.mockClear();
    shown.setThreads([thread('sent', at('a', 'new', 4))], plain().render);
    expect(drawnThreads()).toEqual(['sent']);
    expect(line).not.toHaveBeenCalled();
    // With focus in it, focus goes to its line.
    const last = shown.compose(at('a', 'new', 8), 'Last', composerEvents());
    last.close();
    expect(document.activeElement?.closest('.lo-diffcomposer')).toBeNull();
    expect(shown.probe.cursor()?.at).toMatchObject(onLine('a', 'new', 8));
    // Also when what was sent came first, drawing the box again: its focus was on its way back.
    const sent = shown.compose(at('a', 'new', 10), 'Sent', composerEvents());
    shown.setThreads(
      [thread('sent', at('a', 'new', 4)), thread('mine', at('a', 'new', 10))],
      plain().render,
    );
    sent.close();
    expect(shown.probe.cursor()?.at).toMatchObject(onLine('a', 'new', 10));
    expect(document.activeElement).toBe(vimIn('After').content);
  });

  test('a box closed on screen as its answer came keeps its room, and what it sent waits there, until input', async () => {
    const shown = open();
    const { render } = plain();
    const box = shown.compose(at('a', 'new', 4), 'Sent', composerEvents());
    shown.focus();
    onScreen(['line 4'], ['sent']);
    // The box, and what takes its place, are on screen too.
    vi.spyOn(Element.prototype, 'getClientRects').mockImplementation(function (this: Element) {
      return boxOrThread(this) ? oneRect(new DOMRect(0, 100, 400, 80)) : noRects();
    });
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: Element,
    ) {
      if (this.classList.contains('lo-diffview')) return new DOMRect(0, 0, 800, 600);
      return boxOrThread(this) ? new DOMRect(0, 100, 400, 80) : new DOMRect();
    });
    box.close();
    expect(parent!.querySelector('.lo-diffcomposer')).toBeNull();
    expect(parent!.querySelector<HTMLElement>('.lo-diffcomposer-room')?.style.height).toBe('80px');
    shown.setThreads([thread('sent', at('a', 'new', 4))], render);
    expect(drawnThreads()).toEqual([]);
    // The reader's next key: the room goes, and what was sent comes.
    press(scroller(), 'j');
    await new Promise((resolve) => setTimeout(resolve));
    expect(parent!.querySelector('.lo-diffcomposer-room')).toBeNull();
    expect(drawnThreads()).toEqual(['sent']);
  });

  test('a box held, as while it’s sent, takes no change to its text until it’s let go', () => {
    const shown = open();
    const box = shown.compose(at('a', 'new', 4), 'Sent as it is', composerEvents());
    const comment = vimIn('Comment');
    expect(comment.mode).toBe('insert');
    box.hold(true);
    expect(comment.mode).toBe('normal');
    comment.keys('d', 'd', 'x', 'p');
    box.replace(0, 4, '');
    expect(box.text).toBe('Sent as it is');
    box.hold(false);
    comment.keys('0', 'x');
    expect(box.text).toBe('ent as it is');
  });

  test("]t stops at a file's threads, on its header", () => {
    const shown = open();
    shown.setThreads([onFile('on b', 'b'), thread('line', at('b', 'new', 6))], plain().render);
    shown.reveal(onLine('a', 'new', 10));
    shown.jump('thread', 1);
    expect(shown.probe.cursor()?.at).toEqual(onHeader('b', 'new'));
    shown.jump('thread', 1);
    expect(shown.probe.cursor()?.at).toMatchObject(onLine('b', 'new', 6));
  });

  test('in a diff that scrolls a little, what no scroll takes off screen changes on input', async () => {
    const sizes = observers();
    const shown = open();
    const { render } = plain();
    shown.setThreads([thread('one', at('a', 'new', 4))], render);
    const screen = onScreen(['line 4'], ['one'], 300);
    Object.defineProperty(scroller(), 'scrollHeight', { configurable: true, value: 750 });
    const card = parent!.querySelector<HTMLElement>('[data-thread-id="one"]')!;
    const content = card.querySelector('.lo-diffthread__host')!;
    sizes.resize(content, 40);
    sizes.resize(content, 90);
    expect(card.classList).toContain('is-held');
    shown.setThreads([thread('one', at('a', 'new', 4)), thread('two', at('a', 'new', 4))], render);
    expect(drawnThreads()).toEqual(['one']);
    press(scroller(), 'j');
    await new Promise((resolve) => setTimeout(resolve));
    expect(card.classList).not.toContain('is-held');
    expect(drawnThreads()).toEqual(['one', 'two']);
    // Where a scroll can take it off screen, it waits for that.
    Object.defineProperty(scroller(), 'scrollHeight', { configurable: true, value: 2000 });
    screen.threads.add('two');
    shown.setThreads([thread('one', at('a', 'new', 4))], render);
    press(scroller(), 'j');
    await new Promise((resolve) => setTimeout(resolve));
    expect(drawnThreads()).toEqual(['one', 'two']);
  });
});

/** Waits for the page's next frame. */
function nextFrame(): Promise<number> {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

/** What's undone after each test of threads. */
const restore: (() => void)[] = [];

/** The text the caller drew in thread `id`. */
function said(id: string): string | null {
  return parent!.querySelector(`[data-thread-id="${id}"]`)?.textContent ?? null;
}

/** The threads drawn, in the page's order. */
function drawnThreads(): (string | undefined)[] {
  return [...parent!.querySelectorAll<HTMLElement>('[data-thread-id]')].map(
    (each) => each.dataset.threadId,
  );
}

/**
 * jsdom lays nothing out: from now on the view's box is a screen, and on it are the lines that say
 * one of `lines`, `top` down it, and the threads whose ids are among `threads`. The rest are far
 * below it.
 */
function onScreen(lines: string[], threads: string[] = [], top = 100) {
  const screen = { lines: new Set(lines), threads: new Set(threads) };
  Object.defineProperty(scroller(), 'clientHeight', { configurable: true, value: 600 });
  const lineBlockAt: unknown = Reflect.get(EditorView.prototype, 'lineBlockAt');
  vi.spyOn(EditorView.prototype, 'lineBlockAt').mockImplementation(function (
    this: EditorView,
    pos: number,
  ) {
    const block: unknown =
      typeof lineBlockAt === 'function' ? Reflect.apply(lineBlockAt, this, [pos]) : undefined;
    if (!(block instanceof BlockInfo)) throw new Error('The editor has no line there.');
    const drawn = screen.lines.has(this.state.doc.lineAt(pos).text) ? top : 5000;
    const moved: unknown = Object.create(block, { top: { value: drawn }, height: { value: 20 } });
    if (!(moved instanceof BlockInfo)) throw new Error('The line could not be moved.');
    return moved;
  });
  vi.spyOn(Element.prototype, 'getClientRects').mockImplementation(function (this: Element) {
    return threadOf(this) === undefined ? noRects() : oneRect(new DOMRect(0, 0, 400, 40));
  });
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    if (this.classList.contains('lo-diffview')) return new DOMRect(0, 0, 800, 600);
    const id = threadOf(this);
    if (id === undefined) return new DOMRect();
    return new DOMRect(0, screen.threads.has(id) ? top : 5000, 400, 40);
  });
  return screen;
}

/** Whether `element` is in a comment box, the room one left, or a thread. */
function boxOrThread(element: Element): boolean {
  return element.closest('.lo-diffcomposer, .lo-diffcomposer-room, [data-thread-id]') !== null;
}

/** The thread `element` is in, if it's in one. */
function threadOf(element: Element): string | undefined {
  return element.closest<HTMLElement>('.lo-diffthread__thread')?.dataset.threadId;
}

/** A resize observer the tests make, and what it watches. */
interface Watch {
  callback: ResizeObserverCallback;
  watched: Set<Element>;
  observer: ResizeObserver;
}

/** Resize observers made from now on, which the test calls as the page would. */
function observers() {
  const made: Watch[] = [];
  const before = globalThis.ResizeObserver;
  globalThis.ResizeObserver = class {
    readonly #watch: Watch;
    constructor(callback: ResizeObserverCallback) {
      this.#watch = { callback, watched: new Set(), observer: this };
      made.push(this.#watch);
    }
    observe(element: Element): void {
      this.#watch.watched.add(element);
    }
    unobserve(element: Element): void {
      this.#watch.watched.delete(element);
    }
    disconnect(): void {
      this.#watch.watched.clear();
    }
  };
  restore.push(() => {
    globalThis.ResizeObserver = before;
  });
  return {
    /** Tells the observers watching `element` that it's `height` tall and `width` wide now. */
    resize(element: Element, height: number, width = 400): void {
      const size = { blockSize: height, inlineSize: width };
      const entry: ResizeObserverEntry = {
        target: element,
        borderBoxSize: [size],
        contentBoxSize: [size],
        devicePixelContentBoxSize: [size],
        contentRect: new DOMRect(0, 0, width, height),
      };
      for (const { callback, watched, observer } of made) {
        if (watched.has(element)) callback([entry], observer);
      }
    },
  };
}

describe('keys', () => {
  test("keyState says Vim's mode and whether it's in the middle of a command", () => {
    const shown = open();
    shown.reveal(onLine('a', 'new', 10));
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
    expect(shown.probe.cursor()?.at).toEqual(onLine('a', 'new', 10, 1));
    after.keys('v');
    expect(shown.keyState()).toMatchObject({ mode: 'visual', pending: false });
    shown.clearPending();
    expect(shown.keyState().mode).toBe('visual');
  });

  test('keyState says the count Vim holds when that’s all it holds', () => {
    const shown = open();
    shown.reveal(onLine('a', 'new', 10));
    const after = vimIn('After');
    expect(shown.keyState().count).toBeUndefined();
    after.keys('1', '2');
    expect(shown.keyState()).toMatchObject({ pending: true, count: 12 });
    after.keys('y');
    expect(shown.keyState()).toMatchObject({ pending: true, count: undefined });
    shown.clearPending();
    expect(shown.keyState().count).toBeUndefined();
  });

  test('the status bar hears Vim’s mode while the view has focus, and nothing after', async () => {
    const shown = open();
    shown.reveal(onLine('a', 'new', 10));
    shown.focus();
    const after = vimIn('After');
    after.content.focus();
    await Promise.resolve();
    expect(focusedMode()).toBe('NORMAL');
    after.keys('V');
    await Promise.resolve();
    expect(focusedMode()).toBe('V-LINE');
    after.keys('v');
    await Promise.resolve();
    expect(focusedMode()).toBe('VISUAL');
    after.keys('<Esc>');
    await Promise.resolve();
    expect(focusedMode()).toBe('NORMAL');
    after.content.blur();
    await vi.waitFor(() => {
      expect(focusedMode()).toBeUndefined();
    });
  });

  test('passKeys hands keys to Vim, as if typed', () => {
    const shown = open();
    shown.reveal(onLine('a', 'new', 10));
    shown.focus();
    shown.passKeys(['y', 'w']);
    expect(shown.probe.cursor()?.at).toMatchObject(onLine('a', 'new', 10));
    shown.passKeys(['g', 'g']);
    expect(shown.probe.cursor()?.at).toEqual(onHeader('a', 'new'));
  });

  test('passKeys hands Vim nothing while focus is elsewhere in the view, where typed keys never reach it', () => {
    const shown = open();
    shown.reveal(onLine('a', 'new', 10));
    const outside = parent!.querySelector<HTMLElement>('.cm-scroller')!;
    outside.tabIndex = -1;
    outside.focus();
    shown.passKeys([']']);
    expect(shown.keyState().pending).toBe(false);
    shown.passKeys(['g', 'g']);
    expect(shown.probe.cursor()?.at).toMatchObject(onLine('a', 'new', 10));
  });

  test('cursor and mode events follow the focused editor', () => {
    const on = events();
    const shown = open(on);
    shown.reveal(onLine('a', 'old', 7));
    shown.focus();
    expect(on.cursor).toHaveBeenLastCalledWith(onLine('a', 'old', 7, 0));
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
    shown.reveal({ kind: 'file', file: 'b' });
    shown.setHeader('b', {
      additions: 10,
      deletions: 0,
      viewed: 'viewed',
      threads: { total: 3, unresolved: 2 },
      tags: ['new'],
    });
    const header = parent!.querySelector('.cm-content[aria-label="After"] [data-row="h:1"]')!;
    expect(header.classList.contains('is-viewed')).toBe(true);
    expect(header.textContent).toContain('new3');
    const count = header.querySelector('.lo-count');
    expect(count?.getAttribute('title')).toBe('2 unresolved of 3');
    expect(count?.classList.contains('is-open')).toBe(true);
    shown.setHeader('b', { additions: 10, deletions: 0, threads: { total: 1, unresolved: 0 } });
    const resolved = parent!.querySelector(
      '.cm-content[aria-label="After"] [data-row="h:1"] .lo-count',
    );
    expect(resolved?.getAttribute('aria-label')).toBe('1 thread, resolved');
    expect(resolved?.classList.contains('is-open')).toBe(false);
    expect(header.querySelector('.lo-diffhead__ball.is-viewed')?.getAttribute('title')).toBe(
      'Viewed',
    );
  });

  test('a header draws its viewed mark as a ball', () => {
    const shown = open();
    shown.reveal({ kind: 'file', file: 'b' });
    expect(ballOf('h:1')).toBeNull();
    shown.setHeader('b', { additions: 1, deletions: 0, viewed: 'unviewed' });
    expect(ballOf('h:1')?.className).toBe('lo-diffhead__ball');
    expect(headerOf('h:1').classList.contains('is-viewed')).toBe(false);
    shown.setHeader('b', { additions: 1, deletions: 0, viewed: 'stale' });
    expect(ballOf('h:1')?.className).toBe('lo-diffhead__ball is-stale');
    expect(ballOf('h:1')?.getAttribute('aria-label')).toBe('Changed since you viewed it');
  });

  test('a note on the comparison sits above the sides', () => {
    open(events(), { note: { text: 'r3 → r5, since you last looked', tone: 'info' } });
    const note = parent!.querySelector('.lo-diffview > .lo-diffnote--info');
    expect(note?.textContent).toBe('r3 → r5, since you last looked');
  });
});

/** The header of the row `row` in the new side's editor. */
function headerOf(row: string): Element {
  return document.querySelector(`.cm-content[aria-label="After"] [data-row="${row}"]`)!;
}

/** The viewed ball in that header, if it draws one. */
function ballOf(row: string): Element | null {
  return headerOf(row).querySelector('.lo-diffhead__ball');
}

/** Runs `command` from Vim's `:` prompt in the editor labelled `label`, as `Enter` there does. */
function ex(label: string, command: string): void {
  const vim = vimIn(label);
  vim.keys(':');
  const prompt = vim.content.parentElement!.parentElement!.querySelector('input');
  if (!prompt) throw new Error('Vim opened no prompt.');
  prompt.value = command;
  prompt.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true, cancelable: true }),
  );
}

describe('Ex commands', () => {
  test.each([
    's/line/x/',
    '%s/line/x/g',
    'j',
    '5,9j',
    'put',
    'normal x',
    'normal .',
    '3,8normal .',
    "'<,'>d",
    'g/line/d',
    'sort',
  ])(':%s keeps the cursor where it was, and the text', (command) => {
    const shown = open();
    shown.reveal(onLine('a', 'new', 10));
    shown.focus();
    const after = vimIn('After');
    after.keys('x');
    const before = { text: after.text, cursor: after.cursor };
    ex('After', command);
    expect(after.text).toBe(before.text);
    expect(after.cursor).toBe(before.cursor);
    expect(after.mode).toBe('normal');
  });

  test(':startinsert leaves the diff in normal mode', () => {
    const on = events();
    const shown = open(on);
    shown.reveal(onLine('a', 'new', 10));
    shown.focus();
    ex('After', 'startinsert');
    expect(vimIn('After').mode).toBe('normal');
    expect(on.mode).not.toHaveBeenCalledWith('insert');
  });

  test('a line number still moves the cursor there', () => {
    const shown = open();
    shown.reveal(onLine('a', 'new', 10));
    shown.focus();
    // Document line 31 is file line 30.
    ex('After', '31');
    expect(shown.probe.cursor()?.at).toMatchObject(onLine('a', 'new', 30));
  });

  test.each([
    ['s/a/b/', true],
    [' :%s#a#b#g', true],
    ['.,$d', true],
    ["'<,'>norm .", true],
    ['/needle/,+3j', true],
    ['5', false],
    ['$', false],
    ['/needle/', false],
    ['set nu', false],
    ['noh', false],
    ['y', false],
    ['st', false],
    ['re', false],
  ] as const)('%s is an edit: %s', (command, edits) => {
    expect(editsText(command)).toBe(edits);
  });
});

describe("Lo's motions", () => {
  test('a motion no code view runs is refused, not left a dead key', () => {
    const shown = open();
    const unknown: VimKey = { kind: 'motion', command: 'tree.nextFolder', keys: ']d' };
    expect(() => shown.setVimKeys([...motions, unknown])).toThrow(
      "No code view runs tree.nextFolder as a motion: diffMotions doesn't list it.",
    );
    // The keys in place before stay.
    shown.reveal(onLine('a', 'new', 1));
    vimIn('After').keys(']', 'c');
    expect(shown.probe.cursor()?.at).toMatchObject(onLine('a', 'new', 5));
  });
});

describe('moved code', () => {
  test('is named by file ids, and code moved to or from a file the view lacks is left out', () => {
    const shown = open();
    const words = { old: [], new: [] };
    shown.setMoves([
      { from: { file: 'c', first: 1, last: 3 }, to: { file: 'b', first: 3, last: 5 }, words },
      { from: { file: 'gone', first: 1, last: 2 }, to: { file: 'b', first: 7, last: 8 }, words },
    ]);
    // Drawn: the files after `a`, at the end of the documents.
    shown.reveal(onHeader('c', 'old'));
    expect(labels('Before')).toEqual(['Moved tosrc/b.ts:3']);
    shown.reveal(onHeader('b', 'new'));
    expect(labels('After')).toEqual(['Moved fromsrc/c.ts:1']);
    shown.setMoves([]);
    expect(labels('After')).toEqual([]);
  });

  test('draws again only the files whose moves changed', () => {
    const shown = open();
    const words = { old: [], new: [] };
    const cToB = {
      from: { file: 'c', first: 1, last: 3 },
      to: { file: 'b', first: 3, last: 5 },
      words,
    };
    shown.setMoves([cToB]);
    const dispatched = vi.spyOn(EditorView.prototype, 'update');
    try {
      // The same moves again: nothing to draw.
      shown.setMoves([cToB]);
      expect(dispatched).not.toHaveBeenCalled();
      // One more, within `a`: only `a` is drawn again, on each side.
      shown.setMoves([
        cToB,
        { from: { file: 'a', first: 1, last: 1 }, to: { file: 'a', first: 5, last: 5 }, words },
      ]);
      expect(dispatched).toHaveBeenCalledTimes(2);
    } finally {
      dispatched.mockRestore();
    }
  });
});

describe('loading', () => {
  test('a diff that comes before its lines leaves the file loading, and za asks once', () => {
    const on = events();
    const shown = open(on);
    const lines = { old: numbered(4, 'd'), new: [...numbered(4, 'd'), 'd 5'] };
    shown.reveal({ kind: 'file', file: 'd' });
    shown.fold({ kind: 'file', file: 'd' }, 'toggle');
    shown.setDiff('d', diffOf(lines));
    expect(notes()).toEqual(['Loading the file…']);
    shown.fold({ kind: 'file', file: 'd' }, 'toggle');
    expect(on.load).toHaveBeenCalledTimes(1);
    shown.setLines('d', lines);
    expect(notes()).toEqual([]);
    expect(shown.lines({ file: 'd', side: 'new', from: 5, to: 5 })).toEqual(['d 5']);
  });
});

/** How many updates each editor of the page takes from here on, in the editors' order. */
function countUpdates(): () => (number | undefined)[] {
  const editors = [...document.querySelectorAll<HTMLElement>('.cm-editor')].flatMap(
    (dom) => EditorView.findFromDOM(dom) ?? [],
  );
  const updates = new Map<EditorView, number>();
  for (const editor of editors) {
    const counted = EditorView.updateListener.of((update) => {
      if (update.transactions.length > 0) {
        updates.set(update.view, (updates.get(update.view) ?? 0) + 1);
      }
    });
    editor.dispatch({ effects: StateEffect.appendConfig.of(counted) });
  }
  updates.clear();
  return () => editors.map((editor) => updates.get(editor));
}

describe('gaps', () => {
  /**
   * `e`: GitHub's diff of a 30-line file whose lines 3 and 28 changed, which left out lines 7 to
   * 24 on both sides, outside its three lines of context.
   */
  const eOld = numbered(30, 'e');
  const eNew = eOld.map((each, index) => (index === 2 || index === 27 ? `${each}!` : each));
  const gapped: DiffFile = {
    id: 'e',
    path: 'src/e.ts',
    change: 'modified',
    lines: { old: placeholders(eOld), new: placeholders(eNew) },
    gaps: [
      { side: 'old', from: 7, to: 24 },
      { side: 'new', from: 7, to: 24 },
    ],
    header: { additions: 2, deletions: 2 },
  };

  function gappedView(): DiffView {
    const shown = open(events(), { files: [gapped] });
    shown.setDiff('e', diffOf(gapped.lines!));
    focusable();
    return shown;
  }

  test("lines GitHub's diff left out stay collapsed, and say so", () => {
    const shown = gappedView();
    expect(runs()).toEqual(['18 unchanged lines, not loaded yet']);
    shown.fold(onLine('e', 'new', 12), 'open');
    shown.fold(onLine('e', 'new', 1), 'file');
    expect(runs()).toHaveLength(1);
  });

  test('a gap of one line, or one next to a change, collapses on both sides', () => {
    // Lines 4 and 8 changed, with the context around them reaching lines 1 and 9 to 11.
    const fOld = numbered(12, 'f');
    const fNew = fOld.map((each, index) => (index === 3 || index === 7 ? `${each}!` : each));
    const lines = { old: blank(fOld), new: blank(fNew) };
    const shown = open(events(), {
      files: [
        {
          id: 'f',
          path: 'src/f.ts',
          change: 'modified',
          lines,
          gaps: (['old', 'new'] as const).flatMap((side) => [
            { side, from: 1, to: 1 },
            { side, from: 9, to: 12 },
          ]),
          header: { additions: 2, deletions: 2 },
        },
      ],
    });
    shown.setDiff('f', diffOf(lines));
    for (const label of ['Before', 'After']) {
      const content = parent!.querySelector(`.cm-content[aria-label="${label}"]`)!;
      const blocks = [...content.querySelectorAll('.lo-collapsed')].map((each) => each.textContent);
      expect(blocks).toEqual([
        'lines 1–11 unchanged line, not loaded yet',
        'lines 9–124 unchanged lines, not loaded yet',
      ]);
      // No placeholder is drawn as a line.
      const drawn = [...content.querySelectorAll('.cm-line')].map((each) => each.textContent);
      expect(drawn).not.toContain('');
    }
  });

  test('real unchanged lines beside a gap collapse and open as usual', () => {
    // Line 3 changed: lines 7 to 10 are outside the hunk, and only line 10 is a placeholder.
    const gOld = numbered(10, 'g');
    const gNew = gOld.map((each, index) => (index === 2 ? `${each}!` : each));
    const lines = { old: lastBlank(gOld), new: lastBlank(gNew) };
    const shown = open(events(), {
      files: [
        {
          id: 'g',
          path: 'src/g.ts',
          change: 'modified',
          lines,
          gaps: [
            { side: 'old', from: 10, to: 10 },
            { side: 'new', from: 10, to: 10 },
          ],
          header: { additions: 1, deletions: 1 },
        },
      ],
    });
    shown.setDiff('g', diffOf(lines));
    expect(runs()).toEqual(['3 unchanged lines', '1 unchanged line, not loaded yet']);
    shown.fold(onLine('g', 'new', 8), 'open');
    expect(runs()).toEqual(['1 unchanged line, not loaded yet']);
    expect(shown.lines({ file: 'g', side: 'new', from: 7, to: 9 })).toEqual(['g 7', 'g 8', 'g 9']);
  });

  test('the whole file comes at the same place, with its diff, and the cursor stays', () => {
    const on = events();
    const shown = open(on, { files: [gapped] });
    shown.setDiff('e', diffOf(gapped.lines!));
    focusable();
    shown.reveal(onLine('e', 'new', 26, 2));
    shown.focus();
    const content = vimIn('After').content;
    const lineOf = (text: string) =>
      [...content.querySelectorAll('.cm-line')].find((each) => each.textContent === text);
    const drawn = lineOf('e 26');
    on.cursor.mockClear();
    shown.setLines('e', { old: eOld, new: eNew }, diffOf({ old: eOld, new: eNew }));
    expect(shown.probe.cursor()?.at).toEqual(onLine('e', 'new', 26, 2));
    expect(on.cursor).not.toHaveBeenCalled();
    expect(notes()).toEqual([]);
    expect(runs()).toEqual(['18 unchanged lines']);
    // The line under the cursor wasn't drawn again: what's on screen didn't move.
    expect(lineOf('e 26')).toBe(drawn);
    shown.setLayout('inline');
    expect(shown.probe.cursor()?.at).toEqual(onLine('e', 'new', 26, 0));
  });

  test('the whole file comes in one update of each editor, with its decorations', () => {
    const shown = gappedView();
    const updates = countUpdates();
    shown.setLines('e', { old: eOld, new: eNew }, diffOf({ old: eOld, new: eNew }));
    // The old side's and the new side's.
    expect(updates()).toEqual([1, 1]);
    expect(runs()).toEqual(['18 unchanged lines']);
  });

  test('inline, the whole file comes in one update of each editor too', () => {
    const shown = gappedView();
    shown.setLayout('inline');
    const updates = countUpdates();
    shown.setLines('e', { old: eOld, new: eNew }, diffOf({ old: eOld, new: eNew }));
    // The two sides', hidden, and the inline one's.
    expect(updates()).toEqual([1, 1, 1]);
    expect(runs()).toEqual(['18 unchanged lines']);
  });

  test("the whole file after a diff that stopped short of it adds the rest, the cursor's line kept", () => {
    // GitHub's diff of `e` with only line 3 changed: it stops after its context, at line 6.
    const tOld = numbered(30, 'e');
    const tNew = tOld.map((each, index) => (index === 2 ? `${each}!` : each));
    const short = { old: tOld.slice(0, 6), new: tNew.slice(0, 6) };
    const on = events();
    const shown = open(on, {
      files: [
        { id: 'e', path: 'src/e.ts', change: 'modified', lines: short, header: gapped.header },
      ],
    });
    shown.setDiff('e', diffOf(short));
    focusable();
    shown.reveal(onLine('e', 'new', 5, 2));
    shown.focus();
    const content = vimIn('After').content;
    const lineOf = (text: string) =>
      [...content.querySelectorAll('.cm-line')].find((each) => each.textContent === text);
    const drawn = lineOf('e 5');
    on.cursor.mockClear();
    shown.setLines('e', { old: tOld, new: tNew }, diffOf({ old: tOld, new: tNew }));
    expect(shown.probe.cursor()?.at).toEqual(onLine('e', 'new', 5, 2));
    expect(on.cursor).not.toHaveBeenCalled();
    expect(runs()).toEqual(['24 unchanged lines']);
    // The line under the cursor wasn't drawn again: the rest came after it, and nothing moved.
    expect(lineOf('e 5')).toBe(drawn);
    // Without its diff, the short one doesn't fit the whole file, which waits for its own.
    shown.setLines('e', short, diffOf(short));
    shown.setLines('e', { old: tOld, new: tNew });
    expect(notes()).toEqual(['Working out the diff…']);
  });

  test('lines that were left out, not held as placeholders, swap whole, the cursor on its text', () => {
    // GitHub's diff of `e` with lines 7 to 24 left out altogether: its line 8 is the file's 26.
    const short = { old: leftOut(eOld), new: leftOut(eNew) };
    for (const layout of ['split', 'inline'] as const) {
      view?.destroy();
      parent?.remove();
      const shown = open(events(), {
        files: [
          { id: 'e', path: 'src/e.ts', change: 'modified', lines: short, header: gapped.header },
        ],
        layout,
      });
      shown.setDiff('e', diffOf(short));
      focusable();
      shown.reveal(onLine('e', 'new', 8, 2));
      shown.focus();
      shown.setLines('e', { old: eOld, new: eNew }, diffOf({ old: eOld, new: eNew }));
      expect(shown.probe.cursor()?.at).toEqual(onLine('e', 'new', 26, 2));
    }
  });

  test('says whether the whole file would draw in the rows GitHub’s diff of it has', () => {
    const shown = gappedView();
    // The gap filled, collapsed as it was: the same rows.
    expect(shown.keepsShape('e', { old: eOld, new: eNew }, diffOf({ old: eOld, new: eNew }))).toBe(
      true,
    );
    // More lines after the last hunk: a collapsed run below it that wasn't there.
    const longer = { old: [...eOld, ...numbered(10, 'x')], new: [...eNew, ...numbered(10, 'x')] };
    expect(shown.keepsShape('e', longer, diffOf(longer))).toBe(false);
  });

  test('a shown file keeps its diff only while its lines outside the gaps stay', () => {
    const shown = gappedView();
    // The gaps filled, and nothing else changed: the diff still fits.
    shown.setLines('e', { old: eOld, new: eNew });
    expect(notes()).toEqual([]);
    expect(runs()).toEqual(['18 unchanged lines']);
    // As many lines, but line 3 back as it was and line 5 changed: the diff waits for its new one.
    const other = eOld.map((each, index) => (index === 4 || index === 27 ? `${each}!` : each));
    shown.setLines('e', { old: eOld, new: other });
    expect(notes()).toEqual(['Working out the diff…']);
    shown.setDiff('e', diffOf({ old: eOld, new: other }));
    expect(notes()).toEqual([]);
  });

  test('zR before the whole file comes opens it as it comes, and a run closed since stays closed', () => {
    const shown = gappedView();
    const whole = { old: eOld, new: eNew };
    shown.fold(onLine('e', 'new', 1), 'file');
    expect(runs()).toEqual(['18 unchanged lines, not loaded yet']);
    // Opened whole, the file wouldn't draw in the rows it has.
    expect(shown.keepsShape('e', whole, diffOf(whole))).toBe(false);
    shown.setLines('e', whole, diffOf(whole));
    expect(runs()).toEqual([]);
    // Closed again, the run stays closed as a new diff comes, as when whitespace is hidden.
    shown.fold(onLine('e', 'new', 12), 'close');
    expect(runs()).toEqual(['18 unchanged lines']);
    shown.setDiff('e', diffOf(whole));
    expect(runs()).toEqual(['18 unchanged lines']);
    expect(shown.keepsShape('e', whole, diffOf(whole))).toBe(true);
  });

  test('zR before the diff comes opens the file once it does', () => {
    const shown = gappedView();
    // As many lines, but line 3 back as it was and line 5 changed: the diff waits for its new one.
    const other = { old: eOld, new: eOld.map((each, index) => (index === 4 ? `${each}!` : each)) };
    shown.setLines('e', other);
    expect(notes()).toEqual(['Working out the diff…']);
    shown.fold(onHeader('e', 'new'), 'file');
    shown.setDiff('e', diffOf(other));
    expect(runs()).toEqual([]);
  });

  test('the whole file fills them, and they open', () => {
    const shown = gappedView();
    shown.setLines('e', { old: eOld, new: eNew });
    shown.setDiff('e', diffOf({ old: eOld, new: eNew }));
    expect(runs()).toEqual(['18 unchanged lines']);
    expect(shown.lines({ file: 'e', side: 'new', from: 12, to: 12 })).toEqual(['e 12']);
    shown.fold(onLine('e', 'new', 12), 'open');
    expect(runs()).toEqual([]);
  });
});

describe('input methods', () => {
  test('a composition in a diff never reaches CodeMirror, and is ended', () => {
    const shown = open();
    shown.reveal(onLine('a', 'new', 3));
    shown.focus();
    const { content } = vimIn('After');
    const blurred = vi.fn<() => void>();
    content.addEventListener('blur', blurred);
    const reached = vi.fn<() => void>();
    content.addEventListener('compositionstart', reached);
    content.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: 'に' }));
    expect(reached).not.toHaveBeenCalled();
    expect(blurred).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(content);
  });
});

describe('the inline layout', () => {
  test('drawn from the start, it takes no focus, and the reader changing to it does', () => {
    const focused = vi.spyOn(HTMLElement.prototype, 'focus');
    const shown = open(events(), { layout: 'inline' });
    expect(shown.probe.layout).toBe('inline');
    expect(focused).not.toHaveBeenCalled();
    shown.setLayout('split');
    shown.setLayout('inline');
    expect(focused).toHaveBeenCalled();
    focused.mockRestore();
  });

  test('gi from a header comes back on the side it left', () => {
    const shown = open();
    shown.reveal(onHeader('b', 'new'));
    shown.focus();
    shown.setLayout('inline');
    expect(shown.probe.cursor()?.at).toEqual(onHeader('b', 'new'));
    shown.setLayout('split');
    expect(shown.probe.cursor()).toMatchObject({ at: onHeader('b', 'new'), pane: 'new' });
  });
});

/** An overview mark on file `a`'s lines `from` to `to` of `side`, from block `block`. */
function overview(
  side: 'old' | 'new',
  from: number,
  to: number,
  block = 'one',
  text = 'A query over the plan’s ceiling is refused before it touches the bucket.',
): Mark {
  return {
    kind: 'overview',
    at: { file: 'a', side, from, to },
    block,
    note: { label: 'Where to look', text },
  };
}

/** The markers' gutter of the editor labelled `label`, if it has one. */
function markerColumn(label: string): Element | null {
  const content = parent!.querySelector(`.cm-content[aria-label="${label}"]`);
  return content?.closest('.cm-editor')?.querySelector('.cm-gutter.lo-ovcolumn') ?? null;
}

/** What the markers' gutter of the editor labelled `label` draws, top to bottom. */
function markers(label: string): string[] {
  return [...(markerColumn(label)?.querySelectorAll('.cm-gutterElement') ?? [])].map((element) => {
    const ball = element.querySelector('.lo-ov-marker');
    const parts = [ball ? (ball.classList.contains('is-open') ? 'open' : 'ball') : 'rail'];
    if (element.classList.contains('is-first')) parts.push('first');
    if (element.classList.contains('is-last')) parts.push('last');
    return parts.join(' ');
  });
}

/** What the editor labelled `label` draws in its text. */
function drawnText(label: string): string {
  return parent!.querySelector(`.cm-content[aria-label="${label}"]`)!.innerHTML;
}

/** The notes drawn in the editor labelled `label`: each one's label and text. */
function noted(label: string): string[] {
  const shown = parent!.querySelectorAll(`.cm-content[aria-label="${label}"] .lo-ovnote`);
  return [...shown].map(
    (note) =>
      `${note.querySelector('.lo-ovnote__label')?.textContent}: ${note.querySelector('.lo-ovnote__text')?.textContent}`,
  );
}

describe('overview marks', () => {
  test('their gutter is there before any mark, in both layouts', () => {
    const shown = open();
    expect(markerColumn('Before')).not.toBeNull();
    expect(markerColumn('After')).not.toBeNull();
    expect(markers('After')).toEqual([]);
    shown.setLayout('inline');
    expect(markerColumn('Changes')).not.toBeNull();
  });

  test('marks on each side draw a ball and a rail beside their lines, and nothing else changes', () => {
    const shown = open();
    const before = { old: drawnText('Before'), new: drawnText('After') };
    shown.setMarks([overview('new', 4, 6), overview('old', 3, 2, 'two')]);
    expect(markers('After')).toEqual(['ball first', 'rail', 'rail last']);
    expect(markers('Before')).toEqual(['ball first', 'rail last']);
    expect({ old: drawnText('Before'), new: drawnText('After') }).toEqual(before);
    shown.setMarks([]);
    expect(markers('After')).toEqual([]);
    expect(markers('Before')).toEqual([]);
    expect({ old: drawnText('Before'), new: drawnText('After') }).toEqual(before);
  });

  test("kinds the diff doesn't draw, and files it doesn't have, are left out", () => {
    const shown = open();
    shown.setMarks([
      { kind: 'lines', at: { file: 'a', side: 'new', from: 4, to: 6 } },
      { ...overview('new', 4, 6), at: { file: 'z', side: 'new', from: 4, to: 6 } },
    ]);
    expect(markers('After')).toEqual([]);
  });

  test('ranges that overlap share a rail, each with its ball', () => {
    const shown = open();
    shown.setMarks([overview('new', 2, 4), overview('new', 3, 6, 'two')]);
    expect(markers('After')).toEqual(['ball first', 'ball', 'rail', 'rail', 'rail last']);
  });

  test('lines collapsed into a block carry the rail, and the ball where a range starts', () => {
    const shown = open();
    // New lines 9 to 17 are collapsed.
    shown.setMarks([overview('new', 12, 14)]);
    expect(markers('After')).toEqual(['ball first last']);
    shown.setMarks([overview('new', 7, 12)]);
    expect(markers('After')).toEqual(['ball first', 'rail', 'rail last']);
  });

  test('inline, both sides’ marks, the rail running past the other side’s lines', () => {
    const shown = open();
    shown.setLayout('inline');
    shown.setMarks([overview('new', 4, 6), overview('old', 2, 3, 'two')]);
    // Old 2, old 3; new 4, then old 5 deleted and new 5 added, and new 6.
    expect(markers('Changes')).toEqual([
      'ball first',
      'rail last',
      'ball first',
      'rail',
      'rail',
      'rail last',
    ]);
  });

  test('a note opens under the range’s last line, and the ball says it’s open', () => {
    const shown = open();
    shown.setMarks([overview('new', 4, 6)]);
    expect(shown.openNote(at('a', 'new', 8))).toBe(false);
    expect(shown.openNote(at('a', 'old', 5))).toBe(false);
    expect(noted('After')).toEqual([]);
    expect(shown.openNote(at('a', 'new', 5))).toBe(true);
    expect(noted('After')).toEqual([
      'Overview · Where to look: A query over the plan’s ceiling is refused before it touches the bucket.',
    ]);
    expect(markers('After')).toEqual(['open first', 'rail', 'rail last']);
    // Under line 6: the note's block follows line 6, before line 7.
    const note = parent!.querySelector('.cm-content[aria-label="After"] .lo-ovnote')!;
    const block = note.closest('.cm-content > *')!;
    expect(block.previousElementSibling?.textContent).toBe('line 6');
    expect(block.nextElementSibling?.textContent).toBe('line 7');
    // Opening it again changes nothing.
    expect(shown.openNote(at('a', 'new', 4))).toBe(true);
    expect(noted('After')).toHaveLength(1);
    expect(shown.closeNote()).toBe(true);
    expect(noted('After')).toEqual([]);
    expect(markers('After')).toEqual(['ball first', 'rail', 'rail last']);
    expect(shown.closeNote()).toBe(false);
  });

  test('Esc in the diff closes the note opened last, once Vim is waiting on nothing', () => {
    const shown = open();
    shown.setMarks([overview('new', 2, 3), overview('new', 5, 6, 'two', 'The second.')]);
    shown.openNote(at('a', 'new', 2));
    shown.openNote(at('a', 'new', 5));
    shown.reveal(onLine('a', 'new', 8));
    shown.focus();
    const after = vimIn('After');
    after.keys('v');
    press(after.content, 'Escape');
    expect(after.mode).toBe('normal');
    expect(noted('After')).toHaveLength(2);
    press(after.content, 'Escape');
    expect(noted('After')).toEqual([expect.stringContaining('A query')]);
    press(after.content, 'Escape', { shiftKey: true });
    expect(noted('After')).toHaveLength(1);
    press(after.content, 'Escape');
    expect(noted('After')).toEqual([]);
  });

  test('Esc in a comment box is the box’s, and leaves the note open', () => {
    const shown = open();
    shown.setMarks([overview('new', 4, 6)]);
    shown.openNote(at('a', 'new', 4));
    shown.compose(at('a', 'new', 6), '', composerEvents());
    const { content: box } = vimIn('Comment');
    press(box, 'Escape');
    expect(vimIn('Comment').mode).toBe('normal');
    expect(noted('After')).toHaveLength(1);
    // The note and the box are under the same line, in one block.
    expect(
      parent!.querySelector(
        '.cm-content[aria-label="After"] .lo-diffthread .lo-ovnote + .lo-diffcomposer',
      ),
    ).not.toBeNull();
  });

  test('a note keeps its line shown, among collapsed lines, once it closes too', () => {
    const shown = open();
    shown.setMarks([overview('new', 12, 13)]);
    const before = runs();
    shown.openNote(at('a', 'new', 12));
    expect(noted('After')).toHaveLength(1);
    const opened = runs();
    expect(opened).not.toEqual(before);
    shown.closeNote();
    expect(noted('After')).toEqual([]);
    expect(runs()).toEqual(opened);
  });

  test('“Read it in the overview” names the block, when the caller hears it', () => {
    const on = { ...events(), explained: vi.fn<NonNullable<DiffEvents['explained']>>() };
    const shown = open(on);
    shown.setMarks([overview('new', 4, 6, 'block-7')]);
    shown.openNote(at('a', 'new', 4));
    const link = parent!.querySelector<HTMLElement>('.lo-ovnote__read');
    expect(link?.textContent).toBe('Read it in the overview');
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    link!.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    link!.click();
    // With the line the note is under, where the reader was.
    expect(on.explained).toHaveBeenCalledWith('block-7', at('a', 'new', 6));
    shown.destroy();
    parent!.remove();
    const quiet = open();
    quiet.setMarks([overview('new', 4, 6)]);
    quiet.openNote(at('a', 'new', 4));
    expect(parent!.querySelector('.lo-ovnote__read')).toBeNull();
  });

  test('a note that wouldn’t be drawn isn’t opened, and Esc passes over one that isn’t now', () => {
    const shown = open();
    shown.setMarks([
      // A file kept out, a range past the file's end, and an old-side line.
      { ...overview('new', 1, 3), at: { file: 'd', side: 'new', from: 1, to: 3 } },
      overview('new', 39, 45),
      overview('old', 4, 6),
    ]);
    expect(shown.hasNote(at('d', 'new', 2))).toBe(false);
    expect(shown.openNote(at('d', 'new', 2))).toBe(false);
    expect(shown.hasNote(at('a', 'new', 40))).toBe(false);
    expect(shown.openNote(at('a', 'new', 40))).toBe(false);
    expect(shown.closeNote()).toBe(false);
    expect(shown.hasNote(at('a', 'old', 5))).toBe(true);
    expect(shown.openNote(at('a', 'old', 5))).toBe(true);
    expect(noted('Before')).toHaveLength(1);
    // Closed into one block, the file draws no note, and Esc leaves it be.
    shown.setCollapsed('a', true);
    expect(noted('Before')).toEqual([]);
    expect(shown.closeNote()).toBe(false);
    shown.setCollapsed('a', false);
    expect(noted('Before')).toHaveLength(1);
    expect(shown.closeNote()).toBe(true);
    expect(noted('Before')).toEqual([]);
  });

  test('a note on lines GitHub’s diff left out isn’t opened', () => {
    const shown = open(events(), {
      files: [
        {
          id: 'a',
          path: 'src/a.ts',
          change: 'modified',
          lines: {
            old: aOld.map((line, index) => (index >= 9 && index < 16 ? '' : line)),
            new: aNew.map((line, index) => (index >= 9 && index < 16 ? '' : line)),
          },
          gaps: [
            { side: 'old', from: 10, to: 16 },
            { side: 'new', from: 10, to: 16 },
          ],
          header: { additions: 3, deletions: 2 },
        },
      ],
    });
    shown.setMarks([overview('new', 8, 12), overview('new', 3, 4, 'two')]);
    expect(shown.hasNote(at('a', 'new', 9))).toBe(false);
    expect(shown.openNote(at('a', 'new', 9))).toBe(false);
    expect(shown.openNote(at('a', 'new', 3))).toBe(true);
  });

  test('a note follows its block’s mark to its new lines', () => {
    const shown = open();
    shown.setMarks([overview('new', 4, 6)]);
    shown.openNote(at('a', 'new', 4));
    shown.setMarks([overview('new', 5, 7)]);
    const note = parent!.querySelector('.cm-content[aria-label="After"] .lo-ovnote')!;
    expect(note.closest('.cm-content > *')!.previousElementSibling?.textContent).toBe('line 7');
    expect(markers('After')).toEqual(['open first', 'rail', 'rail last']);
  });

  test('a note stays open while its mark does, and says what the mark says now', () => {
    const shown = open();
    shown.setMarks([overview('new', 4, 6), overview('new', 8, 9, 'two')]);
    shown.openNote(at('a', 'new', 4));
    shown.setMarks([overview('new', 4, 6, 'one', 'Said again.'), overview('new', 8, 9, 'two')]);
    expect(noted('After')).toEqual(['Overview · Where to look: Said again.']);
    shown.setMarks([overview('new', 8, 9, 'two')]);
    expect(noted('After')).toEqual([]);
    expect(shown.closeNote()).toBe(false);
  });
});

/** A list of one rect, as an element on screen has. */
function oneRect(rect: DOMRect): DOMRectList {
  return Object.assign([rect], { item: (index: number) => (index === 0 ? rect : null) });
}

/** jsdom lays nothing out: from now on, the view's box is a screen, and every note is on it. */
function notesOnScreen(): void {
  vi.spyOn(Element.prototype, 'getClientRects').mockImplementation(function (this: Element) {
    return this.classList.contains('lo-ovnote') ? oneRect(new DOMRect(0, 100, 400, 80)) : noRects();
  });
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    return this.classList.contains('lo-diffview') ? new DOMRect(0, 0, 800, 600) : new DOMRect();
  });
}

/** The diff view's box, which scrolls. */
function scroller(): HTMLElement {
  return parent!.querySelector<HTMLElement>('.lo-diffview')!;
}

/** A note open on new lines 4 to 6, on screen, whose mark then says something else. */
function held(on: DiffEvents = events()): DiffView {
  const shown = open(on);
  shown.setMarks([overview('new', 4, 6)]);
  shown.openNote(at('a', 'new', 4));
  notesOnScreen();
  shown.setMarks([overview('new', 4, 6, 'one', 'Said again.')]);
  expect(noted('After')).toEqual([expect.stringContaining('A query')]);
  return shown;
}

describe('notes held on screen', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  test('one in a file closed and opened again says what its mark says now', () => {
    const shown = held();
    // As the local copy's say closes it, and as `za` does.
    shown.setCollapsed('a', true);
    shown.setCollapsed('a', false);
    expect(noted('After')).toEqual(['Overview · Where to look: Said again.']);
    shown.setMarks([]);
    expect(noted('After')).toHaveLength(1);
    shown.fold({ kind: 'file', file: 'a' }, 'toggle');
    shown.fold({ kind: 'file', file: 'a' }, 'toggle');
    expect(noted('After')).toEqual([]);
    expect(shown.closeNote()).toBe(false);
  });

  test('in a diff too short to scroll, one changes after the reader’s next input', async () => {
    vi.useFakeTimers();
    held();
    // Where the scroll would let it go, the input doesn't.
    Object.defineProperty(scroller(), 'scrollHeight', { configurable: true, value: 2000 });
    Object.defineProperty(scroller(), 'clientHeight', { configurable: true, value: 600 });
    press(scroller(), 'j');
    await vi.runAllTimersAsync();
    expect(noted('After')).toEqual([expect.stringContaining('A query')]);
    Object.defineProperty(scroller(), 'scrollHeight', { configurable: true, value: 600 });
    press(scroller(), 'j');
    // Not before the input is handled.
    expect(noted('After')).toEqual([expect.stringContaining('A query')]);
    await vi.runAllTimersAsync();
    expect(noted('After')).toEqual(['Overview · Where to look: Said again.']);
  });

  test('one changes at once while the view is hidden, as behind another view', () => {
    const shown = open();
    shown.setMarks([overview('new', 4, 6)]);
    shown.openNote(at('a', 'new', 4));
    notesOnScreen();
    Object.assign(scroller(), { checkVisibility: () => false });
    shown.setMarks([overview('new', 4, 6, 'one', 'Said again.')]);
    expect(noted('After')).toEqual(['Overview · Where to look: Said again.']);
  });

  test('its link shows the block its mark is from now, and a mark gone closes it', () => {
    const on = { ...events(), explained: vi.fn<NonNullable<DiffEvents['explained']>>() };
    const shown = held(on);
    shown.setMarks([overview('new', 5, 7, 'one', 'Moved on.')]);
    parent!.querySelector<HTMLElement>('.lo-ovnote__read')!.click();
    expect(on.explained).toHaveBeenCalledWith('one', at('a', 'new', 7));
    expect(noted('After')).toEqual(['Overview · Where to look: Moved on.']);
    shown.setMarks([overview('new', 8, 9, 'two')]);
    expect(noted('After')).toEqual([expect.stringContaining('Moved on.')]);
    parent!.querySelector<HTMLElement>('.lo-ovnote__read')!.click();
    expect(on.explained).toHaveBeenCalledTimes(1);
    expect(noted('After')).toEqual([]);
    expect(markers('After').some((each) => each.startsWith('open'))).toBe(false);
  });
});

describe('swapping', () => {
  test('fills each run of placeholders with one change, and leaves the lines that stay', () => {
    const before = ['a', '', '', '', 'e', '', 'g'];
    const after = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    const host = document.body.appendChild(document.createElement('div'));
    let changed = 0;
    const editor = new EditorView({
      doc: ['header', ...before].join('\n'),
      parent: host,
      extensions: EditorView.updateListener.of((update) =>
        update.changes.iterChangedRanges(() => (changed += 1)),
      ),
    });

    editor.dispatch(swapping(editor.state, 1, before, after, true));

    expect(editor.state.doc.toString()).toBe(['header', ...after].join('\n'));
    // Lines 2 to 4, line 6, and the line added at the end.
    expect(changed).toBe(3);
    editor.destroy();
    host.remove();
  });
});
