// Each pull request's tab's diff in the window: its loader, made the first time anything asks for
// it, fed what main says, and stopped as the tab closes; the view drawn of it while the diff is on
// screen, which the keys act on; and what it shows once it's drawn again, when something asks for
// a place in it while another middle view is on screen.

import type { Target } from '@lo/ui/commands';
import type { DiffView } from '@lo/ui/code';
import { useCallback, useSyncExternalStore } from 'react';

import { orderIn, orderModeOf } from '../../tree/window/shared.ts';
import type { DiffState } from '../contract.ts';
import { Loader, type Snapshot } from './loader.ts';
import { diffJobs, main } from './main.ts';

const loaders = new Map<string, Loader>();

/** Places to show in each tab's diff once it's drawn: see {@link revealWhenDrawn}. */
const reveals = new Map<string, Reveal>();

/** The diff of tab `id`, its loader made and told what main has the first time it's asked for. */
export function loaderOf(id: string): Loader {
  let loader = loaders.get(id);
  if (loader) return loader;
  const made = new Loader({
    texts: (input) => main().texts({ id, ...input }),
    files: (input, signal) => diffJobs().files(input, { signal }),
    moves: (input, signal) => diffJobs().moves(input, { signal }),
    highlight: (input, signal) => diffJobs().highlight(input, { signal }),
    order: (changes) => orderIn(changes, orderModeOf(id)),
    log: (message, error) => console.error(message, error),
  });
  loader = made;
  loaders.set(id, made);
  main()
    .versions({ id })
    .then((state) => {
      // Unless what the topic said came first, and is newer.
      if (state && !made.snapshot().state) made.take(state);
    })
    .catch((error: unknown) => console.error("Lo couldn't ask about a tab's diff:", error));
  return made;
}

/** What `loader` has to draw, re-rendering when it changes. */
export function useSnapshot(loader: Loader): Snapshot {
  const subscribe = useCallback((listener: () => void) => loader.subscribe(listener), [loader]);
  return useSyncExternalStore(subscribe, () => loader.snapshot());
}

/** Takes what main says of a tab's diff. */
export function takeState(state: DiffState): void {
  loaderOf(state.id).take(state);
}

/** Stops the diffs of tabs that closed: those not in `open`. */
export function keepOnly(open: ReadonlySet<string>): void {
  for (const [id, loader] of loaders) {
    if (open.has(id)) continue;
    loader.stop();
    loaders.delete(id);
  }
  for (const id of reveals.keys()) if (!open.has(id)) reveals.delete(id);
}

/** A diff view drawn for a tab, while the tab is on screen. */
export interface Drawn {
  readonly view: DiffView;
  readonly loader: Loader;
  /** The pull request it shows. */
  readonly pull: { owner: string; repo: string; number: number };
  /** The reader opened or closed a file: how it starts out is theirs to say now. */
  acted(file: string): void;
}

const drawn = new Map<string, Drawn>();

/** The view drawn for tab `id`, if it's drawn. */
export function drawnFor(id: string): Drawn | undefined {
  return drawn.get(id);
}

/** Records the view drawn for tab `id`. Returns a function that forgets it, as it goes. */
export function setDrawn(id: string, view: Drawn): () => void {
  drawn.set(id, view);
  return () => {
    if (drawn.get(id) === view) drawn.delete(id);
  };
}

/** A place to show in a tab's diff once it's drawn, and whether focus goes there too. */
export interface Reveal {
  readonly target: Target;
  readonly focus: boolean;
}

/**
 * Shows `reveal`'s place in tab `id`'s diff once it's drawn: for a place asked for while another
 * middle view is on screen, such as `⌃o` back from a whole file. The newest asked for wins.
 */
export function revealWhenDrawn(id: string, reveal: Reveal): void {
  reveals.set(id, reveal);
}

/** The place to show in tab `id`'s diff as it's drawn, if one was asked for, once. */
export function takeReveal(id: string): Reveal | undefined {
  const reveal = reveals.get(id);
  reveals.delete(id);
  return reveal;
}
