import { cva } from 'class-variance-authority';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

const icon = cva('flex-none', {
  variants: {
    tone: {
      info: 'text-info',
      success: 'text-success',
      warning: 'text-warning',
      danger: 'text-danger',
    },
  },
});

export type ToastTone = 'info' | 'success' | 'warning' | 'danger';

export interface ToastProps {
  /** What the icon says, as its color: a status color never stands without an icon and a word. */
  tone: ToastTone;
  /** A 16 px icon, an `svg` with the `lo-i` class and `aria-hidden`. */
  icon: ReactNode;
  /** What happened, in a few words. */
  title: ReactNode;
  /** More about it. */
  body?: ReactNode;
  /** Buttons for what to do about it. */
  actions?: ReactNode;
}

/**
 * A quiet note when something finished or arrived: an icon, a title, a body and the buttons for
 * what to do about it. Not for an error that needs action, which is a banner or a callout in place.
 */
export function Toast({ tone, icon: mark, title, body, actions }: ToastProps) {
  return (
    <div className="grid w-toast-w toast items-start rounded-md bg-bg-overlay text-fg shadow-pop text-ui">
      <span className={icon({ tone })}>{mark}</span>
      <div className="font-semibold">{title}</div>
      {body !== undefined && <div className="col-start-2 text-fg-muted text-small">{body}</div>}
      {actions !== undefined && <div className="col-start-2 mt-8 flex gap-6">{actions}</div>}
    </div>
  );
}

export interface ToastRegionProps {
  children?: ReactNode;
  /** Toasts that stay until the reader acts on them. */
  waiting?: ReactNode;
  /**
   * Called with how tall the waiting toasts are, and with 0 once none is, so the window can leave
   * room for them: a toast that stays would otherwise sit over whatever is at the corner.
   */
  onWaitingHeight?: ((height: number) => void) | undefined;
}

/**
 * Where a toast floats, at the bottom right of the window above its status bar. The region is
 * always there and says each toast as it comes, so a screen reader hears it. `waiting` is for
 * toasts that stay until the reader acts on them: they sit below what the region says, in a live
 * region of their own that isn't atomic, so a screen reader hears each toast as it comes and the
 * part of it that changes, such as "Copy" turning to "Copied", and not all of it again each time,
 * nor again each time the note above comes. A `status` region is atomic unless it says it isn't.
 * While one waits the region sits at the foot of the window instead, where the window has made
 * room for it (`onWaitingHeight`), and a note passes above it.
 */
export function ToastRegion({ children, waiting, onWaitingHeight }: ToastRegionProps) {
  const held = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);
  const holding = waiting !== undefined;
  useLayoutEffect(() => {
    const element = held.current;
    if (!holding || !element || typeof ResizeObserver === 'undefined') return undefined;
    const measure = () => setHeight(element.offsetHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => {
      observer.disconnect();
      setHeight(0);
    };
  }, [holding]);
  useLayoutEffect(() => {
    onWaitingHeight?.(height);
  }, [height, onWaitingHeight]);
  useLayoutEffect(
    () => () => {
      onWaitingHeight?.(0);
    },
    [onWaitingHeight],
  );
  return (
    <div className="toast-floating" style={height > 0 ? { bottom: 'var(--lo-sp-12)' } : undefined}>
      <div role="status" aria-atomic="true">
        {children}
      </div>
      {holding && (
        <div
          ref={held}
          role="status"
          aria-atomic="false"
          className="mt-8 flex flex-col gap-8 empty:mt-0"
        >
          {waiting}
        </div>
      )}
    </div>
  );
}
