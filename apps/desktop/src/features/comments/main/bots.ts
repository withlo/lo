// Where each bot's picture is. GitHub keeps a GitHub App's bot's picture at an address its login
// doesn't name (`avatars.githubusercontent.com/in/<app id>`), which only GitHub's answer for the
// bot's account gives (`@lo/github`'s `botAvatar`).
//
// - **How often:** each bot is asked about at most once a run, and 100 bots at most, one at a
//   time. What GitHub said is kept for the run: where the picture is, or that it has none, as for
//   a bot it doesn't have (`404`).
// - **As whom** (`askGitHub`): the first account signed in, in its queue as a background read, and
//   only while GitHub answers it and its rate limit is normal. With no account signed in, a bot
//   keeps its initials: a tab acting as nobody shows no comments.
// - **When not:** while the account can't ask, nothing is, until its poller hears from GitHub
//   again. After an ask GitHub answered with an error, nothing is asked for a minute, then for
//   twice as long after each failure in a row, an hour at most, unless an account is added or
//   signs in again first (`release`). A bot not asked about keeps its initials, and is asked about
//   the next time it's drawn.

import { botAvatar, type Poller } from '@lo/github';

import { AVATAR_HOST, ImageError } from './images.ts';

/** What asking GitHub about a bot came to. */
export type BotAnswer =
  /** Where GitHub says the bot's picture is, unchecked. */
  | { kind: 'found'; avatar: string }
  /** GitHub has no such bot, or the account isn't a bot. */
  | { kind: 'none' }
  /** GitHub wasn't asked, for `why`, such as there being no account to ask as. */
  | { kind: 'later'; why: string }
  /**
   * GitHub didn't answer, and the account says why (`why`): it can't reach GitHub, or its rate
   * limit is low, which keeps asks off until its poller hears from GitHub again.
   */
  | { kind: 'unanswered'; why: string };

/** How much bots' pictures are asked about. */
export interface BotLimits {
  /** The most bots asked about in a run. */
  bots: number;
  /** How long nothing is asked after a failed ask, in milliseconds. */
  firstWait: number;
  /** The longest nothing is asked, after failures in a row, in milliseconds. */
  longestWait: number;
}

export const BOT_LIMITS: BotLimits = {
  bots: 100,
  firstWait: 60_000,
  longestWait: 60 * 60_000,
};

/**
 * Where on the avatars' host a bot's picture may be, as GitHub gives it: an app's (`/in/<id>`), or
 * an account's (`/u/<id>`).
 */
const BOT_AVATAR_PATH = /^\/(?:in|u)\/[1-9]\d{0,11}$/;

export interface BotPicturesOptions {
  /**
   * Asks GitHub about bot `login`, by its app's slug (`askGitHub`). Throws when the ask fails.
   */
  ask(login: string): Promise<BotAnswer>;
  /** Milliseconds, only ever forward. */
  now?: (() => number) | undefined;
  limits?: Partial<BotLimits> | undefined;
}

/** Finds and keeps where each bot's picture is. */
export class BotPictures {
  readonly #ask: (login: string) => Promise<BotAnswer>;
  readonly #now: () => number;
  readonly #limits: BotLimits;
  /**
   * What GitHub said of each bot, by its slug in lowercase: where its picture is, or why there's
   * none.
   */
  readonly #known = new Map<string, URL | string>();
  /** The bots being asked about, or waiting their turn, so two asks at once ask once. */
  readonly #asking = new Map<string, Promise<URL>>();
  /** The bots GitHub was asked about this run, or is being asked about. */
  readonly #asked = new Set<string>();
  /** The asks, one at a time: each starts once the one before has ended. */
  #line: Promise<unknown> = Promise.resolve();
  /** How many asks in a row failed. */
  #failures = 0;
  /** Until when, by `#now`, nothing is asked. */
  #heldUntil = Number.NEGATIVE_INFINITY;

  constructor(options: BotPicturesOptions) {
    this.#ask = (login) => options.ask(login);
    this.#now = options.now ?? (() => performance.now());
    this.#limits = { ...BOT_LIMITS, ...options.limits };
  }

  /**
   * Where bot `login`'s picture is, on the avatars' host, with no size: kept, or asked about.
   * Throws an {@link ImageError}.
   */
  picture(login: string): Promise<URL> {
    const key = login.toLowerCase();
    const known = this.#known.get(key);
    if (known !== undefined) {
      return typeof known === 'string'
        ? Promise.reject(new ImageError('refused', known))
        : Promise.resolve(new URL(known));
    }
    let asking = this.#asking.get(key);
    if (!asking) {
      const turn = this.#line.then(() => this.#lookUp(login, key));
      this.#line = turn.catch(() => undefined);
      asking = turn.finally(() => this.#asking.delete(key));
      this.#asking.set(key, asking);
    }
    return asking.then((address) => new URL(address));
  }

  /** Asks again at once, after a failure: something changed that may let an ask go. */
  release(): void {
    this.#failures = 0;
    this.#heldUntil = Number.NEGATIVE_INFINITY;
  }

  async #lookUp(login: string, key: string): Promise<URL> {
    const wait = this.#heldUntil - this.#now();
    if (wait > 0) {
      throw new ImageError(
        'failed',
        `asking GitHub about a bot failed, so it’s asked again in ${Math.ceil(wait / 1000)} s`,
      );
    }
    const first = !this.#asked.has(key);
    if (first && this.#asked.size >= this.#limits.bots) {
      throw new ImageError(
        'refused',
        `GitHub was asked about ${this.#limits.bots} bots this run, the most it’s asked about`,
      );
    }
    this.#asked.add(key);
    let answer: BotAnswer;
    try {
      answer = await this.#ask(login);
    } catch {
      // What GitHub said is no part of the error: only that it couldn't say.
      this.#failures += 1;
      const held = this.#limits.firstWait * 2 ** (this.#failures - 1);
      this.#heldUntil = this.#now() + Math.min(held, this.#limits.longestWait);
      throw new ImageError('failed', `GitHub couldn’t say where ${login}’s avatar is`);
    }
    if (answer.kind === 'later') {
      if (first) this.#asked.delete(key);
      throw new ImageError('failed', `GitHub wasn’t asked about ${login}: ${answer.why}`);
    }
    if (answer.kind === 'unanswered') {
      throw new ImageError('failed', `GitHub didn’t answer about ${login}: ${answer.why}`);
    }
    this.release();
    const address = answer.kind === 'found' ? pictureAddress(answer.avatar) : undefined;
    if (address) {
      this.#known.set(key, address);
      return address;
    }
    const why =
      answer.kind === 'none'
        ? `GitHub has no bot ${login}`
        : `GitHub has no avatar for ${login} on ${AVATAR_HOST}`;
    this.#known.set(key, why);
    throw new ImageError('refused', why);
  }
}

/**
 * The picture's address on the avatars' host, as GitHub gave it, with only its path: the size is
 * the window's, and nothing else GitHub said is kept. Nothing for one anywhere else.
 */
function pictureAddress(given: string): URL | undefined {
  const address = URL.parse(given);
  if (
    !address ||
    address.protocol !== 'https:' ||
    address.hostname !== AVATAR_HOST ||
    address.port !== '' ||
    address.username !== '' ||
    address.password !== '' ||
    !BOT_AVATAR_PATH.test(address.pathname)
  ) {
    return undefined;
  }
  return new URL(address.pathname, address.origin);
}

/** An account as asking needs it: its login, and whether its token can be used. */
export interface BotAccountState {
  account: { login: string };
  signedOut: unknown;
  needsKeyring: boolean;
}

/** What asking takes of an account's poller. */
export type BotPoller = Pick<Poller, 'login' | 'status' | 'readOnce'>;

/** What asking takes of Lo's GitHub accounts (`GithubAccess`). */
export interface BotAccounts {
  /** Every account, oldest first. */
  accounts(): Promise<readonly BotAccountState[]>;
  poller(login: string): Promise<BotPoller>;
}

/**
 * Asks GitHub about bot `login` as the first account signed in whose token can be read, in its
 * queue as a background read: it waits behind writes, reads someone is waiting on, and polls that
 * came first. Nothing is asked while that account can't ask (`later`). A failure the account then
 * shows, as it does when GitHub can't be reached or the rate limit runs low, is `unanswered`; any
 * other throws.
 */
export async function askGitHub(access: BotAccounts, login: string): Promise<BotAnswer> {
  const signedIn = (await access.accounts()).find(
    (state) => state.signedOut === undefined && !state.needsKeyring,
  );
  if (signedIn === undefined) return { kind: 'later', why: 'no account is signed in' };
  const poller = await access.poller(signedIn.account.login);
  const before = stall(poller);
  if (before !== undefined) return { kind: 'later', why: before };
  try {
    const avatar = await poller.readOnce(
      (client) => botAvatar(client, login),
      undefined,
      'background',
    );
    return avatar === undefined ? { kind: 'none' } : { kind: 'found', avatar };
  } catch (error) {
    const after = stall(poller);
    if (after !== undefined) return { kind: 'unanswered', why: after };
    throw error;
  }
}

/** Why `poller`'s account can't ask GitHub now, as its status says, or nothing when it can. */
function stall(poller: BotPoller): string | undefined {
  const { rateLimit, offline, signedOut } = poller.status();
  if (signedOut) return `${poller.login} is signed out`;
  if (offline !== undefined) return 'GitHub can’t be reached';
  if (rateLimit.kind !== 'normal') return `${poller.login}’s rate limit is low`;
  return undefined;
}
