import { z } from 'zod';

import { defineContract, reply } from '../../ipc/contract.ts';

export const theme = z.enum(['dark', 'light']);
export type Theme = z.output<typeof theme>;

/**
 * Whether Lo has a git it can run, so the window can say when it hasn't: `checking` until Lo has
 * looked, which it does once the window is up; `found`, with its version; `missing`; or `tooOld`,
 * with its version and the check it failed, its version or whether it can be kept from downloading
 * on its own. `message` says what's wrong, and `install` how to put it right, in words for the
 * person using Lo.
 */
export const gitInfo = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('checking') }),
  z.strictObject({ status: z.literal('found'), version: z.string() }),
  z.strictObject({ status: z.literal('missing'), message: z.string(), install: z.string() }),
  z.strictObject({
    status: z.literal('tooOld'),
    version: z.string(),
    check: z.enum(['version', 'lazyFetch']),
    message: z.string(),
    install: z.string(),
  }),
]);
export type GitInfo = z.output<typeof gitInfo>;

/** What `app.info` answers, which main checks against this before it answers. */
export const appInfo = z.strictObject({
  /** Lo's version. */
  version: z.string(),
  /** The system Lo runs on, as Node names it: `darwin` or `linux`. */
  platform: z.string(),
  /** The current theme, which `app.theme` then keeps up to date. */
  theme,
  /** Whether Lo has a git it can run, which `app.git` then keeps up to date. */
  git: gitInfo,
});
export type AppInfo = z.output<typeof appInfo>;

export const contract = defineContract('app', {
  requests: {
    info: { input: z.undefined(), reply: reply<AppInfo>() },
  },
  topics: {
    /** The system's appearance, each time it changes. */
    theme,
    /** What Lo finds each time it looks for git. */
    git: gitInfo,
  },
});
