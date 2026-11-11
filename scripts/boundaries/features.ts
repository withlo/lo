import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, matchesGlob, relative, resolve } from 'node:path';

import { isTest, mapped, realPath, splitPackage, toSlashes, type Violation } from './check.ts';
import {
  importsOf,
  ParseError,
  referencesOf,
  type Glob,
  type Import,
  type OptionValue,
  type References,
} from './imports.ts';

/** The desktop app, whose features each have a folder in `src/features/`. */
const app = 'apps/desktop';
const features = `${app}/src/features`;

/** The files in a feature's folder that other features may import, the ones it shares through. */
const sharedFiles = ['contract.ts', 'keys.ts', 'service.ts', 'window/shared.ts'];

const shared = `contract.ts, keys.ts, service.ts and window/shared.ts`;

/** Files Vite can bundle that refer to other files: scripts, and stylesheets. */
const bundled = /\.(?:[cm]?[jt]s|[jt]sx|css)$/;

/** The options of `import.meta.glob` that don't change which files it matches. */
const plainOptions = new Set(['eager', 'import', 'query', 'as']);

/**
 * Checks that the desktop app's features share only through their shared files: from inside one
 * feature's folder, an import, an `import.meta.glob`, a `new URL(…, import.meta.url)`, a
 * `declare module` or a stylesheet's `@import` or `url()` that reaches into another feature's
 * folder reaches only those, and a shared file re-exports none of its own feature's other files.
 * Imports resolve as the boundary check resolves them, through symlinks, installed packages and
 * the app's `imports`, to the file they land on. Every file in a feature's folder that Vite could
 * bundle is checked, in whatever folder it sits.
 */
export function checkFeatures(workspaceRoot: string): Violation[] {
  // Real paths throughout, so that a path through a symlink lands in the folder it points to.
  const root = realpathSync(workspaceRoot);
  const folder = join(root, features);
  if (!existsSync(folder)) return [];
  const imports = importsMap(join(root, app, 'package.json'));

  /**
   * The feature whose folder holds `path`, and where in it: `''` for the folder itself, which
   * Vite loads as its `index`, as it does any folder. Nothing outside every feature's folder, or
   * for a file directly in `src/features/`.
   */
  const placeOf = (path: string) => {
    const where = toSlashes(relative(folder, path));
    if (where === '' || where === '..' || where.startsWith('../') || isAbsolute(where)) {
      return undefined;
    }
    const [feature = '', ...rest] = where.split('/');
    if (rest.length === 0 && isFile(path)) return undefined;
    const file = rest.join('/');
    // How it's named in a message: a folder with a slash after it.
    const name = file !== '' && isFolder(path) ? `${file}/` : file;
    return { feature, file, name };
  };

  /** Where `specifier`, imported from `from`, lands: one real path, or more for an `imports` map. */
  const land = (specifier: string, from: string): string[] => {
    // Without a query or fragment, keeping a `#name`'s own `#`.
    const path = specifier.slice(0, 1) + specifier.slice(1).replace(/[?#].*$/, '');
    if (path.startsWith('.') || path.startsWith('/')) return [realPath(resolve(from, path))];
    if (path.startsWith('#')) {
      return (mapped(imports, path) ?? []).flatMap((target) =>
        target.startsWith('#') ? [] : land(target, join(root, app)),
      );
    }
    // A package, found as Node finds it, from the importing folder up to the workspace's root.
    const { name, rest } = splitPackage(path);
    for (let dir = from; ; dir = dirname(dir)) {
      const installed = join(dir, 'node_modules', name);
      if (existsSync(installed)) return [realPath(join(installed, ...rest))];
      if (dir === root || dirname(dir) === dir) return [];
    }
  };

  /** Why a file in `home`'s folder may not reach `path`, or nothing when it may. */
  const reason = (path: string, home: string): string | undefined => {
    const place = placeOf(path);
    if (!place || place.feature === home || sharedFiles.includes(place.file)) return undefined;
    const what =
      place.file === ''
        ? `the ${place.feature} feature's folder, which loads its index`
        : `${place.name} in the ${place.feature} feature`;
    return `that's ${what}, and features share only their ${shared}`;
  };

  /** Why `specifier` may not be reached from `from`, in `home`'s folder: the first reason found. */
  const verdict = (specifier: string, from: string, home: string): string | undefined =>
    land(specifier, from)
      .map((path) => reason(path, home))
      .find((text) => text !== undefined);

  const files = [...featureFiles(folder)].flatMap((file) => {
    const place = placeOf(file);
    if (!place) return [];
    const parsed = file.endsWith('.css') ? undefined : parse(file);
    return [{ file, place, from: dirname(file), parsed }];
  });

  // Every file something in a feature's folder bundles, as far as it can be followed: a test or
  // a fixture nothing bundles never reaches the app.
  const reached = new Set<string>();
  const reach = (paths: readonly string[]) => {
    for (const path of paths) for (const each of resolutions(path)) reached.add(each);
  };
  for (const { from, parsed } of files) {
    if (!parsed) continue;
    for (const { specifier, computed, loader } of parsed.imports) {
      if (!computed && !loader) reach(land(specifier, from));
    }
    for (const { specifier, computed } of parsed.references.urls) {
      if (!computed) reach(land(specifier, from));
    }
    for (const glob of parsed.references.globs) reach(globMatches(glob, from).map(realPath));
  }

  const violations: Violation[] = [];
  for (const { file, place, from, parsed } of files) {
    const home = place.feature;
    const where = toSlashes(relative(root, file));
    const report = (line: number, message: string) => {
      violations.push({ where: `${where}:${line}`, message });
    };

    if (file.endsWith('.css')) {
      for (const { specifier, line } of stylesheetReferences(readFileSync(file, 'utf8'))) {
        // A stylesheet's `url(icon.svg)` is a file beside it, unless it's a package's.
        const ways = specifier.startsWith('.') ? [specifier] : [specifier, `./${specifier}`];
        const why = ways.map((way) => verdict(way, from, home)).find((text) => text);
        if (why) report(line, `refers to ${specifier}: ${why}.`);
      }
      continue;
    }

    // Nothing can bundle a file that doesn't parse, and the boundary check reports one it reads.
    if (!parsed) continue;
    // A shared file names what its feature shares: handing on another of its files would share
    // all of that file.
    const sharing = sharedFiles.includes(place.file);
    /** What `specifier` is among its own feature's other files, if it's one of them. */
    const ownFile = (specifier: string) => {
      const own = land(specifier, from)
        .map(placeOf)
        .find((at) => at?.feature === home && !sharedFiles.includes(at.file));
      return own && (own.file === '' ? 'its own folder' : own.name);
    };
    const handsOn = `a shared file names each thing it shares, so it hands on none of its feature's other files.`;
    // A module chosen at run time stays out of the app in a test or fixture nothing bundles.
    const unbundled =
      (isTest(place.file) || /(?:^|\/)fixtures\//.test(place.file)) && !reached.has(file);

    for (const { specifier, line, reference, computed, loader, reexport } of parsed.imports) {
      // The boundary check allows these only in the files it lists.
      if (loader) continue;
      if (computed) {
        if (unbundled) continue;
        report(
          line,
          `loads ${specifier}: the module is chosen at run time, so where it lands can't be checked. A feature loads modules by name.`,
        );
        continue;
      }
      const why = verdict(specifier, from, home);
      if (why) {
        report(line, `${reference ? 'references' : 'imports'} ${specifier}: ${why}.`);
        continue;
      }
      const own = sharing && reexport === 'value' ? ownFile(specifier) : undefined;
      if (own) report(line, `re-exports ${specifier}, which is ${own}: ${handsOn}`);
    }

    if (sharing) {
      for (const { specifier, line } of parsed.references.exported) {
        const own = ownFile(specifier);
        if (own) {
          report(line, `exports what it imports from ${specifier}, which is ${own}: ${handsOn}`);
        }
      }
    }

    for (const { specifier, line, computed } of parsed.references.urls) {
      if (computed) {
        if (unbundled) continue;
        report(
          line,
          `makes a URL from ${specifier}: the file is chosen at run time, so where it lands can't be checked.`,
        );
        continue;
      }
      const why = verdict(specifier, from, home);
      if (why) report(line, `makes a URL to ${specifier}: ${why}.`);
    }

    for (const { specifier, line } of parsed.references.modules) {
      const why = verdict(specifier, from, home);
      if (why) report(line, `declares module ${specifier}: ${why}.`);
    }

    for (const glob of parsed.references.globs) {
      for (const message of globViolations(glob, from, (path) => reason(path, home))) {
        report(glob.line, message);
      }
    }
  }
  return violations.toSorted((a, b) => a.where.localeCompare(b.where, 'en', { numeric: true }));
}

/** The extensions Vite tries for a path written without one, and for a folder's `index`. */
const extensions = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];

/** The files a path Vite resolves can be: as written, with an extension, or a folder's index. */
function resolutions(path: string): string[] {
  return [
    path,
    ...extensions.map((extension) => path + extension),
    ...extensions.map((extension) => join(path, `index${extension}`)),
  ];
}

/** Whether one of a glob's options would change what it matches beyond what the rule follows. */
function unfollowed(name: string, value: OptionValue): boolean {
  if (plainOptions.has(name) || name === 'base') return false;
  if (name === 'caseSensitive') return value !== true;
  if (name === 'exhaustive') return value !== false;
  return true;
}

/** The folder a glob's patterns start from, at `from`: its `base`, when that starts with `.`. */
function globBase(options: ReadonlyMap<string, OptionValue>, from: string): string | undefined {
  const base = options.has('base') ? options.get('base') : '.';
  const usable =
    typeof base === 'string' && (base === '.' || base === '..' || /^\.\.?\//.test(base));
  return usable ? resolve(from, base) : undefined;
}

/** The files a glob at `from` matches, through symlinks, when what it matches can be followed. */
function globMatches({ patterns, options }: Glob, from: string): string[] {
  if (options === undefined) return [];
  const cwd = globBase(options, from);
  if (cwd === undefined || [...options].some(([name, value]) => unfollowed(name, value))) {
    return [];
  }
  return patterns
    .filter((pattern) => /^\.\.?\//.test(pattern))
    .flatMap((pattern) => expandGlob(pattern, cwd));
}

/**
 * What's wrong with a glob in a feature's folder, at `from`: an option the rule can't follow, or
 * a file it matches that `reason` refuses.
 */
function globViolations(
  { patterns, options }: Glob,
  from: string,
  reason: (path: string) => string | undefined,
): string[] {
  const written = patterns.join(', ');
  if (options === undefined) {
    return [
      `globs ${written} with options that aren't written out as an object, so what it matches can't be checked.`,
    ];
  }
  const problems: string[] = [];
  for (const [name, value] of options) {
    if (!unfollowed(name, value)) continue;
    const said = value === undefined ? name : `${name}: ${JSON.stringify(value)}`;
    problems.push(
      `globs ${written} with ${said}, which the feature rule doesn't follow, so what it matches can't be checked. Leave it out.`,
    );
  }
  const base = options.has('base') ? options.get('base') : '.';
  const cwd = globBase(options, from);
  if (cwd === undefined) {
    const said =
      typeof base === 'string' ? `the base ${JSON.stringify(base)}` : 'a base not written out';
    problems.push(
      `globs ${written} from ${said}: a feature's globs and their base start with ./ or ../, from the file, so where they reach can be checked.`,
    );
    return problems;
  }
  if (problems.length > 0) return problems;
  const fromBase = options.has('base') ? ` (from ${base})` : '';

  // A pattern that leaves files out can only narrow what the others match.
  for (const pattern of patterns.filter((each) => !each.startsWith('!'))) {
    if (!pattern.startsWith('./') && !pattern.startsWith('../')) {
      problems.push(
        `globs ${pattern}: a feature's globs start with ./ or ../, from the file, so where they reach can be checked.`,
      );
      continue;
    }
    const why = expandGlob(pattern, cwd)
      .map((path) => ({ match: toSlashes(relative(cwd, path)), text: reason(realPath(path)) }))
      .find(({ text }) => text !== undefined);
    if (why) problems.push(`globs ${pattern}${fromBase}, which matches ${why.match}: ${why.text}.`);
  }
  return problems;
}

/**
 * The files `pattern` matches from `cwd`, as Vite matches them: through symlinked folders too,
 * leaving out `node_modules` and, unless the pattern names them, hidden files and folders.
 */
function expandGlob(pattern: string, cwd: string): string[] {
  const parts = pattern.split('/');
  const first = parts.findIndex((part) => /[*?[\]{}()!+@]/.test(part));
  const base = resolve(cwd, ...(first === -1 ? parts : parts.slice(0, first)));
  if (first === -1) return isFile(base) ? [base] : [];
  const rest = parts.slice(first).join('/');
  const found: string[] = [];
  // Each folder once, by its real path, so a symlink back up the tree ends.
  const seen = new Set<string>();
  const walk = (folder: string): void => {
    const real = realpathSync(folder);
    if (seen.has(real)) return;
    seen.add(real);
    const entries = readdirSync(folder, { withFileTypes: true });
    for (const entry of entries.toSorted((a, b) => a.name.localeCompare(b.name, 'en'))) {
      const path = join(folder, entry.name);
      if (isFolder(path)) {
        if (entry.name !== 'node_modules') walk(path);
      } else if (isFile(path) && matchesGlob(toSlashes(relative(base, path)), rest)) {
        found.push(path);
      }
    }
  };
  if (isFolder(base)) walk(base);
  return found;
}

/**
 * Every file in each feature's folder that Vite could bundle, in any folder: hidden ones,
 * `node_modules`, `dist` and fixtures too. Symlinks are left out, since an import through one is
 * followed to where it points, and what it points to is checked where it is.
 */
function* featureFiles(folder: string): Generator<string> {
  const entries = readdirSync(folder, { withFileTypes: true });
  for (const entry of entries.toSorted((a, b) => a.name.localeCompare(b.name, 'en'))) {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) yield* featureFiles(path);
    else if (entry.isFile() && bundled.test(entry.name)) yield path;
  }
}

/** A file's imports and the rest of what it refers to, or nothing when it doesn't parse. */
function parse(file: string): { imports: Import[]; references: References } | undefined {
  const source = readFileSync(file, 'utf8');
  try {
    return { imports: importsOf(file, source), references: referencesOf(file, source) };
  } catch (error) {
    if (error instanceof ParseError) return undefined;
    throw error;
  }
}

/**
 * What a stylesheet's `@import` rules and `url()`s name, by relative path or package, with their
 * lines. Addresses, `data:` and the page's own (`/…`, `#…`) aren't files Vite bundles from here.
 */
function stylesheetReferences(source: string): { specifier: string; line: number }[] {
  // Comments blanked out, keeping their line breaks, so the lines stay where they were.
  const text = source.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '));
  const found: { specifier: string; line: number }[] = [];
  const pattern = /@import\s+(?:url\(\s*)?(["']?)([^"')\s;]+)\1|url\(\s*(["']?)([^"')\s]+)\3\s*\)/g;
  for (const match of text.matchAll(pattern)) {
    const specifier = match[2] ?? match[4] ?? '';
    if (/^(?:[a-z][a-z\d+.-]*:|\/|#)/i.test(specifier) || specifier === '') continue;
    found.push({ specifier, line: text.slice(0, match.index).split('\n').length });
  }
  return found;
}

function isFile(path: string): boolean {
  return existsSync(path) && statSync(path).isFile();
}

function isFolder(path: string): boolean {
  return existsSync(path) && statSync(path).isDirectory();
}

/** The `imports` of the `package.json` at `path`, if there is one. */
function importsMap(path: string): unknown {
  if (!existsSync(path)) return undefined;
  const manifest: unknown = JSON.parse(readFileSync(path, 'utf8'));
  return typeof manifest === 'object' && manifest !== null
    ? Reflect.get(manifest, 'imports')
    : undefined;
}
