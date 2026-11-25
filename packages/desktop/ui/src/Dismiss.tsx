import type { HTMLAttributes, MouseEvent, ReactNode } from 'react';

import { Button } from './Button.tsx';
import { openMenuUnder } from './MoreButton.tsx';

/** What Dismiss is named, and its tooltip. */
export const DISMISS = 'Dismiss';

export interface DismissButtonProps {
  /** Puts it away at once, for news the reader has seen. */
  onDismiss?: (() => void) | undefined;
  /**
   * It asks where to dismiss it, for an offer or advice: it opens the menu of the element it's in,
   * as `MoreButton` does, whose rows are the choices ("Dismiss for #264", "Dismiss for all
   * stacks"). Give that element the menu (a right-click target), so the two can't differ.
   */
  choices?: boolean | undefined;
  /** What a banner marks its buttons with, for focus to go to the same one on the next. */
  'data-lo-banner'?: string | undefined;
}

/**
 * Dismiss: the `×` at the end of a message or an offer. News goes at once. An offer or advice asks
 * where, with `choices`: for this pull request where it's tied to one, or for all, which its
 * setting brings back.
 */
export function DismissButton({ onDismiss, choices = false, ...rest }: DismissButtonProps) {
  return (
    <Button
      size="sm"
      variant="ghost"
      icon
      aria-label={DISMISS}
      aria-haspopup={choices ? 'menu' : undefined}
      hint={DISMISS}
      onClick={(event: MouseEvent<HTMLButtonElement>) => {
        if (choices) openMenuUnder(event.currentTarget);
        else onDismiss?.();
      }}
      {...rest}
    >
      <svg className="lo-i lo-i--xs" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M4 4l8 8M12 4l-8 8" />
      </svg>
    </Button>
  );
}

export interface OfferProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  /** What Lo could do, in one line, as a fact: "This branch stack merges one layer at a time." */
  line: ReactNode;
  /** The one thing to do about it: its command's button. */
  action: ReactNode;
}

/**
 * An offer, on the control or panel it belongs to: its line with Dismiss at its end, and its button
 * under it. Dismiss asks where to dismiss it, so give the offer the right-click menu of those
 * choices (`onContextMenu`, in `rest`): Dismiss opens the same menu under itself.
 */
export function Offer({ line, action, className = '', ...rest }: OfferProps) {
  return (
    <div className={`flex flex-col items-start gap-6 text-small ${className}`} {...rest}>
      <div className="flex w-full min-w-0 items-start gap-4">
        <p className="m-0 min-w-0 flex-1 text-fg-muted">{line}</p>
        {/* On the line, and no taller than it, so the button under it stays where it was. */}
        <span className="-me-4 flex h-1lh flex-none items-center">
          <DismissButton choices />
        </span>
      </div>
      {action}
    </div>
  );
}
