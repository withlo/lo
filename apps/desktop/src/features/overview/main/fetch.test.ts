import { RepoRef } from '@lo/github';
import { describe, expect, it } from 'vitest';

import { NAME_LIMIT } from '../contract.ts';
import { Blobs } from './blobs.ts';
import { fetchBlob, readOverview, type Github } from './fetch.ts';
import { artifactText, database, FakeGithub, idOf, notFound, overview } from './test/support.ts';

const E2E = new RepoRef('rozed-dev', 'e2e');

/** The byline of an overview whose commit's author is `login`, named `name`, on GitHub. */
async function bylineOf(login: string | null, name: string) {
  const github = new FakeGithub();
  const made = overview('byline', { 'artifact.md': artifactText(5) });
  github.push('rozed-dev/e2e', 5, made, { login, name });
  const reads: Github = (request) => request(github.client);
  return (await readOverview(reads, new Blobs(database()), E2E, made.commit, 'base')).byline;
}

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
    const ask = () => fetchBlob(reads, blobs, E2E, id);
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
});
