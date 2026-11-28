// What the timeline on screen shows of what main sends: nothing on screen moves without the
// reader's input, so a change that comes while they look, as a comment someone posts, waits for
// their next key, click or scroll. A timeline goes on screen at once while it isn't on screen, when
// it's the first the reader sees or fills in the newest page they see, and while what the reader's
// own write changed is still to come: a comment they posted from the box at its end, or one of
// theirs they edited or deleted, which shows as it comes, for a minute at most. Plain functions,
// tested alone.

import type { PullWrite } from '../../comments/window/shared.ts';
import type { Timeline, TimelineView } from '../contract.ts';

/** How long Lo waits for what the reader's own write changed, in milliseconds. */
export const CLAIM_FOR = 60_000;

/**
 * A write of the reader's whose change the timeline shows at once, until `until`. For a comment
 * posted, `after` is the cursor of the newest item the timeline on screen held as it went, and
 * `had` how many comments with its text it held, of `by`'s, the account that wrote it, when it's
 * known.
 */
export interface Claim {
  readonly write: PullWrite;
  readonly until: number;
  readonly had: number;
  readonly after?: string | undefined;
  readonly by?: string | undefined;
}

/** A comment's text as GitHub keeps it, to compare: Unix line ends, trimmed. */
function text(body: string): string {
  return body.replaceAll('\r\n', '\n').trim();
}

/** The comments on the pull request itself `timeline` holds. */
function comments(timeline: Timeline) {
  return timeline.items.flatMap(({ item }) => (item.kind === 'comment' ? [item.comment] : []));
}

/**
 * How many comments with the text `body` `timeline` holds, of account `by`'s when it's given: none
 * without a timeline.
 */
export function holding(timeline: Timeline | null | undefined, body: string, by?: string): number {
  if (!timeline) return 0;
  const login = by?.toLowerCase();
  return comments(timeline).filter(
    (comment) =>
      (login === undefined || comment.author?.login.toLowerCase() === login) &&
      text(comment.body) === text(body),
  ).length;
}

/** The comment `id` on the pull request itself that `timeline` holds, if it does. */
export function pullComment(timeline: Timeline, id: string) {
  return comments(timeline).find((comment) => comment.id === id);
}

/**
 * Whether `timeline` holds a comment of account `by`'s with the text `body` made at `since` or
 * after, in milliseconds since the Unix epoch, give or take `slack`.
 */
export function madeSince(
  timeline: Timeline,
  body: string,
  by: string,
  since: number,
  slack: number,
): boolean {
  const login = by.toLowerCase();
  return comments(timeline).some(
    (comment) =>
      comment.author?.login.toLowerCase() === login &&
      Date.parse(comment.createdAt) >= since - slack &&
      text(comment.body) === text(body),
  );
}

/** Whether `timeline` shows what `claim`'s write changed. */
export function shows(timeline: Timeline, claim: Claim): boolean {
  const { write } = claim;
  switch (write.kind) {
    case 'posted': {
      // The post comes after what was on screen as it went. When that was the newest page, the rest
      // of the timeline brings what's older, which may hold a comment with the same text.
      const at = timeline.items.findIndex(({ cursor }) => cursor === claim.after);
      if (at === -1) return holding(timeline, write.text, claim.by) > claim.had;
      const newer = { ...timeline, items: timeline.items.slice(at + 1) };
      return holding(newer, write.text, claim.by) > 0;
    }
    case 'edited':
      return comments(timeline).some(
        (comment) => comment.id === write.comment && text(comment.body) === text(write.text),
      );
    case 'deleted':
      return !comments(timeline).some((comment) => comment.id === write.comment);
    default:
      write satisfies never;
      return true;
  }
}

/**
 * Whether `next`, what main sent of a view's timeline, goes on screen at once, rather than waiting
 * for the reader's next key, click or scroll: when the timeline isn't on screen, when there are no
 * rows shown yet, or none to show, when what's shown is the newest page while the rest is read,
 * and while one of `claims`, the reader's own writes, is still to come at `now`.
 */
export function atOnce(
  next: TimelineView,
  shown: TimelineView | undefined,
  onScreen: boolean,
  claims: readonly Claim[],
  now: number,
): boolean {
  if (!onScreen) return true;
  if (!shown?.timeline || !next.timeline || shown.status === 'loading') return true;
  return claims.some((claim) => claim.until > now);
}

/** `claims` once `timeline` is on screen at `now`: those it doesn't show yet, and still waited for. */
export function stillToCome(
  claims: readonly Claim[],
  timeline: Timeline | null,
  now: number,
): Claim[] {
  return claims.filter(
    (claim) => claim.until > now && (timeline === null || !shows(timeline, claim)),
  );
}
