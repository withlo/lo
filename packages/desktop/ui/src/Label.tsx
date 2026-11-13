import type { ReactNode } from 'react';

/** GitHub gives a label's color as six hex digits, with or without the `#`. */
const COLOR = /^#?([0-9a-f]{6})$/i;

/**
 * The CSS color for a label's `color`, or undefined when it isn't six hex digits. A label's color
 * comes from the repository, so only that shape is ever set: nothing else it might hold, such as
 * an address, reaches the style.
 */
export function labelColor(color: string): string | undefined {
  const digits = COLOR.exec(color)?.[1];
  return digits === undefined ? undefined : `#${digits.toLowerCase()}`;
}

export interface LabelProps {
  /** The label's own color, as GitHub gives it. */
  color: string;
  /** Its name. */
  children: ReactNode;
}

/**
 * One of the pull request's labels: its name, after a dot in the label's own color. The color is
 * set through the style property, since it isn't one of Lo's, so no class is ever built from it.
 */
export function Label({ color, children }: LabelProps) {
  const fill = labelColor(color);
  return (
    <span className="inline-flex h-20 flex-none items-center gap-6 rounded-pill px-8 text-small-medium whitespace-nowrap text-fg inset-ring inset-ring-border-strong">
      <span
        className={`size-8 flex-none rounded-pill ${fill === undefined ? 'bg-fg-muted' : ''}`}
        style={fill === undefined ? undefined : { backgroundColor: fill }}
        aria-hidden="true"
      />
      {children}
    </span>
  );
}
