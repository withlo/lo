import { parseOid } from '@lo/git';
import { GithubClient, Token } from '@lo/github';
import { replayFetch } from '@lo/testing';
import { APP_PULL, RepoServer } from '@lo/testing/git';
import { describe, expect, it, onTestFinished } from 'vitest';

import type { Changed, TreeState } from '../contract.ts';
import { cloneOf, e2eClone, e2eInfo, READY, replayClient, treeTab } from './test/support.ts';

/** The paths of a whole listing, or of the root's entries. */
function listed(state: TreeState): string[] {
  const { listing } = state;
  if (listing.kind === 'whole') return listing.entries.map((entry) => entry.path.text);
  if (listing.kind === 'folders')
    return listing.root.map((entry) => `${entry.kind} ${entry.path.text}`);
  return [];
}

/** The changes as a line each: how, the path, a rename's old path, why it's generated. */
function changes(state: TreeState): string[] {
  return (state.changes ?? [])
    .map(
      (change: Changed) =>
        `${change.change} ${change.path.text}${change.previous ? ` ← ${change.previous.text}` : ''}${change.generated ? ` (${change.generated})` : ''}`,
    )
    .toSorted();
}

/** A path of `bytes` bytes, many folders deep under src, to `evil.ts`. */
const longPath = (bytes: number) =>
  `src/${'deep/'.repeat(Math.ceil(bytes / 5)).slice(0, bytes - 11)}evil.ts`;

/** #78's changes, as the local copy and GitHub both list them. */
const E2E_CHANGES = [
  'added data/numbers.txt',
  'added src/text/wrap.ts',
  'deleted src/legacy.ts',
  'modified assets/mark.png',
  'modified pnpm-lock.yaml (lockfile)',
  'modified src/format.ts',
  'renamed src/parser.ts ← src/parse.ts',
];

const E2E_FILES = [
  'README.md',
  'assets/mark.png',
  'data/numbers.txt',
  'pnpm-lock.yaml',
  'src/format.ts',
  'src/parser.ts',
  'src/text/wrap.ts',
];

/** GitHub as rozed-bot sees it in `cassette`, counting the requests made. */
function githubFrom(cassette: string) {
  const client = replayClient(cassette);
  let requests = 0;
  return {
    get requests() {
      return requests;
    },
    github: <T>(_acting: unknown, request: (client: GithubClient) => Promise<T>) => {
      requests++;
      return request(client);
    },
  };
}

describe('TreeTab', () => {
  it('reads the files and what changed from the local copy once it’s ready at the head on screen', async () => {
    const repo = await e2eClone();
    const { tree, settled } = treeTab({ clone: () => Promise.resolve(repo) });
    tree.update(e2eInfo(READY));
    const state = await settled((sent) => sent.changes !== null);
    expect(state).toMatchObject({
      id: 't1',
      at: APP_PULL.head,
      from: 'local',
      changesFrom: 'local',
      partial: false,
      problem: null,
      listing: { kind: 'whole' },
    });
    expect(listed(state)).toEqual(E2E_FILES);
    expect(changes(state)).toEqual(E2E_CHANGES);
  });

  it('reads them from GitHub until the local copy is ready, then from the copy', async () => {
    const repo = await e2eClone();
    const github = githubFrom('rest_tree_e2e');
    const { tree, sent, settled } = treeTab({
      clone: () => Promise.resolve(repo),
      github: github.github,
    });
    tree.update(e2eInfo());
    const fromGithub = await settled((state) => state.changes !== null);
    expect(fromGithub).toMatchObject({ from: 'github', changesFrom: 'github', partial: false });
    expect(listed(fromGithub)).toEqual(E2E_FILES);
    expect(changes(fromGithub)).toEqual(E2E_CHANGES);
    // The first thing it said: nothing yet, at the head on screen.
    expect(sent[0]).toMatchObject({
      at: APP_PULL.head,
      listing: { kind: 'loading' },
      changes: null,
    });

    tree.update(e2eInfo(READY));
    const fromLocal = await settled((state) => state.changesFrom === 'local');
    expect(fromLocal).toMatchObject({ from: 'local', changesFrom: 'local' });
    expect(changes(fromLocal)).toEqual(E2E_CHANGES);
    // GitHub was asked once for the tree and once for the files, and not again.
    expect(github.requests).toBe(2);
  });

  it('asks GitHub nothing when the local copy is ready from the start', async () => {
    const repo = await e2eClone();
    const github = githubFrom('rest_tree_e2e');
    const { tree, settled } = treeTab({
      clone: () => Promise.resolve(repo),
      github: github.github,
    });
    tree.update(e2eInfo(READY));
    await settled((state) => state.changes !== null);
    expect(github.requests).toBe(0);
  });

  it('asks GitHub nothing about a head Lo saved until GitHub says it’s still the head', async () => {
    const github = githubFrom('rest_tree_e2e');
    const { tree, settled } = treeTab({ github: github.github });
    tree.update({ ...e2eInfo(), provisional: true });
    expect(github.requests).toBe(0);
    tree.update(e2eInfo());
    await settled((state) => state.changes !== null);
    expect(github.requests).toBe(2);
  });

  it('shows only the changed files while GitHub lists the repository’s files only in part', async () => {
    // GitHub's answer for a tree it cut short, standing in for #78's.
    const truncated = replayFetch('rest_tree_truncated');
    const files = replayFetch('rest_tree_e2e');
    const client = new GithubClient({
      token: new Token('gho_FAKE'),
      fetch: (input, init) =>
        (input instanceof Request ? input.url : input.toString()).includes('/git/trees/')
          ? truncated(
              'https://api.github.com/repos/torvalds/linux/git/trees/067c5c24cef23d913b67eaaf71ae67e7169a6620?recursive=1',
              init,
            )
          : files(input, init),
    });
    const { tree, settled } = treeTab({ github: (_acting, request) => request(client) });
    tree.update(e2eInfo());
    const state = await settled((sent) => sent.changes !== null);
    expect(state.listing).toEqual({
      kind: 'changed',
      why: 'GitHub lists only part of this repository’s files, so the tree shows the changed ones until the local copy is ready.',
    });
    expect(changes(state)).toEqual(E2E_CHANGES);
  });

  it('says why when GitHub can’t be read, and shows what the local copy has once it’s ready', async () => {
    const repo = await e2eClone();
    const { tree, settled, lines } = treeTab({
      clone: () => Promise.resolve(repo),
      github: () => Promise.reject(new Error('GitHub is down')),
    });
    tree.update(e2eInfo());
    const failed = await settled((state) => state.listing.kind === 'changed');
    expect(failed).toMatchObject({
      listing: {
        kind: 'changed',
        why: 'Lo couldn’t read the repository’s files from GitHub (GitHub is down), so the tree shows the changed ones until the local copy is ready.',
      },
      changes: null,
      problem: 'Lo couldn’t read the changed files from GitHub: GitHub is down',
    });
    expect(lines).toContain('reading the files from GitHub: GitHub is down');

    tree.update(e2eInfo(READY));
    const ready = await settled((state) => state.changesFrom === 'local');
    expect(ready).toMatchObject({ listing: { kind: 'whole' }, problem: null });
  });

  it('starts again at a new head on screen, and drops what the last one read', async () => {
    const repo = await e2eClone();
    const { tree, sent, settled } = treeTab({ clone: () => Promise.resolve(repo) });
    tree.update(e2eInfo(READY));
    await settled((state) => state.changes !== null);
    const first = { ...e2eInfo(READY), shown: APP_PULL.firstHead };
    tree.update({ ...first, local: { kind: 'fetching', progress: null, attempt: 1 } });
    expect(sent.at(-1)).toMatchObject({
      at: APP_PULL.firstHead,
      listing: { kind: 'loading' },
      changes: null,
    });
    expect(() => tree.folders(APP_PULL.head, [{ text: 'src' }])).toThrow(/another commit/);
  });

  it('marks what .gitattributes calls generated, and lockfiles unless it says otherwise', async () => {
    const server = new RepoServer();
    onTestFinished(() => server.remove());
    const remote = server.repo('o', 'r');
    remote.write('README.md', 'base\n').write('Cargo.lock', 'a\n').commit('base');
    remote.publish('refs/heads/trunk');
    const base = remote.head();
    remote
      .write('.gitattributes', 'gen/** linguist-generated\nCargo.lock -linguist-generated\n')
      .write('gen/api.ts', 'export {};\n')
      .write('src/a.ts', 'a\n')
      .write('Cargo.lock', 'b\n')
      .write('yarn.lock', 'c\n');
    const head = remote.commit('head');
    remote.publish('refs/pull/1/head');
    const repo = await cloneOf(server.baseUrl, {
      owner: 'o',
      name: 'r',
      number: 1,
      head,
      baseBranch: 'trunk',
      base,
    });
    const { tree, settled } = treeTab({ clone: () => Promise.resolve(repo) });
    tree.update({
      ...e2eInfo({ kind: 'ready', head, base, mergeBase: base, offline: false }),
      repository: { owner: 'o', name: 'r' },
      number: 1,
      shown: head,
    });
    const state = await settled((sent) => sent.changes !== null);
    expect(changes(state)).toEqual([
      'added .gitattributes',
      'added gen/api.ts (attribute)',
      'added src/a.ts',
      'added yarn.lock (lockfile)',
      'modified Cargo.lock',
    ]);
  });

  it('sends a path that isn’t UTF-8 as its bytes, beside the text it shows as', async () => {
    const server = new RepoServer();
    onTestFinished(() => server.remove());
    const remote = server.repo('o', 'r');
    remote.write('README.md', 'base\n').commit('base');
    remote.publish('refs/heads/trunk');
    const base = remote.head();
    // "café.txt" in Latin-1.
    const cafe = Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x2e, 0x74, 0x78, 0x74]);
    const head = remote.commitWithNames([[cafe, 'latin-1\n']], 'names');
    remote.publish('refs/pull/1/head');
    const repo = await cloneOf(server.baseUrl, {
      owner: 'o',
      name: 'r',
      number: 1,
      head,
      baseBranch: 'trunk',
      base,
    });
    const { tree, settled } = treeTab({ clone: () => Promise.resolve(repo) });
    tree.update({
      ...e2eInfo({ kind: 'ready', head, base, mergeBase: base, offline: false }),
      shown: head,
    });
    const state = await settled((sent) => sent.changes !== null);
    const path = { text: 'caf�.txt', hex: cafe.toString('hex') };
    expect(state.listing).toEqual({
      kind: 'whole',
      entries: [
        { path: { text: 'README.md' }, kind: 'file' },
        { path, kind: 'file' },
      ],
    });
    expect(state.changes).toEqual([{ path, change: 'added', previous: null, generated: null }]);
    expect((await tree.find('caf')).found).toEqual([{ path, changed: true, matched: [0, 1, 2] }]);
  });

  it('sends a large repository folder by folder', async () => {
    const repo = await e2eClone();
    const { tree, settled } = treeTab({ clone: () => Promise.resolve(repo) }, 3);
    tree.update(e2eInfo(READY));
    const state = await settled((sent) => sent.changes !== null);
    expect(listed(state)).toEqual([
      'folder assets',
      'folder data',
      'folder src',
      'file README.md',
      'file pnpm-lock.yaml',
    ]);
    expect(
      tree.folders(APP_PULL.head, [
        { text: 'src' },
        { text: 'src/text' },
        { text: 'nowhere' },
        { text: 'src' },
      ]),
    ).toEqual([
      {
        path: { text: 'src' },
        entries: [
          { path: { text: 'src/text' }, kind: 'folder' },
          { path: { text: 'src/format.ts' }, kind: 'file' },
          { path: { text: 'src/parser.ts' }, kind: 'file' },
        ],
      },
      {
        path: { text: 'src/text' },
        entries: [{ path: { text: 'src/text/wrap.ts' }, kind: 'file' }],
      },
    ]);
  });

  it('finds files by name, the changed ones first', async () => {
    const repo = await e2eClone();
    const { tree, settled } = treeTab({ clone: () => Promise.resolve(repo) });
    tree.update(e2eInfo(READY));
    await settled((sent) => sent.changes !== null);
    const found = await tree.find('e');
    expect(found.at).toBe(APP_PULL.head);
    // Five changed files hold an e, then README.md, which doesn't change.
    expect(found.found.map((file) => file.changed)).toEqual([true, true, true, true, true, false]);
    expect(found.found.at(-1)?.path.text).toBe('README.md');
    expect(found.total).toBe(6);
    expect((await tree.find('wrap')).found).toEqual([
      { path: { text: 'src/text/wrap.ts' }, changed: true, matched: [9, 10, 11, 12] },
    ]);
    // A deleted file is found too: it's in the diff.
    expect((await tree.find('legacy')).found.map((file) => file.path.text)).toEqual([
      'src/legacy.ts',
    ]);
  });

  it('asks GitHub what the local copy couldn’t say only once GitHub has given the head', async () => {
    const repo = await e2eClone();
    const github = githubFrom('rest_tree_e2e');
    const { tree, settled } = treeTab({
      clone: () => Promise.resolve(repo),
      github: github.github,
    });
    // No history in common with the base, so the copy can't say what changed.
    const unrelated = {
      ...e2eInfo({
        kind: 'ready',
        head: APP_PULL.head,
        base: APP_PULL.base,
        mergeBase: null,
        offline: false,
      }),
      provisional: true,
    };
    tree.update(unrelated);
    await settled((state) => state.from === 'local');
    expect(github.requests).toBe(0);
    tree.update({ ...unrelated, provisional: false });
    const state = await settled((sent) => sent.changes !== null);
    expect(state).toMatchObject({ from: 'local', changesFrom: 'github' });
    // Only the files: the copy listed the tree.
    expect(github.requests).toBe(1);
  });

  it('tries GitHub again, waiting longer each time, after it fails', async () => {
    const replay = githubFrom('rest_tree_e2e');
    let failures = 0;
    const waits: number[] = [];
    const { tree, settled } = treeTab(
      {
        github: (acting, request) =>
          failures++ < 2
            ? Promise.reject(new Error('GitHub is down'))
            : replay.github(acting, request),
      },
      undefined,
      (count) => {
        waits.push(count);
        return 5;
      },
    );
    tree.update(e2eInfo());
    const state = await settled((sent) => sent.changes !== null && sent.from === 'github');
    expect(changes(state)).toEqual(E2E_CHANGES);
    expect(state.problem).toBeNull();
    // Both reads failed once, as one failure in a row, then worked.
    expect(waits).toEqual([1]);
  });

  it('tries the local copy again after it fails', async () => {
    const repo = await e2eClone();
    let failed = false;
    const flaky = new Proxy(repo, {
      get(target, property) {
        if (property === 'tree' && !failed) {
          failed = true;
          return () => Promise.reject(new Error('the clone is busy'));
        }
        const value: unknown = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    const { tree, settled, lines } = treeTab(
      { clone: () => Promise.resolve(flaky) },
      undefined,
      () => 5,
    );
    tree.update(e2eInfo(READY));
    const state = await settled((sent) => sent.listing.kind === 'whole' && sent.changes !== null);
    expect(state).toMatchObject({ from: 'local', problem: null });
    expect(lines).toContain(`listing the files at ${APP_PULL.head}: the clone is busy`);
  });

  it('leaves out an unchanged file whose path is too long to key a map by, and says how many', async () => {
    const server = new RepoServer();
    onTestFinished(() => server.remove());
    const remote = server.repo('o', 'r');
    // Folders a disk takes, in a path longer than the tree keys a map by, which goes straight into
    // the index.
    const long = Buffer.from(`${'abcdefgh/'.repeat(120)}deep.txt`);
    remote.write('README.md', 'base\n');
    const base = remote.commitWithNames([[long, 'deep\n']], 'base');
    remote.publish('refs/heads/trunk');
    remote.write('short.txt', 'short\n');
    const head = remote.commit('short');
    remote.publish('refs/pull/1/head');
    const repo = await cloneOf(server.baseUrl, {
      owner: 'o',
      name: 'r',
      number: 1,
      head,
      baseBranch: 'trunk',
      base,
    });
    expect((await repo.tree(parseOid(head))).map((entry) => entry.path.length)).toContain(
      long.length,
    );
    const { tree, settled } = treeTab({ clone: () => Promise.resolve(repo) });
    tree.update({
      ...e2eInfo({ kind: 'ready', head, base, mergeBase: base, offline: false }),
      shown: head,
    });
    const state = await settled((sent) => sent.changes !== null);
    expect(listed(state)).toEqual(['README.md', 'short.txt']);
    expect(changes(state)).toEqual(['added short.txt']);
    expect(state.omitted).toBe(1);
  });

  it('shows every changed file, however long its path, known by its digest, and finds it', async () => {
    const paths = [longPath(1_207), longPath(20_480)];
    const head = APP_PULL.head;
    // GitHub as it would answer for a pull request adding them.
    const answer = (url: string): unknown =>
      url.includes('/git/trees/')
        ? {
            sha: head,
            truncated: false,
            tree: [
              { path: 'README.md', type: 'blob', mode: '100644', sha: 'a'.repeat(40) },
              ...paths.map((path) => ({ path, type: 'blob', mode: '100644', sha: 'b'.repeat(40) })),
            ],
          }
        : paths.map((filename) => ({
            filename,
            status: 'added',
            additions: 1,
            deletions: 0,
            changes: 1,
            contents_url: `https://api.github.com/repos/o/r/contents/x?ref=${head}`,
          }));
    const client = new GithubClient({
      token: new Token('gho_FAKE'),
      fetch: (input) =>
        Promise.resolve(
          new Response(
            JSON.stringify(answer(input instanceof Request ? input.url : input.toString())),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
        ),
    });
    const { tree, settled } = treeTab({ github: (_acting, request) => request(client) });
    tree.update(e2eInfo());
    const state = await settled((sent) => sent.changes !== null && sent.from === 'github');
    expect(
      state.changes?.map((change) => [change.path.text.length, change.path.digest?.length]),
    ).toEqual([
      [1_207, 64],
      [20_480, 64],
    ]);
    // Neither is in the listing, which keys maps by its paths, and neither counts as left out.
    expect(listed(state)).toEqual(['README.md']);
    expect(state.omitted).toBe(0);
    const start = performance.now();
    const found = await tree.find('evil');
    expect(performance.now() - start).toBeLessThan(1_000);
    expect(found.found.map((file) => file.path.text.length).toSorted((a, b) => a - b)).toEqual([
      1_207, 20_480,
    ]);
    expect(found.found.every((file) => file.changed)).toBe(true);
    // Where it matched is by the whole path's indices: the name at its end.
    expect(found.found.find((file) => file.path.text.length === 20_480)?.matched).toEqual([
      20_473, 20_474, 20_475, 20_476,
    ]);
  });
});
