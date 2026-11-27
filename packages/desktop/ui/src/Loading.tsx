import { cva } from 'class-variance-authority';
import { useEffect, useState } from 'react';

import { Button } from './Button.tsx';
import { Key } from './Key.tsx';
import { LogoMotion } from './LogoMotion.tsx';

/** How long a view waits with nothing shown before `Loading` appears: a quick load never shows it. */
export const LOADING_DELAY_MS = 300;

/** How long a wait runs before `Loading` says what's slow and offers to cancel. */
export const LOADING_SLOW_MS = 8000;

/** What marks a `Loading` on the page. */
const LOADING_ATTRIBUTE = 'data-lo-loading';

/**
 * Whether `element` shows a `Loading`, or holds one: a view with nothing to draw yet, which hasn't
 * laid out what it will show. A switch to it keeps what it replaces drawn meanwhile.
 */
export function loadingIn(element: Element): boolean {
  return (
    element.matches(`[${LOADING_ATTRIBUTE}]`) ||
    element.querySelector(`[${LOADING_ATTRIBUTE}]`) !== null
  );
}

export interface LoadingProps {
  /** The wait, as a progress label: "Fetching diff…". */
  status: string;
  /**
   * What's slow, named once the wait has run eight seconds, in place of `status`: "Waiting for
   * GitHub…". Without it the status stays.
   */
  slow?: string | undefined;
  /** Gives the wait up. Offered as "Cancel" once the wait has run eight seconds. */
  onCancel?: (() => void) | undefined;
  /** The key that cancels, as the system shows each key of it. */
  cancelKeys?: readonly string[] | undefined;
  /**
   * When the wait began, as `Date.now()` gives it, where that was before this was drawn. A wait
   * that one view after another draws, as a tab's does while it opens, counts from here in each of
   * them, so the mark doesn't go and come back, and what's slow is said eight seconds into the
   * wait, not into its last view. The mark is where it would be had it gone round since then, and
   * what the wait already showed is there at once. Without it the wait begins as this is drawn.
   */
  since?: number | undefined;
  /**
   * The line the wait showed last, in the view that drew it before this one, as a tab's opening
   * hands its wait from view to view. A line of its own swaps in over it, as a new line does within
   * one view; the same line is there at once. Without it, what shows at first is this one's own.
   */
  before?: string | undefined;
  /** Hears each line it shows, as it shows it, for the next view of the same wait to carry on. */
  onLine?: ((line: string) => void) | undefined;
}

type Stage = 'early' | 'waiting' | 'slow';

const lineOf = cva('m-0 min-h-1lh text-center text-fg-muted text-ui', {
  variants: { swaps: { true: 'move-swap', false: '' } },
});

/** How far a wait has got, `waited` milliseconds in. */
function stageAfter(waited: number): Stage {
  if (waited >= LOADING_SLOW_MS) return 'slow';
  return waited >= LOADING_DELAY_MS ? 'waiting' : 'early';
}

/**
 * How a view waits when it has nothing to draw yet: the mark melding, round and round, over one
 * line that names the wait. It fills the view it's in, and stays empty for its first 300 ms, so a
 * load that's quick shows nothing at all. After eight seconds its line says what's slow and it
 * offers "Cancel".
 *
 * It's the first of the three ways Lo waits. A view whose shape is known waits as a `Skeleton` laid
 * out as its content will be, and a control at work is `busy`.
 */
export function Loading({
  status,
  slow,
  onCancel,
  cancelKeys,
  since,
  before,
  onLine,
}: LoadingProps) {
  const [drawn] = useState(Date.now);
  const began = since ?? drawn;
  const [wait, setWait] = useState(() => ({ began, waited: Date.now() - began }));
  if (wait.began !== began) setWait({ began, waited: Date.now() - began });
  useEffect(() => {
    // A timer may run a moment before it's due by the clock: it has waited its time all the same.
    const timers = [LOADING_DELAY_MS, LOADING_SLOW_MS]
      .filter((due) => Date.now() - began < due)
      .map((due) =>
        setTimeout(
          () => setWait({ began, waited: Math.max(due, Date.now() - began) }),
          began + due - Date.now(),
        ),
      );
    return () => {
      for (const timer of timers) clearTimeout(timer);
    };
  }, [began]);

  const stage = stageAfter(wait.waited);
  const late = stage === 'slow';
  const line = late && slow !== undefined ? slow : status;
  // What was already showing as this was drawn, in a wait another view drew before: it's there at
  // once, with nothing coming in again, and a line of this view's own swaps in over the last.
  const [found] = useState(() => ({ stage: stageAfter(Date.now() - began), line: before ?? line }));
  const shows = stage === 'early' ? undefined : line;
  useEffect(() => {
    if (shows !== undefined) onLine?.(shows);
  }, [shows, onLine]);
  return (
    <div
      role="status"
      className="flex h-full min-h-0 flex-col items-center justify-center gap-16 px-16"
      {...{ [LOADING_ATTRIBUTE]: '' }}
    >
      {stage !== 'early' && (
        <>
          <LogoMotion
            play="meld"
            since={began + LOADING_DELAY_MS}
            className={found.stage === 'early' ? 'size-48 move-swap' : 'size-48'}
            decorative
          />
          <div className="flex flex-col items-center gap-12">
            {/* A new line swaps in under the mark, which keeps going round. */}
            <p
              key={line}
              className={lineOf({ swaps: found.stage === 'early' || found.line !== line })}
            >
              {line}
            </p>
            {/* Its room is kept from the start, so nothing shifts when it comes. */}
            {onCancel !== undefined && (
              <div
                className={late ? (found.stage === 'slow' ? undefined : 'move-swap') : 'invisible'}
              >
                <Button size="sm" onClick={onCancel} tabIndex={late ? undefined : -1}>
                  Cancel
                  {cancelKeys && <Key keys={cancelKeys} decorative />}
                </Button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
