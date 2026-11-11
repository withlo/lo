// The file finder (`⌘P`): what's in it, what main found for it, and what `⏎` and `⌘⏎` do with the
// file that's highlighted. Main matches the query against the files of the tree on screen, the
// changed ones first; the window lists them, and asks the tree to show the one chosen.

import { createStore } from 'zustand/vanilla';

import { IpcError } from '../../../ipc/contract.ts';
import { focusMiddle, registry } from '../../../window/commands/registry.ts';
import { pullOnScreen, revealFile } from './actions.ts';
import type { Answer, Item } from './found.ts';
import { main } from './main.ts';
import { states } from './store.ts';

export interface FinderState {
  readonly open: boolean;
  /** The pull request's tab it searches, and that pull request's repository, for its label. */
  readonly tab: string | undefined;
  readonly repo: string;
  readonly query: string;
  /** Whether only the changed files are listed. */
  readonly changedOnly: boolean;
  /** What main last found, for the query it was asked: it stays until a newer answer arrives. */
  readonly answer: Answer | undefined;
  /** Why the last search failed. */
  readonly problem: string | undefined;
  /** The key of the file the list has highlighted. */
  readonly highlighted: string | undefined;
}

const closed: FinderState = {
  open: false,
  tab: undefined,
  repo: '',
  query: '',
  changedOnly: false,
  answer: undefined,
  problem: undefined,
  highlighted: undefined,
};

export const finderStore = createStore<FinderState>()(() => closed);

/** The files the list shows now, which the highlighted one is among. */
let listed: readonly Item[] = [];

/** Says which files the list shows, so a key acts only on one that is. */
export function showing(items: readonly Item[]): void {
  listed = items;
}

/** The file the list has highlighted, if it's one the list shows. */
export function highlighted(): Item | undefined {
  const { highlighted: key } = finderStore.getState();
  return key === undefined ? undefined : listed.find((item) => item.id === key);
}

/** The searches begun; only the newest one's answer is kept. */
let searches = 0;

/** Asks main for the files that match what's typed, and keeps its answer unless a newer search began. */
function search(): void {
  const { tab, query } = finderStore.getState();
  if (tab === undefined) return;
  const mine = ++searches;
  main()
    .find({ id: tab, query })
    .then(
      (answer) => {
        if (mine === searches) finderStore.setState({ answer, problem: undefined });
      },
      (error: unknown) => {
        // A newer search took its place, or the tab went: nothing to say.
        if (mine !== searches || (error instanceof IpcError && error.code === 'superseded')) return;
        console.error("Lo couldn't search the files:", error);
        finderStore.setState({ problem: "Lo couldn't search the files." });
      },
    );
}

/** Stops watching the tree for a new commit or new changes. */
let unwatch: (() => void) | undefined;

/** Searches again when the tab's tree moves to another commit or its changes arrive. */
function watch(tab: string): void {
  unwatch?.();
  let seen = states.get(tab);
  unwatch = states.subscribe(() => {
    const now = states.get(tab);
    if (now === seen) return;
    const moved = now?.at !== seen?.at || now?.changes !== seen?.changes;
    seen = now;
    if (moved) search();
  });
}

/** What to do once the finder has closed and given focus back, as a command run from it needs. */
let afterClose: (() => void) | undefined;

/** Opens the finder over the pull request's tab on screen, if there is one. */
export function openFinder(): void {
  const tab = pullOnScreen();
  if (typeof tab === 'string') return;
  afterClose = undefined;
  finderStore.setState({ ...closed, open: true, tab: tab.id, repo: tab.repo });
  watch(tab.id);
  search();
}

/** Whether the finder is open. */
export function finderOpen(): boolean {
  return finderStore.getState().open;
}

/**
 * Closes the finder, then runs `then` once it has closed and focus is back where it was, so a
 * command run from it acts where it would have from its key.
 */
export function closeFinder(then?: () => void): void {
  if (!finderStore.getState().open) return;
  afterClose = then;
  unwatch?.();
  unwatch = undefined;
  // Whatever was still being searched for is no longer wanted.
  searches++;
  finderStore.setState({ open: false });
}

/**
 * The finder has closed, and focus is back where it was, or nowhere if that has gone, as when its
 * tab closed: then it goes to the middle of the window. It clears what the finder held, and runs
 * what was waiting.
 */
export function finderClosed(): void {
  const then = afterClose;
  afterClose = undefined;
  if (!finderStore.getState().open) {
    listed = [];
    finderStore.setState(closed);
    if (document.activeElement === null || document.activeElement === document.body) {
      focusMiddle();
    }
  }
  then?.();
}

/** What's typed changed. */
export function typeQuery(query: string): void {
  finderStore.setState({ query });
  search();
}

/** `Tab`: only the changed files, or all the matches again. */
export function toggleChangedOnly(): void {
  if (!finderOpen()) return;
  finderStore.setState((state) => ({ changedOnly: !state.changedOnly }));
}

/** The list highlighted another file, or none. */
export function highlight(item: Item | undefined): void {
  if (finderStore.getState().highlighted !== item?.id) {
    finderStore.setState({ highlighted: item?.id });
  }
}

/** How the finder takes a file: `show` as the tree's `⏎` does, or `whole` as its "Whole file" does. */
export type Way = 'show' | 'whole';

/**
 * Takes the finder to `item`. A changed file is revealed in the tree, which the diff follows, and
 * shown as the tree's `⏎` shows it; any other file is asked of the whole-file view. Both go through
 * the tree's commands once the finder has closed, so each is refused, with a reason, where the
 * tree's own would be: while no view can show it.
 */
export function go(item: Item, way: Way): void {
  const { tab } = finderStore.getState();
  if (tab === undefined) return;
  closeFinder(() => {
    const target = { kind: 'file', file: item.id } as const;
    if (way === 'whole') {
      registry().run('tree.wholeFile', target);
      return;
    }
    if (item.changed) revealFile(tab, item.id);
    registry().run('tree.show', target);
  });
}

/** `⌘⏎`: the highlighted file, whole. */
export function openWhole(): void {
  const item = finderOpen() ? highlighted() : undefined;
  if (item) go(item, 'whole');
}

/**
 * Why `⌘⏎` can't act now, or `true`. Another palette has no use for the key and says nothing of
 * it; the finder with no file highlighted says so.
 */
export function wholeReady(): true | string {
  if (!finderOpen()) return true;
  return highlighted() === undefined ? 'No file is highlighted.' : true;
}
