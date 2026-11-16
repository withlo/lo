// What the merge queue's keys do: `gq` from a pull request's tab, and in the queue's tab moving
// between its rows, opening the one the keyboard is on, showing another branch's queue, and opening
// a pull request or the queue on GitHub. A row's right-click menu and the palette do the same for
// the row right-clicked or the one the keyboard is on.

import type { NoTarget, RowTarget, Target } from '@lo/ui/commands';

import { notify } from '../../../window/commands/notices.tsx';
import type { QueueTab } from '../../tab/contract.ts';
import { activeTab, pullOf } from '../../tab/window/shared.ts';
import { main, tabs } from './main.ts';
import { focusedRow, rowsOf, stepRow, type Row } from './rows.ts';
import { focusedRows, queueOf } from './store.ts';

/** Says what went wrong with what `title` asked for. */
function failed(title: string): (error: unknown) => void {
  return (error) => notify(title, error instanceof Error ? error.message : String(error));
}

/**
 * The base branch of the pull request on screen, and its tab's view, for `gq`, or why there's no
 * queue to show: no pull request on screen, not read yet, or a tab that acts as nobody.
 */
function queueFromPull(): { id: string; branch: string } | string {
  const tab = activeTab();
  if (tab?.kind !== 'pull') return 'There’s no pull request on screen.';
  const view = pullOf(tab.id);
  const branch = view?.header?.base.branch;
  if (branch === undefined) return 'Lo hasn’t read this pull request yet.';
  const acting = view?.acting;
  if (acting === null || acting === undefined) {
    return 'Lo is still working out which account this tab uses.';
  }
  if (acting.kind !== 'account') {
    return 'Lo reads a merge queue as a signed-in account. This tab reads without signing in.';
  }
  return { id: tab.id, branch };
}

/** `gq`: whether the merge queue for the pull request on screen's base can be shown. */
export function canShowQueue(): true | string {
  const found = queueFromPull();
  return typeof found === 'string' ? found : true;
}

/** `gq`: shows the merge queue for the pull request on screen's base, in its tab. */
export async function showQueueTab(): Promise<void> {
  const found = queueFromPull();
  if (typeof found === 'string') return;
  await main().show(found).catch(failed('Merge queue'));
}

/** The merge queue's tab on screen, or why a key for one can't run. */
export function queueOnScreen(): QueueTab | string {
  const tab = activeTab();
  return tab?.kind === 'queue' ? tab : 'There’s no merge queue on screen.';
}

/** The rows of the merge queue's tab `tab`, as main last said. */
function rowsIn(tab: string): Row[] {
  return rowsOf(queueOf(tab)?.read);
}

/** The table of the merge queue's tab on screen, while it's drawn, which keys give focus back to. */
let table: { readonly tab: string; readonly element: () => HTMLElement | null } | undefined;

/** Says the table of merge queue tab `tab` is drawn, until the returned function. */
export function setTable(tab: string, element: () => HTMLElement | null): () => void {
  const drawn = { tab, element };
  table = drawn;
  return () => {
    if (table === drawn) table = undefined;
  };
}

/** What a key in a merge queue's tab acts on: the row the keyboard is on, if there's one. */
export function rowTarget(tab: string): Target {
  const row = focusedRow(rowsIn(tab), focusedRows.get(tab));
  return row === undefined ? { kind: 'none' } : { kind: 'row', row: row.key };
}

/** Puts the keyboard on row `key` of merge queue tab `tab`, and brings it on screen. */
export function focusRow(tab: string, key: string): void {
  focusedRows.set(tab, key);
  const element = table?.tab === tab ? table.element() : null;
  if (element && document.activeElement !== element) element.focus({ preventScroll: true });
  requestAnimationFrame(() => {
    const row = element?.querySelector(`[data-key="${CSS.escape(key)}"]`);
    row?.scrollIntoView({ block: 'nearest' });
  });
}

/** `j` and `k`: the next or previous row, staying put at the ends. */
export function move(by: 1 | -1): void {
  const tab = queueOnScreen();
  if (typeof tab === 'string') return;
  const next = stepRow(rowsIn(tab.id), focusedRows.get(tab.id), by);
  if (next) focusRow(tab.id, next.key);
}

/** The row `target` names in the merge queue's tab on screen, with its tab, or why there's none. */
function rowAt(target: RowTarget): { tab: QueueTab; row: Row } | string {
  const tab = queueOnScreen();
  if (typeof tab === 'string') return tab;
  const row = rowsIn(tab.id).find((each) => each.key === target.row);
  return row ? { tab, row } : 'That pull request isn’t in the queue any more.';
}

/**
 * Whether a row's right-click menu lists the queue's row commands: on the queue's own rows only,
 * never on another list's, such as a pull request's timeline.
 */
export function onQueueRow(target: RowTarget | NoTarget): boolean {
  return target.kind !== 'row' || typeof rowAt(target) !== 'string';
}

/** Whether the row `target` names can be opened. */
export function canOpenRow(target: RowTarget): true | string {
  const at = rowAt(target);
  return typeof at === 'string' ? at : true;
}

/** `⏎`: opens the pull request of the row `target` names, as the queue's account. */
export async function openRow(target: RowTarget): Promise<void> {
  const at = rowAt(target);
  if (typeof at === 'string') return;
  await main().open({ id: at.tab.id, number: at.row.number }).catch(failed('Open'));
}

/**
 * Where `gx` goes: the pull request of the row `target` names, or with none, the queue itself, as
 * GitHub gave its page; or why it can't.
 */
function pageOf(target: RowTarget | NoTarget): string {
  if (target.kind === 'row') {
    const at = rowAt(target);
    return typeof at === 'string' ? '' : at.row.url;
  }
  const tab = queueOnScreen();
  if (typeof tab === 'string') return '';
  const read = queueOf(tab.id)?.read;
  return read?.kind === 'queue' ? (read.url ?? '') : '';
}

/** Whether `gx` has a page to open. */
export function canOpenOnGithub(target: RowTarget | NoTarget): true | string {
  if (target.kind === 'row') {
    const at = rowAt(target);
    if (typeof at === 'string') return at;
  }
  return pageOf(target) === '' ? 'Lo hasn’t read this branch’s merge queue.' : true;
}

/** `gx`: opens the pull request, or the queue, on GitHub. */
export async function openOnGithub(target: RowTarget | NoTarget): Promise<void> {
  const url = pageOf(target);
  if (url === '') return;
  await tabs().openExternal({ url }).catch(failed('Open on GitHub'));
}

/** The branches the merge queue's tab on screen can show, and the one it shows, if it can show another. */
function branchesOnScreen(): { tab: QueueTab; names: string[]; at: number } | string {
  const tab = queueOnScreen();
  if (typeof tab === 'string') return tab;
  const names = (queueOf(tab.id)?.branches ?? []).map(({ name }) => name);
  if (names.length < 2) return 'Lo knows of no other branch with a merge queue here.';
  return { tab, names, at: names.indexOf(tab.branch) };
}

/** Whether `Tab` and `⇧Tab` have another branch to show. */
export function canStepBranch(): true | string {
  const found = branchesOnScreen();
  return typeof found === 'string' ? found : true;
}

/** Shows `branch`'s queue in merge queue tab `tab`. */
export async function showBranch(tab: string, branch: string): Promise<void> {
  await main().show({ id: tab, branch }).catch(failed('Show the branch’s queue'));
}

/** `Tab` and `⇧Tab`: the next or previous branch's queue, round the ends. */
export async function stepBranch(by: 1 | -1): Promise<void> {
  const found = branchesOnScreen();
  if (typeof found === 'string') return;
  const { tab, names, at } = found;
  const next = names[(Math.max(0, at) + by + names.length) % names.length];
  if (next !== undefined && next !== tab.branch) await showBranch(tab.id, next);
}
