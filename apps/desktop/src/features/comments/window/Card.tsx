// A review thread's card in a diff, drawn in the element the code view makes for it: its comments,
// each with its author's avatar, when it was written and its text, and its state. A comment's text
// is drawn as GitHub renders it, through `Post`.

import { Thread, type ThreadComment } from '@lo/ui';
import { keyLabels } from '@lo/ui/commands';
import type { ReactNode } from 'react';

import { registry } from '../../../window/commands/registry.ts';
import { avatarImage } from '../../../window/images.ts';
import { usePull, useTabState } from '../../tab/window/shared.ts';
import type { ThreadCommentRow, ThreadRow } from '../contract.ts';
import { landed } from './landed.ts';
import { Post, type PostPull } from './Post.tsx';
import { held } from './threads.ts';

/** How tall a comment's avatar is drawn, in pixels: `Avatar`'s small size. */
const AVATAR = 20;

/** How much of the first comment the collapsed line shows. */
const EXCERPT = 120;

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

/** The opening of a comment's text, on one line, for a collapsed thread. */
export function excerptOf(body: string): string {
  const line = body.replaceAll(/\s+/g, ' ').trim();
  return line.length > EXCERPT ? `${line.slice(0, EXCERPT - 1)}…` : line;
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
  readonly view: string;
  /** The pull request that view shows. */
  readonly pull: PostPull;
  readonly id: string;
  /** Whether it shows open, or collapsed to one line. */
  readonly open: boolean;
  /** Opens or collapses it, as its own buttons ask. */
  readonly onToggle: () => void;
}

/** View `view`'s thread `id`, as main last sent it: nothing once it's gone. */
export function Card({ view, pull, id, open, onToggle }: CardProps): ReactNode {
  const threads = useTabState(held, view, (value) => value.threads);
  const author = usePull(view)?.header?.author;
  const newer = useTabState(landed, view, (ids) => ids.has(id));
  const row = threads?.threads.find((each) => each.id === id);
  if (!row) return null;
  const body = (comment: ThreadCommentRow) => (
    <Post view={view} post={{ kind: 'post', id: comment.id }} markdown={comment.body} pull={pull} />
  );
  return (
    <ThreadCard
      row={row}
      open={open}
      onToggle={onToggle}
      author={author}
      body={body}
      landed={newer}
    />
  );
}

/** A thread's card, from what main sent of it. */
export function ThreadCard({
  row,
  open,
  onToggle,
  author,
  body,
  landed: newer = false,
  now = Date.now(),
}: {
  row: ThreadRow;
  open: boolean;
  onToggle: () => void;
  /** The pull request's author's login, if GitHub still has the account. */
  author: string | null | undefined;
  /** Draws a comment's text. */
  body: (comment: ThreadCommentRow) => ReactNode;
  /**
   * You wrote it on a revision, and GitHub put it on a newer push, where its lines may hold other
   * code.
   */
  landed?: boolean;
  now?: number;
}): ReactNode {
  const comments = row.comments.map((comment): ThreadComment => ({
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
    body: body(comment),
  }));
  return (
    <Thread
      comments={comments}
      resolved={row.resolved}
      open={open}
      outdated={row.outdated}
      tags={newer ? [{ label: 'On a newer push', tone: 'warning' }] : undefined}
      excerpt={row.comments[0] && excerptOf(row.comments[0].body)}
      keys={{ toggle: keysOf('diff.toggleFile') }}
      onToggle={onToggle}
    />
  );
}
