import type { ReactNode } from 'react';

import { announceSlot, NEW_SLOT, REPLY_SLOT } from './edits.ts';

/** One thread in a popover: its id, and its card. */
export interface PoppedThread {
  readonly id: string;
  /** The thread as `Thread` draws it in a popover (`variant="popover"`). */
  readonly card: ReactNode;
}

export interface ThreadPopoverProps {
  /**
   * What it is, for a screen reader, as its head says it: its first thread's state and lines,
   * "Unresolved thread · lines 10–35".
   */
  label: string;
  /** The threads, in the order they show: unresolved first, then oldest. The first has Close. */
  threads: readonly PoppedThread[];
  /**
   * A new comment's box is in it, after the threads, or alone: it draws the slot the code view puts
   * the box in (`NEW_SLOT`), a hairline over it where threads are above.
   */
  box?: boolean | undefined;
}

/**
 * The review threads on a line, over the code: the shell a code view places under the line, in a
 * layer of its own scroll, and the threads in it, `lo-sp-12` apart with a hairline between, each
 * marked as its thread's (`data-thread-id`), which a key or a right-click in it acts on. It's as
 * tall as they are, up to the most the code view lets it be (`thread-pop`), past which they scroll
 * inside it, each thread's head staying over its comments. To a screen reader it's a dialog that
 * doesn't hold focus in, named for its first thread.
 */
export function ThreadPopover({ label, threads, box = false }: ThreadPopoverProps) {
  return (
    <div
      role="dialog"
      aria-label={label}
      data-thread-pop=""
      // Focus comes to it as a click on its mark opens it, with no ring: `j` rings a comment.
      tabIndex={-1}
      className="thread-pop rounded-md border border-border bg-bg-overlay text-fg shadow-pop outline-none text-ui"
    >
      {threads.map(({ id, card }, index) => (
        <div
          key={id}
          data-thread-id={id}
          className={index === 0 ? undefined : 'mt-12 border-t border-border-subtle'}
        >
          {card}
        </div>
      ))}
      {box && (
        <div
          ref={announceSlot}
          {...{ [NEW_SLOT]: '' }}
          className={
            threads.length === 0 ? 'p-8' : 'mt-12 border-t border-border-subtle px-12 py-8'
          }
        />
      )}
    </div>
  );
}

/**
 * Where a reply's box goes in a thread's card in a popover, in place of the row that offers one,
 * as the card's `reply`: the code view puts the box in it.
 */
export function ReplySlot({ thread }: { thread: string }) {
  return <div ref={announceSlot} {...{ [REPLY_SLOT]: thread }} />;
}

/** The room kept between a ringed comment and the edges of what its popover shows. */
const RING_ROOM = 8;

/**
 * Moves the keyboard's ring in the thread popover focus is in to the comment `by` after the one
 * it's on, or before, as `j` and `k` do: focus goes to it, and the popover scrolls the least that
 * shows it, under its thread's head, which stays over its comments. Says whether it moved: not past
 * either end, nor outside a popover.
 */
export function ringComment(by: 1 | -1): boolean {
  const active = document.activeElement;
  const popover = active?.closest<HTMLElement>('[data-thread-pop]');
  if (!active || !popover) return false;
  const comments = [...popover.querySelectorAll<HTMLElement>('[data-comment]')];
  const at = comments.findIndex((comment) => comment.contains(active));
  const next = comments[at < 0 ? (by > 0 ? 0 : comments.length - 1) : at + by];
  if (!next) return false;
  next.focus({ preventScroll: true });
  const head = next.closest('[data-thread-id]')?.querySelector<HTMLElement>('[data-pop-head]');
  const shown = popover.getBoundingClientRect();
  const ringed = next.getBoundingClientRect();
  const top = shown.top + (head?.offsetHeight ?? 0) + RING_ROOM;
  const bottom = shown.bottom - RING_ROOM;
  if (ringed.top < top) popover.scrollTop -= top - ringed.top;
  else if (ringed.bottom > bottom) {
    popover.scrollTop += Math.min(ringed.bottom - bottom, ringed.top - top);
  }
  return true;
}
