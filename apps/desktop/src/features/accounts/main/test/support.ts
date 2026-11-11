// What the accounts feature's tests share: a database with the feature's tables, a stand-in for
// Electron's safeStorage that really encrypts, and GitHub replayed from the recorded cassettes.

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { basename } from 'node:path';

import type { Account } from '@lo/github';
import { cassette, Replay, replayFetch, type Interaction, type ReplayFetch } from '@lo/testing';

import { openDatabase, type Database } from '../../../../main/database.ts';
import { migrate } from '../../../../main/migrations.ts';
import type { SafeStorage } from '../grants.ts';

// Keyed as main finds them, under the feature's folder.
const migrations = Object.fromEntries(
  Object.entries(
    import.meta.glob<string>('../../migrations/*.sql', {
      eager: true,
      query: '?raw',
      import: 'default',
    }),
  ).map(([path, sql]) => [`/features/accounts/migrations/${basename(path)}`, sql]),
);

/** A database with the accounts feature's tables, in memory unless given a file. */
export function accountsDatabase(path = ':memory:'): Database {
  const database = openDatabase(path);
  migrate(database, migrations);
  return database;
}

/** An account's row as tests make them. */
export function account(login: string, addedAt: number): Account {
  return {
    login,
    userId: 1,
    name: `${login}'s name`,
    scopes: ['read:org', 'repo', 'workflow'],
    source: 'deviceFlow',
    addedAt,
  };
}

/**
 * Electron's `safeStorage` as tests use it: AES-256-GCM under a key of its own, so what it
 * encrypts never holds the text, and a Linux store that can be set to the fallback.
 */
export class FakeStorage implements SafeStorage {
  /** Whether it can encrypt at all. */
  available = true;
  /** The store it says it chose, on Linux. */
  backend = 'gnome_libsecret';
  /** When set, decrypting fails, as when the user denies Lo the keychain. */
  refusing = false;
  /** When set, encrypting fails, as when the keychain refuses a write. */
  refusingWrites = false;
  /** When set, decrypting asks for the text to be encrypted again, as after a new key. */
  reEncrypt = false;
  /** How many times it encrypted. */
  encrypted = 0;
  /** When set, decrypting waits for it. */
  held: Promise<void> | undefined;
  readonly #key = randomBytes(32);

  isAsyncEncryptionAvailable(): Promise<boolean> {
    return Promise.resolve(this.available);
  }

  encryptStringAsync(plainText: string): Promise<Uint8Array> {
    if (this.refusingWrites) return Promise.reject(new Error('the keychain refused the write'));
    this.encrypted += 1;
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.#key, iv);
    const text = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
    return Promise.resolve(Buffer.concat([Buffer.from('v11'), iv, cipher.getAuthTag(), text]));
  }

  async decryptStringAsync(
    encrypted: Buffer,
  ): Promise<{ shouldReEncrypt: boolean; result: string }> {
    await this.held;
    if (this.refusing) throw new Error('the user denied access to the keychain');
    const iv = encrypted.subarray(3, 15);
    const tag = encrypted.subarray(15, 31);
    const decipher = createDecipheriv('aes-256-gcm', this.#key, iv);
    decipher.setAuthTag(tag);
    const text = Buffer.concat([decipher.update(encrypted.subarray(31)), decipher.final()]);
    return { shouldReEncrypt: this.reEncrypt, result: text.toString('utf8') };
  }

  getSelectedStorageBackend(): string {
    return this.backend;
  }
}

/** The interactions of the cassettes `names`, in order, as one. */
export function recorded(...names: string[]): Interaction[] {
  return names.flatMap((name) => cassette(name).interactions.map(({ interaction }) => interaction));
}

/** A `fetch` that replays the cassettes `names` as one. */
export function replaying(...names: string[]): ReplayFetch {
  return replayFetch(new Replay(names.join('+'), recorded(...names)));
}

/** A stand-in token, never a real one. */
export const TOKEN = 'gho_FAKE_ACCOUNTS_TEST';
