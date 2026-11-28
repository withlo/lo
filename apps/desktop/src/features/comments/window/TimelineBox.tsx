// The comment boxes a pull request's timeline draws, outside any code view (`createComposer`), each
// in the frame every comment box has: the box at the timeline's end, which comments on the pull
// request itself, and the box that edits your comment there, in the comment's card. Each keeps its
// draft as main does. From the moment the box at the end sends its comment, the comment is the
// timeline's last row, and the box stands empty, as it will be once GitHub has the comment, taking
// nothing until then. The box keeps the room it took when it shrinks with no input of the
// reader's, so nothing around it moves; the next key, click or scroll lets it go. Under a comment
// whose delete's answer was lost, the card says how that stands.

import { Button, CommentBoxFootBar, CommentBoxHeadBar, Key } from '@lo/ui';
import { createComposer } from '@lo/ui/code';
import { KEY_EVENT } from '@lo/ui/commands';
import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type ReactNode,
  type RefObject,
} from 'react';

import { useTabState, type PullTab } from '../../tab/window/shared.ts';
import { acting, checkAgain, closeAct, closedActs, noteKey, noteOf, threw } from './acts.ts';
import {
  type Box,
  bringToTimeline,
  catchUpDrafts,
  drawnInTimeline,
  hintOf,
  inputsSoFar,
  knowPull,
  leftTimeline,
  sendingNow,
  timelineBox,
  timelineBoxes,
  timelineEvents,
  timelineFrame,
} from './boxes.ts';
import { boxKeys } from './boxkeys.ts';
import { ActCallout, ThrewProblem } from './Card.tsx';
import { type PullComment, removeOnPull, setPullBoxFocus } from './conversation.ts';
import { useNonce } from './page.ts';
import { ON_PULL, whereText } from './writing.ts';

/**
 * `box`'s editor, in its frame, drawn in this element for as long as it's here: taken from wherever
 * else it was drawn. `leave` gives focus back to the timeline, as `Esc` in it, or its going while it
 * had focus, does.
 */
function TimelineComposer({
  box,
  label,
  hint,
  leave,
}: {
  box: Box;
  label: string;
  /** What the box says while it's empty. */
  hint?: string | undefined;
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
      { draft: box.state.text, nonce, label, ...(hint === undefined ? {} : { hint }) },
      timelineEvents(box, back),
      timelineFrame(box),
    );
    drawnInTimeline(box, made, back);
    // In insert mode at once, so no key typed meanwhile goes to the timeline instead.
    if (box.focusOnOpen) {
      box.focusOnOpen = false;
      made.focus();
    }
    return () => {
      box.saveNow();
      // Unless it was closed already, as once it was sent, or taken elsewhere; one still open, as
      // the timeline goes, opens where it opens now, as under its block if the overview has it.
      leftTimeline(box, made);
      if (box.left === back) box.left = undefined;
    };
  }, [box, nonce, label, hint]);
  return <div ref={host} />;
}

/**
 * Keeps `outer` as tall as `inner` has been since the reader's last key, click or scroll, so that
 * when `inner` shrinks with no input of theirs, nothing after it, and nothing scrolled to the end,
 * moves. A key counts once the key listener says it's the reader's input (`KEY_EVENT`), those Lo's
 * commands take, such as `j`, among them. `away` changing lets it go too: the box's comment has
 * gone to the timeline's last row, which takes its room.
 */
function useHeldHeight(
  outer: RefObject<HTMLDivElement | null>,
  inner: RefObject<HTMLDivElement | null>,
  away: boolean,
): void {
  useLayoutEffect(() => {
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
    const events = [KEY_EVENT, 'pointerdown', 'wheel', 'touchstart'] as const;
    for (const event of events) document.addEventListener(event, input, true);
    return () => {
      observer.disconnect();
      for (const event of events) document.removeEventListener(event, input, true);
      held.style.minHeight = '';
    };
  }, [outer, inner, away]);
}

/** Whether `box`'s comment is on its way, or looked for: the timeline's last row shows it. */
function useAway(box: Box | undefined): boolean {
  return useSyncExternalStore(
    box?.subscribe ?? noSubscription,
    () => box !== undefined && sendingNow(box.state),
  );
}

/** Whether `box` holds no text. */
function useEmpty(box: Box | undefined): boolean {
  return useSyncExternalStore(
    box?.subscribe ?? noSubscription,
    () => box === undefined || box.state.text === '',
  );
}

function noSubscription(): () => void {
  return () => {};
}

/**
 * The box at the timeline's end as it stands while its comment is on its way, which the timeline's
 * last row shows: empty, as it will be once GitHub has the comment, and taking nothing, its height
 * the box's own when it was last empty, so nothing moves as the box comes back.
 */
function Away({ number, height }: { number: number; height: number | undefined }): ReactNode {
  const id = useId();
  return (
    <div
      inert
      aria-hidden="true"
      data-lo-timeline="away"
      className="lo-diffcomposer overflow-hidden"
      style={height === undefined ? undefined : { height }}
    >
      <div className="lo-diffcomposer__head">
        <CommentBoxHeadBar
          head={{ where: whereText(ON_PULL), previewKeys: boxKeys('preview'), held: true }}
        />
      </div>
      <div className="lo-diffcomposer__body">
        <div className="cm-content py-4 ps-6 text-fg-subtle code-text">{`Comment on #${number}`}</div>
      </div>
      <div className="lo-diffcomposer__foot">
        <CommentBoxFootBar
          id={id}
          foot={{
            attach: { disabled: true },
            discard: { disabled: true },
            actions: [
              {
                label: 'Send',
                icon: 'send',
                keys: boxKeys('addToReview'),
                primary: true,
                disabled: true,
              },
            ],
          }}
        />
      </div>
    </div>
  );
}

export interface PullBoxProps {
  readonly tab: PullTab;
  /** Gives focus back to the timeline. */
  readonly leave: () => void;
  /** The keys of `c` there, which brings the draft from a code block, as this system shows them. */
  readonly keys?: readonly string[] | undefined;
}

/**
 * What the box's place says while the pull request's draft opens elsewhere: under the code block it
 * was written on, or, while Lo is still checking whether the overview has that block, in no box yet.
 */
const AWAY: Readonly<Record<'block' | 'waits', string>> = {
  block: 'Draft in the overview',
  waits: 'Checking overview…',
};

/**
 * The box at the end of tab `tab`'s timeline, which comments on the pull request itself: its draft
 * as main keeps it, restored after a restart, and a new, empty box once GitHub takes the comment.
 * `c` in the timeline puts focus in it. While the draft opens under the code block it was written
 * on, or waits for Lo to tell whether it does, it says so in the box's place, and `c` brings it
 * here.
 */
export function PullBox({ tab, leave, keys }: PullBoxProps): ReactNode {
  const view = tab.id;
  const own = useTabState(timelineBoxes, view, (boxes) => boxes.own);
  const away = useTabState(timelineBoxes, view, (boxes) => boxes.away);
  const box = own ?? (away ? undefined : timelineBox(view, ON_PULL));
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const drawn = useRef<HTMLDivElement>(null);
  // Its comment on its way is the timeline's last row: the box stands empty meanwhile.
  const sent = useAway(box);
  const empty = useEmpty(box);
  const emptyHeight = useRef<number | undefined>(undefined);
  useEffect(() => {
    knowPull(tab);
    catchUpDrafts(view);
  }, [tab, view]);
  useEffect(
    () =>
      // The box brings itself on screen as it takes focus.
      setPullBoxFocus(view, () => box?.composer?.focus()),
    [view, box],
  );
  // How tall it is empty, which it stands as while its comment is on its way.
  useLayoutEffect(() => {
    const height = drawn.current?.getBoundingClientRect().height;
    if (empty && !sent && height !== undefined && height > 0) emptyHeight.current = height;
  }, [empty, sent, box]);
  // Focus in it as its comment goes goes to the timeline, whose keyboard is then on the comment.
  // Should the comment come back to the box, as when it couldn't be sent, focus left where it went,
  // with no key, click or scroll of the reader's since, comes back with it, to the note and the
  // text. A reader who moved on, as with `j`, stays where they went.
  const focusedAsSent = useRef(false);
  focusedAsSent.current = sent && (box?.state.focused ?? false);
  const handed = useRef<
    { readonly box: Box; readonly to: Element | null; readonly inputs: number } | undefined
  >(undefined);
  useLayoutEffect(() => {
    if (sent) {
      if (!focusedAsSent.current || !box) return;
      leave();
      handed.current = { box, to: document.activeElement, inputs: inputsSoFar() };
      return;
    }
    const was = handed.current;
    handed.current = undefined;
    if (!was || was.box !== box || was.to === null || document.activeElement !== was.to) return;
    if (inputsSoFar() !== was.inputs) return;
    was.box.composer?.focus();
  }, [sent, leave, box]);
  useHeldHeight(outer, inner, sent);
  return (
    <div ref={outer} data-lo-timeline="box">
      <div ref={inner}>
        {box ? (
          <>
            {sent && <Away number={tab.number} height={emptyHeight.current} />}
            <div ref={drawn} hidden={sent}>
              <TimelineComposer
                box={box}
                label={`Comment on #${tab.number}`}
                hint={hintOf(box.state.place, tab.number)}
                leave={leave}
              />
            </div>
          </>
        ) : (
          <div className="flex flex-wrap items-center gap-x-8 gap-y-4 py-4 text-fg-muted text-small">
            <span>{AWAY[away ?? 'block']}</span>
            <Button variant="ghost" size="sm" onClick={() => bringToTimeline(view)}>
              {`Comment on #${tab.number}`}
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
  return <TimelineComposer box={box} label="Edit comment" leave={leave} />;
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
 * checking whether it went, or that it didn't, with "Try again", which asks again, or may not have,
 * with "Check again", which looks again. Or that an edit or delete of it failed before GitHub had
 * it, with what came back.
 */
export function PullNote({ tab, comment }: PullNoteProps): ReactNode {
  const view = tab.id;
  const asked = useTabState(acting, view, (acts) => acts.get(comment.id));
  const isClosed = useTabState(
    closedActs,
    view,
    (keys) => asked !== undefined && keys.has(noteKey(asked)),
  );
  const thrown = useTabState(threw, view, (all) => all.get(comment.id));
  // The comment is still in the timeline, so what was asked doesn't show.
  const note = asked && noteOf(asked, false, isClosed);
  // A write that failed before GitHub had it says so in the note's place: one note on a card.
  if (thrown) {
    return (
      <div className="mb-8">
        <ThrewProblem view={view} id={comment.id} thrown={thrown} />
      </div>
    );
  }
  if (!note || !asked) return null;
  return (
    <div className="mb-8">
      <ActCallout
        note={note}
        onAgain={() => {
          // Nobody knows whether it went: only a look is safe.
          if (note.again === 'check') {
            checkAgain(tab, asked);
            return;
          }
          closeAct(view, asked);
          removeOnPull(tab, comment);
        }}
        onClose={() => closeAct(view, asked)}
      />
    </div>
  );
}
