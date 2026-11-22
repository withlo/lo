import { handlers } from '@lo/ui/commands';
import { createElement } from 'react';

import type { WindowFeature } from '../../../window/features.ts';
import { client } from '../../../window/ipc.ts';
import { defineView } from '../../../window/slots.tsx';
import { contract as tabs } from '../../tab/contract.ts';
import { kinds, stripEnd } from '../../tab/window/shared.ts';
import { contract } from '../contract.ts';
import keys from '../keys.ts';
import Appearance, { followMotion } from './Appearance.tsx';
import Cache from './Cache.tsx';
import { Gear } from './Gear.tsx';
import Keys from './Keys.tsx';
import { canMoveSection, moveSection, search } from './nav.ts';
import { SettingsTab } from './Page.tsx';
import { showSettings } from './store.ts';

/** Why a key for Settings' page can't run: the page isn't open. */
const onPage = () => (canMoveSection() ? true : 'Settings isn’t open');

export default {
  commands: handlers(keys, {
    open: {
      run: () =>
        client(tabs)
          .open({ kind: 'settings' })
          .then(() => undefined),
    },
    nextSection: { run: () => moveSection(1), enabled: onPage },
    previousSection: { run: () => moveSection(-1), enabled: onPage },
    search: { run: search, enabled: onPage },
  }),
  views: [
    // Settings is drawn in its tab, and in no other.
    defineView(kinds, {
      id: 'settings.tab',
      order: 0,
      render: ({ tab }) => (tab.kind === 'settings' ? createElement(SettingsTab) : null),
    }),
    defineView(stripEnd, { id: 'settings.gear', order: 10, render: () => createElement(Gear) }),
    ...Appearance,
    ...Keys,
    ...Cache,
  ],
  start() {
    const settings = client(contract);
    // Subscribed first, so no change between the two is missed. Whatever main pushes is newer
    // than its answer, which it gave from the file as it was when it was asked.
    let pushed = false;
    settings.subscribe('state', (state) => {
      pushed = true;
      showSettings(state);
    });
    settings
      .read()
      .then((state) => {
        if (!pushed) showSettings(state);
      })
      .catch((error: unknown) => console.error("Lo couldn't read the settings:", error));
    followMotion();
  },
} satisfies WindowFeature;
