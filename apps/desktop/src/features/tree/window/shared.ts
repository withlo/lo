// What the file tree shares with other features' window code: the order it lists the changed files
// in, which the diff shows them in; the file on screen, which the diff says as it scrolls and the
// tree follows; going to the tree, at the file on screen; the views that show a file the tree asks
// for; the path a file's key names; and the file finder, opened on a name.

import { useTabState } from '../../tab/window/shared.ts';
import type { Changed, TreePath, TreeState } from '../contract.ts';
import { foldersOf, panelOrder, type Mode } from './model.ts';
import { keyOf, pathOfKey } from './paths.ts';
import { choices, focus, onScreen, picked, reveal, shown, states } from './store.ts';

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
 * path's digest doesn't hold its path, but the row, the change or the file finder's answer it names
 * does, as main sent it.
 */
export function pathOf(tab: string, key: string): TreePath {
  if (!key.startsWith('\0#') && !key.startsWith('\0~')) return pathOfKey(key);
  const row = shown.get(tab)?.rows.find((each) => each.key === key);
  if (row !== undefined && row.kind !== 'group') return row.path;
  const change = states.get(tab)?.changes?.find((each) => keyOf(each.path) === key);
  return change?.path ?? picked.get(tab).get(key) ?? pathOfKey(key);
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

/** Puts the keyboard on `key`'s row in `tab`'s tree, and scrolls to it. */
export function focusRow(tab: string, key: string): void {
  focus.set(tab, key);
  reveal.update(tab, (last) => ({ key, count: (last?.count ?? 0) + 1 }));
}

/** Puts the tree's keyboard row on the file `key`, opening the folders it's in and scrolling to it. */
export function revealFile(tab: string, key: string): void {
  choices.update(tab, (current) => {
    const opened = new Set(current.opened);
    const closed = new Set(current.closed);
    for (const folder of foldersOf(pathOf(tab, key))) {
      opened.add(folder);
      closed.delete(folder);
    }
    return { ...current, opened, closed };
  });
  focusRow(tab, key);
}

/**
 * Gives the file tree focus, its keyboard on the file on screen in `tab`, with the folders it's in
 * open, as `-` does from a code view and, in the tree, when there's no stack above it to go up to.
 */
export function goToTree(tab: string): void {
  const key = onScreen.get(tab) ?? focus.get(tab);
  if (key !== undefined) revealFile(tab, key);
  const tree = document.querySelector('[data-lo-scope="tree"]');
  if (tree instanceof HTMLElement) tree.focus();
}

/**
 * Shows a file the tree asks for, by key, in `tab`: the diff scrolls to a changed one, the
 * whole-file view opens any. `path` is the file's whole path, as main sent it, which a key made of
 * a long path's digest doesn't hold.
 */
export type ShowFile = (tab: string, file: string, path: TreePath) => void;

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
  show(tab, file, pathOf(tab, file));
  return true;
}

/** How the file finder opens with a name typed, once the tree's window feature has said. */
let finding: ((name: string) => void) | undefined;

/**
 * Makes `open` how {@link findFile} opens the file finder, as the tree's window feature does when
 * it starts. Returns a function that takes it back.
 */
export function onFindFile(open: (name: string) => void): () => void {
  finding = open;
  return () => {
    if (finding === open) finding = undefined;
  };
}

/**
 * Opens the file finder (`⌘P`) over the pull request's tab on screen with `name` typed, as a
 * reference to a file that isn't there offers to find a file of its name.
 */
export function findFile(name: string): void {
  finding?.(name);
}
