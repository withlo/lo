// What the comments say in a pull request's tab's status bar: how many drafts the diff, drawn
// again, had nowhere to open, "2 kept drafts". A click opens their list over it, a row each, where
// each draft is: "retry.ts · line 41 · r2". "Show kept drafts" opens the same list from the
// palette and the app menu.

import { Popover, StatusItem } from '@lo/ui';

import { useTabState, type PullTab } from '../../tab/window/shared.ts';
import { keptAway, keptCount, keptOpen } from './boxes.ts';

export function KeptStatus({ tab }: { tab: PullTab }) {
  const kept = useTabState(keptAway, tab.id);
  const open = useTabState(keptOpen, tab.id);
  const count = keptCount(kept);
  if (count === undefined) return null;
  // The item is the list's trigger, which opens and closes it, and the list opens over it.
  return (
    <Popover
      open={open}
      onOpenChange={(next) => keptOpen.set(tab.id, next)}
      trigger={<StatusItem title="Show kept drafts">{count}</StatusItem>}
      side="top"
      align="start"
      label="Kept drafts"
      className="max-w-toast-w p-8"
    >
      <ul className="flex flex-col gap-2 text-fg text-small">
        {kept.map((each) => (
          <li key={each.box} className="px-4 py-2 break-words">
            {each.where}
          </li>
        ))}
      </ul>
    </Popover>
  );
}
