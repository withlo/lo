import type { MouseEvent } from 'react';

import { Button } from './Button.tsx';
import { Icon } from './Icon.tsx';

export interface MoreButtonProps {
  /** What it's the actions of, where a row has several: "More actions for retry.ts". */
  label?: string | undefined;
}

/** The words a `⋯` button is named with, and its tooltip. */
export const MORE_ACTIONS = 'More actions';

/**
 * Opens the menu of `control`'s surface under it, as a right-click there does: the surface hears
 * a `contextmenu` at the control's corner and opens its own menu, so the button and the right-click
 * can never list different things.
 */
export function openMenuUnder(control: Element): void {
  const { left, bottom } = control.getBoundingClientRect();
  control.dispatchEvent(
    new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: left,
      clientY: bottom,
    }),
  );
}

/**
 * The `⋯` button: anything with a right-click menu has one, which opens that menu under itself.
 * It goes inside the element whose right-click opens the menu, at the end of its row.
 */
export function MoreButton({ label = MORE_ACTIONS }: MoreButtonProps) {
  return (
    <Button
      variant="ghost"
      size="sm"
      icon
      aria-label={label}
      aria-haspopup="menu"
      hint={label}
      onClick={(event: MouseEvent<HTMLButtonElement>) => openMenuUnder(event.currentTarget)}
    >
      <Icon name="ellipsis" size={16} />
    </Button>
  );
}
