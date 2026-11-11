import { Replay, replayFetch } from '@lo/testing';
import { expect, test } from 'vitest';

import { GithubClient } from './client.ts';
import { GithubError, type GithubErrorDetail } from './errors.ts';
import type { PullRequestMergeMethod } from './generated/graphql.ts';
import {
  adminOverride,
  describeMergeRefusal,
  directMerge,
  enableAutoMerge,
  enqueue,
  isFullSha,
  isRefusal,
  isStackMerge,
  knownMethod,
  mergeAsyncBody,
  mergeRefusal,
  mergeRefusalFrom,
  queueMerge,
  readAsyncMerge,
  withCommit,
  withLayersBelow,
  type MergeRefusal,
  type MergeRequest,
} from './merge-writes.ts';
import { readBehind } from './poll/poller.ts';
import { PullRef } from './refs.ts';
import { Token } from './token.ts';

const HEAD = '1c320a8fdea55a1322333aa89b2fe7a52bd49e20';

function graphql(type: string, message: string): GithubErrorDetail {
  return { kind: 'graphql', errors: [{ message, type, path: [] }] };
}

function api(status: number, message: string, errors: unknown[]): GithubErrorDetail {
  return { kind: 'api', status, message, errors };
}

/** The refusal GitHub's `detail` is, or a failure if it isn't one. */
function refusal(detail: GithubErrorDetail): MergeRefusal {
  const refused = mergeRefusal(detail);
  if (refused === undefined) throw new Error(`not refused: ${JSON.stringify(detail)}`);
  return refused;
}

/** The request `made` is, or a failure if it was refused. */
function requested(made: MergeRequest | { refusal: string }): MergeRequest {
  if (isRefusal(made)) throw new Error(`refused: ${JSON.stringify(made)}`);
  return made;
}

function direct(sha: string, method: PullRequestMergeMethod): MergeRequest {
  return requested(directMerge(sha, method));
}

test('the merge body carries the head and the action', () => {
  const request = withCommit(direct(HEAD, 'SQUASH'), 'Title', undefined);
  expect(mergeAsyncBody(request)).toBe(
    `{"sha":"${HEAD}","merge_method":"squash","merge_action":"direct_merge","commit_title":"Title"}`,
  );
  // A queue picks its own method and message, so they aren't sent.
  const queue = withCommit(requested(queueMerge(HEAD)), 'Title', undefined);
  expect(mergeAsyncBody(queue)).toBe(`{"sha":"${HEAD}","merge_action":"merge_queue"}`);
});

test('the admin override sends bypass rules', () => {
  const request = requested(adminOverride(HEAD, 'MERGE'));
  expect(request.bypassRules).toBe(true);
  expect(mergeAsyncBody(request)).toBe(
    `{"sha":"${HEAD}","merge_method":"merge","merge_action":"direct_merge","bypass_rules":true}`,
  );
});

test('a merge is made only with full heads', () => {
  // GitHub reads a missing head as whatever the head is then, which nobody saw.
  for (const sha of ['', 'c0ffee', HEAD.slice(0, 39), `${HEAD}0`, HEAD.replaceAll('c', 'x')]) {
    expect(directMerge(sha, 'SQUASH')).toEqual({ refusal: 'notACommit', sha });
    expect(queueMerge(sha)).toEqual({ refusal: 'notACommit', sha });
    expect(adminOverride(sha, 'MERGE')).toEqual({ refusal: 'notACommit', sha });
  }
  // A SHA-256 repository's.
  expect(isFullSha('a'.repeat(64))).toBe(true);
  const request = direct(HEAD, 'SQUASH');
  expect(withLayersBelow(request, [{ pr: 45, head: '' }])).toEqual({
    refusal: 'notACommit',
    sha: '',
  });
  const stack = requested(withLayersBelow(request, [{ pr: 45, head: HEAD }]));
  expect(isStackMerge(stack)).toBe(true);
  expect(stack.layersBelow).toEqual([{ pr: 45, head: HEAD }]);
  // Every request names its way in: there's no `default`.
  for (const named of [direct(HEAD, 'SQUASH'), requested(queueMerge(HEAD))]) {
    expect(mergeAsyncBody(named)).not.toContain('"default"');
  }
});

test('an admin override merges no layer below', () => {
  // GitHub lets a merge past the rules take only a stack's bottom layer.
  const admin = requested(adminOverride(HEAD, 'MERGE'));
  expect(withLayersBelow(admin, [{ pr: 45, head: HEAD }])).toEqual({
    refusal: 'adminOverrideLayers',
  });
  // The bottom layer has none to name.
  expect(withLayersBelow(admin, [])).toEqual(admin);
});

test('a read behind a refusal keeps its kind', () => {
  const offline: GithubErrorDetail = {
    kind: 'network',
    failure: 'offline',
    message: 'connection refused',
  };
  expect(new GithubError(offline).isUnreachable()).toBe(true);
  const unchecked: MergeRefusal = { refusal: 'unchecked', read: offline };
  const read = readBehind(unchecked);
  expect(read).toEqual(offline);
  expect(read && new GithubError(read).isUnreachable()).toBe(true);
  // The merge itself was never sent: a refusal is a value Lo answered with, not an error that
  // may have posted.
  expect(isRefusal(unchecked)).toBe(true);
  expect(unchecked).not.toBeInstanceOf(Error);
  expect(describeMergeRefusal(unchecked)).toMatch(
    /^Lo couldn't read the pull request's stack, so it didn't merge: /,
  );
  // Any other refusal is its own: it holds no read.
  expect(readBehind({ refusal: 'draft' })).toBeUndefined();
});

test('a queue or auto merge write with a head that isnt a commit isnt sent', async () => {
  const fetch = replayFetch(new Replay('none', []));
  const client = new GithubClient({ fetch, token: new Token('gho_FAKE') });
  const pull = new PullRef('rozed-dev', 'e2e', 47);

  expect(await enqueue(client, pull, 'PR_47', '', false)).toEqual({
    refusal: 'notACommit',
    sha: '',
  });
  const auto = { expectedHead: '', method: 'SQUASH' } as const;
  expect(await enableAutoMerge(client, pull, 'PR_47', auto)).toEqual({
    refusal: 'notACommit',
    sha: '',
  });
  // Nothing was sent, not even the stack lookup that comes first.
  expect(fetch.seen).toHaveLength(0);
  // A full SHA is the head they go on with.
  expect(isFullSha(HEAD)).toBe(true);
});

test('an unknown status is kept and never merged', () => {
  const answer = readAsyncMerge({ status: 'rolling', details: {} });
  expect(answer.status).toEqual({ unknown: 'rolling' });
});

test('an auto merge method lo doesnt know is none', () => {
  expect(knownMethod('SQUASH')).toBe('SQUASH');
  expect(knownMethod('FAST_FORWARD')).toBeUndefined();
  expect(knownMethod('')).toBeUndefined();
});

test('other errors are left as they were', () => {
  const server = api(502, 'Bad Gateway', []);
  expect(mergeRefusal(server)).toBeUndefined();
  const notFound: GithubErrorDetail = { kind: 'notFound', message: 'Not Found' };
  expect(mergeRefusal(notFound)).toBeUndefined();
  const timeout: GithubErrorDetail = {
    kind: 'graphql',
    errors: [{ message: 'Something went wrong while executing your query.', path: [] }],
  };
  expect(mergeRefusal(timeout)).toBeUndefined();
  expect(new GithubError(timeout).mayHavePosted()).toBe(true);
});

test('permission and a busy stack are their own refusals', () => {
  expect(refusal(graphql('FORBIDDEN', "Viewer can't jump the queue"))).toEqual({
    refusal: 'noPermission',
    message: "Viewer can't jump the queue",
  });
  expect(refusal(api(409, 'Stack is currently being modified', []))).toEqual({
    refusal: 'stackBusy',
  });
  const missing = [{ resource: 'Stack', field: 'pull_requests', code: 'missing', value: [123] }];
  expect(refusal(api(422, 'Validation Failed', missing))).toEqual({
    refusal: 'other',
    message: 'pull_requests: missing [123]',
  });
});

test('a 409 lo cant read keeps githubs words', () => {
  // Only the Stacks API's own words mean a busy stack.
  expect(refusal(api(409, 'Something else', []))).toEqual({
    refusal: 'other',
    message: 'Something else',
  });
});

// GitHub's words, from the `merge_writes_e2e_*` recordings, unless they say otherwise.

test('githubs refusals are sorted by their words', () => {
  const cases: [string, MergeRefusal][] = [
    ['Pull request head branch was modified.', { refusal: 'headMoved' }],
    [
      'Failed to add PR #36: expected head oid does not match the current head oid',
      { refusal: 'headMoved' },
    ],
    ['Pull request is in draft.', { refusal: 'draft' }],
    ['Pull request is closed.', { refusal: 'closed' }],
    ['Pull Request has merge conflicts', { refusal: 'conflict' }],
    ['Auto merge is not allowed for this repository', { refusal: 'autoMergeNotAllowed' }],
    ["No merge queue found for branch 'e9b/base'", { refusal: 'noMergeQueue' }],
    [
      'Cannot perform a merge queue merge for a branch with no merge queue',
      { refusal: 'noMergeQueue' },
    ],
    [
      "Pull requests must form a stack, where each PR's base ref is the previous PR's head ref",
      { refusal: 'notAChain' },
    ],
    // `gh`'s handling of GitHub's answer, not recorded yet.
    ['Pull request Pull request is in clean status', { refusal: 'canMergeNow' }],
    // GitHub's documented answers.
    ['Pull request is already merged.', { refusal: 'merged' }],
    ['Merge conflict: the pull request could not be merged.', { refusal: 'conflict' }],
    ['Stack is currently being modified', { refusal: 'stackBusy' }],
  ];
  for (const [message, expected] of cases) {
    expect([message, mergeRefusalFrom(message)]).toEqual([message, expected]);
  }
  const rebase =
    "Stack needs to be rebased: PR #57's branch is not a linear descendant of PR #56's branch.";
  expect(mergeRefusalFrom(rebase)).toEqual({ refusal: 'stackNeedsRebase', message: rebase });
  for (const stacked of [
    'Pull requests #45, #46 are already part of a stack',
    'Pull request #45 is already part of a stack',
  ]) {
    expect(mergeRefusalFrom(stacked)).toEqual({ refusal: 'alreadyStacked', message: stacked });
  }
});

test('rule violations list each rule', () => {
  const message =
    'Repository rule violations found\n\nAt least 1 approving review is required by reviewers with write access.\n\nRequired status check "ci" is failing.\n\n';
  expect(mergeRefusalFrom(message)).toEqual({
    refusal: 'rules',
    rules: [
      'At least 1 approving review is required by reviewers with write access.',
      'Required status check "ci" is failing.',
    ],
  });
  // On one line, after a colon.
  expect(
    mergeRefusalFrom(
      'Repository rule violations found: Changes must be made through the merge queue',
    ),
  ).toEqual({ refusal: 'rules', rules: ['Changes must be made through the merge queue'] });
});

test('a title or a branch in githubs words decides nothing', () => {
  // A dequeue of a pull request that isn't queued names it by its title, which GitHub's Revert
  // button makes `Revert "<title>"`, with quotes inside.
  for (const message of [
    'Failed to remove PR #36 "E4: for the queue, ci fails in the queue"',
    'Failed to remove PR #29 "E4: a draft, with a merge conflict"',
    'Failed to remove PR #36 "Revert "Fix merge conflict""',
    'Failed to remove PR #36 "Revert "Pass the expected head""',
    'Failed to remove PR #36 "Revert "Skip PRs that is closed""',
    'Failed to remove PR #36 "Revert "a "b" c is in draft""',
    'Failed to add PR #36 "Revert "Pull request head branch was modified""',
    'Failed to remove PR #36: "Revert "Pull request is closed"" isn\'t queued',
  ]) {
    expect(mergeRefusalFrom(message)).toEqual({ refusal: 'other', message });
  }
  // A branch's name comes after GitHub's fixed words.
  expect(mergeRefusalFrom("No merge queue found for branch 'e4/draft'")).toEqual({
    refusal: 'noMergeQueue',
  });
  // A queue's reason after the number and its colon is GitHub's own.
  expect(mergeRefusalFrom('Failed to add PR #7: Pull request is in draft.')).toEqual({
    refusal: 'draft',
  });
});

test('a refusal reads as a sentence the ui can show', () => {
  expect(describeMergeRefusal({ refusal: 'headMoved' })).toBe(
    'Someone pushed to the pull request since Lo showed it',
  );
  expect(describeMergeRefusal({ refusal: 'layerMoved', pr: 45, now: HEAD })).toBe(
    'Someone pushed to #45, a layer below, since Lo showed it',
  );
  // A refusal is a value, not an error, so nothing about it may have posted.
  expect(isRefusal({ refusal: 'headMoved' })).toBe(true);
});
