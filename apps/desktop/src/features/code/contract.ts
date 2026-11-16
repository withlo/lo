// Code features: trust, the syntax index and language servers. Language servers run only on a
// repository, or a pull request from a fork, the reader trusts, and only main decides which: the
// window asks main to ask the reader in a dialog of main's own, and nothing the window sends trusts
// anything by itself. Main tells the window where each view of a pull request's tab stands, for the
// banner, the palette and Settings, how far its syntax index has got and where its language
// servers are, for the status bar, and lists the toolchains servers use for Settings. What code
// features ask goes over the code port (`port.ts`).

import { z } from 'zod';

import { defineContract, reply } from '../../ipc/contract.ts';
import { tabId } from '../tab/contract.ts';
import { nodeId, pullNumber } from './settings.ts';

/** A repository's name as a tab has it, `owner/name`, which main compares with the view's own. */
const named = z.string().min(3).max(140);

/**
 * Where a view's pull request's head is: in its repository itself, as far as Lo knows; in a fork,
 * named; or in a fork GitHub no longer has, which Lo learns only once it reads the repositories'
 * IDs, as it does for a repository the reader trusts.
 */
export const head = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('base') }),
  z.strictObject({ kind: z.literal('fork'), repo: named }),
  z.strictObject({ kind: z.literal('gone') }),
]);
export type Head = z.output<typeof head>;

/**
 * Whether language servers may run on a view, as main decided:
 *
 * - `noGit` when Lo has no git it can run: code features need it;
 * - `checking` until GitHub has said where the pull request's head is, or while Lo reads the
 *   repositories' IDs for an entry that names the repository or the pull request;
 * - `waiting` for the local copy, once an entry names it: nothing runs before the copy is ready,
 *   and the IDs are read then;
 * - `untrusted`: no entry names the repository or the pull request (`unnamed`), and nothing was
 *   read; or one does but isn't this one (`other`): a fork's pull request in a trusted repository,
 *   or a repository by that name that isn't the one trusted; or the IDs couldn't be read
 *   (`unread`, with why), which Lo tries again until they are;
 * - `trusted`, by the repository's entry or the pull request's.
 */
export const trust = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('noGit') }),
  z.strictObject({ kind: z.literal('checking') }),
  z.strictObject({ kind: z.literal('waiting') }),
  z.strictObject({
    kind: z.literal('untrusted'),
    why: z.enum(['unnamed', 'other', 'unread']),
    message: z.string().max(400).optional(),
  }),
  z.strictObject({ kind: z.literal('trusted'), by: z.enum(['repo', 'pull']) }),
]);
export type Trust = z.output<typeof trust>;

/**
 * How far main has got with trusting a view, once the reader asked: reading from GitHub which repo
 * it is (`reading`), asking in its own dialog (`asking`), then writing the entry (`saving`).
 */
export const trusting = z.enum(['reading', 'asking', 'saving']);
export type Trusting = z.output<typeof trusting>;

/**
 * Where a view of a pull request's tab stands, sent each time it changes: its repository and pull
 * request as the tab names them, where its head is (`null` until GitHub has said), its trust,
 * whether the reader dismissed the banner for its repository, and, while main is trusting it, how
 * far that has got.
 */
export const status = z.strictObject({
  view: tabId,
  repo: named,
  pull: pullNumber,
  head: head.nullable(),
  trust,
  dismissed: z.boolean(),
  trusting: trusting.optional(),
});
export type Status = z.output<typeof status>;

/**
 * Why a view's syntax index isn't whole: past a tree's files, past its downloads, offline, or a
 * tree with more files than git lists for Lo.
 */
export const partialWhy = z.enum(['files', 'bytes', 'offline', 'listing']);
export type PartialWhy = z.output<typeof partialWhy>;

/**
 * How far a view's syntax index has got, for the status bar:
 *
 * - `noGit` when Lo has no git it can run: the index reads the local copy;
 * - `waiting` for the local copy at the head on screen, or for what the tab compares;
 * - `building`, with the files read of those it reads, across both sides;
 * - `ready`, whole or `partial`: `indexed` of `total` files, and why;
 * - `failed`, with why, which Lo tries again by itself.
 */
export const indexState = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('noGit') }),
  z.strictObject({ kind: z.literal('waiting') }),
  z.strictObject({
    kind: z.literal('building'),
    done: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
  }),
  z.strictObject({
    kind: z.literal('ready'),
    partial: z
      .strictObject({
        indexed: z.number().int().nonnegative(),
        total: z.number().int().nonnegative(),
        why: z.array(partialWhy),
      })
      .nullable(),
  }),
  z.strictObject({ kind: z.literal('failed'), message: z.string().max(400) }),
]);
export type IndexState = z.output<typeof indexState>;

/** A view's syntax index, sent each time it changes. */
export const indexed = z.strictObject({ view: tabId, state: indexState });
export type Indexed = z.output<typeof indexed>;

/** An adapter's id, which names a language server to the window: `typescript`. */
const serverId = z.string().regex(/^[a-z][a-z0-9-]{0,39}$/);

/**
 * Where a view's language server is, for its item in the status bar:
 *
 * - `downloading`, in bytes, the first time it's needed, then `unpacking` what came, and
 *   `building` it, for a server Lo builds from its source;
 * - `waiting` in line for room, since Lo runs `count` at once at most: `next` when it's first;
 * - `starting`, also while its checkout is made or looked at, or while it moves to another head;
 * - `indexing` while it says it's loading the project, `percent` far when it says;
 * - `ready`, or `notAnswering` once it has missed several deadlines in a short while;
 * - `failed`: out of memory at `cap` bytes, a download that failed, or anything else, in a
 *   sentence; it waits for "Restart";
 * - `missing`: the toolchain it needs isn't installed; `plural` when `needs` names them, not it;
 * - `refused`: Lo won't run it on this checkout, as `why` says, in a sentence or two; it's looked
 *   at again once another head is on screen.
 */
export const serverState = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('downloading'),
    done: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
  }),
  z.strictObject({ kind: z.literal('unpacking') }),
  z.strictObject({ kind: z.literal('building') }),
  z.strictObject({
    kind: z.literal('waiting'),
    count: z.number().int().positive(),
    next: z.boolean(),
  }),
  z.strictObject({ kind: z.literal('starting') }),
  z.strictObject({
    kind: z.literal('indexing'),
    percent: z.number().int().min(0).max(100).optional(),
  }),
  z.strictObject({ kind: z.literal('ready') }),
  z.strictObject({ kind: z.literal('notAnswering') }),
  z.strictObject({
    kind: z.literal('failed'),
    why: z.discriminatedUnion('kind', [
      z.strictObject({ kind: z.literal('memory'), cap: z.number().int().positive() }),
      z.strictObject({ kind: z.literal('download'), message: z.string().max(400) }),
      z.strictObject({ kind: z.literal('error'), message: z.string().max(400) }),
    ]),
  }),
  z.strictObject({
    kind: z.literal('missing'),
    needs: z.string().max(200),
    install: z.string().max(200).optional(),
    plural: z.boolean().optional(),
  }),
  z.strictObject({ kind: z.literal('refused'), why: z.string().max(400) }),
]);
export type ServerState = z.output<typeof serverState>;

/**
 * A view's language servers, sent each time they change: `off` when servers don't run on it
 * because nothing trusts it, and otherwise one for each language its new side shows that a server
 * reads, by its adapter's `id`, with its `name` and what it is (`version`) where Lo knows.
 */
export const servers = z.strictObject({
  view: tabId,
  off: z.boolean(),
  servers: z.array(
    z.strictObject({
      id: serverId,
      name: z.string().max(40),
      version: z.string().max(80).optional(),
      state: serverState,
    }),
  ),
});
export type Servers = z.output<typeof servers>;

/** A toolchain's ID in `toolchains.json`: `go`. */
const toolchainId = z.string().regex(/^[a-z][a-z0-9-]{0,39}$/);

/**
 * A toolchain language servers use, as Settings lists it: one Lo downloads, with what it is, how
 * many bytes its files take by its marker (`null` while it isn't downloaded), how large its download
 * is, and the servers that use it, by name; or one of the system's, which Lo doesn't download, as
 * Swift's comes with Xcode, with where the copy Lo runs is from (`null` while there's none) and
 * what it needs then.
 */
export const toolchain = z.union([
  z.strictObject({
    id: toolchainId,
    name: z.string().max(40),
    version: z.string().max(80),
    installed: z.number().int().nonnegative().nullable(),
    download: z.number().int().positive(),
    uses: z.array(z.string().max(40)).max(32),
  }),
  z.strictObject({
    id: toolchainId,
    name: z.string().max(40),
    from: z.string().max(80).nullable(),
    needs: z.string().max(200),
    uses: z.array(z.string().max(40)).max(32),
  }),
]);
export type Toolchain = z.output<typeof toolchain>;

/** The toolchains Lo pins for this system, sent each time one is downloaded or removed. */
export const toolchains = z.array(toolchain).max(32);

/** A language server's log, oldest line first, as main keeps it: in memory, plain text. */
export interface ServerLog {
  name: string;
  lines: string[];
}

/** How asking to trust went: the reader said "Trust", or didn't. */
export type Asked = 'trusted' | 'cancelled';

export const contract = defineContract('code', {
  requests: {
    /** Where view `view` stands now, or nothing for no such view. The `status` topic follows it. */
    state: { input: z.strictObject({ view: tabId }), reply: reply<Status | null>() },
    /**
     * Asks main to ask the reader, in a dialog of its own, whether to trust the repository view
     * `view`'s pull request is in, named `repo` as the window shows it, or with `pull`, that pull
     * request alone, from its fork. Main reads from GitHub what the pull request joins first, and
     * trusts what its dialog named only once the reader says "Trust" there. The view's `status`
     * says how far it has got meanwhile. It refuses a view that isn't open (`missing`), a `repo`
     * or `pull` that isn't the view's (`invalid`), a pull request whose head isn't in a fork GitHub
     * has (`refused`), and a request while it's asking already: about the same view (`busy`), or
     * about another, which it names, bringing its dialog forward (`asking`). Once the reader said
     * "Trust", it fails, saying why and what to do, when what the settings file holds keeps Lo from
     * writing the entry, which editing the file fixes (`settingsFile`), or when the file couldn't
     * be written otherwise (`unsaved`).
     */
    trust: {
      input: z.strictObject({ view: tabId, repo: named, pull: pullNumber.nullable() }),
      reply: reply<Asked>(),
    },
    /**
     * Stops trusting what trusts view `view`, as "Stop trusting this repo" asks; or, from
     * Settings, the repository with node ID `id`, or with `pull`, that pull request. Its language
     * servers stop and its checkouts go.
     */
    untrust: {
      input: z.union([
        z.strictObject({ view: tabId }),
        z.strictObject({ id: nodeId, pull: pullNumber.nullable() }),
      ]),
      reply: reply<void>(),
    },
    /** Dismisses the banner for view `view`'s repository: no tab of it shows it again. */
    dismiss: { input: z.strictObject({ view: tabId }), reply: reply<void>() },
    /** How far view `view`'s syntax index has got, or nothing for no such view. The `indexed` topic follows it. */
    index: { input: z.strictObject({ view: tabId }), reply: reply<IndexState | null>() },
    /** View `view`'s language servers, or nothing for no such view. The `served` topic follows it. */
    servers: { input: z.strictObject({ view: tabId }), reply: reply<Servers | null>() },
    /**
     * Starts view `view`'s language server `server` again, at the view's head, as "Restart" asks:
     * one that failed to download downloads again. Refused for a view nothing trusts (`refused`).
     */
    restart: {
      input: z.strictObject({ view: tabId, server: serverId }),
      reply: reply<void>(),
    },
    /** View `view`'s language server `server`'s log, or nothing when it has none. */
    log: {
      input: z.strictObject({ view: tabId, server: serverId }),
      reply: reply<ServerLog | null>(),
    },
    /** The toolchains Lo pins for this system, for Settings. The `downloaded` topic follows them. */
    toolchains: { input: z.undefined(), reply: reply<Toolchain[]>() },
    /**
     * Removes toolchain `id`, as Settings' "Remove" asks: the servers that use it stop, each saying
     * so until "Restart" downloads it again, and its files go.
     */
    removeToolchain: { input: z.strictObject({ id: toolchainId }), reply: reply<void>() },
  },
  topics: {
    /** Where a view stands, each time that changes. */
    status,
    /** How far a view's syntax index has got, each time that changes. */
    indexed,
    /** A view's language servers, each time they change. */
    served: servers,
    /** The toolchains, each time one is downloaded or removed. */
    downloaded: toolchains,
  },
});
