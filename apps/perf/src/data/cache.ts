// The local copy of each PR's files. Every upstream repo gets one bare, shallow, blobless clone
// under the cache folder, shared by every checkout of Lo on the machine. It holds the commits the
// manifests name, their trees, and the blobs of the files the PRs change, nothing more. Git checks
// every object it downloads against its ID, so a manifest's two commit IDs pin all of its text.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { devNull, homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import type { Manifest } from './manifest.ts';

/** Where the clones live: `LO_PERF_CACHE`, else `lo/perf` in the user's cache folder. */
export function cacheFolder(env: NodeJS.ProcessEnv = process.env): string {
  if (env.LO_PERF_CACHE) return env.LO_PERF_CACHE;
  return join(env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'lo', 'perf');
}

/** The clone of `owner/name`: a folder two levels inside the cache, or an error. */
export function repoFolder(cache: string, repo: string): string {
  const folder = resolve(cache, `${repo}.git`);
  const inside = relative(resolve(cache), folder);
  const parts = inside.split(sep);
  if (isAbsolute(inside) || parts.length !== 2 || parts.some((part) => part === '..')) {
    throw new Error(`${repo} isn't a repo's owner/name.`);
  }
  return folder;
}

/** The oldest git that can turn off lazy fetching, with `GIT_NO_LAZY_FETCH`. */
const oldestGit = [2, 45] as const;

/** Fails unless `version`, as `git --version` prints it, is at least `oldestGit`. */
export function checkGitVersion(version: string): void {
  const [, major = '0', minor = '0'] = /(\d+)\.(\d+)/.exec(version) ?? [];
  const [oldestMajor, oldestMinor] = oldestGit;
  if (
    Number(major) < oldestMajor ||
    (Number(major) === oldestMajor && Number(minor) < oldestMinor)
  ) {
    throw new Error(
      `Fetching needs git ${oldestMajor}.${oldestMinor} or later, which can turn off lazy ` +
        `fetching, but this is ${version.trim() || 'an unknown git'}.`,
    );
  }
}

let gitChecked: Promise<void> | undefined;

/**
 * The settings a clone of ours holds: what `git init` writes, the remote's address, and what a
 * filtered fetch writes to make the remote a promisor. A clone with any other is refused, since
 * its settings could run commands or send git elsewhere.
 */
const ownSettings = new Set([
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

/** Fails unless the clone at `folder` holds only settings this code writes, and no alternates. */
async function checkClone(folder: string): Promise<void> {
  // Read as a plain file, so the clone's own includes aren't followed.
  const names = (await run(['config', '--file', join(folder, 'config'), '--list', '--name-only']))
    .toString('utf8')
    .split('\n')
    .filter((name) => name !== '' && !ownSettings.has(name.toLowerCase()));
  if (names.length > 0) {
    throw new Error(
      `${folder} has settings this code didn't write (${names.join(', ')}). Delete the folder ` +
        `and fetch again.`,
    );
  }
  if (existsSync(join(folder, 'objects', 'info', 'alternates'))) {
    throw new Error(`${folder} borrows objects from elsewhere. Delete the folder and fetch again.`);
  }
}

/** A changed file's two versions as blob IDs. A side the file isn't on has none. */
export interface FileBlobs {
  path: string;
  base?: string | undefined;
  head?: string | undefined;
}

export interface FetchResult {
  /** The manifest's files, in its order. */
  files: FileBlobs[];
  /** How many distinct blobs the files need, and their size in bytes. */
  blobs: number;
  bytes: number;
  /** How many of them this run downloaded: none when the cache already had them. */
  downloaded: number;
}

/**
 * Makes sure the cache holds `manifest`'s two commits and both versions of every file it changes,
 * and returns each file's blob IDs. Downloads only what's missing: the commits with their trees,
 * then every missing blob in one request. Needs no token, since the repos are public.
 */
export async function fetchPullRequest(
  manifest: Manifest,
  options: { cache?: string; remote?: string } = {},
): Promise<FetchResult> {
  const folder = repoFolder(options.cache ?? cacheFolder(), manifest.repo);
  const remote = options.remote ?? `https://github.com/${manifest.repo}.git`;
  // Tests fetch from a local repo; everything else, over HTTPS.
  const protocol = URL.parse(remote)?.protocol.slice(0, -1);
  if (protocol !== 'https' && protocol !== 'file') {
    throw new Error(`${remote} isn't an https: or file: address.`);
  }
  gitChecked ??= run(['--version']).then((version) => checkGitVersion(version.toString('utf8')));
  await gitChecked;
  const git = gitIn(folder, protocol);
  if (existsSync(folder)) {
    await checkClone(folder);
  } else {
    mkdirSync(dirname(folder), { recursive: true });
    // No template, so the clone starts with no hooks or other files of the system's.
    await run(['init', '--bare', '--quiet', '--template=', folder], undefined, protocol);
  }
  await git(['config', 'remote.origin.url', remote]);

  const commits = [manifest.base, manifest.head];
  if ((await sizesOf(git, commits)).includes(undefined)) {
    // The first fetch with a filter also makes origin the clone's promisor remote.
    await git([
      'fetch',
      '--quiet',
      '--no-tags',
      '--no-write-fetch-head',
      '--depth=1',
      '--filter=blob:none',
      'origin',
      ...commits,
    ]);
  }
  // The refs keep the commits, and with them their trees and blobs, reachable.
  await git(['update-ref', `refs/perf/${manifest.number}/base`, manifest.base]);
  await git(['update-ref', `refs/perf/${manifest.number}/head`, manifest.head]);

  const files = await resolveFiles(git, manifest);
  const blobs = [...new Set(files.flatMap(({ base, head }) => [base, head]))].filter(
    (blob) => blob !== undefined,
  );
  const before = await sizesOf(git, blobs);
  const missing = blobs.filter((_, index) => before[index] === undefined);
  if (missing.length > 0) {
    // Every missing blob in one request, as git asks its promisor remote for a batch. Reading
    // them one by one would download each in its own round trip.
    await git(
      [
        '-c',
        'fetch.negotiationAlgorithm=noop',
        'fetch',
        '--quiet',
        '--no-tags',
        '--no-write-fetch-head',
        '--recurse-submodules=no',
        '--filter=blob:none',
        '--stdin',
        'origin',
      ],
      `${missing.join('\n')}\n`,
    );
  }
  const sizes = await sizesOf(git, blobs);
  const absent = sizes.filter((size) => size === undefined).length;
  if (absent > 0) throw new Error(`${manifest.repo} didn't send ${absent} of the blobs asked for.`);
  return {
    files,
    blobs: blobs.length,
    bytes: sizes.reduce<number>((total, size) => total + (size ?? 0), 0),
    downloaded: missing.length,
  };
}

/**
 * Finds each file's blobs in the two commits' trees: the old path in the merge base, the new path
 * in the head. Fails when a file isn't where the manifest says, since then the manifest doesn't
 * describe these commits.
 */
async function resolveFiles(git: Git, manifest: Manifest): Promise<FileBlobs[]> {
  const [base, head] = await Promise.all([treeOf(git, manifest.base), treeOf(git, manifest.head)]);
  const blobAt = (tree: Map<string, Entry>, path: string, commit: string): string | undefined => {
    const entry = tree.get(path);
    if (!entry) throw new Error(`${manifest.repo}@${commit.slice(0, 12)} has no ${path}.`);
    // A submodule's entry is a commit in another repo, with no text here.
    return entry.type === 'blob' ? entry.id : undefined;
  };
  return manifest.files.map((file) => ({
    path: file.path,
    base:
      file.status === 'added'
        ? undefined
        : blobAt(base, file.previousPath ?? file.path, manifest.base),
    head: file.status === 'removed' ? undefined : blobAt(head, file.path, manifest.head),
  }));
}

interface Entry {
  type: string;
  id: string;
}

/** Every file in a commit, by path. Reads only trees, which the clone has in full. */
async function treeOf(git: Git, commit: string): Promise<Map<string, Entry>> {
  const output = (await git(['ls-tree', '-r', '-z', '--full-tree', commit])).toString('utf8');
  const tree = new Map<string, Entry>();
  for (const record of output.split('\0')) {
    if (record === '') continue;
    // `<mode> <type> <id>\t<path>`
    const tab = record.indexOf('\t');
    const [, type = '', id = ''] = record.slice(0, tab).split(' ');
    tree.set(record.slice(tab + 1), { type, id });
  }
  return tree;
}

/** Each object's size in bytes, or `undefined` for one the clone doesn't have. */
async function sizesOf(git: Git, ids: readonly string[]): Promise<(number | undefined)[]> {
  if (ids.length === 0) return [];
  const output = await git(
    ['cat-file', '--batch-check=%(objectname) %(objectsize)'],
    `${ids.join('\n')}\n`,
  );
  const lines = output.toString('utf8').trimEnd().split('\n');
  return ids.map((_, index) => {
    const [, size] = (lines[index] ?? '').split(' ');
    return size === undefined || size === 'missing' ? undefined : Number(size);
  });
}

type Git = (args: readonly string[], input?: string) => Promise<Buffer>;

function gitIn(folder: string, protocol: string): Git {
  return (args, input) => run([`--git-dir=${folder}`, ...args], input, protocol);
}

/**
 * Runs git without the user's or the system's settings, so no credential helper or URL rewrite of
 * theirs takes part. Hooks and replace refs are off, so a clone can't run commands or swap one
 * object for another, and git reaches remotes only over `protocol`. Lazy fetching is off too, so a
 * missing object fails instead of being downloaded on its own. The clone's own settings are
 * checked before any of this runs on it.
 */
function run(args: readonly string[], input?: string, protocol = 'https'): Promise<Buffer> {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_')),
  );
  Object.assign(env, {
    GIT_CONFIG_GLOBAL: devNull,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_TERMINAL_PROMPT: '0',
    GIT_NO_LAZY_FETCH: '1',
    GIT_NO_REPLACE_OBJECTS: '1',
    GIT_ALLOW_PROTOCOL: protocol,
  });
  return new Promise((done, reject) => {
    const child = spawn('git', ['-c', `core.hooksPath=${devNull}`, ...args], {
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) done(Buffer.concat(stdout));
      else {
        const message = Buffer.concat(stderr).toString('utf8').trim();
        reject(new Error(`git ${args.join(' ')} failed (${code}): ${message}`));
      }
    });
    child.stdin.end(input);
  });
}
