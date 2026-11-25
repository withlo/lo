// The overview's setting: whether there are overviews at all. The window shows it in Settings ›
// Pull requests, before what a pull request's tab opens on, and main reads it before it reads one.

import { z } from 'zod';

import { defineSetting } from '../settings/contract.ts';

/**
 * Whether there are overviews. On, as Lo starts, a pull request's tab has the Overview view, with
 * its mark and status item, the overview's notes in the diff and its marks in a stack; Lo reads
 * each pull request's overview, and offers the prompts that write one and the overview skill. Off,
 * none of it is anywhere, and nothing is read. On again, it all comes back.
 */
export const on = defineSetting('overview.on', z.boolean(), true, 'true or false', {
  group: 'pullRequests',
  label: 'Show overviews',
  named: 'whether overviews show',
  description: 'Overviews coding agents write, the prompts for them and the overview skill.',
});
