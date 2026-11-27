import { useRef, type ReactNode } from 'react';

import { useGiveUp } from '../giveUp.ts';
import { Icon } from '../Icon.tsx';
import { Tooltip } from '../Tooltip.tsx';

/** What it gives up where it's narrow: its button beside its text, for a column of its own. */
const STEPS = ['beside'] as const;

/**
 * Over an overview written for an older push than the pull request is at: what it was written
 * for and where the pull request is, in `title`; how much changed since, in `detail`, as it comes;
 * and what to do, `actions`. It's as tall from its first frame as it stays, whatever `detail` says,
 * so nothing under it moves as what changed since comes in. Where its button doesn't fit beside
 * its text, it's one column: the icon on the first line, the button under the text.
 */
export function OutOfDate({
  title,
  detail,
  actions,
}: {
  title: string;
  detail: string;
  actions?: ReactNode;
}) {
  const row = useRef<HTMLDivElement>(null);
  useGiveUp(row, STEPS);
  return (
    <div className="lo-ov-stales">
      <div ref={row} className="lo-ov-stale" role="status" data-lo-stale="">
        <Icon name="triangle-exclamation-point" size={16} />
        {/* Beside the button only while it shows whole. */}
        <Tooltip label={title} cut>
          <div className="lo-ov-stale__title" data-fit="">
            {title}
          </div>
        </Tooltip>
        <Tooltip label={detail === '' ? null : detail} cut>
          <div className="lo-ov-stale__sub">{detail}</div>
        </Tooltip>
        <div className="lo-ov-stale__actions">{actions}</div>
      </div>
    </div>
  );
}
