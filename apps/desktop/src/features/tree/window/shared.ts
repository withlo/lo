// What the file tree shares with other features' window code: the order it lists the changed files
// in, which the diff shows them in; the file on screen, which the diff says as it scrolls and the
// tree follows; the views that show a file the tree asks for; and the path a file's key names.

import { useTabState } from '../../tab/window/shared.ts';
import type { Changed, TreePath, TreeState } from '../contract.ts';
import { panelOrder, type Mode } from './model.ts';
import { keyOf, pathOfKey } from './paths.ts';
import { choices, onScreen, reveal, shown, states } from './store.ts';

/** The order of each tab's changed files, kept until its changes or its mode change. */
const orders = new Map<
  string,
  { changes: readonly Changed[]; mode: Mode; order: readonly string[] }
>();

function orderOf(tab: string, state: TreeState | undefined, mode: Mode): readonly string[] {
  const changes = state?.changes ?? [];
  const kept = orders.get(tab);
  if (kept && kept.changes === changes && kept.mode === mode) return kept.order;
  const order = panelOrder(changes, mode);
  orders.set(tab, { changes, mode, order });
  return order;
}

/**
 * The files `tab`'s pull request changes, by key, in the order the panel lists them: the tree's
 * order, or review order. A file's key is its path, or for a path that isn't UTF-8, a NUL and its
 * bytes in hex.
 */
export function fileOrder(tab: string): readonly string[] {
  return orderOf(tab, states.get(tab), choices.get(tab).mode);
}

/** {@link fileOrder}, re-rendering when it changes. */
export function useFileOrder(tab: string): readonly string[] {
  const state = useTabState(states, tab);
  const mode = useTabState(choices, tab, (chosen) => chosen.mode);
  return orderOf(tab, state, mode);
}

/** How the panel orders the changed files: the tree's order, or review order. */
export type OrderMode = Mode;

/** The order `tab`'s panel lists its changed files in now, re-rendering when the reader changes it. */
export function useOrderMode(tab: string): OrderMode {
  return useTabState(choices, tab, (chosen) => chosen.mode);
}

/** {@link useOrderMode}, read once. */
export function orderModeOf(tab: string): OrderMode {
  return choices.get(tab).mode;
}

/**
 * The order the panel lists `changes` in, by key, in `mode`, as {@link fileOrder} gives it once
 * the tree has the same changes: for a view that has them first, so it's drawn in the panel's
 * order from the start.
 */
export function orderIn(changes: readonly Changed[], mode: OrderMode): readonly string[] {
  return panelOrder(changes, mode);
}

/**
 * The whole path of the file `key` names in `tab`'s tree, as the tree has it: a key made of a
 * path's digest doesn't hold its path, but the row or the change it names does.
 */
export function pathOf(tab: string, key: string): TreePath {
  if (!key.startsWith('\0#') && !key.startsWith('\0~')) return pathOfKey(key);
  const row = shown.get(tab)?.rows.find((each) => each.key === key);
  if (row !== undefined && row.kind !== 'group') return row.path;
  const change = states.get(tab)?.changes?.find((each) => keyOf(each.path) === key);
  return change?.path ?? pathOfKey(key);
}

/**
 * Says which file the middle view has on screen, by key, as the diff's `file` event does, or none.
 * The tree marks it, and scrolls to it unless the reader is in the tree.
 */
export function followFile(tab: string, file: string | undefined): void {
  if (onScreen.get(tab) === file) return;
  onScreen.set(tab, file);
  const tree = document.querySelector('[data-lo-scope="tree"]');
  const inTree = tree !== null && tree.contains(document.activeElement);
  if (file !== undefined && !inTree) {
    reveal.update(tab, (last) => ({ key: file, count: (last?.count ?? 0) + 1 }));
  }
}

/**
 * Shows a file the tree asks for, by key, in `tab`: the diff scrolls to a changed one, the
 * whole-file view opens any.
 */
export type ShowFile = (tab: string, file: string) => void;

/** The views that show files: the diff, and the whole-file view. */
export type FileView = 'diff' | 'whole';

const showers = new Map<FileView, ShowFile[]>();

/**
 * Makes `show` how `view` shows a file the tree asks for: `⏎` on a changed file asks the diff,
 * "Whole file" asks the whole-file view. The newest view to ask is the one that shows. Returns a
 * function that takes it back, for when the view goes.
 */
export function onShowFile(view: FileView, show: ShowFile): () => void {
  const list = showers.get(view) ?? [];
  showers.set(view, [...list, show]);
  return () => {
    showers.set(
      view,
      (showers.get(view) ?? []).filter((each) => each !== show),
    );
  };
}

/** Whether a view can show the tree's files now. */
export function canShow(view: FileView): boolean {
  return (showers.get(view)?.length ?? 0) > 0;
}

/** Shows `file` in `view`, if a view can: returns whether one did. */
export function showFile(view: FileView, tab: string, file: string): boolean {
  const show = showers.get(view)?.at(-1);
  if (!show) return false;
  show(tab, file);
  return true;
}
