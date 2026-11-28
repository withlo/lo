// The overview feature's keys: copying a prompt for a coding agent, anywhere in a pull request's
// tab; installing the overview skill, which has none; and, in Settings, copying the command that
// installs it from a terminal. In the overview's own view, the `overview` scope: moving between its
// blocks and within one, following a block to its code, scrolling, going to its glossary, which
// has none, and folding its sections; on a block's menu, showing the latest overview or reading it
// again, which have none; and on a section heading's menu, the switches that collapse a section in
// this repo or every repo, which have none.

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
    /**
     * Brings the overview's Glossary section to the top, and lands on the first term the pull
     * request adds or changes: from the line under the byline that counts them.
     */
    goGlossary: {
      label: 'Go to glossary',
      group: 'Review',
      keys: [],
      when: overview,
      control: 'Go to glossary on the line under the overview’s byline',
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
     * Collapses the section the keyboard is in to its heading, or expands it again: on a heading's
     * menu, that heading's; otherwise the focused block's, or the one the outline marks as current.
     * Collapsing it from inside brings its heading back to the top. The tl;dr never collapses. The
     * handler names it by what it would do: "Expand section" on one collapsed.
     */
    foldSection: {
      label: 'Collapse section',
      group: 'View',
      keys: ['z a'],
      targets: ['block', 'none'],
      when: overview,
      menu: { on: 'block', order: 60 },
      control: 'the chevron beside a section’s heading in the overview',
    },
    /**
     * Whether the section's heading is in this repo's list of sections that start collapsed
     * (`overview.collapsed`): turned on, the section collapses now, and off, it expands.
     */
    foldHere: {
      label: 'Collapse in this repo',
      group: 'View',
      keys: [],
      targets: ['block', 'none'],
      when: overview,
      toggle: 'switch',
      menu: { on: 'block', order: 61 },
    },
    /** As `foldHere`, for every repo's list and each repo's own. */
    foldEverywhere: {
      label: 'Collapse in every repo',
      group: 'View',
      keys: [],
      targets: ['block', 'none'],
      when: overview,
      toggle: 'switch',
      menu: { on: 'block', order: 62 },
    },
    /** Expands every section of the overview. */
    unfoldAll: {
      label: 'Expand all sections',
      group: 'View',
      keys: ['z R'],
      targets: ['block', 'none'],
      when: overview,
      menu: { on: 'block', order: 63, apart: true },
    },
    /** Collapses every section of the overview but the tl;dr. */
    foldAll: {
      label: 'Collapse all sections',
      group: 'View',
      keys: ['z M'],
      targets: ['block', 'none'],
      when: overview,
      menu: { on: 'block', order: 64 },
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
      // A block's, so its menu knows a heading's, which doesn't list it.
      targets: ['block', 'none'],
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
