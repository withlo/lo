// The tab's setting: which of its middle views a pull request's tab opens on. The window shows it in
// Settings › Pull requests, and reads it as a tab opens.

import { z } from 'zod';

import { defineSetting } from '../settings/contract.ts';

/**
 * Which middle view a pull request's tab opens on: the one each value names (`overview.view` for
 * `overview`). Overview, with no overview to show, opens on the timeline, where the description is
 * first; so does a value whose view isn't there, as with Overview turned off.
 */
export const open = defineSetting(
  'tab.open',
  z.enum(['overview', 'timeline', 'diff']),
  'overview',
  'overview, timeline or diff',
  {
    group: 'pullRequests',
    label: 'Open pull requests on',
    named: 'where pull requests open',
    // While Overview is on, the row says what Overview opens on without one (`window/index.ts`).
    description: 'The timeline starts with the pull request’s description.',
    options: { overview: 'Overview', timeline: 'Timeline', diff: 'Diff' },
  },
);
export type OpenOn = typeof open.fallback;
