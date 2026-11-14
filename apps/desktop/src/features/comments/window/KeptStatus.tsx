// What the comments say in a pull request's tab's status bar: each draft the diff, drawn again, had
// nowhere to open, where it is, and that it opens when its lines or its code block are shown again.

import { StatusItem } from '@lo/ui';

import { useTabState, type PullTab } from '../../tab/window/shared.ts';
import { keptAway } from './boxes.ts';

export function KeptStatus({ tab }: { tab: PullTab }) {
  const away = useTabState(keptAway, tab.id);
  return away.map(({ box, note, title }) => (
    <StatusItem key={box} title={title}>
      {note}
    </StatusItem>
  ));
}
