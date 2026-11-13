// What the tree's keys and clicks do to a tab's tree: move the keyboard's row, open and close
// folders, show a file, mark it viewed, and the file's menu. They act on what the tree last showed.

import { ROW_HEIGHT } from '@lo/ui';

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

/**
 * Moves the keyboard `count` rows down (`step` 1) or up (-1), past the groups' labels, stopping at
 * the ends.
 */
export function move(tab: string, step: 1 | -1, count = 1): void {
  const rows = rowsOf(tab);
  let at = focusedIndex(tab);
  if (at < 0) at = step > 0 ? -1 : rows.length;
  let landed: Row | undefined;
  let left = count;
  for (let next = at + step; next >= 0 && next < rows.length && left > 0; next += step) {
    const row = rows[next];
    if (row && row.kind !== 'group') {
      landed = row;
      left -= 1;
    }
  }
  if (landed) focusRow(tab, landed.key);
}

/** Moves the keyboard to the first row (`gg`) or the last (`G`), past the groups' labels. */
export function moveToEnd(tab: string, end: 'first' | 'last'): void {
  const rows = rowsOf(tab);
  const row = (end === 'first' ? rows : rows.toReversed()).find((each) => each.kind !== 'group');
  if (row) focusRow(tab, row.key);
}

/** How many rows the tree on screen shows at once, at least one. */
function pageRows(): number {
  const tree = document.querySelector('[data-lo-scope="tree"]');
  const height = tree instanceof HTMLElement ? tree.clientHeight : 0;
  return Math.max(1, Math.floor(height / ROW_HEIGHT) - 1);
}

/** `PgDn` and `PgUp`: moves the keyboard a page of rows, as many as the tree shows less one. */
export function movePage(tab: string, step: 1 | -1): void {
  move(tab, step, pageRows());
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

/** `⏎` on a folder, as a click on it: opens it, or closes an open one. */
export function toggleRow(tab: string): void {
  const row = rowsOf(tab)[focusedIndex(tab)];
  if (row?.kind === 'folder') setOpen(tab, row.key, !row.open);
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
 * With a count, `3e` marks three: `key` first unless it's viewed, then the next that aren't. It
 * clears no mark.
 */
export function markViewed(tab: string, key: string, count = 1): void {
  const changes = states.get(tab)?.changes ?? [];
  const byKey = new Map(changes.map((change) => [keyOf(change.path), change]));
  if (!byKey.has(key)) {
    notify('Mark viewed', 'Only a changed file has a viewed mark.');
    return;
  }
  // Read each time, so a file just marked counts as viewed.
  const done = (other: string): boolean => {
    const change = byKey.get(other);
    return !change || passedOver(viewedMarksOf(tab), change.path, change.previous);
  };
  const order = shown.get(tab)?.order ?? [];
  let at: string | undefined = count > 1 && done(key) ? nextIn(order, key, done) : key;
  for (let left = count; left > 0 && at !== undefined; left--) {
    const change = byKey.get(at);
    if (!change) return;
    const toggled = toggleViewed(tab, { path: change.path, previous: change.previous });
    if (toggled.kind === 'refused') {
      notify('Mark viewed', toggled.why);
      return;
    }
    if (toggled.kind !== 'marking') return;
    at = nextIn(order, at, done);
  }
  if (at !== undefined) revealFile(tab, at);
}

/** The file after `key` in `order` that isn't `done`, round the end, if there's one. */
function nextIn(
  order: readonly string[],
  key: string,
  done: (key: string) => boolean,
): string | undefined {
  const from = order.indexOf(key);
  if (from < 0) return undefined;
  for (let step = 1; step < order.length; step++) {
    const next = order[(from + step) % order.length];
    if (next !== undefined && !done(next)) return next;
  }
  return undefined;
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
