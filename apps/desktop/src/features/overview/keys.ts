// The overview feature's keys: copying a prompt for a coding agent, anywhere in a pull request's
// tab, and installing the overview skill, which has none. In the overview's own view, the
// `overview` scope: moving between its blocks and within one, following a block to its code, the
// code beside it, and scrolling; and, on a block's menu, loading a newer overview or reading it
// again, which have none.

import { defineCommands, type When } from '@lo/ui/commands';

/** In the overview, not in the code beside it, which is a code view of its own. */
const overview: When = { scope: 'overview' };

export default defineCommands(
  'overview',
  {
    /** The next block that holds something to act on: code, a figure, a link to code or a term. */
    nextBlock: { label: 'Next block', group: 'Overview', keys: ['] b'], when: overview },
    previousBlock: { label: 'Previous block', group: 'Overview', keys: ['[ b'], when: overview },
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
    },
    /** Splits the middle: the overview, and the block's file in the diff beside it, inline. */
    beside: {
      label: 'Open or close code beside',
      group: 'Overview',
      keys: ['o'],
      targets: ['block', 'none'],
      when: overview,
      menu: { on: 'block', order: 20 },
    },
    /**
     * Closes the code beside the overview, as the button over it does, after a term's card that's
     * open. With neither open, focus goes back to the overview, as `Esc` does in any middle view.
     */
    closeBeside: { label: 'Close code beside', group: 'Overview', keys: ['esc'], when: overview },
    /**
     * In the block that has focus, its next link, figure part or control, round through the block
     * itself. From the overview itself, as `Esc` leaves it, the outline's sections, the byline's
     * offer, then the block `]b` goes to.
     */
    nextLink: {
      label: 'Next link, part or section',
      group: 'Overview',
      keys: ['tab'],
      when: overview,
    },
    previousLink: {
      label: 'Previous link, part or section',
      group: 'Overview',
      keys: ['shift+tab'],
      when: overview,
    },
    /** A walkthrough's next step, or the next of a set of tabs. */
    nextStep: {
      label: 'Next step or tab',
      group: 'Overview',
      keys: ['right'],
      targets: ['block', 'none'],
      when: overview,
    },
    previousStep: {
      label: 'Previous step or tab',
      group: 'Overview',
      keys: ['left'],
      targets: ['block', 'none'],
      when: overview,
    },
    scrollDown: {
      label: 'Scroll down',
      group: 'Move',
      keys: ['j', 'down'],
      repeat: true,
      when: overview,
    },
    scrollUp: {
      label: 'Scroll up',
      group: 'Move',
      keys: ['k', 'up'],
      repeat: true,
      when: overview,
    },
    top: { label: 'Top of the overview', group: 'Move', keys: ['g g', 'home'], when: overview },
    bottom: { label: 'End of the overview', group: 'Move', keys: ['G', 'end'], when: overview },
    pageDown: {
      label: 'Page down',
      group: 'Move',
      keys: ['pagedown'],
      repeat: true,
      when: overview,
    },
    pageUp: {
      label: 'Page up',
      group: 'Move',
      keys: ['pageup'],
      repeat: true,
      when: overview,
    },
    /** Puts the newer overview, pushed while this one was read, on screen. */
    loadNewer: {
      label: 'Load the newer overview',
      group: 'Overview',
      keys: [],
      targets: ['block', 'none'],
      menu: { on: 'block', order: 40 },
    },
    /** Reads the overview's ref again now, after a read that failed. */
    retry: {
      label: 'Retry',
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
      label: 'Copy prompt for an agent',
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
      group: 'Tabs and window',
      keys: [],
      bar: { menu: 'App', order: 20 },
    },
  },
  { scopes: ['overview'] },
);
