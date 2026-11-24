import { cva } from 'class-variance-authority';

// One size wherever it turns: a busy button's ring's, beside text of the interface's size.
const spinner = cva('inline-block size-12 spinner', {
  variants: {
    tone: {
      accent: '',
      // On a fill of its own, such as a button at work: the color of the words beside it.
      current: 'spinner-current',
    },
  },
  defaultVariants: { tone: 'accent' },
});

export interface SpinnerProps {
  /** `current` takes the color of the text beside it, for a control with a fill of its own. */
  tone?: 'accent' | 'current' | undefined;
}

/**
 * A wait in place, for something small: a tab opening, the local copy fetching. A control at work
 * shows one through `busy` on `Button`, and a whole view waits with `Loading` instead. Screen
 * readers hear what's waiting from its place.
 */
export function Spinner({ tone }: SpinnerProps) {
  return <span className={spinner({ tone })} aria-hidden="true" />;
}

/**
 * Where text goes once it arrives: a bar, its width set by where it sits. Lay skeletons out as the
 * content will be, and put both in one `Swap`, so the content fades in over them in the same box.
 */
export function Skeleton({ className = '' }: { className?: string | undefined }) {
  return <span className={`skeleton ${className}`} aria-hidden="true" />;
}
