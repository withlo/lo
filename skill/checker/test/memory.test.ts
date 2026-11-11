/**
 * What the built checker holds and reads, for an overview naming many large files: only what each
 * check needs is kept, and git writes no more than the checker's limit before it says it can't
 * check.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, beforeAll, expect, test } from 'vitest';

import { SIZE_ONLY } from '@lo/artifact';
import { gitBytes, testGitEnvironment } from '@lo/testing/git';

import { STREAM_LIMIT } from '../src/code.ts';
import { CHECKER, overview, scratch } from './support.ts';

const MIB = 1024 * 1024;

let root: ReturnType<typeof scratch>;
let repo: string;
let commit: string;
/** A module that writes the most memory the process held, in KiB, to `LO_TEST_RSS` as it exits. */
let measure: string;

/** As many files of 10 MiB, each its own and each binary from its first byte, as this names. */
const FILES = 30;

beforeAll(() => {
  root = scratch('memory');
  repo = join(root.dir, 'repo');
  mkdirSync(repo);
  gitBytes(repo, ['init', '-q', '--object-format=sha1', '.']);
  const lines = Array.from({ length: FILES }, (_, n) => {
    const bytes = new Uint8Array(SIZE_ONLY);
    bytes.set(new TextEncoder().encode(`file ${n}`), 1);
    const id = gitBytes(repo, ['hash-object', '-w', '--stdin'], bytes).toString().trim();
    return `100644 blob ${id}\t${n}.bin\0`;
  });
  const folder = gitBytes(repo, ['mktree', '-z'], lines.join('')).toString().trim();
  const top = gitBytes(repo, ['mktree', '-z'], `040000 tree ${folder}\tbig\0`).toString().trim();
  commit = gitBytes(repo, ['commit-tree', top], 'Code.\n').toString().trim();
  measure = join(root.dir, 'measure.mjs');
  writeFileSync(
    measure,
    "import { writeFileSync } from 'node:fs';\nprocess.on('exit', () => writeFileSync(process.env.LO_TEST_RSS, String(process.resourceUsage().maxRSS)));\n",
  );
});

afterAll(() => root.remove());

/** Checks an overview naming the first `count` files' first lines: what it said, and held. */
function check(count: number): { status: number | null; stderr: string; held: number } {
  const dir = join(root.dir, `overview-${count}`);
  mkdirSync(dir);
  const links = Array.from({ length: count }, (_, n) => `[${n}](code:big/${n}.bin#L1)`);
  writeFileSync(join(dir, 'artifact.md'), overview(commit, `${links.join('\n')}\n`));
  const rss = join(root.dir, `rss-${count}`);
  const ran = spawnSync(process.execPath, [`--import=${measure}`, CHECKER, 'check', dir], {
    cwd: repo,
    env: { ...testGitEnvironment(), LO_TEST_RSS: rss },
    encoding: 'utf8',
  });
  return { status: ran.status, stderr: ran.stderr, held: Number(readFileSync(rss, 'utf8')) * 1024 };
}

test('many large files named hold no more memory than a few', () => {
  // 20 files of 10 MiB: git writes 200 MiB of them, under its limit, and each is binary.
  expect(20 * SIZE_ONLY).toBeLessThan(STREAM_LIMIT);
  const many = check(20);
  expect(many.status, `stderr: ${many.stderr}`).toBe(1);
  // Holding what git writes would take 200 MiB on top of what Node and the checker take.
  expect(many.held, `held ${Math.round(many.held / MIB)} MiB`).toBeLessThan(200 * MIB);
});

test('past what git may write for one check, it can’t check, and says why', () => {
  expect(FILES * SIZE_ONLY).toBeGreaterThan(STREAM_LIMIT);
  const all = check(FILES);
  expect(all.status).toBe(2);
  expect(all.stderr).toBe(
    "Checking the overview would read more than 256 MiB from git, the most the checker reads for one overview. Name fewer large files.\nLo couldn't check all of the overview.\n",
  );
  expect(all.held, `held ${Math.round(all.held / MIB)} MiB`).toBeLessThan(200 * MIB);
});
