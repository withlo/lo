// The stacks' offers dismissed for a stack or a layer, kept in the database by pull request.

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
  ).map(([path, sql]) => [path.replace(/^\.\.\//, '/src/features/stacks/'), sql]),
);

function database(): Database {
  const opened = openDatabase(':memory:');
  migrate(opened, migrations);
  return opened;
}

it('keeps each offer dismissed for each pull request, in any case, for a Lo started again', () => {
  const opened = database();
  const dismissed = new Dismissed(opened);
  expect(dismissed.has('convert', 'rozed-dev/e2e', [82, 83])).toBe(false);
  dismissed.add('convert', 'Rozed-Dev/E2E', [82, 83], 1);
  dismissed.add('convert', 'rozed-dev/e2e', [83], 2);
  dismissed.add('start', 'rozed-dev/e2e', [84], 3);
  // Any of a stack's layers is enough; each offer is its own.
  expect(dismissed.has('convert', 'rozed-dev/e2e', [84, 83])).toBe(true);
  expect(dismissed.has('convert', 'rozed-dev/e2e', [84])).toBe(false);
  expect(dismissed.has('start', 'rozed-dev/e2e', [82])).toBe(false);
  expect(dismissed.has('convert', 'rozed-dev/other', [82])).toBe(false);
  const again = new Dismissed(opened);
  expect(again.has('convert', 'ROZED-DEV/e2e', [82])).toBe(true);
  expect(again.has('start', 'rozed-dev/e2e', [84])).toBe(true);
  expect(
    opened.prepare('SELECT notice, repo, number, at FROM stacks_dismissed ORDER BY at').all(),
  ).toEqual([
    { notice: 'convert', repo: 'rozed-dev/e2e', number: 82, at: 1 },
    { notice: 'convert', repo: 'rozed-dev/e2e', number: 83, at: 1 },
    { notice: 'start', repo: 'rozed-dev/e2e', number: 84, at: 3 },
  ]);
});
