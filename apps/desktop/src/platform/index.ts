import type { BrowserWindowConstructorOptions } from 'electron';

import { linuxChrome, type Strip } from './linux.ts';
import { macChrome } from './mac.ts';

export type { Strip };

/** The window's title bar and controls on this system. Lo draws its own tab strip on both. */
export function windowChrome(
  platform: NodeJS.Platform,
  strip: Strip,
): BrowserWindowConstructorOptions {
  return platform === 'darwin' ? macChrome() : linuxChrome(strip);
}
