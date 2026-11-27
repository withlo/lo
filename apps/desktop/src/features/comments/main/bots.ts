// Where each bot's picture is. GitHub keeps a GitHub App's bot's picture at an address its login
// doesn't name (`avatars.githubusercontent.com/in/<app id>`), which only GitHub's answer for the
// bot's account gives (`@lo/github`'s `botAvatar`).
//
// - **How often:** each bot is asked about at most once a run, and 100 bots at most, one at a
//   time. What GitHub said is kept for the run: where the picture is, or that it has none, as for
//   a bot it doesn't have (`404`).
// - **From run to run:** where a bot's picture is, once GitHub has said, is kept in the feature's
//   table (`BotTable`), so a bot seen before is drawn at once. It's still asked about once a run,
//   as any bot is, and what's kept follows: a picture that moved is kept where it is now and drawn
//   again (`changed`), and a bot GitHub has no more, or whose kept picture didn't load before
//   GitHub was asked (`missing`), is no longer kept. Only a bot never seen waits for its ask,
//   behind the reads the tab opens with. Clearing the cache clears the table.
// - **As whom** (`askGitHub`): the first account signed in, in its queue as a background read, and
//   only while GitHub answers it and its rate limit is normal. With no account signed in, a bot
//   not kept keeps its initials: a tab acting as nobody shows no comments.
// - **When not:** while the account can't ask, nothing is, until its poller hears from GitHub
//   again. After an ask GitHub answered with an error, nothing is asked for a minute, then for
//   twice as long after each failure in a row, an hour at most, unless an account is added or
//   signs in again first (`release`). A bot not asked about keeps its initials, and is asked about
//   the next time it's drawn.

import { botAvatar, type Poller } from '@lo/github';

import type { Database } from '../../../main/database.ts';
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
  /** Where bots' pictures are kept from run to run. Without it, only for the run. */
  kept?: KeptBots | undefined;
  /**
   * Called when bot `slug`'s picture, drawn from where an earlier run kept it, changes once GitHub
   * is asked: it moved, or GitHub has no such bot now, or no picture for it.
   */
  changed?: ((slug: string) => void) | undefined;
}

/** Finds and keeps where each bot's picture is. */
export class BotPictures {
  readonly #ask: (login: string) => Promise<BotAnswer>;
  readonly #now: () => number;
  readonly #limits: BotLimits;
  readonly #kept: KeptBots | undefined;
  readonly #changed: (slug: string) => void;
  /** The bots drawn from where an earlier run kept their picture, that GitHub hasn't answered for. */
  readonly #unchecked = new Set<string>();
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
    this.#kept = options.kept;
    this.#changed = (slug) => options.changed?.(slug);
  }

  /**
   * Where bot `login`'s picture is, on the avatars' host, with no size: known this run, kept from
   * an earlier one, or asked about. Throws an {@link ImageError}.
   */
  picture(login: string): Promise<URL> {
    const key = login.toLowerCase();
    const known = this.#known.get(key) ?? this.#keptPicture(key);
    if (known !== undefined) {
      // Drawn from where it was kept, and asked about all the same, in its turn.
      if (this.#unchecked.has(key)) this.#check(login, key);
      return typeof known === 'string'
        ? Promise.reject(new ImageError('refused', known))
        : Promise.resolve(new URL(known));
    }
    return this.#inLine(login, key).then((address) => new URL(address));
  }

  /**
   * Bot `login`'s picture didn't load from `address`: where an earlier run kept it goes, if that's
   * where it was drawn from and GitHub hasn't answered for it yet, and GitHub is asked.
   */
  missing(login: string, address: URL): void {
    const key = login.toLowerCase();
    const known = this.#known.get(key);
    if (!this.#unchecked.has(key) || !(known instanceof URL)) return;
    if (known.pathname !== address.pathname) return;
    this.#unchecked.delete(key);
    this.#known.delete(key);
    this.#forget(key);
  }

  /** Asks GitHub about bot `login` in turn, once at a time. */
  #inLine(login: string, key: string): Promise<URL> {
    let asking = this.#asking.get(key);
    if (!asking) {
      const turn = this.#line.then(() => this.#lookUp(login, key));
      this.#line = turn.catch(() => undefined);
      asking = turn.finally(() => this.#asking.delete(key));
      this.#asking.set(key, asking);
    }
    return asking;
  }

  /**
   * Asks GitHub about bot `login`, drawn from where it was kept, as any bot is asked about: once
   * it answers, what's kept follows what it said, and a change is told (`changed`). While GitHub
   * can't say, what was kept stays, and it's asked again the next time it's drawn.
   */
  #check(login: string, key: string): void {
    if (this.#asking.has(key)) return;
    const kept = this.#known.get(key);
    void this.#inLine(login, key).then(
      (address) => {
        this.#unchecked.delete(key);
        if (!(kept instanceof URL) || kept.href !== address.href) this.#changed(key);
      },
      () => {
        // Only an answer that there's no picture to draw is a change: GitHub has no such bot.
        if (typeof this.#known.get(key) !== 'string') return;
        this.#unchecked.delete(key);
        this.#forget(key);
        this.#changed(key);
      },
    );
  }

  /** Keeps bot `key` no more. A table that can't be written keeps it until it's asked about. */
  #forget(key: string): void {
    try {
      this.#kept?.forget(key);
    } catch {
      // Asked about again next run, which corrects it.
    }
  }

  /** Where bot `key`'s picture is, as kept from an earlier run, now known for this one. */
  #keptPicture(key: string): URL | undefined {
    let path: string | undefined;
    try {
      path = this.#kept?.read(key);
    } catch {
      // What can't be read is asked about, as if it had never been kept.
      return undefined;
    }
    // Read as GitHub's answer is: only an app's or an account's picture, on the avatars' host.
    const address =
      path === undefined ? undefined : pictureAddress(`https://${AVATAR_HOST}${path}`);
    if (address) {
      this.#known.set(key, address);
      this.#unchecked.add(key);
    }
    return address;
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
      try {
        this.#kept?.keep(key, address.pathname);
      } catch {
        // Known for the run all the same: a picture that can't be kept for later is drawn now.
      }
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

/**
 * Where bots' pictures are kept from run to run: where GitHub said each one's is, on the avatars'
 * host, as a path (`/in/1210556`), by the bot's slug in lowercase.
 */
export interface KeptBots {
  /** Where bot `slug`'s picture is, as kept, or nothing. */
  read(slug: string): string | undefined;
  /** Keeps where bot `slug`'s picture is, `path` on the avatars' host. */
  keep(slug: string, path: string): void;
  /** Keeps bot `slug` no more. */
  forget(slug: string): void;
}

/** The most bots whose pictures are kept: those GitHub was asked about last. */
export const KEPT_BOTS = 500;

/** Bots' pictures, kept in the feature's table (`comments_bots`), the newest {@link KEPT_BOTS}. */
export class BotTable implements KeptBots {
  readonly #database: Database;
  readonly #now: () => number;
  readonly #most: number;

  constructor(database: Database, now: () => number = Date.now, most = KEPT_BOTS) {
    this.#database = database;
    this.#now = now;
    this.#most = most;
  }

  read(slug: string): string | undefined {
    const row = this.#database
      .prepare('SELECT picture FROM comments_bots WHERE slug = ?')
      .get(slug);
    return row === undefined ? undefined : String(row.picture);
  }

  keep(slug: string, path: string): void {
    this.#database.transaction(() => {
      this.#database
        .prepare(
          'INSERT INTO comments_bots (slug, picture, at) VALUES (?, ?, ?) ON CONFLICT (slug) DO UPDATE SET picture = excluded.picture, at = excluded.at',
        )
        .run(slug, path, this.#now());
      this.#database
        .prepare(
          'DELETE FROM comments_bots WHERE slug NOT IN (SELECT slug FROM comments_bots ORDER BY at DESC, slug LIMIT ?)',
        )
        .run(this.#most);
    });
  }

  forget(slug: string): void {
    this.#database.prepare('DELETE FROM comments_bots WHERE slug = ?').run(slug);
  }

  /** Keeps no bot, as clearing the cache does. */
  clear(): void {
    this.#database.prepare('DELETE FROM comments_bots').run();
  }
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
