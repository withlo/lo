// Where each bot's picture is. GitHub keeps a GitHub App's bot's picture at an address its login
// doesn't name (`avatars.githubusercontent.com/in/<app id>`), which only GitHub's answer for the
// bot's account gives (`@lo/github`'s `botAvatar`).
//
// - **How often:** each bot is asked about at most once a run, and 100 bots at most, one at a
//   time. What GitHub said is kept for the run: where the picture is, or that it has none, as for
//   a bot it doesn't have (`404`).
// - **When not:** after an ask fails, nothing is asked for a minute, then for twice as long after
//   each failure in a row, an hour at most. A bot not asked about keeps its initials, and is asked
//   about the next time it's drawn.
// - **As whom** is the asker's to say (`comments/main/index.ts`): an account, in its queue.

import { AVATAR_HOST, ImageError } from './images.ts';

/** What asking GitHub about a bot came to. */
export type BotAnswer =
  /** Where GitHub says the bot's picture is, unchecked. */
  | { kind: 'found'; avatar: string }
  /** GitHub has no such bot, or the account isn't a bot. */
  | { kind: 'none' }
  /** GitHub wasn't asked, for `why`, such as there being no account to ask as. */
  | { kind: 'later'; why: string };

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
  /** Asks GitHub about bot `login`, by its app's slug. Throws when the ask fails. */
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
    this.#failures = 0;
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
