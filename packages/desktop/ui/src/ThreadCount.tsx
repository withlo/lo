/** A speech bubble on the 16 grid, the mark of a comment. */
export function CommentIcon() {
  return (
    <svg className="lo-i lo-i--xs" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2.75 3.25c0-.55.45-1 1-1h8.5c.55 0 1 .45 1 1v6.5c0 .55-.45 1-1 1H7.5L4.75 13v-2.25h-1c-.55 0-1-.45-1-1Z" />
    </svg>
  );
}

export interface ThreadCountProps {
  /** How many threads there are. */
  total: number;
  /** How many of them are unresolved. */
  unresolved: number;
}

/** What the count says in words, for its tooltip and for screen readers. */
function words({ total, unresolved }: ThreadCountProps): string {
  if (unresolved === 0)
    return total === 1 ? '1 thread, resolved' : `${total} threads, all resolved`;
  if (unresolved === total) return `${unresolved} unresolved`;
  return `${unresolved} unresolved of ${total}`;
}

/**
 * A file's threads as a comment mark and a number, in the file tree and on a file's header. It
 * stands out while any thread is unresolved, and shows nothing for a file with none.
 */
export function ThreadCount({ total, unresolved }: ThreadCountProps) {
  if (total <= 0) return null;
  const open = unresolved > 0;
  const said = words({ total, unresolved });
  return (
    <span
      role="img"
      aria-label={said}
      title={said}
      data-open={open ? '' : undefined}
      className={`lo-num inline-flex flex-none items-center gap-2 text-micro ${open ? 'text-fg' : 'text-fg-muted'}`}
    >
      <CommentIcon />
      {total}
    </span>
  );
}
