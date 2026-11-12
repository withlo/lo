// The account picker: which account opens a pull request when several can see its repository. The
// accounts that can't, being signed out or waiting for a keyring, show why.

import { Button, Choices, Dialog, DialogSpacer, Key, Switch, type ChoiceItem } from '@lo/ui';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { useStore } from 'zustand';

import { IpcError } from '../../../ipc/contract.ts';
import type { AccountSummary } from '../contract.ts';
import { closeDialog } from './dialogs.ts';
import { labels } from './labels.ts';
import { main } from './main.ts';
import { accountsStore, type AccountQuestion, type OpenDialog } from './store.ts';

type Pick = Extract<OpenDialog, { kind: 'pick' }>;

/** Why `account` can't open anything now, or nothing when it can. */
export function unusable(account: AccountSummary | undefined): string | undefined {
  if (account === undefined) return "Lo isn't signed in to it any more.";
  if (account.needsKeyring) {
    return "Lo can't read its token without a keyring, such as GNOME Keyring or KWallet.";
  }
  if (account.signedOut !== null) return 'Signed out. Sign in again to use it here.';
  return undefined;
}

/** How `account` signed in, for its line. */
export function how(account: AccountSummary | undefined): string {
  if (account === undefined) return '';
  const source = account.source === 'gh' ? 'Imported from gh' : 'Signed in with GitHub';
  return account.name === null ? source : `${account.name} · ${source.toLowerCase()}`;
}

/** The repository, and the pull request if there is one, as the picker names them. */
function opening(question: AccountQuestion): string {
  const repo = `${question.owner}/${question.name}`;
  return question.number === undefined ? repo : `${repo}#${question.number}`;
}

/** The account picker, open while `dialog` is. */
export function PickerView({
  dialog,
  container,
}: {
  dialog: Pick | undefined;
  container: HTMLElement | null;
}) {
  const accounts = useStore(accountsStore, (state) => state.accounts) ?? [];
  const question = dialog?.question;
  const byLogin = (login: string) =>
    accounts.find((account) => account.login.toLowerCase() === login.toLowerCase());
  const items: ChoiceItem<string>[] = (question?.logins ?? []).map((login) => {
    const account = byLogin(login);
    const why = unusable(account);
    return {
      value: login,
      title: login,
      description: why ?? how(account),
      disabled: why !== undefined,
    };
  });
  // Accounts that weren't asked about because they're signed out or locked show why too.
  for (const account of accounts) {
    const why = unusable(account);
    if (why === undefined || items.some((item) => item.value === account.login)) continue;
    items.push({ value: account.login, title: account.login, description: why, disabled: true });
  }
  const first = items.find((item) => item.disabled !== true)?.value;
  const [chosen, setChosen] = useState<string | undefined>(first);
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const primary = useRef<HTMLButtonElement>(null);
  const rememberLabel = useId();

  // Each question starts on its first account that can open it.
  useEffect(() => {
    setChosen(first);
    setRemember(true);
    setError(undefined);
    setBusy(false);
  }, [dialog]);

  const usable =
    chosen !== undefined && items.some((item) => item.value === chosen && !item.disabled);

  const confirm = () => {
    if (dialog === undefined || chosen === undefined || !usable || busy) return;
    const { owner, name } = dialog.question;
    const answer = () => {
      // Answered first, so closing it answers nothing more.
      dialog.answer(chosen);
      if (accountsStore.getState().dialog === dialog) closeDialog();
    };
    if (!remember) {
      answer();
      return;
    }
    setBusy(true);
    main()
      .choose({ owner, name, login: chosen, remember: dialog.question.remember })
      .then(answer, (thrown: unknown) => {
        setBusy(false);
        setError(
          thrown instanceof IpcError
            ? thrown.message
            : `Lo couldn't remember ${chosen} for ${owner}.`,
        );
      });
  };

  // `⏎` on a choice opens with it, as the main button does.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const { target } = event;
    if (event.key !== 'Enter' || event.metaKey || event.ctrlKey || event.altKey) return;
    if (target instanceof Element && target.getAttribute('role') === 'radio') {
      event.preventDefault();
      confirm();
    }
  };

  const visible = question?.logins.length ?? 0;
  const where =
    question === undefined
      ? ''
      : question.remember === 'owner'
        ? `every ${question.owner} repo`
        : `${question.owner}/${question.name}`;
  return (
    <Dialog
      open={dialog !== undefined}
      onOpenChange={(open) => {
        if (!open) closeDialog();
      }}
      title={`Which account for ${question?.owner ?? ''}?`}
      description={
        question === undefined
          ? undefined
          : `Opening ${opening(question)}. ${visible === 1 ? 'One' : visible} of your accounts can see it.`
      }
      onKeyDown={onKeyDown}
      container={container}
      testId="account-picker"
      foot={
        <>
          <span className="flex items-center gap-6">
            <Key keys={['j']} quiet decorative />
            <Key keys={['k']} quiet decorative />
            Choose
          </span>
          <DialogSpacer />
          <Button onClick={closeDialog}>
            Cancel
            <Key keys={labels('esc')} decorative />
          </Button>
          <Button ref={primary} variant="primary" disabled={!usable || busy} onClick={confirm}>
            {chosen === undefined ? 'Open' : `Open as ${chosen}`}
            <Key keys={labels('enter')} decorative className="text-on-accent" />
          </Button>
        </>
      }
    >
      <Choices label="Account" items={items} value={chosen} onChange={setChosen} />
      <div className="flex items-center gap-12 border-t border-border-subtle pt-12">
        <div className="flex min-w-0 flex-1 flex-col">
          <span id={rememberLabel} className="text-ui-strong">
            Remember for {where}
          </span>
          <span className="text-fg-muted text-small">
            {remember
              ? 'Lo opens its PRs as this account from now on.'
              : 'Lo asks again next time.'}
          </span>
        </div>
        <Switch
          checked={remember}
          onCheckedChange={setRemember}
          aria-describedby={rememberLabel}
          aria-label={`Remember for ${where}`}
        />
      </div>
      {error !== undefined && (
        <p role="alert" className="m-0 text-danger text-small">
          {error}
        </p>
      )}
    </Dialog>
  );
}
