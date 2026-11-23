// Why something asked of GitHub for a merge queue failed, in the reader's words: one reason for
// each cause, and none where the cause isn't known, with what the reader can do about it. GitHub's
// own text stays out of the reason, behind Details. Nothing here calls Electron or GitHub.

import { describeMergeRefusal, GithubError, type MergeRefusal } from '@lo/github';

import type { ActWhy } from '../contract.ts';

/** Why GitHub's answer isn't known. */
export const NO_ANSWER = 'GitHub didn’t respond.';

/** Why a question about the queue no longer stands, as asked: it was read again since. */
export const QUEUE_CHANGED = 'The queue has changed.';

/** Why GitHub left an entry, or one waiting to join, out of what it listed. */
export const LEFT_OUT = 'GitHub left part of the queue out.';

/** A number of minutes or hours, as a clock writes it: "05". */
function twoDigits(value: number): string {
  return String(value).padStart(2, '0');
}

/** A clock time as the interface writes it: "14:05". */
export function clock(at: number): string {
  const time = new Date(at);
  return `${twoDigits(time.getHours())}:${twoDigits(time.getMinutes())}`;
}

/** Why GitHub's rate limit holds writes back until `until`. */
export function rateLimited(until: number): ActWhy {
  return { why: `GitHub’s rate limit resets at ${clock(until)}.`, next: 'none' };
}

/** Why `login`'s account can't change anything: it's signed out. */
export function signedOut(login: string): ActWhy {
  return { why: `${login} is signed out.`, next: 'signIn' };
}

/** Where this computer keeps an account's sign-in. */
const KEPT_IN = process.platform === 'darwin' ? 'the Keychain' : 'the keyring';

/** What `error` says, as it came. */
export function textOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Why `error` stopped what was asked of GitHub as `login`, in `owner`'s repository, with GitHub's
 * text behind it.
 */
export function causeOf(error: unknown, login: string, owner?: string): ActWhy {
  const details = textOf(error);
  if (!(error instanceof GithubError)) return { why: '', details };
  const { detail } = error;
  switch (detail.kind) {
    case 'network':
      if (detail.failure === 'offline') return { why: 'Offline.', details };
      if (detail.failure === 'tunnel') {
        return { why: 'The proxy couldn’t connect to GitHub.', details };
      }
      if (detail.failure === 'lost') return { why: NO_ANSWER, details };
      return { why: '', details };
    case 'ssoRequired':
      return { why: owner === undefined ? '' : `${owner} requires single sign-on.`, details };
    case 'oauthAppRestricted': {
      const org = detail.org ?? owner;
      return { why: org === undefined ? '' : `${org} hasn’t approved Lo.`, details };
    }
    case 'refusedUrl':
      return { why: '', details };
    case 'rateLimited':
      return detail.reset === undefined
        ? { why: 'GitHub’s rate limit was reached.', details }
        : { ...rateLimited(detail.reset * 1000), details };
    case 'unauthorized':
      return { ...signedOut(detail.missing ?? login), details };
    case 'tokenUnavailable':
      return {
        why: `${login}’s sign-in can’t be read from ${KEPT_IN}.`,
        details,
      };
    case 'notFound':
      return { why: `It doesn’t exist, or ${login} can’t see it.`, details };
    case 'api':
    case 'graphql':
    case 'inconsistent':
    case 'decode':
      return { why: 'GitHub returned an error.', details };
    default:
      return { why: '', details };
  }
}

/** Why GitHub refused a change to the queue, or Lo did before asking it, as `login`. */
export function refusalOf(refusal: MergeRefusal, login: string): ActWhy {
  const details = describeMergeRefusal(refusal);
  switch (refusal.refusal) {
    case 'paused':
      return { ...rateLimited(refusal.until), details };
    case 'noPermission':
      return { why: `${login} doesn’t have permission.`, details, next: 'none' };
    case 'stacked':
      return { why: 'GitHub queues a stack’s layers in order', details, next: 'none' };
    case 'stackBusy':
      return { why: 'GitHub is still changing this stack.', details };
    case 'stackChanged':
    case 'unnamedAbove':
      return { why: QUEUE_CHANGED, details };
    case 'headMoved':
      return { why: 'This revision is out of date.', details, next: 'ask' };
    // Refusals of merges and of stacks, which no change to the queue meets.
    case 'alreadyStacked':
    case 'autoMergeNotAllowed':
    case 'baseChanged':
    case 'canMergeNow':
    case 'closed':
    case 'conflict':
    case 'draft':
    case 'layerMoved':
    case 'merged':
    case 'noMergeQueue':
    case 'notAChain':
    case 'notACommit':
    case 'other':
    case 'queueUnchecked':
    case 'rules':
    case 'stackNeedsRebase':
    case 'unchecked':
    case 'unnamedLayers':
      return { why: 'GitHub returned an error.', details };
    default:
      refusal satisfies never;
      return { why: 'GitHub returned an error.', details };
  }
}
