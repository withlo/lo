// What the middle of a pull request's tab says while there's nothing to show yet.

import { useStore } from 'zustand';

import { pullsStore } from './store.ts';

/** What the middle says until a middle view is there to show, or has something to. */
export function Placeholder({ tab }: { tab: string }) {
  const view = useStore(pullsStore, (state) => state.views.get(tab));
  return (
    <div className="grid h-full place-items-center p-32 text-center text-fg-muted text-ui">
      <p className="max-w-read-measure">
        {view?.header
          ? 'The diff and the threads will show here.'
          : view?.problem
            ? 'Nothing to show yet.'
            : 'Opening the pull request…'}
      </p>
    </div>
  );
}
