export interface MarkProps {
  /** More classes for the mark, such as its size. It is at least 16 px. */
  className?: string | undefined;
}

/**
 * Lo's mark: an L holding a ball lifted out of its socket, in the mark's color, which is chalk on
 * dark grounds and ink on light ones. These are the shapes of `brand/logo/mark.svg`; it takes no
 * other color, and keeps the ball's radius clear on every side.
 */
export function Mark({ className }: MarkProps) {
  return (
    <svg className={className} viewBox="12 12 76 76" role="img" aria-label="Lo">
      <g className="fill-mark">
        <path d="M12 21A9 9 0 0 1 30 21V44A26 26 0 0 0 56 70H79A9 9 0 0 1 79 88H20Q12 88 12 80Z" />
        <circle cx="65" cy="35" r="21" />
      </g>
    </svg>
  );
}
