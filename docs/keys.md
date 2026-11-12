<!-- Written by `pnpm nx run desktop:codegen` from each feature's keys.ts in apps/desktop. Change those, not this file. -->

# Keys

Lo is keyboard first: every action has a key, but for a few done once in a while, which a menu and
the command palette reach. These are its keys as it ships, from the commands each of its features
declares. Keys are written as macOS shows them; on Linux, Ctrl takes the place of `⌘` (see
[Keys for one system](#keys-for-one-system)). A sequence's keys are pressed one after another: `] f`
is `]`, then `f`.

Each command's id is what [the keymap file](#the-keymap-file) binds keys to.

## Move

| Action                       | Keys     | Where                        | Command                    |
| ---------------------------- | -------- | ---------------------------- | -------------------------- |
| Line down                    | `j`      | Vim's own key, in code views | `diff.down`                |
| Line up                      | `k`      | Vim's own key, in code views | `diff.up`                  |
| Select lines                 | `v`      | Vim's own key, in code views | `diff.select`              |
| Next pull request            | `j`, `↓` | In `recent`                  | `open.nextRecent`          |
| Previous pull request        | `k`, `↑` | In `recent`                  | `open.previousRecent`      |
| Next section of Settings     | `j`      | In `settings`                | `settings.nextSection`     |
| Previous section of Settings | `k`      | In `settings`                | `settings.previousSection` |

## Jump

| Action          | Keys  | Where                                  | Command               |
| --------------- | ----- | -------------------------------------- | --------------------- |
| Next change     | `] c` | In `diff`; in code views, Vim's motion | `diff.nextChange`     |
| Previous change | `[ c` | In `diff`; in code views, Vim's motion | `diff.previousChange` |
| Next file       | `] f` | In `diff`; in code views, Vim's motion | `diff.nextFile`       |
| Previous file   | `[ f` | In `diff`; in code views, Vim's motion | `diff.previousFile`   |

## Act

| Action              | Keys | Where                                         | Command           |
| ------------------- | ---- | --------------------------------------------- | ----------------- |
| Mark viewed         | `e`  | In `diff`; in code views, only in normal mode | `diff.markViewed` |
| Mark viewed         | `e`  | In `tree`                                     | `tree.markViewed` |
| Sign in with GitHub | `⏎`  | In `welcome`                                  | `welcome.signIn`  |

## Code

| Action  | Keys | Where              | Command        |
| ------- | ---- | ------------------ | -------------- |
| Back    | `⌃o` | Anywhere but `box` | `keys.back`    |
| Forward | `⌃i` | Anywhere but `box` | `keys.forward` |

## Copy and open

| Action                   | Keys                              | Where                                                               | Command             |
| ------------------------ | --------------------------------- | ------------------------------------------------------------------- | ------------------- |
| Copy the sign-in code    | `y y`                             | In `dialog`                                                         | `accounts.copyCode` |
| Whole file at the cursor | `g f`                             | In `diff`; in code views, only in normal mode                       | `diff.wholeFile`    |
| Copy the lines           | `y y`                             | In `diff` and `file`; in code views, only in normal and visual mode | `diff.copyLines`    |
| Copy the line's link     | `y l`                             | In `diff` and `file`; in code views, only in normal mode            | `diff.copyLink`     |
| Copy path                | `y p`                             | In `diff` and `file`; in code views, only in normal mode            | `diff.copyPath`     |
| Open on GitHub           | `g x`                             | In `diff` and `file`; in code views, only in normal mode            | `diff.openOnGithub` |
| Overview note            | None: in its menu and the palette | Anywhere                                                            | `diff.overviewNote` |
| Whole file               | `g f`                             | In `tree`                                                           | `tree.wholeFile`    |
| Copy path                | `y p`                             | In `tree`                                                           | `tree.copyPath`     |
| Open on GitHub           | `g x`                             | In `tree`                                                           | `tree.openOnGithub` |

## Find

| Action                         | Keys                    | Where                               | Command              |
| ------------------------------ | ----------------------- | ----------------------------------- | -------------------- |
| Search                         | `/`                     | Vim's own key, in code views        | `diff.search`        |
| Next match                     | `n`                     | Vim's own key, in code views        | `diff.nextMatch`     |
| Previous match                 | `N`                     | Vim's own key, in code views        | `diff.previousMatch` |
| Command palette                | `⌘⇧P`                   | Anywhere                            | `keys.palette`       |
| Review a pull request          | `⌘L`, `⌘O` (macOS only) | Anywhere but `dialog` and `palette` | `open.box`           |
| Open the link on the clipboard | `⌘V`                    | In `recent`                         | `open.paste`         |
| Filter recent pull requests    | `/`                     | In `recent`                         | `open.filter`        |
| Open the pull request          | `⏎`                     | In `recent`                         | `open.openRecent`    |
| Go to a file                   | `⌘P`                    | Anywhere but `dialog` and `palette` | `tree.find`          |

## View

| Action               | Keys    | Where                                                                                               | Command            |
| -------------------- | ------- | --------------------------------------------------------------------------------------------------- | ------------------ |
| Compare revisions    | `g v`   | Anywhere but `menu`, `dialog`, `palette`, `box` and `revisions`; in code views, only in normal mode | `revisions.picker` |
| Next middle view     | `` ` `` | Anywhere but `menu`, `dialog`, `palette` and `box`; in code views, only in normal mode              | `tab.nextView`     |
| Previous middle view | `~`     | Anywhere but `menu`, `dialog`, `palette` and `box`; in code views, only in normal mode              | `tab.previousView` |

## Files

| Action                   | Keys     | Where                                                                                  | Command            |
| ------------------------ | -------- | -------------------------------------------------------------------------------------- | ------------------ |
| Go to the file tree      | `-`      | Anywhere but `menu`, `dialog`, `palette` and `box`; in code views, only in normal mode | `tree.focus`       |
| Tree or review order     | `t`      | In `tree`                                                                              | `tree.mode`        |
| Changed files only       | `f`      | In `tree`                                                                              | `tree.changedOnly` |
| Next row of the tree     | `j`, `↓` | In `tree`                                                                              | `tree.down`        |
| Previous row of the tree | `k`, `↑` | In `tree`                                                                              | `tree.up`          |
| Open the folder          | `l`, `→` | In `tree`                                                                              | `tree.open`        |
| Close the folder         | `h`, `←` | In `tree`                                                                              | `tree.close`       |
| Open every folder        | `z R`    | In `tree`                                                                              | `tree.openAll`     |
| Close every folder       | `z M`    | In `tree`                                                                              | `tree.closeAll`    |
| Show the file            | `⏎`      | In `tree`                                                                              | `tree.show`        |

## Overview

| Action                   | Keys  | Where                                                                                  | Command               |
| ------------------------ | ----- | -------------------------------------------------------------------------------------- | --------------------- |
| Copy prompt for an agent | `y a` | Anywhere but `menu`, `dialog`, `palette` and `box`; in code views, only in normal mode | `overview.copyPrompt` |

## Panels

| Action     | Keys | Where                               | Command         |
| ---------- | ---- | ----------------------------------- | --------------- |
| Left panel | `⌘\` | Anywhere but `dialog` and `palette` | `tab.leftPanel` |

## Diff view

| Action                                | Keys  | Where                                         | Command           |
| ------------------------------------- | ----- | --------------------------------------------- | ----------------- |
| The other side                        | `Tab` | In `diff`; in code views, only in normal mode | `diff.otherSide`  |
| Inline or side by side                | `g i` | In `diff`; in code views, only in normal mode | `diff.inline`     |
| Hide or show whitespace changes       | `g w` | In `diff`; in code views, only in normal mode | `diff.whitespace` |
| Open unchanged lines                  | `z o` | In `diff`; in code views, only in normal mode | `diff.openRun`    |
| Close unchanged lines                 | `z c` | In `diff`; in code views, only in normal mode | `diff.closeRun`   |
| Open every unchanged line in the file | `z R` | In `diff`; in code views, only in normal mode | `diff.openFile`   |
| Load, close or open the file          | `z a` | In `diff`; in code views, only in normal mode | `diff.toggleFile` |
| Load a large file anyway              | `z a` | In `file`; in code views, only in normal mode | `diff.loadWhole`  |

## Revision picker

| Action                         | Keys     | Where          | Command                 |
| ------------------------------ | -------- | -------------- | ----------------------- |
| Next revision                  | `j`, `↓` | In `revisions` | `revisions.down`        |
| Previous revision              | `k`, `↑` | In `revisions` | `revisions.up`          |
| Set an end                     | `Space`  | In `revisions` | `revisions.end`         |
| Compare                        | `⏎`      | In `revisions` | `revisions.compare`     |
| Compare since your review      | `r`      | In `revisions` | `revisions.sinceReview` |
| Compare since you last looked  | `s`      | In `revisions` | `revisions.sinceSeen`   |
| Compare the whole pull request | `w`      | In `revisions` | `revisions.whole`       |
| Close the revision picker      | `Esc`    | In `revisions` | `revisions.close`       |

## Palettes

| Action                                | Keys  | Where        | Command            |
| ------------------------------------- | ----- | ------------ | ------------------ |
| Show an action's key                  | `⌥⏎`  | In `palette` | `keys.showKey`     |
| Changed files only in the file finder | `Tab` | In `palette` | `tree.findChanged` |
| Whole file from the file finder       | `⌘⏎`  | In `palette` | `tree.findWhole`   |

## Tabs and window

| Action                    | Keys                                  | Where                                                                                  | Command                 |
| ------------------------- | ------------------------------------- | -------------------------------------------------------------------------------------- | ----------------------- |
| Zoom in                   | `⌘=`, `⌘⇧=`                           | Anywhere                                                                               | `app.zoomIn`            |
| Zoom out                  | `⌘-`                                  | Anywhere                                                                               | `app.zoomOut`           |
| Actual size               | `⌘0`                                  | Anywhere                                                                               | `app.actualSize`        |
| Every key                 | `?`                                   | Anywhere                                                                               | `keys.help`             |
| Show the right-click menu | `Menu`, `⇧F10`                        | Anywhere but `menu`, `dialog` and `palette`                                            | `keys.menu`             |
| Back to the middle view   | `Esc`                                 | Anywhere but `menu`, `dialog`, `palette` and `box`; in code views, only in normal mode | `keys.escape`           |
| Open the keymap file      | `g ,`                                 | Anywhere but `menu`, `dialog`, `palette` and `box`; in code views, only in normal mode | `keys.openKeymap`       |
| Install command-line tool | None: in the app menu and the palette | Anywhere                                                                               | `open.installCommand`   |
| Install overview skill    | None: in the app menu and the palette | Anywhere                                                                               | `overview.installSkill` |
| Open Settings             | `⌘,`                                  | Anywhere but `dialog` and `palette`                                                    | `settings.open`         |
| Tab 1                     | `⌘1`                                  | Anywhere but `dialog` and `palette`                                                    | `tab.show1`             |
| Tab 2                     | `⌘2`                                  | Anywhere but `dialog` and `palette`                                                    | `tab.show2`             |
| Tab 3                     | `⌘3`                                  | Anywhere but `dialog` and `palette`                                                    | `tab.show3`             |
| Tab 4                     | `⌘4`                                  | Anywhere but `dialog` and `palette`                                                    | `tab.show4`             |
| Tab 5                     | `⌘5`                                  | Anywhere but `dialog` and `palette`                                                    | `tab.show5`             |
| Tab 6                     | `⌘6`                                  | Anywhere but `dialog` and `palette`                                                    | `tab.show6`             |
| Tab 7                     | `⌘7`                                  | Anywhere but `dialog` and `palette`                                                    | `tab.show7`             |
| Tab 8                     | `⌘8`                                  | Anywhere but `dialog` and `palette`                                                    | `tab.show8`             |
| Last tab                  | `⌘9`                                  | Anywhere but `dialog` and `palette`                                                    | `tab.showLast`          |
| Next tab                  | `⌘⇧]`, `⌃⇥`                           | Anywhere but `dialog` and `palette`                                                    | `tab.next`              |
| Previous tab              | `⌘⇧[`, `⌃⇧⇥`                          | Anywhere but `dialog` and `palette`                                                    | `tab.previous`          |
| Tabs that don’t fit       | `⌘⇧A`                                 | Anywhere but `dialog` and `palette`                                                    | `tab.more`              |
| Close tab                 | `⌘W`                                  | Anywhere but `dialog` and `palette`                                                    | `tab.close`             |

## Where keys apply

A key applies in a scope: the nearest part of the window around the focused element that names one,
or `window`. A key for a scope beats one for anywhere, so the same chord can mean one thing in a
comment box and another elsewhere.

| Scope       | What it is                                                                            |
| ----------- | ------------------------------------------------------------------------------------- |
| `window`    | Anywhere no other scope has focus.                                                    |
| `menu`      | A menu. Only commands that name it run there, and `j` and `k` move as `↓` and `↑` do. |
| `dialog`    | A dialog, which keeps the browser's `Tab`.                                            |
| `palette`   | A palette, such as the command palette.                                               |
| `diff`      | The diff, a code view.                                                                |
| `file`      | A whole file, a code view.                                                            |
| `peek`      | A peek at code elsewhere, such as a definition, a code view.                          |
| `box`       | A comment box, a code view with an insert mode.                                       |
| `recent`    | Named by `open`.                                                                      |
| `overview`  | Named by `overview`.                                                                  |
| `revisions` | Named by `revisions`.                                                                 |
| `settings`  | Named by `settings`.                                                                  |
| `tree`      | Named by `tree`.                                                                      |
| `welcome`   | Named by `welcome`.                                                                   |

In a code view, keys follow Vim's mode. In insert mode, and while Vim waits for the rest of a
command (after a count or an operator), only chords are Lo's, and other keys go to Vim. In a text
field, typing and moving through the text are the field's.

A key that starts one of Lo's sequences waits up to 1 s for the rest. In a code view, a waiting key
that isn't completed goes on to Vim: with the next key, when that doesn't go on with it, so `y w`
still yanks a word, or alone once the time is up. Anywhere else it's dropped, and the next key
counts on its own. A chord Lo runs drops the waiting key, as do `Esc`, focus leaving, a click and a
tab switch.

`Tab` doesn't move focus out of a scope; only dialogs and forms keep the browser's `Tab`.

## Keys for one system

On Linux, Ctrl takes the place of `⌘` in every key, and Lo shows each system its keys in its own
form: `⌘⇧P` is `Ctrl+Shift+P` on Linux. `⌃` is Ctrl on both, so Vim's `⌃o` is `Ctrl+O` on Linux.

These keys are on one system only:

| Action                | Keys     | On    | Where                               | Command          |
| --------------------- | -------- | ----- | ----------------------------------- | ---------------- |
| Quit Lo               | `Ctrl+Q` | Linux | Anywhere                            | `app.quit`       |
| Full screen           | `F11`    | Linux | Anywhere                            | `app.fullScreen` |
| Review a pull request | `⌘O`     | macOS | Anywhere but `dialog` and `palette` | `open.box`       |

On Linux, in a comment box in insert mode, and in a field inside a code view such as Vim's search,
Lo never takes `Ctrl+C`, `Ctrl+X`, `Ctrl+V`, `Ctrl+A`, `Ctrl+Z` or `Ctrl+W`: they keep their editing
meanings.

## Keys over Vim's

Code views (`diff`, `file`, `peek` and `box`) run Vim, and Lo leaves Vim's keys to it there, except
these, which run Lo's command in place of Vim's key:

| Keys             | Action                          | Vim's key | Where                                                                | Command               |
| ---------------- | ------------------------------- | --------- | -------------------------------------------------------------------- | --------------------- |
| `e`              | Mark viewed                     | `e`       | `diff` (normal)                                                      | `diff.markViewed`     |
| `g i`            | Inline or side by side          | `g i`     | `diff` (normal)                                                      | `diff.inline`         |
| `g w`            | Hide or show whitespace changes | `g w`     | `diff` (normal)                                                      | `diff.whitespace`     |
| `y y`            | Copy the lines                  | `y`       | `diff` and `file`                                                    | `diff.copyLines`      |
| `y l`            | Copy the line's link            | `y`       | `diff` (normal) and `file` (normal)                                  | `diff.copyLink`       |
| `y p`            | Copy path                       | `y`       | `diff` (normal) and `file` (normal)                                  | `diff.copyPath`       |
| `?`              | Every key                       | `?`       | `diff`, `file`, `peek` and `box` (normal and visual)                 | `keys.help`           |
| `⌃o`             | Back                            | `⌃o`      | `diff`, `file` and `peek`                                            | `keys.back`           |
| `⌃i`             | Forward                         | `⌃i`      | `diff`, `file` and `peek`                                            | `keys.forward`        |
| `y a`            | Copy prompt for an agent        | `y`       | `diff` (normal), `file` (normal) and `peek` (normal)                 | `overview.copyPrompt` |
| `g v`            | Compare revisions               | `g v`     | `diff` (normal), `file` (normal) and `peek` (normal)                 | `revisions.picker`    |
| `` ` ``          | Next middle view                | `` ` ``   | `diff` (normal), `file` (normal) and `peek` (normal)                 | `tab.nextView`        |
| `~`              | Previous middle view            | `~`       | `diff` (normal), `file` (normal) and `peek` (normal)                 | `tab.previousView`    |
| `-`              | Go to the file tree             | `-`       | `diff` (normal), `file` (normal) and `peek` (normal)                 | `tree.focus`          |
| `Ctrl+Q` (Linux) | Quit Lo                         | `Ctrl+Q`  | `diff`, `file`, `peek` and `box` (normal and visual)                 | `app.quit`            |
| `Ctrl+W` (Linux) | Close tab                       | `Ctrl+W`  | `diff` (normal), `file` (normal), `peek` (normal) and `box` (normal) | `tab.close`           |
| `Ctrl+P` (Linux) | Go to a file                    | `Ctrl+P`  | `diff`, `file`, `peek` and `box` (normal and visual)                 | `tree.find`           |

In code views, Vim runs Lo's motions (next change, previous change, next file and previous file)
under Lo's keys, so a count repeats them and they extend a selection in visual mode.

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
# Open the command palette with ⌘K as well, as many apps do.
bind cmd+k keys.palette
# Esc no longer goes back to the middle view.
unbind esc keys.escape
# Y yanks to the end of the line.
vim normal Y y$
```

A line that can't be read or applied is reported with its number, and the others still apply. A
`bind` doesn't apply when it names one of Vim's own keys, repeats a key the command already has, or
would keep another command's key from running: one of the two being the start of the other where
both apply.

Lo watches the file, so a saved change applies within a second, with no restart, and key help (`?`)
shows the new keys and the lines Lo can't use. To open the file, use the button in key help, the
command palette or `g ,`: Lo opens it as text in your system's text editor, writing it first, with a
header of comments, if there isn't one. Opening never runs anything, so Lo doesn't open a file that
is executable, isn't a plain file (a folder, or an app a link leads to) or is over the limit below:
key help says why, and has no button. The editor is the app for text whatever the file's name or
contents, even through a link to a file named like a launcher or a web page: on Linux, the app
`xdg-mime query default text/plain` names, started with `gio launch`. Without one of those, Lo says
so and opens nothing. A link to a file in a dotfiles folder is followed. Lo reads a file of up to 1
MiB and lines of up to 1,000 characters; a longer line is reported and skipped, and a longer file
isn't read. Nothing in the file is ever run.

### Writing keys

Keys are written the same way in the keymap file and in Lo's code:

- A chord joins modifiers and a key with `+`: `cmd+shift+p`. `cmd` is `⌘` on macOS and Ctrl on
  Linux, `ctrl` is `⌃` on macOS and Ctrl on Linux, `alt` is `⌥` (Alt) and `shift` is `⇧`.
- A sequence separates its keys with spaces: `] f`, `g S`.
- A key is one character, or one of `enter`, `esc`, `tab`, `space`, `backspace`, `delete`, `up`,
  `down`, `left`, `right`, `home`, `end`, `pageup`, `pagedown`, `insert`, `menu`, and `f1` to `f20`.
  `plus` is `+`.
- A lone letter's case is its key: `G` is Shift and G, as is `shift+g`.
