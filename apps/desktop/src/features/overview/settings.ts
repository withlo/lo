// The overview's setting: what a pull request's tab opens on when it has an overview. The window
// shows it in Settings' Opening PRs, and reads it as a tab opens.

import { z } from 'zod';

import { defineSetting } from '../settings/contract.ts';

/**
 * What a pull request's tab opens on when the pull request has an overview Lo can show: the
 * overview, or the diff. Without one, it always opens on the diff.
 */
export const open = defineSetting(
  'overview.open',
  z.enum(['overview', 'diff']),
  'overview',
  'overview or diff',
);
export type OpenOn = typeof open.fallback;
