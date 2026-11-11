import { expect, test } from 'vitest';

import type { GithubErrorDetail } from './errors.ts';
import type { GraphQLError } from './graphql.ts';
import { describeReviewRefusal, reviewRefusal, type ReviewWriteRefusal } from './review-writes.ts';

const UNEXPLAINED: ReviewWriteRefusal = { refusal: 'unexplained' };

/** A GraphQL answer's error of GitHub's `UNPROCESSABLE` type, as a refusal of a review is. */
function unprocessable(message: string): GithubErrorDetail {
  const error: GraphQLError = {
    message,
    type: 'UNPROCESSABLE',
    path: ['addPullRequestReview'],
  };
  return { kind: 'graphql', errors: [error] };
}

/** A REST `422` with the validation errors it lists. */
function validation(message: string, errors: unknown[]): GithubErrorDetail {
  return { kind: 'api', status: 422, message, errors };
}

/** The refusal in `detail`, which is expected to be one. */
function refusal(detail: GithubErrorDetail, empty: ReviewWriteRefusal): ReviewWriteRefusal {
  const found = reviewRefusal(detail, empty);
  if (found === undefined) throw new Error(`not a refusal: ${JSON.stringify(detail)}`);
  return found;
}

// The messages are GitHub's, from the review API checks and the recordings.

test('graphqls refusals are explained', () => {
  expect(refusal(unprocessable('Line could not be resolved'), UNEXPLAINED)).toEqual({
    refusal: 'notInDiff',
  });
  expect(
    refusal(unprocessable('User can only have one pending review per pull request'), UNEXPLAINED),
  ).toEqual({ refusal: 'pendingReviewExists' });
  for (const message of [
    'Review Can not approve your own pull request',
    'Review Can not request changes on your own pull request',
  ]) {
    expect(refusal(unprocessable(message), UNEXPLAINED)).toEqual({ refusal: 'ownPullRequest' });
  }
  // A COMMENT with neither a body nor a thread: an empty message.
  expect(refusal(unprocessable(''), { refusal: 'nothingToSubmit' })).toEqual({
    refusal: 'nothingToSubmit',
  });
  expect(refusal(unprocessable(''), UNEXPLAINED)).toEqual(UNEXPLAINED);
  expect(refusal(unprocessable("Body can't be blank"), UNEXPLAINED)).toEqual({
    refusal: 'other',
    message: "Body can't be blank",
  });
});

test('rests validation failures are explained', () => {
  const line = [
    {
      resource: 'PullRequestReviewComment',
      code: 'custom',
      field: 'pull_request_review_thread.line',
      message: 'could not be resolved',
    },
  ];
  expect(refusal(validation('Validation Failed', line), UNEXPLAINED)).toEqual({
    refusal: 'notInDiff',
  });
  const pending = [
    {
      resource: 'PullRequestReview',
      code: 'custom',
      field: 'user_id',
      message: 'user_id can only have one pending review per pull request',
    },
  ];
  expect(refusal(validation('Validation Failed', pending), UNEXPLAINED)).toEqual({
    refusal: 'pendingReviewExists',
  });
  const own = ['Review Can not approve your own pull request'];
  expect(refusal(validation('Unprocessable Entity', own), UNEXPLAINED)).toEqual({
    refusal: 'ownPullRequest',
  });
  const empty = [''];
  expect(
    refusal(validation('Unprocessable Entity', empty), { refusal: 'nothingToSubmit' }),
  ).toEqual({ refusal: 'nothingToSubmit' });
  const missing = [{ resource: 'IssueComment', code: 'missing_field', field: 'body' }];
  expect(refusal(validation('Validation Failed', missing), UNEXPLAINED)).toEqual({
    refusal: 'other',
    message: 'body: missing_field',
  });
  expect(refusal(validation('Validation Failed', []), UNEXPLAINED)).toEqual({
    refusal: 'other',
    message: 'Validation Failed',
  });
});

test('githubs limit on how fast comments come is its own refusal', () => {
  // GitHub's documented answer to content created too fast, through REST and GraphQL.
  const fast = [
    {
      resource: 'IssueComment',
      code: 'unprocessable',
      field: 'data',
      message: 'was submitted too quickly',
    },
  ];
  const tooFast: ReviewWriteRefusal = { refusal: 'tooFast', message: 'was submitted too quickly' };
  expect(refusal(validation('Validation Failed', fast), UNEXPLAINED)).toEqual(tooFast);
  expect(refusal(unprocessable('was submitted too quickly'), UNEXPLAINED)).toEqual(tooFast);
});

test('other errors are left as they were', () => {
  // Not refusals, so there's nothing to return: the write throws the error itself.
  const forbidden: GithubErrorDetail = {
    kind: 'graphql',
    errors: [
      {
        message: 'Resource not accessible by integration',
        type: 'FORBIDDEN',
        path: [],
      },
    ],
  };
  expect(reviewRefusal(forbidden, UNEXPLAINED)).toBeUndefined();
  const server: GithubErrorDetail = {
    kind: 'api',
    status: 502,
    message: 'Bad Gateway',
    errors: [],
  };
  expect(reviewRefusal(server, UNEXPLAINED)).toBeUndefined();
});

test('a rejection reads as a sentence the ui can show', () => {
  expect(describeReviewRefusal({ refusal: 'ownPullRequest' })).toBe(
    "GitHub doesn't let a pull request's author approve it or request changes",
  );
  expect(describeReviewRefusal({ refusal: 'other', message: "Body can't be blank" })).toBe(
    "GitHub refused it: Body can't be blank",
  );
});
