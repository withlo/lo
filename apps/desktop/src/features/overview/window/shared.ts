// What the overview shares with other features' window code: its mark for a tab, as the header's
// view switch shows it, which the stack's tree shows for the layer on screen.

import { usePull } from '../../tab/window/shared.ts';
import { markOf, newestHead, type MarkKind } from './facts.ts';
import { useStanding } from './hooks.ts';

/**
 * Whether there's an overview: one for the newest push (`current`), for an older one (`stale`), one
 * that can't be shown (`error`), or none.
 */
export type OverviewMark = MarkKind;

/**
 * The overview's mark for view `tab` of a pull request's tab, re-rendering as it changes: nothing
 * while Lo is still finding out.
 */
export function useOverviewMark(tab: string): OverviewMark | undefined {
  const standing = useStanding(tab);
  const pull = usePull(tab);
  return markOf(standing, newestHead(pull));
}
