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
//
// What's drawn around a row can be taller than the screen, as a spacer facing a long run of added
// lines is, and so can a line that wraps. Then no row's body may be wholly on screen. The cursor
// still never stays behind the screen, where the scroll to the cursor after each key would take the
// screen back: it goes to a row of text on screen in a line the screen cuts through, or, with only
// what's drawn between rows on screen, to the row past that, which the scroll then brings on screen.

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

/**
 * A place for the cursor: a row, at its start, or at `offset`, the start of a row of text in a line
 * that wraps; and the row of text there, as `caretOf` finds it.
 */
interface Stop {
  block: BlockInfo;
  offset?: number;
  row: Span;
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

/** Whether `span` is wholly on `screen`, give or take `slack`. */
function within(span: Span, screen: Span): boolean {
  return span.top >= screen.top - slack && span.bottom <= screen.bottom + slack;
}

/** The row's line, header or collapsed block, without what's drawn around it. */
function bodyOf(row: BlockInfo): BlockInfo {
  const parts = Array.isArray(row.type) ? row.type : [row];
  return (
    parts.find((part) => part.type === BlockType.Text || part.type === BlockType.WidgetRange) ?? row
  );
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
    if (within(bodyOf(row), screen)) rows.push(row);
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

/** Where `pos` is in the document. */
function offsetOf(view: EditorView, pos: Pos): number {
  const { doc } = view.state;
  const line = doc.line(Math.min(doc.lines, pos.line + 1));
  return Math.min(line.to, line.from + pos.ch);
}

/** The cursor at `stop`: at its offset, or where `place` puts it in its row. */
function posAt(view: EditorView, stop: Stop, place: (row: BlockInfo) => Pos): Pos {
  if (stop.offset === undefined) return place(stop.block);
  const line = view.state.doc.lineAt(stop.offset);
  return { line: line.number - 1, ch: stop.offset - line.from };
}

/**
 * Whether `body` is a line wrapped onto more rows of text than one, which the screen can cut
 * through, and drawn, so its rows can be measured.
 */
function wraps(view: EditorView, body: BlockInfo): boolean {
  return (
    body.type === BlockType.Text &&
    body.bottom - body.top > view.defaultLineHeight * 1.5 &&
    body.from >= view.viewport.from &&
    body.to <= view.viewport.to
  );
}

/**
 * The row of text a cursor at `offset` is on, by height in the document, as CodeMirror and the
 * spacer pass bring it into view: its row's body, or, in a line that wraps, the row of the
 * character after it.
 */
function caretOf(view: EditorView, offset: number): Span {
  const body = bodyOf(view.lineBlockAt(offset));
  if (!wraps(view, body)) return body;
  const rect = view.coordsAtPos(offset, 1);
  if (!rect) return body;
  const origin = view.documentTop;
  const row = { top: rect.top - origin, bottom: rect.bottom - origin };
  return row.bottom > body.top && row.top < body.bottom ? row : body;
}

/** The first offset from `from` to `to` that `fits`, which holds from one on; `to + 1` if none. */
function firstFitting(from: number, to: number, fits: (offset: number) => boolean): number {
  let low = from;
  let high = to + 1;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (fits(middle)) high = middle;
    else low = middle + 1;
  }
  return low;
}

/**
 * The rows of text that a line that wraps shows wholly where the screen cuts through it: the first
 * there, the one at the screen's middle and the last, top to bottom, as stops at their starts.
 */
function textRowsOn(view: EditorView, row: BlockInfo, screen: Span): Stop[] {
  const body = bodyOf(row);
  if (!wraps(view, body)) return [];
  const origin = view.documentTop;
  let lost = false;
  // The row of text the character at `offset` is on, which all of the row's characters share.
  const textRow = (offset: number): Span => {
    const rect = view.coordsAtPos(offset, 1);
    if (!rect) lost = true;
    return rect ? { top: rect.top - origin, bottom: rect.bottom - origin } : { top: 0, bottom: 0 };
  };
  const { from, to } = body;
  // The start of the first row of text that ends below `y`.
  const startBelow = (y: number): number =>
    firstFitting(from, to, (offset) => textRow(offset).bottom > y);
  const starts = [
    firstFitting(from, to, (offset) => textRow(offset).top >= screen.top - slack),
    startBelow((screen.top + screen.bottom) / 2),
  ];
  // The last row of text that ends on screen, by its last character.
  const past = firstFitting(from, to, (offset) => textRow(offset).bottom > screen.bottom + slack);
  if (past > from) {
    const last = textRow(past - 1);
    starts.push(startBelow((last.top + last.bottom) / 2));
  }
  const stops: Stop[] = [];
  for (const start of [...new Set(starts)].toSorted((a, b) => a - b)) {
    if (start > to) continue;
    const text = textRow(start);
    if (!within(text, screen)) continue;
    stops.push(
      start === from ? { block: row, row: text } : { block: row, offset: start, row: text },
    );
  }
  return lost ? [] : stops;
}

/**
 * Where the cursor can go on `screen`, top to bottom: the start of each row whose body is wholly
 * on it, or, with none, rows of text in lines that wrap, which the screen cuts through.
 */
function stopsOn(view: EditorView, screen: Span): Stop[] {
  const rows = rowsOn(view, screen);
  if (rows.length > 0) return rows.map((row) => ({ block: row, row: bodyOf(row) }));
  const stops: Stop[] = [];
  let row: BlockInfo | undefined = view.lineBlockAtHeight(Math.max(0, screen.top));
  for (; row && row.top < screen.bottom; row = next(view, row)) {
    const body = bodyOf(row);
    if (body.bottom > screen.top && body.top < screen.bottom) {
      stops.push(...textRowsOn(view, row, screen));
    }
  }
  return stops;
}

/**
 * The row past what's drawn between rows on `screen`: the first row whose body starts below the
 * screen's top, `forward`, or the last whose body ends above its bottom; else the document's last
 * row, or its first.
 */
function beyond(view: EditorView, screen: Span, forward: boolean): BlockInfo {
  let row: BlockInfo | undefined = view.lineBlockAtHeight(
    Math.max(0, forward ? screen.top : screen.bottom),
  );
  if (forward) {
    for (; row; row = next(view, row)) if (bodyOf(row).top >= screen.top - slack) return row;
    return view.lineBlockAt(view.state.doc.length);
  }
  for (; row; row = previous(view, row)) {
    if (bodyOf(row).bottom <= screen.bottom + slack) return row;
  }
  return view.lineBlockAt(0);
}

/**
 * Where the cursor goes on `screen` after a key that went `forward` (down) or back: the first stop
 * on it or the last, as Vim's cursor goes to its window's first line or its last. With none, the
 * row past what's drawn there, which the scroll to the cursor then brings on screen, going on the
 * way the key went.
 */
function land(view: EditorView, screen: Span, forward: boolean): Stop {
  const stops = stopsOn(view, screen);
  const stop = forward ? stops[0] : stops.at(-1);
  if (stop) return stop;
  const block = beyond(view, screen, forward);
  return { block, row: bodyOf(block) };
}

/**
 * Whether the cursor's row of text is behind `screen`, for a key going `forward` (down) or back:
 * past the edge the screen moves away from, wholly or partly, where the scroll to the cursor would
 * take the screen back. Ahead of it, that scroll goes on the way the key went.
 */
function behind(row: Span, screen: Span, forward: boolean): boolean {
  return forward ? row.top < screen.top - slack : row.bottom > screen.bottom + slack;
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
  const start = (row: BlockInfo): Pos => startOf(view, row);
  const stops = stopsOn(view, screen);
  if (stops.length === 0) return start(beyond(view, screen, where !== 'bottom'));
  if (where === 'top') return posAt(view, stops[Math.min(count, stops.length) - 1]!, start);
  if (where === 'bottom') return posAt(view, stops[Math.max(0, stops.length - count)]!, start);
  // The middle of what the rows on screen take up, as Vim's is of the lines its window shows.
  const middle = (stops[0]!.row.top + stops.at(-1)!.row.bottom) / 2;
  const distance = ({ row }: Stop): number => Math.max(row.top - middle, middle - row.bottom, 0);
  let nearest = stops[0]!;
  for (const stop of stops) if (distance(stop) < distance(nearest)) nearest = stop;
  return posAt(view, nearest, start);
}

/**
 * `Ctrl-f` and `Ctrl-b`: `count` pages on, each keeping two rows of the last on screen, and the
 * cursor on the first row on screen (or the last, going back) if the scroll left it behind. Where
 * there's no more to scroll, the cursor goes to the document's last row (or its first).
 */
function page(cm: { cm6: unknown }, head: Pos, forward: boolean, count: number): Pos {
  const found = geometry(cm);
  if (!found) return head;
  const { view, scroller, screen } = found;
  const height = screen.bottom - screen.top;
  const { doc } = view.state;
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
  if (forward) {
    // No further than the document's last row at the top of the screen, as Vim's last line goes,
    // where the other side's document goes on below it.
    const last = bodyOf(view.lineBlockAt(doc.length));
    top = Math.min(top, Math.max(screen.top, last.top));
  }
  const moved = scrollBy(scroller, top - screen.top);
  if (Math.abs(moved) < slack) {
    return startOf(view, view.lineBlockAt(forward ? doc.length : 0));
  }
  const now = { top: screen.top + moved, bottom: screen.bottom + moved };
  if (!behind(caretOf(view, offsetOf(view, head)), now, forward)) return head;
  return posAt(view, land(view, now, forward), (row) => startOf(view, row));
}

/** The rows `Ctrl-d` and `Ctrl-u` go in each editor once a count has set it, as Vim's `scroll`. */
const halfPageRows = new WeakMap<EditorView, number>();

/**
 * `Ctrl-d` and `Ctrl-u`: the cursor `count` rows on, which the next ones go too, or half the rows
 * on screen until a count is given, and the scroll as far as the cursor went, so it stays where it
 * is on screen. A cursor the wheel left behind the screen goes from where a page would land it.
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
  const caret = caretOf(view, offsetOf(view, head));
  let from = { pos: head, row: caret, block: rowAt(view, head) };
  if (behind(caret, screen, forward)) {
    const stop = land(view, screen, forward);
    from = {
      pos: posAt(view, stop, (row) => startOf(view, row)),
      row: stop.row,
      block: stop.block,
    };
  }
  let to = from.block;
  for (let turn = 0; turn < rows; turn++) {
    const step = forward ? next(view, to) : previous(view, to);
    if (!step) break;
    to = step;
  }
  if (to === from.block) return from.pos;
  // From the cursor's own row of text, which in a line that wraps can be far below its start.
  scrollBy(scroller, bodyOf(to).top - from.row.top);
  return startOf(view, to);
}

/**
 * `Ctrl-e` and `Ctrl-y`: the scroll `count` rows on, a row at the top of the screen at a time,
 * and the cursor onto the screen's first row (or last) if the scroll left it behind. A motion, so in
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
  if (!behind(caretOf(view, offsetOf(view, head)), now, forward)) return head;
  return posAt(view, land(view, now, forward), (each) => columnOf(view, each, head.ch));
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
  const head = cm.getCursor();
  const shift = (span: Span): number =>
    where === 'top'
      ? span.top - screen.top
      : where === 'bottom'
        ? span.bottom - screen.bottom
        : (span.top + span.bottom) / 2 - (screen.top + screen.bottom) / 2;
  // A line taller than the screen goes by the cursor's own row of text, which putting the line's
  // body there would leave off screen.
  const caret = caretOf(view, offsetOf(view, head));
  let delta = shift(bodyOf(rowAt(view, head)));
  if (!within({ top: caret.top - delta, bottom: caret.bottom - delta }, screen)) {
    delta = shift(caret);
  }
  scrollBy(scroller, delta);
}

/**
 * Leaves a cursor whose row is wholly on screen where it is when it's brought into view, as Vim
 * does, where CodeMirror would scroll it to 5 pixels inside the screen's edge: after `H`, `L` or
 * `z<CR>`, that would move what they put at the edge. In a line that wraps, the cursor's row is
 * its own row of text. A row off screen, or partly, scrolls as usual.
 */
export const leaveOnScreen = EditorView.scrollHandler.of((view, range, options) => {
  if (options.y !== 'nearest' || !range.empty) return false;
  const scroller = scrollerOf(view);
  if (!scroller) return false;
  return within(caretOf(view, range.head), screenOf(view, scroller));
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
