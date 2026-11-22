// The updates feature's setting: whether Lo checks for a newer version by itself. Off, it checks
// only when asked to: from the command palette, the app menu, Settings or the overview.

import { z } from 'zod';

import { defineSetting } from '../settings/contract.ts';

/** Whether Lo checks GitHub Releases by itself: 30 s after its window is up, and every 6 hours. */
export const check = defineSetting('updates.check', z.boolean(), true, 'true or false', {
  group: 'about',
  label: 'Check for updates automatically',
  named: 'automatic update checks',
  description: 'Checks at startup, then every 6 h.',
});
