// The npm packages a build bundles, with the license each carries, for the notices Lo ships.
//
// Vite's own `build.license` finds them too, but electron-vite bundles each `?modulePath` entry (the
// background process and the symbol store's worker) in a build of its own and hands only its files
// on, so the packages bundled there never reach Vite's list. This plugin runs in those builds as
// well, and the build that holds them writes what all of them found.

import { readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

import type { Plugin } from 'vite';
import { z } from 'zod';

/** A package that is in a bundle, with what its folder says of its license. */
export interface Bundled {
  readonly name: string;
  readonly version: string;
  /** Its `license` field, trimmed. Absent when it declares none, or none Lo can read. */
  readonly license?: string | undefined;
  /** Its license file's text. Absent when it has none. */
  readonly text?: string | undefined;
  /** Its NOTICE file's text, which an Apache-2.0 package may carry and its license requires. */
  readonly notice?: string | undefined;
}

/** What a package's `package.json` says that the notices need. */
const manifest = z.looseObject({
  name: z.string(),
  version: z.string().optional(),
  license: z.unknown().optional(),
});

/** A package's folder, with its manifest. */
interface Found {
  readonly dir: string;
  readonly manifest: z.output<typeof manifest>;
}

/** A module's or asset's path, without the `?query` or `#fragment` a build may add to an id. */
function pathOf(id: string): string {
  return id.replace(/[?#].*$/, '');
}

/** Whether `path` is in a package installed in a `node_modules` folder. */
function installed(path: string): boolean {
  return path.includes('/node_modules/');
}

/**
 * The text of the first file in `dir` whose name matches `pattern`, read as UTF-8 and trimmed.
 * Absent when none does.
 */
function textOf(dir: string, pattern: RegExp): string | undefined {
  const file = readdirSync(dir)
    .filter((name) => pattern.test(name))
    .toSorted()[0];
  return file === undefined ? undefined : readFileSync(join(dir, file), 'utf8').trim();
}

/** Reads each package's folder once. Makes the finder, with its own memory. */
export function packageReader(): (file: string) => Bundled | undefined {
  const folders = new Map<string, Found | null>();
  const packages = new Map<string, Bundled>();

  /**
   * The nearest `package.json` above `dir` that names a package: others only mark a module type.
   * It's never above a `node_modules` folder, since what lies above isn't the package.
   */
  function nearest(dir: string): Found | undefined {
    if (basename(dir) === 'node_modules') return undefined;
    const remembered = folders.get(dir);
    if (remembered !== undefined) return remembered ?? undefined;
    let found: Found | null = null;
    try {
      const read = manifest.safeParse(JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')));
      if (read.success) found = { dir, manifest: read.data };
    } catch {
      // No package.json here, or one that isn't JSON: go on up.
    }
    if (found === null && dirname(dir) !== dir) found = nearest(dirname(dir)) ?? null;
    folders.set(dir, found);
    return found ?? undefined;
  }

  return (file) => {
    const path = pathOf(file);
    if (file.startsWith('\0') || !installed(path)) return undefined;
    const found = nearest(dirname(path));
    if (!found) return undefined;
    const { name, version = '0.0.0', license } = found.manifest;
    const key = `${name}@${version}`;
    let bundled = packages.get(key);
    if (!bundled) {
      bundled = {
        name,
        version,
        license: typeof license === 'string' ? license.trim() : undefined,
        text: textOf(found.dir, /^(?:licen[cs]e|copying)/i),
        notice: textOf(found.dir, /^notice/i),
      };
      packages.set(key, bundled);
    }
    return bundled;
  };
}

/** Packages in name and version order, each once, as a list written to a file reads the same. */
export function sorted(packages: Iterable<Bundled>): Bundled[] {
  const each = new Map<string, Bundled>();
  for (const bundled of packages) each.set(`${bundled.name}@${bundled.version}`, bundled);
  return [...each.entries()]
    .toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, bundled]) => bundled);
}

/** What of a bundle's outputs the collector reads: a chunk's modules, or an asset's source files. */
export type Output =
  | { readonly type: 'chunk'; readonly moduleIds: readonly string[] }
  | { readonly type: 'asset'; readonly originalFileNames: readonly string[] };

/** The packages a build bundles, found output by output as the build makes them. */
export interface Collector {
  /** Takes in the packages of every chunk's modules and every asset's source files in `bundle`. */
  add(bundle: Readonly<Record<string, Output>>): void;
  /** Every package taken in so far, in order. */
  list(): Bundled[];
}

/**
 * A collector for a build whose root is `root`, which names an asset's files: Vite gives them
 * relative to it, where a chunk's modules have absolute ids.
 */
export function collector(root: () => string): Collector {
  const read = packageReader();
  const found = new Map<string, Bundled>();
  return {
    add(bundle) {
      for (const output of Object.values(bundle)) {
        const files =
          output.type === 'chunk'
            ? output.moduleIds
            : output.originalFileNames.map((file) => resolve(root(), file));
        for (const file of files) {
          const bundled = read(file);
          if (bundled) found.set(`${bundled.name}@${bundled.version}`, bundled);
        }
      }
    },
    list: () => sorted(found.values()),
  };
}

/**
 * Lists the packages a build bundles in `fileName` in its output folder, as JSON of {@link Bundled}:
 * those whose modules are in a chunk, and those whose files are copied into an asset, such as a
 * font. A build that writes nothing, as a `?modulePath` entry's does, only adds to what the build
 * holding it writes.
 */
export function bundledPackages(fileName: string): Plugin {
  let root = process.cwd();
  const packages = collector(() => root);
  return {
    name: 'lo:bundled-packages',
    apply: 'build',
    configResolved(config) {
      root = config.root;
    },
    generateBundle(_options, bundle, isWrite) {
      packages.add(bundle);
      if (!isWrite) return;
      this.emitFile({
        type: 'asset',
        fileName,
        source: `${JSON.stringify(packages.list(), null, 2)}\n`,
      });
    },
  };
}
