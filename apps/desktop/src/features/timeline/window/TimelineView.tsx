// A pull request's timeline, the third of its tab's middle views: the description card, then
// everything that happened to the pull request, oldest first, as GitHub lists it, and at its end
// the box that comments on the pull request itself. Main reads it the first time it's shown, and
// keeps it current; what comes while it's on screen waits for the reader's next key, click or
// scroll, and the row they're reading stays where it is as it comes. The keyboard moves between its
// rows (`j`, `k`), the list being one focusable element with the row the keyboard is on as its
// active descendant. Posts draw through the comments' `Post`, from GitHub's rendering of them; your
// own comments have Edit and Delete, and an edit's box is drawn in the comment's card.

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
  TimelineEnd,
  TimelineReview,
  type TimelineHidden,
} from '@lo/ui';
import { keyLabels, setScopeSource } from '@lo/ui/commands';
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
  type RefObject,
} from 'react';

import { useMenuTarget } from '../../../window/commands/menus.tsx';
import { registry, setMiddle } from '../../../window/commands/registry.ts';
import { avatarImage } from '../../../window/images.ts';
import { signIn } from '../../accounts/window/shared.ts';
import {
  deletePullComment,
  editPullComment,
  Post,
  type PostPull,
  type PullComment,
  PullCommentBox,
  PullCommentEdit,
  PullCommentNote,
  useEditsOnPull,
} from '../../comments/window/shared.ts';
import { showDiff } from '../../diff/window/shared.ts';
import { usePull, useTabState, withoutBidi, type PullTab } from '../../tab/window/shared.ts';
import {
  compare,
  focusRow,
  inStop,
  keptRow,
  revealHidden,
  rowTarget,
  setDrawn,
  stillHidden,
} from './actions.ts';
import { tabs } from './main.ts';
import { keepPlace, readingPlace, type ReadingPlace } from './place.ts';
import { rowsOf, type Part, type Person, type Row } from './rows.ts';
import {
  beforeShowing,
  comparisons,
  focusedRows,
  setLooked,
  showHeld,
  shownHidden,
  shownTimelines,
  showTimeline,
  sidebars,
} from './store.ts';
import { when } from './words.ts';
import { commentIn, isYours } from './yours.ts';

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
  const view = useTabState(shownTimelines, tab.id);
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

/** The input that shows what came while the reader looked: a key, a click or a scroll. */
const INPUT = ['keydown', 'pointerdown', 'wheel', 'touchstart'] as const;

/**
 * While `shown`, what main sends of tab `tab`'s timeline waits for the reader's next key, click or
 * scroll; and as it goes on screen, what the reader looks at in `root` stays where it is, `rows`
 * being what's drawn.
 */
function useHolding(
  tab: string,
  shown: boolean,
  root: RefObject<HTMLDivElement | null>,
  rows: readonly Row[],
): void {
  const place = useRef<ReadingPlace | undefined>(undefined);
  useEffect(() => {
    setLooked(tab, shown);
    if (!shown) return undefined;
    const input = () => showHeld(tab);
    for (const event of INPUT) document.addEventListener(event, input, true);
    const stop = beforeShowing(tab, () => {
      place.current = root.current ? readingPlace(root.current, focusedRows.get(tab)) : undefined;
    });
    return () => {
      stop();
      for (const event of INPUT) document.removeEventListener(event, input, true);
      setLooked(tab, false);
    };
  }, [tab, shown, root]);
  useLayoutEffect(() => {
    const kept = place.current;
    place.current = undefined;
    if (kept && root.current) keepPlace(root.current, kept);
  }, [rows, root]);
}

/**
 * As tab `tab`'s rows become `rows`, the keyboard stays on its row, or, once that's gone, as after
 * your `dd` or a delete that came while you looked, moves to its neighbour, with nothing scrolled:
 * never back to the first row.
 */
function useKeptRow(tab: string, rows: readonly Row[]): void {
  const before = useRef(rows);
  useLayoutEffect(() => {
    const was = before.current;
    before.current = rows;
    const key = focusedRows.get(tab);
    if (key === undefined || rows.some((row) => row.key === key)) return;
    focusedRows.set(tab, keptRow(was, rows, key));
  }, [tab, rows]);
}

/** The login tab `tab` acts as, if it acts as anyone. */
function useLogin(tab: string): string | undefined {
  const acting = usePull(tab)?.acting;
  return acting?.kind === 'account' ? acting.login : undefined;
}

/** The first keys command `id` has now, as this system shows them, if it has any. */
function keysOf(id: string): string[] | undefined {
  const [first] = registry().keysOf(id);
  return first && keyLabels(first, registry().system);
}

/** The timeline's rows, in a list the keyboard moves through, and the box at its end. */
function Rows({ tab, shown, rows }: { tab: PullTab; shown: boolean; rows: readonly Row[] }) {
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLOListElement>(null);
  const kept = useTabState(focusedRows, tab.id);
  const focused = rows.some((row) => row.key === kept) ? kept : rows[0]?.key;
  const now = useNow(shown);
  useTabState(shownHidden, tab.id);
  const login = useLogin(tab.id);
  const edits = useEditsOnPull(tab.id);
  useHolding(tab.id, shown, root, rows);
  useKeptRow(tab.id, rows);
  useMiddle(
    shown,
    () => root.current,
    () => list.current?.focus({ preventScroll: true }),
  );
  const { owner, repo, number } = tab;
  const pull = useMemo<PostPull>(() => ({ owner, repo, number }), [owner, repo, number]);
  const drawn = useMemo(() => ({ tab, rows, list: () => list.current }), [tab, rows]);
  // While it's on screen, the keys act on it, on the row the keyboard is on.
  useLayoutEffect(() => (shown ? setDrawn(drawn) : undefined), [shown, drawn]);
  useEffect(() => {
    const own = root.current;
    return own ? setScopeSource(own, { target: () => rowTarget(drawn) }) : undefined;
  }, [drawn]);
  const leave = useMemo(() => () => list.current?.focus({ preventScroll: true }), []);
  // A right-click on a row: the row's menu, the keyboard moving to it.
  const menu = useMenuTarget((event) => {
    const element = event.target instanceof Element ? event.target.closest('li[data-key]') : null;
    const key = element instanceof HTMLElement ? element.dataset['key'] : undefined;
    if (key === undefined || !rows.some((row) => row.key === key)) return undefined;
    focusRow(drawn, key);
    list.current?.focus({ preventScroll: true });
    return { kind: 'row', row: key };
  });
  return (
    <div ref={root} className="h-full overflow-y-auto" data-lo-scope="timeline" {...menu}>
      <Timeline
        listRef={list}
        tabIndex={0}
        focused={focused}
        aria-label="Timeline"
        end={
          login !== undefined && (
            <TimelineEnd marker={{ login, image: avatarImage({ login, type: 'User' }, MARKER) }}>
              <PullCommentBox tab={tab} leave={leave} />
            </TimelineEnd>
          )
        }
      >
        {rows.map((row) => (
          <RowOf
            key={row.key}
            tab={tab}
            pull={pull}
            row={row}
            now={now}
            login={login}
            editing={row.kind === 'comment' && edits.has(row.id)}
            leave={leave}
            onFocus={(event) => {
              focusRow(drawn, row.key);
              // A link or button clicked in the row keeps focus, for what it does.
              if (!inStop(event.target)) list.current?.focus({ preventScroll: true });
            }}
            onReveal={() => revealHidden(drawn, row.key)}
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

/** A comment of yours on the pull request: its Edit and Delete, its edit's box and its note. */
function yourComment(
  tab: PullTab,
  comment: PullComment,
  editing: boolean,
  leave: () => void,
): {
  mine: true;
  keys: { edit: string[] | undefined; delete: string[] | undefined };
  onEdit: () => void;
  onDelete: () => void;
  editing: ReactNode;
  note: ReactNode;
} {
  return {
    mine: true,
    keys: { edit: keysOf('timeline.editComment'), delete: keysOf('timeline.deleteComment') },
    onEdit: () => void editPullComment(tab, comment),
    onDelete: () => deletePullComment(tab, comment),
    editing: editing ? (
      <div data-lo-timeline="edit">
        <PullCommentEdit tab={tab} comment={comment.id} leave={leave} />
      </div>
    ) : undefined,
    note: <PullCommentNote tab={tab} comment={comment} />,
  };
}

function RowOf({
  tab: pullTab,
  pull,
  row,
  now,
  login,
  editing,
  leave,
  onFocus,
  onReveal,
}: {
  tab: PullTab;
  pull: PostPull;
  row: Row;
  now: number;
  /** Who the tab acts as: their comments have Edit and Delete. */
  login: string | undefined;
  /** It's your comment, and its edit's box is open. */
  editing: boolean;
  /** Gives focus back to the list, as an edit's box does as it goes. */
  leave: () => void;
  onFocus: (event: MouseEvent<HTMLElement>) => void;
  /** Shows the row's hidden comment, focus going back to the list as its button goes. */
  onReveal: () => void;
}) {
  const tab = pullTab.id;
  const attributes = { item: row.key, 'data-key': row.key, onClick: onFocus };
  const hidden = (): TimelineHidden | undefined => {
    if (!stillHidden(tab, row)) return undefined;
    const reason = row.kind === 'comment' ? row.hidden : undefined;
    return { reason, onShow: onReveal };
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
    case 'comment': {
      const comment = commentIn(row, false);
      const yours =
        isYours(row, login) && typeof comment !== 'string'
          ? yourComment(pullTab, comment, editing, leave)
          : undefined;
      return (
        <TimelineComment
          {...attributes}
          author={withoutBidi(row.author?.login ?? 'ghost')}
          image={imageOf(row.author, MARKER)}
          when={when(row.at, now)}
          byAuthor={row.byAuthor}
          hidden={hidden()}
          mine={yours?.mine}
          keys={yours?.keys}
          onEdit={yours?.onEdit}
          onDelete={yours?.onDelete}
          editing={yours?.editing}
          body={
            <>
              {yours?.note}
              <Post
                view={tab}
                post={{ kind: 'post', id: row.id }}
                markdown={row.body}
                pull={pull}
              />
            </>
          }
        />
      );
    }
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
