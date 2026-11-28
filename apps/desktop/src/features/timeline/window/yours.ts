// Your comments on the pull request, in its timeline: what `i` and `dd`, and a comment's Edit and
// Delete, act on, and why not, in Lo's words. Lo changes only comments, and only your own: a review
// and the description are GitHub's to change, and so is anyone else's comment.

import { whyNotChange, type PullComment } from '../../comments/window/shared.ts';
import { pullOf } from '../../tab/window/shared.ts';
import type { Row } from './rows.ts';

/** The login view `view` acts as, if it acts as anyone. */
export function loginOf(view: string): string | undefined {
  const acting = pullOf(view)?.acting;
  return acting?.kind === 'account' ? acting.login : undefined;
}

/** Why a comment just sent can't be changed yet: GitHub's copy isn't in the timeline. */
export const SENT = 'This comment isn’t in the timeline yet';

/**
 * The comment on the pull request `row` is, to edit or delete, or why it isn't one Lo changes.
 * `hidden` says it's a hidden comment the reader hasn't shown, which they see first.
 */
export function commentIn(row: Row, hidden: boolean): PullComment | string {
  switch (row.kind) {
    case 'comment':
      if (hidden) return 'Show this comment first';
      return {
        id: row.id,
        author: row.author?.login,
        body: row.body,
        viewerCanUpdate: row.canUpdate,
        viewerCanDelete: row.canDelete,
      };
    case 'description':
      return 'Edit the description on GitHub';
    case 'review':
      return 'Edit a review on GitHub';
    case 'sent':
      return SENT;
    case 'push':
    case 'forcePush':
    case 'checks':
    case 'event':
    case 'older':
      return 'This event isn’t a comment';
    default:
      row satisfies never;
      return 'This event isn’t a comment';
  }
}

/**
 * The comment `row` is, which `login` can make `change` to, or why not: it isn't a comment, it's
 * someone else's, or GitHub doesn't let them.
 */
export function changeTarget(
  row: Row,
  hidden: boolean,
  login: string | undefined,
  change: 'edit' | 'delete',
): PullComment | string {
  const comment = commentIn(row, hidden);
  if (typeof comment === 'string') return comment;
  return whyNotChange(comment, login, change) ?? comment;
}

/**
 * Whether `row` is a comment `login` wrote, GitHub's logins ignoring case: one that says it's
 * theirs, with Edit and Delete.
 */
export function isYours(row: Row, login: string | undefined): boolean {
  const author = row.kind === 'comment' ? row.author?.login : undefined;
  return (
    author !== undefined && login !== undefined && author.toLowerCase() === login.toLowerCase()
  );
}
