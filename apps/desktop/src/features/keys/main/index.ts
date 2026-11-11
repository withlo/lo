// The keys feature in main: the app menu, built from the commands the window lists, whose clicks
// go back to the window to run through its registry, and the keymap file, which main reads, watches
// and opens.

import { join } from 'node:path';

import { app, Menu, shell } from 'electron';

import { configFolder, devTools } from '../../../main/environment.ts';
import { defineFeature } from '../../../main/features.ts';
import { appMenu } from '../../../platform/index.ts';
import { IpcError } from '../../../ipc/contract.ts';
import { contract, keymapFile, type BarItem } from '../contract.ts';
import { ensureKeymap, watchKeymap, type KeymapWatch } from './keymap.ts';

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
      const path = keymapPath();
      try {
        await ensureKeymap(path);
      } catch (error) {
        console.error("Lo couldn't create the keymap file:", error);
        throw new IpcError('unopened', "Lo couldn't create the keymap file.");
      }
      // An empty answer is success; anything else says why the system couldn't open it.
      const failure = await shell.openPath(path);
      if (failure !== '') {
        console.error("The system couldn't open the keymap file:", failure);
        throw new IpcError('unopened', "Lo couldn't open the keymap file.");
      }
    },
  },
  start({ publish }) {
    const watch = watchKeymap(keymapPath(), (file) => publish('keymap', file), {
      log: (message, error) => console.error(message, error),
    });
    keymap = watch;
    app.once('will-quit', () => watch.stop());
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
});
