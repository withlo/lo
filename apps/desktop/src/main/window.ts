import { BrowserWindow, type Session } from 'electron';

import { windowChrome } from '../platform/index.ts';
import { tokens, type Theme } from './tokens.ts';

/**
 * Opens Lo's window on `url`, in `session`. The page runs sandboxed, in its own JavaScript world,
 * with no Node and no webviews; `secureSession` and `secureContents` decide what it may load.
 */
export function openWindow(session: Session, url: string): BrowserWindow {
  const theme: Theme = 'dark';
  const ground = tokens.color('lo-bg', theme);
  const window = new BrowserWindow({
    title: 'Lo',
    width: 1280,
    height: 800,
    minWidth: 720,
    minHeight: 480,
    show: false,
    backgroundColor: ground,
    ...windowChrome(process.platform, {
      ground,
      symbols: tokens.color('lo-fg-muted', theme),
      height: tokens.size('lo-tabbar-h'),
    }),
    webPreferences: {
      session,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      webviewTag: false,
      spellcheck: false,
    },
  });
  window.once('ready-to-show', () => window.show());
  window.loadURL(url).catch((error: unknown) => {
    console.error(`Lo couldn't load its window from ${url}:`, error);
  });
  return window;
}
