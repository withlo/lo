// The threads panel in the window: what it lists, one filter for the whole window; for each view,
// the thread the keyboard is on and the one last shown; and what its keys and clicks do. `j` and
// `k` move, `f` steps through the filters, and `⏎` or a click shows a thread in the diff: opened,
// at the top of the screen, as a jump. A thread the diff on screen doesn't show, as an outdated
// one, shows in the whole diff of the revision it's on, which Lo compares first. A file's own
// thread shows its file's header.

import { DEFAULT_PANEL_FILTER, place, type PanelFilter } from '@lo/review';
import type { ThreadListGroup } from '@lo/ui';
import type { Target } from '@lo/ui/commands';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';

import { IpcError } from '../../../ipc/contract.ts';
import { notify } from '../../../window/commands/notices.tsx';
import { diffStateOf, showThread as showInDiff } from '../../diff/window/shared.ts';
import { activeTab, pullOf, tabState, type PullTab } from '../../tab/window/shared.ts';
import { fileOrder, showFile } from '../../tree/window/shared.ts';
import type { ComparisonView } from '../../revisions/contract.ts';
import type { ThreadRow, ThreadsView } from '../contract.ts';
import { focusedIn, nextFilter, rowKeys, stepRow, threadGroups } from './list.ts';
import { screenOf, threadOf } from './placing.ts';
import { labelIn, revisions, revisionViews } from './revisions.ts';
import { held } from './threads.ts';

/** What the panel lists, the same in every tab: the unresolved threads until the reader asks. */
export const filterStore = createStore<{ readonly filter: PanelFilter }>()(() => ({
  filter: DEFAULT_PANEL_FILTER,
}));

/** What the panel lists, re-rendering when the reader changes it. */
export function useFilter(): PanelFilter {
  return useStore(filterStore, (state) => state.filter);
}

/** Lists what `filter` says. */
export function setFilter(filter: PanelFilter): void {
  filterStore.setState({ filter });
}

/** `f`: lists the next filter's threads, round the end. */
export function stepFilter(): void {
  setFilter(nextFilter(filterStore.getState().filter));
}

/** The thread the keyboard is on in each view's panel: the first listed until the reader moves. */
export const focusedRows = tabState<string | undefined>(() => undefined);

/** The thread each view's panel last showed in the diff: the one on screen. */
export const shownRows = tabState<string | undefined>(() => undefined);

/** What the panel says when it lists nothing, for what main last sent of a view's threads. */
export function emptyText(threads: ThreadsView | undefined, filter: PanelFilter): string {
  const status = threads?.status;
  switch (status) {
    case undefined:
    case 'loading':
      return 'Reading the review threads…';
    case 'run':
      return 'A run has no threads. Show one of its layers to see them.';
    case 'signIn':
      return 'Sign in to see comments.';
    case 'failed':
      return `The review threads didn’t load. ${threads?.problem ?? ''}`.trim();
    case 'ready':
      switch (filter) {
        case 'unresolved':
          return 'No unresolved threads.';
        case 'all':
          return 'No review threads yet.';
        case 'yours':
          return 'You haven’t started or replied in a thread.';
        default:
          filter satisfies never;
          return '';
      }
    default:
      status satisfies never;
      return '';
  }
}

/** The reader's login in view `view`: none for a tab acting as nobody. */
export function viewerOf(view: string): string | undefined {
  const acting = pullOf(view)?.acting;
  return acting?.kind === 'account' ? acting.login : undefined;
}

/** The threads view `view`'s panel can list: none until they're read, and none in a run. */
export function listable(threads: ThreadsView | undefined): readonly ThreadRow[] {
  return threads?.status === 'ready' ? threads.threads : [];
}

/** The groups view `view`'s panel lists now, as `filter` says. */
export function groupsIn(view: string, filter: PanelFilter): ThreadListGroup[] {
  const known = revisionViews.get(view);
  return threadGroups(listable(held.get(view).threads), {
    filter,
    viewer: viewerOf(view),
    order: fileOrder(view),
    label: (head) => labelIn(known, head),
  });
}

/** The pull request's tab on screen, as its view on screen, or why a panel key can't run. */
export function pullOnScreen(): PullTab | string {
  const tab = activeTab();
  return tab?.kind === 'pull' ? tab : 'There’s no pull request on screen.';
}

/** Whether a panel key can run: there's a pull request on screen, or why not. */
export function inPanel(): true | string {
  const tab = pullOnScreen();
  return typeof tab === 'string' ? tab : true;
}

/** `j` (1) and `k` (-1): the keyboard moves a thread on, stopping at the ends. */
export function moveRow(step: 1 | -1): void {
  const tab = pullOnScreen();
  if (typeof tab === 'string') return;
  const keys = rowKeys(groupsIn(tab.id, filterStore.getState().filter));
  const next = stepRow(keys, focusedIn(keys, focusedRows.get(tab.id)), step);
  if (next !== undefined) focusedRows.set(tab.id, next);
}

/** What a key in view `view`'s panel acts on: the thread the keyboard is on, if it's listed. */
export function panelTarget(view: string): Target {
  const keys = rowKeys(groupsIn(view, filterStore.getState().filter));
  const on = focusedIn(keys, focusedRows.get(view));
  return on === undefined ? { kind: 'none' } : { kind: 'thread', thread: on };
}

/** Whether `target` is a thread of the view on screen, or why a command can't act on it. */
export function onThread(target: Target): true | string {
  const tab = pullOnScreen();
  if (typeof tab === 'string') return tab;
  if (target.kind !== 'thread') return 'No thread has focus.';
  return held.get(tab.id).threads?.threads.some((row) => row.id === target.thread)
    ? true
    : 'That thread isn’t on the pull request on screen.';
}

/** What the notes about showing a thread say they're about. */
export const SHOW = 'Show the thread';

/** `⏎` in the panel, or Show the thread in the diff from the palette. */
export function showTarget(target: Target): void {
  const tab = pullOnScreen();
  if (typeof tab === 'string' || target.kind !== 'thread') return;
  showThread(tab, target.thread);
}

/**
 * Shows thread `id` of `tab`'s in the diff, and makes it the panel's thread on screen and the one
 * the keyboard is on: where the diff on screen shows it, there; otherwise in the whole diff of the
 * revision it's on, which is compared first; or says why it can't.
 */
export function showThread(tab: PullTab, id: string): void {
  const row = held.get(tab.id).threads?.threads.find((each) => each.id === id);
  if (!row) return;
  focusedRows.set(tab.id, id);
  shownRows.set(tab.id, id);
  if (shownWhereItIs(tab.id, row)) return;
  const elsewhere = comparisonFor(row, revisionViews.get(tab.id));
  if ('why' in elsewhere) {
    notify(SHOW, elsewhere.why);
    return;
  }
  show(tab.id, row, true);
  revisions()
    .compare({ id: tab.id, from: null, to: elsewhere.head })
    .catch((error: unknown) => {
      notify(
        SHOW,
        error instanceof IpcError ? error.message : 'Lo couldn’t compare it. Try again.',
      );
    });
}

/** Shows `row` in view `view`'s diff, its file's header for a file's own. Says whether it could. */
function show(view: string, row: ThreadRow, wait: boolean): boolean {
  if (row.subject === 'FILE') return showFile('diff', view, row.path);
  return showInDiff(view, row.id, { wait });
}

/**
 * Shows `row` where view `view`'s diff on screen has it, if it does, saying whether it did. Before
 * the diff is drawn, a thread that goes on what it compares shows once it is.
 */
function shownWhereItIs(view: string, row: ThreadRow): boolean {
  const state = diffStateOf(view);
  if (state?.at === null || state?.at === undefined) return show(view, row, false);
  const screen = screenOf(
    {
      at: state.at,
      comparison: state.comparison,
      compareFrom: state.compareFrom,
      files: [],
    },
    held.get(view).threads?.compared ?? null,
  );
  const placed = place(threadOf(row), screen);
  if (placed.kind !== 'lines' && placed.kind !== 'file') return false;
  return show(view, row, false);
}

/**
 * The revision whose whole diff shows `row`, by its head, for a thread the diff on screen doesn't
 * show: the one it was written on, for an outdated thread, and otherwise the one it's on now. Or
 * why there’s none to compare, as `known`, the view’s revisions, say.
 */
export function comparisonFor(
  row: ThreadRow,
  known: ComparisonView | undefined,
): { readonly head: string } | { readonly why: string } {
  const head = row.outdated ? row.writtenOn : (row.currentOn ?? row.writtenOn);
  if (head === null) return { why: 'GitHub no longer has the commit this thread is on.' };
  if (known?.status !== 'ready') {
    return { why: known?.problem ?? 'Lo hasn’t read the pull request’s revisions yet.' };
  }
  const revision = known.revisions.find((each) => each.head === head);
  if (!revision) {
    return { why: 'This thread is on a commit that isn’t one of the pull request’s pushes.' };
  }
  const label = labelIn(known, head) ?? head.slice(0, 7);
  if (!revision.available) return { why: `GitHub no longer has ${label}, so Lo can’t show it.` };
  const now =
    known.pending ??
    known.comparison ??
    (known.shown === null ? null : { from: null, to: known.shown });
  if (now?.from === null && now.to === head) {
    return { why: 'This thread’s lines aren’t in the diff on screen.' };
  }
  return { head };
}
