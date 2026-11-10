import type { BrowserWindowConstructorOptions } from 'electron';

/** The tab strip that the system's window controls are drawn over. */
export interface Strip {
  /** Its background color. */
  ground: string;
  /** The color of the controls' symbols. */
  symbols: string;
  /** Its height in pixels. */
  height: number;
}

/**
 * On Linux the window has no frame. The system's controls (minimize, maximize, close) are drawn
 * over the end of Lo's tab strip, in its colors and at its height, and the window reads their width
 * from the overlay's geometry to end the strip before them, at `--lo-window-inset-end`.
 */
export function linuxChrome(strip: Strip): BrowserWindowConstructorOptions {
  return {
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: strip.ground, symbolColor: strip.symbols, height: strip.height },
  };
}
