// Every overview in `testing/fixtures/artifacts/` checks the same in the app as through
// `@lo/artifact`'s readers of the fixture's folder and its code's repository: the same outcome,
// findings and state of each code block and figure. So does one naming more code than the checks
// read, from a local copy that has it or one that must download it, and one whose figures' headers
// go on past their starts, which the check is sent first. In the app, main lists the overview's
// commit as GitHub does, gives its files as `files` does and reads its code from a local copy
// fetching from a server standing in for GitHub; the window reads and checks it through the
// overview's two jobs, run as the background process runs them. So Lo, the checker and the app
// can't disagree. What the window first finds from the text alone, before the figures and code are
// read, is the same outcome as the whole check's: whether an overview shows depends on its text.

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

import type { Entry, OverviewCommit, OverviewFile, OverviewState } from './contract.ts';
import { FIGURE_HEAD, treeEntries, type CheckInput } from './jobs.ts';
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
import { jpeg } from './test/images.ts';
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
 * from `file`, as main gives them, and its code from the local copy. With what it published first,
 * from the text alone while the rest was to come, if it did.
 */
/**
 * Whether `value` is the whole check, the last a check publishes: none of its figures coming, and
 * its code read, as the local copy is there; or one that failed.
 */
function isWhole(value: CheckedOverview | undefined): boolean {
  return value?.kind !== 'checked' || (value.coming.length === 0 && value.code.kind !== 'waiting');
}

async function checkInApp(
  commit: OverviewCommit,
  pr: number,
  file: (path: string) => OverviewFile,
): Promise<{ first: CheckedOverview | undefined; last: CheckedOverview | undefined }> {
  const published: (CheckedOverview | undefined)[] = [];
  const last = await new Promise<CheckedOverview | undefined>((resolve) => {
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
      publish: (value) => {
        published.push(value);
        if (isWhole(value)) resolve(value);
      },
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
  return { first: published[0], last };
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
    const { first, last: shown } = await checkInApp(commit, pr, given);
    // The text alone tells whether it shows, before any figure or code comes.
    expect(outcomeOf(first)).toBe(outcomeOf(shown));
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

/** What a check in the app found the overview to be, or that it couldn't check it. */
function outcomeOf(value: CheckedOverview | undefined): string | undefined {
  return value?.kind === 'checked' ? value.checked.outcome.kind : value?.kind;
}

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

/** An overview showing `body`, at a commit of its code, on pull request #1. */
function overviewOf(body: string): Uint8Array {
  return new TextEncoder().encode(
    `---\nformat: 1\npr: 1\ncommit: ${'a'.repeat(40)}\n---\n\n## tl;dr\n\nIt reads.\n\n${body}`,
  );
}

/**
 * `files` named by their lines, read as the checks read them and as main reads them from a copy
 * that has them all, or with `lacking`, one that must download them, each bringing what `wire`
 * says of it, else its size. Both checks, and what each found of the code.
 */
async function bothWays(
  files: ReadonlyMap<string, Uint8Array>,
  lacking: boolean,
  wire?: ReadonlyMap<string, number>,
) {
  const artifact = overviewOf(
    [...files.keys()].map((path) => `:::code ${path}#L1\n:::\n`).join('\n'),
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
  const parsed = await localJobs.parse({ artifact });
  const { clone } = memoryClone(files, { lacking, wire });
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
  return { reference, checked, code: codeOf(checked) };
}

/** The state of each code block a check found. */
function codeOf(result: CheckedArtifact) {
  return result.outcome.kind === 'shown' ? result.outcome.code.map(({ code }) => code) : [];
}

/** How much of each figure `figures` holds, or what main answered instead. */
function sizes(figures: CheckInput['figures']) {
  return figures.map(({ file }) => (file.kind === 'file' ? file.bytes?.length : file.kind));
}

describe.each([
  { copy: 'has', lacking: false },
  { copy: 'must download', lacking: true },
])(
  'an overview naming more code than the checks read, from a copy that $copy it',
  ({ lacking }) => {
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
      const { reference, checked, code } = await bothWays(files, lacking);
      expect(code).toEqual([
        ...Array.from({ length: 6 }, () => ({ state: 'resolved' })),
        { state: 'broken', why: 'binary' },
        { state: 'resolved' },
        { state: 'broken', why: 'tooLarge' },
        { state: 'broken', why: 'tooLarge' },
        { state: 'broken', why: 'lines' },
        { state: 'broken', why: 'tooLarge' },
      ]);
      expect(checked).toEqual(reference);
    }, 60_000);

    test('reads a small file after large ones that take up what the checks read', async () => {
      const files = new Map<string, Uint8Array>();
      for (let n = 0; n < 7; n++) files.set(`text/${n}.txt`, textOf(LIMITS.file - 1));
      files.set('text/small.txt', textOf(4));
      // Larger than the checks read of a file, by any measure.
      files.set('big/huge.txt', textOf(3 * LIMITS.file));
      files.set('text/last.txt', textOf(4));
      const { reference, checked, code } = await bothWays(files, lacking);
      expect(code).toEqual([
        ...Array.from({ length: 6 }, () => ({ state: 'resolved' })),
        { state: 'broken', why: 'tooLarge' },
        { state: 'resolved' },
        { state: 'broken', why: 'tooLarge' },
        { state: 'resolved' },
      ]);
      expect(checked).toEqual(reference);
    }, 60_000);
  },
);

test('large files that compress well leave room for the files after them', async () => {
  const files = new Map<string, Uint8Array>([
    ['big/0.txt', textOf(60 * 1024 * 1024)],
    ['big/1.txt', textOf(60 * 1024 * 1024)],
  ]);
  for (let n = 0; n < 4; n++) files.set(`text/${n}.txt`, textOf(3 * 1024 * 1024));
  files.set('text/small.txt', textOf(4));
  // Each large one comes in as a fifth of a megabyte.
  const wire = new Map([
    ['big/0.txt', 200 * 1024],
    ['big/1.txt', 200 * 1024],
  ]);
  const { reference, checked, code } = await bothWays(files, true, wire);
  expect(code).toEqual([
    { state: 'broken', why: 'tooLarge' },
    { state: 'broken', why: 'tooLarge' },
    ...Array.from({ length: 5 }, () => ({ state: 'resolved' })),
  ]);
  expect(checked).toEqual(reference);
}, 60_000);

describe('an overview whose figures’ headers go on past their starts', () => {
  test('checks the same, the check sent all of a figure only once it reads it', async () => {
    const figures = new Map<string, Uint8Array>([
      // Its size in its start, and a megabyte after.
      ['figures/near.jpg', jpeg(30, 20, { after: 1024 * 1024 })],
      // Its size past its start.
      ['figures/far.jpg', jpeg(40, 10, { before: 20_000, after: 1024 * 1024 })],
      // Not what its name says: left out, from its start.
      ['figures/wrong.png', jpeg(5, 5, { after: 1024 * 1024 })],
    ]);
    const artifact = overviewOf(
      [...figures.keys()].map((path) => `:::figure ${path}\nA figure.\n:::\n`).join('\n'),
    );
    const entries: Entry[] = [
      { path: 'artifact.md', kind: 'file', size: artifact.length, id: 'b'.repeat(40) },
      { path: 'figures', kind: 'folder', size: null, id: 'c'.repeat(40) },
      ...[...figures].map(([path, bytes]): Entry => ({
        path,
        kind: 'file',
        size: bytes.length,
        id: 'd'.repeat(40),
      })),
    ];
    const reference = await checkArtifact(
      parseArtifact(artifact),
      {
        entries: treeEntries(entries),
        read: async (path, cap) => {
          const bytes = figures.get(path) ?? new Uint8Array();
          return { kind: 'file', size: bytes.length, bytes: bytes.subarray(0, cap) };
        },
      },
      () => Promise.resolve({ kind: 'missing' }),
      { pr: 1 },
    );
    if (reference.outcome.kind !== 'shown') throw new Error('The overview isn’t shown');
    expect(reference.outcome.figures.map(({ figure }) => figure.state)).toEqual([
      'kept',
      'kept',
      'leftOut',
    ]);

    const sent: CheckInput['figures'][] = [];
    const shown = await new Promise<CheckedOverview | undefined>((resolve) => {
      const checking = new Checking('t1', {
        files: async ({ paths }) =>
          paths.map((path): OverviewFile => {
            const bytes = path === 'artifact.md' ? artifact : figures.get(path);
            return bytes ? { kind: 'file', size: bytes.length, bytes } : { kind: 'missing' };
          }),
        code: () => Promise.resolve({ kind: 'read', files: [] }),
        parse: (input) => localJobs.parse(input),
        check: (input) => {
          sent.push(input.figures);
          return localJobs.check(input);
        },
        publish: (value) => {
          if (isWhole(value)) resolve(value);
        },
        log: () => {},
      });
      checking.take({
        id: 't1',
        ref: 'refs/lo/pr/1',
        watching: true,
        found: 'commit',
        overview: { ...commitOf(entries, true), repository: { owner: 'o', name: 'r' } },
        newer: null,
        saved: false,
        problem: null,
        code: 'ready',
      });
    });
    if (shown?.kind !== 'checked') throw new Error('The overview wasn’t checked');
    expect(shown.checked).toEqual(reference);
    // The text alone; the first figures as they come, each its start, then all of the one whose
    // header goes on past it; then with the rest, sent all of the one it has all of already.
    const far = figures.get('figures/far.jpg')?.length;
    expect(sent.map(sizes)).toEqual([
      [],
      [FIGURE_HEAD],
      [FIGURE_HEAD, FIGURE_HEAD],
      [FIGURE_HEAD, far],
      [FIGURE_HEAD, far, FIGURE_HEAD],
    ]);
    // What's kept is what's drawn: all of each figure kept, and the start of the rest.
    expect([...shown.figures].map(([path, file]) => [path, sizes([{ path, file }])[0]])).toEqual([
      ['figures/near.jpg', figures.get('figures/near.jpg')?.length],
      ['figures/far.jpg', figures.get('figures/far.jpg')?.length],
      ['figures/wrong.png', FIGURE_HEAD],
    ]);
  });
});
