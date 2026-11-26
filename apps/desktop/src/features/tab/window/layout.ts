// The row a pull request's tab draws its body in: the left panel, one view or two, and the threads
// panel, as `fit` draws the window's layout in the row's width. The layout is the window's, every
// tab's alike: each panel open or not, and its width, unset while it's the default; and whether the
// code is beside a reading view, with the reading view's share of their room once its edge has been
// dragged. Main keeps it across restarts, the window has it before it draws a tab, and each change
// is kept as it's made. A drag on an edge sets a width as it ends, and draws its own until then, and
// so do the keys that size what has focus, which draw the edge as pressed while they're held. What
// the row has no room for at its minimum is put away, the threads panel first, then the left panel,
// then the view without focus, but never what was asked for last before the others, and comes back
// as soon as there's room. A panel asked for, put back by Reset layout, or back as its key or button
// closes the other, fades in as it arrives; one back as the window widens, or as a drag closes the
// other, is just there.

import {
  fit,
  KEY_STEP,
  readSizes,
  resizing,
  type Fitted,
  type Layout,
  type PanelLayout,
  type Asked,
  type Sizes,
  type ViewFocus,
} from '@lo/ui';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';

import { focusMiddle } from '../../../window/commands/registry.ts';
import { FIRST_LAYOUT, type WindowLayout } from '../contract.ts';
import { main } from './main.ts';

/** A panel with an edge in the row. */
export type Edge = 'left' | 'threads';

/** An edge in the row: a panel's, or the gap between two views. */
export type RowEdge = Edge | 'views';

/** The panels, the left first. */
const EDGES = ['left', 'threads'] as const;

/** The window's layout of the row, every pull request's tab alike. */
export const layout = createStore<WindowLayout>()(() => FIRST_LAYOUT);

/**
 * The row as it's drawn: its width, once it's measured; an edge as a drag under way has it, which
 * `layout` takes only if the drag ends somewhere new, and whether letting go there closes the
 * panel, the width being the reading view's for the edge between two views; the edge a key moved,
 * while the key is held; and what was asked for last, a panel or code beside.
 */
export const row = createStore<{
  readonly width?: number | undefined;
  readonly drag?:
    { readonly edge: RowEdge; readonly width: number; readonly closing: boolean } | undefined;
  readonly stepped?: RowEdge | undefined;
  readonly asked?: Asked | undefined;
}>()(() => ({}));

type RowState = ReturnType<typeof row.getState>;

/**
 * How many views other features put in the left panel, the middle and the right panel, as the tab
 * last drew them, and how many of the middle's are reading views and code views, for the keys that
 * open the panels, put the code beside and step between the views. Features list their views once,
 * as the window starts, and only a view a setting turns off comes and goes.
 */
export const viewCounts = { left: 0, middle: 0, right: 0, reading: 0, code: 0 };

/**
 * Which of two views has focus in the tab on screen, as it last drew them, or would have with the
 * code beside: what `fit` keeps where there's room for only one.
 */
export const viewFocus: { now: ViewFocus } = { now: 'reading' };

/** Where the left panel is on the DOM, when it's drawn: the tab on screen's. */
export const LEFT = '[data-lo-left]';
/** Where the right panel is on the DOM, when it's drawn: the tab on screen's. */
export const RIGHT = '[data-lo-right]';

/** Which panels a pull request's tab has views for, and whether it has a reading view and code. */
export interface There {
  readonly left: boolean;
  readonly threads: boolean;
  readonly beside: boolean;
}

/** Which panels the tab on screen has views for, as it last drew them. */
function thereNow(): There {
  return {
    left: viewCounts.left > 0,
    threads: viewCounts.right > 0,
    beside: viewCounts.reading > 0 && viewCounts.code > 0,
  };
}

let sizes: Sizes | undefined;

/** The sizes the row is laid out in, from the design tokens, read once. */
function rowSizes(): Sizes {
  sizes ??= readSizes(getComputedStyle(document.documentElement));
  return sizes;
}

/** `saved` as a tab with the panels `there` draws it, a drag's width in place of the one kept. */
function asShown(there: There, saved: WindowLayout, state: RowState): Layout {
  const panel = (edge: Edge, panelThere: boolean): PanelLayout => ({
    open: saved[edge].open && panelThere,
    width: state.drag?.edge === edge ? state.drag.width : saved[edge].width,
  });
  return {
    left: panel('left', there.left),
    threads: panel('threads', there.threads),
    beside: saved.beside && there.beside,
    reading: saved.reading,
  };
}

/**
 * The row of a tab with the panels `there` has views for, as it's drawn: with `state`'s width (as
 * wide as they like, before it's measured), the layout `saved`, and `focus` on one of two views.
 * A drag of the edge between two views draws the reading view as wide as the drag has it.
 */
export function drawnRow(
  there: There = thereNow(),
  state: RowState = row.getState(),
  saved: WindowLayout = layout.getState(),
  focus: ViewFocus = viewFocus.now,
): Fitted {
  const shown = asShown(there, saved, state);
  const width = state.width ?? Infinity;
  const drawn = fit(shown, width, state.asked, focus, rowSizes());
  const [reading, code] = drawn.views;
  if (state.drag?.edge !== 'views' || reading === undefined || code === undefined) return drawn;
  return fit(
    { ...shown, reading: state.drag.width / (reading + code) },
    width,
    state.asked,
    focus,
    rowSizes(),
  );
}

/** The row as it's drawn, re-rendering as it changes, a drag's frames among it. */
export function useRow(there: There, focus: ViewFocus = viewFocus.now): Fitted {
  const state = useStore(row);
  const saved = useStore(layout);
  return drawnRow(there, state, saved, focus);
}

/**
 * What `pick` takes of the row a tab with the panels `there` draws, re-rendering only as that
 * changes, so a tab isn't drawn again at each frame of a drag.
 */
function useDrawn<T>(there: There, pick: (drawn: Fitted) => T, focus?: ViewFocus): T {
  const fromRow = useStore(row, (state) => pick(drawnRow(there, state, layout.getState(), focus)));
  useStore(layout, (saved) => pick(drawnRow(there, row.getState(), saved, focus)));
  return fromRow;
}

/**
 * Whether the tab with the views `there` draws two views, the code beside a reading view, with
 * `focus` on one of them: re-rendering as that changes, not at each frame of a drag.
 */
export function useBesideDrawn(there: There, focus?: ViewFocus): boolean {
  return useDrawn(there, (drawn) => drawn.views.length === 2, focus);
}

/** Whether the code can't be drawn beside a view, and isn't: its button is dimmed. */
export function useBesideCramped(there: There): boolean {
  return useDrawn(there, (drawn) => drawn.views.length < 2 && drawn.cramped.beside);
}

/** Whether panel `edge` is drawn, re-rendering as that changes. */
export function usePanelDrawn(edge: Edge, there: There): boolean {
  return useDrawn(there, (drawn) => drawn[edge] !== undefined);
}

/**
 * Whether panel `edge` can't be drawn beside one view at its minimum, and isn't: its button is
 * dimmed, and says to widen the window.
 */
export function usePanelCramped(edge: Edge, there: There): boolean {
  return useDrawn(there, (drawn) => drawn[edge] === undefined && drawn.cramped[edge]);
}

/** Whether letting go of the drag under way closes panel `edge`, which then shows gone. */
export function useClosing(edge: Edge): boolean {
  return useStore(row, (state) => state.drag?.edge === edge && state.drag.closing);
}

/** Whether a key moved `edge`, and is still held. */
export function useStepped(edge: RowEdge): boolean {
  return useStore(row, (state) => state.stepped === edge);
}

/** Changes what the layout keeps of panel `edge`. */
function setPanel(edge: Edge, change: PanelLayout): void {
  const now = layout.getState();
  layout.setState(
    edge === 'left'
      ? { left: { ...now.left, ...change } }
      : { threads: { ...now.threads, ...change } },
  );
}

/** Whether panel `edge` is drawn in the tab on screen. */
export function panelDrawn(edge: Edge): boolean {
  return drawnRow()[edge] !== undefined;
}

/** Whether the tab on screen draws two views, the code beside a reading view. */
export function besideDrawn(): boolean {
  return drawnRow().views.length === 2;
}

/**
 * Why the code can't be drawn beside a view in the tab on screen: it isn't, and two views don't fit
 * at their minimum. `true` when it's drawn, or can be.
 */
export function besideDrawable(): true | string {
  const drawn = drawnRow();
  return drawn.views.length === 2 || !drawn.cramped.beside || 'Widen the window first';
}

/**
 * Why panel `edge` can't be drawn in the tab on screen: it isn't, and doesn't fit beside one view
 * at its minimum. `true` when it's drawn, or can be.
 */
export function drawable(edge: Edge): true | string {
  const drawn = drawnRow();
  return drawn[edge] !== undefined || !drawn.cramped[edge] || 'Widen the window first';
}

/** The panels that fade in as they're next drawn: asked for, or put back by Reset layout. */
const arriving = new Set<Edge>();

/** Makes `change`, and has each panel it draws that wasn't drawn fade in as it arrives. */
function arrive(change: () => void): void {
  const before = drawnRow();
  change();
  const after = drawnRow();
  for (const edge of EDGES) {
    if (before[edge] === undefined && after[edge] !== undefined) arriving.add(edge);
  }
  // One that isn't drawn by then after all doesn't fade in later, as the window widens.
  if (arriving.size > 0) requestAnimationFrame(() => arriving.clear());
}

/** Whether panel `edge` fades in as it's drawn now, which it does once after it's asked for. */
export function arrives(edge: Edge): boolean {
  return arriving.delete(edge);
}

/**
 * Asks for panel `edge`, as its key or its button does: it opens, or if it's open but put away,
 * it's drawn, and the other gives way.
 */
export function askPanel(edge: Edge): void {
  arrive(() => {
    row.setState({ asked: edge });
    setPanel(edge, { open: true });
  });
}

/**
 * Closes panel `edge`, giving focus in it, if it had it, back to the middle view, as the panel
 * goes. It's no longer the panel asked for last, so it doesn't put the other away as it opens
 * again by itself, as when a tab puts its threads panel back.
 */
export function closePanel(edge: Edge): void {
  const had = document.querySelector(edge === 'left' ? LEFT : RIGHT);
  const focused = had?.contains(document.activeElement) ?? false;
  if (row.getState().asked === edge) row.setState({ asked: undefined });
  setPanel(edge, { open: false });
  if (focused) focusMiddle();
}

/**
 * Opens or closes panel `edge`, as its key or its button does: one drawn closes, and one that
 * isn't is asked for. Says which it did. The other panel, put away for this one, fades in as it
 * comes back.
 */
export function togglePanel(edge: Edge): 'opened' | 'closed' {
  if (panelDrawn(edge)) {
    arrive(() => closePanel(edge));
    return 'closed';
  }
  askPanel(edge);
  return 'opened';
}

/** Keeps panel `edge` open or closed, as it was, without asking for it. */
export function setOpen(edge: Edge, open: boolean): void {
  setPanel(edge, { open });
}

/** Keeps panel `edge` at `width`, or at its default with none. */
export function setWidth(edge: Edge, width: number | undefined): void {
  setPanel(edge, { open: layout.getState()[edge].open, width });
}

/**
 * Keeps the reading view at `share` of the two views' room, or at its default with none, as the
 * edge between them is dragged or put back.
 */
export function setReading(share: number | undefined): void {
  const { left, threads, beside } = layout.getState();
  const next: WindowLayout = { left, threads, beside };
  layout.setState(share === undefined ? next : { ...next, reading: share }, true);
}

/**
 * Asks for the code beside a reading view, as `o` does: drawn, and what has no room gives way.
 * What a panel put away for it gives back as it closes fades in.
 */
export function askBeside(): void {
  arrive(() => {
    row.setState({ asked: 'beside' });
    layout.setState({ beside: true });
  });
}

/**
 * Takes the code from beside a reading view, as `o` does again: one view, and a panel put away for
 * the two fades in as it comes back.
 */
export function closeBeside(): void {
  arrive(() => {
    if (row.getState().asked === 'beside') row.setState({ asked: undefined });
    layout.setState({ beside: false });
  });
}

/**
 * Draws `edge` as pressed, as a key moves it, until a key is let go, the pointer moves or the
 * window loses focus.
 */
function showStepped(edge: RowEdge): void {
  if (row.getState().stepped !== undefined) return;
  row.setState({ stepped: edge });
  const ends = ['keyup', 'pointermove', 'blur'] as const;
  const end = () => {
    row.setState({ stepped: undefined });
    for (const type of ends) window.removeEventListener(type, end, true);
  };
  for (const type of ends) window.addEventListener(type, end, true);
}

/** The panels by where they are on the DOM. */
const PANELS = [
  ['left', LEFT],
  ['threads', RIGHT],
] as const;

/** Where the views' sheets are on the DOM, each named for its kind: `reading` or `code`. */
export const SHEET = '[data-lo-sheet]';

/**
 * What the keys that size what has focus act on: the panel focus is in, as it's drawn; or, with
 * two views drawn, the edge between them, for the view focus is in, the reading view's width
 * growing (`by` 1) as it widens or the code's (`by` -1). Nothing has an edge anywhere else, and
 * nothing while an edge is dragged, whose drag the keys would undo.
 */
function sized():
  { edge: RowEdge; width: number; min: number; max: number; by: 1 | -1; room: number } | undefined {
  if (resizing(document)) return undefined;
  const focused = document.activeElement;
  const drawn = drawnRow();
  const panel = PANELS.find(([, at]) => document.querySelector(at)?.contains(focused));
  if (panel) {
    const [edge] = panel;
    const width = drawn[edge];
    const range = drawn.edges[edge];
    if (width === undefined || range === undefined) return undefined;
    return { edge, width, ...range, by: 1, room: 0 };
  }
  const sheet = focused?.closest<HTMLElement>(SHEET)?.dataset['loSheet'];
  const [reading, code] = drawn.views;
  const range = drawn.edges.views;
  if (sheet === undefined || reading === undefined || code === undefined || !range) {
    return undefined;
  }
  return {
    edge: 'views',
    width: reading,
    ...range,
    by: sheet === 'code' ? -1 : 1,
    room: reading + code,
  };
}

/**
 * Whether what has focus can be widened (1) or narrowed (-1) by a key, or `''` where nothing has
 * an edge or it's at its limit, as a dimmed label says.
 */
export function steppable(step: 1 | -1): true | '' {
  const edge = sized();
  if (!edge) return '';
  return (step * edge.by === 1 ? edge.width < edge.max : edge.width > edge.min) || '';
}

/** Widens (1) or narrows (-1) what has focus by a key's step, within its limits. */
export function stepWidth(step: 1 | -1): void {
  const edge = sized();
  if (!edge) return;
  const width = Math.max(edge.min, Math.min(edge.max, edge.width + step * edge.by * KEY_STEP));
  if (edge.edge === 'views') setReading(width / edge.room);
  else setWidth(edge.edge, width);
  showStepped(edge.edge);
}

/** Whether what has focus has a width of its own to put back, or `''` where it doesn't. */
export function resettable(): true | '' {
  const edge = sized();
  if (!edge) return '';
  const saved = layout.getState();
  return (edge.edge === 'views' ? saved.reading : saved[edge.edge].width) !== undefined || '';
}

/** Puts what has focus back to its default width. */
export function resetWidth(): void {
  const edge = sized();
  if (!edge) return;
  if (edge.edge === 'views') setReading(undefined);
  else setWidth(edge.edge, undefined);
  showStepped(edge.edge);
}

/** Whether the layout is the first one, with nothing for Reset layout to put back. */
export function firstLayout(): boolean {
  const now = layout.getState();
  return (
    now.left.open === FIRST_LAYOUT.left.open &&
    now.left.width === undefined &&
    now.threads.open === FIRST_LAYOUT.threads.open &&
    now.threads.width === undefined &&
    now.beside === FIRST_LAYOUT.beside &&
    now.reading === undefined
  );
}

/**
 * Puts the layout back as it first was, as Reset layout does: focus in a panel that closes goes
 * back to the middle view, and one that opens fades in.
 */
export function resetLayout(): void {
  arrive(() => {
    for (const edge of EDGES) {
      if (!FIRST_LAYOUT[edge].open) closePanel(edge);
    }
    row.setState({ asked: undefined });
    layout.setState(FIRST_LAYOUT, true);
  });
}

/** The layout as main last had it, as JSON, so what main sent isn't sent back. */
let kept = JSON.stringify(FIRST_LAYOUT);

/** Takes the layout main kept, as the window starts, before it draws a tab. */
export async function loadLayout(): Promise<void> {
  const value = await main().layout();
  kept = JSON.stringify(value);
  layout.setState(value, true);
}

/** Has main keep each change to the layout from now on, for the next time Lo starts. */
export function keepLayout(): () => void {
  return layout.subscribe((value) => {
    const text = JSON.stringify(value);
    if (text === kept) return;
    kept = text;
    main()
      .keepLayout(value)
      .catch((error: unknown) => console.error("Lo couldn't keep the window's layout:", error));
  });
}
