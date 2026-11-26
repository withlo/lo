import type { ReactNode } from 'react';

import { Glyphs } from './Icon.tsx';

/**
 * A button that reads as a link, for what a card or a row points to. The window never follows an
 * address itself: the caller opens the page, and only an `https://` one. A label's characters the
 * fonts don't hold, as the `↗` of "Open the run ↗", are drawn as their icons (`Glyphs`).
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
      {typeof children === 'string' ? <Glyphs text={children} /> : children}
    </button>
  );
}
