// What the comments say in a pull request's tab's status bar: how many drafts the diff, drawn
// again, had nowhere to open, "2 kept drafts". A click opens their list over it, a row each, where
// each draft is: "retry.ts · line 41 · r2". "Show kept drafts" opens the same list from the
// palette and the app menu.

import { Popover, StatusItem } from '@lo/ui';
import { useState } from 'react';

import { useTabState, type PullTab } from '../../tab/window/shared.ts';
import { keptAway, keptCount, keptOpen } from './boxes.ts';

export function KeptStatus({ tab }: { tab: PullTab }) {
  const kept = useTabState(keptAway, tab.id);
  const open = useTabState(keptOpen, tab.id);
  // The list opens over the item, which is drawn before it can be the list's anchor.
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const count = keptCount(kept);
  if (count === undefined) return null;
  return (
    <>
      <span ref={setAnchor} className="inline-flex min-w-0">
        <StatusItem title="Show kept drafts" onClick={() => keptOpen.set(tab.id, !open)}>
          {count}
        </StatusItem>
      </span>
      <Popover
        open={open && anchor !== null}
        onOpenChange={(next) => keptOpen.set(tab.id, next)}
        anchor={anchor}
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
    </>
  );
}
