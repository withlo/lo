import { handlers } from '@lo/ui/commands';
import { createElement } from 'react';

import type { WindowFeature } from '../../../window/features.ts';
import { defineView } from '../../../window/slots.tsx';
import { dialogs } from '../../tab/window/shared.ts';
import keys from '../keys.ts';
import Accounts from './Accounts.tsx';
import { heardSignIn, openSignIn, openSignOut, waitingSignIn } from './dialogs.ts';
import { AccountDialogs } from './AccountDialogs.tsx';
import { main } from './main.ts';
import { pressCopyCode } from './SignIn.tsx';
import { accountsStore, showAccounts } from './store.ts';

export default {
  commands: handlers(keys, {
    copyCode: {
      // Its key presses the dialog's own Copy button, which says how it went.
      run: () => pressCopyCode(),
      enabled: () => (waitingSignIn() === undefined ? 'No sign-in is waiting for its code' : true),
    },
    addAccount: { run: () => openSignIn() },
    signOut: {
      run: () => openSignOut((accountsStore.getState().accounts ?? []).map(({ login }) => login)),
      enabled: () =>
        (accountsStore.getState().accounts ?? []).length === 0
          ? "Lo isn't signed in to any account."
          : true,
    },
  }),
  views: [
    defineView(dialogs, {
      id: 'accounts.dialogs',
      order: 0,
      render: () => createElement(AccountDialogs),
    }),
    Accounts,
  ],
  start() {
    const accounts = main();
    // Subscribed first, so no change between the two is missed.
    let pushed = false;
    accounts.subscribe('accounts', (list) => {
      pushed = true;
      showAccounts(list);
    });
    accounts.subscribe('signingIn', heardSignIn);
    accounts
      .list()
      .then((list) => {
        if (!pushed) showAccounts(list);
      })
      .catch((error: unknown) => console.error("Lo couldn't list its accounts:", error));
  },
} satisfies WindowFeature;
