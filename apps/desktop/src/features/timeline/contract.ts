// A pull request's timeline: its description, and everything that happened to it since, as GitHub
// lists it, with its labels, reviewers, assignees and draft state beside the description. Main
// reads them the first time the window shows a view's timeline, through the account's poller, which
// keeps them current from then on; the window draws them as the timeline's rows.

import { z } from 'zod';

import { defineContract, reply } from '../../ipc/contract.ts';
import { tabId } from '../tab/contract.ts';

/**
 * A value GitHub names from a list it may add to, such as a review's state: as GitHub gives it, so
 * a new one shows as nothing in particular rather than failing the whole timeline.
 */
const named = z.string();

/** An account, by its login and the type GitHub names it with (`User`, `Bot`, a mannequin…). */
export const actor = z.strictObject({ login: z.string(), type: named });
export type Actor = z.output<typeof actor>;

/** Who did something, and when, as an ISO time: nobody for a deleted account. */
const event = z.strictObject({ actor: actor.optional(), at: z.string() });

/** Someone asked for a review: an account, or a team by its slug (`org/team`). */
export const reviewer = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('account'), login: z.string(), type: named }),
  z.strictObject({ kind: z.literal('team'), slug: z.string() }),
]);
export type Reviewer = z.output<typeof reviewer>;

/** A comment on the pull request itself. `hidden` is why GitHub hid it, while it's hidden. */
const comment = z.strictObject({
  id: z.string(),
  author: actor.optional(),
  body: z.string(),
  createdAt: z.string(),
  lastEditedAt: z.string().optional(),
  url: z.string(),
  hidden: z.string().optional(),
  viewerCanUpdate: z.boolean(),
  viewerCanDelete: z.boolean(),
});

/**
 * A review: its state (`APPROVED`, `CHANGES_REQUESTED`, `COMMENTED`, `DISMISSED` or `PENDING`), the
 * commit it reviewed, and how many comments it left in threads.
 */
const review = z.strictObject({
  id: z.string(),
  author: actor.optional(),
  body: z.string(),
  state: named,
  createdAt: z.string(),
  submittedAt: z.string().optional(),
  lastEditedAt: z.string().optional(),
  url: z.string(),
  hidden: z.boolean(),
  commit: z.string().optional(),
  comments: z.number(),
});

/** A commit on the head branch, with its checks' state (`SUCCESS`, `FAILURE`…), if it has checks. */
const commit = z.strictObject({
  oid: z.string(),
  headline: z.string(),
  authorLogin: z.string().optional(),
  authorName: z.string().optional(),
  committedAt: z.string(),
  checks: named.optional(),
});

/** An issue or pull request that mentioned this one. */
const source = z.strictObject({
  kind: z.enum(['issue', 'pullRequest']),
  repository: z.string(),
  number: z.number(),
  title: z.string(),
  url: z.string(),
});

/** What happened to auto-merge. */
const autoMerge = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('enabledMerge') }),
  z.strictObject({ kind: z.literal('enabledRebase') }),
  z.strictObject({ kind: z.literal('enabledSquash') }),
  z.strictObject({ kind: z.literal('disabled'), reason: z.string().optional() }),
]);

/** An item of the timeline, as `@lo/github`'s `TimelineItem` says each kind. */
export const item = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('comment'), comment }),
  z.strictObject({ kind: z.literal('review'), review }),
  z.strictObject({ kind: z.literal('commit'), commit }),
  z.strictObject({
    kind: z.literal('forcePushed'),
    event,
    branch: z.enum(['head', 'base']),
    before: z.string().optional(),
    after: z.string().optional(),
  }),
  z.strictObject({
    kind: z.literal('label'),
    event,
    name: z.string(),
    color: z.string().optional(),
    added: z.boolean(),
  }),
  z.strictObject({
    kind: z.literal('assignment'),
    event,
    assignee: actor.optional(),
    added: z.boolean(),
  }),
  z.strictObject({
    kind: z.literal('reviewRequest'),
    event,
    reviewer: reviewer.optional(),
    added: z.boolean(),
  }),
  z.strictObject({
    kind: z.literal('crossReference'),
    event,
    source: source.optional(),
    willClose: z.boolean(),
  }),
  z.strictObject({
    kind: z.literal('merged'),
    event,
    commit: z.string().optional(),
    into: z.string(),
  }),
  z.strictObject({
    kind: z.literal('mergeQueue'),
    event,
    added: z.boolean(),
    reason: z.string().optional(),
  }),
  z.strictObject({
    kind: z.literal('deployed'),
    event,
    environment: z.string().optional(),
    state: named.optional(),
  }),
  z.strictObject({
    kind: z.literal('deploymentChanged'),
    event,
    environment: z.string().optional(),
    state: named,
  }),
  z.strictObject({ kind: z.literal('draft'), event, draft: z.boolean() }),
  z.strictObject({ kind: z.literal('closed'), event }),
  z.strictObject({ kind: z.literal('reopened'), event }),
  z.strictObject({
    kind: z.literal('baseChanged'),
    event,
    from: z.string(),
    to: z.string(),
    how: z.enum(['changed', 'automatic', 'automaticFailed']),
  }),
  z.strictObject({
    kind: z.literal('reviewDismissed'),
    event,
    review: z.string().optional(),
    reviewer: actor.optional(),
    message: z.string().optional(),
    previousState: named,
  }),
  z.strictObject({ kind: z.literal('autoMerge'), event, change: autoMerge }),
  z.strictObject({
    kind: z.literal('stack'),
    event,
    number: z.number().optional(),
    added: z.boolean(),
  }),
  z.strictObject({ kind: z.literal('other'), typename: z.string().optional() }),
]);
export type Item = z.output<typeof item>;

/**
 * A pull request's timeline: its description (its author, its Markdown, when it was opened), its
 * items oldest first, each with the cursor that names it, and how many older items weren't read.
 */
export const timeline = z.strictObject({
  description: z.strictObject({
    author: actor.optional(),
    body: z.string(),
    createdAt: z.string(),
    lastEditedAt: z.string().optional(),
  }),
  items: z.array(z.strictObject({ cursor: z.string(), item })),
  leftOut: z.number(),
  count: z.number(),
  shownUpdatedAt: z.string(),
  readInFullAt: z.string(),
});
export type Timeline = z.output<typeof timeline>;

/**
 * A view's timeline, as main has it: `loading` until it's read; `signIn` for a tab that acts as
 * nobody, which reads no timeline; `run` for a run of a stack's layers, which has none of its own;
 * `ready`; or `failed`, with why in `problem`, when it couldn't be read and nothing was read before.
 */
export const timelineView = z.strictObject({
  id: tabId,
  status: z.enum(['loading', 'signIn', 'run', 'ready', 'failed']),
  timeline: timeline.nullable(),
  problem: z.string().nullable(),
});
export type TimelineView = z.output<typeof timelineView>;

/**
 * What the description card shows beside the description: whether it's a draft, its labels (each
 * color six lowercase hex digits, when GitHub's is), who was asked to review it and hasn't since, a
 * team the account can't see among them, each reviewer's latest review, and who it's assigned to.
 */
export const sidebar = z.strictObject({
  isDraft: z.boolean(),
  labels: z.array(z.strictObject({ name: z.string(), color: z.string().optional() })),
  requested: z.array(z.union([reviewer, z.strictObject({ kind: z.literal('hiddenTeam') })])),
  reviews: z.array(z.strictObject({ author: actor.optional(), state: named })),
  assignees: z.array(actor),
});
export type Sidebar = z.output<typeof sidebar>;

/** A view's labels, reviewers, assignees and draft state, once main has read them. */
export const sidebarView = z.strictObject({ id: tabId, sidebar: sidebar.nullable() });
export type SidebarView = z.output<typeof sidebarView>;

export const contract = defineContract('timeline', {
  requests: {
    /**
     * Reads view `id`'s timeline and what goes beside its description, the first time the window
     * shows it, and keeps them current from then on, as the account's poller reads them again; and
     * answers with what main has now, which `timeline` and `sidebar` then keep up to date. Fails as
     * `missing` for no such view.
     */
    show: {
      input: z.strictObject({ id: tabId }),
      reply: reply<{ timeline: TimelineView; sidebar: SidebarView }>(),
    },
  },
  topics: {
    /** A view's timeline, each time it changes. */
    timeline: timelineView,
    /** A view's labels, reviewers, assignees and draft state, each time they change. */
    sidebar: sidebarView,
  },
});
