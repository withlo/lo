// What the comments say in a pull request's tab's status bar: the drafts the diff, drawn again, had
// nowhere to open, each kept until its lines or its code block are drawn again.

import { StatusItem } from '@lo/ui';

import { useTabState, type PullTab } from '../../tab/window/shared.ts';
import { keptAway } from './boxes.ts';

export function KeptStatus({ tab }: { tab: PullTab }) {
  const away = useTabState(keptAway, tab.id);
  if (away.length === 0) return null;
  return (
    <StatusItem title={away.map((each) => each.why).join('\n')}>
      {away.length === 1 ? 'Draft kept' : `${away.length} drafts kept`}
    </StatusItem>
  );
}
