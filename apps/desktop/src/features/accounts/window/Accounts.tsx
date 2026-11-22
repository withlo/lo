// Accounts, in Settings: each account and how it is, with what to do about it, and the ways to
// add one. The window never sees a token; each account's summary says all it needs.

import {
  Avatar,
  Button,
  Problem,
  SettingsEmpty,
  SettingsList,
  SettingsListItem,
  Tag,
  type TagTone,
} from '@lo/ui';
import { NO_TARGET } from '@lo/ui/commands';
import { useStore } from 'zustand';

import { registry } from '../../../window/commands/registry.ts';
import { defineRow } from '../../settings/window/shared.ts';
import type { AccountSummary } from '../contract.ts';
import { openImport, openSignIn, openSignOut } from './dialogs.ts';
import { accountsStore } from './store.ts';

/** How an account is, in a tag, with a line about it where the tag and its button don't say it. */
function status(account: AccountSummary): { tag: string; tone: TagTone; line?: string } {
  if (account.needsKeyring) {
    return {
      tag: 'Sign-in can’t be read',
      tone: 'danger',
      line: `${account.login}’s sign-in can’t be read from the keyring.`,
    };
  }
  if (account.signedOut !== null) return { tag: 'Signed out', tone: 'danger' };
  if (account.cantSave) {
    return {
      tag: 'Sign-in not saved',
      tone: 'warning',
      line: 'It stays signed in until you quit Lo.',
    };
  }
  return { tag: 'Signed in', tone: 'ok' };
}

function Account({ account }: { account: AccountSummary }) {
  const { tag, tone, line } = status(account);
  const fromCli = account.source === 'gh';
  const again = account.signedOut !== null;
  return (
    <SettingsListItem
      lead={<Avatar login={account.login} />}
      label={
        <>
          <span className="truncate text-ui-strong">{account.login}</span>
          <Tag tone={tone}>{tag}</Tag>
        </>
      }
      description={[
        'github.com',
        ...(account.name === null ? [] : [account.name]),
        ...(fromCli ? ['from GitHub CLI'] : []),
      ].join(' · ')}
      note={line === undefined ? undefined : <span className="text-fg-muted">{line}</span>}
    >
      {again && (
        <Button size="sm" onClick={fromCli ? openImport : openSignIn}>
          {fromCli ? 'Import again' : 'Sign in again'}
        </Button>
      )}
      <Button
        size="sm"
        variant="ghost"
        aria-label={`Sign out of ${account.login}`}
        onClick={() => openSignOut([account.login])}
      >
        Sign out…
      </Button>
    </SettingsListItem>
  );
}

export function AccountsSection({ label, description }: { label: string; description: string }) {
  const accounts = useStore(accountsStore, (state) => state.accounts);
  return (
    <SettingsList
      label={label}
      description={description}
      actions={
        <>
          <Button size="sm" variant="ghost" onClick={openImport}>
            Import from GitHub CLI
          </Button>
          <Button size="sm" onClick={openSignIn}>
            Sign in with GitHub…
          </Button>
        </>
      }
    >
      {accounts?.some((account) => account.needsKeyring) === true && (
        <div className="border-b border-border-subtle p-8">
          <Problem
            title="Can’t read the sign-ins"
            reason="Sign-ins are kept in the keyring, and none is running."
            action={{ label: 'Quit Lo', onClick: () => registry().run('app.quit', NO_TARGET) }}
          />
        </div>
      )}
      {accounts !== undefined && accounts.length === 0 ? (
        <SettingsEmpty heading="No accounts" line="Public pull requests open without one." />
      ) : (
        <div role="list" aria-label="Accounts">
          {accounts?.map((account) => (
            <Account key={account.login} account={account} />
          ))}
        </div>
      )}
    </SettingsList>
  );
}

export default defineRow({
  id: 'accounts.settings',
  group: 'accounts',
  order: 10,
  label: 'Accounts',
  description: 'Each pull request opens with an account that can see its repo.',
  words: () => [
    'sign in',
    'sign out',
    'GitHub CLI',
    ...(accountsStore.getState().accounts?.map(({ login }) => login) ?? []),
  ],
  render: AccountsSection,
});
