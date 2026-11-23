// Importing accounts from `gh`: listing what gh has, reading each chosen account's token from gh
// and checking with GitHub that it's that account's, then keeping it as Lo keeps any account. And
// once GitHub refuses an imported account's token, reading gh's newer one, which gh renews itself.
// Nothing here calls Electron, so it runs under unit tests with a fake gh and a `fetch` that
// replays GitHub.

import { describeDistrust } from '@lo/git';
import {
  causeOf,
  GithubClient,
  GithubError,
  missingScopes,
  sameLogin,
  saidBy,
  type AuthenticatedUser,
  type GitHubUrls,
  type Grant,
  type Token,
} from '@lo/github';

import { detailsOf, githubCause } from '../../../ipc/cause.ts';
import type { GhListing, ImportFailure, Imported } from '../contract.ts';
import { githubMessage, noKeychain } from './errors.ts';
import { GhError, type Gh, type GhAccount, type GhLookup } from './gh.ts';
import { checkedUser } from './users.ts';

export interface ImportOptions {
  gh: Gh;
  /** The `fetch` a token is checked with GitHub through. */
  fetch: typeof globalThis.fetch;
  urls: GitHubUrls;
}

/** What gh has to import, with which of its accounts Lo has already (`known`, by login). */
export async function listGh(
  gh: Gh,
  known: readonly string[],
  log: (message: string) => void,
): Promise<GhListing> {
  const found = await gh.find();
  if (found.kind === 'missing') return { kind: 'missing' };
  if (found.kind === 'distrusted') {
    return {
      kind: 'distrusted',
      program: found.program,
      why: found.distrust.why,
      details: detailsOf(distrustDetails(found)) ?? found.program,
    };
  }
  const { program } = found;
  // gh's version never fails, so it's there to name a gh too old to list its accounts.
  const asked = gh.version(program);
  try {
    const [accounts, version] = await Promise.all([gh.accounts(program), asked]);
    return {
      kind: 'found',
      program,
      version: version ?? null,
      accounts: accounts.map((account) => ({
        login: account.login,
        active: account.active,
        usable: isUsable(account),
        state: account.state,
        scopes: [...account.scopes],
        missing: missingScopes(account.scopes),
        shortLived: account.refreshable,
        inLo: known.some((login) => sameLogin(login, account.login)),
      })),
    };
  } catch (error) {
    const version = (await asked) ?? null;
    if (!(error instanceof GhError)) {
      log(`listing gh's accounts: ${logged(error)}`);
      return { kind: 'failed', program, why: 'other', version, details: detailsOf(logged(error)) };
    }
    // What gh couldn't be run with is the system's, so where gh is goes with it.
    const said = error.trouble === 'run' ? `${program}\n${error.said}` : error.said;
    return { kind: 'failed', program, why: error.trouble, version, details: detailsOf(said) };
  }
}

/** Where a gh Lo passed over is, and what's true of it, for Details, as Git's says it. */
function distrustDetails(found: Extract<GhLookup, { kind: 'distrusted' }>): string {
  return `${found.program}\n${describeDistrust(found.distrust)}`;
}

/** Whether gh could use the account's token when it last checked. */
function isUsable(account: GhAccount): boolean {
  return account.state === 'success';
}

/** gh's token for `login` is `other`'s, as GitHub says. */
export class OtherAccount extends GhError {
  override name = 'OtherAccount';
  readonly other: string;

  constructor(login: string, other: string) {
    super(`gh's token for ${login} is ${other}'s.`);
    this.other = other;
  }
}

/**
 * The token gh keeps for `login`, and the account GitHub says it's for, which must be `login`. It
 * goes to GitHub's API and nowhere else.
 */
export async function ghToken(
  options: ImportOptions,
  program: string,
  login: string,
): Promise<{ user: AuthenticatedUser; token: Token }> {
  const token = await options.gh.token(program, login);
  const client = new GithubClient({ fetch: options.fetch, token, urls: options.urls });
  const user = checkedUser(await client.user());
  if (!sameLogin(user.user.login, login)) throw new OtherAccount(login, user.user.login);
  return { user, token };
}

/**
 * Imports `logins` from gh, one at a time, keeping each with `add`. Only accounts gh lists, and
 * whose token gh could use, are imported. Answers how each went, in the order asked.
 */
export async function importFromGh(
  options: ImportOptions & {
    add: (user: AuthenticatedUser, grant: Grant) => Promise<void>;
    log: (message: string) => void;
  },
  logins: readonly string[],
): Promise<Imported[]> {
  const { gh, log } = options;
  const found = await gh.find();
  if (found.kind !== 'found') {
    const why: ImportFailure = {
      kind: 'failed',
      cause: { kind: 'unknown' },
      details: found.kind === 'distrusted' ? detailsOf(distrustDetails(found)) : undefined,
    };
    return logins.map((login) => ({ ok: false, login, why }));
  }
  let listed: GhAccount[];
  try {
    listed = await gh.accounts(found.program);
  } catch (error) {
    return logins.map((login) => ({ ok: false, login, why: failureOf(error, login, log) }));
  }
  const results: Imported[] = [];
  for (const login of new Set(logins)) {
    const account = listed.find((each) => sameLogin(each.login, login));
    if (account === undefined) {
      results.push({ ok: false, login, why: { kind: 'notSignedIn' } });
      continue;
    }
    if (!isUsable(account)) {
      results.push({ ok: false, login, why: { kind: 'unusable', state: account.state } });
      continue;
    }
    try {
      const { user, token } = await ghToken(options, found.program, account.login);
      await options.add(user, { token });
      results.push({ ok: true, login: user.user.login });
    } catch (error) {
      results.push({ ok: false, login, why: failureOf(error, login, log) });
    }
  }
  return results;
}

/**
 * What reads an account imported from gh from gh again, after GitHub refused its token: gh's token
 * for it, once GitHub says it's the account's, or nothing when gh has nothing for it: no gh, the
 * account no longer in gh, or a token GitHub refuses too or says is someone else's. Nothing signs
 * the account out. It throws when gh or GitHub couldn't be asked, as when gh times out, can't reach
 * its keyring, Lo is offline or Lo is quitting, so the account stays signed in and is tried again
 * later.
 */
export function rereadFromGh(
  options: ImportOptions & { log: (message: string) => void },
): (login: string) => Promise<Token | undefined> {
  return tokenFromGh(options, 'again');
}

/**
 * What reads gh's token for an account for one upload, when GitHub took no upload with Lo's own:
 * read afresh each time, checked with GitHub to be the account's, and handed to that upload alone,
 * never kept. Nothing when gh has nothing for the account, as {@link rereadFromGh} answers; it
 * throws when gh or GitHub couldn't be asked.
 */
export function ghTokenForUpload(
  options: ImportOptions & { log: (message: string) => void },
): (login: string) => Promise<Token | undefined> {
  return tokenFromGh(options, 'for an upload');
}

/**
 * gh's token for an account, read `why` ("again", "for an upload"), as {@link rereadFromGh} and
 * {@link ghTokenForUpload} read it. What's logged never holds the token.
 */
function tokenFromGh(
  options: ImportOptions & { log: (message: string) => void },
  why: string,
): (login: string) => Promise<Token | undefined> {
  const { gh, log } = options;
  const tell = (login: string, message: string) =>
    log(`reading ${login}'s token from gh ${why}: ${message}`);
  return async (login) => {
    const found = await gh.find();
    if (found.kind === 'missing') {
      tell(login, "Lo can't find gh, GitHub's command-line tool.");
      return undefined;
    }
    if (found.kind === 'distrusted') {
      const distrust = describeDistrust(found.distrust);
      tell(login, `Lo found gh at ${found.program}, but ${distrust}, so Lo won't run it.`);
      return undefined;
    }
    let listed: GhAccount[];
    let token: Token;
    try {
      listed = await gh.accounts(found.program);
      if (!listed.some((account) => sameLogin(account.login, login))) {
        tell(login, `gh isn't signed in to ${login}${why === 'again' ? ' any more' : ''}.`);
        return undefined;
      }
      token = await gh.token(found.program, login);
    } catch (error) {
      tell(login, logged(error));
      throw error;
    }
    const client = new GithubClient({ fetch: options.fetch, token, urls: options.urls });
    let user: AuthenticatedUser;
    try {
      user = checkedUser(await client.user());
    } catch (error) {
      tell(login, logged(error));
      // A token GitHub refuses, or answers for with no account, is no newer token.
      if (error instanceof GithubError && ['unauthorized', 'decode'].includes(error.detail.kind)) {
        return undefined;
      }
      throw error;
    }
    if (!sameLogin(user.user.login, login)) {
      tell(login, `gh's token for ${login} is ${user.user.login}'s.`);
      return undefined;
    }
    return token;
  };
}

/**
 * Why `login` wasn't imported, for what went wrong with gh or with checking or keeping its token:
 * by its cause, with what gh, GitHub or the system said behind Details.
 */
function failureOf(error: unknown, login: string, log: (message: string) => void): ImportFailure {
  if (error instanceof OtherAccount) return { kind: 'otherAccount', other: error.other };
  if (error instanceof GhError) {
    const cause =
      error.trouble === 'tooSlow' ? { kind: 'tooSlow' as const } : { kind: 'unknown' as const };
    return { kind: 'failed', cause, details: detailsOf(error.said) };
  }
  // GitHub refusing gh's token is gh's sign-in that can't be used, as gh says of one it checked.
  if (error instanceof GithubError && error.detail.kind === 'unauthorized') {
    return { kind: 'unusable', state: detailsOf(error.said()) ?? 'unauthorized' };
  }
  if (error instanceof GithubError) {
    return {
      kind: 'failed',
      cause: githubCause(causeOf(error, { login })),
      details: detailsOf(saidBy(error)),
    };
  }
  const keychain = noKeychain(error);
  if (keychain !== undefined) {
    return { kind: 'failed', cause: { kind: 'unknown' }, details: detailsOf(keychain.message) };
  }
  log(`importing ${login} from gh: ${logged(error)}`);
  return { kind: 'failed', cause: { kind: 'unknown' }, details: detailsOf(logged(error)) };
}

/** What went wrong with gh, or with checking or keeping its token, for the log. */
function logged(error: unknown): string {
  return githubMessage(error) ?? (error instanceof Error ? error.message : String(error));
}
