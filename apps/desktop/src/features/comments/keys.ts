// The comments' keys: writing a comment in the diff, and acting on its review threads. `c` opens a
// comment box under the cursor's line, or the lines `v` selected, on either side, or on the file
// with the cursor on its header; `C` opens the same box to post right away; `s` opens it with the
// lines in a `suggestion` block. In the file tree `c` comments on the file. On an overview's code
// block, `c` comments on its lines, and in its code on the cursor's line or the lines `v` selected:
// on those lines at the head on screen where GitHub takes a comment on them, else on their file,
// else on the pull request itself. On a thread, the one `]t` landed on or the only one on the
// cursor's line or the header's file, `r` replies, `x` resolves or unresolves it, `i` edits your
// newest comment in it and `dd` deletes that comment, after asking. Each replaces Vim's key, since
// the code is read-only. The thread's menu, from a right-click on it or the `⋯` in its head, has
// them too. A right-click on one of your comments, or its own `⋯`, opens the same menu, with Edit
// and Delete acting on that comment.
// A line GitHub takes no comment on says so, and then `⏎` comments on its file instead; anywhere
// else `⏎` is Vim's. The box's own keys, in the Comment box group, are the box's editor's: `⌘⏎` adds
// the comment to your review (in the pull request's own box, which joins no review, it posts it; in
// an edit's box it saves it; in the review summary's it submits the review) and `⌥⏎` posts it now,
// or replies now, `⌘⇧V` shows the preview or the editor, `⌘⇧A` asks for files to attach, and `Esc`
// closes the box, keeping the draft. With Vim keys on, `Esc` leaves insert mode first, and closes
// the box at once only from its preview or its frame. The editor runs them itself, whatever box
// it's in, so they're
// declared as its own (`editor`): listed, checked for clashes, and never run or offered by the
// registry, nor changed by the keymap file. What the buttons in a box's notes do is also on its
// frame's right-click menu, and in the palette while focus is in the box, each only where the box
// offers it, without a key of its own. Where the kept drafts are, those the diff took down open
// that no box has taken since, the palette says, as a click on the status bar's note for them does.
// A new comment's box on lines in the diff changes its lines from its head's lines button, whose
// menu has them, or by key, in the box: `⌘⌥↓` and `⌘⌥↑` add and remove a last line, and with `⇧`
// a first, each taking the next line that way that takes a comment. They're Lo's, not the editor's,
// so a key that can't says why; the box's editor gives up its own add-a-cursor keys for them. Its
// bracket's two ends in the gutter drag the lines too, as a drag from the `+` does.
//
// Vim keys are a setting, `editor.vim`, off as Lo starts: "Vim keys" switches it, from the palette
// or Settings › Keyboard. Off, code and boxes have a plain caret, a box takes typing as soon as it
// has focus, and every key here works as it does with them on, but Vim's own.
//
// With threads beside lines (`comments.threads`), a thread is a mark in the gutter that opens in a
// popover over the code. On a line with a mark, `⏎` pins its popover and moves focus into it, the
// `thread` scope, where `j` and `k` move the ring between its comments, which `i` and `dd` act on,
// `r` and `x` act on its thread, and `Esc` closes it, focus going back to the line. From the line,
// with its popover closed, `x` and `dd` pin it first: a key never changes a thread that isn't on
// screen. Between lines the popover's keys are off. "Threads beside lines" and "Threads between
// lines", in the View menu and the palette, change the setting.
//
// In the threads panel, the `threads` scope: `j` and `k` move between its threads, `⏎` shows the
// one the keyboard is on in the diff, and `f` steps through what it lists: the unresolved threads,
// every thread, or yours. `⌘⌫` clears the filter, listing every thread. `x` resolves or
// unresolves the thread the keyboard is on, as in the diff. `Esc` goes back to the middle view, as
// it does anywhere.

import { defineCommands, type When } from '@lo/ui/commands';

/** In the diff, on the cursor's line or header, or the lines `v` selected. */
const diff: When = { scope: 'diff', mode: ['normal', 'visual'] };

/** In a comment box. */
const box: When = { scope: 'box' };

/** In the diff, on the thread the cursor's on, or in a thread's popover. */
const onThread: When = { scope: ['diff', 'thread'], mode: 'normal' };

/** In a thread's popover, beside lines. */
const popover: When = { scope: 'thread' };

/** In the threads panel. */
const panel: When = { scope: 'threads' };

export default defineCommands(
  'comments',
  {
    /**
     * A comment box on the cursor's line, the lines `v` selected, or, on a header, on the file. By
     * the mouse, the `+` beside a line: a click on that line, a drag from it on the lines it
     * crosses, and a click with Shift on the lines from the cursor's; or the right-click menu, on
     * the lines selected where it's inside them.
     */
    comment: {
      label: 'Comment',
      control: 'the + beside a line, in the gutter, or a drag from it',
      group: 'Comments',
      keys: ['c'],
      targets: ['line', 'header'],
      overVim: true,
      when: diff,
      menu: { on: 'line', order: 1 },
    },
    /** The same box, whose main button posts the comment right away, outside your pending review. */
    commentNow: {
      label: 'Comment now',
      description: 'Sends at once, outside your pending review.',
      group: 'Comments',
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
      label: 'Suggest change',
      group: 'Comments',
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
      label: 'Comment on file',
      group: 'Comments',
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
      label: 'Comment on lines',
      group: 'Comments',
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
      label: 'Comment on file',
      control: 'Comment on file on the toast after a line takes no comment',
      group: 'Comments',
      keys: ['enter'],
      targets: ['line'],
      overVim: true,
      when: { scope: 'diff', mode: 'normal' },
    },
    /**
     * Beside lines, on a line a draft's mark is on, its box opened again, as a click on its own
     * mark does: on a thread's, `⏎` shows the thread, the draft in it.
     */
    openDraft: {
      label: 'Open draft',
      control: 'a draft’s own mark beside lines',
      group: 'Comments',
      keys: ['enter'],
      targets: ['draft'],
      overVim: true,
      // In the diff, or an overview's code block.
      when: { scope: ['diff', 'file'], mode: 'normal', on: 'draft' },
    },
    /**
     * Beside lines, the popover of the thread on the cursor's line, pinned if it isn't, with focus
     * in it, the ring on its first comment. Just after a line refused a comment, `⏎` comments on
     * its file instead, as it does on a line with no mark.
     */
    openThread: {
      label: 'Show thread',
      description: 'Opens the thread on the cursor’s line and moves into it.',
      control: 'the marker beside a thread’s lines',
      group: 'Comments',
      keys: ['enter'],
      targets: ['thread'],
      overVim: true,
      // In the diff, or an overview's code block.
      when: { scope: ['diff', 'file'], mode: 'normal', on: 'thread' },
    },
    /** Closes the thread's popover, as its Close does: focus goes back to its line. */
    closeThread: {
      label: 'Close thread',
      control: 'Close on a thread’s popover',
      group: 'Comments',
      keys: ['esc'],
      when: popover,
    },
    /** Moves the ring in a thread's popover to its next comment, and keeps it in view. */
    nextComment: {
      label: 'Next comment',
      control: 'a click on a comment',
      group: 'Comments',
      keys: ['j', 'down'],
      when: popover,
      repeat: true,
    },
    previousComment: {
      label: 'Previous comment',
      control: 'a click on a comment',
      group: 'Comments',
      keys: ['k', 'up'],
      when: popover,
      repeat: true,
    },
    /**
     * Shows review threads in code beside their lines, as the `comments.threads` setting: with
     * `threadsBetween`, a choice of two, in the View menu beside the diff's layout.
     */
    threadsBeside: {
      label: 'Threads beside lines',
      description: 'Threads and overview notes open over the code.',
      group: 'View',
      keys: [],
      bar: { menu: 'View', section: 'threads', order: 10 },
      toggle: 'choice',
    },
    /**
     * Shows review threads in code between their lines, the whole thread under its line, and the
     * overview's notes under theirs.
     */
    threadsBetween: {
      label: 'Threads between lines',
      description: 'Threads and overview notes open under their lines.',
      group: 'View',
      keys: [],
      bar: { menu: 'View', section: 'threads', order: 20 },
      toggle: 'choice',
    },
    /** A reply box in the thread, right after its card. */
    reply: {
      label: 'Reply',
      control: 'Reply on a thread’s card',
      group: 'Comments',
      keys: ['r'],
      targets: ['line', 'header', 'thread'],
      overVim: true,
      when: onThread,
      menu: { on: 'thread', order: 10 },
    },
    /** Resolves the thread, or unresolves it once it's resolved, where GitHub lets you. */
    resolve: {
      label: 'Resolve thread',
      control: 'Resolve on a thread’s card',
      group: 'Comments',
      keys: ['x'],
      targets: ['line', 'header', 'thread'],
      overVim: true,
      when: onThread,
      // Named by which it would do: the handler says "Unresolve thread", and the thread's own menu
      // "Unresolve", on one that's resolved.
      menu: { on: 'thread', order: 20, label: 'Resolve' },
    },
    /**
     * A box with your newest comment in the thread, to edit it and save it over GitHub's text: in a
     * thread's popover, the comment the ring is on, and from a comment's own menu, that comment.
     */
    edit: {
      label: 'Edit comment',
      group: 'Comments',
      keys: ['i'],
      targets: ['line', 'header', 'thread'],
      overVim: true,
      when: onThread,
      menu: { on: 'thread', order: 40 },
    },
    /**
     * Deletes your newest comment in the thread, once you say so: in a popover, the ringed one, and
     * from a comment's own menu, that one.
     */
    remove: {
      label: 'Delete comment…',
      group: 'Comments',
      keys: ['d d'],
      targets: ['line', 'header', 'thread'],
      overVim: true,
      when: onThread,
      menu: { on: 'thread', order: 50 },
    },
    /** Drops the box's draft, and the box, as its "Discard draft" does. */
    discard: {
      label: 'Discard draft',
      control: 'Discard draft in a comment box’s foot',
      group: 'Comments',
      keys: [],
      targets: ['box'],
      when: box,
      menu: { on: 'box', order: 0 },
    },
    /** Brings back the draft "Discard draft" last took, as the "Undo" on its toast does. */
    undiscard: {
      label: 'Undo discard',
      control: 'Undo on the toast that says a draft was discarded',
      group: 'Comments',
      keys: [],
    },
    /**
     * After a comment was sent and didn't post: sends it again, as the box's "Try again" does. Never
     * while nobody knows whether it posted, which "Check again" finds out first.
     */
    sendAnyway: {
      label: 'Send again',
      control: 'Try again in a comment box’s note',
      group: 'Comments',
      keys: [],
      targets: ['box'],
      when: box,
      menu: { on: 'box', order: 10 },
    },
    /**
     * After a comment was sent and GitHub's answer never came: looks whether it posted, as the box's
     * "Check again" does. Found, the box goes; not there, it can be sent again.
     */
    checkAgain: {
      label: 'Check again',
      control: 'Check again in a comment box’s note',
      group: 'Comments',
      keys: [],
      targets: ['box'],
      when: box,
      menu: { on: 'box', order: 11 },
    },
    /**
     * Moves the box's text to a box on the file: from a new comment's lines button, and after GitHub
     * took no comment on the box's lines, as "Comment on file" does.
     */
    moveToFile: {
      label: 'Move comment to file',
      control: 'Move comment to file in a comment box’s note, or its lines button’s menu',
      group: 'Comments',
      keys: [],
      targets: ['box', 'lines'],
      when: box,
      menu: [
        { on: 'box', order: 20 },
        { on: 'lines', order: 50, apart: true },
      ],
    },
    /**
     * A new comment's lines while its box is open: the next line above its first that takes a
     * comment joins them, over a fold if one is between, and the box keeps its text. Also from its
     * head's lines button, and by dragging its bracket's tick in the gutter.
     */
    lineAbove: {
      label: 'Add line above',
      group: 'Comments',
      keys: ['cmd+alt+shift+up'],
      targets: ['lines'],
      when: box,
      menu: { on: 'lines', order: 10 },
    },
    /** Its first line taken off, the next that takes a comment its first, never past its last. */
    dropFirst: {
      label: 'Remove first line',
      group: 'Comments',
      keys: ['cmd+alt+shift+down'],
      targets: ['lines'],
      when: box,
      menu: { on: 'lines', order: 20 },
    },
    /** The next line below its last that takes a comment joins them. */
    lineBelow: {
      label: 'Add line below',
      group: 'Comments',
      keys: ['cmd+alt+down'],
      targets: ['lines'],
      when: box,
      menu: { on: 'lines', order: 30 },
    },
    /** Its last line taken off, the next that takes a comment its last, never past its first. */
    dropLast: {
      label: 'Remove last line',
      group: 'Comments',
      keys: ['cmd+alt+up'],
      targets: ['lines'],
      when: box,
      menu: { on: 'lines', order: 40 },
    },
    /**
     * After someone pushed since, or after a comment that would join your pending review, which is
     * on the latest push: shows that push, as the note's "Show latest" does.
     */
    showLatest: {
      label: 'Show latest',
      control: 'Show latest in a comment box’s note',
      group: 'View',
      keys: [],
      targets: ['box'],
      when: box,
      menu: { on: 'box', order: 30 },
    },
    /**
     * In the box's editor: adds the comment to your review. In the pull request's own box, which
     * joins no review, it posts the comment, and in an edit's box saves it. The submit dialog's
     * summary takes it for the dialog.
     */
    addToReview: {
      label: 'Add to review',
      control: 'Add to review in a comment box’s foot',
      group: 'Comments',
      keys: ['cmd+enter'],
      editor: true,
      when: box,
    },
    /**
     * In the box's editor: posts the comment now, or the reply, outside your pending review. In the
     * pull request's own box it posts the comment, and in an edit's box saves it, as `⌘⏎` does.
     */
    postNow: {
      label: 'Send now',
      description: 'Sends at once, outside your pending review.',
      control: 'Send now in a comment box’s foot',
      group: 'Comments',
      keys: ['alt+enter'],
      editor: true,
      when: box,
    },
    /** In the box's editor: shows the preview in the editor's place, or the editor again. */
    preview: {
      label: 'Preview',
      control: 'Write and Preview in a comment box’s head',
      group: 'Comments',
      keys: ['cmd+shift+v'],
      editor: true,
      when: box,
    },
    /** In the box's editor: asks for files to attach, where the box takes them. */
    attach: {
      label: 'Attach files…',
      control: 'Attach files… in a comment box’s foot',
      group: 'Comments',
      keys: ['cmd+shift+a'],
      editor: true,
      when: box,
    },
    /** With Vim keys on, in insert mode: Vim's `Esc`, which leaves it. */
    leaveInsert: {
      label: 'Leave INSERT mode',
      group: 'Comments',
      keys: ['esc'],
      vim: 'own',
      when: { scope: 'box', mode: 'insert' },
    },
    /**
     * Closes the box, keeping the draft, as its close button does. With Vim keys on, that's in
     * normal mode with nothing typed towards a command, so `Esc` again after leaving insert mode;
     * in the box's preview, or on its frame, `Esc` closes it at once, whatever mode the box was in.
     */
    close: {
      label: 'Close comment box',
      control: 'Close comment box in a comment box’s head',
      group: 'Comments',
      keys: ['esc'],
      editor: true,
      when: { scope: 'box', mode: 'normal' },
    },
    /**
     * Vim's keys in code views and comment boxes, on or off, saved as the `editor.vim` setting.
     * Off, as Lo starts, both have a plain caret, and Lo's own keys work as they do with them on.
     */
    vim: {
      label: 'Vim keys',
      control: 'The Vim keys switch in Settings › Keyboard',
      group: 'App',
      keys: [],
      toggle: 'switch',
    },
    /**
     * Says where each kept draft is, one the diff took down open that no box has taken since, and
     * when it opens, as a click on the status bar's note for them does: the pull request on
     * screen's, or the tab's that Settings' list of kept drafts names.
     */
    keptDrafts: {
      label: 'Show kept drafts',
      description: 'Drafts whose lines aren’t in this diff.',
      control: 'Show on a pull request in Settings › Storage › Kept drafts',
      group: 'Comments',
      keys: [],
      targets: ['none', 'tab'],
    },
    nextThread: {
      label: 'Next thread',
      control: 'Next in the threads panel’s foot',
      group: 'Comments',
      keys: ['j', 'down'],
      when: panel,
      repeat: true,
    },
    previousThread: {
      label: 'Previous thread',
      control: 'Previous in the threads panel’s foot',
      group: 'Comments',
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
      label: 'Show in diff',
      control: 'a row of the threads panel',
      group: 'Comments',
      keys: ['enter'],
      targets: ['thread'],
      when: panel,
    },
    /** Resolves the thread the keyboard is on, or unresolves it, as `x` in the diff does. */
    resolveInPanel: {
      label: 'Resolve thread',
      control: 'Resolve in the threads panel’s foot',
      group: 'Comments',
      keys: ['x'],
      targets: ['thread'],
      when: panel,
    },
    /** Lists the unresolved threads, every thread, or yours, round the end. */
    filterThreads: {
      label: 'Next thread filter',
      control: 'the filter over the threads panel’s list',
      group: 'Comments',
      keys: ['f'],
      when: panel,
    },
    /**
     * Lists every thread again: the button where the panel's filter lists none of them. `⌘⌫`, as
     * Recent's Clear filter.
     */
    clearFilter: {
      label: 'Clear filter',
      control: 'Clear filter in the threads panel, where its filter lists none of the threads',
      group: 'Comments',
      keys: ['cmd+backspace'],
      when: panel,
    },
  },
  { scopes: ['threads', 'thread'] },
);
