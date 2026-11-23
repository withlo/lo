// The code index's item in a pull request's tab's status bar: "Indexing code · 1,204 / 3,880"
// while it builds, "Code index" once it's ready, with how much a partial one has, and why, in its
// details, and why one couldn't be built.

import { Problem, StatusItem, StatusLine } from '@lo/ui';
import { useEffect } from 'react';

import { useTabState, type PullTab } from '../../tab/window/shared.ts';
import { catchUpIndex, indexes, indexItem } from './indexes.ts';

export function IndexStatus({ tab }: { tab: PullTab }) {
  const state = useTabState(indexes, tab.id);
  useEffect(() => catchUpIndex(tab.id), [tab.id]);
  const item = indexItem(state);
  if (!item) return null;
  const details =
    item.failure !== undefined ? (
      <Problem title="Can’t index the code" details={item.failure} />
    ) : item.lines !== undefined ? (
      <StatusLine>{item.lines.join(' ')}</StatusLine>
    ) : undefined;
  return (
    <StatusItem
      ball={item.ball}
      details={details}
      label={item.text}
      container={document.getElementById('root')}
    >
      {item.text}
    </StatusItem>
  );
}
