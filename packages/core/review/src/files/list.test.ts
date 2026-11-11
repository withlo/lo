import type { FileViewedState, PullFile } from '@lo/github';
import { expect, test } from 'vitest';

import {
  changeLetter,
  FileList,
  githubChange,
  githubFileEntry,
  type FileChange,
  type FileEntry,
} from './list.ts';

function entry(name: string, previousPath?: string): FileEntry {
  return {
    file: { path: name, previousPath, additions: 1, deletions: 0, binary: false },
    change: 'modified',
    viewed: undefined,
  };
}

function list(names: readonly string[]): FileList {
  return new FileList(names.map((name) => entry(name)));
}

function paths(files: FileList): string[] {
  return files.rows().map((row) => row.file.path);
}

function pathOf(row: FileEntry | undefined): string | undefined {
  return row?.file.path;
}

const PULL_REQUEST = ['Cargo.lock', 'README.md', 'src/lib.rs', 'src/main.rs', 'tests/lib.rs'];

test('files start in review order and one switch shows path order', () => {
  const files = list(PULL_REQUEST);
  expect(files.order).toBe('review');
  expect(paths(files)).toEqual([
    'README.md',
    'src/lib.rs',
    'tests/lib.rs',
    'src/main.rs',
    'Cargo.lock',
  ]);

  files.toggleOrder();

  expect(files.order).toBe('path');
  expect(paths(files)).toEqual(PULL_REQUEST);

  files.toggleOrder();
  expect(files.order).toBe('review');
});

test('the selected file stays selected when the order changes', () => {
  const files = list(PULL_REQUEST);
  files.selectPath('Cargo.lock');
  expect(files.selectedRow()).toBe(4);

  files.toggleOrder();

  expect(pathOf(files.selected())).toBe('Cargo.lock');
  expect(files.selectedRow()).toBe(0);
});

test('moving the selection follows the order and stops at the ends', () => {
  const files = list(PULL_REQUEST);
  expect(files.selected()).toBeUndefined();

  files.selectNext();
  expect(pathOf(files.selected())).toBe('README.md');
  files.selectNext();
  files.selectNext();
  expect(pathOf(files.selected())).toBe('tests/lib.rs');
  for (let step = 0; step < 10; step++) files.selectNext();
  expect(pathOf(files.selected())).toBe('Cargo.lock');
  files.selectPrevious();
  expect(pathOf(files.selected())).toBe('src/main.rs');

  const fresh = list(PULL_REQUEST);
  fresh.selectPrevious();
  expect(fresh.selectedRow()).toBe(0);
  for (let step = 0; step < 10; step++) fresh.selectPrevious();
  expect(fresh.selectedRow()).toBe(0);
});

test('an empty list selects nothing', () => {
  const files = list([]);
  files.selectNext();
  files.selectPrevious();
  files.selectRow(3);
  expect(files.selected()).toBeUndefined();
  expect(files.isEmpty()).toBe(true);
});

test('review positions give the diffs order whatever the lists', () => {
  const files = list(PULL_REQUEST);
  files.toggleOrder();
  expect(files.reviewPosition('README.md')).toBe(0);
  expect(files.reviewPosition('tests/lib.rs')).toBe(2);
  expect(files.reviewPosition('Cargo.lock')).toBe(4);
  expect(files.reviewPosition('missing.rs')).toBeUndefined();
  // Entries are in path order here, so this lists each path's place in review order.
  expect(files.reviewPositions()).toEqual([4, 0, 1, 3, 2]);
});

test('viewed marks come from github by path', () => {
  const files = list(PULL_REQUEST);
  const viewed = new Map<string, FileViewedState>([
    ['src/lib.rs', 'VIEWED'],
    ['README.md', 'DISMISSED'],
    ['tests/lib.rs', 'UNVIEWED'],
  ]);

  files.setViewed(viewed);

  expect(files.rows().map((row) => [row.file.path, row.viewed])).toEqual([
    ['README.md', 'DISMISSED'],
    ['src/lib.rs', 'VIEWED'],
    ['tests/lib.rs', 'UNVIEWED'],
    ['src/main.rs', undefined],
    ['Cargo.lock', undefined],
  ]);

  files.setViewed(new Map());
  expect(files.rows().filter((row) => row.viewed !== undefined)).toEqual([]);
});

function marked(marks: readonly (readonly [string, FileViewedState | undefined])[]): FileList {
  const files = list(marks.map(([file]) => file));
  files.setViewed(
    new Map(
      marks.flatMap(([file, state]) => (state === undefined ? [] : [[file, state] as const])),
    ),
  );
  return files;
}

function nextUnviewed(files: FileList, from: string): string | undefined {
  return pathOf(files.nextUnviewed(from));
}

test('the next unviewed file is the next in review order that isnt viewed', () => {
  // Review order: README.md, src/lib.rs, tests/lib.rs, src/main.rs, Cargo.lock.
  const files = marked([
    ['Cargo.lock', undefined],
    ['README.md', 'UNVIEWED'],
    ['src/lib.rs', 'VIEWED'],
    ['src/main.rs', 'DISMISSED'],
    ['tests/lib.rs', 'VIEWED'],
  ]);

  // Viewed files are skipped; changed since viewed counts as unviewed.
  expect(nextUnviewed(files, 'README.md')).toBe('src/main.rs');
  // A file with no mark known counts as unviewed.
  expect(nextUnviewed(files, 'src/main.rs')).toBe('Cargo.lock');
});

test('the next unviewed file goes round to the start', () => {
  const files = marked([
    ['Cargo.lock', 'VIEWED'],
    ['README.md', 'UNVIEWED'],
    ['src/lib.rs', 'VIEWED'],
    ['src/main.rs', 'VIEWED'],
    ['tests/lib.rs', 'UNVIEWED'],
  ]);

  expect(nextUnviewed(files, 'Cargo.lock')).toBe('README.md');
  expect(nextUnviewed(files, 'src/main.rs')).toBe('README.md');
  expect(nextUnviewed(files, 'README.md')).toBe('tests/lib.rs');
});

test('with every other file viewed there is no next unviewed file', () => {
  const files = marked([
    ['Cargo.lock', 'VIEWED'],
    ['README.md', 'UNVIEWED'],
    ['src/lib.rs', 'VIEWED'],
    ['src/main.rs', 'VIEWED'],
    ['tests/lib.rs', 'VIEWED'],
  ]);

  // The file itself doesn't count, viewed or not.
  expect(nextUnviewed(files, 'README.md')).toBeUndefined();
  expect(nextUnviewed(files, 'missing.rs')).toBeUndefined();
  expect(nextUnviewed(list(['one.rs']), 'one.rs')).toBeUndefined();
});

test('the next unviewed file follows review order whatever the lists', () => {
  const files = marked([
    ['Cargo.lock', 'UNVIEWED'],
    ['README.md', 'VIEWED'],
    ['src/lib.rs', 'UNVIEWED'],
    ['src/main.rs', 'UNVIEWED'],
    ['tests/lib.rs', 'UNVIEWED'],
  ]);
  files.toggleOrder();

  // In path order src/main.rs would come next; in review order tests/lib.rs does.
  expect(nextUnviewed(files, 'src/lib.rs')).toBe('tests/lib.rs');
  expect(pathOf(files.atReviewPosition(4))).toBe('Cargo.lock');
  expect(files.atReviewPosition(5)).toBeUndefined();
});

test('a renamed file shows the mark github keeps at its old path', () => {
  const files = new FileList([entry('new.rs', 'old.rs'), entry('other.rs')]);
  const marks = new Map<string, FileViewedState>([
    ['old.rs', 'VIEWED'],
    ['other.rs', 'UNVIEWED'],
  ]);

  files.setViewed(marks);

  expect(files.entry('new.rs')?.viewed).toBe('VIEWED');
  expect(files.entry('other.rs')?.viewed).toBe('UNVIEWED');
});

test('each change shows the letter git gives it', () => {
  const changes: FileChange[] = ['added', 'deleted', 'modified', 'renamed', 'typeChanged'];
  expect(changes.map((change) => changeLetter(change))).toEqual(['A', 'D', 'M', 'R', 'T']);
});

/** A file in GitHub's list of a pull request's files. */
function pullFile(status: PullFile['status'], patch?: string): PullFile {
  return {
    filename: 'src/new.rs',
    status,
    additions: patch === undefined ? 0 : 1,
    deletions: patch === undefined ? 0 : 1,
    changes: patch === undefined ? 0 : 2,
    patch,
  };
}

test('files from githubs list keep renames and say when line counts are unknown', () => {
  // A rename alone: GitHub gives no patch and no changed lines.
  const renamed = githubFileEntry({ ...pullFile('renamed'), previous_filename: 'src/old.rs' });
  expect(renamed).toEqual({
    file: {
      path: 'src/new.rs',
      previousPath: 'src/old.rs',
      additions: 0,
      deletions: 0,
      binary: true,
    },
    change: 'renamed',
    viewed: undefined,
  } satisfies FileEntry);
  // Its line counts aren't known, rather than none; a patch's are.
  expect(githubFileEntry(pullFile('modified', '@@ -1 +1 @@\n-a\n+b')).file.binary).toBe(false);
  // A copy shows as a new file, though GitHub names where it came from.
  const copied = githubFileEntry({
    ...pullFile('copied', '@@ -0,0 +1 @@\n+a'),
    previous_filename: 'src/old.rs',
  });
  expect([copied.change, copied.file.previousPath]).toEqual(['added', 'src/old.rs']);
  // Only a rename or copy keeps the old path.
  const modified = githubFileEntry({ ...pullFile('modified'), previous_filename: 'src/old.rs' });
  expect(modified.file.previousPath).toBeUndefined();
});

test('githubs statuses show as git shows changes', () => {
  const statuses = [
    'added',
    'copied',
    'removed',
    'renamed',
    'modified',
    'changed',
    'unchanged',
    'other',
  ] as const;
  expect(statuses.map((status) => changeLetter(githubChange(status)))).toEqual([
    'A',
    'A',
    'D',
    'R',
    'M',
    'M',
    'M',
    'M',
  ]);
});
