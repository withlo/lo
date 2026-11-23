// The code index's item in a pull request's tab's status bar: "Indexing code · 1,204 / 3,880"
// while it builds, with how far it has got in its details, "Code index" once it's ready, with how
// much a partial one has, and why, in its details, and why one couldn't be built, with when it's
// built again and "Try now".

import { Countdown, Meter, Problem, StatusItem, StatusLine } from '@lo/ui';
import { useEffect } from 'react';

import { useTabState, type PullTab } from '../../tab/window/shared.ts';
import { catchUpIndex, indexes, indexItem, retryIndex } from './indexes.ts';

export function IndexStatus({ tab }: { tab: PullTab }) {
  const state = useTabState(indexes, tab.id);
  useEffect(() => catchUpIndex(tab.id), [tab.id]);
  const item = indexItem(state);
  if (!item) return null;
  const { failure, progress } = item;
  const details =
    failure !== undefined ? (
      <Problem
        title="Can’t index the code"
        reason={
          failure.retryAt === null ? undefined : (
            <>
              Retrying <Countdown at={failure.retryAt} />.
            </>
          )
        }
        action={{
          label: failure.retryAt === null ? 'Try again' : 'Try now',
          onClick: () => retryIndex(tab.id),
        }}
        details={failure.message === '' ? undefined : failure.message}
      />
    ) : item.lines !== undefined ? (
      <>
        <StatusLine>{item.lines.join(' ')}</StatusLine>
        {progress !== undefined && (
          <Meter value={progress.done} max={progress.total} label={item.text} />
        )}
      </>
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
