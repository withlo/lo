/** The order the file list shows a pull request's files in. */

import { comparePaths, fileName, type ChangedFile } from './changed.ts';
import { asTest, fileKind, SCRIPT_EXTENSIONS, splitName, type FileKind } from './kind.ts';

/** A file and its index in the caller's list. */
interface Indexed {
  readonly file: ChangedFile;
  readonly index: number;
}

/**
 * The files in review order, as indices into `files`.
 *
 * Source files come first, each followed by its tests, then tests whose source file the pull
 * request doesn't change, then config, then generated files ({@link FileKind} says which is
 * which). Within each group, files keep {@link pathOrder}, and so do several tests of one source
 * file.
 *
 * A test's name says which source file it tests: `foo.test.ts` tests `foo.ts`, `test_foo.py` tests
 * `foo.py`. That source file can be in any directory, and a JavaScript or TypeScript test can test
 * a source file with any of their extensions: `foo.test.ts` tests `foo.tsx` when the pull request
 * has no `foo.ts`. When several source files have the name, the test follows the nearest: the one
 * sharing the most leading directories with it, then the one with its own extension, then the
 * first in path order.
 */
export function reviewOrder(files: readonly ChangedFile[]): number[] {
  return reviewRows(files).map((row) => row.index);
}

/** A file's place in review order, as the file list shows it. */
export interface ReviewRow {
  /** The file's index in the caller's list. */
  readonly index: number;
  /** Its group of review order. */
  readonly kind: FileKind;
  /** For a test that follows the source file it tests, that file's index; else nothing. */
  readonly follows?: number | undefined;
}

/**
 * The files in review order, as {@link reviewOrder} puts them, each with its group and, for a test
 * listed after the source file it tests, that file: what the list needs to label the groups and
 * set each test under its file.
 */
export function reviewRows(files: readonly ChangedFile[]): ReviewRow[] {
  const groups: Record<FileKind, Indexed[]> = { source: [], test: [], config: [], generated: [] };
  for (const indexed of byPath(files)) groups[fileKind(indexed.file)].push(indexed);

  // The source files with each stem, in path order.
  const sourcesByStem = new Map<string, Indexed[]>();
  for (const source of groups.source) {
    const name = splitName(fileName(source.file.path));
    if (name !== undefined) push(sourcesByStem, name.stem, source);
  }

  // The tests that follow each source file, by the source file's index.
  const testsOf = new Map<number, number[]>();
  const unmatchedTests: number[] = [];
  for (const test of groups.test) {
    const source = sourceOf(test.file.path, sourcesByStem);
    if (source === undefined) {
      unmatchedTests.push(test.index);
    } else {
      push(testsOf, source, test.index);
    }
  }

  return [
    ...groups.source.flatMap(({ index }): ReviewRow[] => [
      { index, kind: 'source' },
      ...(testsOf.get(index) ?? []).map((test): ReviewRow => ({
        index: test,
        kind: 'test',
        follows: index,
      })),
    ]),
    ...unmatchedTests.map((index): ReviewRow => ({ index, kind: 'test' })),
    ...groups.config.map(({ index }): ReviewRow => ({ index, kind: 'config' })),
    ...groups.generated.map(({ index }): ReviewRow => ({ index, kind: 'generated' })),
  ];
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const values = map.get(key);
  if (values === undefined) {
    map.set(key, [value]);
  } else {
    values.push(value);
  }
}

/** The index of the source file the test at `path` follows, if the pull request changes it. */
function sourceOf(
  path: string,
  sourcesByStem: ReadonlyMap<string, readonly Indexed[]>,
): number | undefined {
  const subject = asTest(path)?.subject;
  if (subject === undefined) return undefined;
  let nearest: { index: number; shared: number; ownExtension: boolean } | undefined;
  for (const source of sourcesByStem.get(subject.stem) ?? []) {
    const extension = splitName(fileName(source.file.path))?.extension;
    if (extension === undefined || !sameLanguage(subject.extension, extension)) continue;
    const shared = sharedDirectories(path, source.file.path);
    const ownExtension = extension === subject.extension;
    // Only a nearer source replaces one before it, so ties go to path order.
    if (
      nearest === undefined ||
      shared > nearest.shared ||
      (shared === nearest.shared && ownExtension && !nearest.ownExtension)
    ) {
      nearest = { index: source.index, shared, ownExtension };
    }
  }
  return nearest?.index;
}

/** Whether a test with the extension `test` can test a source file with the extension `source`. */
function sameLanguage(test: string, source: string): boolean {
  return test === source || (SCRIPT_EXTENSIONS.has(test) && SCRIPT_EXTENSIONS.has(source));
}

/** How many leading directories two paths share. */
function sharedDirectories(a: string, b: string): number {
  const ofA = directories(a);
  const ofB = directories(b);
  let shared = 0;
  while (shared < ofA.length && shared < ofB.length && ofA[shared] === ofB[shared]) shared++;
  return shared;
}

/** A path's directories, outermost first. */
function directories(path: string): string[] {
  const slash = path.lastIndexOf('/');
  return slash < 0 ? [] : path.slice(0, slash).split('/');
}

/**
 * The files in path order, as indices into `files`.
 *
 * Paths compare byte by byte, which is git's order and the order of GitHub's changed-file list:
 * uppercase before lowercase, and `a.ts` before `a/b.ts`. Every directory's files stay together.
 */
export function pathOrder(files: readonly ChangedFile[]): number[] {
  return byPath(files).map(({ index }) => index);
}

function byPath(files: readonly ChangedFile[]): Indexed[] {
  // A stable sort, so two entries with the same path keep the caller's order.
  return files
    .map((file, index) => ({ file, index }))
    .toSorted((a, b) => comparePaths(a.file.path, b.file.path));
}
