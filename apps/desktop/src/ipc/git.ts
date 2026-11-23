// Why Lo has no git it can run, as it crosses to the window: parts the window words, never a
// sentence. Main makes them from what `@lo/git` found (`main/git.ts`).

import { z } from 'zod';

/** How to get a git Lo can run: commands to copy, and a page that lists newer packages, if any. */
const install = z.strictObject({
  commands: z.array(z.string().max(200)).max(4),
  page: z.string().max(200).nullable(),
});

/**
 * Why Lo has no git it can run, as parts the window words, each with how to get one: none was
 * found (`missing`); the only one found, at `program`, could be changed by someone else
 * (`distrusted`), `why`, with what that's true of and the system's words behind Details; or the
 * newest is `version`, older than the `minimum` its failed `check` needs: its version, or whether
 * it can be kept from downloading on its own.
 */
export const gitTrouble = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('missing'), install }),
  z.strictObject({
    status: z.literal('distrusted'),
    program: z.string(),
    why: z.enum(['owner', 'writable', 'folderOwner', 'folderWritable', 'unchecked']),
    details: z.string(),
    install,
  }),
  z.strictObject({
    status: z.literal('tooOld'),
    program: z.string(),
    version: z.string(),
    minimum: z.string(),
    check: z.enum(['version', 'lazyFetch']),
    install,
  }),
]);
export type GitTrouble = z.output<typeof gitTrouble>;
