import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, onTestFinished, test } from 'vitest';

import { APP_PULL, writeAppRemote } from './app.ts';
import { git } from './git.ts';

test(
  'app.sh makes the pull request with the commit IDs GitHub has for it',
  { timeout: 30_000 },
  () => {
    const folder = mkdtempSync(join(tmpdir(), 'lo-app-'));
    onTestFinished(() => rmSync(folder, { recursive: true, force: true }));
    expect(writeAppRemote(folder)).toBe(`file://${folder}`);
    const bare = join(folder, 'rozed-dev', 'e2e.git');
    expect(
      git(bare, 'rev-parse', 'refs/heads/app/base', 'refs/heads/app/feature', 'refs/pull/80/head'),
    ).toBe(`${APP_PULL.base}\n${APP_PULL.head}\n${APP_PULL.head}`);
    // The second push rebased the first onto the moved base: the first is no ancestor of it, but
    // still there by its ID, as GitHub keeps it.
    expect(() =>
      git(bare, 'merge-base', '--is-ancestor', APP_PULL.firstHead, APP_PULL.head),
    ).toThrow('git merge-base --is-ancestor');
    expect(git(bare, 'cat-file', '-t', APP_PULL.firstHead)).toBe('commit');
    expect(git(bare, 'merge-base', APP_PULL.firstHead, APP_PULL.base)).toBe(APP_PULL.firstBase);
    expect(git(bare, 'merge-base', APP_PULL.head, APP_PULL.base)).toBe(APP_PULL.base);
    // The overview, as GitHub holds it: one commit of artifact.md and its figure, and nothing else.
    expect(git(bare, 'rev-parse', 'refs/lo/pr/80')).toBe(APP_PULL.overview);
    expect(git(bare, 'ls-tree', '-r', '--name-only', 'refs/lo/pr/80').split('\n')).toEqual([
      'artifact.md',
      'figures/flow.svg',
    ]);
    expect(git(bare, 'rev-list', '--count', 'refs/lo/pr/80')).toBe('1');
    expect(git(bare, 'show', 'refs/lo/pr/80:artifact.md')).toContain(
      `commit: ${APP_PULL.firstHead}`,
    );
    // Clients may filter, and fetch any commit by ID, as from GitHub.
    expect(git(bare, 'config', 'uploadpack.allowFilter')).toBe('true');
    expect(git(bare, 'config', 'uploadpack.allowAnySHA1InWant')).toBe('true');
    // And a rebuild makes the same commits.
    const again = mkdtempSync(join(tmpdir(), 'lo-app-'));
    onTestFinished(() => rmSync(again, { recursive: true, force: true }));
    writeAppRemote(again);
    expect(
      git(join(again, 'rozed-dev', 'e2e.git'), 'rev-parse', 'refs/pull/80/head', 'refs/lo/pr/80'),
    ).toBe(`${APP_PULL.head}\n${APP_PULL.overview}`);
  },
);

test(
  'app.sh can leave the first push out, as if GitHub no longer had it',
  { timeout: 30_000 },
  () => {
    const folder = mkdtempSync(join(tmpdir(), 'lo-app-'));
    onTestFinished(() => rmSync(folder, { recursive: true, force: true }));
    writeAppRemote(folder, { firstPush: false });
    const bare = join(folder, 'rozed-dev', 'e2e.git');
    expect(git(bare, 'rev-parse', 'refs/pull/80/head')).toBe(APP_PULL.head);
    expect(() => git(bare, 'cat-file', '-t', APP_PULL.firstHead)).toThrow(
      'could not get object info',
    );
  },
);

test('the pull request changes what the end-to-end tests need', { timeout: 30_000 }, () => {
  const folder = mkdtempSync(join(tmpdir(), 'lo-app-'));
  onTestFinished(() => rmSync(folder, { recursive: true, force: true }));
  writeAppRemote(folder);
  const bare = join(folder, 'rozed-dev', 'e2e.git');
  const changes = git(bare, 'diff', '--name-status', '-M', `${APP_PULL.base}...${APP_PULL.head}`);
  expect(changes.split('\n').toSorted()).toEqual([
    'A\tdata/numbers.txt',
    'A\tsrc/text/wrap.ts',
    'D\tsrc/legacy.ts',
    'M\tassets/mark.png',
    'M\tpnpm-lock.yaml',
    'M\tsrc/format.ts',
    expect.stringMatching(/^R\d+\tsrc\/parse\.ts\tsrc\/parser\.ts$/),
  ]);
  expect(git(bare, 'cat-file', '-s', `${APP_PULL.head}:data/numbers.txt`)).not.toBe('0');
  expect(git(bare, 'show', `${APP_PULL.head}:data/numbers.txt`).split('\n')).toHaveLength(5001);
});
