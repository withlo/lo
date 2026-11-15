// The page the code view's spec drives: a diff of one file, a line in every four changed, in a box
// 600 px tall, its threads drawn as cards as tall as the spec says, with Lo's key listener, as the
// window runs it, which tells the view of each key once it's the reader's input. The first lines can
// run on past the box's width, so they wrap. The spec works it through `window.harness`.

import { diffText } from '@lo/diff';

import {
  createDiffView,
  type DiffLayout,
  type DiffView,
  type RenderThread,
} from '../../src/code/index.ts';
import { listen, Registry } from '../../src/commands/index.ts';

/** What the next key does first, before Lo's key listener, or anything else, hears of it. */
let beforeKey: (() => void) | undefined;
window.addEventListener(
  'keydown',
  () => {
    const run = beforeKey;
    beforeKey = undefined;
    run?.();
  },
  { capture: true },
);

// No command of Lo's: every key is Vim's, and the reader's input as it comes.
listen(window, new Registry({ system: 'linux', commands: [] }));

let old: string[] = [];
let changed: string[] = [];

/**
 * The file's lines: `line 1` to `line 300`, the first `wrapped` of them with words after that wrap,
 * onto more rows the narrower the view.
 */
function setLines(wrapped: number): void {
  old = Array.from({ length: 300 }, (_, index) =>
    index < wrapped ? `line ${index + 1}${' and more words'.repeat(20)}` : `line ${index + 1}`,
  );
  // Lines 1, 5, 9 and on: three unchanged lines between changes, which none collapse.
  changed = old.map((text, index) => (index % 4 === 0 ? `${text}, changed` : text));
}

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

/** The box the view is drawn in. */
function root(): HTMLElement {
  const found = document.getElementById('root');
  if (!found) throw new Error('The page has no root.');
  return found;
}

const harness = {
  /** Draws the view in `layout`, its first `wrapped` lines long enough to wrap. */
  open(layout: DiffLayout, wrapped = 0): void {
    setLines(wrapped);
    shown = createDiffView(
      root(),
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
  /** Puts new line `line` at the top of the screen, or `below` pixels below it. */
  scrollTo(line: number, below = 0): void {
    view().scrollTo({ at: { kind: 'line', at: { file: 'a', side: 'new', line } }, offset: -below });
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
  /** The view narrows, or widens, to `width`, as when a panel opens or closes beside it. */
  narrow(width: number): void {
    root().style.width = `${width}px`;
  },
  /**
   * The view narrows to `width` as the next key comes, before anything on the page hears of it, so
   * what the key does is done at the new width.
   */
  narrowOnKey(width: number): void {
    beforeKey = () => harness.narrow(width);
  },
  /** The view narrows to `width` as the next wheel comes, before the view hears of it. */
  narrowOnWheel(width: number): void {
    window.addEventListener('wheel', () => harness.narrow(width), {
      capture: true,
      once: true,
      passive: true,
    });
  },
  /**
   * Thread `id` grows to `height` with no input, as `grow` has it, and the view narrows to `width`
   * at the start of the frame that takes the thread's change, before it's taken, as when a panel
   * opens beside the diff just then. The next frame lays the thread out, and the view takes its
   * change in the one after.
   */
  growAsItNarrows(id: string, height: number, width: number): void {
    harness.grow(id, height);
    // Asked for in the next frame before it lays the thread out, and so before the view asks for
    // the frame after, this runs there ahead of the view's own.
    requestAnimationFrame(() => requestAnimationFrame(() => harness.narrow(width)));
  },
  /** Puts the cursor on new line `line`, and focus in the view. */
  cursor(line: number): void {
    view().reveal({ kind: 'line', at: { file: 'a', side: 'new', line } });
    view().focus();
  },
  /** Whether the cursor's row is drawn wholly on screen. */
  cursorOnScreen(): boolean {
    return view().probe.cursor()?.onScreen ?? false;
  },
  /** Shows the view in `layout`, as when the setting changes, with no input. */
  layout(layout: DiffLayout): void {
    view().setLayout(layout);
  },
  /** How far down the screen the top of the cursor's row is. */
  cursorTop(): number | undefined {
    const cursor = view().probe.cursor();
    return cursor && cursor.top - screen().top;
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
