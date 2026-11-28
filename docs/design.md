# Lo design

## 1. Overview and scope

Lo (as in "lo and behold") is a desktop app for reviewing GitHub pull requests. It's for people who
read far more code than they write, such as someone reviewing the PRs their coding agents open. It
talks to GitHub directly and has no backend of its own.

### Where it beats GitHub's web UI

- **Overviews.** A PR can carry an overview: an explanation a coding agent wrote, with definitions,
  diagrams and walkthroughs tied to the real code. Lo opens it before the diff.
- **The whole repo.** The file tree shows changed files among their unchanged neighbors.
- **Stacks.** Any chain of PRs is a stack: native GitHub stacks, chains of base branches, and PRs
  that contain another PR's commits. Stacks show as a tree, you review them layer by layer, and a
  GitHub stack merges in one request, where other chains merge a layer at a time.
- **Diffs.** Side by side by default, with moved-code detection and rebase-aware "changes since my
  last review".
- **Code.** Syntax-based navigation everywhere, plus types, hovers and exact references from
  language servers on repos you trust.
- **Merging.** Approve and ship on one key, a clear "why can't this merge" panel, and full merge
  queue support.

### Principles

- **Read-only.** Lo never edits files or pushes commits. It writes to GitHub only to review and
  merge: comments and their attachments, reviews, viewed marks, merges, queue and auto-merge
  changes, and changing a PR's base branch to form a stack or to merge a chain.
- **No AI inside Lo.** Lo calls no model and runs no agent. It displays what agents write elsewhere.
- **No backend, no telemetry.** Lo talks only to GitHub and to language servers' official download
  sources. Updates come from GitHub Releases.
- **Never runs a repo's code.** No dependency installs or build steps. Language servers run only on
  repos you trust, and overviews contain no scripts.
- **Keyboard first.** Every action has a key.

### Scope

- **v1:** everything above, plus several GitHub accounts, opening PRs from links, comments and
  reviews, and the full conversation timeline.
- **Later:** a syntax-aware diff view, agent-written widgets in overviews, a web viewer for
  overviews, a cross-repo inbox, reactions, @-mention autocomplete, a browser extension, dependency
  types, GitHub Enterprise, Windows and a mobile app.
- **Never:** editing code, applying suggestions (that's a commit), a Lo backend.

### Platforms and license

v1 ships for the Mac as a signed, notarized download, a DMG and a zip each for Apple silicon
(`arm64`) and for Intel (`x64`), and a Homebrew cask, with Linux builds published as a preview in
deb and rpm packages, each for `x64` and `arm64`. The Linux packages are unsigned and Lo doesn't
install its own updates there. It skips the Mac App Store, whose rules forbid downloading and
running code, which language servers need.

The app is open source under GPL-3.0. The overview skill and the artifact format are MIT, so teams
can copy them into their repos and other tools can read artifacts. Lo shows its license where
GPL-3.0 asks an interface to: the system's About panel names its copyright, says it has no warranty
and may be redistributed under the license, and says where the source is. "Open licenses" opens
`licenses.txt`, which holds Lo's own license and the license of every package and file Lo bundles,
and says where Electron's and Chromium's are, installed beside it. The build fails on a bundled
package with no license, or one GPL-3.0 can't carry.

## 2. Architecture

Lo is an Electron app written in TypeScript. Its interface is built with React, styled with Tailwind
CSS and bundled with Vite, and every code view is a CodeMirror 6 editor: the diff, the whole-file
view, the peek and the comment box.

### Packages

The repo is a pnpm workspace, and a package's folder says where it runs. The core packages, in
`packages/core/`, hold Lo's logic and run anywhere, so a mobile app or a web viewer can reuse them
later. They follow four rules:

- they make network calls with `fetch`;
- storage and secrets are passed in by whatever runs them;
- they never touch git, the file system, child processes, Node or Electron;
- they depend only on other core packages.

The desktop packages, in `packages/desktop/`, run only in the desktop app. The app itself is in
`apps/desktop/`, and the overview skill and its checker are in `skill/`. A check in CI enforces
these rules.

| Package    | Does                                                                                                       | Runs                        |
| ---------- | ---------------------------------------------------------------------------------------------------------- | --------------------------- |
| `github`   | Sign-in and renewal, accounts, Lo's own `fetch` client for GraphQL and REST, rate limits, polling          | Anywhere                    |
| `review`   | The PR model: revisions, comparisons, viewed marks, threads, the pending review, merge rules, review order | Anywhere                    |
| `stacks`   | Finding stacks, the stack tree, turning chains into GitHub stacks                                          | Anywhere                    |
| `diff`     | Line and word diffs, and moved-code detection                                                              | Anywhere                    |
| `markdown` | GitHub's Markdown and HTML, turned into a sanitized tree (MIT)                                             | Anywhere                    |
| `artifact` | The artifact format: its parser and checks (MIT)                                                           | Anywhere                    |
| `checker`  | The checker's command line, published to npm (MIT)                                                         | Node                        |
| `git`      | Partial clones, fetching PR commits and artifact refs, checkouts                                           | Desktop, main process       |
| `syntax`   | Highlighting, and the syntax index's tags and ranking, built with tree-sitter                              | Desktop, background or main |
| `lsp`      | Downloading language servers and their toolchains, and starting, feeding and stopping the servers          | Desktop, main process       |
| `ui`       | Lo's React components and CodeMirror extensions                                                            | Desktop, window             |
| `desktop`  | The Electron app: processes, windows, menus, settings, updates                                             | Desktop                     |

The overview skill uses `checker`, which lives beside it.

### Styling

Tailwind CSS styles everything React renders, on a theme generated from Lo's design tokens with
Tailwind's own colors and sizes switched off, so only Lo's tokens exist. Plain CSS covers what
Tailwind can't reach: the token variables and themes, CodeMirror's theme and decorations, and the
overview's article. Menus, dialogs, popovers, tooltips, tabs and the palette's list come from Base
UI. The design system's rules, tokens and plain CSS are in `design/`.

### Languages

Highlighting and the syntax index both use tree-sitter grammars compiled to WebAssembly, parsed in
the background process. One set of grammars covers highlighting, navigation and, later, the
syntax-aware diff. A small bridge turns tree-sitter's output into CodeMirror highlighting.

### Processes

- **Main process.** It holds the GitHub tokens, makes every GitHub call and owns the database and
  the syntax index's store. It starts git and language servers as child processes and speaks the
  protocol with the servers itself.
- **Window.** It draws the interface in a sandbox with no access to Node or the file system. It asks
  the main process for data through a small, typed set of messages, and it never sees a token.
- **Background process.** Parsing and highlighting, the syntax index, diffs and moved-code
  detection, and Markdown and artifact parsing run in one background process, each job with a time
  limit. The main process restarts it when its memory passes a cap, so a hostile file can't freeze
  Lo or exhaust its memory. It gets no tokens: the main process reads git and hands it file
  contents, and the window gets its results directly. Main sends it work of its own too, for the
  syntax index's parsing, in a queue behind the window's: those jobs run one at a time, so the index
  never slows what you asked for.

### Untrusted content

Everything a PR contains is untrusted: code, Markdown, images and artifacts.

- **Scripts.** The window loads only Lo's own files, and a content security policy blocks every
  other script.
- **Markdown and SVG** are sanitized before they're shown.
- **Images** load only through the main process, and only from GitHub's image hosts. Main adds the
  account's token only for an attachment's address on github.com, which needs it in private repos;
  the signed and proxied addresses GitHub renders need none. An image fetched as one account is
  shown only to tabs acting as that account.
- **Links** open only web addresses, in your default browser. The window can't navigate away or open
  new windows.

### Local data

- **Database.** A SQLite file holds cached PR data, "last seen" revisions, the account to use per
  owner, recent PRs, unsent comment text and the repos Lo has offered to trust once.
- **Settings file.** `settings.json` in `~/.config/lo/` holds the settings, among them which repos
  and PRs you trust to run language servers. The window shows that list but can't write it: only the
  main process does. It adds an entry only once its own dialog says "Trust", and the window can ask
  it to take one out.
- **Tokens** are encrypted with a key kept in the system keychain, and stored in the database, one
  per account. On Linux that's a keyring, such as GNOME Keyring or KWallet: when none answers, Lo
  asks for one rather than keep a token as good as unencrypted.
- **Repo copies.** Each repo gets a bare partial clone in Lo's cache folder. On a Mac that's the
  folder macOS keeps for the user's caches outside the home folder (`/var/folders/…/C/Lo`), so no
  settings a tool reads from the folders above its own, such as `~/.cargo/config.toml`, reach the
  language servers Lo runs there. The servers and toolchains Lo downloads, and the syntax index's
  store, are in that folder too.

### Per-system code

The keychain, link handling, menus and key modifiers sit behind small interfaces, with a Mac and a
Linux implementation of each.

### Updates

Lo checks the releases of `withlo/lo` on GitHub, and nothing else: 30 s after its window is up,
every 6 hours, and whenever it's asked, from Settings, the command palette, the app menu or the
overview's "Get a newer Lo". The `updates.check` setting turns off the timed checks only. Only a
packaged Lo that carries an `app-update.yml`, which only a release build writes, checks, so a build
run from source and a zip made from a branch never do, and no id of the copy goes with a check. Lo
offers a version only if it's newer than itself, and a release is never offered a prerelease.

The offer is a toast that waits until it's acted on and never takes focus. It shows the first line
of the release's notes as plain text, and "What's new" opens the release's page, whose address Lo
builds from the version, never from the feed. How a copy takes a newer version is decided from where
it runs, as it starts and again for each offer:

- **Lo installs it,** on a Mac, from an Applications folder it can write. Nothing downloads until
  you press "Update". The release's zip has its SHA-512 checked against `latest-mac.yml`, then goes
  to Squirrel.Mac, which installs it only if it's signed by the running Lo's team and bundle ID. It
  installs when Lo quits, or when you press "Restart to update", which quits Lo as any quit does, so
  each feature stops first.
- **Homebrew updates it,** where Lo is in an Applications folder and Homebrew keeps a `lo` cask
  (`/opt/homebrew/Caskroom/lo` or `/usr/local/Caskroom/lo` exists). Lo never replaces such a copy,
  which would leave Homebrew's record of it wrong. The toast gives
  `brew upgrade --cask withlo/tap/lo`, with a "Copy" button, and "What's new" and "Hide".
- **Lo moves first,** on a Mac, from the disk image, a translocated download or any folder but an
  Applications one. "Move Lo to Applications" moves it there and starts it from there, asking before
  it replaces a Lo that's already there.
- **Lo tells you and links the release page,** on Linux, and on a Mac where Lo can't write its own
  folder. "Download update" opens the page, and you install the new package or app yourself: Lo
  never runs a package manager.

### Build order

The core packages and the app's shell don't depend on the code view, so they can be built first. The
diff view is proven before anything else is built on CodeMirror: it must hold up on a large real PR,
with review threads on both sides, hundreds of files in one scroll and Vim keys. If CodeMirror can't
hold up there, the diff falls back to a read-only renderer, and CodeMirror stays for comment boxes
and the whole-file view.

## 3. GitHub, git and accounts

### Sign-in

- **Accounts.** Each account signs in through GitHub's device flow: Lo shows a code and opens
  GitHub's sign-in page. Lo can also import accounts from the `gh` CLI.
- **Renewal.** Tokens expire, and Lo renews them by itself. If GitHub refuses a renewal, that
  account is signed out and the others keep working.
- **Scopes.** Lo asks for `repo` (read and review private repos, and merge), `read:org` (team review
  requests and code owner teams) and `workflow` (GitHub refuses to merge a PR that changes
  `.github/workflows` without it).
- **Which account.** A PR opens with the account that can see its repo. If several can, Lo asks once
  per owner and remembers the answer.
- **Blocked by an org.** If an organization blocks third-party apps, Lo shows GitHub's link to
  request approval.

### GitHub API

- **GraphQL** covers PRs, files, reviews, threads, viewed marks, the timeline, stack membership and
  the merge queue.
- **REST** covers the Stacks API, async merges, a branch's rules, commit comparisons, repo trees and
  refs.
- **Client.** Lo makes both through its own small client on `fetch`, typed from GitHub's published
  REST description and GraphQL schema, with one client per account.
- **Polling.** The open PR is checked every 10 seconds while Lo is in front, and every 20 while it's
  on screen behind another window, as beside a browser; its merge queue every 20 seconds. Everything
  else is checked less often, and everything slows to every 5 minutes while Lo is off screen:
  minimized, hidden or behind a locked screen. Each poll asks first whether anything changed, and
  only then fetches the details. REST calls use ETags, so unchanged answers don't count against the
  rate limit.
- **Rate limit.** Lo tracks how much of the limit is left, slows polling when it runs low and tells
  you when it does.
- **Refresh.** `⌘R`, or `F5`, reads the tab on screen again at once, whatever the interval: a PR's
  details and checks, then what its view on screen shows, then the rest of what the tab shows, its
  stack's list included, and it shows the newest push; a merge queue's tab reads its queue. Its
  requests wait their turn and for the rate limit as polls do, and the tab's mark in the strip turns
  until they're in, and for 400 ms at least, so a quick answer still shows it.

### The local copy

- **What it fetches.** Each repo gets a bare partial clone. Lo fetches PR heads
  (`refs/pull/<n>/head`, including PRs from forks) and base branches as it needs them. It keeps
  every revision it has fetched under its own refs, so force-pushed commits survive.
- **Overviews don't come through it.** Lo reads each PR's artifact ref (`refs/lo/pr/<n>`) through
  GitHub's REST API, with or without git: it watches the ref with ETags, then reads the tree of the
  commit it holds, by the commit's ID, the artifact's files by their IDs, and the commit, for who
  wrote it, and keeps them so an overview shows at once, offline too, and before a tab opened again
  knows which account it acts as. As a tab opens, these reads go ahead of polls, in one turn of the
  account's queue: the ref, the tree, the text, the first figures it names and the commit. The code
  an overview shows comes from the local copy.
- **The repo's definitions come the same way.** Lo watches `refs/lo/terms` in the base repo with
  ETags, and for a commit it hasn't read, reads the top of its tree and `terms.json` by its ID,
  never one larger than the store may be. It reads them only for a tab with an overview to show, in
  a turn after the overview's read, so the overview never waits for them: as the tab is shown, if
  they weren't read in the last 30 s, and every 5 minutes while it's on screen. One read serves
  every tab of the repo that acts as the same account. What's read is kept for 30 days after its
  last read, up to 16 MiB of files in all.
- **Sign-in.** Git signs in with the account's token, and your git config is never touched.
- **Checkouts.** Trusted repos get a checkout at the PR head for language servers. The old side is
  read straight from git.
- **Before the copy is ready.** Lo shows GitHub's own diff, builds the file tree from GitHub's API
  and shows the overview. A stack's layer shows GitHub's comparison with the layer below instead,
  which lists 300 files at most. When GitHub can't compare them, the layer shows its own pull
  request's files, and the status bar says the layers below are included. Whole-file context,
  navigation and rebase-aware comparison turn on when the copy arrives, with progress shown.
- **Cleanup.** Settings shows how much space the cache uses and can clear it. Repos unused for 30
  days are removed, with their checkouts and what their language servers keep. The cache also has a
  size cap, 10 GB by default and changeable in Settings, which counts all of it but the toolchains
  language servers use. Past it, checkouts and what language servers keep go first, least recently
  used first, since Lo gets them back without a fetch, then the least recently used copies, each
  only while the cache is still over. Nothing of a repo that's open or that a language server runs
  on goes, and its checkouts and what its language servers keep don't count toward removing anything
  else.

### When git is missing

If git isn't installed or is too old, Lo says so when it starts, with how to install it and a "Check
again" button that finds git without restarting Lo. Until then, PRs open with GitHub's diff, the
file tree and the overview, and nothing that needs the local copy.

## 4. Stacks

### What makes a stack

PR B sits on PR A when any of these is true. When more than one is, the first in the list wins.

1. **GitHub stack.** GitHub says they're adjacent layers of a native stack.
2. **Base branch.** B's base branch is A's head branch.
3. **Shared commits.** B contains A's latest commit. If B contains several open PRs' commits, its
   parent is the nearest one: the PR whose latest commit is closest to B's.

A base branch with no PR, such as `feature-x`, is the stack's root, just like `main`. A PR can have
several children, so a stack is a tree, with children in the order they were opened.

### Finding stacks

When you open a PR, Lo loads its repo's open PRs, with their branches and recent commits, in a few
GraphQL pages. It builds the stack graph from that and refreshes it as it polls.

### Layer diffs

- **One layer.** Each layer is compared against the layer below it, not the stack's root, using the
  local copy of the repo. Until the copy is ready, the diff is GitHub's comparison of the two
  commits. A layer on its base branch, such as a GitHub stack's, already starts there, so its diff
  is GitHub's own.
- **Several layers.** Any run of layers, each sitting on the one before, can be viewed as one diff,
  from where its bottom layer's changes start to its top layer's head, and so can the stack from its
  bottom up to any layer. A run is chosen in the stack tree, and opens on its diff in a view of its
  own, with a bar that names its layers and goes back to the layer it was chosen from, as `Esc`
  does. The diff's note names the run's ends ("Every change, #4819 → #4821"), and the tab names its
  top layer, as the heading does, since a run's diff ends at its head. A run marks no file viewed,
  compares no revisions and has no overview, since each of those is a layer's own. It isn't restored
  after a restart. When GitHub can't compare a run from where its bottom layer starts, the bar says
  only the top layer's pull request shows, and that the local copy's diff replaces it once it's
  ready, without the run's branches and file count, which describe the run.
- **After a merge.** When a lower layer is squash-merged, the layer above is compared against the
  merged layer's last commit. Changes that already landed stay hidden, and the layer is marked
  "needs rebase." A layer that needs a rebase shows its stack even when it's the only layer left.
- **Found late.** When Lo knows the stack before the diff is drawn, the diff starts at the right
  place. When it learns where a layer starts only after the diff is on screen, the diff stays as it
  is, and a banner offers the change: "#4821's diff includes #4819's changes" with "Show only
  #4821's". The button reloads the diff from there, as loading a newer push does. The banner goes
  once the diff on screen starts where it offers, or once it's dismissed: for that layer, or for all
  stacks, which Settings › Pull requests turns back on.

### The stack tree

The tree sits at the top of the left panel, above the files, whenever the PR on screen is in a
stack, and only then. A PR alone shows its stack of one when it needs a rebase, to say why. Its head
says how many layers there are and how they were found: "GitHub stack · 4 layers" when every layer
is in one GitHub stack, and otherwise each kind of link between them, in the order above, such as "4
layers · by base branch and shared commits". GitHub stacks can't branch, so a tree that branches can
hold a GitHub stack along one path and other layers off it: "4 layers · by GitHub stack and base
branch", with a note under the rows for each GitHub stack in it, naming its layers: "#4790, #4797
and #4803 are a GitHub stack." Each layer shows its title, number, author, review state, the state
of its checks, its place in the merge queue, any "needs rebase" mark, whether it has an overview,
how many of its files you've viewed (for the layer on screen, of the files its diff shows), and how
many of its review threads are unresolved (for the layer on screen, as its threads panel counts
them, and for the others, of the first 100 threads GitHub lists, with a plus when there are more).
The tree scrolls when the stack is longer than its share of the panel, and keeps the layer on
screen, or the one the keyboard moved to, in view as they change and as the space around the tree
does, unless you've scrolled the tree yourself since: then it stays where you left it until another
layer is shown. `]s` and `[s` walk the tree from top to bottom, finishing one branch before starting
the next, and stop at either end. Showing a layer isn't a jump, so `⌃o` doesn't go back to the one
before. A link to any layer opens the whole stack in one tab, at that layer, and each layer keeps
its own place.

### Turning chains into GitHub stacks

"Make this a GitHub stack" lists what will change and asks before doing anything:

1. Any PR found through shared commits gets its base branch pointed at the head branch of the PR
   below it.
2. Lo creates the stack through the Stacks API, from the bottom PR to the top.

GitHub stacks can't branch, so for a tree Lo converts the path through the layer you're on. The
option isn't offered when a PR comes from a fork, when GitHub's Stacks API isn't there for the repo
(it answers 404; github.com has no setting that turns stacks on), or when a PR is already in a merge
queue. The tree offers it in a line over its rows, and the merge panel in a box over its methods,
for a chain it merges only once it's a GitHub stack. Either can be dismissed for that stack, or for
all stacks, which Settings › Pull requests turns back on, and a dismissal in one place takes both;
`gS` and the layer's menu still convert it. Dismissing the offer to convert a branch stack leaves
the offer to add layers to the GitHub stack below them, which the stack may come to need.

## 5. The file tree

The left panel shows the repo's files as a tree, at the commit on screen. Its edge drags to widen or
narrow it, between 220 and 480 px, and `>` and `<` do the same while it has focus, a step at a time;
a double-click on the edge, or `=`, puts it back to 300 px. `Esc` during a drag puts back the width
it had. Let go near the window's side, the edge closes the panel. `⌘\` or the button at the start of
the header's cluster opens and closes it. Whether it's open, and its width, are the window's, the
same in every tab, and kept when Lo restarts.

### What it shows

- **The whole repo.** Folders that contain changes start open, and the rest start closed. A closed
  folder shows how many changed files it holds.
- **Changed files** carry their marks: added, modified, deleted or renamed, plus viewed state and
  comment counts.
  - A deleted file appears where it used to be.
  - A renamed file appears at its new path and names its old one.
  - Generated files and lockfiles are marked as generated.
- **Unchanged neighbors** are dimmed.
- **Compact folders.** A chain of folders with one child each, such as `src/api/handlers`, shows on
  one line.
- **Changed only.** One key filters the tree down to changed files, still as a tree.

### Modes

- **Tree and review order.** The tree is the default. One key switches to review order: a flat list
  with each source file followed by its tests (matched by name, such as `foo.ts` and `foo.test.ts`,
  `foo_test.go` or `test_foo.py`), then config (JSON, YAML and TOML files, dotfiles and `.github/`),
  then generated files. The diff scrolls in the order the panel shows.
- **Comparing two revisions.** The tree highlights only the files that changed between them.
- **Stacks.** The tree shows the changes of the layer on screen, or of every layer in view when
  several are shown as one diff.

### Using it

- **Changed files.** Selecting one scrolls the diff to it. As the diff scrolls, the tree follows and
  highlights the file on screen.
- **Unchanged files.** Selecting one opens it read-only in the whole-file view, and `⌃o` returns to
  where you were.
- **Finding files.** `⌘P` finds any file in the repo, with changed files listed first.

### Where it comes from

The tree is read from the local copy, or from GitHub's API until the copy is ready. In very large
repos, a folder's contents load when it's opened.

## 6. Diffs

### The diff view

Each file is a CodeMirror side-by-side diff, and all files sit in one scroll, in the order the left
panel shows. Lo computes the diff itself, so the same view shows GitHub's diff, the local diff,
rebase-aware comparisons and moved code. Both sides stay aligned, including around review threads.

- **Layout.** Side-by-side by default. `⇥` switches sides, and one key switches to inline. The seam
  between the sides drags to share the width between them, and `>`, `<` and `=` widen, narrow and
  even the side the cursor is on. The share is the window's, kept for every diff and across
  restarts. Each side keeps at least 240 px or a quarter of the diff, and a diff 480 px wide splits
  evenly. A narrower one draws inline, keeping the layout chosen, and side by side again as soon as
  it's 480 px, the line at the top of the screen staying where it is; meanwhile Side by side and
  Inline both refuse, saying to widen the window first: the menu dims them and the palette leaves
  them out. As the sides change width, the first row under the file's header stays where it is, and
  the rows stay level.
- **Changes.** Changed words are highlighted within changed lines.
- **Context.** Unchanged code is collapsed and expands in place. One key shows the whole file.
- **Whitespace.** Whitespace changes are shown, and a key hides them.
- **Renames.** A renamed file shows as a rename, with any changes to its contents.
- **Generated files.** Files the repo's `.gitattributes` marks `linguist-generated`, and common
  lockfiles (`pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`, `Cargo.lock`, `go.sum`, `uv.lock`,
  `poetry.lock`, `Gemfile.lock` and others), start collapsed.
- **Binary files.** Images show before and after, side by side. Other binary files just say "binary
  file changed."
- **Very large files.** Files with more than 5,000 changed lines start collapsed and load on a key.

### Moved code

A block of at least 3 non-blank lines that's deleted in one place and added in another shows as a
move, within a file or across files in the PR. Changes in indentation don't count. Both ends link to
each other ("moved from `api/user.ts:40`"), and only edits inside the block are highlighted.

### Overview markers

Lines the overview explains carry a marker beside them, in a lane of their own last before the new
code; the old side has none, since an overview explains new lines. Opening it shows the explanation
in place, with its code, emphasis and lists drawn as the overview draws them, cut at 600 characters,
and a link to that point in the overview.

## 7. Revisions and viewed files

### Revisions

Each push to a PR's branch is a revision, numbered r1, r2 and so on, taken from the PR's timeline of
pushed commits and force-pushes. A revision's base is where its head branched off the base branch.

- **Picker.** Compare any two revisions. Two markers show where you left off: "your last review"
  (the commit your latest review was made on) and "last seen here" (the newest revision on screen
  when you last left the PR, saved on this computer only).
- **Default.** Lo compares the more recent of those two markers with the latest revision. With
  neither marker, it shows the full diff. If nothing changed since the marker, it shows the full
  diff with a note: "Nothing new since r4."
- **Tree.** When comparing two revisions, the tree highlights only the files that changed between
  them.
- **Overview.** The picker marks the revision the overview was written for.

### Rebase-aware comparison

When the base moved between two revisions, Lo replays the older revision's changes onto the newer
base in its local copy (`git merge-tree`). It then compares the result with the newer revision, so
only the author's changes show. If the replay conflicts, Lo falls back to a plain comparison and
says so. The same applies to a stacked layer when the layer below it gets a new push.

### Viewed marks

- **GitHub's marks.** Lo reads and sets GitHub's own per-file viewed marks, so they match the web UI
  and other computers. Each PR in a stack has its own marks.
- **The count.** "Viewed" counts the files of the PR, or of the layer's own diff when it starts
  above the PR's base, and comparing revisions doesn't change it: files that only changed between
  two revisions aren't in it. A layer's own files are good for the head and start they were listed
  at: after a push or a new start, GitHub's count shows until they're listed again.
- **Changed since viewed.** When a push changes a viewed file, GitHub resets it to "changed since
  viewed." Lo remembers, on this computer, the revision at which you marked each file viewed, and
  opens the file to what changed since then. For a file marked viewed elsewhere, it shows what
  changed since your last review instead.
- **Keys.** `e` marks a file viewed and moves to the next unviewed file. Pressing it again on a
  viewed file clears the mark. A count marks that many and clears none: `3e` marks three files
  viewed, from this one on.

## 8. Overviews

An overview is an explanation of a PR, written by a coding agent and shown in Lo. The file the agent
writes is called an artifact.

### Who writes one

- **Any coding agent with push access,** using the overview skill. It can be the agent that opened
  the PR, or one you asked to explain someone else's.
- **Never Lo.** When a PR has no overview, Lo offers a prompt to copy into an agent.
- **Shown with every overview:** who pushed it, when, and the commit it describes.

### Where it lives

- **In a ref, not a branch:** `refs/lo/pr/<number>` in the PR's repo. A ref outside `refs/heads`
  never shows in GitHub's branch list, isn't cloned by default and isn't subject to branch rules. It
  holds `artifact.md` and a `figures/` folder.
- **One per PR.** Each rewrite is a new commit on the ref and replaces the last for everyone. Lo
  shows the latest.
- **Forks.** Lo looks in the base repo, then the PR's fork, then, for a PR from a fork, the base
  repo's copy of the fork's overview (`refs/lo/kept/pr/<n>`), which outlives the fork, and labels an
  overview that came from the fork or the copy.
- **Closed PRs.** Lo's cache never drops a closed PR's overview to make room, and doesn't count its
  files toward its cap. Once GitHub has none anywhere, Lo shows the one it kept, labelled a saved
  copy.
- **Stacks.** Each layer has its own.

### The format

`artifact.md` is Markdown with a short header (the format version, the PR and the commit it
describes) and these blocks:

| Block          | The agent writes                                                              | Lo shows                                                         |
| -------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Term           | A term, defined once in the glossary                                          | A hover definition on every use                                  |
| Code           | A file and a line range                                                       | The real code at that commit, as a diff, with its review threads |
| Figure         | An SVG or image file, with parts optionally linked to code, terms or sections | The figure, sanitized, with clickable parts                      |
| Walkthrough    | Ordered steps, each with text and a code range                                | A stepper with a code view that follows                          |
| Tabs and folds | Titled content                                                                | Tabs and collapsed sections                                      |
| Glossary       | Each term and its definition                                                  | A list at the end                                                |

- **Behavior belongs to Lo.** The agent supplies content, and Lo's own components make it respond.
  An artifact holds no scripts.
- **Figures** are SVG, PNG, JPEG, GIF or WebP files in `figures/`. SVGs use Lo's named colors, so
  they follow light and dark.
- **Illustrations.** A plain fenced code block is shown labeled as an illustration, not real code.
- **Never shown:** raw HTML, and images from other servers, which would reveal the reader's address.
- **Size.** Lo refuses an artifact over 50 MB in total.
- **Versions.** If an artifact uses a newer format than Lo knows, Lo says it needs an update.

### What an overview contains

With no customization, an overview has five parts:

1. **tl;dr.** What the PR does and why. Always required.
2. **How it works.** Prose and code blocks, with a walkthrough or figure where the change has a flow
   worth drawing.
3. **Where to look.** The risky parts and judgment calls, each linked to its code.
4. **How it was checked.** The tests and manual checks behind the change.
5. **Glossary.** Every defined term.

A repo's or a user's instructions can drop, add or reorder everything except the tl;dr.

### Links between the overview and the code

- **Code blocks are real code.** Lo fills each one in from the repo at the overview's commit, so it
  can't misquote the PR. A block may point at changed lines, unchanged lines, or a file the PR
  doesn't touch.
- **Threads on a block.** A code block shows the review threads on its lines at the overview's
  commit as the diff shows its own (section 10): beside its lines, each a mark in the thread lane
  that opens over the code in a popover, or between lines, under the line each is on, as Settings
  says. The popover is the overview's, over its blocks, so no block cuts it off, and there's one:
  one opened in a block closes another's, and while one is pinned, no mark previews. The pointer
  resting on a mark previews it, and a click or `⏎` on its line pins it, its card drawn ahead as the
  cursor comes to the line. Its keys are the diff popover's, but `]t` and `[t`, which move between
  the diff's threads, say to go to the diff first. An out-of-date overview's blocks show only the
  threads on that commit's lines. `c` on a block, or on lines of its code, writes a comment on them,
  in the same box as the diff's, where its threads show: beside lines in the popover, under their
  last line, and between lines under them. Beside lines, Reply and Edit in a block's popover, by
  key, button or menu, write there too, in its thread, with the same held send, and a box closed
  with words in it is a mark beside its lines, or the dot on its thread's, as in the diff (section
  10). A box opened on a block is the block's: one open for the same comment in the diff comes to
  the block, and while it's in the diff, the block's popover still offers Reply and shows the
  comment. Between lines, or where the block can't draw the box, Reply and Edit from a block write
  in the diff while it's on screen, as with the code beside, and otherwise say to go to the diff
  first and open nothing. An edit opens nothing if the reader moved on while its text was read, and
  keeps no draft. A new comment is an ordinary review comment on those lines at the head, where
  they're there unchanged and in the diff. Otherwise it goes on the file when the PR changes or
  deletes it, and on the PR itself when it doesn't touch the file. The box says where the comment
  goes and why: GitHub takes line comments only in the diff, the lines changed after the overview's
  revision, or Lo can't tell where they are now. Once sent, a comment that won't show under the
  block says where it went. A comment on the PR itself is posted at once, since it joins no review.
  A draft keeps the block it was written from, and reopens there after a restart while the overview
  still has that block; otherwise it opens where it would have without one, in the diff for lines
  and files, and in the timeline's box for the PR. A draft opens in one box only, and an open box
  keeps its draft, whatever the overview does. When the diff is drawn again without your asking, as
  once the local copy's files replace GitHub's, a box open there comes back as it was, in the same
  mode with the same caret and undo history, on its line. Where the diff drawn anew doesn't show
  that line, as in a file closed as viewed, it goes under its file's header, still a comment on the
  line; only where the diff has neither does the draft open under its block, if the overview has it.
  Until one of them is shown, as while the diff is drawn anew, the draft is in no box, and the
  status bar counts it as a kept draft: one item for all such drafts ("2 kept drafts"), which opens
  their list, where each is ("retry.ts · line 41 · r2"). Focus comes back only to a box that had it,
  and only if you've done nothing since. Threads that arrive, grow or go while a block is on screen
  move nothing you're reading.
- **From the block to the code.** Following a block jumps to the diff at that spot, or to the
  whole-file view when the code is outside the diff. `⌃o` returns to the same place in the overview.
  With code beside, the diff on the right goes there and the line Lands, nothing switches, and
  following focus from block to block takes the diff along to each block's code.
- **From the code to the overview.** In the diff, lines the overview explains carry a marker
  (section 6).

### In the PR tab

The overview is a third view in the middle of the tab, beside the diff and the timeline. When a PR
has one, it opens first. Without one, the PR opens on its timeline, where its description is first.
A setting makes the timeline or the diff open first instead, and another turns overviews off: then
there's no Overview view, no overview anywhere else in Lo, and Lo reads none.

It appears as soon as its text arrives, and its code blocks fill in as the code loads. A block on
screen, with more under it, whose code comes taller than the room it kept, keeps that room, so
nothing you're reading moves: the rest is cut off above "Show whole block". It shows whole when you
press that, when your cursor goes into the part cut off, and when a thread or a comment box opens on
a line there, first, so it opens under its line. Every block and link can be reached and opened from
the keyboard.

### When the PR moves on

- **An out-of-date overview stays visible.** A banner says, for example, "Written for r3. The PR is
  at r5", links to the r3-to-r5 comparison, and offers the prompt to copy so an agent can update it.
- **Code blocks keep showing the code at the overview's commit,** since that's what the text
  describes. A block whose lines have changed since is flagged.

### The overview skill

The skill teaches a coding agent to write an artifact. It lives in Lo's repo and installs into
Claude Code and Codex. It tells the agent to:

1. **Read the PR:** its diff, description and commits.
2. **Read the instructions** for this repo and this user, if there are any.
3. **Start from the existing artifact** when the PR already has one, since the new one replaces it
   for everyone.
4. **Write `artifact.md` and its figures.**
5. **Run the checker** and fix what it reports.
6. **Push to `refs/lo/pr/<number>`,** in the PR's repo, or in the fork when the agent can't push to
   the repo. The agent pushes with its own git credentials, and Lo takes no part.

### The checker

The checker is a command-line tool, published as an npm package and run with `npx`. It's built from
the same parser Lo uses, so an artifact that passes will render. It checks that:

- the format is valid and its version is known;
- every code reference points at a real file and line range at the commit the artifact describes;
- every term used is defined in the glossary;
- every figure exists, is a supported type and contains no scripts;
- the artifact is under the size cap.

### The workflow

A repository with the skill installed has a workflow, `.github/workflows/lo-overview.yml`, that runs
the checker on GitHub for each pull request, by the skill's version. It runs on
`pull_request_target`, so it runs for pull requests from forks, and it never checks out or runs a
pull request's code: it fetches git data alone, into an empty repository, as data.

- **`keep`:** for a PR from a fork, copies the fork's overview, and the stack overview it names, to
  `refs/lo/kept/pr/<number>` and `refs/lo/kept/stack/<id>` in the base repo, when it's one Lo shows.
  A copy only moves forward. Lo reads it when the base repo and the fork have none.
- **`fold`:** when a PR merges, adds the terms its overview marks new or changed to the repo's
  definitions, `refs/lo/terms`, or suggests the change for a locked term.

### Customization

- **Two files.** `.lo/overview.md`, committed to the repo, holds the team's conventions.
  `~/.config/lo/overview.md` holds your own preferences, and applies when the agent runs on your
  machine.
- **Plain instructions.** Both are Markdown that the agent reads, for example "write for someone new
  to billing" or "always draw a sequence diagram for API changes".
- **Glossary.** A "Glossary" heading in either file lists terms and their definitions, so the same
  term reads the same in every overview.
- **Precedence.** The repo's conventions come first, and personal preferences refine them. The tl;dr
  is always required.
- **Appearance** isn't customized here. Overviews follow the reader's Lo theme.

## 9. Code features

### Syntax-based, on every repo

Highlighting, a file outline, and go-to-definition and find-references by name across the whole
repo. The right side of a diff navigates the new commit, and the left side the old one.

- **Index.** Lo builds a symbol index from tree-sitter tag queries, reading files from its local
  copy. The first index of a repo downloads its files at that commit, and later commits reuse most
  of them. It needs no trust, since reading a file runs nothing.
- **How it answers.** The index answers inside the app, for both sides of the diff, the peek and the
  whole-file view.
- **Name collisions.** When a name matches several definitions, the peek lists them all: same file
  first, then same directory, then a matching import.

### Language servers, on trusted repos

- **What they add.** Type hovers, inline type hints (off by default, toggled with a key), exact
  definitions and references, and the file's outline.
- **How they run.** The main process starts each one as a child process on a checkout of the PR head
  and speaks the protocol with it. The window asks main, which answers from the server or, when the
  server can't, from the syntax index. They serve the new side only. The old side keeps syntax-based
  navigation.
- **How many.** One server runs per repo and language, on the head on screen, and it moves when
  another head of the repo comes on screen. Each is held to 4 GB, and at most four run, holding 8 GB
  in all: past either, the one used longest ago that isn't on screen stops. One on screen is never
  stopped for another, so past four on screen the rest wait in line, and the first starts as soon as
  one stops, fails or is refused. "Restart" starts one if there's room, and otherwise puts it first
  in line.
- **Precedence.** Language server answers win, each labelled with its language's name, such as
  "TypeScript". Syntax-based answers fill in while a language server starts up, or when it can't
  answer, and say why.
- **Dependencies.** Dependencies are never installed, so a symbol from one shows its import and
  nothing more.

### Languages

- **Grammars** for highlighting and syntax-based navigation ship inside Lo: TypeScript, JavaScript,
  Python, Rust, Go, Swift, Kotlin, Terraform, Ruby, Java, C#, PHP and Elixir, plus common config and
  markup formats.
- **Language servers** come from a fixed list built into Lo, one per language: TypeScript and
  JavaScript (vtsls), Python (Pyright), PHP (php-lsp), Go (gopls), Terraform (terraform-ls), Rust
  (rust-analyzer), Java (Eclipse JDT LS), C# (Roslyn's server) and Swift (SourceKit-LSP). Each but
  Swift's on macOS is downloaded on first use, only for trusted repos, from its project's own
  release: npm, NuGet, GitHub releases, releases.hashicorp.com and download.eclipse.org. The Go team
  publishes no gopls binary, so Lo fetches its source from the Go module proxy and builds it,
  offline. Every file is pinned by its hash. vtsls and Pyright run on a Node that Lo downloads for
  them from nodejs.org. On macOS, Swift's server is Apple's: Lo downloads none, and runs the copy in
  the developer folder that `xcode-select -p` names, which comes with the Command Line Tools or
  Xcode. Without either, Swift's status item says to install the Command Line Tools. On Linux,
  Swift's server comes in the Swift toolchain Lo downloads.
- **Toolchains.** The toolchains servers need are Lo's own too: Go, Rust, a Temurin JDK, the .NET
  SDK and, on Linux, Swift, one version each, pinned and downloaded like the servers on first use of
  their language, from each project's own site: dl.google.com, static.rust-lang.org, Adoptium's
  releases on GitHub, builds.dotnet.microsoft.com and download.swift.org. Apart from SourceKit-LSP
  on macOS, which comes with Apple's tools, servers never use the machine's, nor a version a repo
  asks for. Settings lists them with their sizes, and removes them; on macOS it lists Apple's Swift
  too, with nothing to remove.
- **Swift on Linux.** swift.org builds Swift for each Linux distribution, against its libraries, so
  Lo pins one for each it gives install instructions for: Ubuntu 22.04, 24.04 and 26.04, Debian 12
  and 13, Fedora 41, whose build later Fedoras take too, with libxml2's older library from Fedora
  45, and Red Hat Enterprise Linux 9, for x64 and arm64. `/etc/os-release` says which a system
  takes, and distributions built on those, such as Linux Mint or Rocky Linux, take the one they
  name. Each needs the distribution's packages that swift.org lists; with any missing, Swift's
  status item says which, and the command that installs them, and Lo downloads nothing until they're
  there. Lo installs nothing on the system itself. A Linux none of them fits has no Swift server.
- **Hardening.** Lo picks each server's program, its arguments and its environment, and nothing in a
  checkout supplies a program: a server starts as its own program, never through a shell. Its
  environment is built from nothing, so none of Lo's secrets or your settings reach it, and its home
  is a folder of its own in Lo's cache, so it reads none of the settings files in yours. Its proxy
  variables point nowhere, so a program that honours them reaches no host. That isn't a sandbox:
  Node's `fetch`, for one, ignores them.
- **Still steered.** Files in a checkout can still steer a server. A `tsconfig.json` can load a
  `tsserver` plugin that's already in a `node_modules` above Lo's install, which on Linux includes
  `~/node_modules`. A `pyrightconfig.json` can name a virtual environment and extra paths for
  Pyright to read, and a `.php-lsp.json` folders of stubs. A `go.mod` or a Terraform module can lead
  a server to files outside the checkout. No server is sandboxed: it reads what you can, and Lo
  never opens a place outside the checkout that an answer names. The lsp package's README lists
  each.
- **Refusals.** A checkout that holds files a server's tools would act on gets no server for that
  language: the status bar says it's refused, its details say why, and the syntax index answers. It
  holds no room, and Restart isn't offered, since the checkout is the same; Lo looks again once
  another head of the repo is on screen. For Rust that's a `rust-analyzer.toml`, or a Cargo config
  that sets an environment or unstable options, includes another file or sits above the checkout;
  for Go, a `go.work` above the checkout or one that names folders outside it; for C#, a
  `global.json` that names folders to find an SDK in, or an MSBuild or NuGet settings file, such as
  `Directory.Build.props`, above the checkout; for Java, Eclipse's `.settings` folder at the root;
  and for Swift, a `buildServer.json`, a `.bsp` or a `.sourcekit-lsp` anywhere in the checkout. Lo
  looks as soon as a server is wanted, so one refused never waits in line. A look that fails, as a
  read error may, refuses nothing: the server fails, and Restart looks again.
- **Homes.** Each repo and language has a home in Lo's cache, where its server keeps what it writes,
  but for a cache Roslyn keeps in its install. The cache's size cap counts homes, and a repo's go
  with its clone.
- **Java and C#.** Neither server reads the repo's build. Java's source folders come from the files'
  own packages, and Roslyn gets a project of Lo's own that lists the checkout's `.cs` files. So a
  type from a dependency has no definition.
- **Swift.** SourceKit-LSP is told of no workspace, so it reads no build or settings of the repo:
  each file is read alone, with the macOS SDK, or on Linux, the system's headers. A use of what
  another file declares isn't resolved, and it can't find references, so `gr` answers from the
  syntax index.
- **Without a server.** Kotlin and Ruby have none and answer from the syntax index, as does any
  other language that has a grammar but no server, and Swift on a Linux none of swift.org's builds
  fits.

### Trust

Language servers are large programs that read a checkout's code and settings files. Lo limits what
they can run, but they aren't sandboxed: a checkout can still steer them in the ways listed under
Languages, and hostile content could use a bug in one. So they run only when the repo is trusted and
the PR's branch lives in that repo. A PR from a fork is someone else's code, even in a repo you
trust.

- **Untrusted repo.** The status bar's Language servers item reads "Language servers off", and its
  details say what they're off for, with "Trust repo…". It opens by itself once per repo, at the
  first `g d` there. Trusting opens a dialog of Lo's own that names the repo, with "Cancel" as its
  default.
- **PR from a fork.** The item offers to trust that one PR instead, and its later pushes are trusted
  too.
- **Where it's kept.** Trust is in the settings file, by the repo's name and GitHub's ID for it, so
  a name that comes to belong to another repo isn't trusted. Only the main process writes it.
- **Settings.** Settings lists trusted repos and PRs, and you can remove any of them. Removing one
  stops the servers it alone trusted and removes their checkouts.

### Navigating

- **Peek.** `gd` opens the definition in a peek under the line. One key opens the full file, read
  only, in the same tab, and `⌃o` brings you back to the diff.
- **Into the diff.** If the definition is in a file the PR changes, Lo jumps to that spot in the
  diff instead of the plain file.
- **Other keys.** `gr` lists references in a panel, the right one, beside the threads. `K` shows the
  type hover, `gh` turns inline type hints on or off and `gO` opens the file's outline. In moved
  code, `gm` goes to the other end. `⌃o` and `⌃i` go back and forward, comparing again the revisions
  a place in the diff was in.

## 10. Comments, reviews and the timeline

### Comments

- **Where.** `c` comments on the current line, and `v` then `c` on a range of lines, on either side
  of the diff. By the mouse, a click on the `+` beside a line comments on it, a drag from the `+` on
  the lines it crosses, Shift with the click on the lines from the cursor's, and a right-click
  inside lines selected on those lines. `c` on a file's header, or on its row in the file tree,
  leaves a file-level comment, its box under the header, in the header's popover beside lines.
  GitHub takes line comments only on lines in the PR's diff, so on any other line Lo says so, and
  `⏎` then comments on the file instead. Comments can also be written on an overview's code blocks
  (section 8).
- **In the diff.** A thread is its mark beside the code, and opens over the code in a popover under
  its last line: the pointer resting on the mark previews it, and a click, `⏎` on its line or `]t`
  pins it. A reply's, an edit's and a new comment's box open in the popover too, so no line moves
  for a thread or a box. Settings › Pull requests › Threads in code, or the View menu, puts threads
  between lines instead, as on GitHub: each under its line, and a file's under its header,
  unresolved ones open and resolved ones collapsed, `za` opening or collapsing one. A file's header
  and its row in the file tree count its threads.
- **Marks beside the code.** Each side has a thread lane between its line numbers and its code. A
  thread's mark there is a bubble beside its last line, amber while it's unresolved or holds your
  pending comments, grey once it's resolved or out of date, with a bracket up the lane to its first
  line. Several threads on a line share one bubble. A file's threads have theirs in its header's
  row. A click on a bubble pins its popover, or between lines collapses or expands its thread, as
  `za` does. The lane is as wide empty as full, so no mark coming or going moves a line.
- **Threads.** You can reply, resolve and unresolve from the thread's buttons, and edit or delete
  your own comments from each one's `⋯`, which shows on the comment under the pointer or the
  keyboard. A right-click on the thread, or on one of your comments, opens the same menu, and the
  keys do all of it. A key acts on the thread `]t` landed on, or the only thread on screen on the
  cursor's line, or under the file's header; where there's more than one, Lo says to pick one with
  `]t`. `r` opens a reply box in the thread's card in its popover beside lines, or right after the
  card between lines, whose buttons add the reply to your pending review or post it at once. `x`
  resolves the thread, or unresolves it, here and in the threads panel, where GitHub lets you. `i`
  opens a box with your newest comment's text, and saving it replaces the comment on GitHub. `dd`
  asks first, showing the comment's first line, whether it leaves your pending review and whether
  its thread goes with it: `⏎` deletes it and `Esc` leaves it, and a held or repeated key never
  confirms. Lo changes only your own comments, even where GitHub would let you change someone
  else's: theirs are for GitHub's page. Between lines, a reply box and a comment box on the same
  line can both be open; beside lines the popover holds one box at a time, and the one open closes
  as another opens, keeping its draft.
- **Edits and deletes.** An edit keeps the text it started from with its draft, through a restart.
  GitHub's edit doesn't check what it replaces, so before saving Lo reads the comment again, and
  saves only if GitHub's text is still the one the edit started from. If it was edited elsewhere
  meanwhile, Lo keeps your text in the box to copy, and saves nothing. A delete likewise reads the
  comment first, and goes only if it's still as the question showed it. Resolving, edits and deletes
  are writes like any comment: one at a time to a PR, never while GitHub has asked Lo to hold off,
  and refused offline. What your own write changes in a thread shows at once, without moving the
  line you're on.
- **Writing.** The comment box is a CodeMirror editor with Markdown highlighting, Vim keys and a
  preview toggle. Its head says where the comment goes and which account it's from, and its foot has
  Vim's mode and the buttons that send. While a comment is sent, its text can't be changed. One
  write to a PR goes at a time, so a second comment waits for the first's answer. When GitHub's
  answer is lost, Lo reads your comments to find out whether it posted, after a restart too, and
  until it knows, the comment can't be sent again. Lo never sends it again by itself. The same goes
  for a lost answer to an edit, a resolve or a delete: Lo reads the comment or the thread again
  after a while to see whether it went, says it's checking meanwhile, and if it can't tell, says so
  and offers to try again. A comment that GitHub puts on a later revision than the one it was
  written on is labeled with that revision: "On r5".
- **Suggestions.** `s` opens the comment box with the selected lines in a `suggestion` block, ready
  to edit. It works on the new side only, because GitHub can only apply suggestions there. Applying
  them happens on GitHub. A thread shows a suggested change as the diff shows a change: the lines it
  replaces over the lines it suggests.
- **Outdated threads.** A thread whose line has since changed appears where it was written when you
  view that revision, and is labeled outdated elsewhere.
- **Attachments.** Drag, paste or pick (`⌘⇧A`) files (PNG, JPEG, GIF, WebP, SVG, MP4, MOV or WebM),
  up to 10 on their way into a box at a time, into any comment box, including the review summary.
  Each goes in at the cursor as a placeholder, and Lo uploads it the way `gh --attach` does, one at
  a time, with its progress and Cancel, then puts its Markdown in the placeholder's place. If you
  took the placeholder out meanwhile, its row says so and offers Insert. Lo takes a photo's location
  and other metadata out first, and says what it took; a GIF, SVG or WebM goes as it is, and Lo says
  it couldn't remove its metadata. While files are in a box, it warns that uploads stay reachable by
  link even if the comment is deleted, and the comment isn't sent until they're in. A placeholder
  whose upload didn't finish, as when Lo quit, holds the comment too: the box names the file, and
  you take the placeholder out. Images and GIFs can be up to 10 MB, and videos 10 MB on free plans
  or 100 MB on paid ones. Uploading needs write access to the repo. Where you don't have it, Attach
  is off, the box says so, and an image's web address pasted or dropped goes in as an image. If
  GitHub won't take Lo's sign-in for uploads, Lo uses `gh`'s sign-in for that one upload, read from
  gh each time and never kept, and without gh it takes web addresses only. An upload is never sent
  again by itself. There's no built-in GIF search.

### Reviews

- **Pending review.** Comments collect into a pending review by default. It's stored on GitHub, so
  it survives quitting Lo and shows as pending on the web. `C` posts one comment right away instead.
  While you have one, GitHub posts nothing else from you, so a comment sent right away (`C`, `⌥⏎`)
  joins it, and Lo says so: "Added to your pending review", even when GitHub's answer was lost and a
  later read finds the comment in the review.
- **Submitting.** `⌘⏎` opens the submit dialog. It has a summary box, a choice of Comment, Approve
  or Request changes, the number of pending comments, and the account you're acting as. On your own
  PRs only Comment is offered, since GitHub allows nothing else there.
- **Approve and ship.** `⌘⇧⏎`, described in section 11.

### Threads panel

The right panel. `⌘⇧\` or the toggle in the tab's header opens and closes it for the whole window,
and opening it puts focus in its list. Opening or closing it leaves the line at the top of the diff
where it is. The toggle counts the unresolved threads. Its edge sizes it as the left panel's does,
between 280 and 560 px, 340 by default.

The window keeps its layout, each panel open or not and its width, from tab to tab and when Lo
restarts, and opens where it was, as big, maximized or full screen if it was, or on the display that
holds most of its top where part of it would be off every display, no bigger than that display; on a
display that's gone, it opens at 1280×800. Reset layout, in the View menu and the palette, puts the
panels back as they first were. A window too narrow for a panel beside a view at its minimum (340
px) puts it away, the threads panel first, but never the one asked for last before the other, and
brings it back when there's room. A panel's button shows what's drawn: one put away reads unpressed,
and pressing it asks for it, so the other gives way. One that can't fit at all is dimmed: "Widen the
window first". A panel opened by its key, its button or Reset layout fades in, and so does one back
as its key or button closes the other; one back as the window widens, or as a drag closes the other,
is just there. Focus in a panel that closes or is put away goes back to the view that had it last.

Code beside, `o` or the header's button between the view switch and the threads panel's, shows two
views: the overview or the timeline on the left, and the diff, always inline, on the right, two
sheets with a gap between them that drags as the panels' edges do. It's part of the window's layout,
kept for every tab and across restarts; `Esc` doesn't close it, and `o` again does. The view
switch's thumb spans both views on screen; `` ` `` steps the reading view, and `\` goes to the other
view. A link to code shows it in the diff on the right, its line Landing, and gives the code focus;
`⌃o` goes back to where the link was. Focus moving from block to block in the overview, or from
review to review on the timeline, takes the diff along, leaving focus where it is. Under 480 px, the
timeline's markers are smaller, so its cards keep the room.

It lists the threads of the view on screen, so each layer of a stack shows its own. A run of layers
has none of its own, and the panel says to show one of its layers. Threads are grouped by file in
the file tree's order, each file's own threads first and then by line. Each row shows who started
the thread, where it is, its replies, whether it's resolved, and the opening of its first comment as
plain words, with none of its Markdown, as a collapsed thread in the diff does. Outdated threads are
labeled with the revision and line they were written on. It lists the unresolved threads at first,
and `f` steps to all threads, then to yours: the ones you started or replied in.

`j` and `k` move through it, and `x` resolves or unresolves the thread the keyboard is on. `⏎` or a
click shows the thread in the diff, opened, at the top of the screen, and focus stays in the panel;
with code beside, its line Lands. It's a jump, so `⌃o` goes back. A thread the diff on screen
doesn't show, such as an outdated one, shows in the whole diff of the revision it's on, which Lo
compares first, saying so: "Showing r1 for this thread", with Back. `⌃o` then goes back to the
comparison before and the place in it, and `⌃i` comes forward again. The last move wins: a
comparison still coming is called off, with what Lo said of it, when the diff on screen shows the
next thread asked for, or when `⌃o` or `⌃i` goes elsewhere first. A file-level thread shows its
file's header. In the diff, `]t` and `[t` jump between threads, a stop for each, a file's threads
under its header included, and the thread landed on is ringed.

### Timeline

The PR's full GitHub timeline: the description, comments, reviews, pushes and force-pushes, CI
results, labels, assignments, review requests, cross-references, merges, queue events and
deployments. A merge shows once, as GitHub's page shows it: without the close GitHub records with
it. Markdown is rendered, GIFs play, and images load through the main process as the tab's account,
so attachments in private repos show. The PR's title, description, labels, reviewers and draft
status are read-only in Lo.

It's the third middle view, after the overview and the diff. Lo reads it from GitHub when you first
show it, before what it reads in the background, and keeps it current from then on. A long one shows
its newest events while the older ones are read. `j` and `k` move between its events, `⇥` goes
through the links and buttons of the one you're on, `Esc` goes back to the list, and `gx` opens it
on GitHub. What an event's buttons do is also on its right-click menu. A tab acting as nobody asks
you to sign in to see it, and a run of a stack's layers has none of its own.

What changes on GitHub while you read the timeline waits for your next key, click or scroll, and
when it comes, what you were reading stays where it is. What your own comment, edit or delete
changes shows as it comes.

- **The comment box.** A comment box at the bottom, beside your avatar, comments on the PR itself.
  `c` puts focus in it, and `⌘⏎` or its Comment button posts it at once, since it joins no review.
  It's the same box as in the diff, with its draft kept through a restart, offline and pauses
  handled the same way, and the same care when GitHub's answer is lost: Lo reads the timeline to
  find out whether it posted, and never posts it again by itself. `Esc` gives focus back to the list
  and keeps the draft. While your comment on the PR is on an overview's code block, open there or a
  mark beside its lines, the box says so, and `c` brings it here. While Lo is still checking the
  overview for that block, the box says that instead. A draft the box shows stays in it while it's
  open, with your focus, whatever the overview does. It goes back to its block, if the overview has
  it, only once the timeline goes, as after a restart.
- **Your comments.** Your own comments on the PR say so and have Edit and Delete in their menu, from
  a right-click or the `⋯` that shows on the row under the pointer or the keyboard, as each post's
  does. `i` on one opens a box with its text in its card, and `dd` asks first, as a review comment's
  delete does. Each reads the comment again first and goes only if GitHub still has it as it was, as
  in the diff. Lo changes only your own comments, never a review or the description.

## 11. Merging and the merge queue

### Merge status

Every PR tab shows a one-line merge status in its header, such as "Ready to merge · Squash into
main", "Can’t merge yet · Review required · 1 check running" or "Queued, 3rd · about 12 min". A
click on it, or `m`, opens the merge panel under it. When a PR can't merge, the panel lists why, a
row for each reason, starting with what waiting won't fix: missing approvals (including which code
owners), changes requested, required checks that failed, are running or haven't reported (each
linked to its run), unresolved conversations, conflicts, an out-of-date branch, draft status, and
other rules on the branch. `j` and `k` move between the rows, `o` opens the page of the one you're
on, and `]t` goes to the next unresolved conversation.

Lo pieces this together from several API calls, for the view on screen only: a tab that isn't shown
reads nothing, and a tab acting as nobody, or showing a run of layers, has no status. If GitHub
reports a block Lo can't explain, the panel says "GitHub says no, and not why" and links to the PR
on GitHub. Lo doesn't check every rule on the base branch, signed commits among them. When GitHub
blocks a PR, the panel names the ones it sees, such as "Commits must be signed", as rules Lo doesn't
check, since one may be the reason. A read that may be missing something, or that failed, says so
and how old it is, and a PR that looks ready reads "Lo may not see everything" beside it.

### Merging

- **Method.** Only the methods the repo allows are offered, and `⇥` and `⇧⇥` step through them. Lo
  remembers the last one GitHub took in each repo. A squash commit's title and message start from
  what GitHub would write, and `e` edits them. Lo sends only text you typed, so an empty field
  leaves GitHub's own.
- **Queue.** If the base branch requires a merge queue, the button becomes "Add to merge queue," and
  the queue's own settings decide the method and message. The panel reads the queue as it opens ("4
  ahead, about 18 min"). Once the PR is in it, the status and the panel give its place, and the
  panel's "See the queue" does what `gq` does. When a PR leaves the queue without merging, a banner
  says why ("#4821 left the merge queue: test (node 20) failed with its group."), and the panel
  links the failed checks. Where Lo can't tell why, it says so.
- **Auto-merge.** `a` in the panel turns it on when only waits stand in the way (checks running, an
  approval to come, GitHub still checking) or a block Lo may not see all of. GitHub then merges the
  PR, or adds it to the queue, once they clear. The confirmation says what GitHub waits for, and
  warns when a push before then would merge too, as when the base branch keeps approvals through a
  push. It goes only for a PR alone or a GitHub stack's bottom layer: for a stack's upper layers,
  whose merge would take the layers below, for any layer of a chain, and where Lo doesn't know where
  the PR sits, Lo refuses and says why. With auto-merge on, `a` turns it off at once without asking,
  since that merges nothing. If nothing blocks the merge now, GitHub refuses auto-merge, and Lo
  offers the merge itself in its place.
- **Admin override.** `⌥⏎` merges past the base branch's rules. It's offered only to an account
  GitHub lets bypass them, for a PR that rules block rather than a draft or conflicts, that isn't
  queued, and that sits alone or as a GitHub stack's bottom layer, as for auto-merge. Its
  confirmation lists what it skips, and goes only once you type the PR's number. The field empties
  each time Lo asks again.
- **Confirmation.** Every merge, queue entry, auto-merge turned on and override asks first. The
  confirmation names the account, the method, the target branch, the revision ("r5 of #4821, the one
  on screen") and, for a stack, every layer that will merge. `⏎` confirms it and `Esc` goes back to
  the panel. The press that opened it can't confirm it, and a held key never does.
- **Before it's sent.** Lo checks again as you confirm. It sends only if you're still signed in as
  the account, what it read of the PR is whole, at the head on screen and no more than 7 minutes
  old, that head is GitHub's, it knows where the PR sits, nothing else is merging it, no conversion
  to a GitHub stack is running on its path, and it's online and not asked to hold off. A merge takes
  with it only the layers the confirmation named, and auto-merge and a merge past the rules go only
  for a PR alone or a GitHub stack's bottom layer. Otherwise Lo reads again where a read can help.
  If anything the confirmation named has changed, it asks again with the new facts, and if not, it
  sends nothing and says why. `Esc` while it checks sends nothing. The merge carries the head on
  screen, so GitHub merges only that head.
- **Sending.** One merge write goes to a PR at a time, across tabs and accounts: a merge, a queue
  entry, auto-merge, a removal from the queue and approve and ship take turns. A merge goes on if
  you close its dialog or tab, and a toast says when it's done ("Merged #4821 into main"). A refusal
  shows in the dialog while it's open, and otherwise in a banner on the tab with "Merge panel" `m`.
- **Branches.** Lo never deletes branches. The repo's own auto-delete setting applies.
- **Out-of-date branches.** Lo shows that a branch is out of date but doesn't offer GitHub's "Update
  branch," because that adds a commit to the PR. The author or agent updates it.

### Approve and ship

`⌘⇧⏎` opens one confirmation that lists each step: check that the revision on screen is still the
newest push, approve (with your summary and pending comments, and skipped on your own PRs), then
what Lo expects to follow: merge, join the queue, or turn on auto-merge. Lo checks with GitHub for
20 seconds at most before it shows that, and otherwise says GitHub took too long. If it's only
waiting on checks or other approvals, that is auto-merge, so the PR goes in once ready. If something
waiting won't fix blocks it (conflicts, failed checks, changes requested), Lo stops after approving
and shows why. Your approval stays.

- **What it approves.** Only the revision on screen, so it merges only a PR alone or the bottom
  layer of a GitHub stack, and nothing with it. Where a merge would take others along, as for a
  GitHub stack's layer above the bottom, or a chain's layers, or where the merge panel wouldn't
  merge from, Lo approves and stops, says why, and leaves the merge to the merge panel (`m`).
- **Running it.** Lo reads GitHub again as you confirm. If anyone pushed since the revision you saw,
  it stops before approving and offers "See r2 → r3". Otherwise it approves, waits until GitHub
  shows the approval, and goes on only if GitHub then allows what you confirmed, into the branch you
  confirmed. The merge, queue entry or auto-merge goes through the same checks as the merge panel's.
  An approval whose answer is lost is settled by reading your reviews, and nothing more is sent
  until it is. Lo waits a minute at most for that, and only while the tab is open: then it stops,
  says it can't tell whether GitHub took the approval, and merges nothing.
- **The watch.** GitHub keeps auto-merge on after a push, and unless the base branch wants a new
  approval, the push merges with your approval. So Lo watches the auto-merge it turned on after
  approving someone else's PR. The watch survives a restart, and reads the PR every 2 minutes, or 5
  while Lo isn't in front, whether or not a tab shows it. On a push that would merge with your
  approval, Lo turns auto-merge off and says so in a banner on the PR's tab, or in a toast while
  another tab is on screen: "Lo turned off auto-merge: mira-chen pushed r4 2 min ago after you
  approved r3." The banner offers the merge panel. The watch ends when the PR merges or closes, when
  auto-merge stops being the one Lo turned on, when GitHub refused to turn it on, and when the base
  branch wants a new approval after a push, so a push can't merge with yours.

### Stacks

Merging a layer of a GitHub stack merges the open layers below it with it. The panel's button says
"Merge 3 layers", or adds them to the queue. The confirmation lists every layer with its review and
checks, names each at the head GitHub's Stacks API gave as it opened, and says the layers above stay
open and move onto the base branch. Lo submits it through the async merge API and shows each layer's
state, and how long ago GitHub took the merge, until it's done. GitHub checks the branch's rules as
the merge runs, and its docs disagree on whether a stack merge is all or nothing, so Lo promises
neither. If GitHub stops partway, Lo says which layers landed ("Merged #232 only."), that none did
("Nothing merged."), or that it can't tell.

Other chains are offered "Make this a GitHub stack" first (section 4), and nothing merges until it
is one. When that isn't possible, the panel lists why, and Lo merges one layer at a time, from the
bottom PR's own tab. It moves the bottom PR's base to the root branch if it isn't there, merges it,
then points each layer on it at the root branch. After a squash or a rebase it marks each "needs
rebase," and after a merge commit, which keeps the layers' commits, it doesn't. The confirmation
lists every move. Lo makes the moves only while it's open, once GitHub says the PR merged. After a
queue entry it reads the PR until it merges, for up to 6 hours, or until it leaves the queue, and
after a lost answer for up to 15 minutes from the last one. Each move reads the base branch first,
and doesn't move one someone else moved. The first move that fails stops the rest and says what
moved, and Lo puts nothing back. A layer above the bottom is refused, naming the layer to merge
first, and so is a bottom layer that needs a rebase.

Lo merges a PR only once it knows where it sits, from the stack list (section 4) and, for a GitHub
stack, GitHub's own answer. Until then the panel says why and asks again by itself. It asks afresh
each time it opens and as the stack's layers move, and `⏎` asks once more before it refuses, so a
chain that changed since never leaves `⏎` doing nothing.

### The merge queue

- **Opening it.** `gq` opens the merge queue for the base branch of the PR on screen, in a tab of
  its own, read as the account that PR's tab acts as. There's one per repo and account: `gq` from a
  PR into another branch moves it there, and it comes back after a restart.
- **What it shows.** The header names the repo and branch, the queue's settings when your account
  can read them ("squash, groups of up to 5 · next merges in about 6 min"), and a switch between the
  repo's branches that have a queue, with how many entries each holds. `⇥` and `⇧⇥` switch branches.
  Below it, every entry with its position, title, author, state ("Checks running", "Waiting", "Will
  be removed"), time in the queue and estimated time to merge. The entries GitHub is testing
  together at the front are boxed as one group, "Testing together · 3 PRs", your PRs are marked, and
  a stack's layers are named. Past 100 entries, a note links to the rest on GitHub. A branch with no
  queue says its PRs merge on their own.
- **Waiting to join.** The open PRs into the branch with auto-merge on that aren't in the queue yet,
  from the 100 most recently updated, each with what it waits for ("when approved").
- **Removals.** "Left the queue" lists up to 20 PRs per branch that Lo saw leave while it was
  running, latest first, each with why (merged, failed checks, a conflict, a timeout, or someone
  removed it) and a link to the failing check. Where GitHub leaves part of why out, the row says so.
- **Reading.** Lo reads the queue every 20 seconds while its tab is on screen, those waiting to join
  every 2 minutes, and nothing while it isn't, and the status bar says how long ago. When GitHub
  leaves part of the queue out, the tab says Lo may not see every entry rather than call the queue
  empty.
- **Remove.** `x` takes the entry out. Its confirmation names the account, the branch, the PR and
  its place, and the layers above it in its GitHub stack that leave with it. For a layer above the
  bottom, Lo asks you to take out the bottom layer instead, since GitHub takes a stack out from
  there.
- **To the front.** `J` is for the repo's admins only, since GitHub allows no one else. The entry
  leaves the queue and joins again at the front, so GitHub tests it, and the entries tested with it,
  again from the start. It isn't offered for the entry already at the front, or for a layer of a
  GitHub stack with other open layers. If GitHub takes the entry out and won't add it back, Lo says
  it's out.
- **Auto-merge.** `a` turns it off at once for a PR waiting to join, without asking. For one that
  left the queue and is still open, it opens the PR's tab and asks to turn auto-merge on there,
  through the merge panel's confirmation. For an entry already queued, it says so.
- **Checked as you confirm.** `x` and `J` ask from a read of the queue no older than 40 seconds. As
  you confirm, Lo reads it again unless the last read is that recent. It drops the question if the
  entry left, got a newer push or the tab changed branch, asks again if the layers that leave with
  it changed, and refuses `J` once the account is no longer an admin. A change takes its PR's turn
  among merge writes, so it never races a merge.

## 12. Keyboard, windows and opening links

### Keys

Vim-style single keys by default, from CodeMirror's Vim package. Arrow keys also work. Nothing in a
diff is editable, so Vim's insert mode exists only in comment boxes. Every key can be remapped in
the keymap file, `~/.config/lo/keymap`. `?` shows every key.

| What            | Keys                                                                                                                                                                                                                                                                                                                                   |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Move            | `j`/`k` line, `w`/`b` word, `gg`/`G` top and bottom                                                                                                                                                                                                                                                                                    |
| Jump            | `]c`/`[c` change, `]f`/`[f` file, `]t`/`[t` thread, `]s`/`[s` stack layer, `gm` the other end of moved code                                                                                                                                                                                                                            |
| Act             | `v` select lines, `c` comment, `C` comment right away, `s` suggest, `e` mark viewed, `⇥` switch side                                                                                                                                                                                                                                   |
| Threads         | `r` reply, `x` resolve or unresolve, `i` edit your comment, `dd` delete your comment                                                                                                                                                                                                                                                   |
| Code            | `gd` definition, `gr` references, `K` type hover, `gh` inline type hints, `gO` outline, `⌃o`/`⌃i` back and forward                                                                                                                                                                                                                     |
| Peek            | `j`/`k` pick an answer, `⏎` go to it, `gr` the references of the same name, `Esc` close it                                                                                                                                                                                                                                             |
| References      | In the references panel, which `gr` opens: `j`/`k` move, `⏎` go there, `Esc` back to the threads, or close the panel                                                                                                                                                                                                                   |
| Copy and open   | `yy` the line, `yl` a link to it, `yp` the file's path, `gf` the whole file, `gx` on GitHub                                                                                                                                                                                                                                            |
| Review          | `m` merge panel, `⌘⏎` submit review, `⌘⇧⏎` approve and ship, `gq` the merge queue, `gS` make this a GitHub stack                                                                                                                                                                                                                       |
| Find            | `⌘L` open PR (`⌘O` too on macOS), `⌘P` files, `⌘⇧P` command palette, `/` search, `n`/`N` next and previous match                                                                                                                                                                                                                       |
| View            | `` ` `` next middle view (overview, diff, timeline), `~` previous, `o` code beside, `\` the other view, `gv` compare revisions, `>`/`<` widen and narrow what has focus, `=` reset its width                                                                                                                                           |
| Files           | `-` go to the file tree at the file on screen, and `-` again up to the stack tree. In the tree: `t` tree or review order, `f` changed files only, `l`/`h` (or `→`/`←`) open and close a folder, `zR`/`zM` open and close all, `⏎` show the file, `e` mark viewed, `Esc` back                                                           |
| Overview        | `]b`/`[b` next and previous block, `⏎` follow a block to its code, `c` comment on a block's lines, `⇥` next part of a figure, `←`/`→` walkthrough step or tab, `ya` copy a prompt for an agent                                                                                                                                         |
| Timeline        | `j`/`k` move between events, `⇥` through its links and buttons, `Esc` back to the list, `⏎` show a review's comments in the diff, `gx` open the one you're on on GitHub, `c` comment on the PR, `i` edit your comment, `dd` delete your comment                                                                                        |
| Panels          | `⌘\` left panel, `⌘⇧\` threads panel. In the threads panel: `j`/`k` move, `⏎` show the thread in the diff, `x` resolve or unresolve, `f` unresolved, all or yours. In the stack tree: `j`/`k` move, `⏎` show the layer, `gx` open it on GitHub, `Esc` back, `v` choose a run of layers, `j`/`k` to grow it, `⏎` to view it as one diff |
| Diff view       | `gi` inline or side by side, `gw` hide or show whitespace, `zo`/`zc` expand and collapse unchanged code, `zR` the whole file, `za` open or close a collapsed file, or between lines the thread at the cursor                                                                                                                           |
| Comment box     | `⌘⏎` add to review (in the timeline's box, comment), `⌥⏎` comment now, `⌘⇧V` write or preview, `⌘⇧A` attach files, `Esc` leave insert mode, `Esc Esc` close and keep the draft                                                                                                                                                         |
| Merge panel     | `⏎` merge or add to the merge queue, `a` turn auto-merge on or off, `⌥⏎` merge without the rules, `⇥`/`⇧⇥` next and previous method, `e` edit the commit's title and message, `j`/`k` move between reasons, `o` open the reason's page, `]t` next unresolved conversation, `Esc` close, or back from the commit's fields               |
| Merge queue     | `j`/`k` move, `⏎` open the PR, `x` remove, `J` to the front (admins), `a` turn auto-merge off, or on for a PR that left the queue, `⇥`/`⇧⇥` next and previous branch, `gx` open on GitHub                                                                                                                                              |
| Revision picker | `j`/`k` move, `Space` set an end, `⏎` compare                                                                                                                                                                                                                                                                                          |
| Palettes        | `⏎` open, `⌘⏎` the other way (a new window, the whole file), `⇥` changed files only in the file finder, `⌥⏎` show an action's key                                                                                                                                                                                                      |
| Tabs and window | `⌘1`–`⌘9` a tab, `⌘⇧]`/`⌘⇧[` or `⌃⇥`/`⌃⇧⇥` next and previous tab, `⌘W` close the tab, `⌘,` settings, `?` every key, `Menu` or `⇧F10` the right-click menu of what has focus, `g ,` open the keymap file                                                                                                                                |

In code views, `m` and `gq` take the place of Vim's own keys in normal mode: Lo's code is read-only,
so marks and formatting have no use there. The merge panel and the merge queue aren't code views, so
`e`, `⇥`, `x` and the rest mean what their rows say. In the dialogs they open, `⏎` confirms and
`Esc` cancels, and the press that opened a dialog never confirms it.

Copying is always `y` plus a letter; there's no single-key `y`. `⌃o` returns from anywhere a key
took you: from the code back to the overview block, from a definition or the other end of moved code
back to the diff.

`gh` turns inline type hints on for the whole window only when the code on screen gets some back;
otherwise it says why, as on a repo Lo runs no language server for, and leaves them off. Once
they're on, each view shows its server's hints where it has them and none, quietly, where it
doesn't, and `gh` again turns them off everywhere.

A count typed before a key repeats it, as in Vim, for `e`, `yy`, `]s` and `[s`, and `j` and `k` in
the file tree: `3e` marks three files viewed, and `2yy` copies two lines as they show. A count
before any other key in the code goes to Vim with it, and `Esc` drops one. The status bar shows the
keys typed so far of a command still to come, as Vim does. In the file tree, `gg`, `G`, `PgUp` and
`PgDn` move as in the overview, and `⏎` on a folder opens or closes it; in the stack tree, `+` goes
back down to the files.

**On Linux,** Ctrl takes the place of `⌘` in every key above, and the app shows each platform its
own. Vim's `⌃` keys keep their meanings, so two keys differ from what that rule would give, on both
systems: `⌘L` opens a PR, because `⌘O` would become Ctrl+O, which is `⌃o` (back); and `⌥⏎` shows an
action's key in the palettes, because `⌃⏎` would be the same as `⌘⏎`. `⌃⇥` and `⌃⇧⇥` also switch
tabs on both systems. In a comment box in insert mode, Ctrl+C, Ctrl+X, Ctrl+V, Ctrl+A and Ctrl+Z
keep their usual editing meanings, and Ctrl+W deletes the previous word, as in Vim, instead of
closing the tab. Every action that has a key is also in a right-click menu where one makes sense.

### Window

One window, with a tab per PR. A whole stack lives in one tab. Opening a link to a PR that's already
open switches to its tab, at that layer. Drag a tab along the strip to move it, or move the tab on
screen a place with `⌃⇧PgUp` and `⌃⇧PgDn`; the tabs come back in that order after a restart.

- **Header.** The PR's title, number and author, the account you're acting as, the merge status and
  the revision picker.
- **Left.** The stack tree, with the file tree below it.
- **Middle.** The overview, the diff or the timeline. One key cycles between them. With code beside,
  the overview or the timeline sits on the left and the diff, inline, on the right.
- **Right.** The threads panel, or the references `gr` lists, one at a time.

Each panel opens and closes with a key. With no PR open, Lo shows the PRs you opened recently,
across all accounts.

On first launch, Lo shows a welcome: six steps, walked with "Continue", "Back" and "Skip", by mouse
or with `⏎` and `⇧⏎`. It opens by itself until it's finished or an account is signed in, and
"Welcome to Lo" in the Help menu, the command palette and Settings opens it again.

1. **An account.** The Lo mark, which unmelds once, a headline and a line on what Lo is for. "Sign
   in with GitHub…" (`⏎`) starts GitHub's device flow, and "Import from GitHub CLI" is there when
   `gh` is found. When Git is missing or too old, a notice says how to install it, with a "Check
   again" button that finds Git without restarting Lo.
2. **The look.** The theme, the diff's layout and how threads show in code, each a row of cards with
   a small drawing of what it does. A card changes the setting as it's pressed, and Continue changes
   nothing.
3. **Keys.** Standard keys or Vim keys for code and comment boxes, and a short diff to try `j`, `k`
   and `c` on. Nothing typed there is sent.
4. **Overviews.** Two lines on what an overview is and who writes it, the top of one drawn at its
   real size, and two rows: whether there are overviews, and which view a pull request opens on,
   each as Settings has it. Focus starts on Continue, so `⏎` goes on.
5. **Set-up.** One row each, with its own button: installing the `lo` command, sending pull request
   links from other apps to Lo, and installing the overview skill while there are overviews. Sending
   links opens a dialog with ready-made rules for Finicky, Velja and Choosy to copy, and a link to
   the docs. Lo registers as a link handler when it's installed, so the row registers nothing.
6. **A pull request.** A field for a link, which opens public pull requests without an account, and
   a sample pull request of Lo's own, which says it has an overview while there are overviews.

### Settings

Settings live in a file in `~/.config/lo/` and in a Settings screen. They cover accounts, trusted
repos and PRs, the theme, the cache, the toolchains language servers use, which view a PR opens on
(its overview, its timeline or its diff), and whether there are overviews at all.

### Opening links

- **`⌘L`** (and `⌘O` on macOS) opens a box that's already filled in when the clipboard holds a PR
  link.
- **Link routers.** Lo registers as an app that can open web links, without becoming the default
  browser, so Finicky, Velja or Choosy can send PR links to it. Lo's docs include ready-made rules.
  Any link Lo can't show goes back to the default browser.
- **`lo://` and the CLI.** `lo://github.com/<owner>/<repo>/pull/<n>` opens a PR. "Install
  command-line tool" in the app menu adds `lo <url>`.
- **What counts as a PR link.** `github.com/<owner>/<repo>/pull/<n>`, plus its `/files`, `/commits`
  and `/checks` pages. Links to a file, a line, a commit or a comment open at that spot.

## 13. Errors and edge cases

### Acting on what you saw

- **Reviews** are recorded against the commit you were looking at, so GitHub shows exactly what you
  approved.
- **Merges** also carry the commit you were looking at. If someone pushed after it, GitHub refuses
  the merge, and Lo shows the new revision with the changes since the one you saw ("See r5 → r6").
- **Approve and ship** checks for a newer push before it does anything, and if there is one it stops
  before approving.

### GitHub

- **Offline.** Cached PRs open with "Offline" in the header, whose details say when the data was
  last checked. You can still write comments: they're kept on this computer as drafts, and you post
  them yourself once you're back online. Nothing posts by itself. Reviewing and merging are off
  until then.
- **A proxy that asks Lo to sign in.** Behind a proxy that signs you in with Kerberos, reads work.
  Writes, such as comments, reviews and merges, stop before anything is sent. They say the proxy
  asked Lo to sign in. Writes go over Node's HTTP stack, which can't sign in to a proxy. Lo can't
  sign in to a proxy that needs NTLM or a password, for reads or writes.
- **Unsent text.** Text in comment boxes is saved on this computer until it's posted, so a crash or
  restart doesn't lose it. After a restart, or a reload of the window, its box opens again where it
  was, unfocused, saying when the draft was saved, with a button to discard it.
- **Rate limit used up.** The header says so, and its details say when it resets. Polling pauses
  until then, and so does writing, as it does for a minute when GitHub turns a comment away as sent
  too fast. A comment, review or merge asked for meanwhile isn't sent, and says when it can be. A
  change to a stack's base branches waits, and goes once the pause is over.
- **Signed out.** If an account's token is revoked, that account's tabs say so in the header, whose
  details ask you to sign in again. Other accounts keep working.
- **Single sign-on.** If an org requires SSO approval for the token, Lo shows GitHub's link to grant
  it.
- **PR state changes.** When a PR is closed, merged or reopened while it's open in Lo, the tab
  updates and the actions change to match.

### The local copy

- **First open.** The diff appears straight away from GitHub's API. Whole-file context, navigation
  and rebase-aware comparison turn on when the local copy is ready, with progress shown.
- **Fetch fails.** Those features stay off, the local copy's status bar item says why, and Lo
  retries.
- **Disk full.** The local copy's item offers to clear the cache.
- **Missing revisions.** A force-pushed revision that GitHub no longer has, and that Lo never
  fetched, is shown as "no longer available."

### Stacks

- **Busy repos.** Stacks are found among the 1,000 open PRs opened most recently. A note says so
  when a repo has more.
- **The layer below is gone.** When GitHub no longer has the commit a layer starts at, the layer is
  compared with its base branch, and its stack says why.
- **Conversion fails partway.** Lo lists what it changed and offers to put the base branches back.
- **Async merge fails.** Branch rules are checked when the merge runs, so a failure can arrive late.
  Lo shows GitHub's reason, and which layers went in, if any did, since GitHub's docs disagree on
  whether a stack merge is all or nothing.

### Merging

- **A lost answer.** When Lo can't tell whether a merge, queue entry, auto-merge change or removal
  went, it says so ("Lo can’t tell whether #4821 merged."), and reads the PR or the queue again to
  find out. No other merge write goes to that PR until a read made since shows how it ended. "Ask
  GitHub again" is that read, and Lo never sends the write again by itself. A merge GitHub took ends
  whether or not Lo is open, and after a restart the PR's own read shows how.
- **Too much to read.** With over 1,000 checks on a head, or over 1,000 open PRs in the repo, Lo
  can't tell what it needs to merge safely. It says so and sends you to GitHub.
- **A push after approval.** When Lo can't turn auto-merge off after one, its banner says so and
  that the push would merge with your approval. When it can't tell whether the push would, it says
  that and reads again.
- **What Lo doesn't show.** It doesn't name the files a conflict is in, and for auto-merge it says
  who turned it on and with which method, but not when. It names the rules it doesn't check without
  checking them.

### Overviews

- **An artifact that can't be read.** If it's invalid, too large or in a newer format, the overview
  view says why, and the PR opens on its timeline.
- **A broken code reference.** If a block's file or lines don't exist at the overview's commit, that
  block says so and the rest of the overview shows.
- **A broken figure.** A figure that's missing or fails sanitizing is left out, with a note in its
  place.
- **A missing commit.** If the overview's commit was force-pushed away and Lo never fetched it, the
  text still shows, and its code blocks say the code is no longer available.
- **Fetch fails.** The PR opens on its timeline, and Lo retries.

### The file tree

Until the tree can load, the panel shows only the PR's changed files.

### Hostile files

A file that's too costly to parse is shown without highlighting and left out of the syntax index.
Each job in the background process stops at a time limit, and the process restarts past a memory
cap.

### Language servers

If one fails to download, crashes or hangs, syntax-based navigation carries on, the status bar shows
the problem, and a button restarts it. A repo's language servers stop when its last tab closes, and
a server stops once its PR hasn't been on screen for 10 minutes.

## 14. Testing

- **Logic.** Unit tests cover the packages that make decisions, each fed from fixtures: stacks,
  revisions, moved-code detection, review order, PR links, why a PR can't merge, and every outcome
  of approve and ship.
- **Git.** Tests build real repos in temporary folders and script commits, rebases, force-pushes and
  squash merges. They check rebase-aware comparison, fetching PR refs into a partial clone, and that
  fetched revisions survive a force-push.
- **GitHub API.** GraphQL queries are checked against GitHub's published schema and generate
  TypeScript types, so a change on GitHub's side fails the build rather than the app. Responses
  recorded from a real test repo are replayed by a fake server, so tests run offline and fast.
- **Artifacts.** One set of example artifacts, valid and invalid, is run through both Lo and the
  checker, so the two can't disagree.
- **The app.** Playwright drives the real app against replayed responses, checks what each key does
  and compares screenshots. It also checks that every default key maps to an action and that `?`
  lists them all.
- **Hostile input.** Oversized files, deeply nested Markdown, and SVGs and artifacts carrying
  scripts are part of the fixtures.
- **End to end.** Scripted scenarios in a public test repo, driven by a bot account, cover stacks, a
  merge queue, force-pushes and fork PRs. They run nightly and on demand. A proxy records every host
  Lo contacts, and the run fails on any host other than GitHub and the language-server download
  sources.
- **CI.** Tests, linting and type checks run on Linux for every PR and again in the merge queue. A
  Mac runner builds, signs and notarizes release builds.
- **Performance.** Time to the first diff and scrolling smoothness are measured on a large fixture
  PR, against budgets set once the diff view exists.

## 15. Decisions and trade-offs

| Decision                                                                         | Rejected                                                           | Why                                                                                                                                                                           | Cost we accept                                                                     |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Electron and TypeScript                                                          | A native toolkit; a Rust backend behind a web view; forking an IDE | Overviews are web content, tests can drive the real app, and one language can be shared with a mobile app                                                                     | A larger download and more memory than a native app                                |
| CodeMirror 6 for every code view                                                 | Monaco; a read-only diff renderer                                  | Many editors on one page stay cheap, it's styled with plain CSS, it works on phones and it has a real text cursor                                                             | Lo builds thread alignment, the many-file scroll, the peek and the references list |
| tree-sitter for highlighting                                                     | CodeMirror's own grammars                                          | One set of grammars covers highlighting, navigation and the later syntax-aware diff                                                                                           | A bridge between tree-sitter and CodeMirror                                        |
| Logic in core packages that run anywhere                                         | Logic inside the app                                               | A mobile app can reuse it                                                                                                                                                     | Those packages can't touch git, files, processes, Node or Electron                 |
| Overviews are structured documents Lo renders                                    | Sandboxed HTML pages                                               | They follow Lo's design, never run scripts and tell Lo every code reference                                                                                                   | Layout is limited to Lo's blocks, with no agent-written widgets in v1              |
| Overviews live in a hidden ref per PR                                            | One shared branch; a PR comment; a Lo backend                      | No size limit, nothing visible on GitHub, no races between agents, no server                                                                                                  | They can't be read on github.com, and writing one needs push access                |
| One overview per PR                                                              | One per writer                                                     | One explanation to read, with no picker                                                                                                                                       | A new one replaces the last for everyone                                           |
| Code in overviews by reference                                                   | Code written into the artifact                                     | An overview can't misquote the PR                                                                                                                                             | A block needs the code loaded before it shows                                      |
| Lo never writes an overview                                                      | An action that runs a local agent                                  | Lo calls no model                                                                                                                                                             | One copy and paste to get an overview                                              |
| The whole repo in the file tree                                                  | A list of changed files                                            | Changed files are seen in context                                                                                                                                             | More to load in large repos                                                        |
| Language servers in v1                                                           | Syntax-based navigation only in v1                                 | Types and exact references are what GitHub can't show                                                                                                                         | Each server needs its own download and start-up handling                           |
| A fixed list of language servers, each from its project's own source             | An extension store                                                 | Official sources only: npm, NuGet, GitHub, HashiCorp, Eclipse, Go's module proxy, nodejs.org, each toolchain's own site and Apple's tools, with every download pinned by hash | New languages arrive only with Lo releases                                         |
| The syntax-aware diff comes later                                                | In v1                                                              | Its algorithm must be written from scratch                                                                                                                                    | v1 has moved-code detection only                                                   |
| Git is optional                                                                  | Git is required                                                    | A PR is useful from GitHub's API alone                                                                                                                                        | Two ways to load a PR                                                              |
| Mac release, Linux preview as deb and rpm                                        | Mac only; both as full releases                                    | The tests already run on Linux                                                                                                                                                | The Linux build is unpolished in v1                                                |
| GPL-3.0 app, MIT skill and format                                                | Permissive everywhere; a source-available license                  | Nobody can ship a closed rebrand, and the format stays easy to adopt                                                                                                          | Contributors sign an agreement so the license can change later                     |
| OAuth app                                                                        | GitHub App                                                         | A GitHub App can't comment, approve or merge where it isn't installed, which rules out most open-source repos                                                                 | Broad `repo` scope, and orgs that restrict apps must approve Lo                    |
| No backend, polling                                                              | A server receiving webhooks                                        | Nothing to run, pay for or trust                                                                                                                                              | Up to 15–30 seconds of lag, and a rate limit to budget                             |
| A local partial clone                                                            | GitHub's API alone                                                 | Whole-file context, navigation, rebase-aware comparison and language servers all need one                                                                                     | git is required, and repos take disk space                                         |
| Three stack rules, including shared commits                                      | Base-branch chains only                                            | Catches agents branching off another branch but targeting `main`, and stacks from forks                                                                                       | More data per repo, and the nearest-parent rule can guess wrong                    |
| Convert chains to GitHub stacks to merge them                                    | Merging one layer at a time                                        | A GitHub stack merges in one request, including through the queue                                                                                                             | It changes PR base branches for everyone, on a feature in preview                  |
| Language servers only for trusted repos and same-repo PRs                        | Language servers everywhere                                        | Servers are large programs that read a repo's code and settings with no sandbox, and a checkout can still steer them                                                          | One click per repo, and PRs from forks get syntax-based navigation only            |
| No dependency types                                                              | Installing dependencies                                            | Every repo installs differently, and Lo never runs a repo's code                                                                                                              | Symbols from dependencies show their import only                                   |
| Attachments uploaded the way `gh --attach` does                                  | No attachments                                                     | You want GIFs in reviews                                                                                                                                                      | The upload endpoint is undocumented and needs write access                         |
| Comments collect into a pending review                                           | Posting each one right away                                        | Agents act on each comment as it lands                                                                                                                                        | One extra key to post a single comment                                             |
| Read-only: no "Update branch," applying suggestions, PR edits or branch deletion | Matching GitHub's web UI                                           | Lo changes nothing but reviews, comments and merges                                                                                                                           | Those actions stay on GitHub                                                       |
| Several accounts in v1                                                           | One account                                                        | You work across several GitHub accounts                                                                                                                                       | Choosing an account for each owner, plus account names shown everywhere            |
| Signed download and Homebrew                                                     | Mac App Store                                                      | App Store rules forbid downloading and running code                                                                                                                           | No App Store discovery or updates                                                  |
