// The overview's mark in the header's view switch: whether there's an overview, and whether it's
// out of date or can't be shown.

import type { PullTab } from '../../tab/window/shared.ts';
import { markWords } from './facts.ts';
import { useOverviewMark } from './shared.ts';

export function OverviewMark({ tab }: { tab: PullTab }) {
  const mark = useOverviewMark(tab.id);
  // Its room is kept while Lo finds out, so the switch doesn't move as the mark comes.
  if (mark === undefined) {
    return <span className="lo-ovmark lo-ovmark--pending" aria-hidden="true" data-lo-ovmark="" />;
  }
  const words = markWords(mark);
  return (
    <span
      className={`lo-ovmark lo-ovmark--${mark}`}
      role="img"
      aria-label={words}
      title={words}
      data-lo-ovmark={mark}
    />
  );
}
