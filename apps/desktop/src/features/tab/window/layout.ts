// The row a pull request's tab draws its body in: the left panel, the middle and the threads panel,
// each as wide as `fitWidths` lets it be in the row's width. The left panel's width is the window's,
// every tab's alike, kept in memory and unset while it's the default. A drag on its edge sets it, and
// so do the keys that size what has focus, which draw the edge as pressed while they're held.

import { fitWidths, KEY_STEP, readSizes, type Fitted, type Sizes } from '@lo/ui';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';

/** The window's layout of the row: the left panel's width, unset while it's the default. */
export const layout = createStore<{ readonly left?: number | undefined }>()(() => ({}));

/**
 * The row as it's drawn: its width, once it's measured, and the edge a key moved, while the key is
 * held.
 */
export const row = createStore<{
  readonly width?: number | undefined;
  readonly stepped?: 'left' | undefined;
}>()(() => ({}));

/** Where the left panel is on the DOM, when it's drawn: the tab on screen's. */
export const LEFT = '[data-lo-left]';

let sizes: Sizes | undefined;

/** The sizes the row is laid out in, from the design tokens, read once. */
function rowSizes(): Sizes {
  sizes ??= readSizes(getComputedStyle(document.documentElement));
  return sizes;
}

/** Which panels a tab's row draws. */
export interface Open {
  readonly left: boolean;
  readonly threads: boolean;
}

/**
 * The row drawn with the panels `open` says, `width` wide (as wide as they like, before it's
 * measured), with the left panel `left` wide.
 */
export function drawnRow(
  open: Open,
  width = row.getState().width,
  left = layout.getState().left,
): Fitted {
  return fitWidths(
    { left: { open: open.left, width: left }, threads: { open: open.threads }, beside: false },
    width ?? Infinity,
    rowSizes(),
  );
}

/** The row drawn with the panels `open` says, re-rendering as it changes. */
export function useRow(open: Open): Fitted {
  const width = useStore(row, (state) => state.width);
  const left = useStore(layout, (state) => state.left);
  return drawnRow(open, width, left);
}

/** Whether a key moved the left panel's edge, and is still held. */
export function useStepped(): boolean {
  return useStore(row, (state) => state.stepped === 'left');
}

/**
 * Draws the left panel's edge as pressed, as a key moves it, until a key is let go, the pointer
 * moves or the window loses focus.
 */
function showStepped(): void {
  if (row.getState().stepped !== undefined) return;
  row.setState({ stepped: 'left' });
  const ends = ['keyup', 'pointermove', 'blur'] as const;
  const end = () => {
    row.setState({ stepped: undefined });
    for (const type of ends) window.removeEventListener(type, end, true);
  };
  for (const type of ends) window.addEventListener(type, end, true);
}

/**
 * What the keys that size what has focus act on: the left panel while focus is in it, drawn with
 * the panels `open` says. Nothing has an edge anywhere else.
 */
function sized(open: Open): { width: number; min: number; max: number } | undefined {
  const panel = document.querySelector(LEFT);
  if (!panel?.contains(document.activeElement)) return undefined;
  const drawn = drawnRow(open);
  if (drawn.left === undefined || drawn.edges.left === undefined) return undefined;
  return { width: drawn.left, ...drawn.edges.left };
}

/**
 * Whether what has focus can be widened (1) or narrowed (-1) by a key, or `''` where nothing has
 * an edge or it's at its limit, as a dimmed label says.
 */
export function steppable(open: Open, step: 1 | -1): true | '' {
  const edge = sized(open);
  if (!edge) return '';
  return (step === 1 ? edge.width < edge.max : edge.width > edge.min) || '';
}

/** Widens (1) or narrows (-1) what has focus by a key's step, within its limits. */
export function stepWidth(open: Open, step: 1 | -1): void {
  const edge = sized(open);
  if (!edge) return;
  const width = Math.max(edge.min, Math.min(edge.max, edge.width + step * KEY_STEP));
  layout.setState({ left: width });
  showStepped();
}

/** Whether what has focus has a width of its own to put back, or `''` where it doesn't. */
export function resettable(open: Open): true | '' {
  return (sized(open) !== undefined && layout.getState().left !== undefined) || '';
}

/** Puts what has focus back to its default width. */
export function resetWidth(open: Open): void {
  if (!sized(open)) return;
  layout.setState({ left: undefined });
  showStepped();
}
