// The updates feature's window side: the toast that says a newer Lo is out, downloading or ready,
// Settings' About rows, and the commands from the command palette and the app menu: the five
// that ask main to act, and those of the toast's other buttons. Each applies only to where updates
// stand: the app menu greys the rest, and the palette says why when one is chosen anyway. A check
// says what it found in a note; main refuses a command that doesn't apply now, and a note says why.

import { handlers } from '@lo/ui/commands';
import { createElement } from 'react';

import { menuStale } from '../../../window/commands/bar.ts';
import { announce } from '../../../window/commands/notices.tsx';
import type { WindowFeature } from '../../../window/features.ts';
import { client } from '../../../window/ipc.ts';
import { defineView } from '../../../window/slots.tsx';
import { contract as app } from '../../app/contract.ts';
import { toasts } from '../../tab/window/shared.ts';
import keys from '../keys.ts';
import {
  check,
  copyBrewCommand,
  goToToast,
  hear,
  install,
  later,
  main,
  move,
  openUpdatePage,
  readHow,
  restart,
} from './actions.ts';
import {
  canCheck,
  canCopy,
  canDownload,
  canGoTo,
  canHide,
  canInstall,
  canMove,
  canRestart,
  menuKey,
} from './applies.ts';
import { Offer } from './Offer.tsx';
import Settings from './Settings.tsx';
import { showVersion, updatesStore } from './store.ts';
import { buildOf } from './words.ts';

/** Where updates stand, for what a command applies to. */
const now = () => updatesStore.getState();

export default {
  commands: handlers(keys, {
    check: { run: () => check(), enabled: () => canCheck(now().checking) },
    install: { run: install, enabled: () => canInstall(now().state) },
    restart: { run: restart, enabled: () => canRestart(now().state) },
    move: { run: move, enabled: () => canMove(now().state, now().how) },
    later: { run: later, enabled: () => canHide(now().state) },
    // With none on offer, what's new is on the list of Lo's releases.
    whatsNew: { run: openUpdatePage },
    download: { run: openUpdatePage, enabled: () => canDownload(now().state) },
    copy: {
      async run() {
        if (await copyBrewCommand()) announce('Copied Homebrew command');
      },
      enabled: () => canCopy(now().state),
    },
    focus: { run: goToToast, enabled: () => canGoTo(now().state) },
  }),
  views: [
    defineView(toasts, { id: 'updates.offer', order: 0, render: () => createElement(Offer) }),
    ...Settings,
  ],
  start() {
    const updates = main();
    // Subscribed first, so no change between the two is missed. Whatever main pushes is newer than
    // its answer, which it gave from what it knew when it was asked.
    let pushed = false;
    updates.subscribe('state', (state) => {
      pushed = true;
      hear(state);
    });
    updates
      .read()
      .then((state) => {
        if (!pushed) hear(state);
      })
      .catch((error: unknown) => console.error("Lo couldn't read where updates stand:", error));
    void readHow();
    client(app)
      .info()
      .then(({ version, packaged, commit }) => showVersion(version, buildOf({ packaged, commit })))
      .catch((error: unknown) => console.error("Lo couldn't read its version:", error));
    // The app menu greys what doesn't apply, so it's made again when what applies changes.
    updatesStore.subscribe((next, before) => {
      if (
        menuKey(next.state, next.checking, next.how) !==
        menuKey(before.state, before.checking, before.how)
      ) {
        menuStale();
      }
    });
  },
} satisfies WindowFeature;
