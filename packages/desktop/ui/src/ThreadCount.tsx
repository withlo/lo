import { COMMENT_PATH, threadWords } from './counts.ts';

/** A speech bubble on the 16 grid, the mark of a comment. */
export function CommentIcon() {
  return (
    <svg className="lo-i lo-i--xs" viewBox="0 0 16 16" aria-hidden="true">
      <path d={COMMENT_PATH} />
    </svg>
  );
}

export interface ThreadCountProps {
  /** How many threads there are. */
  total: number;
  /** How many of them are unresolved. */
  unresolved: number;
}

/**
 * A file's threads as a comment mark and a number, in the file tree and on a file's header. It
 * stands out while any thread is unresolved, and shows nothing for a file with none.
 */
export function ThreadCount({ total, unresolved }: ThreadCountProps) {
  if (total <= 0) return null;
  const open = unresolved > 0;
  const said = threadWords(total, unresolved);
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
