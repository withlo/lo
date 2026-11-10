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
  // A review GitHub can't show comes as a null, and is passed over.
  const read = await pendingReview(answering(reviews([null, review])), PULL, 'rozed-bot');
  expect(read).toEqual(review);
});

test('without a pending review there is none', async () => {
  expect(await pendingReview(answering(reviews([])), PULL, 'rozed-bot')).toBeUndefined();
});

test('a pending review on a commit github lost has none', async () => {
  const review = { id: 'PRR_1', commit: null, comments: { totalCount: 1 } };
  const read = await pendingReview(answering(reviews([review])), PULL, 'rozed-bot');
  expect(read?.commit).toBeNull();
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

test('an error in one review keeps the read', async () => {
  // A field below a review is the review's own: the rest of the answer still holds.
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
  const read = await pendingReview(answering(body), PULL, 'rozed-bot');
  expect(read?.id).toBe('PRR_1');
});
