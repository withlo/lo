/**
 * The derived cassettes (`./derive.ts`): what GitHub can't be made to answer on demand, written
 * from what it answered. Add one here, and run `node testing/scripts/derive-answers.ts` to write
 * it; `nx run testing:codegen` writes them all again, as after their recorded cassettes change.
 */

import { isObject, type Interaction, type Json } from './cassette.ts';
import { answered, at, BAD_GATEWAY, graphql, only, refused, type Derivation } from './derive.ts';

/** Who the derived reads say opened a pull request: GitHub's stand-in for an account it no longer has. */
export const SOMEONE_ELSE = 'ghost';

/** The comments fixture's pull request, `testing/fixtures/comments.sh`'s. */
const COMMENTS_PULL = 94;

/**
 * `json` with pull request `number`, wherever it's read, opened by `login`: its `author` in
 * GraphQL's reads and its `user` in REST's.
 */
function openedBy(json: Json, number: number, login: string): Json {
  if (Array.isArray(json)) return json.map((each) => openedBy(each, number, login));
  if (!isObject(json)) return json;
  const changed = Object.fromEntries(
    Object.entries(json).map(([key, value]) => [key, openedBy(value, number, login)]),
  );
  if (json['number'] !== number) return changed;
  for (const key of ['author', 'user']) {
    const who = changed[key];
    if (isObject(who) && typeof who['login'] === 'string') changed[key] = { ...who, login };
  }
  return changed;
}

/**
 * Whether `request` reads pull request `number` itself, which says who opened it: GraphQL's
 * `PullRequest`, or REST's. Lists of pull requests are left as they were.
 */
function readsPull(request: Interaction['request'], number: number): boolean {
  if (request.operation !== undefined) {
    return request.operation === 'PullRequest' && at(request.variables, 'number') === number;
  }
  return request.method === 'GET' && new URL(request.url).pathname.endsWith(`/pulls/${number}`);
}

/** The state a review submitted with each verdict has. */
const STATES = { APPROVE: 'APPROVED', REQUEST_CHANGES: 'CHANGES_REQUESTED' } as const;

/**
 * The recorded submission of a pending review as a comment, `submitted`, as GitHub would answer it
 * with `event`: the review in its verdict's state. The replayer tells them apart by their variables.
 */
function submittedAs(submitted: Interaction, event: keyof typeof STATES): Interaction {
  const { request, response } = submitted;
  const review = at(response.body, 'data', 'submitPullRequestReview', 'pullRequestReview');
  if (!isObject(review) || !isObject(request.variables)) {
    throw new Error('the recorded submission names no review');
  }
  return {
    request: { ...request, variables: { ...request.variables, event } },
    response: {
      ...response,
      body: {
        data: {
          submitPullRequestReview: { pullRequestReview: { ...review, state: STATES[event] } },
        },
      },
    },
  };
}

export const DERIVATIONS: readonly Derivation[] = [
  {
    name: 'app_comments_write_others',
    from: 'app_comments_write',
    description: `app_comments_write as if someone else had opened rozed-dev/e2e#${COMMENTS_PULL}: every read of it names ${SOMEONE_ELSE} as its author, so rozed-bot may approve it or request changes, which GitHub takes from no pull request's author. The pending review's submission is answered for each verdict as it was for a comment.`,
    derive(recorded) {
      const submitted =
        recorded[only(recorded, graphql('SubmitPullRequestReview'), 'submissions')]!;
      const others = recorded.map(({ request, response }) => ({
        request,
        response:
          response.body === undefined || !readsPull(request, COMMENTS_PULL)
            ? response
            : { ...response, body: openedBy(response.body, COMMENTS_PULL, SOMEONE_ELSE) },
      }));
      return [
        ...others,
        submittedAs(submitted, 'APPROVE'),
        submittedAs(submitted, 'REQUEST_CHANGES'),
      ];
    },
  },
  {
    name: 'app_comments_write_lost',
    from: 'app_comments_write',
    description:
      "app_comments_write with the pending review's submission answered 502, as when GitHub's gateway gives up whatever it did by then: Lo can't tell whether it was submitted, and reads your reviews (YourReviews) to find out, as recorded after it was.",
    derive(recorded) {
      const place = only(recorded, graphql('SubmitPullRequestReview'), 'submissions');
      recorded[place] = answered(recorded[place]!, BAD_GATEWAY);
      return recorded;
    },
  },
  {
    name: 'app_comments_now_too_fast',
    from: 'app_comments_now',
    description:
      'app_comments_now with the comment posted at once refused as GitHub refuses content created too fast: "was submitted too quickly". Nothing was posted.',
    derive(recorded) {
      const place = only(recorded, graphql('AddPullRequestReview'), 'comments posted');
      recorded[place] = answered(
        recorded[place]!,
        refused(recorded[place]!, 'was submitted too quickly'),
      );
      return recorded;
    },
  },
  {
    name: 'review_writes_e2e_23_not_in_diff',
    from: 'review_writes_e2e_23_pending',
    description:
      "review_writes_e2e_23_pending with the first thread added to the pending review answered as GitHub answers one on lines outside the pull request's diff: no thread, and no error.",
    derive(recorded) {
      const place = recorded.findIndex(graphql('AddPullRequestReviewThread'));
      const added = recorded[place];
      if (!added) throw new Error('the recording adds no thread');
      recorded[place] = answered(added, {
        ...added.response,
        body: { data: { addPullRequestReviewThread: { thread: null } } },
      });
      return recorded;
    },
  },
  {
    name: 'attachments_e2e_not_found',
    from: 'attachments_e2e',
    description:
      "attachments_e2e with the PNG's upload to rozed-dev/e2e answered 404, as GitHub answered its upload to a repository that doesn't exist: what a token GitHub won't take uploads from gets.",
    derive(recorded) {
      const uploads = recorded.flatMap((each, index) =>
        each.request.url.includes('/user-attachments/assets') ? [index] : [],
      );
      const first = uploads[0];
      const missing = uploads.find((index) => recorded[index]!.response.status === 404);
      if (first === undefined || missing === undefined || first === missing) {
        throw new Error('the recording holds no upload GitHub took and none it answered 404');
      }
      recorded[first] = answered(recorded[first]!, recorded[missing]!.response);
      return recorded;
    },
  },
  {
    name: 'app_merge_write_polled',
    from: 'app_merge_write',
    description:
      "app_merge_write with GitHub's 304 to a poll of each pull request Lo merged, rozed-dev/e2e#174, #175 and #176, made after the read that saw it closed: the copy of Lo that merged each stopped before it polled again.",
    derive(recorded) {
      for (const number of [174, 175, 176]) {
        const url = `https://api.github.com/repos/rozed-dev/e2e/pulls/${number}`;
        const closed = recorded.findLast(
          ({ request, response }) =>
            request.method === 'GET' &&
            request.url === url &&
            request.if_modified_since !== undefined &&
            response.status === 200,
        );
        const since = closed?.response.headers['last-modified'];
        if (!closed || since === undefined)
          throw new Error(`the recording never saw #${number} change`);
        const { 'content-type': _type, ...headers } = closed.response.headers;
        recorded.push({
          request: { ...closed.request, if_modified_since: since },
          response: { status: 304, headers },
        });
      }
      return recorded;
    },
  },
  {
    name: 'app_merge_write_moved',
    from: 'app_merge_write',
    description:
      "app_merge_write with rozed-dev/e2e#183's polls between its first and the merge answered as the first after the merge, which saw the push: Lo reads the newer push at the first poll after GitHub failed the merge, as when it polls less often than the recording did.",
    derive(recorded) {
      const merged = only(
        recorded,
        ({ request }) => request.method === 'PUT' && request.url.endsWith('/pulls/183/merge-async'),
        "#183's merges",
      );
      const checks = recorded.flatMap((each, index) =>
        each.request.operation === 'PullRequestCheck' &&
        at(each.request.variables, 'number') === 183
          ? [index]
          : [],
      );
      const after = checks.find((index) => index > merged);
      const between = checks.filter((index) => index < merged).slice(1);
      if (after === undefined || between.length === 0) {
        throw new Error(
          'the recording polls #183 neither between its first poll and the merge nor after',
        );
      }
      for (const index of between)
        recorded[index] = answered(recorded[index]!, recorded[after]!.response);
      return recorded;
    },
  },
  {
    name: 'app_merge_write_lost',
    from: 'app_merge_write',
    description:
      "app_merge_write with the merge of rozed-dev/e2e#183 answered 502, as when GitHub's gateway gives up whatever it did by then: Lo can't tell whether it merged, and reads the pull request to find out, which says it's open, as GitHub failed that merge.",
    derive(recorded) {
      const place = only(
        recorded,
        ({ request }) => request.method === 'PUT' && request.url.endsWith('/pulls/183/merge-async'),
        "#183's merges",
      );
      recorded[place] = answered(recorded[place]!, BAD_GATEWAY);
      return recorded;
    },
  },
];
