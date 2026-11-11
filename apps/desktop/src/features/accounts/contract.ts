import { z } from 'zod';

import { defineContract, reply } from '../../ipc/contract.ts';

/** A GitHub login: letters, digits and hyphens, at most 39. */
export const login = z.string().regex(/^[A-Za-z0-9-]{1,39}$/);

/** A repository's owner, as GitHub names them. */
export const owner = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);

/** A repository's name, without its owner. */
export const repoName = z
  .string()
  .regex(/^[A-Za-z0-9_.-]{1,100}$/)
  .refine((name) => name !== '.' && name !== '..');

/** Why an account is signed out: GitHub refused its token, or its token isn't kept any more. */
export const signedOut = z.enum(['refused', 'tokenMissing']);

/**
 * An account as the window sees it: its login and name, how it signed in, whether and why it's
 * signed out, whether the keychain keeps refusing its renewed token, and whether its token can't be
 * read or kept for want of a keychain, as on Linux with no keyring. Never its token.
 */
export const accountSummary = z.strictObject({
  login,
  name: z.string().nullable(),
  source: z.enum(['deviceFlow', 'gh']),
  signedOut: signedOut.nullable(),
  cantSave: z.boolean(),
  needsKeyring: z.boolean(),
});
export type AccountSummary = z.output<typeof accountSummary>;

/** What happened to an account, for a notice. */
export const accountEvent = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('signedOut'), login, why: signedOut }),
  z.strictObject({ kind: z.literal('removed'), login }),
  z.strictObject({ kind: z.literal('cantSave'), login }),
  z.strictObject({ kind: z.literal('cantSaveOver'), login }),
]);
export type AccountEvent = z.output<typeof accountEvent>;

/** Which sign-in a message is about: each new one is numbered after the last. */
export const signInId = z.number().int().positive();

/**
 * Why a sign-in ended without an account: Lo has no keychain to keep a token in (`noKeyring`), the
 * code expired, the person cancelled on GitHub, GitHub refused, the token lacks Lo's scopes, GitHub
 * couldn't be reached, or Lo couldn't keep the account.
 */
export const signInFailure = z.enum([
  'noKeyring',
  'expired',
  'denied',
  'refused',
  'missingScopes',
  'offline',
  'failed',
]);
export type SignInFailure = z.output<typeof signInFailure>;

/**
 * How a sign-in through GitHub's device flow is going: waiting for the code to be entered on
 * GitHub's page, checking the account GitHub handed a token for, done, ended without an account
 * (with why, in words for the person), or cancelled. Never a token, nor the device code that would
 * get one.
 */
export const signInState = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('waiting'),
    id: signInId,
    /** What the person types on GitHub's page, such as `4F2K-9QXD`. */
    userCode: z.string().regex(/^[A-Za-z0-9-]{1,32}$/),
    /** When the code expires, in milliseconds since the Unix epoch. */
    expiresAt: z.number(),
    /** The page the code is entered on, without its scheme: `github.com/login/device`. */
    page: z.string(),
  }),
  z.strictObject({ kind: z.literal('checking'), id: signInId }),
  z.strictObject({
    kind: z.literal('signedIn'),
    id: signInId,
    login,
    name: z.string().nullable(),
  }),
  z.strictObject({
    kind: z.literal('failed'),
    id: signInId,
    why: signInFailure,
    message: z.string(),
  }),
  z.strictObject({ kind: z.literal('cancelled'), id: signInId }),
]);
export type SignInState = z.output<typeof signInState>;

/** The scopes Lo asks for. */
export const scope = z.enum(['repo', 'read:org', 'workflow']);

/** An account `gh` is signed in to on github.com, without its token. */
export const ghAccount = z.strictObject({
  login,
  /** Whether it's the account gh uses for github.com. */
  active: z.boolean(),
  /** Whether gh could use its token just now. */
  usable: z.boolean(),
  /** What gh said when it checked the token: `success` when it works. */
  state: z.string(),
  /** The scopes gh says its token has. */
  scopes: z.array(z.string()),
  /** The scopes Lo asks for that its token lacks. */
  missing: z.array(scope),
  /** Whether its token lasts only hours, renewed by gh, which Lo asks gh for again. */
  shortLived: z.boolean(),
  /** Whether Lo has the account already: importing it replaces its token. */
  inLo: z.boolean(),
});
export type GhAccount = z.output<typeof ghAccount>;

/** What `gh` has to import: its accounts, or why there are none to show. */
export const ghListing = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('found'),
    /** Where gh is. */
    program: z.string(),
    /** gh's version, such as `2.62.0`, when it says. */
    version: z.string().nullable(),
    accounts: z.array(ghAccount),
  }),
  /** No gh Lo will run: none found, or one that someone else could change. */
  z.strictObject({ kind: z.literal('missing'), message: z.string() }),
  /** gh ran and failed. */
  z.strictObject({ kind: z.literal('failed'), program: z.string(), message: z.string() }),
]);
export type GhListing = z.output<typeof ghListing>;

/** How importing one account from `gh` went. */
export const imported = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true), login }),
  z.strictObject({ ok: z.literal(false), login, message: z.string() }),
]);
export type Imported = z.output<typeof imported>;

export const contract = defineContract('accounts', {
  requests: {
    /** Every account, oldest first, which `accounts.accounts` then keeps up to date. */
    list: { input: z.undefined(), reply: reply<AccountSummary[]>() },
    /** Removes an account, its token and everything Lo kept for it. */
    remove: { input: z.strictObject({ login }), reply: reply<void>() },
    /**
     * Why Lo can't keep a GitHub token just now, in words for the person, or null when it can: the
     * system has no keychain Lo keeps tokens with, as on Linux when no keyring answers.
     */
    keyring: { input: z.undefined(), reply: reply<string | null>() },
    /**
     * Starts signing in with GitHub's device flow, stopping any other sign-in, and answers with the
     * code to enter on GitHub, or why there's none. `accounts.signingIn` tells how it goes from there.
     */
    signIn: { input: z.undefined(), reply: reply<SignInState>() },
    /** Stops a sign-in: Lo asks GitHub nothing more for it. */
    cancelSignIn: { input: z.strictObject({ id: signInId }), reply: reply<void>() },
    /** Copies a sign-in's code to the clipboard. */
    copyCode: { input: z.strictObject({ id: signInId }), reply: reply<void>() },
    /**
     * Copies a sign-in's code to the clipboard and opens GitHub's page for entering it: always the
     * same page on GitHub's website, whatever GitHub's answer named.
     */
    openGithub: { input: z.strictObject({ id: signInId }), reply: reply<void>() },
    /** The accounts `gh` is signed in to on github.com, without their tokens. */
    ghAccounts: { input: z.undefined(), reply: reply<GhListing>() },
    /**
     * Imports accounts from `gh`: each one's token, read from gh and checked with GitHub. Only
     * accounts gh lists can be imported. Answers how each went.
     */
    importGh: {
      input: z.strictObject({ logins: z.array(login).min(1).max(20) }),
      reply: reply<Imported[]>(),
    },
    /**
     * Remembers `login` as the account to open a repository's pull requests with: for every
     * repository of its owner, or for this one alone.
     */
    choose: {
      input: z.strictObject({
        owner,
        name: repoName,
        login,
        remember: z.enum(['owner', 'repo']),
      }),
      reply: reply<void>(),
    },
  },
  topics: {
    /** Every account, each time one is added, removed or signed out, or how one is changes. */
    accounts: z.array(accountSummary),
    /** What happened to an account. */
    event: accountEvent,
    /** How the sign-in running is going, after `accounts.signIn` answered. */
    signingIn: signInState,
  },
});
