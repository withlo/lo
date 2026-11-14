// What the accounts feature offers the others in main: GitHub, as the accounts Lo is signed in to.

import type {
  Account,
  GithubClient,
  GitHubUrls,
  Poller,
  PullRef,
  RecentPull,
  RepoAccount,
  RepoRef,
  SignedOut,
  Token,
} from '@lo/github';

import { defineService } from '../../main/services.ts';

/** An account and how it is: why it's signed out, if it is. */
export interface AccountState {
  account: Account;
  signedOut: SignedOut | undefined;
  /**
   * Whether the keychain keeps refusing the account's renewed token, which Lo uses all the same,
   * but loses if it quits first.
   */
  cantSave: boolean;
  /**
   * Whether its token was last refused for want of a keychain to read or keep it with, such as a
   * Linux desktop where no keyring answers. It stays signed in, and its token is kept, but Lo can't
   * use it until a keyring answers.
   */
  needsKeyring: boolean;
}

/** What happened to an account, or what its poller saw. */
export type GithubEvent =
  /** The account was signed out, once each time it is. */
  | { kind: 'signedOut'; login: string; why: SignedOut }
  /** The account was removed. Each feature forgets what it kept for it. */
  | { kind: 'removed'; login: string }
  /** The keychain keeps refusing the account's renewed token (see {@link AccountState.cantSave}). */
  | { kind: 'cantSave'; login: string }
  /** What `cantSave` warned of is over. */
  | { kind: 'cantSaveOver'; login: string }
  /**
   * The account's poller saw these heads of a pull request, at `at`, in milliseconds since the
   * Unix epoch: once for each answer that brings them anew.
   */
  | { kind: 'seen'; login: string; pull: PullRef; heads: readonly string[]; at: number };

/**
 * GitHub, as Lo is signed in to it: each account's client and poller, the account to open a
 * repository with, a client for public repositories, and the pull requests opened lately. Tokens
 * stay in main: a client holds its account's, and nothing here hands one to the window.
 */
export interface GithubAccess {
  /** GitHub's addresses: github.com's, or a test server's. */
  readonly urls: GitHubUrls;
  /** A client signed in as nobody, for public repositories: not polled, and never recent. */
  readonly anonymous: GithubClient;
  /** Every account, oldest first, and how each is. */
  accounts(): Promise<AccountState[]>;
  /**
   * The account's client. Throws a `GithubError`: `unauthorized` for an account that's signed out
   * or unknown, `tokenUnavailable` when its token can't be read just now.
   */
  client(login: string): Promise<GithubClient>;
  /**
   * The account's poller, which polls only what it's asked to watch, faster while Lo is in the
   * foreground. Throws for an account Lo doesn't have.
   */
  poller(login: string): Promise<Poller>;
  /**
   * The account to open `repo` with: the one that can see it, or the one remembered for it, or a
   * question for the user. Each account's check waits its turn in its poller's queue.
   */
  accountForRepo(repo: RepoRef): Promise<RepoAccount>;
  /** Remembers the account to open an owner's repositories with. */
  rememberAccountForOwner(owner: string, login: string): Promise<void>;
  /** Remembers the account to open one repository with, over its owner's. */
  rememberAccountForRepo(repo: RepoRef, login: string): Promise<void>;
  /** The pull requests opened most recently, newest first, `limit` at most. */
  recent(limit?: number): RecentPull[];
  /** Forgets a pull request opened under a name its repository no longer has. */
  forgetRecent(pull: PullRef): void;
  /** Forgets every answer the pollers kept, never the accounts or the recent pull requests. */
  clearAnswers(): void;
  /**
   * gh's token for `login`, for one upload GitHub took none of with Lo's own: read from gh afresh
   * each time it's asked, checked with GitHub to be the account's, and never kept or logged.
   * Nothing when gh has none for the account, as without gh. Throws when gh or GitHub couldn't be
   * asked.
   */
  ghToken(login: string): Promise<Token | undefined>;
  /** Calls `listener` with each {@link GithubEvent}, until the returned function is called. */
  onEvent(listener: (event: GithubEvent) => void): () => void;
}

export const github = defineService<GithubAccess>('accounts.github');
