// The overview feature's keys: copying a prompt for a coding agent, anywhere in a pull request's
// tab; installing the overview skill, which has none; and, in Settings, copying the command that
// installs it from a terminal. In the overview's own view, the `overview` scope: moving between its
// blocks and within one, following a block to its code, the code beside it, and scrolling; and, on
// a block's menu, showing the latest overview or reading it again, which have none.

import { defineCommands, type When } from '@lo/ui/commands';

/** In the overview, not in the code beside it, which is a code view of its own. */
const overview: When = { scope: 'overview' };

export default defineCommands(
  'overview',
  {
    /** The next block that holds something to act on: code, a figure, a link to code or a term. */
    nextBlock: {
      label: 'Next block',
      group: 'Overview',
      keys: ['] b'],
      when: overview,
      control: 'Next block under the outline, and over an overview beside its code',
    },
    previousBlock: {
      label: 'Previous block',
      group: 'Overview',
      keys: ['[ b'],
      when: overview,
      control: 'Previous block under the outline',
    },
    /**
     * Follows the block that has focus, or the link, part or control in it that has: code goes to
     * the diff, at the lines it points at, or to the file whole where the diff doesn't have it, and
     * `⌃o` comes back; a fold opens or closes; a link goes where it points.
     */
    follow: {
      label: 'Go to code',
      group: 'Overview',
      keys: ['enter'],
      targets: ['block', 'none'],
      when: overview,
      menu: { on: 'block', order: 10 },
      control: "Go to code on a focused block's chip",
    },
    /** Splits the middle: the overview, and the block's file in the diff beside it, inline. */
    beside: {
      label: 'Code beside',
      group: 'Overview',
      keys: ['o'],
      targets: ['block', 'none'],
      when: overview,
      menu: { on: 'block', order: 20 },
      control: 'Code beside on the chip of a focused block with code',
    },
    /**
     * Closes the code beside the overview, as the button over it does, after a term's card that's
     * open. With neither open, focus goes back to the overview, as `Esc` does in any middle view.
     */
    closeBeside: {
      label: 'Close code beside',
      group: 'Overview',
      keys: ['esc'],
      when: overview,
      control: 'Close code beside, over the code beside',
    },
    /**
     * In the block that has focus, its next link, figure part or control, round through the block
     * itself. From the overview itself, as `Esc` leaves it, the outline's sections, the byline's
     * offer, then the block `]b` goes to.
     */
    nextLink: {
      label: 'Next link',
      group: 'Overview',
      keys: ['tab'],
      when: overview,
      control: "Next link on a focused block's chip, and a click on the link itself",
    },
    previousLink: {
      label: 'Previous link',
      group: 'Overview',
      keys: ['shift+tab'],
      when: overview,
      control: 'a click on the link itself',
    },
    /** A walkthrough's next step, or the next of a set of tabs. */
    nextStep: {
      label: 'Next step',
      group: 'Overview',
      keys: ['right'],
      targets: ['block', 'none'],
      when: overview,
      control: "Next on a walkthrough, a set's tabs, and Next step on a focused block's chip",
    },
    previousStep: {
      label: 'Previous step',
      group: 'Overview',
      keys: ['left'],
      targets: ['block', 'none'],
      when: overview,
      control: "Previous on a walkthrough, and a set's tabs",
    },
    scrollDown: {
      label: 'Scroll down',
      group: 'Move',
      keys: ['j', 'down'],
      repeat: true,
      when: overview,
      control: "the overview's scroll bar",
    },
    scrollUp: {
      label: 'Scroll up',
      group: 'Move',
      keys: ['k', 'up'],
      repeat: true,
      when: overview,
      control: "the overview's scroll bar",
    },
    top: {
      label: 'Go to top',
      group: 'Move',
      keys: ['g g', 'home'],
      when: overview,
      control: "the overview's scroll bar",
    },
    bottom: {
      label: 'Go to bottom',
      group: 'Move',
      keys: ['G', 'end'],
      when: overview,
      control: "the overview's scroll bar",
    },
    pageDown: {
      label: 'Page down',
      group: 'Move',
      keys: ['pagedown'],
      repeat: true,
      when: overview,
      control: "the overview's scroll bar",
    },
    pageUp: {
      label: 'Page up',
      group: 'Move',
      keys: ['pageup'],
      repeat: true,
      when: overview,
      control: "the overview's scroll bar",
    },
    /** Puts the latest overview, pushed while this one was read, on screen. */
    loadNewer: {
      label: 'Show latest overview',
      group: 'Overview',
      keys: [],
      targets: ['block', 'none'],
      menu: { on: 'block', order: 40 },
    },
    /** Reads the overview's ref again now: after a read that failed, or one made only once. */
    retry: {
      label: 'Try again',
      group: 'Overview',
      keys: [],
      targets: ['block', 'none'],
      menu: { on: 'block', order: 50 },
    },
    /**
     * Copies the prompt the tab's overview offers: to write one, bring it up to date, fix it or make
     * it smaller. It works wherever focus is in a pull request's tab, so it takes `y` over Vim's
     * yank in the code views, as `yy` does there.
     */
    copyPrompt: {
      label: 'Copy prompt',
      group: 'Overview',
      keys: ['y a'],
      overVim: true,
      when: { except: ['menu', 'dialog', 'palette', 'box'], mode: 'normal' },
      menu: { on: 'block', order: 30 },
    },
    /**
     * Installs the overview skill for the coding agents that are set up: done once, so it has no
     * key. It's in the app's own menu on macOS beside installing the command-line tool, in
     * Settings, on the welcome screen, and in the command palette.
     */
    installSkill: {
      label: 'Install overview skill',
      control: 'Install on the Overview skill row of Settings',
      group: 'Tabs and window',
      keys: [],
      bar: { menu: 'App', order: 20 },
    },
    /**
     * Copies the command that installs the overview skill from a terminal, which Settings shows in
     * its Command line section, by the version of the checker Lo's own skill runs.
     */
    copyInstallCommand: {
      label: 'Copy the overview skill’s install command',
      control: 'Copy on the On another computer row of Settings',
      group: 'Copy and open',
      keys: ['y c'],
      when: { scope: 'settings' },
    },
  },
  { scopes: ['overview'] },
);
