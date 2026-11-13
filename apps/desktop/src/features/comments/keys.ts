// The comments' keys: writing a comment in the diff. `c` opens a comment box under the cursor's
// line, or the lines `v` selected, on either side, or on the file with the cursor on its header; `C`
// opens the same box to post right away; `s` opens it with the lines in a `suggestion` block. In
// the file tree `c` comments on the file. Each replaces Vim's key, since the diff is read-only. A
// line GitHub takes no comment on says so, and then `⏎` comments on its file instead; anywhere else
// `⏎` is Vim's. The box's own keys are the code view's (`⌘⏎`, `⌥⏎`, `⌘⇧V`, `Esc Esc`).

import { defineCommands, type When } from '@lo/ui/commands';

/** In the diff, on the cursor's line or header, or the lines `v` selected. */
const diff: When = { scope: 'diff', mode: ['normal', 'visual'] };

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
  /** A comment box on the file, under its header in the diff: from its header, or its row in the tree. */
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
});
