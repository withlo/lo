/**
 * `fold`: a merged pull request's New and Changed terms, into the store at `refs/lo/terms` in the
 * base repository, read from its overview: the base repository's, else the fork's, else the copy.
 * Local bare repositories stand in for both, and a fake GitHub for GitHub's answers.
 */

import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { parseStore, type Store, type StoreTerm } from '@lo/artifact';
import { git } from '@lo/testing/git';

import { ATTEMPTS, fold, gitName, type FoldOptions } from '../src/fold.ts';
import type { PullRequest } from '../src/github.ts';
import { fakeGitHub, fromFork, keptLog, openWorkspace, overviewText, Repos } from './remotes.ts';
import { scratch } from './support.ts';

let root: ReturnType<typeof scratch>;
let repos: Repos;

beforeAll(() => {
  root = scratch('fold');
  repos = new Repos(root.dir);
});

afterAll(() => root.remove());

const PR = 7;
const MERGED = '2026-11-28T08:00:00Z';
const NOW = new Date('2026-11-28T09:30:00.250Z');

/** #7, merged, from the fork. */
const merged = (more: Partial<PullRequest> = {}) =>
  fromFork(PR, { merged: true, mergedAt: MERGED, ...more });

/** An overview of #7 whose glossary holds `entries`, each a line, all linked from its tl;dr. */
function withGlossary(...entries: string[]): string {
  const keys = entries.map((line) => /\*\*(.+?)\*\*/.exec(line)![1]!);
  const links = keys.map((key) => `[${key}](<term:${key}>)`).join(', ');
  return overviewText(PR, `It uses ${links}.`, `## Glossary\n\n${entries.join('\n')}\n`);
}

const BUCKET = '- **Bucket** (new): The tokens a tenant has to spend.';
const TOKEN = '- **Token** (changed): What a request spends to go through.';
const TENANT = '- **Tenant**: An account the quota is counted for.';

/** `terms.json` holding `terms`, each a term's entry by its key. */
function storeJson(terms: Record<string, Record<string, unknown>>): string {
  return JSON.stringify({ format: 1, terms });
}

/** A term's entry, by octocat, from #2, with `more`. */
function entry(term: string, definition: string, more: Record<string, unknown> = {}) {
  return {
    term,
    definition,
    written: 'agent',
    by: { login: 'octocat' },
    from: '#2',
    at: '2026-11-20T10:00:00Z',
    ...more,
  };
}

/** A base repository and a fork, and a way to run `fold` for them with what GitHub says. */
function setUp() {
  const base = repos.bare('base');
  const fork = repos.bare('fork');
  const logins: Record<string, string> = {};
  const run = async (
    pulls: readonly PullRequest[] = [merged()],
    more: Partial<FoldOptions> = {},
  ) => {
    const log = keptLog();
    const workspace = await openWorkspace();
    try {
      await fold({
        pr: PR,
        base: { name: 'us/repo', remote: { url: base } },
        fork: () => ({ url: fork }),
        github: fakeGitHub(pulls, logins),
        log,
        workspace,
        now: () => NOW,
        pause: async () => {},
        ...more,
      });
    } finally {
      workspace.close();
    }
    return log.lines;
  };
  /** The store `refs/lo/terms` holds in the base repository, read as Lo reads it. */
  const store = (): Store => {
    const text = git(base, 'cat-file', 'blob', 'refs/lo/terms:terms.json');
    const read = parseStore(text);
    if (!read.ok) throw new Error(read.problem.message);
    return read.store;
  };
  /** Sets the base repository's store to `text`, and returns its commit. */
  const setStore = (text: string, parents: string[] = []): string => {
    const id = repos.commit({ 'terms.json': text }, parents);
    repos.push(base, id, 'refs/lo/terms');
    return id;
  };
  return { base, fork, logins, run, store, setStore };
}

/** What each term in `store` is defined as, by its key. */
function definitions(store: Store): Record<string, string> {
  return Object.fromEntries([...store.terms].map(([key, term]) => [key, term.definition]));
}

describe('folding a merged pull request’s terms', () => {
  test('makes the store with its new terms, by the account its overview’s commit maps to', async () => {
    const { base, fork, logins, run, store } = setUp();
    const overview = repos.commit({ 'artifact.md': withGlossary(BUCKET, TENANT) });
    repos.push(fork, overview, `refs/lo/pr/${PR}`);
    logins[`us/repo ${overview}`] = 'writer';

    const lines = await run();
    expect(lines).toContain('info: Added "Bucket", from #7.');
    expect([...store().terms.values()]).toEqual<StoreTerm[]>([
      {
        key: 'bucket',
        term: 'Bucket',
        definition: 'The tokens a tenant has to spend.',
        aliases: [],
        written: 'agent',
        by: { login: 'writer' },
        from: PR,
        at: MERGED,
        suggestions: [],
        changes: [],
      },
    ]);
    // One commit, of one file, by the workflow's account.
    expect(git(base, 'rev-list', 'refs/lo/terms').split('\n')).toHaveLength(1);
    expect(git(base, 'ls-tree', '--name-only', 'refs/lo/terms')).toBe('terms.json');
    expect(git(base, 'log', '-1', '--format=%an <%ae> %at %s', 'refs/lo/terms')).toBe(
      `github-actions[bot] <41898282+github-actions[bot]@users.noreply.github.com> ${Math.floor(NOW.getTime() / 1000)} Definitions from pull request #7`,
    );
  });

  test('changes a term’s definition, keeping the one it had first among its changes', async () => {
    const { fork, run, store, setStore, base } = setUp();
    const before = setStore(
      storeJson({
        token: entry('Token', 'What a request spends.', {
          changes: [
            {
              definition: 'A request.',
              written: 'human',
              by: { login: 'mona' },
              from: 'lo',
              at: '2026-11-01T00:00:00Z',
            },
          ],
        }),
      }),
    );
    repos.push(
      fork,
      repos.commit({ 'artifact.md': withGlossary(TOKEN, BUCKET) }),
      `refs/lo/pr/${PR}`,
    );

    const lines = await run();
    expect(lines).toContain(
      `info: Changed "Token"'s definition to #7's, and kept the one it had in its changes.`,
    );
    const token = store().terms.get('token')!;
    expect(token).toMatchObject({
      definition: 'What a request spends to go through.',
      written: 'agent',
      from: PR,
      at: MERGED,
    });
    expect(token.changes.map(({ definition, from }) => [definition, from])).toEqual([
      ['What a request spends.', 2],
      ['A request.', 'lo'],
    ]);
    expect(definitions(store())).toEqual({
      bucket: 'The tokens a tenant has to spend.',
      token: 'What a request spends to go through.',
    });
    expect(git(base, 'rev-parse', 'refs/lo/terms^')).toBe(before);
  });

  test('suggests a change to a locked term, and leaves its definition', async () => {
    const { fork, run, store, setStore } = setUp();
    setStore(
      storeJson({
        token: entry('Token', 'What a request spends.', {
          locked: { by: { login: 'mona' }, at: '2026-11-21T00:00:00Z' },
        }),
      }),
    );
    repos.push(fork, repos.commit({ 'artifact.md': withGlossary(TOKEN) }), `refs/lo/pr/${PR}`);

    expect(await run()).toContain(
      `info: "Token" is locked, so #7's definition of it is a suggestion.`,
    );
    const token = store().terms.get('token')!;
    expect(token.definition).toBe('What a request spends.');
    expect(token.suggestions).toEqual([
      {
        definition: 'What a request spends to go through.',
        by: { name: 'Lo test' },
        from: PR,
        at: MERGED,
      },
    ]);
  });

  test('changes a term it names by one of its aliases', async () => {
    const { fork, run, store, setStore } = setUp();
    setStore(
      storeJson({ token: entry('Token', 'What a request spends.', { aliases: ['tokens'] }) }),
    );
    repos.push(
      fork,
      repos.commit({
        'artifact.md': withGlossary('- **Tokens** (changed): What requests spend.'),
      }),
      `refs/lo/pr/${PR}`,
    );
    await run();
    expect(definitions(store())).toEqual({ token: 'What requests spend.' });
  });

  test('writes the overview’s commit’s git name, not verified, when GitHub maps it to no account', async () => {
    const { fork, run, store } = setUp();
    repos.push(
      fork,
      repos.commit({ 'artifact.md': withGlossary(BUCKET) }, [], {
        name: ' A.\u202e Writer\n ',
        email: 'writer@example.invalid',
      }),
      `refs/lo/pr/${PR}`,
    );
    await run();
    expect(store().terms.get('bucket')!.by).toEqual({ name: 'A. Writer' });
  });

  test('asks the fork for the account when the base repository doesn’t have the commit', async () => {
    const { fork, logins, run, store } = setUp();
    const overview = repos.commit({ 'artifact.md': withGlossary(BUCKET) });
    repos.push(fork, overview, `refs/lo/pr/${PR}`);
    logins[`them/repo ${overview}`] = 'forker';
    await run([merged({ author: 'Forker' })]);
    expect(store().terms.get('bucket')!.by).toEqual({ login: 'forker' });
  });
});

describe('who a fork’s definitions are by', () => {
  const AUTHOR = { name: 'A. Forker', email: '1+someone@users.noreply.github.com' };

  test('the commit’s git name, not verified, when its account didn’t open the pull request', async () => {
    const { fork, logins, run, store } = setUp();
    const overview = repos.commit({ 'artifact.md': withGlossary(BUCKET) }, [], AUTHOR);
    repos.push(fork, overview, `refs/lo/pr/${PR}`);
    logins[`us/repo ${overview}`] = 'someone';
    expect(await run()).toContain(
      `info: #7's overview's commit, from its fork, maps to someone, who didn't open #7, so its definitions are by the commit's git name, "A. Forker", which isn't verified.`,
    );
    expect(store().terms.get('bucket')!.by).toEqual({ name: 'A. Forker' });
  });

  test('the same for the copy of a deleted fork’s overview', async () => {
    const { base, logins, run, store } = setUp();
    const overview = repos.commit({ 'artifact.md': withGlossary(BUCKET) }, [], AUTHOR);
    repos.push(base, overview, `refs/lo/kept/pr/${PR}`);
    logins[`us/repo ${overview}`] = 'someone';
    await run([merged({ head: undefined })]);
    expect(store().terms.get('bucket')!.by).toEqual({ name: 'A. Forker' });

    const opened = setUp();
    repos.push(opened.base, overview, `refs/lo/kept/pr/${PR}`);
    opened.logins[`us/repo ${overview}`] = 'someone';
    await opened.run([merged({ head: undefined, author: 'someone' })]);
    expect(opened.store().terms.get('bucket')!.by).toEqual({ login: 'someone' });
  });

  test('the account, for an overview in the base repository, which only its writers push', async () => {
    const { base, logins, run, store } = setUp();
    const overview = repos.commit({ 'artifact.md': withGlossary(BUCKET) }, [], AUTHOR);
    repos.push(base, overview, `refs/lo/pr/${PR}`);
    logins[`us/repo ${overview}`] = 'someone';
    await run();
    expect(store().terms.get('bucket')!.by).toEqual({ login: 'someone' });
  });
});

describe('what folding leaves as it was', () => {
  test('a definition the store has already, but for runs of spaces: no commit, and its writer kept', async () => {
    const { base, fork, run, store, setStore } = setUp();
    const before = setStore(
      storeJson({
        token: entry('Token', 'What  a request spends to go through.', {
          written: 'human',
          from: 'lo',
        }),
      }),
    );
    repos.push(fork, repos.commit({ 'artifact.md': withGlossary(TOKEN) }), `refs/lo/pr/${PR}`);
    expect(await run()).toContain(`info: "Token" has #7's definition already.`);
    expect(repos.ref(base, 'refs/lo/terms')).toBe(before);
    expect(store().terms.get('token')).toMatchObject({ written: 'human', from: 'lo' });
  });

  test('a pull request folded once already', async () => {
    const { base, fork, run } = setUp();
    repos.push(fork, repos.commit({ 'artifact.md': withGlossary(BUCKET) }), `refs/lo/pr/${PR}`);
    await run();
    const once = repos.ref(base, 'refs/lo/terms');
    expect((await run()).at(-1)).toBe(
      `info: refs/lo/terms has #7's definitions already, from ${once}, so they aren't added again.`,
    );
    expect(repos.ref(base, 'refs/lo/terms')).toBe(once);
  });

  test('a pull request folded once, whose terms were deleted, unlocked or dismissed since', async () => {
    const { base, fork, run, setStore } = setUp();
    const first = setStore(
      storeJson({
        token: entry('Token', 'What a request spends.', {
          locked: { by: { login: 'mona' }, at: '2026-11-21T00:00:00Z' },
        }),
      }),
    );
    repos.push(
      fork,
      repos.commit({ 'artifact.md': withGlossary(BUCKET, TOKEN) }),
      `refs/lo/pr/${PR}`,
    );
    await run();
    const folded = repos.ref(base, 'refs/lo/terms')!;
    expect(git(base, 'rev-parse', `${folded}^`)).toBe(first);
    // Bucket deleted and Token unlocked, its suggestion settled, in Lo, then other changes after.
    git(repos.maker, 'fetch', '-q', base, 'refs/lo/terms');
    let tip = setStore(storeJson({ token: entry('Token', 'What a request spends.') }), [folded]);
    for (let n = 0; n < 3; n++) {
      tip = setStore(storeJson({ token: entry('Token', `What a request spends, ${n}.`) }), [tip]);
    }
    expect((await run()).at(-1)).toBe(
      `info: refs/lo/terms has #7's definitions already, from ${folded}, so they aren't added again.`,
    );
    expect(repos.ref(base, 'refs/lo/terms')).toBe(tip);
  });

  test('a term a later pull request changed, when an earlier one is folded again', async () => {
    const { base, fork, run, setStore } = setUp();
    const before = setStore(
      storeJson({
        bucket: entry('Bucket', 'Tokens, refilled.', {
          from: '#9',
          changes: [
            {
              definition: 'The tokens a tenant has to spend.',
              written: 'agent',
              by: { login: 'octocat' },
              from: '#7',
              at: '2026-11-20T10:00:00Z',
            },
          ],
        }),
      }),
    );
    repos.push(fork, repos.commit({ 'artifact.md': withGlossary(BUCKET) }), `refs/lo/pr/${PR}`);
    await run();
    expect(repos.ref(base, 'refs/lo/terms')).toBe(before);
  });

  test('unmarked terms, and a pull request that marks none', async () => {
    const { base, fork, run } = setUp();
    repos.push(fork, repos.commit({ 'artifact.md': withGlossary(TENANT) }), `refs/lo/pr/${PR}`);
    expect((await run()).at(-1)).toBe(
      "info: #7's overview marks no term (new) or (changed), so there's nothing to add.",
    );
    expect(repos.ref(base, 'refs/lo/terms')).toBeUndefined();
  });

  test('a pull request that hasn’t merged', async () => {
    const { base, fork, run } = setUp();
    repos.push(fork, repos.commit({ 'artifact.md': withGlossary(BUCKET) }), `refs/lo/pr/${PR}`);
    expect(await run([fromFork(PR)])).toEqual([
      "info: #7 hasn't merged, so its definitions aren't added.",
    ]);
    expect(repos.ref(base, 'refs/lo/terms')).toBeUndefined();
  });

  test('a pull request with no overview anywhere', async () => {
    const { run } = setUp();
    expect((await run()).at(-1)).toBe(
      'info: #7 has no overview, so there are no definitions to add.',
    );
  });

  test('an overview Lo doesn’t show', async () => {
    const { base, fork, run } = setUp();
    repos.push(
      fork,
      repos.commit({ 'artifact.md': withGlossary(BUCKET), 'extra.txt': 'x' }),
      `refs/lo/pr/${PR}`,
    );
    expect((await run()).at(-1)).toMatch(/^warning: #7's overview, .* isn't one Lo shows/);
    expect(repos.ref(base, 'refs/lo/terms')).toBeUndefined();
  });

  test('a store Lo can’t read: nothing is added to it', async () => {
    const { base, fork, run, setStore } = setUp();
    const before = setStore('{ "format": 1, "terms": ');
    repos.push(fork, repos.commit({ 'artifact.md': withGlossary(BUCKET) }), `refs/lo/pr/${PR}`);
    await expect(run()).rejects.toThrow(/can't be read, so nothing is added to them/);
    expect(repos.ref(base, 'refs/lo/terms')).toBe(before);
  });
});

/** Puts an overview defining Bucket as `definition` at `ref` in `repo`. */
function overviewAt(repo: string, ref: string, definition: string): void {
  const text = withGlossary(`- **Bucket** (new): ${definition}`);
  repos.push(repo, repos.commit({ 'artifact.md': text }), ref);
}

describe('where the overview is read from', () => {
  test('the base repository’s first, then the fork’s, then the copy', async () => {
    const { base, fork, run, store } = setUp();
    overviewAt(base, `refs/lo/kept/pr/${PR}`, 'The copy’s.');
    overviewAt(fork, `refs/lo/pr/${PR}`, 'The fork’s.');
    overviewAt(base, `refs/lo/pr/${PR}`, 'The base’s.');
    await run();
    expect(definitions(store())).toEqual({ bucket: 'The base’s.' });

    const second = setUp();
    overviewAt(second.base, `refs/lo/kept/pr/${PR}`, 'The copy’s.');
    overviewAt(second.fork, `refs/lo/pr/${PR}`, 'The fork’s.');
    await second.run();
    expect(definitions(second.store())).toEqual({ bucket: 'The fork’s.' });

    const third = setUp();
    overviewAt(third.base, `refs/lo/kept/pr/${PR}`, 'The copy’s.');
    overviewAt(third.fork, `refs/lo/pr/${PR}`, 'The fork’s.');
    await third.run([merged({ head: undefined })]);
    expect(definitions(third.store())).toEqual({ bucket: 'The copy’s.' });
  });
});

describe('a store that moves as it’s pushed', () => {
  test('is read again, and each term folded in again', async () => {
    const { fork, run, store, setStore } = setUp();
    const first = setStore(storeJson({ token: entry('Token', 'What a request spends.') }));
    repos.push(
      fork,
      repos.commit({ 'artifact.md': withGlossary(BUCKET, TOKEN) }),
      `refs/lo/pr/${PR}`,
    );
    let pushes = 0;
    const lines = await run([merged()], {
      // Someone else's change lands first, once.
      beforePush: async () => {
        if (pushes++ > 0) return;
        setStore(
          storeJson({
            token: entry('Token', 'What a request spends.'),
            tenant: entry('Tenant', 'An account.'),
          }),
          [first],
        );
      },
    });
    expect(
      lines.some((line) => /refs\/lo\/terms moved as #7's definitions were added/.test(line)),
    ).toBe(true);
    expect(definitions(store())).toEqual({
      bucket: 'The tokens a tenant has to spend.',
      tenant: 'An account.',
      token: 'What a request spends to go through.',
    });
  });

  test('gives up after moving each time', async () => {
    const { base, fork, run, setStore } = setUp();
    let parent = setStore(storeJson({}));
    repos.push(fork, repos.commit({ 'artifact.md': withGlossary(BUCKET) }), `refs/lo/pr/${PR}`);
    let pushes = 0;
    await expect(
      run([merged()], {
        beforePush: async () => {
          pushes++;
          parent = setStore(storeJson({ [`t${pushes}`]: entry(`T${pushes}`, 'A term.') }), [
            parent,
          ]);
        },
      }),
    ).rejects.toThrow(`moved each of the ${ATTEMPTS} times`);
    expect(pushes).toBe(ATTEMPTS);
    expect(repos.ref(base, 'refs/lo/terms')).toBe(parent);
  });
});

test('a git name as the store holds one', () => {
  expect(gitName('  Mona\u0000 Lisa\u200b ')).toBe('Mona Lisa');
  expect(gitName('\u202e')).toBe('unknown');
  expect(Buffer.byteLength(gitName('é'.repeat(300)))).toBeLessThanOrEqual(256);
});
