import { cassette } from '@lo/testing';
import { expect, test } from 'vitest';

import {
  MERGE_FACTS,
  PENDING_REVIEW,
  PULL_REQUEST_SIDEBAR,
  PUSH_HISTORY,
  REVIEW_THREADS,
  STACK_LAYERS,
  stamp,
  TIMELINE,
} from './reads.ts';

/** The check as JSON, edited freely. */
// oxlint-disable-next-line typescript/no-explicit-any
type Json = Record<string, any>;

/** PR #1's recorded check, with a thread and a pending review of yours, each with a comment. */
function check(): Json {
  const [recorded] = cassette('graphql_pull_request_check_1').interactions;
  const body: Json = JSON.parse(JSON.stringify(recorded?.interaction.response.body ?? {}));
  const pull: Json = body.data.repository.pullRequest;
  pull.reviewThreads = {
    totalCount: 1,
    nodes: [{ isResolved: false, comments: { totalCount: 1 } }],
  };
  pull.viewerPendingReview = { nodes: [{ viewerDidAuthor: true, comments: { totalCount: 1 } }] };
  return pull;
}

/** Which of the review threads, your pending review and the timeline `edit` reads again. */
function readAgain(edit: (check: Json) => void): [boolean, boolean, boolean] {
  const before = check();
  const after = structuredClone(before);
  edit(after);
  const changed = (watched: readonly string[]) => stamp(before, watched) !== stamp(after, watched);
  return [
    changed(REVIEW_THREADS.watched),
    changed(PENDING_REVIEW.watched),
    changed(TIMELINE.watched),
  ];
}

const LATER = '2026-11-07T12:00:00Z';

/** The check's counts of check runs by state, with `inProgress` running and `success` passed. */
function counts(inProgress: number, success: number) {
  return {
    contexts: {
      checkRunCountsByState: [
        { state: 'IN_PROGRESS', count: inProgress },
        { state: 'SUCCESS', count: success },
      ],
      statusContextCountsByState: [{ state: 'PENDING', count: 0 }],
    },
  };
}

test('every kept read watches fields the check has', () => {
  const pull = check();
  for (const kind of [
    PUSH_HISTORY,
    STACK_LAYERS,
    REVIEW_THREADS,
    PENDING_REVIEW,
    TIMELINE,
    MERGE_FACTS,
    PULL_REQUEST_SIDEBAR,
  ]) {
    for (const pointer of kind.watched) {
      expect.soft(stamp(pull, [pointer])).not.toBe('<absent>');
    }
  }
});

test('threads your pending review and the timeline are read again only when they change', () => {
  // Someone mentions the pull request elsewhere: only the whole timeline moves.
  const mentioned = readAgain((pull) => {
    pull.timelineItems.updatedAt = LATER;
    pull.timelineItems.totalCount += 1;
  });
  expect(mentioned).toEqual([false, false, false]);
  // A comment on the pull request, or a label.
  const commented = readAgain((pull) => {
    pull.comments.totalCount += 1;
    pull.timelineEvents.filteredCount += 1;
    pull.timelineEvents.updatedAt = LATER;
  });
  expect(commented).toEqual([false, false, true]);
  // The newest item's time moves alone: an item added as another was deleted.
  expect(readAgain((pull) => (pull.timelineEvents.updatedAt = LATER))).toEqual([
    false,
    false,
    true,
  ]);
  // A comment edited: only the pull request's own time moves.
  expect(readAgain((pull) => (pull.updatedAt = LATER))).toEqual([false, false, true]);
  // Checks start on the latest commit, and the description is edited.
  expect(readAgain((pull) => (pull.statusCheckRollup = { state: 'PENDING' }))).toEqual([
    false,
    false,
    true,
  ]);
  expect(readAgain((pull) => (pull.lastEditedAt = LATER))).toEqual([false, false, true]);
  // A reply, posted at once: a review of its own, in the timeline too.
  const replied = readAgain((pull) => {
    pull.reviewThreads.nodes[0].comments.totalCount += 1;
    pull.reviews.totalCount += 1;
    pull.submittedReviews.totalCount += 1;
    pull.timelineEvents.filteredCount += 1;
    pull.timelineEvents.updatedAt = LATER;
  });
  expect(replied).toEqual([true, false, true]);
  // A thread resolved, or a push.
  expect(readAgain((pull) => (pull.reviewThreads.nodes[0].isResolved = true))).toEqual([
    true,
    false,
    false,
  ]);
  const pushed = readAgain((pull) => {
    pull.headRefOid = 'c7f30e9b1a5d7c3e9f1b5d7a3c9e1f5b7d3a9c62';
    pull.timelineEvents.filteredCount += 1;
  });
  expect(pushed).toEqual([true, false, true]);
  // You add to your pending review, from Lo or from GitHub's web pages: the threads hold your
  // pending comments too.
  const pending = readAgain((pull) => {
    pull.viewerPendingReview.nodes[0].comments.totalCount += 1;
  });
  expect(pending).toEqual([true, true, false]);
  // You delete it.
  expect(readAgain((pull) => (pull.viewerPendingReview.nodes = []))).toEqual([true, true, false]);
  // You submit it: its comments are posted, though no count of the threads moves.
  const submitted = readAgain((pull) => {
    pull.viewerPendingReview.nodes = [];
    pull.submittedReviews.totalCount += 1;
    pull.timelineEvents.filteredCount += 1;
    pull.timelineEvents.updatedAt = LATER;
  });
  expect(submitted).toEqual([true, true, true]);
});

test('what decides a merge is read again when github may decide otherwise', () => {
  const before = check();
  const changed = (edit: (pull: Json) => void) => {
    const after = structuredClone(before);
    edit(after);
    return stamp(before, MERGE_FACTS.watched) !== stamp(after, MERGE_FACTS.watched);
  };

  // Someone mentions the pull request elsewhere, or edits its description.
  expect(changed((pull) => (pull.timelineItems.totalCount += 1))).toBe(false);
  expect(changed((pull) => (pull.lastEditedAt = LATER))).toBe(false);
  const edits: ((pull: Json) => void)[] = [
    // A push, or GitHub working out mergeability again.
    (pull) => (pull.headRefOid = 'c7f30e9b1a5d7c3e9f1b5d7a3c9e1f5b7d3a9c62'),
    (pull) => (pull.mergeStateStatus = 'DIRTY'),
    // The base moves on, or another one is picked.
    (pull) => (pull.baseRefOid = 'd4c3b2a1d4c3b2a1d4c3b2a1d4c3b2a1d4c3b2a1'),
    (pull) => (pull.baseRefName = 'release'),
    // A review, a check, a thread resolved, the queue, the draft.
    (pull) => (pull.submittedReviews.totalCount += 1),
    (pull) => (pull.statusCheckRollup = { state: 'FAILURE' }),
    (pull) => (pull.reviewThreads.nodes[0].isResolved = true),
    (pull) => (pull.mergeQueueEntry = { position: 1 }),
    (pull) => (pull.isDraft = true),
    // Your pending review, which approve and ship submits.
    (pull) => (pull.viewerPendingReview.nodes = []),
    // A review requested, auto-merge turned on, or a comment.
    (pull) => (pull.timelineEvents.filteredCount += 1),
  ];
  for (const edit of edits) expect(changed(edit)).toBe(true);

  // A required check finishes while others still run: the combined state stays pending, and only
  // the counts move. Only the merge read is read again.
  const running = structuredClone(before);
  running.statusCheckRollup = { state: 'PENDING' };
  running.checkCounts = counts(2, 1);
  const finished = structuredClone(running);
  finished.checkCounts = counts(1, 2);
  const moved = (watched: readonly string[]) =>
    stamp(running, watched) !== stamp(finished, watched);
  expect(moved(MERGE_FACTS.watched)).toBe(true);
  for (const kind of [
    PUSH_HISTORY,
    STACK_LAYERS,
    REVIEW_THREADS,
    PENDING_REVIEW,
    TIMELINE,
    PULL_REQUEST_SIDEBAR,
  ]) {
    expect.soft(moved(kind.watched)).toBe(false);
  }
});

test('a stamp holds the watched fields values', () => {
  const pull = { headRefOid: 'abc', reviews: { totalCount: 9 } };
  expect(stamp(pull, ['/headRefOid', '/reviews/totalCount'])).toBe('"abc"\n9');
  // A field the check doesn't have isn't a null one.
  expect(stamp(pull, ['/nope'])).toBe('<absent>');
  expect(stamp({ nope: null }, ['/nope'])).toBe('null');
});
