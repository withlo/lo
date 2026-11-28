// The page the code view's spec drives: a diff of one file, a line in every four changed, or the
// file's new version whole, in a box 600 px tall, its threads drawn as cards as tall as the spec
// says, or beside lines as marks that open a popover, with Lo's key listener, as the window runs
// it, which tells the view of each key once it's the reader's input. The first lines can run on
// past the box's width, so they wrap. The spec works it through `window.harness`.

import { diffText } from '@lo/diff';

import {
  createDiffView,
  createFileView,
  type Anchor,
  type DiffLayout,
  type DiffView,
  type FileView,
  type PassStats,
  type PeekFrame,
  type PeekView,
  type Place,
  type RenderPopover,
  type RenderThread,
  type ThreadsMode,
} from '../../src/code/index.ts';
import {
  commandsOf,
  defineCommands,
  holdRegistry,
  listen,
  Registry,
  type Target,
} from '../../src/commands/index.ts';
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
 * onto more rows the narrower the view; and `added` lines that wrap the same, `added 1` and on,
 * only on the new side, before line 20.
 */
function setLines(wrapped: number, added = 0): void {
  const more = ' and more words'.repeat(20);
  old = Array.from({ length: 300 }, (_, index) =>
    index < wrapped ? `line ${index + 1}${more}` : `line ${index + 1}`,
  );
  // Lines 1, 5, 9 and on: three unchanged lines between changes, which none collapse.
  changed = old.map((text, index) => (index % 4 === 0 ? `${text}, changed` : text));
  changed.splice(
    19,
    0,
    ...Array.from({ length: added }, (_, index) => `added ${index + 1}${more}`),
  );
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
 * The threads' popover, beside lines, as a caller draws it: a card 120 px tall for each thread, and
 * the slot a new comment's box goes in, where one is open in it.
 */
const popover: RenderPopover = (host, shown) => {
  const draw = (now: typeof shown): void => {
    const drawn = now.threads.map(({ id }) => {
      const card = document.createElement('div');
      card.className = 'card';
      card.dataset.threadId = id;
      card.textContent = id;
      card.style.height = '120px';
      return card;
    });
    const slot = document.createElement('div');
    slot.setAttribute('data-new-slot', '');
    host.replaceChildren(...drawn, ...(now.box && now.box.thread === undefined ? [slot] : []));
  };
  draw(shown);
  return { update: draw, destroy: () => host.replaceChildren() };
};

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

/** Each share the view said to keep as the edge between the sides moved, or none put back. */
const shares: (number | undefined)[] = [];
/** Each time the view said its box became too narrow for two sides, or wide enough again. */
const narrows: boolean[] = [];

let shown: DiffView | undefined;
let whole: FileView | undefined;

/** The comment command the `+` runs, in the scene that picks lines, and what it ran on. */
const commenting = defineCommands('comments', {
  comment: {
    label: 'Comment',
    control: 'the + beside a line',
    group: 'Comments',
    keys: ['c'],
    targets: ['line'],
    when: { scope: 'diff' },
  },
});
const comments: Target[] = [];

/**
 * The lines of the scene that picks lines that take a comment: on each side, those of its file's
 * hunks, named as a box names them. Where `known` is false, the caller can't tell yet.
 */
let hunks: Record<string, { old: [number, number][]; new: [number, number][] }> = {};
let known = true;
const takes = (file: string, side: 'old' | 'new', line: number): boolean =>
  (hunks[file]?.[side] ?? []).some(([first, last]) => line >= first && line <= last);

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

/** How wide side `side` is drawn. */
function sideWidth(side: 'old' | 'new'): number {
  return document.querySelector(`.cm-editor[data-side="${side}"]`)!.getBoundingClientRect().width;
}

/** Where unchanged line `line`'s text starts, down from the top of the screen, long or not. */
function lineTop(line: number): number | undefined {
  const text = `line ${line}`;
  const found = [...newSide().querySelectorAll('.cm-line')].find(
    (each) => each.textContent === text || each.textContent?.startsWith(`${text} `),
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
  /**
   * Draws the view in `layout`, its first `wrapped` lines long enough to wrap, and `added` lines
   * the new side alone has before line 20, as long.
   */
  open(layout: DiffLayout, wrapped = 0, added = 0): void {
    setLines(wrapped, added);
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
        sides: (share) => shares.push(share),
        narrowed: (narrow) => narrows.push(narrow),
      },
    );
    shown.setDiff('a', diffText(textOf(old), textOf(changed)));
  },
  /**
   * Draws three files side by side: `src/a.ts` and `src/c.ts` each end with three lines added, the
   * second last in the diff, and `src/b.ts` between them is added whole, three lines long. With
   * `addedLast`, `src/d.ts`, added whole as `src/b.ts` is, comes last.
   */
  openFiles(addedLast = false): void {
    const ends = { old: ['one', 'two'], new: ['one', 'two', 'three', 'four', 'five'] };
    const added = { old: [], new: ['one', 'two', 'three'] };
    const header = { additions: 3, deletions: 0 };
    const files = [
      { id: 'a', path: 'src/a.ts', change: 'modified' as const, lines: ends, header },
      { id: 'b', path: 'src/b.ts', change: 'added' as const, lines: added, header },
      { id: 'c', path: 'src/c.ts', change: 'modified' as const, lines: ends, header },
      ...(addedLast
        ? [{ id: 'd', path: 'src/d.ts', change: 'added' as const, lines: added, header }]
        : []),
    ];
    shown = createDiffView(
      root(),
      { files, layout: 'split', vimKeys: [], nonce: 'harness' },
      {
        cursor: ignore,
        mode: ignore,
        file: ignore,
        jumped: ignore,
        load: ignore,
        menu: ignore,
      },
    );
    for (const { id, lines } of files) {
      const before = lines.old.length === 0 ? undefined : textOf(lines.old);
      shown.setDiff(id, diffText(before, textOf(lines.new)));
    }
  },
  /**
   * Draws two files in `layout` for picking lines with the `+`: `src/a.ts`, 80 lines, line 6 and
   * line 50 changed, the unchanged lines between their hunks in a fold, and `src/b.ts` after it,
   * with a line added. The `+` runs a comment command, whose runs `commented` gives, and only the
   * lines of a hunk take a comment, unless `unknown`: the caller can't tell yet.
   */
  openPicking(layout: DiffLayout, unknown = false): void {
    holdRegistry(
      new Registry({
        system: 'linux',
        commands: commandsOf(commenting).map((command) => ({
          ...command,
          handler: { run: (target: Target) => void comments.push(target) },
        })),
      }),
    );
    known = !unknown;
    const a = Array.from({ length: 80 }, (_, index) => `a ${index + 1}`);
    const changedA = a.map((text, index) =>
      index === 5 || index === 49 ? `${text}, changed` : text,
    );
    const b = ['b 1', 'b 2', 'b 3'];
    const changedB = ['b 1', 'b 2', 'b 2.5', 'b 3'];
    const files = [
      { id: 'a', path: 'src/a.ts', change: 'modified' as const, lines: { old: a, new: changedA } },
      { id: 'b', path: 'src/b.ts', change: 'modified' as const, lines: { old: b, new: changedB } },
    ];
    const diffs = files.map(({ lines }) => diffText(textOf(lines.old), textOf(lines.new)));
    hunks = Object.fromEntries(
      files.map(({ id }, index) => [
        id,
        {
          old: diffs[index]!.hunks.map((hunk) => [hunk.old.start, hunk.old.end - 1]),
          new: diffs[index]!.hunks.map((hunk) => [hunk.new.start, hunk.new.end - 1]),
        },
      ]),
    );
    shown = createDiffView(
      root(),
      {
        files: files.map((each) => ({ ...each, header: { additions: 1, deletions: 1 } })),
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
        commentLines: (file) =>
          known
            ? {
                on: ({ side, from, to }) =>
                  takes(file, side, from) && takes(file, side, to)
                    ? `${from === to ? `Line ${to}` : `Lines ${from}–${to}`}${side === 'old' ? ', removed' : ''}`
                    : undefined,
              }
            : undefined,
      },
    );
    files.forEach(({ id }, index) => shown!.setDiff(id, diffs[index]!));
  },
  /** What the `+` ran the comment command on, in the scene that picks lines, in order. */
  commented(): Target[] {
    return comments;
  },
  /** Which lines the caller says take a comment, in the scene that picks lines, from now on. */
  know(): void {
    known = true;
  },
  /** The lines picked in each editor, by their text. */
  picked(): Record<string, string[]> {
    const found: Record<string, string[]> = {};
    for (const editor of document.querySelectorAll<HTMLElement>('.cm-editor')) {
      if (editor.getClientRects().length === 0) continue;
      const name = editor.querySelector('.cm-content')?.getAttribute('aria-label') ?? '';
      found[name] = [...editor.querySelectorAll('.cm-line.lo-picked')].map(
        (line) => line.textContent ?? '',
      );
    }
    return found;
  },
  /** Each spacer on the old side, by the file it's in or at the end of, with its look. */
  spacers(): { path: string; look: 'hatched' | 'under' | 'flat'; height: number }[] {
    const found: { path: string; look: 'hatched' | 'under' | 'flat'; height: number }[] = [];
    let path = '';
    const content = document.querySelector('.cm-content[aria-label="Before"]');
    for (const child of content?.children ?? []) {
      const head = child.matches('.lo-diffhead')
        ? child
        : child.querySelector<HTMLElement>('.lo-diffhead[data-path]');
      if (head instanceof HTMLElement && head.dataset.path) path = head.dataset.path;
      if (!child.classList.contains('lo-spacer')) continue;
      const look = child.classList.contains('is-hatched')
        ? 'hatched'
        : child.classList.contains('is-under')
          ? 'under'
          : 'flat';
      found.push({ path, look, height: child.getBoundingClientRect().height });
    }
    return found;
  },
  /** Scrolls file `path`'s own header to `below` pixels below the top of the screen. */
  headerAt(path: string, below: number): void {
    const box = document.querySelector('.lo-diffview');
    const head = document.querySelector(`.cm-content[aria-label="After"] [data-path="${path}"]`);
    if (!box || !head) throw new Error(`No header for ${path} on the page.`);
    box.scrollTop += head.getBoundingClientRect().top - screen().top - below;
  },
  /** The file the row pinned over the top names, and how it's moved, or nothing while it's hidden. */
  pinned(): { path: string | undefined; transform: string } | undefined {
    const pin = document.querySelector<HTMLElement>('.lo-diffpin');
    if (!pin || pin.hidden) return undefined;
    const head = pin.querySelector<HTMLElement>('[data-path]');
    return { path: head?.dataset.path, transform: pin.style.transform };
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
  /** `count` changes on from the cursor, as `]c` or the menu bar's Next Change. */
  jump(count: number): void {
    view().jump('change', count);
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
  /** How far down the screen the new side's first line starting with `text` is drawn, if it is. */
  textTop(text: string): number | undefined {
    const found = [...newSide().querySelectorAll('.cm-line')].find((each) =>
      each.textContent?.startsWith(text),
    );
    return found && found.getBoundingClientRect().top - screen().top;
  },
  /** How far down the screen the top of what `selector` matches is. */
  top(selector: string): number | undefined {
    const found = document.querySelector(selector);
    return found ? found.getBoundingClientRect().top - screen().top : undefined;
  },
  /**
   * Gives the threads, each under a line, of the new side unless said, `height` tall; `now`, as for
   * a view not yet seen.
   */
  threads(
    threads: { id: string; line: number; height: number; side?: 'old' | 'new' }[],
    now = false,
  ): void {
    for (const { id, height } of threads) heights.set(id, height);
    view().setThreads(
      threads.map(({ id, line, side = 'new' }) => ({
        id,
        at: { file: 'a', side, line },
        open: true,
        version: 1,
      })),
      render,
      { now },
    );
  },
  /**
   * Gives threads with their marks, each ending on `side`'s line `line`, from line `from` where it
   * covers more, or on the file, under its header, where it has no line; beside lines they open in
   * the popover.
   */
  markedThreads(
    threads: {
      id: string;
      side?: 'old' | 'new';
      line?: number;
      from?: number;
      resolved?: boolean;
    }[],
  ): void {
    view().setThreads(
      threads.map(({ id, side = 'new', line, from, resolved = false }) => ({
        id,
        at: line === undefined ? { file: 'a' } : { file: 'a', side, line },
        open: true,
        version: 1,
        mark: {
          resolved,
          from: from === undefined ? undefined : { side, line: from },
          words: { lines: `line ${line ?? 0}`, line: `line ${line ?? 0}` },
        },
      })),
      render,
      // Those on lines on screen come at once too, so nothing waits to be measured.
      { popover, now: true },
    );
  },
  /** Shows threads beside lines or between them, as the setting does. */
  threadsMode(mode: ThreadsMode): void {
    view().setThreadsMode(mode);
  },
  /** Pins thread `id`'s popover, beside lines, as a key does. */
  pin(id: string): boolean {
    return view().pinThread(id);
  },
  /** Closes the threads' popover, as `Esc` does. */
  closePopover(): boolean {
    return view().closePopover();
  },
  /**
   * How each editor the diff shows lays out its rows: each line drawn, its text, where it starts
   * below the top of what the diff's scroll holds, so a shift of the whole diff shows too, and how
   * tall it is, what's drawn between lines counted in where the next starts; and how tall the
   * editor's text is in all, lines not drawn too.
   */
  rows(): { editor: string; lines: string[]; height: number }[] {
    const scroller = document.querySelector<HTMLElement>('.lo-diffview');
    if (!scroller) throw new Error('The page has no diff yet.');
    const top = scroller.getBoundingClientRect().top - scroller.scrollTop;
    return [...scroller.querySelectorAll<HTMLElement>('.cm-content[aria-label]')]
      .filter(
        (content) =>
          ['Before', 'After', 'Changes'].includes(content.getAttribute('aria-label') ?? '') &&
          content.getClientRects().length > 0,
      )
      .map((content) => {
        const text = content.getBoundingClientRect();
        const lines = [...content.querySelectorAll(':scope > .cm-line')].map((line) => {
          const drawn = line.getBoundingClientRect();
          return `${line.textContent} ${(drawn.top - top).toFixed(1)} ${drawn.height.toFixed(1)}`;
        });
        return {
          editor: content.getAttribute('aria-label') ?? '',
          lines,
          height: Math.round(text.height * 10) / 10,
        };
      });
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
  /**
   * The layout drawn, whether the view says its box is too narrow for two sides, and each time it
   * said that changed.
   */
  drawn(): { layout: DiffLayout; narrow: boolean; said: boolean[] } {
    return { layout: view().probe.layout, narrow: view().narrow, said: [...narrows] };
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
  /** What the spacer pass has done so far. */
  passStats(): PassStats {
    return { ...view().probe.passStats };
  },
  /** Shares the width between the sides as the window's layout hands it: the old side `share`. */
  sides(share: number | undefined): void {
    view().setSides(share);
  },
  /** Each share the view said to keep since the page opened, or none for even again. */
  shares(): (number | undefined)[] {
    return shares;
  },
  /** How wide each side is drawn. */
  sideWidths(): { old: number; new: number } {
    return { old: sideWidth('old'), new: sideWidth('new') };
  },
  /** Where the edge between the sides is, across the page, and how far down it reaches, if shown. */
  seam(): { x: number; top: number; bottom: number } | undefined {
    const grip = document.querySelector<HTMLElement>('.lo-diffseam:not([hidden]) > .splitter');
    if (!grip) return undefined;
    const { left, top, bottom } = grip.getBoundingClientRect();
    return { x: left, top, bottom };
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
