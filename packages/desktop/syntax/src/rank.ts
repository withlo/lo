// Ranking: which of a name's definitions the asking file most likely means, by syntax alone. Those
// in the asking file come first, then those in its folder, then those in a file its imports name,
// then the rest, each in path order. An import names a file when it brings the name in from it, or
// brings in a module or class the file may reach the name through, as `store.Open` or
// `Circle.unit()`. Each answer is labelled, so the reader knows how much links it to the asking
// file: its file or an import, or only its name.

import type { Import, ImportedName } from './imports.ts';
import { taggedLanguageOfPath, type TaggedLanguage } from './tagged.ts';

/** How near a definition is to the file asking for it, nearest first. */
export const nearness = ['file', 'folder', 'import', 'name'] as const;

export type Nearness = (typeof nearness)[number];

/** The label of a syntax answer that something besides its name links to the asking file. */
export const syntaxLabel = 'Syntax index';

/** The label of a syntax answer that only its name links to the asking file. */
export const sameNameLabel = 'Syntax index · same name';

/** The file asking for a name's definitions: its path, and what its symbols say it imports. */
export interface Asking {
  path: string;
  imports: readonly Import[];
  namespace?: string | undefined;
}

export interface Ranked<T> {
  candidate: T;
  near: Nearness;
  label: typeof syntaxLabel | typeof sameNameLabel;
}

/**
 * Ranks the definitions of `name` found across a tree for the file `from`. A definition in a
 * language the asking file's can't call is left out: TypeScript, TSX and JavaScript call each
 * other, and so do Java and Kotlin; every other language only itself.
 */
export function rank<T extends { path: string }>(
  name: string,
  from: Asking,
  candidates: readonly T[],
): Ranked<T>[] {
  const language = taggedLanguageOfPath(from.path);
  const family = language === undefined ? undefined : familyOf(language);
  const folder = folderOf(from.path);
  let matcher: ((path: string) => boolean) | undefined;
  const imported = (path: string): boolean => {
    matcher ??= language === undefined ? () => false : importMatcher(language, from, name);
    return matcher(path);
  };
  const ranked: Ranked<T>[] = [];
  for (const candidate of candidates) {
    const theirs = taggedLanguageOfPath(candidate.path);
    if (theirs === undefined || (family !== undefined && familyOf(theirs) !== family)) continue;
    let near: Nearness;
    let linked: boolean;
    if (candidate.path === from.path) {
      near = 'file';
      linked = true;
    } else if (folderOf(candidate.path) === folder) {
      near = 'folder';
      // A Go package is its folder, so its files use each other's names without importing them.
      linked = language === 'go' || imported(candidate.path);
    } else {
      linked = imported(candidate.path);
      near = linked ? 'import' : 'name';
    }
    ranked.push({ candidate, near, label: linked ? syntaxLabel : sameNameLabel });
  }
  // Stable, so a file's definitions keep the order they were given in.
  return ranked.toSorted(
    (a, b) =>
      nearness.indexOf(a.near) - nearness.indexOf(b.near) ||
      compare(a.candidate.path, b.candidate.path),
  );
}

/**
 * The import that brings `name` into a file by that name, and the name it has where it comes from,
 * if one does. A module brought in whole names nothing.
 */
export function importOf(
  imports: readonly Import[],
  name: string,
): { from: Import; name: string } | undefined {
  for (const from of imports) {
    if (from.names === 'all') continue;
    const found = from.names.find((imported) => (imported.as ?? imported.name) === name);
    if (found) return { from, name: found.name };
  }
  return undefined;
}

function compare(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** The languages whose files call each other, by a name for each such group. */
function familyOf(language: TaggedLanguage): string {
  switch (language) {
    case 'javascript':
    case 'tsx':
    case 'typescript':
      return 'javascript';
    case 'java':
    case 'kotlin':
      return 'java';
    case 'csharp':
    case 'elixir':
    case 'go':
    case 'php':
    case 'python':
    case 'ruby':
    case 'rust':
    case 'swift':
    case 'terraform':
      return language;
    default:
      throw new Error(`No family for ${String(language satisfies never)}.`);
  }
}

/** The folder a path is in, `""` at the root. */
export function folderOf(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? '' : path.slice(0, slash);
}

/** The last part of a path. */
function baseOf(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

/** `relative` resolved in `folder`, following `.` and `..`, or `undefined` above the root. */
export function join(folder: string, relative: string): string | undefined {
  const parts = folder.split('/').filter((part) => part !== '');
  for (const part of relative.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (parts.length === 0) return undefined;
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  return parts.join('/');
}

/** Whether `path` is `suffix`, or ends with a `/` and `suffix`. */
function endsWithPath(path: string, suffix: string): boolean {
  return suffix !== '' && (path === suffix || path.endsWith(`/${suffix}`));
}

/** Whether an import brings `name` in by name, under its own name or the one the file uses. */
function brings(names: readonly ImportedName[], name: string): boolean {
  return names.some((imported) => imported.name === name || imported.as === name);
}

/**
 * Whether the file at a path is one that `from`'s imports say `name` may be defined in: a guess
 * for each language from the asking file's path and imports, never from a project's manifest.
 */
function importMatcher(
  language: TaggedLanguage,
  from: Asking,
  name: string,
): (path: string) => boolean {
  switch (language) {
    case 'javascript':
    case 'tsx':
    case 'typescript':
      return scripts(from);
    case 'python':
      return python(from, name);
    case 'rust':
      return rust(from, name);
    case 'go':
      return go(from, name);
    case 'java':
    case 'kotlin':
      return jvm(from, name);
    case 'php':
      return php(from, name);
    case 'csharp':
    case 'elixir':
    case 'ruby':
    case 'swift':
    case 'terraform':
      return () => false;
    default:
      throw new Error(`No import matching for ${String(language satisfies never)}.`);
  }
}

/** The extensions of JavaScript and TypeScript files, longest first. */
const scriptExtensions = [
  '.d.mts',
  '.d.cts',
  '.d.ts',
  '.mts',
  '.cts',
  '.tsx',
  '.jsx',
  '.mjs',
  '.cjs',
  '.ts',
  '.js',
];

function withoutScriptExtension(path: string): string | undefined {
  const extension = scriptExtensions.find((candidate) => path.endsWith(candidate));
  return extension === undefined ? undefined : path.slice(0, -extension.length);
}

/**
 * JavaScript and TypeScript: a relative import names a file by its path, with any script
 * extension (`./parse.js` is `parse.ts` too), or the `index` in a folder. Others name packages or
 * a project's path aliases, which only its configuration knows. What a file imports can be a class
 * or a namespace whose members it uses, so a file it imports counts for any name.
 */
function scripts(from: Asking): (path: string) => boolean {
  const stems = new Set<string>();
  for (const { module } of from.imports) {
    if (!(
      module === '.' ||
      module === '..' ||
      module.startsWith('./') ||
      module.startsWith('../')
    )) {
      continue;
    }
    const stem = join(folderOf(from.path), withoutScriptExtension(module) ?? module);
    if (stem !== undefined) stems.add(stem);
  }
  return (path) => {
    const stem = withoutScriptExtension(path);
    if (stem === undefined) return false;
    return stems.has(stem) || (baseOf(stem) === 'index' && stems.has(folderOf(stem)));
  };
}

/**
 * Python: `from a.b import c` names `a/b.py` or `a/b/__init__.py`, under any folder, since the
 * folder imports start from isn't known; `from .b import c` names them beside the asking file.
 * `from a import b` may bring in a module, so `a/b.py` counts for any name.
 */
function python(from: Asking, name: string): (path: string) => boolean {
  const exact = new Set<string>();
  const suffixes = new Set<string>();
  const add = (module: string, child?: string): void => {
    const dots = /^\.*/.exec(module)![0].length;
    const rest = module
      .slice(dots)
      .split('.')
      .filter((part) => part !== '');
    if (child !== undefined) rest.push(child);
    if (dots === 0) {
      if (rest.length > 0) suffixes.add(rest.join('/'));
      return;
    }
    let folder: string | undefined = folderOf(from.path);
    for (let up = 1; up < dots && folder !== undefined; up++) {
      folder = folder === '' ? undefined : folderOf(folder);
    }
    if (folder !== undefined) exact.add([folder, ...rest].filter((part) => part !== '').join('/'));
  };
  for (const { module, names } of from.imports) {
    if (names === 'all' || brings(names, name)) add(module);
    if (names !== 'all') for (const imported of names) add(module, imported.name);
  }
  return (path) => {
    const stem = path.endsWith('.py')
      ? path.slice(0, -3)
      : path.endsWith('.pyi')
        ? path.slice(0, -4)
        : undefined;
    if (stem === undefined) return false;
    const module = baseOf(stem) === '__init__' ? folderOf(stem) : stem;
    if (exact.has(module)) return true;
    for (const suffix of suffixes) if (endsWithPath(module, suffix)) return true;
    return false;
  };
}

/**
 * Rust: `use crate::a::b::C` names `a/b.rs` or `a/b/mod.rs` in the asking file's crate, the folder
 * holding its `src`; `self::` and `super::` start from the asking file's module, and `mod child;`
 * names the module's file. Other crates' paths name no file. `use crate::a::b` may bring in a
 * module, so `a/b.rs` counts for any name.
 */
function rust(from: Asking, name: string): (path: string) => boolean {
  const files = new Set<string>();
  const parts = from.path.split('/');
  const src = parts.lastIndexOf('src', parts.length - 2);
  const root = src === -1 ? undefined : parts.slice(0, src + 1).join('/');
  const file = baseOf(from.path);
  // The folder the asking file's own modules are in.
  const own = ['mod.rs', 'lib.rs', 'main.rs'].includes(file)
    ? folderOf(from.path)
    : from.path.replace(/\.rs$/, '');
  const add = (module: string, child?: string): void => {
    const path = module.split('::');
    if (child !== undefined) path.push(child);
    let folder: string | undefined;
    let at = 1;
    if (path[0] === 'crate') folder = root;
    else if (path[0] === 'self') folder = own;
    else if (path[0] === 'super') {
      folder = own;
      at = 0;
      while (path[at] === 'super' && folder !== undefined) {
        folder = folder === '' ? undefined : folderOf(folder);
        at++;
      }
    }
    if (folder === undefined) return;
    const rest = path.slice(at);
    if (
      rest.some((part) => part === '' || part === 'self' || part === 'super' || part === 'crate')
    ) {
      return;
    }
    const base = [folder, ...rest].filter((part) => part !== '').join('/');
    // A crate's own module is its `lib.rs` or `main.rs`; any other, its file or its `mod.rs`.
    if (base === root) {
      for (const top of ['lib.rs', 'main.rs']) files.add(`${base}/${top}`);
      return;
    }
    files.add(`${base}.rs`);
    files.add(`${base}/mod.rs`);
  };
  for (const { module, names } of from.imports) {
    if (names === 'all' || brings(names, name)) add(module);
    if (names !== 'all') for (const imported of names) add(module, imported.name);
  }
  return (path) => files.has(path);
}

/**
 * Go: an import path names the package in a folder its path ends with, whose exported names, the
 * capitalized ones, the asking file uses through it.
 */
function go(from: Asking, name: string): (path: string) => boolean {
  if (!/^\p{Lu}/u.test(name)) return () => false;
  const packages = from.imports.filter(({ names }) => names === 'all').map(({ module }) => module);
  return (path) => {
    const folder = folderOf(path);
    return path.endsWith('.go') && packages.some((module) => endsWithPath(module, folder));
  };
}

const jvmExtensions = ['.java', '.kt', '.kts'];

/** A Java or Kotlin package as a path: `com.acme` is `com/acme`. */
function slashed(module: string): string {
  return module.replaceAll('.', '/');
}

/**
 * Java and Kotlin: `import a.b.C` names `a/b/C.java` or `C.kt` under any folder, for `C` and the
 * members used through it, and with `import static a.b.C.m`, `C`'s file names `m`; a Kotlin
 * function can be in any file of its package's folder. A wildcard and the asking file's own
 * `package` name every file of the package's folder. Both languages, since each calls the other.
 */
function jvm(from: Asking, name: string): (path: string) => boolean {
  const files = new Set<string>();
  const folders = new Set<string>();
  for (const { module, names } of from.imports) {
    if (names === 'all') {
      folders.add(slashed(module));
      files.add(slashed(module));
      continue;
    }
    for (const imported of names) {
      // A class, whose members the file can use through it.
      files.add([slashed(module), imported.name].filter((part) => part !== '').join('/'));
      if (imported.name !== name && imported.as !== name) continue;
      // A static import's class.
      files.add(slashed(module));
      // A Kotlin function or property, which can be in any file of its package.
      if (/^\p{Ll}/u.test(imported.name)) folders.add(slashed(module));
    }
  }
  if (from.namespace !== undefined) folders.add(slashed(from.namespace));
  folders.delete('');
  files.delete('');
  return (path) => {
    const extension = jvmExtensions.find((candidate) => path.endsWith(candidate));
    if (extension === undefined) return false;
    const stem = path.slice(0, -extension.length);
    for (const file of files) if (endsWithPath(stem, file)) return true;
    const folder = folderOf(path);
    for (const named of folders) if (endsWithPath(folder, named)) return true;
    return false;
  };
}

/** A PHP namespace's folder, past its first part: `App\Models` is `…/Models`. */
function namespaceFolder(parts: readonly string[]): string | undefined {
  return parts.length >= 2 ? parts.at(-1) : undefined;
}

/**
 * PHP: `use App\Models\User` names `User.php` in a folder `Models`, as PSR-4 lays classes out under
 * a folder that stands for the namespace's first part, which only `composer.json` knows. A
 * function or constant imported can be in any file of its namespace's folder, and so can the
 * classes of the asking file's own namespace.
 */
function php(from: Asking, name: string): (path: string) => boolean {
  const files = new Set<string>();
  const folders = new Set<string>();
  for (const { module, names } of from.imports) {
    if (names === 'all') continue;
    const parts = module === '' ? [] : module.split('\\');
    const at = namespaceFolder(parts);
    for (const imported of names) {
      files.add(at === undefined ? imported.name : `${at}/${imported.name}`);
      if ((imported.name === name || imported.as === name) && at !== undefined) folders.add(at);
    }
  }
  if (from.namespace !== undefined) {
    const at = namespaceFolder(from.namespace.split('\\'));
    if (at !== undefined) folders.add(at);
  }
  return (path) => {
    if (!path.endsWith('.php')) return false;
    const stem = path.slice(0, -4);
    for (const file of files) if (endsWithPath(stem, file)) return true;
    for (const named of folders) if (endsWithPath(folderOf(path), named)) return true;
    return false;
  };
}
