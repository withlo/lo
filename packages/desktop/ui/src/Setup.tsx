import type { ReactNode } from 'react';

export interface SetupListProps {
  /** The `SetupItem`s. */
  children?: ReactNode;
  /** What the list is called, for screen readers. */
  label: string;
}

/** A short list of optional steps, set into the ground one row to a step. */
export function SetupList({ children, label }: SetupListProps) {
  return (
    <ul
      aria-label={label}
      className="m-0 flex list-none flex-col rounded-md border border-border bg-bg-chrome p-0"
    >
      {children}
    </ul>
  );
}

export interface SetupItemProps {
  /** An icon drawn on a 16 px grid, as the design's icons are. */
  icon: ReactNode;
  /** What the step is. */
  title: ReactNode;
  /** What it does, in a line. */
  description: ReactNode;
  /** Its button, at the end of the row. */
  children?: ReactNode;
}

/** One optional step: an icon, what it is and does, and its own button. */
export function SetupItem({ icon, title, description, children }: SetupItemProps) {
  return (
    <li className="setup-item border-t border-border-subtle px-16 py-12 first:border-t-0">
      <span className="row-span-2 text-icon-muted" aria-hidden="true">
        {icon}
      </span>
      <span className="text-ui-strong">{title}</span>
      <span className="col-start-2 text-fg-muted text-small">{description}</span>
      {children !== undefined && (
        <span className="col-start-3 row-span-2 row-start-1">{children}</span>
      )}
    </li>
  );
}
