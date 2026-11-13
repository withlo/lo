import { formatVersion, type GitStatus } from '@lo/git';
import { app, BrowserWindow, nativeTheme } from 'electron';

import { holdLimit } from '../../../main/environment.ts';
import { defineFeature } from '../../../main/features.ts';
import { pageNonce } from '../../../main/security.ts';
import { appInfo, contract, type GitInfo, type Theme } from '../contract.ts';
import { zoomed } from './zoom.ts';

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
  },
  start({ publish, git }) {
    nativeTheme.on('updated', () => publish('theme', currentTheme()));
    git.onStatus((status) => publish('git', gitInfo(status)));
  },
});
