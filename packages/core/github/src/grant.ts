/** What GitHub grants an account, how it's kept, and why renewing it can fail. */

import type { Token } from './token.ts';

/**
 * What renews an access token that expires: its refresh token, and when each of them expires.
 * Times are in seconds since the Unix epoch.
 */
export interface Refresh {
  token: Token;
  /** When GitHub issued it, with its access token, by this computer's clock: of two pairs, the one issued later is newer. */
  issuedAt?: number | undefined;
  /** When the access token issued with it expires. */
  expiresAt?: number | undefined;
  /** When the refresh token itself expires, unless it's used before then. */
  refreshTokenExpiresAt?: number | undefined;
}

/** An access token GitHub issued, by a sign-in or a renewal, with what renews it when it expires. */
export interface Grant {
  token: Token;
  /** Nothing for a token that doesn't expire, or one from somewhere else, such as `gh`. */
  refresh?: Refresh | undefined;
}

/**
 * Where each account's grant is kept: in the app, encrypted on disk. A grant is written whole, so
 * an account's access and refresh tokens always belong together.
 */
export interface Secrets {
  /** The account's grant, or nothing when none is kept. Throws when it can't be read just now, as from a locked keychain, which is never taken for none. */
  read(login: string): Promise<Grant | undefined>;
  /** Keeps `grant` for the account, in place of what was kept. */
  write(login: string, grant: Grant): Promise<void>;
  /** Forgets the account's grant. */
  delete(login: string): Promise<void>;
}

/** Why a renewal gave no token. */
export class RenewalError extends Error {
  override name = 'RenewalError';
  /**
   * `refused`: GitHub won't renew with this refresh token: it expired, was used already, or the
   * user revoked Lo's access. Only signing in again gets a token. `unavailable`: GitHub didn't
   * answer, or couldn't just then. The refresh token may still work.
   */
  readonly kind: 'refused' | 'unavailable';

  constructor(kind: 'refused' | 'unavailable', message: string, options?: ErrorOptions) {
    super(
      kind === 'refused'
        ? `GitHub refused to renew the token: ${message}`
        : `Lo couldn't renew the token: ${message}`,
      options,
    );
    this.kind = kind;
  }
}
