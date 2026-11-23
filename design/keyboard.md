# Keyboard and focus

Lo is keyboard first, not keyboard only: every action has a key and a visible control, and you can
reach and open every block, row, link and control without a mouse. Lo's keys are single keys that
act on what has focus. They work with Vim keys off, the default, and on. Nothing may depend on Vim.
Every key can be remapped in `~/.config/lo/keymap`.

## Vim keys

"Vim keys" in the command palette and the View menu switches the `editor.vim` setting, and every
code view and comment box follows at once.

- **Off, as Lo starts,** code has a caret, as text anywhere does: click to place it, arrows to move
  it, Shift with either to select, `⌘C` to copy, and `/` or `⌘F` to search. A comment box is typed
  in from the moment it has focus, and one `Esc` closes it and keeps the draft. No mode shows
  anywhere.
- **On,** code views and comment boxes run CodeMirror's Vim package: modes, counts, operators and
  visual mode. A box opens in insert mode; `Esc` leaves it, and `Esc` again closes the box.
- **Lo's own keys are the same either way:** `j` `k`, `g d`, `] c`, `c`, `e` and the rest. A key
  that acts on the lines `v` selected acts on the lines a selection covers with Vim keys off.
- **A new command must run with Vim keys off.** A test runs every command's keys that way and fails
  on one only a Vim mode could reach. The keys documented as Vim's own are `j`, `k`, `g g`, `G`,
  `/`, `n` and `N`, which a code view runs itself while Vim keys are off, and `v` and the box's
  `Esc` out of insert mode, which only Vim has.

## Rules

- **Every action gets a key before it ships,** and appears in the command palette (`⌘⇧P`), the key
  help (`?`) and the right-click menu where one makes sense.
- **Every action gets a control too,** drawn where its target is, which runs the command as its key
  does. Its command says where in `keys.ts` (`control`, `menu` or `bar`), and a check fails on one
  that doesn't. "Every action has a control" in [`README.md`](README.md#every-action-has-a-control)
  has the pieces: `HintButton`, `MoreButton` and the controls a code view draws.
- **Show the key where it works now.** Main buttons, dialog buttons, menu items, segmented controls
  and hint rows carry `lo-kbd` (one key) or `lo-keys` (a sequence such as `] b`), after the label. A
  control repeated on every card or row shows its key only on the one the keyboard is on, and in its
  tooltip on the others. Chords are one key (`⌘⇧P`); sequences are separate keys with no plus sign.
- **Write keys in their macOS form in docs.** On Linux, Ctrl replaces `⌘`; the app shows each
  platform its own. The exceptions are under Linux, below.
- **Don't take a key that's already used,** by Lo or by Vim habits people bring with them
  (`j k w b gg G v / n`). Check [`docs/keys.md`](../docs/keys.md) before adding one.
- **Copying is `y` plus a letter** (`yy`, `yl`, `yp`, `ya`). There is no single-key `y`, so none
  collides with them.
- **Families stay families.** `]`/`[` jump forward and back, `g` goes somewhere, `z` folds, `⌘` acts
  on the window or the review.
- **Single letters act on what has focus.** In the file tree, `t`, `f`, `l` and `h` mean tree
  things; in the diff, the table's meanings hold.
- **A right-click menu lists what its target can do, with the keys,** and greys what can't run
  there, with the reason. `Menu` or `⇧F10` opens the menu of what has focus; `j`/`k` or the arrows
  move, `⏎` runs, and `Esc` closes it and gives focus back where it was. A menu runs the same
  command a key does, on what was clicked.
- **A key that edits text never runs a command in a field that can be edited.** The keys are those
  that delete a word or to the line's start (`⌥⌫`, `⌘⌫`, `⌥⌦`; Ctrl+Backspace and Ctrl+Delete on
  Linux), select all, undo and redo, and move the caret or the selection by word, line, paragraph
  and document (`⌥←` `⌥→` `⌥↑` `⌥↓`, `⌘←` `⌘→` `⌘↑` `⌘↓`, Home and End, with and without `⇧`; Ctrl
  with the arrows, Home and End on Linux). On macOS they also take in the `⌃` keys every text field
  has from Emacs: `⌃A` `⌃E` `⌃B` `⌃F` `⌃P` `⌃N` (with and without `⇧`), `⌃H` `⌃D` `⌃K` `⌃T` and
  `⌃O`. `textEditingKeys` in the command engine lists each system's. A field that can be edited is
  an input or text area that isn't read-only, or editable content, such as a comment box's text, in
  any mode; a code view's read-only text isn't one. There the keys are the field's, whatever the
  scope. A command on one of them goes in a scope that holds no field, as Clear filter's `⌘⌫` works
  in Recent's list and not in the filter field above it. Only a command that changes the text of the
  field it's pressed in says `editsField`, which gives it the keys there. `checkEditingKeys` fails
  on any other, naming it, but those the app lists as leaving their key to a field: Back's `⌃O` goes
  back everywhere but in a field on macOS, which opens a line with it. The app lists both in
  `window/commands/fieldless.ts`, and the window logs an error when a field has focus in a scope
  listed as holding none, as the check is wrong then.

## Focus

- Keyboard focus shows `--lo-ring`: a 1.5 px Powder edge and a soft halo. Rows in lists, tabs and
  summaries use `--lo-ring-inset`.
- Focus only shows for the keyboard (`:focus-visible`). Pointer clicks don't draw a ring.
- Focus is where the keyboard is. **Current** (a Powder ball, `lo-current` behind) is what's on
  screen. Both can show at once, on different rows.
- A focused overview block shows its keys in a hint chip at its bottom right.
- In code, the cursor glows while the view has focus and goes hollow when it loses it.
- The mode (`NORMAL`, `V-LINE`, `INSERT`) shows only with Vim keys on, and then once in the status
  bar and in the focused box.
- `Esc` always returns focus to the middle view and closes the nearest popover.
- **Focus never falls to the page with what had it.** When the focused element leaves the page, as a
  Try again does that goes once pressed, the browser drops focus on the body, where none of the
  view's keys work. Instead focus goes to the nearest part of the view still there: the nearest
  scope (`data-lo-scope`) around that element that's still on the page, but never the window's own,
  so the view's keys work at once. One handler on the window does it (`catchFocus` in the command
  engine), a frame after the element goes, once React, Base UI and a closing popup have done their
  own focus work, and only while focus is still on the body. Focus that went anywhere by then, as a
  dialog giving it back to its trigger, stays there, and so does focus that left an element still on
  the page, by a click on nothing or the window losing focus. Should focus fall without a word, the
  next key pressed on the body catches it, before the key is matched. A code view's scope gives it
  to the view (its source's `focus`), which puts it in its text, where its cursor and Vim keys are,
  in the pane that had focus last, the cursor where it was. Any other scope takes it itself, made
  focusable (`tabIndex = -1`) if it can't be, and drawing no ring, until focus leaves it, for
  anywhere but the window losing focus.
- **A better place than the scope is the view's to give.** Where one exists, such as the field a
  button was beside, the stack's tree above the note that held a Try again, or a dialog's main
  button, the view moves focus there itself as the element goes, and the window's handler finds
  focus taken. `handOffFocus` in `@lo/ui` does it: given what's leaving and where focus goes, it
  acts only if focus was inside what's leaving, and a microtask on, once React has drawn what
  replaces it, only if focus fell to the page or stays on what can no longer hold it, as a button in
  a row that closes. Focus that went anywhere else by then stays. A row or other element made to
  take focus this way draws no ring (`data-lo-caught`) and is no stop for `Tab`. So a banner's "+1"
  hands focus to the next banner's "+1", or its action where it has none; Dismiss to the same button
  on the banner that takes its place, else its action, else its "+1"; and a banner that leaves while
  it holds focus for any other reason, as its own action takes it away or a more urgent one takes
  its place, to the next banner's action, else its "+1", else its Dismiss. Once the last banner
  goes, focus goes to the middle view. A status item's details, or the header chip's, ending while
  they hold focus, hand it to their item or chip as it's drawn now, else to the next control beside
  it (`besideIn`), else the one before it, else the row.

## Linux

Ctrl takes the place of `⌘` in every key. Vim's `⌃` keys keep their meanings, so two keys differ
from what that rule would give, on both systems:

- **`⌘L` opens a PR,** the browser's "type an address" key. `⌘O` would become Ctrl+O, which is `⌃o`
  (back), so it stays a macOS alias only.
- **`⌥⏎` shows an action's key in the palettes.** `⌃⏎` would be the same as `⌘⏎`, the other way.

`⌃⇥` and `⌃⇧⇥` also move to the next and previous tab, on both systems, beside `⌘⇧]` and `⌘⇧[`.

In a comment box that's being typed in (always, with Vim keys off; in insert mode with them on),
Ctrl+C, Ctrl+X, Ctrl+V, Ctrl+A and Ctrl+Z keep their usual editing meanings, and Ctrl+W deletes the
previous word, as in Vim and terminals. It doesn't close the tab there; anywhere else, Ctrl+W does.
