// How many review threads the layer on screen has unresolved, which another feature, such as the
// comments, counts from the threads it has of the layer's view: its row in the stack's tree shows
// them as they change, where the other layers' rows show what main read of each layer.

import { useSyncExternalStore } from 'react';

/** What counts the unresolved threads of the views of pull requests' tabs. */
export interface LayerCounter {
  /**
   * How many of view `view`'s review threads are unresolved, once they're read: nothing until then,
   * and for a view that has none to read, such as a run of layers.
   */
  unresolvedIn(view: string): number | undefined;
  /** Calls `listener` when any view's count may have changed. Returns a function that stops it. */
  subscribe(listener: () => void): () => void;
}

let current: { readonly counter: LayerCounter; readonly stop: () => void } | undefined;
const listeners = new Set<() => void>();

function changed(): void {
  for (const listener of listeners) listener();
}

/** Takes `given` as what counts the layers' threads. Returns a function that lets it go. */
export function countWith(given: LayerCounter): () => void {
  current?.stop();
  current = { counter: given, stop: given.subscribe(changed) };
  changed();
  return () => {
    if (current?.counter !== given) return;
    current.stop();
    current = undefined;
    changed();
  };
}

/** How many of view `view`'s threads are unresolved, re-rendering when that changes. */
export function useLayerCount(view: string): number | undefined {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current?.counter.unresolvedIn(view),
  );
}
