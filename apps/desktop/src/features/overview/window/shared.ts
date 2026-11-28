// What the overview shares with other features' window code: whether there are overviews, which
// Settings turns off and on, and every view and command of the overview comes and goes with; what
// one looks like, for the welcome to show; its mark for a tab, as the header's view switch shows
// it, which the stack's tree shows for the layer on screen; the review threads another feature
// places and draws on its code blocks, with their popover and the comments written there; and
// whether a tab's overview has a block now, and when that may have changed; and the stack's
// overview, which the stack's tree has a row for, shown in place of the layer's own and back.

import type { StackTreeOverview } from '@lo/ui';
import type { Target } from '@lo/ui/commands';
import { createElement, type ReactNode } from 'react';

import type { Presence } from '../../../window/slots.tsx';
import { settingNow, watchSetting } from '../../settings/window/shared.ts';
import {
  showMiddle,
  useMiddle,
  usePull,
  useTabState,
  type PullTab,
} from '../../tab/window/shared.ts';
import { on } from '../settings.ts';
import { Example } from './Example.tsx';
import { markOf, newestHead, standingOf, type MarkKind } from './facts.ts';
import { blockAt, drawnIn, onDrawn } from './follow.ts';
import { useStanding } from './hooks.ts';
import { OVERVIEW_VIEW } from './labels.ts';
import type { CommentOnHead } from './mapping.ts';
import { commentLinesOnHead } from './since.ts';
import {
  hasStackOverview as stackOverviewIn,
  readLayers,
  setSubject,
  stackStates,
  subjectNow,
  subjects,
} from './stack.ts';
import {
  setStackParts as takeStackParts,
  stackViewOf,
  type StackParts as Parts,
} from './stacked.ts';
import { codeBlocksIn, labelOf } from './stale.ts';
import { checked, revisions, states } from './store.ts';
import {
  blockKey as keyOfBlock,
  blockLinesOf,
  blockThreadsWith,
  blockWithFocus as withFocus,
  changed,
  changedEverywhere,
  type BlockLines,
  type BlockPopover,
  type BlockThreads,
  writingBlockKeyed,
  writingBlockOf,
  writingBlocksOf,
  writingPinnedWith,
  writingWithFocus,
  type WritingBlock,
} from './threaded.ts';

export type { CommentOnHead, FileWhy } from './mapping.ts';
export type {
  BlockLines,
  BlockPopover,
  BlockThreads,
  DrawnBlock,
  WritingBlock,
} from './threaded.ts';

/**
 * Whether there are overviews now, as Settings says: on until main has said otherwise. A view of
 * another feature's that's there only for overviews, such as a row about them, takes it as its
 * `present`, so it comes and goes with them.
 */
export const overviews: Presence = {
  now: () => settingNow(on),
  subscribe: (listener) => {
    // Told only of a change: what it is as it starts is what `now` says.
    let starting = true;
    const stop = watchSetting(on, () => {
      if (!starting) listener();
    });
    starting = false;
    return stop;
  },
};

/**
 * Calls `listener` with whether there are overviews once main has said, and again each time
 * Settings turns them off or on, for a feature to take out what's there only for them, as a
 * command of its own. Returns a function that stops it.
 */
export function followOverviews(listener: (on: boolean) => void): () => void {
  return watchSetting(on, listener);
}

/**
 * What an overview looks like: the top of one, its tl;dr and the code block it links to, drawn at
 * its real size in the overview's own styles, in a frame as wide as its place that cuts it off.
 * Nothing in it responds, and a screen reader hears what it shows. It's the same while overviews
 * are off.
 */
export function OverviewExample(): ReactNode {
  return createElement(Example);
}

/**
 * Whether there's an overview: one for the newest push (`current`), for an older one (`stale`), one
 * that can't be shown (`error`), or none.
 */
export type OverviewMark = MarkKind;

/**
 * The overview's mark for view `tab` of a pull request's tab, re-rendering as it changes: nothing
 * while Lo is still finding out.
 */
export function useOverviewMark(tab: string): OverviewMark | undefined {
  const standing = useStanding(tab);
  const pull = usePull(tab);
  return markOf(standing, newestHead(pull));
}

/**
 * Gives the overviews' code blocks what places and draws their review threads, such as the
 * comments: a block drawn asks it for the threads on its lines at the commit the overview
 * describes and how they show, has its code view show them so, beside its lines in a popover it
 * draws or between them, each under its line, open or collapsed as it says, and asks again on
 * `blockThreadsChanged` and `blockThreadsShowChanged`. What would move a line on screen waits until
 * it's off screen or the reader acts. A block drawn tells it, for the boxes open there. Returns a
 * function that takes it back.
 */
export function setBlockThreads(threads: BlockThreads): () => void {
  return blockThreadsWith(threads);
}

/** Says tab `tab`'s review threads changed, so its code blocks drawn ask for them again. */
export function blockThreadsChanged(tab: string): void {
  changed(tab);
}

/** Says how review threads show in code changed: every code block drawn shows them so. */
export function blockThreadsShowChanged(): void {
  changedEverywhere();
}

/**
 * Pull request's tab `tab`'s code block with focus in its code or its threads' popover, if one
 * has: where a key on a thread, or in its popover, acts.
 */
export function blockWithFocus(tab: string): BlockPopover | undefined {
  return withFocus(tab);
}

/**
 * The code block of pull request's tab `tab`'s overview a key or a control on thread `thread` is
 * asked for in, if it's one's: one with focus in its code, as on a card under its lines, or in its
 * popover, or, with the overview on screen, one whose popover is pinned with the thread in it, as
 * from a menu over it. Not that one while focus is `elsewhere`, as in the diff beside it, whose own
 * thread it is then.
 */
export function writingBlockAsked(
  tab: string,
  thread: string,
  elsewhere = false,
): WritingBlock | undefined {
  const focused = writingWithFocus(tab);
  if (focused || elsewhere || !drawnIn(tab)) return focused;
  return writingPinnedWith(tab, thread);
}

/**
 * The code block `target` names in pull request's tab `tab`'s overview on screen, and the lines a
 * comment on it is on: in a block's code, the cursor's line or the lines `v` selected; on a block,
 * as its key or menu names it, the lines it points at. Or why there's none.
 */
export function blockLines(tab: string, target: Target): BlockLines | string {
  // The stack's overview's code is the whole stack's, which no comment on the layer is on.
  if (target.kind !== 'line' && subjectNow(tab) === 'stack') return STACK_COMMENTS;
  // A line is a drawn block's, or one of a view that takes no comment, as the whole file's.
  if (target.kind !== 'line' && !drawnIn(tab)) return 'Go to the overview first';
  return blockLinesOf(tab, target);
}

/** Why a block of the stack's overview takes no comment. */
const STACK_COMMENTS = 'Comment on a layer’s own code';

/** Whether `target` is a code block of tab `tab`'s overview on screen, drawn yet or not. */
export function isCodeBlock(tab: string, target: Target): boolean {
  if (subjectNow(tab) === 'stack') return false;
  const overview = drawnIn(tab);
  if (!overview || target.kind !== 'block') return false;
  return blockAt(overview, target)?.querySelector('[data-lo-excerpt]') != null;
}

/**
 * The key of a code block that points at `path`'s lines `start` to `end`, of an overview that
 * describes `commit`, as `DrawnBlock.key` has it: the same after a restart.
 */
export function blockKey(commit: string, path: string, start: number, end: number): string {
  return keyOfBlock(commit, path, start, end);
}

/**
 * Whether tab `tab`'s overview has the code block known by `key` (`DrawnBlock.key`) now, drawn or
 * not: `unknown` while Lo is still reading or checking it.
 */
export function blockInOverview(tab: string, key: string): boolean | 'unknown' {
  if (!overviews.now()) return false;
  if (writingBlockKeyed(tab, key)) return true;
  const standing = standingOf(states.get(tab), checked.get(tab));
  if (standing.kind === 'reading' || standing.kind === 'checking') return 'unknown';
  if (standing.kind !== 'shown') return false;
  const { commit } = standing.header;
  return codeBlocksIn(standing.parsed.tree).some(
    ({ path, lines }) => keyOfBlock(commit, path, lines.start, lines.end) === key,
  );
}

/**
 * Calls `listener` as any tab's overview changes, as main reads it or it's checked, or overviews
 * turn off or on: which blocks it has may have changed. Returns a function that stops it.
 */
export function onOverviewChanged(listener: () => void): () => void {
  const stops = [
    states.subscribe(listener),
    checked.subscribe(listener),
    overviews.subscribe(listener),
  ];
  return () => {
    for (const stop of stops) stop();
  };
}

/** What the reader calls the revision whose head is `commit`, in tab `tab`: `r3`, or its short id. */
export function revisionName(tab: string, commit: string): string {
  return labelOf(revisions.get(tab), commit);
}

/** Tab `tab`'s code block known by `key` (`DrawnBlock.key`), while it's drawn. */
export function writingBlock(tab: string, key: string): WritingBlock | undefined {
  return writingBlockKeyed(tab, key);
}

/** Tab `tab`'s code blocks drawn, as comments are written on them and their drafts marked. */
export function writingBlocks(tab: string): readonly WritingBlock[] {
  return writingBlocksOf(tab);
}

/**
 * Tab `tab`'s code block drawn whose code view names its file `file`, as a line target in it does,
 * if one is.
 */
export function writingBlockIn(tab: string, file: string): WritingBlock | undefined {
  return writingBlockOf(tab, file);
}

/** Whether tab `tab`'s overview is on screen, drawn. */
export function overviewOnScreen(tab: string): boolean {
  return drawnIn(tab) !== undefined;
}

/**
 * Brings tab `tab`'s overview into sight, as `~` steps to it, the layout as it is. Says whether the
 * tab has one.
 */
export function showOverview(tab: string): boolean {
  return showMiddle(tab, OVERVIEW_VIEW);
}

/**
 * Calls `listener` with a tab's id each time its overview is drawn on screen, as it comes into
 * sight. Returns a function that stops it.
 */
export function onOverviewShown(listener: (tab: string) => void): () => void {
  return onDrawn(listener);
}

/**
 * Where lines `from` to `to` on `side` of the file at `path`, at `commit`, the commit tab `tab`'s
 * overview describes, are for a comment at the head on screen: the same lines, each there
 * unchanged; the file, saying why: they changed, they're on the older side, or Lo can't tell, as
 * for an overview of a commit other than the head's or the one Lo compares it with; or nowhere,
 * with the file gone. It waits for Lo to work out how the file changed.
 */
export function commentOnHead(
  tab: string,
  commit: string,
  path: string,
  lines: { readonly side: 'old' | 'new'; readonly from: number; readonly to: number },
): Promise<CommentOnHead> {
  return commentLinesOnHead(tab, commit, path, lines);
}

/**
 * Whether view `id`'s stack has an overview Lo has read, which its row in the stack's tree then
 * offers.
 */
export function hasStackOverview(id: string): boolean {
  return stackOverviewIn(id);
}

/** What the stacks give the overview of the stack each view is in. */
export type StackParts = Parts;

/**
 * Takes what the stacks give the overview, as they start, until the function it returns takes it
 * back: the stack each view is in, the way to show a layer, and the way to show the whole stack.
 */
export function setStackParts(given: StackParts): () => void {
  return takeStackParts(given);
}

/**
 * The stack overview's row in the stack's tree of view `tab`, while its stack has an overview Lo has
 * read: whether the Overview shows it now.
 */
export function useStackOverviewRow(tab: PullTab): StackTreeOverview | undefined {
  const present = useTabState(stackStates, tab.id, (state) => (state?.overview ?? null) !== null);
  const subject = useTabState(subjects, tab.id);
  const { onScreen } = useMiddle(tab.id);
  if (!present) return undefined;
  return { shown: subject === 'stack' && onScreen.includes(OVERVIEW_VIEW) };
}

/**
 * Shows the overview of the stack view `tab` is in, in its Overview, as `g s`, the stack's row and
 * the notice do: a place in its history. Says whether it has one.
 */
export function showStackOverview(tab: PullTab): boolean {
  if (!stackOverviewIn(tab.id)) return false;
  // What its layers' overviews say is read again, for any pushed since.
  readLayers(tab.id, stackViewOf(tab.id), true);
  setSubject(tab.id, 'stack');
  return showMiddle(tab.id, OVERVIEW_VIEW);
}

/** Sets view `id`'s Overview back to its layer's own overview, as showing the layer does. */
export function showOwnOverview(id: string): void {
  setSubject(id, 'pull');
}
