import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { devNull, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { cacheFolder, fetchPullRequest, repoFolder } from './cache.ts';
import type { Manifest } from './manifest.ts';

const env = {
  ...Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_'))),
  GIT_CONFIG_GLOBAL: devNull,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_NO_LAZY_FETCH: '1',
  GIT_AUTHOR_NAME: 'Lo',
  GIT_AUTHOR_EMAIL: 'lo@example.com',
  GIT_COMMITTER_NAME: 'Lo',
  GIT_COMMITTER_EMAIL: 'lo@example.com',
};

function git(...args: string[]): string {
  return execFileSync('git', args, { env, encoding: 'utf8', stdio: 'pipe' }).trim();
}

function write(folder: string, files: Record<string, string>): void {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(folder, path)), { recursive: true });
    writeFileSync(join(folder, path), text);
  }
}

describe('fetchPullRequest', () => {
  let folder: string;
  let upstream: string;
  let manifest: Manifest;
  const blob = (commit: string, path: string): string =>
    git('-C', upstream, 'rev-parse', `${commit}:${path}`);

  // An upstream repo whose one PR adds, edits, removes and renames a file, and leaves one alone.
  beforeAll(() => {
    folder = mkdtempSync(join(tmpdir(), 'lo-perf-'));
    upstream = join(folder, 'upstream');
    git('init', '--quiet', '--initial-branch=main', upstream);
    git('-C', upstream, 'config', 'uploadpack.allowFilter', 'true');
    git('-C', upstream, 'config', 'uploadpack.allowAnySHA1InWant', 'true');
    write(upstream, {
      'kept.txt': 'unchanged\n',
      'edited.txt': 'one\ntwo\n',
      'gone.txt': 'removed\n',
      'old/name.txt': 'moved\n',
    });
    git('-C', upstream, 'add', '.');
    git('-C', upstream, 'commit', '--quiet', '-m', 'base');
    const base = git('-C', upstream, 'rev-parse', 'HEAD');
    write(upstream, { 'edited.txt': 'one\n2\n', 'added.txt': 'new\n' });
    git('-C', upstream, 'rm', '--quiet', 'gone.txt');
    git('-C', upstream, 'mv', 'old/name.txt', 'renamed.txt');
    git('-C', upstream, 'add', '.');
    git('-C', upstream, 'commit', '--quiet', '-m', 'head');
    const head = git('-C', upstream, 'rev-parse', 'HEAD');
    manifest = {
      repo: 'example/upstream',
      number: 7,
      base,
      head,
      files: [
        { path: 'added.txt', status: 'added', additions: 1, deletions: 0 },
        { path: 'edited.txt', status: 'modified', additions: 1, deletions: 1 },
        { path: 'gone.txt', status: 'removed', additions: 0, deletions: 1 },
        {
          path: 'renamed.txt',
          previousPath: 'old/name.txt',
          status: 'renamed',
          additions: 0,
          deletions: 0,
        },
      ],
      threads: [],
    };
  });
  afterAll(() => rmSync(folder, { recursive: true, force: true }));

  test('downloads both versions of each changed file, and nothing else', async () => {
    const cache = join(folder, 'cache');
    const result = await fetchPullRequest(manifest, { cache, remote: `file://${upstream}` });
    const { base, head } = manifest;
    expect(result.files).toEqual([
      { path: 'added.txt', head: blob(head, 'added.txt') },
      { path: 'edited.txt', base: blob(base, 'edited.txt'), head: blob(head, 'edited.txt') },
      { path: 'gone.txt', base: blob(base, 'gone.txt') },
      { path: 'renamed.txt', base: blob(base, 'old/name.txt'), head: blob(head, 'renamed.txt') },
    ]);
    // The renamed file's text didn't change, so it's one blob on both sides.
    expect(result).toMatchObject({ blobs: 5, downloaded: 5 });
    expect(result.bytes).toBe(
      'new\n'.length +
        'one\ntwo\n'.length +
        'one\n2\n'.length +
        'removed\n'.length +
        'moved\n'.length,
    );

    const clone = repoFolder(cache, manifest.repo);
    expect(git(`--git-dir=${clone}`, 'cat-file', '-p', `${head}:edited.txt`)).toBe('one\n2');
    expect(() => git(`--git-dir=${clone}`, 'cat-file', '-e', blob(head, 'kept.txt'))).toThrow(
      /Command failed/,
    );
  });

  test('downloads nothing the second time', async () => {
    const cache = join(folder, 'again');
    const options = { cache, remote: `file://${upstream}` };
    await fetchPullRequest(manifest, options);
    expect(await fetchPullRequest(manifest, options)).toMatchObject({ blobs: 5, downloaded: 0 });
  });

  test('fails when a file isn’t where the manifest says', async () => {
    const files = [
      { path: 'missing.txt', status: 'modified' as const, additions: 1, deletions: 1 },
    ];
    await expect(
      fetchPullRequest(
        { ...manifest, files },
        { cache: join(folder, 'wrong'), remote: `file://${upstream}` },
      ),
    ).rejects.toThrow(/has no missing\.txt/);
  });
});

describe('cacheFolder', () => {
  test('is LO_PERF_CACHE, else lo/perf in the cache folder', () => {
    expect(cacheFolder({ LO_PERF_CACHE: '/data/perf', XDG_CACHE_HOME: '/cache' })).toBe(
      '/data/perf',
    );
    expect(cacheFolder({ XDG_CACHE_HOME: '/cache' })).toBe('/cache/lo/perf');
    expect(cacheFolder({})).toMatch(/\/\.cache\/lo\/perf$/);
  });
});
