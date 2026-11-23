import { join } from 'node:path';

import { formatVersion, type GitStatus } from '@lo/git';
import { app, BrowserWindow, nativeTheme, type WebContents } from 'electron';

import { launch, query } from '../../../main/editor.ts';
import { troubleOf } from '../../../main/git.ts';
import { holdLimit, keymapEditor } from '../../../main/environment.ts';
import { defineFeature } from '../../../main/features.ts';
import { pageNonce } from '../../../main/security.ts';
import { IpcError } from '../../../ipc/contract.ts';
import { settings } from '../../settings/service.ts';
import { appInfo, contract, type GitInfo, type Theme } from '../contract.ts';
import { gpu, zoom } from '../settings.ts';
import { aboutOptions, buildOf, shortHash } from './about.ts';
import { licensesPath, openLicenses } from './licenses.ts';
import { zoomed } from './zoom.ts';

/** The commit this build is of, which electron-vite defines when it builds main. Empty if unknown. */
declare const LO_COMMIT: string;

/** Lo's window: the one a key was just pressed in, or else its only one. */
function loWindow(): BrowserWindow | undefined {
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
}

/** The zoom the window draws at, from `window.zoom`, once main has read it. */
let drawnAt = 100;

/**
 * How many zoom steps are being written. The window is drawn at each step before it's written, so
 * the file catching up meanwhile, a step behind, isn't drawn: fast presses would flash back.
 */
let zoomWrites = 0;

/** Draws `contents` at the zoom set, as it is now. */
function applyZoom(contents: WebContents): void {
  contents.setZoomFactor(drawnAt / 100);
}

/** Draws every window at `percent`. */
function drawAt(percent: number): void {
  drawnAt = percent;
  for (const window of BrowserWindow.getAllWindows()) applyZoom(window.webContents);
}

// Lo follows the system's appearance.
const currentTheme = (): Theme => (nativeTheme.shouldUseDarkColors ? 'dark' : 'light');

/** What the window hears of what Lo found of git. */
function gitInfo(status: GitStatus | undefined): GitInfo {
  if (status === undefined) return { status: 'checking' };
  if (status.status === 'found') {
    return { status: 'found', version: formatVersion(status.git.version) };
  }
  return troubleOf(status);
}

export default defineFeature(contract, {
  uses: [settings],
  handlers: {
    // Checked as a push is, so the window gets nothing but what the contract says.
    info: (_input, { git }) =>
      appInfo.parse({
        version: app.getVersion(),
        platform: process.platform,
        theme: currentTheme(),
        git: gitInfo(git.status),
        packaged: app.isPackaged,
        commit: shortHash(LO_COMMIT),
        nonce: pageNonce(),
        holdLimit: holdLimit({ packaged: app.isPackaged, env: process.env }),
      }),
    about() {
      app.showAboutPanel();
    },
    quit() {
      app.quit();
    },
    // The setting is the zoom, so a step is written there to last. The window zooms at once all
    // the same, from where it's drawn, as it always has: a settings file Lo can't write keeps the
    // step from lasting, not from happening.
    async zoom({ step }, { use }) {
      const next = zoomed(drawnAt, step);
      drawAt(next);
      zoomWrites += 1;
      try {
        await use(settings).update(zoom, () => next);
      } catch (error) {
        if (!(error instanceof IpcError)) throw error;
        console.error(`Lo couldn't save the zoom: ${error.message}`);
      } finally {
        zoomWrites -= 1;
      }
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
      // Why, as the code; what the system said, if anything, behind Details.
      if (!result.ok) throw new IpcError(result.why, result.said ?? '');
    },
  },
  start({ publish, git, use }) {
    // Main read `app.gpu` before `ready`. Declared, a value it took as on because it wasn't true
    // or false is reported in Settings.
    use(settings).declare(gpu);
    // Chromium keeps a page's zoom by its origin, and starts a page it loads at its own, so each
    // page the window loads is drawn at the setting's again.
    app.on('browser-window-created', (_event, window) => {
      window.webContents.on('did-navigate', () => applyZoom(window.webContents));
    });
    use(settings).watch(zoom, (percent) => {
      if (zoomWrites === 0) drawAt(percent);
    });
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
