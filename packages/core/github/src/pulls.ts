/**
 * GitHub's REST view of a pull request (`GET /repos/{owner}/{repo}/pulls/{number}`) and of a
 * repository's open pull requests: what a tab shows without the full details, and what opening a
 * pull request reads, to copy it locally and know when it opened. Signed in, a pull request is
 * read with the account's client; without an account, anonymously, which works for public
 * repositories only.
 */

import type { GithubClient, RestResponse } from './client.ts';
import { GithubError } from './errors.ts';
import { isRecord } from './graphql.ts';
import { RepoRef, type PullRef } from './refs.ts';

/** One side of a pull request. */
export interface PullBranch {
  ref: string;
  sha: string;
}

/**
 * The parts of GitHub's REST view of a pull request that a tab shows without the full details:
 * enough to notice a push, a retitle, a merge or a close.
 */
export interface PullSummary {
  number: number;
  title: string;
  /** `open` or `closed`. */
  state: string;
  draft: boolean;
  merged_at?: string | undefined;
  updated_at: string;
  head: PullBranch;
  base: PullBranch;
}

/** Whether the pull request merged. */
export function pullMerged(summary: PullSummary): boolean {
  return summary.merged_at !== undefined;
}

/**
 * When GitHub last updated the pull request, as an HTTP date for `If-Modified-Since`. GitHub's
 * `Last-Modified` for a pull request is its `updated_at`, which a push to another branch or a
 * star doesn't move, unlike its ETag.
 */
export function pullLastModified(summary: PullSummary): string | undefined {
  const time = Date.parse(summary.updated_at);
  return Number.isNaN(time) ? undefined : new Date(time).toUTCString();
}

/** GitHub's answer for a pull request, read as a {@link PullSummary}. */
export function readPullSummary(json: unknown): PullSummary {
  const pull = new Fields(json, 'pull');
  return {
    number: pull.integer('number'),
    title: pull.text('title'),
    state: pull.text('state'),
    draft: pull.flag('draft'),
    merged_at: pull.maybeText('merged_at'),
    updated_at: pull.text('updated_at'),
    head: branch(pull.fields('head')),
    base: branch(pull.fields('base')),
  };
}

/**
 * A pull request as GitHub's REST list of a repository's open pull requests shows it: what the
 * open pull request list holds about it. Comparing these, not the list's ETag, tells whether the
 * list changed: the ETag also covers each pull request's embedded repositories, which change with
 * any push to the repository.
 */
export interface ListedPull {
  number: number;
  title: string;
  draft: boolean;
  updated_at: string;
  head: PullBranch;
  base: PullBranch;
  /** The GitHub stack it's in. */
  stack?: ListedStack | undefined;
}

/** A listed pull request's place in a GitHub stack. */
export interface ListedStack {
  number: number;
  position: number;
  size: number;
  /** The branch the stack merges into. */
  base: { ref: string };
}

/** One page of a repository's open pull requests from GitHub's REST list, with its ETag. */
export interface ListedPage {
  etag?: string | undefined;
  pulls: ListedPull[];
}

/**
 * The pages of a repository's open pull requests Lo reads, newest first: as many as hold the pull
 * requests the open pull request list does. Each page is asked about with its own ETag, so an
 * older pull request that's pushed to or closed is noticed too.
 */
export interface ListedPulls {
  pages: ListedPage[];
}

/** Every pull request on `listed`'s pages, in order. */
export function allListedPulls(listed: ListedPulls): ListedPull[] {
  return listed.pages.flatMap((page) => page.pulls);
}

/** Whether both list the same pull requests, the same way, whatever their ETags. */
export function listsTheSame(a: ListedPulls, b: ListedPulls): boolean {
  const [these, those] = [allListedPulls(a), allListedPulls(b)];
  return (
    these.length === those.length &&
    these.every((pull, index) => sameListedPull(pull, those[index]))
  );
}

function sameListedPull(a: ListedPull, b: ListedPull | undefined): boolean {
  return (
    b !== undefined &&
    a.number === b.number &&
    a.title === b.title &&
    a.draft === b.draft &&
    a.updated_at === b.updated_at &&
    sameBranch(a.head, b.head) &&
    sameBranch(a.base, b.base) &&
    sameStack(a.stack, b.stack)
  );
}

function sameBranch(a: PullBranch, b: PullBranch): boolean {
  return a.ref === b.ref && a.sha === b.sha;
}

function sameStack(a: ListedStack | undefined, b: ListedStack | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return (
    a.number === b.number &&
    a.position === b.position &&
    a.size === b.size &&
    a.base.ref === b.base.ref
  );
}

/** A page of GitHub's REST list of a repository's open pull requests ({@link RepoRef.openPullsPath}), read. */
export function readListedPulls(json: unknown): ListedPull[] {
  if (!Array.isArray(json)) throw unexpected("the repository's open pull requests aren't a list");
  return json.map((pull: unknown, index) => readListedPull(new Fields(pull, `pulls[${index}]`)));
}

function readListedPull(pull: Fields): ListedPull {
  const stack = pull.maybeFields('stack');
  return {
    number: pull.integer('number'),
    title: pull.text('title'),
    draft: pull.flag('draft'),
    updated_at: pull.text('updated_at'),
    head: branch(pull.fields('head')),
    base: branch(pull.fields('base')),
    stack: stack === undefined ? undefined : readStack(stack),
  };
}

function readStack(stack: Fields): ListedStack {
  return {
    number: stack.integer('number'),
    position: stack.integer('position'),
    size: stack.integer('size'),
    base: { ref: stack.fields('base').text('ref') },
  };
}

function branch(side: Fields): PullBranch {
  return { ref: side.text('ref'), sha: side.text('sha') };
}

/** The parts of GitHub's pull request Lo reads to open it. */
export interface PullToOpen {
  title: string;
  /** The author. GitHub leaves it out for a deleted account. */
  user?: { login: string } | undefined;
  /** When the pull request was opened, where its revisions start. */
  created_at: Date;
  head: {
    sha: string;
    /**
     * The repository the head branch lives in: the base's own, or a fork. GitHub leaves it out
     * once the fork is deleted.
     */
    repo?:
      | {
          /** GitHub's ID for it, which a rename or a transfer keeps. */
          id: number;
          /** Its `owner/name`. */
          full_name: string;
        }
      | undefined;
  };
  base: {
    /** The branch the pull request merges into. */
    ref: string;
    /** The base commit GitHub compared against, which stands in for the branch once it's gone. */
    sha: string;
    repo: {
      /**
       * GitHub's ID for the repository, which a rename or a transfer keeps: what trust in a
       * repository is kept by.
       */
      id: number;
      /**
       * The repository's canonical `owner/name`, which names its local copy. A link to a renamed
       * or transferred repository still names the old one.
       */
      full_name: string;
      /**
       * Where to clone the repository from. Pull requests from forks are fetched from here too,
       * through `refs/pull/<n>/head`.
       */
      clone_url: string;
    };
  };
  /** How many files it changes. GitHub lists no more than 3,000 of them. */
  changed_files?: number | undefined;
  /** Whether it merged. */
  merged: boolean;
  /**
   * Once it merged, the commit that merged it: a merge commit, the squashed or last rebased
   * commit, or the head itself.
   */
  merge_commit_sha?: string | undefined;
}

/** The repository the pull request merges into, by its canonical name ({@link PullToOpen}'s `base.repo.full_name`). */
export function pullBaseRepo(pull: PullToOpen): RepoRef {
  const { full_name: fullName } = pull.base.repo;
  const repo = RepoRef.parse(fullName);
  if (repo === undefined)
    throw unexpected(`GitHub named the repository ${JSON.stringify(fullName)}`);
  return repo;
}

/**
 * GitHub's answer for a pull request, read as a {@link PullToOpen}: one whose repository is on
 * github.com and named `owner/name`.
 */
export function readPullToOpen(json: unknown): PullToOpen {
  const pull = new Fields(json, 'pull');
  const user = pull.maybeFields('user');
  const head = pull.fields('head');
  const fork = head.maybeFields('repo');
  const base = pull.fields('base');
  const repo = base.fields('repo');
  const opened = pull.text('created_at');
  const createdAt = new Date(opened);
  if (Number.isNaN(createdAt.getTime())) {
    throw unexpected(`pull.created_at, ${JSON.stringify(opened)}, isn't a time`);
  }
  const read: PullToOpen = {
    title: pull.text('title'),
    user: user && { login: user.text('login') },
    created_at: createdAt,
    head: {
      sha: head.text('sha'),
      repo: fork && { id: fork.integer('id'), full_name: fork.text('full_name') },
    },
    base: {
      ref: base.text('ref'),
      sha: base.text('sha'),
      repo: {
        id: repo.integer('id'),
        full_name: repo.text('full_name'),
        clone_url: repo.text('clone_url'),
      },
    },
    changed_files: pull.maybeInteger('changed_files'),
    merged: pull.flag('merged'),
    merge_commit_sha: pull.maybeText('merge_commit_sha'),
  };
  const cloneUrl = read.base.repo.clone_url;
  if (!cloneUrl.startsWith('https://github.com/')) {
    throw unexpected(`the repository's clone URL ${cloneUrl} isn't on github.com`);
  }
  pullBaseRepo(read);
  return read;
}

/** Reads the pull request to open it with `login`'s client. */
export async function fetchPullAs(
  client: GithubClient,
  login: string,
  pull: PullRef,
): Promise<PullToOpen> {
  let json: unknown;
  try {
    json = await client.get(pull.restPath(), (answer) => answer);
  } catch (error) {
    if (error instanceof GithubError && error.detail.kind === 'notFound') {
      throw new Error(`GitHub has no pull request ${pull.toString()}, or ${login} can't see it`, {
        cause: error,
      });
    }
    throw withContext(`asking GitHub for ${pull.toString()}`, error);
  }
  try {
    return readPullToOpen(json);
  } catch (error) {
    throw withContext(`reading GitHub's answer for ${pull.toString()}`, error);
  }
}

/**
 * Reads the pull request to open it with `client`, a client without an account. It works for
 * public repositories only and counts against GitHub's 60 requests an hour per IP address, so the
 * app keeps one such client, which keeps what GitHub last said about that limit for every tab.
 * `canSignIn` says whether Lo can sign in to GitHub, which it can't when it couldn't read its
 * accounts.
 */
export async function fetchPublicPull(
  client: GithubClient,
  pull: PullRef,
  { canSignIn }: { canSignIn: boolean },
): Promise<PullToOpen> {
  let response: RestResponse;
  try {
    // A renamed repository answers with a redirect to its new name, which the client follows.
    response = await client.getAnswer(pull.restPath());
  } catch (error) {
    throw withContext(`asking GitHub for ${pull.toString()}`, error);
  }
  checkStatus(response, pull, canSignIn);
  try {
    return response.json(readPullToOpen);
  } catch (error) {
    throw withContext(`reading GitHub's answer for ${pull.toString()}`, error);
  }
}

/** How long {@link githubAnswers} waits for an answer, in milliseconds. */
export const ANSWER_TIMEOUT_MS = 15_000;

/**
 * Whether it's worth loading from GitHub again: `GET /rate_limit`, which doesn't count against any
 * rate limit, got an answer with any status within `timeoutMs`, or failed in a way waiting won't
 * fix, such as a proxy that refuses it, which loading then reports.
 */
export async function githubAnswers(
  client: GithubClient,
  timeoutMs = ANSWER_TIMEOUT_MS,
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => {
      resolve(false);
    }, timeoutMs);
  });
  const answered = client.getAnswer('/rate_limit').then(
    () => true,
    (error: unknown) => !(error instanceof GithubError && error.isRetryable()),
  );
  try {
    return await Promise.race([answered, late]);
  } finally {
    clearTimeout(timer);
  }
}

/** Turns an unsuccessful answer into an error that says what to do about it, caused by GitHub's error. */
function checkStatus(response: RestResponse, pull: PullRef, canSignIn: boolean): void {
  const { status, headers } = response;
  if (status >= 200 && status < 300) return;
  const cause = GithubError.fromResponse(status, headers, response.text());
  const rateLimited = headers.get('x-ratelimit-remaining') === '0';
  if (rateLimited && (status === 403 || status === 429)) {
    const used = "GitHub's limit of 60 requests an hour without signing in is used up";
    throw new Error(
      canSignIn
        ? `${used}; sign in from Accounts… in the Lo menu, or try again later`
        : `${used}; try again later`,
      { cause },
    );
  }
  if (status === 404) {
    const missing = `GitHub has no public pull request ${pull.toString()}`;
    throw new Error(
      canSignIn
        ? `${missing}, and no account Lo is signed in to can see it. Sign in from Accounts… in the Lo menu`
        : `${missing}, and Lo couldn't read its accounts to sign in`,
      { cause },
    );
  }
  const message = 'message' in cause.detail ? cause.detail.message : '';
  throw new Error(`GitHub answered ${statusLine(status)} for ${pull.toString()}: ${message}`, {
    cause,
  });
}

/** The reason phrases of the error statuses GitHub answers with. */
const REASONS: Readonly<Record<number, string>> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
  410: 'Gone',
  422: 'Unprocessable Entity',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
  504: 'Gateway Timeout',
};

/** A status with its reason phrase, such as `500 Internal Server Error`. */
function statusLine(status: number): string {
  const reason = REASONS[status];
  return reason === undefined ? String(status) : `${status} ${reason}`;
}

/** `error` after what was being done when it happened: `<context>: <what went wrong>`. */
function withContext(context: string, error: unknown): Error {
  const said =
    error instanceof GithubError && error.detail.kind === 'decode'
      ? error.detail.message
      : error instanceof Error
        ? error.message
        : String(error);
  return new Error(`${context}: ${said}`, { cause: error });
}

function unexpected(message: string): GithubError {
  return new GithubError({ kind: 'decode', message });
}

/**
 * An object in GitHub's answer, read field by field: a field that isn't what Lo reads it as is a
 * decode error naming it. A field GitHub may leave out also reads as nothing when it's `null`.
 */
class Fields {
  readonly #json: Record<string, unknown>;
  readonly #path: string;

  constructor(json: unknown, path: string) {
    if (!isRecord(json)) throw unexpected(`${path} isn't an object`);
    this.#json = json;
    this.#path = path;
  }

  text(key: string): string {
    const value = this.#json[key];
    if (typeof value !== 'string') throw this.#wrong(key, 'a string');
    return value;
  }

  maybeText(key: string): string | undefined {
    return this.#present(key) ? this.text(key) : undefined;
  }

  integer(key: string): number {
    const value = this.#json[key];
    if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
      throw this.#wrong(key, 'a whole number');
    }
    return value;
  }

  maybeInteger(key: string): number | undefined {
    return this.#present(key) ? this.integer(key) : undefined;
  }

  /** A boolean that reads as `false` when GitHub leaves it out. */
  flag(key: string): boolean {
    const value = this.#json[key];
    if (value === undefined) return false;
    if (typeof value !== 'boolean') throw this.#wrong(key, 'true or false');
    return value;
  }

  fields(key: string): Fields {
    return new Fields(this.#json[key], `${this.#path}.${key}`);
  }

  maybeFields(key: string): Fields | undefined {
    return this.#present(key) ? this.fields(key) : undefined;
  }

  #present(key: string): boolean {
    const value = this.#json[key];
    return value !== undefined && value !== null;
  }

  #wrong(key: string, what: string): GithubError {
    return unexpected(`${this.#path}.${key} isn't ${what}`);
  }
}
