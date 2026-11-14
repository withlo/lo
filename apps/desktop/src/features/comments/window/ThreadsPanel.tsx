// The threads panel, in a pull request's tab's right panel: every thread of the view on screen, so
// each layer of a stack shows its own, grouped by file in the left panel's order, filtered to the
// unresolved ones, all of them, or yours. The list is the panel's scope, `threads`, and takes focus
// as the panel opens. And the count the header's toggle shows: the unresolved threads, yours not
// yet sent among them.

import { Key, PaletteHint, ThreadFilter, ThreadList } from '@lo/ui';
import { keyLabels, setScopeSource } from '@lo/ui/commands';
import { useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react';

import { registry, useKeys } from '../../../window/commands/registry.ts';
import { threadsChanged } from '../../diff/window/shared.ts';
import { catchUpRevisions, useRevisions } from '../../revisions/window/shared.ts';
import { usePull, useTabState, type PullTab } from '../../tab/window/shared.ts';
import { useFileOrder } from '../../tree/window/shared.ts';
import type { ThreadsView } from '../contract.ts';
import { useExcerpts } from './excerpts.ts';
import { filterCounts, focusedIn, rowKeys } from './list.ts';
import {
  emptyText,
  focusedRows,
  groupsIn,
  listable,
  moves,
  panelTarget,
  setFilter,
  showThread,
  shownRows,
  useFilter,
} from './panel.ts';
import { catchUp, held } from './threads.ts';

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

/** The threads panel of view `tab`, the view on screen. */
export function ThreadsPanel({ tab }: { tab: PullTab }): ReactNode {
  useKeys();
  const view = tab.id;
  const threads = useTabState(held, view, (value) => value.threads);
  const filter = useFilter();
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

  // The threads' openings are read in the background, and the rows draw them as they come.
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
    // Not in jsdom, which lays nothing out.
    if (typeof row?.scrollIntoView === 'function') row.scrollIntoView({ block: 'nearest' });
  }, [view, moved, on]);

  const show = keysOf('comments.showThread');
  const next = keysOf('comments.nextThread');
  const previous = keysOf('comments.previousThread');
  const filters = keysOf('comments.filterThreads');
  const resolving = keysOf('comments.resolveInPanel');
  const panelKey = keysOf('tab.rightPanel');
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-lo-threads={view}>
      <div className="flex flex-none items-center gap-6 ps-16 pe-8 pt-12 pb-8">
        <h2 className="label-caps text-fg-muted text-label">Threads</h2>
        {panelKey && (
          <span className="ms-auto">
            <Key keys={panelKey} quiet decorative />
          </span>
        )}
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
          empty={emptyText(threads, filter)}
          listRef={listRef}
          className="outline-none"
          data-lo-scope="threads"
        />
      </div>
      <div className="flex flex-none flex-wrap items-center gap-12 border-t border-border-subtle px-16 py-8 text-fg-muted text-small">
        {next && <PaletteHint keys={next}>Next</PaletteHint>}
        {previous && <PaletteHint keys={previous}>Previous</PaletteHint>}
        {show && <PaletteHint keys={show}>Show</PaletteHint>}
        {resolving && <PaletteHint keys={resolving}>Resolve</PaletteHint>}
        {filters && <PaletteHint keys={filters}>Filter</PaletteHint>}
      </div>
    </div>
  );
}
