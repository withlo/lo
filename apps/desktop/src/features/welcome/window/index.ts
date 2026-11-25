import { handlers } from '@lo/ui/commands';
import { createElement } from 'react';

import type { WindowFeature } from '../../../window/features.ts';
import { client } from '../../../window/ipc.ts';
import { defineView } from '../../../window/slots.tsx';
import { contract as app } from '../../app/contract.ts';
import { cover, dialogs } from '../../tab/window/shared.ts';
import keys from '../keys.ts';
import { back, enter, loadState, show } from './actions.ts';
import { Cover } from './Cover.tsx';
import { Rules } from './Rules.tsx';
import { CommandStep, LinksRow, LinksStep, WelcomeRow } from './Setup.tsx';
import { setup } from './shared.ts';
import { showGit, STEPS, welcomeStore } from './store.ts';

export default {
  commands: handlers(keys, {
    show: { run: show },
    continue: {
      run: enter,
      enabled: () => (welcomeStore.getState().shown ? true : 'The welcome isn’t open'),
    },
    back: {
      run: back,
      enabled: () => {
        const { shown, step } = welcomeStore.getState();
        if (!shown) return 'The welcome isn’t open';
        // On the first step, its dimmed label says it all.
        return step === STEPS[0] ? '' : true;
      },
    },
  }),
  views: [
    defineView(cover, { id: 'welcome.cover', order: 0, render: Cover }),
    defineView(dialogs, { id: 'welcome.rules', order: 20, render: () => createElement(Rules) }),
    defineView(setup, {
      id: 'welcome.command',
      order: 10,
      render: () => createElement(CommandStep),
    }),
    defineView(setup, { id: 'welcome.links', order: 20, render: () => createElement(LinksStep) }),
    LinksRow,
    WelcomeRow,
  ],
  start() {
    void loadState();
    const git = client(app);
    // Subscribed first, so no change between the two is missed. Whatever main pushes is newer
    // than its answer, which it gave from what it knew when it was asked.
    let pushed = false;
    git.subscribe('git', (found) => {
      pushed = true;
      showGit(found);
    });
    git
      .info()
      .then(({ git: found }) => {
        if (!pushed) showGit(found);
      })
      .catch((error: unknown) => console.error("Lo couldn't ask what Lo found of git:", error));
  },
} satisfies WindowFeature;
