// What the tree's keys and clicks do to a tab's tree: move the keyboard's row, open and close
// folders, show a file, mark it viewed, and the file's menu. They act on what the tree last showed.

import { notify } from '../../../window/commands/notices.tsx';
import { passedOver, toggleViewed, viewedMarksOf } from '../../revisions/window/shared.ts';
import { activeTab, type PullTab } from '../../tab/window/shared.ts';
import { canShow, focusRow, pathOf, revealFile, showFile } from './shared.ts';
import { parentRow, rowAt, type Row } from './model.ts';
import { addressPath, keyOf } from './paths.ts';
import { choices, focus, onScreen, setOpen, shown, states } from './store.ts';

/** The pull request's tab on screen, or why a key for the tree can't run. */
export function pullOnScreen(): PullTab | string {
  const tab = activeTab();
  return tab?.kind === 'pull' ? tab : 'There’s no pull request on screen.';
}

/** The rows the tree last showed of `tab`. */
function rowsOf(tab: string): readonly Row[] {
  return shown.get(tab)?.rows ?? [];
}

/** The row the keyboard is on, its place among the rows, or where to start: the file on screen. */
function focusedIndex(tab: string): number {
  const rows = rowsOf(tab);
  const at = rowAt(rows, focus.get(tab));
  if (at >= 0) return at;
  return rowAt(rows, onScreen.get(tab));
}

/** Moves the keyboard `step` rows, past the groups' labels, stopping at the ends. */
export function move(tab: string, step: 1 | -1): void {
  const rows = rowsOf(tab);
  let at = focusedIndex(tab);
  if (at < 0) at = step > 0 ? -1 : rows.length;
  for (let next = at + step; next >= 0 && next < rows.length; next += step) {
    const row = rows[next];
    if (row && row.kind !== 'group') {
      focusRow(tab, row.key);
      return;
    }
  }
}

/** Opens the folder the keyboard is on, or on an open one goes to what's in it. */
export function openRow(tab: string): void {
  const rows = rowsOf(tab);
  const at = focusedIndex(tab);
  const row = rows[at];
  if (row?.kind !== 'folder') return;
  if (!row.open) {
    setOpen(tab, row.key, true);
    return;
  }
  const inside = rows[at + 1];
  if (inside && inside.kind !== 'group' && inside.depth > row.depth) focusRow(tab, inside.key);
}

/** Closes the folder the keyboard is on, or goes to the folder its row is in. */
export function closeRow(tab: string): void {
  const rows = rowsOf(tab);
  const at = focusedIndex(tab);
  const row = rows[at];
  if (row?.kind === 'folder' && row.open) {
    setOpen(tab, row.key, false);
    return;
  }
  const parent = rows[parentRow(rows, at)];
  if (parent) focusRow(tab, parent.key);
}

/** Opens every folder the tree knows of, or closes every one. */
export function setAll(tab: string, open: boolean): void {
  const known = new Set(shown.get(tab)?.folders ?? []);
  choices.update(tab, (current) => ({
    ...current,
    opened: open ? known : new Set(),
    closed: open ? new Set() : known,
  }));
  // A row inside a closed folder no longer shows: the keyboard goes to the outermost one.
  if (!open) {
    const rows = rowsOf(tab);
    let at = focusedIndex(tab);
    for (let parent = parentRow(rows, at); parent >= 0; parent = parentRow(rows, at)) at = parent;
    const outermost = rows[at];
    if (outermost) focusRow(tab, outermost.key);
  }
}

/** A changed file of `tab`'s, by key. */
function changeOf(tab: string, key: string) {
  return states.get(tab)?.changes?.find((change) => keyOf(change.path) === key);
}

/** Why `key` can't be marked viewed, or `true`: only a changed file has a mark. */
export function markable(tab: string, key: string): true | string {
  return changeOf(tab, key) ? true : 'Only a changed file has a viewed mark.';
}

/**
 * `e` on the file `key`: marks it viewed, or clears its mark. Marking moves the keyboard to the next
 * changed file that isn't viewed, in the panel's order, round the end, past any `e` can't mark.
 */
export function markViewed(tab: string, key: string): void {
  const changes = states.get(tab)?.changes ?? [];
  const byKey = new Map(changes.map((change) => [keyOf(change.path), change]));
  const change = byKey.get(key);
  if (!change) {
    notify('Mark viewed', 'Only a changed file has a viewed mark.');
    return;
  }
  const toggled = toggleViewed(tab, { path: change.path, previous: change.previous });
  if (toggled.kind === 'refused') {
    notify('Mark viewed', toggled.why);
    return;
  }
  if (toggled.kind !== 'marking') return;
  // Read after the toggle, so the file just marked counts as viewed.
  const marks = viewedMarksOf(tab);
  const order = shown.get(tab)?.order ?? [];
  const from = order.indexOf(key);
  if (from < 0) return;
  for (let step = 1; step < order.length; step++) {
    const next = order[(from + step) % order.length];
    const other = next === undefined ? undefined : byKey.get(next);
    if (next !== undefined && other && !passedOver(marks, other.path, other.previous)) {
      revealFile(tab, next);
      return;
    }
  }
}

/** Why the file `key` can't be shown, or `true`: a changed file in the diff, any whole. */
export function showable(tab: string, key: string): true | string {
  if (changeOf(tab, key)) {
    return canShow('diff') || 'There’s no diff on screen to show it in.';
  }
  return canShow('whole') || 'Lo has no whole-file view to open it in.';
}

/**
 * Shows the file `key`: a changed file in the diff, an unchanged one whole. On a folder, opens or
 * closes it.
 */
export function show(tab: string, key: string): void {
  const row = rowsOf(tab).find((each) => each.key === key);
  if (row?.kind === 'folder') {
    setOpen(tab, row.key, !row.open);
    return;
  }
  focus.set(tab, key);
  if (changeOf(tab, key)) showFile('diff', tab, key);
  else showFile('whole', tab, key);
}

/** Why `key` can't be opened whole, or `true`. */
export function wholeShowable(): true | string {
  return canShow('whole') || 'Lo has no whole-file view to open it in.';
}

/** The key of the row the keyboard is on, if it's a file's. */
export function focusedFile(tab: string): string | undefined {
  const row = rowsOf(tab)[focusedIndex(tab)];
  return row?.kind === 'file' ? row.key : undefined;
}

/** Whether the tree is on screen to go to. */
export function treeShown(): true | string {
  return document.querySelector('[data-lo-scope="tree"]') !== null
    ? true
    : 'The file tree isn’t open.';
}

/**
 * The page on github.com for `key`: a changed file in the pull request's changes, any other at the
 * head on screen.
 */
export async function githubPage(tab: PullTab, key: string): Promise<string> {
  const base = `https://github.com/${tab.owner}/${tab.repo}`;
  const path = pathOf(tab.id, key);
  const change = changeOf(tab.id, key);
  if (change) {
    const files = `${base}/pull/${tab.number}/files`;
    const digest = await sha256(path.hex === undefined ? path.text : undefined);
    return digest === undefined ? files : `${files}#diff-${digest}`;
  }
  const at = states.get(tab.id)?.at;
  return at ? `${base}/blob/${at}/${addressPath(path)}` : `${base}/pull/${tab.number}/files`;
}

/** The SHA-256 of `text` in hex, as GitHub names a file's place in a pull request's changes. */
async function sha256(text: string | undefined): Promise<string | undefined> {
  if (text === undefined || typeof crypto === 'undefined' || !crypto.subtle) return undefined;
  try {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(
      '',
    );
  } catch {
    return undefined;
  }
}
