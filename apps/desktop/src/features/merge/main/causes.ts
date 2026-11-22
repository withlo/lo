// Why something asked of GitHub failed, in the interface's words: one reason for each cause,
// whatever was asked, and none where the cause isn't known. GitHub's own text stays out of the
// reason, except where the reason says only that GitHub returned an error, or nothing: there it
// follows, as all there is to say why. Nothing here calls Electron or GitHub.

import { GithubError, type GithubErrorDetail, type NetworkFailure } from '@lo/github';

/** Who asked, for the causes that name them. */
export interface Asker {
  /** The account it was asked as. */
  readonly login: string;
  /** The repo's owner, which single sign-on and an organization's approval name. */
  readonly owner?: string | undefined;
}

/** What GitHub failing says, where GitHub's own text says why. */
const RETURNED = 'GitHub returned an error.';

/** Where this computer keeps an account's sign-in. */
const KEPT_IN = process.platform === 'linux' ? 'the keyring' : 'the Keychain';

/** A number of minutes or hours, as a clock writes it: "05". */
function twoDigits(value: number): string {
  return String(value).padStart(2, '0');
}

/** A clock time as the interface writes it: "14:05". */
export function clock(at: number): string {
  const time = new Date(at);
  return `${twoDigits(time.getHours())}:${twoDigits(time.getMinutes())}`;
}

/** The reason for a request that got no answer, as far as Lo can tell why. */
function networkCause(failure: NetworkFailure): string {
  switch (failure) {
    case 'offline':
      return 'Offline.';
    case 'tunnel':
      return 'The proxy couldn’t connect to GitHub.';
    case 'lost':
      return 'GitHub didn’t respond.';
    // A certificate or a proxy's refusal, which can't be told apart; or anything else.
    case 'refused':
    case 'unknown':
      return '';
    default:
      failure satisfies never;
      return '';
  }
}

/** The reason for `detail`'s cause, or none where the cause isn't known. */
export function causeOfDetail(detail: GithubErrorDetail, { login, owner }: Asker): string {
  switch (detail.kind) {
    case 'unauthorized':
      return `${login} is signed out.`;
    case 'ssoRequired':
      return owner === undefined ? '' : `${owner} requires single sign-on.`;
    case 'oauthAppRestricted': {
      const org = detail.org ?? owner;
      return org === undefined ? '' : `${org} hasn’t approved Lo.`;
    }
    case 'rateLimited':
      return detail.reset === undefined
        ? 'GitHub’s rate limit was reached.'
        : `GitHub’s rate limit resets at ${clock(detail.reset * 1000)}.`;
    case 'notFound':
      return `It doesn’t exist, or ${login} can’t see it.`;
    case 'network':
      return networkCause(detail.failure);
    case 'tokenUnavailable':
      return `${login}’s sign-in can’t be read from ${KEPT_IN}.`;
    case 'api':
    case 'graphql':
    case 'inconsistent':
    case 'decode':
      return RETURNED;
    case 'refusedUrl':
      return '';
    default:
      detail satisfies never;
      return '';
  }
}

/** The reason for `error`'s cause, or none where the cause isn't known. */
export function causeOf(error: unknown, asker: Asker): string {
  return error instanceof GithubError ? causeOfDetail(error.detail, asker) : '';
}

/**
 * Why `error` happened, for the reader: its cause's reason, followed by GitHub's own text where the
 * reason doesn't say why, or alone where there's no reason.
 */
export function explained(error: unknown, asker: Asker): string {
  const reason = causeOf(error, asker);
  if (reason !== '' && reason !== RETURNED) return reason;
  const raw = error instanceof Error ? error.message : String(error);
  return reason === '' ? raw : `${reason} ${raw}`;
}
