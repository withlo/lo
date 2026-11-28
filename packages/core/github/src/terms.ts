/**
 * Writing a repository's definitions, the commit `refs/lo/terms` holds, through GitHub's API as the
 * account signed in: a tree holding only `terms.json`, a commit of it on the commit the ref holds,
 * then the ref moved to it, only from that commit and only by a fast-forward. Nothing here writes
 * to a branch, or to any other ref. A tree or a commit nothing points to changes nothing anyone
 * reads: only moving the ref changes the definitions.
 *
 * GitHub's REST API moves a ref under `refs/lo/` that isn't a fast-forward, `force: false` or not,
 * and can't be told which commit the ref should still hold. So the ref is moved with GraphQL's
 * `updateRefs`, which does both. It refuses a move from a commit the ref no longer holds with
 * "Something went wrong" alone, which is also what it says when it fails inside: that's
 * {@link RefMove}'s `unsure`, which reading the ref again settles.
 *
 * None is ever sent again by itself. A move whose answer was lost may have been made: whoever sent
 * it reads the ref, and {@link holds} says whether it holds the commit.
 */

import type { GithubClient } from './client.ts';
import { GithubError } from './errors.ts';
import { MoveTermsDocument, TermsAccessDocument } from './generated/graphql.ts';
import type { GraphQLError } from './graphql.ts';
import { Fields } from './json.ts';
import type { RepoRef } from './refs.ts';

/** The ref a repository's definitions are on. */
export const TERMS_REF = 'refs/lo/terms';

/** The one file a commit of the definitions holds. */
const FILE = 'terms.json';

/** What `updateRefs` takes for a ref that isn't there, before, or after. */
const NONE = '0000000000000000000000000000000000000000';

function gitPath(repo: RepoRef, rest: string): string {
  return `/repos/${repo.owner}/${repo.name}/git/${rest}`;
}

/**
 * Whether the account may write `repo`'s definitions, and the repository's node ID, which moving
 * their ref names it by. GitHub's permissions that push are `WRITE`, `MAINTAIN` and `ADMIN`; one
 * it doesn't say, as for an account it shows nothing of the repository's permissions, doesn't.
 */
export interface TermsAccess {
  repositoryId: string;
  push: boolean;
}

/** Whether the account may write `repo`'s definitions ({@link TermsAccess}). */
export async function termsAccess(client: GithubClient, repo: RepoRef): Promise<TermsAccess> {
  const data = await client.graphql(TermsAccessDocument, { owner: repo.owner, name: repo.name });
  const repository = data.repository;
  if (!repository) {
    throw new GithubError({ kind: 'notFound', message: `${repo.toString()} wasn't found` });
  }
  const permission = repository.viewerPermission;
  return {
    repositoryId: repository.id,
    push: permission === 'WRITE' || permission === 'MAINTAIN' || permission === 'ADMIN',
  };
}

/** A tree made to hold `terms.json`: its ID, and the ID of the file's blob. */
export interface TermsTree {
  tree: string;
  blob: string;
}

/**
 * Makes a tree in `repo` holding `text` as `terms.json`, and nothing else. GitHub makes the blob
 * from the text, as UTF-8, and names it in its answer.
 */
export async function termsTree(
  client: GithubClient,
  repo: RepoRef,
  text: string,
): Promise<TermsTree> {
  const body = JSON.stringify({
    tree: [{ path: FILE, mode: '100644', type: 'blob', content: text }],
  });
  return client.write('POST', gitPath(repo, 'trees'), body, (json) => {
    const answer = new Fields(json, 'tree');
    const listed = answer.raw('tree');
    if (!Array.isArray(listed)) throw unexpected("the tree's entries aren't a list");
    const entries = listed.map((item: unknown, index) => new Fields(item, `tree[${index}]`));
    const [file] = entries;
    if (entries.length !== 1 || file?.text('path') !== FILE || file.text('type') !== 'blob') {
      throw unexpected(`the tree made isn't ${FILE} alone`);
    }
    return { tree: objectId(answer.text('sha')), blob: objectId(file.text('sha')) };
  });
}

/**
 * Makes a commit in `repo` of `tree`, on `parent`, or on nothing for a repository's first
 * definitions, saying `message`. GitHub writes the account signed in as its author and committer,
 * now.
 */
export async function termsCommit(
  client: GithubClient,
  repo: RepoRef,
  commit: { tree: string; parent: string | undefined; message: string },
): Promise<string> {
  const body = JSON.stringify({
    message: commit.message,
    tree: objectId(commit.tree),
    parents: commit.parent === undefined ? [] : [objectId(commit.parent)],
  });
  return client.write('POST', gitPath(repo, 'commits'), body, (json) =>
    objectId(new Fields(json, 'commit').text('sha')),
  );
}

/**
 * What moving the ref came to:
 *
 * - `moved`;
 * - `behind`: GitHub refused it as no fast-forward, so nothing changed;
 * - `unsure`: GitHub said only that something went wrong, which it says of a ref that no longer
 *   held `from`, and of a failure of its own, which may have moved it: reading the ref says which;
 * - `refused`: GitHub doesn't let the account write: it has no push access (`push`), or a rule of
 *   the repository's blocks it (`rule`), with what GitHub said.
 */
export type RefMove =
  | { kind: 'moved' }
  | { kind: 'behind'; said: string }
  | { kind: 'unsure'; said: string }
  | { kind: 'refused'; why: TermsRefusal; said: string };

/** Why GitHub refused a write to the definitions: no push access, or a rule of the repository's. */
export type TermsRefusal = 'push' | 'rule';

/**
 * Moves `repo`'s definitions' ref to `to`, a commit on `from`, the commit it holds, or makes it at
 * `to` where there was none (`from` undefined): only if it holds `from` still, or is still none,
 * and only by a fast-forward. `repositoryId` is the repository's node ID ({@link termsAccess}).
 * Throws for anything else GitHub answered, and for no answer: one lost may have moved it.
 */
export async function moveTerms(
  client: GithubClient,
  repositoryId: string,
  move: { from: string | undefined; to: string },
): Promise<RefMove> {
  try {
    const data = await client.graphql(MoveTermsDocument, {
      repositoryId,
      before: move.from === undefined ? NONE : objectId(move.from),
      after: objectId(move.to),
    });
    if (!data.updateRefs) throw unexpected('GitHub moved no ref');
    return { kind: 'moved' };
  } catch (error) {
    const refused = termsRefusal(error);
    if (refused) return { kind: 'refused', ...refused };
    if (error instanceof GithubError && error.detail.kind === 'graphql') {
      const said = error.said();
      if (error.detail.errors.some(isBehind)) return { kind: 'behind', said };
      if (error.mayHavePosted()) return { kind: 'unsure', said };
    }
    throw error;
  }
}

/** Whether GitHub refused a move as no fast-forward: "rejecting non-fast forward update". */
function isBehind(error: GraphQLError): boolean {
  return /\bnon[- ]fast[- ]?forward\b/i.test(error.message);
}

/**
 * Why GitHub refused a write to the definitions, from its error, if it's that: a rule of the
 * repository's, by its words; or no push access, which REST answers with a `403`, or a `404` where
 * the account mayn't know there's anything to write to, and GraphQL as forbidden or not found. A
 * rate limit, single sign-on or an organization's restriction isn't.
 */
export function termsRefusal(error: unknown): { why: TermsRefusal; said: string } | undefined {
  if (!(error instanceof GithubError)) return undefined;
  const { detail } = error;
  const said = error.said();
  switch (detail.kind) {
    case 'notFound':
      return { why: 'push', said };
    case 'api':
      if ((detail.status === 403 || detail.status === 422) && RULE.test(detail.message)) {
        return { why: 'rule', said };
      }
      return detail.status === 403 ? { why: 'push', said } : undefined;
    case 'graphql':
      if (detail.errors.some(({ message }) => RULE.test(message))) return { why: 'rule', said };
      return detail.errors.some(({ type }) => type === 'FORBIDDEN' || type === 'NOT_FOUND')
        ? { why: 'push', said }
        : undefined;
    case 'unauthorized':
    case 'ssoRequired':
    case 'oauthAppRestricted':
    case 'rateLimited':
    case 'inconsistent':
    case 'refusedUrl':
    case 'network':
    case 'tokenUnavailable':
    case 'decode':
      return undefined;
    default:
      detail satisfies never;
      return undefined;
  }
}

/** What GitHub says of a write a repository's rules refused: "Repository rule violations found". */
const RULE = /\brules?\b|\bruleset/i;

/**
 * Whether `head`, a commit in `repo`, is `base` or comes after it, as GitHub compares them: the
 * commit a ref holds now, and the one Lo moved it to, whose answer was lost.
 */
export async function holds(
  client: GithubClient,
  repo: RepoRef,
  head: string,
  base: string,
): Promise<boolean> {
  const path = `/repos/${repo.owner}/${repo.name}/compare/${objectId(base)}...${objectId(head)}?per_page=1`;
  const status = await client.get(path, (json) => new Fields(json, 'comparison').text('status'));
  return status === 'identical' || status === 'ahead';
}

/** `sha`, if it's an object's ID as GitHub writes one: 40 hex digits, or 64. */
function objectId(sha: string): string {
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(sha)) {
    throw unexpected(`${JSON.stringify(sha.slice(0, 80))} isn't an object's ID`);
  }
  return sha;
}

function unexpected(message: string): GithubError {
  return new GithubError({ kind: 'decode', message });
}
