// What the overview shares with other features' window code: its mark for a tab, as the header's
// view switch shows it, which the stack's tree shows for the layer on screen; the review threads
// another feature places and draws on its code blocks, with the comments written there; and
// whether a tab's overview has a block now, and when that may have changed.

import type { Target } from '@lo/ui/commands';

import { usePull } from '../../tab/window/shared.ts';
import { markOf, newestHead, standingOf, type MarkKind } from './facts.ts';
import { blockAt, drawnIn } from './follow.ts';
import { useStanding } from './hooks.ts';
import type { CommentOnHead } from './mapping.ts';
import { commentLinesOnHead } from './since.ts';
import { codeBlocksIn, labelOf } from './stale.ts';
import { checked, revisions, states } from './store.ts';
import {
  blockKey as keyOfBlock,
  blockLinesOf,
  blockThreadsWith,
  changed,
  type BlockLines,
  type BlockThreads,
  writingBlockKeyed,
  type WritingBlock,
} from './threaded.ts';

export type { CommentOnHead, FileWhy } from './mapping.ts';
export type { BlockLines, BlockThreads, DrawnBlock, WritingBlock } from './threaded.ts';

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
 * describes, has its code view draw each under its line, open or collapsed as it says, and asks
 * again on `blockThreadsChanged`. What would move a line on screen waits until it's off screen or
 * the reader acts. A block drawn tells it, for the boxes open there. Returns a function that takes
 * it back.
 */
export function setBlockThreads(threads: BlockThreads): () => void {
  return blockThreadsWith(threads);
}

/** Says tab `tab`'s review threads changed, so its code blocks drawn ask for them again. */
export function blockThreadsChanged(tab: string): void {
  changed(tab);
}

/**
 * The code block `target` names in pull request's tab `tab`'s overview on screen, and the lines a
 * comment on it is on: in a block's code, the cursor's line or the lines `v` selected; on a block,
 * as its key or menu names it, the lines it points at. Or why there's none.
 */
export function blockLines(tab: string, target: Target): BlockLines | string {
  // A line is a drawn block's, or one of a view that takes no comment, as the whole file's.
  if (target.kind !== 'line' && !drawnIn(tab)) return 'There’s no overview on screen.';
  return blockLinesOf(tab, target);
}

/** Whether `target` is a code block of tab `tab`'s overview on screen, drawn yet or not. */
export function isCodeBlock(tab: string, target: Target): boolean {
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
 * Calls `listener` as any tab's overview changes, as main reads it or it's checked: which blocks
 * it has may have changed. Returns a function that stops it.
 */
export function onOverviewChanged(listener: () => void): () => void {
  const stops = [states.subscribe(listener), checked.subscribe(listener)];
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
