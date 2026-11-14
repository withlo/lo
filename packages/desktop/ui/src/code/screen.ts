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
// The keys that scroll go by pixels, as much of the screen as each key asks, and never by where
// the cursor lands: what's drawn around a row, and a line that wraps, can be far taller than the
// screen, and the other side's lines go by beside a spacer as tall as they are. The cursor then
// goes to a row on the new screen, and the scroll to the cursor that follows every key is held
// back for these, so the cursor never drags the view. Where the focused side shows only what's
// drawn between its rows, as a spacer facing the other side's lines, the cursor goes to its row
// beside the other side's nearest one on screen, which can be off screen itself.

import type { EditorSelection } from '@codemirror/state';
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
 * A place for the cursor on screen: a row, at its start, or at `offset`, the start of a row of text
 * in a line that wraps; the row of text there, as `caretOf` finds it; and whether that's wholly on
 * screen or only partly.
 */
interface Stop {
  block: BlockInfo;
  offset?: number;
  row: Span;
  whole: boolean;
}

/** How many lines of the last screen a page keeps on screen, as Vim does. */
const pageOverlap = 2;

/** Whether a row's body ends this little outside the screen and still counts as on it, in px. */
const slack = 1;

let defined = false;

/**
 * The line each editor's last screen key put its cursor on, and the selection that made, for which
 * the scroll to the cursor is held back; and the line the key's scroll kept at the screen's edge.
 */
const placed = new WeakMap<EditorView, { line: number; selection?: EditorSelection; pin?: Pin }>();

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

/** The other editors shown beside this one in the same box: the other side of a diff. */
function othersOf(view: EditorView): EditorView[] {
  const others: EditorView[] = [];
  for (const child of view.dom.parentElement?.children ?? []) {
    if (child === view.dom || !(child instanceof HTMLElement) || child.hidden) continue;
    const other = child.classList.contains('cm-editor') ? EditorView.findFromDOM(child) : null;
    if (other) others.push(other);
  }
  return others;
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

/** Whether any of `span` is on `screen`, more than `slack` of it. */
function crosses(span: Span, screen: Span): boolean {
  return span.bottom > screen.top + slack && span.top < screen.bottom - slack;
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

/** The rows whose bodies are on `screen`, wholly or partly, top to bottom. */
function rowsOn(view: EditorView, screen: Span): BlockInfo[] {
  const rows: BlockInfo[] = [];
  let row: BlockInfo | undefined = view.lineBlockAtHeight(Math.max(0, screen.top));
  for (; row && row.top < screen.bottom; row = next(view, row)) {
    if (crosses(bodyOf(row), screen)) rows.push(row);
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
 * How tall a line of text is, as the editor's style sets it; else as CodeMirror estimates it, from
 * whichever short line it measured last.
 */
function lineHeightOf(view: EditorView): number {
  const { lineHeight } = getComputedStyle(view.contentDOM);
  const set = lineHeight.endsWith('px') ? Number.parseFloat(lineHeight) : Number.NaN;
  return set > 0 ? set : view.defaultLineHeight;
}

/**
 * Whether `body` is a line wrapped onto more rows of text than one, which the screen can cut
 * through, and drawn, so its rows can be measured.
 */
function wraps(view: EditorView, body: BlockInfo): boolean {
  return (
    body.type === BlockType.Text &&
    body.bottom - body.top > lineHeightOf(view) * 1.5 &&
    body.from >= view.viewport.from &&
    body.to <= view.viewport.to
  );
}

/**
 * The row of text a cursor at `offset` is on, by height in the document, as CodeMirror and the
 * spacer pass bring it into view: its row's body, or, in a line that wraps, the row of the
 * character after it. `updating` while the editor updates, as when it brings the cursor into view:
 * it refuses to say where text is then, so the row is read from what it drew.
 */
function caretOf(view: EditorView, offset: number, updating = false): Span {
  const body = bodyOf(view.lineBlockAt(offset));
  if (!wraps(view, body)) return body;
  const rect = updating ? drawnAt(view, offset) : view.coordsAtPos(offset, 1);
  if (!rect) return body;
  const origin = view.documentTop;
  const row = { top: rect.top - origin, bottom: rect.bottom - origin };
  return row.bottom > body.top && row.top < body.bottom ? row : body;
}

/**
 * Where the character at `offset` is drawn, or at the end of its text the one before it, which is
 * on the same row of text: what `coordsAtPos` says of its row, read from the page. Nothing where
 * the editor drew no text there.
 */
function drawnAt(view: EditorView, offset: number): DOMRect | undefined {
  const { node, offset: at } = view.domAtPos(offset);
  const length = node.nodeType === Node.TEXT_NODE ? (node.nodeValue?.length ?? 0) : 0;
  if (length === 0) return undefined;
  const range = node.ownerDocument?.createRange();
  if (!range) return undefined;
  const from = Math.min(at, length - 1);
  range.setStart(node, from);
  range.setEnd(node, from + 1);
  return [...range.getClientRects()].find((rect) => rect.height > 0);
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
      start === from
        ? { block: row, row: text, whole: true }
        : { block: row, offset: start, row: text, whole: true },
    );
  }
  return lost ? [] : stops;
}

/**
 * Where the cursor can go on `screen`, top to bottom: the start of each row whose body is on it,
 * and, in a line that wraps and that the screen cuts through, the rows of text it shows wholly.
 */
function stopsOn(view: EditorView, screen: Span): Stop[] {
  return rowsOn(view, screen).flatMap((row): Stop[] => {
    const body = bodyOf(row);
    if (within(body, screen)) return [{ block: row, row: body, whole: true }];
    const rows = textRowsOn(view, row, screen);
    return rows.length > 0 ? rows : [{ block: row, row: body, whole: false }];
  });
}

/**
 * The stops a key goes by: those wholly on screen, or, with none, those partly on it, as Vim's
 * cursor goes only to lines its window shows whole while there are any.
 */
function wholeFirst(stops: readonly Stop[]): readonly Stop[] {
  const whole = stops.filter((stop) => stop.whole);
  return whole.length > 0 ? whole : stops;
}

/**
 * Where the focused side shows nothing of a row on `screen`, only what's drawn between its rows,
 * as a spacer facing the other side's lines: its row beside the other side's nearest row on
 * screen, the first going `forward`, the last going back. Undefined where neither side shows a
 * row.
 */
function across(view: EditorView, scroller: HTMLElement, forward: boolean): Stop | undefined {
  let nearest: number | undefined;
  for (const other of othersOf(view)) {
    const rows = rowsOn(other, screenOf(other, scroller));
    const row = forward ? rows[0] : rows.at(-1);
    if (!row) continue;
    const body = bodyOf(row);
    // The middle of its body, on the page.
    const at = other.documentTop + (body.top + body.bottom) / 2;
    if (nearest === undefined || (forward ? at < nearest : at > nearest)) nearest = at;
  }
  if (nearest === undefined) return undefined;
  const block = view.lineBlockAtHeight(Math.max(0, nearest - view.documentTop));
  return { block, row: bodyOf(block), whole: false };
}

/**
 * Where the cursor goes on `screen`: to the first stop on it, `forward`, or the last, as Vim's
 * goes to its window's first line or its last; else beside the other side's nearest row on it.
 * Undefined where neither side shows a row, and the cursor stays.
 */
function land(
  view: EditorView,
  scroller: HTMLElement,
  screen: Span,
  forward: boolean,
): Stop | undefined {
  const stops = wholeFirst(stopsOn(view, screen));
  return (forward ? stops[0] : stops.at(-1)) ?? across(view, scroller, forward);
}

/**
 * Holds back the scroll to the cursor after this key, which `pos` is where it put the cursor: the
 * view moves only as far as the key scrolled it. `pin` is the line the key's scroll kept at the
 * edge of the screen.
 */
function hold(view: EditorView, pos: Pos, pin?: Pin): Pos {
  placed.set(view, pin ? { line: pos.line + 1, pin } : { line: pos.line + 1 });
  return pos;
}

/**
 * The line a screen key that scrolled kept at the edge of the screen it moved away from, while the
 * selection the key made stands: the spacer pass keeps it in place as the rows around it are
 * measured, so rows past it, which may not have been on screen yet, move only away from it.
 */
export function screenKeyPin(view: EditorView): Pin | undefined {
  return heldByScreenKey(view) ? placed.get(view)?.pin : undefined;
}

/**
 * Whether the cursor is where a screen key just put it, so the scroll to it after that key is held
 * back, by CodeMirror and by the spacer pass alike: as long as the selection the key made stands.
 */
export function heldByScreenKey(view: EditorView): boolean {
  const record = placed.get(view);
  if (!record) return false;
  const { selection } = view.state;
  if (!record.selection && view.state.doc.lineAt(selection.main.head).number === record.line) {
    record.selection = selection;
  }
  if (record.selection === selection) return true;
  placed.delete(view);
  return false;
}

/** Scrolls by `delta` and says how far it went, which an end of the scroll can cut short. */
function scrollBy(scroller: HTMLElement, delta: number): number {
  const before = scroller.scrollTop;
  scroller.scrollTop = before + delta;
  return scroller.scrollTop - before;
}

/** Has the editor do now the measuring it has waiting, as it would before the next paint. */
function measureNow(view: EditorView): void {
  view.requestMeasure();
  // Reading the layout makes the editor do the measuring it has waiting.
  view.lineBlockAtHeight(0);
}

/** A line a key's scroll keeps on screen: the editor it's in, and where it starts. */
interface Pin {
  view: EditorView;
  pos: number;
}

/**
 * The line a key's scroll keeps on screen, and how far to scroll to keep it there. On each side,
 * going `forward`, the lowest line whose own top is on screen, more than a line below the screen's
 * top and no more than `limit`, which the scroll takes to the screen's top; going back, the
 * highest whose own bottom is as far above the screen's bottom, which the scroll takes there. Of
 * the sides', the one that scrolls least, so no side's lines are scrolled past unseen: everything
 * above that top, or below that bottom, was on screen or past it. Undefined where no line is in
 * reach, as inside a line taller than the screen.
 */
function pinFor(
  views: readonly EditorView[],
  scroller: HTMLElement,
  forward: boolean,
  limit: number,
): { pin: Pin; delta: number } | undefined {
  let best: { pin: Pin; distance: number } | undefined;
  for (const view of views) {
    const screen = screenOf(view, scroller);
    const line = lineHeightOf(view);
    let mine: { pin: Pin; distance: number } | undefined;
    let row: BlockInfo | undefined = view.lineBlockAtHeight(Math.max(0, screen.top));
    for (; row && row.top < screen.bottom; row = next(view, row)) {
      const body = bodyOf(row);
      const distance = forward ? body.top - screen.top : screen.bottom - body.bottom;
      if (distance <= line || distance > limit + slack) continue;
      if (!mine || distance > mine.distance) mine = { pin: { view, pos: body.from }, distance };
    }
    if (mine && (!best || mine.distance < best.distance)) best = mine;
  }
  return best && { pin: best.pin, delta: forward ? best.distance : -best.distance };
}

/**
 * Scrolls by what's on screen: a line of either side near the edge the scroll moves away from goes
 * to the other edge (`pinFor`), or, with none in reach, the screen goes `fallback` px on, keeping
 * the line at its top where it was. The editors measure what's waiting first, and again once the
 * scroll has brought rows into view, then the line is put back where the scroll took it, however
 * heights around it changed. Returns what the scroller shows now, whether the scroll moved, and the
 * line kept.
 */
function scrollByContent(
  view: EditorView,
  scroller: HTMLElement,
  forward: boolean,
  limit: number,
  fallback: number,
): { now: Span; moved: boolean; pin: Pin } {
  const views = [view, ...othersOf(view)];
  for (const each of views) measureNow(each);
  const screen = screenOf(view, scroller);
  const found = pinFor(views, scroller, forward, limit);
  const pin = found?.pin ?? {
    view,
    pos: bodyOf(view.lineBlockAtHeight(Math.max(0, screen.top))).from,
  };
  const delta = found?.delta ?? (forward ? fallback : -fallback);
  // Where the line's own top goes on screen.
  const top = (each: Pin): number =>
    bodyOf(each.view.lineBlockAt(each.pos)).top - screenOf(each.view, scroller).top;
  const goal = top(pin) - delta;
  const from = scroller.scrollTop;
  scrollBy(scroller, delta);
  for (const each of views) measureNow(each);
  scrollBy(scroller, top(pin) - goal);
  return {
    now: screenOf(view, scroller),
    moved: Math.abs(scroller.scrollTop - from) >= slack,
    pin,
  };
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
  const { view, scroller, screen } = found;
  const start = (row: BlockInfo): Pos => startOf(view, row);
  const stops = wholeFirst(stopsOn(view, screen));
  if (stops.length === 0) {
    const stop = across(view, scroller, where !== 'bottom');
    return hold(view, stop ? start(stop.block) : head);
  }
  if (where === 'top')
    return hold(view, posAt(view, stops[Math.min(count, stops.length) - 1]!, start));
  if (where === 'bottom') {
    return hold(view, posAt(view, stops[Math.max(0, stops.length - count)]!, start));
  }
  // The middle of what the rows on screen take up, as Vim's is of the lines its window shows.
  const middle = (stops[0]!.row.top + stops.at(-1)!.row.bottom) / 2;
  const distance = ({ row }: Stop): number => Math.max(row.top - middle, middle - row.bottom, 0);
  let nearest = stops[0]!;
  for (const stop of stops) if (distance(stop) < distance(nearest)) nearest = stop;
  return hold(view, posAt(view, nearest, start));
}

/**
 * `Ctrl-f` and `Ctrl-b`: `count` pages on, each taking the lowest line that starts on screen to
 * its top (or the highest that ends on it to its bottom), so it stays on screen as Vim keeps its
 * last lines, or, with none, a screen less two lines; and the cursor on that line, or the first row
 * on screen (or the last, going back), unless it's still wholly on screen. Where there's no more to
 * scroll, the cursor goes to the last row on screen (or the first), as Vim's goes to the
 * document's last line.
 */
function page(cm: { cm6: unknown }, head: Pos, forward: boolean, count: number): Pos {
  const found = geometry(cm);
  if (!found) return head;
  const { view, scroller, screen } = found;
  const line = lineHeightOf(view);
  const height = screen.bottom - screen.top;
  const step = Math.max(line, height - pageOverlap * line);
  let scrolled = { now: screen, moved: false, pin: undefined as Pin | undefined };
  for (let turn = 0; turn < count; turn++) {
    const one = scrollByContent(view, scroller, forward, height, step);
    scrolled = { now: one.now, moved: scrolled.moved || one.moved, pin: one.pin };
    if (!one.moved) break;
  }
  const { now, moved, pin } = scrolled;
  if (!moved) {
    const stop = land(view, scroller, now, !forward);
    return hold(view, stop ? posAt(view, stop, (row) => startOf(view, row)) : head);
  }
  if (within(caretOf(view, offsetOf(view, head)), now)) return hold(view, head, pin);
  // Onto the line the page kept, at the screen's top (or bottom), which the spacer pass then
  // holds there as the rows around it are measured.
  if (pin?.view === view) {
    const block = view.lineBlockAt(pin.pos);
    if (within(bodyOf(block), now)) return hold(view, startOf(view, block), pin);
  }
  const stop = land(view, scroller, now, forward);
  return hold(view, stop ? posAt(view, stop, (row) => startOf(view, row)) : head, pin);
}

/** The lines `Ctrl-d` and `Ctrl-u` go in each editor once a count has set it, as Vim's `scroll`. */
const halfPageLines = new WeakMap<EditorView, number>();

/**
 * `Ctrl-d` and `Ctrl-u`: the scroll `count` lines on, which the next ones go too, or half the
 * screen until a count is given, as far as the lowest line that starts within that (or the highest
 * that ends within it, going back), and the cursor as far, so it stays where it is on screen, on
 * the first row there or after it (before it, going back); from the screen's edge where it was off
 * it.
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
  if (count !== undefined) halfPageLines.set(view, count);
  const line = lineHeightOf(view);
  const height = screen.bottom - screen.top;
  const lines = halfPageLines.get(view) ?? Math.max(1, Math.floor(height / line / 2));
  const limit = Math.min(lines * line, height);
  const caret = caretOf(view, offsetOf(view, head));
  // Where the cursor's row of text is on screen, which it keeps.
  const offset = within(caret, screen) ? caret.top - screen.top : undefined;
  const { now, pin } = scrollByContent(view, scroller, forward, limit, limit);
  // At the end of the scroll, the cursor goes on as far as the key asked, as Vim's does.
  const end = forward
    ? scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - slack
    : scroller.scrollTop <= slack;
  const target =
    offset === undefined
      ? forward
        ? now.top
        : now.bottom
      : end
        ? caret.top + (forward ? limit : -limit)
        : now.top + offset;
  const stops = wholeFirst(stopsOn(view, now));
  const stop = forward
    ? (stops.find((each) => each.row.top >= target - slack) ?? stops.at(-1))
    : (stops.findLast((each) => each.row.top <= target + slack) ?? stops[0]);
  const landed = stop ?? across(view, scroller, forward);
  return hold(view, landed ? posAt(view, landed, (row) => startOf(view, row)) : head, pin);
}

/**
 * `Ctrl-e` and `Ctrl-y`: the scroll `count` lines on, and the cursor onto the screen's first row
 * (or last) if the scroll left it off. A motion, so in visual mode the selection keeps its other
 * end.
 */
function scrollRows(cm: { cm6: unknown }, head: Pos, forward: boolean, count: number): Pos {
  const found = geometry(cm);
  if (!found) return head;
  const { view, scroller } = found;
  const lines = count * lineHeightOf(view);
  const { now, pin } = scrollByContent(view, scroller, forward, lines, lines);
  const caret = caretOf(view, offsetOf(view, head));
  if (within(caret, now)) return hold(view, head, pin);
  // Onto the edge of the screen it went past, as Vim's cursor stays on screen.
  const stop = land(view, scroller, now, caret.top < now.top);
  const pos = stop ? posAt(view, stop, (row) => columnOf(view, row, head.ch)) : head;
  return hold(view, pos, pin);
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
 * Leaves the scroll as it is when the cursor is brought into view, as Vim does, where its row is
 * wholly on screen, and CodeMirror would scroll it to 5 pixels inside the screen's edge: after
 * `H`, `L` or `z<CR>`, that would move what they put at the edge. In a line that wraps, the
 * cursor's row is its own row of text. And after a screen key, wherever the key put the cursor.
 */
export const leaveOnScreen = EditorView.scrollHandler.of((view, range, options) => {
  if (options.y !== 'nearest') return false;
  if (heldByScreenKey(view)) return true;
  if (!range.empty) return false;
  const scroller = scrollerOf(view);
  if (!scroller) return false;
  return within(caretOf(view, range.head, true), screenOf(view, scroller));
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
