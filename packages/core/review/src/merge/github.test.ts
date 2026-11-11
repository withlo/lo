import { expect, test } from 'vitest';

import { githubEnum, UnknownValue } from '../enums.ts';
import {
  CHECK_CONCLUSIONS,
  CHECK_STATUSES,
  MERGE_METHODS,
  MERGE_STATE_STATUSES,
  MERGEABLE_STATES,
  mergeableFromRest,
  PULL_REQUEST_STATES,
  REVIEW_DECISIONS,
  REVIEW_STATES,
  STATUS_STATES,
} from './github.ts';

test('values parse from their graphql names', () => {
  expect(githubEnum(MERGE_STATE_STATUSES, 'HAS_HOOKS')).toBe('HAS_HOOKS');
  expect(githubEnum(REVIEW_DECISIONS, 'CHANGES_REQUESTED')).toBe('CHANGES_REQUESTED');
  expect(githubEnum(REVIEW_STATES, 'CHANGES_REQUESTED')).toBe('CHANGES_REQUESTED');
  expect(githubEnum(MERGEABLE_STATES, 'CONFLICTING')).toBe('CONFLICTING');
  expect(githubEnum(PULL_REQUEST_STATES, 'MERGED')).toBe('MERGED');
  expect(githubEnum(MERGE_METHODS, 'SQUASH')).toBe('SQUASH');
  expect(githubEnum(CHECK_STATUSES, 'IN_PROGRESS')).toBe('IN_PROGRESS');
  expect(githubEnum(CHECK_CONCLUSIONS, 'STARTUP_FAILURE')).toBe('STARTUP_FAILURE');
  expect(githubEnum(STATUS_STATES, 'EXPECTED')).toBe('EXPECTED');
});

test('values parse from their rest names', () => {
  expect(githubEnum(MERGE_STATE_STATUSES, 'has_hooks')).toBe('HAS_HOOKS');
  expect(githubEnum(PULL_REQUEST_STATES, 'open')).toBe('OPEN');
  expect(githubEnum(MERGE_METHODS, 'rebase')).toBe('REBASE');
  expect(githubEnum(CHECK_CONCLUSIONS, 'timed_out')).toBe('TIMED_OUT');
  expect(githubEnum(STATUS_STATES, 'error')).toBe('ERROR');
});

test('an unknown value is an error', () => {
  expect(() => githubEnum(MERGE_STATE_STATUSES, 'MERGE_QUEUED')).toThrow(
    new UnknownValue('MERGE_QUEUED'),
  );
  expect(() => githubEnum(MERGE_METHODS, '')).toThrow(new UnknownValue(''));
});

test('values give back their graphql names', () => {
  expect(githubEnum(MERGE_STATE_STATUSES, 'HAS_HOOKS')).toBe('HAS_HOOKS');
  expect(githubEnum(MERGE_METHODS, 'squash')).toBe('SQUASH');
  expect(githubEnum(CHECK_CONCLUSIONS, 'timed_out')).toBe('TIMED_OUT');
});

test('rest mergeable maps to the graphql state', () => {
  expect(mergeableFromRest(true)).toBe('MERGEABLE');
  expect(mergeableFromRest(false)).toBe('CONFLICTING');
  expect(mergeableFromRest(null)).toBe('UNKNOWN');
});
