/**
 * A pull request's timeline (`docs/design.md`, "Timeline"): its description and its items, newest
 * first, mapped into Lo's {@link TimelineItem}s.
 *
 * GraphQL has no ETags, so a timeline read again asks only for its newest page, and keeps the
 * older items it has: each item's cursor says where the page joins them. A long timeline costs a
 * point a page the first time, and a point each time it's read again. It's read in full again
 * when an older item may have changed:
 *
 * - the page doesn't join what Lo has, or the counts don't move together, as after a deletion;
 * - the time of the newest item it shows moved, but nothing on the page changed, as when an item
 *   is added while an older one is deleted. An edit doesn't move that time, so an older comment's
 *   edit by someone else shows at the next full read;
 * - the page has a new dismissal of a review it doesn't hold, or a new force-push to a commit it
 *   doesn't hold, which changes or replaces older items;
 * - and at least every {@link READ_IN_FULL_EVERY}, for what none of those show, such as checks run
 *   again on an older commit.
 */

import type { GithubClient } from './client.ts';
import { GithubError } from './errors.ts';
import {
  TimelineDocument,
  type DeploymentStatusState,
  type PullRequestReviewState,
  type StatusState,
  type TimelineQuery,
} from './generated/graphql.ts';
import type { PullRef } from './refs.ts';

/** The most items GitHub gives a page. */
const PAGE_SIZE = 100;

/**
 * The most pages of a timeline read, newest first. Older items are left out
 * ({@link PullRequestTimeline.leftOut}).
 */
export const MAX_TIMELINE_PAGES = 10;

/**
 * How often a timeline kept current is read in full rather than by its newest page, in
 * milliseconds.
 */
export const READ_IN_FULL_EVERY = 60 * 60 * 1000;

/** A pull request's timeline: its description, and its items oldest first, as GitHub lists them. */
export interface PullRequestTimeline {
  description: TimelineDescription;
  /**
   * The items, oldest first, each by its cursor: every item, or the latest
   * {@link MAX_TIMELINE_PAGES} pages of them.
   */
  items: TimelineEntry[];
  /** How many older items weren't read, past {@link MAX_TIMELINE_PAGES} pages. */
  leftOut: number;
  /**
   * How many items GitHub counted when it was read (`filteredCount`). A read of the newest page
   * joins this one only when the two counts differ by as many items as it adds.
   */
  count: number;
  /**
   * When the newest item the timeline shows was made, as of when it was read. An edit doesn't move
   * it.
   */
  shownUpdatedAt: string;
  /**
   * When it was last read in full, as an ISO time. Reads in between ask only for its newest page.
   */
  readInFullAt: string;
}

/** The pull request's description: its first post. */
export interface TimelineDescription {
  /** `author`. `undefined` for a deleted account. */
  author: Actor | undefined;
  /** `body`, in Markdown. */
  body: string;
  createdAt: string;
  /** `lastEditedAt`, once it's been edited. */
  lastEditedAt: string | undefined;
}

/** An item and its cursor, which says where it is in the timeline. */
export interface TimelineEntry {
  cursor: string;
  item: TimelineItem;
}

/**
 * An item of a pull request's timeline. Each kind names the GraphQL types it comes from; every
 * other type is `other`.
 */
export type TimelineItem =
  /** `IssueComment`: a comment on the pull request itself. */
  | { kind: 'comment'; comment: TimelineComment }
  /** `PullRequestReview`: a review, whose comments are its threads'. */
  | { kind: 'review'; review: TimelineReview }
  /** `PullRequestCommit`: a commit on the head branch, with its checks. */
  | { kind: 'commit'; commit: TimelineCommit }
  /**
   * `HeadRefForcePushedEvent`, or `BaseRefForcePushedEvent` on the base branch. `before` and
   * `after` are the branch's commit before and after, `undefined` when GitHub no longer has it.
   */
  | {
      kind: 'forcePushed';
      event: TimelineEvent;
      branch: ForcePushedBranch;
      before: string | undefined;
      after: string | undefined;
    }
  /**
   * `LabeledEvent`, or `UnlabeledEvent` when `added` is false. `color` is six lowercase hex digits,
   * or `undefined` when GitHub's isn't ({@link labelColor}).
   */
  | {
      kind: 'label';
      event: TimelineEvent;
      name: string;
      color: string | undefined;
      added: boolean;
    }
  /**
   * `AssignedEvent`, or `UnassignedEvent` when `added` is false. `assignee` is `undefined` for a
   * deleted account.
   */
  | { kind: 'assignment'; event: TimelineEvent; assignee: Actor | undefined; added: boolean }
  /**
   * `ReviewRequestedEvent`, or `ReviewRequestRemovedEvent` when `added` is false. `reviewer` is
   * `undefined` for a deleted account or team.
   */
  | {
      kind: 'reviewRequest';
      event: TimelineEvent;
      reviewer: RequestedReviewer | undefined;
      added: boolean;
    }
  /**
   * `CrossReferencedEvent`: another issue or pull request mentioned this one. `source` is
   * `undefined` when it's of a kind Lo doesn't know. `willClose` is `willCloseTarget`: merging
   * the source closes this pull request.
   */
  | {
      kind: 'crossReference';
      event: TimelineEvent;
      source: ReferenceSource | undefined;
      willClose: boolean;
    }
  /** `MergedEvent`: `commit` merged it into the branch `into`. */
  | { kind: 'merged'; event: TimelineEvent; commit: string | undefined; into: string }
  /**
   * `AddedToMergeQueueEvent`, or `RemovedFromMergeQueueEvent` when `added` is false, with GitHub's
   * reason.
   */
  | { kind: 'mergeQueue'; event: TimelineEvent; added: boolean; reason: string | undefined }
  /** `DeployedEvent`: deployed to `environment`, whose latest status is `state`. */
  | {
      kind: 'deployed';
      event: TimelineEvent;
      environment: string | undefined;
      state: DeploymentStatusState | undefined;
    }
  /** `DeploymentEnvironmentChangedEvent`: a deployment's status changed to `state`. */
  | {
      kind: 'deploymentChanged';
      event: TimelineEvent;
      environment: string | undefined;
      state: DeploymentStatusState;
    }
  /** `ConvertToDraftEvent`, or `ReadyForReviewEvent` when `draft` is false. */
  | { kind: 'draft'; event: TimelineEvent; draft: boolean }
  /** `ClosedEvent`. */
  | { kind: 'closed'; event: TimelineEvent }
  /** `ReopenedEvent`. */
  | { kind: 'reopened'; event: TimelineEvent }
  /**
   * `BaseRefChangedEvent`, `AutomaticBaseChangeSucceededEvent` or
   * `AutomaticBaseChangeFailedEvent`: the branch it targets changed, or GitHub failed to change
   * it, from `from` to `to`.
   */
  | { kind: 'baseChanged'; event: TimelineEvent; from: string; to: string; how: BaseChange }
  /**
   * `ReviewDismissedEvent`: `reviewer`'s review, whose node ID is `review`, and which was
   * `previousState`, was dismissed.
   */
  | {
      kind: 'reviewDismissed';
      event: TimelineEvent;
      review: string | undefined;
      reviewer: Actor | undefined;
      message: string | undefined;
      previousState: PullRequestReviewState;
    }
  /**
   * `AutoMergeEnabledEvent`, `AutoRebaseEnabledEvent`, `AutoSquashEnabledEvent` or
   * `AutoMergeDisabledEvent`.
   */
  | { kind: 'autoMerge'; event: TimelineEvent; change: AutoMergeChange }
  /**
   * `AddedToStackEvent`, or `RemovedFromStackEvent` when `added` is false. `number` is the
   * stack's, which isn't a pull request's.
   */
  | { kind: 'stack'; event: TimelineEvent; number: number | undefined; added: boolean }
  /**
   * Any other item, by its `__typename`, which Lo shows nothing of. `undefined` for an item
   * GitHub left out.
   */
  | { kind: 'other'; typename: string | undefined };

/** Who did something, and when: an event's `actor` and `createdAt`. */
export interface TimelineEvent {
  /** `undefined` for a deleted account. */
  actor: Actor | undefined;
  at: string;
}

/**
 * The type of account GitHub names someone with (`__typename`). Only a `User`'s or an
 * `Organization`'s login names its avatar at `avatars.githubusercontent.com`: GraphQL gives a bot's
 * login without the `[bot]` that sets it apart from a person's, and a mannequin or an enterprise
 * account isn't an account on github.com.
 */
export type ActorType = 'User' | 'Bot' | 'Mannequin' | 'Organization' | 'EnterpriseUserAccount';

/** An account, by its login and its type. */
export interface Actor {
  login: string;
  type: ActorType;
}

/** `IssueComment`'s fields. */
export interface TimelineComment {
  id: string;
  /** `author`. `undefined` for a deleted account. */
  author: Actor | undefined;
  /** `body`, in Markdown. */
  body: string;
  createdAt: string;
  lastEditedAt: string | undefined;
  url: string;
  /**
   * `minimizedReason` when it's hidden (`isMinimized`), such as `outdated`, or an empty string
   * when GitHub gives none.
   */
  hidden: string | undefined;
  viewerCanUpdate: boolean;
  viewerCanDelete: boolean;
}

/** `PullRequestReview`'s fields. */
export interface TimelineReview {
  id: string;
  /** `author`. `undefined` for a deleted account. */
  author: Actor | undefined;
  /** `body`, in Markdown, which may be empty. */
  body: string;
  state: PullRequestReviewState;
  createdAt: string;
  /** `undefined` while it's pending. */
  submittedAt: string | undefined;
  lastEditedAt: string | undefined;
  url: string;
  /** `isMinimized`. */
  hidden: boolean;
  /** `commit.oid`: the revision it reviewed. `undefined` once GitHub no longer has the commit. */
  commit: string | undefined;
  /** `comments.totalCount`: its review comments, which the threads show. */
  comments: number;
}

/** `PullRequestCommit`'s commit. */
export interface TimelineCommit {
  oid: string;
  /** `messageHeadline`. */
  headline: string;
  /** The author's GitHub login, when GitHub matched their email to an account. */
  authorLogin: string | undefined;
  /** The author's name, as the commit gives it. */
  authorName: string | undefined;
  /** `committedDate`. */
  committedAt: string;
  /** `statusCheckRollup.state`, when it has checks or statuses. */
  checks: StatusState | undefined;
}

/** Which branch a force-push moved. */
export type ForcePushedBranch = 'head' | 'base';

/**
 * Who was asked for a review: a person, bot or mannequin by login and type, or a team as
 * `org/team` (an enterprise team by its slug).
 */
export type RequestedReviewer =
  { kind: 'account'; login: string; type: ActorType } | { kind: 'team'; slug: string };

/** An issue or pull request that mentioned this one. */
export interface ReferenceSource {
  kind: 'issue' | 'pullRequest';
  /** `repository.nameWithOwner`: `owner/repo`. */
  repository: string;
  number: number;
  title: string;
  url: string;
}

/**
 * How a pull request's base branch changed: someone changed it (`BaseRefChangedEvent`), GitHub
 * changed it after the branch it targeted was merged and deleted
 * (`AutomaticBaseChangeSucceededEvent`), or GitHub tried to and couldn't
 * (`AutomaticBaseChangeFailedEvent`).
 */
export type BaseChange = 'changed' | 'automatic' | 'automaticFailed';

/** What happened to auto-merge. */
export type AutoMergeChange =
  /** Turned on, to merge with a merge commit (`AutoMergeEnabledEvent`). */
  | { kind: 'enabledMerge' }
  /** Turned on, to rebase (`AutoRebaseEnabledEvent`). */
  | { kind: 'enabledRebase' }
  /** Turned on, to squash (`AutoSquashEnabledEvent`). */
  | { kind: 'enabledSquash' }
  /** Turned off (`AutoMergeDisabledEvent`), with GitHub's reason. */
  | { kind: 'disabled'; reason: string | undefined };

/** A page of a timeline, newest first. */
export interface TimelineItemsPage {
  description: TimelineDescription;
  entries: TimelineEntry[];
  /**
   * How many items the timeline has, when the page was read without a cursor; otherwise how many
   * come before the cursor.
   */
  count: number;
  /** When the newest item the timeline shows was made. An edit doesn't move it. */
  shownUpdatedAt: string;
  hasPreviousPage: boolean;
  startCursor: string | undefined;
}

/**
 * Whether it's time to read `timeline` in full, at `now`: an hour after its last full read, or when
 * the clock went back.
 */
export function dueInFull(timeline: PullRequestTimeline, now: Date): boolean {
  const age = now.getTime() - Date.parse(timeline.readInFullAt);
  return !(age >= 0 && age < READ_IN_FULL_EVERY);
}

/**
 * `known` with `page`, its newest, joined on: the items from the page's first on are the page's.
 * `undefined` when it must be read in full instead: the page doesn't join, the items it adds don't
 * match how far GitHub's count moved, or an older item may have changed (see the module's docs).
 * Past `maxItems`, the oldest items are left out.
 */
export function joinNewestPage(
  known: PullRequestTimeline,
  page: TimelineItemsPage,
  maxItems: number,
): PullRequestTimeline | undefined {
  const [first] = page.entries;
  if (first === undefined) return undefined;
  const at = known.items.findIndex((entry) => entry.cursor === first.cursor);
  if (at < 0) return undefined;
  const onPage = new Set(page.entries.map((entry) => entry.cursor));
  const items = [
    ...known.items.slice(0, at).filter((entry) => !onPage.has(entry.cursor)),
    ...page.entries,
  ];
  const added = items.length - known.items.length;
  if (added !== page.count - known.count) return undefined;
  const held = new Map(known.items.map((entry) => [entry.cursor, entry.item]));
  const fresh = page.entries.filter((entry) => !held.has(entry.cursor)).map((entry) => entry.item);
  const changed =
    fresh.length > 0 ||
    page.entries.some((entry) => {
      const before = held.get(entry.cursor);
      return before === undefined || !equal(before, entry.item);
    });
  if (page.shownUpdatedAt !== known.shownUpdatedAt && !changed) return undefined;
  if (fresh.some((item) => !holdsSubject(page, item))) return undefined;
  const dropped = Math.max(0, items.length - maxItems);
  return {
    description: page.description,
    items: items.slice(dropped),
    leftOut: known.leftOut + dropped,
    count: page.count,
    shownUpdatedAt: page.shownUpdatedAt,
    readInFullAt: known.readInFullAt,
  };
}

/**
 * Whether `page` holds what `item` changes, when it's an item that changes an older one: a
 * dismissal changes the review it dismisses, and a force-push replaces the commits before it with
 * those up to the one it pushed. A force-push of the base branch changes the pull request's
 * commits, none of which it names.
 */
function holdsSubject(page: TimelineItemsPage, item: TimelineItem): boolean {
  if (item.kind === 'reviewDismissed') {
    return page.entries.some(
      ({ item: held }) => held.kind === 'review' && held.review.id === item.review,
    );
  }
  if (item.kind === 'forcePushed') {
    return (
      item.branch === 'head' &&
      page.entries.some(
        ({ item: held }) => held.kind === 'commit' && held.commit.oid === item.after,
      )
    );
  }
  return true;
}

/**
 * The cursor to read the page before `page` before, or `undefined` when it's the first.
 *
 * GitHub lists items that share a time in one order, but `before` compares them in another, so
 * reading before a page's first item skips some of the items that share its time and repeats
 * others (seen on cli/cli#13057, whose rebased commits share a time). Reading before the page's
 * first item with a later time reads all of them, and the ones this page holds are dropped as
 * repeats, so each page after the newest reads one item or more again. That needs the time each
 * cursor holds, in a format GitHub doesn't document, so a cursor that doesn't read as one, or a
 * page whose items share one time, is read before its start, as GitHub's paging intends. `skip`,
 * GitHub's offset paging, isn't an alternative: on one pull request of 547 items it listed 252.
 */
export function cursorBefore(page: TimelineItemsPage): string | undefined {
  if (!page.hasPreviousPage) return undefined;
  const [firstEntry] = page.entries;
  const first = firstEntry === undefined ? undefined : cursorTime(firstEntry.cursor);
  const later =
    first === undefined
      ? undefined
      : page.entries.find((entry) => {
          const time = cursorTime(entry.cursor);
          return time !== undefined && time !== first;
        });
  return later?.cursor ?? page.startCursor;
}

const CURSOR_PREFIX = new TextEncoder().encode('cursor:v2:');

/**
 * The time a timeline item's cursor holds, as hex digits of its bytes, comparable for equality
 * only. A cursor is `cursor:v2:` and a MessagePack array whose first element is the time, in
 * base64.
 */
export function cursorTime(cursor: string): string | undefined {
  const bytes = base64Decode(cursor);
  if (bytes === undefined || !startsWith(bytes, CURSOR_PREFIX)) return undefined;
  const rest = bytes.subarray(CURSOR_PREFIX.length);
  // A fixarray of at least one element.
  const array = rest[0];
  if (array === undefined || (array & 0xf0) !== 0x90 || array === 0x90) return undefined;
  const format = rest[1];
  const length = format === undefined ? undefined : integerLength(format);
  if (length === undefined || rest.length < 1 + length) return undefined;
  return Array.from(rest.subarray(1, 1 + length), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

/**
 * How many bytes a MessagePack integer takes, its format byte included: a positive fixint, or one
 * of the int and uint formats.
 */
function integerLength(format: number): number | undefined {
  if (format <= 0x7f) return 1;
  switch (format) {
    case 0xcc:
    case 0xd0:
      return 2;
    case 0xcd:
    case 0xd1:
      return 3;
    case 0xce:
    case 0xd2:
      return 5;
    case 0xcf:
    case 0xd3:
      return 9;
    default:
      return undefined;
  }
}

function startsWith(bytes: Uint8Array, prefix: Uint8Array): boolean {
  return bytes.length >= prefix.length && prefix.every((byte, index) => bytes[index] === byte);
}

/** Base64 in either alphabet, padded or not, or `undefined` when it isn't base64. */
export function base64Decode(text: string): Uint8Array | undefined {
  const bytes: number[] = [];
  let bits = 0;
  let count = 0;
  for (const character of text.replace(/=+$/, '')) {
    const value = base64Value(character);
    if (value === undefined) return undefined;
    bits = (bits << 6) | value;
    count += 6;
    if (count >= 8) {
      count -= 8;
      bytes.push((bits >> count) & 0xff);
      bits &= (1 << count) - 1;
    }
  }
  return Uint8Array.from(bytes);
}

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

function base64Value(character: string): number | undefined {
  if (character === '+' || character === '-') return 62;
  if (character === '/' || character === '_') return 63;
  const value = BASE64.indexOf(character);
  return value < 0 ? undefined : value;
}

/**
 * Whether two items hold the same values, as plain data: a key set to `undefined` is one left out.
 */
function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((value, index) => equal(value, b[index]))
    );
  }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].every((key) => equal(Reflect.get(a, key), Reflect.get(b, key)));
}

/** How to read a timeline. */
export interface TimelineRead {
  /**
   * The timeline as read before: only its newest page is read, unless it's due in full or the page
   * doesn't join it.
   */
  known?: PullRequestTimeline | undefined;
  /**
   * When the read happens, which says whether `known` is due to be read in full. Now, by default.
   */
  now?: Date | undefined;
  /** How many items to read a page: GitHub's most, 100, by default. */
  pageSize?: number | undefined;
}

/**
 * `pull`'s timeline, newest first, at most {@link MAX_TIMELINE_PAGES} pages. With `known`, read
 * before, it reads only the newest page, unless it's due to be read in full at `now` or the page
 * doesn't join `known`.
 */
export async function readTimeline(
  client: GithubClient,
  pull: PullRef,
  { known, now = new Date(), pageSize = PAGE_SIZE }: TimelineRead = {},
): Promise<PullRequestTimeline> {
  const maxItems = MAX_TIMELINE_PAGES * Math.max(pageSize, 1);
  const newest = await readPage(client, pull, pageSize, undefined);
  const timeline = (items: TimelineEntry[], leftOut: number): PullRequestTimeline => ({
    description: newest.description,
    items,
    leftOut,
    count: newest.count,
    shownUpdatedAt: newest.shownUpdatedAt,
    readInFullAt: now.toISOString(),
  });
  if (!newest.hasPreviousPage) return timeline(newest.entries, 0);
  if (known !== undefined && !dueInFull(known, now)) {
    const joined = joinNewestPage(known, newest, maxItems);
    if (joined !== undefined) return joined;
  }
  const seen = new Set(newest.entries.map((entry) => entry.cursor));
  const asked = new Set<string>();
  const pages = [newest.entries];
  let before = cursorBefore(newest);
  let truncated = false;
  while (before !== undefined) {
    if (pages.length >= MAX_TIMELINE_PAGES) {
      truncated = true;
      break;
    }
    if (asked.has(before)) {
      throw new GithubError({
        kind: 'inconsistent',
        message: 'a page of timeline items came back again',
      });
    }
    asked.add(before);
    const page = await readPage(client, pull, pageSize, before);
    before = cursorBefore(page);
    // It holds again the items the page after it has before the cursor.
    const fresh = page.entries.filter((entry) => {
      if (seen.has(entry.cursor)) return false;
      seen.add(entry.cursor);
      return true;
    });
    if (fresh.length === 0) break;
    pages.push(fresh);
  }
  const all = pages.toReversed().flat();
  const dropped = Math.max(0, all.length - maxItems);
  const items = all.slice(dropped);
  const leftOut = truncated || dropped > 0 ? Math.max(0, newest.count - items.length) : 0;
  return timeline(items, leftOut);
}

type PullRequestNode = NonNullable<NonNullable<TimelineQuery['repository']>['pullRequest']>;
type Edge = NonNullable<NonNullable<PullRequestNode['timelineItems']['edges']>[number]>;
type Node = NonNullable<Edge['node']>;

/** The page of `pull`'s timeline before `before`, or the newest. */
async function readPage(
  client: GithubClient,
  pull: PullRef,
  pageSize: number,
  before: string | undefined,
): Promise<TimelineItemsPage> {
  const { data } = await client.graphqlWithErrors(
    TimelineDocument,
    {
      owner: pull.repo.owner,
      name: pull.repo.name,
      number: pull.number,
      last: pageSize,
      before: before ?? null,
    },
    2,
  );
  const pullRequest = data.repository?.pullRequest;
  if (!pullRequest) {
    throw new GithubError({
      kind: 'notFound',
      message: `Could not find pull request ${pull.toString()}`,
    });
  }
  const items = pullRequest.timelineItems;
  return {
    description: {
      author: actor(pullRequest.author),
      body: pullRequest.body,
      createdAt: pullRequest.createdAt,
      lastEditedAt: pullRequest.lastEditedAt ?? undefined,
    },
    entries: (items.edges ?? []).flatMap((edge) =>
      edge ? [{ cursor: edge.cursor, item: edge.node ? itemOf(edge.node) : other(undefined) }] : [],
    ),
    count: Math.max(0, items.filteredCount),
    shownUpdatedAt: pullRequest.timelineEvents.updatedAt,
    hasPreviousPage: items.pageInfo.hasPreviousPage,
    startCursor: items.pageInfo.startCursor ?? undefined,
  };
}

function other(typename: string | undefined): TimelineItem {
  return { kind: 'other', typename };
}

/** Who did an event and when: every event names them the same way. */
function event(node: { actor: ActorNode | null; createdAt: string }): TimelineEvent {
  return { actor: actor(node.actor), at: node.createdAt };
}

/** An account as GitHub names it: its type, and its login unless Lo doesn't ask about its type. */
type ActorNode = { __typename: ActorType; login?: string };

/**
 * `node`, an account, or `undefined` for a deleted one, or one of a type Lo doesn't know, which
 * comes without a login.
 */
export function actor(node: ActorNode | null | undefined): Actor | undefined {
  if (!node) return undefined;
  const { __typename: type, login } = node;
  return typeof login === 'string' ? { login, type } : undefined;
}

/**
 * `color`, a label's, as six lowercase hex digits without the `#`, or `undefined` when it isn't
 * that, so a color never reaches a style as anything else.
 */
export function labelColor(color: string): string | undefined {
  return /^[0-9a-fA-F]{6}$/.test(color) ? color.toLowerCase() : undefined;
}

type ReviewerNode = Extract<Node, { __typename: 'ReviewRequestedEvent' }>['requestedReviewer'];

/**
 * Who was asked for a review, or `undefined` for a deleted account or team, one the account can't
 * see, or one of a kind Lo doesn't know.
 */
export function requestedReviewer(requested: ReviewerNode): RequestedReviewer | undefined {
  if (requested === null) return undefined;
  const { __typename: typename } = requested;
  switch (typename) {
    case 'Bot':
    case 'Mannequin':
    case 'User':
      return { kind: 'account', login: requested.login, type: typename };
    case 'Team':
      return { kind: 'team', slug: requested.combinedSlug };
    case 'EnterpriseTeam':
      return { kind: 'team', slug: requested.slug };
    default:
      typename satisfies never;
      return undefined;
  }
}

type SourceNode = Extract<Node, { __typename: 'CrossReferencedEvent' }>['source'];

/**
 * The issue or pull request that mentioned this one, or `undefined` when it's of a kind Lo doesn't
 * know.
 */
function referenceSource(source: SourceNode): ReferenceSource | undefined {
  const { __typename: typename } = source;
  switch (typename) {
    case 'Issue':
    case 'PullRequest':
      return {
        kind: typename === 'Issue' ? 'issue' : 'pullRequest',
        repository: source.repository.nameWithOwner,
        number: source.number,
        title: source.title,
        url: source.url,
      };
    default:
      typename satisfies never;
      return undefined;
  }
}

/**
 * The item `node` is. The types Lo shows nothing of are `other`, by name, as is a type newer
 * than Lo's schema, which comes with nothing but its name.
 */
function itemOf(node: Node): TimelineItem {
  const { __typename: typename } = node;
  switch (typename) {
    case 'IssueComment':
      return {
        kind: 'comment',
        comment: {
          id: node.id,
          author: actor(node.author),
          body: node.body,
          createdAt: node.createdAt,
          lastEditedAt: node.lastEditedAt ?? undefined,
          url: node.url,
          hidden: node.isMinimized ? (node.minimizedReason ?? '') : undefined,
          viewerCanUpdate: node.viewerCanUpdate,
          viewerCanDelete: node.viewerCanDelete,
        },
      };
    case 'PullRequestReview':
      return {
        kind: 'review',
        review: {
          id: node.id,
          author: actor(node.author),
          body: node.body,
          state: node.state,
          createdAt: node.createdAt,
          submittedAt: node.submittedAt ?? undefined,
          lastEditedAt: node.lastEditedAt ?? undefined,
          url: node.url,
          hidden: node.isMinimized,
          commit: node.commit?.oid,
          comments: Math.max(0, node.comments.totalCount),
        },
      };
    case 'PullRequestCommit': {
      const commit = node.gitCommit;
      return {
        kind: 'commit',
        commit: {
          oid: commit.oid,
          headline: commit.messageHeadline,
          authorLogin: commit.author?.user?.login,
          authorName: commit.author?.name ?? undefined,
          committedAt: commit.committedDate,
          checks: commit.statusCheckRollup?.state,
        },
      };
    }
    case 'HeadRefForcePushedEvent':
    case 'BaseRefForcePushedEvent':
      return {
        kind: 'forcePushed',
        event: event(node),
        branch: typename === 'HeadRefForcePushedEvent' ? 'head' : 'base',
        before: node.beforeCommit?.oid,
        after: node.afterCommit?.oid,
      };
    case 'LabeledEvent':
    case 'UnlabeledEvent':
      return {
        kind: 'label',
        event: event(node),
        name: node.label.name,
        color: labelColor(node.label.color),
        added: typename === 'LabeledEvent',
      };
    case 'AssignedEvent':
    case 'UnassignedEvent':
      return {
        kind: 'assignment',
        event: event(node),
        // Nothing for a deleted account or one of a kind Lo doesn't know.
        assignee: actor(node.assignee),
        added: typename === 'AssignedEvent',
      };
    case 'ReviewRequestedEvent':
    case 'ReviewRequestRemovedEvent':
      return {
        kind: 'reviewRequest',
        event: event(node),
        reviewer: requestedReviewer(node.requestedReviewer),
        added: typename === 'ReviewRequestedEvent',
      };
    case 'CrossReferencedEvent':
      return {
        kind: 'crossReference',
        event: event(node),
        source: referenceSource(node.source),
        willClose: node.willCloseTarget,
      };
    case 'MergedEvent':
      return {
        kind: 'merged',
        event: event(node),
        commit: node.commit?.oid,
        into: node.mergeRefName,
      };
    case 'AddedToMergeQueueEvent':
      return { kind: 'mergeQueue', event: event(node), added: true, reason: undefined };
    case 'RemovedFromMergeQueueEvent':
      return {
        kind: 'mergeQueue',
        event: event(node),
        added: false,
        reason: node.reason ?? undefined,
      };
    case 'DeployedEvent':
      return {
        kind: 'deployed',
        event: event(node),
        environment: node.deployment.environment ?? undefined,
        state: node.deployment.latestStatus?.state,
      };
    case 'DeploymentEnvironmentChangedEvent':
      return {
        kind: 'deploymentChanged',
        event: event(node),
        environment: node.deploymentStatus.deployment.environment ?? undefined,
        state: node.deploymentStatus.state,
      };
    case 'ConvertToDraftEvent':
      return { kind: 'draft', event: event(node), draft: true };
    case 'ReadyForReviewEvent':
      return { kind: 'draft', event: event(node), draft: false };
    case 'ClosedEvent':
      return { kind: 'closed', event: event(node) };
    case 'ReopenedEvent':
      return { kind: 'reopened', event: event(node) };
    case 'BaseRefChangedEvent':
      return {
        kind: 'baseChanged',
        event: event(node),
        from: node.previousRefName,
        to: node.currentRefName,
        how: 'changed',
      };
    case 'AutomaticBaseChangeSucceededEvent':
    case 'AutomaticBaseChangeFailedEvent':
      return {
        kind: 'baseChanged',
        event: event(node),
        from: node.oldBase,
        to: node.newBase,
        how: typename === 'AutomaticBaseChangeSucceededEvent' ? 'automatic' : 'automaticFailed',
      };
    case 'ReviewDismissedEvent':
      return {
        kind: 'reviewDismissed',
        event: event(node),
        review: node.review?.id,
        reviewer: actor(node.review?.author),
        message: node.dismissalMessage ?? undefined,
        previousState: node.previousReviewState,
      };
    case 'AutoMergeEnabledEvent':
      return { kind: 'autoMerge', event: event(node), change: { kind: 'enabledMerge' } };
    case 'AutoRebaseEnabledEvent':
      return { kind: 'autoMerge', event: event(node), change: { kind: 'enabledRebase' } };
    case 'AutoSquashEnabledEvent':
      return { kind: 'autoMerge', event: event(node), change: { kind: 'enabledSquash' } };
    case 'AutoMergeDisabledEvent':
      return {
        kind: 'autoMerge',
        event: event(node),
        change: { kind: 'disabled', reason: node.reason ?? undefined },
      };
    case 'AddedToStackEvent':
    case 'RemovedFromStackEvent':
      return {
        kind: 'stack',
        event: event(node),
        number: node.stackNumber ?? undefined,
        added: typename === 'AddedToStackEvent',
      };
    case 'AddedToProjectEvent':
    case 'AddedToProjectV2Event':
    case 'BaseRefDeletedEvent':
    case 'BlockedByAddedEvent':
    case 'BlockedByRemovedEvent':
    case 'BlockingAddedEvent':
    case 'BlockingRemovedEvent':
    case 'CommentDeletedEvent':
    case 'ConnectedEvent':
    case 'ConvertedFromDraftEvent':
    case 'ConvertedNoteToIssueEvent':
    case 'ConvertedToDiscussionEvent':
    case 'DemilestonedEvent':
    case 'DisconnectedEvent':
    case 'HeadRefDeletedEvent':
    case 'HeadRefRestoredEvent':
    case 'IssueCommentPinnedEvent':
    case 'IssueCommentUnpinnedEvent':
    case 'IssueFieldAddedEvent':
    case 'IssueFieldChangedEvent':
    case 'IssueFieldRemovedEvent':
    case 'IssueTypeAddedEvent':
    case 'IssueTypeChangedEvent':
    case 'IssueTypeRemovedEvent':
    case 'LockedEvent':
    case 'MarkedAsDuplicateEvent':
    case 'MentionedEvent':
    case 'MilestonedEvent':
    case 'MovedColumnsInProjectEvent':
    case 'ParentIssueAddedEvent':
    case 'ParentIssueRemovedEvent':
    case 'PinnedEvent':
    case 'ProjectV2ItemStatusChangedEvent':
    case 'PullRequestCommitCommentThread':
    case 'PullRequestReviewThread':
    case 'PullRequestRevisionMarker':
    case 'ReferencedEvent':
    case 'RemovedFromProjectEvent':
    case 'RemovedFromProjectV2Event':
    case 'RenamedTitleEvent':
    case 'SubIssueAddedEvent':
    case 'SubIssueRemovedEvent':
    case 'SubscribedEvent':
    case 'TransferredEvent':
    case 'UnlockedEvent':
    case 'UnmarkedAsDuplicateEvent':
    case 'UnpinnedEvent':
    case 'UnsubscribedEvent':
    case 'UserBlockedEvent':
      return other(typename);
    // A type newer than Lo's schema.
    default:
      typename satisfies never;
      return other(typename);
  }
}
