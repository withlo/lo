import { join } from 'node:path';

import { formatVersion, type GitStatus } from '@lo/git';
import { app, BrowserWindow, nativeTheme } from 'electron';

import { launch, query } from '../../../main/editor.ts';
import { holdLimit, keymapEditor } from '../../../main/environment.ts';
import { defineFeature } from '../../../main/features.ts';
import { pageNonce } from '../../../main/security.ts';
import { IpcError } from '../../../ipc/contract.ts';
import { appInfo, contract, type GitInfo, type Theme } from '../contract.ts';
import { aboutOptions, buildOf } from './about.ts';
import { licensesPath, openLicenses } from './licenses.ts';
import { zoomed } from './zoom.ts';

/** The commit this build is of, which electron-vite defines when it builds main. Empty if unknown. */
declare const LO_COMMIT: string;

/** Lo's window: the one a key was just pressed in, or else its only one. */
function loWindow(): BrowserWindow | undefined {
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
}

// Lo follows the system's appearance.
const currentTheme = (): Theme => (nativeTheme.shouldUseDarkColors ? 'dark' : 'light');

/** What the window hears of what Lo found of git. */
function gitInfo(status: GitStatus | undefined): GitInfo {
  if (status === undefined) return { status: 'checking' };
  if (status.status === 'found') {
    return { status: 'found', version: formatVersion(status.git.version) };
  }
  if (status.status === 'missing') {
    return { status: 'missing', message: status.message, install: status.install };
  }
  const { version, check, message, install } = status;
  return { status: 'tooOld', version: formatVersion(version), check, message, install };
}

export default defineFeature(contract, {
  handlers: {
    // Checked as a push is, so the window gets nothing but what the contract says.
    info: (_input, { git }) =>
      appInfo.parse({
        version: app.getVersion(),
        platform: process.platform,
        theme: currentTheme(),
        git: gitInfo(git.status),
        packaged: app.isPackaged,
        nonce: pageNonce(),
        holdLimit: holdLimit({ packaged: app.isPackaged, env: process.env }),
      }),
    about() {
      app.showAboutPanel();
    },
    quit() {
      app.quit();
    },
    zoom({ step }) {
      const contents = loWindow()?.webContents;
      if (contents) contents.zoomLevel = zoomed(contents.zoomLevel, step);
    },
    fullScreen() {
      const window = loWindow();
      window?.setFullScreen(!window.isFullScreen());
    },
    async licenses() {
      // Lo's own file, opened as text and never run.
      const result = await openLicenses(
        licensesPath({
          packaged: app.isPackaged,
          resources: process.resourcesPath,
          app: app.getAppPath(),
        }),
        {
          platform: process.platform,
          launch,
          linux: { query, env: process.env, home: app.getPath('home') },
          editor: keymapEditor({ packaged: app.isPackaged, env: process.env }),
        },
      );
      if (!result.ok) throw new IpcError('unopened', result.reason);
    },
  },
  start({ publish, git }) {
    app.setAboutPanelOptions(
      aboutOptions({
        platform: process.platform,
        name: app.name,
        version: app.getVersion(),
        build: buildOf({ packaged: app.isPackaged, commit: LO_COMMIT }),
        // Linux's panel shows it; a build run from source has no copy of it beside it.
        icon: app.isPackaged ? join(process.resourcesPath, 'icon.png') : undefined,
      }),
    );
    nativeTheme.on('updated', () => publish('theme', currentTheme()));
    git.onStatus((status) => publish('git', gitInfo(status)));
  },
});
