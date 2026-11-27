import { cva } from 'class-variance-authority';
import { useRef, type Ref, type RefObject } from 'react';

import { withoutBidi } from './controls.ts';
import { givenUp } from './cut.ts';
import { Key, keyAria } from './Key.tsx';
import { Tooltip } from './Tooltip.tsx';

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
      ready: 'bg-success text-success',
      waiting: 'bg-warning text-warning',
      blocked: 'bg-danger text-danger',
      queued: 'bg-queue text-queue',
      auto: 'bg-accent text-accent',
      merged: 'bg-state-merged text-state-merged',
      closed: 'bg-state-closed text-state-closed',
    },
    // It just landed here, with nothing else to say so: it fills, once.
    fills: { true: 'move-fill', false: '' },
    size: {
      // Beside a line of small text, in the header.
      sm: 'size-8',
      // Before a panel's verdict.
      md: 'verdict-dot',
    },
  },
  defaultVariants: { size: 'sm' },
});

/**
 * The dot for how a pull request stands on merging. It says nothing alone: words go beside it.
 * With `fills`, it fills from a ring over 260 ms as it's drawn.
 */
export function MergeDot({
  kind,
  size,
  fills = false,
}: {
  kind: MergeKind;
  size?: 'sm' | 'md' | undefined;
  fills?: boolean | undefined;
}) {
  return <span className={dot({ kind, size, fills })} aria-hidden="true" />;
}

export interface MergeStatusProps {
  kind: MergeKind;
  /** The verdict, in a few words: "Ready to merge", "Can't merge yet", "Queued, 3rd". */
  verdict: string;
  /** The reasons or the method after it, on the same line: "Review required · 2 checks running". */
  detail?: string | undefined;
  /** The key that opens the merge panel, shown at its end, and in its tooltip, "Merge panel". */
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
  /**
   * The merge it stands for has just landed, with no dialog open to say so: the dot fills, once,
   * over 260 ms. Give it only on the draw the pull request turns `merged`.
   */
  landed?: boolean | undefined;
}

const line =
  'inline-flex h-control-h flex-none items-center rounded-sm border border-border px-8 whitespace-nowrap text-fg-muted text-small';

/**
 * Whether a pull request can merge, as a dot and one line in the header: a strong verdict, then the
 * reasons or the method after it. A click, or its key, opens the merge panel, which lists every
 * reason. It's never cut: the row it's in gives up its key chip, its detail (`detail`) and then its
 * verdict (`title`), each whole, which leaves the dot alone. Both are still heard, and its tooltip
 * says them.
 */
export function MergeStatus({
  kind,
  verdict,
  detail,
  keys,
  onClick,
  expanded,
  ref,
  landed = false,
}: MergeStatusProps) {
  const said = withoutBidi(verdict);
  const reasons = detail === undefined ? undefined : withoutBidi(detail);
  const words = useRef<HTMLElement>(null);
  const more = useRef<HTMLElement>(null);
  const content = (
    <span className="flex items-center gap-8">
      {/* A new dot as it lands, so its fill plays then and only then. */}
      <MergeDot key={landed ? 'landed' : 'still'} kind={kind} fills={landed} />
      <strong ref={words} data-gives="title" className="flex-none font-semibold text-fg">
        {said}
      </strong>
      {reasons !== undefined && reasons !== '' && (
        // Given up, still heard: nothing else says it.
        <span ref={more} data-gives="detail" data-heard className="flex-none">
          {reasons}
        </span>
      )}
      {keys !== undefined && onClick !== undefined && <Key keys={keys} decorative />}
    </span>
  );
  // Not a control, with nothing to name: what it says is all there is, and its tooltip once it's
  // given up some of it.
  if (onClick === undefined) {
    return (
      <Tooltip label={reasons ? `${said} · ${reasons}` : said} cut>
        <span className={line}>{content}</span>
      </Tooltip>
    );
  }
  return (
    <Tooltip label={<StatusTip said={said} reasons={reasons} parts={[words, more]} />} keys={keys}>
      <button
        ref={ref}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={expanded}
        {...keyAria(keys, undefined, 'Merge panel')}
        className={`${line} hover:bg-hover hover:text-fg focus-visible:shadow-ring`}
        onClick={onClick}
      >
        {content}
      </button>
    </Tooltip>
  );
}

/**
 * The status's tooltip, read as it opens: what it's a control for, or, once the row it's in has
 * given up its detail or its verdict, what it says: the verdict and the reasons.
 */
function StatusTip({
  said,
  reasons,
  parts,
}: {
  said: string;
  reasons: string | undefined;
  parts: readonly RefObject<HTMLElement | null>[];
}) {
  const cut = parts.some(({ current }) => current !== null && givenUp(current));
  if (!cut) return <span>Merge panel</span>;
  return <span>{reasons ? `${said} · ${reasons}` : said}</span>;
}
