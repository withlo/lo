// Adding and taking out trusted entries, on the list as the file holds it.

import { describe, expect, it } from 'vitest';

import { fileEntry, type PullEntry, type RepoEntry } from '../settings.ts';
import { removes, withEntry, withoutEntries } from './entries.ts';

const REPO: RepoEntry = {
  kind: 'repo',
  repo: 'rozed-dev/e2e',
  id: 'R_e2e',
  at: '2026-11-15T09:00:00.000Z',
};
const PULL: PullEntry = {
  kind: 'pull',
  repo: 'rozed-dev/e2e',
  id: 'R_e2e',
  pull: 97,
  from: 'rozed-bot/e2e',
  fromId: 'R_fork',
};
/** PULL as the file holds it. */
const WRITTEN = fileEntry(PULL);
/** An entry Lo can't read, as a person left it. */
const BROKEN = { repo: 'rozed-dev/e2e' };

describe('the trusted entries, changed', () => {
  it('adds an entry in place of those for the same thing, keeping what Lo can’t read', () => {
    const renamed = { repo: 'rozed-dev/old-name', id: 'R_e2e' };
    const taken = { repo: 'rozed-dev/e2e', id: 'R_someone' };
    const other = { repo: 'rozed-dev/other', id: 'R_other' };
    expect(withEntry([BROKEN, renamed, taken, other], REPO)).toEqual([
      BROKEN,
      other,
      { repo: 'rozed-dev/e2e', id: 'R_e2e', at: '2026-11-15T09:00:00.000Z' },
    ]);
    // A pull request's entry stands beside the repository's.
    const both = withEntry(withEntry([], REPO), PULL);
    expect(both).toHaveLength(2);
    expect(withEntry(both, { ...PULL, fromId: 'R_newer' })).toHaveLength(2);
  });

  it('takes out a repository by its ID, or one pull request in it, keeping the rest', () => {
    const list = [
      BROKEN,
      { repo: 'rozed-dev/old-name', id: 'R_e2e' },
      { repo: 'rozed-dev/e2e', id: 'R_e2e' },
    ];
    const repo = withoutEntries([...list, WRITTEN], (entry) =>
      removes({ id: 'R_e2e', pull: null }, entry),
    );
    expect(repo.list).toEqual([BROKEN, WRITTEN]);
    expect(repo.removed.map((entry) => entry.repo)).toEqual([
      'rozed-dev/old-name',
      'rozed-dev/e2e',
    ]);
    const pull = withoutEntries([...list, WRITTEN], (entry) =>
      removes({ id: 'R_e2e', pull: 97 }, entry),
    );
    expect(pull.list).toEqual(list);
    expect(pull.removed).toEqual([PULL]);
    expect(
      withoutEntries(list, (entry) => removes({ id: 'R_e2e', pull: 98 }, entry)).removed,
    ).toEqual([]);
  });
});
