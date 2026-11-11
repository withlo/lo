import { expect, test } from 'vitest';

import { snapshot, viewer } from '../../test/snapshot.ts';
import type { CheckState, MergeSnapshot } from '../merge.ts';
import type { Blocker } from './blockers.ts';
import { mergeStatus } from './status.ts';

function ready(fields: Partial<MergeSnapshot> = {}): MergeSnapshot {
  return snapshot({ mergeable: 'MERGEABLE', mergeState: 'CLEAN', ...fields });
}

function checks(states: readonly (readonly [string, CheckState])[]): MergeSnapshot {
  return ready({
    mergeState: 'BLOCKED',
    requiredChecks: states.map(([name, state]) => ({ name, state, url: undefined })),
    seesEveryRule: true,
  });
}

function withAutoMerge(given: MergeSnapshot): MergeSnapshot {
  return { ...given, autoMerge: { method: 'SQUASH', enabledBy: 'bob' } };
}

function blocker(name: string, state: CheckState): Blocker {
  return { kind: 'check', check: { name, state, url: undefined } };
}

test('a merged or closed pull request says so', () => {
  expect(mergeStatus(ready({ state: 'MERGED' }))).toEqual({ kind: 'merged' });
  expect(mergeStatus(ready({ state: 'CLOSED' }))).toEqual({ kind: 'closed' });
});

test('a queued pull request gives its position', () => {
  const queued = ready({
    queue: { required: true, method: undefined, inQueue: true, position: 4 },
  });

  expect(mergeStatus(queued)).toEqual({ kind: 'queued', position: 4 });
});

test('a queued pull request is queued without an entry to read', () => {
  const queued = {
    ...checks([['test', 'running']]),
    queue: { required: true, method: undefined, inQueue: true, position: undefined },
  };

  expect(mergeStatus(queued)).toEqual({ kind: 'queued', position: undefined });
});

test('a pull request nothing blocks is ready whoever is looking', () => {
  const anyone = ready({ viewer: viewer({ canMerge: false }) });

  expect(mergeStatus(anyone)).toEqual({ kind: 'ready' });
});

test('a pull request only waiting is waiting', () => {
  expect(mergeStatus(checks([['test', 'running']]))).toEqual({
    kind: 'waiting',
    blockers: [blocker('test', 'running')],
    autoMerge: false,
    partial: false,
  });
});

test('a waiting pull request says when lo may not see every rule', () => {
  const unsure = { ...checks([['test', 'running']]), seesEveryRule: false };

  expect(mergeStatus(unsure)).toEqual({
    kind: 'waiting',
    blockers: [blocker('test', 'running')],
    autoMerge: false,
    partial: true,
  });
});

test('a waiting pull request says whether auto merge is on', () => {
  expect(mergeStatus(withAutoMerge(checks([['test', 'running']])))).toEqual({
    kind: 'waiting',
    blockers: [blocker('test', 'running')],
    autoMerge: true,
    partial: false,
  });
});

test('a pull request waiting on a check nothing will report is blocked', () => {
  expect(mergeStatus(checks([['test', 'missing']]))).toEqual({
    kind: 'blocked',
    blockers: [{ kind: 'notReported', check: { name: 'test', state: 'missing', url: undefined } }],
    autoMerge: false,
    partial: false,
  });
});

test('a pull request something else blocks is blocked', () => {
  const failed = withAutoMerge(
    checks([
      ['test', 'running'],
      ['build', 'failed'],
    ]),
  );

  expect(mergeStatus(failed)).toEqual({
    kind: 'blocked',
    blockers: [blocker('build', 'failed'), blocker('test', 'running')],
    autoMerge: true,
    partial: false,
  });
});
