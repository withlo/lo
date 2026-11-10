/**
 * Reading the signed-in user's pending review on a pull request: the review they're writing,
 * which GitHub keeps until it's submitted. GitHub keeps at most one per person per pull request.
 */

import type { GithubClient } from './client.ts';
import { GithubError } from './errors.ts';
import { PendingReviewDocument, type PendingReviewQuery } from './generated/graphql.ts';
import { notFound } from './pager.ts';
import type { PullRef } from './refs.ts';

type PendingReviews = NonNullable<
  NonNullable<NonNullable<PendingReviewQuery['repository']>['pullRequest']>['reviews']
>;

/**
 * A pending review, as `PendingReview` reads it: its `id`, the commit it's recorded on
 * (`commit.oid`, or nothing once GitHub no longer has the commit), and how many comments it holds
 * (`comments.totalCount`).
 */
export type ViewerPendingReview = NonNullable<NonNullable<PendingReviews['nodes']>[number]>;

/**
 * What GitHub's answer says of the signed-in user's pending review: `review`, or none; or that
 * it's unknown, when GitHub left the review out or answered with an error about it. GitHub keeps
 * at most one pending review per person, and refuses a second, so an unknown one is never taken
 * for none.
 */
export type PendingReviewRead =
  { kind: 'read'; review: ViewerPendingReview | undefined } | { kind: 'unknown'; why: string };

/**
 * The pending review the user with login `login` has on `pull`, or none, or that it's unknown.
 * `login` is the signed-in user's: nobody else's pending review can be read. An error that leaves
 * out the reviews fails the read; a review GitHub leaves out as a null, or any error about one,
 * makes it unknown.
 */
export async function pendingReview(
  client: GithubClient,
  pull: PullRef,
  login: string,
): Promise<PendingReviewRead> {
  const { owner, name } = pull.repo;
  const { data, errors } = await client.graphqlWithErrors(
    PendingReviewDocument,
    { owner, name, number: pull.number, login },
    3,
  );
  const found = data.repository?.pullRequest;
  if (!found) throw notFound(`pull request ${pull.toString()}`);
  if (!found.reviews) {
    throw new GithubError({ kind: 'decode', message: "GitHub didn't list the pending reviews" });
  }
  if (errors.length > 0) {
    return { kind: 'unknown', why: errors.map((error) => error.message).join('; ') };
  }
  const nodes = found.reviews.nodes ?? [];
  // GitHub leaves out a review it can't show as a null: there is one, and Lo can't see it.
  if (nodes.includes(null)) {
    return { kind: 'unknown', why: 'GitHub left out a pending review it could not show' };
  }
  return { kind: 'read', review: nodes.find((node) => node !== null) ?? undefined };
}
