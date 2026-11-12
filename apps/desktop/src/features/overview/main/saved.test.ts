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

  it('empties as the cache is cleared', () => {
    const saved = new SavedRefs(database());
    saved.set({ repository: 'rozed-dev/e2e', number: 80 }, COMMIT);
    saved.clear();
    expect(saved.get({ repository: 'rozed-dev/e2e', number: 80 })).toBeUndefined();
  });
});
