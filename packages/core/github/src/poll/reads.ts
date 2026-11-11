/**
 * Reads about a pull request that the poller keeps current and in its cache
 * ({@link Poller.readCached}), and the kinds of them Lo keeps.
 */

import { MERGE_FACTS_WATCHED, mergeFactsComplete, type MergeFacts } from '../merge.ts';
import type { PendingReviewRead } from '../pending.ts';
import { PUSH_HISTORY_WATCHED, pushHistoryIsComplete, type PushHistory } from '../push-history.ts';
import { STACK_LAYERS_WATCHED, stackLayersComplete, type StackLayerList } from '../stack-layers.ts';
import type { ReviewThreadList } from '../threads.ts';
import type { PullRequestTimeline } from '../timeline.ts';

/**
 * Something about a pull request that the poller reads, keeps under `name`, and reads again while
 * the pull request is open when the fields it watches in the pull request's cheap check change,
 * and on the 5-minute refresh. Its values are plain JSON, so the cache can keep them.
 */
export interface ReadKind<T> {
  /** Its name, which no other read the poller keeps has. */
  readonly name: string;
  /**
   * The fields of the open pull request's check (`PullRequestCheck`) whose change means it's out
   * of date, as JSON pointers into the check, which names fields as GraphQL does:
   * `/headRefOid`, `/submittedReviews/totalCount`.
   */
  readonly watched: readonly string[];
  /**
   * Whether every part of `value` was read. One that isn't, because a part failed for a reason
   * that may pass, is kept and shown, and read again after a wait, as a read that failed is,
   * whatever its watched fields say. Every value is whole without it.
   */
  readonly complete?: ((value: T) => boolean) | undefined;
}

/**
 * The values of the fields `watched` names in `check`. A field the check doesn't have reads apart
 * from a null one, so a misspelt field can't match a stamp made when it was there.
 */
export function stamp(check: unknown, watched: readonly string[]): string {
  return watched
    .map((pointer) => {
      const found = at(check, pointer);
      return found.present ? canonical(found.value) : '<absent>';
    })
    .join('\n');
}

/** The value `pointer`, a JSON pointer, names in `json`. */
function at(json: unknown, pointer: string): { present: boolean; value?: unknown } {
  if (pointer === '') return { present: true, value: json };
  let value = json;
  for (const part of pointer.slice(1).split('/')) {
    const key = part.replaceAll('~1', '/').replaceAll('~0', '~');
    if (Array.isArray(value)) {
      if (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length) return { present: false };
      value = value[Number(key)];
    } else if (typeof value === 'object' && value !== null && Object.hasOwn(value, key)) {
      value = Reflect.get(value, key);
    } else {
      return { present: false };
    }
  }
  return { present: true, value };
}

/** `value` as JSON with every object's keys sorted, so the order GitHub sends them in doesn't matter. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_, field: unknown) => {
    if (typeof field !== 'object' || field === null || Array.isArray(field)) return field;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(field).toSorted()) sorted[key] = Reflect.get(field, key);
    return sorted;
  });
}

/**
 * Whether two JSON values are the same: a field left out and one that's `undefined` are, as they
 * are once written to JSON.
 */
export function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((item, index) => sameJson(item, b[index]))
    );
  }
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (!sameJson(Reflect.get(a, key), Reflect.get(b, key))) return false;
  }
  return true;
}

/**
 * Where a read the poller keeps stood when it was asked to read everything again
 * ({@link Poller.readAfresh}): what a run that started later reads is past it
 * ({@link Poller.readSince}). It names the read it was taken from, so it's never compared with
 * another's runs: another poller's, or one the poller made again after letting go of it.
 */
export interface ReadMark {
  readonly read: number;
  readonly generation: number;
}

/** Where a read the poller keeps stands against a {@link ReadMark}. */
export type SinceMark<T> =
  /** No run that started after the mark has finished yet. */
  | { kind: 'waiting' }
  /** One has, without all of the value, so the read runs again after a wait. */
  | { kind: 'partial' }
  /** One has finished with all of it: what the read holds now. */
  | { kind: 'read'; read: T }
  /**
   * The mark isn't this read's: it's another poller's, or from a read the poller has let go of
   * since. Take a new one.
   */
  | { kind: 'stale' };

/**
 * A pull request's push history. A push changes the head, a retarget the base, a merge or close
 * the state, and a submitted review the count of submitted reviews.
 */
export const PUSH_HISTORY: ReadKind<PushHistory> = {
  name: 'PushHistory',
  watched: PUSH_HISTORY_WATCHED,
  complete: pushHistoryIsComplete,
};

/**
 * A pull request's review threads. A push moves threads and makes some outdated. A new or deleted
 * thread anywhere moves the count, a reply or a deleted comment the comment count of its thread,
 * and resolving one its state: the check holds both for the first 100 threads. Your pending review
 * holds your pending threads and replies, which are posted when you submit it, from Lo or anywhere
 * else. Edits show on the 5-minute refresh, and so do replies to threads past the first 100. A
 * comment on the pull request itself, a review without comments, or a label changes none of them.
 */
export const REVIEW_THREADS: ReadKind<ReviewThreadList> = {
  name: 'ReviewThreads',
  watched: ['/headRefOid', '/reviewThreads', '/viewerPendingReview'],
  complete: (threads) => threads.missing === 0,
};

/**
 * Your pending review. Only you change it, and the check holds its comment count, or nothing when
 * you have none, so starting, adding to, submitting or deleting it from anywhere moves it. The
 * check's is only a trigger: it asks for any pending review it can see, while this asks for yours
 * by login. One GitHub's answer left unknown is read again after a wait.
 */
export const PENDING_REVIEW: ReadKind<PendingReviewRead> = {
  name: 'PendingReview',
  watched: ['/viewerPendingReview'],
  complete: (read) => read.kind !== 'unknown',
};

/**
 * A pull request's timeline. The check counts the items the timeline shows and holds when the
 * newest was made, so an item added or deleted changes them, and a mention or a subscription
 * doesn't. An edit changes neither, but it moves the pull request's own `updatedAt`, which a new
 * title and other changes move too: reading the newest page again then is cheap, and it shows an
 * edit there at the next poll. An edit of an older item by someone else shows at the next full
 * read, within the hour; Lo's own edits read it in full themselves. With them, the latest commit's
 * checks, and when the description was last edited.
 */
export const TIMELINE: ReadKind<PullRequestTimeline> = {
  name: 'Timeline',
  watched: ['/timelineEvents', '/statusCheckRollup', '/lastEditedAt', '/updatedAt'],
};

/** What decides whether a pull request can merge. */
export const MERGE_FACTS: ReadKind<MergeFacts> = {
  name: 'MergeFacts',
  watched: MERGE_FACTS_WATCHED,
  complete: mergeFactsComplete,
};

/** The state of the layers a stack's tree shows. */
export const STACK_LAYERS: ReadKind<StackLayerList> = {
  name: 'StackLayers',
  watched: STACK_LAYERS_WATCHED,
  complete: stackLayersComplete,
};
