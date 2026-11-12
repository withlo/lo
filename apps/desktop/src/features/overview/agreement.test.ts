// Every overview in `testing/fixtures/artifacts/` checks the same in the app as through
// `@lo/artifact`'s readers of the fixture's folder and its code's repository: the same outcome,
// findings and state of each code block and figure, and so does one naming more code than the
// checks read. In the app, main lists the overview's commit as
// GitHub does, gives its files as `files` does and reads its code from a local copy fetching from a
// server standing in for GitHub; the window reads and checks it through the overview's two jobs,
// run as the background process runs them. So Lo, the checker and the app can't disagree.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  ARTIFACT_READ,
  BINARY_WINDOW,
  checkArtifact,
  LIMITS,
  parseArtifact,
  type CheckedArtifact,
} from '@lo/artifact';
import type { Repo } from '@lo/git';
import { RepoServer } from '@lo/testing/git';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import type { OverviewCommit, OverviewFile, OverviewState } from './contract.ts';
import { treeEntries } from './jobs.ts';
import { codeReply, readCode } from './main/code.ts';
import { readsText, sizeOnly } from './main/fetch.ts';
import { entryAt, isReadable, listedEntries } from './main/listing.ts';
import { cloneFrom } from './test/clone.ts';
import {
  CODE_COMMIT,
  commitCode,
  expectedOf,
  FIXTURES,
  fixtureEntries,
  folderFiles,
  githubListing,
  gitReader,
  mainFile,
  PR,
  type Expected,
  type FixtureInput,
} from './test/fixtures.ts';
import { localJobs } from './test/jobs.ts';
import { memoryClone } from './test/memory.ts';
import { Checking, type CheckedOverview } from './window/checking.ts';

const GROUPS = ['valid', 'invalid', 'hostile'] as const;

const fixtures = GROUPS.flatMap((group) =>
  readdirSync(join(FIXTURES, group))
    .toSorted()
    .map((name) => ({ group, name, dir: join(FIXTURES, group, name) })),
);

let server: RepoServer;
let gitDir: string;
let local: { repo: Repo; close: () => Promise<void> };

beforeAll(async () => {
  server = new RepoServer();
  gitDir = server.repo('rozed-dev', 'e2e').gitDir;
  const code = commitCode(gitDir);
  if (code !== CODE_COMMIT) throw new Error(`The fixtures' code is ${code}, not ${CODE_COMMIT}.`);
  local = await cloneFrom(server.baseUrl, 'rozed-dev', 'e2e');
}, 60_000);

afterAll(async () => {
  await local.close();
  server.remove();
});

/** The overview commit main would have read for the fixture's `listed` entries. */
function commitOf(entries: OverviewCommit['entries'], read: boolean): OverviewCommit {
  return {
    id: 'c'.repeat(40),
    source: 'base',
    repository: { owner: 'rozed-dev', name: 'e2e' },
    byline: { login: 'rozed-bot', name: 'rozed-bot', at: 0 },
    entries,
    truncated: false,
    read,
  };
}

/**
 * The overview `commit`, on pull request `pr`'s ref, checked as the window checks it: its files
 * from `file`, as main gives them, and its code from the local copy.
 */
function checkInApp(
  commit: OverviewCommit,
  pr: number,
  file: (path: string) => OverviewFile,
): Promise<CheckedOverview | undefined> {
  return new Promise((resolve) => {
    const checking = new Checking('t1', {
      files: async ({ paths }) => paths.map(file),
      code: ({ commit: at, files }) =>
        codeReply(
          { kind: 'ready', head: at, base: at, mergeBase: at, offline: false },
          () => Promise.resolve(local.repo),
          at,
          files,
        ),
      parse: (input) => localJobs.parse(input),
      check: (input) => localJobs.check(input),
      publish: resolve,
      log: () => {},
    });
    const state: OverviewState = {
      id: 't1',
      ref: `refs/lo/pr/${pr}`,
      watching: true,
      found: 'commit',
      overview: commit,
      newer: null,
      saved: false,
      problem: null,
      code: 'ready',
    };
    checking.take(state);
  });
}

describe.each(fixtures)('$group/$name', ({ dir }) => {
  test('checks the same in the app as through the fixtures’ readers', async () => {
    const input: FixtureInput = existsSync(join(dir, 'fixture.json'))
      ? JSON.parse(readFileSync(join(dir, 'fixture.json'), 'utf8'))
      : {};
    const expected: Expected = JSON.parse(readFileSync(join(dir, 'expected.json'), 'utf8'));
    const pr = input.ref ?? PR;
    const entries = fixtureEntries(dir, input);

    // Through the fixtures' readers, as `@lo/artifact`'s tests check them.
    const files = folderFiles(entries);
    const text = await files
      .read('artifact.md', ARTIFACT_READ, new AbortController().signal)
      .catch(() => undefined);
    const whole = text?.kind === 'file' && text.bytes.length === text.size;
    const reference = await checkArtifact(
      whole ? parseArtifact(text.bytes) : undefined,
      files,
      gitReader(gitDir),
      { pr },
    );
    expect(expectedOf(reference)).toEqual(expected);

    // In the app: main lists the commit as GitHub does, and reads only what it would.
    const listed = listedEntries(githubListing(entries));
    if (!listed) throw new Error('GitHub would list each entry with an ID');
    const read = await readsText(listed, false);
    const commit = commitOf(listed, read);
    const given = (path: string): OverviewFile => {
      if (!read || !isReadable(path)) return { kind: 'refused' };
      const entry = entryAt(listed, path);
      if (!entry) return { kind: 'missing' };
      if (entry.kind !== 'file') return { kind: 'notFile', is: entry.kind };
      if (entry.size !== null && sizeOnly(entry.size)) {
        return { kind: 'file', size: entry.size, bytes: null };
      }
      return mainFile(entries, path);
    };
    const shown = await checkInApp(commit, pr, given);
    // Where main has the listing, but can't read artifact.md, the window tries again later rather
    // than show it, and a check of what main has finds what the fixtures' readers do.
    expect(shown?.kind === 'checked' || given('artifact.md').kind === 'unread').toBe(true);
    const checked: CheckedArtifact =
      shown?.kind === 'checked'
        ? shown.checked
        : await localJobs.check({
            artifact: null,
            entries: commit.entries,
            pr,
            figures: [],
            code: null,
          });
    expect(checked).toEqual(reference);
    expect(expectedOf(checked)).toEqual(expected);
  });
});

/** Text of `size` bytes, lines of `x`. */
function textOf(size: number): Uint8Array {
  const bytes = new Uint8Array(size).fill(0x78);
  for (let at = 99; at < size; at += 100) bytes[at] = 0x0a;
  return bytes;
}

/** `size` bytes that aren't text: a NUL at `at`. */
function binaryOf(size: number, at: number): Uint8Array {
  const bytes = textOf(size);
  bytes[at] = 0;
  return bytes;
}

describe('an overview naming more code than the checks read', () => {
  test('reads it as the checks do, up to the last byte they read', async () => {
    const files = new Map<string, Uint8Array>();
    // Six files of text as large as the checks read: nearly all they read of code.
    for (let n = 0; n < 6; n++) files.set(`text/${n}.txt`, textOf(LIMITS.file - 1));
    // One that isn't text, of which only its start counts.
    files.set('bin/early.bin', binaryOf(1024 * 1024, 0));
    // Text that leaves 100 bytes to read, then one that's past them, by its start alone.
    const used = 6 * (LIMITS.file - 1) + BINARY_WINDOW;
    files.set('text/fills.txt', textOf(LIMITS.code - used - 100));
    files.set('text/past.txt', textOf(1000));
    // With nothing left to read: one that isn't text, though nothing of it is read to say so.
    files.set('bin/late.bin', binaryOf(4096, 50));
    files.set('text/empty.txt', new Uint8Array());
    files.set('big/huge.txt', textOf(LIMITS.file + 1));
    const blocks = [...files.keys()].map((path) => `:::code ${path}#L1\n:::\n`).join('\n');
    const artifact = new TextEncoder().encode(
      `---\nformat: 1\npr: 1\ncommit: ${'a'.repeat(40)}\n---\n\n## tl;dr\n\nIt reads.\n\n${blocks}`,
    );
    const entries = [
      { path: 'artifact.md', kind: 'file' as const, size: artifact.length, id: 'b'.repeat(40) },
    ];

    const reference = await checkArtifact(
      parseArtifact(artifact),
      { entries: treeEntries(entries), read: () => Promise.resolve({ kind: 'missing' }) },
      async (_commit, path, cap) => {
        const bytes = files.get(path) ?? new Uint8Array();
        return { kind: 'file', size: bytes.length, bytes: bytes.subarray(0, cap) };
      },
      { pr: 1 },
    );
    if (reference.outcome.kind !== 'shown') throw new Error('The overview isn’t shown');
    expect(reference.outcome.code.map(({ code }) => code)).toEqual([
      ...Array.from({ length: 6 }, () => ({ state: 'resolved' })),
      { state: 'broken', why: 'binary' },
      { state: 'resolved' },
      { state: 'broken', why: 'tooLarge' },
      { state: 'broken', why: 'tooLarge' },
      { state: 'broken', why: 'lines' },
      { state: 'broken', why: 'tooLarge' },
    ]);

    const parsed = await localJobs.parse({ artifact });
    const { clone } = memoryClone(files);
    const answers = await readCode(clone, 'a'.repeat(40), parsed.code);
    const checked = await localJobs.check({
      artifact,
      entries,
      pr: 1,
      figures: [],
      code: {
        commit: 'a'.repeat(40),
        files: parsed.code.map(({ path }, index) => ({
          path,
          answer: answers[index] ?? { kind: 'unread', why: '' },
        })),
      },
    });
    expect(checked).toEqual(reference);
  }, 60_000);
});
