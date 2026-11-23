import { handlers } from '@lo/ui/commands';

import { IpcError } from '../../../ipc/contract.ts';
import { barItems, focusedTarget, onMenuStale, runFromBar } from '../../../window/commands/bar.ts';
import { applyKeymapFile, keymapOpenable } from '../../../window/commands/keymap.ts';
import { currentMenu, openMenuAtFocus } from '../../../window/commands/menus.tsx';
import { notify, refuse } from '../../../window/commands/notices.tsx';
import { showHighlighted, toggleHelp, togglePalette } from '../../../window/commands/overlays.tsx';
import { escapeToMiddle, here, registry } from '../../../window/commands/registry.ts';
import type { WindowFeature } from '../../../window/features.ts';
import { client, type Client } from '../../../window/ipc.ts';
import { contract } from '../contract.ts';
import keys from '../keys.ts';

/**
 * Keeps main's app menu in step with the registry: its commands' labels, keys and whether they
 * can run where focus is, and when a feature says that has changed. Sends only when something
 * changed.
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
  onMenuStale(soon);
  // Back and Forward dim where the tab's history has nowhere to go.
  registry().history.subscribe(soon);
  window.addEventListener('focusin', soon);
  window.addEventListener('focusout', soon);
  send();
}

/** The feature's client, made when it's needed, once the window's bridge is there. */
function main(): Client<typeof contract> {
  return client(contract);
}

/** Applies the keymap file main reads, and each change to it. */
function syncKeymap(file: Client<typeof contract>): void {
  let pushed = false;
  // Subscribed first, so no change between the two is missed. Whatever main pushes is newer than
  // its answer, which it gave from the file as it was when it was asked.
  file.subscribe('keymap', (keymap) => {
    pushed = true;
    applyKeymapFile(keymap);
  });
  file
    .readKeymap()
    .then((keymap) => {
      if (!pushed) applyKeymapFile(keymap);
    })
    .catch((error: unknown) => console.error("Lo couldn't read the keymap file:", error));
}

/** Opens the keymap file, and says why in a toast if it can't be. */
async function openKeymap(): Promise<void> {
  try {
    await main().openKeymap();
  } catch (error) {
    console.error("Lo couldn't open the keymap file:", error);
    notify(
      'Open the keymap file',
      error instanceof IpcError && error.code === 'unopened'
        ? error.message
        : "Lo couldn't open the keymap file.",
    );
  }
}

/** Why Back stays: the one place before is where the cursor is now. */
const BACK_HERE = 'You’re already where Back goes';
/** Why Back stays: each file or block it would show again is gone, as a push removes a file. */
const BACK_GONE = 'What you saw before this is gone';
/** Why Forward stays, the same way. */
const FORWARD_GONE = 'What you went back from is gone';

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
    escape: { run: escapeToMiddle },
    // With no history, Back and Forward are dimmed, which says it all: their keys do nothing, and
    // say nothing. Whether they can run follows the history alone, which the app menu hears, not
    // where the cursor is. Run, and finding nowhere to go after all, they say why.
    back: {
      run() {
        const { history } = registry();
        const at = here();
        if (!history.canBack(at)) refuse(BACK_HERE);
        else if (!history.back(at)) refuse(BACK_GONE);
      },
      enabled: () => registry().history.canBack() || '',
    },
    forward: {
      run() {
        if (!registry().history.forward()) refuse(FORWARD_GONE);
      },
      enabled: () => registry().history.canForward() || '',
    },
    // A file Lo won't open says why when asked, as any command that can't run does.
    openKeymap: { run: openKeymap, enabled: keymapOpenable },
  }),
  start() {
    const menu = main();
    syncKeymap(menu);
    // A click in the app menu runs through the registry, on what has focus, as a key would. Only
    // the menu's own commands run this way.
    menu.subscribe('run', ({ id }) => {
      // A right-click menu is open over the window, and nothing but its own commands runs under it.
      if (currentMenu() !== undefined) {
        refuse('Close the menu first');
        return;
      }
      runFromBar(registry(), id, focusedTarget());
    });
    // Linux has no app menu.
    if (registry().system === 'mac') syncMenu(menu);
  },
} satisfies WindowFeature;
