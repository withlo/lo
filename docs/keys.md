<!-- Written by `pnpm nx run desktop:codegen` from each feature's keys.ts in apps/desktop. Change those, not this file. -->

# Keys

Lo is keyboard first: every action has a key. These are its keys as it ships, from the commands each
of its features declares. Keys are written as macOS shows them; on Linux, Ctrl takes the place of
`⌘` (see [Keys for one system](#keys-for-one-system)). A sequence's keys are pressed one after
another: `] f` is `]`, then `f`.

Each command's id is what [the keymap file](#the-keymap-file) binds keys to.

## Code

| Action  | Keys | Where              | Command        |
| ------- | ---- | ------------------ | -------------- |
| Back    | `⌃o` | Anywhere but `box` | `keys.back`    |
| Forward | `⌃i` | Anywhere but `box` | `keys.forward` |

## Tabs and window

| Action                  | Keys  | Where                                                                                  | Command       |
| ----------------------- | ----- | -------------------------------------------------------------------------------------- | ------------- |
| Back to the middle view | `Esc` | Anywhere but `menu`, `dialog`, `palette` and `box`; in code views, only in normal mode | `keys.escape` |

## Where keys apply

A key applies in a scope: the nearest part of the window around the focused element that names one,
or `window`. A key for a scope beats one for anywhere, so the same chord can mean one thing in a
comment box and another elsewhere.

| Scope     | What it is                                                   |
| --------- | ------------------------------------------------------------ |
| `window`  | Anywhere no other scope has focus.                           |
| `menu`    | A menu. `j` and `k` move in it as `↓` and `↑` do.            |
| `dialog`  | A dialog, which keeps the browser's `Tab`.                   |
| `palette` | A palette, such as the command palette.                      |
| `diff`    | The diff, a code view.                                       |
| `file`    | A whole file, a code view.                                   |
| `peek`    | A peek at code elsewhere, such as a definition, a code view. |
| `box`     | A comment box, a code view with an insert mode.              |

In a code view, keys follow Vim's mode. In insert mode, and while Vim waits for the rest of a
command (after a count or an operator), only chords are Lo's, and other keys go to Vim. In a text
field, typing and moving through the text are the field's.

A key that starts one of Lo's sequences waits up to 1 s for the rest. If the next key doesn't go on
with it, both go on to Vim, so `y w` still yanks a word. Focus leaving, a click, `Esc` or a tab
switch drops a waiting key.

`Tab` doesn't move focus out of a scope; only dialogs and forms keep the browser's `Tab`.

## Keys for one system

On Linux, Ctrl takes the place of `⌘` in every key, and Lo shows each system its keys in its own
form: `⌘⇧P` is `Ctrl+Shift+P` on Linux. `⌃` is Ctrl on both, so Vim's `⌃o` is `Ctrl+O` on Linux.

These keys are on one system only:

| Action      | Keys                     | On    | Where    | Command          |
| ----------- | ------------------------ | ----- | -------- | ---------------- |
| Quit Lo     | `Ctrl+Q`                 | Linux | Anywhere | `app.quit`       |
| Zoom in     | `Ctrl+=`, `Ctrl+Shift+=` | Linux | Anywhere | `app.zoomIn`     |
| Zoom out    | `Ctrl+-`                 | Linux | Anywhere | `app.zoomOut`    |
| Actual size | `Ctrl+0`                 | Linux | Anywhere | `app.actualSize` |
| Full screen | `F11`                    | Linux | Anywhere | `app.fullScreen` |

On Linux, in a comment box in insert mode, and in a field inside a code view such as Vim's search,
Lo never takes `Ctrl+C`, `Ctrl+X`, `Ctrl+V`, `Ctrl+A`, `Ctrl+Z` or `Ctrl+W`: they keep their editing
meanings.

## Keys over Vim's

Code views (`diff`, `file`, `peek` and `box`) run Vim, and Lo leaves Vim's keys to it there, except
these, which run Lo's command in place of Vim's key:

| Keys             | Action  | Vim's key | Where                                                | Command        |
| ---------------- | ------- | --------- | ---------------------------------------------------- | -------------- |
| `⌃o`             | Back    | `⌃o`      | `diff`, `file` and `peek`                            | `keys.back`    |
| `⌃i`             | Forward | `⌃i`      | `diff`, `file` and `peek`                            | `keys.forward` |
| `Ctrl+Q` (Linux) | Quit Lo | `Ctrl+Q`  | `diff`, `file`, `peek` and `box` (normal and visual) | `app.quit`     |

## The keymap file

Keys are remapped in `~/.config/lo/keymap` (`$XDG_CONFIG_HOME/lo/keymap` on Linux), a text file with
one change on each line:

- `bind <keys> <command>` adds keys to a command, where it applies. A line here beats Lo's own keys,
  and a later line an earlier one.
- `unbind <keys>` takes keys from every command, and `unbind <keys> <command>` from that one.
- `vim <mode> <keys> <what they do>` maps keys in code views' Vim, as Vim's `:nmap` does, both sides
  in Vim's notation (`<C-o>`, `<CR>`). The mode is `normal`, `visual` or `insert`.
- `#` starts a comment.

```
# Back and forward with Alt and the arrows, as well as ⌃o and ⌃i.
bind alt+left keys.back
bind alt+right keys.forward
# Esc no longer goes back to the middle view.
unbind esc keys.escape
# Y yanks to the end of the line.
vim normal Y y$
```

A line that can't be read or applied is reported with its number, and the others still apply. A
`bind` doesn't apply when it names one of Vim's own keys, repeats a key the command already has, or
would keep another command's key from running: one of the two being the start of the other where
both apply.

### Writing keys

Keys are written the same way in the keymap file and in Lo's code:

- A chord joins modifiers and a key with `+`: `cmd+shift+p`. `cmd` is `⌘` on macOS and Ctrl on
  Linux, `ctrl` is `⌃` on macOS and Ctrl on Linux, `alt` is `⌥` (Alt) and `shift` is `⇧`.
- A sequence separates its keys with spaces: `] f`, `g S`.
- A key is one character, or one of `enter`, `esc`, `tab`, `space`, `backspace`, `delete`, `up`,
  `down`, `left`, `right`, `home`, `end`, `pageup`, `pagedown`, `insert`, and `f1` to `f20`. `plus`
  is `+`.
- A lone letter's case is its key: `G` is Shift and G, as is `shift+g`.
