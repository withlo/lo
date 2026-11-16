/**
 * What a server is given that depends on where it runs: its checkout and its home, each as the
 * system resolves it, once its home is made and just before it starts. Most servers need none of
 * this. A JVM does: it takes the folders it writes in as system properties, not from `HOME` or
 * `TMPDIR`, so its arguments name its home. And a server whose project Lo works out from the
 * checkout, as Java's is, is told what Lo found there. SourceKit-LSP writes its generated files and
 * its module cache where its options and arguments say, so both name folders in its home, and
 * Apple's Foundation takes the home folder from `CFFIXED_USER_HOME` rather than `HOME`.
 */

import { constants } from 'node:fs';
import { mkdir, realpath, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { isInside } from './environment.ts';
import { isPlainPath } from './manifest.ts';

/** Where a server runs, each folder as the system resolves it. */
export interface Where {
  /** The checkout it runs on. */
  readonly root: string;
  /** Its own folder, its `HOME`, made already. */
  readonly home: string;
}

/** What a server is given that depends on where it runs. */
export interface Placed {
  /** Arguments before its own, such as a JVM's system properties that name folders in its home. */
  readonly args?: readonly string[] | undefined;
  /** More variables of its own, such as one that names a folder in its home. */
  readonly variables?: Readonly<Record<string, string>> | undefined;
  /** Files Lo writes in its home before it starts, by their paths there, with their text. */
  readonly files?: Readonly<Record<string, string>> | undefined;
  /** What it gets for `workspace/configuration`, in place of what its spec says. */
  readonly settings?: unknown;
  /** Its `initializationOptions`, in place of what its spec says. */
  readonly initializationOptions?: unknown;
}

/** Works out what a server is given where it runs. */
export type Place = (where: Where) => Promise<Placed>;

/**
 * Writes `files` in `home`, each by its path there, replacing what was there. A path that isn't a
 * plain relative one, or whose folder resolves outside `home`, is refused, and so is writing
 * through a link: the server may have left one there itself.
 */
export async function writeInHome(
  home: string,
  files: Readonly<Record<string, string>>,
): Promise<void> {
  for (const [path, text] of Object.entries(files)) {
    if (!isPlainPath(path)) throw new Error(`a server’s file must be a path in its home: ${path}`);
    const file = join(home, ...path.split('/'));
    await mkdir(dirname(file), { recursive: true, mode: 0o700 });
    if (!isInside(home, await realpath(dirname(file)))) {
      throw new Error(`a server’s file must stay in its home: ${path}`);
    }
    await writeFile(file, text, {
      flag: constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW,
      mode: 0o600,
    });
  }
}
