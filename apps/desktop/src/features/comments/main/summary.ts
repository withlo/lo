// The submit dialog's summary, in main: one draft a pull request for each account, kept in the
// drafts store as comment boxes' drafts are, and offered to the review feature as
// `comments.drafts`. Nothing here calls Electron.

import type { DraftsService, SummaryDraft } from '../service.ts';
import { type DraftStore, type Kept, SUMMARY, type SummaryPlace } from './drafts.ts';

/** A summary as the service hands it out. */
function summaryOf(kept: Kept<SummaryPlace>): SummaryDraft {
  const { text, savedAt, restored, sent, sentAt } = kept;
  return { text, savedAt, restored, sent, sentAt };
}

/** Whether a kept summary says nothing: blank, and not marked sent. Such a one isn't kept. */
function empty(kept: Kept<SummaryPlace>): boolean {
  return kept.sent === null && kept.text.trim() === '';
}

/** The summaries in `store`, which is asked for only once it's there, as the feature starts. */
export function summaries(store: () => DraftStore): DraftsService {
  return {
    summary(login, pull) {
      const kept = store().get(login, pull, SUMMARY);
      return kept && !empty(kept) ? summaryOf(kept) : undefined;
    },
    saveSummary(login, pull, text) {
      store().save(login, pull, SUMMARY, text);
    },
    markSummarySent(login, pull, sent, at) {
      store().markSent(login, pull, SUMMARY, sent, at, true);
      // A blank summary is kept only while it's marked sent: unmarked, it goes.
      const kept = store().get(login, pull, SUMMARY);
      if (kept && empty(kept)) store().take(login, pull, SUMMARY);
    },
    takeSummary(login, pull) {
      store().take(login, pull, SUMMARY);
    },
    markedSummaries: () =>
      store()
        .markedSummaries()
        .map(({ account, pull, kept }) => ({ login: account, pull, summary: summaryOf(kept) })),
  };
}
