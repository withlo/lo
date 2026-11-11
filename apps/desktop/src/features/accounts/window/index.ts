import { handlers } from '@lo/ui/commands';
import { createElement } from 'react';

import type { WindowFeature } from '../../../window/features.ts';
import { defineView } from '../../../window/slots.tsx';
import { dialogs } from '../../tab/window/shared.ts';
import keys from '../keys.ts';
import Accounts from './Accounts.tsx';
import { copyCode, heardSignIn, waitingSignIn } from './dialogs.ts';
import { AccountDialogs } from './AccountDialogs.tsx';
import { main } from './main.ts';
import { showAccounts } from './store.ts';

export default {
  commands: handlers(keys, {
    copyCode: {
      run: () => copyCode(),
      enabled: () => (waitingSignIn() === undefined ? 'No sign-in is waiting for its code.' : true),
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
