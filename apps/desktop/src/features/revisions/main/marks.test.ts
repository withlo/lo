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
    ]);
    expect(marks.seen(e2e)).toHaveLength(2);
    expect(marks.lastSeen('bot', e2e)).toBe('h2');

    marks.forget('BOT');
    expect(marks.seen(e2e)).toEqual([seen('h2', 20)]);
    expect(marks.lastSeen('bot', e2e)).toBeUndefined();
  });
});
