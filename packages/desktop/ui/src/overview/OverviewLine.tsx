// A quiet line under an overview's byline: an icon, one fact, and the one thing to do about it, as
// a hint. "Adds 2 definitions · changes 1" with "Go to glossary", or "Part of a 4-layer stack" with
// "Stack overview" `g s`. It reports nothing new and asks for nothing: what it says is there to
// read, and its hint goes there.

import type { ReactNode } from 'react';

import { HintButton } from '../HintButton.tsx';
import { HintRow } from '../HintRow.tsx';
import { Icon } from '../Icon.tsx';
import type { IconName } from '../icons.ts';
import type { TermHint } from './TermCard.tsx';

export interface OverviewLineProps {
  /** What it's about, by its icon's name in `icons.ts`: `book-a`, `layers`. */
  icon: IconName;
  /** The fact, as text: "Adds 2 definitions · changes 1". */
  children: ReactNode;
  /** Its one hint: the command that goes where the fact points, on what, and its words. */
  action: TermHint;
}

/**
 * One line, 24 px high: a 14 px icon in `lo-icon-muted`, the fact in `text-small` and
 * `lo-fg-muted`, then its hint, `lo-sp-6` apart. Too narrow for all of it, the fact is cut short,
 * never the hint.
 */
export function OverviewLine({ icon, children, action }: OverviewLineProps) {
  return (
    <HintRow className="h-24 items-center gap-6 text-fg-muted text-small" role="note">
      <span className="flex flex-none text-icon-muted">
        <Icon name={icon} size={14} />
      </span>
      <span className="min-w-0 truncate">{children}</span>
      <span className="flex flex-none">
        <HintButton command={action.command} target={action.target}>
          {action.label}
        </HintButton>
      </span>
    </HintRow>
  );
}
