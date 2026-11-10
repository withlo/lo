# Keyboard and focus

Lo is keyboard first: every action has a key, and you can reach and open every block, row, link and
control without a mouse. Keys are Vim-style single keys from CodeMirror's Vim package; arrow keys
also work. Every key can be remapped in `~/.config/lo/keymap`.

## Rules

- **Every action gets a key before it ships,** and appears in the command palette (`⌘⇧P`), the key
  help (`?`) and the right-click menu where one makes sense.
- **Show the key on the control.** Buttons, menu items, segmented controls and hint rows carry
  `lo-kbd` (one key) or `lo-keys` (a sequence such as `] b`). Chords are one key (`⌘⇧P`); sequences
  are separate keys with no plus sign.
- **Write keys in their macOS form in docs.** On Linux, Ctrl replaces `⌘`; the app shows each
  platform its own. The exceptions are under Linux, below.
- **Don't take a key that's already used,** by Lo or by Vim habits people bring with them
  (`j k w b gg G v / n`). Check the key table in section 12 of [`docs/design.md`](../docs/design.md)
  before adding one.
- **Copying is `y` plus a letter** (`yy`, `yl`, `yp`, `ya`). There is no single-key `y`, so none
  collides with them.
- **Families stay families.** `]`/`[` jump forward and back, `g` goes somewhere, `z` folds, `⌘` acts
  on the window or the review.
- **Single letters act on what has focus.** In the file tree, `t`, `f`, `l` and `h` mean tree
  things; in the diff, the table's meanings hold.

## Focus

- Keyboard focus shows `--lo-ring`: a 1.5 px Powder edge and a soft halo. Rows in lists, tabs and
  summaries use `--lo-ring-inset`.
- Focus only shows for the keyboard (`:focus-visible`). Pointer clicks don't draw a ring.
- Focus is where the keyboard is. **Current** (a Powder ball, `lo-current` behind) is what's on
  screen. Both can show at once, on different rows.
- A focused overview block shows its keys in a hint chip at its bottom right.
- In code, the block cursor glows while the view has focus and goes hollow when it loses it. The
  mode (`NORMAL`, `V-LINE`, `INSERT`) shows in the status bar and in comment boxes.
- `Esc` always returns focus to the middle view and closes the nearest popover.

## Linux

Ctrl takes the place of `⌘` in every key. Vim's `⌃` keys keep their meanings, so two keys differ
from what that rule would give, on both systems:

- **`⌘L` opens a PR,** the browser's "type an address" key. `⌘O` would become Ctrl+O, which is `⌃o`
  (back), so it stays a macOS alias only.
- **`⌥⏎` shows an action's key in the palettes.** `⌃⏎` would be the same as `⌘⏎`, the other way.

`⌃⇥` and `⌃⇧⇥` also move to the next and previous tab, on both systems, beside `⌘⇧]` and `⌘⇧[`.

In a comment box in insert mode, Ctrl+C, Ctrl+X, Ctrl+V, Ctrl+A and Ctrl+Z keep their usual editing
meanings, and Ctrl+W deletes the previous word, as in Vim and terminals. It doesn't close the tab
there; anywhere else, Ctrl+W does.
