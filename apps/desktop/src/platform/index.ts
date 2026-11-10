import type { BrowserWindow, BrowserWindowConstructorOptions } from 'electron';

import { linuxChrome, linuxPaint, type Strip } from './linux.ts';
import { macChrome, macPaint } from './mac.ts';

export type { Strip };

/** The window's title bar and controls on this system. Lo draws its own tab strip on both. */
export function windowChrome(
  platform: NodeJS.Platform,
  strip: Strip,
): BrowserWindowConstructorOptions {
  return platform === 'darwin' ? macChrome() : linuxChrome(strip);
}

/** Repaints the window's own colors, behind its page and in its controls, in the strip's colors. */
export function paintChrome(window: BrowserWindow, platform: NodeJS.Platform, strip: Strip): void {
  if (platform === 'darwin') macPaint(window, strip.ground);
  else linuxPaint(window, strip);
}
