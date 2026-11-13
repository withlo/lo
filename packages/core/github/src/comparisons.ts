/**
 * The files that changed between two commits, as GitHub's REST API compares them
 * (`GET /repos/{owner}/{repo}/compare/{base}...{head}`): from where their histories meet to the
 * second, as `git diff base...head` lists them. A stack's layer whose own changes start somewhere
 * other than its base branch shows these until the local copy is ready (`docs/design.md`, "Layer
 * diffs").
 */

import type { GithubClient } from './client.ts';
import { GithubError } from './errors.ts';
import { filesHead, readDiffEntries, type PullFile } from './files.ts';
import { Fields } from './json.ts';
import type { RepoRef } from './refs.ts';

/**
 * GitHub lists at most 300 of a comparison's files, on one page, and doesn't say when there were
 * more; the rest only the local copy shows.
 */
export const MAX_COMPARISON_FILES = 300;

/** A comparison's files, in the shape a pull request's are read in. */
export interface ComparisonFiles {
  /** The commit compared from, as asked. */
  base: string;
  /** The commit compared to, as asked: the head GitHub listed every file at. */
  head: string;
  /** The files that changed, each as GitHub lists a pull request's. */
  files: PullFile[];
  /**
   * Whether GitHub may have left files out: a list of {@link MAX_COMPARISON_FILES} is taken to be
   * cut short, since GitHub says nothing when it is.
   */
  capped: boolean;
  /** The answer's ETag, which the next read sends. */
  etag: string | undefined;
}

/**
 * The REST path of the comparison of commits `base` and `head` in `repo`, named by their IDs. It
 * asks for one commit a page: every file comes on the first page, and the commits aren't read.
 */
export function comparisonPath(repo: RepoRef, base: string, head: string): string {
  const range = `${commitId(base)}...${commitId(head)}`;
  return `/repos/${repo.owner}/${repo.name}/compare/${range}?per_page=1`;
}

/**
 * GitHub's comparison, read: its files. A comparison without its list of files is an answer Lo
 * doesn't know, not one that changes nothing.
 */
export function readComparedFiles(json: unknown): PullFile[] {
  const files = new Fields(json, 'comparison').raw('files');
  if (!Array.isArray(files)) throw unexpected("the comparison's files aren't a list");
  return readDiffEntries(files);
}

/**
 * The files that changed from where commits `base` and `head` in `repo` meet to `head`: GitHub's
 * three-dot comparison, as far as it lists them. `known`, the comparison read before, is asked
 * about with its ETag when it's of the same commits: an unchanged answer is `known` again, for
 * free.
 *
 * Both commits are named by their IDs, never by a branch: a fork's pull request has its head in
 * the base repository too, under `refs/pull/<n>/head`, where its branch's name is another branch's
 * or none. A commit the repository doesn't have, or a repository the account can't see, is
 * GitHub's `404`, thrown as `notFound`.
 */
export async function readComparison(
  client: GithubClient,
  repo: RepoRef,
  base: string,
  head: string,
  known: ComparisonFiles | undefined,
): Promise<ComparisonFiles> {
  const path = comparisonPath(repo, base, head);
  const reusable = known?.base === base && known.head === head ? known : undefined;
  const etag = reusable?.etag;
  const response = await client.send('GET', path, {
    condition: etag === undefined ? undefined : { ifNoneMatch: etag },
  });
  if (response.status === 304) {
    if (reusable?.etag === undefined) {
      throw new GithubError({
        kind: 'inconsistent',
        message: `GitHub said the comparison of ${base} and ${head} hadn't changed, but Lo never read it`,
      });
    }
    return structuredClone(reusable);
  }
  const files = response.json(readComparedFiles);
  const listedAt = filesHead(files);
  if (listedAt !== undefined && listedAt !== head) {
    throw new GithubError({
      kind: 'inconsistent',
      message: `GitHub listed the comparison's files at ${listedAt}, not ${head}`,
    });
  }
  return {
    base,
    head,
    files,
    capped: files.length >= MAX_COMPARISON_FILES,
    etag: response.etag,
  };
}

/** `sha`, if it's a commit's ID as GitHub writes one: 40 hex digits, or 64. */
function commitId(sha: string): string {
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(sha)) {
    throw new RangeError(`${JSON.stringify(sha.slice(0, 80))} isn't a commit's ID`);
  }
  return sha;
}

function unexpected(message: string): GithubError {
  return new GithubError({ kind: 'decode', message });
}
