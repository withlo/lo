// The GraphQL queries on responses recorded from `rozed-dev/playground`, where PR #1
// (`stack-a` → `main`) and PR #2 (`stack-b` → `stack-a`) form stack #3, and on answers written by
// hand for what GitHub can't be made to do on demand.

import { Replay, replayFetch, type Interaction, type Json } from '@lo/testing';
import { expect, test } from 'vitest';

import { GithubClient } from '../src/client.ts';
import { GithubError } from '../src/errors.ts';
import { PullRequestDocument } from '../src/generated/graphql.ts';
import { unchecked } from '../src/json.ts';
import {
  markFileAsViewed,
  openPullRequestsPaged,
  pullRequest,
  pullRequestCheck,
  pullRequestPaged,
  RECENTLY_UPDATED_MERGED,
  unmarkFileAsViewed,
  unresolvedThreads,
  viewer,
  type PullRequestCheck,
} from '../src/queries.ts';
import { RepoRef } from '../src/refs.ts';
import { Token } from '../src/token.ts';

function client(cassette: string | Replay) {
  const fetch = replayFetch(cassette);
  return { client: new GithubClient({ fetch, token: new Token('gho_FAKE') }), fetch };
}

/** What a request sent as JSON. */
function sent(body: Uint8Array): Record<string, Json> {
  return unchecked<Record<string, Json>>(JSON.parse(new TextDecoder().decode(body)));
}

test('viewer', async () => {
  const { client: account, fetch } = client('graphql_viewer');
  const me = await viewer(account);
  expect(me.login).toBe('rozed-bot');
  expect(me.databaseId).toBe(353226052);
  expect(me.avatarUrl.startsWith('https://avatars.githubusercontent.com/')).toBe(true);
  expect(fetch.seen[0]?.url).toBe('https://api.github.com/graphql');
  expect(fetch.seen[0]?.headers.get('authorization')).toBe('token gho_FAKE');
});

test('pull request', async () => {
  const { client: account } = client('graphql_pull_request_1');
  const pr = await pullRequest(account, 'rozed-dev', 'playground', 1);
  expect(pr.number).toBe(1);
  expect(pr.state).toBe('OPEN');
  expect(pr.isDraft).toBe(false);
  expect(pr.author?.login).toBe('rozed-bot');
  expect([pr.baseRefName, pr.headRefName]).toEqual(['main', 'stack-a']);
  expect(pr.baseRefOid.startsWith('6ce218eb')).toBe(true);
  expect(pr.headRefOid).toHaveLength(40);
  expect(pr.isCrossRepository).toBe(false);
  expect(pr.headRepository).toEqual({ nameWithOwner: 'rozed-dev/playground', isFork: false });
  expect(pr.files?.totalCount).toBe(1);
  expect(pr.files?.nodes).toHaveLength(1);
});

test('pull request reads every page of files', async () => {
  const { client: account, fetch } = client('graphql_pull_request_files_paged');
  const pr = await pullRequestPaged(account, 'rozed-dev', 'playground', 2, 1);
  expect(pr.files?.pageInfo.hasNextPage).toBe(false);
  const files = (pr.files?.nodes ?? []).map((file) => [file?.path, file?.viewerViewedState]);
  expect(files).toEqual([
    ['stack-b.md', 'VIEWED'],
    ['docs/notes.md', 'UNVIEWED'],
  ]);
  expect(fetch.seen).toHaveLength(2);
});

test('pull request check', async () => {
  const { client: account } = client('graphql_pull_request_check_1');
  const check = await pullRequestCheck(account, 'rozed-dev', 'playground', 1);
  expect(check.headRefOid).toHaveLength(40);
  expect(check.commits.totalCount).toBe(1);
  expect(check.changedFiles).toBe(1);
  // Joining a stack moved the timeline but not the pull request's own updatedAt.
  expect(Date.parse(check.timelineItems.updatedAt)).toBeGreaterThan(Date.parse(check.updatedAt));
  // What the window shows without the details: the playground has no checks, required reviews,
  // review threads or merge queue, and PR #1 can merge.
  expect(check.statusCheckRollup).toBeNull();
  expect(check.reviewDecision).toBeNull();
  expect(check.mergeStateStatus).toBe('CLEAN');
  expect(unresolvedThreads(check)).toBe(0);
  expect(check.mergeQueueEntry).toBeNull();
  // The query asks for its own cost, which lands in the account's rate limits. Everything above
  // still costs a single point.
  const limits = account.rateLimits();
  expect(limits.lastGraphQLCost).toBe(1);
  expect(limits.graphql()).toBeDefined();
});

test('a check counts its unresolved threads', () => {
  const check = unchecked<PullRequestCheck>({
    updatedAt: '2026-11-06T08:15:07Z',
    state: 'OPEN',
    isDraft: false,
    baseRefName: 'main',
    baseRefOid: '6ce218eb1930c49db64d5744c76a6739d4525e82',
    headRefOid: 'b046244d9569964088e952243e5e557312322488',
    reviewDecision: 'CHANGES_REQUESTED',
    mergeStateStatus: 'BLOCKED',
    statusCheckRollup: { state: 'PENDING' },
    mergeQueueEntry: { state: 'QUEUED', position: 2 },
    timelineItems: { updatedAt: '2026-11-06T08:15:21Z', totalCount: 2 },
    revisionEvents: { filteredCount: 0 },
    commits: { totalCount: 1 },
    reviews: { totalCount: 1 },
    submittedReviews: { totalCount: 1 },
    reviewThreads: {
      totalCount: 3,
      nodes: [
        { isResolved: false, comments: { totalCount: 1 } },
        { isResolved: true, comments: { totalCount: 2 } },
        { isResolved: false, comments: { totalCount: 1 } },
      ],
    },
    viewerPendingReview: { nodes: [{ viewerDidAuthor: true, comments: { totalCount: 1 } }] },
    comments: { totalCount: 0 },
    changedFiles: 1,
    lastEditedAt: null,
    timelineEvents: { filteredCount: 4, updatedAt: '2026-11-06T08:15:21Z' },
  });
  expect(unresolvedThreads(check)).toBe(2);
  expect(check.statusCheckRollup?.state).toBe('PENDING');
});

test('open pull requests with their stack', async () => {
  const { client: account, fetch } = client('graphql_open_pull_requests_paged');
  const list = await openPullRequestsPaged(
    account,
    new RepoRef('rozed-dev', 'playground'),
    1,
    RECENTLY_UPDATED_MERGED,
  );
  expect(list.totalCount).toBe(2);
  expect(list.truncated).toBe(false);
  expect(fetch.seen).toHaveLength(2);
  const layers = list.pullRequests.map((pr) => [
    pr.number,
    pr.baseRefName,
    pr.headRefName,
    pr.stackEntry?.stack?.number,
    pr.stackEntry?.position,
  ]);
  // Newest first, so the cap drops the oldest pull requests rather than the newest.
  expect(layers).toEqual([
    [2, 'stack-a', 'stack-b', 3, 2],
    [1, 'main', 'stack-a', 3, 1],
  ]);
  // Layer 2's base is layer 1's head.
  expect(list.pullRequests[0]?.baseRefOid).toBe(list.pullRequests[1]?.headRefOid);
  // The query asks for that order.
  const query = sent(fetch.seen[0]?.body ?? new Uint8Array())['query'];
  expect(query).toMatch(/orderBy:\s*\{\s*field:\s*CREATED_AT,\s*direction:\s*DESC\s*\}/);
});

test('a missing repository is not found', async () => {
  const { client: account } = client('graphql_not_found');
  const error = await pullRequest(account, 'rozed-dev', 'does-not-exist', 1).catch(
    (thrown: unknown) => thrown,
  );
  expect(error instanceof GithubError && error.detail).toMatchObject({ kind: 'notFound' });
  expect(String(error)).toContain('rozed-dev/does-not-exist');
});

test('partial data keeps the errors and their type', async () => {
  const { client: account } = client('graphql_not_found');
  const response = await account.graphqlPartial(PullRequestDocument, {
    owner: 'rozed-dev',
    name: 'does-not-exist',
    number: 1,
    filesFirst: 100,
    filesAfter: null,
  });
  expect(response.data?.repository).toBeNull();
  expect(response.errors[0]?.type).toBe('NOT_FOUND');
});

/** PR #2's files and their viewed marks, and the pull request's node ID. */
async function pr2Marks(account: GithubClient): Promise<[string, [string, string][]]> {
  const pr = await pullRequest(account, 'rozed-dev', 'playground', 2);
  const files = (pr.files?.nodes ?? []).flatMap((file): [string, string][] =>
    file ? [[file.path, file.viewerViewedState]] : [],
  );
  return [pr.id, files];
}

test('a file is marked viewed and the mark cleared', async () => {
  const { client: account, fetch } = client('graphql_viewed_marks');
  const [id, before] = await pr2Marks(account);
  expect(before).toEqual([['stack-b.md', 'UNVIEWED']]);

  await markFileAsViewed(account, id, 'stack-b.md');
  expect((await pr2Marks(account))[1]).toEqual([['stack-b.md', 'VIEWED']]);

  await unmarkFileAsViewed(account, id, 'stack-b.md');
  expect((await pr2Marks(account))[1]).toEqual([['stack-b.md', 'UNVIEWED']]);

  // Each mutation names the pull request by its node ID, and the file by its path.
  const mutations = fetch.seen.flatMap((request) => {
    const body = sent(request.body);
    const operation = body['operationName'];
    return typeof operation === 'string' && operation.endsWith('FileAsViewed')
      ? [[operation, body['variables']]]
      : [];
  });
  const variables = { pullRequestId: id, path: 'stack-b.md' };
  expect(mutations).toEqual([
    ['MarkFileAsViewed', variables],
    ['UnmarkFileAsViewed', variables],
  ]);
});

/** A pull request node ID that names nothing. */
const MISSING_PULL_REQUEST = 'PR_kwDOVk6v9M8AAAAAAAAAAA';

test('marking a file of a pull request that doesnt exist fails', async () => {
  const { client: account } = client('graphql_mark_file_as_viewed_not_found');
  const error = await markFileAsViewed(account, MISSING_PULL_REQUEST, 'README.md').catch(
    (thrown: unknown) => thrown,
  );
  expect(error instanceof GithubError && error.detail.kind).toBe('notFound');
  expect(String(error)).toContain(MISSING_PULL_REQUEST);
});

test('marking a path the pull request doesnt have is refused', async () => {
  const { client: account } = client('graphql_mark_file_as_viewed_unlisted_path');
  const [id, before] = await pr2Marks(account);

  const error = await markFileAsViewed(account, id, 'not-in-this-pull-request.md').catch(
    (thrown: unknown) => thrown,
  );

  expect(error instanceof GithubError && error.detail).toMatchObject({
    kind: 'graphql',
    errors: [{ type: 'UNPROCESSABLE', message: 'Filepath must be part of pull request' }],
  });
  // PR #2's one file is still unviewed.
  expect(before).toEqual([['stack-b.md', 'UNVIEWED']]);
  expect((await pr2Marks(account))[1]).toEqual(before);
});

/** Answers written by hand: each operation with its variables, answered with `data`. */
function synthetic(answers: [operation: string, variables: Json, data: Json][]): Replay {
  const interactions: Interaction[] = answers.map(([operation, variables, data]) => ({
    request: { method: 'POST', url: 'https://api.github.com/graphql', operation, variables },
    response: { status: 200, headers: {}, body: { data } },
  }));
  return new Replay('synthetic', interactions);
}

test('a viewed mark answer without its pull request isnt taken as done', async () => {
  const variables = { pullRequestId: 'PR_x', path: 'a.rs' };
  const { client: account } = client(
    synthetic([
      ['MarkFileAsViewed', variables, { markFileAsViewed: { pullRequest: null } }],
      ['UnmarkFileAsViewed', variables, { unmarkFileAsViewed: null }],
    ]),
  );
  for (const write of [markFileAsViewed, unmarkFileAsViewed]) {
    const error = await write(account, 'PR_x', 'a.rs').catch((thrown: unknown) => thrown);
    expect(error instanceof GithubError && error.detail.kind).toBe('decode');
  }
});

/** The variables of PR #2's page of one file after `after`. */
function filesAfter(after: string | null): Json {
  return { owner: 'o', name: 'r', number: 2, filesFirst: 1, filesAfter: after };
}

/** PR #2 at `head`, with a page of files. */
function prPage(head: string, files: string[], hasNext: boolean, endCursor: string | null): Json {
  return {
    repository: {
      pullRequest: {
        id: 'PR_x',
        number: 2,
        title: 't',
        url: 'https://github.com/o/r/pull/2',
        state: 'OPEN',
        isDraft: false,
        updatedAt: '2026-11-06T08:15:08Z',
        author: null,
        baseRefName: 'main',
        baseRefOid: 'b'.repeat(40),
        headRefName: 'topic',
        headRefOid: head,
        isCrossRepository: false,
        headRepository: null,
        files: {
          totalCount: 2,
          pageInfo: { hasNextPage: hasNext, endCursor },
          nodes: files.map((path) => ({ path, viewerViewedState: 'UNVIEWED' })),
        },
      },
    },
  };
}

/** The variables of a page of one open pull request after `after`. The first page also asks for the merged pull requests updated most recently. */
function openAfter(after: string | null): Json {
  return {
    owner: 'o',
    name: 'r',
    first: 1,
    after,
    merged: after === null ? RECENTLY_UPDATED_MERGED : 0,
  };
}

/** A page of open pull requests, numbered `numbers`, each into `main`. */
function openPage(numbers: number[], hasNext: boolean, endCursor: string | null): Json {
  return {
    rateLimit: null,
    repository: {
      defaultBranchRef: { name: 'main' },
      pullRequests: {
        totalCount: 3,
        pageInfo: { hasNextPage: hasNext, endCursor },
        nodes: numbers.map((number) => ({
          id: `PR_${number}`,
          number,
          title: 't',
          isDraft: false,
          createdAt: '2026-11-06T08:15:08Z',
          updatedAt: '2026-11-06T08:15:08Z',
          author: null,
          baseRefName: 'main',
          baseRefOid: 'b'.repeat(40),
          baseRef: null,
          headRefName: `pr-${number}`,
          headRefOid: 'c'.repeat(40),
          headRef: null,
          isCrossRepository: false,
          headRepositoryOwner: null,
          commits: { nodes: [] },
          stackEntry: null,
        })),
      },
      mergedPullRequests: { nodes: [] },
    },
  };
}

const repo = new RepoRef('o', 'r');

async function failure(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => undefined,
    (thrown: unknown) => thrown,
  );
}

test('files without a cursor to go on from stop', async () => {
  const { client: account, fetch } = client(
    synthetic([['PullRequest', filesAfter(null), prPage('a', ['one'], true, null)]]),
  );
  const error = await failure(pullRequestPaged(account, 'o', 'r', 2, 1));
  expect(error instanceof GithubError && error.detail.kind).toBe('inconsistent');
  expect(fetch.seen).toHaveLength(1);
});

test('a page of files that repeats stops the paging', async () => {
  const { client: account, fetch } = client(
    synthetic([
      ['PullRequest', filesAfter(null), prPage('a', ['one'], true, 'c1')],
      ['PullRequest', filesAfter('c1'), prPage('a', ['two'], true, 'c1')],
    ]),
  );
  const error = await failure(pullRequestPaged(account, 'o', 'r', 2, 1));
  expect(error instanceof GithubError && error.detail.kind).toBe('inconsistent');
  expect(fetch.seen).toHaveLength(2);
});

test('files are read again when a push lands between pages', async () => {
  const [old, next] = ['a'.repeat(40), 'd'.repeat(40)];
  const { client: account, fetch } = client(
    synthetic([
      ['PullRequest', filesAfter(null), prPage(old, ['one'], true, 'c1')],
      ['PullRequest', filesAfter(null), prPage(next, ['one-new'], true, 'c1')],
      ['PullRequest', filesAfter('c1'), prPage(next, ['two-new'], false, 'c2')],
    ]),
  );
  const pr = await pullRequestPaged(account, 'o', 'r', 2, 1);
  expect(pr.headRefOid).toBe(next);
  // Never the old head's first page with the new head's second.
  expect((pr.files?.nodes ?? []).map((file) => file?.path)).toEqual(['one-new', 'two-new']);
  expect(fetch.seen).toHaveLength(4);
});

test('open pull requests without a cursor to go on from stop', async () => {
  const { client: account } = client(
    synthetic([['OpenPullRequests', openAfter(null), openPage([3], true, null)]]),
  );
  const error = await failure(openPullRequestsPaged(account, repo, 1, RECENTLY_UPDATED_MERGED));
  expect(error instanceof GithubError && error.detail.kind).toBe('inconsistent');
});

test('open pull requests that repeat stop the paging', async () => {
  const { client: account, fetch } = client(
    synthetic([
      ['OpenPullRequests', openAfter(null), openPage([3], true, 'c1')],
      ['OpenPullRequests', openAfter('c1'), openPage([2], true, 'c1')],
    ]),
  );
  const error = await failure(openPullRequestsPaged(account, repo, 1, RECENTLY_UPDATED_MERGED));
  expect(error instanceof GithubError && error.detail.kind).toBe('inconsistent');
  expect(fetch.seen).toHaveLength(2);
});

test('null pull requests dont make the list look capped', async () => {
  // GitHub leaves out a pull request it can't show (a null node); the list isn't capped for it.
  const page = openPage([3, 2], false, 'c1');
  const nodes = unchecked<{ repository: { pullRequests: { nodes: Json[] } } }>(page).repository
    .pullRequests.nodes;
  nodes.push(null);
  const { client: account } = client(synthetic([['OpenPullRequests', openAfter(null), page]]));
  const list = await openPullRequestsPaged(account, repo, 1, RECENTLY_UPDATED_MERGED);
  expect(list.pullRequests).toHaveLength(2);
  expect(list.truncated).toBe(false);
});

/** One recorded GraphQL answer, with errors beside the data. */
function withErrors(data: Json, errors: Json): Replay {
  return new Replay('partial', [
    {
      request: {
        method: 'POST',
        url: 'https://api.github.com/graphql',
        operation: 'PullRequest',
        variables: filesAfter(null),
      },
      response: { status: 200, headers: {}, body: { data, errors } },
    },
  ]);
}

const RESTRICTION =
  'Although you appear to have the correct authorization credentials, the `acme` organization has enabled OAuth App access restrictions';

test('an error on a field that can be null keeps the rest', async () => {
  // A fork in an organization that restricts OAuth apps: GitHub nulls the head repository,
  // explains it, and returns the rest of the pull request.
  const page = prPage('a', ['one'], false, null);
  unchecked<{ repository: { pullRequest: { files: { totalCount: number } } } }>(
    page,
  ).repository.pullRequest.files.totalCount = 1;
  const { client: account } = client(
    withErrors(page, [
      {
        type: 'FORBIDDEN',
        path: ['repository', 'pullRequest', 'headRepository'],
        message: RESTRICTION,
      },
    ]),
  );
  const pr = await pullRequestPaged(account, 'o', 'r', 2, 1);
  expect(pr.number).toBe(2);
  expect(pr.headRepository).toBeNull();
});

test('an error on what was asked for is the error', async () => {
  // The pull request itself is forbidden: that's the answer, not a missing field.
  const { client: account } = client(
    withErrors({ repository: { pullRequest: null } }, [
      { type: 'FORBIDDEN', path: ['repository', 'pullRequest'], message: RESTRICTION },
    ]),
  );
  const error = await failure(pullRequestPaged(account, 'o', 'r', 2, 1));
  expect(error instanceof GithubError && error.detail.kind).toBe('oauthAppRestricted');
});
