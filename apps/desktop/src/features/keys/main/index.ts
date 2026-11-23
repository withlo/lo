// The keys feature in main: the app menu, built from the commands the window lists, whose clicks
// go back to the window to run through its registry, and the keymap file, which main reads, watches
// and opens.

import { join } from 'node:path';

import { app, BrowserWindow, Menu, type MenuItemConstructorOptions } from 'electron';

import { launch, query } from '../../../main/editor.ts';
import { configFolder, devTools, keymapEditor } from '../../../main/environment.ts';
import { defineFeature } from '../../../main/features.ts';
import { appMenu } from '../../../platform/index.ts';
import { IpcError } from '../../../ipc/contract.ts';
import { contract, keymapFile, type BarItem } from '../contract.ts';
import { watchKeymap, type KeymapWatch } from './keymap.ts';
import { openKeymapFile } from './open.ts';

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

/** The app menu as the window last listed its commands. */
let tree: MenuItemConstructorOptions[] = [];

/**
 * Sets the app menu from `tree`. On macOS it's the menu bar, in place of whatever was there,
 * Electron's default included. Lo's window on Linux has no menu bar, so there the menu is kept for
 * the window to open from its tab strip, and Electron's goes with nothing in its place: a menu set
 * there would take keys the page didn't, though it never shows.
 */
function draw(): void {
  Menu.setApplicationMenu(process.platform === 'darwin' ? Menu.buildFromTemplate(tree) : null);
}

/**
 * Draws the menu bar again as the window last listed its commands, once the click that flipped a
 * check in it is over. Linux's menu is made afresh each time it opens.
 */
function redraw(): void {
  if (process.platform === 'darwin') setImmediate(draw);
}

/** Makes the app menu from the commands the window lists. */
function setMenu(items: readonly BarItem[], run: (id: string) => void): void {
  tree = appMenu(process.platform, items, { name: app.name, devTools: tools, run, redraw });
  draw();
}

export default defineFeature(contract, {
  handlers: {
    menu({ items }, { publish }) {
      setMenu(items, (id) => publish('run', { id }));
    },
    popup({ x, y }, _context, { windowId }) {
      const window = windowId === undefined ? undefined : BrowserWindow.fromId(windowId);
      if (!window || tree.length === 0) return;
      // The window says where in CSS pixels; the menu goes by the window's own, at its zoom.
      const zoom = window.webContents.getZoomFactor();
      Menu.buildFromTemplate(tree).popup({
        window,
        x: Math.round(x * zoom),
        y: Math.round(y * zoom),
      });
    },
    async readKeymap() {
      if (!keymap) throw new IpcError('unavailable', 'Lo isn’t watching the keymap file.');
      // Checked as a push is, so the window gets nothing but what the contract says.
      return keymapFile.parse(await keymap.latest());
    },
    async openKeymap() {
      // The only file it opens is the keymap file's. It is checked and opened as text, never run.
      const result = await openKeymapFile(keymapPath(), {
        platform: process.platform,
        launch,
        linux: { query, env: process.env, home: app.getPath('home') },
        editor: keymapEditor({ packaged: app.isPackaged, env: process.env }),
      });
      // Why, as the code; what the system said, if anything, behind Details.
      if (!result.ok) throw new IpcError(result.why, result.said ?? '');
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
