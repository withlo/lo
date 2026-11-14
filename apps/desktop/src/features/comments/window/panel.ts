// The threads panel in the window: what it lists, one filter for the whole window; for each view,
// the thread the keyboard is on and the one last shown; and what its keys and clicks do. `j` and
// `k` move, `f` steps through the filters, and `⏎` or a click shows a thread in the diff: opened,
// at the top of the screen, as a jump. A thread the diff on screen doesn't show, as an outdated
// one, shows in the whole diff of the revision it's on, which Lo compares first, saying so. The
// last thread asked for is the one shown: a comparison an earlier one asked for that hasn't come
// yet is called off. A file's own thread shows its file's header.

import { DEFAULT_PANEL_FILTER, place, type PanelFilter } from '@lo/review';
import type { ThreadListGroup } from '@lo/ui';
import { keyLabels, type Target } from '@lo/ui/commands';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';

import { notify } from '../../../window/commands/notices.tsx';
import { registry } from '../../../window/commands/registry.ts';
import { diffStateOf, showThread as showInDiff, type ShowWhen } from '../../diff/window/shared.ts';
import {
  comparedIn,
  comparisonComing,
  compareTo,
  revisionLabel,
  revisionsOf,
  sameCompared,
  type Compared,
  type ComparisonView,
} from '../../revisions/window/shared.ts';
import { activeTab, pullOf, tabState, type PullTab } from '../../tab/window/shared.ts';
import { fileOrder, showFile } from '../../tree/window/shared.ts';
import type { ThreadRow, ThreadsView } from '../contract.ts';
import { excerptOf } from './excerpts.ts';
import { focusedIn, nextFilter, rowKeys, stepRow, threadGroups } from './list.ts';
import { screenOf, threadOf } from './placing.ts';
import { held, listed } from './threads.ts';

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

/**
 * How many times the keyboard moved in each view's panel: the list scrolls the thread it's on
 * into view only as it moves, never by itself.
 */
export const moves = tabState<number>(() => 0);

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

/**
 * The threads a view's panel can list: none until they're read, and none in a run. `threads` are
 * those the panel lists (`listed`): main's, once their openings are read.
 */
export function listable(threads: ThreadsView | undefined): readonly ThreadRow[] {
  return threads?.status === 'ready' ? threads.threads : [];
}

/** The groups view `view`'s panel lists now, as `filter` says. */
export function groupsIn(view: string, filter: PanelFilter): ThreadListGroup[] {
  const known = revisionsOf(view);
  return threadGroups(listable(listed.get(view)), {
    filter,
    viewer: viewerOf(view),
    order: fileOrder(view),
    label: (head) => revisionLabel(known, head),
    excerpt: excerptOf,
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
  if (next === undefined) return;
  focusedRows.set(tab.id, next);
  moves.update(tab.id, (count) => count + 1);
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
  const found = threadIn(held.get(tab.id).threads, target.thread);
  return typeof found === 'string' ? found : true;
}

/**
 * What's true of a row the panel lists whose thread main's threads don't hold: it was listed
 * before main sent them again without it, and the list is catching up.
 */
export const GONE = 'That thread has just gone from the pull request. The list is catching up.';

/** Thread `id` in the threads main sent, or why there's none to act on. */
export function threadIn(threads: ThreadsView | undefined, id: string): ThreadRow | string {
  return threads?.threads.find((row) => row.id === id) ?? GONE;
}

/** What the notes about showing a thread say they're about. */
export const SHOW = 'Show the thread';

/** `⏎` in the panel, or Show the thread in the diff from the palette. */
export function showTarget(target: Target): void {
  const tab = pullOnScreen();
  if (typeof tab === 'string' || target.kind !== 'thread') return;
  showThread(tab, target.thread);
}

/** The keys command `id` has first, as this system shows them, if it has any. */
function keyOf(id: string): string | undefined {
  const [first] = registry().keysOf(id);
  return first && keyLabels(first, registry().system).join(' ');
}

/**
 * Shows thread `id` of `tab`'s in the diff, and makes it the panel's thread on screen and the one
 * the keyboard is on, as {@link planShow} decides.
 */
export function showThread(tab: PullTab, id: string): void {
  const row = threadIn(held.get(tab.id).threads, id);
  if (typeof row === 'string') {
    notify(SHOW, row);
    return;
  }
  focusedRows.set(tab.id, id);
  shownRows.set(tab.id, id);
  const here = onScreenNow(tab.id, row);
  // Before the diff is drawn, it shows the thread once it is, if it has it.
  const plan =
    here === undefined ? HERE : planShow(row, here, revisionsOf(tab.id), comparisonComing(tab.id));
  switch (plan.kind) {
    case 'here':
      show(tab.id, row, 'now');
      return;
    case 'callOff':
      compareTo(tab.id, plan.compared, SHOW);
      show(tab.id, row, 'both');
      return;
    case 'coming':
      show(tab.id, row, 'drawn');
      return;
    case 'compare': {
      // The place it leaves goes in the history first, with what's compared now.
      show(tab.id, row, 'drawn');
      const back = keyOf('keys.back');
      // Said as it's asked for, and taken back if a later move calls it off.
      const asked = compareTo(tab.id, plan.compared, SHOW, {
        title: `Comparing base → ${plan.label}`,
        body: `This thread is on ${plan.label}.${back === undefined ? '' : ` ${back} goes back.`}`,
      });
      if (typeof asked !== 'string') notify(SHOW, asked.why);
      return;
    }
    case 'why':
      notify(SHOW, plan.why);
      return;
    default:
      plan satisfies never;
  }
}

/** Shows `row` in view `view`'s diff as `when` says, its file's header for a file's own. */
function show(view: string, row: ThreadRow, when: ShowWhen): boolean {
  if (row.subject === 'FILE') return showFile('diff', view, row.path);
  return showInDiff(view, row.id, when);
}

/**
 * Whether the diff view `view` has on screen, or is drawing, shows `row`: none before it's drawn.
 */
function onScreenNow(view: string, row: ThreadRow): boolean | undefined {
  const state = diffStateOf(view);
  if (state?.at === null || state?.at === undefined) return undefined;
  const screen = screenOf(
    { at: state.at, comparison: state.comparison, compareFrom: state.compareFrom, files: [] },
    held.get(view).threads?.compared ?? null,
  );
  const placed = place(threadOf(row), screen);
  return placed.kind === 'lines' || placed.kind === 'file';
}

/**
 * How `⏎` shows a thread: `here`, in the diff on screen; `callOff`, there too, calling off a
 * comparison that's coming by comparing what's on screen, `compared`, again; `coming`, in the
 * comparison that's coming, once it's drawn; `compare`, in the whole diff of the revision
 * `label`, which `compared` compares, once it's drawn; or `why` not.
 */
export type ShowPlan =
  | { readonly kind: 'here' }
  | { readonly kind: 'callOff'; readonly compared: Compared }
  | { readonly kind: 'coming' }
  | { readonly kind: 'compare'; readonly compared: Compared; readonly label: string }
  | { readonly kind: 'why'; readonly why: string };

const HERE: ShowPlan = { kind: 'here' };

/**
 * How `⏎` shows `row`, which the diff on screen shows or not, `here`, as `known`, the view's
 * revisions, say what's compared, and `coming`, what's compared once what's asked for comes. The
 * last thread asked for wins: a comparison that's coming for an earlier one is called off, or
 * replaced.
 */
export function planShow(
  row: ThreadRow,
  here: boolean,
  known: ComparisonView | undefined,
  coming: Compared | undefined,
): ShowPlan {
  const now = comparedIn(known);
  if (here) return coming && now ? { kind: 'callOff', compared: now } : HERE;
  const elsewhere = comparisonFor(row, known);
  if ('why' in elsewhere) return { kind: 'why', why: elsewhere.why };
  const compared: Compared = { from: null, to: elsewhere.head };
  if (sameCompared(coming, compared)) return { kind: 'coming' };
  if (!coming && sameCompared(now, compared)) {
    return { kind: 'why', why: 'This thread’s lines aren’t in the diff on screen.' };
  }
  return { kind: 'compare', compared, label: elsewhere.label };
}

/**
 * The revision whose whole diff shows `row`, by its head and label, for a thread the diff on
 * screen doesn't show: the one it was written on, for an outdated thread, and otherwise the one
 * it's on now. Or why there’s none to compare, as `known`, the view’s revisions, say.
 */
export function comparisonFor(
  row: ThreadRow,
  known: ComparisonView | undefined,
): { readonly head: string; readonly label: string } | { readonly why: string } {
  const head = row.outdated ? row.writtenOn : (row.currentOn ?? row.writtenOn);
  if (head === null) return { why: 'GitHub no longer has the commit this thread is on.' };
  if (known?.status !== 'ready') {
    return { why: known?.problem ?? 'Lo hasn’t read the pull request’s revisions yet.' };
  }
  const revision = known.revisions.find((each) => each.head === head);
  if (!revision) {
    return { why: 'This thread is on a commit that isn’t one of the pull request’s pushes.' };
  }
  const label = revisionLabel(known, head) ?? head.slice(0, 7);
  if (!revision.available) return { why: `GitHub no longer has ${label}, so Lo can’t show it.` };
  return { head, label };
}
