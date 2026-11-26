import { cva } from 'class-variance-authority';
import type { ReactNode } from 'react';

import { Collapse } from './Collapse.tsx';
import { Icon } from './Icon.tsx';
import type { IconName } from './icons.ts';

export type SetupListProps = {
  /** The `SetupItem`s. */
  children?: ReactNode;
} & (
  | {
      /** What the list is called, for screen readers, where no heading names it. */
      label: string;
      labelledBy?: undefined;
    }
  | {
      label?: undefined;
      /** The id of the heading that names the list. */
      labelledBy: string;
    }
);

/** A short list of things to set up, set into the ground one row to a step. */
export function SetupList({ children, label, labelledBy }: SetupListProps) {
  return (
    <ul
      aria-label={label}
      aria-labelledby={labelledBy}
      className="m-0 flex list-none flex-col rounded-md border border-border bg-bg-chrome p-0"
    >
      {children}
    </ul>
  );
}

export interface SetupDoneProps {
  /** The fact, in a word or a few: "Installed", "Signed in as ravi-k". */
  children: ReactNode;
  /** The size of the button it stands in for: a row's small one, unless it says. */
  size?: 'sm' | 'md' | undefined;
}

const fact = cva('inline-flex items-center gap-6 text-fg-muted', {
  variants: { size: { sm: 'h-control-h-sm text-small', md: 'h-control-h text-ui' } },
});

/**
 * A step that's done, said where its button was: a tick and the fact. It's as tall as the button
 * it replaces, so the row holds still. A fact is never a dimmed button.
 */
export function SetupDone({ children, size = 'sm' }: SetupDoneProps) {
  return (
    <span className={fact({ size })}>
      <Icon name="check" size={size === 'sm' ? 12 : 14} className="text-success" />
      {children}
    </span>
  );
}

export interface SetupItemProps {
  /**
   * Its icon, by its name in `icons.ts`, at 16 px beside its title and line, as an empty list's
   * is. A row that's a setting, with the control its row in Settings has, has none.
   */
  icon?: IconName | undefined;
  /** What the step is, in six words at most. */
  title: ReactNode;
  /** What it adds, in a line. */
  description: ReactNode;
  /**
   * Where it stands once it's done, in a word: "Installed". It takes the button's place, as a
   * `SetupDone`.
   */
  done?: ReactNode;
  /**
   * What its button's last press left to say, under its line: a step still to take, such as a
   * folder to add to `PATH`, or a `Problem` where it failed. It opens and closes as `Collapse` does.
   */
  below?: ReactNode;
  /** Its one button, or its setting's control, at the end of the row, while it isn't done. */
  children?: ReactNode;
}

/** A row's columns: with an icon before its words, or its words from the row's start. */
const item = cva('border-t border-border-subtle px-16 py-12 first:border-t-0', {
  variants: { icon: { true: 'setup-item', false: 'setup-item-plain' } },
});

/** Where a row's words, its end and what's under it go, with an icon before them or without. */
const COLUMNS = {
  true: { words: 'col-start-2', end: 'col-start-3', below: 'col-span-2 col-start-2' },
  false: { words: 'col-start-1', end: 'col-start-2', below: 'col-span-2 col-start-1' },
} as const;

/**
 * One thing to set up: an icon, what it is and adds, and its own button, which gives way to the
 * step's state once it's done.
 */
export function SetupItem({ icon, title, description, done, below, children }: SetupItemProps) {
  const end = done !== undefined ? <SetupDone>{done}</SetupDone> : children;
  const drawn = icon !== undefined;
  const columns = COLUMNS[`${drawn}`];
  return (
    <li className={item({ icon: drawn })}>
      {drawn && (
        <span className="row-span-2 flex text-icon-muted">
          <Icon name={icon} size={16} />
        </span>
      )}
      <span className={`${columns.words} text-ui-strong`}>{title}</span>
      <span className={`${columns.words} text-fg-muted text-small`}>{description}</span>
      {end !== undefined && <span className={`${columns.end} row-span-2 row-start-1`}>{end}</span>}
      {/* It comes and goes as the press that left it does, moving the rows under it once. */}
      <Collapse open={below !== undefined && below !== null} className={columns.below}>
        {below !== undefined && below !== null && <div className="pt-6">{below}</div>}
      </Collapse>
    </li>
  );
}
