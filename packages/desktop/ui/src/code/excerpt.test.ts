// @vitest-environment jsdom
import { EditorView } from '@codemirror/view';
import { diffText } from '@lo/diff';
import tokenNames from '@lo/design/syntax.json' with { type: 'json' };
import { getCM, Vim } from '@replit/codemirror-vim';
import {
  afterEach,
  beforeAll,
  describe,
  expect,
  type Mock,
  onTestFinished,
  test,
  vi,
} from 'vitest';

import { findScope, isKeySource, KEY_EVENT } from '../commands/index.ts';
import type {
  ComposerEvents,
  ExcerptEvents,
  ExcerptInit,
  ExcerptView,
  Place,
  RenderThread,
  Spot,
  ThreadView,
  VimKey,
} from './api.ts';
import { createExcerptView, excerptLines } from './excerpt.ts';

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
 * Twenty lines, then: line 5 changed, two lines added after line 10 (new lines 11 and 12), and old
 * line 15 removed, between new lines 16 and 17. The new side has 21 lines.
 */
const old = numbered(20);
const added = [
  ...old.slice(0, 4),
  'line 5, changed',
  ...old.slice(5, 10),
  'added one',
  'added two',
  ...old.slice(10, 14),
  ...old.slice(15),
];

function textOf(lines: readonly string[]): string | undefined {
  return lines.length === 0 ? undefined : `${lines.join('\n')}\n`;
}

const diff = diffText(textOf(old), textOf(added));

const motions: VimKey[] = [{ kind: 'motion', command: 'diff.nextChange', keys: ']c' }];

let view: ExcerptView | undefined;
let parent: HTMLElement | undefined;

afterEach(() => {
  view?.destroy();
  parent?.remove();
  view = undefined;
});

type Spied<T> = { [K in keyof T]: T[K] extends (...args: never[]) => unknown ? Mock<T[K]> : never };

function events(): Spied<ExcerptEvents> {
  return {
    cursor: vi.fn<ExcerptEvents['cursor']>(),
    mode: vi.fn<ExcerptEvents['mode']>(),
    jumped: vi.fn<ExcerptEvents['jumped']>(),
    menu: vi.fn<ExcerptEvents['menu']>(),
  };
}

/** An excerpt of `src/a.ts`, as file `a`: new lines 4 to 17 unless `init` says otherwise. */
function open(on: ExcerptEvents = events(), init: Partial<ExcerptInit> = {}): ExcerptView {
  parent = document.createElement('div');
  parent.className = 'lo-app';
  document.body.append(parent);
  view = createExcerptView(
    parent,
    {
      id: 'a',
      path: 'src/a.ts',
      lines: { old, new: added },
      diff,
      range: { side: 'new', from: 4, to: 17 },
      vimKeys: motions,
      nonce: 'excerpt-nonce',
      ...init,
    },
    on,
  );
  // jsdom focuses only what it knows can take focus.
  for (const content of parent.querySelectorAll<HTMLElement>('.cm-content')) content.tabIndex = 0;
  return view;
}

/** The excerpt's editor, as only this folder's tests may reach it. */
function editor(): EditorView {
  const content = parent!.querySelector<HTMLElement>('.cm-content');
  if (!content) throw new Error('The excerpt has no editor.');
  const found: unknown = Reflect.get(Reflect.get(Reflect.get(content, 'cmTile'), 'root'), 'view');
  if (!(found instanceof EditorView)) throw new Error('The excerpt has no editor.');
  return found;
}

/** Vim in the excerpt's editor. */
function vim() {
  const cm = getCM(editor());
  if (!cm) throw new Error('The editor has no Vim.');
  return {
    content: editor().contentDOM,
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

/** Each line's text, as drawn. */
function texts(): string[] {
  return [...parent!.querySelectorAll('.cm-line')].map((line) => line.textContent ?? '');
}

/** A side's gutter's numbers, top to bottom, of the lines on that side; `marked`, with that class. */
function numbers(side: 'old' | 'new', marked = ''): string[] {
  return [
    ...parent!.querySelectorAll<HTMLElement>(
      `.lo-inlinenumbers--${side} .cm-gutterElement${marked}`,
    ),
  ]
    .filter((element) => element.style.visibility !== 'hidden')
    .map((element) => element.textContent ?? '');
}

/** The numbers marked as changed since, on a side. */
function stale(side: 'old' | 'new'): string[] {
  return numbers(side, '.is-stale');
}

/** The lines drawn with the class `name`, as their text. */
function drawn(name: string): string[] {
  return [...parent!.querySelectorAll(`.cm-line.${name}`)].map((line) => line.textContent ?? '');
}

/** Each list of keys, titled by the keys it holds. */
function titled(lists: string[][]): (readonly [string, string[]])[] {
  return lists.map((keys) => [keys.join(''), keys] as const);
}

function at(line: number, side: 'old' | 'new' = 'new'): Place {
  return { file: 'a', side, line };
}

function onLine(line: number, side: 'old' | 'new' = 'new', column?: number): Spot {
  return {
    kind: 'line',
    at: column === undefined ? at(line, side) : { ...at(line, side), column },
  };
}

describe('the lines it shows', () => {
  test('a range on the new side, with the deleted lines of the changes among them', () => {
    expect(excerptLines(diff, { side: 'new', from: 4, to: 6 }, added.length)).toEqual({
      old: [4, 5, 0, 6],
      new: [4, 0, 5, 6],
    });
    // Lines only added: nothing deleted among them.
    expect(excerptLines(diff, { side: 'new', from: 11, to: 12 }, added.length)).toEqual({
      old: [0, 0],
      new: [11, 12],
    });
    // A line removed between two of the range's.
    expect(excerptLines(diff, { side: 'new', from: 16, to: 17 }, added.length)).toEqual({
      old: [14, 15, 16],
      new: [16, 0, 17],
    });
  });

  test('a range on the old side, with the added lines among them', () => {
    expect(excerptLines(diff, { side: 'old', from: 10, to: 11 }, old.length)).toEqual({
      old: [10, 0, 0, 11],
      new: [10, 11, 12, 13],
    });
    expect(excerptLines(diff, { side: 'old', from: 15, to: 15 }, old.length)).toEqual({
      old: [15],
      new: [0],
    });
  });

  test('a range that ends a change shows the rest of it', () => {
    // Old lines 2 and 3 become new line 2: the range ends on new line 2, and old line 3 comes too.
    const short = diffText('a\nb\nc\nd\n', 'a\nX\nd\n');
    expect(excerptLines(short, { side: 'new', from: 1, to: 2 }, 3)).toEqual({
      old: [1, 2, 3, 0],
      new: [1, 0, 0, 2],
    });
    // Ending before the change's end, it stops at its row, the added line beside it included.
    expect(excerptLines(short, { side: 'old', from: 1, to: 2 }, 4)).toEqual({
      old: [1, 2, 0],
      new: [1, 0, 2],
    });
  });

  test('the rest of a change shows 50 lines at most, and says how many more it has', () => {
    const many = Array.from({ length: 120 }, (_, index) => `gone ${index + 1}`);
    const long = diffText(textOf(['a', ...many, 'z']), textOf(['a', 'b', 'z']));
    const shown = excerptLines(long, { side: 'new', from: 1, to: 2 }, 3);
    // Line a, then the deleted lines on the added line's row and 50 more, then the added line.
    expect(shown.old).toEqual([1, ...Array.from({ length: 51 }, (_, index) => index + 2), 0]);
    expect(shown.new).toEqual([1, ...Array.from({ length: 51 }, () => 0), 2]);
    expect(shown.more).toEqual({ after: 52, count: 69 });
    // From the old side, the added lines past it.
    const grown = diffText(textOf(['a', 'b', 'z']), textOf(['a', ...many, 'z']));
    expect(excerptLines(grown, { side: 'old', from: 2, to: 2 }, 3).more).toEqual({
      after: 52,
      count: 69,
    });
    // Short of the cap, nothing's left out.
    expect(excerptLines(diff, { side: 'new', from: 4, to: 6 }, added.length)).not.toHaveProperty(
      'more',
    );
  });

  test('a range at the file’s end stops there, either way round, and one past it shows nothing', () => {
    expect(excerptLines(diff, { side: 'new', from: 99, to: 18 }, added.length)).toEqual({
      old: [17, 18, 19, 20],
      new: [18, 19, 20, 21],
    });
    expect(excerptLines(diff, { side: 'new', from: 30, to: 40 }, added.length)).toEqual({
      old: [],
      new: [],
    });
    expect(excerptLines(diff, { side: 'new', from: 0, to: 1 }, added.length)).toEqual({
      old: [1],
      new: [1],
    });
  });

  test('without a diff, the range’s lines alone', () => {
    expect(excerptLines(undefined, { side: 'new', from: 3, to: 5 }, added.length)).toEqual({
      old: [0, 0, 0],
      new: [3, 4, 5],
    });
  });
});

describe('what it draws', () => {
  test('the lines, numbered on each side as in the file, changes marked', () => {
    open(events(), { range: { side: 'new', from: 4, to: 6 } });
    expect(texts()).toEqual(['line 4', 'line 5', 'line 5, changed', 'line 6']);
    expect(numbers('old')).toEqual(['4', '5', '6']);
    expect(numbers('new')).toEqual(['4', '5', '6']);
    expect(drawn('lo-line-del')).toEqual(['line 5']);
    expect(drawn('lo-line-add')).toEqual(['line 5, changed']);
    expect(parent!.querySelectorAll('.lo-word-add').length).toBeGreaterThan(0);
  });

  test('what a change has past the 50 lines shown is a row of its own, where they’d be', () => {
    const many = Array.from({ length: 120 }, (_, index) => `gone ${index + 1}`);
    const lines = { old: ['a', ...many, 'z'], new: ['a', 'b', 'z'] };
    const shown = open(events(), {
      lines,
      diff: diffText(textOf(lines.old), textOf(lines.new)),
      range: { side: 'new', from: 1, to: 2 },
    });
    // The editor draws the lines around the cursor: the excerpt's end.
    shown.reveal({ kind: 'line', at: at(2) });
    const row = parent!.querySelector('.lo-filenote');
    expect(row?.textContent).toBe('69 more lines in this change');
    expect(row?.previousElementSibling?.textContent).toBe('gone 51');
    expect(row?.nextElementSibling?.textContent).toBe('b');
    expect(numbers('new')).toContain('2');
  });

  test('a range at the file’s end, its numbers taken as they are', () => {
    open(events(), { range: { side: 'new', from: 19, to: 40 } });
    expect(texts()).toEqual(['line 18', 'line 19', 'line 20']);
    expect(numbers('new')).toEqual(['19', '20', '21']);
    expect(numbers('old')).toEqual(['18', '19', '20']);
  });

  test('without a diff, plain lines with one column of numbers', () => {
    open(events(), { diff: undefined, range: { side: 'new', from: 2, to: 3 } });
    expect(texts()).toEqual(['line 2', 'line 3']);
    expect(parent!.querySelector('.lo-inlinenumbers--old')).toBeNull();
    expect(numbers('new')).toEqual(['2', '3']);
    expect(parent!.querySelectorAll('.lo-line-add, .lo-line-del')).toHaveLength(0);
  });

  test('a long line is held whole, as one numbered line that wraps, its change marked', () => {
    const long = Array.from({ length: 4000 }, (_, index) => `word${index}`).join(' ');
    const lines = { old: ['first', 'short', 'last'], new: ['first', long, 'last'] };
    open(events(), {
      lines,
      diff: diffText(textOf(lines.old), textOf(lines.new)),
      range: { side: 'new', from: 2, to: 2 },
    });
    expect(vim().text).toBe(`short\n${long}`);
    expect(numbers('old')).toEqual(['2']);
    expect(numbers('new')).toEqual(['2']);
    expect(editor().contentDOM.classList.contains('cm-lineWrapping')).toBe(true);
    expect(drawn('lo-line-del')).toEqual(['short']);
    // CodeMirror draws only as much of a line this long as it needs to.
    const drawnLong = drawn('lo-line-add');
    expect(drawnLong).toHaveLength(1);
    expect(drawnLong[0]!.startsWith('word0 word1 word2')).toBe(true);
  });

  test('stale lines have their numbers marked, on the range’s side, given at first or later', () => {
    const shown = open(events(), { range: { side: 'new', from: 4, to: 6 }, stale: [5] });
    expect(stale('new')).toEqual(['5']);
    expect(stale('old')).toEqual([]);
    shown.setStale([4, 6]);
    expect(stale('new')).toEqual(['4', '6']);
    shown.setStale([]);
    expect(stale('new')).toEqual([]);
  });

  test('tokens highlight each side’s lines, given at first or later', () => {
    const keyword = tokenNames.indexOf('keyword');
    // `line` at the start of old line 5 and of new line 5: each line before is 6 characters and a
    // line break.
    const tokens = Uint32Array.of(28, 32, keyword);
    const shown = open(events(), { range: { side: 'new', from: 4, to: 6 } });
    expect(parent!.querySelectorAll('.lo-syn-keyword')).toHaveLength(0);
    shown.setTokens('old', tokens);
    shown.setTokens('new', tokens);
    expect(
      [...parent!.querySelectorAll('.lo-syn-keyword')].map(
        (each) => each.closest('.cm-line')?.textContent,
      ),
    ).toEqual(['line 5', 'line 5, changed']);
    shown.destroy();
    parent!.remove();
    open(events(), { range: { side: 'new', from: 4, to: 6 }, tokens: { old: tokens } });
    expect(parent!.querySelectorAll('.lo-syn-keyword')).toHaveLength(1);
  });

  test('its style elements carry the nonce it was given', () => {
    open();
    expect(editor().state.facet(EditorView.cspNonce)).toBe('excerpt-nonce');
  });

  test('a right-click on the code is its line’s menu', () => {
    const on = events();
    open(on, { range: { side: 'new', from: 5, to: 6 } });
    const click = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    // jsdom has no layout, so every point is on the first line: old line 5, deleted.
    parent!.querySelector('.cm-line')!.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    expect(on.menu).toHaveBeenLastCalledWith({ kind: 'line', at: at(5, 'old') }, 0, 0);
  });
});

describe('places', () => {
  test('each line is on the side it’s on, an unchanged one on the range’s', () => {
    const on = events();
    const shown = open(on, { range: { side: 'new', from: 4, to: 6 } });
    shown.focus();
    const places = [at(4), at(5, 'old'), at(5), at(6)];
    const seen = places.map((place) => {
      expect(shown.reveal({ kind: 'line', at: place })).toBe(true);
      return on.cursor.mock.lastCall?.[0];
    });
    expect(seen).toEqual(places.map(({ side, line }) => onLine(line, side, 0)));
    // An unchanged line's old place is the same line, which is on the new side here.
    shown.reveal({ kind: 'line', at: at(6, 'old') });
    expect(shown.keyState().target).toEqual({ kind: 'line', at: { ...at(6), column: 0 } });
    shown.destroy();
    parent!.remove();
    // On the old side, an unchanged line is an old line, and an added one a new line.
    const before = open(on, { range: { side: 'old', from: 10, to: 11 } });
    expect(before.reveal({ kind: 'line', at: at(11) })).toBe(true);
    expect(before.keyState().target).toEqual({ kind: 'line', at: { ...at(11), column: 0 } });
    expect(before.reveal({ kind: 'line', at: at(11, 'old') })).toBe(true);
    expect(before.keyState().target).toEqual({ kind: 'line', at: { ...at(11, 'old'), column: 0 } });
  });

  test('reveal takes a line it shows, a span’s last line or its file, and refuses the rest', () => {
    const shown = open();
    expect(shown.reveal({ kind: 'line', at: { file: 'a', side: 'new', from: 6, to: 9 } })).toBe(
      true,
    );
    expect(shown.keyState().target).toEqual({ kind: 'line', at: { ...at(9), column: 0 } });
    expect(shown.reveal({ kind: 'file', file: 'a' })).toBe(true);
    expect(shown.keyState().target).toEqual({ kind: 'line', at: { ...at(4), column: 0 } });
    for (const target of [
      { kind: 'line', at: at(3) },
      { kind: 'line', at: at(18) },
      { kind: 'line', at: at(1, 'old') },
      { kind: 'line', at: { file: 'b', side: 'new', line: 5 } },
      { kind: 'file', file: 'b' },
      { kind: 'thread', thread: 't' },
      { kind: 'none' },
    ] as const) {
      expect(shown.reveal(target)).toBe(false);
    }
    expect(shown.keyState().target).toEqual({ kind: 'line', at: { ...at(4), column: 0 } });
  });

  test('an excerpt with no lines has its cursor on its header', () => {
    const on = events();
    const shown = open(on, { range: { side: 'new', from: 40, to: 50 } });
    expect(texts()).toEqual(['']);
    shown.focus();
    expect(on.cursor).toHaveBeenLastCalledWith({ kind: 'header', file: 'a', side: 'new' });
    expect(numbers('new')).toEqual([]);
  });

  test('in visual mode, the target is the lines selected on one side', () => {
    const shown = open(events(), { range: { side: 'new', from: 6, to: 10 } });
    shown.reveal({ kind: 'line', at: at(7) });
    vim().keys('V', 'G');
    expect(shown.keyState()).toMatchObject({
      mode: 'visual',
      target: { kind: 'line', at: { file: 'a', side: 'new', from: 7, to: 10 } },
    });
    vim().keys('<Esc>');
  });

  test('lines selected on one side take the other side’s between them, as they show', () => {
    const shown = open(events(), { range: { side: 'new', from: 16, to: 17 } });
    shown.reveal({ kind: 'line', at: at(16) });
    vim().keys('V', 'G');
    expect(shown.keyState().target).toEqual({
      kind: 'line',
      at: { file: 'a', side: 'new', from: 16, to: 17 },
      across: [
        { file: 'a', side: 'new', from: 16, to: 16 },
        { file: 'a', side: 'old', from: 15, to: 15 },
        { file: 'a', side: 'new', from: 17, to: 17 },
      ],
    });
    vim().keys('<Esc>');
  });

  test('Vim’s count is said, and takes that many lines from the cursor’s as they show', () => {
    const shown = open(events(), { range: { side: 'old', from: 10, to: 11 } });
    shown.reveal({ kind: 'line', at: at(10, 'old') });
    vim().keys('3');
    expect(shown.keyState()).toMatchObject({
      mode: 'normal',
      count: 3,
      target: {
        at: { file: 'a', side: 'old', line: 10 },
        across: [
          { file: 'a', side: 'old', from: 10, to: 10 },
          { file: 'a', side: 'new', from: 11, to: 12 },
        ],
      },
    });
    shown.clearPending();
    expect(shown.keyState().count).toBeUndefined();
  });
});

/** Presses `keys` on new line 8, focused, and says what became of it. */
function pressing(keys: string[]) {
  const on = events();
  const shown = open(on);
  shown.reveal({ kind: 'line', at: at(8) });
  shown.focus();
  const keyed = vim();
  const before = { text: keyed.text, cursor: keyed.cursor };
  keyed.keys(...keys);
  return { on, shown, keyed, before };
}

describe('keys', () => {
  test('it answers for the file scope, as long as it lasts', () => {
    const shown = open();
    const scope = findScope(vim().content);
    expect(scope.name).toBe('file');
    expect(isKeySource(scope.source) && scope.source).toBe(shown);
    shown.destroy();
    view = undefined;
    expect(parent!.querySelector('.lo-excerpt')).toBeNull();
    expect(scope.element && findScope(scope.element).source).toBeUndefined();
  });

  test('a jump goes out with its side and file, never into a list of Vim’s', () => {
    const on = events();
    const shown = open(on, { range: { side: 'new', from: 14, to: 17 } });
    shown.reveal({ kind: 'line', at: at(14) });
    shown.focus();
    const keys = vim();
    keys.keys('G');
    expect(on.jumped).toHaveBeenLastCalledWith(onLine(14), onLine(17));
    keys.keys('g', 'g');
    expect(on.jumped).toHaveBeenLastCalledWith(onLine(17), onLine(14));
    const calls = on.jumped.mock.calls.length;
    const { cursor } = keys;
    keys.keys('<C-o>');
    expect(keys.cursor).toBe(cursor);
    expect(on.jumped).toHaveBeenCalledTimes(calls);
  });

  test('passKeys hands keys to Vim, as if typed, and cursor and mode events follow', () => {
    const on = events();
    const shown = open(on, { range: { side: 'new', from: 4, to: 6 } });
    shown.reveal({ kind: 'line', at: at(4) });
    shown.focus();
    shown.passKeys(['G']);
    expect(on.cursor).toHaveBeenLastCalledWith(onLine(6, 'new', 0));
    shown.passKeys(['v']);
    expect(on.mode).toHaveBeenLastCalledWith('visual');
    shown.passKeys(['<Esc>']);
    expect(on.mode).toHaveBeenLastCalledWith('normal');
    shown.passKeys(['2']);
    expect(shown.keyState().pending).toBe(true);
    shown.clearPending();
    expect(shown.keyState().pending).toBe(false);
  });

  test.each(titled([['i'], ['A'], ['o'], ['O'], ['c', 'c'], ['R'], ['g', 'I']]))(
    '%s doesn’t enter insert or replace mode, nor move',
    (_, keys) => {
      const { on, shown, keyed, before } = pressing(keys);
      expect(keyed.mode).toBe('normal');
      expect(shown.keyState().mode).toBe('normal');
      expect(keyed.text).toBe(before.text);
      expect(keyed.cursor).toBe(before.cursor);
      expect(on.mode).not.toHaveBeenCalledWith('insert');
    },
  );

  test.each(
    titled([
      ['V', 'c'],
      ['<C-v>', 'I'],
    ]),
  )('%s doesn’t enter insert mode from visual mode', (_, keys) => {
    const { on, shown, keyed, before } = pressing(keys);
    expect(keyed.mode).not.toBe('insert');
    expect(shown.keyState().mode).not.toBe('insert');
    expect(keyed.text).toBe(before.text);
    expect(on.mode).not.toHaveBeenCalledWith('insert');
  });

  test.each(titled([['x'], ['d', 'd'], ['y', 'y', 'p'], ['J'], ['r', 'X'], ['>', '>']]))(
    '%s changes no text',
    (_, keys) => {
      open();
      const keyed = vim();
      const before = keyed.text;
      keyed.keys(...keys);
      expect(keyed.text).toBe(before);
    },
  );
});

/** A thread under line `line` of `a`'s new side. */
function thread(id: string, line: number, file = 'a'): ThreadView {
  return { id, at: { file, side: 'new', line }, open: true, version: 1 };
}

/** A caller's threads, drawn as their ids, with what it was asked to do in turn. */
function plain() {
  const asked: string[] = [];
  const render: RenderThread = (host, shown) => {
    asked.push(`draw ${shown.id}`);
    host.textContent = shown.id;
    return {
      update: (next) => asked.push(`update ${next.id} ${next.open ? 'open' : 'collapsed'}`),
      destroy: () => asked.push(`destroy ${shown.id}`),
    };
  };
  return { render, asked };
}

/** The threads drawn, in the page's order. */
function drawnThreads(): (string | undefined)[] {
  return [...parent!.querySelectorAll<HTMLElement>('[data-thread-id]')].map(
    (each) => each.dataset.threadId,
  );
}

describe('threads and comment boxes', () => {
  test('a thread draws under its line, is the line’s target and its menu, and opens and closes', () => {
    const on = events();
    const shown = open(on);
    const { render, asked } = plain();
    shown.setThreads([thread('here', 6), thread('elsewhere', 6, 'b'), thread('out', 19)], render);
    expect(drawnThreads()).toEqual(['here']);
    shown.reveal({ kind: 'line', at: at(6) });
    expect(shown.keyState().target).toEqual({
      kind: 'line',
      at: { ...at(6), column: 0 },
      thread: 'here',
    });
    const click = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    parent!.querySelector('[data-thread-id="here"]')!.dispatchEvent(click);
    expect(on.menu).toHaveBeenLastCalledWith({ kind: 'thread', thread: 'here' }, 0, 0);
    expect(shown.openThread('here', 'toggle')).toBe(true);
    expect(shown.openThread('out', true)).toBe(false);
    shown.setThreads([], render);
    expect(drawnThreads()).toEqual([]);
    expect(asked).toEqual(['draw here', 'update here collapsed', 'destroy here']);
  });

  test('a box under a thread acts on it, and Esc Esc closes it, keeping the draft', () => {
    const shown = open();
    shown.setThreads([thread('here', 6)], plain().render);
    const on = {
      change: vi.fn<ComposerEvents['change']>(),
      submit: vi.fn<ComposerEvents['submit']>(),
      close: vi.fn<ComposerEvents['close']>(),
    };
    const box = shown.compose({ thread: 'here' }, 'Reply', on);
    expect(shown.compose(at(6), 'Again', on)).toBe(box);
    expect(parent!.querySelector('.lo-diffthread__thread + .lo-diffcomposer')).not.toBeNull();
    const content = parent!.querySelector<HTMLElement>('.cm-content[aria-label="Comment"]')!;
    const scope = findScope(content);
    expect(scope.name).toBe('box');
    expect(isKeySource(scope.source) && scope.source.keyState()).toMatchObject({
      mode: 'insert',
      target: { kind: 'line', at: at(6), thread: 'here' },
    });
    const escape = () =>
      content.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      );
    escape();
    expect(on.close).not.toHaveBeenCalled();
    escape();
    expect(on.close).toHaveBeenCalledWith(true);
    expect(parent!.querySelector('.lo-diffcomposer')).toBeNull();
    expect(() => shown.compose(at(19), '', on)).toThrow('A comment box goes under a line');
  });

  test('threads that come on a line on screen wait until the reader acts in the excerpt, or it’s off screen', async () => {
    const shown = open();
    await frame();
    const { render } = plain();
    shown.setThreads([thread('here', 6)], render);
    expect(drawnThreads()).toEqual([]);
    // A scroll that leaves the line on screen changes nothing; a pointer in the excerpt lets it come.
    document.dispatchEvent(new Event('scroll'));
    expect(drawnThreads()).toEqual([]);
    editor().contentDOM.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(drawnThreads()).toEqual(['here']);
    // Going, it waits too, until a scroll takes its line off screen.
    shown.setThreads([], render);
    expect(drawnThreads()).toEqual(['here']);
    const below = vi.spyOn(EditorView.prototype, 'documentTop', 'get').mockReturnValue(5000);
    document.dispatchEvent(new Event('scroll'));
    expect(drawnThreads()).toEqual([]);
    below.mockRestore();
  });

  test('a box sent on screen keeps its room until the reader acts, and one opened there takes it', async () => {
    const shown = open();
    await frame();
    const on = composerEvents();
    const room = () => parent!.querySelector('.lo-diffcomposer-room');
    shown.compose(at(6), 'Sent', on).close();
    expect(parent!.querySelector('.lo-diffcomposer')).toBeNull();
    expect(room()).not.toBeNull();
    expect(on.close).not.toHaveBeenCalled();
    shown.compose(at(6), 'Next', on).close();
    expect(parent!.querySelectorAll('.lo-diffcomposer-room')).toHaveLength(1);
    editor().contentDOM.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(room()).toBeNull();
  });

  test('a key the registry takes, in the excerpt or out of it, lets what waits come, as the listener tells of it', async () => {
    const shown = open();
    await frame();
    const { render } = plain();
    shown.setThreads([thread('here', 6)], render);
    expect(drawnThreads()).toEqual([]);
    // As `listen` sends it before the registry runs the key, which goes no further.
    editor().contentDOM.dispatchEvent(new Event(KEY_EVENT, { bubbles: true }));
    expect(drawnThreads()).toEqual(['here']);
    // Elsewhere, what no scroll can take off screen comes: the page doesn't scroll here.
    shown.setThreads([], render);
    expect(drawnThreads()).toEqual(['here']);
    document.body.dispatchEvent(new Event(KEY_EVENT, { bubbles: true }));
    expect(drawnThreads()).toEqual([]);
  });

  test('a reply that comes once its box closed on screen takes the room the box left', async () => {
    const sizes = observers();
    const shown = open();
    const { render } = plain();
    shown.setThreads([thread('here', 6)], render);
    await frame();
    // The thread is drawn on screen, and the box is 80 px tall.
    const drawnAt = new DOMRect(0, 100, 400, 80);
    vi.spyOn(Element.prototype, 'getClientRects').mockImplementation(function (this: Element) {
      const rects = this.closest('[data-thread-id]') ? [drawnAt] : [];
      return Object.assign(rects, { item: (index: number) => rects[index] ?? null });
    });
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: Element,
    ) {
      return this.closest('[data-thread-id]') ? drawnAt : new DOMRect();
    });
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.classList.contains('lo-diffcomposer') ? 80 : 0;
    });
    const card = parent!.querySelector<HTMLElement>('[data-thread-id="here"]')!;
    const content = card.querySelector('.lo-diffthread__host')!;
    sizes.resize(content, 40);
    // Closed as GitHub answered, before the reply is in the thread.
    shown.compose({ thread: 'here' }, 'A reply', composerEvents()).close();
    const room = parent!.querySelector<HTMLElement>('.lo-diffcomposer-room')!;
    expect(room.style.height).toBe('80px');
    shown.setThreads([{ ...thread('here', 6), version: 2 }], render);
    sizes.resize(content, 90);
    await frame();
    expect(card.style.height).toBe('90px');
    expect(card.classList).not.toContain('is-held');
    expect(room.style.height).toBe('30px');
    // More than the room has left waits for the reader.
    shown.setThreads([{ ...thread('here', 6), version: 3 }], render);
    sizes.resize(content, 150);
    await frame();
    expect(card.style.height).toBe('90px');
    expect(card.classList).toContain('is-held');
    vi.restoreAllMocks();
  });

  test('a box opened unfocused leaves focus and Vim’s selection be; asked for again, it’s focused', () => {
    const shown = open();
    shown.focus();
    const keyed = vim();
    keyed.keys('V');
    const on = composerEvents();
    const box = shown.compose(at(6), 'Kept', on, undefined, { focus: false });
    expect(keyed.mode).toBe('visual');
    expect(document.activeElement).toBe(keyed.content);
    expect(shown.compose(at(6), '', on)).toBe(box);
    expect(inBox(document.activeElement)).toBe(true);
    expect(box.text).toBe('Kept');
  });

  test('a box dismissed, as its draft goes elsewhere, tells its caller nothing; focus in it goes to its line', () => {
    const shown = open();
    const on = composerEvents();
    shown.compose(at(6), 'Moved', on).dismiss();
    expect(parent!.querySelector('.lo-diffcomposer, .lo-diffcomposer-room')).toBeNull();
    expect(on.close).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(editor().contentDOM);
    expect(shown.keyState().target).toMatchObject({ kind: 'line', at: at(6) });
    // Focus elsewhere stays there.
    const outside = document.createElement('input');
    document.body.append(outside);
    outside.focus();
    shown.compose(at(8), 'Elsewhere', on, undefined, { focus: false }).dismiss();
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });
});

/** Resize observers made from now on, until the test ends, which the test calls as the page would. */
function observers() {
  const made: { callback: ResizeObserverCallback; watched: Set<Element> }[] = [];
  const before = globalThis.ResizeObserver;
  globalThis.ResizeObserver = class {
    readonly #watched = new Set<Element>();
    constructor(callback: ResizeObserverCallback) {
      made.push({ callback, watched: this.#watched });
    }
    observe(element: Element): void {
      this.#watched.add(element);
    }
    unobserve(element: Element): void {
      this.#watched.delete(element);
    }
    disconnect(): void {
      this.#watched.clear();
    }
  };
  onTestFinished(() => {
    globalThis.ResizeObserver = before;
  });
  return {
    /** Tells the observers watching `element` that it's `height` tall now. */
    resize(element: Element, height: number): void {
      const size = { blockSize: height, inlineSize: 400 };
      const entry: ResizeObserverEntry = {
        target: element,
        borderBoxSize: [size],
        contentBoxSize: [size],
        devicePixelContentBoxSize: [size],
        contentRect: new DOMRect(0, 0, 400, height),
      };
      for (const { callback, watched } of made) {
        if (watched.has(element)) callback([entry], new globalThis.ResizeObserver(() => {}));
      }
    },
  };
}

/** The next frame. */
function frame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

/** A box's events, each a spy. */
function composerEvents() {
  return {
    change: vi.fn<ComposerEvents['change']>(),
    submit: vi.fn<ComposerEvents['submit']>(),
    close: vi.fn<ComposerEvents['close']>(),
  };
}

/** Whether `element` is in a comment box. */
function inBox(element: Element | null): boolean {
  return element?.closest('.lo-diffcomposer') != null;
}
