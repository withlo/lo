// A pull request's timeline, the third of its tab's middle views: the description card, then
// everything that happened to the pull request, oldest first, as GitHub lists it, and at its end
// the box that comments on the pull request itself. Main reads it the first time it's shown, and
// keeps it current; a long one draws its newest page while the older events are read. What comes
// while it's on screen waits for the reader's next key, click or scroll, and the row they're
// reading stays where it is as it comes. The keyboard moves between its
// rows (`j`, `k`), the list being one focusable element with the row the keyboard is on as its
// active descendant. Posts draw through the comments' `Post`, from GitHub's rendering of them; your
// own comments have Edit and Delete, and an edit's box is drawn in the comment's card. With code
// beside, the diff follows the review the keyboard is on to its first comment.

import {
  Countdown,
  EmptyState,
  Label,
  Problem,
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
  type ProblemAction,
  type TimelineHidden,
} from '@lo/ui';
import { keyLabels, NO_TARGET, setScopeSource, type Entry } from '@lo/ui/commands';
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
import { registry, setMiddle, useKeys } from '../../../window/commands/registry.ts';
import { explain, REMEDY_LABELS, remedyOf } from '../../../window/explain.ts';
import { avatarImage } from '../../../window/images.ts';
import {
  deletePullComment,
  editPullComment,
  Post,
  type PostPull,
  Preview,
  type PullComment,
  PullCommentBox,
  PullCommentEdit,
  PullCommentNote,
  settleSent,
  useEditsOnPull,
  useSentOnPull,
} from '../../comments/window/shared.ts';
import {
  besideNow,
  focusNowhereFor,
  MiddlePlaceholder,
  showMiddle,
  usePull,
  useRunLayers,
  useTabState,
  viewsShown,
  withoutBidi,
  type PullTab,
} from '../../tab/window/shared.ts';
import type { TimelineView } from '../contract.ts';
import {
  compare,
  focusRow,
  hasCode,
  inStop,
  keptRow,
  revealHidden,
  rowTarget,
  setDrawn,
  showReviewInDiff,
  stillHidden,
  type DrawnTimeline,
} from './actions.ts';
import { main, tabs } from './main.ts';
import { keepPlace, readingPlace, type ReadingPlace } from './place.ts';
import { rowsOf, type Part, type Person, type Row } from './rows.ts';
import { beforeOf, type Before, sentRows } from './sent.ts';
import {
  beforeShowing,
  comparisons,
  focusedRows,
  setLooked,
  showHeldOnInput,
  shownHidden,
  shownTimelines,
  showTimeline,
  sidebars,
} from './store.ts';
import { when } from './words.ts';
import { commentIn, isYours } from './yours.ts';

/**
 * Whether focus is in the view itself, or nowhere in particular for it, so the timeline can take it
 * as it comes on screen.
 */
function focusIsFree(own: HTMLElement | null): boolean {
  return (own !== null && own.contains(document.activeElement)) || focusNowhereFor(own);
}

/** The id of the timeline among the tab's middle views. */
export const TIMELINE_VIEW = 'timeline.view';

/**
 * While `shown`, makes `own` the middle view `Esc` gives focus back to, on `home`, and gives it
 * focus, with `here` saying where the tab is in it, for history.
 */
function useMiddle(
  shown: boolean,
  own: () => HTMLElement | null,
  home: () => HTMLElement | null,
  here: () => Entry | undefined = () => undefined,
): void {
  useEffect(() => {
    if (!shown) return undefined;
    const focus = () => home()?.focus({ preventScroll: true });
    if (focusIsFree(own())) focus();
    return setMiddle({ focus, root: own, holds: (element) => element === home(), here });
    // `own`, `home` and `here` only read refs.
  }, [shown]);
}

/** The time, again each minute while the view is on screen, for "3 d ago". */
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
        <NoneInRun tab={tab} />
      </Note>
    );
  }
  return <TimelineOf tab={tab} shown={shown} />;
}

/**
 * What the middle shows in place of the timeline, which `Esc` gives focus to. While the timeline is
 * read, it stands in for the middle of the window: focus on it is nowhere in particular, so keys
 * typed meanwhile go on in the rows once they're drawn and take focus.
 */
function Note({
  shown,
  waiting = false,
  children,
}: {
  shown: boolean;
  waiting?: boolean;
  children: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  useMiddle(
    shown,
    () => root.current,
    () => root.current,
  );
  return (
    <div
      ref={root}
      tabIndex={-1}
      className="h-full outline-none"
      data-lo-timeline="note"
      data-lo-middle={waiting || undefined}
    >
      {children}
    </div>
  );
}

/** A run of a stack's layers on screen as one diff has no timeline: each layer has its own. */
function NoneInRun({ tab }: { tab: PullTab }) {
  useKeys();
  const layers = useRunLayers(tab.id);
  return (
    <EmptyState
      icon="layers"
      title={`No timeline for ${layers}`}
      line="Each layer has its own."
      actions={[{ command: 'stacks.back', label: 'Show single layer' }]}
    />
  );
}

/**
 * A timeline that couldn't be read, with nothing read before: why, by its cause, with what GitHub or
 * the system said behind Details, and when main tries again, counted down, where it knows. What it
 * offers follows the cause: a sign-in, for an account signed out or one that can't see it; nothing,
 * while the rate limit holds, whose reset time the reason says; else Try now, or Try again where
 * main doesn't say when, which reads it at once, busy until main's read has answered. While the
 * account's poller reads nothing, the tab's banner says the wait and has the way to try again, so
 * this has neither.
 */
function Failed({ tab, view }: { tab: PullTab; view: TimelineView | undefined }) {
  const [trying, setTrying] = useState(false);
  const cause = view?.cause ? explain(view.cause) : undefined;
  const remedy = view?.cause ? remedyOf(view.cause) : 'tryAgain';
  const retryAt = remedy === 'tryAgain' ? (view?.retryAt ?? undefined) : undefined;
  const stalled = view?.stalled ?? false;
  const action: ProblemAction | undefined =
    stalled || remedy === 'none'
      ? undefined
      : remedy === 'tryAgain'
        ? {
            label: retryAt === undefined ? REMEDY_LABELS.tryAgain : 'Try now',
            busy: trying,
            working: 'Trying…',
            onClick: () => {
              setTrying(true);
              main()
                .retry({ id: tab.id })
                .catch((error: unknown) =>
                  console.error("Lo couldn't read the timeline again:", error),
                )
                .finally(() => setTrying(false));
            },
          }
        : {
            label: REMEDY_LABELS[remedy],
            onClick: () => registry().run('accounts.addAccount', NO_TARGET),
          };
  return (
    <Problem
      layout="view"
      title="Can’t show the timeline"
      reason={
        retryAt === undefined ? (
          cause
        ) : (
          <>
            {cause}
            {cause !== undefined && ' '}Retrying <Countdown at={retryAt} />.
          </>
        )
      }
      action={action}
      details={view?.details ? withoutBidi(view.details) : undefined}
    />
  );
}

/** A timeline read as no one, which shows only to an account. */
function SignIn() {
  useKeys();
  return (
    <EmptyState
      icon="user-round"
      title="Sign in to see comments"
      actions={[{ command: 'accounts.addAccount', label: 'Sign in with GitHub…' }]}
    />
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
  const status = view?.status;
  // A timeline that's still loading is its newest page, while the older events are read.
  const reading = status === 'loading';
  const repository = `${tab.owner}/${tab.repo}`;
  const made = useMemo(
    () => timeline && rowsOf(timeline, repository, { sidebar, revisions, author, reading }),
    [timeline, repository, sidebar, revisions, author, reading],
  );
  const { rows, landed, saving } = useSent(tab.id, timeline, made, author);
  switch (status) {
    case 'signIn':
      return (
        <Note shown={shown}>
          <SignIn />
        </Note>
      );
    case 'run':
      return (
        <Note shown={shown}>
          <NoneInRun tab={tab} />
        </Note>
      );
    case 'failed':
      return (
        <Note shown={shown}>
          <Failed tab={tab} view={view} />
        </Note>
      );
    case 'loading':
    case 'ready':
    case undefined:
      return rows ? (
        <Rows tab={tab} shown={shown} rows={rows} landed={landed} saving={saving} />
      ) : (
        <Note shown={shown} waiting>
          <MiddlePlaceholder tab={tab} status="Reading timeline…" />
        </Note>
      );
    default:
      status satisfies never;
      return null;
  }
}

/** What each view's timeline held as each comment sent from its box was first seen on its way. */
const sentBefore = new Map<string, ReadonlyMap<string, Before>>();

/** The rows of tab `tab`'s timeline, with what the reader's writes on the pull request add. */
interface WithSent {
  readonly rows: readonly Row[] | undefined;
  /** The row of GitHub's copy that took each sent comment's place, by the sent row's key. */
  readonly landed: ReadonlyMap<string, string>;
  /** What each comment whose edit is on its way says in its time's place: "Saving…". */
  readonly saving: ReadonlyMap<string, string>;
}

const NONE: ReadonlyMap<string, string> = new Map();

/**
 * `made`, tab `tab`'s rows from the timeline on screen, `timeline`, with the reader's comments sent
 * from the box at its end that it doesn't show yet as its last rows, and their comments there with
 * the text of edits it doesn't show yet: each until it shows GitHub's copy, which takes its place
 * with nothing moving. `author` opened the pull request.
 */
function useSent(
  tab: string,
  timeline: TimelineView['timeline'] | undefined,
  made: readonly Row[] | undefined,
  author: string | undefined,
): WithSent {
  const sent = useSentOnPull(tab);
  const login = useLogin(tab);
  const added = useMemo(() => {
    if (!made || sent.length === 0) return undefined;
    // What the timeline holds as a comment is first seen on its way tells GitHub's copy of it.
    const before = new Map(sentBefore.get(tab));
    for (const each of sent) {
      if (each.comment === undefined && !before.has(each.key)) {
        before.set(each.key, beforeOf(timeline, each.text));
      }
    }
    const me = login === undefined ? undefined : { login, type: 'User' };
    const byAuthor = login !== undefined && login.toLowerCase() === author?.toLowerCase();
    return { ...sentRows(sent, timeline, made, before, me, byAuthor), before };
  }, [tab, sent, timeline, made, login, author]);
  // What the timeline held is kept while each is on its way, and the ones it shows are let go.
  useLayoutEffect(() => {
    if (!added) {
      sentBefore.delete(tab);
      return;
    }
    const kept = new Map(added.before);
    for (const key of kept.keys()) {
      if (added.shown.has(key) || !sent.some((each) => each.key === key)) kept.delete(key);
    }
    sentBefore.set(tab, kept);
    settleSent(tab, added.shown);
  }, [tab, added, sent]);
  return useMemo(() => {
    if (!made || !added) return { rows: made, landed: NONE, saving: NONE };
    const { edits } = added;
    const saving = new Map<string, string>();
    for (const [comment, edit] of edits) if (edit.saving) saving.set(comment, edit.saving);
    const rows =
      edits.size === 0
        ? made
        : made.map((row) => {
            const edited = row.kind === 'comment' ? edits.get(row.id) : undefined;
            return edited === undefined ? row : { ...row, body: edited.text };
          });
    return { rows: [...rows, ...added.rows], landed: added.landed, saving };
  }, [made, added]);
}

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
    const listening = showHeldOnInput(tab);
    const stop = beforeShowing(tab, () => {
      place.current = root.current ? readingPlace(root.current, focusedRows.get(tab)) : undefined;
    });
    return () => {
      stop();
      listening();
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
 * never back to the first row. A comment just sent from the box at the end takes the keyboard as
 * it comes while focus is in the list, as the box gives it there, and GitHub's copy of it, which
 * takes its row's place (`landed`), takes the keyboard from it.
 */
function useKeptRow(
  tab: string,
  rows: readonly Row[],
  landed: ReadonlyMap<string, string>,
  list: RefObject<HTMLOListElement | null>,
): void {
  const before = useRef(rows);
  useLayoutEffect(() => {
    const was = before.current;
    before.current = rows;
    const key = focusedRows.get(tab);
    const sent = rows.find(
      (row) => row.kind === 'sent' && !was.some((each) => each.key === row.key),
    );
    if (sent && list.current !== null && list.current === document.activeElement) {
      focusedRows.set(tab, sent.key);
      return;
    }
    if (key === undefined || rows.some((row) => row.key === key)) return;
    focusedRows.set(tab, landed.get(key) ?? keptRow(was, rows, key));
  }, [tab, rows, landed, list]);
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
function Rows({
  tab,
  shown,
  rows,
  landed,
  saving,
}: {
  tab: PullTab;
  shown: boolean;
  rows: readonly Row[];
  /** The row of GitHub's copy that took each sent comment's place, by the sent row's key. */
  landed: ReadonlyMap<string, string>;
  /** What each comment whose edit is on its way says in its time's place: "Saving…". */
  saving: ReadonlyMap<string, string>;
}) {
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLOListElement>(null);
  const kept = useTabState(focusedRows, tab.id);
  // The keyboard on a comment just sent is on GitHub's copy of it, which took its place.
  const on = kept === undefined ? undefined : (landed.get(kept) ?? kept);
  const focused = rows.some((row) => row.key === on) ? on : rows[0]?.key;
  const now = useNow(shown);
  useTabState(shownHidden, tab.id);
  const login = useLogin(tab.id);
  const edits = useEditsOnPull(tab.id);
  useHolding(tab.id, shown, root, rows);
  useKeptRow(tab.id, rows, landed, list);
  const { owner, repo, number } = tab;
  const pull = useMemo<PostPull>(() => ({ owner, repo, number }), [owner, repo, number]);
  const drawn = useMemo(() => ({ tab, rows, list: () => list.current }), [tab, rows]);
  const latest = useRef<DrawnTimeline>(drawn);
  latest.current = drawn;
  // The timeline is a place in the tab's history, at the row the keyboard is on, so a file opened
  // from it, or code a review showed, has a way back to it.
  useEffect(
    () =>
      registry().history.register(tab.id, 'timeline', (at) => {
        const timeline = latest.current;
        const there = viewsShown(tab.id).includes(TIMELINE_VIEW);
        if (at.kind === 'row' && timeline.rows.some((row) => row.key === at.row)) {
          focusRow(timeline, at.row);
        }
        showMiddle(tab.id, TIMELINE_VIEW);
        // On screen already, beside the code, it takes focus back itself.
        if (there) timeline.list()?.focus({ preventScroll: true });
        return true;
      }),
    [tab.id],
  );
  useMiddle(
    shown,
    () => root.current,
    () => list.current,
    () => ({ view: 'timeline', at: rowTarget(latest.current) }),
  );
  // With code beside, the keyboard landing on a review, by a key or a click, has the diff follow it
  // to its first comment: focus stays on the timeline, and history records nothing.
  const followed = useRef(focused);
  useEffect(() => {
    const was = followed.current;
    followed.current = focused;
    if (!shown || focused === undefined || focused === was || !besideNow()) return;
    if (!root.current?.contains(document.activeElement)) return;
    const row = rows.find((each) => each.key === focused);
    if (row && hasCode(row)) showReviewInDiff(tab.id, row, 'follow');
  }, [tab.id, shown, focused, rows]);
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
              <PullCommentBox tab={tab} leave={leave} keys={keysOf('timeline.comment')} />
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
            saving={row.kind === 'comment' ? saving.get(row.id) : undefined}
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
  saving,
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
  /** It's your comment, and its edit is being saved: what its card says meanwhile, "Saving…". */
  saving: string | undefined;
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
          reading={row.reading}
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
          sending={saving}
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
          onShowInDiff={() => showReviewInDiff(tab, row, 'go')}
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
    case 'sent':
      // Drawn as GitHub's copy will be, which takes its place with nothing moving, from the text
      // sent and the tree its card will start from.
      return (
        <TimelineComment
          {...attributes}
          data-sent=""
          author={withoutBidi(row.author.login)}
          image={imageOf(row.author, MARKER)}
          when={row.at === undefined ? '' : when(row.at, now)}
          mine
          byAuthor={row.byAuthor}
          sending={row.sending}
          body={<Preview view={tab} text={row.body} pull={pull} flush sent />}
        />
      );
    default:
      row satisfies never;
      return null;
  }
}
