# Settings

Lo's settings are in a file, `settings.json`, and in Settings (`⌘,`), which edits the same file.

The file is in the folder Lo keeps the files you edit in, beside the keymap file: `~/.config/lo` on
macOS, and `$XDG_CONFIG_HOME/lo` (or `~/.config/lo`) on Linux. Settings says where it is. A build
run from source keeps it in `config` in its data folder instead, so it never touches an installed
Lo's.

## The file

The file is one JSON object, with each setting's key written out whole: `"diff.layout": "inline"`,
not a `diff` object holding `layout`.

```json
{
  "theme": "dark",
  "cache.cap": 20
}
```

- **Lo applies a change as soon as you save the file,** whether you edited it or Settings did.
- **A value Lo can't use is reported and ignored.** Settings says which setting, what it takes and
  what Lo uses instead, and the rest of the file applies as it is. The value stays in the file for
  you to fix.
- **A file that isn't JSON** (a missing comma, a comment) is reported, and Lo goes on with the
  settings it had. It changes nothing in the file until it's fixed, so Settings never writes over
  what you typed.
- **Keys Lo doesn't know are kept** when Settings changes a setting, so a file shared with another
  version of Lo stays whole. Settings writes the file whole, as JSON with two-space indents.
- **A save of yours is never written over.** Settings reads the file as it is when you change a
  setting, and if you save it again before the change is written, it reads it again and makes the
  change on top of your save.
- **A link to a file is followed.** A settings file kept with other dotfiles stays a link, and the
  file it leads to is the one Lo reads, watches and replaces.
- The file is read up to 1 MiB.

## The settings

| Setting     | Takes                                  | Default    | What it does                                                                            |
| ----------- | -------------------------------------- | ---------- | --------------------------------------------------------------------------------------- |
| `theme`     | dark, light or system                  | `"system"` | The theme: Lo Glow in dark or light, or whichever the system is in.                     |
| `cache.cap` | a whole number of GB, from 1 to 10,000 | `10`       | The size Lo keeps its local copies of repos under. Past it, the least recently used go. |
