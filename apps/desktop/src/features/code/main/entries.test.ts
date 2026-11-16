// Adding and taking out trusted entries, on the list as the file holds it, and what's let go of
// once one is out of it.

import { describe, expect, it } from 'vitest';

import { fileEntry, type PullEntry, type RepoEntry } from '../settings.ts';
import { dropsFor, goneFrom, meant, removes, withEntry, withoutEntries } from './entries.ts';

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

describe('stopping trusting a view', () => {
  const both = [REPO, PULL];

  it('takes out only the entry that trusts it', () => {
    expect(both.filter(meant(PULL))).toEqual([PULL]);
    expect(both.filter(meant(REPO))).toEqual([REPO]);
  });

  it('takes out nothing when no entry trusts it', () => {
    expect(both.filter(meant(undefined))).toEqual([]);
  });
});

describe('what’s let go of', () => {
  const OTHER: RepoEntry = { kind: 'repo', repo: 'rozed-dev/other', id: 'R_other' };

  it('finds what went from the list, however it went, but not an entry trusted again', () => {
    const again = { ...REPO, at: '2026-11-16T09:00:00.000Z' };
    expect(goneFrom([REPO, PULL, OTHER], [again, OTHER])).toEqual([PULL]);
    // Trusted again after a rename: the old name's entry went.
    const renamed = { ...REPO, repo: 'rozed-dev/e2e-renamed' };
    expect(goneFrom([REPO], [renamed])).toEqual([REPO]);
    // Another fork for the same pull request.
    expect(goneFrom([PULL], [{ ...PULL, from: 'someone/e2e' }])).toEqual([PULL]);
  });

  it('lets go of a repository’s checkouts but those of forks’ pull requests still trusted', () => {
    expect(dropsFor([REPO], [PULL, OTHER])).toEqual([{ repo: 'rozed-dev/e2e', except: [97] }]);
    expect(dropsFor([REPO], [])).toEqual([{ repo: 'rozed-dev/e2e', except: [] }]);
  });

  it('lets go of a fork’s pull request alone, and of nothing still trusted', () => {
    expect(dropsFor([PULL], [REPO])).toEqual([{ repo: 'rozed-dev/e2e', pull: 97 }]);
    // The repository's entry still there, by its ID and name: what it trusts stays.
    expect(dropsFor([REPO], [{ ...REPO, at: '2026-11-16T09:00:00.000Z' }])).toEqual([]);
    // Both at once: the repository's drop takes the pull request's.
    expect(dropsFor([PULL, REPO], [])).toEqual([{ repo: 'rozed-dev/e2e', except: [] }]);
  });
});
