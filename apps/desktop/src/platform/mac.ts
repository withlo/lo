import type { BrowserWindow, BrowserWindowConstructorOptions } from 'electron';

/**
 * On macOS the window has no title bar, and its traffic lights sit inset over Lo's tab strip. The
 * strip starts after them, at `--lo-window-inset-start`.
 */
export function macChrome(): BrowserWindowConstructorOptions {
  return { titleBarStyle: 'hiddenInset' };
}

/** The traffic lights follow the system's appearance by themselves. */
export function macPaint(window: BrowserWindow, ground: string): void {
  window.setBackgroundColor(ground);
}
