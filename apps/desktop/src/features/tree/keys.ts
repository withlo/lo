// The file tree's keys: `-` goes to the tree at the file on screen, and in the tree single keys act
// on it: the tree or review order, changed files only, moving, as in the overview, with counts,
// opening and closing folders, showing a file, and marking it viewed. A file's right-click menu
// opens it whole, copies its path, opens it on GitHub or marks it viewed.
// `⌘P` finds any file in the repository by name, and in the finder `Tab` lists the changed files
// only and `⌘⏎` opens the highlighted file whole.

import { defineCommands, type When } from '@lo/ui/commands';

const tree: When = { scope: 'tree' };

export default defineCommands(
  'tree',
  {
    /**
     * The file finder: any file in the repository, found by name, the changed ones first. Not in
     * a dialog or a palette, which hold the keys while they're open. On Linux Ctrl+P is Vim's line
     * up in a code view, which `k` and `↑` do as well.
     */
    find: {
      label: 'Go to file…',
      group: 'Go',
      keys: ['cmd+p'],
      bar: { menu: 'Go', section: 'find', order: 10 },
      overVim: true,
      when: { except: ['dialog', 'palette'] },
    },
    /**
     * In the file finder, lists only the changed files, or all the matches again. In a palette `Tab`
     * moves nothing, so the finder has it for its own.
     */
    findChanged: {
      label: 'Changed files only',
      group: 'Go',
      keys: ['tab'],
      when: { scope: 'palette' },
    },
    /**
     * In the file finder, opens the highlighted file whole, changed or not: `⏎` shows a changed
     * file in the diff instead.
     */
    findWhole: {
      label: 'Open whole file',
      group: 'Go',
      keys: ['cmd+enter'],
      when: { scope: 'palette' },
    },
    /**
     * Focuses the tree at the file on screen. In a code view `-` is Vim's line up, which `k` and
     * `↑` do as well. In the tree, `-` goes on up, to the stack above it; in the stack, there's
     * nothing further up.
     */
    focus: {
      label: 'Go to files',
      control: 'a click in the files tree',
      group: 'Go',
      keys: ['-'],
      overVim: true,
      when: { except: ['menu', 'dialog', 'palette', 'box', 'tree', 'stack'], mode: 'normal' },
    },
    /**
     * Lists the files as a tree, as the setting, for every pull request: with `tree.reviewOrder`, a
     * choice of two.
     */
    asTree: {
      label: 'Tree',
      control: 'Tree in the Files toolbar',
      group: 'View',
      // `t` is the switch's, which comes back to the tree.
      keys: [],
      when: tree,
    },
    /**
     * A switch, as the setting: lists only the changed files, in review order, or the tree again,
     * for every pull request.
     */
    reviewOrder: {
      label: 'Review order',
      control: 'Review order in the Files toolbar',
      group: 'View',
      keys: ['t'],
      when: tree,
    },
    /** Shows only the changed files, still as a tree, or every file again. */
    changedOnly: {
      label: 'Changed files only',
      control: 'Changed files only in the Files toolbar',
      group: 'View',
      keys: ['f'],
      when: tree,
    },
    down: {
      label: 'Next row',
      group: 'Go',
      keys: ['j', 'down'],
      when: tree,
      repeat: true,
      count: 'rows',
    },
    up: {
      label: 'Previous row',
      group: 'Go',
      keys: ['k', 'up'],
      when: tree,
      repeat: true,
      count: 'rows',
    },
    top: { label: 'Go to top', group: 'Go', keys: ['g g', 'home'], when: tree },
    bottom: { label: 'Go to bottom', group: 'Go', keys: ['G', 'end'], when: tree },
    /** A page of rows on, as many as the tree shows. */
    pageDown: {
      label: 'Page down',
      group: 'Go',
      keys: ['pagedown'],
      when: tree,
      repeat: true,
    },
    pageUp: {
      label: 'Page up',
      group: 'Go',
      keys: ['pageup'],
      when: tree,
      repeat: true,
    },
    /** Opens a folder, or on an open one goes to what's in it. */
    open: {
      label: 'Expand folder',
      control: "a closed folder's row in the files tree",
      group: 'View',
      keys: ['l', 'right'],
      when: tree,
      repeat: true,
    },
    /** Closes a folder, or goes to the folder a row is in. */
    close: {
      label: 'Collapse folder',
      control: "an open folder's row in the files tree",
      group: 'View',
      keys: ['h', 'left'],
      when: tree,
      repeat: true,
    },
    openAll: { label: 'Expand all folders', group: 'View', keys: ['z R'], when: tree },
    closeAll: { label: 'Collapse all folders', group: 'View', keys: ['z M'], when: tree },
    /**
     * Shows the file: a changed one at the top of the diff. On a folder, opens or closes it, as a
     * click does. Not a jump of its own: showing a file records one, as a click does, and a folder
     * moves nothing.
     */
    show: {
      label: 'Show file',
      control: "a file's row in the files tree",
      group: 'Go',
      keys: ['enter'],
      targets: ['file', 'none'],
      when: tree,
    },
    /**
     * Marks the changed file viewed, or clears its mark. Marking goes on to the next changed file
     * that isn't viewed, in the panel's order, round the end. A count marks that many, and clears
     * none, as in the diff.
     */
    markViewed: {
      label: 'Mark viewed',
      group: 'Review',
      keys: ['e'],
      targets: ['file'],
      when: tree,
      count: 'files',
      menu: { on: 'file', order: 5 },
    },
    /** Opens the file whole and read-only, changed or not. */
    wholeFile: {
      label: 'Open whole file',
      group: 'Code',
      keys: ['g f'],
      targets: ['file'],
      jump: true,
      when: tree,
      menu: { on: 'file', order: 10 },
    },
    copyPath: {
      label: 'Copy path',
      group: 'Code',
      keys: ['y p'],
      targets: ['file'],
      when: tree,
      menu: { on: 'file', order: 20 },
    },
    /** The file in the pull request's changes on GitHub, or for an unchanged file, at the head. */
    openOnGithub: {
      label: 'Open on GitHub',
      group: 'Code',
      keys: ['g x'],
      targets: ['file'],
      when: tree,
      menu: { on: 'file', order: 30 },
    },
  },
  { scopes: ['tree'] },
);
