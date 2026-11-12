import type { ReactNode } from 'react';

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
        <svg className="lo-i" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M7.13 2.5a1 1 0 0 1 1.74 0l5.2 9.5a1 1 0 0 1-.87 1.5H2.8a1 1 0 0 1-.87-1.5Z" />
          <path d="M8 6.25v3M8 11.25v.01" />
        </svg>
        <div className="lo-ov-stale__title" title={title}>
          {title}
        </div>
        <div className="lo-ov-stale__sub" title={detail === '' ? undefined : detail}>
          {detail}
        </div>
        <div className="lo-ov-stale__actions">{actions}</div>
      </div>
    </div>
  );
}
