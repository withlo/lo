// @vitest-environment jsdom
import { EditorState, Text } from '@codemirror/state';
import { BlockInfo, BlockType, Decoration, EditorView } from '@codemirror/view';
import { getCM, vim, Vim } from '@replit/codemirror-vim';
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';

import { defineScreenKeys, leaveOnScreen } from './screen.ts';
import { SpacerWidget } from './widgets.ts';

/** How tall the box that scrolls is, as the diff view's was on a laptop's screen. */
const screenHeight = 868;

/** How tall CodeMirror estimates a line, which is all it has here. */
const lineHeight = 14;

const noRects = (): DOMRectList => Object.assign([], { item: () => null });

/** What jsdom lacks that the editor reaches for. */
beforeAll(() => {
  if (!('getClientRects' in Range.prototype)) {
    Object.defineProperty(Range.prototype, 'getClientRects', { value: noRects });
    Object.defineProperty(Range.prototype, 'getBoundingClientRect', { value: () => new DOMRect() });
  }
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
  defineScreenKeys();
});

/**
 * CodeMirror measures what it draws in the next frame, which jsdom, with no layout, measures as
 * nothing tall. Here no frame comes, so the heights stay CodeMirror's estimates: 14 px a line, and
 * a spacer as tall as it says.
 */
beforeEach(() => {
  vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(-1);
});

const opened: { views: EditorView[]; boxes: HTMLElement[] } = { views: [], boxes: [] };

afterEach(() => {
  for (const view of opened.views.splice(0)) view.destroy();
  for (const box of opened.boxes.splice(0)) box.remove();
  vi.restoreAllMocks();
});

interface Spacer {
  /** The line the spacer is drawn above or below, or after which the document ends. */
  line: number;
  height: number;
  place: 'above' | 'below' | 'end';
}

interface Side {
  lines: string[];
  spacers: Spacer[];
}

const lines = (count: number, word: string): string[] =>
  Array.from({ length: count }, (_, index) => `  ${word} ${index + 1}`);

/**
 * The two sides of a diff as the spacer pass lines them up: 40 lines alike; 300 removed, as a
 * file only the old side has is, beside a spacer as tall; 40 alike; 120 added beside a spacer;
 * 40 alike; and 100 more added at the end of the new side, the old side's document ending with
 * space as tall. Every spacer is taller than the screen.
 */
const sides: { old: Side; new: Side } = {
  old: {
    lines: [
      ...lines(40, 'head'),
      ...lines(300, 'removed'),
      ...lines(40, 'middle'),
      ...lines(40, 'tail'),
    ],
    spacers: [
      { line: 380, height: 120 * lineHeight, place: 'below' },
      { line: 420, height: 100 * lineHeight, place: 'end' },
    ],
  },
  new: {
    lines: [
      ...lines(40, 'head'),
      ...lines(40, 'middle'),
      ...lines(120, 'added'),
      ...lines(40, 'tail'),
      ...lines(100, 'more'),
    ],
    spacers: [{ line: 41, height: 300 * lineHeight, place: 'above' }],
  },
};

function editor(parent: HTMLElement, side: Side): EditorView {
  const doc = Text.of(side.lines);
  const placed = side.spacers.map(({ line, height, place }) =>
    Decoration.widget({
      widget: new SpacerWidget(height),
      block: true,
      side: place === 'above' ? -1 : place === 'below' ? 2 : 3,
    }).range(place === 'above' ? doc.line(line).from : doc.line(line).to),
  );
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [vim(), leaveOnScreen, EditorView.decorations.of(Decoration.set(placed, true))],
    }),
  });
  opened.views.push(view);
  return view;
}

interface Diff {
  old: EditorView;
  new: EditorView;
  box: HTMLElement;
}

/**
 * Both sides, each an editor as tall as its document, side by side in one box that scrolls, as
 * the diff view's are. jsdom has no layout, so the box's is made up from the editors' heights.
 */
function open(): Diff {
  const box = document.createElement('div');
  box.style.overflowY = 'auto';
  document.body.append(box);
  opened.boxes.push(box);
  const old = editor(box, sides.old);
  const added = editor(box, sides.new);
  expect(old.contentHeight).toBe(added.contentHeight);
  let scrollTop = 0;
  Object.defineProperties(box, {
    clientHeight: { get: () => screenHeight },
    scrollHeight: { get: () => old.contentHeight },
    scrollTop: {
      get: () => scrollTop,
      set: (value: number) => {
        scrollTop = Math.max(0, Math.min(old.contentHeight - screenHeight, value));
      },
    },
  });
  box.getBoundingClientRect = () => new DOMRect(0, 0, 800, screenHeight);
  for (const view of [old, added]) {
    view.contentDOM.getBoundingClientRect = () =>
      new DOMRect(0, -scrollTop, 400, view.contentHeight);
  }
  return { old, new: added, box };
}

function bodyOf(row: BlockInfo): BlockInfo {
  const parts = Array.isArray(row.type) ? row.type : [row];
  return parts.find((part) => part.type === BlockType.Text) ?? row;
}

/** What the box shows of a document, by height in it. */
function screenOf(view: EditorView): { top: number; bottom: number } {
  const top = -view.documentTop;
  return { top, bottom: top + screenHeight };
}

/** The lines of `view` on screen, wholly or partly, from 1. */
function linesOn(view: EditorView): number[] {
  const screen = screenOf(view);
  const shown: number[] = [];
  for (let number = 1; number <= view.state.doc.lines; number++) {
    const body = bodyOf(view.lineBlockAt(view.state.doc.line(number).from));
    if (body.bottom > screen.top && body.top < screen.bottom) shown.push(number);
  }
  return shown;
}

/** The cursor's line, from 1. */
function lineOf(view: EditorView): number {
  return view.state.doc.lineAt(view.state.selection.main.head).number;
}

function mode(view: EditorView): string {
  const state = getCM(view)!.state.vim!;
  return state.insertMode ? 'insert' : state.visualMode ? 'visual' : 'normal';
}

/**
 * Presses `key` in `view`'s Vim, then brings the cursor into view as Vim has CodeMirror do after
 * every key: left where it is if a scroll handler holds it, else, where its line is off screen,
 * the least scroll that shows it, 5 px inside the screen's edge.
 */
function press(view: EditorView, box: HTMLElement, key: string): void {
  Vim.handleKey(getCM(view)!, key, 'user');
  const range = view.state.selection.main;
  const options = { x: 'nearest', y: 'nearest', xMargin: 5, yMargin: 5 } as const;
  const handlers = view.state.facet(EditorView.scrollHandler);
  if (handlers.some((handler) => handler(view, range, options))) return;
  const line = bodyOf(view.lineBlockAt(range.head));
  const screen = screenOf(view);
  if (line.top < screen.top) box.scrollTop += line.top - screen.top - 5;
  else if (line.bottom > screen.bottom) box.scrollTop += line.bottom - screen.bottom + 5;
}

/**
 * Holds `key` in side `side` from where the scroll is until it stops moving, at most `limit` times,
 * and checks every press: the scroll goes the key's way, by no more than one screen; the cursor
 * goes the same way, onto a line on screen wherever the side shows one; and every line of both
 * sides passes through the screen.
 */
function hold(diff: Diff, side: 'old' | 'new', key: string, way: 1 | -1, limit: number): void {
  const { box } = diff;
  const view = diff[side];
  const seen = { old: new Set(linesOn(diff.old)), new: new Set(linesOn(diff.new)) };
  let line = lineOf(view);
  for (let turn = 0; turn < limit; turn++) {
    const before = box.scrollTop;
    press(view, box, key);
    const moved = (box.scrollTop - before) * way;
    expect(moved).toBeGreaterThanOrEqual(0);
    expect(moved).toBeLessThanOrEqual(screenHeight);
    expect((lineOf(view) - line) * way).toBeGreaterThanOrEqual(0);
    // On a line on screen, unless the side shows none.
    const shown = linesOn(view);
    expect(shown.length === 0 || shown.includes(lineOf(view))).toBe(true);
    expect(mode(view)).toBe('normal');
    line = lineOf(view);
    for (const each of ['old', 'new'] as const) {
      for (const number of linesOn(diff[each])) seen[each].add(number);
    }
    if (moved === 0) break;
  }
  expect(box.scrollTop).toBe(way === 1 ? diff.old.contentHeight - screenHeight : 0);
  for (const each of ['old', 'new'] as const) {
    expect(seen[each].size).toBe(diff[each].state.doc.lines);
  }
}

describe('paging past spacers taller than the screen, and lines on one side only', () => {
  for (const side of ['old', 'new'] as const) {
    // Back at the top, the cursor is on the first line; `Ctrl-y` moves it only off the screen's
    // bottom, so it ends on the last line there.
    for (const [down, up, limit, home] of [
      ['<PageDown>', '<PageUp>', 30, 'first'],
      ['<C-f>', '<C-b>', 30, 'first'],
      ['<C-d>', '<C-u>', 60, 'first'],
      ['<C-e>', '<C-y>', 1000, 'last'],
    ] as const) {
      test(`${down} held on the ${side} side goes on to the end, and ${up} back to the top`, () => {
        const diff = open();
        hold(diff, side, down, 1, limit);
        hold(diff, side, up, -1, limit);
        expect(lineOf(diff[side])).toBe(home === 'first' ? 1 : linesOn(diff[side]).at(-1));
      });
    }
  }

  test('at the end of the scroll, the cursor is on the last line', () => {
    const diff = open();
    hold(diff, 'new', '<PageDown>', 1, 30);
    expect(lineOf(diff.new)).toBe(diff.new.state.doc.lines);
  });

  test('on the side whose document ends first, the cursor goes beside the other side’s lines', () => {
    const diff = open();
    hold(diff, 'old', '<PageDown>', 1, 30);
    expect(linesOn(diff.old)).toEqual([]);
    expect(lineOf(diff.old)).toBe(diff.old.state.doc.lines);
  });
});

/** The screen inside the new side's spacer beside the removed lines, the cursor on line 1. */
function inSpacer(): Diff {
  const diff = open();
  const spacer = diff.new.lineBlockAt(diff.new.state.doc.line(41).from);
  diff.box.scrollTop = spacer.top + 1000;
  expect(linesOn(diff.new)).toEqual([]);
  expect(linesOn(diff.old).length).toBeGreaterThan(0);
  return diff;
}

describe('with only a spacer on the focused side’s screen', () => {
  for (const key of ['H', 'M', 'L']) {
    test(`${key} puts the cursor in the row beside the other side’s lines, and nothing scrolls`, () => {
      const diff = inSpacer();
      const scroll = diff.box.scrollTop;
      press(diff.new, diff.box, key);
      expect(diff.box.scrollTop).toBe(scroll);
      // The row the spacer is drawn in, above line 41.
      expect(lineOf(diff.new)).toBe(41);
    });
  }

  test('a page takes the last line starting on screen to the top, and the cursor doesn’t drag it', () => {
    const diff = inSpacer();
    const last = linesOn(diff.old).at(-1)!;
    const top = (): number =>
      diff.old.lineBlockAt(diff.old.state.doc.line(last).from).top - screenOf(diff.old).top;
    const scroll = diff.box.scrollTop;
    const start = top();
    press(diff.new, diff.box, '<PageDown>');
    expect(top()).toBe(0);
    expect(diff.box.scrollTop - scroll).toBe(start);
    expect(lineOf(diff.new)).toBe(41);
  });
});

describe('bringing the cursor into view', () => {
  test('on a line that wraps, the cursor’s row is read without asking the editor as it updates', () => {
    // A frame is asked for, and reading the layout then measures at once, as the frame would.
    vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1);
    const box = document.createElement('div');
    box.style.overflowY = 'auto';
    document.body.append(box);
    opened.boxes.push(box);
    const errors: unknown[] = [];
    const view = new EditorView({
      parent: box,
      state: EditorState.create({
        doc: Text.of(['  wraps'.repeat(60), '  short']),
        extensions: [
          leaveOnScreen,
          EditorView.lineWrapping,
          EditorView.exceptionSink.of((error) => errors.push(error)),
        ],
      }),
    });
    opened.views.push(view);
    Object.defineProperty(view.scrollDOM, 'clientHeight', { value: screenHeight });
    // jsdom measures every line as nothing tall: the first wraps onto five rows.
    const lineBlockAt: unknown = Reflect.get(EditorView.prototype, 'lineBlockAt');
    vi.spyOn(EditorView.prototype, 'lineBlockAt').mockImplementation(function (
      this: EditorView,
      pos: number,
    ) {
      const block: unknown =
        typeof lineBlockAt === 'function' ? Reflect.apply(lineBlockAt, this, [pos]) : undefined;
      if (!(block instanceof BlockInfo)) throw new Error('The editor has no line there.');
      const tall: unknown = Object.create(block, { height: { value: 5 * lineHeight } });
      if (!(tall instanceof BlockInfo)) throw new Error('The line could not be made taller.');
      return tall;
    });
    view.dispatch({ selection: { anchor: 200 }, scrollIntoView: true });
    view.coordsAtPos(0);
    expect(errors).toEqual([]);
  });
});
