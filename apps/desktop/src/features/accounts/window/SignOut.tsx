// The sign-out dialog: which account to sign out of, when there are several, and what signing out
// does, before it does it.

import { Button, Choices, Dialog, DialogSpacer, Key, type ChoiceItem } from '@lo/ui';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
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
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const primary = useRef<HTMLButtonElement>(null);
  const chosen = only ?? picked;

  // Each time it opens, nothing is picked and nothing is said.
  useEffect(() => {
    setPicked(undefined);
    setError(undefined);
    setBusy(false);
  }, [dialog]);

  const items: ChoiceItem<string>[] = logins.map((login) => {
    const account = accounts.find((each) => each.login.toLowerCase() === login.toLowerCase());
    const description = how(account);
    return {
      value: login,
      title: login,
      description: description === '' ? undefined : description,
    };
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
          setError(
            thrown instanceof IpcError ? thrown.message : `Lo couldn't sign out of ${chosen}.`,
          );
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

  return (
    <Dialog
      open={dialog !== undefined}
      onOpenChange={(open) => {
        if (!open) closeDialog();
      }}
      title={only === undefined ? 'Sign out of which account?' : `Sign out of ${only}?`}
      onKeyDown={onKeyDown}
      initialFocus={only === undefined ? undefined : primary}
      container={container}
      testId="sign-out"
      foot={
        <>
          <DialogSpacer />
          <Button onClick={closeDialog}>
            Cancel
            <Key keys={labels('esc')} decorative />
          </Button>
          <Button
            ref={primary}
            variant="primary"
            disabled={chosen === undefined || busy}
            onClick={signOut}
          >
            {only === undefined && chosen !== undefined ? `Sign out of ${chosen}` : 'Sign out'}
            <Key keys={labels('enter')} decorative className="text-on-accent" />
          </Button>
        </>
      }
    >
      <p className="m-0 text-fg-muted">
        Lo removes {only === undefined ? 'its' : `${only}'s`} token from this computer and forgets
        which repos open with it.
      </p>
      {only === undefined && (
        <Choices label="Account" items={items} value={picked} onChange={setPicked} />
      )}
      {error !== undefined && (
        <p role="alert" className="m-0 text-danger text-small">
          {error}
        </p>
      )}
    </Dialog>
  );
}
