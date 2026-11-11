// @vitest-environment jsdom
import { EditorState, Text } from '@codemirror/state';
import { type BlockInfo, BlockType, Decoration, EditorView } from '@codemirror/view';
import { getCM, vim, Vim } from '@replit/codemirror-vim';
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';

import { defineScreenKeys, leaveOnScreen } from './screen.ts';
import { SpacerWidget } from './widgets.ts';

/** How tall the box that scrolls is, as the diff view's was on a laptop's screen. */
const screenHeight = 868;

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

let editor: { view: EditorView; scroller: HTMLElement } | undefined;

afterEach(() => {
  editor?.view.destroy();
  editor?.scroller.remove();
  editor = undefined;
  vi.restoreAllMocks();
});

interface Spacer {
  /** The line the spacer is drawn above, or below. */
  line: number;
  height: number;
  below?: boolean;
}

const lineCount = 200;
const lines = Array.from({ length: lineCount }, (_, index) => `  line ${index + 1}`);

/**
 * An editor as tall as its document, in a box that scrolls, as a side of the diff is: its lines,
 * spacers taller than the screen among them, and `end`, the space after the end of a document
 * shorter than the other side's. jsdom has no layout, so the box's is made up from the editor's
 * heights.
 */
function open(spacers: readonly Spacer[], end = 0): { view: EditorView; scroller: HTMLElement } {
  const doc = Text.of(lines);
  const placed = spacers.map(({ line, height, below }) =>
    Decoration.widget({
      widget: new SpacerWidget(height),
      block: true,
      side: below ? 2 : -1,
    }).range(below ? doc.line(line).to : doc.line(line).from),
  );
  if (end > 0) {
    placed.push(
      Decoration.widget({ widget: new SpacerWidget(end), block: true, side: 3 }).range(doc.length),
    );
  }
  const scroller = document.createElement('div');
  scroller.style.overflowY = 'auto';
  document.body.append(scroller);
  const view = new EditorView({
    parent: scroller,
    state: EditorState.create({
      doc,
      extensions: [vim(), leaveOnScreen, EditorView.decorations.of(Decoration.set(placed, true))],
    }),
  });
  let scrollTop = 0;
  Object.defineProperties(scroller, {
    clientHeight: { get: () => screenHeight },
    scrollHeight: { get: () => view.contentHeight },
    scrollTop: {
      get: () => scrollTop,
      set: (value: number) => {
        scrollTop = Math.max(0, Math.min(view.contentHeight - screenHeight, value));
      },
    },
  });
  scroller.getBoundingClientRect = () => new DOMRect(0, 0, 800, screenHeight);
  view.contentDOM.getBoundingClientRect = () => new DOMRect(0, -scrollTop, 800, view.contentHeight);
  editor = { view, scroller };
  return editor;
}

function bodyOf(row: BlockInfo): BlockInfo {
  const parts = Array.isArray(row.type) ? row.type : [row];
  return parts.find((part) => part.type === BlockType.Text) ?? row;
}

/** What the box shows of the document, by height in it. */
function screenOf(view: EditorView): { top: number; bottom: number } {
  const top = -view.documentTop;
  return { top, bottom: top + screenHeight };
}

/** The cursor's line, from 1. */
function lineOf(view: EditorView): number {
  return view.state.doc.lineAt(view.state.selection.main.head).number;
}

/** Whether the cursor's line is wholly on screen. */
function onScreen(view: EditorView): boolean {
  const line = bodyOf(view.lineBlockAt(view.state.selection.main.head));
  const screen = screenOf(view);
  return line.top >= screen.top - 1 && line.bottom <= screen.bottom + 1;
}

/**
 * Presses `key` in Vim, then brings the cursor into view as Vim has CodeMirror do after every key:
 * left alone where its line is wholly on screen, else the least scroll that shows it, 5 px inside
 * the screen's edge.
 */
function press(view: EditorView, scroller: HTMLElement, key: string): void {
  Vim.handleKey(getCM(view)!, key, 'user');
  if (onScreen(view)) return;
  const line = bodyOf(view.lineBlockAt(view.state.selection.main.head));
  const screen = screenOf(view);
  scroller.scrollTop +=
    line.top < screen.top ? line.top - screen.top - 5 : line.bottom - screen.bottom + 5;
}

function mode(view: EditorView): string {
  const state = getCM(view)!.state.vim!;
  return state.insertMode ? 'insert' : state.visualMode ? 'visual' : 'normal';
}

/** Spacers taller than the screen: above a line, below one, and two that meet. */
const tall: readonly Spacer[] = [
  { line: 40, height: 2660 },
  { line: 90, height: 3100, below: true },
  { line: 130, height: 1500, below: true },
  { line: 131, height: 1500 },
];

describe('paging past spacers taller than the screen', () => {
  for (const [down, up] of [
    ['<PageDown>', '<PageUp>'],
    ['<C-f>', '<C-b>'],
    ['<C-d>', '<C-u>'],
  ] as const) {
    test(`${down} held goes on to the end, and ${up} back to the top, never back`, () => {
      const { view, scroller } = open(tall);
      const max = view.contentHeight - screenHeight;
      let scroll = scroller.scrollTop;
      let line = lineOf(view);
      for (let turn = 0; turn < 30; turn++) {
        press(view, scroller, down);
        expect(scroller.scrollTop).toBeGreaterThanOrEqual(scroll);
        expect(lineOf(view)).toBeGreaterThanOrEqual(line);
        expect(onScreen(view)).toBe(true);
        expect(mode(view)).toBe('normal');
        scroll = scroller.scrollTop;
        line = lineOf(view);
      }
      expect(scroller.scrollTop).toBe(max);
      expect(lineOf(view)).toBe(lineCount);

      for (let turn = 0; turn < 30; turn++) {
        press(view, scroller, up);
        expect(scroller.scrollTop).toBeLessThanOrEqual(scroll);
        expect(lineOf(view)).toBeLessThanOrEqual(line);
        expect(onScreen(view)).toBe(true);
        expect(mode(view)).toBe('normal');
        scroll = scroller.scrollTop;
        line = lineOf(view);
      }
      expect(scroller.scrollTop).toBe(0);
      expect(lineOf(view)).toBe(1);
    });
  }

  test('<C-e> held scrolls on past them a row at a time, and <C-y> back, never back', () => {
    const { view, scroller } = open(tall);
    let scroll = scroller.scrollTop;
    for (let turn = 0; turn < lineCount + 10; turn++) {
      press(view, scroller, '<C-e>');
      expect(scroller.scrollTop).toBeGreaterThanOrEqual(scroll);
      expect(onScreen(view)).toBe(true);
      scroll = scroller.scrollTop;
    }
    expect(scroller.scrollTop).toBe(view.contentHeight - screenHeight);
    for (let turn = 0; turn < lineCount + 10; turn++) {
      press(view, scroller, '<C-y>');
      expect(scroller.scrollTop).toBeLessThanOrEqual(scroll);
      expect(onScreen(view)).toBe(true);
      scroll = scroller.scrollTop;
    }
    expect(scroller.scrollTop).toBe(0);
  });

  test('on a side whose document ends first, PageDown stops with its last line on screen', () => {
    const { view, scroller } = open(tall, 3000);
    let scroll = scroller.scrollTop;
    for (let turn = 0; turn < 30; turn++) {
      press(view, scroller, '<PageDown>');
      expect(scroller.scrollTop).toBeGreaterThanOrEqual(scroll);
      expect(onScreen(view)).toBe(true);
      scroll = scroller.scrollTop;
    }
    expect(lineOf(view)).toBe(lineCount);
  });
});

/** The screen inside the spacer above line 40, and the cursor on line `line`, far from it. */
function inSpacer(line = 1): { view: EditorView; scroller: HTMLElement } {
  const opened = open(tall);
  const { doc } = opened.view.state;
  opened.view.dispatch({ selection: { anchor: doc.line(line).from } });
  const spacer = opened.view.lineBlockAt(doc.line(40).from);
  opened.scroller.scrollTop = spacer.top + 500;
  expect(bodyOf(spacer).top).toBeGreaterThan(screenOf(opened.view).bottom);
  return opened;
}

describe('with only a spacer on screen', () => {
  test('H and M go to the row after it, and L to the row before', () => {
    for (const [key, line] of [
      ['H', 40],
      ['M', 40],
      ['L', 39],
    ] as const) {
      const { view, scroller } = inSpacer();
      Vim.handleKey(getCM(view)!, key, 'user');
      expect(lineOf(view)).toBe(line);
      view.destroy();
      scroller.remove();
    }
  });

  test('<C-d> from a cursor above it goes on from the row after it, and <C-u> from one below from the row before', () => {
    for (const { key, from, to, way } of [
      { key: '<C-d>', from: 1, to: 41, way: 1 },
      { key: '<C-u>', from: lineCount, to: 38, way: -1 },
    ]) {
      const { view, scroller } = inSpacer(from);
      const scroll = scroller.scrollTop;
      press(view, scroller, key);
      expect(Math.sign(scroller.scrollTop - scroll)).toBe(way);
      expect(lineOf(view)).toBe(to);
      view.destroy();
      scroller.remove();
    }
  });
});
