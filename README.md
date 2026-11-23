<picture>
  <source media="(prefers-color-scheme: light)" srcset="brand/banner/banner-light.svg">
  <img alt="Lo" src="brand/banner/banner-dark.svg" width="100%">
</picture>

<p align="center">
  A fast, keyboard-first desktop app for reviewing GitHub pull requests.
</p>

<p align="center">
  <b>Early development · not released yet · Mac first, with a Linux preview</b>
</p>

<p align="center">
  <a href="https://github.com/withlo/lo/actions/workflows/ci.yml?query=event%3Amerge_group"><img alt="CI" src="https://github.com/withlo/lo/actions/workflows/ci.yml/badge.svg?event=merge_group"></a>
  <a href="LICENSE"><img alt="License: GPL-3.0" src="https://img.shields.io/badge/license-GPL--3.0-blue"></a>
  <a href="#status"><img alt="Platform: macOS, with a Linux preview" src="https://img.shields.io/badge/platform-macOS%20%C2%B7%20Linux%20preview-lightgrey"></a>
</p>

<p align="center">
  <a href="#about">About</a> ·
  <a href="#principles">Principles</a> ·
  <a href="#features">Features</a> ·
  <a href="#status">Status</a> ·
  <a href="#install">Install</a> ·
  <a href="#build-from-source">Build</a> ·
  <a href="#usage">Usage</a> ·
  <a href="#contributing">Contributing</a> ·
  <a href="#license">License</a>
</p>

## About

Lo (as in "lo and behold") is a desktop app for reviewing GitHub pull requests. It's for people who
read far more code than they write, such as someone reviewing the pull requests their coding agents
open. It talks to GitHub directly and has no backend of its own.

Lo is built around what a reviewer does all day: read an overview that a coding agent wrote to
explain the change, see the changed files among the rest of the repository, review a stack of pull
requests layer by layer, see what changed since your last review even after a rebase, follow code to
where it's defined, and approve and merge on one key.

## Principles

Lo keeps to these rules. [`docs/design.md`](docs/design.md) has the detail.

- **No AI in Lo.** Lo calls no model and runs no agent: it shows the overviews agents write. Their
  format and skill are MIT-licensed, and the skill installs for Claude Code or Codex.
- **Built on GitHub.** Reviews, comments, viewed marks and merges are GitHub's own, so github.com
  shows what you did in Lo.
- **Your data stays between you and GitHub.** No Lo backend, account or telemetry. Your tokens stay
  on your computer, protected by your system's keychain, and go only to GitHub.
- **Read-only.** Lo never edits files or pushes commits. It writes to GitHub only to review, merge
  and form stacks.
- **Never runs a repository's code.** No dependency installs or build steps. Language servers, which
  can run a project's code, start only on repositories you trust.
- **Keyboard first.** Every action is meant to have a key, and `?` lists every key. A few rare ones,
  such as installing the `lo` command, live in the command palette instead.

## Features

- **Overviews.** A pull request can carry an overview: an explanation a coding agent wrote, with
  definitions, diagrams and walkthroughs tied to the real code. Lo opens it before the diff.
- **The whole repo.** The file tree shows changed files among their unchanged neighbors, or in
  review order, with each source file followed by its tests. `⌘P` finds any file.
- **Stacks.** Native GitHub stacks, chains of base branches, and pull requests that contain
  another's commits show as a tree. You review them layer by layer, and a GitHub stack merges in one
  request, where other chains merge a layer at a time.
- **Diffs.** Side by side by default, with moved-code detection.
- **Revisions.** Compare any two pushes, and see what changed since your last review or since you
  marked a file viewed, even across a rebase.
- **Code.** Syntax-based navigation everywhere, plus types, hovers and exact references from
  language servers on repositories you trust.
- **Merging.** Approve and ship on one key, a clear "why can't this merge" panel, and full merge
  queue support.
- **Keys.** Vim-style keys in the code, a command palette, `?` for every key, and a keymap file to
  change them.

## Status

Lo is in early development and isn't released yet. To try it,
[build it from source](#build-from-source), and expect missing pieces and things that change. It's
made for the Mac first, and Linux builds will come as a preview. [Install](#install) says where its
builds are published and what they hold.

[`docs/design.md`](docs/design.md) describes everything Lo is meant to do, and how it's built.

## Install

Lo's releases are published on [GitHub Releases](https://github.com/withlo/lo/releases), and each
holds Lo for the Mac and for Linux. `<version>` below is the release's, such as `0.1.0`.

**On a Mac** (macOS 13 or later), install Lo with [Homebrew](https://brew.sh), from its tap,
[withlo/homebrew-tap](https://github.com/withlo/homebrew-tap):

```sh
brew install --cask withlo/tap/lo
```

Homebrew installs the release's DMG for your Mac, and updates Lo with
`brew upgrade --cask withlo/tap/lo`, or with everything else on `brew upgrade`. Lo installed this
way doesn't update itself, so Homebrew always knows which version you have. A release reaches the
tap through a pull request that the tap's checks audit and install before it's merged, so it can
arrive there a little after GitHub Releases.

Or download the DMG that matches your Mac, open it and drag Lo to your Applications folder:

- `Lo-<version>-arm64.dmg` for Apple silicon, and `Lo-<version>-x64.dmg` for Intel.
- The zips of the same names hold the same app. Lo downloads the zip when it updates itself.

The app in each DMG and zip is signed with a Developer ID, notarized by Apple and stapled, and the
DMGs are signed and notarized too, so Gatekeeper accepts them.

**On Linux,** install the package for your distribution and architecture with its package manager:

- `Lo-<version>-amd64.deb` or `Lo-<version>-arm64.deb`: `sudo apt install ./Lo-<version>-amd64.deb`,
  on Debian and Ubuntu.
- `Lo-<version>-x86_64.rpm` or `Lo-<version>-aarch64.rpm`:
  `sudo dnf install ./Lo-<version>-x86_64.rpm`, on Fedora and Red Hat.

Lo goes in `/opt/Lo`, and `lo` becomes a command that opens it. Lo keeps your tokens in the system's
keyring, such as GNOME Keyring or KWallet, through libsecret, which the packages depend on. It
registers for `lo://` links only, so web links stay with your browser.

The Linux packages are a preview: the Linux build is newer and less polished than the Mac's. Each
release's packages are installed and started on Ubuntu 24.04 (the debs) and Fedora (the rpms) and
checked before the release is drafted, and they differ from the Mac's in three ways:

- They aren't signed.
- Lo can't install its own updates on Linux. It tells you a newer one is out, and you install the
  new package.
- On the Mac, Electron checks Lo's code against a hash as it loads it. On Linux it doesn't.

Each release also has `SHA256SUMS`, the SHA-256 of each of its files. Compare a download's with
`shasum -a 256 <file>` on a Mac or `sha256sum <file>` on Linux. [`SECURITY.md`](SECURITY.md) says
what that shows.

## Updates

Lo checks GitHub Releases for a newer version 30 seconds after it starts, then every 6 hours, and
whenever you ask: "Check for updates" in the command palette (and, on a Mac, the app menu), "Check
now" in Settings, or "Get a newer Lo" on the overview. It asks GitHub alone, and no id of your copy
goes with the request. To stop the checks Lo makes by itself, turn off "Check for updates
automatically" in Settings, or `updates.check` in [`settings.json`](docs/settings.md). A build from
source doesn't check: asked to, it says so, with "Open on GitHub" for Lo's releases.

A newer version shows as a toast, "Lo 0.2.0 is available", above the status bar. It waits until you
act on it and never takes focus. What it offers depends on how Lo was installed:

- **A Mac, with Lo from Homebrew:** Lo doesn't update itself, since Homebrew keeps a record of the
  version it installed. The toast gives the command, `brew upgrade --cask withlo/tap/lo`, with
  "Copy".
- **A Mac, with Lo in Applications** (or `~/Applications`) from a DMG: "Update" downloads the new
  version, checks it against the checksum in the release, and has macOS install it only if the same
  team signed it. Lo then offers "Restart to update", or installs it when you quit. "What's new"
  opens the release's page, and "Hide" hides the toast until Lo starts again or you check for
  updates yourself.
- **A Mac, with Lo anywhere else,** such as the disk image or your Downloads folder: "Move Lo to
  Applications" moves Lo there, asking before it replaces a Lo that's already there. It updates
  itself from there.
- **Linux,** and a Mac where Lo can't write its own folder: "Download update" opens the release's
  page, and you install the new package as you did the old one.

## Build from source

You need git and pnpm 11 or later. pnpm downloads the Node and pnpm versions that `package.json`
pins, and the install sets up the git hooks.

```sh
git clone https://github.com/withlo/lo.git
cd lo
pnpm install
pnpm nx run desktop:dev    # with hot reloading
pnpm nx run desktop:start  # the built app
```

A copy run from source keeps its data apart from an installed Lo's.
[`CONTRIBUTING.md`](CONTRIBUTING.md) has the rest: the checks, where code goes and how changes land.

## Usage

Keys are written as macOS shows them. On Linux, Ctrl takes the place of `⌘`.

### Opening a pull request

- **In Lo:** press `⌘L` and paste a pull request's link, such as
  `https://github.com/owner/repo/pull/123`. In the list of recent pull requests, `⌘V` opens the link
  on the clipboard.
- **From a terminal:** install the `lo` command from the welcome, or with "Install command-line
  tool" in the command palette (on macOS, the app menu has it too). Then run `lo <link>`. The Linux
  packages install the command already.
- **From a link:** Lo opens `lo://` links, such as `lo://github.com/owner/repo/pull/123`. To have
  pull request links you click in other apps open in Lo while your browser stays the default, use a
  link router: [`docs/link-routers.md`](docs/link-routers.md) has rules for Finicky, Velja and
  Choosy. They follow each app's documentation.

Public pull requests open without signing in, read-only. To open private ones, sign in from the
welcome, through GitHub's device flow or by importing your accounts from GitHub CLI. "Welcome to Lo"
in the Help menu and the command palette opens the welcome again.

### Keys and settings

- **`?`** shows every key, wherever you are, and **`⌘⇧P`** opens the command palette, which runs any
  command by name. [`docs/keys.md`](docs/keys.md) lists every key.
- **The keymap file,** `~/.config/lo/keymap`, changes keys. `g ,` opens it, and Lo applies a saved
  change within a second. "The keymap file" in [`docs/keys.md`](docs/keys.md#the-keymap-file)
  describes it.
- **Settings** (`⌘,`) edits `settings.json`, a file beside the keymap file that you can also edit by
  hand. [`docs/settings.md`](docs/settings.md) lists the settings.
- **`app.gpu`** turns off drawing with the graphics card, for a window that stays blank: set
  `"app.gpu": false` in `settings.json` and start Lo again. It's in the file only, since a window
  that draws nothing couldn't reach it in Settings. An installed Lo takes no command-line switches,
  so it refuses `--disable-gpu`.

## Contributing

Open an [issue](https://github.com/withlo/lo/issues) for a bug or an idea. To change Lo, start with
[`CONTRIBUTING.md`](CONTRIBUTING.md): it covers setting up, the checks, where code goes and how
changes land. [`AGENTS.md`](AGENTS.md) holds the working rules in full, and the same rules apply to
people and to coding agents.

The docs:

- [`docs/design.md`](docs/design.md): what Lo does and how it's built.
- [`docs/keys.md`](docs/keys.md): every key, and the keymap file.
- [`CONTRIBUTING.md`](CONTRIBUTING.md): setting up, the checks, and how changes land.
- [`design/README.md`](design/README.md): the design system's rules.
- [`brand/README.md`](brand/README.md): the mark, colors, type and motion.
- [`SECURITY.md`](SECURITY.md): reporting a security problem, and how releases are signed and
  checked.

## Security

Please report a security problem privately, as [`SECURITY.md`](SECURITY.md) describes, not in a
public issue.

## License

Lo is free software under the [GNU General Public License v3.0](LICENSE). Its About panel says so,
and "Show licenses", in the command palette, opens the licenses of everything Lo ships.

The overview skill (`skill/`) and the artifact format with the Markdown parser it builds on
(`packages/core/artifact` and `packages/core/markdown`) are under the MIT license, so teams can copy
them into their own repos and other tools can read overviews. Each of those folders carries its own
`LICENSE`.
