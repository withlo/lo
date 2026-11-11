// Each account's grant, its access token and what renews it, kept in Lo's database encrypted by
// the system's keychain through Electron's `safeStorage`: one ciphertext per account, from its
// async API. A token is never written, logged or handed to the window in the clear.
//
// Where the system has no keychain to encrypt with, `safeStorage` falls back to a key every copy of
// Chromium knows: on Linux, when no keyring answers, and with Chromium's stand-in keychain for
// tests (`--use-mock-keychain`). A token kept that way is as good as plain text, so Lo refuses to
// keep or read one, except in a test run.
//
// On Linux, what the ciphertext is marked decides, never the store `safeStorage` reports: Chromium
// marks only its built-in key's `v10` (the Secret Service's and KWallet's are `v11`, the portal's
// `v12`). The report is the store chosen for the desktop, not the one that answered: a GNOME
// session whose keyring is dead says `gnome_libsecret` and encrypts with the built-in key, while
// sway, i3 or Hyprland say `basic_text` and get their key from the Secret Service. (On a Mac, the
// keychain's key is marked `v10` too, so the mark says nothing there.)

import { GithubError, Token, type Grant, type Refresh, type Secrets } from '@lo/github';
import { z } from 'zod';

import type { Database } from '../../../main/database.ts';
import { bytes } from './columns.ts';

/** What Lo uses of Electron's `safeStorage`: its async API. */
export interface SafeStorage {
  isAsyncEncryptionAvailable(): Promise<boolean>;
  encryptStringAsync(plainText: string): Promise<Uint8Array>;
  decryptStringAsync(encrypted: Buffer): Promise<{ shouldReEncrypt: boolean; result: string }>;
}

/** Where Lo runs, for whether the keychain `safeStorage` has is one Lo keeps tokens with. */
export interface Keychain {
  platform: NodeJS.Platform;
  /**
   * Whether this is a test run, a build run from source talking to a GitHub on this machine, where
   * a stand-in keychain is fine.
   */
  testRun: boolean;
  /** Whether Lo was started with Chromium's stand-in keychain, `--use-mock-keychain`. */
  mockKeychain: boolean;
}

/** What Lo tells someone on Linux whose system has no keyring that works. */
const NO_KEYRING =
  'Lo keeps your GitHub token in a keyring, such as GNOME Keyring or KWallet, and none answered. Install or unlock one, then start Lo again.';

/** How Chromium marks, on Linux, what it encrypted with its built-in key rather than a keyring's. */
const BUILT_IN_KEY = new TextEncoder().encode('v10');

/** Why Lo won't keep a token: the system has no keychain it can encrypt with. */
export class NoKeychain extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'NoKeychain';
  }
}

/** Whether `sealed` is marked as what Chromium encrypted with its built-in key, on Linux. */
function isBuiltInKey(sealed: Uint8Array): boolean {
  return BUILT_IN_KEY.every((byte, index) => sealed[index] === byte);
}

/**
 * Why Lo won't keep or read a token with `storage` now, in words for the person using Lo, or
 * nothing when it will. On Linux, what a ciphertext is marked decides as well
 * ({@link Grants}), since only encrypting shows whether a keyring answered.
 */
export async function keychainProblem(
  storage: SafeStorage,
  keychain: Keychain,
): Promise<string | undefined> {
  if (!(await storage.isAsyncEncryptionAvailable())) {
    return "Lo can't reach the system's keychain to keep your GitHub token safe.";
  }
  if (keychain.testRun) return undefined;
  if (keychain.mockKeychain) {
    return 'Lo was started with a stand-in keychain (--use-mock-keychain), which would leave your GitHub token unprotected.';
  }
  return undefined;
}

/** A grant as it's encrypted: the GitHub it's for, with its tokens. */
const sealedGrant = z.object({
  github: z.string(),
  token: z.string(),
  refresh: z
    .object({
      token: z.string(),
      issuedAt: z.number().optional(),
      expiresAt: z.number().optional(),
      refreshTokenExpiresAt: z.number().optional(),
    })
    .optional(),
});
type SealedGrant = z.output<typeof sealedGrant>;

export interface GrantsOptions {
  database: Database;
  storage: SafeStorage;
  keychain: Keychain;
  /**
   * The GitHub the grants are for: its API's address. A grant kept for another GitHub, such as
   * github.com's when Lo talks to a test server, is never read, so its token never goes there.
   */
  github: string;
}

/** Each account's grant, under its login, encrypted in the database. */
export class Grants implements Secrets {
  readonly #database: Database;
  readonly #storage: SafeStorage;
  readonly #keychain: Keychain;
  readonly #github: string;

  constructor(options: GrantsOptions) {
    this.#database = options.database;
    this.#storage = options.storage;
    this.#keychain = options.keychain;
    this.#github = options.github;
  }

  /**
   * The account's grant, or nothing when none is kept. Throws {@link NoKeychain} when there's no
   * keychain Lo keeps tokens with, and another error when the keychain can't decrypt it just now,
   * as when the user denies Lo the keychain: neither is taken for no grant, so neither signs the
   * account out. A grant that decrypts to something that isn't one throws GitHub's `unauthorized`,
   * since it can never work.
   */
  async read(login: string): Promise<Grant | undefined> {
    const row = this.#database
      .prepare('SELECT sealed FROM accounts_grants WHERE login = ?')
      .get(login);
    if (!row) return undefined;
    await this.#check();
    const sealed = bytes(row, 'sealed');
    this.#checkSealed(sealed);
    let opened: { shouldReEncrypt: boolean; result: string };
    try {
      opened = await this.#storage.decryptStringAsync(Buffer.from(sealed));
    } catch (error) {
      // A keyring's key that stopped answering leaves Chromium encrypting with its built-in one,
      // so the grant can't be read for want of a keyring, not for anything wrong with it.
      if (await this.#builtInKeyOnly()) throw new NoKeychain(NO_KEYRING, { cause: error });
      throw new Error(`the keychain couldn't decrypt the token: ${describe(error)}`, {
        cause: error,
      });
    }
    const grant = this.#open(opened.result);
    if (opened.shouldReEncrypt) await this.#reseal(login, sealed, opened.result);
    return grant;
  }

  /** Keeps `grant` for the account, encrypted, in place of what was kept. */
  async write(login: string, grant: Grant): Promise<void> {
    await this.#check();
    const sealed = await this.#seal(grant);
    this.#checkSealed(sealed);
    this.#database
      .prepare(
        `INSERT INTO accounts_grants (login, sealed) VALUES (?, ?)
         ON CONFLICT (login) DO UPDATE SET login = excluded.login, sealed = excluded.sealed`,
      )
      .run(login, sealed);
  }

  /**
   * Why Lo can't keep a token just now, in words for the person, or nothing when it can: what
   * {@link keychainProblem} says, and on Linux, whether what `safeStorage` encrypts now is marked
   * as Chromium's built-in key's, which says no keyring answered. Nothing is written.
   */
  async problem(): Promise<string | undefined> {
    const problem = await keychainProblem(this.#storage, this.#keychain);
    if (problem !== undefined) return problem;
    return (await this.#builtInKeyOnly()) ? NO_KEYRING : undefined;
  }

  /** Forgets the account's grant. It needs no keychain. */
  async delete(login: string): Promise<void> {
    this.#database.prepare('DELETE FROM accounts_grants WHERE login = ?').run(login);
  }

  async #check(): Promise<void> {
    const problem = await keychainProblem(this.#storage, this.#keychain);
    if (problem !== undefined) throw new NoKeychain(problem);
  }

  /**
   * Throws {@link NoKeychain} for what `safeStorage` encrypted with Chromium's built-in key on
   * Linux, marked `v10`, which says no keyring answered: never kept or read outside a test run.
   */
  #checkSealed(sealed: Uint8Array): void {
    if (this.#keychain.testRun || this.#keychain.platform !== 'linux') return;
    if (isBuiltInKey(sealed)) throw new NoKeychain(NO_KEYRING);
  }

  /**
   * Whether, on Linux outside a test run, `safeStorage` now encrypts only with Chromium's built-in
   * key: what it encrypts is marked `v10`. A probe it can't encrypt says nothing either way.
   */
  async #builtInKeyOnly(): Promise<boolean> {
    if (this.#keychain.testRun || this.#keychain.platform !== 'linux') return false;
    try {
      return isBuiltInKey(new Uint8Array(await this.#storage.encryptStringAsync('probe')));
    } catch {
      return false;
    }
  }

  async #seal(grant: Grant): Promise<Uint8Array> {
    const { refresh } = grant;
    const sealed: SealedGrant = {
      github: this.#github,
      token: grant.token.expose(),
      ...(refresh && {
        refresh: {
          token: refresh.token.expose(),
          ...(refresh.issuedAt !== undefined && { issuedAt: refresh.issuedAt }),
          ...(refresh.expiresAt !== undefined && { expiresAt: refresh.expiresAt }),
          ...(refresh.refreshTokenExpiresAt !== undefined && {
            refreshTokenExpiresAt: refresh.refreshTokenExpiresAt,
          }),
        },
      }),
    };
    return new Uint8Array(await this.#storage.encryptStringAsync(JSON.stringify(sealed)));
  }

  /** The grant `text`, decrypted, holds. */
  #open(text: string): Grant {
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
    const parsed = sealedGrant.safeParse(json);
    if (!parsed.success) {
      // Neither the text nor Zod's issues are repeated: they'd hold the token.
      throw new GithubError({ kind: 'unauthorized', message: 'the kept token is unreadable' });
    }
    const { github, token, refresh } = parsed.data;
    if (github !== this.#github) {
      throw new Error(`the kept token is for ${github}, not ${this.#github}`);
    }
    return {
      token: new Token(token),
      ...(refresh && { refresh: readRefresh(refresh) }),
    };
  }

  /**
   * Encrypts a grant again, as `safeStorage` asks after its key changed, unless it was replaced
   * since it was read. A failure leaves it as it was, which still decrypts.
   */
  async #reseal(login: string, was: Uint8Array, text: string): Promise<void> {
    let sealed: Uint8Array;
    try {
      sealed = new Uint8Array(await this.#storage.encryptStringAsync(text));
      this.#checkSealed(sealed);
    } catch {
      return;
    }
    this.#database
      .prepare('UPDATE accounts_grants SET sealed = ? WHERE login = ? AND sealed = ?')
      .run(sealed, login, was);
  }
}

function readRefresh(refresh: NonNullable<SealedGrant['refresh']>): Refresh {
  return {
    token: new Token(refresh.token),
    ...(refresh.issuedAt !== undefined && { issuedAt: refresh.issuedAt }),
    ...(refresh.expiresAt !== undefined && { expiresAt: refresh.expiresAt }),
    ...(refresh.refreshTokenExpiresAt !== undefined && {
      refreshTokenExpiresAt: refresh.refreshTokenExpiresAt,
    }),
  };
}

/** What was thrown, in a few words. */
function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
