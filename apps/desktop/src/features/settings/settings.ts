// The settings this feature owns: how Lo looks and moves, and how much room its local copies may
// take. Main applies the theme and the cap, the window applies motion, and Settings shows them.

import { z } from 'zod';

import { defineSetting } from './contract.ts';

/** Lo's colors: its dark theme, its light one, or whichever the system is in. */
export const theme = defineSetting(
  'theme',
  z.enum(['dark', 'light', 'system']),
  'system',
  'dark, light or system',
  {
    group: 'appearance',
    label: 'Theme',
    description: 'System follows the computer’s light or dark appearance.',
    options: { dark: 'Dark', light: 'Light', system: 'System' },
  },
);
export type ThemeChoice = typeof theme.fallback;

/**
 * Whether the window's moves are off: `system` follows the system's Reduce Motion, `on` turns them
 * off and `off` keeps them. Tests that start Lo with every move off (`LO_MOTION=reduce`) keep them
 * off whatever this says.
 */
export const motion = defineSetting(
  'motion.reduce',
  z.enum(['system', 'on', 'off']),
  'system',
  'system, on or off',
  {
    group: 'appearance',
    label: 'Reduce motion',
    description: 'Menus, dialogs and panels appear at once, without moving.',
    options: { system: 'System', on: 'On', off: 'Off' },
  },
);

/** The most Settings offers as the cache's cap, in GB. */
export const CACHE_CAP_MAX = 10_000;

/** The size the cache is kept under, in GB. Past it, Lo removes the least recently used copies. */
export const cacheCap = defineSetting(
  'cache.cap',
  z.number().int().min(1).max(CACHE_CAP_MAX),
  10,
  `a whole number of GB, from 1 to ${CACHE_CAP_MAX.toLocaleString('en-US')}`,
  {
    group: 'storage',
    label: 'Size limit',
    description: 'Past it, the least recently used local copies are removed.',
  },
);

/** What a GB is for the cap: 1024³ bytes, as the cache counts. */
export const GB = 1024 ** 3;
