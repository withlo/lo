import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Accounts, GithubError, Token, type Account, type Grant } from '@lo/github';
import { MemoryAccountRows } from '@lo/testing';
import { describe, expect, it, onTestFinished } from 'vitest';

import { bytes } from './columns.ts';
import { Grants, keychainProblem, NoKeychain, type Keychain } from './grants.ts';
import { accountsDatabase, FakeStorage, TOKEN } from './test/support.ts';

const API = 'https://api.github.com';
const REFRESH = 'ghr_FAKE_ACCOUNTS_REFRESH';

const mac: Keychain = { platform: 'darwin', testRun: false, mockKeychain: false };
const linux: Keychain = { platform: 'linux', testRun: false, mockKeychain: false };

function grants(options: { keychain?: Keychain; github?: string; path?: string } = {}) {
  const database = accountsDatabase(options.path);
  const storage = new FakeStorage();
  const kept = new Grants({
    database,
    storage,
    keychain: options.keychain ?? mac,
    github: options.github ?? API,
  });
  return { grants: kept, storage, database };
}

const expiring: Grant = {
  token: new Token(TOKEN),
  refresh: {
    token: new Token(REFRESH),
    issuedAt: 1_800_000_000,
    expiresAt: 1_800_028_800,
    refreshTokenExpiresAt: 1_815_552_000,
  },
};

/** Every token in `grant`, as text, to compare grants by. */
function exposed(grant: Grant | undefined) {
  return (
    grant && {
      ...grant,
      token: grant.token.expose(),
      refresh: grant.refresh && { ...grant.refresh, token: grant.refresh.token.expose() },
    }
  );
}

describe('Grants', () => {
  it('round-trips a grant through safeStorage, refresh token and times included', async () => {
    const { grants: kept, storage } = grants();
    expect(await kept.read('bot')).toBeUndefined();
    await kept.write('bot', expiring);
    expect(storage.encrypted).toBe(1);
    expect(exposed(await kept.read('bot'))).toEqual(exposed(expiring));
    expect(await kept.read('other')).toBeUndefined();
  });

  it('round-trips a token without a refresh token, and replaces a grant whole', async () => {
    const { grants: kept } = grants();
    await kept.write('bot', expiring);
    await kept.write('BOT', { token: new Token('gho_FAKE_SECOND') });
    expect(exposed(await kept.read('bot'))).toEqual({ token: 'gho_FAKE_SECOND' });
  });

  it('keeps one ciphertext per account, and never a token in the clear', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'lo-accounts-'));
    onTestFinished(() => rmSync(folder, { recursive: true, force: true }));
    const { grants: kept, database } = grants({ path: join(folder, 'lo.db') });
    await kept.write('bot', expiring);
    const rows = database.prepare('SELECT login, sealed FROM accounts_grants').all();
    expect(rows).toHaveLength(1);
    const sealed = Buffer.from(bytes(rows[0] ?? {}, 'sealed'));
    for (const secret of [TOKEN, REFRESH]) {
      expect(sealed.includes(secret)).toBe(false);
      // Nor anywhere in the database's files.
      for (const file of readdirSync(folder)) {
        expect(readFileSync(join(folder, file)).includes(secret)).toBe(false);
      }
    }
    database.close();
  });

  it('deletes a grant without the keychain', async () => {
    const { grants: kept, storage } = grants({ keychain: linux });
    storage.backend = 'gnome_libsecret';
    await kept.write('bot', expiring);
    storage.backend = 'basic_text';
    await kept.delete('BOT');
    storage.backend = 'gnome_libsecret';
    expect(await kept.read('bot')).toBeUndefined();
  });

  it("throws, rather than answer none, when the keychain can't decrypt just now", async () => {
    const { grants: kept, storage } = grants();
    await kept.write('bot', expiring);
    storage.refusing = true;
    const read = kept.read('bot');
    await expect(read).rejects.toThrow("the keychain couldn't decrypt the token");
    await expect(read).rejects.not.toBeInstanceOf(GithubError);
    storage.refusing = false;
    expect(exposed(await kept.read('bot'))).toEqual(exposed(expiring));
  });

  it('never reads a grant kept for another GitHub', async () => {
    const database = accountsDatabase();
    const storage = new FakeStorage();
    const real = new Grants({ database, storage, keychain: mac, github: API });
    await real.write('bot', expiring);
    const local = new Grants({
      database,
      storage,
      keychain: { ...mac, testRun: true },
      github: 'http://127.0.0.1:4567/api',
    });
    await expect(local.read('bot')).rejects.toThrow(
      `the kept token is for ${API}, not http://127.0.0.1:4567/api`,
    );
    // It's left for the GitHub it's for.
    expect(exposed(await real.read('bot'))).toEqual(exposed(expiring));
  });

  it("takes a grant that isn't one for a token that can never work, without repeating it", async () => {
    const { grants: kept, storage, database } = grants();
    const garbled = await storage.encryptStringAsync(`{"token":"${TOKEN}"`);
    database
      .prepare('INSERT INTO accounts_grants (login, sealed) VALUES (?, ?)')
      .run('bot', garbled);
    const read = kept.read('bot');
    await expect(read).rejects.toBeInstanceOf(GithubError);
    await expect(read).rejects.toThrow('the kept token is unreadable');
    const error: unknown = await read.catch((thrown: unknown) => thrown);
    expect(JSON.stringify(error, Object.getOwnPropertyNames(error))).not.toContain(TOKEN);
  });

  it('encrypts a grant again when safeStorage asks, unless it was replaced meanwhile', async () => {
    const { grants: kept, storage, database } = grants();
    await kept.write('bot', expiring);
    const before = database.prepare('SELECT sealed FROM accounts_grants').get()?.['sealed'];
    storage.reEncrypt = true;
    expect(exposed(await kept.read('bot'))).toEqual(exposed(expiring));
    const after = database.prepare('SELECT sealed FROM accounts_grants').get()?.['sealed'];
    expect(after).not.toEqual(before);
    expect(exposed(await kept.read('bot'))).toEqual(exposed(expiring));

    // A write while a read decrypts wins over the read's encrypting again.
    const held = Promise.withResolvers<void>();
    storage.held = held.promise;
    const reading = kept.read('bot');
    await kept.write('bot', { token: new Token('gho_FAKE_NEWER') });
    held.resolve();
    storage.held = undefined;
    expect(exposed(await reading)).toEqual(exposed(expiring));
    storage.reEncrypt = false;
    expect(exposed(await kept.read('bot'))).toEqual({ token: 'gho_FAKE_NEWER' });
  });
});

describe("Linux's fallback, and other stand-in keychains", () => {
  it('refuses to keep or read a token with the Linux fallback outside test runs', async () => {
    const { grants: kept, storage } = grants({ keychain: linux });
    await kept.write('bot', expiring);
    storage.backend = 'basic_text';
    await expect(kept.write('bot', expiring)).rejects.toBeInstanceOf(NoKeychain);
    await expect(kept.write('bot', expiring)).rejects.toThrow('GNOME Keyring or KWallet');
    // A grant kept before isn't taken for none, so nothing signs the account out.
    await expect(kept.read('bot')).rejects.toBeInstanceOf(NoKeychain);
  });

  it("refuses what Linux's built-in key encrypted, whatever store safeStorage reports", async () => {
    // A GNOME session whose keyring never answered: the store chosen is libsecret's, and Chromium
    // falls back to its built-in key, marked v10.
    const { grants: kept, storage, database } = grants({ keychain: linux });
    storage.backend = 'gnome_libsecret';
    storage.mark = 'v10';
    const written = kept.write('bot', expiring);
    await expect(written).rejects.toBeInstanceOf(NoKeychain);
    await expect(written).rejects.toThrow('GNOME Keyring or KWallet');
    expect(database.prepare('SELECT count(*) AS n FROM accounts_grants').get()).toEqual({ n: 0 });

    // One kept so before isn't read, nor taken for none.
    const garbled = await storage.encryptStringAsync(JSON.stringify({ github: API, token: TOKEN }));
    database
      .prepare('INSERT INTO accounts_grants (login, sealed) VALUES (?, ?)')
      .run('bot', garbled);
    await expect(kept.read('bot')).rejects.toBeInstanceOf(NoKeychain);

    // Once the keyring answers, what it encrypts is kept.
    storage.mark = 'v11';
    await kept.write('bot', expiring);
    expect(exposed(await kept.read('bot'))).toEqual(exposed(expiring));
  });

  it("never encrypts a grant again with Linux's built-in key", async () => {
    const { grants: kept, storage, database } = grants({ keychain: linux });
    await kept.write('bot', expiring);
    const before = bytes(
      database.prepare('SELECT sealed FROM accounts_grants').get() ?? {},
      'sealed',
    );
    // The keyring stops answering once it has decrypted: what the grant was kept with stays.
    storage.reEncrypt = true;
    storage.mark = 'v10';
    const read = await kept.read('bot');
    expect(exposed(read)).toEqual(exposed(expiring));
    const after = bytes(
      database.prepare('SELECT sealed FROM accounts_grants').get() ?? {},
      'sealed',
    );
    expect(Buffer.from(after).equals(Buffer.from(before))).toBe(true);
  });

  it("takes v10 on a Mac, whose keychain's key Chromium marks so", async () => {
    const { grants: kept, storage } = grants({ keychain: mac });
    storage.mark = 'v10';
    await kept.write('bot', expiring);
    expect(exposed(await kept.read('bot'))).toEqual(exposed(expiring));
  });

  it("takes Linux's built-in key in a test run", async () => {
    const { grants: kept, storage } = grants({ keychain: { ...linux, testRun: true } });
    storage.mark = 'v10';
    await kept.write('bot', expiring);
    expect(exposed(await kept.read('bot'))).toEqual(exposed(expiring));
  });

  it('takes the fallback in a test run', async () => {
    const { grants: kept, storage } = grants({ keychain: { ...linux, testRun: true } });
    storage.backend = 'basic_text';
    await kept.write('bot', expiring);
    expect(exposed(await kept.read('bot'))).toEqual(exposed(expiring));
  });

  it.each([
    ['the Linux fallback', linux, 'basic_text', 'GNOME Keyring or KWallet'],
    ['a store not chosen yet', linux, 'unknown', 'GNOME Keyring or KWallet'],
    [
      "Chromium's stand-in keychain",
      { ...mac, mockKeychain: true },
      'unknown',
      'stand-in keychain',
    ],
    ['a stand-in keychain on Linux', { ...linux, mockKeychain: true }, 'kwallet6', 'stand-in'],
  ])('refuses %s outside a test run', async (_name, keychain, backend, said) => {
    const storage = new FakeStorage();
    storage.backend = backend;
    expect(await keychainProblem(storage, keychain)).toContain(said);
    expect(await keychainProblem(storage, { ...keychain, testRun: true })).toBeUndefined();
  });

  it.each(['gnome_libsecret', 'kwallet', 'kwallet5', 'kwallet6'])(
    "takes Linux's %s",
    async (backend) => {
      const storage = new FakeStorage();
      storage.backend = backend;
      expect(await keychainProblem(storage, linux)).toBeUndefined();
    },
  );

  it("doesn't ask a Mac which Linux store it chose", async () => {
    const storage = new FakeStorage();
    storage.backend = 'basic_text';
    expect(await keychainProblem(storage, mac)).toBeUndefined();
  });

  it('refuses when safeStorage can encrypt nothing, even in a test run', async () => {
    const storage = new FakeStorage();
    storage.available = false;
    expect(await keychainProblem(storage, { ...mac, testRun: true })).toContain(
      "can't reach the system's keychain",
    );
  });

  it("leaves an account signed in, its grant kept, while there's no keychain", async () => {
    const { grants: kept, storage } = grants({ keychain: linux });
    await kept.write('rozed-bot', expiring);
    storage.backend = 'basic_text';
    const rows = new MemoryAccountRows<Account>();
    await rows.save({
      login: 'rozed-bot',
      userId: 1,
      scopes: ['repo'],
      source: 'deviceFlow',
      addedAt: 1,
    });
    const accounts = await Accounts.load({
      rows,
      secrets: kept,
      renew: () => Promise.reject(new Error('no renewals here')),
      fetch: () => Promise.reject(new Error('no requests here')),
    });
    const client = accounts.client('rozed-bot');
    await expect(client).rejects.toMatchObject({ detail: { kind: 'tokenUnavailable' } });
    await expect(client).rejects.toThrow('GNOME Keyring or KWallet');
    expect(accounts.isSignedOut('rozed-bot')).toBe(false);
    storage.backend = 'kwallet6';
    expect(exposed(await kept.read('rozed-bot'))).toEqual(exposed(expiring));
  });
});
