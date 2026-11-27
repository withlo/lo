// How the middle of a pull request's tab waits while there's nothing to draw in it: the mark
// melding over one line that names the wait. It's the example of a view with nothing to draw yet.
// A view whose shape is known waits as a skeleton instead, and a control at work is busy.
//
// A tab that's opening is one wait, whichever view draws it: the tab before it has a view, the
// overview while it chooses what to open on, the diff until its files are drawn. Each draws this,
// and each takes the wait up where the last left it: the mark keeps going round where it was on
// screen, and only its line changes, swapping in what the view reads. With the code beside, while
// both views wait, the tab draws one of them across the middle, so it's one wait there too.

import { Loading, LOADING_DELAY_MS } from '@lo/ui';
import { keyLabels } from '@lo/ui/commands';
import {
  createContext,
  use,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from 'react';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';

import { registry, useKeys } from '../../../window/commands/registry.ts';
import { blocked } from './banners.ts';
import { main } from './main.ts';
import { pullsStore } from './store.ts';

/**
 * A tab's wait: when it began, how many placeholders draw it now, the line it showed last, and
 * where on screen its mark came, to stay.
 */
interface Wait {
  readonly since: number;
  drawn: number;
  /** Ends it, once nothing has drawn it for a moment. */
  over?: ReturnType<typeof setTimeout> | undefined;
  /** The line it showed last, for the next view to swap its own in over. */
  line?: string | undefined;
  /** The middle of the box it was drawn in as its mark came, in window pixels from the top. */
  at?: number | undefined;
}

const waits = new Map<string, Wait>();

/** The middle view a placeholder is drawn in, by its id, as the tab draws each view. */
export const MiddleViewOf = createContext<string | undefined>(undefined);

/** The middle views each tab has waiting, drawing a placeholder, by tab and view, with how many. */
const waitingViews = createStore<ReadonlyMap<string, ReadonlyMap<string, number>>>()(
  () => new Map(),
);

/** Counts a placeholder in view `view` of tab `tab` in (1) or out (-1). */
function countWaiting(tab: string, view: string, by: 1 | -1): void {
  const all = new Map(waitingViews.getState());
  const views = new Map(all.get(tab));
  const count = (views.get(view) ?? 0) + by;
  if (count > 0) views.set(view, count);
  else views.delete(view);
  if (views.size > 0) all.set(tab, views);
  else all.delete(tab);
  waitingViews.setState(all, true);
}

/** Whether each of `views` in tab `tab` draws only a placeholder, re-rendering as that changes. */
export function useAllWaiting(tab: string, views: readonly string[]): boolean {
  return useStore(waitingViews, (all) => {
    const waiting = all.get(tab);
    return views.length > 0 && views.every((view) => (waiting?.get(view) ?? 0) > 0);
  });
}

/** The room a held mark keeps from its box's edges: enough for it, its line and Cancel. */
const HELD_MARGIN = 72;

/**
 * Tab `tab`'s wait: when it began, as its first placeholder was drawn, and the line it showed
 * before this placeholder was drawn. A placeholder drawn while another draws the wait, or within
 * the moment a quick load shows nothing for after the last one went, as one view gives way to the
 * next, carries on the same wait. One drawn later, as when the tab is read again, begins a new one.
 */
function useWait(tab: string): { since: number; before: string | undefined } {
  const start = () => {
    const wait = waits.get(tab);
    return { tab, since: wait?.since ?? Date.now(), before: wait?.line };
  };
  const [held, setHeld] = useState(start);
  if (held.tab !== tab) setHeld(start());
  const { since } = held;
  // Before the layout of the box is read, so the wait is there to hold the mark's place in.
  useLayoutEffect(() => {
    const wait = waits.get(tab) ?? { since, drawn: 0 };
    clearTimeout(wait.over);
    wait.over = undefined;
    wait.drawn += 1;
    waits.set(tab, wait);
    return () => {
      wait.drawn -= 1;
      if (wait.drawn > 0) return;
      wait.over = setTimeout(() => {
        if (waits.get(tab) === wait) waits.delete(tab);
      }, LOADING_DELAY_MS);
    };
  }, [tab, since]);
  return { since, before: held.before };
}

/**
 * Holds the mark of tab `tab`'s wait where it was on screen as it came, whatever the box it's
 * drawn in does: a view's bar over the next view's box, or a banner coming above the tab's body,
 * moves the box, and the mark stays, as near its place as the box has room for. Until the mark
 * shows, it's in the middle of the box it's in, and that's where it comes. The window resized, it
 * comes back to the middle. Returns the ref for the box.
 */
function useHeldPlace(tab: string): RefObject<HTMLDivElement | null> {
  const box = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = box.current;
    if (!element) return undefined;
    const place = () => {
      const wait = waits.get(tab);
      const loading = element.firstElementChild;
      if (!wait || !(loading instanceof HTMLElement)) return;
      const { top, height } = element.getBoundingClientRect();
      const middle = top + height / 2;
      if (wait.at === undefined || Date.now() - wait.since < LOADING_DELAY_MS) wait.at = middle;
      const room = Math.max(0, height / 2 - HELD_MARGIN);
      const by = Math.min(room, Math.max(-room, wait.at - middle));
      loading.style.translate = by === 0 ? '' : `0 ${by}px`;
    };
    place();
    const recenter = () => {
      const wait = waits.get(tab);
      if (wait) wait.at = undefined;
    };
    window.addEventListener('resize', recenter);
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(place);
    observer?.observe(element);
    return () => {
      window.removeEventListener('resize', recenter);
      observer?.disconnect();
    };
  }, [tab]);
  return box;
}

/** The key that closes a tab now, as this system shows it, if it has one. */
function closeKeys(): string[] | undefined {
  const [first] = registry().keysOf('tab.close');
  return first && keyLabels(first, registry().system);
}

/**
 * What the middle shows until a middle view is there, or has something to draw. Nothing for the
 * wait's first moments, so a pull request that opens at once shows no wait at all. Its line is
 * "Opening pull request…" unless the view that draws it gives its own `status`, for what it reads
 * once the pull request is there. One GitHub hasn't answered for after eight seconds says so. From
 * then it offers to give up, which closes its tab. A tab that can't open draws nothing here: its
 * banner says why, once. A read that fails once the pull request is drawn leaves the wait going, as
 * the header's chip says why: the read tried again may bring what the view waits for.
 */
export function Placeholder({ tab, status }: { tab: string; status?: string | undefined }) {
  const view = useStore(pullsStore, (state) => state.views.get(tab));
  const { since, before } = useWait(tab);
  // The view it's drawn in waits while it's there.
  const middle = use(MiddleViewOf);
  useLayoutEffect(() => {
    if (middle === undefined) return undefined;
    countWaiting(tab, middle, 1);
    return () => countWaiting(tab, middle, -1);
  }, [tab, middle]);
  const box = useHeldPlace(tab);
  const shown = useCallback(
    (line: string) => {
      const wait = waits.get(tab);
      if (wait) wait.line = line;
    },
    [tab],
  );
  useKeys();
  const waiting = !blocked(view);
  return (
    <div ref={box} className="h-full" data-lo-placeholder aria-busy={waiting || undefined}>
      {waiting && (
        <Loading
          since={since}
          before={before}
          onLine={shown}
          status={status ?? 'Opening pull request…'}
          // With its header there, or a view reading what came with it, GitHub has answered, and
          // what's left is Lo's own work.
          slow={view?.header || status !== undefined ? undefined : 'Waiting for GitHub…'}
          onCancel={() => {
            main()
              .close({ id: tab })
              .catch((error: unknown) => console.error("The tab didn't close:", error));
          }}
          cancelKeys={closeKeys()}
        />
      )}
    </div>
  );
}
