// The overview's mark in the header's view switch: whether there's an overview, and whether it's
// out of date or can't be shown.

import { usePull, type PullTab } from '../../tab/window/shared.ts';
import { markOf, markWords, newestHead } from './facts.ts';
import { useStanding } from './hooks.ts';

export function OverviewMark({ tab }: { tab: PullTab }) {
  const standing = useStanding(tab.id);
  const pull = usePull(tab.id);
  const mark = markOf(standing, newestHead(pull));
  if (mark === undefined) return null;
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
