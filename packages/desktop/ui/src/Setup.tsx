import { cva } from 'class-variance-authority';
import type { ReactNode } from 'react';

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
      <svg className="lo-i lo-i--sm flex-none text-success" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M3.5 8.5 6.5 11.5 12.5 4.5" />
      </svg>
      {children}
    </span>
  );
}

export interface SetupItemProps {
  /** An icon drawn on a 16 px grid, as the design's icons are. */
  icon: ReactNode;
  /** What the step is, in six words at most. */
  title: ReactNode;
  /** What it adds, in a line. */
  description: ReactNode;
  /**
   * Where it stands once it's done, in a word: "Installed". It takes the button's place, as a
   * `SetupDone`.
   */
  done?: ReactNode;
  /** One picture of what the step adds, under its line. */
  figure?: ReactNode;
  /** Its one button, at the end of the row, while it isn't done. */
  children?: ReactNode;
}

/**
 * One thing to set up: an icon, what it is and adds, and its own button, which gives way to the
 * step's state once it's done.
 */
export function SetupItem({ icon, title, description, done, figure, children }: SetupItemProps) {
  const end = done !== undefined ? <SetupDone>{done}</SetupDone> : children;
  return (
    <li className="setup-item border-t border-border-subtle px-16 py-12 first:border-t-0">
      <span className="row-span-2 text-icon-muted" aria-hidden="true">
        {icon}
      </span>
      <span className="text-ui-strong">{title}</span>
      <span className="col-start-2 text-fg-muted text-small">{description}</span>
      {end !== undefined && <span className="col-start-3 row-span-2 row-start-1">{end}</span>}
      {figure !== undefined && <div className="col-span-2 col-start-2 pt-8">{figure}</div>}
    </li>
  );
}
