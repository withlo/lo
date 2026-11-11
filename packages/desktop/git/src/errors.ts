/** What can go wrong, in terms the app can show and act on. */

import { formatDuration } from './limits.ts';

/**
 * Why a fetch failed:
 *
 * - `network`: the network failed or timed out.
 * - `auth`: GitHub wanted a token and Lo had none, or the account can't use it here (single
 *   sign-on, an IP allow list).
 * - `tokenRefused`: GitHub refused the token git signed in with. It expired, or was revoked, as
 *   renewing the account's token revokes the one before, so the next fetch signs in with the
 *   account's token as it is then.
 * - `rateLimited`: GitHub is limiting requests: a rate limit or an abuse limit, which wears off.
 * - `certificate`: the server's certificate didn't verify, so Lo sent it nothing.
 * - `repoNotFound`: the repository doesn't exist, or the account can't see it.
 * - `refNotFound`: the branch or pull request ref doesn't exist, or a commit asked for by ID
 *   doesn't.
 * - `timedOut`: the fetch ran out a limit, so Lo stopped it. The message, Lo's own, says which, and
 *   what git was doing then.
 * - `tooLarge`: the fetch brought more than it may, such as an overview over 50 MB, so Lo stopped
 *   it.
 * - `other`: something else, in git's words.
 */
export type FetchFailure =
  | 'network'
  | 'auth'
  | 'tokenRefused'
  | 'rateLimited'
  | 'certificate'
  | 'repoNotFound'
  | 'refNotFound'
  | 'timedOut'
  | 'tooLarge'
  | 'other';

/** What went wrong. Object IDs are full, lowercase hex. */
export type GitErrorDetail =
  /**
   * Fetching from GitHub failed: `what` names what was being fetched, such as "pull request #12",
   * and `message` is git's own words. The app shows it and tries again later when
   * {@link GitError.isRetryable} says so.
   */
  | { kind: 'fetch'; what: string; failure: FetchFailure; message: string }
  /** A commit Lo never fetched, which GitHub no longer has: it was force-pushed away long ago. */
  | { kind: 'unavailable'; oid: string }
  /**
   * A commit that isn't in the local copy. It's never downloaded behind the caller's back, which
   * would bring its whole history with no progress shown and no ref keeping it: fetch it first.
   */
  | { kind: 'notFetched'; oid: string }
  /**
   * Files whose contents the local copy lacks, by blob ID. Reading never downloads them, which
   * would wait on GitHub with no limit or progress: download them first.
   */
  | { kind: 'notDownloaded'; oids: readonly string[] }
  /** More `.gitattributes` files apply to the paths asked about than Lo reads, so it reads none. */
  | { kind: 'tooManyAttributeFiles'; found: number; limit: number }
  /** A revision whose base isn't its head or an ancestor, so its changes can't be told apart. */
  | { kind: 'baseNotAncestor'; base: string; head: string }
  /** The disk is full. The app offers to clear the cache. */
  | { kind: 'diskFull' }
  /** A name or ID that can't be used, such as a branch name git refuses. */
  | { kind: 'invalid'; what: string; value: string }
  /**
   * A git command wrote, or would have, more than `limit` bytes, or `limit` of `unit`, such as a
   * file's lines or a tree's entries, so Lo stopped it or never read it.
   */
  | { kind: 'tooLarge'; command: string; limit: number; unit?: 'lines' | 'entries' | undefined }
  /** A git command took longer than `limit` milliseconds, so Lo stopped it. */
  | { kind: 'tooSlow'; command: string; limit: number }
  /** The cache is open in another process, or already in this one. */
  | { kind: 'busy'; message: string }
  /** Writing to a clone opened to read offline, which never writes. */
  | { kind: 'readOnly'; name: string; what: string }
  /** A git command failed for a reason none of the others covers. */
  | { kind: 'git'; command: string; message: string }
  /** Reading or writing the cache failed. */
  | { kind: 'io'; context: string; message: string };

/** Something that went wrong with git or the local copy. {@link GitError.detail} says what. */
export class GitError extends Error {
  override name = 'GitError';
  readonly detail: GitErrorDetail;

  constructor(detail: GitErrorDetail, options?: ErrorOptions) {
    super(describeOr(detail), options);
    this.detail = detail;
  }

  /**
   * Whether trying again later might work: a fetch that failed on the network, on a rate limit,
   * on a time limit, on a refused token, which renewing the account's token replaces, or for a
   * reason Lo doesn't know.
   */
  isRetryable(): boolean {
    const { detail } = this;
    if (detail.kind !== 'fetch') return false;
    return (
      detail.failure === 'network' ||
      detail.failure === 'rateLimited' ||
      detail.failure === 'tokenRefused' ||
      detail.failure === 'timedOut' ||
      detail.failure === 'other'
    );
  }

  /**
   * The error for a git command, shown as `command`, that failed with `message` on stderr. `what`
   * names what a fetch was fetching. A command that isn't a fetch can still report a failed
   * download from the clone's promisor remote.
   */
  static fromGit(command: string, message: string, what?: string): GitError {
    if (message.includes('No space left on device')) return new GitError({ kind: 'diskFull' });
    // The clone itself is gone or broken, which no fetch fixes.
    if (message.includes('fatal: not a git repository')) {
      return new GitError({ kind: 'git', command, message });
    }
    if (what === undefined && !message.includes('promisor remote')) {
      return new GitError({ kind: 'git', command, message });
    }
    return new GitError({
      kind: 'fetch',
      what: what ?? 'the files to show',
      failure: classifyFetch(message),
      message,
    });
  }

  /** The error for a failed file system call while `context`. A full disk is its own error. */
  static io(context: string, cause: unknown): GitError {
    const code = cause instanceof Error && 'code' in cause ? cause.code : undefined;
    if (code === 'ENOSPC' || code === 'EDQUOT')
      return new GitError({ kind: 'diskFull' }, { cause });
    const message = cause instanceof Error ? cause.message : String(cause);
    return new GitError({ kind: 'io', context, message }, { cause });
  }
}

/**
 * `detail` in words, or a plain message when it can't be put in words, as for a kind Lo doesn't
 * know: making the error never throws, so it never hides the failure it reports.
 */
function describeOr(detail: GitErrorDetail): string {
  try {
    return describe(detail);
  } catch {
    return "git failed in a way Lo couldn't describe";
  }
}

function describe(detail: GitErrorDetail): string {
  switch (detail.kind) {
    case 'fetch':
      return `can't fetch ${detail.what}: ${explain(detail.failure, detail.message)}`;
    case 'unavailable':
      return `commit ${detail.oid.slice(0, 7)} is no longer available`;
    case 'notFetched':
      return `commit ${detail.oid.slice(0, 7)} isn't in the local copy`;
    case 'notDownloaded': {
      const [first = ''] = detail.oids;
      return detail.oids.length === 1
        ? `file ${first.slice(0, 7)} isn't in the local copy yet`
        : `${detail.oids.length} files aren't in the local copy yet, such as ${first.slice(0, 7)}`;
    }
    case 'tooManyAttributeFiles':
      return `${detail.found} .gitattributes files apply, more than the ${detail.limit} Lo reads`;
    case 'baseNotAncestor':
      return (
        `commit ${detail.base.slice(0, 7)} isn't an ancestor of ${detail.head.slice(0, 7)}, so ` +
        `it can't be its base`
      );
    case 'diskFull':
      return 'the disk is full';
    case 'invalid':
      return `\`${detail.value}\` isn't a valid ${detail.what}`;
    case 'tooLarge':
      return `\`${detail.command}\` wrote more than ${detail.limit} ${detail.unit ?? 'bytes'}, so Lo stopped it`;
    case 'tooSlow':
      return `\`${detail.command}\` took longer than ${formatDuration(detail.limit)}, so Lo stopped it`;
    case 'busy':
      return detail.message;
    case 'readOnly':
      return `${detail.name}'s local copy was opened to read offline, so it can't ${detail.what}`;
    case 'git':
      return `\`${detail.command}\` failed: ${detail.message}`;
    case 'io':
      return `${detail.context}: ${detail.message}`;
    default:
      throw new Error(`a git error Lo doesn't know: ${JSON.stringify(detail satisfies never)}`);
  }
}

/** Why a fetch failed, in words, followed by the line of git's message that says so. */
function explain(failure: FetchFailure, message: string): string {
  let reason: string;
  switch (failure) {
    case 'network':
      reason = 'the network failed';
      break;
    case 'rateLimited':
      reason = 'GitHub is limiting requests for now';
      break;
    case 'certificate':
      reason = "the server's certificate didn't verify, so Lo sent it nothing";
      break;
    case 'auth':
      reason = 'GitHub wants an account that can see the repository; sign in with one';
      break;
    case 'tokenRefused':
      reason =
        "GitHub refused the account's token, which may have just expired; Lo tries again with " +
        'its renewed token';
      break;
    case 'repoNotFound':
      reason = "the repository doesn't exist, or the account can't see it";
      break;
    case 'refNotFound':
      reason = "GitHub doesn't have it";
      break;
    case 'timedOut':
    case 'tooLarge':
    case 'other':
      return message;
    default:
      throw new Error(
        `a fetch failure Lo doesn't know: ${JSON.stringify(failure satisfies never)}`,
      );
  }
  // git's last line usually says what happened, such as "Could not resolve host: github.com".
  const detail = message
    .split('\n')
    .map((line) => line.trim())
    .findLast((line) => line !== '');
  return detail === undefined ? reason : `${reason} (${detail})`;
}

/** Reads why a fetch failed from git's message, which is in English: Lo runs git with `LC_ALL=C`. */
function classifyFetch(message: string): FetchFailure {
  const has = (...needles: string[]) => needles.some((needle) => message.includes(needle));
  const lowercase = message.toLowerCase();
  if (has("couldn't find remote ref", 'not our ref', 'unadvertised object')) return 'refNotFound';
  if (
    has('returned error: 429') ||
    lowercase.includes('rate limit') ||
    lowercase.includes('abuse detection')
  ) {
    return 'rateLimited';
  }
  // git says so once GitHub refuses the credential it sent, the token. Without one, it can't read
  // a username.
  if (has('Authentication failed', 'Invalid username or token', 'Invalid username or password')) {
    return 'tokenRefused';
  }
  if (
    has(
      'could not read Username',
      'could not read Password',
      'returned error: 401',
      'returned error: 403',
    )
  ) {
    return 'auth';
  }
  if (
    has('Repository not found', 'does not appear to be a git repository', 'returned error: 404') ||
    isRepositoryNotFound(message)
  ) {
    return 'repoNotFound';
  }
  if (lowercase.includes('certificate')) return 'certificate';
  if (
    has(
      'Could not resolve host',
      'Failed to connect',
      "Couldn't connect",
      'Connection refused',
      'Connection reset',
      'Connection timed out',
      'Operation timed out',
      'Network is unreachable',
      'transfer closed',
      'early EOF',
      'the remote end hung up',
      'RPC failed',
      'SSL',
      'TLS',
      'unable to access',
    )
  ) {
    return 'network';
  }
  return 'other';
}

/**
 * Whether a line of `message` is git's `fatal: repository '<url>' not found`, which GitHub's 404
 * for a repository leads to.
 */
function isRepositoryNotFound(message: string): boolean {
  return message.split('\n').some((line) => {
    const trimmed = line.trim();
    return trimmed.startsWith("fatal: repository '") && trimmed.endsWith("' not found");
  });
}
