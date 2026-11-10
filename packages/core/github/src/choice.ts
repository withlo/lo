/**
 * Which account a pull request opens with (`docs/design.md`, "Sign-in"): the one that can see its
 * repository, else the one remembered for it, else ask.
 */

import type { GithubError, HelpLink } from './errors.ts';
import type { RepoRef } from './refs.ts';

/**
 * The accounts remembered for a repository: one chosen for it alone, because its owner's couldn't
 * see it, and the one chosen for its owner. Removed accounts aren't remembered.
 */
export interface Remembered {
  repo?: string | undefined;
  owner?: string | undefined;
}

/** The account that opens the repository, which is never swapped for another: its own, else its owner's. */
export function chosenAccount(remembered: Remembered): string | undefined {
  return remembered.repo ?? remembered.owner;
}

/** The remembered account among `logins`, as `logins` spells it, the repository's own first. */
export function pickRemembered(
  remembered: Remembered,
  logins: readonly string[],
): string | undefined {
  const find = (login: string | undefined) =>
    login === undefined ? undefined : logins.find((each) => sameLogin(each, login));
  return find(remembered.repo) ?? find(remembered.owner);
}

/** Which account to open a repository's pull requests with. */
export type AccountChoice =
  | { kind: 'account'; login: string }
  /**
   * Several accounts can see the repository and none of them was chosen for it: ask, then
   * remember the answer for the owner, or for the repository alone when the owner's account is
   * another one.
   */
  | { kind: 'ask'; logins: string[] }
  /**
   * The account remembered for the repository, its own or its owner's, can't check it just now:
   * it's signed out, its token can't be read, or GitHub didn't answer yes or "not found". The
   * problems say why. Lo doesn't fall back to another account, which would review as someone
   * else.
   */
  | { kind: 'unavailable'; login: string }
  /** No signed-in account can see it, as far as GitHub said. */
  | { kind: 'none' };

/** An account GitHub gave an answer other than yes or "not found", with its error. */
export interface Problem {
  login: string;
  error: GithubError;
}

/** What checking which accounts can see a repository found. */
export interface RepoAccount {
  /**
   * The repository as GitHub names it now (its `full_name`), which can differ from the one asked
   * about after a rename or transfer. As asked when no account could see it.
   */
  repo: RepoRef;
  choice: AccountChoice;
  /** The accounts that can see the repository. */
  visible: string[];
  /** The accounts remembered for the repository, by the name GitHub gives it now. */
  remembered: Remembered;
  /**
   * The accounts GitHub gave an answer other than yes or "not found": a refused token, a rate
   * limit, single sign-on, an organization's OAuth restriction or a server error.
   * {@link GithubError.helpLink} has GitHub's link to fix it, where there is one.
   */
  problems: Problem[];
}

/** Picks among the accounts that can see a repository: the only one, else the one remembered for it, its own before its owner's, else ask. */
export function chooseAccount(visible: readonly string[], remembered: Remembered): AccountChoice {
  const [only, ...others] = visible;
  if (only === undefined) return { kind: 'none' };
  if (others.length === 0) return { kind: 'account', login: only };
  const login = pickRemembered(remembered, visible);
  return login === undefined ? { kind: 'ask', logins: [...visible] } : { kind: 'account', login };
}

/** Who a tab acts as on GitHub: a signed-in account, or nobody, for a public repository read without signing in. */
export type Acting = { kind: 'account'; login: string } | { kind: 'anonymous' };

/** What to do about the account a pull request opens with. */
export type AccountDecision =
  | { kind: 'open'; acting: Acting }
  /** Several accounts can see the repository and none of them was chosen for it. */
  | { kind: 'ask'; logins: string[] }
  /** No account can open it, and GitHub said why. */
  | { kind: 'refuse'; refusal: AccountRefusal };

/**
 * Why Lo won't open a pull request with any account: the account remembered for its repository,
 * or for its owner, can't check the repository, or no account could and GitHub said why. Lo
 * doesn't fall back to another account, which would review as someone else, nor open it without
 * signing in, which would hide what's wrong. GitHub's links say how to fix it, such as authorizing
 * single sign-on.
 */
export interface AccountRefusal {
  message: string;
  links: HelpLink[];
  /** Whether waiting may fix every problem behind it, such as a server error or a rate limit, so Lo tries again by itself. */
  waitable: boolean;
}

/**
 * Decides from what checking the accounts found, or from nothing when Lo keeps no accounts. A pull
 * request opens with the account that can see its repository, and without signing in when none
 * can and none ran into anything else, which works for public repositories. Messages name the
 * repository as GitHub does now.
 */
export function decideAccount(found: RepoAccount | undefined): AccountDecision {
  if (found === undefined) return { kind: 'open', acting: { kind: 'anonymous' } };
  const { repo, choice } = found;
  switch (choice.kind) {
    case 'account':
      return { kind: 'open', acting: { kind: 'account', login: choice.login } };
    case 'ask':
      return { kind: 'ask', logins: [...choice.logins] };
    case 'none': {
      // GitHub refusing a token signs its account out, which then counts as not signed in, as it
      // would had it been signed out before the check.
      const problems = found.problems.filter(({ error }) => !error.isUnauthorized());
      if (problems.length === 0) return { kind: 'open', acting: { kind: 'anonymous' } };
      const said = problems.map(({ login, error }) => `${login}: ${describe(error)}`);
      return {
        kind: 'refuse',
        refusal: {
          message: `No account Lo is signed in to could check ${repo.toString()}, so it didn't open without signing in. ${said.join('; ')}`,
          links: problems.flatMap(({ error }) => error.helpLink() ?? []),
          waitable: problems.every(({ error }) => error.isWaitable()),
        },
      };
    }
    case 'unavailable': {
      const { login } = choice;
      const problem = found.problems.find((each) => sameLogin(each.login, login))?.error;
      const why = problem === undefined ? "GitHub didn't say why" : describe(problem);
      const forRepo =
        found.remembered.repo !== undefined && sameLogin(found.remembered.repo, login);
      const usesFor = forRepo ? repo.toString() : repo.owner;
      const link = problem?.helpLink();
      return {
        kind: 'refuse',
        refusal: {
          message: `${login}, the account Lo uses for ${usesFor}, couldn't check ${repo.toString()}: ${why}`,
          links: link === undefined ? [] : [link],
          waitable: problem?.isWaitable() ?? false,
        },
      };
    }
    default:
      return choice satisfies never;
  }
}

/** Whether two logins are the same account's: GitHub's logins ignore (ASCII) case. */
export function sameLogin(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/** GitHub's message, and its link to fix it, where there's one. */
function describe(error: GithubError): string {
  const link = error.helpLink();
  return link === undefined ? error.message : `${error.message} (${link.url})`;
}
