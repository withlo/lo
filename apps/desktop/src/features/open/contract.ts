// Opening pull requests: by a link typed or pasted in the open box, from the Recent list, or from
// another app. Main reads each link, works out which account opens it, and opens it in a tab; a
// link Lo doesn't show goes to the browser. It also installs the `lo` command, which hands a link
// from a terminal to Lo.

import { z } from 'zod';

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
 * repository no account can see (read only), or the person's choice among the accounts that can.
 */
export const opener = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('account'), login }),
  z.strictObject({ kind: z.literal('anonymous') }),
  z.strictObject({ kind: z.literal('ask'), logins: z.array(login).min(2) }),
]);
export type Opener = z.output<typeof opener>;

/**
 * What the open box shows for what's in it:
 *
 * - `empty`, nothing yet;
 * - `pull`, a pull request it opens, as whom, with its title and state once GitHub has said;
 * - `blocked`, a pull request none of the accounts can open, with why: GitHub's links to fix it,
 *   whether signing in with an account might, and whether opening it anyway may work once GitHub
 *   answers, as when it couldn't be reached;
 * - `web`, a link Lo doesn't show, which goes to the browser;
 * - `invalid`, text that isn't a link Lo can do anything with.
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
    title: z.string(),
    message: z.string(),
    links: z.array(helpLink),
    signIn: z.boolean(),
    openAnyway: z.boolean(),
  }),
  z.strictObject({
    kind: z.literal('web'),
    url: z.string(),
    title: z.string(),
    message: z.string(),
  }),
  z.strictObject({ kind: z.literal('invalid'), message: z.string() }),
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
  z.strictObject({ kind: z.literal('refused'), message: z.string() }),
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
 * Lo's, which a newer or moved Lo writes again.
 */
export const commandState = z.strictObject({
  installed: z.array(z.strictObject({ path: z.string(), current: z.boolean() })),
});
export type CommandState = z.output<typeof commandState>;

/**
 * How installing the `lo` command went: installed at `path`, which the shell may not search
 * (`onPath`); not, because a `lo` Lo didn't write is there; or not, and why.
 */
export const installed = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('installed'), path: z.string(), onPath: z.boolean() }),
  z.strictObject({ kind: z.literal('taken'), path: z.string() }),
  z.strictObject({ kind: z.literal('failed'), message: z.string() }),
]);
export type Installed = z.output<typeof installed>;

export const contract = defineContract('open', {
  requests: {
    /** What the open box shows for `text`. Nothing opens. */
    look: { input: z.strictObject({ text: linkText }), reply: reply<Preview>() },
    /**
     * Opens `text`: a pull request in a tab, as `login` when that account can see it and as the
     * account Lo chooses otherwise; any other web link in the browser.
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
     * administrator allows it, or in `~/.local/bin` when it doesn't; on Linux in `~/.local/bin`.
     */
    installCommand: { input: z.undefined(), reply: reply<Installed>() },
  },
  topics: {
    /** A link from another app that Lo couldn't open, and why, for a notice. */
    refused: z.strictObject({ message: z.string() }),
  },
});
