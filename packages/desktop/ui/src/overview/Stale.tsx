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
 * its text, it's one column: the icon on the first line, the button under the text. Given
 * `widest`, the title and actions at their widest, it's laid out for those whatever it says, so its
 * layout and its height depend on its width alone, as its labels change.
 */
export function OutOfDate({
  title,
  detail,
  actions,
  widest,
}: {
  title: string;
  detail: string;
  actions?: ReactNode;
  /**
   * What its title and actions say at their widest, as they say the commits by their short ids
   * before the revisions are named: drawn out of sight under them, holding their room.
   */
  widest?: { readonly title: string; readonly actions?: ReactNode } | undefined;
}) {
  const row = useRef<HTMLDivElement>(null);
  useGiveUp(row, STEPS);
  return (
    <div className="lo-ov-stales">
      <div ref={row} className="lo-ov-stale" role="status" data-lo-stale="">
        <Icon name="triangle-exclamation-point" size={16} />
        {/* Beside the button only while it shows whole, and its widest would. */}
        <div className="lo-ov-stale__head">
          <Tooltip label={title} cut>
            <div className="lo-ov-stale__title" data-fit="">
              {title}
            </div>
          </Tooltip>
          {widest !== undefined && (
            <div aria-hidden="true" className="lo-ov-stale__widest" data-fit="">
              {widest.title}
            </div>
          )}
        </div>
        <Tooltip label={detail === '' ? null : detail} cut>
          <div className="lo-ov-stale__sub">{detail}</div>
        </Tooltip>
        <div className="lo-ov-stale__actions">
          <div className="lo-ov-stale__buttons">{actions}</div>
          {widest?.actions !== undefined && (
            <div aria-hidden="true" inert className="lo-ov-stale__buttons lo-ov-stale__widest">
              {widest.actions}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
