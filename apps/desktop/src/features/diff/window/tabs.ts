// Each pull request's tab's diff in the window: its loader, made the first time anything asks for
// it, fed what main says, and stopped as the tab closes; and the view drawn of it while the tab is
// on screen, which the keys act on.

import type { DiffView } from '@lo/ui/code';

import { fileOrder } from '../../tree/window/shared.ts';
import type { DiffState } from '../contract.ts';
import { Loader } from './loader.ts';
import { diffJobs, main } from './main.ts';

const loaders = new Map<string, Loader>();

/** The diff of tab `id`, its loader made and told what main has the first time it's asked for. */
export function loaderOf(id: string): Loader {
  let loader = loaders.get(id);
  if (loader) return loader;
  const made = new Loader({
    texts: (input) => main().texts({ id, ...input }),
    files: (input, signal) => diffJobs().files(input, { signal }),
    moves: (input, signal) => diffJobs().moves(input, { signal }),
    order: () => fileOrder(id),
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
