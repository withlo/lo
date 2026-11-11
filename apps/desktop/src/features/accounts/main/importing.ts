// Importing accounts from `gh`: listing what gh has, reading each chosen account's token from gh
// and checking with GitHub that it's that account's, then keeping it as Lo keeps any account. And
// once GitHub refuses an imported account's token, reading gh's newer one, which gh renews itself.
// Nothing here calls Electron, so it runs under unit tests with a fake gh and a `fetch` that
// replays GitHub.

import {
  GithubClient,
  missingScopes,
  sameLogin,
  type AuthenticatedUser,
  type GitHubUrls,
  type Grant,
  type Token,
} from '@lo/github';

import type { GhListing, Imported } from '../contract.ts';
import { githubMessage, noKeychain } from './errors.ts';
import { GhError, type Gh, type GhAccount } from './gh.ts';
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
  if (found.kind === 'missing') return { kind: 'missing', message: found.message };
  const { program } = found;
  try {
    const [accounts, version] = await Promise.all([gh.accounts(program), gh.version(program)]);
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
    return { kind: 'failed', program, message: ghMessage(error, log) };
  }
}

/** Whether gh could use the account's token when it last checked. */
function isUsable(account: GhAccount): boolean {
  return account.state === 'success';
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
  if (!sameLogin(user.user.login, login)) {
    throw new GhError(`gh's token for ${login} is ${user.user.login}'s.`);
  }
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
  if (found.kind === 'missing') {
    return logins.map((login) => ({ ok: false, login, message: found.message }));
  }
  let listed: GhAccount[];
  try {
    listed = await gh.accounts(found.program);
  } catch (error) {
    const message = ghMessage(error, log);
    return logins.map((login) => ({ ok: false, login, message }));
  }
  const results: Imported[] = [];
  for (const login of new Set(logins)) {
    const account = listed.find((each) => sameLogin(each.login, login));
    if (account === undefined) {
      results.push({ ok: false, login, message: `gh isn't signed in to ${login}.` });
      continue;
    }
    if (!isUsable(account)) {
      results.push({
        ok: false,
        login,
        message: `gh can't use ${account.login}'s token just now: gh says ${account.state}.`,
      });
      continue;
    }
    try {
      const { user, token } = await ghToken(options, found.program, account.login);
      await options.add(user, { token });
      results.push({ ok: true, login: user.user.login });
    } catch (error) {
      results.push({ ok: false, login, message: ghMessage(error, log) });
    }
  }
  return results;
}

/**
 * What reads an account imported from gh from gh again, after GitHub refused its token: gh's token
 * for it, once GitHub says it's the account's, or nothing.
 */
export function rereadFromGh(
  options: ImportOptions & { log: (message: string) => void },
): (login: string) => Promise<Token | undefined> {
  return async (login) => {
    try {
      const found = await options.gh.find();
      if (found.kind === 'missing') {
        options.log(`reading ${login}'s token from gh again: ${found.message}`);
        return undefined;
      }
      return (await ghToken(options, found.program, login)).token;
    } catch (error) {
      options.log(`reading ${login}'s token from gh again: ${ghMessage(error, () => undefined)}`);
      return undefined;
    }
  };
}

/** What went wrong with gh, or with checking or keeping its token, in words for the person. */
function ghMessage(error: unknown, log: (message: string) => void): string {
  if (error instanceof GhError) return error.message;
  const keychain = noKeychain(error);
  if (keychain !== undefined) return keychain.message;
  const github = githubMessage(error);
  if (github !== undefined) return github;
  log(`importing from gh: ${error instanceof Error ? error.message : String(error)}`);
  return "Lo couldn't import the account.";
}
