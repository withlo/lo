// Signing in with GitHub's device flow, one sign-in at a time: Lo asks GitHub for a code, the window
// shows it, the person enters it on GitHub's page, and Lo polls until GitHub hands over a token,
// as often as GitHub allows (its `interval`, and `slow_down`). Lo checks whose token it is and that
// it has Lo's scopes, then keeps it. Cancelling, or another sign-in, stops the polling at once.
// Nothing here calls Electron, so it runs under unit tests with a `fetch` that replays GitHub.
//
// The token never leaves main: what the window hears is the code to enter, then who signed in, or
// why it didn't.

import {
  checkToken,
  DeviceFlowError,
  GithubError,
  requestCodes,
  waitForToken,
  type AuthenticatedUser,
  type DeviceCodes,
  type GitHubUrls,
  type Grant,
} from '@lo/github';

import type { SignInFailure, SignInState } from '../contract.ts';
import { noKeychain } from './errors.ts';
import { checkedUser } from './users.ts';

export interface SignInsOptions {
  /** The `fetch` the sign-in talks to GitHub through. */
  fetch: typeof globalThis.fetch;
  urls: GitHubUrls;
  /** Why Lo can't keep a token just now, in words for the person, or nothing when it can. */
  keyring: () => Promise<string | undefined>;
  /** Keeps the account, its token in the system's keychain. */
  add: (user: AuthenticatedUser, grant: Grant) => Promise<void>;
  /** Tells the window how the sign-in is going. */
  publish: (state: SignInState) => void;
  /** Where to report what went wrong, never with a token in it. */
  log: (message: string) => void;
  /** Milliseconds since the Unix epoch, now: the computer's clock unless said otherwise. */
  now?: (() => number) | undefined;
}

/** The sign-in running, if any. */
interface Running {
  readonly id: number;
  readonly controller: AbortController;
  /** GitHub's codes, once it gave them. */
  codes: DeviceCodes | undefined;
}

/** A code GitHub gives the user to type, such as `4F2K-9QXD`: what the window may show. */
const USER_CODE = /^[A-Za-z0-9-]{1,32}$/;

/** Why the sign-in stopped, as its signal's reason, so its end isn't taken for a failure. */
class Stopped extends Error {
  override name = 'Stopped';
}

/** Lo's sign-ins through GitHub's device flow, one at a time. */
export class SignIns {
  readonly #options: SignInsOptions;
  readonly #now: () => number;
  #running: Running | undefined;
  #count = 0;
  #stopped = false;

  constructor(options: SignInsOptions) {
    this.#options = options;
    this.#now = options.now ?? Date.now;
  }

  /**
   * Starts a sign-in, stopping any other, and answers with the code to show, or why there's none.
   * First it makes sure Lo can keep a token, so nobody goes through GitHub's page for a token Lo
   * would refuse. The rest of the sign-in goes to {@link SignInsOptions.publish}.
   */
  async start(): Promise<SignInState> {
    this.cancel();
    const id = ++this.#count;
    const running: Running = { id, controller: new AbortController(), codes: undefined };
    this.#running = running;
    const { signal } = running.controller;
    if (this.#stopped) running.controller.abort(new Stopped('Lo is quitting.'));
    try {
      const problem = await this.#options.keyring();
      signal.throwIfAborted();
      if (problem !== undefined) return this.#end(running, failed(id, 'noKeyring', problem));
      const web = { fetch: this.#options.fetch, urls: this.#options.urls, signal };
      const codes = await requestCodes(web);
      signal.throwIfAborted();
      if (!USER_CODE.test(codes.userCode)) {
        return this.#end(
          running,
          failed(id, 'refused', "GitHub's answer had a code Lo can't show."),
        );
      }
      running.codes = codes;
      const waiting: SignInState = {
        kind: 'waiting',
        id,
        userCode: codes.userCode,
        expiresAt: this.#now() + codes.expiresIn * 1000,
        page: shownAddress(codes.verificationUrl),
      };
      void this.#finish(running, codes);
      return waiting;
    } catch (error) {
      if (signal.aborted) return { kind: 'cancelled', id };
      return this.#end(running, failure(id, error, this.#options.log));
    }
  }

  /** Stops the sign-in `id`, or whichever is running: no more polls go to GitHub. */
  cancel(id?: number): void {
    const running = this.#running;
    if (running === undefined || (id !== undefined && running.id !== id)) return;
    this.#running = undefined;
    running.controller.abort(new Stopped('The sign-in was cancelled.'));
  }

  /**
   * The code the sign-in `id` waits for, and the page to enter it on, or nothing once it's no
   * longer waiting.
   */
  waiting(id: number): { userCode: string; page: string } | undefined {
    const running = this.#running;
    if (running?.id !== id || running.codes === undefined) return undefined;
    return { userCode: running.codes.userCode, page: running.codes.verificationUrl };
  }

  /** Stops the sign-in running, and starts no more. Run once, as Lo quits. */
  stop(): void {
    this.#stopped = true;
    this.cancel();
  }

  /** Polls until GitHub hands over a token, then keeps the account, and tells the window how. */
  async #finish(running: Running, codes: DeviceCodes): Promise<void> {
    const { id, controller } = running;
    const { signal } = controller;
    const web = { fetch: this.#options.fetch, urls: this.#options.urls, signal };
    try {
      const grant = await waitForToken(web, codes);
      signal.throwIfAborted();
      running.codes = undefined;
      this.#options.publish({ kind: 'checking', id });
      const user = checkedUser(await checkToken(web, grant.token));
      signal.throwIfAborted();
      // The keyring may have gone since the sign-in started.
      const problem = await this.#options.keyring();
      if (problem !== undefined) {
        this.#end(running, failed(id, 'noKeyring', problem));
        return;
      }
      await this.#options.add(user, grant);
      this.#end(running, {
        kind: 'signedIn',
        id,
        login: user.user.login,
        name: user.user.name ?? null,
      });
    } catch (error) {
      if (signal.aborted) return;
      this.#end(running, failure(id, error, this.#options.log));
    }
  }

  /** Ends `running` with `state`, telling the window, unless another sign-in took its place. */
  #end(running: Running, state: SignInState): SignInState {
    if (this.#running === running) this.#running = undefined;
    running.codes = undefined;
    if (!running.controller.signal.aborted) this.#options.publish(state);
    return state;
  }
}

/** The page the code is entered on, as the window shows it: without its scheme. */
function shownAddress(url: string): string {
  return url.replace(/^https?:\/\//, '');
}

function failed(id: number, why: SignInFailure, message: string): SignInState {
  return { kind: 'failed', id, why, message };
}

/** Why the sign-in `id` ended without an account, from what it threw. */
function failure(id: number, error: unknown, log: (message: string) => void): SignInState {
  const keychain = noKeychain(error);
  if (keychain !== undefined) return failed(id, 'noKeyring', keychain.message);
  if (error instanceof DeviceFlowError) {
    const { detail } = error;
    switch (detail.kind) {
      case 'expired':
        return failed(id, 'expired', 'The code expired before it was entered on GitHub.');
      case 'denied':
        return failed(id, 'denied', 'The sign-in was cancelled on GitHub.');
      case 'refused':
        return failed(id, 'refused', error.message);
      case 'missingScopes':
        return failed(id, 'missingScopes', error.message);
      default:
        detail satisfies never;
        return failed(id, 'failed', "The sign-in ended in a way Lo doesn't know.");
    }
  }
  if (error instanceof GithubError) {
    if (error.detail.kind === 'network') {
      return failed(id, 'offline', `Lo couldn't reach GitHub: ${error.message}`);
    }
    return failed(id, 'refused', `GitHub refused the sign-in: ${error.message}`);
  }
  log(`signing in: ${error instanceof Error ? error.message : String(error)}`);
  return failed(id, 'failed', "Lo couldn't keep the account. Try signing in again.");
}
