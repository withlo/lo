// The merge panel's keys. `m` opens it from anywhere in a pull request's tab, over Vim's `m` in
// code views in normal mode, as `gv` does the revision picker: Vim's marks are little use in a
// diff. In it, `j` and `k` move between the reasons, `o` opens the page of the one the keyboard is
// on, `Tab` and `⇧Tab` step through the merge methods the repository allows, `e` edits the squash
// commit's title and message, `]t` goes to the next unresolved conversation, and `Esc` closes it.
// In the commit's fields, `Esc` goes back to the panel. The header's merge status has a right-click
// menu that opens the panel, and each reason one that opens its page: both are rows to the menus,
// which only the merge feature's commands are listed for. `⏎` in the panel merges, or adds the pull
// request to the merge queue, once the dialog it opens is confirmed; that dialog takes its own
// `⏎` and `Esc`. `a` turns auto-merge on the same way, through the dialog, or with it on turns it
// off at once, and `⌥⏎` merges past the base branch's rules, which its dialog confirms only with the
// pull request's number typed. When Lo can't tell whether a merge it sent went, the status's menu
// asks GitHub again, as the banner that says so does. `⌘⇧⏎` approves and ships the pull request on
// screen, from anywhere in its tab but where a box, a dialog, the palette or a menu has the keys,
// through one dialog that lists each step and takes its own `⏎` and `Esc`; the status's menu
// offers it too.

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
    /**
     * Plans the merge the panel offers, and opens the dialog that confirms it in the panel's place:
     * straight in with the method shown, or into the merge queue.
     */
    merge: {
      label: 'Merge or add to the merge queue',
      group: 'Review',
      keys: ['enter'],
      when: panel,
    },
    /**
     * Plans auto-merge, for the dialog to confirm, when only waits block the merge: GitHub merges
     * it, or adds it to the merge queue, once they clear. With auto-merge on, turns it off at once.
     */
    autoMerge: {
      label: 'Turn auto-merge on or off',
      group: 'Review',
      keys: ['a'],
      when: panel,
    },
    /**
     * Plans a merge past the base branch's rules, for an account GitHub lets bypass them, and opens
     * the dialog that confirms it with the pull request's number typed.
     */
    override: {
      label: 'Merge without the rules',
      group: 'Review',
      keys: ['alt+enter'],
      when: panel,
    },
    /**
     * After Lo couldn't tell whether a merge it sent went: asks GitHub again, as the banner's "Ask
     * GitHub again" does. A read: nothing is sent again.
     */
    askAgain: {
      label: 'Ask GitHub whether it merged',
      group: 'Review',
      keys: [],
      targets: ['row', 'none'],
      when: { except: ['menu', 'dialog', 'palette', 'box'] },
      menu: { on: 'row', order: 10 },
    },
    /**
     * Approves the revision on screen and merges it, adds it to the merge queue or turns on
     * auto-merge, as GitHub allows once approved, through one dialog that lists each step to
     * confirm.
     */
    ship: {
      label: 'Approve and ship',
      group: 'Review',
      keys: ['cmd+shift+enter'],
      targets: ['row', 'none'],
      when: { except: ['box', 'dialog', 'palette', 'menu'] },
      menu: { on: 'row', order: 5 },
      bar: { menu: 'Review', order: 20 },
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
