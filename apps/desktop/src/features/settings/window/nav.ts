// Moving between Settings' groups, and to its search, by key, and what the search holds, which
// "Clear search" empties. The page that's open says how; with none open, the keys have nowhere to
// go.

import { createStore } from 'zustand/vanilla';

let mover: ((step: 1 | -1) => void) | undefined;
let searcher: (() => void) | undefined;

/** Makes `move` what the keys do. Returns a function that takes it back, for when the page goes. */
export function onMoveSection(move: (step: 1 | -1) => void): () => void {
  mover = move;
  return () => {
    if (mover === move) mover = undefined;
  };
}

/** Whether a page is open to move in. */
export function canMoveSection(): boolean {
  return mover !== undefined;
}

/** Goes to the next group, or the previous. */
export function moveSection(step: 1 | -1): void {
  mover?.(step);
}

/** Makes `go` what the search key does. Returns a function that takes it back. */
export function onSearch(go: () => void): () => void {
  searcher = go;
  return () => {
    if (searcher === go) searcher = undefined;
  };
}

/** Goes to the search field, when a page is open. */
export function search(): void {
  searcher?.();
}

/** What Settings' search holds: what the page filters its rows by, while it's open. */
export const searchStore = createStore<{ readonly query: string }>()(() => ({ query: '' }));

/** Whether the search holds something to clear, or why not. */
export function canClearSearch(): true | string {
  return searchStore.getState().query.trim() === '' ? 'The search is empty' : true;
}

/** Empties the search, and goes to it, so what's typed next searches again. */
export function clearSearch(): void {
  searchStore.setState({ query: '' });
  searcher?.();
}
