// The overview feature's keys: copying a prompt for a coding agent, and showing the overview of the
// stack the pull request is a layer of, anywhere in a pull request's tab; installing the overview
// skill, which has none; and, in Settings, copying the command that
// installs it from a terminal. In the overview's own view, the `overview` scope: moving between its
// blocks and within one, following a block to its code, and scrolling; and, on a block's menu,
// showing the latest overview or reading it again, which have none.

import { defineCommands, type When } from '@lo/ui/commands';

/** In the overview, not in the code beside it, which is a view of its own. */
const overview: When = { scope: 'overview' };

export default defineCommands(
  'overview',
  {
    /**
     * Shows the overview in the middle of the pull request's tab on screen: one of the three views
     * the header's switch lists, so the app menu has it beside the other two, checked while it shows.
     */
    show: {
      label: 'Overview',
      control: 'Overview in the pull request’s header',
      group: 'View',
      keys: [],
      bar: { menu: 'View', section: 'views', order: 10 },
      toggle: 'choice',
    },
    /**
     * Shows the overview of the stack the pull request on screen is a layer of, in place of the
     * layer's own in the Overview view: a place in the tab's history, so `⌃o` comes back. Showing a
     * layer shows its own again. Refused while the stack has none.
     */
    showStack: {
      label: 'Stack overview',
      control: 'Stack overview, first in the stack’s tree, and on a layer’s overview',
      group: 'Go',
      keys: ['g s'],
      when: { except: ['menu', 'dialog', 'palette', 'box'], mode: 'normal' },
      // After Go to file.
      bar: { menu: 'Go', section: 'find', order: 20 },
    },
    /** The next block that holds something to act on: code, a figure, a link to code or a term. */
    nextBlock: {
      label: 'Next block',
      group: 'Go',
      keys: ['] b'],
      when: overview,
      control: 'Next block under the outline, or a click on the block',
    },
    previousBlock: {
      label: 'Previous block',
      group: 'Go',
      keys: ['[ b'],
      when: overview,
      control: 'Previous block under the outline, or a click on the block',
    },
    /**
     * Follows the block that has focus, or the link, part or control in it that has: code goes to
     * the diff, at the lines it points at, or to the file whole where the diff doesn't have it, and
     * `⌃o` comes back; a fold opens or closes; a link goes where it points.
     */
    follow: {
      label: 'Go to code',
      description: 'On a link, follows it. On a fold, opens it.',
      group: 'Go',
      keys: ['enter'],
      targets: ['block', 'none'],
      when: overview,
      menu: { on: 'block', order: 10 },
      control: 'Go to code on a focused block’s chip',
    },
    /**
     * In the block that has focus, its next link, figure part or control, round through the block
     * itself. From the overview itself, as `Esc` leaves it, the outline's sections, the byline's
     * offer, then the block `]b` goes to.
     */
    nextLink: {
      label: 'Next link',
      description: 'Stops at parts and sections too.',
      group: 'Go',
      keys: ['tab'],
      when: overview,
      control: 'Next link on a focused block’s chip, and a click on the link itself',
    },
    previousLink: {
      label: 'Previous link',
      description: 'Stops at parts and sections too.',
      group: 'Go',
      keys: ['shift+tab'],
      when: overview,
      control: 'a click on the link itself',
    },
    /** A walkthrough's next step, or the next of a set of tabs. */
    nextStep: {
      label: 'Next step',
      group: 'Go',
      keys: ['right'],
      targets: ['block', 'none'],
      when: overview,
      control: 'Next on a walkthrough, a set’s tabs, and Next step on a focused block’s chip',
    },
    previousStep: {
      label: 'Previous step',
      group: 'Go',
      keys: ['left'],
      targets: ['block', 'none'],
      when: overview,
      control: 'Previous on a walkthrough, and a set’s tabs',
    },
    scrollDown: {
      label: 'Scroll down',
      group: 'Go',
      keys: ['j', 'down'],
      repeat: true,
      when: overview,
      control: 'the overview’s scroll bar',
    },
    scrollUp: {
      label: 'Scroll up',
      group: 'Go',
      keys: ['k', 'up'],
      repeat: true,
      when: overview,
      control: 'the overview’s scroll bar',
    },
    top: {
      label: 'Go to top',
      group: 'Go',
      keys: ['g g', 'home'],
      when: overview,
      control: 'the overview’s scroll bar',
    },
    bottom: {
      label: 'Go to bottom',
      group: 'Go',
      keys: ['G', 'end'],
      when: overview,
      control: 'the overview’s scroll bar',
    },
    pageDown: {
      label: 'Page down',
      group: 'Go',
      keys: ['pagedown'],
      repeat: true,
      when: overview,
      control: 'the overview’s scroll bar',
    },
    pageUp: {
      label: 'Page up',
      group: 'Go',
      keys: ['pageup'],
      repeat: true,
      when: overview,
      control: 'the overview’s scroll bar',
    },
    /** Puts the latest overview, pushed while this one was read, on screen. */
    loadNewer: {
      label: 'Show latest overview',
      group: 'View',
      keys: [],
      targets: ['block', 'none'],
      menu: { on: 'block', order: 40 },
    },
    /** Reads the overview's ref again now: after a read that failed, or one made only once. */
    retry: {
      label: 'Try again',
      group: 'View',
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
      group: 'View',
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
      group: 'App',
      keys: [],
    },
    /**
     * Copies the command that installs the overview skill from a terminal, which Settings shows in
     * its Command line section, by the version of the checker Lo's own skill runs.
     */
    copyInstallCommand: {
      label: 'Copy install command',
      control: 'Copy on the On another computer row of Settings',
      group: 'App',
      keys: ['y c'],
      when: { scope: 'settings' },
    },
  },
  { scopes: ['overview'] },
);
