/**
 * What a pull request's description card shows beside the description (`docs/design.md`,
 * "Timeline"): its labels, who was asked to review it and how each reviewer last reviewed it, who
 * it's assigned to, and whether it's a draft (`PullRequestSidebar`). Lo shows them and never
 * changes them.
 */

import type { GithubClient } from './client.ts';
import { GithubError } from './errors.ts';
import { PullRequestSidebarDocument, type PullRequestReviewState } from './generated/graphql.ts';
import type { PullRef } from './refs.ts';
import { actor, requestedReviewer, type Actor, type RequestedReviewer } from './timeline.ts';

/** A pull request's labels, reviewers and assignees, as `PullRequestSidebar` reads them. */
export interface PullRequestSidebar {
  isDraft: boolean;
  /** Its labels, in GitHub's order. */
  labels: SidebarLabel[];
  /**
   * Who was asked to review it and hasn't reviewed since, as GitHub lists them. A reviewer of a
   * kind Lo doesn't know is left out.
   */
  requested: SidebarReviewer[];
  /** Each reviewer's latest review, leaving out pending ones. */
  reviews: SidebarReview[];
  /** Who it's assigned to. */
  assignees: Actor[];
}

/**
 * Someone asked to review: a person, bot or team, or a team the account can't see, which GitHub
 * names as no one.
 */
export type SidebarReviewer = RequestedReviewer | { kind: 'hiddenTeam' };

export interface SidebarLabel {
  name: string;
  /**
   * Its color as six lowercase hex digits, without the `#`, or `undefined` when GitHub's isn't,
   * so a color never reaches a style as anything else.
   */
  color: string | undefined;
}

export interface SidebarReview {
  /** `undefined` for a deleted account. */
  author: Actor | undefined;
  state: PullRequestReviewState;
}

/** The labels, reviewers, assignees and draft state of `pull`. 1 point. */
export async function readPullRequestSidebar(
  client: GithubClient,
  pull: PullRef,
): Promise<PullRequestSidebar> {
  const data = await client.graphql(PullRequestSidebarDocument, {
    owner: pull.repo.owner,
    name: pull.repo.name,
    number: pull.number,
  });
  const pullRequest = data.repository?.pullRequest;
  if (!pullRequest) {
    throw new GithubError({
      kind: 'notFound',
      message: `Could not find pull request ${pull.toString()}`,
    });
  }
  const requested: SidebarReviewer[] = [];
  for (const request of pullRequest.reviewRequests?.nodes ?? []) {
    if (!request) continue;
    // A team the account can't see comes back as no one, without an error.
    const reviewer =
      request.requestedReviewer === null
        ? { kind: 'hiddenTeam' as const }
        : requestedReviewer(request.requestedReviewer);
    if (reviewer) requested.push(reviewer);
  }
  return {
    isDraft: pullRequest.isDraft,
    labels: (pullRequest.labels?.nodes ?? []).flatMap((label) =>
      label ? [{ name: label.name, color: labelColor(label.color) }] : [],
    ),
    requested,
    reviews: (pullRequest.latestReviews?.nodes ?? []).flatMap((review) =>
      review ? [{ author: actor(review.author), state: review.state }] : [],
    ),
    assignees: (pullRequest.assignees.nodes ?? []).flatMap((user) => actor(user) ?? []),
  };
}

/** `color`, a label's, as six lowercase hex digits, or `undefined` when it isn't that. */
export function labelColor(color: string): string | undefined {
  return /^[0-9a-fA-F]{6}$/.test(color) ? color.toLowerCase() : undefined;
}
