/**
 * The overview the app's end-to-end tests open, rozed-dev/e2e#80's, which `testing/fixtures/app.sh`
 * writes: it checks as Lo shows it, with only the broken reference it's written with, and its
 * commit is the one `commit` writes of its files.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ARTIFACT } from '@lo/artifact';
import { APP_PULL, git, testGitEnvironment, writeAppRemote } from '@lo/testing/git';
import { afterAll, beforeAll, expect, test } from 'vitest';

import { writeCommit } from '../src/commit.ts';
import { gitIn } from '../src/git.ts';
import { runJson, scratch } from './support.ts';

let root: ReturnType<typeof scratch>;

beforeAll(() => {
  root = scratch('app');
  writeAppRemote(root.dir);
}, 60_000);

afterAll(() => root.remove());

test('shows, with only its broken reference as an error', () => {
  const found = runJson(
    ['check', join(root.dir, 'overview'), '--pr', String(APP_PULL.number), '--repo', 'work'],
    root.dir,
  );
  expect(found.outcome).toBe('shown');
  expect(found.findings.map(({ code, severity }) => `${severity} ${code}`)).toEqual([
    'error code-missing',
  ]);
  expect(found.findings[0]?.message).toContain('src/cache.ts');
  expect(found.incomplete).toEqual([]);
});

test('is the commit `commit` writes of its files', async () => {
  const written = await writeCommit(
    gitIn(join(root.dir, 'work'), {
      ...testGitEnvironment(),
      GIT_AUTHOR_NAME: 'rozed-bot',
      GIT_AUTHOR_EMAIL: '353226052+rozed-bot@users.noreply.github.com',
      GIT_AUTHOR_DATE: '2026-11-11T09:30:00Z',
      GIT_COMMITTER_NAME: 'rozed-bot',
      GIT_COMMITTER_EMAIL: '353226052+rozed-bot@users.noreply.github.com',
      GIT_COMMITTER_DATE: '2026-11-11T09:30:00Z',
    }),
    APP_PULL.number,
    [ARTIFACT, 'figures/flow.svg'].map((path) => ({
      path,
      bytes: readFileSync(join(root.dir, 'overview', path)),
    })),
  );
  expect(written).toEqual({ id: APP_PULL.overview, parent: undefined });
  expect(git(join(root.dir, 'rozed-dev', 'e2e.git'), 'rev-parse', 'refs/lo/pr/80')).toBe(
    written.id,
  );
});
