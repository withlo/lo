// Code features' keys, and trust's commands. In the diff and a file whole, in normal mode, on the
// word at the cursor: `gd` opens a peek of its definitions under the line, `gr` lists its
// references in the right panel, `K` shows its type in a card over it, and `gh` turns inline type
// hints on or off for the window; `gO` opens the outline of the cursor's file. None of these is
// one of Vim's keys in a code view. In the peek, `j` and `k` (and the arrows) pick an answer in
// place of Vim's moves, `⏎` goes to it, `gr` lists the references of the same name, and `Esc`
// closes it, putting the cursor back. In the references panel, the `references` scope, `j` and `k`
// move, `⏎` goes, and `Esc` goes back to the threads, if they were showing, or closes the panel.
//
// Trust's and language servers' commands, each with no key: trusting is done once a repository,
// and through main's own dialog, and a server's status item offers the rest. In the palette and
// the app's Review menu; a pull request's banner offers the first two.

import { defineCommands, type When } from '@lo/ui/commands';

/** In either code view, in normal mode, on the word at the cursor. */
const code: When = { scope: ['diff', 'file'], mode: 'normal' };

/** In a peek, whose keys are Lo's alone. */
const peek: When = { scope: 'peek', mode: 'normal' };

/** In the references panel. */
const panel: When = { scope: 'references' };

export default defineCommands(
  'code',
  {
    /**
     * The definitions of the word at the cursor, in a peek under its line, on either side, best
     * first, each saying where it came from. With none, the status bar says so and nothing opens.
     */
    definition: {
      label: 'Definition',
      group: 'Code',
      keys: ['g d'],
      targets: ['line'],
      when: code,
      menu: { on: 'line', order: 5 },
    },
    /**
     * Where the word at the cursor, or the peek's, is used, in the right panel, which opens if it's
     * closed and takes focus.
     */
    references: {
      label: 'References',
      group: 'Code',
      keys: ['g r'],
      targets: ['line'],
      when: { scope: ['diff', 'file', 'peek'], mode: 'normal' },
      menu: { on: 'line', order: 6 },
    },
    /** What the word at the cursor is, in a card over it that takes no focus. */
    type: {
      label: 'Type',
      group: 'Code',
      keys: ['K'],
      targets: ['line'],
      when: code,
      menu: { on: 'line', order: 7 },
    },
    /**
     * Inline type hints in the code views, on or off for the window, and kept as `code.hints`. They
     * come on only when the code on screen gets some: otherwise the status bar says why, and they
     * stay off.
     */
    hints: {
      label: 'Type hints',
      group: 'Code',
      keys: ['g h'],
      when: code,
      bar: { menu: 'View', order: 50 },
    },
    /** The cursor's file's definitions, nested, in a palette that finds them as you type. */
    outline: {
      label: 'Outline',
      group: 'Code',
      keys: ['g O'],
      targets: ['line', 'header'],
      when: code,
      menu: { on: 'header', order: 15 },
    },
    nextAnswer: {
      label: 'Next answer in the peek',
      group: 'Code',
      control: "an answer in a peek's list",
      keys: ['j', 'down'],
      overVim: true,
      when: peek,
      repeat: true,
    },
    previousAnswer: {
      label: 'Previous answer in the peek',
      group: 'Code',
      control: "an answer in a peek's list",
      keys: ['k', 'up'],
      overVim: true,
      when: peek,
      repeat: true,
    },
    /**
     * The peek's answer shown: into the diff when the comparison shows its file on its side,
     * otherwise the file whole. A jump, which `⌃o` comes back from.
     */
    goAnswer: {
      label: 'Go to the answer',
      group: 'Code',
      control: "the button in a peek's head that goes to the answer",
      keys: ['enter'],
      overVim: true,
      targets: ['line'],
      when: peek,
    },
    /** Closes the peek, and the cursor goes back to its line. */
    closePeek: {
      label: 'Close the peek',
      group: 'Code',
      control: "Close in a peek's head",
      keys: ['esc'],
      targets: ['line'],
      when: peek,
    },
    nextReference: {
      label: 'Next reference in the panel',
      group: 'Panels',
      control: "Next in the references panel's foot",
      keys: ['j', 'down'],
      when: panel,
      repeat: true,
    },
    previousReference: {
      label: 'Previous reference in the panel',
      group: 'Panels',
      control: "Previous in the references panel's foot",
      keys: ['k', 'up'],
      when: panel,
      repeat: true,
    },
    /** The reference the keyboard is on, as the peek's `⏎` goes. A jump, which `⌃o` comes back from. */
    goReference: {
      label: 'Go to the reference',
      group: 'Panels',
      control: "Go to reference in the references panel's foot, or a reference's row",
      keys: ['enter'],
      when: panel,
    },
    /**
     * Back to the threads, if they were showing as the references came; otherwise the panel
     * closes. Focus goes back to the middle view.
     */
    closeReferences: {
      label: 'Close the references',
      group: 'Panels',
      control: "Close in the references panel's foot",
      keys: ['esc'],
      when: panel,
    },
    /** Asks main to ask whether to trust the repository of the pull request on screen. */
    trust: {
      label: 'Trust this repo…',
      group: 'Code',
      keys: [],
      bar: { menu: 'Review', order: 40 },
    },
    /** Asks main to ask whether to trust the pull request on screen, from its fork, alone. */
    trustPull: {
      label: 'Trust this PR…',
      group: 'Code',
      keys: [],
      bar: { menu: 'Review', order: 41 },
    },
    /** Stops trusting what trusts the pull request on screen: language servers stop on it. */
    untrust: {
      label: 'Stop trusting this repo',
      group: 'Code',
      keys: [],
      bar: { menu: 'Review', order: 42 },
    },
    /**
     * Starts the language servers of the pull request on screen again, or of the tab Settings'
     * list of language servers names.
     */
    restart: {
      label: 'Restart language servers',
      control: 'Restart on a pull request in Settings › Code intelligence › Language servers',
      group: 'Code',
      keys: [],
      targets: ['none', 'tab'],
      bar: { menu: 'Review', order: 44 },
    },
    /**
     * Shows the log of the pull request on screen's language server, or of the tab Settings' list
     * of language servers names.
     */
    log: {
      label: 'Show the language server’s log',
      control: 'Show log on a pull request in Settings › Code intelligence › Language servers',
      group: 'Code',
      keys: [],
      targets: ['none', 'tab'],
      bar: { menu: 'Review', order: 45 },
    },
  },
  { scopes: ['references'] },
);
