// The updates feature's window side: the toast that says a newer Lo is out, downloading or ready,
// Settings' Updates section, and the commands from the command palette and the app menu, each of
// which asks main to act. A check says what it found in a note; main refuses a command that doesn't
// apply now, and a note says why.

import { handlers } from '@lo/ui/commands';
import { createElement } from 'react';

import type { WindowFeature } from '../../../window/features.ts';
import { defineView } from '../../../window/slots.tsx';
import { contract as app } from '../../app/contract.ts';
import { client } from '../../../window/ipc.ts';
import { toasts } from '../../tab/window/shared.ts';
import keys from '../keys.ts';
import { check, install, later, main, move, restart } from './actions.ts';
import { Offer } from './Offer.tsx';
import Settings from './Settings.tsx';
import { showState, showVersion } from './store.ts';

export default {
  commands: handlers(keys, {
    check: { run: check },
    install: { run: install },
    restart: { run: restart },
    move: { run: move },
    later: { run: later },
  }),
  views: [
    defineView(toasts, { id: 'updates.offer', order: 0, render: () => createElement(Offer) }),
    Settings,
  ],
  start() {
    const updates = main();
    // Subscribed first, so no change between the two is missed. Whatever main pushes is newer than
    // its answer, which it gave from what it knew when it was asked.
    let pushed = false;
    updates.subscribe('state', (state) => {
      pushed = true;
      showState(state);
    });
    updates
      .read()
      .then((state) => {
        if (!pushed) showState(state);
      })
      .catch((error: unknown) => console.error("Lo couldn't read where updates stand:", error));
    client(app)
      .info()
      .then(({ version }) => showVersion(version))
      .catch((error: unknown) => console.error("Lo couldn't read its version:", error));
  },
} satisfies WindowFeature;
