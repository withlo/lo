// A review thread's card in a diff, drawn in the element the code view makes for it: its comments,
// each with its author's avatar, when it was written and its text, and its state; its buttons,
// which reply, resolve or unresolve it, and edit or delete your comments, where GitHub lets you;
// and, under it, how a change asked of it stands while GitHub's answer was lost. A comment's text
// is drawn as GitHub renders it, through `Post`.

import { Button, Callout, Thread, type ThreadComment } from '@lo/ui';
import { keyLabels } from '@lo/ui/commands';
import type { MouseEvent, ReactNode } from 'react';

import { registry } from '../../../window/commands/registry.ts';
import { avatarImage } from '../../../window/images.ts';
import { usePull, useTabState, type PullTab } from '../../tab/window/shared.ts';
import type { ActRow, ThreadCommentRow, ThreadRow } from '../contract.ts';
import {
  acting,
  actNote,
  type ActNote,
  checkAgain,
  closeAct,
  closedActs,
  edit,
  noteKey,
  remove,
  reply,
  resolveThread,
  tryAgain,
  underWay,
  unshown,
} from './acts.ts';
import { editing, replying } from './boxes.ts';
import { useExcerpt } from './excerpts.ts';
import { landed } from './landed.ts';
import { Post, type PostPull } from './Post.tsx';
import { held } from './threads.ts';

/** How tall a comment's avatar is drawn, in pixels: `Avatar`'s small size. */
const AVATAR = 20;

/** How long ago `at` was, in words, from `now`. */
export function ago(at: number, now: number): string {
  if (Number.isNaN(at)) return '';
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  const days = Math.round(hours / 24);
  return `${days} ${days === 1 ? 'day' : 'days'} ago`;
}

/** Whether two logins name one account: GitHub's ignore case. */
function same(a: string | null | undefined, b: string | null | undefined): boolean {
  return a !== null && a !== undefined && a.toLowerCase() === b?.toLowerCase();
}

/** The first keys `id` has now, as this system shows them, if it has any. */
function keysOf(id: string): string[] | undefined {
  const [first] = registry().keysOf(id);
  return first && keyLabels(first, registry().system);
}

export interface CardProps {
  /** The view of a pull request's tab the thread is in. */
  readonly tab: PullTab;
  readonly id: string;
  /** Whether it shows open, or collapsed to one line. */
  readonly open: boolean;
  /** The keyboard is on it: the code cursor is on its line, and its keys act on it. */
  readonly focused?: boolean;
  /** Opens or collapses it, as its own buttons ask. */
  readonly onToggle: () => void;
}

/** View `tab`'s thread `id`, as main last sent it: nothing once it's gone. */
export function Card({ tab, id, open, focused = false, onToggle }: CardProps): ReactNode {
  const view = tab.id;
  const pull: PostPull = { owner: tab.owner, repo: tab.repo, number: tab.number };
  const threads = useTabState(held, view, (value) => value.threads);
  const shown = usePull(view);
  const author = shown?.header?.author;
  const login = shown?.acting?.kind === 'account' ? shown.acting.login : undefined;
  const newer = useTabState(landed, view, (ids) => ids.has(id));
  const replied = useTabState(replying, view, (ids) => ids.has(id));
  const edited = useTabState(editing, view);
  const asked = useTabState(acting, view, (acts) => acts.get(id));
  const kept = useTabState(unshown, view, (keys) => keys.has(id));
  const isClosed = useTabState(
    closedActs,
    view,
    (keys) => asked !== undefined && keys.has(noteKey(asked)),
  );
  const row = threads?.threads.find((each) => each.id === id);
  // Its first comment's opening, as plain words, which it shows while it's collapsed.
  const opening = useExcerpt(row?.comments[0]?.body, !open);
  if (!row) return null;
  const body = (comment: ThreadCommentRow) => (
    <Post view={view} post={{ kind: 'post', id: comment.id }} markdown={comment.body} pull={pull} />
  );
  const thread = { kind: 'thread' as const, thread: id };
  const note = actNote(asked, row, isClosed);
  return (
    <>
      <ThreadCard
        row={row}
        asked={asked}
        atWork={!kept}
        open={open}
        focused={focused}
        onToggle={onToggle}
        author={author}
        body={body}
        excerpt={opening}
        landed={newer}
        login={login}
        replying={replied}
        editing={edited}
        actions={{
          onReply: () => reply(tab, thread),
          onResolve: () => void resolveThread(tab, row),
          onEdit: (comment) => void edit(tab, thread, comment),
          onDelete: (comment) => remove(tab, thread, comment),
        }}
      />
      {note && asked && (
        <div data-act-note="" className="mt-8 max-w-read-measure">
          <ActCallout
            note={note}
            onAgain={() => (note.again === 'check' ? checkAgain(tab, asked) : tryAgain(tab, asked))}
            onClose={() => closeAct(view, asked)}
          />
        </div>
      )}
    </>
  );
}

/**
 * Gives focus to the card a note is under, at its first control: the note goes as its buttons are
 * pressed, and focus goes nowhere with it otherwise.
 */
function focusCard(from: Element): void {
  const card = from.closest('[data-act-note]')?.previousElementSibling;
  const control =
    card?.querySelector<HTMLElement>('button, [tabindex]') ??
    // No card over it, as in the timeline: whatever holds it that takes focus.
    from.parentElement?.closest<HTMLElement>('[tabindex]');
  control?.focus({ preventScroll: true });
}

/**
 * What a card says of a change asked of it that didn't go, or may not have: what wasn't done, why,
 * and "Try again", or "Check again" where nobody knows whether it went, and "Dismiss". Whoever
 * shows it says it to a screen reader: it's drawn with its words on it.
 */
/** Runs a note's button, focus going to its card first: the button goes with the note. */
function then(act: () => void) {
  return (event: MouseEvent<HTMLElement>): void => {
    focusCard(event.currentTarget);
    act();
  };
}

export function ActCallout({
  note,
  onAgain,
  onClose,
}: {
  note: ActNote;
  onAgain: () => void;
  onClose: () => void;
}): ReactNode {
  return (
    <Callout tone="warning">
      <div className="flex flex-wrap items-center gap-8">
        <span className="min-w-0 flex-1">
          <b className="text-ui-strong">{note.title}</b> {note.text}
        </span>
        <span className="flex flex-none gap-4">
          <Button size="sm" onClick={then(onAgain)}>
            {note.again === 'check' ? 'Check again' : 'Try again'}
          </Button>
          <Button size="sm" variant="ghost" onClick={then(onClose)}>
            Dismiss
          </Button>
        </span>
      </div>
    </Callout>
  );
}

/** What a thread's card's buttons do. */
export interface CardActions {
  readonly onReply: () => void;
  readonly onResolve: () => void;
  /** Edit or Delete was pressed on one of your comments, by its id. */
  readonly onEdit: (comment: string) => void;
  readonly onDelete: (comment: string) => void;
}

/** A thread's card, from what main sent of it. */
export function ThreadCard({
  row,
  asked,
  atWork = true,
  open,
  focused = false,
  onToggle,
  author,
  body,
  excerpt,
  landed: newer = false,
  login,
  replying: replied = false,
  editing: edited,
  actions,
  now = Date.now(),
}: {
  row: ThreadRow;
  /**
   * The change asked of it that GitHub hasn't answered for: the card shows it done already, with
   * its control at work, and goes back to what `row` says if it doesn't go.
   */
  asked?: ActRow | undefined;
  /**
   * Whether that change's control is still at work. It isn't once GitHub took the change and the
   * threads didn't show it in time: the card still shows it done, until they're read again.
   */
  atWork?: boolean;
  open: boolean;
  /** The keyboard is on it: the code cursor is on its line, and its keys act on it. */
  focused?: boolean;
  onToggle: () => void;
  /** The pull request's author's login, if GitHub still has the account. */
  author: string | null | undefined;
  /** Draws a comment's text. */
  body: (comment: ThreadCommentRow) => ReactNode;
  /** The first comment's opening as one line of plain text, which the collapsed line shows. */
  excerpt?: string | undefined;
  /**
   * You wrote it on a revision, and GitHub put it on a newer push, where its lines may hold other
   * code.
   */
  landed?: boolean;
  /** The account the view writes as, whose comments are yours: nobody's while it writes as none. */
  login?: string | undefined;
  /** A reply box is open in it, right after it, in place of its own row that offers one. */
  replying?: boolean;
  /**
   * Its comments an edit box is open on, right after it, by their ids: the box is the comment
   * meanwhile, so the card draws without it, and offers no reply.
   */
  editing?: ReadonlySet<string> | undefined;
  /** What its buttons do: it has none without. */
  actions?: CardActions | undefined;
  now?: number;
}): ReactNode {
  const inBox = edited !== undefined && row.comments.some((comment) => edited.has(comment.id));
  // What was asked, while the card shows it done.
  const done = underWay(asked) ? asked : undefined;
  const toggled = done !== undefined && done.change !== 'delete';
  // A comment GitHub deleted that the threads still hold isn't drawn.
  const gone = done?.change === 'delete' && !atWork ? done.comment : null;
  const kept = row.comments.filter((comment) => comment.id !== gone);
  const comments = kept.map((comment): ThreadComment => ({
    id: comment.id,
    // GitHub shows a deleted account as "ghost".
    author: comment.author ?? 'ghost',
    image:
      comment.author === null
        ? undefined
        : avatarImage({ login: comment.author, type: comment.authorType ?? '' }, AVATAR),
    when: ago(Date.parse(comment.createdAt), now),
    byAuthor: same(comment.author, author),
    pending: comment.state === 'PENDING',
    mine: actions !== undefined && login !== undefined && same(comment.author, login),
    body: body(comment),
  }));
  const resolving = toggled && atWork;
  const resolved = toggled ? done.change === 'resolve' : row.resolved;
  const deleting = done?.change === 'delete' && atWork ? done.comment : null;
  return (
    <Thread
      comments={comments}
      resolved={resolved}
      resolving={resolving}
      deleting={deleting ?? undefined}
      editing={inBox ? edited : undefined}
      open={open}
      focused={focused}
      outdated={row.outdated}
      tags={newer ? [{ label: 'On a newer push', tone: 'warning' }] : undefined}
      excerpt={excerpt === '' ? undefined : excerpt}
      canResolve={
        actions !== undefined &&
        login !== undefined &&
        // It's the control that was pressed, whatever the thread takes next.
        (toggled || (row.resolved ? row.viewerCanUnresolve : row.viewerCanResolve))
      }
      canReply={
        actions !== undefined && login !== undefined && row.viewerCanReply && !replied && !inBox
      }
      keys={{
        toggle: keysOf('diff.toggleThread'),
        reply: keysOf('comments.reply'),
        resolve: keysOf('comments.resolve'),
        edit: keysOf('comments.edit'),
        delete: keysOf('comments.remove'),
      }}
      // Every card is drawn in a code view, whose right-click on it opens the thread's menu.
      menu
      onToggle={onToggle}
      onReply={actions?.onReply}
      onResolve={actions?.onResolve}
      onEdit={actions?.onEdit}
      onDelete={actions?.onDelete}
    />
  );
}
