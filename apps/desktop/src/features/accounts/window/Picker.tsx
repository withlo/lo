// The account picker: which account opens a pull request when several can see its repository. The
// accounts that can't, being signed out or their sign-in unreadable, show why. Its body stays put
// from asking to remembering the choice: only the foot changes, and a choice that couldn't be
// remembered says so above it, with the pull request still a press away.

import { Choices, Dialog, Switch, type ChoiceItem, type DialogState } from '@lo/ui';
import { useEffect, useId, useState, type KeyboardEvent } from 'react';
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
  if (account === undefined) return 'Signed out';
  if (account.needsKeyring) return 'Sign-in can’t be read';
  if (account.signedOut !== null) return 'Signed out';
  return undefined;
}

/**
 * What's said of `account` under its login: its name, and where it came from when that isn't the
 * usual way, signing in with GitHub.
 */
export function how(account: AccountSummary | undefined): string | undefined {
  if (account === undefined) return undefined;
  const fromCli = account.source === 'gh';
  if (account.name === null) return fromCli ? 'From GitHub CLI' : undefined;
  return fromCli ? `${account.name} · from GitHub CLI` : account.name;
}

/** The pull request, or the repository when there's none, as the picker's title names it. */
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

  /** Opens with the account chosen, remembering it first when the switch says to. */
  const confirm = () => {
    if (dialog === undefined || chosen === undefined || !usable || busy) return;
    const { owner, name } = dialog.question;
    const answer = () => {
      // Answered first, so closing it answers nothing more.
      dialog.answer(chosen);
      if (accountsStore.getState().dialog === dialog) closeDialog();
    };
    // The choice couldn't be remembered: the pull request still opens with it.
    if (!remember || error !== undefined) {
      answer();
      return;
    }
    setBusy(true);
    main()
      .choose({ owner, name, login: chosen, remember: dialog.question.remember })
      .then(answer, (thrown: unknown) => {
        setBusy(false);
        setError(thrown instanceof IpcError ? thrown.message : String(thrown));
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
  const label = chosen === undefined ? 'Open' : `Open as ${chosen}`;
  const state: DialogState = busy ? 'working' : error === undefined ? 'ask' : 'failed';
  return (
    <Dialog
      open={dialog !== undefined}
      onOpenChange={(open) => {
        if (!open) closeDialog();
      }}
      title={question === undefined ? '' : `Open ${opening(question)}`}
      description={question === undefined ? undefined : `${visible} of your accounts can see it.`}
      state={state}
      action={{
        label,
        working: 'Opening…',
        // After a choice that couldn't be remembered, the way on is to open with it all the same.
        again: label,
        keys: labels('enter'),
        disabled: usable ? undefined : 'Choose an account',
        onRun: confirm,
      }}
      problem={
        error === undefined || chosen === undefined || question === undefined
          ? undefined
          : {
              // For what it was to be remembered for: the owner, or this repository alone.
              title: `Couldn’t remember ${chosen} for ${question.remember === 'owner' ? question.owner : `${question.owner}/${question.name}`}`,
              details: error,
            }
      }
      leaveKeys={labels('esc')}
      onKeyDown={onKeyDown}
      container={container}
      testId="account-picker"
    >
      <Choices
        label="Account"
        items={items}
        value={chosen}
        onChange={(next) => {
          setChosen(next);
          setError(undefined);
        }}
      />
      <div className="flex items-center gap-12 border-t border-border-subtle pt-12">
        <span id={rememberLabel} className="min-w-0 flex-1 text-ui-strong">
          Remember for {where}
        </span>
        <Switch
          checked={remember}
          onCheckedChange={(on) => {
            setRemember(on);
            setError(undefined);
          }}
          aria-labelledby={rememberLabel}
        />
      </div>
    </Dialog>
  );
}
