// A commit's whole tree from GitHub's REST API: rozed-dev/e2e's, recorded, and a tree GitHub lists
// only in part.

import { replayFetch } from '@lo/testing';
import { expect, test } from 'vitest';

import { GithubClient } from '../src/client.ts';
import { GithubError } from '../src/errors.ts';
import { RepoRef } from '../src/refs.ts';
import { Token } from '../src/token.ts';
import { readRepoTree, repoTree, treePath } from '../src/trees.ts';
import { E2E_HEAD } from './scenarios/trees.ts';

const signedIn = (fetch: typeof globalThis.fetch) =>
  new GithubClient({ fetch, token: new Token('gho_FAKE') });

test("a commit's tree lists every file and folder, however deep", async () => {
  const fetch = replayFetch('rest_tree_e2e');
  const tree = await repoTree(signedIn(fetch), new RepoRef('rozed-dev', 'e2e'), E2E_HEAD);

  expect(tree.truncated).toBe(false);
  expect(tree.items.map((item) => `${item.type} ${item.path}`)).toEqual([
    'blob README.md',
    'tree assets',
    'blob assets/mark.png',
    'tree data',
    'blob data/numbers.txt',
    'blob pnpm-lock.yaml',
    'tree src',
    'blob src/format.ts',
    'blob src/parser.ts',
    'tree src/text',
    'blob src/text/wrap.ts',
  ]);
  expect(tree.items.find((item) => item.path === 'assets/mark.png')).toEqual({
    path: 'assets/mark.png',
    type: 'blob',
    mode: '100644',
    sha: '1eb423c2049dd10874358903fc4d8b19f31ebed6',
    size: 73,
  });
  // A folder has no size.
  expect(tree.items.find((item) => item.path === 'src')?.size).toBeUndefined();
  const [seen] = fetch.seen;
  expect(seen?.url).toBe(
    `https://api.github.com/repos/rozed-dev/e2e/git/trees/${E2E_HEAD}?recursive=1`,
  );
});

test('a tree GitHub lists only in part says so', async () => {
  const sha = '067c5c24cef23d913b67eaaf71ae67e7169a6620';
  const tree = await repoTree(
    signedIn(replayFetch('rest_tree_truncated')),
    new RepoRef('torvalds', 'linux'),
    sha,
  );
  expect(tree.truncated).toBe(true);
  expect(tree.items.at(-1)?.path).toBe('Documentation/.renames.txt');
});

test('a ref with characters a path would read otherwise is escaped', () => {
  expect(treePath(new RepoRef('o', 'r'), 'a b#c')).toBe(
    '/repos/o/r/git/trees/a%20b%23c?recursive=1',
  );
});

const readTag = () =>
  readRepoTree({ sha: 'a', tree: [{ path: 'x', type: 'tag', mode: '1', sha: 'b' }] });

test('an entry of a kind Lo doesn’t know is a decode error', () => {
  expect(readTag).toThrow(GithubError);
  expect(readTag).toThrow(/type is "tag"/);
  expect(() => readRepoTree({ sha: 'a', tree: {} })).toThrow(/aren't a list/);
});
