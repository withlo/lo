import type { ReactNode } from 'react';

import { Icon } from '../Icon.tsx';
import { Tooltip } from '../Tooltip.tsx';

/**
 * Over an overview written for an older push than the pull request is at: what it was written
 * for and where the pull request is, in `title`; how much changed since, in `detail`, as it comes;
 * and what to do, `actions`. It's as tall from its first frame as it stays, whatever `detail` says,
 * at any width, so nothing under it moves as what changed since comes in.
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
  return (
    <div className="lo-ov-stales">
      <div className="lo-ov-stale" role="status" data-lo-stale="">
        <Icon name="triangle-exclamation-point" size={16} />
        <Tooltip label={title} cut>
          <div className="lo-ov-stale__title">{title}</div>
        </Tooltip>
        <Tooltip label={detail === '' ? null : detail} cut>
          <div className="lo-ov-stale__sub">{detail}</div>
        </Tooltip>
        <div className="lo-ov-stale__actions">{actions}</div>
      </div>
    </div>
  );
}
