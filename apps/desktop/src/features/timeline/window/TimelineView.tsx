// A pull request's timeline, the third of its tab's middle views: the description card, then
// everything that happened to the pull request, oldest first, as GitHub lists it. Main reads it the
// first time it's shown, and keeps it current. The keyboard moves between its rows (`j`, `k`), the
// list being one focusable element with the row the keyboard is on as its active descendant.
// Posts draw through the comments' `Post`, from GitHub's rendering of them.

import {
  Button,
  Label,
  Timeline,
  TimelineChecks,
  TimelineComment,
  TimelineDescription,
  TimelineEvent,
  TimelineForcePush,
  TimelineName,
  TimelineOlder,
  TimelinePush,
  TimelineReview,
  type TimelineHidden,
} from '@lo/ui';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { setMiddle } from '../../../window/commands/registry.ts';
import { avatarImage } from '../../../window/images.ts';
import { signIn } from '../../accounts/window/shared.ts';
import { Post, type PostPull } from '../../comments/window/shared.ts';
import { showDiff } from '../../diff/window/shared.ts';
import { usePull, useTabState, withoutBidi, type PullTab } from '../../tab/window/shared.ts';
import { compare, focusRow, setDrawn, showHidden, stillHidden } from './actions.ts';
import { tabs } from './main.ts';
import { rowsOf, type Part, type Person, type Row } from './rows.ts';
import {
  comparisons,
  focusedRows,
  shownHidden,
  showTimeline,
  sidebars,
  timelines,
} from './store.ts';
import { when } from './words.ts';

/**
 * Whether focus is nowhere in particular, in the view itself, or left behind in a middle view now
 * hidden, so the timeline can take it as it comes on screen.
 */
function focusIsFree(own: HTMLElement | null): boolean {
  const focused = document.activeElement;
  return (
    !focused ||
    focused === document.body ||
    (own !== null && own.contains(focused)) ||
    focused.hasAttribute('data-lo-middle') ||
    focused.closest('[inert]') !== null
  );
}

/** While `shown`, makes `element` the middle view `Esc` gives focus back to, and gives it focus. */
function useMiddle(shown: boolean, own: () => HTMLElement | null, focus: () => void): void {
  useEffect(() => {
    if (!shown) return undefined;
    if (focusIsFree(own())) focus();
    return setMiddle({ focus, here: () => undefined });
    // `own` and `focus` only read refs.
  }, [shown]);
}

/** The time, again each minute while the view is on screen, for "3 days ago". */
function useNow(shown: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!shown) return undefined;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, [shown]);
  return now;
}

/** A pull request's tab's timeline, or why it has none. */
export function TimelineMiddle({ tab, shown }: { tab: PullTab; shown: boolean }) {
  if (tab.run) {
    return (
      <Note shown={shown}>
        A run of layers has no timeline. Show one of its layers to see its timeline.
      </Note>
    );
  }
  return <TimelineOf tab={tab} shown={shown} />;
}

/** What the middle says in place of the timeline, which `Esc` gives focus to. */
function Note({ shown, children }: { shown: boolean; children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  useMiddle(
    shown,
    () => root.current,
    () => root.current?.focus({ preventScroll: true }),
  );
  return (
    <div
      ref={root}
      tabIndex={-1}
      className="grid h-full place-items-center p-32 text-center text-fg-muted outline-none text-ui"
      data-lo-timeline="note"
    >
      <div className="flex max-w-read-measure flex-col items-center gap-12">{children}</div>
    </div>
  );
}

function TimelineOf({ tab, shown }: { tab: PullTab; shown: boolean }) {
  useEffect(() => {
    if (shown) showTimeline(tab.id);
  }, [tab.id, shown]);
  const view = useTabState(timelines, tab.id);
  const sidebar = useTabState(sidebars, tab.id);
  const revisions = useTabState(comparisons, tab.id);
  const author = usePull(tab.id)?.header?.author ?? undefined;
  const timeline = view?.timeline ?? undefined;
  const repository = `${tab.owner}/${tab.repo}`;
  const rows = useMemo(
    () => timeline && rowsOf(timeline, repository, { sidebar, revisions, author }),
    [timeline, repository, sidebar, revisions, author],
  );
  const status = view?.status;
  switch (status) {
    case 'signIn':
      return (
        <Note shown={shown}>
          <p>Sign in to see comments.</p>
          <Button onClick={signIn}>Sign in</Button>
        </Note>
      );
    case 'run':
      return (
        <Note shown={shown}>
          A run of layers has no timeline. Show one of its layers to see its timeline.
        </Note>
      );
    case 'failed':
      return <Note shown={shown}>{view?.problem ?? 'Lo couldn’t read the timeline.'}</Note>;
    case 'loading':
    case 'ready':
    case undefined:
      return rows ? (
        <Rows tab={tab} shown={shown} rows={rows} />
      ) : (
        <Note shown={shown}>Reading the timeline…</Note>
      );
    default:
      status satisfies never;
      return null;
  }
}

/** The timeline's rows, in a list the keyboard moves through. */
function Rows({ tab, shown, rows }: { tab: PullTab; shown: boolean; rows: readonly Row[] }) {
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLOListElement>(null);
  const kept = useTabState(focusedRows, tab.id);
  const focused = rows.some((row) => row.key === kept) ? kept : rows[0]?.key;
  const now = useNow(shown);
  useTabState(shownHidden, tab.id);
  useMiddle(
    shown,
    () => root.current,
    () => list.current?.focus({ preventScroll: true }),
  );
  // While it's on screen, the keys act on it.
  const tabId = tab.id;
  const { owner, repo, number } = tab;
  const pull = useMemo<PostPull>(() => ({ owner, repo, number }), [owner, repo, number]);
  useLayoutEffect(() => {
    if (!shown) return undefined;
    return setDrawn({ tab, rows, list: () => list.current });
  }, [shown, tab, rows]);
  return (
    <div ref={root} className="h-full overflow-y-auto" data-lo-scope="timeline">
      <Timeline listRef={list} tabIndex={0} focused={focused} aria-label="Timeline">
        {rows.map((row) => (
          <RowOf
            key={row.key}
            tab={tabId}
            pull={pull}
            row={row}
            now={now}
            onFocus={() => {
              focusRow({ tab, rows, list: () => list.current }, row.key);
              list.current?.focus({ preventScroll: true });
            }}
          />
        ))}
      </Timeline>
    </div>
  );
}

/** A label's color as `Label` takes it: none, for one GitHub gave that Lo doesn't take. */
function labelOf(label: { name: string; color: string | undefined }) {
  return { name: withoutBidi(label.name), color: label.color ?? '' };
}

/** A one-line event's sentence. */
function Sentence({ parts }: { parts: readonly Part[] }) {
  return (
    <span>
      {parts.map((part, at) => {
        switch (part.kind) {
          case 'text':
            return <span key={at}>{part.text}</span>;
          case 'name':
            return <TimelineName key={at}>{withoutBidi(part.name)}</TimelineName>;
          case 'label':
            return (
              <span key={at} className="inline-flex align-middle">
                <Label color={part.color ?? ''}>{withoutBidi(part.name)}</Label>
              </span>
            );
          case 'code':
            return (
              <span key={at} className="text-fg code-small">
                {withoutBidi(part.text)}
              </span>
            );
          case 'quote':
            return (
              <span key={at} className="text-fg">
                {withoutBidi(part.text)}
              </span>
            );
          default:
            part satisfies never;
            return null;
        }
      })}
    </span>
  );
}

/** How many pixels a side the avatar that marks a row is, and one beside a line of small text. */
const MARKER = 32;
const SMALL = 20;

/** Where to load `person`'s avatar from, `size` pixels a side: nothing keeps their initials. */
function imageOf(person: Person | undefined, size: number): string | undefined {
  return person && avatarImage(person, size);
}

/** A revision's number as a tag shows it. */
function revisionOf(number: number | undefined): string | undefined {
  return number === undefined ? undefined : `r${number}`;
}

function RowOf({
  tab,
  pull,
  row,
  now,
  onFocus,
}: {
  tab: string;
  pull: PostPull;
  row: Row;
  now: number;
  onFocus: () => void;
}) {
  const attributes = { item: row.key, 'data-key': row.key, onClick: onFocus };
  const hidden = (): TimelineHidden | undefined => {
    if (!stillHidden(tab, row)) return undefined;
    const reason = row.kind === 'comment' ? row.hidden : undefined;
    return { reason, onShow: () => showHidden(tab, row.key) };
  };
  switch (row.kind) {
    case 'description':
      return (
        <TimelineDescription
          {...attributes}
          author={withoutBidi(row.author?.login ?? 'ghost')}
          image={imageOf(row.author, MARKER)}
          when={when(row.at, now)}
          draft={row.draft}
          body={
            row.body.trim() === '' ? undefined : (
              <Post view={tab} post={{ kind: 'description' }} markdown={row.body} pull={pull} />
            )
          }
          labels={row.labels.map(labelOf)}
          reviewers={row.reviewers.map(({ person, state }) => ({
            login: withoutBidi(person.login),
            image: imageOf(person, SMALL),
            state,
          }))}
        />
      );
    case 'older':
      return (
        <TimelineOlder
          {...attributes}
          count={row.count}
          onSee={() => {
            void tabs()
              .openExternal({
                url: `https://github.com/${pull.owner}/${pull.repo}/pull/${pull.number}`,
              })
              .catch((error: unknown) => console.error("Lo couldn't open GitHub:", error));
          }}
        />
      );
    case 'comment':
      return (
        <TimelineComment
          {...attributes}
          author={withoutBidi(row.author?.login ?? 'ghost')}
          image={imageOf(row.author, MARKER)}
          when={when(row.at, now)}
          byAuthor={row.byAuthor}
          hidden={hidden()}
          body={
            <Post view={tab} post={{ kind: 'post', id: row.id }} markdown={row.body} pull={pull} />
          }
        />
      );
    case 'review':
      return (
        <TimelineReview
          {...attributes}
          author={withoutBidi(row.author?.login ?? 'ghost')}
          image={imageOf(row.author, SMALL)}
          when={when(row.at, now)}
          verdict={row.verdict}
          revision={revisionOf(row.revision)}
          hidden={hidden()}
          body={
            row.body.trim() === '' ? undefined : (
              <Post
                view={tab}
                post={{ kind: 'post', id: row.id }}
                markdown={row.body}
                pull={pull}
              />
            )
          }
          comments={{ count: row.comments }}
          onShowInDiff={() => showDiff(tab)}
        />
      );
    case 'push':
      return (
        <TimelinePush
          {...attributes}
          actor={withoutBidi(row.actor)}
          when={when(row.at, now)}
          revision={revisionOf(row.revision)}
          commits={row.commits.map(({ oid, headline }) => ({
            oid,
            headline: withoutBidi(headline),
          }))}
        />
      );
    case 'checks':
      return (
        <TimelineChecks {...attributes} state={row.state} revision={revisionOf(row.revision)} />
      );
    case 'forcePush': {
      const { compare: pair } = row;
      return (
        <TimelineForcePush
          {...attributes}
          actor={withoutBidi(row.actor)}
          when={when(row.at, now)}
          branch={row.branch}
          before={row.before}
          after={row.after}
          revision={revisionOf(row.revision)}
          compare={
            pair && {
              from: `r${pair.from.number}`,
              to: `r${pair.to.number}`,
              onCompare: () => compare(tab, pair.from, pair.to),
            }
          }
        />
      );
    }
    case 'event':
      return (
        <TimelineEvent {...attributes} glyph={row.glyph} tone={row.tone} when={when(row.at, now)}>
          <Sentence parts={row.parts} />
        </TimelineEvent>
      );
    default:
      row satisfies never;
      return null;
  }
}
