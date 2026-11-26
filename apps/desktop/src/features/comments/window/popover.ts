// The keys of a thread's popover, beside lines: `⏎` on a line with a mark pins its popover and
// moves focus into it, `Esc` closes it, and `j` and `k` move the ring between its comments, which
// `i` and `dd` act on. From the line, `x` and `dd` pin the popover first, so a key never changes a
// thread that isn't on screen.

import { ringComment } from '@lo/ui';
import type { Target } from '@lo/ui/commands';

import { writingDiff } from '../../diff/window/shared.ts';
import { activeTab, type PullTab } from '../../tab/window/shared.ts';
import { threadFor, type ThreadKeyTarget } from './acts.ts';
import { takeOffer } from './boxes.ts';
import { threadsMode } from './mode.ts';

/** The diff of the pull request on screen, while it's drawn. */
function diffOnScreen(): ReturnType<typeof writingDiff> {
  const tab = activeTab();
  if (tab?.kind !== 'pull') return undefined;
  return writingDiff(tab.id);
}

/**
 * `⏎` on a thread: its popover pinned, focus in it on its first comment. Just after a line refused
 * a comment, a comment on its file instead, as `⏎` is on a line with no mark.
 */
export function showPopover(target: Target): void {
  const tab = activeTab();
  if (tab?.kind !== 'pull' || takeOffer(tab) || target.kind !== 'thread') return;
  diffOnScreen()?.pinThread(target.thread, true);
}

/** Whether a thread's popover can open: the diff is drawn. */
export function canShowPopover(): true | string {
  return diffOnScreen() ? true : '';
}

/** `Esc` in a thread's popover: it closes, focus going to its line. */
export function closePopover(): void {
  diffOnScreen()?.closePopover();
}

/** Whether a thread's popover is pinned, which `Esc` closes. */
export function popoverPinned(): true | string {
  return (diffOnScreen()?.pinned().length ?? 0) > 0 ? true : '';
}

/** `j` or `k` in a thread's popover: the ring goes to the next comment, or the one before. */
export function moveRing(by: 1 | -1): () => void {
  return () => void ringComment(by);
}

/**
 * Beside lines, what a key from the line does first to the thread it's on, as a key never changes
 * a thread that isn't on screen: its popover pinned already, nothing (`shown`); else it pins
 * (`pinned`), or, where it can't, the key does nothing more (`hidden`). Between lines, from a
 * thread's popover, or on a thread there's none of, which the key says, it's `shown`.
 */
export function pinFirst(tab: PullTab, target: ThreadKeyTarget): 'shown' | 'pinned' | 'hidden' {
  if (target.kind === 'thread' || threadsMode() !== 'beside') return 'shown';
  const row = threadFor(tab.id, target);
  if (typeof row === 'string') return 'shown';
  const diff = writingDiff(tab.id);
  if (!diff) return 'hidden';
  if (diff.pinned().includes(row.id)) return 'shown';
  return diff.pinThread(row.id) ? 'pinned' : 'hidden';
}

/** The comment a key in a thread's popover acts on: the one the ring is on, if it's on one. */
export function ringed(target: ThreadKeyTarget): string | undefined {
  return target.kind === 'thread' ? target.comment : undefined;
}
