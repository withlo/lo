// What went wrong in signing in or importing an account, in words for the person: never a token.

import { GithubError } from '@lo/github';

import { NoKeychain } from './grants.ts';

/** `error`, then what caused it, and so on. */
export function causes(error: unknown): unknown[] {
  const chain: unknown[] = [];
  for (let each = error; each !== undefined && !chain.includes(each) && chain.length < 10;) {
    chain.push(each);
    each = each instanceof Error ? each.cause : undefined;
  }
  return chain;
}

/** The {@link NoKeychain} behind `error`, if that's why it failed. */
export function noKeychain(error: unknown): NoKeychain | undefined {
  return causes(error).find((each): each is NoKeychain => each instanceof NoKeychain);
}

/**
 * What GitHub's error says about a token Lo was checking, in words for the person, or nothing for
 * an error that isn't GitHub's.
 */
export function githubMessage(error: unknown): string | undefined {
  if (!(error instanceof GithubError)) return undefined;
  const { kind } = error.detail;
  if (kind === 'network') return `Lo couldn't reach GitHub: ${error.message}`;
  if (kind === 'unauthorized') return `GitHub refused the token: ${error.message}`;
  return `GitHub answered with an error: ${error.message}`;
}
