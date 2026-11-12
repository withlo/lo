// A pull request's overview, as main has it for the window: the commit `refs/lo/pr/<n>` holds,
// read from GitHub's REST API, with who wrote it and when, what it holds, and its files, which
// main keeps by their IDs. Main watches the ref while the pull request's tab is on screen, and a
// newer commit is offered, never put in place of the one on screen.

import { z } from 'zod';

import { defineContract, reply } from '../../ipc/contract.ts';
import { login } from '../accounts/contract.ts';
import { helpLink, oid, tabId } from '../tab/contract.ts';

/** A moment, in milliseconds since the Unix epoch. */
const time = z.number().int().nonnegative();

/** What a path in the overview's commit is. A link is a symbolic link. */
export const entryKind = z.enum(['file', 'link', 'folder', 'submodule']);
export type EntryKind = z.output<typeof entryKind>;

/**
 * A file or folder in the overview's commit, as GitHub lists it: its path as text, which GitHub
 * writes with U+FFFD for bytes that aren't UTF-8, what it is, a file's or a link's size, and its
 * git ID: a file's blob, a folder's tree or a submodule's commit.
 */
export const entry = z.strictObject({
  path: z.string(),
  kind: entryKind,
  size: z.number().int().nonnegative().nullable(),
  id: oid,
});
export type Entry = z.output<typeof entry>;

/**
 * A login on GitHub, as a commit's author has one: a person's or an organization's, or an app's,
 * such as `dependabot[bot]`.
 */
export const authorLogin = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9-]{0,38}(?:\[bot\])?$/);

/** The most characters of an author's name kept for the byline. */
export const NAME_LIMIT = 256;

/** Who wrote an overview, and when: its commit's author's login, else their name, and its time. */
export const byline = z.strictObject({
  /** The author's login, when GitHub maps their address to an account. */
  login: authorLogin.nullable(),
  /** The author's name, as git records it, up to {@link NAME_LIMIT} characters. */
  name: z.string().max(NAME_LIMIT),
  /** When the commit was made. */
  at: time,
});
export type Byline = z.output<typeof byline>;

/** A repository on GitHub, by its owner and name. */
export const repository = z.strictObject({
  owner: z.string().min(1).max(39),
  name: z.string().min(1).max(100),
});

/**
 * An overview's commit, as main read it: its ID, whether it came from the pull request's own
 * repository or the fork its head is in, and which that is; its byline; its files and folders, as
 * GitHub listed them; and whether `artifact.md` was read, which `files` then gives at once.
 *
 * Past the most files and folders an overview may hold, only one more than that are listed, with
 * `artifact.md` wherever it is, which is all the overview's checks look at. `artifact.md` isn't
 * read when the listing already says the overview is too large, or holds no `artifact.md` as a
 * file: GitHub listed the commit only in part (`truncated`), or it's past its limits.
 */
export const overviewCommit = z.strictObject({
  id: oid,
  source: z.enum(['base', 'fork']),
  repository,
  byline,
  entries: z.array(entry),
  truncated: z.boolean(),
  read: z.boolean(),
});
export type OverviewCommit = z.output<typeof overviewCommit>;

/**
 * Why main couldn't read the overview just now, worst first, each with when it tries again: the
 * account is signed out; the rate limit is used up, or GitHub asked Lo to slow down; an
 * organization blocks the account until it's authorized, with GitHub's links to fix that; GitHub
 * can't be reached; or anything else GitHub answered, or sent, such as a file that isn't the one its
 * ID names.
 */
export const problem = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('signedOut'), login, retryAt: time }),
  z.strictObject({ kind: z.literal('rateLimited'), secondary: z.boolean(), retryAt: time }),
  z.strictObject({
    kind: z.literal('blocked'),
    message: z.string(),
    links: z.array(helpLink),
    retryAt: time,
  }),
  z.strictObject({ kind: z.literal('offline'), message: z.string(), retryAt: time }),
  z.strictObject({ kind: z.literal('failed'), message: z.string(), retryAt: time }),
]);
export type Problem = z.output<typeof problem>;

/**
 * Whether the code an overview names can be read, from the pull request's local copy: `waiting`
 * until the copy is there; `ready` once it is; `offline` when it's opened to read only what it has;
 * `noGit` without git; and `failed` when it couldn't be fetched.
 */
export const codeAccess = z.enum(['waiting', 'ready', 'offline', 'noGit', 'failed']);
export type CodeAccess = z.output<typeof codeAccess>;

/**
 * A pull request's tab's overview, sent each time it changes:
 *
 * - `ref`: the ref main reads, `refs/lo/pr/<n>`;
 * - `watching`: whether main asks GitHub about it again as time goes on, which it does while the
 *   tab is on screen, signed in; a public pull request opened without an account is read once;
 * - `found`: what the ref held when main last read it, in the pull request's repository, else in
 *   its fork: `unknown` until it has, `none`, a `commit`, or `notCommit`, something other than a
 *   commit, which is no overview;
 * - `overview`: the overview on screen: the first commit main had for the tab, from what it kept
 *   or from GitHub, until the newer one is loaded. It stays when the ref later holds nothing;
 * - `newer`: a newer commit the ref holds, read and ready to load;
 * - `saved`: whether the overview on screen is from what main kept from an earlier read, and
 *   GitHub hasn't said since that the ref holds it;
 * - `problem`: why the last read failed, until one succeeds;
 * - `code`: whether the code it names can be read yet, which `code` does.
 */
export const overviewState = z.strictObject({
  id: tabId,
  ref: z.string(),
  watching: z.boolean(),
  found: z.enum(['unknown', 'none', 'commit', 'notCommit']),
  overview: overviewCommit.nullable(),
  newer: overviewCommit.nullable(),
  saved: z.boolean(),
  problem: problem.nullable(),
  code: codeAccess,
});
export type OverviewState = z.output<typeof overviewState>;

/** The most files one `files` asks for: `artifact.md` and every figure an overview may show. */
export const FILES_LIMIT = 101;

/**
 * A file of an overview's commit, as `files` replies: its size and bytes, which are none for one
 * larger than `@lo/artifact`'s `SIZE_ONLY`, as a reader may answer it; `missing`, when nothing is
 * at the path; `notFile`, when what's there is a link, a folder or a submodule; `refused`, when
 * the path is one no overview reads, so main never reads it; or `unread`, when main couldn't read
 * it just now, and why.
 */
export type OverviewFile =
  | { kind: 'file'; size: number; bytes: Uint8Array | null }
  | { kind: 'missing' }
  | { kind: 'notFile'; is: 'link' | 'folder' | 'submodule' }
  | { kind: 'refused' }
  | { kind: 'unread'; why: string };

/** The most files one `code` asks for: one for each place an overview may point. */
export const CODE_LIMIT = 500;

/** The longest path `code` reads, in characters: no place an overview points is longer. */
export const PATH_LIMIT = 1024;

/**
 * A file an overview's code names, as `code` replies, for the overview's checks to read:
 *
 * - `file`: its size, and as much of it as the checks read: none, for a file named whole or one
 *   larger than they read; its start, for one that isn't text or is past what's left of the code
 *   they read; else all of it. A file named whole whose contents the local copy lacks has no size;
 * - `tooLarge`: larger than the checks read of a file, its download stopped past that before its
 *   size was known;
 * - `missing`, `notFile` and `noCommit`, as the checks' readers answer;
 * - `unread`: main couldn't read it, and why.
 */
export type CodeAnswer =
  | { kind: 'file'; size: number | null; bytes: Uint8Array }
  | { kind: 'tooLarge' }
  | { kind: 'missing' }
  | { kind: 'notFile'; is: 'link' | 'folder' | 'submodule' }
  | { kind: 'noCommit' }
  | { kind: 'unread'; why: string };

/**
 * The code an overview names, as `code` replies: each file asked for, read; or none, since the
 * local copy isn't there yet, there's no git, or it couldn't be fetched, and why.
 */
export type CodeReply =
  | { kind: 'read'; files: CodeAnswer[] }
  | { kind: 'waiting' }
  | { kind: 'noGit' }
  | { kind: 'failed'; why: string };

/** A pull request's tab, by its id. */
const byId = z.strictObject({ id: tabId });

export const contract = defineContract('overview', {
  requests: {
    /** What main has of a pull request's tab's overview now, which `state` then keeps up to date. */
    current: { input: byId, reply: reply<OverviewState | undefined>() },
    /**
     * Files of the overview commit `commit`, the one on screen or the newer one, by their paths, in
     * the order asked: `artifact.md` and figures, read from what main keeps, else from GitHub. A
     * commit that's neither fails as `moved`.
     */
    files: {
      input: z.strictObject({
        id: tabId,
        commit: oid,
        paths: z.array(z.string().min(1).max(4096)).min(1).max(FILES_LIMIT),
      }),
      reply: reply<OverviewFile[]>(),
    },
    /**
     * The code an overview names at `commit`, the commit its header names, from the pull
     * request's local copy, read as the overview's checks read it: `files` in the order the
     * overview first names each, with whether it names its lines. In the order asked.
     */
    code: {
      input: z.strictObject({
        id: tabId,
        commit: oid,
        files: z
          .array(z.strictObject({ path: z.string().min(1).max(PATH_LIMIT), lines: z.boolean() }))
          .max(CODE_LIMIT),
      }),
      reply: reply<CodeReply>(),
    },
    /** Reads the overview again now, after a failure. */
    retry: { input: byId, reply: reply<void>() },
    /** Puts the newer overview on screen. */
    load: { input: byId, reply: reply<void>() },
  },
  topics: {
    /** A pull request's tab's overview, each time it changes. */
    state: overviewState,
  },
});
