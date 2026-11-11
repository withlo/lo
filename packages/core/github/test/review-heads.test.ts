// A line comment added to a pending review goes on whatever head GitHub has when it gets it. When
// that isn't the head the comment was written on, its line may hold other code, so Lo takes the
// thread back out, or says where it is when it can't.

import { Replay, replayFetch, type Interaction, type Json } from '@lo/testing';
import { expect, test } from 'vitest';

import { GithubClient, PullRef, sendReviewWrite, Token, type ReviewWrite } from '../src/index.ts';

const PLANNED = 'a'.repeat(40);
const PUSHED = 'b'.repeat(40);
const PULL = new PullRef('rozed-dev', 'e2e', 23);

function graphql(operation: string, variables: Json, body: Json, status = 200): Interaction {
  return {
    request: { method: 'POST', url: 'https://api.github.com/graphql', operation, variables },
    response: { status, headers: { 'content-type': 'application/json' }, body },
  };
}

/** Variables as a request sends them: those left undefined aren't sent. */
function onTheWire(variables: object): Json {
  const json: Json = JSON.parse(JSON.stringify(variables));
  return json;
}

/** GitHub's answer to adding a thread, which it put on `head`. */
function added(variables: object, head: string | null): Interaction {
  return graphql('AddPullRequestReviewThread', onTheWire(variables), {
    data: {
      addPullRequestReviewThread: {
        thread: {
          id: 'PRRT_1',
          comments: {
            nodes: [
              {
                id: 'PRRC_1',
                commit: head === null ? null : { oid: head },
                pullRequestReview: { id: 'PRR_1' },
              },
            ],
          },
        },
      },
    },
  });
}

const deleted = graphql(
  'DeletePullRequestReviewComment',
  { id: 'PRRC_1' },
  { data: { deletePullRequestReviewComment: { pullRequestReview: { id: 'PRR_1' } } } },
);

const LINE = {
  pullRequestReviewId: 'PRR_1',
  path: 'a.rs',
  body: 'Hm.',
  subjectType: 'LINE',
  line: 3,
  side: 'RIGHT',
  startLine: undefined,
  startSide: undefined,
} as const;

const FILE = {
  pullRequestReviewId: 'PRR_1',
  path: 'a.rs',
  body: 'Hm.',
  subjectType: 'FILE',
  line: undefined,
  side: undefined,
  startLine: undefined,
  startSide: undefined,
} as const;

function sendThrough(interactions: Interaction[], write: ReviewWrite) {
  const fetch = replayFetch(new Replay('review_heads', interactions));
  const client = new GithubClient({ fetch, token: new Token('gho_FAKE') });
  const operations = () =>
    fetch.seen.map((seen) => {
      const body: unknown = JSON.parse(new TextDecoder().decode(seen.body));
      return typeof body === 'object' && body !== null && 'operationName' in body
        ? body.operationName
        : seen.url;
    });
  return { sent: sendReviewWrite(client, PULL, write), operations };
}

test('a line thread on the head it was written on is kept', async () => {
  const { sent, operations } = sendThrough([added(LINE, PLANNED)], {
    kind: 'addThread',
    head: PLANNED,
    variables: LINE,
  });
  expect(await sent).toEqual({ review: 'PRR_1', thread: 'PRRT_1', comment: 'PRRC_1' });
  expect(operations()).toEqual(['AddPullRequestReviewThread']);
});

test('a line thread github put on a newer head is taken back out', async () => {
  const { sent, operations } = sendThrough([added(LINE, PUSHED), deleted], {
    kind: 'addThread',
    head: PLANNED,
    variables: LINE,
  });
  expect(await sent).toEqual({ refusal: 'headMoved', head: PUSHED });
  expect(operations()).toEqual(['AddPullRequestReviewThread', 'DeletePullRequestReviewComment']);
});

test('a line thread on a head github doesnt name is taken back out', async () => {
  const { sent } = sendThrough([added(LINE, null), deleted], {
    kind: 'addThread',
    head: PLANNED,
    variables: LINE,
  });
  expect(await sent).toEqual({ refusal: 'headMoved', head: undefined });
});

test('a line thread lo cant take back says where it landed', async () => {
  const failed = graphql(
    'DeletePullRequestReviewComment',
    { id: 'PRRC_1' },
    { message: 'Server Error' },
    502,
  );
  const { sent } = sendThrough([added(LINE, PUSHED), failed], {
    kind: 'addThread',
    head: PLANNED,
    variables: LINE,
  });
  expect(await sent).toEqual({
    review: 'PRR_1',
    thread: 'PRRT_1',
    comment: 'PRRC_1',
    landedOn: PUSHED,
  });
});

test('a file thread goes on the latest head whatever it is', async () => {
  const { sent, operations } = sendThrough([added(FILE, PUSHED)], {
    kind: 'addThread',
    head: PLANNED,
    variables: FILE,
  });
  expect(await sent).toEqual({ review: 'PRR_1', thread: 'PRRT_1', comment: 'PRRC_1' });
  expect(operations()).toEqual(['AddPullRequestReviewThread']);
});
