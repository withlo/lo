import { existsSync, globSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

import { mapped, realPath, sourceFiles, splitPackage, toSlashes, type Violation } from './check.ts';
import { globsOf, importsOf, ParseError, type Glob, type Import } from './imports.ts';

/** The desktop app, whose features each have a folder in `src/features/`. */
const app = 'apps/desktop';
const features = `${app}/src/features`;

/** The files in a feature's folder that other features may import, the ones it shares through. */
const sharedFiles = ['contract.ts', 'keys.ts', 'service.ts', 'window/shared.ts'];

const shared = `contract.ts, keys.ts, service.ts and window/shared.ts`;

/**
 * Checks that the desktop app's features share only through their shared files: from inside one
 * feature's folder, an import or an `import.meta.glob` that reaches into another feature's folder
 * reaches only those. Imports resolve as the boundary check resolves them, through symlinks,
 * installed packages and the app's `imports`, to the file they land on.
 */
export function checkFeatures(workspaceRoot: string): Violation[] {
  // Real paths throughout, so that a path through a symlink lands in the folder it points to.
  const root = realpathSync(workspaceRoot);
  const folder = join(root, features);
  if (!existsSync(folder)) return [];
  const imports = importsMap(join(root, app, 'package.json'));

  /** The feature whose folder holds `path`, and where in it; nothing outside every feature's. */
  const placeOf = (path: string) => {
    const where = toSlashes(relative(folder, path));
    const [feature, ...rest] = where.split('/');
    if (!feature || feature === '..' || rest.length === 0) return undefined;
    return { feature, file: rest.join('/') };
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
    return `that's ${place.file} in the ${place.feature} feature, and features share only their ${shared}`;
  };

  const violations: Violation[] = [];
  for (const file of sourceFiles(folder, features, new Set())) {
    // A file directly in `src/features/` is in no feature's folder.
    const home = placeOf(file)?.feature;
    if (!home) continue;
    const parsed = parse(file);
    // The boundary check reports a file that doesn't parse.
    if (!parsed) continue;
    const where = toSlashes(relative(root, file));
    const from = dirname(file);
    const report = (line: number, message: string) => {
      violations.push({ where: `${where}:${line}`, message });
    };

    for (const { specifier, line, reference, computed, loader } of parsed.imports) {
      // The boundary check allows these only in the files it lists.
      if (loader) continue;
      if (computed) {
        report(
          line,
          `loads ${specifier}: the module is chosen at run time, so where it lands can't be checked. A feature loads modules by name.`,
        );
        continue;
      }
      const why = land(specifier, from)
        .map((path) => reason(path, home))
        .find((text) => text !== undefined);
      if (why) report(line, `${reference ? 'references' : 'imports'} ${specifier}: ${why}.`);
    }

    for (const { patterns, line } of parsed.globs) {
      // A pattern that leaves files out can only narrow what the others match.
      for (const pattern of patterns.filter((each) => !each.startsWith('!'))) {
        if (!pattern.startsWith('./') && !pattern.startsWith('../')) {
          report(
            line,
            `globs ${pattern}: a feature's globs start with ./ or ../, from the file, so where they reach can be checked.`,
          );
          continue;
        }
        const why = globSync(pattern, { cwd: from })
          .toSorted()
          .map((match) => ({ match, text: reason(realPath(resolve(from, match)), home) }))
          .find(({ text }) => text !== undefined);
        if (why)
          report(line, `globs ${pattern}, which matches ${toSlashes(why.match)}: ${why.text}.`);
      }
    }
  }
  return violations.toSorted((a, b) => a.where.localeCompare(b.where, 'en', { numeric: true }));
}

/** A file's imports and globs, or nothing when it doesn't parse. */
function parse(file: string): { imports: Import[]; globs: Glob[] } | undefined {
  const source = readFileSync(file, 'utf8');
  try {
    return { imports: importsOf(file, source), globs: globsOf(file, source) };
  } catch (error) {
    if (error instanceof ParseError) return undefined;
    throw error;
  }
}

/** The `imports` of the `package.json` at `path`, if there is one. */
function importsMap(path: string): unknown {
  if (!existsSync(path)) return undefined;
  const manifest: unknown = JSON.parse(readFileSync(path, 'utf8'));
  return typeof manifest === 'object' && manifest !== null
    ? Reflect.get(manifest, 'imports')
    : undefined;
}
