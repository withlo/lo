// The local copy of each PR's files. Every upstream repo gets one bare, shallow, blobless clone
// under the cache folder, shared by every checkout of Lo on the machine. It holds the commits the
// manifests name, their trees, and the blobs of the files the PRs change, nothing more. Git checks
// every object it downloads against its ID, so a manifest's two commit IDs pin all of its text.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { devNull, homedir } from 'node:os';
import { dirname, join } from 'node:path';

import type { Manifest } from './manifest.ts';

/** Where the clones live: `LO_PERF_CACHE`, else `lo/perf` in the user's cache folder. */
export function cacheFolder(env: NodeJS.ProcessEnv = process.env): string {
  if (env.LO_PERF_CACHE) return env.LO_PERF_CACHE;
  return join(env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'lo', 'perf');
}

/** The clone of `owner/name`. */
export function repoFolder(cache: string, repo: string): string {
  return join(cache, `${repo}.git`);
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
  const git = gitIn(folder);
  if (!existsSync(folder)) {
    mkdirSync(dirname(folder), { recursive: true });
    await run(['init', '--bare', '--quiet', folder]);
  }
  await git([
    'config',
    'remote.origin.url',
    options.remote ?? `https://github.com/${manifest.repo}.git`,
  ]);

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

function gitIn(folder: string): Git {
  return (args, input) => run([`--git-dir=${folder}`, ...args], input);
}

/**
 * Runs git with none of the user's or the system's git settings, so no credential helper, URL
 * rewrite or hook takes part, and with lazy fetching off, so a missing object fails instead of
 * being downloaded on its own.
 */
function run(args: readonly string[], input?: string): Promise<Buffer> {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_')),
  );
  Object.assign(env, {
    GIT_CONFIG_GLOBAL: devNull,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_TERMINAL_PROMPT: '0',
    GIT_NO_LAZY_FETCH: '1',
  });
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { env, stdio: ['pipe', 'pipe', 'pipe'] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(Buffer.concat(stdout));
      else {
        const message = Buffer.concat(stderr).toString('utf8').trim();
        reject(new Error(`git ${args.join(' ')} failed (${code}): ${message}`));
      }
    });
    child.stdin.end(input);
  });
}
