// Paths as a person writes them, for what Lo shows of a folder on this computer.

import { sep } from 'node:path';

/** `path` as a person writes it: the home folder, `home`, as `~`, where the path is in it. */
export function written(path: string, home: string): string {
  if (home === '') return path;
  if (path === home) return '~';
  const prefix = home.endsWith(sep) ? home : `${home}${sep}`;
  return path.startsWith(prefix) ? `~${sep}${path.slice(prefix.length)}` : path;
}
