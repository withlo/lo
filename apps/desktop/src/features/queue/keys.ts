// The merge queue's keys. `gq` opens the merge queue for the base branch of the pull request on
// screen in a tab of its own, or shows it: anywhere in a pull request's tab, and over Vim in code
// views in normal mode, where `gq` would format lines, which Lo's read-only code never does. In the
// queue's tab, `j` and `k` move between the pull requests, `⏎` opens the one the keyboard is on in
// its own tab, `Tab` and `⇧Tab` show the next and previous branch's queue, and `gx` opens the pull
// request on GitHub, or the queue itself when there's none to open.

import { defineCommands, type When } from '@lo/ui/commands';

/** In the merge queue's tab. */
const queue: When = { scope: 'queue' };

export default defineCommands(
  'queue',
  {
    show: {
      label: 'Merge queue',
      group: 'Review',
      keys: ['g q'],
      overVim: true,
      when: { except: ['menu', 'dialog', 'palette', 'box'], mode: 'normal' },
    },
    down: {
      label: 'Next pull request in the queue',
      group: 'Merge queue',
      keys: ['j', 'down'],
      when: queue,
      repeat: true,
    },
    up: {
      label: 'Previous pull request in the queue',
      group: 'Merge queue',
      keys: ['k', 'up'],
      when: queue,
      repeat: true,
    },
    /** Opens the pull request the keyboard is on, or the one right-clicked, in its own tab. */
    open: {
      label: 'Open the pull request',
      group: 'Merge queue',
      keys: ['enter'],
      targets: ['row'],
      when: queue,
      menu: { on: 'row', order: 0 },
    },
    /** Shows the queue of the next branch the header's switch lists, round the end. */
    nextBranch: {
      label: 'Next branch’s queue',
      group: 'Merge queue',
      keys: ['tab'],
      when: queue,
    },
    previousBranch: {
      label: 'Previous branch’s queue',
      group: 'Merge queue',
      keys: ['shift+tab'],
      when: queue,
    },
    /** The pull request on GitHub, or the queue itself while the keyboard is on none. */
    openOnGithub: {
      label: 'Open on GitHub',
      group: 'Copy and open',
      keys: ['g x'],
      targets: ['row', 'none'],
      when: queue,
      menu: { on: 'row', order: 40 },
    },
  },
  { scopes: ['queue'] },
);
