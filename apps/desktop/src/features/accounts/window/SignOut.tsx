// The sign-out dialog: which account to sign out of, when there are several, and what signing out
// does, before it does it. Its body stays put while it signs out: the main button is busy, and a
// sign-out that failed says so above the foot, with the main button trying again.

import { Choices, Dialog, type ChoiceItem, type DialogState } from '@lo/ui';
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useStore } from 'zustand';

import { IpcError } from '../../../ipc/contract.ts';
import { closeDialog } from './dialogs.ts';
import { enterOffControls } from './focus.ts';
import { labels } from './labels.ts';
import { main } from './main.ts';
import { how } from './Picker.tsx';
import { accountsStore, type OpenDialog } from './store.ts';

type SignOut = Extract<OpenDialog, { kind: 'signOut' }>;

/** The sign-out dialog, open while `dialog` is the dialog open. */
export function SignOutView({
  dialog,
  container,
}: {
  dialog: SignOut | undefined;
  container: HTMLElement | null;
}) {
  const accounts = useStore(accountsStore, (state) => state.accounts) ?? [];
  const logins = dialog?.logins ?? [];
  // With one account there's nothing to pick. With several, nothing is picked until the person does.
  const only = logins.length === 1 ? logins[0] : undefined;
  const [picked, setPicked] = useState<string>();
  const [error, setError] = useState<{ login: string; details: string }>();
  const [busy, setBusy] = useState(false);
  const chosen = only ?? picked;
  // With several, the first account takes focus: the main button waits for a choice.
  const choice = useRef<HTMLElement | null>(null);
  const choices = useCallback((element: HTMLDivElement | null) => {
    choice.current = element?.querySelector<HTMLElement>('[role="radio"]:not(:disabled)') ?? null;
  }, []);

  // Each time it opens, nothing is picked and nothing is said.
  useEffect(() => {
    setPicked(undefined);
    setError(undefined);
    setBusy(false);
  }, [dialog]);

  const items: ChoiceItem<string>[] = logins.map((login) => {
    const account = accounts.find((each) => each.login.toLowerCase() === login.toLowerCase());
    return { value: login, title: login, description: how(account) };
  });

  const signOut = () => {
    if (dialog === undefined || chosen === undefined || busy) return;
    setBusy(true);
    setError(undefined);
    main()
      .remove({ login: chosen })
      .then(
        () => {
          if (accountsStore.getState().dialog === dialog) closeDialog();
        },
        (thrown: unknown) => {
          setBusy(false);
          setError({
            login: chosen,
            details: thrown instanceof IpcError ? thrown.message : String(thrown),
          });
        },
      );
  };

  // `⏎` signs out once an account is picked, from its choice or off the buttons; before that it
  // picks the choice it's on.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (chosen === undefined) return;
    const onChoice =
      event.target instanceof Element && event.target.getAttribute('role') === 'radio';
    const plain = !(event.metaKey || event.ctrlKey || event.altKey || event.shiftKey);
    if ((onChoice && event.key === 'Enter' && plain) || enterOffControls(event)) {
      event.preventDefault();
      signOut();
    }
  };

  const state: DialogState = busy ? 'working' : error === undefined ? 'ask' : 'failed';
  return (
    <Dialog
      open={dialog !== undefined}
      onOpenChange={(open) => {
        if (!open) closeDialog();
      }}
      title={only === undefined ? 'Sign out' : `Sign out of ${only}?`}
      size="sm"
      state={state}
      action={{
        label: only === undefined && chosen !== undefined ? `Sign out of ${chosen}` : 'Sign out',
        working: 'Signing out…',
        keys: labels('enter'),
        disabled: chosen === undefined ? 'Choose an account' : undefined,
        onRun: signOut,
      }}
      problem={
        error === undefined
          ? undefined
          : { title: `Couldn’t sign out of ${error.login}`, details: error.details }
      }
      leaveKeys={labels('esc')}
      initialFocus={only === undefined ? choice : undefined}
      onKeyDown={onKeyDown}
      container={container}
      testId="sign-out"
    >
      <p className="m-0 text-fg-muted">
        Its sign-in is deleted from this computer. Repos that opened with it ask for an account
        again.
      </p>
      {only === undefined && (
        <div ref={choices}>
          <Choices
            label="Account"
            items={items}
            value={picked}
            onChange={(next) => {
              setPicked(next);
              setError(undefined);
            }}
          />
        </div>
      )}
    </Dialog>
  );
}
