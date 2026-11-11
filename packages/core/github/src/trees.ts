/**
 * A commit's files, as GitHub's REST API lists them (`GET /repos/{owner}/{repo}/git/trees/{sha}`,
 * with `recursive=1`): what the file tree shows until the local copy is ready. GitHub lists a large
 * tree only in part, and says so.
 */

import type { GithubClient } from './client.ts';
import { GithubError } from './errors.ts';
import { Fields } from './json.ts';
import type { RepoRef } from './refs.ts';

/** What an entry of a tree is: a file or symlink (`blob`), a folder (`tree`), or a submodule. */
export type TreeItemType = 'blob' | 'tree' | 'commit';

/** One entry of a commit's tree. */
export interface TreeItem {
  /** The path from the tree's root, `/`-separated. */
  path: string;
  type: TreeItemType;
  /** git's mode, such as `100644`, `100755`, `120000` (a symlink), `040000` or `160000`. */
  mode: string;
  /** The blob's, folder's or submodule commit's ID. */
  sha: string;
  /** A blob's size in bytes. GitHub gives none for a folder or a submodule. */
  size?: number | undefined;
}

/** A commit's tree, as GitHub lists it. */
export interface RepoTree {
  /** What GitHub names the tree by: the commit or tree asked for. */
  sha: string;
  /** Every entry, folders included, in git's order: each folder before what's in it. */
  items: TreeItem[];
  /**
   * Whether GitHub left entries out: it lists at most about 100,000 entries, or 7 MB of them, of a
   * tree read whole. What's listed is then only part of it.
   */
  truncated: boolean;
}

/**
 * The REST path of the whole tree of `rev`, a commit or a tree, in `repo`: every entry, however
 * deep, as far as GitHub lists them.
 */
export function treePath(repo: RepoRef, rev: string): string {
  return `/repos/${repo.owner}/${repo.name}/git/trees/${encodeURIComponent(rev)}?recursive=1`;
}

/** GitHub's answer for a tree, read. */
export function readRepoTree(json: unknown): RepoTree {
  const tree = new Fields(json, 'tree');
  const listed = tree.raw('tree');
  if (!Array.isArray(listed)) throw unexpected("the tree's entries aren't a list");
  return {
    sha: tree.text('sha'),
    items: listed.map((item: unknown, index) => readItem(new Fields(item, `tree[${index}]`))),
    truncated: tree.flag('truncated'),
  };
}

function readItem(item: Fields): TreeItem {
  const type = item.text('type');
  if (type !== 'blob' && type !== 'tree' && type !== 'commit') {
    throw unexpected(`an entry's type is ${JSON.stringify(type)}`);
  }
  return {
    path: item.text('path'),
    type,
    mode: item.text('mode'),
    sha: item.text('sha'),
    size: item.maybeInteger('size'),
  };
}

function unexpected(message: string): GithubError {
  return new GithubError({ kind: 'decode', message });
}

/** The whole tree of `rev`, a commit or a tree, in `repo`, as far as GitHub lists it. */
export function repoTree(client: GithubClient, repo: RepoRef, rev: string): Promise<RepoTree> {
  return client.get(treePath(repo, rev), readRepoTree);
}
