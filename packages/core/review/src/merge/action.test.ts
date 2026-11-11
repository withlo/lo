import { expect, test } from 'vitest';

import { snapshot, viewer } from '../../test/snapshot.ts';
import type { AllowedMethods, MergeSnapshot } from '../merge.ts';
import { mergeAction, type MergeAction, type NotPossible } from './action.ts';

const ALL_METHODS: AllowedMethods = { merge: true, squash: true, rebase: true };

function ready(fields: Partial<MergeSnapshot> = {}): MergeSnapshot {
  return snapshot({
    mergeable: 'MERGEABLE',
    mergeState: 'CLEAN',
    methods: ALL_METHODS,
    preferredMethod: 'SQUASH',
    viewer: viewer({
      login: 'alice',
      canApprove: true,
      approvalCounts: true,
      canMerge: true,
      canEnableAutoMerge: true,
    }),
    ...fields,
  });
}

function withQueue(given: MergeSnapshot, position?: number): MergeSnapshot {
  return {
    ...given,
    queue: { required: true, method: 'SQUASH', inQueue: position !== undefined, position },
  };
}

function cannotMerge(given: MergeSnapshot): MergeSnapshot {
  return { ...given, viewer: { ...given.viewer, canMerge: false } };
}

function notPossible(reason: NotPossible): MergeAction {
  return { kind: 'notPossible', reason };
}

test('a pull request nothing blocks merges with the preferred method', () => {
  expect(mergeAction(ready())).toEqual({
    kind: 'merge',
    methods: ['MERGE', 'SQUASH', 'REBASE'],
    method: 'SQUASH',
  });
});

test('only the allowed methods are offered', () => {
  const mergeOnly = ready({ methods: { ...ALL_METHODS, rebase: false, squash: false } });

  expect(mergeAction(mergeOnly)).toEqual({ kind: 'merge', methods: ['MERGE'], method: 'MERGE' });
});

test('rebase is not offered when the base requires signed commits', () => {
  const signed = ready({ preferredMethod: 'REBASE', defaultMethod: 'MERGE', signedCommits: true });

  expect(mergeAction(signed)).toEqual({
    kind: 'merge',
    methods: ['MERGE', 'SQUASH'],
    method: 'MERGE',
  });
});

test('a base branch with a merge queue adds it to the queue', () => {
  expect(mergeAction(withQueue(ready()))).toEqual({ kind: 'enqueue', method: 'SQUASH' });
});

test('the queue chooses the method whatever the repository allows', () => {
  const none = { ...withQueue(ready()), methods: { merge: false, squash: false, rebase: false } };

  expect(mergeAction(none)).toEqual({ kind: 'enqueue', method: 'SQUASH' });
});

test('a pull request behind its base still joins the queue', () => {
  const behind = { ...withQueue(ready()), mergeState: 'BEHIND' } as const;

  expect(mergeAction(behind)).toEqual({ kind: 'enqueue', method: 'SQUASH' });
});

test('a pull request in the queue is not added again', () => {
  expect(mergeAction(withQueue(ready(), 2))).toEqual(notPossible({ kind: 'queued', position: 2 }));
});

test('whether it is queued is githubs flag not its entry', () => {
  const queued = withQueue(ready());
  const inQueueWithoutAnEntry = { ...queued, queue: { ...queued.queue, inQueue: true } };
  const entered = withQueue(ready(), 2);
  const entryWithoutTheFlag = { ...entered, queue: { ...entered.queue, inQueue: false } };

  expect(mergeAction(inQueueWithoutAnEntry)).toEqual(
    notPossible({ kind: 'queued', position: undefined }),
  );
  expect(mergeAction(entryWithoutTheFlag)).toEqual({ kind: 'enqueue', method: 'SQUASH' });
});

test('a blocked pull request neither merges nor joins the queue', () => {
  const running = ready({
    mergeState: 'BLOCKED',
    requiredChecks: [{ name: 'test', state: 'running', url: undefined }],
  });

  expect(mergeAction(running)).toEqual(notPossible({ kind: 'blocked' }));
  expect(mergeAction(withQueue(running))).toEqual(notPossible({ kind: 'blocked' }));
});

test('a merged or closed pull request does not merge', () => {
  expect(mergeAction(ready({ state: 'MERGED' }))).toEqual(notPossible({ kind: 'merged' }));
  expect(mergeAction(ready({ state: 'CLOSED' }))).toEqual(notPossible({ kind: 'closed' }));
});

test('you need permission to merge', () => {
  const reader = cannotMerge(ready());

  expect(mergeAction(reader)).toEqual(notPossible({ kind: 'noPermission' }));
  expect(mergeAction(withQueue(reader))).toEqual(notPossible({ kind: 'noPermission' }));
});

test('a blocked pull request you cannot merge is blocked', () => {
  expect(mergeAction(cannotMerge(ready({ draft: true })))).toEqual(
    notPossible({ kind: 'blocked' }),
  );
});

test('a repository allowing no method cannot merge', () => {
  const none = ready({ methods: { merge: false, squash: false, rebase: false } });

  expect(mergeAction(none)).toEqual(notPossible({ kind: 'noMethod' }));
});
