import type { BrowserWindowConstructorOptions } from 'electron';

/**
 * On macOS the window has no title bar, and its traffic lights sit inset over Lo's tab strip. The
 * strip starts after them, at `--lo-window-inset-start`.
 */
export function macChrome(): BrowserWindowConstructorOptions {
  return { titleBarStyle: 'hiddenInset' };
}
