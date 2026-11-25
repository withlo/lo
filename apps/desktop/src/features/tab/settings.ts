// The tab's setting: which of its middle views a pull request's tab opens on. The window shows it in
// Settings › Pull requests, and reads it as a tab opens. And the key it replaced, which main carries
// over once.

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

/**
 * The key `tab.open` replaced, from when a tab opened on the overview or the diff: `overview` or
 * `diff`, or `null` once main has carried it over. Main carries a `diff` over to `tab.open` once,
 * where `tab.open` is still its default, then sets this to `null`, so a later choice stands. Only
 * in the file, and only main writes it.
 */
export const before = defineSetting(
  'overview.open',
  z.enum(['overview', 'diff']).nullable(),
  null,
  'overview, diff or null',
  {
    group: 'file',
    label: 'Open on, before',
    description: 'Replaced by where pull requests open, which takes its value once.',
    window: 'read',
  },
);
