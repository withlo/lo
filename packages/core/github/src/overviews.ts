/**
 * A pull request's overview, as GitHub's REST API serves it: the ref `refs/lo/pr/<n>` it's pushed
 * to, watched with an ETag; the commit the ref holds, with who wrote it and when; and that commit's
 * files, as they are, by their IDs. The commit's tree is {@link repoTree}'s.
 */

import type { Conditional, GithubClient } from './client.ts';
import { GithubError, MAX_RETRY_AFTER } from './errors.ts';
import { Fields } from './json.ts';
import type { RepoRef } from './refs.ts';

/** The ref a pull request's overview is pushed to. */
export function overviewRef(number: number): string {
  return `refs/lo/pr/${number}`;
}

/**
 * The REST path of the refs in `repo` that start with pull request `number`'s overview's ref,
 * which holds it if there's one. GitHub answers a ref that isn't there with a list, empty or of the
 * refs it starts, and an ETag, so a poll that finds nothing changed costs nothing; asking for the
 * ref alone answers a missing one with a `404`, which has no ETag.
 */
export function overviewRefsPath(repo: RepoRef, number: number): string {
  checkNumber(number);
  return `/repos/${repo.owner}/${repo.name}/git/matching-refs/lo/pr/${number}`;
}

/**
 * What pull request `number`'s overview's ref holds: nothing, as when there's no overview; a
 * commit, the overview; or another kind of object (a tag, a tree or a blob), which is no overview.
 */
export type OverviewRef =
  { kind: 'none' } | { kind: 'commit'; sha: string } | { kind: 'other'; type: string; sha: string };

/**
 * GitHub's list of the refs that start with pull request `number`'s overview's ref, read: only
 * the ref itself counts. `refs/lo/pr/8` starts `refs/lo/pr/80`, which is another pull request's.
 */
export function readOverviewRef(number: number): (json: unknown) => OverviewRef {
  const wanted = overviewRef(number);
  return (json) => {
    if (!Array.isArray(json)) throw unexpected("the refs aren't a list");
    for (const [index, item] of json.entries()) {
      const ref = new Fields(item, `refs[${index}]`);
      if (ref.text('ref') !== wanted) continue;
      const object = ref.fields('object');
      const sha = objectId(object.text('sha'));
      const type = object.text('type');
      return type === 'commit' ? { kind: 'commit', sha } : { kind: 'other', type, sha };
    }
    return { kind: 'none' };
  };
}

/** The longest wait between reads GitHub's `x-poll-interval` is taken to ask for, in seconds. */
export const MAX_POLL_INTERVAL = MAX_RETRY_AFTER;

/**
 * An answer about an overview's ref: unchanged, or what it holds and its ETag; and the seconds
 * GitHub's `x-poll-interval` asks Lo to wait before asking again, up to {@link MAX_POLL_INTERVAL},
 * if it sent one. GitHub sends it with a new answer, not with a `304`.
 */
export type OverviewRefAnswer = Conditional<OverviewRef> & { pollInterval: number | undefined };

/** The seconds `x-poll-interval` asks for: a whole number of them, up to {@link MAX_POLL_INTERVAL}. */
export function pollInterval(header: string | undefined): number | undefined {
  if (header === undefined || !/^\s*\d{1,9}\s*$/.test(header)) return undefined;
  const seconds = Number(header);
  return seconds > 0 ? Math.min(seconds, MAX_POLL_INTERVAL) : undefined;
}

/**
 * Reads what pull request `number`'s overview's ref holds in `repo`, sending `etag`, the ETag of
 * the last answer, if there's one: GitHub answers `notModified`, free, when nothing changed.
 */
export function watchOverviewRef(
  client: GithubClient,
  repo: RepoRef,
  number: number,
  etag: string | undefined,
): Promise<OverviewRefAnswer> {
  const path = overviewRefsPath(repo, number);
  const condition = etag === undefined ? undefined : { ifNoneMatch: etag };
  return client.send('GET', path, { condition }).then((response) => {
    const asked = pollInterval(response.header('x-poll-interval'));
    if (response.status === 304) return { notModified: true, pollInterval: asked };
    return {
      notModified: false,
      value: response.json(readOverviewRef(number)),
      etag: response.etag,
      pollInterval: asked,
    };
  });
}

/** A commit, as an overview's byline and its files need it. */
export interface CommitSummary {
  sha: string;
  /** Its tree's ID. */
  tree: string;
  /** Its author's login, when GitHub maps the author's address to an account. */
  login: string | undefined;
  /** Its author's name, as git records it. */
  name: string;
  /** When it was committed, in milliseconds since the Unix epoch. */
  committedAt: number;
}

/** The REST path of commit `sha` in `repo`. */
export function commitPath(repo: RepoRef, sha: string): string {
  return `/repos/${repo.owner}/${repo.name}/commits/${objectId(sha)}`;
}

/** GitHub's answer for a commit, read. */
export function readCommitSummary(json: unknown): CommitSummary {
  const answer = new Fields(json, 'commit');
  const commit = answer.fields('commit');
  const committed = Date.parse(commit.fields('committer').text('date'));
  if (!Number.isFinite(committed)) throw unexpected("the commit's date isn't a date");
  return {
    sha: objectId(answer.text('sha')),
    tree: objectId(commit.fields('tree').text('sha')),
    login: answer.maybeFields('author')?.maybeText('login'),
    name: commit.fields('author').text('name'),
    committedAt: committed,
  };
}

/** Commit `sha` in `repo`. */
export function commitSummary(
  client: GithubClient,
  repo: RepoRef,
  sha: string,
): Promise<CommitSummary> {
  return client.get(commitPath(repo, sha), readCommitSummary);
}

/** The REST path of blob `sha` in `repo`. */
export function blobPath(repo: RepoRef, sha: string): string {
  return `/repos/${repo.owner}/${repo.name}/git/blobs/${objectId(sha)}`;
}

/** The media type that asks for a blob's bytes as they are, rather than in JSON as base64. */
export const RAW = 'application/vnd.github.raw+json';

/**
 * The bytes of blob `sha` in `repo`, as they are. They're GitHub's word for what the ID names:
 * whoever keeps them checks them against it.
 */
export async function blobBytes(
  client: GithubClient,
  repo: RepoRef,
  sha: string,
): Promise<Uint8Array> {
  const response = await client.send('GET', blobPath(repo, sha), { accept: RAW });
  if (response.status !== 200) {
    throw unexpected(`GitHub answered a blob's bytes with ${response.status}`);
  }
  return response.body;
}

/** `sha`, if it's an object's ID as GitHub writes one: 40 hex digits, or 64. */
function objectId(sha: string): string {
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(sha)) {
    throw unexpected(`${JSON.stringify(sha.slice(0, 80))} isn't an object's ID`);
  }
  return sha;
}

function checkNumber(number: number): void {
  if (!Number.isSafeInteger(number) || number < 1) {
    throw new RangeError(`${number} isn't a pull request's number`);
  }
}

function unexpected(message: string): GithubError {
  return new GithubError({ kind: 'decode', message });
}
