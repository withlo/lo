// The feature's dialogs over the window, in the tab feature's `tab.dialogs` slot: whichever one is
// open, as the store says.

import { useStore } from 'zustand';

import { ImportView } from './Import.tsx';
import { PickerView } from './Picker.tsx';
import { SignInView } from './SignIn.tsx';
import { SignOutView } from './SignOut.tsx';
import { accountsStore } from './store.ts';

export function AccountDialogs() {
  const dialog = useStore(accountsStore, (state) => state.dialog);
  const container = document.getElementById('root');
  return (
    <>
      <SignInView dialog={dialog?.kind === 'signIn' ? dialog : undefined} container={container} />
      <ImportView open={dialog?.kind === 'import'} container={container} />
      <PickerView dialog={dialog?.kind === 'pick' ? dialog : undefined} container={container} />
      <SignOutView dialog={dialog?.kind === 'signOut' ? dialog : undefined} container={container} />
    </>
  );
}
