// The banner's dismissals, kept in the database by repository.

import { expect, it } from 'vitest';

import { openDatabase, type Database } from '../../../main/database.ts';
import { migrate } from '../../../main/migrations.ts';
import { Dismissed } from './dismissed.ts';

// The feature's migrations, named by their paths in the app, as main finds them.
const migrations = Object.fromEntries(
  Object.entries(
    import.meta.glob<string>('../migrations/*.sql', {
      eager: true,
      query: '?raw',
      import: 'default',
    }),
  ).map(([path, sql]) => [path.replace(/^\.\.\//, '/src/features/code/'), sql]),
);

function database(): Database {
  const opened = openDatabase(':memory:');
  migrate(opened, migrations);
  return opened;
}

it('keeps a dismissal by repository, in any case, for a Lo started again', () => {
  const opened = database();
  const dismissed = new Dismissed(opened);
  expect(dismissed.has('rozed-dev/e2e')).toBe(false);
  dismissed.add('Rozed-Dev/E2E', 1);
  dismissed.add('rozed-dev/e2e', 2);
  expect(dismissed.has('rozed-dev/e2e')).toBe(true);
  expect(dismissed.has('rozed-dev/other')).toBe(false);
  expect(new Dismissed(opened).has('ROZED-DEV/e2e')).toBe(true);
  expect(opened.prepare('SELECT repo, at FROM code_dismissed').all()).toEqual([
    { repo: 'rozed-dev/e2e', at: 1 },
  ]);
});
