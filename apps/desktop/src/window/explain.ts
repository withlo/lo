// The guide's causes, worded once: why GitHub didn't answer, or refused, as the reason line under an
// error's title. Main says a cause as a kind, and every feature words it here.

import type { System } from '@lo/ui/commands';

import { systemOf } from './commands/registry.ts';

/**
 * Why something that went to GitHub didn't come back: no connection, GitHub's own error, no answer
 * in time, its rate limit (resetting at `resets`, in milliseconds since the Unix epoch, when it
 * said), an account signed out or whose sign-in can't be read, an organization that requires
 * single sign-on or hasn't approved Lo, or something else.
 */
export type Cause =
  | { readonly kind: 'offline' }
  | { readonly kind: 'github' }
  | { readonly kind: 'timeout' }
  | { readonly kind: 'rateLimit'; readonly resets: number | null }
  | { readonly kind: 'signedOut'; readonly login: string }
  | { readonly kind: 'unreadable'; readonly login: string }
  | { readonly kind: 'sso'; readonly org: string }
  | { readonly kind: 'unapproved'; readonly org: string }
  | { readonly kind: 'unknown' };

/** A time of day, in the system's own format: `14:05`. */
function timeOfDay(time: number): string {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(time);
}

/**
 * `cause` as an error's reason line, as the guide words it: nothing where it isn't known, which has
 * no reason line. Sign-ins are kept in the Keychain on macOS and the keyring on Linux, as `system`
 * says.
 */
export function explain(
  cause: Cause,
  system: System = systemOf(globalThis.navigator?.platform ?? ''),
): string | undefined {
  switch (cause.kind) {
    case 'offline':
      return 'Offline.';
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
      return `${cause.login}’s sign-in can’t be read from the ${system === 'mac' ? 'Keychain' : 'keyring'}.`;
    case 'sso':
      return `${cause.org} requires single sign-on.`;
    case 'unapproved':
      return `${cause.org} hasn’t approved Lo.`;
    case 'unknown':
      return undefined;
    default:
      throw new Error(`A cause Lo doesn't know: ${JSON.stringify(cause satisfies never)}`);
  }
}
