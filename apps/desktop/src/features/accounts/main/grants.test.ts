import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Accounts, GithubError, Token, type Account, type Grant } from '@lo/github';
import { MemoryAccountRows } from '@lo/testing';
import { describe, expect, it, onTestFinished } from 'vitest';

import type { Database } from '../../../main/database.ts';
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
    await kept.write('bot', expiring);
    storage.available = false;
    await kept.delete('BOT');
    storage.available = true;
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

/** A grant for rozed-bot as `storage` encrypts it now, put straight in the table. */
async function keep(storage: FakeStorage, database: Database) {
  const sealed = await storage.encryptStringAsync(JSON.stringify({ github: API, token: TOKEN }));
  database
    .prepare('INSERT INTO accounts_grants (login, sealed) VALUES (?, ?)')
    .run('rozed-bot', sealed);
}

describe("Linux's built-in key, and other stand-in keychains", () => {
  // On sway, i3 or Hyprland, safeStorage reports `basic_text` and gets its key from the Secret
  // Service all the same. The mark says which key it used; the report doesn't.
  it.each(['basic_text', 'gnome_libsecret', 'kwallet6', 'unknown'])(
    'takes what a keyring encrypted (v11) on Linux, whatever store it reports: %s',
    async (backend) => {
      const { grants: kept, storage } = grants({ keychain: linux });
      storage.backend = backend;
      storage.mark = 'v11';
      await kept.write('bot', expiring);
      expect(exposed(await kept.read('bot'))).toEqual(exposed(expiring));
    },
  );

  it("takes what the desktop portal's key encrypted (v12) on Linux", async () => {
    const { grants: kept, storage } = grants({ keychain: linux });
    storage.backend = 'basic_text';
    storage.mark = 'v12';
    await kept.write('bot', expiring);
    expect(exposed(await kept.read('bot'))).toEqual(exposed(expiring));
  });

  // A GNOME session whose keyring is dead reports libsecret's store and encrypts with the
  // built-in key, as a desktop with no keyring at all does.
  it.each(['basic_text', 'gnome_libsecret', 'kwallet6'])(
    "refuses to keep what Linux's built-in key encrypted (v10), whatever store it reports: %s",
    async (backend) => {
      const { grants: kept, storage, database } = grants({ keychain: linux });
      storage.backend = backend;
      storage.mark = 'v10';
      const written = kept.write('bot', expiring);
      await expect(written).rejects.toBeInstanceOf(NoKeychain);
      await expect(written).rejects.toThrow('none answered');
      expect(database.prepare('SELECT count(*) AS n FROM accounts_grants').get()).toEqual({
        n: 0,
      });
    },
  );

  it("refuses to read a grant Linux's built-in key encrypted, and doesn't take it for none", async () => {
    const { grants: kept, storage, database } = grants({ keychain: linux });
    storage.mark = 'v10';
    await keep(storage, database);
    await expect(kept.read('rozed-bot')).rejects.toBeInstanceOf(NoKeychain);
    // Kept with a keyring's key, it reads.
    storage.mark = 'v11';
    await kept.write('rozed-bot', expiring);
    expect(exposed(await kept.read('rozed-bot'))).toEqual(exposed(expiring));
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
    storage.backend = 'basic_text';
    storage.mark = 'v10';
    await kept.write('bot', expiring);
    expect(exposed(await kept.read('bot'))).toEqual(exposed(expiring));
  });

  it.each([
    ["Chromium's stand-in keychain", { ...mac, mockKeychain: true }],
    ['a stand-in keychain on Linux', { ...linux, mockKeychain: true }],
  ])('refuses %s outside a test run', async (_name, keychain) => {
    const storage = new FakeStorage();
    expect(await keychainProblem(storage, keychain)).toContain('stand-in keychain');
    expect(await keychainProblem(storage, { ...keychain, testRun: true })).toBeUndefined();
  });

  it('refuses when safeStorage can encrypt nothing, even in a test run', async () => {
    const storage = new FakeStorage();
    storage.available = false;
    expect(await keychainProblem(storage, { ...mac, testRun: true })).toContain(
      "can't reach the system's keychain",
    );
  });

  it("says why a token can't be kept before anything is written: Linux's built-in key", async () => {
    const { grants: kept, storage, database } = grants({ keychain: linux });
    expect(await kept.problem()).toBeUndefined();
    storage.mark = 'v10';
    expect(await kept.problem()).toContain('none answered');
    // Nothing is kept by asking.
    expect(database.prepare('SELECT count(*) AS n FROM accounts_grants').get()).toEqual({ n: 0 });
    // A Mac's keychain marks its key so too, and a test run takes the built-in key.
    const onMac = grants({ keychain: mac });
    onMac.storage.mark = 'v10';
    expect(await onMac.grants.problem()).toBeUndefined();
    const testRun = grants({ keychain: { ...linux, testRun: true } });
    testRun.storage.mark = 'v10';
    expect(await testRun.grants.problem()).toBeUndefined();
  });

  it('says why a token can’t be kept: no keychain, or a stand-in one', async () => {
    const { grants: kept, storage } = grants({ keychain: { ...mac, mockKeychain: true } });
    expect(await kept.problem()).toContain('stand-in keychain');
    storage.available = false;
    expect(await kept.problem()).toContain("can't reach the system's keychain");
  });

  it("takes a keyring's grant that no longer decrypts, once only the built-in key answers, for want of a keyring", async () => {
    const { grants: kept, storage } = grants({ keychain: linux });
    storage.mark = 'v11';
    await kept.write('bot', expiring);
    // The keyring stops answering: decrypting fails, and what's encrypted now is the built-in key's.
    storage.refusing = true;
    storage.mark = 'v10';
    const read = kept.read('bot');
    await expect(read).rejects.toBeInstanceOf(NoKeychain);
    await expect(read).rejects.toThrow('none answered');
    // While a keyring still encrypts, it's the keychain refusing just now, as when the person says no.
    storage.mark = 'v12';
    const refused = kept.read('bot');
    await expect(refused).rejects.not.toBeInstanceOf(NoKeychain);
    await expect(refused).rejects.toThrow("the keychain couldn't decrypt the token");
    // On a Mac, a refusal is never taken for no keychain.
    const onMac = grants({ keychain: mac });
    await onMac.grants.write('bot', expiring);
    onMac.storage.refusing = true;
    onMac.storage.mark = 'v10';
    await expect(onMac.grants.read('bot')).rejects.not.toBeInstanceOf(NoKeychain);
  });

  it("leaves an account signed in, its grant kept, while there's no keyring", async () => {
    const { grants: kept, storage, database } = grants({ keychain: linux });
    storage.mark = 'v10';
    await keep(storage, database);
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
    await expect(client).rejects.toThrow('none answered');
    expect(accounts.isSignedOut('rozed-bot')).toBe(false);
    expect(database.prepare('SELECT count(*) AS n FROM accounts_grants').get()).toEqual({ n: 1 });
  });
});
