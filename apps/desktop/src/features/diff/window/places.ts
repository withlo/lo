// Where the keys and the tree take a pull request's tab's diff and its whole-file view: a place in
// the tab's history, shown in the view it's in, which comes on screen to show it; a changed file
// the tree shows in the diff; and any file opened whole. Only one middle view is drawn at a time,
// so a place in the other waits for it to be drawn.

import type { Side, Target } from '@lo/ui/commands';

import { here, registry } from '../../../window/commands/registry.ts';
import { showMiddle } from '../../tab/window/shared.ts';
import { fileKey, type TreePath } from '../../tree/contract.ts';
import { onShowFile, pathOf } from '../../tree/window/shared.ts';
import type { Version } from '../contract.ts';
import { keyOf } from './loader.ts';
import { drawnFor, loaderOf, revealWhenDrawn } from './tabs.ts';
import { changeAt, changedIn, DIFF_VIEW, known, opened, versionOf, WHOLE_VIEW } from './whole.ts';

/** How many files have been asked to open whole, so each ask is told from the last. */
let asks = 0;

/**
 * Records where the tab is in the middle view in its history, as a jump does: for the middle
 * changing however it was asked, a click included, so `⌃o` comes back. A command that's a jump
 * has recorded it already, which recording again leaves as it is, and walking the history records
 * nothing.
 */
function leave(): void {
  const from = here();
  if (from) registry().history.record(from);
}

/**
 * Opens the file `key`, at `path`, whole in tab `tab`, in `version` where it has one, with its
 * cursor at `at` when given and the lines `marked` picked out, and brings the whole-file view on
 * screen. Focus goes to it with `focus`, and otherwise only when it's nowhere in particular.
 */
export function openWhole(
  tab: string,
  file: {
    key: string;
    path: TreePath;
    version: Version;
    at?: Target | undefined;
    marked?: { from: number; to: number } | undefined;
    focus: boolean;
  },
): void {
  leave();
  const loader = loaderOf(tab);
  const change = changedIn(loader.snapshot().state?.files, file.key);
  asks += 1;
  known.update(tab, (paths) => new Map(paths).set(file.key, file.path));
  opened.set(tab, {
    key: file.key,
    id: loader.ids.of(file.key),
    path: file.path,
    version: versionOf(change, file.version),
    marked: file.marked,
    ask: { at: file.at, focus: file.focus, count: asks },
  });
  showMiddle(tab, WHOLE_VIEW);
}

/**
 * Shows line `line` of the file at `path`, at the head on screen, in tab `tab`: in the diff, with
 * the cursor on it, when the comparison on screen has the file; otherwise the file whole, at that
 * head, with lines `marked` picked out. Without a line, the file's top. Where the tab was is
 * recorded in its history first, as a jump's place, and focus goes to the code.
 */
export function showPlace(
  tab: string,
  path: string,
  line: number | undefined,
  marked?: { from: number; to: number },
): void {
  leave();
  const loader = loaderOf(tab);
  const change = changeAt(loader.snapshot().state?.files, path);
  if (change) {
    const file = loader.ids.of(keyOf(change));
    const target: Target =
      line === undefined || change.change === 'deleted'
        ? { kind: 'file', file }
        : { kind: 'line', at: { file, side: 'new', line } };
    const drawn = drawnFor(tab);
    if (drawn) {
      drawn.view.reveal(target);
      drawn.view.focus();
      return;
    }
    revealWhenDrawn(tab, { target, focus: true });
    showMiddle(tab, DIFF_VIEW);
    return;
  }
  const whole: TreePath = { text: path };
  const key = fileKey(whole);
  const file = loader.ids.of(key);
  openWhole(tab, {
    key,
    path: whole,
    version: 'new',
    at: line === undefined ? undefined : { kind: 'line', at: { file, side: 'new', line } },
    marked,
    focus: true,
  });
}

/** The whole path of the file `key` names in tab `tab`, as it was opened, the diff has it, or the tree. */
function pathFor(tab: string, key: string): TreePath {
  const change = changedIn(loaderOf(tab).snapshot().state?.files, key);
  return known.get(tab).get(key) ?? change?.path ?? pathOf(tab, key);
}

/** The file and side a place in a code view is on, if it's on one. */
function placeOf(target: Target): { file: string; side: Side } | undefined {
  switch (target.kind) {
    case 'line':
      return { file: target.at.file, side: target.at.side };
    case 'header':
      return { file: target.file, side: target.side };
    case 'file':
      return { file: target.file, side: 'new' };
    case 'thread':
    case 'layer':
    case 'block':
    case 'tab':
    case 'none':
      return undefined;
    default:
      throw new Error(`A target Lo doesn't know: ${JSON.stringify(target satisfies never)}`);
  }
}

/**
 * Shows `target` in tab `tab`'s diff and focuses it: at once if the diff is drawn; otherwise once
 * it's drawn again, if it has the file, bringing it on screen. Says whether it could.
 */
function revealInDiff(tab: string, target: Target): boolean {
  const drawn = drawnFor(tab);
  if (drawn) {
    if (!drawn.view.reveal(target)) return false;
    drawn.view.focus();
    return true;
  }
  const file = placeOf(target)?.file;
  const ready = loaderOf(tab).snapshot().ready;
  if (file === undefined || !ready?.entries.some((entry) => entry.id === file)) return false;
  revealWhenDrawn(tab, { target, focus: true });
  showMiddle(tab, DIFF_VIEW);
  return true;
}

/** Opens `target`'s file whole in tab `tab`, at `target`, and focuses it. */
function revealWhole(tab: string, target: Target): boolean {
  const at = placeOf(target);
  const key = at && loaderOf(tab).ids.keyOf(at.file);
  if (!at || key === undefined) return false;
  openWhole(tab, { key, path: pathFor(tab, key), version: at.side, at: target, focus: true });
  return true;
}

/** The tabs whose history can reveal places in the diff and the whole-file view. */
const registered = new Set<string>();

/**
 * Lets tab `tab`'s history reveal its places in the diff and the whole-file view for as long as
 * the tab is open, whichever of them is on screen: `⌃o` from a whole file goes back to the diff.
 */
export function placesFor(tab: string): void {
  if (registered.has(tab)) return;
  registered.add(tab);
  const { history } = registry();
  history.register(tab, 'diff', (target) => revealInDiff(tab, target));
  history.register(tab, 'file', (target) => revealWhole(tab, target));
}

/** Forgets the tabs that closed, those not in `open`: their history goes with them. */
export function keepPlaces(open: ReadonlySet<string>): void {
  for (const tab of registered) if (!open.has(tab)) registered.delete(tab);
}

/**
 * Shows the files the tree asks for: a changed one in the diff, its header brought on screen with
 * focus staying in the tree, and the diff brought back to show it; any one whole.
 */
export function showTreeFiles(): void {
  onShowFile('diff', (tab, key) => {
    const id = loaderOf(tab).ids.find(key);
    const target = id === undefined ? undefined : ({ kind: 'file', file: id } as const);
    const drawn = drawnFor(tab);
    if (drawn) {
      if (target) drawn.view.reveal(target);
      return;
    }
    leave();
    if (target) revealWhenDrawn(tab, { target, focus: false });
    showMiddle(tab, DIFF_VIEW);
  });
  onShowFile('whole', (tab, key, path) =>
    openWhole(tab, { key, path, version: 'new', focus: false }),
  );
}
