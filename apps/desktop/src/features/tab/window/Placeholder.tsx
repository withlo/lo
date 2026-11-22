// How the middle of a pull request's tab waits while there's nothing to draw in it: the mark
// melding over one line that names the wait. It's the example of a view with nothing to draw yet.
// A view whose shape is known waits as a skeleton instead, and a control at work is busy.

import { Loading } from '@lo/ui';
import { useStore } from 'zustand';

import { main } from './main.ts';
import { pullsStore } from './store.ts';

/**
 * What the middle shows until a middle view is there, or has something to draw. Nothing for its
 * first moments, so a pull request that opens at once shows no wait at all. One GitHub hasn't
 * answered for after eight seconds says so, and offers to give up, which closes its tab. A tab that
 * can't open draws nothing here: its banner says why, once.
 */
export function Placeholder({ tab }: { tab: string }) {
  const view = useStore(pullsStore, (state) => state.views.get(tab));
  // With its header there, GitHub has answered, and what's left is Lo's own work.
  const unanswered = !view?.header;
  return (
    <div className="h-full" data-lo-placeholder>
      {!view?.problem && (
        <Loading
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
