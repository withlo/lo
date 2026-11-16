// The syntax index's item in a pull request's tab's status bar: "Syntax index 1,204 / 3,880" while
// it builds, "Syntax index" once it's ready, "Syntax index partial" with how much on hover.

import { StatusItem } from '@lo/ui';
import { useEffect } from 'react';

import { useTabState, type PullTab } from '../../tab/window/shared.ts';
import { catchUpIndex, indexes, indexItem } from './indexes.ts';

export function IndexStatus({ tab }: { tab: PullTab }) {
  const state = useTabState(indexes, tab.id);
  useEffect(() => catchUpIndex(tab.id), [tab.id]);
  const item = indexItem(state);
  if (!item) return null;
  return (
    <StatusItem dot={item.dot} title={item.title}>
      {item.text}
    </StatusItem>
  );
}
