import { describe, expect, it } from 'vitest';

import type { ComparisonView, RevisionRow } from '../../revisions/contract.ts';
import type { Item, Sidebar, Timeline } from '../contract.ts';
import { reviewersOf, rowsOf, sentence, type Row, type RowsContext } from './rows.ts';

const AT = '2026-11-06T12:00:00Z';
const REPOSITORY = 'rozed-dev/e2e';
const head = (letter: string) => letter.repeat(40);
const user = (login: string) => ({ login, type: 'User' });
const event = (login = 'ravi-k') => ({ actor: user(login), at: AT });

function timeline(items: Item[], change: Partial<Timeline> = {}): Timeline {
  return {
    description: { author: user('mona'), body: 'Adds the cache.', createdAt: AT },
    items: items.map((item, at) => ({ cursor: `c${at}`, item })),
    leftOut: 0,
    count: items.length,
    shownUpdatedAt: AT,
    readInFullAt: AT,
    ...change,
  };
}

function commit(letter: string, change: Partial<Extract<Item, { kind: 'commit' }>['commit']> = {}) {
  return {
    kind: 'commit' as const,
    commit: {
      oid: head(letter),
      headline: `Commit ${letter}`,
      authorLogin: 'mona',
      committedAt: AT,
      ...change,
    },
  };
}

function revision(letter: string, number: number, change: Partial<RevisionRow> = {}): RevisionRow {
  return {
    head: head(letter),
    number,
    pushedAt: { kind: 'unknown' },
    forced: false,
    pusher: null,
    rebased: false,
    available: true,
    ...change,
  };
}

function revisions(...rows: RevisionRow[]): ComparisonView {
  return {
    id: 'tab-1',
    status: 'ready',
    revisions: rows,
    base: { branch: 'main', tip: null },
    markers: { review: null, lastSeen: null },
    shown: null,
    comparison: null,
    pending: null,
    offered: null,
    waitingFor: null,
    nothingNewSince: null,
    replay: null,
    conflicted: 0,
    uncertain: false,
    problem: null,
  };
}

const none: RowsContext = { sidebar: undefined, revisions: undefined, author: undefined };

/** The rows of `items` past the description. */
function rowsAfter(items: Item[], context: Partial<RowsContext> = {}): Row[] {
  return rowsOf(timeline(items), REPOSITORY, { ...none, ...context }).slice(1);
}

/** The one event row `item` makes, as a sentence. */
function said(item: Item): string {
  const [row] = rowsAfter([item]);
  if (row?.kind !== 'event') throw new Error(`Not an event: ${row?.kind}`);
  return sentence(row.parts);
}

/** A mention of the pull request from issue #7 in `repository`. */
function mention(repository: string): Item {
  return {
    kind: 'crossReference',
    event: event(),
    source: {
      kind: 'issue',
      repository,
      number: 7,
      title: 'Cache misses',
      url: `https://github.com/${repository}/issues/7`,
    },
    willClose: false,
  };
}

function sidebarOf(change: Partial<Sidebar>): Sidebar {
  return { isDraft: false, labels: [], requested: [], reviews: [], assignees: [], ...change };
}

/** A force-push of `branch` from `before`'s head to `after`'s. */
function force(before: string, after: string, branch: 'head' | 'base' = 'head'): Item {
  return { kind: 'forcePushed', event: event(), branch, before: head(before), after: head(after) };
}

describe('rowsOf', () => {
  it('starts with the description, then a note of what was left out', () => {
    const rows = rowsOf(timeline([], { leftOut: 120 }), REPOSITORY, {
      ...none,
      sidebar: {
        isDraft: true,
        labels: [{ name: 'api', color: '2700af' }],
        requested: [],
        reviews: [],
        assignees: [],
      },
    });
    expect(rows).toEqual([
      expect.objectContaining({
        kind: 'description',
        author: { login: 'mona', type: 'User' },
        body: 'Adds the cache.',
        draft: true,
        labels: [{ name: 'api', color: '2700af' }],
      }),
      { kind: 'older', key: 'older', count: 120 },
    ]);
  });

  it('groups commits into one push, split where a revision ends, each with its checks', () => {
    const rows = rowsAfter(
      [
        commit('a'),
        commit('b', { checks: 'FAILURE' }),
        commit('c'),
        commit('d', { checks: 'SUCCESS', authorLogin: undefined, authorName: 'Mona' }),
      ],
      { revisions: revisions(revision('b', 1, { pusher: 'ravi-k' }), revision('d', 2)) },
    );
    expect(rows).toEqual([
      {
        kind: 'push',
        key: 'c0',
        actor: 'ravi-k',
        at: AT,
        commits: [
          { oid: head('a'), headline: 'Commit a' },
          { oid: head('b'), headline: 'Commit b' },
        ],
        revision: 1,
      },
      { kind: 'checks', key: 'checks:c0', state: 'failed', oid: head('b'), revision: 1 },
      {
        kind: 'push',
        key: 'c2',
        actor: 'Mona',
        at: AT,
        commits: [
          { oid: head('c'), headline: 'Commit c' },
          { oid: head('d'), headline: 'Commit d' },
        ],
        revision: 2,
      },
      { kind: 'checks', key: 'checks:c2', state: 'passed', oid: head('d'), revision: 2 },
    ]);
  });

  it('ends a push at the next row, and leaves out what has none', () => {
    const rows = rowsAfter([
      commit('a'),
      { kind: 'other', typename: 'SubscribedEvent' },
      commit('b'),
      { kind: 'closed', event: event() },
      commit('c', { checks: 'SOMETHING_NEW' }),
    ]);
    expect(rows.map((row) => [row.kind, row.key])).toEqual([
      ['push', 'c0'],
      ['event', 'c3'],
      ['push', 'c4'],
    ]);
  });

  it('makes cards of comments and submitted reviews, with the revision a review was on', () => {
    const rows = rowsAfter(
      [
        {
          kind: 'comment',
          comment: {
            id: 'IC_1',
            author: user('mona'),
            body: 'Thanks!',
            createdAt: AT,
            url: 'https://github.com/rozed-dev/e2e/pull/23#issuecomment-1',
            hidden: 'outdated',
            viewerCanUpdate: true,
            viewerCanDelete: true,
          },
        },
        {
          kind: 'review',
          review: {
            id: 'PRR_1',
            author: { login: 'lint-bot', type: 'Bot' },
            body: '',
            state: 'CHANGES_REQUESTED',
            createdAt: AT,
            submittedAt: AT,
            url: 'https://github.com/rozed-dev/e2e/pull/23#pullrequestreview-1',
            hidden: false,
            commit: head('a'),
            comments: 3,
          },
        },
        {
          kind: 'review',
          review: {
            id: 'PRR_2',
            author: user('ravi-k'),
            body: 'Not yet',
            state: 'PENDING',
            createdAt: AT,
            url: 'https://github.com/rozed-dev/e2e/pull/23#pullrequestreview-2',
            hidden: false,
            comments: 1,
          },
        },
      ],
      { revisions: revisions(revision('a', 1)) },
    );
    expect(rows).toEqual([
      expect.objectContaining({
        kind: 'comment',
        id: 'IC_1',
        byAuthor: true,
        hidden: 'outdated',
        author: { login: 'mona', type: 'User' },
      }),
      expect.objectContaining({
        kind: 'review',
        id: 'PRR_1',
        verdict: 'changes',
        revision: 1,
        comments: 3,
        author: { login: 'lint-bot', type: 'Bot' },
      }),
    ]);
  });

  it('offers to compare a force-push’s revisions only when both are there, in order', () => {
    const view = revisions(
      revision('a', 1),
      revision('b', 2),
      revision('c', 3, { available: false }),
    );
    const rows = rowsAfter(
      [force('a', 'b'), force('b', 'a'), force('b', 'c'), force('a', 'b', 'base')],
      {
        revisions: view,
      },
    );
    expect(rows.map((row) => (row.kind === 'forcePush' ? row.compare : 'not one'))).toEqual([
      { from: { number: 1, head: head('a') }, to: { number: 2, head: head('b') } },
      undefined,
      undefined,
      undefined,
    ]);
    expect(rows.map((row) => (row.kind === 'forcePush' ? row.revision : 'not one'))).toEqual([
      2,
      1,
      3,
      undefined,
    ]);
  });
});

describe('the words of an event', () => {
  it('says labels, assignments and review requests', () => {
    expect(said({ kind: 'label', event: event(), name: 'api', color: '2700af', added: true })).toBe(
      'ravi-k added api',
    );
    expect(said({ kind: 'label', event: event(), name: 'api', added: false })).toBe(
      'ravi-k removed api',
    );
    expect(
      said({ kind: 'assignment', event: event(), assignee: user('ravi-k'), added: true }),
    ).toBe('ravi-k self-assigned this');
    expect(said({ kind: 'assignment', event: event(), assignee: user('mona'), added: false })).toBe(
      'ravi-k unassigned mona',
    );
    expect(
      said({
        kind: 'reviewRequest',
        event: event(),
        reviewer: { kind: 'team', slug: 'rozed-dev/core' },
        added: true,
      }),
    ).toBe('ravi-k asked rozed-dev/core for a review');
    expect(said({ kind: 'reviewRequest', event: event(), added: true })).toBe(
      'ravi-k asked for a review',
    );
    expect(said({ kind: 'reviewRequest', event: event(), added: false })).toBe(
      'ravi-k removed a review request',
    );
  });

  it('names a mention’s repository only when it’s another', () => {
    expect(said(mention(REPOSITORY))).toBe('ravi-k mentioned this in #7 Cache misses');
    expect(said(mention('rozed-dev/other'))).toBe(
      'ravi-k mentioned this in rozed-dev/other#7 Cache misses',
    );
    const [row] = rowsAfter([mention('rozed-dev/other')]);
    expect(row).toMatchObject({ url: 'https://github.com/rozed-dev/other/issues/7' });
  });

  it('says merges, the merge queue, closing and drafts, each in its tone', () => {
    const cases: [Item, string, string][] = [
      [
        { kind: 'merged', event: event(), commit: head('f'), into: 'main' },
        'ravi-k merged fffffff into main',
        'merged',
      ],
      [
        { kind: 'mergeQueue', event: event(), added: false, reason: 'Checks failed' },
        'ravi-k removed this from the merge queue: Checks failed',
        'warn',
      ],
      [{ kind: 'closed', event: event() }, 'ravi-k closed this', 'fail'],
      [{ kind: 'reopened', event: event() }, 'ravi-k reopened this', 'ok'],
      [
        { kind: 'draft', event: event(), draft: false },
        'ravi-k marked this as ready for review',
        'neutral',
      ],
      [
        { kind: 'deployed', event: event(), environment: 'staging', state: 'FAILURE' },
        'ravi-k deployed to staging · Failed',
        'fail',
      ],
      [
        { kind: 'deploymentChanged', event: event(), environment: 'staging', state: 'SUCCESS' },
        'The deployment to staging is now active',
        'ok',
      ],
    ];
    for (const [item, words, tone] of cases) {
      const [row] = rowsAfter([item]);
      expect(row?.kind === 'event' && [sentence(row.parts), row.tone]).toEqual([words, tone]);
    }
  });

  it('says base changes, dismissals, auto-merge and stacks', () => {
    expect(
      said({ kind: 'baseChanged', event: event(), from: 'feat', to: 'main', how: 'automatic' }),
    ).toBe('GitHub changed the base branch from feat to main');
    expect(
      said({
        kind: 'reviewDismissed',
        event: event(),
        reviewer: user('mona'),
        message: 'Stale',
        previousState: 'APPROVED',
      }),
    ).toBe('ravi-k dismissed mona’s review: Stale');
    expect(said({ kind: 'autoMerge', event: event(), change: { kind: 'enabledSquash' } })).toBe(
      'ravi-k turned on auto-merge, squashing',
    );
    expect(said({ kind: 'stack', event: event(), number: 4, added: true })).toBe(
      'ravi-k added this to GitHub stack #4',
    );
    expect(said({ kind: 'closed', event: { at: AT } })).toBe('ghost closed this');
  });
});

describe('reviewersOf', () => {
  it('lists each reviewer’s latest review, then those asked, leaving out the author', () => {
    expect(
      reviewersOf(
        sidebarOf({
          reviews: [
            { author: user('mona'), state: 'COMMENTED' },
            { author: user('ravi-k'), state: 'CHANGES_REQUESTED' },
            { author: user('Ravi-K'), state: 'APPROVED' },
            { author: { login: 'lint-bot', type: 'Bot' }, state: 'COMMENTED' },
            { author: user('jun'), state: 'PENDING' },
          ],
          requested: [
            { kind: 'account', login: 'lint-bot', type: 'Bot' },
            { kind: 'team', slug: 'rozed-dev/core' },
            { kind: 'hiddenTeam' },
          ],
        }),
        'mona',
      ),
    ).toEqual([
      { person: { login: 'Ravi-K', type: 'User' }, state: 'approved' },
      { person: { login: 'lint-bot', type: 'Bot' }, state: 'requested' },
      { person: { login: 'rozed-dev/core', type: 'Team' }, state: 'requested' },
    ]);
  });

  it('lists nobody before the sidebar is read', () => {
    expect(reviewersOf(undefined, 'mona')).toEqual([]);
  });
});
