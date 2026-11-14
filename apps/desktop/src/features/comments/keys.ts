// The comments' keys: writing a comment in the diff. `c` opens a comment box under the cursor's
// line, or the lines `v` selected, on either side, or on the file with the cursor on its header;
// `C` opens the same box to post right away; `s` opens it with the lines in a `suggestion` block.
// In the file tree `c` comments on the file. On an overview's code block, `c` comments on its
// lines, and in its code on the cursor's line or the lines `v` selected: on those lines at the head
// on screen where GitHub takes a comment on them, else on their file, else on the pull request
// itself. Each replaces Vim's key, since the code is read-only. A line GitHub takes no comment on
// says so, and then `⏎` comments on its file instead; anywhere else `⏎` is Vim's. The box's own
// keys are the code view's (`⌘⏎`, `⌥⏎`, `⌘⇧V`, `Esc Esc`). What the buttons in a box's notes do is
// also on its frame's right-click menu, and in the palette while focus is in the box, each only
// where the box offers it, without a key of its own.
//
// In the threads panel, the `threads` scope: `j` and `k` move between its threads, `⏎` shows the
// one the keyboard is on in the diff, and `f` steps through what it lists: the unresolved threads,
// every thread, or yours. `Esc` goes back to the middle view, as it does anywhere.

import { defineCommands, type When } from '@lo/ui/commands';

/** In the diff, on the cursor's line or header, or the lines `v` selected. */
const diff: When = { scope: 'diff', mode: ['normal', 'visual'] };

/** In a comment box. */
const box: When = { scope: 'box' };

/** In the threads panel. */
const panel: When = { scope: 'threads' };

export default defineCommands(
  'comments',
  {
    /** A comment box on the cursor's line, the lines `v` selected, or, on a header, on the file. */
    comment: {
      label: 'Comment',
      group: 'Act',
      keys: ['c'],
      targets: ['line', 'header'],
      overVim: true,
      when: diff,
      menu: { on: 'line', order: 1 },
    },
    /** The same box, whose main button posts the comment right away, outside your pending review. */
    commentNow: {
      label: 'Comment right away',
      group: 'Act',
      keys: ['C'],
      targets: ['line', 'header'],
      overVim: true,
      when: diff,
      menu: { on: 'line', order: 2 },
    },
    /**
     * The box with the lines in a `suggestion` block, the cursor inside, in insert mode: on the newer
     * side only, since GitHub applies suggestions there.
     */
    suggest: {
      label: 'Suggest a change',
      group: 'Act',
      keys: ['s'],
      targets: ['line'],
      overVim: true,
      when: diff,
      menu: { on: 'line', order: 3 },
    },
    /**
     * A comment box on the file, under its header in the diff: from its header, or its row in the
     * tree.
     */
    commentOnFile: {
      label: 'Comment on the file',
      group: 'Act',
      keys: ['c'],
      targets: ['header', 'file'],
      when: { scope: 'tree' },
      menu: { on: 'header', order: 6 },
    },
    /**
     * A comment box under a code block's lines in the overview, from the block, its menu, or its
     * code, where it's on the cursor's line or the lines `v` selected: on those lines at the head
     * on screen, where GitHub takes a comment on them; otherwise on their file, where the pull
     * request changes it; otherwise on the pull request itself.
     */
    commentOnBlock: {
      label: 'Comment on these lines',
      group: 'Act',
      keys: ['c'],
      targets: ['block', 'line'],
      overVim: true,
      when: { scope: ['overview', 'file'], mode: ['normal', 'visual'] },
      menu: { on: 'block', order: 25 },
    },
    /**
     * Just after a line refused a comment, as GitHub takes none there, a comment on its file instead.
     * Otherwise it's Vim's `⏎`.
     */
    onFileInstead: {
      label: 'Comment on the file instead',
      group: 'Act',
      keys: ['enter'],
      targets: ['line'],
      overVim: true,
      when: { scope: 'diff', mode: 'normal' },
    },
    /** On a draft restored as Lo started: drops it, and its box, as the note's "Discard" does. */
    discard: {
      label: 'Discard the draft',
      group: 'Act',
      keys: [],
      targets: ['box'],
      when: box,
      menu: { on: 'box', order: 0 },
    },
    /** After Lo couldn't tell whether a comment posted: sends it again, as "Send it anyway" does. */
    sendAnyway: {
      label: 'Send it anyway',
      group: 'Act',
      keys: [],
      targets: ['box'],
      when: box,
      menu: { on: 'box', order: 10 },
    },
    /**
     * After GitHub took no comment on the box's lines: moves its text to a box on the file, as
     * "Comment on the file" does.
     */
    moveToFile: {
      label: 'Move the comment to the file',
      group: 'Act',
      keys: [],
      targets: ['box'],
      when: box,
      menu: { on: 'box', order: 20 },
    },
    /** After someone pushed since: shows the newer push, as "Load the newer push" does. */
    loadNewer: {
      label: 'Load the newer push',
      group: 'View',
      keys: [],
      targets: ['box'],
      when: box,
      menu: { on: 'box', order: 30 },
    },
    /**
     * After a comment that would join your pending review, which is on the latest push: shows that
     * push, as "Show the latest" does.
     */
    showLatest: {
      label: 'Show the latest push',
      group: 'View',
      keys: [],
      targets: ['box'],
      when: box,
      menu: { on: 'box', order: 40 },
    },
    nextThread: {
      label: 'Next thread in the panel',
      group: 'Panels',
      keys: ['j', 'down'],
      when: panel,
      repeat: true,
    },
    previousThread: {
      label: 'Previous thread in the panel',
      group: 'Panels',
      keys: ['k', 'up'],
      when: panel,
      repeat: true,
    },
    /**
     * Shows the thread the keyboard is on in the diff, opened, at the top of the screen, with focus
     * staying in the panel. One the diff on screen doesn't show, such as an outdated thread, shows
     * in the diff of the revision it's on. A jump, which `⌃o` comes back from.
     */
    showThread: {
      label: 'Show the thread in the diff',
      group: 'Panels',
      keys: ['enter'],
      targets: ['thread'],
      when: panel,
    },
    /** Lists the unresolved threads, every thread, or yours, round the end. */
    filterThreads: {
      label: 'Unresolved, all or your threads',
      group: 'Panels',
      keys: ['f'],
      when: panel,
    },
  },
  { scopes: ['threads'] },
);
