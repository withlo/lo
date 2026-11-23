// The guide's causes, worded once: why something failed, as the reason line under an error's
// title, and why Lo has no git it can run. Main says a cause as a kind (`ipc/cause.ts`, `ipc/git.ts`),
// and every feature words it here.

import type { System } from '@lo/ui/commands';

import type { Cause } from '../ipc/cause.ts';
import type { GitTrouble } from '../ipc/git.ts';
import { systemOf } from './commands/registry.ts';

export type { Cause } from '../ipc/cause.ts';

/** A time of day, in the system's own format: `14:05`. */
export function timeOfDay(time: number): string {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(time);
}

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
          throw new Error(`A proxy Lo doesn't know: ${JSON.stringify(cause.why satisfies never)}`);
      }
    case 'github':
      return 'GitHub returned an error.';
    case 'timeout':
      return 'GitHub didn’t respond.';
    case 'rateLimit':
      return cause.resets === null
        ? 'GitHub’s rate limit was reached.'
        : `GitHub’s rate limit resets at ${timeOfDay(cause.resets)}.`;
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
      throw new Error(`A cause Lo doesn't know: ${JSON.stringify(cause satisfies never)}`);
  }
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
      throw new Error(`A cause Lo doesn't know: ${JSON.stringify(cause satisfies never)}`);
  }
}

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
      throw new Error(`A Git Lo doesn't know: ${JSON.stringify(trouble satisfies never)}`);
  }
}

/** Why a git someone else could change can't be used, by what's true of it. */
const DISTRUST: Readonly<Record<Extract<GitTrouble, { status: 'distrusted' }>['why'], string>> = {
  owner: 'Another user owns it.',
  writable: 'Other users can change it.',
  folderOwner: 'Another user owns its folder.',
  folderWritable: 'Other users can change its folder.',
  unchecked: 'Its permissions can’t be read.',
};
