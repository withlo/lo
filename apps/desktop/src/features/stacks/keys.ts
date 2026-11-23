// The stacks' keys. `]s` and `[s` show the next and previous layer of the stack on screen, in the
// order its tree lists them, or with a count that many on, and `gS` converts the chain the pull
// request on screen is in to a GitHub stack, once you confirm what will change: they work anywhere
// in a pull request's tab, and over Vim in code views in normal mode, as `gv` does. `-` in the file
// tree goes up to the stack's tree, and `+` there back down, as Vim's `-` and `+` go up and down a
// line. In the stack's tree single keys act on the layer the keyboard is on: moving, showing it,
// and opening it on GitHub.
// `v` there selects layers to show as one diff, as Vim's `V` selects lines: `j` and `k` grow the
// selection, `⏎` shows it and `Esc` stops. With layers shown as one diff, `Esc` in the diff, once
// nothing nearer takes it, goes back to the layer they were selected from. A layer's right-click
// menu shows it, selects layers from it, shows the layers up to it as one diff, opens it on GitHub
// or converts its chain to a GitHub stack.
//
// The arrows in the stack panel's head step through the layers as `]s` and `[s` do, and while
// layers are selected a hint row under them has the selection's keys.

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
      group: 'Go',
      keys: ['] s'],
      when: anywhere,
      count: 'layers',
      control: "the down arrow in the stack panel's head",
    },
    previousLayer: {
      label: 'Previous layer',
      group: 'Go',
      keys: ['[ s'],
      when: anywhere,
      count: 'layers',
      control: "the up arrow in the stack panel's head",
    },
    /**
     * Goes up from the file tree to the stack's tree, at the layer on screen; for a pull request
     * that isn't in a stack, back to the file on screen in the tree, as `-` does from the code.
     */
    focus: {
      label: 'Go to stack',
      group: 'Go',
      keys: ['-'],
      when: { scope: 'tree' },
      control: 'the stack panel, which a click gives the keys',
    },
    /**
     * Goes down from the stack's tree to the file tree, at the file on screen, showing the left
     * panel first while it's hidden.
     */
    files: {
      label: 'Go to files',
      group: 'Go',
      keys: ['+'],
      when: tree,
      control: 'the files, which a click gives the keys',
    },
    /** Moves the keyboard to the next layer in the tree, or, while layers are selected, grows them. */
    down: {
      label: 'Next layer',
      group: 'Go',
      keys: ['j', 'down'],
      when: tree,
      repeat: true,
      control: 'Next in the hint row while layers are selected, and a click on a layer',
    },
    up: {
      label: 'Previous layer',
      group: 'Go',
      keys: ['k', 'up'],
      when: tree,
      repeat: true,
      control: 'Previous in the hint row while layers are selected, and a click on a layer',
    },
    /**
     * Shows the layer the keyboard is on, or the one right-clicked; while layers are selected,
     * those layers, as one diff.
     */
    show: {
      label: 'Show layer',
      group: 'Go',
      keys: ['enter'],
      targets: ['layer'],
      when: tree,
      menu: { on: 'layer', order: 0 },
    },
    /**
     * Starts selecting layers at the one the keyboard is on, or the one right-clicked, to show
     * several layers as one diff: `j` and `k` move the selection's other end along that layer's
     * branch, and `⏎` shows the layers selected as one diff. Vim's `V` selects lines, and `v` is
     * the tree's own.
     */
    choose: {
      label: 'Select layers',
      description: 'Shows several layers as one diff.',
      group: 'View',
      keys: ['v'],
      targets: ['layer'],
      when: tree,
      menu: { on: 'layer', order: 10 },
    },
    /**
     * Shows the layers from the bottom of the stack to this one as one diff: "Show layers 1–3" on
     * a layer.
     */
    upTo: {
      label: 'Show layers to here',
      description: 'From the bottom of the stack to this layer, as one diff.',
      group: 'View',
      keys: [],
      targets: ['layer'],
      menu: { on: 'layer', order: 20 },
    },
    /**
     * Stops selecting layers, the layer the keyboard is on staying where it is. With none selected,
     * the key is `Esc` as anywhere, back to the middle view, and its menu row says so.
     */
    cancel: {
      label: 'Stop selecting layers',
      group: 'View',
      keys: ['esc'],
      when: tree,
      control: 'Stop in the hint row while layers are selected',
    },
    /**
     * With layers shown as one diff, once the diff has nothing of its own open that `Esc` closes,
     * goes back to the layer they were selected from. Elsewhere it's `Esc` as anywhere.
     */
    back: {
      label: 'Show single layer',
      group: 'View',
      keys: ['esc'],
      when: { scope: 'diff', mode: 'normal' },
      control: 'Show single layer on the bar over layers shown as one diff',
    },
    openOnGithub: {
      label: 'Open on GitHub',
      group: 'Tabs',
      keys: ['g x'],
      targets: ['layer'],
      when: tree,
      menu: { on: 'layer', order: 30 },
    },
    /**
     * Plans converting the chain the pull request on screen is in to a GitHub stack, or in the
     * stack's tree the chain through the layer the keyboard is on, which shows first, and asks
     * before anything changes, or says every reason it can't. `g` already prefixes places and
     * toggles, and the capital keeps it a key apart from them.
     */
    convert: {
      label: 'Convert to GitHub stack…',
      group: 'Review',
      keys: ['g S'],
      targets: ['layer', 'none'],
      when: anywhere,
      menu: { on: 'layer', order: 40 },
    },
  },
  { scopes: ['stack'] },
);
