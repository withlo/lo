// The merge method last used in each repository, kept in the database for a Lo started again.

import { RepoRef } from '@lo/github';
import { expect, it } from 'vitest';

import { openDatabase, type Database } from '../../../main/database.ts';
import { migrate } from '../../../main/migrations.ts';
import { MethodStore } from './methods.ts';

// The feature's migrations, named by their paths in the app, as main finds them.
const migrations = Object.fromEntries(
  Object.entries(
    import.meta.glob<string>('../migrations/*.sql', {
      eager: true,
      query: '?raw',
      import: 'default',
    }),
  ).map(([path, sql]) => [path.replace(/^\.\.\//, '/src/features/merge/'), sql]),
);

function database(): Database {
  const opened = openDatabase(':memory:');
  migrate(opened, migrations);
  return opened;
}

it('keeps the method last used in each repository, in any case, for a Lo started again', () => {
  const opened = database();
  const methods = new MethodStore(opened);
  const repo = new RepoRef('rozed-dev', 'e2e');
  expect(methods.get(repo)).toBeUndefined();
  methods.set(repo, 'SQUASH', 1);
  methods.set(new RepoRef('Rozed-Dev', 'E2E'), 'REBASE', 2.4);
  expect(methods.get(repo)).toBe('REBASE');
  expect(methods.get(new RepoRef('rozed-dev', 'other'))).toBeUndefined();
  expect(new MethodStore(opened).get(new RepoRef('ROZED-DEV', 'e2e'))).toBe('REBASE');
  expect(opened.prepare('SELECT method, used_at FROM merge_methods').all()).toEqual([
    { method: 'REBASE', used_at: 2 },
  ]);
  // The table takes only GitHub's three methods.
  expect(() =>
    opened
      .prepare('INSERT INTO merge_methods (repo, method, used_at) VALUES (?, ?, ?)')
      .run('rozed-dev/x', 'FAST_FORWARD', 3),
  ).toThrow('CHECK constraint failed');
});
