// The keys feature in main: the app menu, built from the commands the window lists, whose clicks
// go back to the window to run through its registry.

import { app, Menu } from 'electron';

import { devTools } from '../../../main/environment.ts';
import { defineFeature } from '../../../main/features.ts';
import { appMenu } from '../../../platform/index.ts';
import { contract, type BarItem } from '../contract.ts';

const tools = devTools({ packaged: app.isPackaged, env: process.env });

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
  },
  start({ publish }) {
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
