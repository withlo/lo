import { cva } from 'class-variance-authority';
import type { ReactNode } from 'react';

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

/**
 * Where a toast floats, at the bottom right of the window above its status bar. The region is
 * always there and says each toast as it comes, so a screen reader hears it.
 */
export function ToastRegion({ children }: { children?: ReactNode }) {
  return (
    <div role="status" aria-atomic="true" className="toast-floating">
      {children}
    </div>
  );
}
