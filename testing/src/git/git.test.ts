import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { beforeAll, afterAll, describe, expect, test } from 'vitest';

import { git, gitBytes } from './git.ts';

let repo: string;

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), 'lo-git-test-'));
  git(repo, 'init', '-q', '.');
});

afterAll(() => rmSync(repo, { recursive: true, force: true }));

/** The ID git gives `bytes`, read from a file as git reads one, without a pipe. */
function idOf(bytes: Uint8Array): string {
  const file = join(repo, 'blob');
  writeFileSync(file, bytes);
  return git(repo, 'hash-object', file);
}

describe('gitBytes', () => {
  test('gives git its input whole, whether it goes through a pipe or a file', () => {
    // On either side of the most a pipe is given, and far past it.
    for (const size of [0, 1, 64 * 1024, 64 * 1024 + 1, 10 * 1024 * 1024]) {
      const bytes = new Uint8Array(size).map((_, at) => at % 251);
      expect(gitBytes(repo, ['hash-object', '--stdin'], bytes).toString().trim(), `${size}`).toBe(
        idOf(bytes),
      );
    }
    const text = 'é'.repeat(40_000);
    expect(gitBytes(repo, ['hash-object', '--stdin'], text).toString().trim()).toBe(
      idOf(new TextEncoder().encode(text)),
    );
  });

  test('writes the object git is given, for later reads', () => {
    const bytes = new Uint8Array(200_000).fill(7);
    const id = gitBytes(repo, ['hash-object', '-w', '--stdin'], bytes).toString().trim();
    expect(gitBytes(repo, ['cat-file', 'blob', id]).equals(Buffer.from(bytes))).toBe(true);
  });

  test('says what git said when it fails on input that went by file', () => {
    expect(() => gitBytes(repo, ['mktree'], 'x'.repeat(100_000))).toThrow(/git mktree .* failed/);
  });
});
