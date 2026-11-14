// The comments' keys: writing a comment in the diff, and acting on its review threads. `c` opens a
// comment box under the cursor's line, or the lines `v` selected, on either side, or on the file
// with the cursor on its header; `C` opens the same box to post right away; `s` opens it with the
// lines in a `suggestion` block. In the file tree `c` comments on the file. On a thread, the one
// `]t` landed on or the only one on the cursor's line or the header's file, `r` replies, `x`
// resolves or unresolves it, `i` edits your newest comment in it and `dd` deletes that comment,
// after asking. Each replaces Vim's key, since the diff is read-only.
// A line GitHub takes no comment on says so, and then `⏎` comments on its file instead; anywhere
// else `⏎` is Vim's. The box's own keys are the code view's (`⌘⏎`, `⌥⏎`, `⌘⇧V`, `Esc Esc`). What
// the buttons in a box's notes do is also on its frame's right-click menu, and in the palette while
// focus is in the box, each only where the box offers it, without a key of its own.

import { defineCommands, type When } from '@lo/ui/commands';

/** In the diff, on the cursor's line or header, or the lines `v` selected. */
const diff: When = { scope: 'diff', mode: ['normal', 'visual'] };

/** In a comment box. */
const box: When = { scope: 'box' };

/** In the diff, on the thread the cursor's on. */
const onThread: When = { scope: 'diff', mode: 'normal' };

export default defineCommands('comments', {
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
  /** A reply box in the thread, right after its card. */
  reply: {
    label: 'Reply to the thread',
    group: 'Act',
    keys: ['r'],
    targets: ['line', 'header', 'thread'],
    overVim: true,
    when: onThread,
    menu: { on: 'thread', order: 10, label: 'Reply' },
  },
  /** Resolves the thread, or unresolves it once it's resolved, where GitHub lets you. */
  resolve: {
    label: 'Resolve or unresolve the thread',
    group: 'Act',
    keys: ['x'],
    targets: ['line', 'header', 'thread'],
    overVim: true,
    when: onThread,
    menu: { on: 'thread', order: 20, label: 'Resolve or unresolve' },
  },
  /** A box with your newest comment in the thread, to edit it and save it over GitHub's text. */
  edit: {
    label: 'Edit your comment',
    group: 'Act',
    keys: ['i'],
    targets: ['line', 'header', 'thread'],
    overVim: true,
    when: onThread,
    menu: { on: 'thread', order: 40 },
  },
  /** Deletes your newest comment in the thread, once you say so. */
  remove: {
    label: 'Delete your comment…',
    group: 'Act',
    keys: ['d d'],
    targets: ['line', 'header', 'thread'],
    overVim: true,
    when: onThread,
    menu: { on: 'thread', order: 50 },
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
});
