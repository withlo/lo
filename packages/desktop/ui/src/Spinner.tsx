import { cva } from 'class-variance-authority';

const spinner = cva('inline-block spinner', {
  variants: {
    size: {
      // In a tab, beside its number.
      xs: 'size-8',
      sm: 'size-12',
    },
    tone: {
      accent: '',
      // On a fill of its own, such as a button at work: the color of the words beside it.
      current: 'spinner-current',
    },
  },
  defaultVariants: { size: 'sm', tone: 'accent' },
});

export interface SpinnerProps {
  size?: 'xs' | 'sm' | undefined;
  /** `current` takes the color of the text beside it, for a control with a fill of its own. */
  tone?: 'accent' | 'current' | undefined;
}

/**
 * A wait in place, for something small: a tab opening, the local copy fetching. A control at work
 * shows one through `busy` on `Button`, and a whole view waits with `Loading` instead. Screen
 * readers hear what's waiting from its place.
 */
export function Spinner({ size, tone }: SpinnerProps) {
  return <span className={spinner({ size, tone })} aria-hidden="true" />;
}

/**
 * Where text goes once it arrives: a bar, its width set by where it sits. Lay skeletons out as the
 * content will be, and put both in one `Swap`, so the content fades in over them in the same box.
 */
export function Skeleton({ className = '' }: { className?: string | undefined }) {
  return <span className={`skeleton ${className}`} aria-hidden="true" />;
}
