// The code index's item in a pull request's tab's status bar: "Indexing code · 1,204 / 3,880" while
// it builds, "Code index" once it's ready, and why one couldn't be built. A click opens its details
// in every state: what the index is, its state, and once it's ready, the files it read in each
// language and when it was built; or why it couldn't be built, with when it's built again and
// "Try now".

import { Countdown, Problem, StatusFacts, StatusItem, StatusLine, type StatusFact } from '@lo/ui';
import { useEffect, useState } from 'react';

import { useTabState, type PullTab } from '../../tab/window/shared.ts';
import {
  catchUpIndex,
  indexes,
  indexItem,
  INDEX_LINE,
  retryIndex,
  type IndexFact,
} from './indexes.ts';

/** The time now, ticking each minute while `ticking`, for "Indexed 5 min ago". */
function useNow(ticking: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!ticking) return undefined;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, [ticking]);
  return ticking ? now : Date.now();
}

/** A fact as `StatusFacts` draws it: a partial index's reasons under its state. */
function drawn({ label, value, why }: IndexFact): StatusFact {
  return {
    label,
    value:
      why === undefined || why.length === 0 ? (
        value
      ) : (
        <>
          {value}
          {why.map((line) => (
            <span key={line} className="block text-fg-muted">
              {line}
            </span>
          ))}
        </>
      ),
  };
}

export function IndexStatus({ tab }: { tab: PullTab }) {
  const state = useTabState(indexes, tab.id);
  useEffect(() => catchUpIndex(tab.id), [tab.id]);
  const now = useNow(state?.kind === 'ready');
  const item = indexItem(state, `${tab.owner}/${tab.repo}`, now);
  if (!item) return null;
  const { failure } = item;
  return (
    <StatusItem
      ball={item.ball}
      details={
        <>
          <StatusLine>{INDEX_LINE}</StatusLine>
          {item.facts.length > 0 && <StatusFacts items={item.facts.map(drawn)} />}
          {failure !== undefined && (
            <Problem
              layout="details"
              tone={item.ball === 'failed' ? 'danger' : 'warn'}
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
          )}
        </>
      }
      label={item.text}
      container={document.getElementById('root')}
    >
      {item.text}
    </StatusItem>
  );
}
