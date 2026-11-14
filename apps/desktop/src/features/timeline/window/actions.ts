// What the timeline's keys do on the timeline on screen: move between its rows and through the
// links and buttons of the row the keyboard is on, and what a row's buttons do, which its menu and
// the palette offer too, for the row right-clicked or the one the keyboard is on.

import type { RowTarget, Target } from '@lo/ui/commands';

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

/** What a key in the timeline acts on: the row the keyboard is on. */
export function rowTarget(timeline: DrawnTimeline | undefined): Target {
  const row = timeline && focusedRow(timeline);
  return row === undefined ? { kind: 'none' } : { kind: 'row', row: row.key };
}

/** The row `target` names in the timeline on screen, or why there's none. */
function rowAt(target: RowTarget): { timeline: DrawnTimeline; row: Row } | string {
  const timeline = onScreen();
  if (typeof timeline === 'string') return timeline;
  const row = timeline.rows.find((each) => each.key === target.row);
  return row ? { timeline, row } : 'That event isn’t in the timeline any more.';
}

/**
 * A command on a row that only some rows have: it runs `act` on the row `target` names, which it's
 * listed for and enabled on when `has` says why not of it, or nothing.
 */
export function onRow(
  has: (row: Row, timeline: DrawnTimeline) => string | undefined,
  act: (row: Row, timeline: DrawnTimeline) => void | Promise<void>,
) {
  return {
    run: async (target: RowTarget) => {
      const at = rowAt(target);
      if (typeof at !== 'string' && has(at.row, at.timeline) === undefined) {
        await act(at.row, at.timeline);
      }
    },
    enabled: (target: RowTarget): true | string => {
      const at = rowAt(target);
      if (typeof at === 'string') return at;
      return has(at.row, at.timeline) ?? true;
    },
    listed: (target: RowTarget): boolean => {
      const at = rowAt(target);
      return typeof at !== 'string' && has(at.row, at.timeline) === undefined;
    },
  };
}

/** Puts the keyboard on row `key` of `timeline`, and brings it on screen. */
export function focusRow(timeline: DrawnTimeline, key: string): void {
  focusedRows.set(timeline.tab.id, key);
  requestAnimationFrame(() => {
    rowElement(timeline.list(), key)?.scrollIntoView({ block: 'nearest' });
  });
}

/**
 * `j` and `k`: the next or previous row, staying put at the ends, as the app's other lists do. The
 * list takes focus back from a link or button in the row it leaves.
 */
export function move(by: 1 | -1): void {
  const timeline = onScreen();
  if (typeof timeline === 'string') return;
  const at = indexOfFocused(timeline);
  const next = timeline.rows[Math.min(Math.max(at + by, 0), timeline.rows.length - 1)];
  if (next) focusRow(timeline, next.key);
  const list = timeline.list();
  if (list && document.activeElement !== list) list.focus({ preventScroll: true });
}

/** What `Tab` stops at in a row: its links and buttons, as drawn now. */
const STOPS = 'a[href], button, input, select, textarea, [tabindex]';

/** Where an edit of your comment is drawn, in its card: it keeps focus, as a link or button does. */
const EDIT = '[data-lo-timeline="edit"]';

/** Whether `target`, what a click landed on, is in a link or button of a row, or in an edit box. */
export function inStop(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target.closest(EDIT) !== null) return true;
  // The list takes focus itself; a stop is inside one of its rows.
  const stop = target.closest(STOPS);
  return stop !== null && stop.closest('li[data-key]') !== null;
}

/** The links and buttons in `row`, in order, that can take focus now. */
function stopsIn(row: HTMLElement): HTMLElement[] {
  return [...row.querySelectorAll<HTMLElement>(STOPS)].filter(
    (element) =>
      element.tabIndex >= 0 &&
      !(element instanceof HTMLButtonElement && element.disabled) &&
      element.closest('[hidden], [inert]') === null &&
      element.getClientRects().length > 0,
  );
}

/**
 * `Tab` and `⇧Tab`: the next or previous link or button in the row the keyboard is on, round
 * through the list itself, so focus never leaves the row. `Esc`, as in any middle view, gives focus
 * back to the list.
 */
export function nextLink(by: 1 | -1): void {
  const timeline = onScreen();
  if (typeof timeline === 'string') return;
  const list = timeline.list();
  const row = focusedRow(timeline);
  const element = row && rowElement(list, row.key);
  if (!list || !element) return;
  const order = [list, ...stopsIn(element)];
  const at = order.findIndex((each) => each === document.activeElement);
  const next = order[(Math.max(0, at) + by + order.length) % order.length] ?? list;
  next.focus({ preventScroll: true });
  (next === list ? element : next).scrollIntoView({ block: 'nearest' });
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

/** Opens `row` of `tab` on GitHub, as `gx` does. */
export async function openOnGithub(tab: PullTab, row: Row): Promise<void> {
  await tabs().openExternal({ url: linkOf(tab, row) });
}

/** Opens `tab`'s pull request on GitHub, for the older events Lo didn't read. */
export function seeOlder(tab: PullTab): void {
  tabs()
    .openExternal({ url: pullPage(tab) })
    .catch((error: unknown) => console.error("Lo couldn't open GitHub:", error));
}

/** Shows the hidden comment or review `key` in tab `tab`, and its images with it. */
export function showHidden(tab: string, key: string): void {
  shownHidden.update(tab, (shown) => new Set([...shown, key]));
}

/**
 * Shows the hidden comment or review `key` of `timeline`, and puts the keyboard on its row in the
 * list, which takes focus: the "Show comment" that was pressed goes as the comment shows.
 */
export function revealHidden(timeline: DrawnTimeline, key: string): void {
  showHidden(timeline.tab.id, key);
  focusRow(timeline, key);
  timeline.list()?.focus({ preventScroll: true });
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
