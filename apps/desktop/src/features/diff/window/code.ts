// What code features reach of a pull request's tab's code views, the diff and the whole-file view,
// without driving either: a peek under a line, where a word is drawn, inline hints, which each view
// draws beside the marks it has of its own, the pointer resting on a word, and what file and commit
// a place in them is on, as the code port names them.

import type { Side } from '@lo/ui/commands';
import type { Anchor, HintMark, PeekFrame, PeekView, Place } from '@lo/ui/code';

import { here, registry } from '../../../window/commands/registry.ts';
import { comparedIn, revisionsOf } from '../../revisions/window/shared.ts';
import { tabState } from '../../tab/window/shared.ts';
import { pathOf } from '../../tree/window/shared.ts';
import type { FileVersions } from '../contract.ts';
import { keysDiff, loaderOf } from './tabs.ts';
import { changeAt, changedIn, known, opened, pathIn, reads, wholeDrawn } from './whole.ts';

/** Which of a tab's code views: the diff, or the file whole. */
export type CodeViewKind = 'diff' | 'file';

/** A file of a code view at a place, as the code port names it. */
export interface CodeFile {
  /** Its path on the place's side, as text. */
  readonly path: string;
  /** The commit that side shows, whose tree the code port reads: none until it's known. */
  readonly commit: string | undefined;
  /** How the comparison on screen changes it, if it does. */
  readonly change: FileVersions['change'] | undefined;
}

/** The hints each tab's views draw, which each merges with the marks it has of its own. */
export const hintsShown = tabState<{
  readonly diff: readonly HintMark[];
  readonly file: readonly HintMark[];
}>(() => ({ diff: [], file: [] }));

const rests = new Set<(tab: string, view: CodeViewKind, at: Place | undefined) => void>();

/** Tells those listening that the pointer rested on a word in a view of `tab`, or left it. */
export function restedIn(tab: string, view: CodeViewKind, at: Place | undefined): void {
  for (const listener of rests) listener(tab, view, at);
}

/**
 * Calls `listener` each time the pointer rests on a word in a tab's code views for half a second,
 * and with no place once it leaves it. Returns a function that stops it.
 */
export function onCodeRest(
  listener: (tab: string, view: CodeViewKind, at: Place | undefined) => void,
): () => void {
  rests.add(listener);
  return () => {
    rests.delete(listener);
  };
}

/** The commit side `side` of tab `tab`'s diff shows, if it's known yet. */
function commitOf(tab: string, side: Side): string | undefined {
  const state = loaderOf(tab).snapshot().state;
  if (!state?.at) return undefined;
  if (side === 'new') return state.at;
  // Two revisions compared: the older one's head. From the base, the head's start isn't the
  // window's to know.
  if (state.comparison !== null) return comparedIn(revisionsOf(tab))?.from ?? undefined;
  return state.start ?? undefined;
}

/** The view of `kind` in tab `tab`, as the keys act on it, if it's drawn. */
function viewOf(tab: string, kind: CodeViewKind) {
  if (kind === 'file') return wholeDrawn(tab)?.view();
  return keysDiff(tab)?.view;
}

/** A pull request's tab's code views, as code features reach them. */
export interface CodeViews {
  /** The code view keys act on: the file whole while it's on screen, else the diff, if drawn. */
  onScreen(): CodeViewKind | undefined;
  /** The file at `at`, on its side: its path there, the commit that side shows, how it changed. */
  fileAt(at: Place): CodeFile | undefined;
  /**
   * Whether the comparison on screen shows the file at `path` on side `side`, so going to a place
   * in it goes into the diff, not to the file whole.
   */
  inDiff(path: string, side: Side): boolean;
  /** The ids of the files on screen in `view`, first to last, with their lines on the head's side. */
  newOnScreen(view: CodeViewKind): readonly { readonly file: string; readonly lines: number }[];
  /** Shows `peek` under the line at `at` in `view`, or closes it: the view's `peek`. */
  peek(view: CodeViewKind, at: Place, peek: PeekView | undefined, frame?: PeekFrame): boolean;
  /** Where the word at `at` is drawn in `view`, for a card over it. */
  anchor(view: CodeViewKind, at: Place): Anchor | undefined;
  /** Replaces the inline hints `view` draws, beside the marks it has of its own. */
  setHints(view: CodeViewKind, hints: readonly HintMark[]): void;
  /**
   * Moves `view`'s cursor to `at`, on screen, and focuses it: a jump the reader asked for, so where
   * the tab was is recorded in its history first. Says whether the view has the place.
   */
  go(view: CodeViewKind, at: Place): boolean;
}

/** Tab `tab`'s code views, as code features reach them. */
export function codeViewsOf(tab: string): CodeViews {
  return {
    onScreen() {
      if (wholeDrawn(tab)) return opened.get(tab) ? 'file' : undefined;
      return keysDiff(tab) ? 'diff' : undefined;
    },
    fileAt(at) {
      const loader = loaderOf(tab);
      const key = loader.ids.keyOf(at.file);
      if (key === undefined) return undefined;
      const change = changedIn(loader.snapshot().state?.files, key);
      const path = pathIn(change, at.side, () => known.get(tab).get(key) ?? pathOf(tab, key));
      // The code port takes a path as text: one whose bytes aren't UTF-8 it can't name.
      if (path.hex !== undefined) return undefined;
      return { path: path.text, commit: commitOf(tab, at.side), change: change?.change };
    },
    inDiff(path, side) {
      const change = changeAt(loaderOf(tab).snapshot().state?.files, path, side);
      if (!change) return false;
      return side === 'new' ? change.change !== 'deleted' : change.change !== 'added';
    },
    newOnScreen(view) {
      if (view === 'file') {
        const open = opened.get(tab);
        const content = reads.get(tab)?.content;
        if (open?.version !== 'new' || content?.kind !== 'text') return [];
        return [{ file: open.id, lines: content.lines.length }];
      }
      const drawn = keysDiff(tab);
      if (!drawn) return [];
      return drawn.view.filesOnScreen().flatMap((file) => {
        const lines = drawn.loader.shown(file)?.lines.new.length ?? 0;
        return lines > 0 ? [{ file, lines }] : [];
      });
    },
    peek: (view, at, peek, frame) => viewOf(tab, view)?.peek(at, peek, frame) ?? false,
    anchor: (view, at) => viewOf(tab, view)?.anchor(at),
    setHints(view, hints) {
      hintsShown.update(tab, (shown) => ({ ...shown, [view]: hints }));
    },
    go(view, at) {
      const code = viewOf(tab, view);
      if (!code) return false;
      const from = here();
      if (from) registry().history.record(from);
      if (!code.reveal({ kind: 'line', at })) return false;
      code.focus();
      return true;
    },
  };
}
