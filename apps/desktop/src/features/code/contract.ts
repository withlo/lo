// Code features: trust first. Language servers run only on a repository, or a pull request from a
// fork, the reader trusts, and only main decides which: the window asks main to ask the reader in
// a dialog of main's own, and nothing the window sends trusts anything by itself. Main tells the
// window where each view of a pull request's tab stands, for the banner, the palette and Settings.

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
 * Where a view of a pull request's tab stands, sent each time it changes: its repository and pull
 * request as the tab names them, where its head is (`null` until GitHub has said), its trust, and
 * whether the reader dismissed the banner for its repository.
 */
export const status = z.strictObject({
  view: tabId,
  repo: named,
  pull: pullNumber,
  head: head.nullable(),
  trust,
  dismissed: z.boolean(),
});
export type Status = z.output<typeof status>;

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
     * trusts what its dialog named only once the reader says "Trust" there. It refuses a view
     * that isn't open (`missing`), a `repo` or `pull` that isn't the view's (`invalid`), a pull
     * request whose head isn't in a fork GitHub has (`refused`), and a request while another is
     * asking (`busy`).
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
  },
  topics: {
    /** Where a view stands, each time that changes. */
    status,
  },
});
