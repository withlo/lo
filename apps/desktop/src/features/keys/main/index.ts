// The keys feature in main: the app menu, built from the commands the window lists, whose clicks
// go back to the window to run through its registry, and the keymap file, which main reads, watches
// and opens.

import { join } from 'node:path';

import { app, Menu } from 'electron';

import { configFolder, devTools, keymapEditor } from '../../../main/environment.ts';
import { defineFeature } from '../../../main/features.ts';
import { appMenu } from '../../../platform/index.ts';
import { IpcError } from '../../../ipc/contract.ts';
import { contract, keymapFile, type BarItem } from '../contract.ts';
import { watchKeymap, type KeymapWatch } from './keymap.ts';
import { launch, openKeymapFile } from './open.ts';

const tools = devTools({ packaged: app.isPackaged, env: process.env });

/** The keymap file's path: the only file the window can have opened. */
function keymapPath(): string {
  return join(
    configFolder({
      packaged: app.isPackaged,
      platform: process.platform,
      home: app.getPath('home'),
      appData: app.getPath('appData'),
      env: process.env,
    }),
    'keymap',
  );
}

let keymap: KeymapWatch | undefined;

/** Puts the app menu in place of whatever was there, Electron's default included. */
function setMenu(items: readonly BarItem[], run: (id: string) => void): void {
  const template = appMenu(process.platform, items, { name: app.name, devTools: tools, run });
  Menu.setApplicationMenu(template ? Menu.buildFromTemplate(template) : null);
}

export default defineFeature(contract, {
  handlers: {
    menu({ items }, { publish }) {
      setMenu(items, (id) => publish('run', { id }));
    },
    async readKeymap() {
      if (!keymap) throw new IpcError('unavailable', "Lo isn't watching the keymap file.");
      // Checked as a push is, so the window gets nothing but what the contract says.
      return keymapFile.parse(await keymap.latest());
    },
    async openKeymap() {
      // The only file it opens is the keymap file's. It is checked and opened as text, never run.
      const result = await openKeymapFile(keymapPath(), {
        platform: process.platform,
        launch,
        editor: keymapEditor({ packaged: app.isPackaged, env: process.env }),
      });
      if (!result.ok) throw new IpcError('unopened', result.reason);
    },
  },
  start({ publish }) {
    const watch = watchKeymap(keymapPath(), (file) => publish('keymap', file), {
      log: (message, error) => console.error(message, error),
    });
    keymap = watch;
    // Before the window opens, so Electron's default menu never handles a key.
    setMenu([], (id) => publish('run', { id }));
    // With no menu on Linux, the developer tools get their usual key here.
    if (!tools || process.platform === 'darwin') return;
    app.on('browser-window-created', (_event, window) => {
      window.webContents.on('before-input-event', (event, input) => {
        const chord = input.control && input.shift && !input.alt && !input.meta;
        if (input.type === 'keyDown' && chord && input.code === 'KeyI') {
          event.preventDefault();
          window.webContents.toggleDevTools();
        }
      });
    });
  },
  stop() {
    keymap?.stop();
  },
});
