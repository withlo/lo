// What the window knows of submitting reviews: for each view of a pull request's tab, your pending
// review and its revisions, as main sends them, how submitting stands, and the banners dismissed;
// and the submit dialog, while it's open. Only this feature writes here.

import { createStore } from 'zustand/vanilla';

import type { PendingReviewRow, ReviewView } from '../../comments/contract.ts';
import type { ComparisonView } from '../../revisions/contract.ts';
import { tabState } from '../../tab/window/shared.ts';
import type {
  DialogView,
  ReviewEventRow,
  Submission,
  SubmitRefusal,
  Submitting,
} from '../contract.ts';
import { comments, revisions as revisionsClient } from './main.ts';

/** Your pending review on each view, as main last sent it. */
export const pendings = tabState<PendingReviewRow | undefined>(() => undefined);

/** Each view's revisions and what it compares, as main last sent them, for their labels. */
export const revisions = tabState<ComparisonView | undefined>(() => undefined);

/** How submitting from each view stands, as main last said. */
export const submitting = tabState<Submitting | null>(() => null);

/** The banners each view's reader dismissed, by what they said. */
export const dismissed = tabState<ReadonlySet<string>>(() => new Set());

/**
 * The submit dialog, for view `view` of pull request `number`: `read` is what main read as it
 * opened, once it has; `event` the verdict chosen; `text` the summary as typed; `busy` while main
 * is asked to submit; `refusal`, why the last submit didn't go.
 */
export interface Dialog {
  readonly view: string;
  readonly number: number;
  readonly read: DialogView | undefined;
  readonly event: ReviewEventRow;
  readonly text: string;
  readonly busy: boolean;
  readonly refusal: SubmitRefusal | undefined;
}

export interface ReviewWindowState {
  readonly dialog: Dialog | undefined;
}

export const reviewStore = createStore<ReviewWindowState>()(() => ({ dialog: undefined }));

/** Changes the dialog, if it's open on `view`. */
export function changeDialog(view: string, change: Partial<Dialog>): void {
  const { dialog } = reviewStore.getState();
  if (dialog?.view !== view) return;
  reviewStore.setState({ dialog: { ...dialog, ...change } });
}

/** Takes your pending review main sent. */
export function takeReview(view: ReviewView): void {
  if (pendings.get(view.id) !== view.review) pendings.set(view.id, view.review);
}

/** Takes a view's revisions main sent. */
export function takeRevisions(view: ComparisonView): void {
  if (revisions.get(view.id) !== view) revisions.set(view.id, view);
}

/** Takes how submitting from a view stands. */
export function takeSubmission(submission: Submission): void {
  if (submitting.get(submission.id) !== submission.state) {
    submitting.set(submission.id, submission.state);
  }
}

const asked = new Set<string>();

/**
 * Asks main for a view's pending review and revisions, once, for a view drawn before main said
 * anything of them.
 */
export function catchUp(view: string): void {
  if (asked.has(view)) return;
  asked.add(view);
  comments()
    .current({ id: view })
    .then(({ review }) => {
      if (review && pendings.get(view) === undefined) takeReview(review);
    })
    .catch((error: unknown) => console.error("Lo couldn't ask about a pending review:", error));
  revisionsClient()
    .list({ id: view })
    .then((list) => {
      if (list && revisions.get(view) === undefined) takeRevisions(list);
    })
    .catch((error: unknown) => console.error("Lo couldn't ask about a view's revisions:", error));
}
