import { cva } from 'class-variance-authority';

const spinner = cva('inline-block spinner', {
  variants: {
    size: {
      // In a tab, beside its number.
      xs: 'size-8',
      sm: 'size-12',
    },
  },
  defaultVariants: { size: 'sm' },
});

export interface SpinnerProps {
  size?: 'xs' | 'sm' | undefined;
}

/**
 * A wait in place, for something small: a tab opening, the local copy fetching. A whole view
 * waits with the brand's meld loop instead. Screen readers hear what's waiting from its place.
 */
export function Spinner({ size }: SpinnerProps) {
  return <span className={spinner({ size })} aria-hidden="true" />;
}

/** Where text goes once it arrives: a bar, its width set by where it sits. */
export function Skeleton({ className = '' }: { className?: string | undefined }) {
  return <span className={`skeleton ${className}`} aria-hidden="true" />;
}
