import { handlers } from '@lo/ui/commands';
import { createElement } from 'react';

import { barItems, focusedTarget, onMenuStale, runFromBar } from '../../../window/commands/bar.ts';
import { applyKeymapFile, keymapOpenable, keymapState } from '../../../window/commands/keymap.ts';
import { currentMenu, openMenuAtFocus } from '../../../window/commands/menus.tsx';
import { notify, refuse } from '../../../window/commands/notices.tsx';
import { showHighlighted, toggleHelp, togglePalette } from '../../../window/commands/overlays.tsx';
import { escapeToMiddle, here, registry } from '../../../window/commands/registry.ts';
import type { WindowFeature } from '../../../window/features.ts';
import { client, type Client } from '../../../window/ipc.ts';
import { defineView } from '../../../window/slots.tsx';
import { onSettingsChange } from '../../settings/window/shared.ts';
import { stripEnd } from '../../tab/window/shared.ts';
import { contract } from '../contract.ts';
import keys from '../keys.ts';
import { MenuButton, openAppMenu } from './MenuButton.tsx';
import { keymapWords, unopenedWords } from './words.ts';

/**
 * Keeps main's app menu in step with the registry: its commands' labels, keys, whether they can
 * run where focus is and whether they're checked, and when a feature says that has changed, or a
 * setting a switch follows. Sends only when something changed.
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
  // Back and Forward dim where the tab's history has nowhere to go, and where the cursor is counts:
  // it moves with a key or a click, so the menu looks again after each.
  registry().history.subscribe(soon);
  onSettingsChange(soon);
  window.addEventListener('focusin', soon);
  window.addEventListener('focusout', soon);
  window.addEventListener('keyup', soon, true);
  window.addEventListener('pointerup', soon, true);
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
    applyKeymapFile(keymapWords(keymap));
  });
  file
    .readKeymap()
    .then((keymap) => {
      if (!pushed) applyKeymapFile(keymapWords(keymap));
    })
    .catch((error: unknown) => console.error("Lo couldn't read the keymap file:", error));
}

/** Opens the keymap file, and says why in a toast if it can't be. */
async function openKeymap(): Promise<void> {
  try {
    await main().openKeymap();
  } catch (error) {
    console.error("Lo couldn't open the keymap file:", error);
    const { title, reason, details } = unopenedWords(error, keymapState().refusal);
    notify(title, reason, { details, tone: 'danger' });
  }
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
    escape: { run: escapeToMiddle },
    // With nowhere to go, Back and Forward are dimmed, which says it all: their keys do nothing,
    // and say nothing. A place that's gone, or that's where the cursor is, isn't somewhere to go.
    back: {
      run() {
        registry().history.back(here());
      },
      enabled: () => registry().history.canBack(here()) || '',
    },
    forward: {
      run() {
        registry().history.forward(here());
      },
      enabled: () => registry().history.canForward(here()) || '',
    },
    // A file Lo won't open says why when asked, as any command that can't run does.
    openKeymap: { run: openKeymap, enabled: keymapOpenable },
    appMenu: { run: () => openAppMenu(main()) },
  }),
  views: [
    // Linux's window has no menu bar: the app menu opens from the end of the tab strip, after the
    // gear.
    defineView(stripEnd, {
      id: 'keys.menu',
      order: 20,
      render: () => (registry().system === 'linux' ? createElement(MenuButton) : null),
    }),
  ],
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
    syncMenu(menu);
  },
} satisfies WindowFeature;
