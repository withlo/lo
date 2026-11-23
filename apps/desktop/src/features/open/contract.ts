// Opening pull requests: by a link typed or pasted in the open box, from the Recent list, or from
// another app. Main reads each link, works out which account opens it, and opens it in a tab; a
// link Lo doesn't show goes to the browser. It also installs the `lo` command, which hands a link
// from a terminal to Lo.

import { z } from 'zod';

import { cause } from '../../ipc/cause.ts';
import { defineContract, reply } from '../../ipc/contract.ts';
import { login } from '../accounts/contract.ts';
import { helpLink, pullState } from '../tab/contract.ts';

/** The longest text the window hands main to read as a link. */
export const TEXT_LIMIT = 2048;

/** Text typed or pasted as a link, read by main. */
export const linkText = z.string().max(TEXT_LIMIT);

/** A pull request, as a link to it names it. */
const pullRequest = {
  owner: z.string().min(1).max(39),
  repo: z.string().min(1).max(100),
  number: z.number().int().min(1),
};

/**
 * Whom a pull request opens as: the account that can see its repository, nobody for a public
 * repository no account can see (read only), or the person's choice among the accounts that can,
 * which Lo remembers for every repository of the owner, or for this one alone when the owner's
 * repositories open with another account, which can't see this one.
 */
export const opener = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('account'), login }),
  z.strictObject({ kind: z.literal('anonymous') }),
  z.strictObject({
    kind: z.literal('ask'),
    logins: z.array(login).min(2),
    remember: z.enum(['owner', 'repo']),
  }),
]);
export type Opener = z.output<typeof opener>;

/**
 * Why text isn't a pull request link Lo opens: it isn't a link to one, it's a `lo://` link to
 * something else, or it's too long to be one.
 */
export const notPull = z.enum(['link', 'loLink', 'long']);
export type NotPull = z.output<typeof notPull>;

/**
 * Why a link opened nothing: there was none; it isn't a pull request link Lo opens; it's a web link
 * over plain `http`, which the window's links never hand to the browser; or the browser would send
 * it straight back, since Lo is the default browser (`defaultBrowser`) or it just did (`cameBack`).
 */
export const refusal = z.enum([
  ...notPull.options,
  'empty',
  'insecure',
  'defaultBrowser',
  'cameBack',
]);
export type Refusal = z.output<typeof refusal>;

/** Why GitHub didn't say whether an account can see a pull request, as every error says it. */
export { cause, type Cause } from '../../ipc/cause.ts';

/**
 * Why the open box can't open a pull request:
 *
 * - `unchecked`, GitHub couldn't be asked which account can see it, for a `cause`; opening it
 *   anyway asks again from its tab;
 * - `missing`, the account that can see its repository finds no such pull request;
 * - `hidden`, no account can see it, as when it doesn't exist or it's private, with whether any
 *   account is `signedIn`;
 * - `refused`, the accounts that might see it couldn't check it, for a `cause`, with GitHub's
 *   `links` to fix that, and whether opening it anyway may work once GitHub answers;
 * - `unknown`, none of these.
 */
export const blocked = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('unchecked'), cause }),
  z.strictObject({ kind: z.literal('missing') }),
  z.strictObject({ kind: z.literal('hidden'), signedIn: z.boolean() }),
  z.strictObject({
    kind: z.literal('refused'),
    cause,
    links: z.array(helpLink),
    openAnyway: z.boolean(),
  }),
  z.strictObject({ kind: z.literal('unknown') }),
]);
export type Blocked = z.output<typeof blocked>;

/** What a page of GitHub's that isn't a pull request is, where its link says. */
export const githubPage = z.enum([
  'issue',
  'commit',
  'pulls',
  'folder',
  'file',
  'discussion',
  'workflow',
]);
export type GithubPage = z.output<typeof githubPage>;

/**
 * What the open box shows for what's in it:
 *
 * - `empty`, nothing yet;
 * - `pull`, a pull request it opens, as whom, with its title and state once GitHub has said;
 * - `blocked`, a pull request it can't open, with why, and what GitHub said, as it came;
 * - `web`, a link Lo doesn't show: one of GitHub's pages, named where its link says what it is, or
 *   a page elsewhere. It goes to the browser when it's `secure`, over `https`, and is only copied
 *   when it isn't;
 * - `invalid`, text that isn't a pull request link Lo opens.
 *
 * Main says what each is, never in words: the window writes them.
 */
export const preview = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('empty') }),
  z.strictObject({
    kind: z.literal('pull'),
    ...pullRequest,
    as: opener,
    title: z.string().nullable(),
    state: pullState.nullable(),
  }),
  z.strictObject({
    kind: z.literal('blocked'),
    ...pullRequest,
    why: blocked,
    details: z.string().optional(),
  }),
  z.strictObject({
    kind: z.literal('web'),
    url: z.string(),
    github: z.boolean(),
    page: githubPage.nullable(),
    secure: z.boolean(),
  }),
  z.strictObject({ kind: z.literal('invalid'), why: notPull }),
]);
export type Preview = z.output<typeof preview>;

/**
 * What opening a link did: opened a pull request in a tab, which it shows, and how its account
 * was chosen; handed a link Lo doesn't show to the browser; or nothing, and why.
 */
export const opened = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('tab'),
    id: z.string(),
    /**
     * How the account was chosen: the one that can see the repository (`account`), several can and
     * the tab asks (`ask`), the one remembered for it can't check it just now, as the tab says
     * (`unavailable`), or none can, so it opens without signing in (`none`).
     */
    choice: z.enum(['account', 'ask', 'unavailable', 'none']),
  }),
  z.strictObject({ kind: z.literal('browser') }),
  z.strictObject({ kind: z.literal('refused'), why: refusal }),
]);
export type Opened = z.output<typeof opened>;

/** A pull request opened lately, for the Recent list. */
export const recentPull = z.strictObject({
  ...pullRequest,
  /** Its title, when Lo had it. */
  title: z.string().nullable(),
  /** The account it was opened with. */
  login,
  /** When it was last opened, in milliseconds since the Unix epoch. */
  openedAt: z.number(),
});
export type RecentPull = z.output<typeof recentPull>;

/**
 * Where the `lo` command is: each copy Lo wrote that's on this computer, and whether it's this
 * Lo's, which a newer or moved Lo writes again; and first, on Linux, the one Lo's package installed,
 * while it leads to this Lo.
 */
export const commandState = z.strictObject({
  installed: z.array(z.strictObject({ path: z.string(), current: z.boolean() })),
});
export type CommandState = z.output<typeof commandState>;

/**
 * How installing the `lo` command went: installed at `path`, which the shell may not search
 * (`onPath`); not, because a `lo` Lo didn't write is there; or not, because the `lo` there can't be
 * read to tell whose it is (`unreadable`) or the new one can't be written (`unwritable`), with the
 * path and the system's words for Details.
 */
export const installed = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('installed'), path: z.string(), onPath: z.boolean() }),
  z.strictObject({ kind: z.literal('taken'), path: z.string() }),
  z.strictObject({
    kind: z.literal('failed'),
    why: z.enum(['unreadable', 'unwritable']),
    details: z.string().optional(),
  }),
]);
export type Installed = z.output<typeof installed>;

export const contract = defineContract('open', {
  requests: {
    /** What the open box shows for `text`. Nothing opens. */
    look: { input: z.strictObject({ text: linkText }), reply: reply<Preview>() },
    /**
     * Opens `text`: a pull request in a tab, as `login` when that account can see it and as the
     * account Lo chooses otherwise; any other `https` link in the browser.
     */
    open: {
      input: z.strictObject({ text: linkText, login: login.optional() }),
      reply: reply<Opened>(),
    },
    /**
     * The link to a pull request on the clipboard, written as Lo writes one, or nothing. Nothing
     * else on the clipboard ever reaches the window.
     */
    clipboard: { input: z.undefined(), reply: reply<string | null>() },
    /** The pull requests opened lately, newest first. */
    recent: { input: z.undefined(), reply: reply<RecentPull[]>() },
    /** Where the `lo` command is. */
    command: { input: z.undefined(), reply: reply<CommandState>() },
    /**
     * Installs the `lo` command: on macOS in `/usr/local/bin` once the system's prompt for an
     * administrator allows it, or in `~/.local/bin` when it doesn't; on Linux in `~/.local/bin`,
     * unless Lo's package installed `/usr/bin/lo` and it leads to Lo, which is the command then.
     */
    installCommand: { input: z.undefined(), reply: reply<Installed>() },
  },
  topics: {
    /** A link from another app that Lo couldn't open, and why, for a notice. */
    refused: z.strictObject({ why: refusal }),
  },
});
