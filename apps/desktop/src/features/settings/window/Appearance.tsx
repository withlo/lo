// Settings' Appearance rows that are this feature's: the theme, and whether the window moves. Main
// applies the theme; the window applies motion itself, as it's the window that moves.

import { setMotion, type Motion } from '@lo/ui';

import { motion, theme } from '../settings.ts';
import { settingRow, watchSetting } from './shared.ts';

/** What `motion.reduce` sets the window's switch to. */
const MOTION: Record<typeof motion.fallback, Motion> = {
  system: 'system',
  on: 'reduce',
  off: 'full',
};

/**
 * Follows `motion.reduce`, unless the window started with every move off, as tests start it
 * (`LO_MOTION=reduce`): that holds whatever the setting says. Returns a function that stops it.
 */
export function followMotion(): () => void {
  if (document.documentElement.getAttribute('data-lo-motion') === 'reduce') return () => {};
  return watchSetting(motion, (value) => setMotion(MOTION[value]));
}

export default [
  settingRow(theme, { order: 10, id: 'settings.theme' }),
  settingRow(motion, { order: 30, id: 'settings.motion' }),
];
