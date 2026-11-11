/**
 * A pull request's revisions, one per push to its branch, and what to compare when it opens
 * (`docs/design.md`, "Revisions" and "Viewed marks").
 *
 * No single GitHub source lists every push. The repository activity API does when it's available;
 * otherwise force-push events, reviews, check suites and Lo's own poller each saw some heads.
 * `buildRevisions` merges what they saw into one list, keyed by head SHA and ordered oldest first.
 * Revisions are stored by head SHA and numbered r1, r2… only for display, because a source that
 * reports late can insert one. `defaultComparison` picks what the pull request compares when it
 * opens, and `viewedFileComparison` what a file shows once a push changed it after you marked it
 * viewed. `baseTipAt` says where the base branch was when a revision was pushed, for that
 * revision's base.
 *
 * Times are milliseconds since the Unix epoch.
 */

/**
 * Something a source saw on the pull request's head branch. Each kind's comment names the GitHub
 * data it comes from.
 *
 * SHAs are full commit SHAs, as GitHub and git print them. GitHub's all-zero SHA, which stands for
 * "no commit" when a push creates the branch, reads as no commit.
 */
export type PushRecord =
  /**
   * A push in the repository activity API for the head branch
   * (`GET /repos/{owner}/{repo}/activity?ref=refs/heads/{branch}`): `before`, `after`,
   * `timestamp`, and whether `activity_type` is `force_push`. Exact. A `branch_creation` entry's
   * `before` is the all-zero SHA, and its `forced` is ignored. The caller drops `branch_deletion`
   * entries; entries from before the pull request opened are dropped by `buildRevisions`.
   */
  | {
      readonly kind: 'activity';
      readonly before: string | undefined;
      readonly after: string;
      readonly at: number;
      readonly forced: boolean;
    }
  /**
   * A `HeadRefForcePushedEvent` in the timeline: `beforeCommit`, `afterCommit` and `createdAt`, a
   * few seconds after the push. `before` is missing when GitHub no longer has the commit.
   */
  | {
      readonly kind: 'forcePush';
      readonly before: string | undefined;
      readonly after: string;
      readonly at: number;
    }
  /**
   * A submitted review's commit (`PullRequestReview.commit`) and `submittedAt`. The commit is
   * always a revision, since it was the head when the reviewer looked; a review the API made on an
   * older commit makes that commit one. Pending reviews have no `submittedAt` and don't count.
   */
  | { readonly kind: 'review'; readonly commit: string; readonly at: number }
  /**
   * A submitted review's commit and `submittedAt`, as for `review`, where the activity API's
   * complete log of the head branch shows the commit was never its head, as when a review is made
   * through the API on an older commit. Each push is a revision, and this commit was no push; it's
   * kept as a revision all the same, since your last review can be on it, and its source
   * (`reviewedCommit`) says it was never pushed.
   */
  | { readonly kind: 'reviewedCommit'; readonly commit: string; readonly at: number }
  /**
   * The push that started a check suite (`CheckSuite.push`): `previousSha`, `nextSha`, and the
   * suite's `createdAt`, up to a minute after the push. The caller drops suites whose `branch` is
   * set and isn't the head branch; it's null once the branch is deleted. A suite whose previous SHA
   * isn't a head another record names or a current commit, such as one for the same commit pushed
   * to a backport branch, never names the previous head.
   */
  | {
      readonly kind: 'checkSuite';
      readonly previous: string | undefined;
      readonly next: string;
      readonly at: number;
    }
  /** A head Lo's poller saw (`head.sha`), and when it first saw it. */
  | { readonly kind: 'polled'; readonly head: string; readonly at: number };

/** A source that saw a revision's head. */
export type Source =
  /** The repository activity API. */
  | 'activity'
  /** A force-push event, as the head before or after it. */
  | 'forcePush'
  /** A review on the commit. */
  | 'review'
  /** A review on a commit the complete push log shows was never the head. */
  | 'reviewedCommit'
  /** A check suite started by the push. */
  | 'checkSuite'
  /** Lo's poller. */
  | 'poller'
  /** The pull request's current head (`headRefOid`), which is always the latest revision. */
  | 'head';

/** Every source, in the order a revision lists them. */
export const SOURCES: readonly Source[] = [
  'activity',
  'forcePush',
  'review',
  'reviewedCommit',
  'checkSuite',
  'poller',
  'head',
];

/** When a revision was pushed. */
export type PushedAt =
  /** The push's time, from the activity API, or else a force-push event. */
  | { readonly kind: 'exact'; readonly at: number }
  /**
   * It was pushed at or before this time: the earliest a review, check suite or Lo's poller saw
   * the head, or a later head's push time.
   */
  | { readonly kind: 'by'; readonly at: number }
  /** No source dates it. */
  | { readonly kind: 'unknown' };

/** One push to the pull request's branch. */
export interface Revision {
  /** The head commit's SHA. Revisions are keyed by it. */
  readonly head: string;
  /**
   * The branch's head just before this push. A source's `before` or `previousSha` when one names
   * it, else the revision before this one. Missing for the first revision unless a source names
   * the head it replaced, which can be a commit pushed before the pull request opened. It can name
   * a later revision: when a head was pushed again (`a` → `b` → `a`), `b`'s previous head is `a`,
   * which sits after it at its latest push.
   */
  readonly previous: string | undefined;
  /**
   * Whether the push was forced: `true` for a force-push, `false` for a normal push, and missing
   * when no source says and the current commits can't tell.
   */
  readonly forced: boolean | undefined;
  /** When it was pushed. */
  readonly pushedAt: PushedAt;
  /** The sources that saw this head, in the order of {@link SOURCES}. */
  readonly sources: readonly Source[];
  /**
   * Whether Lo can still get the head commit. Revisions start out available; the caller flags one
   * GitHub no longer has, and that Lo never fetched, with {@link Revisions.markUnavailable}. It
   * stays in the list, shown as "no longer available".
   */
  readonly available: boolean;
}

/**
 * Whether a push made the revision the branch's head: every revision but a commit only reviews
 * name, which the complete push log shows was never the head (`reviewedCommit`). One that wasn't
 * shows as reviewed, never pushed, and has no number ({@link Revisions.number}).
 */
export function wasPushed(revision: Revision): boolean {
  return revision.sources.some((source) => source !== 'reviewedCommit');
}

/**
 * A pull request's revisions, oldest first.
 *
 * It keeps them in private fields, which `structuredClone` and messages between processes don't
 * carry: a copy made either way is an empty object. Send {@link Revisions.list} instead, and
 * rebuild them on the other side with `new Revisions(list)`.
 */
export class Revisions implements Iterable<Revision> {
  readonly #list: Revision[];
  /** Each revision's position in the list, by head. */
  readonly #positions = new Map<string, number>();
  /** Each revision's display number, by its position: missing for one that was never pushed. */
  readonly #numbers: (number | undefined)[] = [];

  /** The revisions in `list`, oldest first, one per head. */
  constructor(list: readonly Revision[] = []) {
    this.#list = [...list];
    let pushed = 0;
    for (const [position, revision] of this.#list.entries()) {
      this.#positions.set(revision.head, position);
      this.#numbers.push(wasPushed(revision) ? ++pushed : undefined);
    }
  }

  /** The revisions, oldest first. */
  list(): readonly Revision[] {
    return this.#list;
  }

  [Symbol.iterator](): Iterator<Revision> {
    return this.#list[Symbol.iterator]();
  }

  get length(): number {
    return this.#list.length;
  }

  isEmpty(): boolean {
    return this.#list.length === 0;
  }

  /** The newest revision, which is always the pull request's head passed to `buildRevisions`. */
  latest(): Revision | undefined {
    return this.#list.at(-1);
  }

  /** The revision with this head. */
  get(head: string): Revision | undefined {
    const position = this.position(head);
    return position === undefined ? undefined : this.#list[position];
  }

  /**
   * The revision's display number: 1 for the oldest. Only pushes are numbered: a reviewed commit
   * that was never pushed has none ({@link wasPushed}). A number can change when a source reports
   * a revision late, so store head SHAs, not numbers.
   */
  number(head: string): number | undefined {
    const position = this.position(head);
    return position === undefined ? undefined : this.#numbers[position];
  }

  /**
   * The revision's display label: `r1` for the oldest, or nothing for a reviewed commit that was
   * never pushed, as for a head no revision has.
   */
  label(head: string): string | undefined {
    const number = this.number(head);
    return number === undefined ? undefined : `r${number}`;
  }

  /**
   * The revision a marker points at: your last review's commit, the head last seen here, or the
   * head a file was marked viewed at. Each is a revision's head when the records that saw it were
   * passed to `buildRevisions`, as a review's always is; any other commit finds nothing.
   */
  find(commit: string): Revision | undefined {
    return this.get(commit);
  }

  /** Flags the revision with this head as one GitHub no longer has. Says whether there was one. */
  markUnavailable(head: string): boolean {
    const position = this.position(head);
    const revision = position === undefined ? undefined : this.#list[position];
    if (position === undefined || revision === undefined) return false;
    this.#list[position] = { ...revision, available: false };
    return true;
  }

  /** The position of the revision with this head, counting from 0 for the oldest. */
  position(head: string): number | undefined {
    return this.#positions.get(head);
  }

  /** The nearest revision at or before `position` that Lo can still get. */
  availableFrom(position: number): Revision | undefined {
    for (let at = Math.min(position, this.#list.length - 1); at >= 0; at--) {
      const revision = this.#list[at];
      if (revision?.available) return revision;
    }
    return undefined;
  }
}
