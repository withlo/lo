import { fileURLToPath } from 'node:url';

import { BrowserWindow, Menu, nativeTheme, type Session } from 'electron';

import { editMenu, paintChrome, windowChrome, type Strip } from '../platform/index.ts';
import { tokens, type Theme } from './tokens.ts';

/** The preload's build output, next to main's. */
const preload = fileURLToPath(new URL('../preload/index.cjs', import.meta.url));

/** The tab strip's colors and height in the system's current appearance. */
function strip(): Strip {
  const theme: Theme = nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
  return {
    ground: tokens.color('lo-bg', theme),
    symbols: tokens.color('lo-fg-muted', theme),
    height: tokens.size('lo-tabbar-h'),
  };
}

/**
 * Opens Lo's window on `url`, in `session`. The page runs sandboxed, in its own JavaScript world,
 * with no Node and no webviews; `secureSession` and `secureContents` decide what it may load. Its
 * only way to main is the preload's `window.lo`.
 */
export function openWindow(session: Session, url: string): BrowserWindow {
  const colors = strip();
  const window = new BrowserWindow({
    title: 'Lo',
    width: 1280,
    height: 800,
    minWidth: 720,
    minHeight: 480,
    show: false,
    backgroundColor: colors.ground,
    ...windowChrome(process.platform, colors),
    webPreferences: {
      session,
      preload,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      webviewTag: false,
    },
  });
  window.once('ready-to-show', () => window.show());

  // A right-click in a text field gets the system's Edit menu. Lo's own menus skip text fields.
  window.webContents.on('context-menu', (_event, params) => {
    if (!params.isEditable) return;
    const { webContents } = window;
    Menu.buildFromTemplate(editMenu(params, (word) => webContents.replaceMisspelling(word))).popup({
      window,
    });
  });

  // The window's own colors follow the system's appearance, as its page does.
  const repaint = () => paintChrome(window, process.platform, strip());
  nativeTheme.on('updated', repaint);
  window.once('closed', () => nativeTheme.off('updated', repaint));

  window.loadURL(url).catch((error: unknown) => {
    console.error(`Lo couldn't load its window from ${url}:`, error);
  });
  return window;
}
