// The stacks' keys. `]s` and `[s` show the next and previous layer of the stack on screen, in the
// order its tree lists them, or with a count that many on, and `gS` makes the chain the pull
// request on screen is in a GitHub stack, once you confirm what will change: they work anywhere in a
// pull request's tab, and over Vim in code views in normal mode, as `gv` does. `-` in the file tree
// goes up to the stack's tree, and `+` there back down, as Vim's `-` and `+` go up and down a line.
// In the stack's tree single keys act on the layer the keyboard is on: moving, showing it, and
// opening it on GitHub.
// `v` there chooses a run of layers to view as one diff, as Vim's `V` selects lines: `j` and `k`
// grow it, `⏎` shows it and `Esc` stops. In a run on screen, `Esc` in the diff, once nothing nearer
// takes it, goes back to the layer it was chosen from. A layer's right-click menu shows it, chooses
// a run from it, views the stack up to it as one diff, opens it on GitHub or makes its chain a
// GitHub stack.

import { defineCommands, type When } from '@lo/ui/commands';

/** Anywhere in a pull request's tab, but where a widget or a comment box has the keys. */
const anywhere: When = { except: ['menu', 'dialog', 'palette', 'box'], mode: 'normal' };

/** In the stack's tree. */
const tree: When = { scope: 'stack' };

export default defineCommands(
  'stacks',
  {
    /**
     * Shows the next layer of the stack, bottom up, each branch finished before the next, and stops
     * at the last. Showing a layer isn't a jump: each layer keeps its own place, and `[s` comes back.
     * A count goes that many layers, as far as the last.
     */
    nextLayer: {
      label: 'Next layer',
      group: 'Jump',
      keys: ['] s'],
      when: anywhere,
      count: 'layers',
    },
    previousLayer: {
      label: 'Previous layer',
      group: 'Jump',
      keys: ['[ s'],
      when: anywhere,
      count: 'layers',
    },
    /**
     * Goes up from the file tree to the stack's tree, at the layer on screen; for a pull request
     * that isn't in a stack, back to the file on screen in the tree, as `-` does from the code.
     */
    focus: {
      label: 'Go to the stack, or the file on screen',
      group: 'Files',
      keys: ['-'],
      when: { scope: 'tree' },
    },
    /** Goes down from the stack's tree to the file tree, at the file on screen. */
    files: {
      label: 'Go to the file tree',
      group: 'Files',
      keys: ['+'],
      when: tree,
    },
    down: {
      label: 'Next layer in the stack',
      group: 'Panels',
      keys: ['j', 'down'],
      when: tree,
      repeat: true,
    },
    up: {
      label: 'Previous layer in the stack',
      group: 'Panels',
      keys: ['k', 'up'],
      when: tree,
      repeat: true,
    },
    /**
     * Shows the layer the keyboard is on, or the one right-clicked; while a run is being chosen,
     * the run, as one diff.
     */
    show: {
      label: 'Show this layer',
      group: 'Panels',
      keys: ['enter'],
      targets: ['layer'],
      when: tree,
      menu: { on: 'layer', order: 0 },
    },
    /**
     * Starts choosing a run of layers at the one the keyboard is on, or the one right-clicked: `j`
     * and `k` move its other end along that layer's branch, and `⏎` shows the run as one diff.
     * Vim's `V` selects lines, and `v` is the tree's own.
     */
    choose: {
      label: 'Choose a run from here',
      group: 'Panels',
      keys: ['v'],
      targets: ['layer'],
      when: tree,
      menu: { on: 'layer', order: 10 },
    },
    /** Shows the layers from the stack's bottom up to this one as one diff. */
    upTo: {
      label: 'View the stack up to here as one diff',
      group: 'Panels',
      keys: [],
      targets: ['layer'],
      menu: { on: 'layer', order: 20 },
    },
    /**
     * Stops choosing a run, the layer the keyboard is on staying where it is; otherwise, as
     * anywhere, back to the middle view.
     */
    cancel: {
      label: 'Stop choosing a run, or back to the middle view',
      group: 'Panels',
      keys: ['esc'],
      when: tree,
    },
    /**
     * In a run of layers on screen, once the diff has nothing of its own open that `Esc` closes,
     * goes back to the layer the run was chosen from. Elsewhere it's `Esc` as anywhere.
     */
    back: {
      label: 'Back from a run to its layer',
      group: 'Jump',
      keys: ['esc'],
      when: { scope: 'diff', mode: 'normal' },
    },
    openOnGithub: {
      label: 'Open on GitHub',
      group: 'Copy and open',
      keys: ['g x'],
      targets: ['layer'],
      when: tree,
      menu: { on: 'layer', order: 30 },
    },
    /**
     * Plans making the chain the pull request on screen is in a GitHub stack, or in the stack's
     * tree the chain through the layer the keyboard is on, which shows first, and asks before
     * anything changes, or says every reason it can't. `g` already prefixes places and toggles, and
     * the capital keeps it a key apart from them.
     */
    convert: {
      label: 'Make this a GitHub stack',
      group: 'Review',
      keys: ['g S'],
      targets: ['layer', 'none'],
      when: anywhere,
      menu: { on: 'layer', order: 40 },
    },
  },
  { scopes: ['stack'] },
);
