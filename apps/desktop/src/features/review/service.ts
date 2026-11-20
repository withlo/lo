// What the review feature offers the others in main: approving the revision on screen, as approve
// and ship does before it merges. It goes as `⌘⏎`'s submissions do, in its turn among the writes to
// the pull request, comments included, and an answer that's lost is settled by reading your
// reviews, never by sending it again.

import { defineService } from '../../main/services.ts';

/** What came of approving. */
export type Approved =
  /** GitHub took the approval, or a read of your reviews since found it. */
  | { readonly kind: 'approved' }
  /** GitHub's head is `head` now, not the one asked to approve: nothing was sent. */
  | { readonly kind: 'moved'; readonly head: string }
  /**
   * It wasn't approved: Lo didn't send it, GitHub refused it, or a read of your reviews found it
   * wasn't submitted. `why` says so, in a sentence.
   */
  | { readonly kind: 'refused'; readonly why: string }
  /**
   * GitHub's answer was lost, and Lo can't tell whether it took the approval, or was stopped before
   * it could: `why`, in a sentence. Nothing more is sent until Lo knows.
   */
  | { readonly kind: 'unknown'; readonly why: string };

/**
 * What would go with an approval from a view as its summary: none; the summary kept for the
 * submit dialog; or one that holds a file that may still be on its way in, which doesn't go.
 */
export type SummaryKept = 'none' | 'text' | 'uploading';

/** Approving, for the features that act once you've approved. */
export interface Submissions {
  /** What would go with an approval from view `id` as its summary. */
  summary(id: string): SummaryKept;
  /**
   * Approves `head`, the revision on screen in view `id`, as the view's account: your pending
   * review, submitted as the approval, when it's recorded on `head`, else an approval with the
   * summary kept for the submit dialog. It goes in its turn among the writes to the pull request,
   * and only while `head` is both the revision on screen and GitHub's head. Resolves once Lo knows
   * how it went: when GitHub's answer is lost, once a read of your reviews says, or that Lo can't
   * tell. `lost`, if given, hears at once when it's lost, before that read.
   */
  approve(id: string, head: string, lost?: () => void): Promise<Approved>;
}

export const submissions = defineService<Submissions>('review.submissions');
