import { describe, expect, it } from 'vitest';

import { AccountTable } from './rows.ts';
import { account, accountsDatabase } from './test/support.ts';

describe('AccountTable', () => {
  it('accounts round trip and update in place', async () => {
    const rows = new AccountTable(accountsDatabase());
    expect(await rows.accounts()).toEqual([]);
    await rows.save(account('b', 2));
    await rows.save(account('a', 1));
    expect(await rows.accounts()).toEqual([account('a', 1), account('b', 2)]);

    await rows.save({ ...account('A', 5), source: 'gh', scopes: ['repo'] });
    const accounts = await rows.accounts();
    expect(accounts).toHaveLength(2);
    // Logins are case-insensitive; the update keeps when it was first added.
    expect(accounts[0]).toMatchObject({ login: 'A', addedAt: 1, source: 'gh', scopes: ['repo'] });
  });

  it('a refused account stays refused until it signs in again', async () => {
    const rows = new AccountTable(accountsDatabase());
    await rows.save(account('a', 1));
    await rows.save(account('b', 2));
    expect(await rows.refused()).toEqual([]);
    await rows.setRefused('A', 10);
    expect(await rows.refused()).toEqual(['a']);
    // The account and everything kept for it stay.
    expect(await rows.accounts()).toEqual([account('a', 1), account('b', 2)]);
    // Signing in again saves the account, which clears it.
    await rows.save(account('a', 1));
    expect(await rows.refused()).toEqual([]);
  });

  it('removing an account forgets its owners', async () => {
    const rows = new AccountTable(accountsDatabase());
    await rows.save(account('a', 1));
    await rows.save(account('b', 2));
    await rows.setOwnerAccount('acme', 'a');
    await rows.setOwnerAccount('Other', 'b');
    expect(await rows.ownerAccount('ACME')).toBe('a');
    await rows.setOwnerAccount('acme', 'b');
    expect(await rows.ownerAccount('acme')).toBe('b');
    await rows.delete('B');
    expect(await rows.ownerAccount('acme')).toBeUndefined();
    expect(await rows.ownerAccount('other')).toBeUndefined();
    expect(await rows.accounts()).toEqual([account('a', 1)]);
  });

  it("a repository's own account is kept apart from its owner's", async () => {
    const rows = new AccountTable(accountsDatabase());
    await rows.save(account('a', 1));
    await rows.save(account('b', 2));
    await rows.setOwnerAccount('acme', 'a');
    await rows.setRepoAccount('acme', 'secret', 'b');
    expect(await rows.repoAccount('ACME', 'Secret')).toBe('b');
    expect(await rows.repoAccount('acme', 'app')).toBeUndefined();
    expect(await rows.ownerAccount('acme')).toBe('a');

    await rows.delete('b');
    expect(await rows.repoAccount('acme', 'secret')).toBeUndefined();
    expect(await rows.ownerAccount('acme')).toBe('a');
  });

  it('orders accounts added in the same second by login, ignoring case', async () => {
    const rows = new AccountTable(accountsDatabase());
    for (const login of ['carol', 'Bob', 'alice']) await rows.save(account(login, 7));
    expect((await rows.accounts()).map((row) => row.login)).toEqual(['alice', 'Bob', 'carol']);
  });

  it('keeps an account without a name or an avatar, and one with both', async () => {
    const rows = new AccountTable(accountsDatabase());
    const plain = { login: 'plain', userId: 2, scopes: [], source: 'gh', addedAt: 1 } as const;
    const full = { ...account('full', 2), avatarUrl: 'https://avatars.example/u/1' };
    await rows.save({ ...plain, scopes: [] });
    await rows.save(full);
    expect(await rows.accounts()).toEqual([{ ...plain, scopes: [] }, full]);
  });

  it("notes no refusal for an account it doesn't have", async () => {
    const rows = new AccountTable(accountsDatabase());
    await rows.setRefused('gone', 10);
    await rows.save(account('gone', 1));
    expect(await rows.refused()).toEqual([]);
  });

  it("refuses to choose an account it doesn't have", async () => {
    const rows = new AccountTable(accountsDatabase());
    await expect(rows.setOwnerAccount('acme', 'nobody')).rejects.toThrow('FOREIGN KEY');
    await expect(rows.setRepoAccount('acme', 'app', 'nobody')).rejects.toThrow('FOREIGN KEY');
  });
});
