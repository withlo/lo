// A pull request's overview, as main has it for the window: the commit `refs/lo/pr/<n>` holds,
// read from GitHub's REST API, with who wrote it and when, what it holds, and its files, which
// main keeps by their IDs. Main watches the ref while the pull request's tab is on screen, and a
// newer commit is offered, never put in place of the one on screen. With it, the repository's
// definitions: what `refs/lo/terms` holds in the pull request's base repository, and the bytes of
// its `terms.json`, which the window reads in the background process.

import { z } from 'zod';

import { cause } from '../../ipc/cause.ts';
import { defineContract, reply } from '../../ipc/contract.ts';
import { login } from '../accounts/contract.ts';
import { helpLink, oid, tabId } from '../tab/contract.ts';

/** A moment, in milliseconds since the Unix epoch. */
const time = z.number().int().nonnegative();

/**
 * How many of the figures an overview's text names first come with the text as its tab opens:
 * main reads them in the turn that reads the text, and the window draws each as it comes, before
 * it asks for the rest, so a first screen's figures are in its first frame. A figure is drawn up to
 * 960 px tall, so a first screen rarely shows more.
 */
export const FIRST_FIGURES = 2;

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
 * Where an overview's commit came from: the pull request's own repository (`base`), the fork its
 * head is in (`fork`), or the copy the base repository keeps of the fork's (`kept`), on
 * `refs/lo/kept/pr/<n>`, which Lo reads when neither has one.
 */
export const overviewSource = z.enum(['base', 'fork', 'kept']);
export type OverviewSource = z.output<typeof overviewSource>;

/**
 * An overview's commit, as main read it: its ID, where it came from, and which repository that
 * is; its byline, `null` until main has read it, which it does after the rest, since nothing the
 * overview shows waits for it; its files and folders, as GitHub listed them; and whether
 * `artifact.md` was read, which `files` then gives at once.
 *
 * Past the most files and folders an overview may hold, only one more than that are listed, with
 * `artifact.md` wherever it is, which is all the overview's checks look at. `artifact.md` isn't
 * read when the listing already says the overview is too large, or holds no `artifact.md` as a
 * file: GitHub listed the commit only in part (`truncated`), or it's past its limits.
 */
export const overviewCommit = z.strictObject({
  id: oid,
  source: overviewSource,
  repository,
  byline: byline.nullable(),
  entries: z.array(entry),
  truncated: z.boolean(),
  read: z.boolean(),
});
export type OverviewCommit = z.output<typeof overviewCommit>;

/**
 * Why main couldn't read the overview just now, worst first, each with when it tries again: the
 * account is signed out; the rate limit is used up, or GitHub asked Lo to slow down; an
 * organization, `org`, blocks the account until it's authorized for single sign-on (`sso`) or
 * until the organization approves Lo (`approval`), with GitHub's links to fix that; GitHub gave no
 * answer, for `cause`, such as no connection or no answer in time; or anything else GitHub
 * answered, or sent, such as a file that isn't the one its ID names. A `message` is what GitHub or
 * the system said, as it said it, for Details.
 */
export const problem = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('signedOut'), login, retryAt: time }),
  z.strictObject({ kind: z.literal('rateLimited'), secondary: z.boolean(), retryAt: time }),
  z.strictObject({
    kind: z.literal('blocked'),
    why: z.enum(['sso', 'approval']),
    org: repository.shape.owner,
    message: z.string(),
    links: z.array(helpLink),
    retryAt: time,
  }),
  z.strictObject({ kind: z.literal('offline'), cause, message: z.string(), retryAt: time }),
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
 *   its fork, else in the base repository's copy of the fork's: `unknown` until it has, `none`, a
 *   `commit`, or `notCommit`, something other than a commit, which is no overview;
 * - `overview`: the overview on screen: the first commit main had for the tab, from what it kept
 *   or from GitHub, until the newer one is loaded. It stays when the ref later holds nothing, and
 *   main keeps it: with `found` then `none` or `notCommit`, it's a saved copy, shown once GitHub
 *   has none;
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

/**
 * The most bytes of `terms.json` main reads: `@lo/artifact`'s `STORE_READ`, its limit and a
 * byte-order mark. A larger one is past the store's limits, and isn't read.
 */
export const STORE_BYTES = 2 * 1024 * 1024 + 3;

/**
 * What `refs/lo/terms`, the repository's definitions, held when main last read it in the pull
 * request's base repository:
 *
 * - `unknown`: main hasn't read it yet, and kept nothing from an earlier read;
 * - `none`: the repository has none: the ref isn't there;
 * - `file`: its commit, `commit`, holds `terms.json` as a file of `size` bytes whose ID is `id`,
 *   which main has read and kept, and `storeFile` gives;
 * - `unreadable`: it holds nothing Lo reads as the store: the ref holds `object`, something other
 *   than a commit (`notCommit`), or a commit that holds no `terms.json` (`missing`), something
 *   other than a file there (`notFile`), or one larger than {@link STORE_BYTES} (`tooLarge`, with
 *   its size), which main doesn't read.
 */
export const storeFound = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('unknown') }),
  z.strictObject({ kind: z.literal('none') }),
  z.strictObject({
    kind: z.literal('file'),
    commit: oid,
    id: oid,
    size: z.number().int().nonnegative().max(STORE_BYTES),
  }),
  z.strictObject({
    kind: z.literal('unreadable'),
    object: oid,
    why: z.enum(['notCommit', 'missing', 'notFile', 'tooLarge']),
    size: z.number().int().nonnegative().nullable(),
  }),
]);
export type StoreFound = z.output<typeof storeFound>;

/**
 * A pull request's tab's repository's definitions, sent each time they change:
 *
 * - `repository`: whose they are: the pull request's base repository, a fork's pull request's
 *   included;
 * - `found`: what `refs/lo/terms` held when main last read it;
 * - `saved`: whether that's what main kept from an earlier read, and GitHub hasn't said since;
 * - `checkedAt`: when GitHub last said what the ref holds, or null if it hasn't since Lo started;
 * - `problem`: why the last read failed, until one succeeds.
 *
 * Main reads them with the overview, while it has one to show, as the tab's account, in a turn
 * after the overview's read: every 5 minutes while the tab is on screen, and as it's shown if they
 * weren't read in the last 30 s.
 */
export const storeState = z.strictObject({
  id: tabId,
  repository,
  found: storeFound,
  saved: z.boolean(),
  checkedAt: time.nullable(),
  problem: problem.nullable(),
});
export type StoreState = z.output<typeof storeState>;

/** The most files one `files` asks for: `artifact.md` and every figure an overview may show. */
export const FILES_LIMIT = 101;

/**
 * A file of an overview's commit, as `files` replies: its size and bytes, which are none for one
 * larger than `@lo/artifact`'s `SIZE_ONLY`, as a reader may answer it; `missing`, when nothing is
 * at the path; `notFile`, when what's there is a link, a folder or a submodule; `refused`, when
 * the path is one no overview reads, so main never reads it; or `unread`, when main couldn't read
 * it just now, with what GitHub or the system said in `why`, for Details: empty when it said
 * nothing.
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
 * Why Lo couldn't read a file of the code an overview names, which the window words. Main says
 * the cause, never a sentence, and what went wrong beyond it goes to main's log:
 *
 * - `noGit`: there's no git;
 * - `notFetched`: the pull request's local copy couldn't be fetched;
 * - `notReady`: the local copy isn't there yet, or isn't open;
 * - `noCommit`: the local copy doesn't have the overview's commit, and can't get it;
 * - `noFile`: there's no file at that path at the overview's commit;
 * - `notFile`: what's at that path isn't a file Lo reads;
 * - `binary`: it isn't text;
 * - `tooLarge`: it's larger than the most Lo reads of a file;
 * - `offline`: the local copy is offline, and doesn't have it;
 * - `spent`: Lo read as much of the overview's code as it reads for one;
 * - `notDownloaded`: Lo couldn't download it;
 * - `unknown`: anything else, such as a read that failed or was stopped.
 */
export type CodeCause =
  | 'noGit'
  | 'notFetched'
  | 'notReady'
  | 'noCommit'
  | 'noFile'
  | 'notFile'
  | 'binary'
  | 'tooLarge'
  | 'offline'
  | 'spent'
  | 'notDownloaded'
  | 'unknown';

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
  | { kind: 'unread'; why: CodeCause };

/**
 * The code an overview names, as `code` replies: each file asked for, read; or none, since the
 * local copy isn't there yet, there's no git, or it couldn't be fetched, and why.
 */
export type CodeReply =
  | { kind: 'read'; files: CodeAnswer[] }
  | { kind: 'waiting' }
  | { kind: 'noGit' }
  | { kind: 'failed'; why: CodeCause };

/**
 * How a file a block shows was where the overview's commit branched off the base branch, which is
 * where the pull request's diff of it starts, as GitHub diffs a pull request:
 *
 * - `same`: as it is at the commit, since the pull request doesn't change it;
 * - `added`: not there, since the pull request adds it;
 * - `changed`: its text there, at `path`, which is another when the pull request renames it;
 * - `unknown`: Lo couldn't read it, for a {@link CodeCause}, or `unrelated` when the commit shares
 *   no history with the base branch.
 */
export type BaseText =
  | { kind: 'same' }
  | { kind: 'added' }
  | { kind: 'changed'; path: string; text: string }
  | { kind: 'unknown'; why: CodeCause | 'unrelated' };

/**
 * A file a block of an overview shows, as `texts` replies: its text at the overview's commit, with
 * where its diff starts when that was asked for; or why Lo couldn't read it now.
 */
export type BlockText =
  { kind: 'text'; text: string; base: BaseText | null } | { kind: 'unread'; why: CodeCause };

/**
 * What changed in a pull request since the commit its overview describes, up to the head on
 * screen, as `since` replies: how many files the pushes since changed, as comparing the two
 * revisions lists them, across a rebase, or `null` when Lo couldn't compare them; or none yet,
 * since the local copy isn't there or lacks either commit (`waiting`), there's no git, or it
 * couldn't be fetched, and why.
 */
export type SinceReply =
  | { kind: 'read'; files: number | null }
  | { kind: 'waiting' }
  | { kind: 'noGit' }
  | { kind: 'failed'; why: CodeCause };

/**
 * A file at an overview's commit, as it is at the head on screen, as `sinceFile` replies:
 *
 * - `same`: the same file, at `path`, which is another when it was renamed since;
 * - `changed`: changed, at `path`, with its text at each commit for the window to diff, or why its
 *   lines can't be compared, such as one side not being text. `pushed` says whether the pushes
 *   since changed it, as comparing the revisions lists it, rather than only the base branch they
 *   were rebased onto; it's true when Lo couldn't compare them;
 * - `deleted`: there's no file at its path, or the one it was renamed to, at the head;
 * - `waiting`: the local copy isn't there yet, or lacks either commit;
 * - `unread`: Lo couldn't tell, and why.
 */
export type FileSinceText =
  | { kind: 'same'; path: string }
  | {
      kind: 'changed';
      path: string;
      pushed: boolean;
      texts: { old: string; new: string } | { why: CodeCause };
    }
  | { kind: 'deleted' }
  | { kind: 'waiting' }
  | { kind: 'unread'; why: CodeCause };

/** A coding agent that Lo installs the overview skill for. */
export const agent = z.enum(['claude', 'codex']);
export type Agent = z.output<typeof agent>;

/**
 * Why the skill wasn't installed, as the installer found: no agent is set up (`nothingSetUp`); a
 * link (`link`), or something that isn't a folder or file (`notFolder`, `notFile`), is where the
 * skill goes at `path`; the skill's folder at `path` holds another skill, `name` if it says one
 * (`otherSkill`), or files that aren't the skill's (`otherFiles`); or the file system refused
 * something in the skills folder `skills`, at `path` when it says where, with its error `code`,
 * such as `EACCES`, and `detail`, in its own words (`failed`). Paths are written for a person, with
 * `~` for the home folder.
 */
export const skillRefusal = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('nothingSetUp') }),
  z.strictObject({ kind: z.literal('link'), path: z.string() }),
  z.strictObject({ kind: z.literal('notFolder'), path: z.string() }),
  z.strictObject({ kind: z.literal('notFile'), path: z.string() }),
  z.strictObject({ kind: z.literal('otherSkill'), path: z.string(), name: z.string().nullable() }),
  z.strictObject({ kind: z.literal('otherFiles'), path: z.string() }),
  z.strictObject({
    kind: z.literal('failed'),
    skills: z.string(),
    path: z.string().nullable(),
    code: z.string().nullable(),
    detail: z.string(),
  }),
]);
export type SkillRefusal = z.output<typeof skillRefusal>;

/**
 * One agent and the overview skill on this computer, as main finds them:
 *
 * - `name`: the agent's name, as its users know it;
 * - `setUp`: whether the agent is set up here, which is whether its own folder, `config`, exists;
 * - `installed`: whether its skills folder, `skills`, holds the skill;
 * - `config`, `skills`: those folders as a person writes them, `~` for the home folder;
 * - `blocked`: why installing the skill for the agent would be refused now, if it would be.
 *
 * A Lo opened from the Dock doesn't see the variables a shell sets, such as `CLAUDE_CONFIG_DIR`, so
 * the folders are what it looked in, not what the agent uses.
 */
export const skillAgent = z.strictObject({
  agent,
  name: z.string(),
  setUp: z.boolean(),
  installed: z.boolean(),
  config: z.string(),
  skills: z.string(),
  blocked: skillRefusal.nullable(),
});
export type SkillAgent = z.output<typeof skillAgent>;

/** The overview skill for each agent, in the order they're installed for. */
export const skillState = z.strictObject({ agents: z.array(skillAgent) });
export type SkillState = z.output<typeof skillState>;

/**
 * What installing the skill did for one agent: installed, or refused, and why. A refusal for no
 * agent in particular (`null`) is that none is set up.
 */
export type SkillResult =
  { kind: 'installed'; agent: Agent } | { kind: 'refused'; agent: Agent | null; why: SkillRefusal };

/** A pull request's tab, by its id. */
const byId = z.strictObject({ id: tabId });

/** A pull request's tab's overview, by the tab's id: its stack's with `stack`, else its own. */
const bySubject = z.strictObject({ id: tabId, stack: z.boolean().optional() });

/** The most a stack's id may be: GitHub's numbers for pull requests and stacks fit in 31 bits. */
export const STACK_LIMIT = 2 ** 31 - 1;

export const contract = defineContract('overview', {
  requests: {
    /** What main has of a pull request's tab's overview now, which `state` then keeps up to date. */
    current: { input: byId, reply: reply<OverviewState | undefined>() },
    /**
     * Files of the overview commit `commit`, the one on screen or the newer one, of the pull
     * request's or its stack's, by their paths, in the order asked: `artifact.md` and figures, read
     * from what main keeps, else from GitHub. A commit that's none of them fails as `moved`.
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
    /**
     * The text of the file at `path` at `commit`, the commit the overview's header names, from the
     * pull request's local copy, for a block to show it; and with `base`, the file where the
     * commit branched off the base branch, for its diff. Each is read whole, up to the most of a
     * file the overview's checks read.
     */
    texts: {
      input: z.strictObject({
        id: tabId,
        commit: oid,
        path: z.string().min(1).max(PATH_LIMIT),
        base: z.boolean(),
      }),
      reply: reply<BlockText>(),
    },
    /**
     * How many files the pushes since `commit`, the commit the overview's header names, changed,
     * up to `head`, the head on screen, from the pull request's local copy: worked out once for
     * the two, across a rebase, as the revisions feature compares two revisions.
     */
    since: {
      input: z.strictObject({ id: tabId, commit: oid, head: oid }),
      reply: reply<SinceReply>(),
    },
    /**
     * Where the file at `path` at `commit`, the commit the overview's header names, is at `head`,
     * the head on screen, renames found as comparing the two lists them; and when it changed, its
     * text at each, for the window to diff. Each is read whole, up to the most of a file the
     * overview's checks read, and must be text.
     */
    sinceFile: {
      input: z.strictObject({
        id: tabId,
        commit: oid,
        head: oid,
        path: z.string().min(1).max(PATH_LIMIT),
      }),
      reply: reply<FileSinceText>(),
    },
    /**
     * Reads the overview again now, after a failure or where it's read once, the stack's with
     * `stack`: answered once that read is done, however it went.
     */
    retry: { input: bySubject, reply: reply<void>() },
    /** Puts the newer overview on screen, the stack's with `stack`. */
    load: { input: bySubject, reply: reply<void>() },
    /**
     * Follows the overview of stack `stack`, the stack the pull request is a layer of, beside the
     * pull request's own: `refs/lo/stack/<stack>`, read as the pull request's is, in its base
     * repository, then its fork, then the base repository's copy of the fork's, and kept. `null`
     * stops. `stackState` then says what it is, and `files`, `retry` and `load` take it.
     */
    followStack: {
      input: z.strictObject({
        id: tabId,
        stack: z.number().int().positive().max(STACK_LIMIT).nullable(),
      }),
      reply: reply<void>(),
    },
    /** What main has of the overview of the stack a tab follows now, which `stackState` keeps. */
    currentStack: { input: byId, reply: reply<OverviewState | undefined>() },
    /**
     * What main has of a pull request's tab's repository's definitions now, which `store` then
     * keeps up to date.
     */
    currentStore: { input: byId, reply: reply<StoreState | undefined>() },
    /**
     * The bytes of `terms.json`, the file `file` names, as main kept it as the tab's repository's
     * definitions now. A file that isn't that one fails as `moved`.
     */
    storeFile: {
      input: z.strictObject({ id: tabId, file: oid }),
      reply: reply<Uint8Array>(),
    },
    /**
     * Reads the tab's repository's definitions again now, after a failure: answered once that read
     * is done, however it went.
     */
    retryStore: { input: byId, reply: reply<void>() },
    /**
     * Where the overview skill goes, for each coding agent, and whether it's there now, which the
     * `skill` topic then keeps up to date.
     */
    currentSkill: { input: z.undefined(), reply: reply<SkillState>() },
    /**
     * Installs the overview skill for `agents`, each on its own, so one that's refused leaves the
     * others installed; with none named, for each that's set up. Nothing is written through a link
     * or over another skill. `skill` follows with where things stand.
     */
    installSkill: {
      input: z.strictObject({ agents: z.array(agent).max(2) }),
      reply: reply<SkillResult[]>(),
    },
  },
  topics: {
    /** A pull request's tab's overview, each time it changes. */
    state: overviewState,
    /** The overview of the stack a pull request's tab follows, each time it changes. */
    stackState: overviewState,
    /** A pull request's tab's repository's definitions, each time what main has of them changes. */
    store: storeState,
    /** Where the overview skill is, each time installing it changes that. */
    skill: skillState,
  },
});
