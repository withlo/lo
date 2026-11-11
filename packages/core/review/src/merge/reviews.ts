/**
 * What reviews a pull request still needs (`docs/design.md`, "Merge status").
 *
 * GitHub's `reviewDecision` says whether reviews block the merge. The reviews and review requests
 * say why: who requested changes, how many approvals are missing, and which code owners haven't
 * approved.
 */

import { outsideCase } from '../enums.ts';
import type { MergeSnapshot, Review, Reviewer } from '../merge.ts';

/**
 * Approvals the base branch's rules require and the pull request doesn't have yet.
 *
 * GitHub decides whether approvals are missing. With `more` at 0 and no `codeOwners`, GitHub
 * requires a review Lo can't attribute, such as an approval of the latest push by someone other
 * than its pusher, or a code owner whose request was removed; the merge panel says a review is
 * required.
 */
export interface MissingApprovals {
  /**
   * Approvals still needed to reach the required count. Only approvals from reviewers with write
   * access count.
   */
  readonly more: number;
  /**
   * Code owners asked to review who haven't approved, when the rules require code-owner review.
   * One owner's approval covers a file, and GitHub keeps the other owners' requests, so this can
   * name more owners than need to approve.
   */
  readonly codeOwners: readonly Reviewer[];
}

/** Whether the reviews and requests show anything missing. */
export function nothingMissing(missing: MissingApprovals): boolean {
  return missing.more === 0 && missing.codeOwners.length === 0;
}

/** Each reviewer's latest review, in the order reviewers first appear. */
export function latestReviews(snapshot: MergeSnapshot): Review[] {
  const latest: Review[] = [];
  for (const review of snapshot.reviews) {
    const earlier = latest.findIndex((seen) => sameLogin(seen.author, review.author));
    if (earlier < 0) latest.push(review);
    else latest[earlier] = review;
  }
  return latest;
}

/** Reviewers with write access whose latest review requests changes. */
export function changesRequestedBy(snapshot: MergeSnapshot): string[] {
  return latestReviews(snapshot)
    .filter((review) => review.counts && review.state === 'CHANGES_REQUESTED')
    .map((review) => review.author);
}

/**
 * The approvals missing, as far as the reviews and requests show: the required count less the
 * approvals from reviewers with write access, and, when the rules require code-owner review, the
 * code owners asked to review that no such approval covers. A user's approval covers their own
 * request; an approval on behalf of a team covers the team's.
 */
export function missingApprovals(snapshot: MergeSnapshot): MissingApprovals {
  const approvals = latestReviews(snapshot).filter(
    (review) => review.counts && review.state === 'APPROVED',
  );
  const codeOwners = snapshot.rules.codeOwnerReview
    ? snapshot.reviewRequests
        .filter((request) => request.asCodeOwner)
        .map((request) => request.reviewer)
        .filter((reviewer) => !approvals.some((review) => covers(review, reviewer)))
    : [];
  return {
    more: Math.max(0, snapshot.rules.requiredApprovals - approvals.length),
    codeOwners,
  };
}

/** Whether an approval meets a review request. */
function covers(review: Review, reviewer: Reviewer): boolean {
  switch (reviewer.kind) {
    case 'user':
      return sameLogin(review.author, reviewer.login);
    case 'team':
      return review.onBehalfOf.some((team) => sameLogin(team, reviewer.slug));
    default:
      return outsideCase(reviewer, false);
  }
}

/**
 * Whether two GitHub logins or team slugs name the same account. GitHub ignores their (ASCII) case.
 * A missing one names nobody, so it matches nothing.
 */
export function sameLogin(a: string | undefined, b: string | undefined): boolean {
  return typeof a === 'string' && typeof b === 'string' && asciiLower(a) === asciiLower(b);
}

function asciiLower(text: string): string {
  return text.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
}
