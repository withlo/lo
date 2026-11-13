// The stacks' keys. `]s` and `[s` show the next and previous layer of the stack on screen, in the
// order its tree lists them, and `gS` makes the chain the pull request on screen is in a GitHub
// stack, once you confirm what will change: they work anywhere in a pull request's tab, and over Vim
// in code views in normal mode, as `gv` does. `-` in the file tree goes up to the stack's tree, where
// single keys act on the layer the keyboard is on: moving, showing it, and opening it on GitHub. A
// layer's right-click menu shows it, opens it on GitHub or makes its chain a GitHub stack.

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
     */
    nextLayer: { label: 'Next layer', group: 'Jump', keys: ['] s'], when: anywhere },
    previousLayer: { label: 'Previous layer', group: 'Jump', keys: ['[ s'], when: anywhere },
    /** Goes up from the file tree to the stack's tree, at the layer on screen. */
    focus: { label: 'Go to the stack', group: 'Files', keys: ['-'], when: { scope: 'tree' } },
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
    /** Shows the layer the keyboard is on, or the one right-clicked. */
    show: {
      label: 'Show this layer',
      group: 'Panels',
      keys: ['enter'],
      targets: ['layer'],
      when: tree,
      menu: { on: 'layer', order: 0 },
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
