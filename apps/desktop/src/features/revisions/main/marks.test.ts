import { PullRef } from '@lo/github';
import { describe, expect, it } from 'vitest';

import { openDatabase, type Database } from '../../../main/database.ts';
import { migrate } from '../../../main/migrations.ts';
import { KEPT_AFTER_CLOSING, Marks } from './marks.ts';

// The feature's migrations, named by their paths in the app, as main finds them.
const migrations = Object.fromEntries(
  Object.entries(
    import.meta.glob<string>('../migrations/*.sql', {
      eager: true,
      query: '?raw',
      import: 'default',
    }),
  ).map(([path, sql]) => [path.replace(/^\.\.\//, '/src/features/revisions/'), sql]),
);

function database(): Database {
  const opened = openDatabase(':memory:');
  migrate(opened, migrations);
  return opened;
}

const DAY = 24 * 60 * 60 * 1000;

/** A time, `ms` milliseconds after a fixed moment. */
const at = (ms: number) => 1_790_000_000_000 + ms;

const pr = (owner: string, repo: string, number: number) => new PullRef(owner, repo, number);

const seen = (head: string, ms: number) => ({ head, firstSeen: at(ms) });

describe('Marks', () => {
  it('a head keeps when it was first seen', () => {
    const marks = new Marks(database());
    const e2e = pr('rozed-dev', 'e2e', 16);
    expect(marks.seen(e2e)).toEqual([]);

    marks.noteSeen('bot', e2e, ['h2'], at(20));
    marks.noteSeen('bot', e2e, ['h1'], at(10));
    marks.noteSeen('bot', e2e, ['h2'], at(30));
    // A clock that went backwards, or a note that came late, still keeps the earliest.
    marks.noteSeen('bot', e2e, ['h1'], at(5));

    expect(marks.seen(e2e)).toEqual([seen('h1', 5), seen('h2', 20)]);
    // Owners and repositories match ignoring case, as on GitHub.
    expect(marks.seen(pr('Rozed-Dev', 'E2E', 16))).toHaveLength(2);
  });

  it('heads any account saw count once each', () => {
    const marks = new Marks(database());
    const e2e = pr('rozed-dev', 'e2e', 16);
    marks.noteSeen('bot', e2e, ['h1'], at(10));
    marks.noteSeen('other', e2e, ['h1', 'h2'], at(8));
    marks.noteSeen('other', e2e, ['h2'], at(20));
    marks.noteSeen('bot', pr('rozed-dev', 'e2e', 14), ['x1'], at(1));

    expect(marks.seen(e2e)).toEqual([seen('h1', 8), seen('h2', 8)]);
  });

  it('last seen is per account and pull request', () => {
    const marks = new Marks(database());
    const e2e = pr('rozed-dev', 'e2e', 16);
    expect(marks.lastSeen('bot', e2e)).toBeUndefined();

    marks.setLastSeen('bot', e2e, 'h2', at(10));
    marks.setLastSeen('bot', e2e, 'h3', at(20));

    // Logins match ignoring case, as on GitHub.
    expect(marks.lastSeen('BOT', e2e)).toBe('h3');
    expect(marks.lastSeen('other', e2e)).toBeUndefined();
    expect(marks.lastSeen('bot', pr('rozed-dev', 'e2e', 14))).toBeUndefined();
  });

  it('pull requests closed a month ago are forgotten', () => {
    const marks = new Marks(database());
    const now = at(100 * DAY);
    const noted = now - 45 * DAY;
    const days = (count: number) => now - count * DAY;
    // Closed 40 days ago; closed 10 days ago; open; never seen closed; closed 40 days ago, then
    // reopened; and closed 40 days ago but seen here since.
    const pulls: [number, (pull: PullRef) => void, number][] = [
      [1, (pull) => marks.noteClosed(pull, days(40)), noted],
      [2, (pull) => marks.noteClosed(pull, days(10)), noted],
      [3, (pull) => marks.noteClosed(pull, undefined), noted],
      [4, () => undefined, noted],
      [
        5,
        (pull) => {
          marks.noteClosed(pull, days(40));
          marks.noteClosed(pull, undefined);
        },
        noted,
      ],
      [6, (pull) => marks.noteClosed(pull, days(40)), now],
    ];
    for (const [number, close, when] of pulls) {
      const pull = pr('rozed-dev', 'e2e', number);
      marks.noteSeen('bot', pull, ['h1'], when);
      marks.setLastSeen('bot', pull, 'h1', when);
      close(pull);
    }

    marks.prune(now);

    const numbers = pulls.map(([number]) => pr('rozed-dev', 'e2e', number));
    expect(
      numbers.filter((pull) => marks.seen(pull).length > 0).map((pull) => pull.number),
    ).toEqual([2, 3, 4, 5, 6]);
    expect(
      numbers
        .filter((pull) => marks.lastSeen('bot', pull) !== undefined)
        .map((pull) => pull.number),
    ).toEqual([2, 3, 4, 5, 6]);
    // A day short of the cutoff, they'd all be kept.
    expect(KEPT_AFTER_CLOSING).toBe(30 * DAY);
  });

  it('clearing the cache keeps them and removing the account removes them', () => {
    const opened = database();
    const marks = new Marks(opened);
    const e2e = pr('rozed-dev', 'e2e', 16);
    marks.noteSeen('bot', e2e, ['h1'], at(10));
    marks.noteSeen('other', e2e, ['h2'], at(20));
    marks.setLastSeen('bot', e2e, 'h2', at(30));

    // The cache is the accounts feature's poll answers, which these tables aren't among: a
    // migration's authorizer keeps every feature to its own tables, so nothing else clears them.
    const tables = opened
      .prepare("SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name")
      .all()
      .map((row) => String(row.name));
    expect(tables.filter((name) => name.startsWith('revisions_'))).toEqual([
      'revisions_closed',
      'revisions_lastseen',
      'revisions_seen',
      'revisions_viewed',
    ]);
    expect(marks.seen(e2e)).toHaveLength(2);
    expect(marks.lastSeen('bot', e2e)).toBe('h2');

    marks.forget('BOT');
    expect(marks.seen(e2e)).toEqual([seen('h2', 20)]);
    expect(marks.lastSeen('bot', e2e)).toBeUndefined();
  });
});

/** Where files were marked viewed, by path, as `viewed` lists them. */
const heads = (entries: [string, string][]) => entries.map(([path, head]) => ({ path, head }));

describe('where files were marked viewed', () => {
  it('each file keeps the head it was last marked viewed at', () => {
    const marks = new Marks(database());
    const playground = pr('rozed-dev', 'playground', 2);
    expect(marks.viewed('bot', playground)).toEqual([]);

    marks.noteViewed('bot', playground, 'a.ts', 'h1', at(10));
    marks.noteViewed('bot', playground, 'docs/b.md', 'h1', at(10));
    marks.noteViewed('bot', playground, 'a.ts', 'h2', at(20));

    expect(marks.viewed('bot', playground)).toEqual(
      heads([
        ['a.ts', 'h2'],
        ['docs/b.md', 'h1'],
      ]),
    );
    // Owners, repositories and logins match ignoring case, as on GitHub.
    expect(marks.viewed('BOT', pr('Rozed-Dev', 'Playground', 2))).toHaveLength(2);
  });

  it('records belong to one account and one pull request', () => {
    const marks = new Marks(database());
    marks.noteViewed('bot', pr('rozed-dev', 'playground', 2), 'a.ts', 'h1', at(10));

    for (const [login, pull] of [
      ['other', pr('rozed-dev', 'playground', 2)],
      ['bot', pr('rozed-dev', 'playground', 1)],
      ['bot', pr('rozed-dev', 'elsewhere', 2)],
      ['bot', pr('someone', 'playground', 2)],
    ] as const) {
      expect(marks.viewed(login, pull)).toEqual([]);
    }
  });

  it('clearing a mark forgets its record', () => {
    const marks = new Marks(database());
    const playground = pr('rozed-dev', 'playground', 2);
    for (const path of ['a.ts', 'b.ts']) marks.noteViewed('bot', playground, path, 'h1', at(10));

    marks.forgetViewed('bot', playground, 'a.ts');
    // Forgetting a file with no record does nothing.
    marks.forgetViewed('bot', playground, 'c.ts');

    expect(marks.viewed('bot', playground)).toEqual(heads([['b.ts', 'h1']]));
  });

  it('clearing the cache keeps them and removing the account removes them', () => {
    const opened = database();
    const marks = new Marks(opened);
    const playground = pr('rozed-dev', 'playground', 2);
    marks.noteViewed('bot', playground, 'a.ts', 'h1', at(10));
    marks.noteViewed('other', playground, 'a.ts', 'h2', at(10));

    // The cache is the accounts feature's poll answers, which this table isn't among: no other
    // feature can touch it, so clearing the cache can't.
    expect(marks.viewed('bot', playground)).toHaveLength(1);

    marks.forget('Bot');
    expect(marks.viewed('bot', playground)).toEqual([]);
    expect(marks.viewed('other', playground)).toEqual(heads([['a.ts', 'h2']]));
  });

  it('marks followed from GitHub are noted and forgotten together', () => {
    const marks = new Marks(database());
    const playground = pr('rozed-dev', 'playground', 2);
    marks.noteViewed('bot', playground, 'a.ts', 'h1', at(10));
    marks.noteViewed('bot', playground, 'b.ts', 'h1', at(10));

    marks.followViewed(
      'bot',
      playground,
      heads([
        ['c.ts', 'h2'],
        ['a.ts', 'h2'],
      ]),
      ['b.ts'],
      at(20),
    );

    expect(marks.viewed('bot', playground)).toEqual(
      heads([
        ['a.ts', 'h2'],
        ['c.ts', 'h2'],
      ]),
    );
  });

  it('a pull request closed a month ago forgets where its files were marked viewed', () => {
    const marks = new Marks(database());
    const now = at(100 * DAY);
    const closedLongAgo = pr('rozed-dev', 'e2e', 1);
    const closedLately = pr('rozed-dev', 'e2e', 2);
    const open = pr('rozed-dev', 'e2e', 3);
    for (const pull of [closedLongAgo, closedLately, open]) {
      marks.noteViewed('bot', pull, 'a.ts', 'h1', now - 45 * DAY);
    }
    marks.noteClosed(closedLongAgo, now - 40 * DAY);
    marks.noteClosed(closedLately, now - 10 * DAY);

    marks.prune(now);

    expect(marks.viewed('bot', closedLongAgo)).toEqual([]);
    expect(marks.viewed('bot', closedLately)).toHaveLength(1);
    expect(marks.viewed('bot', open)).toHaveLength(1);
  });
});
