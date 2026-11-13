import { Screen } from '@lo/review';
import { expect, test } from 'vitest';

import type { DrawnDiff, ThreadedFile } from '../../diff/window/shared.ts';
import type { ThreadRow } from '../contract.ts';
import { placeThreads, screenOf, versionOf } from './placing.ts';

const HEAD = 'h'.repeat(40);
const OLDER = 'o'.repeat(40);

/** A thread on `a.ts`'s line 5, on the head's side, written on the head, with one comment. */
function row(overrides: Partial<ThreadRow> = {}): ThreadRow {
  return {
    id: 'T1',
    path: 'a.ts',
    subject: 'LINE',
    side: 'RIGHT',
    startSide: null,
    line: 5,
    startLine: null,
    originalLine: 5,
    originalStartLine: null,
    outdated: false,
    resolved: false,
    currentOn: HEAD,
    writtenOn: HEAD,
    comments: [
      {
        id: 'C1',
        author: 'rozed-bot',
        authorType: 'User',
        body: 'Fixture C: a comment.',
        state: 'SUBMITTED',
        createdAt: '2026-11-13T12:00:00Z',
        url: 'https://github.com/rozed-dev/e2e/pull/94#discussion_r1',
        hidden: null,
        viewerCanUpdate: true,
        viewerCanDelete: true,
      },
    ],
    viewerCanReply: true,
    viewerCanResolve: true,
    viewerCanUnresolve: false,
    ...overrides,
  };
}

function file(overrides: Partial<ThreadedFile> = {}): ThreadedFile {
  return { id: 'd0', key: 'a.ts', path: 'a.ts', old: 'a.ts', since: false, ...overrides };
}

/** The whole pull request's diff at the head, of `files`. */
function drawn(files: ThreadedFile[], overrides: Partial<DrawnDiff> = {}): DrawnDiff {
  return { at: HEAD, comparison: null, compareFrom: null, files, ...overrides };
}

test('a thread goes under its line, open while unresolved, and its file counts it', () => {
  const placed = placeThreads(
    [row(), row({ id: 'T2', side: 'LEFT', line: 3, originalLine: 3, resolved: true })],
    drawn([file()]),
    null,
  );
  expect(placed.threads).toEqual([
    { id: 'T1', at: { file: 'd0', side: 'new', line: 5 }, open: true, version: expect.any(Number) },
    {
      id: 'T2',
      at: { file: 'd0', side: 'old', line: 3 },
      open: false,
      version: expect.any(Number),
    },
  ]);
  expect(placed.counts.get('d0')).toEqual({ threads: 2, unresolved: 1, comments: 2 });
  expect(placed.byKey.get('a.ts')).toEqual({ total: 2, unresolved: 1 });
});

test('a file’s thread is only counted; an outdated one, and one on no file shown, are left out', () => {
  const placed = placeThreads(
    [
      row({ id: 'F', subject: 'FILE', line: null, originalLine: null }),
      row({ id: 'O', outdated: true, currentOn: null, writtenOn: OLDER }),
      row({ id: 'X', path: 'gone.ts' }),
    ],
    drawn([file()]),
    null,
  );
  expect(placed.threads).toEqual([]);
  expect(placed.counts.get('d0')).toEqual({ threads: 1, unresolved: 1, comments: 1 });
});

test('a thread under a renamed file’s old line shows in its older column', () => {
  // As GitHub gives one on rozed-dev/e2e#95, which renames docs/usage.md to docs/guide.md: by the
  // file's new path, on the base's side.
  const renamed = file({ key: 'docs/guide.md', path: 'docs/guide.md', old: 'docs/usage.md' });
  const placed = placeThreads(
    [row({ path: 'docs/guide.md', side: 'LEFT', line: 5, originalLine: 5 })],
    drawn([renamed]),
    null,
  );
  expect(placed.threads.map(({ at }) => at)).toEqual([{ file: 'd0', side: 'old', line: 5 }]);
  expect(placed.byKey.get('docs/guide.md')).toEqual({ total: 1, unresolved: 1 });
});

test('a file shown from a revision of its own has none in its older column', () => {
  const placed = placeThreads(
    [row(), row({ id: 'T2', side: 'LEFT', line: 3, originalLine: 3 })],
    drawn([file({ since: true })]),
    null,
  );
  expect(placed.threads.map(({ id }) => id)).toEqual(['T1']);
});

test('between two revisions, a thread written on the older shows in its column', () => {
  const written = row({ outdated: true, currentOn: null, writtenOn: OLDER, line: null });
  const comparing = { comparison: 'r1..r2' };
  const between = placeThreads([written], drawn([file()], comparing), {
    key: 'r1..r2',
    from: OLDER,
    replayed: false,
  });
  expect(between.threads.map(({ at }) => at)).toEqual([{ file: 'd0', side: 'old', line: 5 }]);
  // Replayed onto another base, or before main said what it compares, its lines are no commit's.
  for (const compared of [{ key: 'r1..r2', from: OLDER, replayed: true }, null]) {
    expect(placeThreads([written], drawn([file()], comparing), compared).threads).toEqual([]);
  }
});

test('the left column shows the base, a revision, or no commit at all', () => {
  expect(screenOf(drawn([]), null)).toEqual(Screen.full(HEAD));
  expect(screenOf(drawn([], { compareFrom: OLDER }), null)).toEqual(Screen.replayed(OLDER, HEAD));
  const comparing = drawn([], { comparison: 'r1..r2' });
  expect(screenOf(comparing, { key: 'r1..r2', from: OLDER, replayed: false })).toEqual(
    Screen.between(OLDER, HEAD),
  );
  expect(screenOf(comparing, { key: 'r0..r2', from: OLDER, replayed: false }).left.kind).not.toBe(
    'revision',
  );
});

test('a thread’s version changes with what it shows', () => {
  expect(versionOf('one')).toBe(versionOf('one'));
  expect(versionOf('one')).not.toBe(versionOf('two'));
});
