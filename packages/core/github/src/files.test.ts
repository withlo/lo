import { Replay, replayFetch, type Interaction, type Json } from '@lo/testing';
import { expect, test } from 'vitest';

import { GithubClient } from './client.ts';
import { GithubError } from './errors.ts';
import {
  ALL_PAGES,
  fileHead,
  filesHead,
  nextLink,
  Pages,
  parsedPatch,
  pullFiles,
  readPullFiles,
  type FileStatus,
  type PullFile,
} from './files.ts';
import { PullRef } from './refs.ts';
import { Token } from './token.ts';

test('the next link is the one marked next', () => {
  const header =
    '<https://api.github.com/repositories/1/pulls/2/files?per_page=100&page=2>; rel="next", <https://api.github.com/repositories/1/pulls/2/files?per_page=100&page=4>; rel="last"';
  expect(nextLink(header)).toBe(
    'https://api.github.com/repositories/1/pulls/2/files?per_page=100&page=2',
  );
  const lastPage =
    '<https://api.github.com/repositories/1/pulls/2/files?page=1>; rel="prev", <https://api.github.com/repositories/1/pulls/2/files?page=1>; rel="first"';
  expect(nextLink(lastPage)).toBeUndefined();
  expect(nextLink('')).toBeUndefined();
  expect(nextLink('garbage')).toBeUndefined();
  expect(nextLink('<https://api.github.com/x?page=3>; rel="prev next"')).toBe(
    'https://api.github.com/x?page=3',
  );
});

/** A page of files at `url`, linking to the next page with `link` if there's one. */
function page(url: string, link: string | undefined, files: Json): Interaction {
  return {
    request: { method: 'GET', url },
    response: { status: 200, headers: link === undefined ? {} : { link }, body: files },
  };
}

const FIRST = 'https://api.github.com/repos/o/r/pulls/7/files?per_page=100';
const SECOND = 'https://api.github.com/repositories/9/pulls/7/files?per_page=100&page=2';
const PULL = new PullRef('o', 'r', 7);

function twoPages() {
  const next = `<${SECOND}>; rel="next", <${SECOND}>; rel="last"`;
  return replayFetch(
    new Replay('files', [
      page(FIRST, next, [
        {
          sha: '1111111111111111111111111111111111111111',
          filename: 'src/main.ts',
          status: 'modified',
          additions: 1,
          deletions: 1,
          changes: 2,
          patch: '@@ -1 +1 @@\n-old\n+new',
        },
      ]),
      page(SECOND, undefined, [
        {
          sha: '2222222222222222222222222222222222222222',
          filename: 'logo.png',
          status: 'added',
          additions: 0,
          deletions: 0,
          changes: 0,
        },
        {
          sha: '3333333333333333333333333333333333333333',
          filename: 'docs/new.md',
          previous_filename: 'docs/old.md',
          status: 'renamed',
          additions: 0,
          deletions: 0,
          changes: 0,
        },
        { filename: 'weird', status: 'something-new', additions: 0, deletions: 0, changes: 0 },
      ]),
    ]),
  );
}

const signedIn = (fetch: typeof globalThis.fetch) =>
  new GithubClient({ fetch, token: new Token('gho_FAKE') });

test('files are read page by page', async () => {
  const fetch = twoPages();
  const files = await pullFiles(signedIn(fetch), PULL);

  const summary = files.map((file) => [
    file.filename,
    file.status,
    file.patch !== undefined,
    file.previous_filename,
  ]);
  expect(summary).toEqual([
    ['src/main.ts', 'modified', true, undefined],
    ['logo.png', 'added', false, undefined],
    ['docs/new.md', 'renamed', false, 'docs/old.md'],
    ['weird', 'other', false, undefined],
  ]);
  const [modified, logo] = files;
  expect(parsedPatch(modified!)?.hunks[0]?.new).toEqual({ start: 0, end: 1 });
  expect(parsedPatch(logo!)).toBeUndefined();

  expect(fetch.seen.map((seen) => seen.url)).toEqual([FIRST, SECOND]);
  expect(fetch.seen.map((seen) => seen.headers.get('authorization'))).toEqual([
    'token gho_FAKE',
    'token gho_FAKE',
  ]);
});

test('without an account no token is sent', async () => {
  const fetch = twoPages();
  const files = await pullFiles(new GithubClient({ fetch }), PULL);
  expect(files).toHaveLength(4);
  expect(fetch.seen).toHaveLength(2);
  for (const seen of fetch.seen) {
    expect(seen.headers.get('authorization')).toBeNull();
    expect(seen.headers.get('accept')).toBe('application/vnd.github+json');
  }
});

test('a next page off githubs api is refused', async () => {
  const fetch = replayFetch(
    new Replay('files', [page(FIRST, '<https://evil.example/files?page=2>; rel="next"', [])]),
  );
  const error = await pullFiles(signedIn(fetch), PULL).catch((thrown: unknown) => thrown);
  expect(error instanceof GithubError && error.detail.kind).toBe('refusedUrl');
  expect(fetch.seen).toHaveLength(1);
});

test('a page that links to itself is an error not a loop', async () => {
  const fetch = replayFetch(new Replay('files', [page(FIRST, `<${FIRST}>; rel="next"`, [])]));
  const error = await pullFiles(signedIn(fetch), PULL).catch((thrown: unknown) => thrown);
  expect(error instanceof GithubError && error.detail.kind).toBe('inconsistent');
  // The first page is read once: its link, a full URL, names the path asked for.
  expect(fetch.seen).toHaveLength(1);
});

test('reading stops after the pages asked for', async () => {
  const fetch = twoPages();
  const read = await readPullFiles(new GithubClient({ fetch }), PULL, {
    maxPages: 1,
    keepRequests: 0,
  });
  expect(read.files).toHaveLength(1);
  expect(read.cutShort).toBe('pages');
  expect(fetch.seen).toHaveLength(1);

  // Reading every page isn't cut short.
  const every = await readPullFiles(new GithubClient({ fetch: twoPages() }), PULL, ALL_PAGES);
  expect(every.cutShort).toBeUndefined();
});

test('reading stops while few requests are left', async () => {
  const reset = Math.floor(Date.now() / 1000) + 3_600;
  const first = page(FIRST, `<${SECOND}>; rel="next"`, []);
  Object.assign(first.response.headers, {
    'x-ratelimit-limit': '60',
    'x-ratelimit-remaining': '10',
    'x-ratelimit-reset': String(reset),
    'x-ratelimit-resource': 'core',
  });
  const fetch = replayFetch(new Replay('files', [first]));
  const client = new GithubClient({ fetch });
  const limits = { maxPages: 3, keepRequests: 10 };

  const read = await readPullFiles(client, PULL, limits);

  expect(read.cutShort).toBe('rateLimit');
  expect(fetch.seen).toHaveLength(1);
  // With so few left, not even a first page is read.
  const again = await readPullFiles(client, PULL, limits);
  expect(again.cutShort).toBe('rateLimit');
  expect(fetch.seen).toHaveLength(1);
});

/** A file GitHub listed at the commit `at`. */
function listedAt(status: FileStatus, at: string): PullFile {
  return {
    filename: 'src/a b.ts',
    status,
    additions: 1,
    deletions: 0,
    changes: 1,
    blob_url: `https://github.com/o/r/blob/${at}/src%2Fa%20b.ts`,
    contents_url: `https://api.github.com/repos/o/r/contents/src%2Fa%20b.ts?ref=${at}`,
  };
}

test('the files name the head they were read at', () => {
  const head = 'd712aa7652cc723fee5fd9b3eba867b0480d40da';
  const base = 'b046244d9569964088e952243e5e557312322488';
  expect(fileHead(listedAt('modified', head))).toBe(head);
  // A removed file's links name the base, not the head.
  expect(fileHead(listedAt('removed', base))).toBeUndefined();
  const withoutContents = { ...listedAt('added', head), contents_url: undefined };
  expect(fileHead(withoutContents)).toBe(head);

  const files = [listedAt('modified', head), listedAt('removed', base), listedAt('added', head)];
  expect(filesHead(files)).toBe(head);
  expect(filesHead([])).toBeUndefined();
  // A push between two pages mixes heads.
  const mixed = [listedAt('modified', head), listedAt('added', base)];
  let error: unknown;
  try {
    filesHead(mixed);
  } catch (thrown) {
    error = thrown;
  }
  expect(error instanceof GithubError && error.detail.kind).toBe('inconsistent');
});

test('no more than 30 pages are read', () => {
  const pages = new Pages(PULL);
  let read = 0;
  for (let path = pages.nextPath(); path !== undefined; path = pages.nextPath()) {
    read++;
    pages.read(`${path}&page=${read + 1}`);
  }
  expect(read).toBe(30);
});
