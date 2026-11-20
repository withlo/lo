# Security

## Reporting a problem

Please don't report a security problem in a public issue. Report it privately, through GitHub's
private vulnerability reporting: the "Report a vulnerability" button on this repository's
[Security tab](https://github.com/withlo/lo/security), which opens a
[private advisory](https://github.com/withlo/lo/security/advisories/new) that only you and the
maintainers can see.

Say what you found, how to reproduce it, and what it lets someone do. A pull request or repository
that shows it helps most.

The latest release is the supported version. A fix lands on `main` and comes out in a new release,
and older releases don't get one.

## In scope

Lo signs in to GitHub, copies other people's repositories and shows their code, so these matter
most:

- **Tokens.** How Lo stores GitHub tokens (encrypted, with the key in the system keychain), hands
  them to git, and sends them to GitHub. A token reaching any other host, a log, any other file, a
  process's arguments or Lo's window is a bug.
- **Running a repository's code.** Lo never installs dependencies or runs build steps, and runs
  language servers only on repositories you trust, and on a pull request from a fork only if you
  trust that pull request. A pull request that gets Lo to run its code without that trust is a bug:
  through a language server, a repository's own settings or tasks files, its git config or
  attributes, or anything else Lo reads from it.
- **Writes to GitHub.** Lo writes to GitHub only to review and merge, and to change a pull request's
  base branch to form a stack. Anything that gets it to write more, or to act as a different account
  than the one shown, is a bug.
- **Other hosts.** Lo talks only to GitHub and to language servers' official download sources. A
  request to any other host is a bug.
- **Updates.** Lo takes an update only from the releases of `withlo/lo` on GitHub, and on a Mac
  installs one only if the same team signed it. An update from anywhere else, one that installs
  without that signature, or one that downloads or restarts Lo without your press is a bug.
- **Content from GitHub.** Markdown, images, overviews and other content from a pull request that
  can do more than display: run a script, navigate Lo's window, or reach Node or the file system.

## Out of scope

- Code a language server runs on a pull request you chose to trust, such as rust-analyzer running
  cargo in a trusted repository's checkout. Trusting a repository or a pull request means you'd run
  its code.
- Problems in Electron itself. Report those to
  [Electron](https://github.com/electron/electron/security), and tell us if Lo is affected.
- Problems in GitHub itself. Report those through [GitHub's bug bounty](https://bounty.github.com).

## How releases are signed and checked

A maintainer pushes a version tag, the `release` workflow builds Lo from it on GitHub's runners and
drafts a release, and a maintainer reads the draft and publishes it. "Releasing" in
[`AGENTS.md`](AGENTS.md#releasing) describes the workflow.

- **On the Mac,** the `mac` job is the only one that reads the signing secrets. It runs in the
  `release` environment, which waits for a maintainer's approval and takes only version tags. Lo and
  its helpers are signed with a Developer ID, with the hardened runtime and a secure timestamp, and
  notarized by Apple, and the app has its ticket stapled. The DMGs are signed and notarized but not
  stapled, so Gatekeeper finds their ticket online.
- **Every file is checked before a release is drafted.** `scripts/check-package.sh` checks each of
  the four Mac files: the Developer ID and its team, Gatekeeper's verdict, the stapled ticket, the
  entitlements, the fuses that turn off the debugger, `NODE_OPTIONS` and `ELECTRON_RUN_AS_NODE`, and
  what's in the asar and its hash. `scripts/check-linux.sh` installs and checks each of the four
  Linux packages. Both start Lo and check that it refuses command-line switches and the variables
  that would write out its traffic. A release with a file that fails isn't drafted, and the job that
  drafts it holds no signing secret.
- **`SHA256SUMS`** lists the SHA-256 of every file in the release. It's published beside them, so it
  shows that a download is the file the release lists, not that the release is genuine: on the Mac,
  the signature and notarization show that.
- **Updates** come from GitHub's release hosts alone. On a Mac, Lo checks the zip it downloads
  against the SHA-512 in the release's `latest-mac.yml`, and Squirrel.Mac, which Electron's updater
  uses there, installs it only if the same team signed it as signed the running Lo. Nothing
  downloads until you press "Install", Lo restarts only when you press "Restart now", and it never
  installs an older version. Where Lo can't install, as on Linux, it says a newer version is out and
  links the release's page.

## Known limits

- **git comes from `PATH`.** Lo runs the newest git it finds among Apple's, the ones on its `PATH`
  and the system's usual folders, passing over one that anyone but you or root could change. So
  whoever controls the `PATH` Lo starts with picks the git that gets your token when Lo fetches.
- **Language servers aren't sandboxed.** They run with your rights, in an environment Lo builds, and
  read what you can read, inside the repository and out. Lo starts them only on repositories you
  trust.
- **The Linux packages aren't signed.** Only `SHA256SUMS`, published beside them, vouches for them.
- **The Linux packages have no asar integrity check.** On the Mac, Electron checks the hash of Lo's
  code, its asar, as it loads. It doesn't on Linux, so a change to `/opt/Lo/resources/app.asar`,
  which only root can write, isn't noticed.
- **The Linux packages install an AppArmor profile.** Where AppArmor runs and takes it, as on Ubuntu
  24.04 and later, `/etc/apparmor.d/lo` lets `/opt/Lo/lo` create user namespaces, which those
  releases withhold from programs without a profile. It confines nothing else, and it applies to
  what Lo starts too, so git and language servers can create them as well.
- **The Linux packages hold a setuid helper.** `/opt/Lo/chrome-sandbox` is Chromium's sandbox
  helper, setuid root as in Chrome's own packages, so that Lo's pages stay sandboxed where
  unprivileged user namespaces are off.
