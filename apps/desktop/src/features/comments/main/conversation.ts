// Comments on a pull request itself, in its conversation, in main: the write, which joins no
// review, and whether one whose answer was lost posted, as the pull request's timeline read afresh
// says. The writer sends them, in turn with every other write to the pull request, from the draft
// of the pull request's own comment box. Nothing here calls Electron.

import type { Poller, PullRef, PullRequestTimeline, ReviewWriteRefusal } from '@lo/github';
import { sameCommentText } from '@lo/review';

/** What a comment on a pull request uses of an account's poller. */
export type ConversationPoller = Pick<Poller, 'addConversationComment'>;

/**
 * Posts `body` on `pull`, whose node ID is `pullRequestId`, in its conversation: the comment's node
 * ID, or GitHub's refusal, as while GitHub asked Lo to hold off writing. Never sent again by
 * itself: an answer lost throws an error that may have posted.
 */
export function postOnPull(
  poller: ConversationPoller,
  pull: PullRef,
  pullRequestId: string,
  body: string,
): Promise<string | ReviewWriteRefusal> {
  return poller.addConversationComment(pull, pullRequestId, body);
}

/**
 * Whether `timeline` holds a comment of `login`'s on the pull request itself whose text is `sent`,
 * made no earlier than `sentAt`, by GitHub's clock, give or take `slack` milliseconds.
 */
export function holdsPullComment(
  timeline: Pick<PullRequestTimeline, 'items'>,
  login: string,
  sent: string,
  sentAt: number,
  slack: number,
): boolean {
  const lower = login.toLowerCase();
  return timeline.items.some(
    ({ item }) =>
      item.kind === 'comment' &&
      item.comment.author?.login.toLowerCase() === lower &&
      Date.parse(item.comment.createdAt) >= sentAt - slack &&
      sameCommentText(item.comment.body, sent),
  );
}
