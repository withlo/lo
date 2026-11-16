/**
 * Trusting a cached clone: nothing in one but its objects and refs is trusted until it's checked,
 * on every open, before git runs on it. Anything able to write in the cache could otherwise leave
 * a clone that runs a program or sends git elsewhere through the next fetch. A clone that fails
 * the check is moved aside and made again; nothing ran on it, so making it again is safe.
 */

import { lstat, readdir, readFile, readlink, realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path';

import type { Runner } from './git.ts';

/** Where a clone's checkouts belong: `folder`, in the cache whose folder is `root`. */
export interface CheckoutsPlace {
  readonly root: string;
  readonly folder: string;
}

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

/** Whether a setting's value, in a clone of a repository on Lo's remote at `base`, is Lo's. */
type Check = (value: string, base: string) => boolean;

/** A check that a value is one of `values`. */
function oneOf(...values: string[]): Check {
  return (value) => values.includes(value);
}

/** What git writes as `true` or `false`, by what the file system can do. */
const BOOLEAN = oneOf('true', 'false');

/** Whether `value` is the address of a repository on Lo's remote, as `<base>/<owner>/<repo>.git`. */
function isAddress(value: string, base: string): boolean {
  return (
    value.startsWith(`${base}/`) &&
    /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+\.git$/.test(value.slice(base.length + 1))
  );
}

/**
 * The settings a clone of Lo's holds, each with the values it may have: what `git init` writes,
 * the remote's address, and what makes the remote a promisor. A clone with any other setting or
 * value, or an `include`, is refused, since a setting can run a program or send git elsewhere.
 */
const OWN_SETTINGS: ReadonlyMap<string, Check> = new Map<string, Check>([
  ['core.repositoryformatversion', oneOf('1')],
  ['core.filemode', BOOLEAN],
  ['core.bare', oneOf('true')],
  ['core.ignorecase', BOOLEAN],
  ['core.precomposeunicode', BOOLEAN],
  ['core.symlinks', BOOLEAN],
  ['core.logallrefupdates', BOOLEAN],
  ['extensions.objectformat', oneOf('sha1')],
  ['extensions.refstorage', oneOf('files', 'reftable')],
  ['extensions.partialclone', oneOf('origin')],
  ['remote.origin.url', isAddress],
  ['remote.origin.promisor', oneOf('true')],
  ['remote.origin.partialclonefilter', oneOf('blob:none')],
]);

/**
 * Why the clone at `clone` can't be trusted, or `undefined` when it can. `options.checkouts` is
 * where its checkouts belong: a checkout's `gitdir` must lead inside that folder, as written and
 * really ({@link leadsInto}), and without it, the clone may have none. A clone must hold its whole
 * history.
 */
export async function distrust(
  runner: Runner,
  clone: string,
  options: { checkouts?: CheckoutsPlace | undefined } = {},
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
  if (await lstat(join(clone, 'shallow')).catch(() => undefined)) {
    return 'it holds commits without their history (shallow)';
  }
  for (const file of FOREIGN_FILES) {
    if (await lstat(join(clone, file)).catch(() => undefined)) {
      return `it holds ${file}, which Lo never writes`;
    }
  }
  // Read as a plain file, so the clone's own includes aren't followed. git gives each name with
  // its section and key in lowercase and its subsection, such as a remote's name, as written:
  // `[remote "Origin"]` is another remote than `[remote "origin"]`, so names are compared as given.
  const listing = await runner
    .command('none')
    .arg('config', '--list', '--null', '--file')
    .path(join(clone, 'config'))
    .finish();
  if (listing.code !== 0) return 'its settings can’t be read';
  const settings = listing.stdout
    .toString('utf8')
    .split('\0')
    .filter((entry) => entry !== '')
    .map((entry) => {
      // A name, then its value after a line break; a name alone is set without one.
      const end = entry.indexOf('\n');
      return end === -1
        ? { name: entry, value: undefined }
        : { name: entry.slice(0, end), value: entry.slice(end + 1) };
    });
  const names = settings.map((setting) => setting.name);
  const others = names.filter((name) => !OWN_SETTINGS.has(name));
  if (others.length > 0) return `it has settings Lo didn't write (${others.join(', ')})`;
  // git reads some settings' first value and others' last, so one that holds two is refused.
  const twice = names.filter((name, index) => names.indexOf(name) !== index);
  if (twice.length > 0) return `it has settings with more than one value (${twice.join(', ')})`;
  // Each must hold what Lo set: a promisor remote by another name, or that may download whole
  // trees, would make git download from elsewhere, or more than it should.
  const changed = settings
    .filter(({ name, value }) => {
      const check = OWN_SETTINGS.get(name);
      return value === undefined || check === undefined || !check(value, runner.remote.base);
    })
    .map((setting) => setting.name);
  if (changed.length > 0) return `it has settings Lo set otherwise (${changed.join(', ')})`;
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
  checkouts: CheckoutsPlace | undefined,
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
    // git writes `../..`, so it's read as written, never through a link.
    const commondir = await readFile(join(worktree, 'commondir'), 'utf8').catch(() => undefined);
    const common = commondir === undefined ? undefined : resolve(worktree, commondir.trim());
    if (common === undefined || resolve(common) !== resolve(clone)) {
      return `worktrees/${name} leads git to another repository`;
    }
    const gitdir = await readFile(join(worktree, 'gitdir'), 'utf8').catch(() => undefined);
    const target = gitdir?.trim();
    const inside =
      checkouts !== undefined && target !== undefined && (await leadsInto(checkouts, target));
    if (!inside) return `worktrees/${name} names a checkout outside Lo's`;
  }
  return undefined;
}

/**
 * Whether `path`, a checkout's `.git` as git names it in the clone, is inside `place.folder`, both
 * as written and really. git names a checkout with the links on the way to it followed, so a link
 * above the cache, as macOS's `/var` is, gives it another name than Lo's for the same folder.
 *
 * - Nothing on the way from the cache's folder to `place.folder` is a link: what's past one isn't
 *   in the cache, wherever it leads.
 * - As written, `path` is inside the folder as Lo names it or as git does ({@link asGitNames}), so
 *   one named outside the cache is refused, even where a link there leads back in.
 * - Really, `path` is inside the folder, both by their real paths, so neither the case each is
 *   spelled in, which a Mac's disk ignores, nor a link inside the folder can mislead. A path that
 *   can't be resolved, such as one past a dangling link, is refused ({@link realAhead}).
 *
 * `path` must be absolute and plain, with no `.` or `..` in it, as git writes a checkout's.
 */
async function leadsInto(place: CheckoutsPlace, path: string): Promise<boolean> {
  const below = relative(place.root, place.folder);
  if (!isAbsolute(path) || normalize(path) !== path || !isBelow(below)) return false;
  if (!(await plainFolders(place.root, below))) return false;
  const named = await asGitNames(place.root);
  const spellings = [place.folder, ...(named === undefined ? [] : [join(named, below)])];
  if (!spellings.some((folder) => isBelow(relative(folder, path)))) return false;
  const [folder, real] = await Promise.all([realAhead(place.folder), realAhead(path)]);
  return folder !== undefined && real !== undefined && isBelow(relative(folder, real));
}

/** Whether `between`, the path from one folder to another place, leads inside the folder. */
function isBelow(between: string): boolean {
  return (
    between !== '' && between !== '..' && !between.startsWith(`..${sep}`) && !isAbsolute(between)
  );
}

/**
 * Whether each folder on the way from `root` down `below` is a folder, never a link, as far as
 * they're there.
 */
async function plainFolders(root: string, below: string): Promise<boolean> {
  let at = root;
  for (const name of below.split(sep)) {
    at = join(at, name);
    try {
      if (!(await lstat(at)).isDirectory()) return false;
    } catch (error) {
      return codeOf(error) === 'ENOENT';
    }
  }
  return true;
}

/**
 * `path`, absolute, as git names it once it follows the links on it: each link replaced by what it
 * says, and every other name kept as given, whatever case the disk keeps it in. `undefined` for a
 * link that can't be read, or past 32 links, where git gives up.
 */
async function asGitNames(path: string): Promise<string | undefined> {
  let named: string = sep;
  const left = path.split(sep).toReversed();
  let links = 0;
  while (left.length > 0) {
    const name = left.pop() ?? '';
    if (name === '' || name === '.') continue;
    if (name === '..') {
      named = dirname(named);
      continue;
    }
    const next = join(named, name);
    if (!(await lstat(next).catch(() => undefined))?.isSymbolicLink()) {
      named = next;
      continue;
    }
    links += 1;
    const target = links > 32 ? undefined : await readlink(next).catch(() => undefined);
    if (target === undefined) return undefined;
    if (isAbsolute(target)) named = sep;
    left.push(...target.split(sep).toReversed());
  }
  return named;
}

/**
 * The real path of `path`, which needn't be there: its nearest folder that is, by its real path,
 * then the rest of `path`, where nothing is, so none of it is a link. `undefined` when something on
 * the way can't be resolved: a dangling link, a loop of links, or a folder that can't be read.
 */
async function realAhead(path: string): Promise<string | undefined> {
  const rest: string[] = [];
  for (let at = path; ; at = dirname(at)) {
    try {
      return join(await realpath(at), ...rest.toReversed());
    } catch (error) {
      // Only a name with nothing at all there is kept as it is: anything else may lead anywhere.
      if (codeOf(error) !== 'ENOENT' || dirname(at) === at) return undefined;
      const there = await lstat(at).then(
        () => true,
        (missing: unknown) => codeOf(missing) !== 'ENOENT',
      );
      if (there) return undefined;
      rest.push(basename(at));
    }
  }
}

/** An error's code, such as `ENOENT`, if it has one. */
function codeOf(error: unknown): unknown {
  return error instanceof Error && 'code' in error ? error.code : undefined;
}
