// The trusted entries as the settings file holds them: each read whole, or reported and ignored,
// never half read.

import { describe, expect, it } from 'vitest';

import { fileEntry, readEntry, readTrusted, trusted } from './settings.ts';

const REPO = { repo: 'rozed-dev/e2e', id: 'R_kgDOVleUfQ', at: '2026-11-15T09:12:44.000Z' };
const PULL = {
  repo: 'rozed-dev/e2e',
  id: 'R_kgDOVleUfQ',
  pull: 97,
  from: 'rozed-bot/e2e',
  fromId: 'R_kgDOVvlr6A',
  at: '2026-11-15T09:20:03.000Z',
};

describe('the trusted entries', () => {
  it('reads a repository’s entry and a pull request’s, and writes them back as they were', () => {
    const { entries, problems } = readTrusted([REPO, PULL]);
    expect(entries).toEqual([
      { kind: 'repo', ...REPO },
      { kind: 'pull', ...PULL },
    ]);
    expect(problems).toEqual([]);
    expect(entries.map(fileEntry)).toEqual([REPO, PULL]);
  });

  it('reads an entry written by hand without when it was trusted', () => {
    const { at: _at, ...plain } = REPO;
    expect(readEntry(plain)).toEqual({ kind: 'repo', ...plain });
    expect(fileEntry({ kind: 'repo', ...plain })).toEqual(plain);
  });

  it('reports and ignores an entry without an id, keeping the rest', () => {
    const { at: _at, id: _id, ...noId } = REPO;
    const { entries, problems } = readTrusted([noId, PULL]);
    expect(entries).toEqual([{ kind: 'pull', ...PULL }]);
    expect(problems).toEqual([
      'code.trusted’s entry 1 (rozed-dev/e2e) has no id, which Lo checks the repository by, so Lo ignores it.',
    ]);
  });

  it('never reads a pull request’s entry with a key misspelled as the whole repository', () => {
    const { pull, ...rest } = PULL;
    const { entries, problems } = readTrusted([{ ...rest, number: pull }]);
    expect(entries).toEqual([]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('number');
    // A repository's entry with anything more isn't one either.
    expect(readEntry({ ...REPO, pull: 97 })).toBeUndefined();
    expect(readEntry({ ...REPO, extra: true })).toBeUndefined();
  });

  it('ignores entries that aren’t objects, or name what GitHub couldn’t', () => {
    const { entries, problems } = readTrusted([
      'rozed-dev/e2e',
      null,
      [REPO],
      { ...REPO, repo: 'rozed-dev/..' },
      { ...REPO, repo: '-rozed/e2e' },
      { ...REPO, id: 'R kgDO' },
      { ...PULL, pull: 0 },
      { ...REPO, at: 'yesterday' },
    ]);
    expect(entries).toEqual([]);
    expect(problems).toHaveLength(6);
    expect(problems[0]).toBe('code.trusted’s entry 1 isn’t an object, so Lo ignores it.');
    expect(problems[5]).toBe('Lo ignores 3 more entries of code.trusted.');
  });

  it('holds thousands of entries, far more than anyone trusts', () => {
    const many = Array.from({ length: 5000 }, (_, at) => ({
      ...REPO,
      repo: `rozed-dev/e2e-${at}`,
    }));
    expect(trusted.schema.safeParse(many).success).toBe(true);
    expect(readTrusted(many).entries).toHaveLength(5000);
  });

  it('is a setting the window may only read, reporting what it ignores', () => {
    expect(trusted.key).toBe('code.trusted');
    expect(trusted.window).toBe('read');
    expect(trusted.fallback).toEqual([]);
    expect(trusted.problems?.([{ repo: 'rozed-dev/e2e' }])).toHaveLength(1);
    expect(trusted.problems?.([REPO])).toEqual([]);
  });
});
