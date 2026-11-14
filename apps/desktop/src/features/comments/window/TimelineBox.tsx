// The comment boxes a pull request's timeline draws, outside any code view (`createComposer`), each
// in the frame every comment box has: the box at the timeline's end, which comments on the pull
// request itself, and the box that edits your comment there, in the comment's card. Each keeps its
// draft as main does. The box at the end keeps the room it took when it shrinks with no input of
// the reader's, as when it's cleared once a comment whose answer was lost turns out to have posted,
// so nothing around it moves; the next key, click or scroll lets it go. Under a comment whose
// delete's answer was lost, the card says how that stands.

import { Button, Key } from '@lo/ui';
import { createComposer } from '@lo/ui/code';
import { useEffect, useLayoutEffect, useMemo, useRef, type ReactNode, type RefObject } from 'react';

import { useTabState, type PullTab } from '../../tab/window/shared.ts';
import { acting, closeAct, closedActs, noteOf } from './acts.ts';
import {
  type Box,
  bringToTimeline,
  catchUpDrafts,
  knowPull,
  sendingNow,
  timelineBox,
  timelineBoxes,
  timelineEvents,
  timelineFrame,
} from './boxes.ts';
import { ActCallout } from './Card.tsx';
import { type PullComment, removeOnPull, setPullBoxFocus } from './conversation.ts';
import { useNonce } from './page.ts';
import { ON_PULL } from './writing.ts';

/**
 * `box`'s editor, in its frame, drawn in this element for as long as it's here: taken from wherever
 * else it was drawn. `leave` gives focus back to the timeline, as `Esc` in it, or its going while it
 * had focus, does.
 */
function TimelineComposer({
  box,
  label,
  leave,
}: {
  box: Box;
  label: string;
  leave: () => void;
}): ReactNode {
  const host = useRef<HTMLDivElement>(null);
  const nonce = useNonce();
  const leaving = useRef(leave);
  leaving.current = leave;
  useLayoutEffect(() => {
    const parent = host.current;
    if (!parent || nonce === undefined) return undefined;
    const back = () => leaving.current();
    const before = box.composer;
    box.composer = undefined;
    before?.dismiss();
    const made = createComposer(
      parent,
      { draft: box.state.text, nonce, label },
      timelineEvents(box, back),
      timelineFrame(box),
    );
    box.composer = made;
    box.drawnIn = 'timeline';
    box.left = back;
    made.hold(sendingNow(box.state));
    box.set({ mode: made.mode });
    // In insert mode at once, so no key typed meanwhile goes to the timeline instead.
    if (box.focusOnOpen) {
      box.focusOnOpen = false;
      made.focus();
    }
    return () => {
      box.saveNow();
      if (box.left === back) box.left = undefined;
      // Closed already, as once it was sent, or taken elsewhere.
      if (box.composer !== made) return;
      box.composer = undefined;
      box.drawnIn = undefined;
      made.dismiss();
    };
  }, [box, nonce, label]);
  return <div ref={host} />;
}

/**
 * Keeps `outer` as tall as `inner` has been since the reader's last key, click or scroll, so that
 * when `inner` shrinks with no input of theirs, nothing after it, and nothing scrolled to the end,
 * moves.
 */
function useHeldHeight(
  outer: RefObject<HTMLDivElement | null>,
  inner: RefObject<HTMLDivElement | null>,
): void {
  useEffect(() => {
    const held = outer.current;
    const drawn = inner.current;
    if (!held || !drawn) return undefined;
    let tallest = 0;
    const measure = () => {
      tallest = Math.max(tallest, drawn.getBoundingClientRect().height);
      held.style.minHeight = `${tallest}px`;
    };
    const input = () => {
      tallest = 0;
      measure();
    };
    const observer = new ResizeObserver(measure);
    observer.observe(drawn);
    const events = ['keydown', 'pointerdown', 'wheel', 'touchstart'] as const;
    for (const event of events) document.addEventListener(event, input, true);
    return () => {
      observer.disconnect();
      for (const event of events) document.removeEventListener(event, input, true);
      held.style.minHeight = '';
    };
  }, [outer, inner]);
}

export interface PullBoxProps {
  readonly tab: PullTab;
  /** Gives focus back to the timeline. */
  readonly leave: () => void;
  /** The keys of `c` there, which brings the draft from a code block, as this system shows them. */
  readonly keys?: readonly string[] | undefined;
}

/**
 * The box at the end of tab `tab`'s timeline, which comments on the pull request itself: its draft
 * as main keeps it, restored after a restart, and a new, empty box once GitHub takes the comment.
 * `c` in the timeline puts focus in it. While the draft opens under the code block it was written
 * on, it says so in the box's place, and `c` brings it here.
 */
export function PullBox({ tab, leave, keys }: PullBoxProps): ReactNode {
  const view = tab.id;
  const own = useTabState(timelineBoxes, view, (boxes) => boxes.own);
  const away = useTabState(timelineBoxes, view, (boxes) => boxes.away);
  const box = own ?? (away ? undefined : timelineBox(view, ON_PULL));
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  useEffect(() => {
    knowPull(tab);
    catchUpDrafts(view);
  }, [tab, view]);
  useEffect(
    () =>
      setPullBoxFocus(view, () => {
        inner.current?.scrollIntoView({ block: 'nearest' });
        box?.composer?.focus();
      }),
    [view, box],
  );
  useHeldHeight(outer, inner);
  return (
    <div ref={outer} data-lo-timeline="box">
      <div ref={inner}>
        {box ? (
          <TimelineComposer box={box} label="Comment on the pull request" leave={leave} />
        ) : (
          <div className="flex flex-wrap items-center gap-x-8 gap-y-4 py-4 text-fg-muted text-small">
            <span>
              Your comment on the pull request is open under its code block in the overview.
            </span>
            <Button variant="ghost" size="sm" onClick={() => bringToTimeline(view)}>
              Write it here
              {keys && <Key keys={keys} decorative />}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

export interface PullEditProps {
  readonly tab: PullTab;
  /** The comment it edits, by its node ID. */
  readonly comment: string;
  /** Gives focus back to the timeline. */
  readonly leave: () => void;
}

/** The box that edits your comment `comment` on the pull request, while it's open. */
export function PullEdit({ tab, comment, leave }: PullEditProps): ReactNode {
  const box = useTabState(timelineBoxes, tab.id, (boxes) => boxes.edits.get(comment));
  if (!box) return null;
  return <TimelineComposer box={box} label="Edit your comment" leave={leave} />;
}

/** The comments on view `view`'s pull request whose edit boxes are open, by their node IDs. */
export function useEditingOnPull(view: string): ReadonlySet<string> {
  const edits = useTabState(timelineBoxes, view, (boxes) => boxes.edits);
  return useMemo(() => new Set(edits.keys()), [edits]);
}

export interface PullNoteProps {
  readonly tab: PullTab;
  readonly comment: PullComment;
}

/**
 * What the card of your comment `comment` says while its delete's answer was lost: that Lo is
 * checking whether it went, or that it didn't, or may not have, with "Try again", which asks again.
 */
export function PullNote({ tab, comment }: PullNoteProps): ReactNode {
  const view = tab.id;
  const asked = useTabState(acting, view, (acts) => acts.get(comment.id));
  const isClosed = useTabState(closedActs, view, (rows) => asked !== undefined && rows.has(asked));
  // The comment is still in the timeline, so what was asked doesn't show.
  const note = asked && noteOf(asked, false, isClosed);
  if (!note || !asked) return null;
  return (
    <div className="mb-8">
      <ActCallout
        note={note}
        onAgain={() => {
          closeAct(view, asked);
          removeOnPull(tab, comment);
        }}
        onClose={() => closeAct(view, asked)}
      />
    </div>
  );
}
