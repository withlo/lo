// The diff view's keys. Lo's jumps run in Vim, under the keys the registry gives it, so counts and
// visual mode work; the rest act on the cursor's line, or the lines `v` selected, or the header the
// cursor is on. Vim's own moves and search are listed too, for key help: they're never taken.

import { defineCommands, type When } from '@lo/ui/commands';

const diff: When = { scope: 'diff' };
const normal: When = { scope: 'diff', mode: 'normal' };

export default defineCommands('diff', {
  nextChange: {
    label: 'Next change',
    group: 'Jump',
    keys: ['] c'],
    targets: ['line'],
    vim: 'motion',
    when: diff,
  },
  previousChange: {
    label: 'Previous change',
    group: 'Jump',
    keys: ['[ c'],
    targets: ['line'],
    vim: 'motion',
    when: diff,
  },
  nextFile: {
    label: 'Next file',
    group: 'Jump',
    keys: ['] f'],
    targets: ['line'],
    vim: 'motion',
    when: diff,
  },
  previousFile: {
    label: 'Previous file',
    group: 'Jump',
    keys: ['[ f'],
    targets: ['line'],
    vim: 'motion',
    when: diff,
  },
  /** The cursor's row on the other side. */
  otherSide: { label: 'The other side', group: 'Diff view', keys: ['tab'], when: normal },
  inline: {
    label: 'Inline or side by side',
    group: 'Diff view',
    keys: ['g i'],
    overVim: true,
    when: normal,
    bar: { menu: 'View', order: 30 },
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
  },
  /** Loads a large file, or closes the file into one block, or opens it again. */
  toggleFile: {
    label: 'Load, close or open the file',
    group: 'Diff view',
    keys: ['z a'],
    targets: ['line', 'header'],
    when: normal,
    menu: { on: 'header', order: 10 },
  },
  /** The cursor's line, or the lines `v` selected, onto the clipboard. */
  copyLines: {
    label: 'Copy the lines',
    group: 'Copy and open',
    keys: ['y y'],
    targets: ['line'],
    overVim: true,
    when: { scope: 'diff', mode: ['normal', 'visual'] },
    menu: { on: 'line', order: 10 },
  },
  /** GitHub's link to the cursor's line in the pull request's changes. */
  copyLink: {
    label: "Copy the line's link",
    group: 'Copy and open',
    keys: ['y l'],
    targets: ['line'],
    overVim: true,
    when: normal,
    menu: { on: 'line', order: 20 },
  },
  copyPath: {
    label: 'Copy path',
    group: 'Copy and open',
    keys: ['y p'],
    targets: ['line', 'header'],
    overVim: true,
    when: normal,
    menu: { on: 'header', order: 20 },
  },
  /** The cursor's line, or the file, in the pull request's changes on GitHub. */
  openOnGithub: {
    label: 'Open on GitHub',
    group: 'Copy and open',
    keys: ['g x'],
    targets: ['line', 'header'],
    when: normal,
    menu: { on: 'header', order: 30 },
  },
  down: { label: 'Line down', group: 'Move', keys: ['j'], vim: 'own', when: diff },
  up: { label: 'Line up', group: 'Move', keys: ['k'], vim: 'own', when: diff },
  select: { label: 'Select lines', group: 'Move', keys: ['v'], vim: 'own', when: diff },
  search: { label: 'Search', group: 'Find', keys: ['/'], vim: 'own', when: diff },
  nextMatch: { label: 'Next match', group: 'Find', keys: ['n'], vim: 'own', when: diff },
  previousMatch: { label: 'Previous match', group: 'Find', keys: ['N'], vim: 'own', when: diff },
});
