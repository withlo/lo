// Each pull request's tab's diff in the window: its loader, made the first time anything asks for
// it, fed what main says, and stopped as the tab closes; the view drawn of it while the diff is on
// screen, which the keys act on; and what it shows once it's drawn again, when something asks for
// a place in it while another middle view is on screen.

import type { Target } from '@lo/ui/commands';
import type { DiffView, HeaderTarget, LineTarget } from '@lo/ui/code';
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
  /** The tab it's drawn for. */
  readonly tab: string;
  /** The pull request it shows. */
  readonly pull: { owner: string; repo: string; number: number };
  /** Its files' ids, in the order it shows them. */
  readonly order: readonly string[];
  /** It's one file of the diff beside another view, such as the overview: always inline. */
  readonly beside?: boolean;
  /** The reader opened or closed a file: how it starts out is theirs to say now. */
  acted(file: string): void;
  /**
   * The file a command on `target` acts on, by id: the target's, when it's on screen; else, as when
   * the cursor was scrolled away, the file at the top of the screen.
   */
  fileAt(target: LineTarget | HeaderTarget): string;
  /**
   * The reader marked file `id` viewed (`viewed`), or cleared its mark, here: marked, it closes at
   * once and the cursor goes to `next`'s header, which stays where it is on screen if it's there
   * and otherwise comes to the top; cleared, it opens, and what's on screen stays. Either way how
   * it shows is the reader's from now on.
   */
  viewedHere(id: string, viewed: boolean, next: string | undefined): void;
}

const drawn = new Map<string, Drawn>();

/** The view drawn for tab `id`, if it's drawn. */
export function drawnFor(id: string): Drawn | undefined {
  return drawn.get(id);
}

/** A file of a tab's diff drawn beside another view, and whether an element is in it. */
export interface Beside {
  readonly drawn: Drawn;
  holds(element: Element | null): boolean;
}

const besides = new Map<string, Beside>();

/** Records a file of tab `id`'s diff drawn beside another view. Returns a function that forgets it. */
export function setBeside(id: string, beside: Beside): () => void {
  besides.set(id, beside);
  return () => {
    if (besides.get(id) === beside) besides.delete(id);
  };
}

/**
 * The diff the keys act on in tab `id`: a file beside another view while focus is in it, otherwise
 * the diff drawn, if it is.
 */
export function keysDiff(id: string): Drawn | undefined {
  const beside = besides.get(id);
  if (beside?.holds(document.activeElement)) return beside.drawn;
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
