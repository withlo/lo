// What a stack's tree and its overview's Layers read of its layers: each layer's overview's text,
// read once while its ref holds the same commit, with every ref read in one request, used for a
// minute; and the first line of a layer's description, read again for free while it's the same.

import { RepoRef, type GithubClient } from '@lo/github';
import { describe, expect, it } from 'vitest';

import type { Acting } from '../../tab/contract.ts';
import { Blobs } from './blobs.ts';
import { firstLine, LayerReads, LINE_LIMIT, REFS_FRESH } from './layers.ts';
import { artifactText, database, FakeGithub, overview } from './test/support.ts';

const REPO = new RepoRef('rozed-dev', 'e2e');
const ACTING: Acting = { kind: 'account', login: 'rozed-bot' };

/** Reads through `github`, as main's queue would, with the priority each read asked for. */
function readsOf(github: FakeGithub) {
  const priorities: unknown[] = [];
  const clock = { now: 0 };
  const reads = new LayerReads({
    now: () => clock.now,
    blobs: new Blobs(database()),
    github: <T>(
      _acting: Acting,
      request: (client: GithubClient) => Promise<T>,
      priority?: unknown,
    ) => {
      priorities.push(priority);
      return request(github.client);
    },
  });
  return { reads, priorities, clock };
}

const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

describe("a stack's layers' overviews", () => {
  it('are read from every ref at once, each once while its ref holds the same commit', async () => {
    const github = new FakeGithub();
    const two = overview('two', { 'artifact.md': artifactText(2) });
    const four = overview('four', { 'artifact.md': artifactText(4, '## tl;dr\n\nFour.\n') });
    github.push('rozed-dev/e2e', 2, two);
    github.push('rozed-dev/e2e', 4, four);
    const { reads, priorities, clock } = readsOf(github);
    const first = await reads.overviews(ACTING, REPO, [2, 3, 4]);
    expect(first.map((each) => each.kind)).toEqual(['read', 'none', 'read']);
    expect(first[0]).toMatchObject({ commit: two.commit });
    expect(first[2]?.kind === 'read' && text(first[2].artifact)).toBe(
      artifactText(4, '## tl;dr\n\nFour.\n'),
    );
    // One read of the refs, then each overview's listing and text.
    expect(github.paths().filter((path) => path.includes('matching-refs'))).toEqual([
      'rozed-dev/e2e/git/matching-refs/lo/pr/',
    ]);
    expect(new Set(priorities)).toEqual(new Set(['background']));
    const asked = github.asked.length;
    // Again within a minute, for another view: nothing is asked.
    expect(await reads.overviews(ACTING, REPO, [2, 3])).toEqual(first.slice(0, 2));
    expect(github.asked.length).toBe(asked);
    // Again after it, with nothing changed: the refs' ETag, and nothing else.
    clock.now = REFS_FRESH;
    expect(await reads.overviews(ACTING, REPO, [2, 3, 4])).toEqual(first);
    expect(github.asked.slice(asked)).toEqual([
      expect.objectContaining({
        path: 'rozed-dev/e2e/git/matching-refs/lo/pr/',
        etag: expect.any(String),
      }),
    ]);
  });

  it("say one is unread when it can't be read now, or its text isn't there to read", async () => {
    const github = new FakeGithub();
    github.push('rozed-dev/e2e', 2, overview('two', { 'notes.md': 'No artifact.' }));
    const { reads, clock } = readsOf(github);
    expect(await reads.overviews(ACTING, REPO, [2])).toEqual([{ kind: 'unread' }]);
    clock.now = REFS_FRESH;
    github.answer.set('rozed-dev/e2e/git/matching-refs/lo/pr/', () =>
      Response.json({ message: 'Server Error' }, { status: 502 }),
    );
    expect(await reads.overviews(ACTING, REPO, [2, 3])).toEqual([
      { kind: 'unread' },
      { kind: 'unread' },
    ]);
  });
});

describe("a layer's description", () => {
  it('is its first line with words, read again with its ETag', async () => {
    const github = new FakeGithub();
    const etag = 'W/"three"';
    const bodies: Record<string, string | null> = {
      'rozed-dev/e2e/pulls/3':
        '<!-- What it does -->\n\n## Rate limit **GraphQL** queries\n\nBy cost.',
      'rozed-dev/e2e/pulls/5': null,
    };
    for (const [path, body] of Object.entries(bodies)) {
      github.answer.set(path, () => Response.json({ number: 3, body }, { headers: { etag } }));
    }
    const { reads } = readsOf(github);
    expect(await reads.lines(ACTING, REPO, [3, 5, 6])).toEqual([
      'Rate limit GraphQL queries',
      null,
      null,
    ]);
    github.asked.length = 0;
    await reads.lines(ACTING, REPO, [3]);
    expect(github.asked).toEqual([
      expect.objectContaining({ path: 'rozed-dev/e2e/pulls/3', etag }),
    ]);
  });

  it("leaves out Markdown's marks and what says nothing", () => {
    expect(firstLine('')).toBe(null);
    expect(firstLine('\n\n---\n| a |\n|---|\n')).toBe('| a |');
    expect(firstLine('> - [x] Fixes [#12](https://github.com/o/r/issues/12) in `parse`')).toBe(
      'Fixes #12 in parse',
    );
    expect(firstLine('1. First\n2. Second')).toBe('First');
    expect(firstLine('<!-- never closed\nStill a comment')).toBe(null);
    expect(firstLine('![diagram](a.png) <b>Shows</b> the flow\r\nNext')).toBe(
      'diagram Shows the flow',
    );
    expect(firstLine('word '.repeat(100))?.length).toBeLessThanOrEqual(LINE_LIMIT);
  });
});
