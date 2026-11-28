// The overview's settings: whether there are overviews at all, which the window shows in Settings ›
// Pull requests, before what a pull request's tab opens on, and main reads before it reads one; and
// whether coding agents write them as they push, in Settings › Integrations, which only the overview
// skill's hook reads.

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

/**
 * Whether coding agents write the overview of each pull request they open or push to by themselves,
 * in a clone with a repository's overview skill, `lo-overview`. Its hook reads this in the settings
 * file, and `.lo/settings.json`'s in the clone, and false in either turns it off. Lo reads it for
 * nothing of its own: a person's own skill, `lo-explain`, never starts by itself.
 */
export const auto = defineSetting('overview.auto', z.boolean(), true, 'true or false', {
  group: 'integrations',
  label: 'Automatic overviews',
  description:
    'Coding agents write an overview as they push, in repositories with the overview skill.',
});
