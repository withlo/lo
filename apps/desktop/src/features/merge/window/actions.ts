// What the merge panel's keys do: open it on the pull request on screen, move between its reasons,
// open a reason's page, step through the methods, go to the squash commit's text, and close it,
// going on to the next unresolved conversation when asked.

import type { Target } from '@lo/ui/commands';

import { focusedTarget } from '../../../window/commands/bar.ts';
import { notify } from '../../../window/commands/notices.tsx';
import { focusMiddle, registry } from '../../../window/commands/registry.ts';
import { activeTab, pullOf } from '../../tab/window/shared.ts';
import type { MergeState } from '../contract.ts';
import { main } from './main.ts';
import { panels, statuses } from './store.ts';
import { rowPage, rowsOf, shownMethod, steppedMethod } from './words.ts';

/** Why the panel can't open before the first read of whether it can merge. */
const NO_STATUS_YET = 'Lo is still reading whether it can merge.';

/** The header's merge status, as the right-click menus take it: a row of the merge feature's own. */
export const STATUS_ROW = 'merge/status';

/** A reason of the merge panel, by its key, as the right-click menus take it. */
export function reasonRow(key: string): string {
  return `merge/reason/${key}`;
}

/** The key of the reason `target` names, if it names one. */
function reasonOf(target: Target): string | undefined {
  const prefix = reasonRow('');
  return target.kind === 'row' && target.row.startsWith(prefix)
    ? target.row.slice(prefix.length)
    : undefined;
}

/** Whether a right-click menu on `target` is the header's merge status's. */
export function onStatus(target: Target): boolean {
  return target.kind === 'row' && target.row === STATUS_ROW;
}

/** View `id`'s merge status, for pull request `number`, or why its panel can't open. */
function statusOf(id: string, number: number): { id: string; state: MergeState } | string {
  const view = statuses.getState().views.get(id);
  switch (view?.kind) {
    case undefined:
    case 'loading':
      return NO_STATUS_YET;
    case 'none':
    case 'failed':
      return view.why;
    case 'known':
      if (view.state.verdict === 'merged') return `#${number} is merged.`;
      if (view.state.verdict === 'closed') return `#${number} is closed.`;
      return { id, state: view.state };
    default:
      view satisfies never;
      return NO_STATUS_YET;
  }
}

/** The pull request's view on screen and its merge status, or why the panel can't open. */
function onScreen(): { id: string; state: MergeState } | string {
  const tab = activeTab();
  if (tab?.kind !== 'pull') return 'There’s no pull request on screen.';
  if (tab.run) return 'Show a layer to see whether it can merge.';
  if (pullOf(tab.id)?.acting?.kind === 'anonymous') return 'Sign in to see whether it can merge.';
  return statusOf(tab.id, tab.number);
}

/** The view whose panel is open, with its status. */
export function opened(): { id: string; state: MergeState } | undefined {
  const found = onScreen();
  if (typeof found === 'string' || !panels.get(found.id).open) return undefined;
  return found;
}

/** Whether the merge panel can open on the pull request on screen, or why not. */
export function canOpen(): true | string {
  const found = onScreen();
  return typeof found === 'string' ? found : true;
}

/** Whether the panel is open, or why its keys can't run. */
export function isOpen(): true | string {
  return opened() ? true : 'The merge panel isn’t open.';
}

/**
 * Opens the merge panel on the pull request on screen, or on view `id` of pull request `number`,
 * at its first reason.
 */
export function openPanel(id?: string, number = 0): void {
  const found = id === undefined ? onScreen() : statusOf(id, number);
  if (typeof found === 'string') return;
  const [first] = rowsOf(found.state);
  panels.update(found.id, (panel) => ({ ...panel, open: true, focused: first?.key }));
}

/** Opens or closes view `id`'s merge panel, as a click on the header's status does. */
export function togglePanel(id: string, number: number): void {
  if (panels.get(id).open) closePanel(id);
  else openPanel(id, number);
}

/** Closes view `id`'s merge panel, or the one on screen's. */
export function closePanel(id?: string): void {
  const tab = id ?? activeTab()?.id;
  if (tab !== undefined && panels.get(tab).open) {
    panels.update(tab, (panel) => ({ ...panel, open: false }));
  }
}

/** Moves the keyboard `step` reasons on in the open panel, stopping at either end. */
export function move(step: 1 | -1): void {
  const open = opened();
  if (!open) return;
  const rows = rowsOf(open.state);
  if (rows.length === 0) return;
  const at = rows.findIndex((row) => row.key === panels.get(open.id).focused);
  const next = rows[Math.min(rows.length - 1, Math.max(0, at < 0 ? 0 : at + step))];
  panels.update(open.id, (panel) => ({ ...panel, focused: next?.key }));
}

/**
 * The page of the reason `target` names, else of the one the keyboard is on, with the view it's
 * in, or why there's none.
 */
function pageOf(target: Target): { id: string; page: string } | string {
  const right = reasonOf(target);
  // A reason right-clicked is one of the status on screen's, whether the panel stayed open or not.
  const open = right === undefined ? opened() : onScreen();
  if (!open || typeof open === 'string') return open ?? 'The merge panel isn’t open.';
  const key = right ?? panels.get(open.id).focused;
  const row = rowsOf(open.state).find((each) => each.key === key);
  const page = row && rowPage(row);
  return page === undefined ? 'This reason has no page to open.' : { id: open.id, page };
}

/** Whether the reason right-clicked, or the one the keyboard is on, has a page to open, or why not. */
export function hasPage(target: Target): true | string {
  const found = pageOf(target);
  return typeof found === 'string' ? found : true;
}

/** Whether a right-click menu on `target` lists Open: a reason's, with a page to open. */
export function reasonHasPage(target: Target): boolean {
  return reasonOf(target) !== undefined && hasPage(target) === true;
}

/** Opens `url`, a page view `id`'s status links, in the system's browser. */
export function openPage(id: string, url: string): void {
  main()
    .open({ id, url })
    .catch((error: unknown) =>
      notify('Open the page', error instanceof Error ? error.message : String(error)),
    );
}

/** Opens the page of the reason right-clicked, or the one the keyboard is on. */
export function openReason(target: Target): void {
  const found = pageOf(target);
  if (typeof found !== 'string') openPage(found.id, found.page);
}

/** Whether the methods can be stepped through, or why not. */
export function canStep(): true | string {
  const open = opened();
  if (!open) return 'The merge panel isn’t open.';
  if (open.state.action.kind !== 'merge') return 'There’s no method to choose now.';
  return open.state.action.methods.length > 1 ? true : 'The repository allows one method only.';
}

/** Chooses the method `step` places on from the one shown. */
export function stepMethod(step: 1 | -1): void {
  const open = opened();
  if (!open) return;
  const method = steppedMethod(open.state, panels.get(open.id).method, step);
  if (method !== undefined) panels.update(open.id, (panel) => ({ ...panel, method }));
}

/** The squash commit's fields, while the panel shows them. */
let titleField: HTMLInputElement | null = null;

/** Keeps the squash commit's title field, for `e` to go to. */
export function keepTitleField(field: HTMLInputElement | null): void {
  titleField = field;
}

/** Whether the panel shows the squash commit's text to edit, or why not. */
export function canEdit(): true | string {
  const open = opened();
  if (!open) return 'The merge panel isn’t open.';
  const { state } = open;
  const squashing =
    state.action.kind === 'merge' && shownMethod(state, panels.get(open.id).method) === 'SQUASH';
  return squashing && titleField?.isConnected ? true : 'Only a squash has a commit to edit here.';
}

/** Goes to the squash commit's title. */
export function edit(): void {
  if (titleField?.isConnected) titleField.focus();
}

/** Leaves the commit's fields for the panel's reasons, or the panel itself. */
export function leaveCommit(): void {
  const panel = document.querySelector<HTMLElement>('[data-lo-scope="merge"]');
  const list = panel?.querySelector<HTMLElement>('[role="listbox"], [role="group"]');
  (list ?? panel)?.focus({ preventScroll: true });
}

/** Whether the pull request on screen has an unresolved conversation to go to, or why not. */
export function hasConversation(): true | string {
  const open = opened();
  if (!open) return 'The merge panel isn’t open.';
  return open.state.blockers.some((blocker) => blocker.kind === 'conversations')
    ? true
    : 'No conversation is in the way.';
}

/**
 * Closes the panel and, once it's gone and focus is back where it was, goes to the next unresolved
 * conversation in the middle view.
 */
export function nextConversation(): void {
  const open = opened();
  if (!open) return;
  closePanel(open.id);
  let frames = 0;
  const go = () => {
    frames += 1;
    if (document.querySelector('[data-lo-scope="merge"]') !== null && frames < 60) {
      requestAnimationFrame(go);
      return;
    }
    focusMiddle();
    registry().run('diff.nextThread', focusedTarget());
  };
  requestAnimationFrame(go);
}
