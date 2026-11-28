// A switch of a pull request's tab's middle view, from one view to another: what's drawn stays
// until what replaces it is ready and laid out. The view the switch leaves stays on screen, taking
// no input, and the one it shows is drawn unseen over it, taking focus and keys as it draws, so a
// key typed mid-switch lands in it. Once that one has laid out, it fades in over the other in one
// Swap, and the other goes once the move has run: no frame shows the middle empty.
//
// A view has laid out once it shows no `Loading`, a frame after it's drawn. One that hasn't by the
// time a wait shows its loading state (`LOADING_DELAY_MS`) is shown then, with its own wait or its
// error: a switch never holds longer. A view that only comes, as the code beside a view does, or
// only goes, does so at once, and so does a switch from views that only wait, drawing the tab's
// placeholder: there's nothing drawn to keep, and the view coming takes their wait over, as the
// timeline does when a tab that waited on its overview finds there's none.

import { LOADING_DELAY_MS, loadingIn, whenSettled } from '@lo/ui';
import { useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';

/** How a middle view is drawn. */
export type Drawn =
  /** On screen. */
  | 'seen'
  /** Wanted on screen, drawn unseen over what it replaces while it lays out. */
  | 'coming'
  /** Left by a switch, on screen under what replaces it, taking no input. */
  | 'under'
  /** Drawn and hidden, as a view shown before stays. */
  | 'hidden';

/** What a tab's middle shows, as the reader sees it. */
interface Shown {
  /** The views on screen, left to right. */
  readonly seen: readonly string[];
  /** The views the last switch left, under those that replaced them until their Swap has run. */
  readonly under: readonly string[];
  /** The views that replaced them. */
  readonly came: readonly string[];
  /** Which switch's move that is: each reveal is a new one. */
  readonly move: number;
}

export interface HoldOptions {
  /** Whether a switch holds: not while the views aren't drawn, as when the pull request can't be shown. */
  readonly holds: boolean;
  /** Where view `id` is drawn, to see whether it has laid out. */
  readonly element: (id: string) => Element | null;
  /** Whether view `id` draws only the tab's placeholder, a wait the view coming takes over. */
  readonly waiting: (id: string) => boolean;
  /**
   * Starts the Swap of views `came` in over views `went`, and gives what moves: the one move each
   * waits for before what it replaced goes.
   */
  readonly swap: (came: readonly string[], went: readonly string[]) => readonly Element[];
}

function same(one: readonly string[], other: readonly string[]): boolean {
  return one.length === other.length && one.every((id, at) => other[at] === id);
}

/** Ends the moves on `elements` where they'd end, as a switch made before they have does. */
function finish(elements: readonly Element[]): void {
  for (const element of elements) {
    if (typeof element.getAnimations !== 'function') continue;
    for (const animation of element.getAnimations()) animation.finish();
  }
}

/**
 * How each of a tab's middle views is drawn, with `want` the views to show, left to right, as the
 * tab has them: a switch from one to another holds the one it leaves on screen until the other has
 * laid out, then swaps it in over it.
 */
export function useHold(want: readonly string[], options: HoldOptions): (id: string) => Drawn {
  const [shown, setShown] = useState<Shown>(() => ({ seen: want, under: [], came: [], move: 0 }));
  const coming = want.filter((id) => !shown.seen.includes(id));
  const leaving = shown.seen.filter((id) => !want.includes(id));
  const switching =
    options.holds &&
    coming.length > 0 &&
    leaving.length > 0 &&
    !leaving.every((id) => options.waiting(id));
  // A view that only comes or goes, even while a switch's move runs, as the code does beside a
  // view, or a switch from views that only wait: that move goes on, and what it left goes once it
  // has run.
  if (!switching && !same(shown.seen, want)) {
    setShown({ ...shown, seen: want, under: shown.under.filter((id) => !want.includes(id)) });
  }
  // While a switch holds, what it leaves is under what's coming, and what an earlier switch left is
  // gone: that switch's move ends as this one starts.
  const under = switching ? leaving : shown.under;

  const latest = useRef({ want, coming, options, shown });
  latest.current = { want, coming, options, shown };
  /** When the switch under way began, holding since. */
  const since = useRef<number | undefined>(undefined);
  /** Ends the last switch's move where it would end, while it runs. */
  const moving = useRef<(() => void) | undefined>(undefined);

  const comingKey = switching ? coming.join('\n') : '';
  useLayoutEffect(() => {
    if (!switching) {
      since.current = undefined;
      return undefined;
    }
    moving.current?.();
    moving.current = undefined;
    since.current ??= Date.now();
    const until = since.current + LOADING_DELAY_MS;
    const reveal = () => {
      const now = latest.current.want;
      flushSync(() =>
        setShown((was) => ({
          seen: now,
          under: was.seen.filter((id) => !now.includes(id)),
          came: now.filter((id) => !was.seen.includes(id)),
          move: was.move + 1,
        })),
      );
    };
    const laidOut = () =>
      latest.current.coming.every((id) => {
        const element = latest.current.options.element(id);
        return element !== null && !loadingIn(element);
      });
    // Looked at each frame, before it's drawn: a view drawn since has been laid out by then.
    let frame = requestAnimationFrame(function look() {
      if (laidOut() || Date.now() >= until) reveal();
      else frame = requestAnimationFrame(look);
    });
    // A window that's hidden draws no frames, and the switch doesn't wait for one.
    const bound = setTimeout(reveal, Math.max(0, until - Date.now()));
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(bound);
    };
  }, [switching, comingKey]);

  // As what came is seen, it fades in over what it replaced, which goes once the move has run.
  useLayoutEffect(() => {
    const { came, under: left, move } = latest.current.shown;
    if (came.length === 0 || left.length === 0) return undefined;
    const moves = latest.current.options.swap(came, left);
    const gone = () => {
      moving.current = undefined;
      setShown((was) => (was.move === move ? { ...was, under: [], came: [] } : was));
    };
    let running = moves.length;
    const stops = moves.map((element) =>
      whenSettled(element, () => {
        running -= 1;
        if (running === 0) gone();
      }),
    );
    const stop = () => {
      for (const each of stops) each();
    };
    if (moves.length === 0) gone();
    else {
      // A switch made before it has run ends it where it would end, and what it left goes then.
      moving.current = () => {
        stop();
        finish(moves);
        gone();
      };
    }
    return stop;
  }, [shown.move]);

  return (id) => {
    if (want.includes(id)) return switching && !shown.seen.includes(id) ? 'coming' : 'seen';
    return under.includes(id) ? 'under' : 'hidden';
  };
}
