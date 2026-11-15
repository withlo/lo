/**
 * Between a tree's paths and the `file:` URIs a server names files by. A server only ever hears of
 * files in its checkout, and a location it answers with maps back to a path only when it's inside
 * the checkout: anything else, such as a toolchain's sources, has no path, so Lo never reads it.
 */

import { join, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { isInside } from './environment.ts';

/**
 * Checks that `path` is a path in a tree, as git names a file: relative, with no empty, `.` or `..`
 * part, and no NUL.
 */
export function checkTreePath(path: string): void {
  const parts = path.split('/');
  if (path.includes('\0') || parts.some((part) => part === '' || part === '.' || part === '..')) {
    throw new Error(`not a path in a tree: ${JSON.stringify(path)}`);
  }
}

/** The `file:` URI of the tree's `path` in the checkout at `root`. */
export function fileUri(root: string, path: string): string {
  checkTreePath(path);
  return pathToFileURL(join(root, path)).href;
}

/** The `file:` URI of the checkout at `root` itself. */
export function folderUri(root: string): string {
  return pathToFileURL(root).href;
}

/**
 * The tree's path for the file `uri` names, when it's a file inside one of `roots`: the checkout's
 * folder as given and as the system resolves it, since a server may name it either way.
 */
export function treePath(roots: readonly string[], uri: string): string | undefined {
  const url = URL.parse(uri);
  if (url?.protocol !== 'file:' || (url.host !== '' && url.host !== 'localhost')) return undefined;
  let file: string;
  try {
    file = fileURLToPath(url);
  } catch {
    // An escaped slash, say.
    return undefined;
  }
  for (const root of roots) {
    if (!isInside(root, file)) continue;
    const path = relative(root, file);
    if (path === '') return undefined;
    return path.split(sep).join('/');
  }
  return undefined;
}
