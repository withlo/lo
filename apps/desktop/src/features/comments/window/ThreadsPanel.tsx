// The threads panel, in a pull request's tab's right panel: every thread of the view on screen, so
// each layer of a stack shows its own, grouped by file in the left panel's order, filtered to the
// unresolved ones, all of them, or yours. The list is the panel's scope, `threads`, and takes focus
// as the panel opens. And the count the header's toggle shows: the unresolved threads, yours not
// yet sent among them.

import { Button, HintButton, Loading, Problem, reveal, ThreadFilter, ThreadList } from '@lo/ui';
import { controlOf, keyLabels, runControl, setScopeSource } from '@lo/ui/commands';
import { useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react';

import { registry, useKeys } from '../../../window/commands/registry.ts';
import { threadsChanged } from '../../diff/window/shared.ts';
import { catchUpRevisions, useRevisions } from '../../revisions/window/shared.ts';
import { usePull, useRun, useTabState, type PullTab } from '../../tab/window/shared.ts';
import { useFileOrder } from '../../tree/window/shared.ts';
import type { ThreadsView } from '../contract.ts';
import { acting as asked, resolvedNow, unshown } from './acts.ts';
import { useExcerpts } from './excerpts.ts';
import { filterCounts, focusedIn, rowKeys } from './list.ts';
import {
  emptyOf,
  focusedRows,
  groupsIn,
  listable,
  moves,
  panelTarget,
  setFilter,
  showThread,
  shownRows,
  useFilter,
  type PanelEmpty,
} from './panel.ts';
import { catchUp, held, listed } from './threads.ts';

/** The first keys `id` has now, as this system shows them, if it has any. */
function keysOf(id: string): string[] | undefined {
  const [first] = registry().keysOf(id);
  return first && keyLabels(first, registry().system);
}

/** A view's unresolved threads, yours not yet sent among them: nothing until they're read. */
export function unresolvedOf(threads: ThreadsView | undefined): number | undefined {
  if (threads?.status !== 'ready') return undefined;
  return threads.threads.filter((row) => !row.resolved).length;
}

/** The header toggle's count: the view on screen's unresolved threads, while it has any. */
export function UnresolvedCount({ tab }: { tab: PullTab }): ReactNode {
  const threads = useTabState(held, tab.id, (value) => value.threads);
  const count = unresolvedOf(threads);
  if (count === undefined || count === 0) return null;
  return (
    <span className="lo-num">
      {count}
      <span className="sr-only"> unresolved</span>
    </span>
  );
}

/** A button that runs command `id`, by its label, as its key would from anywhere. */
function CommandButton({ id }: { id: string }): ReactNode {
  const control = controlOf(id);
  if (!control) return null;
  return (
    <Button size="sm" onClick={() => runControl(id)}>
      {control.label}
    </Button>
  );
}

/**
 * What the panel shows when it lists nothing: the wait for the first read, an empty state's
 * heading with its line and button, or why the read failed.
 */
function Empty({ empty }: { empty: PanelEmpty }): ReactNode {
  switch (empty.kind) {
    case 'reading':
      return (
        <div className="py-24">
          <Loading status="Reading threads…" />
        </div>
      );
    case 'failed':
      return <Problem title="Can’t show the threads" reason={empty.reason} />;
    case 'none':
      return (
        <div className="flex flex-col items-start gap-8">
          <p className="text-fg text-ui-strong">{empty.heading}</p>
          {empty.line !== undefined && <p>{empty.line}</p>}
          {empty.action !== undefined && <CommandButton id={empty.action} />}
        </div>
      );
    default:
      empty satisfies never;
      return null;
  }
}

/** The threads panel of view `tab`, the view on screen. */
export function ThreadsPanel({ tab }: { tab: PullTab }): ReactNode {
  useKeys();
  const view = tab.id;
  // What it lists is main's threads once their openings are read, so no row draws without one.
  const threads = useTabState(listed, view);
  const filter = useFilter();
  const run = useRun(view);
  // What the list reads, so it's drawn again when any of them changes.
  useFileOrder(view);
  useRevisions(view);
  const acting = usePull(view)?.acting;
  const focused = useTabState(focusedRows, view);
  const current = useTabState(shownRows, view);
  const moved = useTabState(moves, view);

  useEffect(() => {
    // A view shown before main said anything of its threads asks main once.
    if (held.get(view).threads === undefined) catchUp(view, () => threadsChanged(view));
    catchUpRevisions(view);
  }, [view]);

  // The openings are read as the threads come, and kept; one that's let go, as the oldest are, is
  // read again.
  const openings = useMemo(
    () => listable(threads).flatMap((row) => (row.comments[0] ? [row.comments[0].body] : [])),
    [threads],
  );
  useExcerpts(openings);
  const groups = groupsIn(view, filter);
  const keys = rowKeys(groups);
  const on = focusedIn(keys, focused);
  const counts = filterCounts(
    listable(threads),
    acting?.kind === 'account' ? acting.login : undefined,
  );

  // Keys in the list act on the thread the keyboard is on.
  const stop = useRef<(() => void) | undefined>(undefined);
  const list = useRef<HTMLDivElement | null>(null);
  const listRef = useCallback(
    (element: HTMLDivElement | null) => {
      list.current = element;
      stop.current?.();
      stop.current = element
        ? setScopeSource(element, { target: () => panelTarget(view) })
        : undefined;
    },
    [view],
  );

  // The thread the keyboard is on stays in view as the keyboard moves it, and only then: the list
  // never scrolls by itself, as when the thread it was on leaves it.
  const scrolled = useRef({ view, moved });
  useEffect(() => {
    const last = scrolled.current;
    scrolled.current = { view, moved };
    if (last.view !== view || last.moved === moved) return;
    const rows = list.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? [];
    const row = [...rows].find((each) => each.dataset['key'] === on);
    // Its own pane scrolls, and nothing else.
    if (row) reveal(row);
  }, [view, moved, on]);

  const filters = keysOf('comments.filterThreads');
  // What the foot's hints act on: the thread the keyboard is on, as their keys do.
  const target = panelTarget(view);
  // Named by what it would do to that thread, as its card shows it: drawn again as a change asked
  // of a thread starts or ends.
  useTabState(asked, view);
  useTabState(unshown, view);
  const onResolved =
    target.kind === 'thread' &&
    listable(threads).some((row) => row.id === target.thread && resolvedNow(view, row));
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-lo-threads={view}>
      {/* The key that opens the panel is on its toggle, not here: it's open already. */}
      <div className="flex flex-none items-center gap-6 ps-16 pe-8 pt-12 pb-8">
        <h2 className="label-caps text-fg-muted text-label">Threads</h2>
      </div>
      <div className="flex flex-none items-center gap-6 ps-12 pe-8 pb-8">
        <ThreadFilter value={filter} counts={counts} onChange={setFilter} keys={filters} />
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <ThreadList
          groups={groups}
          current={current}
          focused={on}
          onShow={(key) => showThread(tab, key)}
          empty={<Empty empty={emptyOf(threads, filter, run?.layers)} />}
          listRef={listRef}
          className="outline-none"
          data-lo-scope="threads"
        />
      </div>
      {/* One line always: the filter's key is on the filter itself, and a narrow foot gives up
          its key chips first, which stay in each hint's tooltip. */}
      <div className="@container flex-none border-t border-border-subtle">
        <div
          data-lo-threads-foot
          className="flex threads-keys min-w-0 items-center gap-2 overflow-hidden px-8 py-4 whitespace-nowrap text-fg-muted text-small"
        >
          <HintButton command="comments.nextThread">Next</HintButton>
          <HintButton command="comments.previousThread">Previous</HintButton>
          {/* "Show in diff" with its key is 31 px wider than the panel's 340: on the panel, "in
              diff" goes, as "thread" does from Next and Previous. */}
          <HintButton command="comments.showThread" target={target}>
            Show
          </HintButton>
          <HintButton command="comments.resolveInPanel" target={target}>
            {onResolved ? 'Unresolve' : 'Resolve'}
          </HintButton>
        </div>
      </div>
    </div>
  );
}
