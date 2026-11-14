// The comments' keys: writing a comment in the diff, and acting on its review threads. `c` opens a
// comment box under the cursor's line, or the lines `v` selected, on either side, or on the file
// with the cursor on its header; `C` opens the same box to post right away; `s` opens it with the
// lines in a `suggestion` block. In the file tree `c` comments on the file. On an overview's code
// block, `c` comments on its lines, and in its code on the cursor's line or the lines `v` selected:
// on those lines at the head on screen where GitHub takes a comment on them, else on their file,
// else on the pull request itself. On a thread, the one `]t` landed on or the only one on the
// cursor's line or the header's file, `r` replies, `x` resolves or unresolves it, `i` edits your
// newest comment in it and `dd` deletes that comment, after asking. Each replaces Vim's key, since
// the code is read-only.
// A line GitHub takes no comment on says so, and then `⏎` comments on its file instead; anywhere
// else `⏎` is Vim's. The box's own keys, in the Comment box group, are the box's editor's: `⌘⏎` adds
// the comment to your review (in the pull request's own box, which joins no review, it posts it; in
// an edit's box it saves it; in the review summary's it submits the review) and `⌥⏎` posts it now,
// or replies now, `⌘⇧V` shows the preview or the editor, `⌘⇧A` asks for files to attach, and `Esc`
// leaves insert mode, then closes the box, keeping the draft. `Esc` closes it at once from the
// box's preview or its frame. The editor runs them itself, whatever box it's in, so they're
// declared as its own (`editor`): listed, checked for clashes, and never run or offered by the
// registry, nor changed by the keymap file. What the buttons in a box's notes do is also on its
// frame's right-click menu, and in the palette while focus is in the box, each only where the box
// offers it, without a key of its own.
//
// In the threads panel, the `threads` scope: `j` and `k` move between its threads, `⏎` shows the
// one the keyboard is on in the diff, and `f` steps through what it lists: the unresolved threads,
// every thread, or yours. `x` resolves or unresolves the thread the keyboard is on, as in the diff.
// `Esc` goes back to the middle view, as it does anywhere.

import { defineCommands, type When } from '@lo/ui/commands';

/** In the diff, on the cursor's line or header, or the lines `v` selected. */
const diff: When = { scope: 'diff', mode: ['normal', 'visual'] };

/** In a comment box. */
const box: When = { scope: 'box' };

/** In the diff, on the thread the cursor's on. */
const onThread: When = { scope: 'diff', mode: 'normal' };

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
    /**
     * In the box's editor: adds the comment to your review. In the pull request's own box, which
     * joins no review, it posts the comment, and in an edit's box saves it. The submit dialog's
     * summary takes it for the dialog.
     */
    addToReview: {
      label: 'Add to review',
      group: 'Comment box',
      keys: ['cmd+enter'],
      editor: true,
      when: box,
    },
    /**
     * In the box's editor: posts the comment now, or the reply, outside your pending review. In the
     * pull request's own box it posts the comment, and in an edit's box saves it, as `⌘⏎` does.
     */
    postNow: {
      label: 'Comment or reply now',
      group: 'Comment box',
      keys: ['alt+enter'],
      editor: true,
      when: box,
    },
    /** In the box's editor: shows the preview in the editor's place, or the editor again. */
    preview: {
      label: 'Write or preview',
      group: 'Comment box',
      keys: ['cmd+shift+v'],
      editor: true,
      when: box,
    },
    /** In the box's editor: asks for files to attach, where the box takes them. */
    attach: {
      label: 'Attach files',
      group: 'Comment box',
      keys: ['cmd+shift+a'],
      editor: true,
      when: box,
    },
    /** In insert mode: Vim's `Esc`, which leaves it. */
    leaveInsert: {
      label: 'Leave insert mode',
      group: 'Comment box',
      keys: ['esc'],
      vim: 'own',
      when: { scope: 'box', mode: 'insert' },
    },
    /**
     * In normal mode, with nothing typed towards a command: closes the box, keeping the draft, as
     * `Esc` again after leaving insert mode does. In the box's preview, or on its frame, `Esc`
     * closes it at once, whatever mode the box was in.
     */
    close: {
      label: 'Close the box and keep the draft',
      group: 'Comment box',
      keys: ['esc'],
      editor: true,
      when: { scope: 'box', mode: 'normal' },
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
    /** Resolves the thread the keyboard is on, or unresolves it, as `x` in the diff does. */
    resolveInPanel: {
      label: 'Resolve or unresolve the thread',
      group: 'Panels',
      keys: ['x'],
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
