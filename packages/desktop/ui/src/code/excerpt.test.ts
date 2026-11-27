// @vitest-environment jsdom
import { BlockInfo, BlockType, EditorView } from '@codemirror/view';
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
import { SHOW_EVENT, shownIn } from '../reveal.ts';
import type {
  ComposerEvents,
  ExcerptEvents,
  ExcerptInit,
  ExcerptView,
  Place,
  PopoverView,
  RenderPopover,
  RenderThread,
  Spot,
  ThreadView,
  VimKey,
} from './api.ts';
import { createExcerptView, excerptLines } from './excerpt.ts';
import { setVim } from './keys.ts';
import { REST } from './popover.ts';

const noRects = (): DOMRectList => Object.assign([], { item: () => null });

/** jsdom has no fonts, no resize observer and no layout: the view needs only that they exist. */
beforeAll(() => {
  // These are the code views with Vim keys on. `plain.test.ts` has them off, as Lo starts.
  setVim(true);
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

/** The comment boxes drawn now. */
const boxes = () => parent!.querySelectorAll('.lo-diffcomposer');

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

/** The excerpt's editor, in `root`, as only this folder's tests may reach it. */
function editor(root: Element = parent!): EditorView {
  const content = root.querySelector<HTMLElement>('.cm-content');
  if (!content) throw new Error('The excerpt has no editor.');
  const found: unknown = Reflect.get(Reflect.get(Reflect.get(content, 'cmTile'), 'root'), 'view');
  if (!(found instanceof EditorView)) throw new Error('The excerpt has no editor.');
  return found;
}

/**
 * The document lines the excerpt in `root` says are shown (`askToShow`) as `run` runs, in turn, as
 * where they are says; each with what `then` says as it's said, if it's given. Where they are is
 * read laid out as jsdom can't: each line a row of text 10 pixels tall, line `n` from `10n` on the
 * page.
 */
function shownLines(root: Element, run: () => unknown, then?: () => string): string[] {
  const code = editor(root);
  const lineBlockAt: unknown = Reflect.get(EditorView.prototype, 'lineBlockAt');
  const said: string[] = [];
  const listen = (event: Event) => {
    const shown = shownIn(event);
    if (!shown) return;
    Object.defineProperty(code, 'documentTop', { get: () => 0, configurable: true });
    const rows = vi.spyOn(code, 'lineBlockAt').mockImplementation((pos) => {
      const block: unknown =
        typeof lineBlockAt === 'function' ? Reflect.apply(lineBlockAt, code, [pos]) : undefined;
      if (!(block instanceof BlockInfo)) throw new Error('The editor has no line there.');
      const row: unknown = Object.create(block, {
        top: { value: code.state.doc.lineAt(pos).number * 10 },
        height: { value: 10 },
        type: { value: BlockType.Text },
      });
      if (!(row instanceof BlockInfo)) throw new Error('The line could not be laid out.');
      return row;
    });
    const span = shown();
    rows.mockRestore();
    Reflect.deleteProperty(code, 'documentTop');
    if (!span) return;
    const line = Math.round(span.top / 10);
    said.push(then ? `${line} ${then()}` : `${line}`);
  };
  root.addEventListener(SHOW_EVENT, listen);
  try {
    run();
  } finally {
    root.removeEventListener(SHOW_EVENT, listen);
  }
  return said;
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

/**
 * A side's gutter's numbers, top to bottom, of the lines on that side; `marked`, with that class.
 * The cursor's line has an element in each gutter, which marks it, with no number where the line
 * isn't on that side.
 */
function numbers(side: 'old' | 'new', marked = ''): string[] {
  return [
    ...parent!.querySelectorAll<HTMLElement>(
      `.lo-inlinenumbers--${side} .cm-gutterElement${marked}`,
    ),
  ]
    .filter((element) => element.style.visibility !== 'hidden')
    .map((element) => element.textContent ?? '')
    .filter((text) => text !== '');
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
    const row = parent!.querySelector('.lo-filerow');
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

/** The threads' lane by each line or block it marks: each piece's ends, the tick, the bubble. */
function lane(): string[] {
  return [...parent!.querySelectorAll('.lo-threadlane .lo-lanemark')].map((mark) => {
    const parts = [...mark.querySelectorAll('.lo-bracket')].map((piece) => {
      if (piece.classList.contains('lo-bracket--tick')) return 'tick';
      const end = (which: 'from' | 'to') =>
        ['edge', 'mid', 'bubble'].find((kind) =>
          piece.classList.contains(`lo-bracket--${which}-${kind}`),
        );
      return `${end('from')}-${end('to')}`;
    });
    const bubble = mark.querySelector('.lo-bubble');
    if (bubble) parts.push(bubble.getAttribute('aria-label') ?? '');
    return parts.join(', ');
  });
}

/** A thread under new line `line` from new line `from`, unresolved. */
function ranged(id: string, from: number, line: number): ThreadView {
  return {
    ...thread(id, line),
    mark: {
      resolved: false,
      from: { side: 'new', line: from },
      words: { lines: `lines ${from}–${line}`, line: `line ${line}` },
    },
  };
}

/** The threads' lane's first bubble. */
const bubble = (): HTMLElement => parent!.querySelector<HTMLElement>('.lo-threadlane .lo-bubble')!;

describe('the threads’ lane', () => {
  test('beside the numbers: a bubble on a thread’s line, a bracket up its range', () => {
    const shown = open();
    const lanes = [...parent!.querySelectorAll('.cm-gutter')].map((gutter) =>
      gutter.classList.contains('lo-threadlane') ? 'threads' : 'numbers',
    );
    expect(lanes).toEqual(['numbers', 'numbers', 'threads']);
    shown.setThreads([ranged('here', 6, 8)], plain().render);
    expect(lane()).toEqual([
      'mid-edge, tick',
      'edge-edge',
      'edge-bubble, Unresolved thread · lines 6–8',
    ]);
    // From above the first line shown, it starts there, with no tick: new 4, old 5, new 5 and 6.
    shown.setThreads([ranged('here', 2, 6)], plain().render);
    expect(lane()).toEqual([
      'edge-edge',
      'edge-edge',
      'edge-edge',
      'edge-bubble, Unresolved thread · lines 2–6',
    ]);
  });

  test('a click on a bubble collapses its thread, or expands it again, as its tip says', () => {
    const shown = open();
    const { render, asked } = plain();
    shown.setThreads([thread('here', 6)], render);
    expect(bubble().dataset.command).toBeUndefined();
    expect(bubble().dataset.tip).toBe('Collapse thread');
    bubble().dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(asked).toEqual(['draw here', 'update here collapsed']);
    expect(bubble().getAttribute('aria-expanded')).toBe('false');
    expect(bubble().dataset.tip).toBe('Expand thread');
  });
});

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
    expect(on.menu).toHaveBeenLastCalledWith(
      { kind: 'thread', thread: 'here', collapsed: false },
      0,
      0,
    );
    expect(shown.openThread('here', 'toggle')).toBe(true);
    expect(shown.openThread('out', true)).toBe(false);
    shown.setThreads([], render);
    expect(drawnThreads()).toEqual([]);
    expect(asked).toEqual(['draw here', 'update here collapsed', 'destroy here']);
  });

  test('the cursor coming to a line, and a thread or a box opening under it, say the line is shown', () => {
    const shown = open();
    const { render } = plain();
    shown.setThreads([{ ...thread('here', 6), open: false }], render);
    // New line 4, old line 5, new line 5, then new 6 on: new line 6 is the fourth, 8 the sixth.
    expect(shownLines(parent!, () => shown.reveal({ kind: 'line', at: at(8) }))).toEqual(['6']);
    // By a key: `G` to the last line, the sixteenth.
    shown.focus();
    expect(shownLines(parent!, () => shown.passKeys(['G']))).toEqual(['16']);
    // A thread opening, before the box under line 9, once it's drawn.
    expect(shownLines(parent!, () => shown.openThread('here', true))).toEqual(['4']);
    expect(shownLines(parent!, () => shown.openThread('here', false))).toEqual([]);
    const options = { focus: false };
    expect(
      shownLines(
        parent!,
        () => shown.compose(at(9), '', composerEvents(), undefined, options),
        () => `${boxes().length} box`,
      ),
    ).toEqual(['7 1 box']);
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

  test('a box sent on screen stays drawn, its comment on it, until the reader acts, and one opened there takes its place', async () => {
    const shown = open();
    await frame();
    const on = composerEvents();
    const sent = shown.compose(at(6), 'Sent', on);
    sent.hold(true);
    sent.close();
    expect(boxes()).toHaveLength(1);
    expect(boxes()[0]!.classList).toContain('is-sent');
    expect(on.close).not.toHaveBeenCalled();
    const next = shown.compose(at(6), 'Next', on);
    expect(boxes()).toHaveLength(1);
    expect(boxes()[0]!.classList).not.toContain('is-sent');
    next.hold(true);
    next.close();
    expect(boxes()).toHaveLength(1);
    editor().contentDOM.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(boxes()).toHaveLength(0);
  });

  test('a thread that comes under a sent box’s line takes the box’s place in one frame', async () => {
    const sizes = observers();
    const shown = open();
    await frame();
    const { render } = plain();
    const sent = shown.compose(at(6), 'Sent', composerEvents());
    sent.hold(true);
    sent.close();
    shown.setThreads([thread('here', 6)], render);
    expect(drawnThreads()).toEqual(['here']);
    const card = parent!.querySelector<HTMLElement>('[data-thread-id="here"]')!;
    // The thread is drawn on screen.
    const drawnAt = new DOMRect(0, 100, 400, 60);
    vi.spyOn(Element.prototype, 'getClientRects').mockImplementation(function (this: Element) {
      const rects = this.closest('[data-thread-id]') ? [drawnAt] : [];
      return Object.assign(rects, { item: (index: number) => rects[index] ?? null });
    });
    sizes.resize(card.querySelector('.lo-diffthread__host')!, 60);
    expect(card.style.height).toBe('0px');
    expect(parent!.querySelector('.lo-diffcomposer')).not.toBeNull();
    await frame();
    expect(card.style.height).toBe('60px');
    expect(parent!.querySelector('.lo-diffcomposer')).toBeNull();
    vi.restoreAllMocks();
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

  test('a key, click or wheel in a dialog over the overview lets nothing in it come; one in the overview does, or one with nothing focused', async () => {
    const shown = open();
    // The overview the excerpt is in, and a dialog over it, in a portal of its own.
    parent!.setAttribute('data-lo-scope', 'overview');
    const text = document.createElement('p');
    text.tabIndex = 0;
    parent!.append(text);
    const dialog = document.createElement('div');
    dialog.setAttribute('data-lo-scope', 'dialog');
    const field = document.createElement('input');
    dialog.append(field);
    document.body.append(dialog);
    onTestFinished(() => dialog.remove());
    await frame();
    shown.setThreads([thread('here', 6)], plain().render);
    expect(drawnThreads()).toEqual([]);
    for (const type of [KEY_EVENT, 'pointerdown', 'wheel']) {
      field.dispatchEvent(new Event(type, { bubbles: true }));
    }
    expect(drawnThreads()).toEqual([]);
    // A key counts as the listener says it's input, a sequence's only as it ends.
    text.dispatchEvent(new Event('keydown', { bubbles: true }));
    expect(drawnThreads()).toEqual([]);
    text.dispatchEvent(new Event(KEY_EVENT, { bubbles: true }));
    expect(drawnThreads()).toEqual(['here']);
    // A click in the page is the overview's too.
    shown.setThreads([], plain().render);
    field.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(drawnThreads()).toEqual(['here']);
    text.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(drawnThreads()).toEqual([]);
    // So is the wheel, over the excerpt too.
    shown.setThreads([thread('here', 6)], plain().render);
    editor().contentDOM.dispatchEvent(new Event('wheel', { bubbles: true }));
    expect(drawnThreads()).toEqual(['here']);
    // And a key with nothing focused, which the listener sends to the page itself; not one with
    // focus in the dialog.
    shown.setThreads([], plain().render);
    field.focus();
    document.body.dispatchEvent(new Event(KEY_EVENT, { bubbles: true }));
    expect(drawnThreads()).toEqual(['here']);
    field.blur();
    document.body.dispatchEvent(new Event(KEY_EVENT, { bubbles: true }));
    expect(drawnThreads()).toEqual([]);
  });

  test('a reply that comes once its box closed on screen takes the box’s place as its thread grows', async () => {
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
    // Closed as the reply came in the thread's rows: the box stays, the reply on it.
    const reply = shown.compose({ thread: 'here' }, 'A reply', composerEvents());
    reply.hold(true);
    shown.setThreads([{ ...thread('here', 6), version: 2 }], render);
    reply.close();
    expect(parent!.querySelector('.lo-diffcomposer')).not.toBeNull();
    sizes.resize(content, 90);
    expect(card.style.height).toBe('40px');
    await frame();
    expect(card.style.height).toBe('90px');
    expect(card.classList).not.toContain('is-held');
    expect(parent!.querySelector('.lo-diffcomposer')).toBeNull();
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
    expect(parent!.querySelector('.lo-diffcomposer')).toBeNull();
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

/**
 * A caller's popover: one comment per thread, and a comment box's slot, a reply's after its thread
 * and a new comment's after them all, with what it was asked to draw in turn. It draws again only
 * what changed, as React does, so a box in a slot stays in it.
 */
function popped() {
  const painted: string[] = [];
  const render: RenderPopover = (host, popover) => {
    let last = '';
    const draw = (shown: PopoverView): void => {
      const { box } = shown;
      const html = [
        ...shown.threads.map(({ id }) => {
          const reply = box?.thread === id ? `<div data-reply-slot="${id}"></div>` : '';
          return `<div data-thread-id="${id}"><p data-comment="${id}.1" tabindex="-1">${id}</p>${reply}</div>`;
        }),
        box !== undefined && box.thread === undefined ? '<div data-new-slot=""></div>' : '',
      ].join('');
      if (html !== last) host.innerHTML = html;
      last = html;
      painted.push(
        `${shown.threads.map(({ id }) => id).join(' ')} ${shown.pinned ? 'pinned' : 'preview'}`,
      );
    };
    draw(popover);
    return { update: draw, destroy: () => host.replaceChildren() };
  };
  return { render, painted };
}

/**
 * Excerpts of `a`, each of new lines 4 to 17, beside lines, in one box that scrolls, as an
 * overview's code blocks are: each with a thread on its line 6, and its lane's bubble.
 */
function inScroll(count: number) {
  const scroller = document.createElement('div');
  scroller.style.overflowY = 'auto';
  document.body.append(scroller);
  const { render, painted } = popped();
  const shown = Array.from({ length: count }, (_, index) => {
    const host = document.createElement('div');
    scroller.append(host);
    const excerpt = createExcerptView(
      host,
      {
        id: `a${index}`,
        path: 'src/a.ts',
        lines: { old, new: added },
        diff,
        range: { side: 'new', from: 4, to: 17 },
        vimKeys: motions,
        nonce: 'excerpt-nonce',
        threads: 'beside',
      },
      events(),
    );
    for (const content of host.querySelectorAll<HTMLElement>('.cm-content')) content.tabIndex = 0;
    excerpt.setThreads(
      [{ ...thread(`t${index}`, 6), at: { file: `a${index}`, side: 'new', line: 6 } }],
      plain().render,
      { popover: render },
    );
    const mark = () => host.querySelector<HTMLElement>('.lo-threadlane .lo-bubble')!;
    return { excerpt, host, mark };
  });
  onTestFinished(() => {
    for (const { excerpt } of shown) excerpt.destroy();
    scroller.remove();
  });
  const layers = () => scroller.querySelectorAll<HTMLElement>(':scope > .lo-threadpop');
  return { scroller, shown, painted, layers };
}

/** Brings the pointer over `mark`. */
function hover(mark: HTMLElement): void {
  mark.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }));
}

describe('threads beside lines', () => {
  test('a thread takes no room under its line: its mark alone, which a click pins in the scroll around it, and again closes', () => {
    const { shown, painted, layers } = inScroll(1);
    const { excerpt, host, mark } = shown[0]!;
    expect(host.querySelector('[data-thread-id]')).toBeNull();
    expect(mark().dataset.beside).toBe('');
    // Nothing's made for the popover until a thread needs it.
    expect(layers()).toHaveLength(0);
    mark().dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(layers()).toHaveLength(1);
    expect(layers()[0]!.hidden).toBe(false);
    expect(painted.at(-1)).toBe('t0 pinned');
    expect(excerpt.pinned()).toEqual(['t0']);
    expect(mark().getAttribute('aria-expanded')).toBe('true');
    expect(excerpt.keyState().target).toMatchObject({
      kind: 'line',
      at: { file: 'a0', side: 'new', line: 6 },
      thread: 't0',
    });
    // Focus is in it, which is the excerpt's.
    expect(layers()[0]!.contains(document.activeElement)).toBe(true);
    expect(excerpt.hasFocus()).toBe(true);
    mark().dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(excerpt.pinned()).toEqual([]);
    expect(layers()[0]!.hidden).toBe(true);
  });

  test('the cursor coming to a thread’s line builds its popover ahead; closed, focus goes back to the line', () => {
    const { shown, painted, layers } = inScroll(1);
    const { excerpt, host } = shown[0]!;
    excerpt.reveal({ kind: 'line', at: { file: 'a0', side: 'new', line: 6 } });
    excerpt.focus();
    expect(layers()[0]!.hidden).toBe(true);
    expect(painted).toEqual(['t0 preview']);
    expect(excerpt.pinThread('t0', true)).toBe(true);
    expect(document.activeElement?.getAttribute('data-comment')).toBe('t0.1');
    expect(excerpt.closePopover()).toBe(true);
    expect(document.activeElement).toBe(host.querySelector('.cm-content'));
    expect(excerpt.popoverPinned()).toBe(false);
    // Pinned, the cursor leaving its lines closes it.
    excerpt.pinThread('t0');
    excerpt.passKeys(['j', 'j', 'j']);
    expect(excerpt.pinned()).toEqual([]);
  });

  test('a thread’s popover, or a box in it, says its line is shown before it opens there', () => {
    const { shown } = inScroll(1);
    const { excerpt, host } = shown[0]!;
    const pinned = () => (excerpt.popoverPinned() ? 'pinned' : 'closed');
    // New line 6 is the excerpt's fourth; the cursor comes to it as the popover is pinned.
    expect(shownLines(host, () => excerpt.pinThread('t0'), pinned)).toEqual([
      '4 closed',
      '4 pinned',
    ]);
    excerpt.closePopover();
    // A new comment's box on new line 8, the sixth.
    const said = shownLines(
      host,
      () => excerpt.compose({ file: 'a0', side: 'new', line: 8 }, '', composerEvents()),
      pinned,
    );
    expect(said[0]).toBe('6 closed');
    expect(said.at(-1)).toBe('6 pinned');
  });

  test('switching between lines draws its threads under them, and back takes them away', () => {
    const { shown } = inScroll(1);
    const { excerpt, host } = shown[0]!;
    excerpt.pinThread('t0');
    excerpt.setThreadsMode('between');
    expect(excerpt.popoverPinned()).toBe(false);
    expect(host.querySelector('[data-thread-id]')?.textContent).toBe('t0');
    expect(excerpt.pinThread('t0')).toBe(false);
    excerpt.setThreadsMode('beside');
    expect(host.querySelector('[data-thread-id]')).toBeNull();
    expect(excerpt.pinThread('t0')).toBe(true);
  });

  test('excerpts in one scroll share one popover: one opened closes another’s, and one pinned stops their previews', () => {
    vi.useFakeTimers();
    onTestFinished(() => void vi.useRealTimers());
    const { shown, painted, layers } = inScroll(2);
    const first = shown[0]!;
    const second = shown[1]!;
    first.mark().dispatchEvent(new MouseEvent('click', { bubbles: true }));
    second.mark().dispatchEvent(new MouseEvent('pointerover', { bubbles: true }));
    vi.advanceTimersByTime(REST);
    expect(first.excerpt.pinned()).toEqual(['t0']);
    expect(second.excerpt.popoverPinned()).toBe(false);
    expect(painted).not.toContain('t1 preview');
    second.mark().dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(layers()).toHaveLength(1);
    expect(first.excerpt.pinned()).toEqual([]);
    expect(first.mark().getAttribute('aria-expanded')).toBe('false');
    expect(second.excerpt.pinned()).toEqual(['t1']);
    expect(second.excerpt.hasFocus()).toBe(true);
    expect(first.excerpt.hasFocus()).toBe(false);
    // The layer stays with the excerpts that have it, and goes with the last.
    first.excerpt.destroy();
    expect(second.excerpt.pinned()).toEqual(['t1']);
    second.excerpt.destroy();
    expect(layers()).toHaveLength(0);
  });

  test('the popover they share takes the listeners it put on the page and the window with the last', () => {
    const { shown } = inScroll(2);
    const [first, second] = [shown[0]!, shown[1]!];
    const on = [document, window].map((target) => ({
      adds: vi.spyOn(target, 'addEventListener'),
      removes: vi.spyOn(target, 'removeEventListener'),
    }));
    // The first mark clicked makes it, and the second's click takes it there.
    first.mark().dispatchEvent(new MouseEvent('click', { bubbles: true }));
    second.mark().dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const listening = on.flatMap(({ adds }) =>
      adds.mock.calls.map(([type, listener]) => ({ type, listener })),
    );
    expect(listening.map(({ type }) => type)).toEqual(
      expect.arrayContaining(['pointerdown', KEY_EVENT, 'keydown']),
    );
    const gone = () =>
      listening.filter(({ type, listener }) =>
        on.some(({ removes }) =>
          removes.mock.calls.some((call) => call[0] === type && call[1] === listener),
        ),
      );
    first.excerpt.destroy();
    expect(gone()).toEqual([]);
    second.excerpt.destroy();
    expect(gone()).toEqual(listening);
    for (const { adds, removes } of on) {
      adds.mockRestore();
      removes.mockRestore();
    }
  });

  test('one taken down as the pointer rests on its mark previews nothing', () => {
    vi.useFakeTimers();
    onTestFinished(() => void vi.useRealTimers());
    const { shown, layers } = inScroll(2);
    const [first, second] = [shown[0]!, shown[1]!];
    // The pointer comes over the second's mark, and on to the first's, which it rests on.
    hover(second.mark());
    hover(first.mark());
    first.excerpt.destroy();
    vi.advanceTimersByTime(REST);
    expect(layers()).toHaveLength(1);
    expect(layers()[0]!.hidden).toBe(true);
    // The other one's still previews as the pointer rests on its mark.
    hover(second.mark());
    vi.advanceTimersByTime(REST);
    expect(layers()[0]!.hidden).toBe(false);
    expect(layers()[0]!.textContent).toBe('t1');
  });

  test('a comment box opens in the popover, pinned with focus in it: a new comment’s under its line, a reply’s in its thread, one at a time', () => {
    const { shown, layers } = inScroll(1);
    const { excerpt, host } = shown[0]!;
    const first = composerEvents();
    const composer = excerpt.compose({ file: 'a0', side: 'new', line: 8 }, 'Hi', first);
    expect(composer.text).toBe('Hi');
    // Nothing goes under the line: the box is in the scroll's layer.
    expect(host.querySelector('.lo-diffcomposer')).toBeNull();
    expect(layers()).toHaveLength(1);
    expect(layers()[0]!.hidden).toBe(false);
    expect(inBox(document.activeElement)).toBe(true);
    expect(layers()[0]!.contains(document.activeElement)).toBe(true);
    expect(excerpt.popoverPinned()).toBe(true);
    // A box already open there is the one it gives.
    expect(excerpt.compose({ file: 'a0', side: 'new', line: 8 }, '', composerEvents())).toBe(
      composer,
    );
    // A reply's opens in its thread, the other closing and keeping its draft.
    const reply = excerpt.compose({ thread: 't0' }, '', composerEvents(), undefined, {
      name: 'r',
    });
    expect(first.close).toHaveBeenCalledWith(true);
    expect(reply).not.toBe(composer);
    expect(excerpt.pinned()).toEqual(['t0']);
    expect(layers()[0]!.querySelector('[data-thread-id="t0"]')).not.toBeNull();
    expect(inBox(document.activeElement)).toBe(true);
    // A line the excerpt doesn't show takes none.
    expect(() =>
      excerpt.compose({ file: 'a0', side: 'new', line: 30 }, '', composerEvents()),
    ).toThrow('A comment box goes under a line');
  });

  test('a box open closes as threads change how they show, keeping its draft, in the popover or under its line', () => {
    const { shown, layers } = inScroll(1);
    const { excerpt, host } = shown[0]!;
    const beside = composerEvents();
    excerpt.compose({ file: 'a0', side: 'new', line: 8 }, 'Kept', beside);
    excerpt.setThreadsMode('between');
    expect(beside.close).toHaveBeenCalledWith(true);
    expect(layers()[0]!.hidden).toBe(true);
    expect(host.querySelector('.lo-diffcomposer')).toBeNull();
    // Between lines it opens under its line, and goes as they're beside them again.
    const between = composerEvents();
    excerpt.compose({ file: 'a0', side: 'new', line: 8 }, '', between);
    expect(host.querySelector('.lo-diffcomposer')).not.toBeNull();
    excerpt.setThreadsMode('beside');
    expect(between.close).toHaveBeenCalledWith(false);
    expect(host.querySelector('.lo-diffcomposer')).toBeNull();
  });

  test('a draft’s own mark is beside its line, which says so to its keys, and opens its box', () => {
    const { shown } = inScroll(1);
    const { excerpt, host } = shown[0]!;
    const opened = vi.fn<() => void>();
    excerpt.setDrafts([
      { at: { file: 'a0', side: 'new', line: 8 }, words: 'line 8', open: opened },
    ]);
    const own = host.querySelector<HTMLElement>('.lo-threadlane .lo-bubble[data-draft]');
    expect(own?.getAttribute('aria-label')).toBe('Draft · line 8');
    expect(own?.dataset.command).toBe('comments.openDraft');
    excerpt.reveal({ kind: 'line', at: { file: 'a0', side: 'new', line: 8 } });
    expect(excerpt.keyState().target).toMatchObject({
      kind: 'line',
      at: { file: 'a0', side: 'new', line: 8 },
      draft: true,
    });
    expect(excerpt.openDraft({ file: 'a0', side: 'new', line: 8 })).toBe(true);
    expect(opened).toHaveBeenCalledTimes(1);
    expect(excerpt.openDraft({ file: 'a0', side: 'new', line: 9 })).toBe(false);
    // On a thread's line, the draft in it puts the dot on its mark, which opens it too.
    excerpt.setDrafts([{ at: { thread: 't0' }, words: '', open: opened }]);
    expect(host.querySelector('.lo-bubble[data-draft]')).toBeNull();
    expect(excerpt.openDraft({ thread: 't0' })).toBe(true);
    expect(opened).toHaveBeenCalledTimes(2);
  });

  test('one taken down with focus in its code, its popover never made, hands focus to the scroll around it', async () => {
    const { scroller, shown, layers } = inScroll(1);
    const { excerpt, host } = shown[0]!;
    excerpt.focus();
    expect(excerpt.hasFocus()).toBe(true);
    expect(layers()).toHaveLength(0);
    // Taken down, then off the page with what drew it, as the overview lets a block go.
    excerpt.destroy();
    host.remove();
    await Promise.resolve();
    expect(document.activeElement).toBe(scroller);
  });

  test('one taken down pinned, with focus in its popover, hands focus to the scroll around it', async () => {
    const { scroller, shown, layers } = inScroll(1);
    const { excerpt, mark } = shown[0]!;
    mark().dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(excerpt.hasFocus()).toBe(true);
    expect(layers()[0]!.contains(document.activeElement)).toBe(true);
    excerpt.destroy();
    await Promise.resolve();
    expect(document.activeElement).toBe(scroller);
  });
});
