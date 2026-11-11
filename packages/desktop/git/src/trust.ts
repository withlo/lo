/**
 * Trusting a cached clone: nothing in one but its objects and refs is trusted until it's checked,
 * on every open, before git runs on it. Anything able to write in the cache could otherwise leave
 * a clone that runs a program or sends git elsewhere through the next fetch. A clone that fails
 * the check is moved aside and made again; nothing ran on it, so making it again is safe.
 */

import { lstat, readdir, readFile, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

import type { Runner } from './git.ts';

/**
 * Files that make git read settings, objects or attributes from somewhere else, or change what it
 * reads: another repository's folder, other object stores, replacement parents, and attributes,
 * whose `eol` settings change the bytes a checkout writes (`--attr-source` doesn't cover a
 * clone's own). Lo writes none of them.
 */
const FOREIGN_FILES = [
  'commondir',
  'gitdir',
  'config.worktree',
  join('info', 'grafts'),
  join('info', 'attributes'),
  join('objects', 'info', 'alternates'),
  join('objects', 'info', 'http-alternates'),
];

/**
 * The settings a clone of Lo's holds: what `git init` writes, the remote's address, and what makes
 * the remote a promisor. A clone with any other, or an `include`, is refused, since a setting can
 * run a program or send git elsewhere.
 */
const OWN_SETTINGS = new Set([
  'core.repositoryformatversion',
  'core.filemode',
  'core.bare',
  'core.ignorecase',
  'core.precomposeunicode',
  'core.symlinks',
  'core.logallrefupdates',
  'extensions.objectformat',
  'extensions.refstorage',
  'extensions.partialclone',
  'remote.origin.url',
  'remote.origin.promisor',
  'remote.origin.partialclonefilter',
]);

/**
 * Why the clone at `clone` can't be trusted, or `undefined` when it can. `options.checkouts` is
 * the folder its checkouts are in: a checkout's `gitdir` must point inside it, and without it, it
 * may have none. A clone of code must hold its whole history; only one that holds overviews,
 * `options.shallow` says so, may hold commits without their parents.
 */
export async function distrust(
  runner: Runner,
  clone: string,
  options: { checkouts?: string | undefined; shallow?: boolean | undefined } = {},
): Promise<string | undefined> {
  const folder = await lstat(clone).catch(() => undefined);
  if (!folder?.isDirectory()) return 'it isn’t a folder';
  // Nothing in it may lead elsewhere: a linked `objects/pack` or `refs/lo` would make git write
  // outside the cache.
  const entries = await readdir(clone, { recursive: true, withFileTypes: true }).catch(
    () => undefined,
  );
  if (entries === undefined) return 'it can’t be read';
  const link = entries.find((entry) => entry.isSymbolicLink());
  if (link !== undefined) {
    return `${relative(clone, join(link.parentPath, link.name))} is a link to somewhere else`;
  }
  // Commits without their parents would cut every pull request's history short.
  if (!options.shallow && (await lstat(join(clone, 'shallow')).catch(() => undefined))) {
    return 'it holds commits without their history (shallow)';
  }
  for (const file of FOREIGN_FILES) {
    if (await lstat(join(clone, file)).catch(() => undefined)) {
      return `it holds ${file}, which Lo never writes`;
    }
  }
  // Read as a plain file, so the clone's own includes aren't followed.
  const listing = await runner
    .command('none')
    .arg('config', '--list', '--name-only', '--file')
    .path(join(clone, 'config'))
    .finish();
  if (listing.code !== 0) return 'its settings can’t be read';
  const names = listing.stdout
    .toString('utf8')
    .split('\n')
    .filter((name) => name !== '')
    .map((name) => name.toLowerCase());
  const settings = names.filter((name) => !OWN_SETTINGS.has(name));
  if (settings.length > 0) return `it has settings Lo didn't write (${settings.join(', ')})`;
  // git reads some settings' first value and others' last, so one that holds two is refused.
  const twice = names.filter((name, index) => names.indexOf(name) !== index);
  if (twice.length > 0) return `it has settings with more than one value (${twice.join(', ')})`;
  const worktrees = await distrustWorktrees(clone, options.checkouts);
  if (worktrees !== undefined) return worktrees;
  // Last, since it runs git on the clone.
  return leadsElsewhere(runner, clone);
}

/**
 * Why git takes the clone at `clone` for some other repository, or `undefined` when it takes the
 * clone itself as its git folder and its common folder.
 */
export async function leadsElsewhere(runner: Runner, clone: string): Promise<string | undefined> {
  const folders = await runner
    .command({ gitDir: clone })
    .arg('rev-parse', '--path-format=absolute', '--git-dir', '--git-common-dir')
    .finish();
  if (folders.code !== 0) return 'git can’t read it';
  const own = await realpath(clone);
  for (const line of folders.stdout.toString('utf8').split('\n')) {
    if (line === '') continue;
    if ((await realpath(line).catch(() => undefined)) !== own) return `it leads git to ${line}`;
  }
  return undefined;
}

/**
 * Why a checkout's folder under the clone's `worktrees/` can't be trusted: one that points
 * anywhere but back at the clone and into `checkouts`, or holds settings of its own.
 */
async function distrustWorktrees(
  clone: string,
  checkouts: string | undefined,
): Promise<string | undefined> {
  const folder = join(clone, 'worktrees');
  const names = await readdir(folder).catch(() => []);
  for (const name of names) {
    const worktree = join(folder, name);
    const entry = await lstat(worktree);
    if (!entry.isDirectory()) return `worktrees/${name} isn’t a folder`;
    for (const file of await readdir(worktree)) {
      const found = await lstat(join(worktree, file));
      if (found.isSymbolicLink()) return `worktrees/${name}/${file} is a link to somewhere else`;
      if (file === 'config.worktree') return `worktrees/${name} has settings of its own`;
    }
    const commondir = await readFile(join(worktree, 'commondir'), 'utf8').catch(() => undefined);
    const common = commondir === undefined ? undefined : resolve(worktree, commondir.trim());
    if (common === undefined || resolve(common) !== resolve(clone)) {
      return `worktrees/${name} leads git to another repository`;
    }
    const gitdir = await readFile(join(worktree, 'gitdir'), 'utf8').catch(() => undefined);
    const target = gitdir?.trim();
    const inside =
      checkouts !== undefined &&
      target !== undefined &&
      isAbsolute(target) &&
      within(checkouts, target);
    if (!inside) return `worktrees/${name} names a checkout outside Lo's`;
  }
  return undefined;
}

/** Whether `path` is inside `folder`. */
function within(folder: string, path: string): boolean {
  const inside = relative(resolve(folder), resolve(path));
  return inside !== '' && !inside.startsWith(`..${sep}`) && inside !== '..' && !isAbsolute(inside);
}
