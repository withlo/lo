/**
 * Real git repositories in temporary folders, served over `file://` the way GitHub serves them:
 * partial clones allowed, and any commit fetchable by ID.
 */

import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { git, gitBytes } from './git.ts';

/** A folder of bare repositories at `<root>/remotes/<owner>/<repo>.git`, standing in for github.com. */
export class RepoServer {
  readonly root: string;

  constructor(root = mkdtempSync(join(tmpdir(), 'lo-git-server-'))) {
    this.root = root;
  }

  /** Where the repositories are: `<base>/<owner>/<repo>.git`. */
  get remotes(): string {
    return join(this.root, 'remotes');
  }

  /** The address git fetches the repositories from. */
  get baseUrl(): string {
    return `file://${this.remotes}`;
  }

  /** A new, empty repository `owner/name`, with a working copy to make commits in. */
  repo(owner: string, name: string): RemoteRepo {
    const gitDir = join(this.remotes, owner, `${name}.git`);
    mkdirSync(gitDir, { recursive: true });
    git(gitDir, 'init', '-q', '--bare', '-b', 'trunk');
    // As GitHub does: clients may filter, and may fetch any object by ID.
    git(gitDir, 'config', 'uploadpack.allowFilter', 'true');
    git(gitDir, 'config', 'uploadpack.allowAnySHA1InWant', 'true');
    const work = join(this.root, 'work', owner, name);
    mkdirSync(work, { recursive: true });
    git(work, 'init', '-q', '-b', 'trunk');
    return new RemoteRepo(gitDir, work);
  }

  /** Deletes every repository. */
  remove(): void {
    rmSync(this.root, { recursive: true, force: true });
  }
}

/** A repository on a {@link RepoServer}, and a working copy where tests make its commits. */
export class RemoteRepo {
  readonly gitDir: string;
  readonly work: string;

  constructor(gitDir: string, work: string) {
    this.gitDir = gitDir;
    this.work = work;
  }

  write(path: string, contents: Uint8Array | string): this {
    const file = join(this.work, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, contents);
    return this;
  }

  remove(path: string): this {
    rmSync(join(this.work, path));
    return this;
  }

  /** Makes the file at `path` executable. */
  executable(path: string): this {
    chmodSync(join(this.work, path), 0o755);
    return this;
  }

  /** Replaces whatever is at `path` with a symlink to `target`. */
  symlink(path: string, target: string): this {
    const link = join(this.work, path);
    rmSync(link, { force: true });
    mkdirSync(dirname(link), { recursive: true });
    symlinkSync(target, link);
    return this;
  }

  /** Points the submodule at `path` at `commit`, a commit in another repository, without checking it out. */
  gitlink(path: string, commit: string): this {
    mkdirSync(join(this.work, path), { recursive: true });
    git(this.work, 'update-index', '--add', '--cacheinfo', `160000,${commit},${path}`);
    return this;
  }

  /** Commits everything in the working copy and returns the commit. */
  commit(message: string): string {
    git(this.work, 'add', '-A');
    return this.#commitStaged(message);
  }

  /**
   * Commits the working copy and `files`, whose names a disk may refuse (a name that isn't
   * UTF-8), which go straight into the index.
   */
  commitWithNames(
    files: readonly (readonly [Uint8Array, Uint8Array | string])[],
    message: string,
  ): string {
    git(this.work, 'add', '-A');
    for (const [path, contents] of files) {
      const id = gitBytes(this.work, ['hash-object', '-w', '--stdin'], contents)
        .toString('utf8')
        .trim();
      // `update-index --index-info` takes the name as bytes, after a tab, ending in a NUL.
      const entry = Buffer.concat([Buffer.from(`100644 ${id}\t`), path, Buffer.from([0])]);
      // Names as given: a Mac's git otherwise turns a decomposed name into a composed one.
      gitBytes(
        this.work,
        ['-c', 'core.precomposeUnicode=false', 'update-index', '-z', '--index-info'],
        entry,
      );
    }
    return this.#commitStaged(message);
  }

  #commitStaged(message: string): string {
    git(this.work, 'commit', '-q', '--allow-empty', '-m', message);
    return this.head();
  }

  /** Replaces the last commit with one holding everything in the working copy. */
  amend(message: string): string {
    git(this.work, 'add', '-A');
    git(this.work, 'commit', '-q', '--amend', '-m', message);
    return this.head();
  }

  head(): string {
    return git(this.work, 'rev-parse', 'HEAD');
  }

  /** Switches the working copy to `branch`, creating it at the current commit if it's new. */
  switch(branch: string): this {
    let exists = true;
    try {
      git(this.work, 'rev-parse', '--verify', '--quiet', `refs/heads/${branch}`);
    } catch {
      exists = false;
    }
    if (exists) git(this.work, 'checkout', '-q', branch);
    else git(this.work, 'checkout', '-q', '-b', branch);
    return this;
  }

  /** Starts `branch` with no history. */
  orphan(branch: string): this {
    git(this.work, 'checkout', '-q', '--orphan', branch);
    git(this.work, 'rm', '-rq', '--cached', '--ignore-unmatch', '.');
    return this;
  }

  /**
   * Points `reference` on the server at the working copy's current commit, force-pushing if it
   * was somewhere else.
   */
  publish(reference: string): this {
    git(this.gitDir, 'fetch', '-q', this.work, `+HEAD:${reference}`);
    return this;
  }

  /**
   * Copies `reference` from `other` (a fork) into this repository, as GitHub does with a pull
   * request's head from a fork.
   */
  takeFrom(other: RemoteRepo, from: string, reference: string): this {
    git(this.gitDir, 'fetch', '-q', other.gitDir, `+${from}:${reference}`);
    return this;
  }

  /** Deletes everything the server's refs don't reach, as if it had lost force-pushed commits. */
  forgetUnreachable(): void {
    git(this.gitDir, 'reflog', 'expire', '--expire=now', '--all');
    git(this.gitDir, 'gc', '-q', '--prune=now');
  }

  /** Whether the server still has `oid`. */
  has(oid: string): boolean {
    try {
      git(this.gitDir, 'cat-file', '-e', oid);
      return true;
    } catch {
      return false;
    }
  }
}

/** How many packs the clone at `gitDir` has. Every fetch and every download that brings something adds one. */
export function packs(gitDir: string): number {
  return readdirSync(join(gitDir, 'objects', 'pack')).filter((name) => name.endsWith('.promisor'))
    .length;
}

/** The objects reachable from `rev` that the clone at `gitDir` hasn't downloaded. */
export function missingObjects(gitDir: string, rev: string): string[] {
  return git(gitDir, 'rev-list', '--objects', '--missing=print', rev, '--')
    .split('\n')
    .filter((line) => line.startsWith('?'))
    .map((line) => line.slice(1));
}

/** How many objects the packs of the clone at `gitDir` hold, an object in two packs counted twice. */
export function packedObjects(gitDir: string): number {
  const line = git(gitDir, 'count-objects', '-v')
    .split('\n')
    .find((each) => each.startsWith('in-pack: '));
  if (line === undefined) throw new Error(`count-objects in ${gitDir} said nothing of packs`);
  return Number(line.slice('in-pack: '.length));
}

/** The size of every object in the repository at `dir`, by ID. */
export function objectSizes(dir: string): Map<string, number> {
  const sizes = new Map<string, number>();
  const listing = git(
    dir,
    'cat-file',
    '--batch-all-objects',
    '--batch-check=%(objectname) %(objectsize)',
  );
  for (const line of listing.split('\n')) {
    const [oid, size] = line.split(' ');
    if (oid !== undefined && size !== undefined) sizes.set(oid, Number(size));
  }
  return sizes;
}

/** The blob at `path` in `rev`, by ID. */
export function blobId(work: string, rev: string, path: string): string {
  return git(work, 'rev-parse', `${rev}:${path}`);
}

/** Lines long enough that a small edit still reads as a rename. */
export function sourceLines(extra: string): string {
  let source = '';
  for (let i = 0; i < 20; i++) source += `pub fn function_${i}() -> u32 { ${i} }\n`;
  return source + extra;
}
