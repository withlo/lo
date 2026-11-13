// The files that changed between two commits, from GitHub's REST API: comparisons of layers of a
// tree of pull requests on rozed-dev/e2e, recorded, and answers GitHub could give, written here.

import { Replay, replayFetch, type Interaction, type Json } from '@lo/testing';
import { describe, expect, test } from 'vitest';

import { GithubClient } from '../src/client.ts';
import {
  comparisonPath,
  MAX_COMPARISON_FILES,
  readComparedFiles,
  readComparison,
} from '../src/comparisons.ts';
import { GithubError } from '../src/errors.ts';
import { fileHead, parsedPatch } from '../src/files.ts';
import { RepoRef } from '../src/refs.ts';
import { Token } from '../src/token.ts';
import { E2E_HEADS, MISSING_COMMIT } from './scenarios/comparisons.ts';

const E2E = new RepoRef('rozed-dev', 'e2e');
const { b, c, d } = E2E_HEADS;

const signedIn = (fetch: typeof globalThis.fetch) =>
  new GithubClient({ fetch, token: new Token('gho_FAKE') });

const url = (base: string, head: string) =>
  `https://api.github.com/repos/rozed-dev/e2e/compare/${base}...${head}?per_page=1`;

describe('recorded', () => {
  test("lists what a layer changes on the one below, as a pull request's files are", async () => {
    const fetch = replayFetch('rest_comparison_e2e');
    const read = await readComparison(signedIn(fetch), E2E, b, c, undefined);
    expect(read).toMatchObject({
      base: b,
      head: c,
      capped: false,
      etag: expect.stringMatching(/^W\/"[0-9a-f]{64}"$/),
    });
    expect(read.files.map(({ filename, status }) => [filename, status])).toEqual([
      ['e2/c.txt', 'added'],
    ]);
    const [file] = read.files;
    expect(file && fileHead(file)).toBe(c);
    expect(file && parsedPatch(file)?.hunks[0]?.lines).toEqual([
      { kind: 'added', text: 'Layer c of fixture E2.' },
    ]);
    // One commit a page: the files come whole on the first, and the commits aren't wanted.
    expect(fetch.seen.map((seen) => seen.url)).toEqual([url(b, c)]);
  });

  test('costs nothing to ask again while it holds the same', async () => {
    const fetch = replayFetch('rest_comparison_e2e');
    const client = signedIn(fetch);
    const first = await readComparison(client, E2E, b, c, undefined);
    const again = await readComparison(client, E2E, b, c, first);
    expect(again).toEqual(first);
    // A copy, so changing one leaves the other.
    expect(again).not.toBe(first);
    expect(fetch.seen.map((seen) => seen.headers.get('if-none-match'))).toEqual([null, first.etag]);
  });

  test('compares a layer with the head of the one whose commits it holds', async () => {
    // #6 targets main, so GitHub's own diff of it holds #2's, #3's and #4's changes too.
    const read = await readComparison(signedIn(replayFetch('rest_comparison_e2e')), E2E, c, d, {
      base: b,
      head: c,
      files: [],
      capped: false,
      etag: 'W/"of-another-comparison"',
    });
    expect(read.files.map(({ filename }) => filename)).toEqual(['e2/d.txt']);
    expect(read.head).toBe(d);
  });

  test("of a commit the repository doesn't have isn't found", async () => {
    const fetch = replayFetch('rest_comparison_e2e');
    const missing = readComparison(signedIn(fetch), E2E, MISSING_COMMIT, c, undefined);
    await expect(missing).rejects.toMatchObject({ detail: { kind: 'notFound' } });
    expect(fetch.seen.map((seen) => seen.url)).toEqual([url(MISSING_COMMIT, c)]);
  });
});

/** GitHub's answer for `base...head` in rozed-dev/e2e. */
function answer(
  base: string,
  head: string,
  response: Interaction['response'],
  etag?: string,
): Interaction {
  return {
    request: {
      method: 'GET',
      url: url(base, head),
      ...(etag === undefined ? {} : { if_none_match: etag }),
    },
    response,
  };
}

/** A comparison listing `files`, as GitHub answers one. */
function listing(files: Json[]): Interaction['response'] {
  return { status: 200, headers: { etag: 'W/"listed"' }, body: { status: 'ahead', files } };
}

/** An added file `name`, listed at `head`. */
function added(name: string, head: string): Json {
  return {
    sha: 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391',
    filename: name,
    status: 'added',
    additions: 0,
    deletions: 0,
    changes: 0,
    blob_url: `https://github.com/rozed-dev/e2e/blob/${head}/${encodeURIComponent(name)}`,
    contents_url: `https://api.github.com/repos/rozed-dev/e2e/contents/${encodeURIComponent(name)}?ref=${head}`,
  };
}

/** `count` added files, listed at `head`. */
function addedFiles(count: number, head: string): Json[] {
  return Array.from({ length: count }, (_, index) => added(`f/${index}.txt`, head));
}

describe('answered', () => {
  test('a list as long as GitHub lists says the rest may be missing', async () => {
    const fetch = replayFetch(
      new Replay('capped', [
        answer(b, c, listing(addedFiles(MAX_COMPARISON_FILES, c))),
        answer(c, d, listing(addedFiles(MAX_COMPARISON_FILES - 1, d))),
      ]),
    );
    const capped = await readComparison(signedIn(fetch), E2E, b, c, undefined);
    expect([capped.files.length, capped.capped]).toEqual([MAX_COMPARISON_FILES, true]);
    const whole = await readComparison(signedIn(fetch), E2E, c, d, undefined);
    expect([whole.files.length, whole.capped]).toEqual([MAX_COMPARISON_FILES - 1, false]);
  });

  test('files listed at another head are an error, not the comparison', async () => {
    const fetch = replayFetch(new Replay('moved', [answer(b, c, listing([added('x.txt', d)]))]));
    await expect(readComparison(signedIn(fetch), E2E, b, c, undefined)).rejects.toMatchObject({
      detail: { kind: 'inconsistent' },
    });
  });

  test('a 304 to a comparison never read is an error, not a comparison', async () => {
    const fetch = replayFetch(
      new Replay('unasked', [answer(b, c, { status: 304, headers: { etag: 'W/"x"' } })]),
    );
    await expect(readComparison(signedIn(fetch), E2E, b, c, undefined)).rejects.toMatchObject({
      detail: { kind: 'inconsistent' },
    });
  });

  test('a comparison without its files is no answer, rather than one without changes', () => {
    expect(() => readComparedFiles({ status: 'ahead' })).toThrow(GithubError);
    expect(() => readComparedFiles({ status: 'ahead', files: null })).toThrow(
      "the comparison's files aren't a list",
    );
    expect(() => readComparedFiles([])).toThrow(GithubError);
    expect(readComparedFiles({ files: [] })).toEqual([]);
  });
});

test('names commits only by their IDs, never a branch', async () => {
  const fetch = replayFetch(new Replay('none', []));
  const client = signedIn(fetch);
  for (const name of ['e2/b', 'HEAD', 'rozed-bot:e2/b', b.slice(0, 12), b.toUpperCase(), '']) {
    await expect(readComparison(client, E2E, name, c, undefined)).rejects.toThrow(RangeError);
    await expect(readComparison(client, E2E, b, name, undefined)).rejects.toThrow(RangeError);
  }
  expect(fetch.seen).toEqual([]);
  // A repository whose objects are named by SHA-256 has IDs of 64 digits.
  const long = 'a'.repeat(64);
  expect(comparisonPath(E2E, long, c)).toBe(
    `/repos/rozed-dev/e2e/compare/${long}...${c}?per_page=1`,
  );
});
