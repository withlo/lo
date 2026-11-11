import { handlers } from '@lo/ui/commands';

import { barItems, focusedTarget, runFromBar } from '../../../window/commands/bar.ts';
import { currentMenu, openMenuAtFocus } from '../../../window/commands/menus.tsx';
import { notify } from '../../../window/commands/notices.tsx';
import { showHighlighted, toggleHelp, togglePalette } from '../../../window/commands/overlays.tsx';
import { focusMiddle, here, registry } from '../../../window/commands/registry.ts';
import type { WindowFeature } from '../../../window/features.ts';
import { client, type Client } from '../../../window/ipc.ts';
import { contract } from '../contract.ts';
import keys from '../keys.ts';

/**
 * Keeps main's app menu in step with the registry: its commands' labels, keys and whether they
 * can run where focus is. Sends only when something changed.
 */
function syncMenu(menu: Client<typeof contract>): void {
  let sent = '';
  let queued = false;
  const send = () => {
    queued = false;
    const items = barItems(registry(), focusedTarget(), currentMenu() !== undefined);
    const json = JSON.stringify(items);
    if (json === sent) return;
    sent = json;
    menu.menu({ items }).catch((error: unknown) => {
      console.error("Lo couldn't update its menu:", error);
    });
  };
  const soon = () => {
    if (queued) return;
    queued = true;
    queueMicrotask(send);
  };
  registry().subscribe(soon);
  window.addEventListener('focusin', soon);
  window.addEventListener('focusout', soon);
  send();
}

export default {
  commands: handlers(keys, {
    help: { run: toggleHelp },
    palette: { run: togglePalette },
    showKey: {
      run() {
        showHighlighted();
      },
    },
    menu: {
      run() {
        openMenuAtFocus();
      },
    },
    escape: { run: focusMiddle },
    back: {
      run() {
        if (!registry().history.back(here())) notify("There's nowhere to go back to.");
      },
    },
    forward: {
      run() {
        if (!registry().history.forward()) notify("There's nowhere to go forward to.");
      },
    },
  }),
  start() {
    const menu = client(contract);
    // A click in the app menu runs through the registry, on what has focus, as a key would. Only
    // the menu's own commands run this way.
    menu.subscribe('run', ({ id }) => {
      // A right-click menu is open over the window, and nothing but its own commands runs under it.
      if (currentMenu() !== undefined) {
        notify('Close the menu first.');
        return;
      }
      runFromBar(registry(), id, focusedTarget());
    });
    // Linux has no app menu.
    if (registry().system === 'mac') syncMenu(menu);
  },
} satisfies WindowFeature;
