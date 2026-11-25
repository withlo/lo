// What the overview says in a pull request's tab's status bar: that an overview that came after the
// tab went to its timeline for want of one is ready, with the key that shows it.

import { Key, StatusItem } from '@lo/ui';

import { useKeys } from '../../../window/commands/registry.ts';
import { showMiddle, useMiddle, useTabState, type PullTab } from '../../tab/window/shared.ts';
import { knownOf } from './facts.ts';
import { useStanding } from './hooks.ts';
import { keyOf, OVERVIEW_VIEW, stepKeyOf } from './labels.ts';
import { offered, openings } from './opening.ts';

export function OverviewStatus({ tab }: { tab: PullTab }) {
  useKeys();
  const standing = useStanding(tab.id);
  const opened = useTabState(openings, tab.id);
  const { shown, ids } = useMiddle(tab.id);
  const onScreen = shown === OVERVIEW_VIEW;
  if (!onScreen && offered(opened, knownOf(standing))) {
    const keys = keyOf(stepKeyOf(ids, shown, OVERVIEW_VIEW));
    return (
      <StatusItem ball="ready" onClick={() => showMiddle(tab.id, OVERVIEW_VIEW)}>
        Overview ready
        {keys !== undefined && (
          <>
            <span aria-hidden="true">·</span>
            <Key keys={keys} quiet decorative />
          </>
        )}
      </StatusItem>
    );
  }
  return null;
}
