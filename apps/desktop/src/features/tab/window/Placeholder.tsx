// How the middle of a pull request's tab waits while there's nothing to draw in it: the mark
// melding over one line that names the wait. It's the example of a view with nothing to draw yet.
// A view whose shape is known waits as a skeleton instead, and a control at work is busy.
//
// A tab that's opening is one wait, whichever view draws it: the tab before it has a view, the
// overview while it chooses what to open on, the diff until the pull request is read. Each draws
// this, and each takes the wait up where the last left it.

import { Loading, LOADING_DELAY_MS } from '@lo/ui';
import { useEffect, useState } from 'react';
import { useStore } from 'zustand';

import { main } from './main.ts';
import { pullsStore } from './store.ts';

/** A tab's wait: when it began, and how many placeholders draw it now. */
interface Wait {
  readonly since: number;
  drawn: number;
  /** Ends it, once nothing has drawn it for a moment. */
  over?: ReturnType<typeof setTimeout> | undefined;
}

const waits = new Map<string, Wait>();

/**
 * When tab `tab`'s wait began: as its first placeholder was drawn. A placeholder drawn while
 * another draws the wait, or within the moment a quick load shows nothing for after the last one
 * went, as one view gives way to the next, carries on the same wait. One drawn later, as when the
 * tab is read again, begins a new one.
 */
function useWaitSince(tab: string): number {
  const [held, setHeld] = useState(() => ({ tab, since: waits.get(tab)?.since ?? Date.now() }));
  if (held.tab !== tab) setHeld({ tab, since: waits.get(tab)?.since ?? Date.now() });
  const { since } = held;
  useEffect(() => {
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
  return since;
}

/**
 * What the middle shows until a middle view is there, or has something to draw. Nothing for the
 * wait's first moments, so a pull request that opens at once shows no wait at all. One GitHub
 * hasn't answered for after eight seconds says so, and offers to give up, which closes its tab. A
 * tab that can't open draws nothing here: its banner says why, once.
 */
export function Placeholder({ tab }: { tab: string }) {
  const view = useStore(pullsStore, (state) => state.views.get(tab));
  const since = useWaitSince(tab);
  const waiting = !view?.problem;
  // With its header there, GitHub has answered, and what's left is Lo's own work.
  const unanswered = !view?.header;
  return (
    <div className="h-full" data-lo-placeholder aria-busy={waiting || undefined}>
      {waiting && (
        <Loading
          since={since}
          status="Opening pull request…"
          slow={unanswered ? 'Waiting for GitHub…' : undefined}
          onCancel={
            unanswered
              ? () => {
                  main()
                    .close({ id: tab })
                    .catch((error: unknown) => console.error("The tab didn't close:", error));
                }
              : undefined
          }
        />
      )}
    </div>
  );
}
