// What the Recent list's keys and buttons do: move through it, open a row, open the link on the
// clipboard, and go to the filter.

import { IpcError } from '../../../ipc/contract.ts';
import { notify } from '../../../window/commands/notices.tsx';
import type { Opened, RecentPull } from '../contract.ts';
import { main } from './main.ts';
import { chosenRow, filterRecent, recentStore, rowKey, rowLink, stepRow } from './rows.ts';

/** Asks main for the pull requests opened lately, for the list. */
export async function loadRecent(): Promise<void> {
  try {
    recentStore.setState({ rows: await main().recent() });
  } catch (error) {
    console.error("Lo couldn't list the pull requests opened lately:", error);
    recentStore.setState({ rows: [] });
  }
}

/** The rows the filter shows now. */
export function shownRows(): RecentPull[] {
  const { rows, query } = recentStore.getState();
  return filterRecent(rows ?? [], query);
}

/** Moves the list's choice `step` rows, stopping at the ends. */
export function stepChosen(step: 1 | -1): void {
  const next = stepRow(shownRows(), recentStore.getState().chosen, step);
  if (next) recentStore.setState({ chosen: rowKey(next) });
}

/** Says what opening a link did, when it opened nothing. */
function said(title: string, done: Opened): void {
  if (done.kind === 'refused') notify(title, done.message);
}

/** Opens `row`, or the one chosen: with its account while it can see the repository. */
export async function openRow(row?: RecentPull): Promise<void> {
  const opening = row ?? chosenRow(shownRows(), recentStore.getState().chosen);
  if (!opening) {
    notify('Open the pull request', 'There’s no pull request to open.');
    return;
  }
  recentStore.setState({ chosen: rowKey(opening) });
  try {
    said(
      'Open the pull request',
      await main().open({ text: rowLink(opening), login: opening.login }),
    );
  } catch (error) {
    console.error("Lo couldn't open the pull request:", error);
    notify(
      'Open the pull request',
      error instanceof IpcError ? error.message : "Lo couldn't open it.",
    );
  }
}

/** Opens the pull request link on the clipboard, which main reads; or says there's none. */
export async function pasteLink(): Promise<void> {
  try {
    const link = await main().clipboard();
    if (link === null) {
      notify('Open the link on the clipboard', 'The clipboard holds no link to a pull request.');
      return;
    }
    said('Open the link on the clipboard', await main().open({ text: link }));
  } catch (error) {
    console.error("Lo couldn't open the link on the clipboard:", error);
    notify('Open the link on the clipboard', "Lo couldn't open the link on the clipboard.");
  }
}

let filterField: HTMLInputElement | null = null;

/** Where the filter is, while the list shows one. */
export function setFilterField(field: HTMLInputElement | null): void {
  filterField = field;
}

/** Goes to the filter, with what it holds selected; or says there's nothing to filter yet. */
export function focusFilter(): void {
  if (!filterField) {
    notify('Filter recent pull requests', 'There are no pull requests to filter yet.');
    return;
  }
  filterField.focus();
  filterField.select();
}
