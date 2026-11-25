// The row a pull request's tab draws its body in: the left panel, the middle and the threads panel,
// as `fit` draws the window's layout in the row's width. The layout is the window's, every tab's
// alike: each panel open or not, and its width, unset while it's the default. Main keeps it across
// restarts, the window has it before it draws a tab, and each change is kept as it's made. A drag on
// an edge sets a width as it ends, and draws its own until then, and so do the keys that size what
// has focus, which draw the edge as pressed while they're held. What the row has no room for at its
// minimum is put away, the threads panel first, but never the panel asked for last before the other,
// and comes back as soon as there's room.

import {
  fit,
  KEY_STEP,
  readSizes,
  resizing,
  type Fitted,
  type Layout,
  type PanelLayout,
  type Sizes,
} from '@lo/ui';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';

import { focusMiddle } from '../../../window/commands/registry.ts';
import { FIRST_LAYOUT, type WindowLayout } from '../contract.ts';
import { main } from './main.ts';

/** A panel with an edge in the row. */
export type Edge = 'left' | 'threads';

/** The window's layout of the row, every pull request's tab alike. */
export const layout = createStore<WindowLayout>()(() => FIRST_LAYOUT);

/**
 * The row as it's drawn: its width, once it's measured; a panel's edge as a drag under way has it,
 * which `layout` takes only if the drag ends somewhere new, and whether letting go there closes the
 * panel; the edge a key moved, while the key is held; and the panel asked for last.
 */
export const row = createStore<{
  readonly width?: number | undefined;
  readonly drag?:
    { readonly edge: Edge; readonly width: number; readonly closing: boolean } | undefined;
  readonly stepped?: Edge | undefined;
  readonly asked?: Edge | undefined;
}>()(() => ({}));

type RowState = ReturnType<typeof row.getState>;

/**
 * How many views other features put in the left panel, the middle and the right panel, as the tab
 * last drew them, for the keys that open the panels and step between the views. Features list
 * their views once, as the window starts, and only a view a setting turns off comes and goes.
 */
export const viewCounts = { left: 0, middle: 0, right: 0 };

/** Where the left panel is on the DOM, when it's drawn: the tab on screen's. */
export const LEFT = '[data-lo-left]';
/** Where the right panel is on the DOM, when it's drawn: the tab on screen's. */
export const RIGHT = '[data-lo-right]';

/** Which panels a pull request's tab has views for. */
export interface There {
  readonly left: boolean;
  readonly threads: boolean;
}

/** Which panels the tab on screen has views for, as it last drew them. */
function thereNow(): There {
  return { left: viewCounts.left > 0, threads: viewCounts.right > 0 };
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
    beside: false,
  };
}

/**
 * The row of a tab with the panels `there` has views for, as it's drawn: with `state`'s width (as
 * wide as they like, before it's measured), and the layout `saved`.
 */
export function drawnRow(
  there: There = thereNow(),
  state: RowState = row.getState(),
  saved: WindowLayout = layout.getState(),
): Fitted {
  return fit(
    asShown(there, saved, state),
    state.width ?? Infinity,
    state.asked,
    'code',
    rowSizes(),
  );
}

/** The row as it's drawn, re-rendering as it changes, a drag's frames among it. */
export function useRow(there: There): Fitted {
  const state = useStore(row);
  const saved = useStore(layout);
  return drawnRow(there, state, saved);
}

/**
 * What `pick` takes of the row a tab with the panels `there` draws, re-rendering only as that
 * changes, so a tab isn't drawn again at each frame of a drag.
 */
function useDrawn<T>(there: There, pick: (drawn: Fitted) => T): T {
  const fromRow = useStore(row, (state) => pick(drawnRow(there, state, layout.getState())));
  useStore(layout, (saved) => pick(drawnRow(there, row.getState(), saved)));
  return fromRow;
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

/** Whether a key moved panel `edge`'s edge, and is still held. */
export function useStepped(edge: Edge): boolean {
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

/**
 * Why panel `edge` can't be drawn in the tab on screen: it isn't, and doesn't fit beside one view
 * at its minimum. `true` when it's drawn, or can be.
 */
export function drawable(edge: Edge): true | string {
  const drawn = drawnRow();
  return drawn[edge] !== undefined || !drawn.cramped[edge] || 'Widen the window first';
}

/**
 * Asks for panel `edge`, as its key or its button does: it opens, or if it's open but put away,
 * it's drawn, and the other gives way.
 */
export function askPanel(edge: Edge): void {
  row.setState({ asked: edge });
  setPanel(edge, { open: true });
}

/**
 * Closes panel `edge`, giving focus in it, if it had it, back to the middle view, as the panel
 * goes.
 */
export function closePanel(edge: Edge): void {
  const had = document.querySelector(edge === 'left' ? LEFT : RIGHT);
  const focused = had?.contains(document.activeElement) ?? false;
  setPanel(edge, { open: false });
  if (focused) focusMiddle();
}

/**
 * Opens or closes panel `edge`, as its key or its button does: one drawn closes, and one that
 * isn't is asked for. Says which it did.
 */
export function togglePanel(edge: Edge): 'opened' | 'closed' {
  if (panelDrawn(edge)) {
    closePanel(edge);
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
 * Draws panel `edge`'s edge as pressed, as a key moves it, until a key is let go, the pointer moves
 * or the window loses focus.
 */
function showStepped(edge: Edge): void {
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

/**
 * What the keys that size what has focus act on: the panel focus is in, as it's drawn. Nothing
 * has an edge anywhere else, and nothing while an edge is dragged, whose drag the keys would undo.
 */
function sized(): { edge: Edge; width: number; min: number; max: number } | undefined {
  if (resizing(document)) return undefined;
  const panel = PANELS.find(([, at]) =>
    document.querySelector(at)?.contains(document.activeElement),
  );
  if (!panel) return undefined;
  const [edge] = panel;
  const drawn = drawnRow();
  const width = drawn[edge];
  const range = drawn.edges[edge];
  if (width === undefined || range === undefined) return undefined;
  return { edge, width, ...range };
}

/**
 * Whether what has focus can be widened (1) or narrowed (-1) by a key, or `''` where nothing has
 * an edge or it's at its limit, as a dimmed label says.
 */
export function steppable(step: 1 | -1): true | '' {
  const edge = sized();
  if (!edge) return '';
  return (step === 1 ? edge.width < edge.max : edge.width > edge.min) || '';
}

/** Widens (1) or narrows (-1) what has focus by a key's step, within its limits. */
export function stepWidth(step: 1 | -1): void {
  const edge = sized();
  if (!edge) return;
  setWidth(edge.edge, Math.max(edge.min, Math.min(edge.max, edge.width + step * KEY_STEP)));
  showStepped(edge.edge);
}

/** Whether what has focus has a width of its own to put back, or `''` where it doesn't. */
export function resettable(): true | '' {
  const edge = sized();
  return (edge !== undefined && layout.getState()[edge.edge].width !== undefined) || '';
}

/** Puts what has focus back to its default width. */
export function resetWidth(): void {
  const edge = sized();
  if (!edge) return;
  setWidth(edge.edge, undefined);
  showStepped(edge.edge);
}

/** Whether the layout is the first one, with nothing for Reset layout to put back. */
export function firstLayout(): boolean {
  return JSON.stringify(layout.getState()) === JSON.stringify(FIRST_LAYOUT);
}

/**
 * Puts the layout back as it first was, as Reset layout does: focus in a panel that closes goes
 * back to the middle view.
 */
export function resetLayout(): void {
  for (const edge of ['left', 'threads'] as const) {
    if (!FIRST_LAYOUT[edge].open) closePanel(edge);
  }
  row.setState({ asked: undefined });
  layout.setState(FIRST_LAYOUT, true);
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
