import { z } from 'zod';

import { defineContract, reply } from '../../ipc/contract.ts';

/** A GitHub login: letters, digits and hyphens, at most 39. */
export const login = z.string().regex(/^[A-Za-z0-9-]{1,39}$/);

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

export const contract = defineContract('accounts', {
  requests: {
    /** Every account, oldest first, which `accounts.accounts` then keeps up to date. */
    list: { input: z.undefined(), reply: reply<AccountSummary[]>() },
    /** Removes an account, its token and everything Lo kept for it. */
    remove: { input: z.strictObject({ login }), reply: reply<void>() },
  },
  topics: {
    /** Every account, each time one is added, removed or signed out, or how one is changes. */
    accounts: z.array(accountSummary),
    /** What happened to an account. */
    event: accountEvent,
  },
});
