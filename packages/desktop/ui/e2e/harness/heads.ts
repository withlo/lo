// The page the file header spec drives: a diff of files whose headers say as much as the fixture's
// do, a folder and a name, counts, tags, threads and a rename, in a box the spec sizes, inline or
// side by side, under Lo's own stylesheet. The spec works it through `window.heads`.

import { diffText } from '@lo/diff';

import {
  createDiffView,
  type DiffFile,
  type DiffLayout,
  type DiffView,
} from '../../src/code/index.ts';

const lines = (count: number, word: string): string[] =>
  Array.from({ length: count }, (_, index) => `${word} ${index + 1}`);
const textOf = (each: readonly string[]): string => `${each.join('\n')}\n`;

const unviewed = 'unviewed' as const;

/** The files, as the narrow views showed them cut: each with lines enough to scroll past. */
const FILES: DiffFile[] = [
  {
    id: 'usage',
    path: 'docs/usage.md',
    change: 'modified',
    lines: { old: lines(12, 'old'), new: lines(12, 'new') },
    header: {
      additions: 1,
      deletions: 1,
      change: 'modified',
      viewed: unviewed,
      threads: { total: 1, unresolved: 1 },
    },
  },
  {
    id: 'wrap',
    path: 'packages/desktop/ui/src/code/a-name-long-enough-to-cut.ts',
    change: 'modified',
    lines: { old: lines(12, 'old'), new: lines(12, 'new') },
    header: {
      additions: 15,
      deletions: 0,
      change: 'modified',
      viewed: 'stale',
      threads: { total: 5, unresolved: 2 },
    },
  },
  {
    id: 'mark',
    path: 'assets/mark.png',
    change: 'modified',
    skip: 'binary',
    header: {
      additions: 0,
      deletions: 0,
      counted: false,
      change: 'modified',
      viewed: unviewed,
      tags: ['binary', '69 B → 73 B'],
    },
  },
  {
    id: 'numbers',
    path: 'numbers.txt',
    change: 'added',
    lines: { old: [], new: lines(12, 'number') },
    header: { additions: 5001, deletions: 0, change: 'added', viewed: unviewed },
  },
  {
    id: 'renamed',
    path: 'src/retry/backoff.ts',
    previousPath: 'src/backoff.ts',
    change: 'modified',
    lines: { old: lines(12, 'old'), new: lines(12, 'new') },
    header: { additions: 18, deletions: 3, change: 'renamed', viewed: unviewed },
  },
];

let shown: DiffView | undefined;
const ignore = (): void => {};

function root(): HTMLElement {
  const found = document.getElementById('root');
  if (!found) throw new Error('The page has no root.');
  return found;
}

/** What one header draws, read from the page as laid out. */
interface Drawn {
  readonly path: string;
  /** Which part of the band it is: `start`, `end` or `both`, or `pinned`. */
  readonly part: string;
  /** What it gave up, on the band or on each half. */
  readonly gaveUp: string;
  /** The folder as drawn, and how wide, if it's drawn. */
  readonly folder: { text: string; width: number; whole: boolean } | undefined;
  readonly name: { text: string; width: number; whole: boolean };
  /** Whether the counts, a rename's old path or the tags are drawn. */
  readonly note: boolean;
  /** Whether everything in the end group is drawn whole, within the band, 8 px short of its end. */
  readonly endWhole: boolean | undefined;
  /** Whether the start runs past where it's cut, its folder or name cut short with nothing to show. */
  readonly startFits: boolean | undefined;
  /** Whether each thing the start draws ends before the next begins: nothing drawn over another. */
  readonly apart: boolean | undefined;
}

function shownOf(element: Element | null): element is HTMLElement {
  return (
    element instanceof HTMLElement && element.getClientRects().length > 0 && element.offsetWidth > 1
  );
}

/** Whether each of `parts` shown, in order, ends where the next begins or before. */
function apart(parts: readonly Element[]): boolean {
  const boxes = parts.filter(shownOf).map((each) => each.getBoundingClientRect());
  return boxes.every((each, index) => index === 0 || each.left >= boxes[index - 1]!.right - 0.5);
}

function read(head: HTMLElement, part: string): Drawn {
  const folder = head.querySelector<HTMLElement>('.lo-path__dir');
  const name = head.querySelector<HTMLElement>('.lo-path b');
  const end = head.querySelector<HTMLElement>('.lo-filehead__end');
  const start = head.querySelector<HTMLElement>('.lo-diffhead__start');
  const band = head.getBoundingClientRect();
  const notes = [
    ...head.querySelectorAll<HTMLElement>('.lo-stat, .lo-path__was, .lo-diffhead__tags'),
  ];
  const gaveUp = [head, start, end]
    .map((each) => each?.getAttribute('data-gave-up') ?? '')
    .filter(Boolean)
    .join(' | ');
  return {
    path: head.dataset.path ?? '',
    part,
    gaveUp,
    folder: shownOf(folder)
      ? {
          text: folder.textContent ?? '',
          width: folder.getBoundingClientRect().width,
          whole: folder.scrollWidth <= folder.clientWidth,
        }
      : undefined,
    name: {
      text: name?.textContent ?? '',
      width: name?.getBoundingClientRect().width ?? 0,
      whole: name !== null && name.scrollWidth <= name.clientWidth,
    },
    note: notes.some(shownOf),
    endWhole:
      end === null
        ? undefined
        : end.scrollWidth <= end.clientWidth &&
          [...end.children].every((each) => {
            if (!shownOf(each)) return true;
            const { right } = each.getBoundingClientRect();
            return right <= band.right - 7.5 && right <= end.getBoundingClientRect().right + 0.5;
          }),
    startFits: start === null ? undefined : start.scrollWidth <= start.clientWidth,
    apart:
      start === null
        ? undefined
        : apart(
            [...start.children].flatMap((each) =>
              each.classList.contains('lo-path') ? [...each.children] : [each],
            ),
          ),
  };
}

const heads = {
  /** Draws the diff in `layout`, in a box `width` pixels wide. */
  open(layout: DiffLayout, width: number): void {
    root().style.width = `${width}px`;
    shown = createDiffView(
      root(),
      { files: FILES, layout, vimKeys: [], nonce: 'heads' },
      { cursor: ignore, mode: ignore, file: ignore, jumped: ignore, load: ignore, menu: ignore },
    );
    for (const file of FILES) {
      if (file.lines) {
        const before = file.lines.old.length === 0 ? undefined : textOf(file.lines.old);
        shown.setDiff(file.id, diffText(before, textOf(file.lines.new)));
      }
    }
  },
  /** Makes the box `width` pixels wide, as a panel opening or closing beside it would. */
  size(width: number): void {
    root().style.width = `${width}px`;
  },
  /** Scrolls the first file's own header up under the top, so its copy is pinned there. */
  pin(): void {
    const box = document.querySelector<HTMLElement>('.lo-diffview')!;
    box.scrollTop += 120;
  },
  /** The layout drawn. */
  layout(): DiffLayout | undefined {
    return shown?.probe.layout;
  },
  /** What every header drawn on screen shows, in the columns and pinned. */
  read(): Drawn[] {
    const found: Drawn[] = [];
    for (const head of document.querySelectorAll<HTMLElement>(
      '.lo-diffview .cm-editor:not([hidden]) .lo-diffhead',
    )) {
      const part = head.classList.contains('lo-diffhead--start')
        ? 'start'
        : head.classList.contains('lo-diffhead--end')
          ? 'end'
          : 'both';
      found.push(read(head, part));
    }
    const pinned = document.querySelector<HTMLElement>('.lo-diffpin:not([hidden]) > .lo-diffhead');
    if (pinned) found.push(read(pinned, 'pinned'));
    return found;
  },
  /** What every header drawn shows at each of `widths`, the box made that wide in turn. */
  async across(widths: readonly number[]): Promise<{ width: number; drawn: Drawn[] }[]> {
    const found: { width: number; drawn: Drawn[] }[] = [];
    for (const width of widths) {
      heads.size(width);
      await heads.frames(2);
      found.push({ width, drawn: heads.read() });
    }
    return found;
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
    /** What the file header spec works the page through. */
    heads: typeof heads;
  }
}

window.heads = heads;
