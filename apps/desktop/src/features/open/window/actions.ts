// What the Recent list's keys and buttons do: move through it, open a row, open the link on the
// clipboard, and go to the filter.

import { IpcError } from '../../../ipc/contract.ts';
import { notify, refuse } from '../../../window/commands/notices.tsx';
import type { Opened, RecentPull } from '../contract.ts';
import { main } from './main.ts';
import { chosenRow, filterRecent, recentStore, rowKey, rowLink, stepRow } from './rows.ts';
import { isNotPull, notPullLine, refusalReason } from './words.ts';

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

/**
 * Says why opening a link did nothing, when it did: that it isn't a pull request link, for text
 * that isn't one; else what failed, `title`, and why; or, with no link at all, the reason alone.
 */
export function said(title: string, done: Opened): void {
  if (done.kind !== 'refused') return;
  if (done.why === 'empty') refuse('No link to open');
  else if (isNotPull(done.why)) notify('Not a pull request link', notPullLine(done.why) ?? '');
  else notify(title, refusalReason(done.why) ?? '');
}

/** What main said went wrong, as it came, when it said, for Details. */
function details(error: unknown): string | undefined {
  return error instanceof IpcError ? error.message : undefined;
}

/** Opens `row`, or the one chosen: with its account while it can see the repository. */
export async function openRow(row?: RecentPull): Promise<void> {
  const opening = row ?? chosenRow(shownRows(), recentStore.getState().chosen);
  if (!opening) {
    refuse('No pull request highlighted');
    return;
  }
  recentStore.setState({ chosen: rowKey(opening) });
  const title = `Couldn’t open #${opening.number}`;
  try {
    said(title, await main().open({ text: rowLink(opening), login: opening.login }));
  } catch (error) {
    console.error("Lo couldn't open the pull request:", error);
    notify(title, '', undefined, details(error));
  }
}

/**
 * Opens `url`, an `https` link followed in a view, such as one in an overview: a pull request in
 * its tab, any other page in the browser. Says why when it opens nothing.
 */
export async function followLink(url: string): Promise<void> {
  try {
    said('Couldn’t open the link', await main().open({ text: url }));
  } catch (error) {
    console.error("Lo couldn't open the link:", error);
    notify('Couldn’t open the link', '', undefined, details(error));
  }
}

/** Opens the pull request link on the clipboard, which main reads; or says there's none. */
export async function pasteLink(): Promise<void> {
  try {
    const link = await main().clipboard();
    if (link === null) {
      refuse('No pull request link on the clipboard');
      return;
    }
    said('Couldn’t open the link', await main().open({ text: link }));
  } catch (error) {
    console.error("Lo couldn't open the link on the clipboard:", error);
    notify('Couldn’t open the link', '', undefined, details(error));
  }
}

let filterField: HTMLInputElement | null = null;

/** Where the filter is, while the list shows one. */
export function setFilterField(field: HTMLInputElement | null): void {
  filterField = field;
}

/** Empties the filter, and goes to it, so what's typed next filters again. */
export function clearFilter(): void {
  recentStore.setState({ query: '' });
  filterField?.focus();
}

/** Whether the filter holds anything to clear, or why not. */
export function canClearFilter(): true | string {
  return recentStore.getState().query === '' ? 'The filter is empty' : true;
}

/** Goes to the filter, with what it holds selected; or says there's nothing to filter yet. */
export function focusFilter(): void {
  if (!filterField) {
    refuse('No pull requests to filter');
    return;
  }
  filterField.focus();
  filterField.select();
}
