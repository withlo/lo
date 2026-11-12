import { handlers } from '@lo/ui/commands';

import type { WindowFeature } from '../../../window/features.ts';
import { client } from '../../../window/ipc.ts';
import { contract as tabs } from '../../tab/contract.ts';
import { kinds } from '../../tab/window/shared.ts';
import { contract } from '../contract.ts';
import keys from '../keys.ts';
import Appearance from './Appearance.tsx';
import Cache from './Cache.tsx';
import Keys from './Keys.tsx';
import Opening from './Opening.tsx';
import { canMoveSection, moveSection } from './nav.ts';
import { SettingsTab } from './Page.tsx';
import { showSettings } from './store.ts';
import { defineView } from '../../../window/slots.tsx';
import { createElement } from 'react';

export default {
  commands: handlers(keys, {
    open: {
      run: () =>
        client(tabs)
          .open({ kind: 'settings' })
          .then(() => undefined),
    },
    nextSection: {
      run: () => moveSection(1),
      enabled: () => (canMoveSection() ? true : 'Settings is not open.'),
    },
    previousSection: {
      run: () => moveSection(-1),
      enabled: () => (canMoveSection() ? true : 'Settings is not open.'),
    },
  }),
  views: [
    // Settings is drawn in its tab, and in no other.
    defineView(kinds, {
      id: 'settings.tab',
      order: 0,
      render: ({ tab }) => (tab.kind === 'settings' ? createElement(SettingsTab) : null),
    }),
    Opening,
    Appearance,
    Cache,
    Keys,
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
  },
} satisfies WindowFeature;
