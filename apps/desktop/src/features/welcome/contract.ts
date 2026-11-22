// The welcome's contract with main: whether the reader has finished it, and looking for Git again.
// Everything else its steps show comes from other features' contracts (the accounts, what Lo found
// of Git, the settings) and their windows.

import { z } from 'zod';

import { defineContract, reply } from '../../ipc/contract.ts';

/** How the welcome stands: whether the reader has finished it, on this computer. */
export const state = z.strictObject({ finished: z.boolean() });
export type State = z.infer<typeof state>;

export const contract = defineContract('welcome', {
  requests: {
    /** Whether the reader has finished the welcome, so it opens by itself only until they have. */
    state: { input: z.undefined(), reply: reply<State>() },
    /** Keeps that the reader finished the welcome. Asked again, it changes nothing. */
    finish: { input: z.undefined(), reply: reply<void>() },
    /**
     * Looks for Git again, as "Check again" asks, for a Git installed since Lo looked. What Lo
     * finds reaches the window on `app.git`, as every look does. It answers once the look is over.
     */
    checkGit: { input: z.undefined(), reply: reply<void>() },
  },
  topics: {},
});
