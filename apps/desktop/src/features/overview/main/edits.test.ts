// Editing a term of a repository's definitions in main: one commit of `terms.json` on the one the
// ref holds and the ref moved to it, only by an account with push access; read again and made
// again where the ref moved meanwhile, three times at most, and never over a term changed since;
// one edit of a repository at a time; and an answer lost settled by reading the ref.

import { parseStore } from '@lo/artifact';
import { RepoRef, type GithubClient } from '@lo/github';
import { describe, expect, it } from 'vitest';

import type { Acting } from '../../tab/contract.ts';
import { makeEdit } from '../background/index.ts';
import type { StoreState, TermEdit } from '../contract.ts';
import { EDIT_AGAIN, Edits, githubTime } from './edits.ts';
import { KeptStores, Stores, TabStore } from './terms.ts';
import { database, FakeGithub, overview, WENT_WRONG } from './test/support.ts';

const ROZED: Acting = { kind: 'account', login: 'rozed-bot' };
const E2E = new RepoRef('rozed-dev', 'e2e');
const TERMS = 'refs/lo/terms';
const NOW = Date.parse('2026-11-28T12:00:00Z');

/** A term of `terms.json`, as an agent wrote it. */
function termOf(name: string, definition: string, aliases: string[] = []) {
  return {
    term: name,
    definition,
    ...(aliases.length > 0 ? { aliases } : {}),
    written: 'agent',
    by: { login: 'elle-kzn' },
    from: '#80',
    at: '2026-11-11T09:30:00Z',
  };
}

/** `terms.json` holding `terms`, by key. */
function storeOf(terms: Record<string, ReturnType<typeof termOf>>): string {
  return `${JSON.stringify({ format: 1, terms }, null, 2)}\n`;
}

const FIRST = storeOf({
  bucket: termOf('bucket', 'The tokens a tenant has.'),
  tenant: termOf('tenant', 'Who pays.'),
});

/** An edit of `bucket` from its first definition. */
function bucketEdit(definition: string, more: Partial<TermEdit> = {}): TermEdit {
  return {
    key: 'bucket',
    term: 'bucket',
    base: { definition: 'The tokens a tenant has.', aliases: [] },
    definition,
    aliases: [],
    ...more,
  };
}

/** The definitions in `github`, read and written through `Edits`, with a tab following them. */
function editsWith(github: FakeGithub, options: { pausedUntil?: number } = {}) {
  const lines: string[] = [];
  const turns: string[] = [];
  const turn = async <T>(request: () => Promise<T>): Promise<T> => {
    const before = github.asked.length;
    try {
      return await request();
    } finally {
      turns.push(github.paths().slice(before).join(' '));
    }
  };
  const stores = new Stores({
    github: (_acting, request) => turn(() => request(github.client)),
    kept: new KeptStores(database()),
    log: (line) => lines.push(line),
  });
  const { pausedUntil } = options;
  const edits = new Edits({
    write: <T>(
      _login: string,
      request: (client: GithubClient, spacing: number) => Promise<T>,
      paused: (until: number) => T,
    ): Promise<T> =>
      pausedUntil === undefined
        ? turn(() => request(github.client, 0))
        : Promise.resolve(paused(pausedUntil)),
    read: <T>(_login: string, request: (client: GithubClient) => Promise<T>): Promise<T> =>
      turn(() => request(github.client)),
    make: async (input) => makeEdit(input),
    stores,
    log: (line) => lines.push(line),
    now: () => NOW,
    sleep: () => Promise.resolve(),
  });
  const sent: StoreState[] = [];
  const tab = new TabStore({ id: 't1', stores, publish: (state) => sent.push(state) });
  tab.update(ROZED, E2E);
  return { edits, stores, tab, turns, lines, last: () => sent.at(-1) };
}

/** The definitions the ref holds now in `github`, read as the store. */
function heldIn(github: FakeGithub) {
  const commit = github.held('rozed-dev/e2e', TERMS) ?? '';
  const tree = github.trees.get(github.commits.get(commit)?.tree ?? '');
  const id = tree?.items.find(({ path }) => path === 'terms.json')?.sha ?? '';
  const read = parseStore(github.blobs.get(id) ?? new Uint8Array());
  if (!read.ok) throw new Error(read.problem.message);
  return { commit, store: read.store };
}

/** A GitHub whose definitions are {@link FIRST}, at commit `one`. */
function githubWithFirst(): { github: FakeGithub; first: string } {
  const github = new FakeGithub();
  const made = overview('one', { 'terms.json': FIRST });
  github.push('rozed-dev/e2e', TERMS, made);
  return { github, first: made.commit };
}

/** The `sha` of an answer of GitHub's. */
function shaOf(json: unknown): string {
  const sha = typeof json === 'object' && json !== null && 'sha' in json ? json.sha : undefined;
  if (typeof sha !== 'string') throw new Error('GitHub named nothing.');
  return sha;
}

/**
 * Another writer's definitions, `terms`, written on what the ref holds through GitHub's API, and
 * the ref moved to them: their commit.
 */
async function theirs(
  github: FakeGithub,
  terms: Record<string, ReturnType<typeof termOf>>,
): Promise<string> {
  const parent = github.held('rozed-dev/e2e', TERMS);
  const content = storeOf(terms);
  const tree = await github.client.write(
    'POST',
    '/repos/rozed-dev/e2e/git/trees',
    JSON.stringify({ tree: [{ path: 'terms.json', mode: '100644', type: 'blob', content }] }),
    shaOf,
  );
  const commit = await github.client.write(
    'POST',
    '/repos/rozed-dev/e2e/git/commits',
    JSON.stringify({ message: 'Theirs', tree, parents: parent === undefined ? [] : [parent] }),
    shaOf,
  );
  github.point('rozed-dev/e2e', TERMS, commit, 'commit');
  return commit;
}

describe('an edit of a term', () => {
  it('is one commit of terms.json on the ref’s, by a person, from Lo, with the ref moved to it', async () => {
    const { github, first } = githubWithFirst();
    const { edits, tab, turns, last } = editsWith(github);
    tab.read('foreground', true);
    await tab.retry();
    turns.length = 0;

    expect(
      await edits.edit(
        'rozed-bot',
        E2E,
        bucketEdit('What a tenant spends from.', { aliases: ['buckets'] }),
      ),
    ).toEqual({ kind: 'saved' });
    // The file kept from the read: not read again.
    expect(turns).toEqual([
      [
        'graphql TermsAccess',
        'rozed-dev/e2e/git/matching-refs/lo/terms',
        `rozed-dev/e2e/git/trees/${first}`,
        'rozed-dev/e2e/git/trees',
        'rozed-dev/e2e/git/commits',
        'graphql MoveTerms',
      ].join(' '),
    ]);
    expect(github.written).toEqual([
      { sha: expect.any(String), message: 'Edit "bucket"', parents: [first] },
    ]);
    const { commit, store } = heldIn(github);
    expect(commit).toBe(github.written[0]?.sha);
    expect(store.terms.get('bucket')).toMatchObject({
      definition: 'What a tenant spends from.',
      aliases: ['buckets'],
      written: 'human',
      by: { login: 'rozed-bot' },
      from: 'lo',
      at: '2026-11-28T12:00:00Z',
      changes: [{ definition: 'The tokens a tenant has.', written: 'agent', from: 80 }],
    });
    expect(store.terms.get('tenant')?.definition).toBe('Who pays.');
    // Taken as read: the tab has it at once.
    expect(last()).toMatchObject({ found: { kind: 'file', commit }, push: true });
    tab.close();
  });

  it('is made again on the definitions as they are when another edit moved them meanwhile', async () => {
    const { github } = githubWithFirst();
    const { edits, turns } = editsWith(github);
    // Theirs goes in as Lo's first move is asked, before it's answered.
    let once = true;
    github.before.set('graphql MoveTerms', async () => {
      if (!once) return;
      once = false;
      await theirs(github, {
        bucket: termOf('bucket', 'The tokens a tenant has.'),
        tenant: termOf('tenant', 'Who pays, monthly.'),
      });
    });

    expect(await edits.edit('rozed-bot', E2E, bucketEdit('What a tenant spends from.'))).toEqual({
      kind: 'saved',
    });
    const { store } = heldIn(github);
    // Both: theirs of another term, and this edit, made again on it.
    expect(store.terms.get('tenant')?.definition).toBe('Who pays, monthly.');
    expect(store.terms.get('bucket')?.definition).toBe('What a tenant spends from.');
    expect(turns.filter((each) => each.includes('graphql MoveTerms'))).toHaveLength(2);
    expect(github.written.map(({ message }) => message)).toEqual([
      'Edit "bucket"',
      'Theirs',
      'Edit "bucket"',
    ]);
  });

  it('never writes over a term changed since it started: it comes back as it is now', async () => {
    const { github } = githubWithFirst();
    const { edits, last, tab } = editsWith(github);
    const changed = await theirs(github, {
      bucket: termOf('bucket', 'Theirs.', ['pail']),
      tenant: termOf('tenant', 'Who pays.'),
    });
    expect(await edits.edit('rozed-bot', E2E, bucketEdit('Mine.'))).toEqual({
      kind: 'changed',
      term: {
        term: 'bucket',
        definition: 'Theirs.',
        aliases: ['pail'],
        written: 'agent',
        by: { login: 'elle-kzn' },
        from: 80,
        at: '2026-11-11T09:30:00Z',
      },
    });
    expect(github.held('rozed-dev/e2e', TERMS)).toBe(changed);
    // The newer definitions, as read for the edit, are the tab's at once.
    expect(last()).toMatchObject({ found: { kind: 'file', commit: changed } });

    // "Save mine": from theirs, it's written, and theirs goes to its changes.
    expect(
      await edits.edit(
        'rozed-bot',
        E2E,
        bucketEdit('Mine.', { base: { definition: 'Theirs.', aliases: ['pail'] } }),
      ),
    ).toEqual({ kind: 'saved' });
    const { store } = heldIn(github);
    expect(store.terms.get('bucket')).toMatchObject({
      definition: 'Mine.',
      aliases: [],
      // Theirs was written whole, with no changes of its own.
      changes: [{ definition: 'Theirs.', written: 'agent', by: { login: 'elle-kzn' } }],
    });
    tab.close();
  });

  it('adds back a term deleted since, once asked to', async () => {
    const { github } = githubWithFirst();
    const { edits } = editsWith(github);
    await theirs(github, { tenant: termOf('tenant', 'Who pays.') });
    expect(await edits.edit('rozed-bot', E2E, bucketEdit('Mine.'))).toEqual({
      kind: 'changed',
      term: null,
    });
    expect(await edits.edit('rozed-bot', E2E, bucketEdit('Mine.', { base: null }))).toEqual({
      kind: 'saved',
    });
    expect(github.written.at(-1)?.message).toBe('Add "bucket"');
    expect(heldIn(github).store.terms.get('bucket')).toMatchObject({
      definition: 'Mine.',
      written: 'human',
    });
  });

  it('settles as saved, writing nothing, where the definitions hold it already', async () => {
    const { github } = githubWithFirst();
    const { edits } = editsWith(github);
    await theirs(github, {
      bucket: termOf('bucket', 'Mine.'),
      tenant: termOf('tenant', 'Who pays.'),
    });
    const written = github.written.length;
    expect(await edits.edit('rozed-bot', E2E, bucketEdit('Mine.'))).toEqual({ kind: 'saved' });
    expect(github.written).toHaveLength(written);
  });

  it('writes one edit of a repository at a time: the second waits, and finds the first', async () => {
    const { github } = githubWithFirst();
    const { edits, turns } = editsWith(github);
    const [one, two] = await Promise.all([
      edits.edit('rozed-bot', E2E, bucketEdit('Mine.')),
      edits.edit('elle-kzn', E2E, bucketEdit('Hers.')),
    ]);
    expect(one).toEqual({ kind: 'saved' });
    expect(two).toMatchObject({ kind: 'changed', term: { definition: 'Mine.' } });
    // Each in a turn of its own, the second after the first.
    expect(turns).toHaveLength(2);
    expect(turns[0]).toMatch(/graphql MoveTerms$/);
    expect(turns[1]).not.toMatch(/MoveTerms/);
  });

  it('gives up once the ref has moved each time, made again three times', async () => {
    const { github } = githubWithFirst();
    const { edits, turns } = editsWith(github);
    github.answer.set('graphql MoveTerms', () =>
      Response.json({
        data: { updateRefs: null },
        errors: [{ type: 'UNPROCESSABLE', path: [], message: 'rejecting non-fast forward update' }],
      }),
    );
    expect(await edits.edit('rozed-bot', E2E, bucketEdit('Mine.'))).toEqual({
      kind: 'refused',
      why: 'changing',
      details: null,
    });
    expect(turns.filter((each) => each.includes('graphql MoveTerms'))).toHaveLength(1 + EDIT_AGAIN);
  });

  it('writes nothing without push access, and says so', async () => {
    const { github, first } = githubWithFirst();
    github.permissions.set('rozed-dev/e2e', 'READ');
    const { edits, last, tab, turns } = editsWith(github);
    expect(await edits.edit('rozed-bot', E2E, bucketEdit('Mine.'))).toEqual({
      kind: 'refused',
      why: 'push',
      details: null,
    });
    expect(turns).toEqual(['graphql TermsAccess']);
    expect(github.written).toEqual([]);
    expect(github.held('rozed-dev/e2e', TERMS)).toBe(first);
    expect(last()).toMatchObject({ push: false });
    tab.close();
  });

  it('fails with the push-access reason when access went after it was asked', async () => {
    const { github, first } = githubWithFirst();
    const { edits, last, tab } = editsWith(github);
    github.before.set('rozed-dev/e2e/git/trees', () => {
      github.permissions.set('rozed-dev/e2e', 'READ');
    });
    expect(await edits.edit('rozed-bot', E2E, bucketEdit('Mine.'))).toMatchObject({
      kind: 'refused',
      why: 'push',
    });
    expect(github.held('rozed-dev/e2e', TERMS)).toBe(first);
    expect(last()).toMatchObject({ push: false });
    tab.close();
  });

  it('says a rule of the repository’s blocks it, in GitHub’s words behind Details', async () => {
    const { github } = githubWithFirst();
    const { edits } = editsWith(github);
    github.answer.set('rozed-dev/e2e/git/commits', () =>
      Response.json({ message: 'Repository rule violations found' }, { status: 422 }),
    );
    expect(await edits.edit('rozed-bot', E2E, bucketEdit('Mine.'))).toEqual({
      kind: 'refused',
      why: 'rule',
      details: expect.stringMatching(/rule violations/),
    });
  });

  it('settles a move whose answer was lost by reading the ref: saved where it moved', async () => {
    const { github } = githubWithFirst();
    const { edits } = editsWith(github);
    github.answer.set('graphql MoveTerms', () => {
      github.point('rozed-dev/e2e', TERMS, github.written.at(-1)?.sha ?? '', 'commit');
      throw new TypeError('fetch failed');
    });
    expect(await edits.edit('rozed-bot', E2E, bucketEdit('Mine.'))).toEqual({ kind: 'saved' });
    // Never sent again.
    expect(github.paths().filter((path) => path === 'graphql MoveTerms')).toHaveLength(1);
    expect(heldIn(github).store.terms.get('bucket')?.definition).toBe('Mine.');
  });

  it('fails, unsent again, where the ref says a move whose answer was lost wasn’t made', async () => {
    const { github, first } = githubWithFirst();
    const { edits } = editsWith(github);
    github.answer.set('graphql MoveTerms', () => {
      throw new TypeError('fetch failed');
    });
    expect(await edits.edit('rozed-bot', E2E, bucketEdit('Mine.'))).toMatchObject({
      kind: 'failed',
      cause: { kind: 'timeout' },
    });
    expect(github.paths().filter((path) => path === 'graphql MoveTerms')).toHaveLength(1);
    expect(github.held('rozed-dev/e2e', TERMS)).toBe(first);
  });

  it('is unconfirmed where the ref can’t be read after a lost answer, which Check again settles', async () => {
    const { github } = githubWithFirst();
    const { edits } = editsWith(github);
    const refs = 'rozed-dev/e2e/git/matching-refs/lo/terms';
    github.answer.set('graphql MoveTerms', () => {
      github.point('rozed-dev/e2e', TERMS, github.written.at(-1)?.sha ?? '', 'commit');
      github.answer.set(refs, () => {
        throw new TypeError('fetch failed');
      });
      throw new TypeError('fetch failed');
    });
    const outcome = await edits.edit('rozed-bot', E2E, bucketEdit('Mine.'));
    const commit = github.written.at(-1)?.sha ?? '';
    expect(outcome).toEqual({ kind: 'unconfirmed', commit, details: expect.any(String) });

    // Still unread: unconfirmed again.
    expect(await edits.check('rozed-bot', E2E, commit)).toMatchObject({ kind: 'unconfirmed' });
    github.answer.delete(refs);
    expect(await edits.check('rozed-bot', E2E, commit)).toEqual({ kind: 'saved' });
    // And past it, someone else's after it: saved too.
    await theirs(github, { bucket: termOf('bucket', 'Later.') });
    expect(await edits.check('rozed-bot', E2E, commit)).toEqual({ kind: 'saved' });
  });

  it('Check again says it wasn’t saved where the ref doesn’t hold it', async () => {
    const { github, first } = githubWithFirst();
    const { edits } = editsWith(github);
    // A commit the ref held, and then didn't.
    const gone = await theirs(github, { bucket: termOf('bucket', 'Theirs.') });
    github.point('rozed-dev/e2e', TERMS, first, 'commit');
    expect(await edits.check('rozed-bot', E2E, gone)).toEqual({
      kind: 'failed',
      cause: { kind: 'timeout' },
      details: null,
    });
  });

  it('fails where GitHub says only that something went wrong, and the ref stayed', async () => {
    const { github, first } = githubWithFirst();
    const { edits } = editsWith(github);
    github.answer.set('graphql MoveTerms', () =>
      Response.json({ data: { updateRefs: null }, errors: [{ message: WENT_WRONG }] }),
    );
    expect(await edits.edit('rozed-bot', E2E, bucketEdit('Mine.'))).toEqual({
      kind: 'failed',
      cause: { kind: 'github' },
      details: expect.stringMatching(/Something went wrong/),
    });
    expect(github.held('rozed-dev/e2e', TERMS)).toBe(first);
  });

  it('fails, unsent, while GitHub has asked Lo to hold off', async () => {
    const { github } = githubWithFirst();
    const { edits } = editsWith(github, { pausedUntil: NOW + 60_000 });
    expect(await edits.edit('rozed-bot', E2E, bucketEdit('Mine.'))).toEqual({
      kind: 'failed',
      cause: { kind: 'rateLimit', resets: NOW + 60_000 },
      details: null,
    });
    expect(github.asked).toEqual([]);
  });

  it('refuses what the definitions can’t hold, writing nothing', async () => {
    const { github } = githubWithFirst();
    const { edits } = editsWith(github);
    expect(
      await edits.edit('rozed-bot', E2E, bucketEdit('Mine.', { aliases: ['Tenant'] })),
    ).toMatchObject({ kind: 'invalid', message: expect.stringMatching(/another term/) });
    expect(github.written).toEqual([]);
  });

  it('makes the definitions where there are none', async () => {
    const github = new FakeGithub();
    const { edits } = editsWith(github);
    expect(await edits.edit('rozed-bot', E2E, bucketEdit('Mine.', { base: null }))).toEqual({
      kind: 'saved',
    });
    expect(github.written[0]?.parents).toEqual([]);
    expect(heldIn(github).store.terms.get('bucket')?.definition).toBe('Mine.');
  });

  it('changes nothing where the ref holds nothing an edit can change', async () => {
    const github = new FakeGithub();
    github.push('rozed-dev/e2e', TERMS, overview('odd', { 'other.json': '{}' }));
    const { edits } = editsWith(github);
    expect(await edits.edit('rozed-bot', E2E, bucketEdit('Mine.'))).toEqual({
      kind: 'unreadable',
      why: { kind: 'notStore', why: 'missing' },
    });
    expect(github.written).toEqual([]);
  });
});

describe('the time an edit is at', () => {
  it('is GitHub’s, to the second', () => {
    const at = Date.parse('2026-11-28T12:00:00.750Z');
    expect(githubTime(at, { githubAhead: () => undefined })).toBe('2026-11-28T12:00:00Z');
    expect(githubTime(at, { githubAhead: () => 90_500 })).toBe('2026-11-28T12:01:31Z');
  });
});
