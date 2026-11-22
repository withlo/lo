// The page the code view's spec drives: a diff of one file, a line in every four changed, or the
// file's new version whole, in a box 600 px tall, its threads drawn as cards as tall as the spec
// says, with Lo's key listener, as the window runs it, which tells the view of each key once it's
// the reader's input. The first lines can run on past the box's width, so they wrap. The spec works
// it through `window.harness`.

import { diffText } from '@lo/diff';

import {
  createDiffView,
  createFileView,
  type Anchor,
  type DiffLayout,
  type DiffView,
  type FileView,
  type PeekFrame,
  type PeekView,
  type Place,
  type RenderThread,
} from '../../src/code/index.ts';
import { listen, Registry } from '../../src/commands/index.ts';
import { setVim } from '../../src/vim.ts';

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

// No command of Lo's: every key is the editor's, and the reader's input as it comes.
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

/**
 * A peek's frame, as the caller draws it: its head and foot at once, and its list of answers a
 * frame later, as when a component draws it, longer than the list has room for.
 */
const frame: PeekFrame = (parts, peek) => {
  parts.head.textContent = peek.label;
  parts.foot.textContent = `${peek.shown + 1} of ${peek.answers.length}`;
  requestAnimationFrame(() => {
    for (const answer of Array.from({ length: 10 }, () => peek.answers).flat()) {
      const item = document.createElement('div');
      item.className = 'answer';
      item.textContent = `${answer.path}:${answer.line}`;
      parts.list.append(item);
    }
  });
  return { update: ignore, destroy: ignore };
};

/** A peek at two answers, the first shown, its code `lines` lines long, or with none still to come. */
function peekOf(lines: number | undefined): PeekView {
  const answers = [
    { path: 'src/b.ts', line: 5, source: 'syntax' as const },
    { path: 'src/c.ts', line: 2, source: 'syntax' as const },
  ];
  if (lines === undefined)
    return { label: 'Definitions of line', answers, shown: 0, waiting: true };
  const code = { first: 1, lines: Array.from({ length: lines }, (_, index) => `b ${index + 1}`) };
  return { label: 'Definitions of line', answers, shown: 0, code };
}

/** Each word the pointer rested on, and none as it left it. */
const rests: (Place | undefined)[] = [];

let shown: DiffView | undefined;
let whole: FileView | undefined;

function view(): DiffView {
  if (!shown) throw new Error('The page has no view yet.');
  return shown;
}

/** The whole-file view. */
function file(): FileView {
  if (!whole) throw new Error('The page has no whole-file view yet.');
  return whole;
}

/** The scrolling box, whose top is the top of the screen. */
function screen(): DOMRect {
  const box = document.querySelector('.lo-diffview, .lo-fileview');
  if (!box) throw new Error('The page has no view yet.');
  return box.getBoundingClientRect();
}

/**
 * The editor showing the new side: the one on the right side by side, the inline one, or the
 * whole file's.
 */
function newSide(): Element {
  const found = [
    ...document.querySelectorAll(
      '.cm-content[aria-label="After"], .cm-content[aria-label="Changes"], .lo-fileview .cm-content',
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
      {
        cursor: ignore,
        mode: ignore,
        file: ignore,
        jumped: ignore,
        load: ignore,
        menu: ignore,
        rested: (at) => rests.push(at),
      },
    );
    shown.setDiff('a', diffText(textOf(old), textOf(changed)));
  },
  /** Draws the file's new version whole, new line `line` at the top of the screen. */
  openFile(line: number): void {
    setLines(0);
    whole = createFileView(
      root(),
      { id: 'a', path: 'src/a.ts', lines: changed, vimKeys: [], nonce: 'harness' },
      { cursor: ignore, mode: ignore, jumped: ignore, menu: ignore },
    );
    harness.fileScrollTo(line);
  },
  /** Puts the whole file's line `line` at the top of the screen, or `below` pixels below it. */
  fileScrollTo(line: number, below = 0): void {
    const box = document.querySelector('.lo-fileview')!;
    box.scrollTop += (lineTop(line) ?? 0) - below;
  },
  /** Puts the whole file's cursor on line `line`, and focus in it. */
  fileCursor(line: number): void {
    file().reveal({ kind: 'line', at: { file: 'a', side: 'new', line } });
    file().focus();
  },
  /** Opens a peek under the whole file's line `line`, or with `open` false closes it. */
  filePeek(line: number, open = true): boolean {
    const at = { file: 'a', side: 'new', line } as const;
    return file().peek(at, open ? peekOf(9) : undefined, frame);
  },
  /** Opens a peek under the whole file's line `line`, its code still to come. */
  filePeekWaiting(line: number): boolean {
    return file().peek({ file: 'a', side: 'new', line }, peekOf(undefined), frame);
  },
  /** Makes the box the view is drawn in `height` pixels tall. */
  setHeight(height: number): void {
    root().style.height = `${height}px`;
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
  /** Turns Vim keys on or off, as the setting does: they're off as the page opens. */
  vim(on: boolean): void {
    setVim(on);
  },
  /** Opens a comment box under `side`'s line `line`, holding `text`, with focus in it. */
  compose(line: number, text = '', side: 'old' | 'new' = 'new'): void {
    view().compose({ file: 'a', side, line }, text, {
      change: ignore,
      submit: ignore,
      close: ignore,
    });
  },
  /** Opens a peek under new line `line`, its code `lines` lines long, in its frame. */
  peek(line: number, lines = 9): boolean {
    return view().peek({ file: 'a', side: 'new', line }, peekOf(lines), frame);
  },
  /** Opens a peek under new line `line`, its code still to come. */
  peekWaiting(line: number): boolean {
    return view().peek({ file: 'a', side: 'new', line }, peekOf(undefined), frame);
  },
  /** Closes the peek under new line `line`. */
  unpeek(line: number): boolean {
    return view().peek({ file: 'a', side: 'new', line }, undefined);
  },
  /** Where the word at `column` of new line `line` is drawn, as the view says. */
  anchor(line: number, column: number): Anchor | undefined {
    return view().anchor({ file: 'a', side: 'new', line, column });
  },
  /** Where the first word of unchanged new line `line`, `line`, is drawn. */
  wordBox(line: number): Anchor | undefined {
    const text = `line ${line}`;
    const found = [...newSide().querySelectorAll('.cm-line')].find(
      (each) => each.textContent === text,
    );
    const node = found?.firstChild;
    if (!node) return undefined;
    const range = document.createRange();
    range.setStart(node, 0);
    range.setEnd(node, 'line'.length);
    const { left, top, right, bottom } = range.getBoundingClientRect();
    return { left, top, right, bottom };
  },
  /** Each word the pointer rested on, and none as it left it, since the page opened. */
  rests(): (Place | undefined)[] {
    return rests;
  },
  /** Where focus is: `peek` in the peek, an editor's label in its code, or the element's tag. */
  focused(): string {
    const active = document.activeElement;
    if (active?.closest('.lo-diffpeek')) return 'peek';
    const editor = active?.closest('.cm-content');
    return editor?.getAttribute('aria-label') ?? active?.tagName.toLowerCase() ?? 'none';
  },
  /** How far the peek's code is scrolled. */
  peekScroll(): number | undefined {
    return document.querySelector('.lo-diffpeek__code')?.scrollTop;
  },
  /** How far apart the rows on screen are drawn side by side, at most. */
  misalignment(): number {
    return view().probe.misalignment().worst;
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
