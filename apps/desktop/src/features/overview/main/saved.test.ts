import { describe, expect, it } from 'vitest';

import type { OverviewCommit } from '../contract.ts';
import { SavedRefs } from './saved.ts';
import { database, fakeId } from './test/support.ts';

const COMMIT: OverviewCommit = {
  id: fakeId('commit'),
  source: 'base',
  repository: { owner: 'rozed-dev', name: 'e2e' },
  byline: { login: 'rozed-bot', name: 'rozed-bot', at: 1_794_389_400_000 },
  entries: [{ path: 'artifact.md', kind: 'file', size: 12, id: fakeId('artifact') }],
  truncated: false,
  read: true,
};

describe('SavedRefs', () => {
  it("keeps each pull request's commit, by its repository whatever its case", () => {
    const saved = new SavedRefs(database());
    saved.set({ repository: 'rozed-dev/e2e', number: 80 }, COMMIT);
    expect(saved.get({ repository: 'Rozed-Dev/E2E', number: 80 })).toEqual(COMMIT);
    expect(saved.get({ repository: 'rozed-dev/e2e', number: 8 })).toBeUndefined();
    const newer = { ...COMMIT, id: fakeId('newer') };
    saved.set({ repository: 'rozed-dev/e2e', number: 80 }, newer);
    expect(saved.get({ repository: 'rozed-dev/e2e', number: 80 })).toEqual(newer);
    saved.forget({ repository: 'ROZED-DEV/e2e', number: 80 });
    expect(saved.get({ repository: 'rozed-dev/e2e', number: 80 })).toBeUndefined();
  });

  it('forgets one that no longer reads as the window takes it', () => {
    const db = database();
    const lines: string[] = [];
    const saved = new SavedRefs(db, { log: (line) => lines.push(line) });
    saved.set({ repository: 'rozed-dev/e2e', number: 80 }, COMMIT);
    db.prepare('UPDATE overview_refs SET overview = ?').run('{"id":"HEAD"}');
    expect(saved.get({ repository: 'rozed-dev/e2e', number: 80 })).toBeUndefined();
    expect(db.prepare('SELECT count(*) AS rows FROM overview_refs').get()?.rows).toBe(0);
    expect(lines).toHaveLength(1);
  });

  it("keeps the IDs of a closed pull request's overview's files, until it's open again", () => {
    const db = database();
    const saved = new SavedRefs(db);
    const pull = { repository: 'rozed-dev/e2e', number: 80 };
    const held = () =>
      db
        .prepare(
          `SELECT files.id FROM overview_ref_files AS files JOIN overview_refs AS refs
           ON refs.repository = files.repository AND refs.number = files.number
           WHERE refs.closed = 1 ORDER BY files.id`,
        )
        .all()
        .map(({ id }) => id);
    const commit: OverviewCommit = {
      ...COMMIT,
      entries: [
        ...COMMIT.entries,
        { path: 'figures/a.svg', kind: 'file', size: 4, id: fakeId('figure') },
        // Files Lo never reads aren't kept, so aren't held.
        { path: 'notes.txt', kind: 'file', size: 4, id: fakeId('notes') },
        { path: 'figures', kind: 'folder', size: null, id: fakeId('folder') },
      ],
    };
    // Closed before anything is kept: nothing to hold.
    saved.close(pull, true);
    saved.set(pull, commit);
    expect(held()).toEqual([]);
    saved.close({ ...pull, repository: 'Rozed-Dev/E2E' }, true);
    expect(held()).toEqual([fakeId('artifact'), fakeId('figure')].toSorted());
    // A newer commit kept for it is held in its place, and stays closed unless said.
    const newer = { ...COMMIT, entries: [{ ...COMMIT.entries[0]!, id: fakeId('newer') }] };
    saved.set(pull, newer);
    expect(held()).toEqual([fakeId('newer')]);
    saved.set(pull, newer, false);
    expect(held()).toEqual([]);
    saved.set(pull, newer, true);
    expect(held()).toEqual([fakeId('newer')]);
    saved.forget(pull);
    expect(held()).toEqual([]);
    expect(db.prepare('SELECT count(*) AS rows FROM overview_ref_files').get()?.rows).toBe(0);
  });

  it("keeps stacks' overviews apart, never held", () => {
    const db = database();
    const pulls = new SavedRefs(db);
    const stacks = new SavedRefs(db, { of: 'stack' });
    const key = { repository: 'rozed-dev/e2e', number: 12 };
    stacks.set(key, COMMIT, true);
    stacks.close(key, true);
    expect(stacks.get(key)).toEqual(COMMIT);
    expect(pulls.get(key)).toBeUndefined();
    expect(db.prepare('SELECT count(*) AS rows FROM overview_ref_files').get()?.rows).toBe(0);
    stacks.clear();
    expect(stacks.get(key)).toBeUndefined();
  });

  it('empties as the cache is cleared', () => {
    const saved = new SavedRefs(database());
    saved.set({ repository: 'rozed-dev/e2e', number: 80 }, COMMIT);
    saved.clear();
    expect(saved.get({ repository: 'rozed-dev/e2e', number: 80 })).toBeUndefined();
  });
});
