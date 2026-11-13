// What the timeline's keys do on the timeline on screen: move between its rows, open the row the
// keyboard is on on GitHub, and the actions a row's buttons take, which the palette offers too.

import { notify } from '../../../window/commands/notices.tsx';
import { showDiff } from '../../diff/window/shared.ts';
import { activeTab, type PullTab } from '../../tab/window/shared.ts';
import type { Row, RevisionMark } from './rows.ts';
import { focusedRows, shownHidden } from './store.ts';
import { revisions, tabs } from './main.ts';

/** The timeline drawn on screen: its tab, its rows, and its list. */
export interface DrawnTimeline {
  readonly tab: PullTab;
  readonly rows: readonly Row[];
  readonly list: () => HTMLOListElement | null;
}

const drawn = new Map<string, DrawnTimeline>();

/** Says the timeline of `timeline.tab` is drawn, for its keys, until the returned function. */
export function setDrawn(timeline: DrawnTimeline): () => void {
  drawn.set(timeline.tab.id, timeline);
  return () => {
    if (drawn.get(timeline.tab.id) === timeline) drawn.delete(timeline.tab.id);
  };
}

/** The timeline on screen, or why a key for it can't run. */
export function onScreen(): DrawnTimeline | string {
  const tab = activeTab();
  if (tab?.kind !== 'pull') return 'There’s no pull request on screen.';
  return drawn.get(tab.id) ?? 'There’s no timeline on screen.';
}

/** The row the keyboard is on in `timeline`: the first, until the reader moves. */
export function focusedRow(timeline: DrawnTimeline): Row | undefined {
  const key = focusedRows.get(timeline.tab.id);
  return timeline.rows.find((row) => row.key === key) ?? timeline.rows[0];
}

/** Where the row the keyboard is on is among `timeline`'s rows. */
function indexOfFocused(timeline: DrawnTimeline): number {
  const row = focusedRow(timeline);
  return row === undefined ? 0 : timeline.rows.indexOf(row);
}

/** The element of the row `key` names in `list`. */
export function rowElement(list: HTMLOListElement | null, key: string): HTMLElement | undefined {
  for (const element of list?.children ?? []) {
    if (element instanceof HTMLElement && element.dataset['key'] === key) return element;
  }
  return undefined;
}

/** Puts the keyboard on row `key` of `timeline`, and brings it on screen. */
export function focusRow(timeline: DrawnTimeline, key: string): void {
  focusedRows.set(timeline.tab.id, key);
  requestAnimationFrame(() => {
    rowElement(timeline.list(), key)?.scrollIntoView({ block: 'nearest' });
  });
}

/** `j` and `k`: the next or previous row, stopping at the ends. */
export function move(by: 1 | -1): void {
  const timeline = onScreen();
  if (typeof timeline === 'string') return;
  const at = indexOfFocused(timeline);
  const next = timeline.rows[Math.min(Math.max(at + by, 0), timeline.rows.length - 1)];
  if (next) focusRow(timeline, next.key);
}

/** Whether there's a row to move to, or why not. */
export function movable(by: 1 | -1): true | string {
  const timeline = onScreen();
  if (typeof timeline === 'string') return timeline;
  const at = indexOfFocused(timeline);
  if (by > 0 && at >= timeline.rows.length - 1) return 'This is the newest event.';
  if (by < 0 && at <= 0) return 'This is the description, the first.';
  return true;
}

/** The pull request's page on GitHub, and the path under it. */
function pullPage(tab: PullTab, under = ''): string {
  return `https://github.com/${tab.owner}/${tab.repo}/pull/${tab.number}${under}`;
}

/** Where row `row` is on GitHub. */
export function linkOf(tab: PullTab, row: Row): string {
  switch (row.kind) {
    case 'comment':
    case 'review':
      return row.url;
    case 'push':
      return pullPage(tab, `/commits/${row.commits.at(-1)?.oid ?? ''}`);
    case 'checks':
      return pullPage(tab, '/checks');
    case 'forcePush':
      return row.before !== undefined && row.after !== undefined
        ? `https://github.com/${tab.owner}/${tab.repo}/compare/${row.before}..${row.after}`
        : pullPage(tab);
    case 'event':
      return row.url ?? pullPage(tab);
    case 'description':
    case 'older':
      return pullPage(tab);
    default:
      row satisfies never;
      return pullPage(tab);
  }
}

/** `gx`: opens the row the keyboard is on on GitHub. */
export async function openOnGithub(): Promise<void> {
  const timeline = onScreen();
  if (typeof timeline === 'string') return;
  const row = focusedRow(timeline);
  if (row) await tabs().openExternal({ url: linkOf(timeline.tab, row) });
}

/** Shows the hidden comment or review `key` in tab `tab`, and its images with it. */
export function showHidden(tab: string, key: string): void {
  shownHidden.update(tab, (shown) => new Set([...shown, key]));
}

/** Whether `row` is a comment or review that's hidden, and not shown yet. */
export function stillHidden(tab: string, row: Row | undefined): boolean {
  if (row?.kind !== 'comment' && row?.kind !== 'review') return false;
  const hidden = row.kind === 'comment' ? row.hidden !== undefined : row.hidden;
  return hidden && !shownHidden.get(tab).has(row.key);
}

/** Compares revision `from` with `to`, as a force-push's "Compare" does, and shows the diff. */
export function compare(tab: string, from: RevisionMark, to: RevisionMark): void {
  showDiff(tab);
  revisions()
    .compare({ id: tab, from: from.head, to: to.head })
    .catch((error: unknown) => {
      notify(
        `Compare r${from.number} → r${to.number}`,
        error instanceof Error ? error.message : String(error),
      );
    });
}
