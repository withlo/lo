/**
 * Installed copies of a server: one the user installed, which an adapter may use where Lo has no
 * download, or prefers the user's (SourceKit-LSP comes only with Xcode or Apple's Command Line
 * Tools). An adapter names where a copy may be, such as `~/go/bin/gopls` or SourceKit-LSP's place
 * in the developer folder `xcode-select -p` names, and a copy there is used only if:
 *
 * - it's an absolute path to a file this user may run;
 * - nobody but this user and root can change it, or a folder it's in, as the app's folder check
 *   says (the one Lo holds git to);
 * - it isn't in Lo's cache, where checkouts and downloads are, as given or once links are
 *   followed;
 * - it isn't a version manager's shim (mise's, asdf's, rbenv's, rustup's, swiftly's, aqua's, rye's
 *   and the like), which picks the program to run from files in the folder it runs in: the
 *   checkout, such as its `.swift-version`, `aqua.yaml` or `.python-version`.
 */

import { realpath, stat } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join } from 'node:path';

import { isInside } from './environment.ts';

/** The folders version managers keep their shims in, inside the user's home. */
const SHIM_FOLDERS = [
  '.local/share/mise/shims',
  '.asdf/shims',
  '.rbenv/shims',
  '.pyenv/shims',
  '.nodenv/shims',
  '.jenv/shims',
  '.goenv/shims',
  '.plenv/shims',
  '.volta/bin',
  '.proto/shims',
  '.proto/bin',
  // swiftly's, on macOS and on Linux: links to swiftly, which reads `.swift-version`.
  '.swiftly/bin',
  '.local/share/swiftly/bin',
  // aqua's, on both: links to aqua-proxy, which reads `aqua.yaml`.
  '.local/share/aquaproj-aqua/bin',
  // rye's, on both: links to rye, which reads `.python-version` and `pyproject.toml`.
  '.rye/shims',
];

/** The programs a version manager's shims are, or link to. */
const MANAGERS = new Set([
  'mise',
  'rtx',
  'asdf',
  'rbenv',
  'pyenv',
  'nodenv',
  'jenv',
  'goenv',
  'plenv',
  'volta-shim',
  'proto',
  'proto-shim',
  'rustup',
  'rustup-init',
  'swiftly',
  'aqua',
  'aqua-proxy',
  'rye',
]);

export interface CopyOptions {
  /**
   * Why someone besides this user and root could change the program at a path, or `undefined`
   * when nobody else can: the app's folder check, `@lo/git`'s `whyDistrusted`.
   */
  readonly distrust: (program: string) => Promise<string | undefined>;
  /** Folders a copy must not be in: Lo's cache, which holds checkouts and downloads. */
  readonly outside: readonly string[];
  /** The user's home folder, where version managers keep their shims. */
  readonly home: string;
}

/** What was found: the first copy that may run, by its real path, and why each before it may not. */
export interface Found {
  readonly program?: string | undefined;
  readonly skipped: readonly { readonly path: string; readonly why: string }[];
}

/** The first of `candidates` that may run as a server, and why each before it may not. */
export async function findCopy(
  candidates: readonly string[],
  options: CopyOptions,
): Promise<Found> {
  const skipped: { path: string; why: string }[] = [];
  const outside = [...options.outside];
  for (const folder of options.outside) {
    const real = await realpath(folder).catch(() => undefined);
    if (real !== undefined) outside.push(real);
  }
  const shims = SHIM_FOLDERS.map((folder) => join(options.home, ...folder.split('/')));
  const realShims = await Promise.all(shims.map((shim) => realpath(shim).catch(() => undefined)));
  for (const real of realShims) if (real !== undefined) shims.push(real);
  for (const path of candidates) {
    const why = await whyNot(path, options, outside, shims);
    if (typeof why === 'string') skipped.push({ path, why });
    else return { program: why.real, skipped };
  }
  return { skipped };
}

/** Why the copy at `path` may not run, or its real path when it may. */
async function whyNot(
  path: string,
  options: CopyOptions,
  outside: readonly string[],
  shims: readonly string[],
): Promise<string | { real: string }> {
  if (!isAbsolute(path)) return 'it isn’t an absolute path';
  const real = await realpath(path).catch(() => undefined);
  if (real === undefined) return 'it isn’t there';
  const info = await stat(real);
  if (!info.isFile() || (info.mode & 0o111) === 0) return 'it isn’t a program';
  const paths = [path, real];
  if (paths.some((one) => outside.some((folder) => isInside(folder, one)))) {
    return 'it’s inside Lo’s cache';
  }
  if (paths.some((one) => shims.some((folder) => isInside(folder, one)))) {
    return 'it’s a version manager’s shim, which picks a program from the checkout';
  }
  if (MANAGERS.has(basename(real)) || (await isManager(paths, info))) {
    return 'it’s a version manager’s shim, which picks a program from the checkout';
  }
  const distrusted = await options.distrust(path);
  if (distrusted !== undefined) return distrusted;
  return { real };
}

/** Whether the file `info` describes is a version manager beside one of `paths`, by another name. */
async function isManager(
  paths: readonly string[],
  info: { readonly dev: number; readonly ino: number },
): Promise<boolean> {
  for (const folder of new Set(paths.map((path) => dirname(path)))) {
    for (const manager of MANAGERS) {
      const beside = await stat(join(folder, manager)).catch(() => undefined);
      if (beside !== undefined && beside.dev === info.dev && beside.ino === info.ino) return true;
    }
  }
  return false;
}
