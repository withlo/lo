// A pull request's overview from GitHub's REST API: its ref watched with an ETag, the commit it
// holds and that commit's files, raw, recorded from rozed-dev/e2e#80's.

import { createHash } from 'node:crypto';

import { replayFetch } from '@lo/testing';
import { describe, expect, test } from 'vitest';

import { GithubClient } from '../src/client.ts';
import { GithubError } from '../src/errors.ts';
import {
  blobBytes,
  commitSummary,
  overviewRef,
  readOverviewRef,
  watchOverviewRef,
} from '../src/overviews.ts';
import { RepoRef } from '../src/refs.ts';
import { Token } from '../src/token.ts';
import { repoTree } from '../src/trees.ts';
import { E2E_OVERVIEW } from './scenarios/overviews.ts';

const E2E = new RepoRef('rozed-dev', 'e2e');

const signedIn = (fetch: typeof globalThis.fetch) =>
  new GithubClient({ fetch, token: new Token('gho_FAKE') });

/** The ID git gives a blob of `bytes`. */
function blobId(bytes: Uint8Array): string {
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}

describe('the ref', () => {
  test('holds the overview, and costs nothing to ask again while it holds the same', async () => {
    const fetch = replayFetch('rest_overview_refs_e2e');
    const client = signedIn(fetch);
    const first = await watchOverviewRef(client, E2E, 80, undefined);
    expect(first).toEqual({
      notModified: false,
      value: { kind: 'commit', sha: E2E_OVERVIEW.commit },
      etag: expect.stringMatching(/^W\/"[0-9a-f]{64}"$/),
    });
    if (first.notModified) throw new Error('unreachable');
    expect(await watchOverviewRef(client, E2E, 80, first.etag)).toEqual({ notModified: true });
    expect(fetch.seen.map(({ url }) => url)).toEqual([
      'https://api.github.com/repos/rozed-dev/e2e/git/matching-refs/lo/pr/80',
      'https://api.github.com/repos/rozed-dev/e2e/git/matching-refs/lo/pr/80',
    ]);
    expect(fetch.seen[1]?.headers.get('if-none-match')).toBe(first.etag);
  });

  test("counts only the pull request's own ref, never another it starts", async () => {
    const client = signedIn(replayFetch('rest_overview_refs_e2e'));
    // #8's ref starts #80's, which GitHub lists.
    const eight = await watchOverviewRef(client, E2E, 8, undefined);
    expect(eight).toMatchObject({ notModified: false, value: { kind: 'none' } });
    const nine = await watchOverviewRef(client, E2E, 9, undefined);
    expect(nine).toMatchObject({ notModified: false, value: { kind: 'none' } });
    // An empty answer has an ETag too, so a pull request without an overview is watched free.
    if (nine.notModified || nine.etag === undefined) throw new Error('no ETag for an empty list');
    expect(await watchOverviewRef(client, E2E, 9, nine.etag)).toEqual({ notModified: true });
  });

  test('that holds a tag, a tree or a blob holds no overview', () => {
    const sha = 'a'.repeat(40);
    for (const type of ['tag', 'tree', 'blob']) {
      const answer = [{ ref: overviewRef(5), object: { sha, type } }];
      expect(readOverviewRef(5)(answer)).toEqual({ kind: 'other', type, sha });
    }
  });

  test("refuses an answer that isn't GitHub's, or names no object", () => {
    const read = readOverviewRef(5);
    expect(() => read({})).toThrow(GithubError);
    expect(() =>
      read([{ ref: 'refs/lo/pr/5', object: { sha: '../../user', type: 'commit' } }]),
    ).toThrow("isn't an object's ID");
    expect(() => read([{ ref: 'refs/lo/pr/5' }])).toThrow(GithubError);
  });

  test("refuses a number that isn't a pull request's", () => {
    expect(() => watchOverviewRef(signedIn(fetch), E2E, 0, undefined)).toThrow(RangeError);
    expect(() => watchOverviewRef(signedIn(fetch), E2E, 1.5, undefined)).toThrow(RangeError);
  });
});

describe('the commit', () => {
  test('says who wrote it, by their login and name, and when', async () => {
    const fetch = replayFetch('rest_overview_e2e');
    expect(await commitSummary(signedIn(fetch), E2E, E2E_OVERVIEW.commit)).toEqual({
      sha: E2E_OVERVIEW.commit,
      tree: E2E_OVERVIEW.tree,
      login: 'rozed-bot',
      name: 'rozed-bot',
      committedAt: Date.parse('2026-11-11T09:30:00Z'),
    });
  });

  test('has no login when GitHub maps the author to no account', async () => {
    const answer = {
      sha: E2E_OVERVIEW.commit,
      author: null,
      commit: {
        author: { name: 'A. Writer', date: '2026-11-11T09:00:00Z' },
        committer: { name: 'A. Writer', date: '2026-11-11T09:30:00Z' },
        tree: { sha: E2E_OVERVIEW.tree },
      },
    };
    const client = signedIn(async () => Response.json(answer));
    expect(await commitSummary(client, E2E, E2E_OVERVIEW.commit)).toMatchObject({
      login: undefined,
      name: 'A. Writer',
      committedAt: Date.parse('2026-11-11T09:30:00Z'),
    });
  });

  test('lists its files with their sizes, and its folders', async () => {
    const tree = await repoTree(signedIn(replayFetch('rest_overview_e2e')), E2E, E2E_OVERVIEW.tree);
    expect(tree.truncated).toBe(false);
    expect(tree.items.map(({ path, type, size }) => ({ path, type, size }))).toEqual([
      { path: 'artifact.md', type: 'blob', size: 2016 },
      { path: 'figures', type: 'tree', size: undefined },
      { path: 'figures/flow.svg', type: 'blob', size: 1389 },
    ]);
  });
});

describe('a blob', () => {
  test('comes raw, as the bytes its ID names', async () => {
    const fetch = replayFetch('rest_overview_e2e');
    const client = signedIn(fetch);
    const artifact = await blobBytes(client, E2E, E2E_OVERVIEW.artifact);
    const figure = await blobBytes(client, E2E, E2E_OVERVIEW.figure);
    expect(blobId(artifact)).toBe(E2E_OVERVIEW.artifact);
    expect(blobId(figure)).toBe(E2E_OVERVIEW.figure);
    expect(new TextDecoder().decode(artifact)).toMatch(/^---\nformat: 1\npr: 80\n/);
    expect(fetch.seen.map(({ headers }) => headers.get('accept'))).toEqual([
      'application/vnd.github.raw+json',
      'application/vnd.github.raw+json',
    ]);
  });

  test("is asked for only by an object's ID", async () => {
    await expect(blobBytes(signedIn(fetch), E2E, 'HEAD')).rejects.toThrow("isn't an object's ID");
  });
});
