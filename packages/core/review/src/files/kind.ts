/** Sorting files into the groups of review order: source, test, config and generated. */

import { fileName, type ChangedFile } from './changed.ts';
import { isLockfile, whyGenerated } from './generated.ts';

/**
 * Which group of review order a file belongs to.
 *
 * - `source`: code, and anything that isn't a test, config or generated, such as docs and images.
 * - `test`: a test, recognized by its name ({@link asTest}).
 * - `config`: a JSON, YAML or TOML file, a lockfile that isn't generated, a dotfile such as
 *   `.gitignore`, or anything in a dot-directory such as `.github/` or `.husky/`.
 * - `generated`: a generated file ({@link whyGenerated}).
 *
 * A file that fits several groups takes the first of generated, config, test and source. So a
 * generated test is generated, and a test under `.github/` is config.
 */
export type FileKind = 'source' | 'test' | 'config' | 'generated';

/** The group of review order the file belongs to. */
export function fileKind(file: ChangedFile): FileKind {
  if (whyGenerated(file) !== undefined) return 'generated';
  if (isConfig(file.path)) return 'config';
  if (asTest(file.path) !== undefined) return 'test';
  return 'source';
}

/** Extensions of config files, matched ignoring case. */
const CONFIG_EXTENSIONS: ReadonlySet<string> = new Set([
  'json',
  'jsonc',
  'json5',
  'yaml',
  'yml',
  'toml',
]);

/**
 * JavaScript's and TypeScript's extensions. A test with one matches a source file with any of
 * them.
 */
export const SCRIPT_EXTENSIONS: ReadonlySet<string> = new Set([
  'ts',
  'tsx',
  'js',
  'jsx',
  'mjs',
  'cjs',
]);

function isConfig(path: string): boolean {
  if (path.split('/').some((component) => component.startsWith('.'))) return true;
  if (isLockfile(path)) return true;
  const name = splitName(fileName(path));
  return name !== undefined && CONFIG_EXTENSIONS.has(name.extension.toLowerCase());
}

/** A code file's name, split for matching tests to sources. */
export interface Name {
  /** The name without its extension: `foo` for `foo.ts`, `foo.d` for `foo.d.ts`. */
  readonly stem: string;
  /** The extension, without the dot. */
  readonly extension: string;
}

/** Splits a file name at its last dot. Nothing when it has no extension, or nothing before it. */
export function splitName(name: string): Name | undefined {
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) return undefined;
  return { stem: name.slice(0, dot), extension: name.slice(dot + 1) };
}

/** A test file. */
export interface TestFile {
  /**
   * The name of the source file it tests: `foo.ts` for `foo.test.ts`, `foo.rs` for
   * `tests/foo.rs`. Nothing for a `.rs` file deeper in `tests`, such as `tests/common/mod.rs`.
   */
  readonly subject: Name | undefined;
}

/**
 * The file at `path` as a test, or nothing when it isn't one. Tests are recognized by their names:
 *
 * - JavaScript and TypeScript: `foo.test.ts` and `foo.spec.ts`, and the same for `.tsx`, `.js`,
 *   `.jsx`, `.mjs` and `.cjs`.
 * - Go: `foo_test.go`.
 * - Python: `test_foo.py` and `foo_test.py`.
 * - Cargo's integration tests: any `.rs` file in a `tests` directory, such as `tests/foo.rs` or
 *   `tests/common/mod.rs`.
 *
 * Other files in test directories, such as `tests/conftest.py` or `__tests__/foo.ts`, keep the
 * group their name gives them.
 */
export function asTest(path: string): TestFile | undefined {
  const slash = path.lastIndexOf('/');
  const name = splitName(path.slice(slash + 1));
  if (name === undefined) return undefined;
  // The test's stem with its marker taken off, which must leave something.
  const tests = (stem: string | undefined): TestFile | undefined =>
    stem === undefined || stem === ''
      ? undefined
      : { subject: { stem, extension: name.extension } };
  if (SCRIPT_EXTENSIONS.has(name.extension)) {
    return tests(withoutSuffix(name.stem, '.test') ?? withoutSuffix(name.stem, '.spec'));
  }
  switch (name.extension) {
    case 'go':
      return tests(withoutSuffix(name.stem, '_test'));
    case 'py':
      return tests(withoutPrefix(name.stem, 'test_') ?? withoutSuffix(name.stem, '_test'));
    case 'rs': {
      const directories = slash < 0 ? [] : path.slice(0, slash).split('/');
      if (directories.at(-1) === 'tests') return { subject: name };
      if (directories.includes('tests')) return { subject: undefined };
      return undefined;
    }
    default:
      return undefined;
  }
}

function withoutSuffix(text: string, suffix: string): string | undefined {
  return text.endsWith(suffix) ? text.slice(0, text.length - suffix.length) : undefined;
}

function withoutPrefix(text: string, prefix: string): string | undefined {
  return text.startsWith(prefix) ? text.slice(prefix.length) : undefined;
}
