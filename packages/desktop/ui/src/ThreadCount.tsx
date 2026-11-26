import { threadWords } from './counts.ts';
import { Icon } from './Icon.tsx';
import { Tooltip } from './Tooltip.tsx';

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
    <Tooltip label={said}>
      <span
        role="img"
        aria-label={said}
        data-open={open ? '' : undefined}
        className={`lo-num inline-flex flex-none items-center gap-2 text-micro ${open ? 'text-fg' : 'text-fg-muted'}`}
      >
        <Icon name="message-square" size={12} />
        {total}
      </span>
    </Tooltip>
  );
}
