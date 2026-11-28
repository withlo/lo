// The guide's causes, worded once: why something failed, as the reason line under an error's
// title, and why Lo has no git it can run. Main says a cause as a kind (`ipc/cause.ts`, `ipc/git.ts`),
// and every feature words it here.

import { clock } from '@lo/ui';
import type { System } from '@lo/ui/commands';

import type { Cause } from '../ipc/cause.ts';
import type { GitTrouble } from '../ipc/git.ts';
import { systemOf } from './commands/registry.ts';

export type { Cause } from '../ipc/cause.ts';

/** Why a text file Lo opens, such as the keymap file or the licenses, didn't open on Linux. */
export const NO_TEXT_APP = 'No app is set for text files.';

/** What Linux was asked for the app for text files, which answered none: behind Details. */
export const TEXT_APP_QUERY = 'xdg-mime query default text/plain';

/** Why a text file didn't open on a computer Lo has no way to open one on. */
export const UNSUPPORTED = 'Opening text files isn’t supported on this computer.';

/** Where sign-ins are kept: the Keychain on macOS, the keyring on Linux. */
export function keptIn(system: System = currentSystem()): string {
  return system === 'mac' ? 'the Keychain' : 'the keyring';
}

function currentSystem(): System {
  return systemOf(globalThis.navigator?.platform ?? '');
}

/**
 * `cause` as an error's reason line, as the guide words it: nothing where it isn't known, which has
 * no reason line. Sign-ins are kept in the Keychain on macOS and the keyring on Linux, as `system`
 * says.
 */
export function explain(cause: Cause, system: System = currentSystem()): string | undefined {
  switch (cause.kind) {
    case 'offline':
      return 'Offline.';
    case 'proxy':
      switch (cause.why) {
        case 'refused':
          return 'The proxy couldn’t connect to GitHub.';
        case 'signIn':
          return 'The proxy requires a sign-in.';
        case 'unsupported':
          return 'The proxy isn’t HTTP, HTTPS or SOCKS5.';
        default:
          throw new Error(`A proxy Lo doesn’t know: ${JSON.stringify(cause.why satisfies never)}`);
      }
    case 'github':
      return 'GitHub returned an error.';
    case 'timeout':
      return 'GitHub didn’t respond.';
    case 'rateLimit':
      return cause.resets === null
        ? 'GitHub’s rate limit was reached.'
        : `GitHub’s rate limit resets at ${clock(cause.resets)}.`;
    case 'signedOut':
      return `${cause.login} is signed out.`;
    case 'unreadable':
      return `${cause.login}’s sign-in can’t be read from ${keptIn(system)}.`;
    case 'hidden':
      return `It doesn’t exist, or ${cause.login} can’t see it.`;
    case 'private':
      return cause.signedIn
        ? 'It doesn’t exist, or none of your accounts can see it.'
        : 'It doesn’t exist, or it’s private.';
    case 'sso':
      return `${cause.org} requires single sign-on.`;
    case 'unapproved':
      return `${cause.org} hasn’t approved Lo.`;
    case 'certificate':
      return 'GitHub’s certificate couldn’t be verified.';
    case 'diskFull':
      return 'The disk is full.';
    case 'tooSlow':
      return 'It took too long.';
    case 'memory':
      return 'It ran out of memory.';
    case 'unknown':
      return undefined;
    default:
      throw new Error(`A cause Lo doesn’t know: ${JSON.stringify(cause satisfies never)}`);
  }
}

/**
 * What a chip, or a dimmed control's reason, calls `cause`, why GitHub gave no answer or a read
 * failed: "Offline" only where no connection reached GitHub, "No response" where GitHub didn't
 * answer in time, and "Can’t read the sign-in" where the account's sign-in can't be read. Any other
 * cause is `otherwise`.
 */
export function chipLabel(cause: Cause, otherwise: string): string {
  switch (cause.kind) {
    case 'offline':
      return 'Offline';
    case 'timeout':
      return 'No response';
    case 'unreadable':
      return 'Can’t read the sign-in';
    case 'unknown':
    case 'proxy':
    case 'github':
    case 'rateLimit':
    case 'signedOut':
    case 'hidden':
    case 'private':
    case 'sso':
    case 'unapproved':
    case 'certificate':
    case 'diskFull':
    case 'tooSlow':
    case 'memory':
      return otherwise;
    default:
      throw new Error(`A cause Lo doesn’t know: ${JSON.stringify(cause satisfies never)}`);
  }
}

/**
 * What a chip, or a dimmed control's reason, calls GitHub giving the connection no answer, for
 * `cause`: as {@link chipLabel} says, "Can’t reach GitHub" where Lo can't tell why, and "Offline"
 * for the rest, such as a proxy that refused.
 */
export function offlineLabel(cause: Cause): string {
  return cause.kind === 'unknown' ? 'Can’t reach GitHub' : chipLabel(cause, 'Offline');
}

/**
 * Whether trying again can't help with `cause` until something changes elsewhere, so its error has
 * no "Try again": the rate limit until it resets, a proxy that wants what Lo can't give, and work
 * that ran out of memory, which fails the same way again.
 */
export function waitsOut(cause: Cause): boolean {
  switch (cause.kind) {
    case 'rateLimit':
      return cause.resets !== null;
    case 'proxy':
      return cause.why !== 'refused';
    case 'memory':
      return true;
    case 'offline':
    case 'github':
    case 'timeout':
    case 'signedOut':
    case 'unreadable':
    case 'hidden':
    case 'private':
    case 'sso':
    case 'unapproved':
    case 'certificate':
    case 'diskFull':
    case 'tooSlow':
    case 'unknown':
      return false;
    default:
      throw new Error(`A cause Lo doesn’t know: ${JSON.stringify(cause satisfies never)}`);
  }
}

/**
 * What an error for `cause` offers to do about it: sign in again, for an account GitHub signed out
 * (`signInAgain`); add an account, for what the account signed in can't see (`addAccount`); sign
 * in, for what nobody signed in can see (`signIn`); nothing, while trying again can't help until
 * it's waited out ({@link waitsOut}), as with the rate limit, which says when it resets; else try
 * again.
 */
export type Remedy = 'tryAgain' | 'signIn' | 'addAccount' | 'signInAgain' | 'none';

/** What an error for `cause` offers to do about it, as {@link Remedy} says. */
export function remedyOf(cause: Cause): Remedy {
  if (waitsOut(cause)) return 'none';
  if (cause.kind === 'signedOut') return 'signInAgain';
  if (cause.kind === 'hidden') return 'addAccount';
  if (cause.kind === 'private' && !cause.signedIn) return 'signIn';
  return 'tryAgain';
}

/** The button of each remedy that has one, as the guide words it. */
export const REMEDY_LABELS = {
  tryAgain: 'Try again',
  signIn: 'Sign in with GitHub…',
  addAccount: 'Add account…',
  signInAgain: 'Sign in again',
} as const satisfies Record<Exclude<Remedy, 'none'>, string>;

/** What a Git Lo can't run says: its title, its reason, how to get one, and the rest behind Details. */
export interface GitWords {
  readonly title: string;
  readonly reason?: string | undefined;
  /** Commands that install one, each to copy. */
  readonly commands: readonly string[];
  /** A page that lists newer packages, where the system's own can be too old. */
  readonly page?: string | undefined;
  readonly details?: string | undefined;
}

/** Why Lo has no git it can run, worded as the guide's Error: "Can’t find Git", and the rest. */
export function gitWords(trouble: GitTrouble): GitWords {
  const { commands } = trouble.install;
  const page = trouble.install.page ?? undefined;
  switch (trouble.status) {
    case 'missing':
      return { title: 'Can’t find Git', commands, page };
    case 'distrusted':
      return {
        title: 'Can’t use Git',
        reason: DISTRUST[trouble.why],
        commands,
        page,
        details: trouble.details,
      };
    case 'tooOld':
      return {
        title: `Can’t use Git ${trouble.version}`,
        reason: `Version ${trouble.minimum} or newer is required.`,
        commands,
        page,
        details: trouble.program,
      };
    default:
      throw new Error(`A Git Lo doesn’t know: ${JSON.stringify(trouble satisfies never)}`);
  }
}

/**
 * Why a program someone else could change can't be used, by what's true of it, as the reason under
 * its error: Git's, or GitHub CLI's.
 */
export function distrustReason(why: Extract<GitTrouble, { status: 'distrusted' }>['why']): string {
  return DISTRUST[why];
}

/** Why a git someone else could change can't be used, by what's true of it. */
const DISTRUST: Readonly<Record<Extract<GitTrouble, { status: 'distrusted' }>['why'], string>> = {
  owner: 'Another user owns it.',
  writable: 'Other users can change it.',
  folderOwner: 'Another user owns its folder.',
  folderWritable: 'Other users can change its folder.',
  unchecked: 'Its permissions can’t be read.',
};
