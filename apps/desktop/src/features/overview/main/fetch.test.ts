import { GithubError, RepoRef } from '@lo/github';
import { describe, expect, it } from 'vitest';

import type { Acting } from '../../tab/contract.ts';
import { NAME_LIMIT } from '../contract.ts';
import { Blobs } from './blobs.ts';
import { fetchBlob, readByline, readOverview, type Github } from './fetch.ts';
import { artifactText, database, FakeGithub, idOf, notFound, overview } from './test/support.ts';

const E2E = new RepoRef('rozed-dev', 'e2e');

/** Who reads, as the e2e tests' account. */
const ROZED: Acting = { kind: 'account', login: 'rozed-bot' };

/** The byline of an overview whose commit's author is `login`, named `name`, on GitHub. */
async function bylineOf(login: string | null, name: string) {
  const github = new FakeGithub();
  const made = overview('byline', { 'artifact.md': artifactText(5) });
  github.push('rozed-dev/e2e', 5, made, { login, name });
  const reads: Github = (request) => request(github.client);
  return readByline(reads, E2E, made.commit);
}

describe('reading an overview', () => {
  it('reads the tree by the commit, then the text, and the byline apart', async () => {
    const github = new FakeGithub();
    const made = overview('order', {
      'artifact.md': artifactText(5),
      'figures/a.svg': '<svg viewBox="0 0 1 1"/>',
    });
    github.push('rozed-dev/e2e', 5, made);
    const reads: Github = (request) => request(github.client);
    const blobs = new Blobs(database());
    const read = await readOverview(reads, ROZED, blobs, E2E, made.commit, 'base');
    // Two reads before the text is in, all by the one commit's ID or IDs its tree gave.
    expect(github.paths()).toEqual([
      `rozed-dev/e2e/git/trees/${made.commit}?recursive=1`,
      `rozed-dev/e2e/git/blobs/${idOf(artifactText(5))}`,
    ]);
    expect(read).toMatchObject({ id: made.commit, byline: null, read: true, truncated: false });
    expect(blobs.get(idOf(artifactText(5)))).toEqual(new TextEncoder().encode(artifactText(5)));
    expect(await readByline(reads, E2E, made.commit)).toMatchObject({
      login: 'rozed-bot',
    });
    expect(github.paths().at(-1)).toBe(`rozed-dev/e2e/commits/${made.commit}`);
  });

  it("refuses a commit GitHub answers for with another's", async () => {
    const github = new FakeGithub();
    const made = overview('other', { 'artifact.md': artifactText(5) });
    github.push('rozed-dev/e2e', 5, made);
    const reads: Github = (request) => request(github.client);
    const asked = `rozed-dev/e2e/commits/${'d'.repeat(40)}`;
    github.answer.set(asked, () =>
      Response.json({
        sha: made.commit,
        author: null,
        commit: {
          author: { name: 'A', date: '2026-11-11T09:30:00Z' },
          committer: { name: 'A', date: '2026-11-11T09:30:00Z' },
          tree: { sha: made.tree },
        },
      }),
    );
    await expect(readByline(reads, E2E, 'd'.repeat(40))).rejects.toThrow('answered for commit');
  });
});

describe('the byline', () => {
  it("names the author by the login GitHub maps them to, an app's too, else by name", async () => {
    expect(await bylineOf('rozed-bot', 'Rozed Bot')).toEqual({
      login: 'rozed-bot',
      name: 'Rozed Bot',
      at: Date.parse('2026-11-11T09:30:00Z'),
    });
    expect((await bylineOf('dependabot[bot]', 'dependabot[bot]')).login).toBe('dependabot[bot]');
    expect((await bylineOf(null, 'A. Writer')).login).toBeNull();
    // A login GitHub wouldn't give is no login.
    expect((await bylineOf('../../user', 'A. Writer')).login).toBeNull();
  });

  it('keeps as much of a long name as fits, never half a character', async () => {
    const name = `${'a'.repeat(NAME_LIMIT - 1)}😀 and more`;
    expect((await bylineOf(null, name)).name).toBe('a'.repeat(NAME_LIMIT - 1));
    expect((await bylineOf(null, '😀'.repeat(NAME_LIMIT))).name).toBe('😀'.repeat(NAME_LIMIT / 2));
  });
});

describe('a file of the overview', () => {
  it('is fetched once for asks at once, and again after a fetch that failed', async () => {
    const github = new FakeGithub();
    const bytes = new TextEncoder().encode(artifactText(5));
    const id = idOf(bytes);
    github.blobs.set(id, bytes);
    const path = `rozed-dev/e2e/git/blobs/${id}`;
    const reads: Github = (request) => request(github.client);
    const blobs = new Blobs(database());
    const ask = () => fetchBlob(reads, ROZED, blobs, E2E, id);
    const fetches = () => github.paths().filter((each) => each === path).length;

    // Two asks at once while GitHub can't find it: one request, and both hear why.
    github.answer.set(path, notFound);
    const failed = await Promise.allSettled([ask(), ask()]);
    expect(failed.map(({ status }) => status)).toEqual(['rejected', 'rejected']);
    expect(fetches()).toBe(1);

    // Asked again, at once, once it's there: one request more, and both have the file.
    github.answer.delete(path);
    const [first, second] = await Promise.all([ask(), ask()]);
    expect(first).toEqual(bytes);
    expect(second).toBe(first);
    expect(fetches()).toBe(2);

    // Kept now, it's read from the store.
    expect(await ask()).toEqual(bytes);
    expect(fetches()).toBe(2);
  });

  it.each([
    ['signed out', new GithubError({ kind: 'unauthorized', message: 'Bad credentials' })],
    [
      'past its rate limit',
      new GithubError({ kind: 'rateLimited', message: 'limit', secondary: false, reset: 3600 }),
    ],
  ])(
    'is fetched apart for each account that asks, so one %s says nothing of another',
    async (_why, refusal) => {
      const github = new FakeGithub();
      const bytes = new TextEncoder().encode(artifactText(5));
      const id = idOf(bytes);
      github.blobs.set(id, bytes);
      const path = `rozed-dev/e2e/git/blobs/${id}`;
      const blobs = new Blobs(database());
      // GitHub refuses account a, a moment after it asks.
      const asA: Github = async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        throw refusal;
      };
      const asOthers: Github = (request) => request(github.client);
      const [a, b, sameB, nobody] = await Promise.allSettled([
        fetchBlob(asA, { kind: 'account', login: 'a' }, blobs, E2E, id),
        fetchBlob(asOthers, { kind: 'account', login: 'b' }, blobs, E2E, id),
        // The same account, whatever its case, shares b's fetch.
        fetchBlob(asOthers, { kind: 'account', login: 'B' }, blobs, E2E, id),
        fetchBlob(asOthers, { kind: 'anonymous' }, blobs, E2E, id),
      ]);
      expect(a).toEqual({ status: 'rejected', reason: refusal });
      for (const each of [b, sameB, nobody])
        expect(each).toEqual({ status: 'fulfilled', value: bytes });
      // One request as b, one as nobody.
      expect(github.paths().filter((each) => each === path)).toHaveLength(2);
    },
  );
});
