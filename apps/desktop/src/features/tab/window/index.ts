import { handlers, type History, type NoTarget, type TabTarget } from '@lo/ui/commands';

import { registry } from '../../../window/commands/registry.ts';
import type { WindowFeature } from '../../../window/features.ts';
import { client } from '../../../window/ipc.ts';
import { contract as app } from '../../app/contract.ts';
import type { Choice } from '../contract.ts';
import keys from '../keys.ts';
import { follow } from './follow.ts';
import { main } from './main.ts';
import { showTabs, tabsStore } from './store.ts';

declare global {
  interface Window {
    /** The registry's history, for the smoke test, in a build run from source. */
    loHistory?: History;
  }
}

/** Asks main to show a tab. */
function select(choice: Choice): Promise<void> {
  return main().select(choice);
}

/** Why `target`, a tab or the one on screen, can't be closed, or `true` when it can. */
function closable(target: TabTarget | NoTarget): true | string {
  const { tabs, active } = tabsStore.getState();
  const id = target.kind === 'tab' ? target.tab : active;
  return tabs.find((tab) => tab.id === id)?.kind === 'recent'
    ? "Recent pull requests can't be closed: it shows while no other tab is open."
    : true;
}

export default {
  commands: handlers(keys, {
    show1: { run: () => select({ position: 1 }) },
    show2: { run: () => select({ position: 2 }) },
    show3: { run: () => select({ position: 3 }) },
    show4: { run: () => select({ position: 4 }) },
    show5: { run: () => select({ position: 5 }) },
    show6: { run: () => select({ position: 6 }) },
    show7: { run: () => select({ position: 7 }) },
    show8: { run: () => select({ position: 8 }) },
    showLast: { run: () => select({ last: true }) },
    next: { run: () => select({ step: 1 }) },
    previous: { run: () => select({ step: -1 }) },
    // Main closes the tab on screen as it has it, so two quick presses close two tabs.
    close: {
      run: (target) => main().close(target.kind === 'tab' ? { id: target.tab } : {}),
      enabled: closable,
    },
  }),
  start() {
    const tabs = main();
    // The registry and the title follow the tabs from the first time main says what they are.
    follow(registry(), tabsStore, (title) => {
      document.title = title;
    });
    // Subscribed first, so no change between the two is missed.
    tabs.subscribe('tabs', showTabs);
    tabs
      .list()
      .then(showTabs)
      .catch((error: unknown) => console.error("Lo couldn't list its tabs:", error));
    // The smoke test records places of its own in the history, to walk them by key.
    client(app)
      .info()
      .then(({ packaged }) => {
        if (!packaged) window.loHistory = registry().history;
      })
      .catch((error: unknown) => console.error("Lo couldn't ask how it was built:", error));
  },
} satisfies WindowFeature;
