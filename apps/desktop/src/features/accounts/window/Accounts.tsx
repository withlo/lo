// Accounts, in Settings: each account and how it is, with what to do about it, and the ways to
// add one. The window never sees a token; each account's summary says all it needs.

import { Avatar, Button, Callout, Tag, type TagTone } from '@lo/ui';
import { useState } from 'react';
import { useStore } from 'zustand';

import { IpcError } from '../../../ipc/contract.ts';
import { defineSection } from '../../settings/window/shared.ts';
import type { AccountSummary } from '../contract.ts';
import { openImport, openSignIn } from './dialogs.ts';
import { main } from './main.ts';
import { accountsStore } from './store.ts';

/** How an account is, in a word or two, with what it means. */
function status(account: AccountSummary): { tag: string; tone: TagTone; detail?: string } {
  if (account.needsKeyring) {
    return {
      tag: 'Needs a keyring',
      tone: 'danger',
      detail:
        "Lo can't read its token without a keyring, such as GNOME Keyring or KWallet. Install or unlock one, then start Lo again.",
    };
  }
  if (account.signedOut === 'refused') {
    return {
      tag: 'Signed out',
      tone: 'danger',
      detail: 'GitHub refused its token. Sign in again to use it.',
    };
  }
  if (account.signedOut === 'tokenMissing') {
    return {
      tag: 'Signed out',
      tone: 'danger',
      detail: "Its token isn't kept any more. Sign in again to use it.",
    };
  }
  if (account.cantSave) {
    return {
      tag: "Can't save",
      tone: 'warning',
      detail:
        "The keychain keeps refusing its renewed token. Lo uses it until it quits, and you'll sign in again after.",
    };
  }
  return { tag: 'Signed in', tone: 'ok' };
}

function Account({ account }: { account: AccountSummary }) {
  const [error, setError] = useState<string>();
  const [removing, setRemoving] = useState(false);
  const { tag, tone, detail } = status(account);
  const source = account.source === 'gh' ? 'imported from gh' : 'signed in with GitHub';
  const remove = () => {
    setRemoving(true);
    setError(undefined);
    main()
      .remove({ login: account.login })
      .catch((thrown: unknown) => {
        setRemoving(false);
        setError(
          thrown instanceof IpcError ? thrown.message : `Lo couldn't remove ${account.login}.`,
        );
      });
  };
  const again = account.signedOut !== null;
  return (
    <li className="flex items-center gap-12 border-t border-border-subtle py-12">
      <Avatar login={account.login} />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <span className="flex items-center gap-8">
          <span className="truncate text-ui-strong">{account.login}</span>
          <Tag tone={tone}>{tag}</Tag>
        </span>
        <span className="text-fg-muted text-small">
          github.com{account.name === null ? '' : ` · ${account.name}`} · {source}
        </span>
        {detail !== undefined && <span className="text-fg-muted text-small">{detail}</span>}
        {error !== undefined && (
          <span role="alert" className="text-danger text-small">
            {error}
          </span>
        )}
      </div>
      <div className="flex flex-none items-center gap-6">
        {again && (
          <Button size="sm" onClick={account.source === 'gh' ? openImport : openSignIn}>
            {account.source === 'gh' ? 'Import again' : 'Sign in again'}
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          disabled={removing}
          aria-label={`Remove ${account.login}`}
          onClick={remove}
        >
          Remove
        </Button>
      </div>
    </li>
  );
}

export function AccountsSection() {
  const accounts = useStore(accountsStore, (state) => state.accounts);
  return (
    <div className="flex flex-col">
      {accounts !== undefined && accounts.length === 0 && (
        <p className="m-0 border-t border-border-subtle py-12 text-fg-muted text-ui">
          Lo isn't signed in to any account. Public PRs open without one.
        </p>
      )}
      {accounts?.some((account) => account.needsKeyring) === true && (
        <div className="pb-12">
          <Callout tone="danger">
            Lo keeps tokens in your system's keyring, and none answered, so it can't use these
            accounts. Install or unlock GNOME Keyring or KWallet, then start Lo again.
          </Callout>
        </div>
      )}
      <ul className="m-0 flex list-none flex-col p-0" aria-label="Accounts">
        {accounts?.map((account) => (
          <Account key={account.login} account={account} />
        ))}
      </ul>
      <div className="flex gap-8 border-t border-border-subtle pt-12">
        <Button size="sm" onClick={openSignIn}>
          Add an account
        </Button>
        <Button size="sm" variant="ghost" onClick={openImport}>
          Import from gh
        </Button>
      </div>
    </div>
  );
}

export default defineSection({
  id: 'accounts.settings',
  title: 'Accounts',
  description: 'Each PR opens with an account that can see its repo.',
  order: 10,
  render: AccountsSection,
});
