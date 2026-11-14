// The timeline's rows, from what main read: the description card, then each item GitHub lists as
// the row the design draws for its kind, in the reviewer's words. Consecutive commits are one push,
// split where a revision ends, with its revision and its last commit's checks; a force-push says
// which revisions it compares; reviews and comments are cards; the rest are one-line events. Plain
// functions of what main sent, so each kind's words are tested alone.

import type { TimelineGlyph, TimelineReviewerState, TimelineTone, TimelineVerdict } from '@lo/ui';

import type { ComparisonView } from '../../revisions/contract.ts';
import type { Actor, Item, Reviewer, Sidebar, Timeline } from '../contract.ts';

/**
 * Someone, as a row names them: their login, or a team's slug, and the type of account GitHub
 * names it with (`User`, `Bot`, `Organization`…, or `Team`), which says whether it has an avatar on
 * GitHub (`window/images.ts`): a bot, a team, a mannequin or a deleted account keeps its initials.
 */
export interface Person {
  readonly login: string;
  readonly type: string;
}

/** A part of a one-line event's sentence. */
export type Part =
  /** Lo's own words. */
  | { readonly kind: 'text'; readonly text: string }
  /** Someone's login, or a team's slug. */
  | { readonly kind: 'name'; readonly name: string }
  /** A label, in its color when GitHub gave one Lo takes. */
  | { readonly kind: 'label'; readonly name: string; readonly color: string | undefined }
  /** A branch, a commit or an environment, as code. */
  | { readonly kind: 'code'; readonly text: string }
  /** Text from someone, such as a title or a reason, set apart from Lo's words. */
  | { readonly kind: 'quote'; readonly text: string };

/** A revision, by its number, and its head. */
export interface RevisionMark {
  readonly number: number;
  readonly head: string;
}

/** A row of the timeline. Each has a key that stays the same as the timeline is read again. */
export type Row =
  | {
      readonly kind: 'description';
      readonly key: string;
      readonly author: Person | undefined;
      readonly at: string;
      readonly body: string;
      readonly draft: boolean;
      readonly labels: readonly { readonly name: string; readonly color: string | undefined }[];
      readonly reviewers: readonly {
        readonly person: Person;
        readonly state: TimelineReviewerState;
      }[];
    }
  | { readonly kind: 'older'; readonly key: string; readonly count: number }
  | {
      readonly kind: 'comment';
      readonly key: string;
      readonly id: string;
      readonly author: Person | undefined;
      readonly at: string;
      readonly body: string;
      readonly url: string;
      readonly byAuthor: boolean;
      /** Why GitHub hid it, while it's hidden: `outdated`, or nothing GitHub says. */
      readonly hidden: string | undefined;
      /** Whether GitHub lets the account edit it, and delete it. */
      readonly canUpdate: boolean;
      readonly canDelete: boolean;
    }
  | {
      readonly kind: 'review';
      readonly key: string;
      readonly id: string;
      readonly author: Person | undefined;
      readonly at: string;
      readonly body: string;
      readonly url: string;
      readonly verdict: TimelineVerdict;
      readonly revision: number | undefined;
      readonly hidden: boolean;
      /** How many comments it left in threads. */
      readonly comments: number;
    }
  | {
      readonly kind: 'push';
      readonly key: string;
      readonly actor: string;
      readonly at: string;
      readonly commits: readonly { readonly oid: string; readonly headline: string }[];
      readonly revision: number | undefined;
    }
  | {
      readonly kind: 'checks';
      readonly key: string;
      readonly state: 'passed' | 'failed' | 'running';
      readonly oid: string;
      readonly revision: number | undefined;
    }
  | {
      readonly kind: 'forcePush';
      readonly key: string;
      readonly actor: string;
      readonly at: string;
      readonly branch: 'head' | 'base';
      readonly before: string | undefined;
      readonly after: string | undefined;
      readonly revision: number | undefined;
      /** The revisions before and after it, which "Compare" sets, when both can be compared. */
      readonly compare: { readonly from: RevisionMark; readonly to: RevisionMark } | undefined;
    }
  | {
      readonly kind: 'event';
      readonly key: string;
      readonly glyph: TimelineGlyph;
      readonly tone: TimelineTone;
      readonly parts: readonly Part[];
      readonly at: string;
      /** Where it points on GitHub, when that's somewhere other than the pull request. */
      readonly url: string | undefined;
    };

/** What the rows are made from besides the timeline. */
export interface RowsContext {
  /** What goes beside the description, once read. */
  readonly sidebar: Sidebar | undefined;
  /** The tab's revisions, once read. */
  readonly revisions: ComparisonView | undefined;
  /** The pull request's author, as its header names them. */
  readonly author: string | undefined;
}

/** What GitHub calls an account it deleted. */
const GHOST = 'ghost';

/** `actor` as a row names them. */
export function personOf(actor: Actor | undefined): Person | undefined {
  return actor && { login: actor.login, type: actor.type };
}

/** Who someone a reviewer asked is, as a row names them. */
function reviewerOf(reviewer: Reviewer): Person {
  return reviewer.kind === 'team'
    ? { login: reviewer.slug, type: 'Team' }
    : { login: reviewer.login, type: reviewer.type };
}

function sameLogin(a: string | undefined, b: string | undefined): boolean {
  return a !== undefined && b !== undefined && a.toLowerCase() === b.toLowerCase();
}

/** A review's state as the description card says where its reviewer stands. */
function standing(state: string): TimelineReviewerState | undefined {
  switch (state) {
    case 'APPROVED':
      return 'approved';
    case 'CHANGES_REQUESTED':
      return 'changes';
    case 'COMMENTED':
      return 'commented';
    case 'DISMISSED':
      return 'dismissed';
    // A pending review is its author's alone, and says nothing of where they stand.
    case 'PENDING':
      return undefined;
    // A state GitHub has added since: they reviewed, at least.
    default:
      return 'commented';
  }
}

/** A review's state as its card says what it did. */
function verdictOf(state: string): TimelineVerdict {
  switch (state) {
    case 'APPROVED':
      return 'approved';
    case 'CHANGES_REQUESTED':
      return 'changes';
    case 'DISMISSED':
      return 'dismissed';
    default:
      return 'commented';
  }
}

/**
 * The reviewers the description card lists: each reviewer's latest review, then those asked who
 * haven't reviewed since, a reviewer asked again showing as asked. The author's own reviews aren't
 * a reviewer's, and a team the account can't see can't be named.
 */
export function reviewersOf(
  sidebar: Sidebar | undefined,
  author: string | undefined,
): { person: Person; state: TimelineReviewerState }[] {
  if (!sidebar) return [];
  const listed = new Map<string, { person: Person; state: TimelineReviewerState }>();
  for (const review of sidebar.reviews) {
    const person = personOf(review.author);
    const state = standing(review.state);
    if (!person || !state || sameLogin(person.login, author)) continue;
    listed.set(person.login.toLowerCase(), { person, state });
  }
  for (const requested of sidebar.requested) {
    if (requested.kind === 'hiddenTeam') continue;
    const person = reviewerOf(requested);
    listed.set(person.login.toLowerCase(), { person, state: 'requested' });
  }
  return [...listed.values()];
}

/** Each revision with a number, by its head. */
function revisionsByHead(revisions: ComparisonView | undefined): Map<string, RevisionMark> {
  const byHead = new Map<string, RevisionMark>();
  for (const revision of revisions?.revisions ?? []) {
    if (revision.number !== null)
      byHead.set(revision.head, { number: revision.number, head: revision.head });
  }
  return byHead;
}

/** A commit's checks, as their row says them, or nothing for a state GitHub has added since. */
function checksOf(state: string | undefined): 'passed' | 'failed' | 'running' | undefined {
  switch (state) {
    case 'SUCCESS':
      return 'passed';
    case 'FAILURE':
    case 'ERROR':
      return 'failed';
    case 'PENDING':
    case 'EXPECTED':
      return 'running';
    case undefined:
      return undefined;
    default:
      return undefined;
  }
}

/** A deployment's state, as its tag says it, and its marker's tone. */
export function deploymentOf(state: string | undefined): {
  words: string | undefined;
  tone: TimelineTone;
} {
  switch (state) {
    case 'SUCCESS':
      return { words: 'Active', tone: 'ok' };
    case 'FAILURE':
      return { words: 'Failed', tone: 'fail' };
    case 'ERROR':
      return { words: 'Error', tone: 'fail' };
    case 'IN_PROGRESS':
      return { words: 'In progress', tone: 'warn' };
    case 'PENDING':
      return { words: 'Pending', tone: 'warn' };
    case 'QUEUED':
      return { words: 'Queued', tone: 'warn' };
    case 'WAITING':
      return { words: 'Waiting', tone: 'warn' };
    case 'INACTIVE':
      return { words: 'Inactive', tone: 'neutral' };
    case undefined:
      return { words: undefined, tone: 'neutral' };
    default:
      return { words: undefined, tone: 'neutral' };
  }
}

const text = (said: string): Part => ({ kind: 'text', text: said });
const name = (actor: Actor | undefined): Part => ({ kind: 'name', name: actor?.login ?? GHOST });
const code = (said: string): Part => ({ kind: 'code', text: said });

/** A commit's ID as rows show it. */
export function shortOid(oid: string): string {
  return oid.slice(0, 7);
}

/** A one-line event's row. */
function eventRow(
  key: string,
  glyph: TimelineGlyph,
  at: string,
  parts: Part[],
  { tone = 'neutral', url }: { tone?: TimelineTone; url?: string | undefined } = {},
): Row {
  return { kind: 'event', key, glyph, tone, parts, at, url };
}

/** The row an item that isn't a comment, a review or a commit makes, or none. */
function eventOf(key: string, item: Item, repository: string): Row | undefined {
  switch (item.kind) {
    case 'label':
      return eventRow(key, 'tag', item.event.at, [
        name(item.event.actor),
        text(item.added ? ' added ' : ' removed '),
        { kind: 'label', name: item.name, color: item.color },
      ]);
    case 'assignment': {
      const self = sameLogin(item.assignee?.login, item.event.actor?.login);
      const parts = self
        ? [
            name(item.event.actor),
            text(item.added ? ' self-assigned this' : ' removed their assignment'),
          ]
        : [
            name(item.event.actor),
            text(item.added ? ' assigned ' : ' unassigned '),
            name(item.assignee),
          ];
      return eventRow(key, 'person', item.event.at, parts);
    }
    case 'reviewRequest': {
      // GitHub names no reviewer it hides from the account, such as a team it can't see.
      if (item.reviewer === undefined) {
        return eventRow(key, 'eye', item.event.at, [
          name(item.event.actor),
          text(item.added ? ' asked for a review' : ' removed a review request'),
        ]);
      }
      const asked: Part = { kind: 'name', name: reviewerOf(item.reviewer).login };
      const parts = item.added
        ? [name(item.event.actor), text(' asked '), asked, text(' for a review')]
        : [name(item.event.actor), text(' removed the review request for '), asked];
      return eventRow(key, 'eye', item.event.at, parts);
    }
    case 'crossReference': {
      const { source } = item;
      if (!source) {
        return eventRow(key, 'link', item.event.at, [
          name(item.event.actor),
          text(' mentioned this elsewhere'),
        ]);
      }
      const where = source.repository === repository ? '' : source.repository;
      return eventRow(
        key,
        'link',
        item.event.at,
        [
          name(item.event.actor),
          text(' mentioned this in '),
          code(`${where}#${source.number}`),
          text(' '),
          { kind: 'quote', text: source.title },
        ],
        { url: source.url },
      );
    }
    case 'merged':
      return eventRow(
        key,
        'merged',
        item.event.at,
        item.commit === undefined
          ? [name(item.event.actor), text(' merged this into '), code(item.into)]
          : [
              name(item.event.actor),
              text(' merged '),
              code(shortOid(item.commit)),
              text(' into '),
              code(item.into),
            ],
        { tone: 'merged' },
      );
    case 'mergeQueue':
      return item.added
        ? eventRow(key, 'queue', item.event.at, [
            name(item.event.actor),
            text(' added this to the merge queue'),
          ])
        : eventRow(
            key,
            'queue',
            item.event.at,
            [
              name(item.event.actor),
              text(' removed this from the merge queue'),
              ...(item.reason === undefined || item.reason === ''
                ? []
                : [text(': '), { kind: 'quote' as const, text: item.reason }]),
            ],
            { tone: 'warn' },
          );
    case 'deployed': {
      const { words, tone } = deploymentOf(item.state);
      return eventRow(
        key,
        'deploy',
        item.event.at,
        [
          name(item.event.actor),
          text(' deployed to '),
          code(item.environment ?? 'an environment'),
          ...(words === undefined ? [] : [text(' · '), text(words)]),
        ],
        { tone },
      );
    }
    case 'deploymentChanged': {
      const { words, tone } = deploymentOf(item.state);
      return eventRow(
        key,
        'deploy',
        item.event.at,
        [
          text('The deployment to '),
          code(item.environment ?? 'an environment'),
          text(words === undefined ? ' changed' : ` is now ${words.toLowerCase()}`),
        ],
        { tone },
      );
    }
    case 'draft':
      return item.draft
        ? eventRow(key, 'draft', item.event.at, [
            name(item.event.actor),
            text(' marked this as a draft'),
          ])
        : eventRow(key, 'eye', item.event.at, [
            name(item.event.actor),
            text(' marked this as ready for review'),
          ]);
    case 'closed':
      return eventRow(
        key,
        'closed',
        item.event.at,
        [name(item.event.actor), text(' closed this')],
        {
          tone: 'fail',
        },
      );
    case 'reopened':
      return eventRow(
        key,
        'reopened',
        item.event.at,
        [name(item.event.actor), text(' reopened this')],
        { tone: 'ok' },
      );
    case 'baseChanged': {
      const fromTo = [code(item.from), text(' to '), code(item.to)];
      switch (item.how) {
        case 'changed':
          return eventRow(key, 'branch', item.event.at, [
            name(item.event.actor),
            text(' changed the base branch from '),
            ...fromTo,
          ]);
        case 'automatic':
          return eventRow(key, 'branch', item.event.at, [
            text('GitHub changed the base branch from '),
            ...fromTo,
          ]);
        case 'automaticFailed':
          return eventRow(
            key,
            'branch',
            item.event.at,
            [text('GitHub couldn’t change the base branch from '), ...fromTo],
            { tone: 'warn' },
          );
        default:
          item.how satisfies never;
          return undefined;
      }
    }
    case 'reviewDismissed':
      return eventRow(key, 'dismissed', item.event.at, [
        name(item.event.actor),
        ...(item.reviewer === undefined
          ? [text(' dismissed a review')]
          : [text(' dismissed '), name(item.reviewer), text('’s review')]),
        ...(item.message === undefined || item.message === ''
          ? []
          : [text(': '), { kind: 'quote' as const, text: item.message }]),
      ]);
    case 'autoMerge': {
      const { change } = item;
      let said: Part[];
      switch (change.kind) {
        case 'enabledMerge':
          said = [text(' turned on auto-merge, with a merge commit')];
          break;
        case 'enabledRebase':
          said = [text(' turned on auto-merge, rebasing')];
          break;
        case 'enabledSquash':
          said = [text(' turned on auto-merge, squashing')];
          break;
        case 'disabled':
          said = [
            text(' turned off auto-merge'),
            ...(change.reason === undefined || change.reason === ''
              ? []
              : [text(': '), { kind: 'quote' as const, text: change.reason }]),
          ];
          break;
        default:
          change satisfies never;
          return undefined;
      }
      return eventRow(key, 'auto', item.event.at, [name(item.event.actor), ...said]);
    }
    case 'stack': {
      const stack = item.number === undefined ? 'a GitHub stack' : `GitHub stack #${item.number}`;
      return eventRow(key, 'stack', item.event.at, [
        name(item.event.actor),
        text(item.added ? ` added this to ${stack}` : ` removed this from ${stack}`),
      ]);
    }
    case 'comment':
    case 'review':
    case 'commit':
    case 'forcePushed':
    case 'other':
      return undefined;
    default:
      item satisfies never;
      return undefined;
  }
}

/**
 * The rows of `timeline`, oldest first: the description card, a note of the older items Lo didn't
 * read, then a row for each item, commits grouped into pushes. `repository` is `owner/name`, which
 * a mention from the same repository leaves out.
 */
export function rowsOf(timeline: Timeline, repository: string, context: RowsContext): Row[] {
  const byHead = revisionsByHead(context.revisions);
  const pushers = new Map<string, string>();
  for (const revision of context.revisions?.revisions ?? []) {
    if (revision.pusher !== null) pushers.set(revision.head, revision.pusher);
  }
  const { description } = timeline;
  const rows: Row[] = [
    {
      kind: 'description',
      key: 'description',
      author: personOf(description.author),
      at: description.createdAt,
      body: description.body,
      draft: context.sidebar?.isDraft ?? false,
      labels: (context.sidebar?.labels ?? []).map((label) => ({
        name: label.name,
        color: label.color,
      })),
      reviewers: reviewersOf(context.sidebar, context.author ?? description.author?.login),
    },
  ];
  if (timeline.leftOut > 0) rows.push({ kind: 'older', key: 'older', count: timeline.leftOut });

  /** The commits of the push being gathered, with the cursor of its first. */
  let push: { key: string; commits: Extract<Item, { kind: 'commit' }>['commit'][] } | undefined;
  const endPush = () => {
    const gathered = push;
    push = undefined;
    const last = gathered?.commits.at(-1);
    if (!gathered || !last) return;
    const revision = byHead.get(last.oid);
    rows.push({
      kind: 'push',
      key: gathered.key,
      actor: pushers.get(last.oid) ?? last.authorLogin ?? last.authorName ?? GHOST,
      at: last.committedAt,
      commits: gathered.commits.map(({ oid, headline }) => ({ oid, headline })),
      revision: revision?.number,
    });
    const checks = checksOf(last.checks);
    if (checks !== undefined) {
      rows.push({
        kind: 'checks',
        key: `checks:${gathered.key}`,
        state: checks,
        oid: last.oid,
        revision: revision?.number,
      });
    }
  };

  const positions = new Map(
    (context.revisions?.revisions ?? []).map((revision, at) => [revision.head, at]),
  );
  const available = new Set(
    (context.revisions?.revisions ?? []).flatMap((revision) =>
      revision.available ? [revision.head] : [],
    ),
  );

  for (const { cursor, item } of timeline.items) {
    if (item.kind === 'commit') {
      push ??= { key: cursor, commits: [] };
      push.commits.push(item.commit);
      // A revision ends here: what comes after it is another push.
      if (byHead.has(item.commit.oid)) endPush();
      continue;
    }
    if (item.kind === 'other') continue;
    endPush();
    if (item.kind === 'comment') {
      const { comment } = item;
      rows.push({
        kind: 'comment',
        key: cursor,
        id: comment.id,
        author: personOf(comment.author),
        at: comment.createdAt,
        body: comment.body,
        url: comment.url,
        byAuthor: sameLogin(comment.author?.login, context.author ?? description.author?.login),
        hidden: comment.hidden,
        canUpdate: comment.viewerCanUpdate,
        canDelete: comment.viewerCanDelete,
      });
    } else if (item.kind === 'review') {
      const { review } = item;
      // Pending, it's its author's alone: their pending review says so where it's kept.
      if (review.submittedAt === undefined || review.state === 'PENDING') continue;
      rows.push({
        kind: 'review',
        key: cursor,
        id: review.id,
        author: personOf(review.author),
        at: review.submittedAt,
        body: review.body,
        url: review.url,
        verdict: verdictOf(review.state),
        revision: review.commit === undefined ? undefined : byHead.get(review.commit)?.number,
        hidden: review.hidden,
        comments: review.comments,
      });
    } else if (item.kind === 'forcePushed') {
      const head = item.branch === 'head';
      const before = item.before === undefined ? undefined : byHead.get(item.before);
      const after = item.after === undefined ? undefined : byHead.get(item.after);
      const comparable =
        head &&
        before !== undefined &&
        after !== undefined &&
        available.has(before.head) &&
        available.has(after.head) &&
        (positions.get(before.head) ?? 0) < (positions.get(after.head) ?? 0);
      rows.push({
        kind: 'forcePush',
        key: cursor,
        actor: item.event.actor?.login ?? GHOST,
        at: item.event.at,
        branch: item.branch,
        before: item.before,
        after: item.after,
        revision: head ? after?.number : undefined,
        compare: comparable ? { from: before, to: after } : undefined,
      });
    } else {
      const row = eventOf(cursor, item, repository);
      if (row) rows.push(row);
    }
  }
  endPush();
  return rows;
}

/** The words of a one-line event, as plain text. */
export function sentence(parts: readonly Part[]): string {
  return parts.map((part) => ('text' in part ? part.text : part.name)).join('');
}
