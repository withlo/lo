import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

import { useHeld, whenSettled } from './motion.ts';

export interface CollapseProps {
  /** Whether what it holds is there. */
  open: boolean;
  /**
   * Opens as it first draws, too. Without it, something already open when its view is first drawn
   * is just there, and only a later change moves.
   */
  appear?: boolean | undefined;
  /** What comes and goes. It may go to nothing the moment `open` turns false. */
  children?: ReactNode;
  /**
   * It has closed and is gone from the page, once its move has run. Unlike a popup's `onClosed`,
   * which comes as the popup starts to leave, this comes once what it held has left.
   */
  onGone?: (() => void) | undefined;
  /** Classes for the box that grows, such as where it sits in a grid. Its gaps go inside it. */
  className?: string | undefined;
}

/**
 * The Open move: something in the flow of a view comes by taking its height and fading in, and
 * what's below it moves once. It goes the same way, faster. A thread, a reply, a banner, a fold and
 * a callout come and go in one.
 *
 * It draws nothing while closed, and keeps what it held, as it was, until it has gone, so a caller
 * renders `<Collapse open={error !== undefined}>{error && <Callout … />}</Collapse>` and nothing
 * more. What's leaving takes no focus and no clicks. Opened again before it has gone, it turns back
 * from where it is.
 */
export function Collapse({ open, appear = false, children, onGone, className }: CollapseProps) {
  const [shown, setShown] = useState(open);
  if (open && !shown) setShown(true);
  const held = useHeld(open, children);
  // Open at first, with nothing asking it to move: there, with no move. Once it has closed, each
  // opening moves.
  const still = useRef(open && !appear);
  if (!open) still.current = false;

  const element = useRef<HTMLDivElement>(null);
  const gone = useRef(onGone);
  gone.current = onGone;
  useLayoutEffect(() => {
    const box = element.current;
    if (!box) return undefined;
    // Clipped only while it moves, so a focus ring at its edge shows whole at rest.
    box.setAttribute('data-moving', '');
    return whenSettled(box, () => {
      box.removeAttribute('data-moving');
      if (open) return;
      setShown(false);
      gone.current?.();
    });
  }, [open, shown]);

  if (!open && !shown) return null;
  return (
    <div
      ref={element}
      className={className === undefined ? 'move-open' : `move-open ${className}`}
      data-appear={still.current ? undefined : ''}
      data-closed={open ? undefined : ''}
      aria-hidden={open ? undefined : true}
      inert={!open}
    >
      <div>{held}</div>
    </div>
  );
}

/** The class that runs the Swap move. */
const SWAP_CLASS = 'move-swap';

export interface SwapProps {
  /**
   * Names what's shown: `loading`, `diff`. What's shown fades in when it changes. With `keep`,
   * nothing named yet is `undefined`, and what it first names doesn't move either.
   */
  id: string | undefined;
  /**
   * Keeps what it holds, rather than drawing it anew, as `id` changes: for content that holds its
   * own state, or that's drawn outside React, such as a code view, or middle views kept drawn while
   * hidden. The box fades in as it is, once its content has changed.
   */
  keep?: boolean | undefined;
  children?: ReactNode;
  /** Classes for the box, which is the same box whatever it shows. */
  className?: string | undefined;
}

/**
 * The Swap move: what replaces something in the same box fades in over it, and nothing slides. A
 * skeleton gives way to its content, and Overview to Diff, in one. What's there when it first draws
 * doesn't move.
 *
 * It draws what it holds anew for each `id`, so the move starts with it. With `keep`, it keeps what
 * it holds, and starts the move on the box itself in the frame `id` changes: the caller changes the
 * content in that frame too.
 */
export function Swap({ id, keep = false, children, className }: SwapProps) {
  const first = useRef<string | undefined>(id);
  if (first.current !== id) first.current = undefined;
  const box = useRef<HTMLDivElement>(null);
  const named = useRef(id);
  useLayoutEffect(() => {
    const before = named.current;
    named.current = id;
    const element = box.current;
    if (!keep || !element || before === undefined || id === undefined || before === id) {
      return undefined;
    }
    return swapIn(element);
  }, [keep, id]);
  if (keep) {
    return (
      <div ref={box} className={className}>
        {children}
      </div>
    );
  }
  const move = first.current === undefined ? SWAP_CLASS : '';
  return (
    <div key={id} className={className === undefined ? move : `${move} ${className}`}>
      {children}
    </div>
  );
}

/**
 * Starts the Swap move on `element` afresh, and takes it off once it has run, so the box's own
 * classes stay as React drew them. Returns a function that stops listening for its end.
 */
function swapIn(element: HTMLElement): () => void {
  element.classList.remove(SWAP_CLASS);
  // Read once, so the move starts again rather than going on from where the last one was.
  void element.getBoundingClientRect();
  element.classList.add(SWAP_CLASS);
  const ended = (event: Event) => {
    if (event.target !== element) return;
    element.classList.remove(SWAP_CLASS);
    stop();
  };
  const stop = () => {
    element.removeEventListener('animationend', ended);
    element.removeEventListener('animationcancel', ended);
  };
  element.addEventListener('animationend', ended);
  element.addEventListener('animationcancel', ended);
  return stop;
}
