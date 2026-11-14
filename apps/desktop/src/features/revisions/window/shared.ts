// What the revisions feature shares with other features' window code: each pull request's tab's
// viewed marks, as they show, and `e`, which marks a changed file viewed or clears its mark. The
// tree and the diff draw the marks, and each moves on in its own way after `e`. Another feature
// marks a revision for the picker to show, as the overview marks the one it describes. And how long
// a pull request's tab holds back what it shows first, which the overview and the diff both keep.
// Each tab's revisions and what it compares, for another feature to read, and to compare another
// pair, as the threads panel does to show a thread, and the diff's history to go back.

import { IpcError } from '../../../ipc/contract.ts';
import { announce, notify, withdraw } from '../../../window/commands/notices.tsx';
import { useTabState } from '../../tab/window/shared.ts';
import type { TreePath } from '../../tree/contract.ts';
import type { Compared, ComparisonView } from '../contract.ts';
import { afterHold as heldAfter, holdLimit as heldFor } from './hold.ts';
import { main } from './main.ts';
import { catchUp, marked, views } from './store.ts';
import {
  countIn,
  markable,
  markIn,
  shownMarks,
  toggle,
  type Mark,
  type ShownMarks,
  type Toggled,
} from './viewed.ts';

export type { Mark, ShownMarks, Toggled } from './viewed.ts';
export type { Compared, ComparisonView } from '../contract.ts';

/**
 * How long a pull request's tab holds back what it shows first, as it opens, in milliseconds:
 * `HOLD_LIMIT`, unless a build run from source was started with another, for its tests.
 */
export function holdLimit(): number {
  return heldFor();
}

/**
 * Runs `run` once the bound has passed since `since`, when a tab started waiting, and returns a
 * function that cancels it. The bound is read as the wait ends, for one a test asked for after it
 * began.
 */
export function afterHold(since: number, run: () => void): () => void {
  return heldAfter(since, run);
}

/** `tab`'s viewed marks as they show, re-rendering as they change. */
export function useViewedMarks(tab: string): ShownMarks {
  return useTabState(shownMarks, tab);
}

/** `tab`'s viewed marks as they show now. */
export function viewedMarksOf(tab: string): ShownMarks {
  return shownMarks.get(tab);
}

/**
 * The mark of the changed file at `path` in `marks`: GitHub's by that path, or by `previous`, for
 * a rename GitHub lists by its old path. None for a file GitHub has no mark for, or whose path is
 * too long to look up.
 */
export function viewedMarkOf(
  marks: ShownMarks,
  path: TreePath,
  previous?: TreePath | null,
): Mark | undefined {
  return markIn(marks, path, previous);
}

/**
 * How many of `files`, the changed files a diff shows, are viewed in `marks`, of how many there
 * are. `marks`' own count is of every file the pull request changes, which a stack's layer's diff,
 * compared with the layer below it, doesn't all show.
 */
export function viewedCountIn(
  marks: ShownMarks,
  files: readonly { readonly path: TreePath; readonly previous: TreePath | null }[],
): { readonly viewed: number; readonly total: number } {
  return countIn(marks, files);
}

/**
 * Whether moving on after `e` passes over the changed file at `path`, or `previous` for a rename
 * GitHub lists by its old path: it's viewed, or `e` can't mark it, as when its path isn't UTF-8 or
 * is longer than 1,024 bytes, so `e` never stops on one it would refuse.
 */
export function passedOver(marks: ShownMarks, path: TreePath, previous?: TreePath | null): boolean {
  return !markable(path) || markIn(marks, path, previous) === 'viewed';
}

/**
 * `e` on a changed file of `tab`'s: marks it viewed, or clears the mark of one that's viewed. The
 * new mark shows at once, and goes back to GitHub's, with a note, if GitHub doesn't take it. Says
 * which it started, or why it couldn't, so the caller moves on only once it has.
 */
export function toggleViewed(
  tab: string,
  file: { readonly path: TreePath; readonly previous: TreePath | null },
): Toggled {
  return toggle(tab, file);
}

/**
 * Marks the commit `head` in tab `tab`'s revision picker as `kind`, or clears the mark for none:
 * `overview`, the commit the overview on screen describes. The picker marks the revision whose
 * head it is, and names any other commit by its short id.
 */
export function markRevision(tab: string, kind: 'overview', head: string | undefined): void {
  if (marked.get(tab)[kind] === head) return;
  marked.update(tab, (current) => ({ ...current, [kind]: head }));
}

/** What main last sent of tab `tab`'s revisions and what it compares, if anything yet. */
export function revisionsOf(tab: string): ComparisonView | undefined {
  return views.get(tab);
}

/** Tab `tab`'s revisions and what it compares, re-rendering as they change. */
export function useRevisions(tab: string): ComparisonView | undefined {
  return useTabState(views, tab);
}

/** Asks main once for the revisions of tab `tab`, drawn before main said anything of them. */
export function catchUpRevisions(tab: string): void {
  if (views.get(tab) === undefined) catchUp(tab);
}

/** The label of the revision with head `head` in `view`, `r2`, if it's one of its revisions. */
export function revisionLabel(view: ComparisonView | undefined, head: string): string | undefined {
  const number = view?.revisions.find((revision) => revision.head === head)?.number;
  return number === undefined || number === null ? undefined : `r${number}`;
}

/** What `view` compares on screen: none before anything's shown. */
export function comparedIn(view: ComparisonView | undefined): Compared | undefined {
  if (!view) return undefined;
  if (view.comparison) return view.comparison;
  return view.shown === null ? undefined : { from: null, to: view.shown };
}

/** Whether `a` and `b` compare the same two revisions. */
export function sameCompared(a: Compared | undefined, b: Compared | undefined): boolean {
  return a !== undefined && b !== undefined && a.from === b.from && a.to === b.to;
}

/**
 * The name a place in a tab's history keeps `compared` by, in `view`: `whole` for the whole pull
 * request, at whichever head is shown, and otherwise its two ends, the base as `base`.
 */
export function comparisonName(view: ComparisonView, compared: Compared): string {
  if (compared.from === null && compared.to === view.shown) return 'whole';
  return `${compared.from ?? 'base'}..${compared.to}`;
}

/** What `name`, from {@link comparisonName}, compares in `view` now, if it names anything. */
export function comparisonNamed(view: ComparisonView, name: string): Compared | undefined {
  if (name === 'whole') return view.shown === null ? undefined : { from: null, to: view.shown };
  const [from, to, ...rest] = name.split('..');
  if (from === undefined || !to || rest.length > 0) return undefined;
  return { from: from === 'base' ? null : from, to };
}

/** What tab `tab` compares on screen, named as a place in its history keeps it: none until known. */
export function comparisonHere(tab: string): string | undefined {
  const view = views.get(tab);
  const compared = comparedIn(view);
  return view && compared && comparisonName(view, compared);
}

/**
 * What each tab asked main to compare, until main has taken it: the window knows it's coming before
 * main says so.
 */
const asked = new Map<string, Compared>();

/**
 * What tab `tab` compares once what's asked for comes, when that's another comparison than the one
 * on screen: asked for here and not yet taken by main, or main's.
 */
export function comparisonComing(tab: string): Compared | undefined {
  const view = views.get(tab);
  const coming = asked.get(tab) ?? view?.pending ?? undefined;
  return coming && !sameCompared(coming, comparedIn(view)) ? coming : undefined;
}

/** What a comparison asked for says as it's asked for: a note, taken back if it's called off. */
export interface Said {
  readonly title: string;
  readonly body: string;
}

/** The note each tab's last comparison asked for put up, and that comparison. */
const said = new Map<string, Said & { readonly compared: Compared }>();

/** Takes back the note tab `tab`'s last comparison put up, unless it was for `compared`. */
function takeBack(tab: string, compared: Compared): void {
  const note = said.get(tab);
  if (!note || sameCompared(note.compared, compared)) return;
  said.delete(tab);
  withdraw(note.title, note.body);
}

/**
 * Has tab `tab` compare `compared`, as the reader asked: `now` when that's on screen and nothing
 * else is coming, `coming` when it's asked for, or why it can't be. One asked for after another
 * takes its place, so the last asked for is what shows: asked for what's on screen, what was coming
 * is called off, and the note it put up, `say`, is taken back. Main's refusal comes as a note titled
 * `title`.
 */
export function compareTo(
  tab: string,
  compared: Compared,
  title: string,
  say?: Said,
): 'now' | 'coming' | { readonly why: string } {
  const view = views.get(tab);
  if (!view || view.status !== 'ready') {
    return { why: view?.problem ?? 'Lo hasn’t read the pull request’s revisions yet.' };
  }
  const coming = comparisonComing(tab);
  if (sameCompared(coming, compared)) return 'coming';
  const now = sameCompared(comparedIn(view), compared);
  if (now && coming === undefined) return 'now';
  takeBack(tab, compared);
  asked.set(tab, compared);
  if (say) {
    said.set(tab, { ...say, compared });
    announce(say.title, say.body);
  }
  const taken = () => {
    if (asked.get(tab) === compared) asked.delete(tab);
  };
  main()
    .compare({ id: tab, ...compared })
    .then(taken, (error: unknown) => {
      taken();
      notify(
        title,
        error instanceof IpcError ? error.message : 'Lo couldn’t compare them. Try again.',
      );
    });
  return now ? 'now' : 'coming';
}

/**
 * Has tab `tab` compare again what `name`, from {@link comparisonHere}, names, as going back in its
 * history does: as {@link compareTo} says.
 */
export function compareAgain(
  tab: string,
  name: string,
): 'now' | 'coming' | { readonly why: string } {
  const view = views.get(tab);
  const compared = view && comparisonNamed(view, name);
  if (!compared) return { why: 'Lo can’t tell what that place compared.' };
  return compareTo(tab, compared, 'Back');
}
