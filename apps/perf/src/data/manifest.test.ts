import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';

import { countTokens, dataFolder, Manifest, manifestNames, readManifest } from './manifest.ts';

const manifest: Manifest = {
  repo: 'example/repo',
  number: 7,
  base: 'a'.repeat(40),
  head: 'b'.repeat(40),
  files: [
    {
      path: 'src/new.ts',
      previousPath: 'src/old.ts',
      status: 'renamed',
      additions: 2,
      deletions: 1,
    },
  ],
  threads: [{ path: 'src/new.ts', side: 'left', line: 3, comments: [12, 40] }],
};

describe('the committed manifests', () => {
  test('are the three measured PRs', () => {
    expect(manifestNames()).toEqual(['kubernetes-125488', 'typescript-51387', 'typescript-54820']);
  });

  test.each(manifestNames())('%s is valid, and holds no token, comment or person', (name) => {
    // The schema allows no field beyond the manifest's, so no comment text or login fits in.
    const { files, threads } = readManifest(name);
    expect(files.length).toBeGreaterThan(0);
    expect(threads.length).toBeGreaterThan(0);
    expect(countTokens(readFileSync(join(dataFolder, `${name}.json`), 'utf8'))).toBe(0);
  });
});

describe('Manifest', () => {
  test('accepts a manifest', () => {
    expect(Manifest.parse(manifest)).toEqual(manifest);
  });

  test.each([
    ['a comment', { ...manifest.threads[0], body: 'Looks good' }],
    ['an author', { ...manifest.threads[0], login: 'someone' }],
  ])('refuses a thread with %s', (_, thread) => {
    expect(Manifest.safeParse({ ...manifest, threads: [thread] }).success).toBe(false);
  });

  test('refuses a field it doesn’t know', () => {
    expect(Manifest.safeParse({ ...manifest, title: 'A title' }).success).toBe(false);
  });

  test.each(['/etc/passwd', '../outside', 'a/../../b', 'a//b', ''])(
    'refuses the path %j',
    (path) => {
      const files = [{ ...manifest.files[0], path }];
      expect(Manifest.safeParse({ ...manifest, files }).success).toBe(false);
    },
  );

  test.each(['../perf', './perf', 'owner/..', 'owner/.', 'a.b/repo', 'owner/repo/extra', 'owner'])(
    'refuses the repo %j',
    (repo) => {
      expect(Manifest.safeParse({ ...manifest, repo }).success).toBe(false);
    },
  );

  test.each(['kubernetes/kubernetes', 'microsoft/TypeScript', 'some-org/.github'])(
    'accepts the repo %j',
    (repo) => {
      expect(Manifest.safeParse({ ...manifest, repo }).success).toBe(true);
    },
  );

  test('refuses a shortened commit', () => {
    expect(Manifest.safeParse({ ...manifest, base: 'abc1234' }).success).toBe(false);
  });
});

describe('countTokens', () => {
  test.each([
    `ghp_${'A1b2'.repeat(9)}`,
    `gho_${'A1b2'.repeat(9)}`,
    `ghs_${'A1b2'.repeat(9)}`,
    `github_pat_${'A1b2_'.repeat(16)}`,
  ])('finds %s', (token) => {
    expect(countTokens(`{"path": "${token}"}`)).toBe(1);
  });

  test('finds one stuck to other characters', () => {
    expect(countTokens(`x_ghp_${'A1b2'.repeat(9)}`)).toBe(1);
    expect(countTokens(`abcgithub_pat_${'A1b2_'.repeat(16)}xyz`)).toBe(1);
  });

  test('ignores words that only start like one', () => {
    expect(countTokens('ghp_short and github_pathfinder')).toBe(0);
  });
});
