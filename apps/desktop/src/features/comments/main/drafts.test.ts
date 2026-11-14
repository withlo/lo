import { PullRef } from '@lo/github';
import { expect, test } from 'vitest';

import { openDatabase } from '../../../main/database.ts';
import { migrate } from '../../../main/migrations.ts';
import type { DraftPlaceRow } from '../contract.ts';
import { DraftStore, placeJson } from './drafts.ts';

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

function database() {
  const opened = openDatabase(':memory:');
  migrate(opened, migrations);
  return opened;
}

const PULL = new PullRef('rozed-dev', 'e2e', 94);
const R1 = '1'.repeat(40);
const R2 = '2'.repeat(40);

function on(commit: string, path: string, line?: number): DraftPlaceRow {
  const lines =
    line === undefined ? null : { start: null, end: { side: 'RIGHT' as const, number: line } };
  return { kind: 'thread', commit, path, lines };
}

test('a draft is saved as typed, comes back restored, and blank text removes it', () => {
  const db = database();
  const store = new DraftStore(db, () => 500);
  expect(store.save('Rozed-Bot', PULL, on(R1, 'a.ts', 4), 'Typed')).toBe(true);
  expect(store.save('rozed-bot', PULL, on(R1, 'a.ts', 4), 'Typed')).toBe(false);
  expect(store.of('rozed-bot', PULL)).toEqual([
    {
      place: on(R1, 'a.ts', 4),
      text: 'Typed',
      savedAt: 500,
      restored: false,
      sent: null,
      sentAt: null,
      base: null,
    },
  ]);
  const again = new DraftStore(db);
  expect(again.of('ROZED-BOT', new PullRef('Rozed-Dev', 'E2E', 94))).toMatchObject([
    { text: 'Typed', restored: true },
  ]);
  expect(again.save('rozed-bot', PULL, on(R1, 'a.ts', 4), '  ')).toBe(true);
  expect(new DraftStore(db).of('rozed-bot', PULL)).toEqual([]);
});

test('a place of a kind Lo doesn’t know is kept in the database and never opened', () => {
  const db = database();
  db.prepare(
    `INSERT INTO comments_drafts (account, owner, repo, number, place, body, sent, saved_at)
     VALUES ('rozed-bot', 'rozed-dev', 'e2e', 94, ?, 'Later', NULL, 1)`,
  ).run(JSON.stringify({ kind: 'review', id: 'x' }));
  const store = new DraftStore(db);
  expect(store.of('rozed-bot', PULL)).toEqual([]);
  store.forget('someone');
  expect(db.prepare('SELECT count(*) AS n FROM comments_drafts').get()?.n).toBe(1);
});

test('the sent mark, with when it was sent, keeps a draft through blank text and a restart until it’s settled', () => {
  const db = database();
  const store = new DraftStore(db, () => 500);
  const place = on(R1, 'a.ts', 4);
  store.save('rozed-bot', PULL, place, 'Sent');
  store.markSent('rozed-bot', PULL, place, 'Sent', 9_000);
  expect(store.save('rozed-bot', PULL, place, '')).toBe(true);
  expect(store.get('rozed-bot', PULL, place)).toMatchObject({
    text: '',
    savedAt: 500,
    sent: 'Sent',
    sentAt: 9_000,
  });
  expect(new DraftStore(db).get('rozed-bot', PULL, place)).toMatchObject({
    sent: 'Sent',
    sentAt: 9_000,
  });
  store.markSent('rozed-bot', PULL, place, null);
  expect(store.get('rozed-bot', PULL, place)).toMatchObject({ sent: null, sentAt: null });
  expect(store.take('rozed-bot', PULL, place)).toMatchObject({ sent: null });
});

test('drafts on an older revision move to the newer one where their file is the same', () => {
  const store = new DraftStore(database());
  store.save('rozed-bot', PULL, on(R1, 'same.ts', 3), 'Moves');
  store.save('rozed-bot', PULL, on(R1, 'changed.ts', 3), 'Stays');
  store.save('rozed-bot', PULL, on(R1, 'same.ts'), 'On the file');
  const moved = store.moveToLatest('rozed-bot', PULL, R2, (place) =>
    place.path === 'same.ts' ? { ...place, commit: R2 } : undefined,
  );
  expect(moved).toBe(true);
  expect(store.of('rozed-bot', PULL).map(({ place, text }) => [placeJson(place), text])).toEqual(
    [
      [placeJson(on(R1, 'changed.ts', 3)), 'Stays'],
      [placeJson(on(R2, 'same.ts', 3)), 'Moves'],
      [placeJson(on(R2, 'same.ts')), 'On the file'],
    ].toSorted(([a], [b]) => (a! < b! ? -1 : 1)),
  );
});

test('an edit’s draft keeps the text it started from through blank text and a restart', () => {
  const db = database();
  const store = new DraftStore(db, () => 500);
  const place: DraftPlaceRow = { kind: 'edit', thread: 'PRRT_1', comment: 'PRRC_1' };
  expect(store.startEdit('rozed-bot', PULL, place, 'GitHub’s text')).toBe(true);
  expect(store.get('rozed-bot', PULL, place)).toMatchObject({
    text: 'GitHub’s text',
    base: 'GitHub’s text',
  });
  store.save('rozed-bot', PULL, place, 'Typed');
  // Started again, it's the draft there that stays.
  expect(store.startEdit('rozed-bot', PULL, place, 'Newer')).toBe(false);
  store.save('rozed-bot', PULL, place, '');
  expect(new DraftStore(db).get('rozed-bot', PULL, place)).toMatchObject({
    text: '',
    base: 'GitHub’s text',
    restored: true,
  });
  store.take('rozed-bot', PULL, place);
  expect(new DraftStore(db).of('rozed-bot', PULL)).toEqual([]);
});

test('a reply’s draft is kept by its thread, and stays where it is as a newer push is shown', () => {
  const store = new DraftStore(database());
  const place: DraftPlaceRow = { kind: 'reply', thread: 'PRRT_1' };
  store.save('rozed-bot', PULL, place, 'A reply');
  expect(store.startEdit('rozed-bot', PULL, place, 'Not an edit')).toBe(false);
  expect(store.moveToLatest('rozed-bot', PULL, R2, () => undefined)).toBe(false);
  expect(store.of('rozed-bot', PULL)).toMatchObject([{ place, text: 'A reply', base: null }]);
});
