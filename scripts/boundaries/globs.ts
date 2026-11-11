// How the boundary checks read Vite's `import.meta.glob`: which files a glob matches, when that can
// be known without running anything.

import { existsSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { join, matchesGlob, relative, resolve, sep } from 'node:path';

import type { Glob, OptionValue } from './imports.ts';

/** The options of `import.meta.glob` that don't change which files it matches. */
const plainOptions = new Set(['eager', 'import', 'query', 'as']);

/** Whether one of a glob's options would change what it matches beyond what the checks follow. */
export function unfollowed(name: string, value: OptionValue): boolean {
  if (plainOptions.has(name) || name === 'base') return false;
  if (name === 'caseSensitive') return value !== true;
  if (name === 'exhaustive') return value !== false;
  return true;
}

/** The folder a glob's patterns start from, at `from`: its `base`, when that starts with `.`. */
export function globBase(
  options: ReadonlyMap<string, OptionValue>,
  from: string,
): string | undefined {
  const base = options.has('base') ? options.get('base') : '.';
  const usable =
    typeof base === 'string' && (base === '.' || base === '..' || /^\.\.?\//.test(base));
  return usable ? resolve(from, base) : undefined;
}

/** The files a glob at `from` matches, through symlinks, when what it matches can be followed. */
export function globMatches({ patterns, options }: Glob, from: string): string[] {
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
 * The files `pattern` matches from `cwd`, as Vite matches them: through symlinked folders too,
 * leaving out `node_modules` and, unless the pattern names them, hidden files and folders.
 */
export function expandGlob(pattern: string, cwd: string): string[] {
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
      } else if (isFile(path) && matchesGlob(relative(base, path).split(sep).join('/'), rest)) {
        found.push(path);
      }
    }
  };
  if (isFolder(base)) walk(base);
  return found;
}

export function isFile(path: string): boolean {
  return existsSync(path) && statSync(path).isFile();
}

export function isFolder(path: string): boolean {
  return existsSync(path) && statSync(path).isDirectory();
}
