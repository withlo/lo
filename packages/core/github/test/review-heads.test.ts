// A line comment added to a pending review goes on whatever head GitHub has when it gets it. When
// that isn't the head the comment was written on, its line may hold other code, so Lo takes the
// thread back out in a write of its own, and says where it is when it can't. Run through the
// poller on a fake clock, so each write takes its turn in the account's queue.

import type { Interaction, Json } from '@lo/testing';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { answer, at, log, Polling, pr, recorded, useFakeClock, wall } from './support/polling.ts';
import type { ReviewWrite } from '../src/review-writes.ts';

beforeEach(useFakeClock);

afterEach(() => {
  vi.useRealTimers();
});

const PLANNED = 'a'.repeat(40);
const PUSHED = 'b'.repeat(40);

/** A GraphQL request for `operation` with the variables `asked`, answered with `body` and `status`. */
function graphql(operation: string, asked: Json, body: Json, status = 200): Interaction {
  const like = structuredClone(at(recorded(), 1));
  like.request.operation = operation;
  like.request.variables = asked;
  delete like.request.query_sha256;
  like.response = { status, headers: { 'content-type': 'application/json' }, body };
  return like;
}

/** What adding a thread on `line` of `a.rs`, or on the file, to your pending review `PRR_1` sends. */
function variables(line: number | 'file'): Json {
  return line === 'file'
    ? { pullRequestReviewId: 'PRR_1', path: 'a.rs', body: 'Hm.', subjectType: 'FILE' }
    : {
        pullRequestReviewId: 'PRR_1',
        path: 'a.rs',
        body: 'Hm.',
        subjectType: 'LINE',
        line,
        side: 'RIGHT',
      };
}

/** The thread on `line`, or on the file, planned on {@link PLANNED}. */
function addThread(line: number | 'file'): ReviewWrite {
  return {
    kind: 'addThread',
    head: PLANNED,
    variables: {
      pullRequestReviewId: 'PRR_1',
      path: 'a.rs',
      body: 'Hm.',
      subjectType: line === 'file' ? 'FILE' : 'LINE',
      line: line === 'file' ? undefined : line,
      side: line === 'file' ? undefined : 'RIGHT',
      startLine: undefined,
      startSide: undefined,
    },
  };
}

/** GitHub's answer to adding the thread on `line`, its comment `PRRC_<line>` put on `head`. */
function added(line: number | 'file', head: string | null, comments = true): Interaction {
  const id = line === 'file' ? 'PRRC_0' : `PRRC_${line}`;
  const node = {
    id,
    commit: head === null ? null : { oid: head },
    pullRequestReview: { id: 'PRR_1' },
  };
  return graphql('AddPullRequestReviewThread', variables(line), {
    data: {
      addPullRequestReviewThread: {
        thread: { id: `PRRT_${line}`, comments: { nodes: comments ? [node] : [] } },
      },
    },
  });
}

/** GitHub's answer to deleting the comment `PRRC_<line>`: deleted, a `null` payload, or an error. */
function deleted(line: number, answered: 'deleted' | 'null' | 'lost' | 'limited'): Interaction {
  const asked = { id: `PRRC_${line}` };
  switch (answered) {
    case 'lost':
      return graphql('DeletePullRequestReviewComment', asked, { message: 'Server Error' }, 502);
    case 'limited': {
      const limited = graphql(
        'DeletePullRequestReviewComment',
        asked,
        { message: 'You have exceeded a secondary rate limit.' },
        403,
      );
      limited.response.headers['retry-after'] = '60';
      return limited;
    }
    case 'null':
    case 'deleted':
      return graphql('DeletePullRequestReviewComment', asked, {
        data: {
          deletePullRequestReviewComment:
            answered === 'null' ? null : { pullRequestReview: { id: 'PRR_1' } },
        },
      });
    default:
      return answered satisfies never;
  }
}

/** GitHub's answer to reading the comment `PRRC_<line>`: still there, gone ("not found"), or failed. */
function read(line: number, found: 'there' | 'gone' | 'failed'): Interaction {
  const asked = { comment: `PRRC_${line}`, thread: `PRRT_${line}` };
  switch (found) {
    case 'failed':
      return graphql('ReviewComment', asked, { message: 'Server Error' }, 502);
    case 'gone':
      return graphql('ReviewComment', asked, {
        data: { comment: null, thread: null },
        errors: [
          {
            type: 'NOT_FOUND',
            path: ['comment'],
            message: `Could not resolve to a node with the global id of 'PRRC_${line}'.`,
          },
        ],
      });
    case 'there':
      return graphql('ReviewComment', asked, {
        data: {
          comment: { __typename: 'PullRequestReviewComment', id: `PRRC_${line}`, state: 'PENDING' },
          thread: { __typename: 'PullRequestReviewThread', isResolved: false },
        },
      });
    default:
      return found satisfies never;
  }
}

/** The thread on `line` as GitHub made it, put on `head`. */
function made(line: number, head: string | undefined) {
  return { review: 'PRR_1', thread: `PRRT_${line}`, comment: `PRRC_${line}`, commit: head };
}

/** A poller replaying `interactions`, and a way to send a thread through it and wait for its answer. */
async function sending(name: string, interactions: Interaction[]) {
  const t = await Polling.start(name, interactions);
  const send = (write: ReviewWrite) => t.finish(t.poller.sendReview(pr(1), write));
  return { t, send };
}

test('a line thread on the head it was written on is kept', async () => {
  const { t, send } = await sending('heads_kept', [added(3, PLANNED)]);
  expect(await send(addThread(3))).toEqual(made(3, PLANNED));
  expect(t.requests()).toEqual(log([0, 'AddPullRequestReviewThread']));
});

test('a line thread github put on a newer head is taken back in a write of its own', async () => {
  const { t, send } = await sending('heads_taken_back', [added(3, PUSHED), deleted(3, 'deleted')]);
  expect(await send(addThread(3))).toEqual({ refusal: 'headMoved', head: PUSHED });
  // A second after the add, as between any two writes.
  expect(t.requests()).toEqual(
    log([0, 'AddPullRequestReviewThread'], [1, 'DeletePullRequestReviewComment']),
  );
});

test('a line thread on a head github doesnt name is taken back', async () => {
  const { t, send } = await sending('heads_unnamed', [added(3, null), deleted(3, 'deleted')]);
  expect(await send(addThread(3))).toEqual({ refusal: 'headMoved', head: undefined });
  expect(t.requests().map(([, what]) => what)).toEqual([
    'AddPullRequestReviewThread',
    'DeletePullRequestReviewComment',
  ]);
});

test('a delete github answers without saying it deleted is checked with a read', async () => {
  const { t, send } = await sending('heads_null_delete', [
    added(3, PUSHED),
    deleted(3, 'null'),
    read(3, 'there'),
    added(4, PUSHED),
    deleted(4, 'null'),
    read(4, 'gone'),
  ]);
  // Still there: flagged, and never said to be taken back, so sending the draft again can't post
  // it twice.
  expect(await send(addThread(3))).toEqual({ ...made(3, PUSHED), landedOn: { head: PUSHED } });
  // Gone after all.
  expect(await send(addThread(4))).toEqual({ refusal: 'headMoved', head: PUSHED });
  expect(t.requests().map(([, what]) => what)).toEqual([
    'AddPullRequestReviewThread',
    'DeletePullRequestReviewComment',
    'ReviewComment',
    'AddPullRequestReviewThread',
    'DeletePullRequestReviewComment',
    'ReviewComment',
  ]);
});

test('a delete whose answer was lost is checked with a read, and flagged when that fails', async () => {
  const { t, send } = await sending('heads_lost_delete', [
    added(3, PUSHED),
    deleted(3, 'lost'),
    read(3, 'there'),
    added(4, null),
    deleted(4, 'lost'),
    read(4, 'failed'),
  ]);
  expect(await send(addThread(3))).toEqual({ ...made(3, PUSHED), landedOn: { head: PUSHED } });
  // No commit named, and nothing that says where the thread is now: flagged all the same.
  expect(await send(addThread(4))).toEqual({
    ...made(4, undefined),
    landedOn: { head: undefined },
  });
  expect(t.requests().map(([, what]) => what)).toEqual([
    'AddPullRequestReviewThread',
    'DeletePullRequestReviewComment',
    'ReviewComment',
    'AddPullRequestReviewThread',
    'DeletePullRequestReviewComment',
    'ReviewComment',
  ]);
});

test('a delete github refuses for the rate limit leaves the thread flagged and holds writes', async () => {
  const { t, send } = await sending('heads_limited', [added(3, PUSHED), deleted(3, 'limited')]);
  expect(await send(addThread(3))).toEqual({ ...made(3, PUSHED), landedOn: { head: PUSHED } });
  // Not done, so there's nothing to read; and GitHub's limit holds the writes after it.
  expect(t.requests()).toEqual(
    log([0, 'AddPullRequestReviewThread'], [1, 'DeletePullRequestReviewComment']),
  );
  expect(t.poller.writesHeldUntil()).toBe(wall(61));
});

test('a delete isnt sent while github asks lo to hold off, and the thread is flagged', async () => {
  const r = recorded();
  const limited = answer(
    at(r, 0),
    403,
    [['retry-after', '60']],
    '{"message":"You have exceeded a secondary rate limit."}',
  );
  const t = await Polling.start('heads_held', [added(3, PUSHED), limited], { delay: 1000 });
  // The open PR's poll waits for the add (0–1 s), and GitHub answers it with a secondary limit
  // before the delete's turn comes.
  const sent = t.poller.sendReview(pr(1), addThread(3));
  await t.run();
  void t.poller.setOpen(pr(1));
  expect(await t.finish(sent)).toEqual({ ...made(3, PUSHED), landedOn: { head: PUSHED } });
  expect(t.requests().map(([, what]) => what)).toEqual([
    'AddPullRequestReviewThread',
    'GET /pulls/1',
  ]);
});

test('a thread github answers without its comment is flagged', async () => {
  const { t, send } = await sending('heads_no_comment', [added(3, PUSHED, false)]);
  expect(await send(addThread(3))).toEqual({
    review: undefined,
    thread: 'PRRT_3',
    comment: undefined,
    commit: undefined,
    landedOn: { head: undefined },
  });
  expect(t.requests().map(([, what]) => what)).toEqual(['AddPullRequestReviewThread']);
});

test('a file thread goes on the latest head whatever it is', async () => {
  const { t, send } = await sending('heads_file', [added('file', PUSHED)]);
  expect(await send(addThread('file'))).toEqual({
    review: 'PRR_1',
    thread: 'PRRT_file',
    comment: 'PRRC_0',
    commit: PUSHED,
  });
  expect(t.requests().map(([, what]) => what)).toEqual(['AddPullRequestReviewThread']);
});
