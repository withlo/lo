// Where updates stand, and what each request does to it. A check asks the feed for its newest
// release and offers it only when this Lo takes it: newer, and a prerelease only to a prerelease.
// Lo gives up on a check the feed doesn't answer in time, and nothing that check finds afterwards
// counts. A download starts only when the window asks to install, and only where Lo installs
// updates itself; once it's done, the update waits to install as Lo quits. Lo restarts into it only
// when the window asks: it quits as on any quit, stopping every feature, and only once that stop has
// finished does it hand over to the installer. Nothing here calls Electron, so it runs under unit
// tests.

import { IpcError } from '../../../ipc/contract.ts';
import {
  BREW_UPGRADE,
  releasePage,
  type CheckAnswer,
  type How,
  type UpdateState,
} from '../contract.ts';
import { reasonOf } from './log.ts';
import { firstLine } from './notes.ts';
import { takes } from './versions.ts';

/** How long Lo waits for the installer to quit it before it quits by itself, in ms. */
export const INSTALL_LIMIT = 15_000;

/** How long Lo waits for the feed to answer a check before it gives up on it, in ms. */
export const CHECK_LIMIT = 60_000;

/** Why a check Lo gave up on failed, in words for the reader. */
export const UNANSWERED = `GitHub didn’t answer within ${CHECK_LIMIT / 1000} s. Check your connection, then try again.`;

/** Why a check failed as Lo quit. */
const QUITTING = 'Lo is quitting.';

/** The newest release a feed offers, as electron-updater read it. */
export interface Release {
  readonly version: string;
  /** Its notes, as electron-updater gives them: text, HTML, a list of them, or nothing. */
  readonly notes: unknown;
}

/** What Lo needs of electron-updater, so everything else here runs without it. */
export interface Updater {
  /**
   * Asks the feed for its newest release, until `signal` aborts: then the check is dropped, so it
   * fails, and the next one asks the feed again.
   */
  check(signal: AbortSignal): Promise<Release>;
  /**
   * Downloads the release the last check found, checks it, and readies it to install as Lo quits,
   * calling `progress` as bytes come. Resolves once it's ready.
   */
  download(progress: (received: number, total: number) => void): Promise<void>;
  /** Drops a download that's going. */
  cancel(): void;
  /**
   * Quits Lo, installs the update that's ready, and starts Lo again. Rejects when the installer
   * can't; on success, Lo quits before it would resolve.
   */
  install(): Promise<void>;
}

/** An event Lo is quitting on, which a listener can hold off. */
export interface QuitEvent {
  readonly defaultPrevented: boolean;
  preventDefault(): void;
}

export interface UpdatesOptions {
  /** This Lo's version. */
  readonly current: string;
  /**
   * How this copy of Lo takes a newer version now. It's asked for each offer, and again before Lo
   * moves itself or downloads one, since the reader may move Lo while it runs.
   */
  how(): How;
  /** electron-updater, when this copy of Lo checks; or why it doesn't. */
  readonly updater: Updater | { readonly unchecked: string };
  publish(state: UpdateState): void;
  log(line: string): void;
  /** Quits Lo, as any quit does. */
  quit(): void;
  /**
   * Moves Lo to Applications and starts it again from there: `false` when the reader said not to.
   * Throws when the move fails.
   */
  move(): boolean;
}

export class Updates {
  readonly #options: UpdatesOptions;
  #state: UpdateState = { status: 'idle' };
  /** The version the reader hid until Lo starts again. */
  #hidden: string | undefined;
  /** The check going now, which every check asked for meanwhile shares. */
  #checking: Promise<Release> | undefined;
  /** What gives up on the check going now. */
  #giveUp: AbortController | undefined;
  /** Lo is quitting to restart into the update that's ready. */
  #restarting = false;
  #stopped = false;

  constructor(options: UpdatesOptions) {
    this.#options = options;
  }

  get state(): UpdateState {
    return this.#state;
  }

  /**
   * Checks the feed: `asked`, when the reader asked, which offers a hidden update again and says
   * what it found; otherwise by itself, which logs a failure and leaves things as they are.
   */
  async check(asked: boolean): Promise<CheckAnswer> {
    const { updater, current } = this.#options;
    if (!('check' in updater)) return { status: 'failed', reason: updater.unchecked };
    const before = this.#state;
    // The update is chosen: Lo is getting it, or has it.
    if (before.status === 'downloading' || before.status === 'ready') return before;
    let release: Release;
    try {
      this.#checking ??= this.#ask(updater);
      release = await this.#checking;
    } catch (error) {
      if (this.#stopped) return { status: 'failed', reason: QUITTING };
      const reason = error instanceof Unanswered ? UNANSWERED : reasonOf(error, 'check');
      this.#options.log(`couldn't check for updates: ${reason}`);
      return { status: 'failed', reason };
    }
    const now = this.#state;
    if (now.status === 'downloading' || now.status === 'ready') return now;
    if (this.#stopped) return { status: 'failed', reason: QUITTING };
    // Never an older version, one Lo isn't released as, nor a prerelease to a release, whatever
    // electron-updater decided. What it decided is what it would download, so an offer of
    // something else is taken back.
    if (!takes(current, release.version)) {
      if (now.status === 'available') this.#publish({ status: 'idle' });
      return { status: 'newest', version: current };
    }
    if (asked) this.#hidden = undefined;
    if (release.version === this.#hidden) return { status: 'newest', version: current };
    const how = this.#options.how();
    if (now.status === 'available' && now.version === release.version) {
      if (now.how === how) return now;
      const moved = { ...now, how };
      this.#publish(moved);
      return moved;
    }
    const offer: UpdateState = {
      status: 'available',
      version: release.version,
      line: firstLine(release.notes),
      how,
      page: releasePage(release.version),
    };
    this.#publish(offer);
    return offer;
  }

  /**
   * Asks the feed, giving up once it hasn't answered within {@link CHECK_LIMIT}: the check then
   * fails as {@link Unanswered}, the updater drops it, and what it answers afterwards counts for
   * nothing, so the next check asks again.
   */
  #ask(updater: Updater): Promise<Release> {
    const giveUp = new AbortController();
    this.#giveUp = giveUp;
    const limit = setTimeout(() => giveUp.abort(new Unanswered()), CHECK_LIMIT);
    const checking = new Promise<Release>((resolve, reject) => {
      giveUp.signal.addEventListener('abort', () => reject(abortedBy(giveUp.signal)), {
        once: true,
      });
      updater.check(giveUp.signal).then(resolve, reject);
    }).finally(() => {
      clearTimeout(limit);
      if (this.#giveUp === giveUp) this.#giveUp = undefined;
      // A check given up on settles after the next has started: it leaves that one be.
      if (this.#checking === checking) this.#checking = undefined;
    });
    return checking;
  }

  /**
   * Decides again how this copy of Lo takes a newer version, and, when that changed, says so with
   * the offer.
   */
  #decide(): How {
    const how = this.#options.how();
    const state = this.#state;
    if (state.status === 'available' && state.how !== how) this.#publish({ ...state, how });
    return how;
  }

  /**
   * Downloads the update on offer, where Lo installs updates itself. A download that fails goes
   * back to the offer, with why.
   */
  install(): void {
    const { updater } = this.#options;
    // Lo may have been moved since the offer was made.
    if (this.#state.status === 'available') this.#decide();
    const offer = this.#state;
    if (offer.status !== 'available' || offer.how !== 'install' || !('download' in updater)) {
      throw new IpcError('unavailable', this.#whyNotInstall());
    }
    const { version } = offer;
    this.#publish({ status: 'downloading', version, received: 0, total: 0 });
    updater
      .download((received, total) => {
        if (this.#state.status !== 'downloading') return;
        this.#publish({ status: 'downloading', version, received, total });
      })
      .then(
        () => this.#publish({ status: 'ready', version }),
        (error: unknown) => {
          const failed = reasonOf(error, 'download');
          this.#options.log(`couldn't download Lo ${version}: ${failed}`);
          this.#publish({ ...offer, failed });
        },
      );
  }

  /** Why there's no update to install now, in words for the reader. */
  #whyNotInstall(): string {
    const state = this.#state;
    switch (state.status) {
      case 'idle':
        return 'There’s no update to install.';
      case 'available':
        return state.how === 'move'
          ? 'Lo can’t update itself from where it is. Move it to Applications first.'
          : state.how === 'brew'
            ? `You installed Lo with Homebrew, so update it there: ${BREW_UPGRADE}`
            : 'Lo can’t install updates here. Download it from its release page.';
      case 'downloading':
        return `Lo ${state.version} is downloading.`;
      case 'ready':
        return `Lo ${state.version} is ready. It installs when you quit, or now.`;
      default:
        throw new Error(
          `An update state Lo doesn't know: ${JSON.stringify(state satisfies never)}`,
        );
    }
  }

  /**
   * Quits Lo to restart into the update that's ready. Lo quits as on any quit; {@link willQuit}
   * hands over to the installer once everything has stopped.
   */
  restart(): void {
    const state = this.#state;
    if (state.status !== 'ready' || !('install' in this.#options.updater)) {
      throw new IpcError('unavailable', 'No update is ready to install.');
    }
    this.#restarting = true;
    this.#options.quit();
  }

  /**
   * Hears each `will-quit`. Lo's own listener, which hears it first, holds off each until every
   * feature has stopped; the first it lets through is Lo's last. When Lo is restarting into an
   * update, that one is held off too, and the installer quits Lo and starts the new one, with no
   * arguments. If it can't, Lo quits all the same, and the update installs then.
   */
  willQuit(event: QuitEvent): void {
    const { updater } = this.#options;
    if (!this.#restarting || event.defaultPrevented || !('install' in updater)) return;
    this.#restarting = false;
    event.preventDefault();
    const limit = setTimeout(() => {
      this.#options.log(`the installer didn't quit Lo within ${INSTALL_LIMIT} ms, so Lo quit`);
      this.#options.quit();
    }, INSTALL_LIMIT);
    // Not from inside the event: Electron ignores a quit asked for while it handles one.
    setImmediate(() => {
      updater.install().catch((error: unknown) => {
        clearTimeout(limit);
        this.#options.log(`couldn't install the update: ${reasonOf(error, 'download')}`);
        this.#options.quit();
      });
    });
  }

  /** Hides the update on offer until Lo starts again. */
  later(): void {
    const state = this.#state;
    if (state.status !== 'available') {
      throw new IpcError('unavailable', 'There’s no update to hide.');
    }
    this.#hidden = state.version;
    this.#publish({ status: 'idle' });
  }

  /**
   * Moves Lo to Applications, where it updates itself, when that's how this copy takes one, as Lo
   * decides again now.
   */
  move(): void {
    const how = this.#decide();
    if (how !== 'move') {
      throw new IpcError(
        'unavailable',
        how === 'page' ? 'Lo can’t move itself from here.' : 'Lo is in Applications already.',
      );
    }
    try {
      this.#options.move();
    } catch (error) {
      const why = error instanceof Error ? error.message : String(error);
      this.#options.log(`couldn't move to Applications: ${why}`);
      throw new IpcError('failed', `Lo couldn’t move itself to Applications: ${why}`);
    }
  }

  /**
   * Stops for good, as Lo quits: a check or a download going is dropped, and nothing more is
   * published.
   */
  stop(): void {
    this.#stopped = true;
    this.#giveUp?.abort(new Error(QUITTING));
    if (this.#state.status === 'downloading' && 'cancel' in this.#options.updater) {
      this.#options.updater.cancel();
    }
  }

  #publish(state: UpdateState): void {
    if (this.#stopped) return;
    this.#state = state;
    this.#options.publish(state);
  }
}

/** A check Lo gave up on: the feed didn't answer within {@link CHECK_LIMIT}. */
class Unanswered extends Error {
  constructor() {
    super(UNANSWERED);
    this.name = 'Unanswered';
  }
}

/** Why `signal` aborted, as an error. */
export function abortedBy(signal: AbortSignal): Error {
  const reason: unknown = signal.reason;
  return reason instanceof Error ? reason : new Error('Lo gave up on the check.');
}
