// The diff view's keys, and the whole-file view's. Lo's jumps run in Vim, under the keys the
// registry gives it, so counts and visual mode work; the rest act on the cursor's line, or the
// lines `v` selected, or the header the cursor is on, or the thread under the line, and `e` on the
// file, or in the whole-file view on the file while it shows a note. Vim's own moves and search
// are listed too, for key help: they're never taken.

import { defineCommands, type When } from '@lo/ui/commands';

const diff: When = { scope: 'diff' };
const normal: When = { scope: 'diff', mode: 'normal' };
/** In either code view: the diff, or a file whole. */
const code: When = { scope: ['diff', 'file'] };
const codeNormal: When = { scope: ['diff', 'file'], mode: 'normal' };

export default defineCommands('diff', {
  nextChange: {
    label: 'Next change',
    group: 'Jump',
    control: 'Previous change and Next change in the diff bar',
    bar: { menu: 'Go', order: 30 },
    keys: ['] c'],
    // From the line, as a key; from anywhere, as its button.
    targets: ['line', 'none'],
    vim: 'motion',
    when: diff,
  },
  previousChange: {
    label: 'Previous change',
    group: 'Jump',
    control: 'Previous change and Next change in the diff bar',
    bar: { menu: 'Go', order: 40 },
    keys: ['[ c'],
    // From the line, as a key; from anywhere, as its button.
    targets: ['line', 'none'],
    vim: 'motion',
    when: diff,
  },
  nextFile: {
    label: 'Next file',
    group: 'Jump',
    bar: { menu: 'Go', order: 50 },
    keys: ['] f'],
    targets: ['line'],
    vim: 'motion',
    when: diff,
  },
  previousFile: {
    label: 'Previous file',
    group: 'Jump',
    bar: { menu: 'Go', order: 60 },
    keys: ['[ f'],
    targets: ['line'],
    vim: 'motion',
    when: diff,
  },
  /** The next review thread under a line, in the files' order. */
  nextThread: {
    label: 'Next thread',
    group: 'Jump',
    bar: { menu: 'Go', order: 70 },
    keys: ['] t'],
    targets: ['line'],
    vim: 'motion',
    when: diff,
  },
  previousThread: {
    label: 'Previous thread',
    group: 'Jump',
    bar: { menu: 'Go', order: 80 },
    keys: ['[ t'],
    targets: ['line'],
    vim: 'motion',
    when: diff,
  },
  /**
   * From moved code on the cursor's line to the same line at the other end, where the code went or
   * came from, its file opened if it's closed; a moved label's click goes to the other end's first
   * line. `⌃o` comes back. The code views' Vim has no `gm` (Vim's middle of the screen line) for it
   * to be over.
   */
  otherEnd: {
    label: 'The other end of moved code',
    group: 'Jump',
    control: 'the place on a moved-code label',
    keys: ['g m'],
    targets: ['line'],
    jump: true,
    when: normal,
  },
  /**
   * Marks the file viewed, or clears its mark. Marking closes it and goes to the next file that
   * isn't viewed, round the end. A count marks that many, and clears none: `3e`. `e` is Vim's "end
   * of word", which `w` and `b` stand in for.
   */
  markViewed: {
    label: 'Mark viewed',
    group: 'Act',
    control: "the viewed ball in a file's header",
    keys: ['e'],
    targets: ['line', 'header'],
    overVim: true,
    count: 'files',
    when: normal,
    menu: { on: 'header', order: 5 },
  },
  /** The cursor's row on the other side. */
  otherSide: {
    label: 'The other side',
    control: 'a line on the other side',
    group: 'Diff view',
    keys: ['tab'],
    when: normal,
  },
  /** Sets the diff side by side, as the setting: with `diff.inline`, a choice of two. */
  sideBySide: {
    label: 'Side by side',
    group: 'Diff view',
    // `g i` is the switch's, which comes back side by side.
    keys: [],
    when: diff,
    bar: { menu: 'View', order: 30 },
  },
  /** A switch, as the setting: draws the diff in one column, or side by side again. */
  inline: {
    label: 'Inline',
    group: 'Diff view',
    keys: ['g i'],
    overVim: true,
    when: normal,
    bar: { menu: 'View', order: 35 },
  },
  whitespace: {
    label: 'Hide or show whitespace changes',
    group: 'Diff view',
    keys: ['g w'],
    overVim: true,
    when: normal,
    bar: { menu: 'View', order: 40 },
  },
  openRun: {
    label: 'Open unchanged lines',
    group: 'Diff view',
    control: 'a fold of unchanged lines',
    keys: ['z o'],
    targets: ['line'],
    when: normal,
  },
  closeRun: {
    label: 'Close unchanged lines',
    group: 'Diff view',
    keys: ['z c'],
    targets: ['line'],
    when: normal,
  },
  openFile: {
    label: 'Open every unchanged line in the file',
    group: 'Diff view',
    keys: ['z R'],
    targets: ['line', 'header'],
    when: normal,
    menu: { on: 'header', order: 12 },
  },
  /**
   * Collapses the file into its header, or expands it again; on a file too large to draw unasked,
   * or whose lines couldn't be read, shows its lines. The header's menu names what it does there.
   * On a thread, `z a` is the thread's (`diff.toggleThread`).
   */
  toggleFile: {
    label: 'Collapse file',
    group: 'Diff view',
    control: "the row under a file's header",
    keys: ['z a'],
    targets: ['line', 'header'],
    when: normal,
    // Named by what it would do: the handler says "Expand" on a file collapsed.
    menu: { on: 'header', order: 10, label: 'Collapse' },
  },
  /**
   * Collapses the review thread the key is on, the one `]t` landed on or the only one on the
   * cursor's line, or expands it again.
   */
  toggleThread: {
    label: 'Collapse thread',
    group: 'Threads',
    keys: ['z a'],
    targets: ['thread'],
    when: { scope: 'diff', mode: 'normal', on: 'thread' },
    // Named by what it would do: the handler says "Expand" on a thread collapsed.
    menu: { on: 'thread', order: 30, label: 'Collapse' },
  },
  /**
   * The file the cursor is in, whole and read-only, at the cursor's line, in the version on the
   * cursor's side. `⌃o` comes back.
   */
  wholeFile: {
    label: 'Whole file at the cursor',
    group: 'Copy and open',
    keys: ['g f'],
    targets: ['line', 'header'],
    jump: true,
    when: normal,
    menu: { on: 'line', order: 30 },
  },
  /** In the whole-file view, a file larger than Lo loads at once, loaded anyway. */
  loadWhole: {
    label: 'Load a large file anyway',
    group: 'Diff view',
    control: "the button in the whole file's note on a large file",
    keys: ['z a'],
    targets: ['header', 'line'],
    when: { scope: 'file', mode: 'normal' },
  },
  /**
   * The cursor's line, or the lines `v` selected, across files and sides too, onto the clipboard.
   * A count copies that many from the cursor's, as Vim's `2yy` yanks two.
   */
  copyLines: {
    label: 'Copy the lines',
    group: 'Copy and open',
    keys: ['y y'],
    targets: ['line'],
    overVim: true,
    count: 'lines',
    when: { scope: ['diff', 'file'], mode: ['normal', 'visual'] },
    menu: { on: 'line', order: 10 },
  },
  /**
   * GitHub's link to the cursor's line: in the pull request's changes, or for a file it leaves
   * alone, in the file at the head.
   */
  copyLink: {
    label: "Copy the line's link",
    group: 'Copy and open',
    keys: ['y l'],
    targets: ['line'],
    overVim: true,
    when: codeNormal,
    menu: { on: 'line', order: 20 },
  },
  copyPath: {
    label: 'Copy path',
    group: 'Copy and open',
    keys: ['y p'],
    targets: ['line', 'header'],
    overVim: true,
    when: codeNormal,
    menu: { on: 'header', order: 20 },
  },
  /**
   * The cursor's line, or the file, on GitHub: in the pull request's changes, or for a file it
   * leaves alone, at the head.
   */
  openOnGithub: {
    label: 'Open on GitHub',
    group: 'Copy and open',
    keys: ['g x'],
    targets: ['line', 'header'],
    when: codeNormal,
    menu: { on: 'header', order: 30 },
  },
  /**
   * The note of an overview's marker on the line: what the overview says about it, under its
   * lines. In the diff alone, which draws the markers, and on the menu of a line with a marker
   * only; a click on the marker's ball opens it too.
   */
  overviewNote: {
    label: 'Overview note',
    group: 'Copy and open',
    keys: [],
    targets: ['line'],
    when: normal,
    menu: { on: 'line', order: 40 },
  },
  down: { label: 'Line down', group: 'Move', keys: ['j'], vim: 'own', when: code },
  up: { label: 'Line up', group: 'Move', keys: ['k'], vim: 'own', when: code },
  select: { label: 'Select lines', group: 'Move', keys: ['v'], vim: 'own', when: code },
  search: { label: 'Search', group: 'Find', keys: ['/'], vim: 'own', when: code },
  nextMatch: { label: 'Next match', group: 'Find', keys: ['n'], vim: 'own', when: code },
  previousMatch: { label: 'Previous match', group: 'Find', keys: ['N'], vim: 'own', when: code },
});
