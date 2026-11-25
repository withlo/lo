# Settings

Lo's settings are in a file, `settings.json`, and in Settings (`⌘,`), which edits the same file.

The file is in the folder Lo keeps the files you edit in, beside the keymap file: `~/.config/lo` on
macOS, and `$XDG_CONFIG_HOME/lo` (or `~/.config/lo`) on Linux. Settings says where it is. A build
run from source keeps it in `config` in its data folder instead, so it never touches an installed
Lo's.

## The file

The file is one JSON object, with each setting's key written out whole: `"diff.layout": "inline"`,
not a `diff` object holding `layout`. As in most editors' settings files, it can have comments, `//`
to the end of a line and `/* */` around any text, and a comma after the last entry of an object or a
list.

```jsonc
// Lo's settings.
{
  "theme": "dark", // Easier at night.
  "cache.cap": 20,
}
```

- **Lo applies a change as soon as you save the file,** whether you edited it or Settings did.
- **A value Lo can't use is reported and ignored.** Settings says which setting and what it takes,
  its row shows the default Lo uses instead, and the rest of the file applies as it is. The value
  stays in the file for you to fix.
- **A file Lo can't read as JSON** (a missing comma, say, or a comment that isn't closed) is
  reported, with the line and column where Lo found the problem, and Lo goes on with the settings it
  had. It changes nothing in the file until it's fixed, so Settings never writes over what you
  typed.
- **Settings changes only the setting's value.** Your comments, the order of the keys, the spacing,
  a byte order mark and the keys Lo doesn't know stay as they are, so a file shared with another
  version of Lo stays whole. A setting the file doesn't have yet goes after the last: on a line of
  its own, indented as the others are (two spaces in a new file), or on the same line in an object
  written on one, with a comma after it if the last one has one. Lo writes the new value whole, so a
  comment inside the old one, as in `code.trusted`'s list, goes with it.
- **A header an older Lo wrote goes.** Older versions of Lo began a file they made with a comment
  about which settings they applied, which no longer holds. When Lo changes a setting in a file that
  begins with that comment exactly as they wrote it, it takes the comment out. A comment you wrote,
  or changed even by a word, stays, and a file Lo makes has none.
- **A setting given more than once** is read as the last one says, as JavaScript and VS Code read
  JSON, and Settings reports it. Lo won't change that setting until the file has it once, since with
  two the file says one thing where you might read another. It changes the others as usual.
- **A save of yours is never written over.** Settings reads the file as it is when you change a
  setting, and if you save it again before the change is written, it reads it again and makes the
  change on top of your save.
- **A link to a file is followed.** A settings file kept with other dotfiles stays a link, and the
  file it leads to is the one Lo reads, watches and replaces.
- The file is read up to 1 MB, with objects and lists nested up to 100 levels deep.
- **Which repos you trust changes only through Lo's own dialog.** Lo adds one to `code.trusted` once
  you say "Trust" there, and takes one out once you remove it in Settings. You can still edit the
  file. If the file has a problem when you say "Trust", Lo says so where you asked, and offers to
  open the file.

## The settings

Settings shows each setting but `app.gpu` and `overview.open` as a row in one of its groups, with a
line on what it does and, under the pointer or focus, its key. Its search (`/` or `⌘F`) finds a row
by any of those. A setting a key also changes, such as `diff.layout`, shows the change in Settings
and keeps it across a restart.

| Setting           | Takes                                     | Default      | What it does                                                                                                                                                 |
| ----------------- | ----------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `theme`           | dark, light or system                     | `"system"`   | The theme: Lo Glow in dark or light, or whichever the system is in.                                                                                          |
| `window.zoom`     | a whole percent, from 50 to 200           | `100`        | How large the window draws everything. `⌘+`, `⌘-` and `⌘0` change it, a step at a time.                                                                      |
| `motion.reduce`   | system, on or off                         | `"system"`   | Whether the window keeps still: as the system says, always, or never. Tests start Lo with every move off, whatever it says.                                  |
| `cache.cap`       | a whole number of GB, from 1 to 10,000    | `10`         | The size Lo keeps its local copies of repos under. Past it, the least recently used go.                                                                      |
| `overview.on`     | true or false                             | `true`       | Whether Lo has overviews. Off, there's no Overview view, no overview notes, marks, prompts or skill, and Lo reads no overview.                               |
| `tab.open`        | overview, timeline or diff                | `"overview"` | What a pull request opens on. Overview, for a pull request with no overview, or with `overview.on` off, opens on the timeline.                               |
| `diff.layout`     | split or inline                           | `"split"`    | The diff's layout: the two sides next to each other, or one column of both. `gi` switches it.                                                                |
| `diff.whitespace` | show or hide                              | `"show"`     | Whether the diff shows changes to whitespace alone. `gw` switches it. GitHub's diff, shown until the local copy is ready, shows them either way.             |
| `tree.mode`       | tree or review                            | `"tree"`     | How the left panel lists a pull request's files: as a tree, or the changed files in review order. `t` switches it, for every pull request.                   |
| `code.hints`      | true or false                             | `false`      | Whether code views show inline type hints where a language server gives them. `gh` switches it.                                                              |
| `code.trusted`    | a list of trusted repos and pull requests | `[]`         | The repos, and pull requests from forks, that language servers may run on, as below.                                                                         |
| `editor.vim`      | true or false                             | `false`      | Whether code and comment boxes take Vim's keys. Off, they have a plain caret, and a box takes typing as soon as it has focus. Lo's own keys work either way. |
| `updates.check`   | true or false                             | `true`       | Whether Lo checks GitHub Releases for a newer version by itself: 30 s after it starts, then every 6 hours. Off, it checks only when you ask.                 |
| `app.gpu`         | true or false                             | `true`       | Whether Lo draws with the graphics card. Off, it draws with the processor alone, for a window that stays blank. It applies at the next start.                |
| `overview.open`   | overview, diff or null                    | `null`       | Replaced by `tab.open`. Lo carries a `"diff"` saved here over to `tab.open` once, unless `tab.open` is chosen already, then sets this to `null`.             |

`app.gpu` is only in the file, since a window that draws nothing couldn't reach it in Settings. Lo
reads it as it starts, before it draws anything, so a change applies the next time Lo starts. It
does what Chromium's `--disable-gpu` does, since an installed Lo takes no command-line switches.

`overview.open` is the key `tab.open` replaced, from when a pull request opened on its overview or
its diff. It's only in the file, and only Lo writes it: once it has carried its value over, it's
`null`, so a later change to `tab.open` stands.

## Trusted repos and pull requests

`code.trusted` lists what language servers may run on. Lo writes an entry once you trust a repo, or
a pull request from a fork, from its tab, and takes it out once you remove it in Settings:

```json
{
  "code.trusted": [
    { "repo": "fieldwork/atlas-api", "id": "R_kgDOVleUfQ", "at": "2026-11-15T09:12:44.000Z" },
    {
      "repo": "fieldwork/atlas-api",
      "id": "R_kgDOVleUfQ",
      "pull": 4833,
      "from": "sam-whit/atlas-api",
      "fromId": "R_kgDOVvlr6A",
      "at": "2026-11-15T09:20:03.000Z"
    }
  ]
}
```

- `repo` and `id` are the repository, by its name and GitHub's node ID for it. Lo trusts a pull
  request whose branch is in that repository only while both match, so a name that comes to belong
  to another repository, as when an account is deleted and its name taken, isn't trusted. A
  repository renamed since is asked about again.
- `pull`, `from` and `fromId` make an entry for one pull request from a fork: its number, and the
  fork by its name and node ID. Later pushes to it are trusted too, while its branch stays in that
  fork, by both: a fork that moves to another owner, or is renamed, is asked about again. A
  repository's entry never trusts a pull request from a fork.
- An entry Lo can't read, as one without an `id`, is reported and ignored, and stays in the file. A
  `code.trusted` that isn't a list, or holds more than 10,000 entries, trusts nothing, and Lo won't
  add to it until it's fixed.
- Taking an entry out, in the file or in Settings, removes the checkouts Lo made for what it alone
  trusted.
