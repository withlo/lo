// The merge panel's keys. `m` opens it from anywhere in a pull request's tab, over Vim's `m` in
// code views in normal mode, as `gv` does the revision picker: Vim's marks are little use in a
// diff. In it, `j` and `k` move between the reasons, `o` opens the page of the one the keyboard is
// on, `Tab` and `⇧Tab` step through the merge methods the repository allows, `e` edits the squash
// commit's title and message, `]t` goes to the next unresolved conversation, and `Esc` closes it.
// In the commit's fields, `Esc` goes back to the panel. The header's merge status has a right-click
// menu that opens the panel, and each reason one that opens its page: both are rows to the menus,
// which only the merge feature's commands are listed for.

import { defineCommands, type When } from '@lo/ui/commands';

/** In the merge panel, but not in its commit's fields. */
const panel: When = { scope: 'merge' };

export default defineCommands(
  'merge',
  {
    /** Opens the merge panel under the header's merge status, at the reasons it can't merge. */
    panel: {
      label: 'Merge panel',
      group: 'Review',
      keys: ['m'],
      targets: ['row', 'none'],
      overVim: true,
      when: { except: ['menu', 'dialog', 'palette', 'box', 'merge', 'commit'], mode: 'normal' },
      menu: { on: 'row', order: 0 },
    },
    down: {
      label: 'Next reason',
      group: 'Review',
      keys: ['j', 'down'],
      when: panel,
      repeat: true,
    },
    up: {
      label: 'Previous reason',
      group: 'Review',
      keys: ['k', 'up'],
      when: panel,
      repeat: true,
    },
    /**
     * Opens the page of the reason the keyboard is on, or the one right-clicked: a check's run, or
     * the pull request.
     */
    open: {
      label: 'Open the reason’s page',
      group: 'Review',
      keys: ['o'],
      targets: ['row', 'none'],
      when: panel,
      menu: { on: 'row', order: 0, label: 'Open' },
    },
    nextMethod: { label: 'Next merge method', group: 'Review', keys: ['tab'], when: panel },
    previousMethod: {
      label: 'Previous merge method',
      group: 'Review',
      keys: ['shift+tab'],
      when: panel,
    },
    /** Goes to the squash commit's title, to change what GitHub would write. */
    edit: {
      label: 'Edit the commit’s title and message',
      group: 'Review',
      keys: ['e'],
      when: panel,
    },
    /** Closes the panel and goes to the next unresolved conversation in the diff. */
    nextThread: {
      label: 'Next unresolved conversation',
      group: 'Review',
      keys: ['] t'],
      when: panel,
    },
    close: { label: 'Close the merge panel', group: 'Review', keys: ['esc'], when: panel },
    /** Leaves the commit's fields for the panel, keeping what was typed. */
    leaveCommit: {
      label: 'Back to the merge panel',
      group: 'Review',
      keys: ['esc'],
      when: { scope: 'commit' },
    },
  },
  { scopes: ['merge', 'commit'] },
);
