import { Replay, replayFetch, type Json } from '@lo/testing';
import { expect, test } from 'vitest';

import { GithubClient } from './client.ts';
import { GithubError } from './errors.ts';
import { pendingReview } from './pending.ts';
import { PullRef } from './refs.ts';
import { Token } from './token.ts';

const PULL = new PullRef('rozed-dev', 'e2e', 23);
const VARIABLES = { owner: 'rozed-dev', name: 'e2e', number: 23, login: 'rozed-bot' };

/** A client whose one `PendingReview` request, for rozed-bot on rozed-dev/e2e#23, is answered with `body`. */
function answering(body: Json): GithubClient {
  const fetch = replayFetch(
    new Replay('pending', [
      {
        request: {
          method: 'POST',
          url: 'https://api.github.com/graphql',
          operation: 'PendingReview',
          variables: VARIABLES,
        },
        response: { status: 200, headers: {}, body },
      },
    ]),
  );
  return new GithubClient({ fetch, token: new Token('gho_FAKE') });
}

function reviews(nodes: Json[]): { data: Json } {
  return { data: { repository: { pullRequest: { reviews: { nodes } } } } };
}

/** What `promise` rejected with. */
async function failure(promise: Promise<unknown>): Promise<GithubError> {
  const thrown = await promise.then(
    () => undefined,
    (error: unknown) => error,
  );
  if (thrown instanceof GithubError) return thrown;
  throw new Error(`expected a GithubError, got ${String(thrown)}`);
}

test('your pending review is read by your login', async () => {
  const review = {
    id: 'PRR_kwDOVleUfc8AAAABWv73rA',
    commit: { oid: '5a48d2255817f0f19dfdfc3168925f0cdb85c630' },
    comments: { totalCount: 4 },
  };
  const read = await pendingReview(answering(reviews([review])), PULL, 'rozed-bot');
  expect(read).toEqual({ kind: 'read', review });
});

test('without a pending review there is none', async () => {
  expect(await pendingReview(answering(reviews([])), PULL, 'rozed-bot')).toEqual({
    kind: 'read',
    review: undefined,
  });
});

test('a pending review github leaves out is unknown', async () => {
  // GitHub keeps one pending review per person: a null in its place is one Lo can't see, and
  // taken for none, it would start a second, which GitHub refuses.
  const read = await pendingReview(answering(reviews([null])), PULL, 'rozed-bot');
  expect(read.kind).toBe('unknown');
});

test('a pending review on a commit github lost has none', async () => {
  const review = { id: 'PRR_1', commit: null, comments: { totalCount: 1 } };
  const read = await pendingReview(answering(reviews([review])), PULL, 'rozed-bot');
  expect(read.kind === 'read' && read.review?.commit).toBeNull();
});

test('a pull request github cant find is not found', async () => {
  const body = {
    data: { repository: { pullRequest: null } },
    errors: [
      {
        type: 'NOT_FOUND',
        path: ['repository', 'pullRequest'],
        message: 'Could not resolve to a PullRequest with the number of 23.',
      },
    ],
  };
  const error = await failure(pendingReview(answering(body), PULL, 'rozed-bot'));
  expect(error.detail.kind).toBe('notFound');
});

test('an error that leaves out the reviews fails the read', async () => {
  // Taken for having no pending review, it would start a second one.
  const body = {
    data: { repository: { pullRequest: { reviews: null } } },
    errors: [{ path: ['repository', 'pullRequest', 'reviews'], message: 'Something went wrong' }],
  };
  const error = await failure(pendingReview(answering(body), PULL, 'rozed-bot'));
  expect(error.detail.kind).toBe('graphql');
});

test('reviews missing without an error are an answer lo cant read', async () => {
  const body = { data: { repository: { pullRequest: { reviews: null } } } };
  const error = await failure(pendingReview(answering(body), PULL, 'rozed-bot'));
  expect(error.detail.kind).toBe('decode');
});

test('an error about the review makes it unknown', async () => {
  // Whether the error nulled a field or the review itself, the answer can't be trusted to say
  // there's none.
  const review = { id: 'PRR_1', commit: null, comments: { totalCount: 2 } };
  const body = {
    ...reviews([review]),
    errors: [
      {
        type: 'FORBIDDEN',
        path: ['repository', 'pullRequest', 'reviews', 'nodes', 0, 'commit'],
        message: 'Resource not accessible by integration',
      },
    ],
  };
  expect(await pendingReview(answering(body), PULL, 'rozed-bot')).toEqual({
    kind: 'unknown',
    why: 'Resource not accessible by integration',
  });
  const nulled = {
    ...reviews([null]),
    errors: [{ path: ['repository', 'pullRequest', 'reviews', 'nodes', 0], message: 'Timeout' }],
  };
  expect(await pendingReview(answering(nulled), PULL, 'rozed-bot')).toEqual({
    kind: 'unknown',
    why: 'Timeout',
  });
});
