import type { MouseEvent } from 'react';

import { Button } from './Button.tsx';
import { Icon } from './Icon.tsx';

export interface MoreButtonProps {
  /** What it's the actions of, where a row has several: "More actions for retry.ts". */
  label?: string | undefined;
  /**
   * It's on every card or row of a list, as a comment's is, which its secondary actions are in: it
   * keeps its room, and shows only on the one under the pointer, the one the keyboard is on or has
   * focus in, and while its menu is open (`shy`, in the nearest element marked `data-shy-scope`).
   * `Tab` still stops at it, and shows it.
   */
  shy?: boolean | undefined;
}

/** The words a `⋯` button is named with, and its tooltip. */
export const MORE_ACTIONS = 'More actions';

/** The control whose `openMenuUnder` is asking for a menu now, while its right-click is heard. */
let asking: Element | undefined;

/**
 * Opens the menu of `control`'s surface under it, as a right-click there does: the surface hears
 * a `contextmenu` at the control's corner and opens its own menu, so the button and the right-click
 * can never list different things.
 */
export function openMenuUnder(control: Element): void {
  const { left, bottom } = control.getBoundingClientRect();
  asking = control;
  try {
    control.dispatchEvent(
      new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: left,
        clientY: bottom,
      }),
    );
  } finally {
    asking = undefined;
  }
}

/**
 * The control a menu opening now opens from, as a `⋯` does through `openMenuUnder`: asked while its
 * right-click is heard, as its surface opens the menu, it's what the menu says is expanded while
 * it's open (`ContextMenu`'s `opener`). Nothing, for a menu a right-click or a key opens.
 */
export function menuOpener(): Element | undefined {
  return asking;
}

/**
 * The `⋯` button: anything with a right-click menu has one, which opens that menu under itself.
 * It goes inside the element whose right-click opens the menu, at the end of its row.
 */
export function MoreButton({ label = MORE_ACTIONS, shy = false }: MoreButtonProps) {
  const button = (
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
  return shy ? <span className="flex flex-none shy">{button}</span> : button;
}
