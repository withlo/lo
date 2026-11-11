// The settings this feature owns: how Lo looks, and how much room its local copies may take. Main
// applies them, and the window shows them in Settings.

import { z } from 'zod';

import { defineSetting } from './contract.ts';

/** Lo's colors: its dark theme, its light one, or whichever the system is in. */
export const theme = defineSetting(
  'theme',
  z.enum(['dark', 'light', 'system']),
  'system',
  'dark, light or system',
);
export type ThemeChoice = typeof theme.fallback;

/** The most Settings offers as the cache's cap, in GB. */
export const CACHE_CAP_MAX = 10_000;

/** The size the cache is kept under, in GB. Past it, Lo removes the least recently used copies. */
export const cacheCap = defineSetting(
  'cache.cap',
  z.number().int().min(1).max(CACHE_CAP_MAX),
  10,
  `a whole number of GB, from 1 to ${CACHE_CAP_MAX.toLocaleString('en-US')}`,
);

/** What a GB is for the cap: 1024³ bytes, as the cache counts. */
export const GB = 1024 ** 3;
