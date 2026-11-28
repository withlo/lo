import type { HTMLAttributes, MouseEvent, ReactNode, Ref } from 'react';

import { Button } from './Button.tsx';
import { Callout } from './Callout.tsx';
import { Icon } from './Icon.tsx';
import { openMenuUnder, pressedByKey } from './MoreButton.tsx';

/** What Dismiss is named, and its tooltip. */
export const DISMISS = 'Dismiss';

export interface DismissButtonProps {
  /** Puts it away at once, for news the reader has seen. */
  onDismiss?: (() => void) | undefined;
  /**
   * It asks where to dismiss it, for an offer or advice: it opens the menu of the element it's in,
   * as `MoreButton` does, whose rows are the choices ("Dismiss for #264", "Dismiss for all
   * stacks"). Give that element the menu (a right-click target), so the two can't differ, and make
   * it a `notice` scope whose target is the same, so `⇧F10` on Dismiss opens it too.
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
        if (choices) openMenuUnder(event.currentTarget, pressedByKey(event));
        else onDismiss?.();
      }}
      {...rest}
    >
      <Icon name="x" size={16} />
    </Button>
  );
}

export interface OfferProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  /** Its element, for the `notice` scope it is. */
  ref?: Ref<HTMLDivElement> | undefined;
  /** What Lo could do, in one line, as a fact: "This branch stack merges one layer at a time." */
  line: ReactNode;
  /** The one thing to do about it: its command's button. */
  action: ReactNode;
  /**
   * In a panel among other parts, as the merge panel's, it sits in an info `Callout`'s box, its
   * line in body text after the box's icon, so it reads apart from them. Over what it's about, as
   * over the stack's tree, it has no box, and its line is muted.
   */
  boxed?: boolean | undefined;
}

/**
 * An offer, on the control or panel it belongs to: its line with Dismiss at its end, and its button
 * under it. Dismiss asks where to dismiss it, so give the offer the right-click menu of those
 * choices (`onContextMenu`, in `rest`), and make it a `notice` scope with the same target
 * (`data-lo-scope` and `ref`): Dismiss opens that menu under itself, as `⇧F10` on it does. An offer
 * made in two places, as the stack's tree's and the merge panel's, has the same target in both.
 */
export function Offer({ line, action, boxed = false, className = '', ...rest }: OfferProps) {
  const parts = (
    <>
      <div className="flex w-full min-w-0 items-start gap-4">
        <p className={boxed ? 'm-0 min-w-0 flex-1' : 'm-0 min-w-0 flex-1 text-fg-muted'}>{line}</p>
        {/* On the line, and no taller than it, so the button under it stays where it was. */}
        <span className="-me-4 flex h-1lh flex-none items-center">
          <DismissButton choices />
        </span>
      </div>
      {action}
    </>
  );
  if (!boxed) {
    return (
      <div className={`flex flex-col items-start gap-6 text-small ${className}`} {...rest}>
        {parts}
      </div>
    );
  }
  return (
    <div className={className === '' ? undefined : className} {...rest}>
      <Callout tone="info">
        <div className="flex flex-col items-start gap-8">{parts}</div>
      </Callout>
    </div>
  );
}
