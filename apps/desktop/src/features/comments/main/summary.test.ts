import { PullRef } from '@lo/github';
import { expect, test } from 'vitest';

import { openDatabase } from '../../../main/database.ts';
import { migrate } from '../../../main/migrations.ts';
import { DraftStore } from './drafts.ts';
import { summaries } from './summary.ts';

// The feature's migrations, named by their paths in the app, as main finds them.
const migrations = Object.fromEntries(
  Object.entries(
    import.meta.glob<string>('../migrations/*.sql', {
      eager: true,
      query: '?raw',
      import: 'default',
    }),
  ).map(([path, sql]) => [path.replace(/^\.\.\//, '/src/features/comments/'), sql]),
);

const PULL = new PullRef('rozed-dev', 'e2e', 94);

test('a blank summary is kept only while a review sent with it may be on GitHub, and never restored', () => {
  const database = openDatabase(':memory:');
  migrate(database, migrations);
  const store = new DraftStore(database, () => 500);
  const drafts = summaries(() => store);
  // A review sent with no summary marks a blank one, so the mark outlasts a restart.
  drafts.markSummarySent('rozed-bot', PULL, '', 900);
  expect(drafts.summary('rozed-bot', PULL)).toMatchObject({ text: '', sent: '', sentAt: 900 });
  expect(drafts.markedSummaries()).toHaveLength(1);
  // Once it's settled, it goes, and nothing is restored after a restart.
  drafts.markSummarySent('rozed-bot', PULL, null, 950);
  expect(drafts.summary('rozed-bot', PULL)).toBeUndefined();
  const again = summaries(() => new DraftStore(database));
  expect(again.summary('rozed-bot', PULL)).toBeUndefined();
  expect(again.markedSummaries()).toEqual([]);
});

test('a summary with text stays once its review wasn’t submitted, and is restored', () => {
  const database = openDatabase(':memory:');
  migrate(database, migrations);
  const drafts = summaries(() => new DraftStore(database, () => 500));
  drafts.saveSummary('rozed-bot', PULL, 'Two small things.');
  drafts.markSummarySent('rozed-bot', PULL, 'Two small things.', 900);
  drafts.markSummarySent('rozed-bot', PULL, null, 950);
  expect(summaries(() => new DraftStore(database)).summary('rozed-bot', PULL)).toEqual({
    text: 'Two small things.',
    savedAt: 500,
    restored: true,
    sent: null,
    sentAt: null,
  });
});
