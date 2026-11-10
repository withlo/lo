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
 * The pending review the user with login `login` has on `pull`, or nothing when they have none.
 * `login` is the signed-in user's: nobody else's pending review can be read. An error that leaves
 * out the reviews, rather than a field of one, fails the read, so it's never taken for having
 * none.
 */
export async function pendingReview(
  client: GithubClient,
  pull: PullRef,
  login: string,
): Promise<ViewerPendingReview | undefined> {
  const { owner, name } = pull.repo;
  const { data } = await client.graphqlWithErrors(
    PendingReviewDocument,
    { owner, name, number: pull.number, login },
    3,
  );
  const found = data.repository?.pullRequest;
  if (!found) throw notFound(`pull request ${pull.toString()}`);
  if (!found.reviews) {
    throw new GithubError({ kind: 'decode', message: "GitHub didn't list the pending reviews" });
  }
  // GitHub leaves out a review it can't show, as a null.
  return found.reviews.nodes?.find((node) => node !== null) ?? undefined;
}
