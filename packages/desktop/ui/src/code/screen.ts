// Vim's keys that go by what's on screen: a page (`Ctrl-f`, `Ctrl-b`, and `PageDown` and `PageUp`,
// which Vim maps to them), half of one (`Ctrl-d`, `Ctrl-u`), a line of scroll (`Ctrl-e`, `Ctrl-y`),
// the lines at the top, middle and bottom of the screen (`H`, `M`, `L`), and the scroll around the
// cursor (`zz`, `zt`, `zb`, and `z.`, `z<CR>` and `z-`, which also go to the line's first
// character). Vim's package works them out from the editor's own scroller, but an editor here is
// as tall as its document and the box around it scrolls, so to Vim the whole pull request is one
// screen. These work them out from the box that scrolls, as Vim does from its window: counts work,
// the cursor lands where Vim puts it, and the other side follows the scroll as it follows any.
//
// A row is one of the editor's line blocks: a line, or a header or collapsed lines, which Vim
// treats as a closed fold, with the spacers, labels and threads drawn around it. Its body is the
// line, header or collapsed block itself.

import { type BlockInfo, BlockType, EditorView } from '@codemirror/view';
import { Vim } from '@replit/codemirror-vim';

interface Pos {
  line: number;
  ch: number;
}

/** A stretch of the document, by its height from the document's top, as CodeMirror gives it. */
interface Span {
  top: number;
  bottom: number;
}

/** How many rows of the last screen a page keeps on screen, as Vim does. */
const pageOverlap = 2;

/** Whether a row's body ends this little outside the screen and still counts as on it, in px. */
const slack = 1;

let defined = false;

function viewOf(cm: { cm6: unknown }): EditorView | undefined {
  const view = cm.cm6;
  return view instanceof EditorView ? view : undefined;
}

/**
 * The box that scrolls the editor: its nearest ancestor that scrolls up and down, past any that
 * could but have nothing to scroll, as an editor around a comment box has; else the nearest that
 * could.
 */
function scrollerOf(view: EditorView): HTMLElement | undefined {
  let could: HTMLElement | undefined;
  for (let element = view.dom.parentElement; element; element = element.parentElement) {
    if (!/auto|scroll/.test(getComputedStyle(element).overflowY)) continue;
    if (element.scrollHeight > element.clientHeight) return element;
    could ??= element;
  }
  return could;
}

/** What the scroller shows of the editor's document, by height in it. */
function screenOf(view: EditorView, scroller: HTMLElement): Span {
  const top = scroller.getBoundingClientRect().top + scroller.clientTop - view.documentTop;
  return { top, bottom: top + scroller.clientHeight };
}

/** The row's line, header or collapsed block, without what's drawn around it. */
function bodyOf(row: BlockInfo): Span {
  const parts = Array.isArray(row.type) ? row.type : [row];
  const body =
    parts.find((part) => part.type === BlockType.Text || part.type === BlockType.WidgetRange) ??
    row;
  return { top: body.top, bottom: body.bottom };
}

function next(view: EditorView, row: BlockInfo): BlockInfo | undefined {
  return row.to < view.state.doc.length ? view.lineBlockAt(row.to + 1) : undefined;
}

function previous(view: EditorView, row: BlockInfo): BlockInfo | undefined {
  return row.from > 0 ? view.lineBlockAt(row.from - 1) : undefined;
}

/** The rows whose bodies are wholly on `screen`, top to bottom. */
function rowsOn(view: EditorView, screen: Span): BlockInfo[] {
  const rows: BlockInfo[] = [];
  let row: BlockInfo | undefined = view.lineBlockAtHeight(Math.max(0, screen.top));
  for (; row && row.top < screen.bottom; row = next(view, row)) {
    const body = bodyOf(row);
    if (body.top >= screen.top - slack && body.bottom <= screen.bottom + slack) rows.push(row);
  }
  return rows;
}

/** The row's first line, at its first character that isn't a space, as Vim's `^` puts it. */
function startOf(view: EditorView, row: BlockInfo): Pos {
  const line = view.state.doc.lineAt(row.from);
  const first = line.text.search(/\S/);
  return { line: line.number - 1, ch: first === -1 ? line.length : first };
}

/** The row's first line, at column `ch` or its end. */
function columnOf(view: EditorView, row: BlockInfo, ch: number): Pos {
  const line = view.state.doc.lineAt(row.from);
  return { line: line.number - 1, ch: Math.min(ch, Math.max(0, line.length - 1)) };
}

function rowAt(view: EditorView, pos: Pos): BlockInfo {
  const { doc } = view.state;
  return view.lineBlockAt(doc.line(Math.min(doc.lines, pos.line + 1)).from);
}

/** Scrolls by `delta` and says how far it went, which an end of the scroll can cut short. */
function scrollBy(scroller: HTMLElement, delta: number): number {
  const before = scroller.scrollTop;
  scroller.scrollTop = before + delta;
  return scroller.scrollTop - before;
}

/** The editor, its scroller and what it shows: undefined where an editor isn't scrolled by one. */
function geometry(cm: {
  cm6: unknown;
}): { view: EditorView; scroller: HTMLElement; screen: Span } | undefined {
  const view = viewOf(cm);
  const scroller = view && scrollerOf(view);
  if (!view || !scroller) return undefined;
  return { view, scroller, screen: screenOf(view, scroller) };
}

/** `H` and `L`: the `count`th row on screen from the top or the bottom. `M`: the middle one. */
function screenRow(
  cm: { cm6: unknown },
  head: Pos,
  where: 'top' | 'middle' | 'bottom',
  count: number,
): Pos {
  const found = geometry(cm);
  if (!found) return head;
  const { view, screen } = found;
  const rows = rowsOn(view, screen);
  if (rows.length === 0) return head;
  if (where === 'top') return startOf(view, rows[Math.min(count, rows.length) - 1]!);
  if (where === 'bottom') return startOf(view, rows[Math.max(0, rows.length - count)]!);
  // The middle of what the rows on screen take up, as Vim's is of the lines its window shows.
  const middle = (bodyOf(rows[0]!).top + bodyOf(rows.at(-1)!).bottom) / 2;
  let nearest = rows[0]!;
  for (const row of rows) {
    const body = bodyOf(row);
    const distance = Math.max(body.top - middle, middle - body.bottom, 0);
    const best = bodyOf(nearest);
    if (distance < Math.max(best.top - middle, middle - best.bottom, 0)) nearest = row;
  }
  return startOf(view, nearest);
}

/**
 * `Ctrl-f` and `Ctrl-b`: `count` pages on, each keeping two rows of the last on screen, and the
 * cursor on the first row on screen (or the last, going back) if the scroll left it off. Where
 * there's no more to scroll, the cursor goes to the document's last row (or its first).
 */
function page(cm: { cm6: unknown }, head: Pos, forward: boolean, count: number): Pos {
  const found = geometry(cm);
  if (!found) return head;
  const { view, scroller, screen } = found;
  const height = screen.bottom - screen.top;
  let top = screen.top;
  for (let turn = 0; turn < count; turn++) {
    const shown = { top, bottom: top + height };
    const rows = rowsOn(view, shown);
    if (forward) {
      const kept = rows[Math.max(1, rows.length - pageOverlap)];
      top = kept ? kept.top : shown.bottom;
    } else {
      const kept = rows[Math.min(rows.length - 2, pageOverlap - 1)];
      top = kept ? kept.bottom - height : shown.top - height;
    }
  }
  const moved = scrollBy(scroller, top - screen.top);
  const { doc } = view.state;
  if (Math.abs(moved) < slack) {
    return startOf(view, view.lineBlockAt(forward ? doc.length : 0));
  }
  const now = { top: screen.top + moved, bottom: screen.bottom + moved };
  const rows = rowsOn(view, now);
  const cursor = bodyOf(rowAt(view, head));
  if (forward && cursor.top < now.top - slack && rows[0]) return startOf(view, rows[0]);
  if (!forward && cursor.bottom > now.bottom + slack && rows.at(-1)) {
    return startOf(view, rows.at(-1)!);
  }
  return head;
}

/** The rows `Ctrl-d` and `Ctrl-u` go in each editor once a count has set it, as Vim's `scroll`. */
const halfPageRows = new WeakMap<EditorView, number>();

/**
 * `Ctrl-d` and `Ctrl-u`: the cursor `count` rows on, which the next ones go too, or half the rows
 * on screen until a count is given, and the scroll as far as the cursor went, so it stays where it
 * is on screen.
 */
function halfPage(
  cm: { cm6: unknown },
  head: Pos,
  forward: boolean,
  count: number | undefined,
): Pos {
  const found = geometry(cm);
  if (!found) return head;
  const { view, scroller, screen } = found;
  if (count !== undefined) halfPageRows.set(view, count);
  const rows = halfPageRows.get(view) ?? Math.max(1, Math.floor(rowsOn(view, screen).length / 2));
  const from = rowAt(view, head);
  let to = from;
  for (let turn = 0; turn < rows; turn++) {
    const step = forward ? next(view, to) : previous(view, to);
    if (!step) break;
    to = step;
  }
  scrollBy(scroller, bodyOf(to).top - bodyOf(from).top);
  return startOf(view, to);
}

/**
 * `Ctrl-e` and `Ctrl-y`: the scroll `count` rows on, a row at the top of the screen at a time,
 * and the cursor onto the screen's first row (or last) if the scroll left it off. A motion, so in
 * visual mode the selection keeps its other end.
 */
function scrollRows(cm: { cm6: unknown }, head: Pos, forward: boolean, count: number): Pos {
  const found = geometry(cm);
  if (!found) return head;
  const { view, scroller, screen } = found;
  // The row at the top of the screen, one that starts there included.
  let row = view.lineBlockAtHeight(Math.max(0, screen.top + slack));
  // A row the top of the screen cuts is one step back to its top.
  let steps = !forward && row.top < screen.top - slack ? count - 1 : count;
  for (; steps > 0; steps--) {
    const step: BlockInfo | undefined = forward ? next(view, row) : previous(view, row);
    if (!step) break;
    row = step;
  }
  const moved = scrollBy(scroller, row.top - screen.top);
  const now = { top: screen.top + moved, bottom: screen.bottom + moved };
  const body = bodyOf(rowAt(view, head));
  const rows = rowsOn(view, now);
  if (forward && body.top < now.top - slack && rows[0]) return columnOf(view, rows[0], head.ch);
  if (!forward && body.bottom > now.bottom + slack && rows.at(-1)) {
    return columnOf(view, rows.at(-1)!, head.ch);
  }
  return head;
}

/** `zt`, `zz` and `zb`: the cursor's row (or the `count`th line's) at the top, middle or bottom. */
function scrollToCursor(
  cm: { cm6: unknown; getCursor(): Pos; setCursor(pos: Pos): void },
  where: 'top' | 'center' | 'bottom',
  line: number | undefined,
): void {
  const found = geometry(cm);
  if (!found) return;
  const { view, scroller, screen } = found;
  if (line !== undefined) {
    const lines = view.state.doc.lines;
    cm.setCursor({ line: Math.min(lines, Math.max(1, line)) - 1, ch: cm.getCursor().ch });
  }
  const body = bodyOf(rowAt(view, cm.getCursor()));
  const delta =
    where === 'top'
      ? body.top - screen.top
      : where === 'bottom'
        ? body.bottom - screen.bottom
        : (body.top + body.bottom) / 2 - (screen.top + screen.bottom) / 2;
  scrollBy(scroller, delta);
}

/**
 * Leaves a cursor whose row is wholly on screen where it is when it's brought into view, as Vim
 * does, where CodeMirror would scroll it to 5 pixels inside the screen's edge: after `H`, `L` or
 * `z<CR>`, that would move what they put at the edge. A row off screen, or partly, scrolls as usual.
 */
export const leaveOnScreen = EditorView.scrollHandler.of((view, range, options) => {
  if (options.y !== 'nearest' || !range.empty) return false;
  const scroller = scrollerOf(view);
  if (!scroller) return false;
  const screen = screenOf(view, scroller);
  const body = bodyOf(view.lineBlockAt(range.head));
  return body.top >= screen.top - slack && body.bottom <= screen.bottom + slack;
});

/** Puts Lo's versions of Vim's screen keys in place of Vim's, once. */
export function defineScreenKeys(): void {
  if (defined) return;
  defined = true;
  Vim.defineMotion('loScreenRow', (cm, head, args) => {
    const where: unknown = Reflect.get(args, 'where');
    if (where !== 'top' && where !== 'middle' && where !== 'bottom') return head;
    return screenRow(cm, head, where, args.repeat);
  });
  Vim.defineMotion('loPage', (cm, head, args) => page(cm, head, args.forward ?? true, args.repeat));
  Vim.defineMotion('loHalfPage', (cm, head, args) =>
    halfPage(cm, head, args.forward ?? true, args.repeatIsExplicit ? args.repeat : undefined),
  );
  Vim.defineMotion('loScrollRows', (cm, head, args) =>
    scrollRows(cm, head, args.forward ?? true, args.repeat),
  );
  Vim.defineAction('loScrollToCursor', (cm, args) => {
    const where = args.position;
    if (where !== 'top' && where !== 'center' && where !== 'bottom') return;
    scrollToCursor(cm, where, args.repeatIsExplicit ? args.repeat : undefined);
  });
  for (const [keys, where] of [
    ['H', 'top'],
    ['M', 'middle'],
    ['L', 'bottom'],
  ] as const) {
    Vim.mapCommand(keys, 'motion', 'loScreenRow', { where, linewise: true, toJumplist: true }, {});
  }
  for (const [keys, forward] of [
    ['<C-f>', true],
    ['<PageDown>', true],
    ['<C-b>', false],
    ['<PageUp>', false],
  ] as const) {
    Vim.mapCommand(keys, 'motion', 'loPage', { forward }, {});
  }
  for (const [keys, forward] of [
    ['<C-d>', true],
    ['<C-u>', false],
  ] as const) {
    Vim.mapCommand(keys, 'motion', 'loHalfPage', { forward, explicitRepeat: true }, {});
  }
  for (const [keys, forward] of [
    ['<C-e>', true],
    ['<C-y>', false],
  ] as const) {
    Vim.mapCommand(keys, 'motion', 'loScrollRows', { forward }, {});
  }
  for (const [keys, position, firstCharacter] of [
    ['zz', 'center', false],
    ['z.', 'center', true],
    ['zt', 'top', false],
    ['z<CR>', 'top', true],
    ['zb', 'bottom', false],
    ['z-', 'bottom', true],
  ] as const) {
    Vim.mapCommand(
      keys,
      'action',
      'loScrollToCursor',
      { position },
      firstCharacter ? { motion: 'moveToFirstNonWhiteSpaceCharacter' } : {},
    );
  }
}
