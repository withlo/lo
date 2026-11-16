import type { ReactNode } from 'react';

/**
 * A button that reads as a link, for what a card or a row points to. The window never follows an
 * address itself: the caller opens the page, and only an `https://` one.
 */
export function LinkButton({
  children,
  onClick,
  label,
}: {
  children: ReactNode;
  onClick?: (() => void) | undefined;
  /** What a screen reader says in place of the text, when the text alone doesn't tell links apart. */
  label?: string | undefined;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      className="rounded-xs text-link underline-offset-2 text-small hover:text-link-hover hover:underline focus-visible:shadow-ring"
      onClick={onClick}
    >
      {children}
    </button>
  );
}
