// The merge queue's keys. `gq` opens the merge queue for the base branch of the pull request on
// screen in a tab of its own, or shows it: anywhere in a pull request's tab, and over Vim in code
// views in normal mode, where `gq` would format lines, which Lo's read-only code never does. In the
// queue's tab, `j` and `k` move between the pull requests, `⏎` opens the one the keyboard is on in
// its own tab, `Tab` and `⇧Tab` show the next and previous branch's queue, and `gx` opens the pull
// request on GitHub, or the queue itself when there's none to open. `x` removes the entry the
// keyboard is on from the queue and `J` moves it to the front, each once the dialog it opens is
// confirmed; `a` turns auto-merge off at once for one waiting to join, and for one that left the
// queue opens its tab and asks to turn auto-merge on there, as `a` in its merge panel does.
//
// Each has a control where its target is drawn: a row's buttons and its `⋯` menu, the hints in the
// queue's status bar, the branch switch in its header, and the merge panel's button for the queue.

import { defineCommands, type When } from '@lo/ui/commands';

/** In the merge queue's tab. */
const queue: When = { scope: 'queue' };

export default defineCommands(
  'queue',
  {
    show: {
      label: 'Merge queue',
      control: 'See the queue in a queued pull request’s merge panel',
      group: 'Merge',
      keys: ['g q'],
      overVim: true,
      when: { except: ['menu', 'dialog', 'palette', 'box'], mode: 'normal' },
    },
    down: {
      label: 'Next pull request',
      control: 'Next in the merge queue’s status bar',
      group: 'Merge',
      keys: ['j', 'down'],
      when: queue,
      repeat: true,
    },
    up: {
      label: 'Previous pull request',
      control: 'Previous in the merge queue’s status bar',
      group: 'Merge',
      keys: ['k', 'up'],
      when: queue,
      repeat: true,
    },
    /**
     * Opens the pull request the keyboard is on, the one right-clicked, or the one double-clicked,
     * in its own tab.
     */
    open: {
      label: 'Open pull request',
      control: 'a double click on a row of the merge queue, and Open in its status bar',
      group: 'Merge',
      keys: ['enter'],
      targets: ['row'],
      when: queue,
      menu: { on: 'row', order: 0 },
    },
    /** Removes the entry the keyboard is on, or the one right-clicked, from the queue, once confirmed. */
    remove: {
      label: 'Remove from merge queue…',
      control: 'Remove… on a row of the merge queue',
      group: 'Merge',
      keys: ['x'],
      targets: ['row'],
      when: queue,
      menu: { on: 'row', order: 10, label: 'Remove…' },
    },
    /**
     * Moves the entry the keyboard is on to the front of the queue, once confirmed: GitHub takes it
     * out and adds it again at the front. Only for the repository's admins, and not for the entry
     * at the front.
     */
    jump: {
      label: 'Move to front…',
      control: 'Move to front… on a row of the merge queue',
      group: 'Merge',
      keys: ['J'],
      targets: ['row'],
      when: queue,
      menu: { on: 'row', order: 20 },
    },
    /**
     * Auto-merge for the pull request the keyboard is on: turns it off at once for one waiting to
     * join, and for one that left the queue, asks to turn it on from its own tab. Its handler names
     * it by which it does: "Turn on auto-merge…" on one that left.
     */
    autoMerge: {
      label: 'Turn off auto-merge',
      control: 'Turn off auto-merge on a row waiting to join the merge queue',
      group: 'Merge',
      keys: ['a'],
      targets: ['row'],
      when: queue,
      menu: { on: 'row', order: 30 },
    },
    /** Shows the queue of the next branch the header's switch lists, round the end. */
    nextBranch: {
      label: 'Next branch',
      control: 'the branch switch in the merge queue’s header',
      group: 'Merge',
      keys: ['tab'],
      when: queue,
    },
    previousBranch: {
      label: 'Previous branch',
      control: 'the branch switch in the merge queue’s header',
      group: 'Merge',
      keys: ['shift+tab'],
      when: queue,
    },
    /** The pull request on GitHub, or the queue itself while the keyboard is on none. */
    openOnGithub: {
      label: 'Open on GitHub',
      description: 'The pull request, or the queue.',
      group: 'Merge',
      keys: ['g x'],
      targets: ['row', 'none'],
      when: queue,
      menu: { on: 'row', order: 40 },
    },
  },
  { scopes: ['queue'] },
);
