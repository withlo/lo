// Why something failed, as it crosses to the window: a kind with what words it, never a sentence.
// Main sends a cause, and the source's own text beside it for Details; the window words the cause
// with the guide's causes (`window/explain.ts`).

import type { GithubCause } from '@lo/github';
import { z } from 'zod';

/** A GitHub login. */
const login = z.string().regex(/^[A-Za-z0-9-]{1,39}$/);

/** An organization or user that owns repositories, as GitHub names them. */
const org = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);

/**
 * Why something failed: GitHub's causes (`causeOf` in `@lo/github`), and the ones of work on this
 * computer or with Git: a certificate that couldn't be verified, a full disk, work that took too
 * long (`tooSlow`) or ran out of memory.
 */
export const cause = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('offline') }),
  z.strictObject({
    kind: z.literal('proxy'),
    why: z.enum(['refused', 'signIn', 'unsupported']),
  }),
  z.strictObject({ kind: z.literal('github') }),
  z.strictObject({ kind: z.literal('timeout') }),
  z.strictObject({ kind: z.literal('rateLimit'), resets: z.number().nullable() }),
  z.strictObject({ kind: z.literal('signedOut'), login }),
  z.strictObject({ kind: z.literal('unreadable'), login }),
  z.strictObject({ kind: z.literal('hidden'), login }),
  z.strictObject({ kind: z.literal('private'), signedIn: z.boolean() }),
  z.strictObject({ kind: z.literal('sso'), org }),
  z.strictObject({ kind: z.literal('unapproved'), org }),
  z.strictObject({ kind: z.literal('certificate') }),
  z.strictObject({ kind: z.literal('diskFull') }),
  z.strictObject({ kind: z.literal('tooSlow') }),
  z.strictObject({ kind: z.literal('memory') }),
  z.strictObject({ kind: z.literal('unknown') }),
]);
export type Cause = z.output<typeof cause>;

/** A cause of GitHub's errors, which crosses as it is: this fails to compile if one can't. */
export function githubCause(given: GithubCause): Cause {
  return given;
}

/** The most of the source's own text a cause carries, in characters. */
export const DETAILS_LIMIT = 4000;

/** What the source said, as it came, behind Details: GitHub's, Git's or the system's words. */
export const details = z.string().min(1).max(DETAILS_LIMIT);

/** `text` as Details carries it: nothing when it's empty, and cut to {@link DETAILS_LIMIT}. */
export function detailsOf(text: string | undefined): string | undefined {
  const trimmed = text?.trim();
  if (trimmed === undefined || trimmed === '') return undefined;
  return trimmed.length <= DETAILS_LIMIT ? trimmed : `${trimmed.slice(0, DETAILS_LIMIT - 1)}…`;
}
