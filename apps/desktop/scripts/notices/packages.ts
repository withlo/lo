// The npm packages a build bundles, with the license each carries, for the notices Lo ships.
//
// Vite's own `build.license` finds them too, but electron-vite bundles each `?modulePath` entry (the
// background process and the symbol store's worker) in a build of its own and hands only its files
// on, so the packages bundled there never reach Vite's list. This plugin runs in those builds as
// well, and the build that holds them writes what all of them found.

import { readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';

import type { Plugin } from 'vite';
import { z } from 'zod';

import { SIGNATURE, accepted } from './check.ts';

/** A package, with what its folder says of its license. */
export interface Package {
  readonly name: string;
  readonly version: string;
  /** Its `license` field, trimmed. Absent when it declares none, or none Lo can read. */
  readonly license?: string | undefined;
  /**
   * Its license file's text: that of the license it's taken under, when it has a file for each of
   * several. Absent when it has none.
   */
  readonly text?: string | undefined;
  /** Its NOTICE file's text, which an Apache-2.0 package may carry and its license requires. */
  readonly notice?: string | undefined;
  /** Its folder. */
  readonly dir: string;
}

/** A license or NOTICE file in a folder of a package that isn't its root. */
export interface Nested {
  /** Its path from the package's root. */
  readonly path: string;
  readonly text: string;
}

/** A package that is in a bundle. */
export interface Bundled extends Package {
  /** The files of it that the bundle has, from its root, in order. */
  readonly files: readonly string[];
  /**
   * The license and NOTICE files in the folders those files are in, below the package's root: a
   * package may hold code of someone else's, with its license, in a folder of its own.
   */
  readonly nested: readonly Nested[];
  /** The package whose own files hold this one's code, as `name@version`, when that's how it's in. */
  readonly in?: string | undefined;
  /** Copyright lines in its files' comments that its license file doesn't hold. */
  readonly says?: readonly string[] | undefined;
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

/** The names of a package's license files: the words a file's name begins with. */
const LICENSE_FILE = /^(?:licen[cs]e|copying)/i;

/** A file's text, read as UTF-8 and trimmed. */
function read(path: string): string {
  return readFileSync(path, 'utf8').trim();
}

/** The words of a license's id a file's name may be spelled with: `apache-2.0`, then `apache`. */
function spellings(id: string): string[] {
  const lower = id.toLowerCase();
  return [lower, lower.split('-')[0] ?? lower];
}

/**
 * The text of `dir`'s license file, the file for the license the package is taken under: `MIT`'s
 * in a package `MIT OR Apache-2.0` that has a file for each, found by the file's name, or else by
 * what it says. All of them for a package under `MIT AND BSD-3-Clause`. The only file when there's
 * one, and the first by name when none is found to be the one. Absent when there's none.
 */
function licenseText(dir: string, license: string | undefined): string | undefined {
  const names = readdirSync(dir)
    .filter((name) => LICENSE_FILE.test(name))
    .toSorted();
  const [only] = names;
  if (only === undefined) return undefined;
  if (names.length === 1) return read(join(dir, only));
  const texts = new Map(names.map((name) => [name, read(join(dir, name))]));
  const chosen = new Set<string>();
  for (const id of license === undefined ? [] : accepted(license).ids) {
    const named = names.find((name) =>
      spellings(id).some((word) => name.toLowerCase().includes(word)),
    );
    const said = names.find((name) => SIGNATURE[id]?.test(texts.get(name) ?? '') ?? false);
    const found = named ?? said;
    if (found !== undefined) chosen.add(found);
  }
  const files = chosen.size === 0 ? [only] : names.filter((name) => chosen.has(name));
  return files.map((name) => texts.get(name)).join('\n\n');
}

/** The text of `dir`'s NOTICE file. Absent when there's none. */
function noticeText(dir: string): string | undefined {
  const name = readdirSync(dir)
    .filter((each) => /^notice/i.test(each))
    .toSorted()[0];
  return name === undefined ? undefined : read(join(dir, name));
}

/** Reads each package's folder once. Makes the finder, with its own memory. */
export function packageReader(): (file: string) => Package | undefined {
  const folders = new Map<string, Found | null>();
  const packages = new Map<string, Package>();

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
      const parsed = manifest.safeParse(
        JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')),
      );
      if (parsed.success) found = { dir, manifest: parsed.data };
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
    let pack = packages.get(key);
    if (!pack) {
      const declared = typeof license === 'string' ? license.trim() : undefined;
      pack = {
        name,
        version,
        license: declared,
        text: licenseText(found.dir, declared),
        notice: noticeText(found.dir),
        dir: found.dir,
      };
      packages.set(key, pack);
    }
    return pack;
  };
}

/**
 * The license and NOTICE files in the folders of `file` below `dir`, its package's root, as far
 * down as `file`'s own: the ones whose text isn't that of the package's own files.
 */
function nestedIn(pack: Package, file: string): Nested[] {
  const found: Nested[] = [];
  const own = new Set([pack.text, pack.notice]);
  for (let folder = dirname(file); folder.length > pack.dir.length; folder = dirname(folder)) {
    for (const name of readdirSync(folder).toSorted()) {
      if (!/^(?:licen[cs]e|copying|notice)/i.test(name)) continue;
      const text = read(join(folder, name));
      if (text !== '' && !own.has(text)) {
        found.push({ path: relative(pack.dir, join(folder, name)).split(sep).join('/'), text });
      }
    }
  }
  return found;
}

/** The files of `a` and `b`, and of their nested licenses, as one package's. */
function merge(a: Bundled, b: Bundled): Bundled {
  const nested = new Map([...a.nested, ...b.nested].map((each) => [each.path, each]));
  return {
    ...a,
    files: [...new Set([...a.files, ...b.files])].toSorted(),
    nested: [...nested.values()].toSorted((x, y) => (x.path < y.path ? -1 : 1)),
  };
}

/**
 * Packages in name and version order, each once, as a list written to a file reads the same. A
 * package that's in more than one has the files of all.
 */
export function merged(packages: Iterable<Bundled>): Bundled[] {
  const each = new Map<string, Bundled>();
  for (const bundled of packages) {
    const key = `${bundled.name}@${bundled.version}`;
    const earlier = each.get(key);
    each.set(key, earlier === undefined ? bundled : merge(earlier, bundled));
  }
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
 * relative to it, where a chunk's modules have absolute ids. It's made once, and keeps what every
 * build it sees has bundled: a build the root build has nested adds to the same list.
 */
export function collector(root: () => string): Collector {
  const readPackage = packageReader();
  const found = new Map<string, Bundled>();
  return {
    add(bundle) {
      for (const output of Object.values(bundle)) {
        const files =
          output.type === 'chunk'
            ? output.moduleIds
            : output.originalFileNames.map((file) => resolve(root(), file));
        for (const file of files) {
          const pack = readPackage(file);
          if (!pack) continue;
          const path = pathOf(file);
          const key = `${pack.name}@${pack.version}`;
          const earlier = found.get(key);
          const bundled: Bundled = {
            ...pack,
            files: [relative(pack.dir, path).split(sep).join('/')],
            nested: nestedIn(pack, path),
          };
          found.set(key, earlier === undefined ? bundled : merge(earlier, bundled));
        }
      }
    },
    list: () => merged(found.values()),
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
