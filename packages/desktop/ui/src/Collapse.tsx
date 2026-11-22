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

export interface SwapProps {
  /** Names what's shown: `loading`, `diff`. What's shown fades in when it changes. */
  id: string;
  children?: ReactNode;
  /** Classes for the box, which is the same box whatever it shows. */
  className?: string | undefined;
}

/**
 * The Swap move: what replaces something in the same box fades in over it, and nothing slides. A
 * skeleton gives way to its content, and Overview to Diff, in one. What's there when it first draws
 * doesn't move.
 */
export function Swap({ id, children, className }: SwapProps) {
  const first = useRef<string | undefined>(id);
  if (first.current !== id) first.current = undefined;
  const move = first.current === undefined ? 'move-swap' : '';
  return (
    <div key={id} className={className === undefined ? move : `${move} ${className}`}>
      {children}
    </div>
  );
}
