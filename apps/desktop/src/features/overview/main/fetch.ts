// Reading an overview's commit from GitHub's REST API: the commit, for its tree and byline; the
// tree, every entry with its kind and size, so the overview's limits are checked before any of its
// files comes; then `artifact.md`, unless the listing says it's too large or holds none. Files come
// raw, by their IDs, and are kept only once they hash to them. Nothing here calls Electron.

import { checkArtifact, SIZE_ONLY, type FileAnswer } from '@lo/artifact';
import {
  blobBytes,
  commitSummary,
  GithubError,
  repoTree,
  type GithubClient,
  type RepoRef,
} from '@lo/github';

import type { Acting } from '../../tab/contract.ts';
import { authorLogin, NAME_LIMIT, type Entry, type OverviewCommit } from '../contract.ts';
import { entryAt, listedEntries, treeEntries } from './listing.ts';
import type { Blobs } from './blobs.ts';

/** Runs `request` with the tab's GitHub client, in its turn in the account's queue. */
export type Github = <T>(request: (client: GithubClient) => Promise<T>) => Promise<T>;

/** A file GitHub sent that isn't the one its ID names, or a listing that isn't GitHub's. */
export class Unexpected extends Error {
  override name = 'Unexpected';
}

/** Whether `error` is a refusal that says what was asked for isn't there: a `404`, or a `410`. */
export function isGone(error: unknown): boolean {
  if (!(error instanceof GithubError)) return false;
  const { detail } = error;
  return detail.kind === 'notFound' || (detail.kind === 'api' && detail.status === 410);
}

/** A reader that reads nothing, for the checks of a listing alone. */
async function unread(): Promise<FileAnswer> {
  return { kind: 'missing' };
}

/**
 * Whether main reads the overview's text up front: not when the listing already makes the overview
 * too large, or holds no `artifact.md` as a file, as the checks would find with nothing parsed.
 */
export async function readsText(entries: readonly Entry[], truncated: boolean): Promise<boolean> {
  // GitHub lists a commit in part only past far more entries than an overview may hold.
  if (truncated) return false;
  const { outcome, findings } = await checkArtifact(
    undefined,
    { entries: treeEntries(entries), read: unread },
    unread,
  );
  if (outcome.kind === 'tooLarge') return false;
  return !findings.some(({ code }) => code === 'artifact-missing' || code === 'artifact-not-file');
}

/**
 * Reads overview commit `sha` from `repository`, which is `source`, with `github`, as `acting`:
 * its byline and listing, and `artifact.md` into `blobs`, unless the listing says not to read it.
 * Throws what GitHub answered, or {@link Unexpected}.
 */
export async function readOverview(
  github: Github,
  acting: Acting,
  blobs: Blobs,
  repository: RepoRef,
  sha: string,
  source: OverviewCommit['source'],
): Promise<OverviewCommit> {
  const summary = await github((client) => commitSummary(client, repository, sha));
  if (summary.sha !== sha) throw new Unexpected(`GitHub answered for commit ${summary.sha}.`);
  const tree = await github((client) => repoTree(client, repository, summary.tree));
  const entries = listedEntries(tree.items);
  if (!entries)
    throw new Unexpected("GitHub's listing of the overview named an object no ID names.");
  const read = await readsText(entries, tree.truncated);
  if (read) {
    const text = entryAt(entries, 'artifact.md');
    if (text?.kind !== 'file' || text.size === null)
      throw new Unexpected('No artifact.md to read.');
    await fetchBlob(github, acting, blobs, repository, text.id);
  }
  const login = summary.login !== undefined && authorLogin.safeParse(summary.login).success;
  return {
    id: sha,
    source,
    repository: { owner: repository.owner, name: repository.name },
    byline: {
      login: login ? (summary.login ?? null) : null,
      name: clip(summary.name, NAME_LIMIT),
      at: Math.max(0, Math.round(summary.committedAt)),
    },
    entries,
    truncated: tree.truncated,
    read,
  };
}

/**
 * The files being fetched, by the store each goes into, then by who asked GitHub for them, their
 * repository and ID.
 */
const fetching = new WeakMap<Blobs, Map<string, Promise<Uint8Array>>>();

/** Who requests go as, for asks to share a fetch: an account, whatever its case, or nobody. */
function askerOf(acting: Acting): string {
  return acting.kind === 'account' ? `@${acting.login.toLowerCase()}` : 'nobody';
}

/**
 * The file `id` names, from `blobs`, else fetched raw from `repository` with `github`, as
 * `acting`, and kept once it hashes to `id`. An ask as the same account, or as nobody, while the
 * same file is being fetched gets that fetch's answer, so asks at once, as the view's and its
 * check's are, cost one request, in that account's turn. One as another account fetches it itself,
 * so what GitHub tells one account, such as that it's signed out or past its rate limit, is never
 * said of another. Throws {@link Unexpected} for bytes that don't hash to `id`.
 */
export async function fetchBlob(
  github: Github,
  acting: Acting,
  blobs: Blobs,
  repository: RepoRef,
  id: string,
): Promise<Uint8Array> {
  const kept = blobs.get(id);
  if (kept) return kept;
  let under = fetching.get(blobs);
  if (!under) {
    under = new Map();
    fetching.set(blobs, under);
  }
  const key = `${askerOf(acting)} ${repository.key} ${id}`;
  const joined = under.get(key);
  if (joined) return joined;
  const started = fetchNew(github, blobs, repository, id).finally(() => under.delete(key));
  under.set(key, started);
  return started;
}

/** The file `id` names, fetched raw from `repository`, and kept once it hashes to `id`. */
async function fetchNew(
  github: Github,
  blobs: Blobs,
  repository: RepoRef,
  id: string,
): Promise<Uint8Array> {
  const bytes = await github((client) => blobBytes(client, repository, id));
  if (!blobs.put(id, bytes)) {
    throw new Unexpected(`GitHub sent a file of the overview that isn't the one its ID names.`);
  }
  return bytes;
}

/** The start of `text`, at most `limit` UTF-16 units of it, never splitting a character. */
function clip(text: string, limit: number): string {
  if (text.length <= limit) return text;
  let clipped = '';
  for (const character of text) {
    if (clipped.length + character.length > limit) break;
    clipped += character;
  }
  return clipped;
}

/** Whether a file of `size` bytes comes with its size alone, as a reader may answer it. */
export function sizeOnly(size: number): boolean {
  return size > SIZE_ONLY;
}
