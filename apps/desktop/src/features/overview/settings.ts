// The overview's setting: what a pull request's tab opens on when it has an overview. The window
// shows it in Settings › Pull requests, and reads it as a tab opens.

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
  {
    group: 'pullRequests',
    label: 'Open pull requests on',
    description: 'A pull request with no overview opens on the diff.',
    options: { overview: 'Overview', diff: 'Diff' },
  },
);
export type OpenOn = typeof open.fallback;
