// What the overview says in a pull request's tab's status bar: that an overview that came after the
// tab opened on its diff is ready, with the key that shows it; and, while the overview's view shows
// there's none, that Lo watches its ref.

import { Key, StatusItem } from '@lo/ui';

import { useKeys } from '../../../window/commands/registry.ts';
import { showMiddle, useMiddle, useTabState, type PullTab } from '../../tab/window/shared.ts';
import { knownOf } from './facts.ts';
import { useStanding } from './hooks.ts';
import { keyOf, OVERVIEW_VIEW, stepKeyOf } from './labels.ts';
import { offered, openings } from './opening.ts';
import { states } from './store.ts';

export function OverviewStatus({ tab }: { tab: PullTab }) {
  useKeys();
  const standing = useStanding(tab.id);
  const state = useTabState(states, tab.id);
  const opened = useTabState(openings, tab.id);
  const { shown, ids } = useMiddle(tab.id);
  const onScreen = shown === OVERVIEW_VIEW;
  if (!onScreen && offered(opened, knownOf(standing))) {
    const keys = keyOf(stepKeyOf(ids, shown, OVERVIEW_VIEW));
    return (
      <StatusItem dot="busy" onClick={() => showMiddle(tab.id, OVERVIEW_VIEW)}>
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
  if (onScreen && standing.kind === 'none' && state?.watching === true) {
    return <StatusItem>Watching {state.ref}</StatusItem>;
  }
  return null;
}
