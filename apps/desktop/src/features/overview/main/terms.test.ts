// The repositories' definitions in main: `refs/lo/terms` watched with an ETag, and for a commit not
// read yet, the top of its tree and `terms.json`, in one turn; never a file past the store's limit;
// one read for every tab of a repository acting as one account; read with the tab's overview, on
// its own cadence; and kept, so they show at once the next time.

import { STORE_READ } from '@lo/artifact';
import { RepoRef, type GithubClient, type ReadPriority, type ReadPriorityNow } from '@lo/github';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { IpcError } from '../../../ipc/contract.ts';
import type { Acting } from '../../tab/contract.ts';
import { STORE_BYTES, type Problem, type StoreFound, type StoreState } from '../contract.ts';
import {
  KeptStores,
  STORE_EVERY,
  STORE_SHOWN,
  Stores,
  STORES_KEPT_FOR,
  TabStore,
} from './terms.ts';
import { database, FakeGithub, fakeId, idOf, overview } from './test/support.ts';

const ROZED: Acting = { kind: 'account', login: 'rozed-bot' };
const E2E = new RepoRef('rozed-dev', 'e2e');
const TERMS = 'refs/lo/terms';

/** `terms.json` holding a term for each of `names`. */
function termsJson(...names: string[]): string {
  const terms = Object.fromEntries(
    names.map((name) => [
      name.toLowerCase(),
      {
        term: name,
        definition: `The ${name}.`,
        written: 'agent',
        by: { login: 'rozed-bot' },
        from: '#80',
        at: '2026-11-27T10:30:00Z',
      },
    ]),
  );
  return JSON.stringify({ format: 1, terms });
}

/** Definitions read with `github`'s client, kept in `db`, with every turn they took. */
function storesWith(github: FakeGithub, db = database()) {
  const turns: string[] = [];
  const priorities: (ReadPriority | undefined)[] = [];
  const lines: string[] = [];
  const kept = new KeptStores(db);
  const stores = new Stores({
    github: async <T>(
      _acting: Acting,
      request: (client: GithubClient) => Promise<T>,
      priority?: ReadPriorityNow,
    ): Promise<T> => {
      priorities.push(typeof priority === 'function' ? priority() : priority);
      const before = github.asked.length;
      try {
        return await request(github.client);
      } finally {
        turns.push(github.paths().slice(before).join(' '));
      }
    },
    kept,
    log: (line) => lines.push(line),
  });
  return { stores, turns, priorities, lines, kept, db };
}

/**
 * A tab following `repository`'s definitions in `stores`, as `acting`, `null` for not known yet,
 * with what it sends.
 */
function tabOf(stores: Stores, id = 't1', acting: Acting | null = ROZED, repository = E2E) {
  const sent: StoreState[] = [];
  const tab = new TabStore({ id, stores, publish: (state) => sent.push(state) });
  tab.update(acting ?? undefined, repository);
  return { tab, sent, last: () => sent.at(-1) };
}

async function settle(): Promise<void> {
  for (let round = 0; round < 5; round++) await vi.advanceTimersByTimeAsync(0);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  vi.setSystemTime(new Date('2026-11-27T12:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("a repository's definitions", () => {
  it('reads the ref, the top of its commit and terms.json in one turn, then asks with the ETag', async () => {
    const github = new FakeGithub();
    const json = termsJson('Bucket');
    const store = overview('store', { 'terms.json': json });
    github.push('rozed-dev/e2e', TERMS, store);
    const { stores, turns } = storesWith(github);
    const { tab, last } = tabOf(stores);
    expect(last()).toEqual({
      id: 't1',
      repository: { owner: 'rozed-dev', name: 'e2e' },
      found: { kind: 'unknown' },
      saved: false,
      checkedAt: null,
      problem: null,
    });
    tab.read('foreground', true);
    await settle();
    expect(turns).toEqual([
      [
        'rozed-dev/e2e/git/matching-refs/lo/terms',
        `rozed-dev/e2e/git/trees/${store.commit}`,
        `rozed-dev/e2e/git/blobs/${idOf(json)}`,
      ].join(' '),
    ]);
    expect(last()).toEqual({
      id: 't1',
      repository: { owner: 'rozed-dev', name: 'e2e' },
      found: { kind: 'file', commit: store.commit, id: idOf(json), size: json.length },
      saved: false,
      checkedAt: Date.now(),
      problem: null,
    });
    expect(new TextDecoder().decode(tab.file(idOf(json)))).toBe(json);
    expect(() => tab.file(fakeId('other'))).toThrow(IpcError);

    // Every 5 minutes, it costs nothing while the ref holds the same.
    await vi.advanceTimersByTimeAsync(STORE_EVERY);
    tab.read('background', false);
    await settle();
    expect(turns.at(-1)).toBe('rozed-dev/e2e/git/matching-refs/lo/terms');
    expect(github.asked.at(-1)?.etag).toMatch(/^"/);
    tab.close();
  });

  it('reads a newer commit whole, and only the ref while the same', async () => {
    const github = new FakeGithub();
    github.push('rozed-dev/e2e', TERMS, overview('one', { 'terms.json': termsJson('Bucket') }));
    const { stores, turns } = storesWith(github);
    const { tab, last } = tabOf(stores);
    tab.read('foreground', true);
    await settle();
    const json = termsJson('Bucket', 'Tenant');
    const newer = overview('two', { 'terms.json': json });
    github.push('rozed-dev/e2e', TERMS, newer);
    await vi.advanceTimersByTimeAsync(STORE_EVERY);
    tab.read('background', false);
    await settle();
    expect(turns.at(-1)?.split(' ')).toHaveLength(3);
    expect(last()?.found).toEqual({
      kind: 'file',
      commit: newer.commit,
      id: idOf(json),
      size: json.length,
    });
    tab.close();
  });

  it('says a repository with none has none', async () => {
    const github = new FakeGithub();
    // Another ref the store's starts is no store.
    github.push('rozed-dev/e2e', 'refs/lo/terms2', overview('x', { 'terms.json': termsJson('A') }));
    const { stores, turns } = storesWith(github);
    const { tab, last } = tabOf(stores);
    tab.read('foreground', true);
    await settle();
    expect(last()?.found).toEqual({ kind: 'none' });
    expect(turns).toEqual(['rozed-dev/e2e/git/matching-refs/lo/terms']);
    tab.close();
  });

  it('never reads a terms.json larger than the store may be, or what isn’t one', async () => {
    expect(STORE_BYTES).toBe(STORE_READ);
    const cases: { name: string; made: () => FakeGithub; found: object }[] = [
      {
        name: 'too large',
        made: () => {
          const github = new FakeGithub();
          const made = overview('large', { 'terms.json': 'x' });
          made.items[0]!.size = STORE_BYTES + 1;
          github.push('rozed-dev/e2e', TERMS, made);
          return github;
        },
        found: { kind: 'unreadable', why: 'tooLarge', size: STORE_BYTES + 1 },
      },
      {
        name: 'missing',
        made: () => {
          const github = new FakeGithub();
          github.push('rozed-dev/e2e', TERMS, overview('none', { 'other.json': '{}' }));
          return github;
        },
        found: { kind: 'unreadable', why: 'missing', size: null },
      },
      {
        name: 'a link',
        made: () => {
          const github = new FakeGithub();
          const made = overview('link', { 'terms.json': 'elsewhere.json' });
          made.items[0]!.mode = '120000';
          github.push('rozed-dev/e2e', TERMS, made);
          return github;
        },
        found: { kind: 'unreadable', why: 'notFile', size: null },
      },
      {
        name: 'in a folder',
        made: () => {
          const github = new FakeGithub();
          github.push('rozed-dev/e2e', TERMS, overview('deep', { 'lo/terms.json': '{}' }));
          return github;
        },
        found: { kind: 'unreadable', why: 'missing', size: null },
      },
      {
        name: 'a tag',
        made: () => {
          const github = new FakeGithub();
          github.point('rozed-dev/e2e', TERMS, fakeId('tag'), 'tag');
          return github;
        },
        found: { kind: 'unreadable', why: 'notCommit', size: null },
      },
    ];
    for (const { name, made, found } of cases) {
      const github = made();
      const { stores } = storesWith(github);
      const { tab, last } = tabOf(stores);
      tab.read('foreground', true);
      await settle();
      expect({ name, found: last()?.found }).toMatchObject({ name, found });
      expect({
        name,
        blobs: github.paths().filter((path) => path.includes('/git/blobs/')),
      }).toEqual({ name, blobs: [] });
      tab.close();
    }
  });

  it('refuses a file that isn’t the one its ID names, and says why until a read goes through', async () => {
    const github = new FakeGithub();
    const json = termsJson('Bucket');
    const store = overview('store', { 'terms.json': json });
    github.push('rozed-dev/e2e', TERMS, store);
    github.blobs.set(idOf(json), new TextEncoder().encode(termsJson('Other')));
    const { stores } = storesWith(github);
    const { tab, last } = tabOf(stores);
    tab.read('foreground', true);
    await settle();
    expect(last()).toMatchObject({ found: { kind: 'unknown' }, problem: { kind: 'failed' } });
    github.blobs.set(idOf(json), new TextEncoder().encode(json));
    await tab.retry();
    await settle();
    expect(last()).toMatchObject({ found: { kind: 'file' }, problem: null });
    tab.close();
  });

  it('is read once for every tab of the repository acting as one account', async () => {
    const github = new FakeGithub();
    github.push('rozed-dev/e2e', TERMS, overview('store', { 'terms.json': termsJson('Bucket') }));
    const { stores, turns } = storesWith(github);
    const one = tabOf(stores, 't1');
    const two = tabOf(stores, 't2', { kind: 'account', login: 'ROZED-BOT' });
    one.tab.read('foreground', true);
    two.tab.read('foreground', true);
    await settle();
    expect(turns).toHaveLength(1);
    expect(one.last()?.found).toEqual(two.last()?.found);
    expect(two.last()?.id).toBe('t2');
    // Another account reads them itself.
    const other = tabOf(stores, 't3', { kind: 'account', login: 'someone' });
    other.tab.read('foreground', true);
    await settle();
    expect(turns).toHaveLength(2);
    for (const each of [one, two, other]) each.tab.close();
  });

  it('is read as a tab is shown only when not read in the last 30 s, and else every 5 minutes', async () => {
    const github = new FakeGithub();
    github.push('rozed-dev/e2e', TERMS, overview('store', { 'terms.json': termsJson('Bucket') }));
    // GitHub asks to be asked no more often than every 10 minutes.
    github.pollInterval = '600';
    const { stores, turns } = storesWith(github);
    const { tab } = tabOf(stores);
    tab.read('foreground', true);
    await settle();
    tab.read('foreground', true);
    await vi.advanceTimersByTimeAsync(STORE_SHOWN - 1);
    tab.read('foreground', true);
    tab.read('background', false);
    await settle();
    expect(turns).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    tab.read('foreground', true);
    await settle();
    expect(turns).toHaveLength(2);
    // On its own cadence, never sooner than GitHub asked.
    await vi.advanceTimersByTimeAsync(STORE_EVERY);
    tab.read('background', false);
    await settle();
    expect(turns).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(600_000 - STORE_EVERY);
    tab.read('background', false);
    await settle();
    expect(turns).toHaveLength(3);
    tab.close();
  });

  it('after a failure, is read once its wait is over, or as the tab is shown', async () => {
    const github = new FakeGithub();
    github.answer.set(
      'rozed-dev/e2e/git/matching-refs/lo/terms',
      () => new Response('{"message":"Server Error"}', { status: 500 }),
    );
    const { stores, turns } = storesWith(github);
    const { tab, last } = tabOf(stores);
    tab.read('foreground', true);
    await settle();
    expect(last()?.problem).toMatchObject({ kind: 'failed' });
    tab.read('background', false);
    await settle();
    expect(turns.filter((turn) => turn !== '')).toHaveLength(1);
    tab.read('foreground', true);
    await settle();
    expect(turns.filter((turn) => turn !== '')).toHaveLength(2);
    tab.close();
  });

  it('never goes ahead of what a view waits on: next after an overview read at once', async () => {
    const github = new FakeGithub();
    const { stores, priorities } = storesWith(github);
    const { tab } = tabOf(stores);
    tab.read('foreground', true);
    await settle();
    await vi.advanceTimersByTimeAsync(STORE_EVERY);
    tab.read(() => 'background', false);
    await settle();
    // Retry is what someone waits on.
    await tab.retry();
    expect(priorities).toEqual(['next', 'background', 'foreground']);
    tab.close();
  });

  it('reads them without an account once', async () => {
    const github = new FakeGithub();
    github.push('rozed-dev/e2e', TERMS, overview('store', { 'terms.json': termsJson('Bucket') }));
    const { stores, turns } = storesWith(github);
    const { tab, last } = tabOf(stores, 't1', { kind: 'anonymous' });
    tab.read('foreground', true);
    await settle();
    await vi.advanceTimersByTimeAsync(10 * STORE_EVERY);
    tab.read('foreground', true);
    await settle();
    expect(turns).toHaveLength(1);
    expect(last()?.found.kind).toBe('file');
    tab.close();
  });

  it('shows what was kept at once, before the tab knows its account, and reads only the ref after', async () => {
    const github = new FakeGithub();
    const json = termsJson('Bucket');
    const store = overview('store', { 'terms.json': json });
    github.push('rozed-dev/e2e', TERMS, store);
    const first = storesWith(github);
    const one = tabOf(first.stores);
    one.tab.read('foreground', true);
    await settle();
    one.tab.close();

    const again = storesWith(github, first.db);
    const { tab, last } = tabOf(again.stores, 't1', null);
    expect(last()).toMatchObject({
      found: { kind: 'file', commit: store.commit, id: idOf(json) },
      saved: true,
      checkedAt: null,
    });
    expect(new TextDecoder().decode(tab.file(idOf(json)))).toBe(json);
    // Not knowing who it acts as, it reads nothing.
    tab.read('foreground', true);
    await settle();
    expect(again.turns).toEqual([]);
    tab.update(ROZED, E2E);
    tab.read('foreground', true);
    await settle();
    expect(again.turns).toEqual(['rozed-dev/e2e/git/matching-refs/lo/terms']);
    expect(last()).toMatchObject({ saved: false, checkedAt: Date.now() });
    tab.close();
  });

  it('forgets what was kept that no longer reads', () => {
    const { kept, db } = storesWith(new FakeGithub());
    const json = new TextEncoder().encode(termsJson('Bucket'));
    kept.set(E2E, { kind: 'file', commit: fakeId('c'), id: idOf(json), size: json.length }, json);
    expect(kept.get(new RepoRef('Rozed-Dev', 'E2E'))?.bytes).toEqual(json);
    db.prepare('UPDATE overview_stores SET bytes = ?').run(new TextEncoder().encode('{}'));
    expect(kept.get(E2E)).toBeUndefined();
    kept.set(E2E, { kind: 'none' }, null);
    db.prepare('UPDATE overview_stores SET found = ?').run('{"kind":"file"}');
    expect(kept.get(E2E)).toBeUndefined();
  });

  it('empties as the cache is cleared, and is read afresh', async () => {
    const github = new FakeGithub();
    github.push('rozed-dev/e2e', TERMS, overview('store', { 'terms.json': termsJson('Bucket') }));
    const { stores, turns, kept } = storesWith(github);
    const { tab, last } = tabOf(stores);
    tab.read('foreground', true);
    await settle();
    stores.clear();
    expect(last()?.found).toEqual({ kind: 'unknown' });
    expect(kept.get(E2E)).toBeUndefined();
    tab.read('foreground', true);
    await settle();
    expect(turns.at(-1)?.split(' ')).toHaveLength(3);
    expect(last()?.found.kind).toBe('file');
    tab.close();
  });

  it('reads the file again when what’s kept isn’t it, as after a write that failed or another account’s older read', async () => {
    const github = new FakeGithub();
    const json = termsJson('Bucket');
    github.push('rozed-dev/e2e', TERMS, overview('store', { 'terms.json': json }));
    const { stores, turns, kept } = storesWith(github);
    const { tab, last } = tabOf(stores);
    const blob = `rozed-dev/e2e/git/blobs/${idOf(json)}`;
    const id = idOf(json);
    // The write fails.
    vi.spyOn(kept, 'set').mockImplementationOnce(() => {
      throw new Error('The disk is full.');
    });
    tab.read('foreground', true);
    await settle();
    expect(last()?.found).toMatchObject({ kind: 'file', id });
    expect(() => tab.file(id)).toThrow(IpcError);
    // Read again, found the same: the file is read again by its ID, and kept.
    await vi.advanceTimersByTimeAsync(STORE_EVERY);
    tab.read('background', false);
    await settle();
    expect(turns.at(-1)).toBe(`rozed-dev/e2e/git/matching-refs/lo/terms ${blob}`);
    expect(new TextDecoder().decode(tab.file(id))).toBe(json);
    // Another account's older read, kept after it.
    kept.set(E2E, { kind: 'none' }, null);
    expect(() => tab.file(id)).toThrow(IpcError);
    await vi.advanceTimersByTimeAsync(STORE_EVERY);
    tab.read('background', false);
    await settle();
    expect(turns.at(-1)).toBe(`rozed-dev/e2e/git/matching-refs/lo/terms ${blob}`);
    expect(new TextDecoder().decode(tab.file(id))).toBe(json);
    // Kept as found: only the ref is asked.
    await vi.advanceTimersByTimeAsync(STORE_EVERY);
    tab.read('background', false);
    await settle();
    expect(turns.at(-1)).toBe('rozed-dev/e2e/git/matching-refs/lo/terms');
    tab.close();
  });

  it('says why they weren’t read when the overview’s read failed, and reads them once it goes through', async () => {
    const github = new FakeGithub();
    const { stores, turns } = storesWith(github);
    const { tab, last } = tabOf(stores);
    const problem: Problem = {
      kind: 'offline',
      cause: { kind: 'offline' },
      message: 'Lo is offline.',
      retryAt: 0,
    };
    tab.failed(problem);
    expect(last()).toMatchObject({ found: { kind: 'unknown' }, problem });
    expect(turns).toEqual([]);
    tab.read('background', false);
    await settle();
    expect(turns).toEqual(['rozed-dev/e2e/git/matching-refs/lo/terms']);
    expect(last()).toMatchObject({ found: { kind: 'none' }, problem: null });
    tab.close();
  });
  it('takes no failure of one tab’s overview with what it read as every tab’s reason', async () => {
    const github = new FakeGithub();
    github.answer.set(
      'rozed-dev/e2e/git/matching-refs/lo/terms',
      () => new Response('{"message":"Server Error"}', { status: 500 }),
    );
    const { stores, turns } = storesWith(github);
    const one = tabOf(stores, 't1');
    const two = tabOf(stores, 't2');
    one.tab.read('foreground', true);
    await settle();
    const before = two.last();
    expect(before?.problem).toMatchObject({ kind: 'failed' });
    // Another tab's overview read a commit that isn't the one its ID names: that's its own.
    one.tab.failed({ kind: 'failed', message: 'Not the file its ID names.', retryAt: 0 });
    expect(two.last()).toBe(before);
    // Its wait stands: nothing is read again before it's over.
    two.tab.read('background', false);
    await settle();
    expect(turns).toHaveLength(1);
    // Offline is every tab's.
    one.tab.failed({ kind: 'offline', cause: { kind: 'offline' }, message: '', retryAt: 0 });
    expect(two.last()?.problem).toMatchObject({ kind: 'offline' });
    one.tab.close();
    two.tab.close();
  });
});

/** A repository of rozed-dev's, `name`. */
function repo(name: string): RepoRef {
  return new RepoRef('rozed-dev', name);
}

describe('what’s kept of the definitions', () => {
  const at = Date.parse('2026-11-27T12:00:00Z');
  const commit = 'c'.repeat(40);
  const file = (text: string): [StoreFound, Uint8Array] => {
    const bytes = new TextEncoder().encode(text);
    return [{ kind: 'file', commit, id: idOf(bytes), size: bytes.length }, bytes];
  };

  it('forgets a repository’s not read for 30 days, however small', () => {
    let now = at;
    const kept = new KeptStores(database(), { now: () => now });
    kept.set(repo('old'), { kind: 'none' }, null);
    kept.set(repo('read'), { kind: 'none' }, null);
    now += STORES_KEPT_FOR - 1;
    // Read again, and found as it was.
    kept.touch(repo('read'));
    now += 2;
    kept.set(repo('new'), ...file('{}'));
    expect(kept.found(repo('old'))).toBeUndefined();
    expect(kept.found(repo('read'))).toEqual({ kind: 'none' });
    expect(kept.found(repo('new'))?.kind).toBe('file');
  });

  it('past its cap, forgets the files read least recently, never the one just kept', () => {
    let now = at;
    const kept = new KeptStores(database(), { now: () => now, cap: 20 });
    kept.set(repo('a'), ...file('0123456789'));
    now += 1000;
    kept.set(repo('b'), ...file('abcdefghij'));
    now += 2 * 60 * 60_000;
    // Read again: now the latest.
    kept.touch(repo('a'));
    kept.set(repo('c'), ...file('klmnopqrst'));
    expect(kept.found(repo('a'))?.kind).toBe('file');
    expect(kept.found(repo('b'))).toBeUndefined();
    expect(kept.found(repo('c'))?.kind).toBe('file');
    // One past the cap alone stays.
    kept.set(repo('d'), ...file('x'.repeat(30)));
    expect(kept.found(repo('d'))?.kind).toBe('file');
    expect(kept.found(repo('a'))).toBeUndefined();
    expect(kept.found(repo('c'))).toBeUndefined();
  });
});
