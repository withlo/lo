import { unchecked } from '@lo/github';
import { expect, test } from 'vitest';

import { snapshot } from '../test/snapshot.ts';
import {
  allowedMethods,
  allows,
  checkRunState,
  chooseMethod,
  commitStatusState,
  methodList,
  pickedMethod,
  type AllowedMethods,
} from './merge.ts';
import type { CheckConclusion, CheckStatus, MergeMethod, StatusState } from './merge/github.ts';

const NONE: AllowedMethods = { merge: false, squash: false, rebase: false };

test('a completed check run passes on success neutral or skipped', () => {
  const conclusions: CheckConclusion[] = ['SUCCESS', 'NEUTRAL', 'SKIPPED'];
  const misread = conclusions.filter(
    (conclusion) => checkRunState('COMPLETED', conclusion) !== 'passed',
  );

  expect(misread).toEqual([]);
});

test('a completed check run fails on any other conclusion', () => {
  const conclusions: (CheckConclusion | undefined)[] = [
    'FAILURE',
    'CANCELLED',
    'TIMED_OUT',
    'ACTION_REQUIRED',
    'STARTUP_FAILURE',
    'STALE',
    undefined,
  ];
  const misread = conclusions.filter(
    (conclusion) => checkRunState('COMPLETED', conclusion) !== 'failed',
  );

  expect(misread).toEqual([]);
});

test('a check run that has not completed is running', () => {
  const statuses: CheckStatus[] = ['REQUESTED', 'QUEUED', 'PENDING', 'IN_PROGRESS'];
  const misread = statuses.filter((status) => checkRunState(status, undefined) !== 'running');

  expect(misread).toEqual([]);
});

test('a check run waiting on a deployment awaits approval', () => {
  expect(checkRunState('WAITING', undefined)).toBe('awaitingApproval');
});

test('a commit status maps to a check state', () => {
  expect(commitStatusState('SUCCESS')).toBe('passed');
  expect(commitStatusState('FAILURE')).toBe('failed');
  expect(commitStatusState('ERROR')).toBe('failed');
  expect(commitStatusState('PENDING')).toBe('running');
  expect(commitStatusState('EXPECTED')).toBe('missing');
});

test('allowed methods are listed in the merge buttons order', () => {
  const methods: AllowedMethods = { merge: true, squash: false, rebase: true };

  expect(methodList(methods)).toEqual(['MERGE', 'REBASE']);
  expect(allows(methods, 'SQUASH')).toBe(false);
  expect(methodList(NONE)).toEqual([]);
});

test('the preferred method is chosen when allowed', () => {
  const methods: AllowedMethods = { merge: true, squash: true, rebase: false };

  expect(chooseMethod(methods, ['SQUASH'])).toBe('SQUASH');
  expect(chooseMethod(methods, ['REBASE', 'SQUASH'])).toBe('SQUASH');
  expect(chooseMethod(methods, ['REBASE'])).toBe('MERGE');
  expect(chooseMethod(methods, [])).toBe('MERGE');
  expect(chooseMethod(NONE, [])).toBeUndefined();
});

test('rebase is not offered when the base requires signed commits', () => {
  const signed = snapshot({
    methods: { merge: false, squash: true, rebase: true },
    signedCommits: true,
  });

  expect(methodList(allowedMethods(signed))).toEqual(['SQUASH']);
});

test('the method is the remembered one then githubs default for you', () => {
  const remembered = snapshot({
    methods: { merge: true, squash: true, rebase: false },
    preferredMethod: 'REBASE',
    defaultMethod: 'SQUASH',
  });
  const rememberedAllowed = { ...remembered, preferredMethod: 'MERGE' as const };

  expect(pickedMethod(remembered)).toBe('SQUASH');
  expect(pickedMethod(rememberedAllowed)).toBe('MERGE');
});

test('a method or status lo doesnt know is never allowed or passing', () => {
  const all: AllowedMethods = { merge: true, squash: true, rebase: true };

  expect(allows(all, unchecked<MergeMethod>('OCTOPUS'))).toBe(false);
  expect(commitStatusState(unchecked<StatusState>('SOMETHING_NEW'))).toBe('running');
});
