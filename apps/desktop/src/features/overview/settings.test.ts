// The lists kept per repo, as `overview.collapsed` is: how Lo reads them, what it says of what it
// can't, and how each switch and each button in Settings writes them.

import { describe, expect, it } from 'vitest';

import {
  addToEvery,
  collapsed,
  entryKey,
  everywhere,
  ignored,
  inRepo,
  listIn,
  readScoped,
  removeFrom,
  resetRepo,
  setEverywhere,
  setInRepo,
  type ScopedValue,
} from './settings.ts';

const KEY = 'overview.collapsed';

const read = (value: ScopedValue) => readScoped(value, KEY);

describe('a list kept per repo', () => {
  it('is every repo’s, with each repo’s own in its place there, a repo matched in any case', () => {
    const { scoped, problems } = read({
      '*': ['Testing'],
      'rozed-dev/e2e': ['Testing', 'Rollout'],
    });
    expect(problems).toEqual([]);
    expect(listIn(scoped, 'rozed-dev/e2e')).toEqual(['Testing', 'Rollout']);
    expect(listIn(scoped, 'Rozed-Dev/E2E')).toEqual(['Testing', 'Rollout']);
    expect(listIn(scoped, 'fieldwork/atlas-api')).toEqual(['Testing']);
    expect(read({}).scoped).toEqual({ every: [], repos: [] });
  });

  it('matches an entry as plain text, ignoring case and runs of spaces', () => {
    expect(entryKey('  How   it\tWORKS ')).toBe('how it works');
    const { scoped } = read({ '*': ['how  it works'] });
    expect(inRepo(scoped, 'rozed-dev/e2e', 'How it works')).toBe(true);
    expect(inRepo(scoped, 'rozed-dev/e2e', 'How it went')).toBe(false);
  });

  it('ignores what it can’t read, says so in words, and reads the rest', () => {
    const { scoped, problems } = read({
      '*': ['Testing', 4, '  ', 'x'.repeat(201)],
      'not a repo': ['Rollout'],
      'rozed-dev/e2e': 'Testing',
      'rozed-dev/lo': ['Rollout'],
    });
    expect(scoped).toEqual({
      every: ['Testing'],
      repos: [{ repo: 'rozed-dev/lo', entries: ['Rollout'] }],
    });
    expect(problems).toEqual([
      'overview.collapsed’s entry 2 under “*” isn’t text, so Lo ignores it.',
      'overview.collapsed’s entry 3 under “*” is empty, so Lo ignores it.',
      'overview.collapsed’s entry 4 under “*” is longer than 200 characters, so Lo ignores it.',
      'overview.collapsed has “not a repo”, which isn’t a repo, so Lo ignores it.',
      'overview.collapsed’s “rozed-dev/e2e” isn’t a list, so Lo ignores it.',
    ]);
    // Past five, the rest are counted.
    const many = read({ '*': [1, 2, 3, 4, 5, 6, 7] });
    expect(many.problems).toHaveLength(6);
    expect(many.problems.at(-1)).toBe('overview.collapsed has 2 more entries Lo ignores.');
    // Settings reports them as the setting's own.
    expect(collapsed.problems?.({ '*': [1] })).toEqual([
      'overview.collapsed’s entry 1 under “*” isn’t text, so Lo ignores it.',
    ]);
  });
});

describe('“Collapse in this repo”', () => {
  it('makes the repo’s list its own as it turns on, starting from every repo’s', () => {
    expect(setInRepo({ '*': ['Testing'] }, 'rozed-dev/e2e', 'Rollout', true)).toEqual({
      '*': ['Testing'],
      'rozed-dev/e2e': ['Testing', 'Rollout'],
    });
    expect(setInRepo({}, 'rozed-dev/e2e', 'Rollout', true)).toEqual({
      'rozed-dev/e2e': ['Rollout'],
    });
  });

  it('turned off, takes the heading out of the repo’s list, which goes once it’s every repo’s', () => {
    const value = { '*': ['Testing'], 'rozed-dev/e2e': ['Testing', 'Rollout'] };
    expect(setInRepo(value, 'rozed-dev/e2e', 'rollout', false)).toEqual({ '*': ['Testing'] });
    // Every repo's heading, off in one repo only.
    expect(setInRepo({ '*': ['Testing'] }, 'rozed-dev/e2e', 'Testing', false)).toEqual({
      '*': ['Testing'],
      'rozed-dev/e2e': [],
    });
  });

  it('writes the repo’s list under the name the file has for it, and keeps what Lo can’t read', () => {
    const value = { '*': [], 'Rozed-Dev/E2E': ['Testing', 7], other: true };
    expect(setInRepo(value, 'rozed-dev/e2e', 'Rollout', true)).toEqual({
      '*': [],
      'Rozed-Dev/E2E': ['Testing', 7, 'Rollout'],
      other: true,
    });
  });
});

describe('“Collapse in every repo”', () => {
  it('adds the heading to every repo’s list and each repo’s own, once', () => {
    const value = { 'rozed-dev/e2e': ['Rollout'], '*': ['Testing'] };
    const on = setEverywhere(value, 'Rollout', true);
    expect(on).toEqual({ '*': ['Testing', 'Rollout'], 'rozed-dev/e2e': ['Rollout'] });
    // Every repo's list goes first in the file.
    expect(Object.keys(on)).toEqual(['*', 'rozed-dev/e2e']);
    expect(everywhere(read(on).scoped, 'rollout')).toBe(true);
  });

  it('is on only while every list has the heading', () => {
    const { scoped } = read({ '*': ['Testing'], 'rozed-dev/e2e': [] });
    expect(everywhere(scoped, 'Testing')).toBe(false);
    expect(inRepo(scoped, 'fieldwork/atlas-api', 'Testing')).toBe(true);
  });

  it('turned off, takes the heading out of every list', () => {
    const value = { '*': ['Testing', 'Rollout'], 'rozed-dev/e2e': ['Rollout', 'Testing'] };
    expect(setEverywhere(value, 'testing', false)).toEqual({
      '*': ['Rollout'],
      'rozed-dev/e2e': ['Rollout'],
    });
  });
});

describe('a term’s other names', () => {
  it('go from the list as its switch writes its name, so a term is in each list once', () => {
    const value = { '*': ['buckets'], 'rozed-dev/e2e': ['Token bucket', 'Lease'] };
    expect(setInRepo(value, 'rozed-dev/e2e', 'Bucket', true, ['buckets', 'token bucket'])).toEqual({
      '*': ['buckets'],
      'rozed-dev/e2e': ['Lease', 'Bucket'],
    });
    expect(setInRepo(value, 'rozed-dev/e2e', 'Bucket', false, ['Token  bucket'])).toEqual({
      '*': ['buckets'],
      'rozed-dev/e2e': ['Lease'],
    });
    expect(setEverywhere(value, 'Bucket', false, ['buckets', 'token bucket'])).toEqual({
      '*': [],
      'rozed-dev/e2e': ['Lease'],
    });
  });

  it('are kept in a setting of their own, whose problems name it', () => {
    expect(ignored.key).toBe('overview.ignored');
    expect(ignored.fallback).toEqual({});
    expect(ignored.problems?.({ '*': [7] })).toEqual([
      'overview.ignored’s entry 1 under “*” isn’t text, so Lo ignores it.',
    ]);
  });
});

describe('Settings’ buttons', () => {
  it('add to every repo’s list, and remove from any list, a repo’s going once it’s every repo’s', () => {
    expect(addToEvery({ 'rozed-dev/e2e': [] }, ' Rollout ')).toEqual({
      '*': ['Rollout'],
      'rozed-dev/e2e': [],
    });
    const value = { '*': ['Testing'], 'rozed-dev/e2e': ['Testing', 'Rollout'] };
    expect(removeFrom(value, undefined, 'testing')).toEqual({
      '*': [],
      'rozed-dev/e2e': ['Testing', 'Rollout'],
    });
    expect(removeFrom(value, 'rozed-dev/e2e', 'rollout')).toEqual({ '*': ['Testing'] });
  });

  it('reset a repo, whose own list goes', () => {
    const value = { '*': ['Testing'], 'rozed-dev/e2e': ['Rollout'] };
    expect(resetRepo(value, 'Rozed-dev/e2e')).toEqual({ '*': ['Testing'] });
    expect(resetRepo(value, 'fieldwork/atlas-api')).toBe(value);
  });
});
