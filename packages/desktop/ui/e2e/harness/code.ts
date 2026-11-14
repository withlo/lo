// The page the code view's spec drives: a diff of one file, a line in every four changed, in a box
// 600 px tall, its threads drawn as cards as tall as the spec says. The spec works it through
// `window.harness`.

import { diffText } from '@lo/diff';

import {
  createDiffView,
  type DiffLayout,
  type DiffView,
  type RenderThread,
} from '../../src/code/index.ts';

const old = Array.from({ length: 300 }, (_, index) => `line ${index + 1}`);
// Lines 1, 5, 9 and on: three unchanged lines between changes, which none collapse.
const changed = old.map((text, index) => (index % 4 === 0 ? `${text}, changed` : text));
const textOf = (lines: readonly string[]): string => `${lines.join('\n')}\n`;

/** How tall each thread's card is drawn, by its id. */
const heights = new Map<string, number>();
const cards = new Map<string, HTMLElement>();

const render: RenderThread = (host, thread) => {
  const card = document.createElement('div');
  card.className = 'card';
  card.textContent = thread.id;
  card.style.height = `${heights.get(thread.id) ?? 60}px`;
  host.append(card);
  cards.set(thread.id, card);
  return {
    update() {},
    destroy() {
      card.remove();
      cards.delete(thread.id);
    },
  };
};

const ignore = (): void => {};

let shown: DiffView | undefined;

function view(): DiffView {
  if (!shown) throw new Error('The page has no view yet.');
  return shown;
}

/** The scrolling box, whose top is the top of the screen. */
function screen(): DOMRect {
  const box = document.querySelector('.lo-diffview');
  if (!box) throw new Error('The page has no view yet.');
  return box.getBoundingClientRect();
}

/** The editor showing the new side: the one on the right side by side, or the inline one. */
function newSide(): Element {
  const found = [
    ...document.querySelectorAll(
      '.cm-content[aria-label="After"], .cm-content[aria-label="Changes"]',
    ),
  ].find((content) => content.getClientRects().length > 0);
  if (!found) throw new Error('No editor shows the new side.');
  return found;
}

/** Where unchanged line `line`'s text starts, down from the top of the screen. */
function lineTop(line: number): number | undefined {
  const text = `line ${line}`;
  const found = [...newSide().querySelectorAll('.cm-line')].find(
    (each) => each.textContent === text,
  );
  return found && found.getBoundingClientRect().top - screen().top;
}

const harness = {
  open(layout: DiffLayout): void {
    const root = document.getElementById('root');
    if (!root) throw new Error('The page has no root.');
    shown = createDiffView(
      root,
      {
        files: [
          {
            id: 'a',
            path: 'src/a.ts',
            change: 'modified',
            lines: { old, new: changed },
            header: { additions: 75, deletions: 75 },
          },
        ],
        layout,
        vimKeys: [],
        nonce: 'harness',
      },
      { cursor: ignore, mode: ignore, file: ignore, jumped: ignore, load: ignore, menu: ignore },
    );
    shown.setDiff('a', diffText(textOf(old), textOf(changed)));
  },
  /** Puts new line `line` at the top of the screen. */
  scrollTo(line: number): void {
    view().scrollTo({ at: { kind: 'line', at: { file: 'a', side: 'new', line } }, offset: 0 });
  },
  /** The unchanged lines whose text is all on screen, and how far down it each starts. */
  onScreen(): { line: number; top: number }[] {
    const { height } = screen();
    return old.flatMap((_, index) => {
      const line = index + 1;
      const top = changed[index] === old[index] ? lineTop(line) : undefined;
      return top !== undefined && top >= 0 && top + 30 <= height ? [{ line, top }] : [];
    });
  },
  lineTop,
  /** How far down the screen the top of what `selector` matches is. */
  top(selector: string): number | undefined {
    const found = document.querySelector(selector);
    return found ? found.getBoundingClientRect().top - screen().top : undefined;
  },
  /** Gives the threads, each under a new line, `height` tall; `now`, as for a view not yet seen. */
  threads(threads: { id: string; line: number; height: number }[], now = false): void {
    for (const { id, height } of threads) heights.set(id, height);
    view().setThreads(
      threads.map(({ id, line }) => ({
        id,
        at: { file: 'a', side: 'new', line },
        open: true,
        version: 1,
      })),
      render,
      { now },
    );
  },
  /** What thread `id` shows grows to `height`, as when an image in it loads. */
  grow(id: string, height: number): void {
    heights.set(id, height);
    const card = cards.get(id);
    if (card) card.style.height = `${height}px`;
  },
  /** Puts the cursor on new line `line`, and focus in the view. */
  cursor(line: number): void {
    view().reveal({ kind: 'line', at: { file: 'a', side: 'new', line } });
    view().focus();
  },
  /** Opens a comment box under new line `line`, with focus in it. */
  compose(line: number): void {
    view().compose({ file: 'a', side: 'new', line }, '', {
      change: ignore,
      submit: ignore,
      close: ignore,
    });
  },
  /** Waits for `count` frames. */
  frames(count: number): Promise<void> {
    return new Promise((resolve) => {
      const next = (left: number): void => {
        if (left === 0) resolve();
        else requestAnimationFrame(() => next(left - 1));
      };
      next(count);
    });
  },
};

declare global {
  interface Window {
    /** What the code view's spec works the page through. */
    harness: typeof harness;
  }
}

window.harness = harness;
