// What the overview says in a pull request's tab's status bar: that an overview that came after the
// tab opened on its diff is ready, with the key that shows it.

import { Key, StatusItem } from '@lo/ui';

import { useKeys } from '../../../window/commands/registry.ts';
import { useKnownSetting } from '../../settings/window/shared.ts';
import { showMiddle, useMiddle, useTabState, type PullTab } from '../../tab/window/shared.ts';
import { open } from '../settings.ts';
import { knownOf } from './facts.ts';
import { useStanding } from './hooks.ts';
import { keyOf, OVERVIEW_VIEW, stepKeyOf } from './labels.ts';
import { offered, openings } from './opening.ts';

export function OverviewStatus({ tab }: { tab: PullTab }) {
  useKeys();
  const standing = useStanding(tab.id);
  const opened = useTabState(openings, tab.id);
  const setting = useKnownSetting(open);
  const { shown, ids } = useMiddle(tab.id);
  const onScreen = shown === OVERVIEW_VIEW;
  if (!onScreen && offered(opened, knownOf(standing), setting)) {
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
  return null;
}
