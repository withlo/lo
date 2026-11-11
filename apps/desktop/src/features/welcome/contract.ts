// The welcome screen's contract with main: looking for git again. Everything else the screen shows
// comes from other features' contracts (the accounts, what Lo found of git) and their windows.

import { z } from 'zod';

import { defineContract, reply } from '../../ipc/contract.ts';

export const contract = defineContract('welcome', {
  requests: {
    /**
     * Looks for git again, as "Check again" asks, for a git installed since Lo looked. What Lo
     * finds reaches the window on `app.git`, as every look does. It answers once the look is over.
     */
    checkGit: { input: z.undefined(), reply: reply<void>() },
  },
  topics: {},
});
