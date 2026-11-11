/**
 * Review threads, read from recorded answers:
 *
 * - `sharkdp/fd#2212`, a maintainer's changes-requested review whose six threads a later push made
 *   outdated, read as rozed-bot.
 * - `rozed-dev/playground#4`, the review API checks' pull request, read two threads and two
 *   comments a page.
 * - `rozed-dev/e2e#20`: a thread on a moved line and one on a line only the old side has, then
 *   rozed-bot's pending review, which it has none of.
 *
 * `@lo/review`'s tests replay the same answers to check how they map into its threads.
 */

import { cassette, Replay, replayFetch, type Json, type ReplayFetch } from '@lo/testing';
import { expect, test } from 'vitest';

import { GithubClient } from '../src/client.ts';
import { GithubError } from '../src/errors.ts';
import { unchecked } from '../src/json.ts';
import { pendingReview } from '../src/pending.ts';
import { PullRef } from '../src/refs.ts';
import {
  reviewThreads,
  reviewThreadsPaged,
  type ReviewThread,
  type ReviewThreadComment,
} from '../src/threads.ts';
import { Token } from '../src/token.ts';

const BOT = 'rozed-bot';

function client(fetch: ReplayFetch): GithubClient {
  return new GithubClient({ fetch, token: new Token('gho_FAKE') });
}

/** The GraphQL operations a replaying `fetch` was asked, in order. */
function operations(fetch: ReplayFetch): string[] {
  return fetch.seen.map(
    (seen) =>
      unchecked<{ operationName: string }>(JSON.parse(new TextDecoder().decode(seen.body)))
        .operationName,
  );
}

/** A thread's comments that GitHub gave. */
function comments(thread: ReviewThread): ReviewThreadComment[] {
  return (thread.comments.nodes ?? []).filter((comment) => comment !== null);
}

test('fd 2212s threads are outdated by the second push', async () => {
  const fetch = replayFetch('review_threads_fd_2212');
  const list = await reviewThreads(client(fetch), new PullRef('sharkdp', 'fd', 2212));

  expect(operations(fetch)).toEqual(['ReviewThreads']);
  expect(list.nodes).toHaveLength(6);
  expect(list.nodes.flatMap(comments)).toHaveLength(7);
});

test('the playgrounds review checks read two threads and two comments a page', async () => {
  const fetch = replayFetch('review_threads_playground_4_paged');
  const list = await reviewThreadsPaged(
    client(fetch),
    new PullRef('rozed-dev', 'playground', 4),
    2,
  );

  // 15 threads, two a page, and the third comment of the one thread that has three.
  expect(operations(fetch)).toEqual([
    ...Array.from({ length: 8 }, () => 'ReviewThreads'),
    'ReviewThreadComments',
  ]);
  expect(list.nodes).toHaveLength(15);
  expect(new Set(list.nodes.map((thread) => thread.id)).size).toBe(15);

  // Its first thread has a reply in a review of its own and one in the pending review that was
  // then submitted, all in order.
  const replied = list.nodes.find((thread) => comments(thread).length > 2)!;
  const read = comments(replied);
  expect(read).toHaveLength(3);
  const times = read.map((comment) => Date.parse(comment.createdAt));
  expect(times).toEqual(times.toSorted((a, b) => a - b));
  expect(new Set(read.map((comment) => comment.id)).size).toBe(3);
});

test('e9s threads show on the moved line and the line only the old side has', async () => {
  const fetch = replayFetch('review_threads_e2e_20');
  const account = client(fetch);
  await reviewThreads(account, e2e20());
  const pending = await pendingReview(account, e2e20(), BOT);

  expect(operations(fetch)).toEqual(['ReviewThreads', 'PendingReview']);
  // rozed-bot submitted its review, so it has nothing pending.
  expect(pending).toEqual({ kind: 'read', review: undefined });
});

function e2e20(): PullRef {
  return new PullRef('rozed-dev', 'e2e', 20);
}

/** `review_threads_e2e_20`'s answer to `operation`, with `edit` made to its body. */
function edited(operation: string, edit: (body: Json) => void): ReplayFetch {
  const recorded = cassette('review_threads_e2e_20')
    .interactions.map(({ interaction }) => interaction)
    .find((interaction) => interaction.request.operation === operation);
  if (!recorded) throw new Error(`review_threads_e2e_20 has no ${operation} answer`);
  const body = structuredClone(recorded.response.body ?? null);
  edit(body);
  return replayFetch(
    new Replay('review_threads_e2e_20', [
      { request: recorded.request, response: { ...recorded.response, body } },
    ]),
  );
}

/** What an edit to a recorded `ReviewThreads` answer changes. */
interface ThreadsAnswer {
  data: {
    repository: {
      pullRequest: { reviewThreads: { nodes: ({ comments: { nodes: Json[] } } | null)[] } };
    };
  };
  errors?: Json;
}

/** What an edit to a recorded `PendingReview` answer changes. */
interface PendingAnswer {
  data: { repository: { pullRequest: { reviews: Json } } };
  errors?: Json;
}

/** What `promise` failed with. */
async function failure(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('it succeeded');
}

test('threads github leaves out make the list incomplete', async () => {
  // An error nulls the first thread, and the second thread's comment.
  const fetch = edited('ReviewThreads', (json) => {
    const body = unchecked<ThreadsAnswer>(json);
    const threads = body.data.repository.pullRequest.reviewThreads.nodes;
    threads[0] = null;
    threads[1]!.comments.nodes[0] = null;
    const path = ['repository', 'pullRequest', 'reviewThreads', 'nodes'];
    body.errors = [
      { message: 'Something went wrong', path: [...path, 0] },
      { message: 'Something went wrong', path: [...path, 1, 'comments', 'nodes', 0] },
    ];
  });
  const list = await reviewThreads(client(fetch), e2e20());
  expect(list.missing).toBe(2);
  expect(list.nodes).toHaveLength(1);
  expect(list.nodes[0]!.comments.nodes).toEqual([null]);

  const whole = await reviewThreads(client(replayFetch('review_threads_e2e_20')), e2e20());
  expect(whole.missing).toBe(0);
});

test('a pending review github leaves out isnt taken for none', async () => {
  const refused = edited('PendingReview', (json) => {
    const body = unchecked<PendingAnswer>(json);
    body.data.repository.pullRequest.reviews = null;
    body.errors = [
      { message: 'Something went wrong', path: ['repository', 'pullRequest', 'reviews'] },
    ];
  });
  expect(await failure(pendingReview(client(refused), e2e20(), BOT))).toBeInstanceOf(GithubError);

  const unlisted = edited('PendingReview', (json) => {
    unchecked<PendingAnswer>(json).data.repository.pullRequest.reviews = null;
  });
  const error = await failure(pendingReview(client(unlisted), e2e20(), BOT));
  expect(error instanceof GithubError && error.detail.kind).toBe('decode');
});
