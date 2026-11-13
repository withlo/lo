import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, onTestFinished, test } from 'vitest';

import { COMMENTS_PULL, COMMENTS_RENAME_PULL, writeCommentsRemote } from './comments.ts';
import { git } from './git.ts';

test(
  'comments.sh makes the pull requests with the commit IDs GitHub has for them',
  { timeout: 30_000 },
  () => {
    const folder = mkdtempSync(join(tmpdir(), 'lo-comments-'));
    onTestFinished(() => rmSync(folder, { recursive: true, force: true }));
    expect(writeCommentsRemote(folder)).toBe(`file://${folder}`);
    const bare = join(folder, 'rozed-dev', 'e2e.git');
    const { number, head, firstHead, base } = COMMENTS_PULL;
    expect(
      git(
        bare,
        'rev-parse',
        'refs/heads/comments/base',
        'refs/heads/comments/feature',
        `refs/pull/${number}/head`,
      ),
    ).toBe(`${base}\n${head}\n${head}`);
    // Two pushes, the second a commit on the first, which is on the base.
    expect(git(bare, 'rev-parse', `${head}^`, `${firstHead}^`)).toBe(`${firstHead}\n${base}`);
    const renamed = COMMENTS_RENAME_PULL;
    expect(
      git(
        bare,
        'rev-parse',
        'refs/heads/comments/renamed',
        `refs/pull/${renamed.number}/head`,
        `${renamed.head}^`,
      ),
    ).toBe(`${renamed.head}\n${renamed.head}\n${base}`);
    // Clients may filter, and fetch any commit by ID, as from GitHub.
    expect(git(bare, 'config', 'uploadpack.allowFilter')).toBe('true');
    expect(git(bare, 'config', 'uploadpack.allowAnySHA1InWant')).toBe('true');
  },
);
