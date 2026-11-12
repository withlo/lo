// The file tree's keys: `-` goes to the tree at the file on screen, and in the tree single keys act
// on it: the tree or review order, changed files only, moving, opening and closing folders,
// showing a file, and marking it viewed. A file's right-click menu opens it whole, copies its path,
// opens it on GitHub or marks it viewed.
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
      label: 'Go to a file',
      group: 'Find',
      keys: ['cmd+p'],
      overVim: true,
      when: { except: ['dialog', 'palette'] },
    },
    /**
     * In the file finder, lists only the changed files, or all the matches again. In a palette `Tab`
     * moves nothing, so the finder has it for its own.
     */
    findChanged: {
      label: 'Changed files only in the file finder',
      group: 'Palettes',
      keys: ['tab'],
      when: { scope: 'palette' },
    },
    /**
     * In the file finder, opens the highlighted file whole, changed or not: `⏎` shows a changed
     * file in the diff instead.
     */
    findWhole: {
      label: 'Whole file from the file finder',
      group: 'Palettes',
      keys: ['cmd+enter'],
      when: { scope: 'palette' },
    },
    /**
     * Focuses the tree at the file on screen. In a code view `-` is Vim's line up, which `k` and
     * `↑` do as well.
     */
    focus: {
      label: 'Go to the file tree',
      group: 'Files',
      keys: ['-'],
      overVim: true,
      when: { except: ['menu', 'dialog', 'palette', 'box'], mode: 'normal' },
    },
    /** Switches between the tree and the changed files in review order. */
    mode: { label: 'Tree or review order', group: 'Files', keys: ['t'], when: tree },
    /** Shows only the changed files, still as a tree, or every file again. */
    changedOnly: { label: 'Changed files only', group: 'Files', keys: ['f'], when: tree },
    down: {
      label: 'Next row of the tree',
      group: 'Files',
      keys: ['j', 'down'],
      when: tree,
      repeat: true,
    },
    up: {
      label: 'Previous row of the tree',
      group: 'Files',
      keys: ['k', 'up'],
      when: tree,
      repeat: true,
    },
    /** Opens a folder, or on an open one goes to what's in it. */
    open: {
      label: 'Open the folder',
      group: 'Files',
      keys: ['l', 'right'],
      when: tree,
      repeat: true,
    },
    /** Closes a folder, or goes to the folder a row is in. */
    close: {
      label: 'Close the folder',
      group: 'Files',
      keys: ['h', 'left'],
      when: tree,
      repeat: true,
    },
    openAll: { label: 'Open every folder', group: 'Files', keys: ['z R'], when: tree },
    closeAll: { label: 'Close every folder', group: 'Files', keys: ['z M'], when: tree },
    /**
     * Shows the file: a changed one at the top of the diff. On a folder, opens or closes it. Not a
     * jump of its own: showing a file records one, as a click does, and a folder moves nothing.
     */
    show: {
      label: 'Show the file',
      group: 'Files',
      keys: ['enter'],
      targets: ['file', 'none'],
      when: tree,
    },
    /**
     * Marks the changed file viewed, or clears its mark. Marking goes on to the next changed file
     * that isn't viewed, in the panel's order, round the end.
     */
    markViewed: {
      label: 'Mark viewed',
      group: 'Act',
      keys: ['e'],
      targets: ['file'],
      when: tree,
      menu: { on: 'file', order: 5 },
    },
    /** Opens the file whole and read-only, changed or not. */
    wholeFile: {
      label: 'Whole file',
      group: 'Copy and open',
      keys: ['g f'],
      targets: ['file'],
      jump: true,
      when: tree,
      menu: { on: 'file', order: 10 },
    },
    copyPath: {
      label: 'Copy path',
      group: 'Copy and open',
      keys: ['y p'],
      targets: ['file'],
      when: tree,
      menu: { on: 'file', order: 20 },
    },
    /** The file in the pull request's changes on GitHub, or for an unchanged file, at the head. */
    openOnGithub: {
      label: 'Open on GitHub',
      group: 'Copy and open',
      keys: ['g x'],
      targets: ['file'],
      when: tree,
      menu: { on: 'file', order: 30 },
    },
  },
  { scopes: ['tree'] },
);
