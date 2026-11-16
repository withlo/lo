import { cva } from 'class-variance-authority';
import type { Ref } from 'react';

import { withoutBidi } from './controls.ts';
import { Key, keyAria } from './Key.tsx';

/**
 * How a pull request stands on merging, which colors the dot and picks the words beside it:
 * `ready` can merge now; `waiting` can't yet, and waiting may fix it; `blocked` can't, and
 * something has to change; `queued` is in a merge queue; `auto` merges once what it waits for
 * passes; `merged` and `closed` are over.
 */
export type MergeKind = 'ready' | 'waiting' | 'blocked' | 'queued' | 'auto' | 'merged' | 'closed';

const dot = cva('flex-none rounded-pill', {
  variants: {
    kind: {
      ready: 'bg-success',
      waiting: 'bg-warning',
      blocked: 'bg-danger',
      queued: 'bg-queue',
      auto: 'bg-accent',
      merged: 'bg-state-merged',
      closed: 'bg-state-closed',
    },
    size: {
      // Beside a line of small text, in the header.
      sm: 'size-8',
      // Before a panel's verdict.
      md: 'verdict-dot',
    },
  },
  defaultVariants: { size: 'sm' },
});

/** The dot for how a pull request stands on merging. It says nothing alone: words go beside it. */
export function MergeDot({ kind, size }: { kind: MergeKind; size?: 'sm' | 'md' | undefined }) {
  return <span className={dot({ kind, size })} aria-hidden="true" />;
}

export interface MergeStatusProps {
  kind: MergeKind;
  /** The verdict, in a few words: "Ready to merge", "Can't merge yet", "Queued, 3rd". */
  verdict: string;
  /** The reasons or the method after it, on the same line: "Review required · 2 checks running". */
  detail?: string | undefined;
  /** What it says on hover. When Lo may not see every rule, it says so here. */
  title?: string | undefined;
  /** The key that opens the merge panel, shown at its end. */
  keys?: readonly string[] | undefined;
  /**
   * Opens the merge panel. Without it the status is only a line, as it is once a pull request has
   * merged or closed.
   */
  onClick?: (() => void) | undefined;
  /** Whether the merge panel it opens is open. */
  expanded?: boolean | undefined;
  /** The button, for the panel to open under. */
  ref?: Ref<HTMLButtonElement> | undefined;
}

const line =
  'inline-flex h-control-h min-w-0 items-center gap-8 rounded-sm border border-border px-8 whitespace-nowrap text-fg-muted text-small';

/**
 * Whether a pull request can merge, as a dot and one line in the header: a strong verdict, then the
 * reasons or the method after it. A click, or its key, opens the merge panel, which lists every
 * reason.
 */
export function MergeStatus({
  kind,
  verdict,
  detail,
  title,
  keys,
  onClick,
  expanded,
  ref,
}: MergeStatusProps) {
  const said = withoutBidi(verdict);
  const reasons = detail === undefined ? undefined : withoutBidi(detail);
  const content = (
    <>
      <MergeDot kind={kind} />
      <strong className="flex-none font-semibold text-fg">{said}</strong>
      {reasons !== undefined && reasons !== '' && (
        <span className="min-w-0 truncate">{reasons}</span>
      )}
      {keys !== undefined && onClick !== undefined && <Key keys={keys} decorative />}
    </>
  );
  if (onClick === undefined) {
    return (
      <span className={line} title={title}>
        {content}
      </span>
    );
  }
  return (
    <button
      ref={ref}
      type="button"
      title={title ?? (keys === undefined ? undefined : `Merge panel (${keys.join(' ')})`)}
      aria-haspopup="dialog"
      aria-expanded={expanded}
      {...keyAria(keys, undefined)}
      className={`${line} hover:bg-hover hover:text-fg focus-visible:shadow-ring`}
      onClick={onClick}
    >
      {content}
    </button>
  );
}
