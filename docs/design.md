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
  that contain another PR's commits. Stacks show as a tree, you review them layer by layer, and they
  merge as one unit wherever GitHub allows.
- **Diffs.** Side by side by default, with moved-code detection and rebase-aware "changes since my
  last review".
- **Code.** Syntax-based navigation everywhere, plus types, hovers and exact references from
  language servers on repos you trust.
- **Merging.** Approve and ship on one key, a clear "why can't this merge" panel, and full merge
  queue support.

### Principles

- **Read-only.** Lo never edits files or pushes commits. It writes to GitHub only to review and
  merge: comments and their attachments, reviews, viewed marks, merges, queue and auto-merge
  changes, and changing a PR's base branch to form a stack.
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

v1 ships for the Mac as a signed, notarized download and a Homebrew cask, with Linux builds
published as a preview in deb and rpm packages. It skips the Mac App Store, whose rules forbid
downloading and running code, which language servers need.

The app is open source under GPL-3.0. The overview skill and the artifact format are MIT, so teams
can copy them into their repos and other tools can read artifacts.

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
| `syntax`   | Highlighting and the syntax index, built with tree-sitter                                                  | Desktop, background process |
| `lsp`      | Starting, feeding and stopping language servers                                                            | Desktop, main process       |
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

- **Main process.** It holds the GitHub tokens, makes every GitHub call and owns the database. It
  starts git and language servers as child processes.
- **Window.** It draws the interface in a sandbox with no access to Node or the file system. It asks
  the main process for data through a small, typed set of messages, and it never sees a token.
- **Background process.** Parsing and highlighting, the syntax index, diffs and moved-code
  detection, and Markdown and artifact parsing run in one background process, each job with a time
  limit. The main process restarts it when its memory passes a cap, so a hostile file can't freeze
  Lo or exhaust its memory. It gets no tokens: the main process reads git and hands it file
  contents, and the window gets its results directly.

### Untrusted content

Everything a PR contains is untrusted: code, Markdown, images and artifacts.

- **Scripts.** The window loads only Lo's own files, and a content security policy blocks every
  other script.
- **Markdown and SVG** are sanitized before they're shown.
- **Images** load through the main process, which adds the account's token for private repos.
- **Links** open only web addresses, in your default browser. The window can't navigate away or open
  new windows.

### Local data

- **Database.** A SQLite file holds cached PR data, "last seen" revisions, the account to use per
  owner, trusted repos, recent PRs and unsent comment text.
- **Tokens** are encrypted with a key kept in the system keychain, and stored in the database, one
  per account. On Linux that's a keyring, such as GNOME Keyring or KWallet: when none answers, Lo
  asks for one rather than keep a token as good as unencrypted.
- **Repo copies.** Each repo gets a bare partial clone in Lo's cache folder.

### Per-system code

The keychain, link handling, menus and key modifiers sit behind small interfaces, with a Mac and a
Linux implementation of each.

### Updates

Lo checks GitHub Releases and offers to install a newer version. Homebrew installs update through
Homebrew.

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
- **Polling.** The open PR and its queue are checked every 15–30 seconds, everything else less
  often, and everything slows to every 5 minutes while Lo is in the background. Each poll asks first
  whether anything changed, and only then fetches the details. REST calls use ETags, so unchanged
  answers don't count against the rate limit.
- **Rate limit.** Lo tracks how much of the limit is left, slows polling when it runs low and tells
  you when it does.

### The local copy

- **What it fetches.** Each repo gets a bare partial clone. Lo fetches PR heads
  (`refs/pull/<n>/head`, including PRs from forks), base branches and each PR's artifact ref
  (`refs/lo/pr/<n>`) as it needs them. It keeps every revision it has fetched under its own refs, so
  force-pushed commits survive.
- **Sign-in.** Git signs in with the account's token, and your git config is never touched.
- **Checkouts.** Trusted repos get a checkout at the PR head for language servers. The old side is
  read straight from git.
- **Before the copy is ready.** Lo shows GitHub's own diff, builds the file tree from GitHub's API
  and loads the artifact through the API. Whole-file context, navigation and rebase-aware comparison
  turn on when the copy arrives, with progress shown.
- **Cleanup.** Settings shows how much space the cache uses and can clear it. Repos unused for 30
  days are removed. The cache also has a size cap, 10 GB by default and changeable in Settings, and
  past it the least recently used copies are removed.

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
  local copy of the repo.
- **Several layers.** The whole stack, or any run of layers, can be viewed as one diff.
- **After a merge.** When a lower layer is squash-merged, the layer above is compared against the
  merged layer's last commit. Changes that already landed stay hidden, and the layer is marked
  "needs rebase."

### The stack tree

A sidebar shows the tree. Each layer shows its title, number, author, review state, checks, queue
state, any "needs rebase" mark, whether it has an overview, and how many of its files you've viewed.
`]s` and `[s` walk the tree from top to bottom, finishing one branch before starting the next. A
link to any layer opens the whole stack in one tab, at that layer.

### Turning chains into GitHub stacks

"Make this a GitHub stack" lists what will change and asks before doing anything:

1. Any PR found through shared commits gets its base branch pointed at the head branch of the PR
   below it.
2. Lo creates the stack through the Stacks API, from the bottom PR to the top.

GitHub stacks can't branch, so for a tree Lo converts the path through the layer you're on. The
option isn't offered when a PR comes from a fork, when the repo doesn't have stacks turned on, or
when a PR is already in a merge queue.

## 5. The file tree

The left panel shows the repo's files as a tree, at the commit on screen.

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

- **Layout.** Side-by-side by default. `Tab` switches sides, and one key switches to inline.
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

Lines the overview explains carry a marker beside them. Opening it shows the explanation in place,
with a link to that point in the overview.

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
- **Changed since viewed.** When a push changes a viewed file, GitHub resets it to "changed since
  viewed." Lo remembers, on this computer, the revision at which you marked each file viewed, and
  opens the file to what changed since then. For a file marked viewed elsewhere, it shows what
  changed since your last review instead.
- **Keys.** `e` marks a file viewed and moves to the next unviewed file. Pressing it again on a
  viewed file clears the mark.

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
- **Forks.** Lo looks in the base repo, then the PR's fork, and labels an overview that came from
  the fork.
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
- **Threads on a block.** A code block shows the review threads on its lines. A comment written on
  the block is an ordinary review comment on those lines. GitHub only accepts line comments on lines
  in the diff, so for other blocks Lo offers a file-level comment when the file is in the PR, and a
  comment on the PR itself otherwise.
- **From the block to the code.** Following a block jumps to the diff at that spot, or to the
  whole-file view when the code is outside the diff. `⌃o` returns to the same place in the overview.
  A menu and a key open the code beside the overview instead.
- **From the code to the overview.** In the diff, lines the overview explains carry a marker
  (section 6).

### In the PR tab

The overview is a third view in the middle of the tab, beside the diff and the timeline. When a PR
has one, it opens first. A setting makes the diff open first instead.

It appears as soon as its text arrives, and its code blocks fill in as the code loads. Every block
and link can be reached and opened from the keyboard.

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
  of them.
- **How it answers.** The index answers inside the app, for both sides of the diff, the peek and the
  whole-file view.
- **Name collisions.** When a name matches several definitions, the peek lists them all: same file
  first, then same directory, then a matching import.

### Language servers, on trusted repos

- **What they add.** Type hovers, inline type hints (off by default, toggled with a key), and exact
  definitions and references.
- **How they run.** Lo starts each one as a child process on a checkout of the PR head, and
  CodeMirror talks to it through its language-server client. They serve the new side only. The old
  side keeps syntax-based navigation.
- **Precedence.** Language server answers win. Syntax-based answers fill in while a language server
  starts up.
- **Dependencies.** Dependencies are never installed, so a symbol from one shows its import and
  nothing more.

### Languages

- **Grammars** for highlighting and syntax-based navigation ship inside Lo: TypeScript, JavaScript,
  Python, Rust, Go, Swift, Kotlin, Terraform, Ruby, Java, C#, PHP and Elixir, plus common config and
  markup formats.
- **Language servers** come from a fixed list built into Lo, one per language: TypeScript and
  JavaScript, Python, Rust, Go, Swift, Kotlin, Terraform, Ruby, Java, C# and PHP. Each is downloaded
  on first use from its official source, only for trusted repos, and Lo uses an installed copy when
  it finds one.
- **Java and Kotlin.** Their servers read the project's Gradle or Maven build to understand it,
  which is one reason language servers need trust.

### Trust

Language servers run only when the repo is trusted and the PR's branch lives in that repo. A PR from
a fork is someone else's code, even in a repo you trust.

- **Untrusted repo.** A banner says "Language servers are off for this repo," with buttons to trust
  the repo or dismiss the banner. You're asked once per repo.
- **PR from a fork.** The banner offers to trust that one PR instead.
- **Settings.** Settings lists trusted repos and PRs, and you can remove any of them.

### Navigating

- **Peek.** `gd` opens the definition in a peek under the line. One key opens the full file, read
  only, in the same tab, and `⌃o` brings you back to the diff.
- **Into the diff.** If the definition is in a file the PR changes, Lo jumps to that spot in the
  diff instead of the plain file.
- **Other keys.** `gr` lists references in a panel. `K` shows the type hover. `⌃o` and `⌃i` go back
  and forward.

## 10. Comments, reviews and the timeline

### Comments

- **Where.** `c` comments on the current line, and `v` then `c` on a range of lines, on either side
  of the diff. A key on a file's header leaves a file-level comment. Comments can also be written on
  an overview's code blocks (section 8).
- **In the diff.** Threads appear under their line. Unresolved threads start open, and resolved ones
  start collapsed.
- **Threads.** You can reply, resolve and unresolve, and edit or delete your own comments.
- **Writing.** The comment box is a CodeMirror editor with Markdown highlighting, Vim keys and a
  preview toggle.
- **Suggestions.** `s` opens the comment box with the selected lines in a `suggestion` block, ready
  to edit. It works on the new side only, because GitHub can only apply suggestions there. Applying
  them happens on GitHub.
- **Outdated threads.** A thread whose line has since changed appears where it was written when you
  view that revision, and is labeled outdated elsewhere.
- **Attachments.** Drag, paste or pick a file (PNG, JPEG, GIF, WebP, SVG, MP4, MOV or WebM) into any
  comment box, including review comments and the review summary. Lo uploads it the way `gh --attach`
  does and inserts the Markdown. Images and GIFs can be up to 10 MB, and videos 10 MB on free plans
  or 100 MB on paid ones. Uploading needs write access to the repo. Where you don't have it, Lo says
  so, and you can still paste or drop a GIF's web address, which goes in as an image. If GitHub
  won't take Lo's sign-in for uploads, Lo uses an imported `gh` sign-in, and without one it accepts
  web addresses only. There's no built-in GIF search.

### Reviews

- **Pending review.** Comments collect into a pending review by default. It's stored on GitHub, so
  it survives quitting Lo and shows as pending on the web. `C` posts one comment right away instead.
- **Submitting.** `⌘⏎` opens the submit dialog. It has a summary box, a choice of Comment, Approve
  or Request changes, the number of pending comments, and the account you're acting as. On your own
  PRs only Comment is offered, since GitHub allows nothing else there.
- **Approve and ship.** `⌘⇧⏎`, described in section 11.

### Threads panel

Lists every thread on the PR. It can show unresolved threads, all threads or only yours, and labels
outdated ones. `]t` and `[t` jump between threads.

### Timeline

The PR's full GitHub timeline: the description, comments, reviews, pushes and force-pushes, CI
results, labels, assignments, review requests, cross-references, merges, queue events and
deployments. Markdown is rendered, GIFs play, and images load with the account's token so images in
private repos show. A comment box at the bottom posts a comment on the PR itself. The PR's title,
description, labels, reviewers and draft status are read-only in Lo.

## 11. Merging and the merge queue

### Merge status

Every PR tab shows a one-line merge status in its header, and `m` opens the merge panel. When a PR
can't merge, the panel lists why: missing approvals (including which code owners), required checks
that failed, are running or haven't reported (each linked to its run), unresolved conversations,
conflicts, an out-of-date branch, draft status, and other rules on the branch. Lo pieces this
together from several API calls. If GitHub reports a block Lo can't explain, it says so and links to
the PR on GitHub.

### Merging

- **Method.** Only the methods the repo allows are offered. Lo remembers the last one you used in
  each repo. A squash commit's title and message start from the repo's setting and can be edited.
- **Queue.** If the base branch requires a merge queue, the button becomes "Add to merge queue," and
  the queue's own settings decide the method and message.
- **Confirmation.** Every merge asks first. The confirmation names the account, the method, the
  target branch and, for a stack, every layer that will merge.
- **Branches.** Lo never deletes branches. The repo's own auto-delete setting applies.
- **Out-of-date branches.** Lo shows that a branch is out of date but doesn't offer GitHub's "Update
  branch," because that adds a commit to the PR. The author or agent updates it.

### Approve and ship

`⌘⇧⏎` approves (skipped on your own PRs), then merges or joins the queue if nothing blocks it. If
it's only waiting on checks or other approvals, Lo turns on auto-merge so the PR goes in once ready.
If something waiting won't fix blocks it (conflicts, failed checks, changes requested), it stops
after approving and shows why. One confirmation lists exactly what will happen.

### Stacks

Merging a layer of a GitHub stack merges every layer below it, as one unit: they merge, join the
queue or don't merge at all. Lo submits it through the async merge API and shows progress until it's
done. Other chains are offered "Make this a GitHub stack" first (section 4). When that isn't
possible, Lo merges one layer at a time: it merges the bottom PR, points the next one at the root
branch and marks it "needs rebase."

### The merge queue

- **Queue view.** For each base branch: every entry with its position, state, time in the queue and
  estimated time to merge, which entries are being tested together, and your PRs highlighted.
- **Removals.** When a PR leaves the queue, Lo says why (failed checks, a conflict, a timeout or
  someone removed it) and links to the failing check.
- **Controls.** Remove a PR from the queue, jump it to the front if you're allowed, and turn
  auto-merge on or off.
- **Admin override.** Offered only to people allowed to bypass the rules. To confirm, you type the
  PR's number.

## 12. Keyboard, windows and opening links

### Keys

Vim-style single keys by default, from CodeMirror's Vim package. Arrow keys also work. Nothing in a
diff is editable, so Vim's insert mode exists only in comment boxes. Every key can be remapped in
the keymap file, `~/.config/lo/keymap`. `?` shows every key.

| What            | Keys                                                                                                                                                                                                                                     |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Move            | `j`/`k` line, `w`/`b` word, `gg`/`G` top and bottom                                                                                                                                                                                      |
| Jump            | `]c`/`[c` change, `]f`/`[f` file, `]t`/`[t` thread, `]s`/`[s` stack layer                                                                                                                                                                |
| Act             | `v` select lines, `c` comment, `C` comment right away, `s` suggest, `e` mark viewed, `Tab` switch side                                                                                                                                   |
| Threads         | `r` reply, `x` resolve or unresolve, `i` edit your comment, `dd` delete your comment                                                                                                                                                     |
| Code            | `gd` definition, `gr` references, `K` type hover, `gh` inline type hints, `⌃o`/`⌃i` back and forward                                                                                                                                     |
| Copy and open   | `yy` the line, `yl` a link to it, `yp` the file's path, `gf` the whole file, `gx` on GitHub                                                                                                                                              |
| Review          | `m` merge panel, `a` merge when ready (in the merge panel), `⌘⏎` submit review, `⌘⇧⏎` approve and ship, `gq` the merge queue, `gS` make this a GitHub stack                                                                              |
| Find            | `⌘L` open PR (`⌘O` too on macOS), `⌘P` files, `⌘⇧P` command palette, `/` search, `n`/`N` next and previous match                                                                                                                         |
| View            | `` ` `` next middle view (overview, diff, timeline), `~` previous, `gv` compare revisions                                                                                                                                                |
| Files           | `-` go to the file tree at the file on screen. In the tree: `t` tree or review order, `f` changed files only, `l`/`h` (or `→`/`←`) open and close a folder, `zR`/`zM` open and close all, `⏎` show the file, `e` mark viewed, `Esc` back |
| Overview        | `]b`/`[b` next and previous block, `⏎` follow a block to its code, `o` open its code beside the overview (`o` again or `Esc` to close), `Tab` next part of a figure, `←`/`→` walkthrough step or tab, `ya` copy a prompt for an agent    |
| Panels          | `⌘\` left panel, `⌘⇧\` threads panel. In the threads panel: `f` unresolved, all or yours. In the stack tree: `v` choose a run of layers, `j`/`k` to grow it, `⏎` to view it as one diff                                                  |
| Diff view       | `gi` inline or side by side, `gw` hide or show whitespace, `zo`/`zc` expand and collapse unchanged code, `zR` the whole file, `za` open or close a collapsed file                                                                        |
| Comment box     | `⌘⏎` add to review, `⌥⏎` comment now, `⌘⇧V` write or preview, `Esc` leave insert mode, `Esc Esc` close and keep the draft                                                                                                                |
| Merge queue     | `x` remove, `J` jump to the front, `a` auto-merge, `⏎` open the PR                                                                                                                                                                       |
| Revision picker | `j`/`k` move, `Space` set an end, `⏎` compare                                                                                                                                                                                            |
| Palettes        | `⏎` open, `⌘⏎` the other way (a new window, the whole file), `Tab` changed files only in the file finder, `⌥⏎` show an action's key                                                                                                      |
| Tabs and window | `⌘1`–`⌘9` a tab, `⌘⇧]`/`⌘⇧[` or `⌃⇥`/`⌃⇧⇥` next and previous tab, `⌘W` close the tab, `⌘,` settings, `?` every key, `Menu` or `⇧F10` the right-click menu of what has focus, `g ,` open the keymap file                                  |

Copying is always `y` plus a letter; there's no single-key `y`. `⌃o` returns from anywhere a key
took you: from the code back to the overview block, from a definition back to the diff.

**On Linux,** Ctrl takes the place of `⌘` in every key above, and the app shows each platform its
own. Vim's `⌃` keys keep their meanings, so two keys differ from what that rule would give, on both
systems: `⌘L` opens a PR, because `⌘O` would become Ctrl+O, which is `⌃o` (back); and `⌥⏎` shows an
action's key in the palettes, because `⌃⏎` would be the same as `⌘⏎`. `⌃⇥` and `⌃⇧⇥` also switch
tabs on both systems. In a comment box in insert mode, Ctrl+C, Ctrl+X, Ctrl+V, Ctrl+A and Ctrl+Z
keep their usual editing meanings, and Ctrl+W deletes the previous word, as in Vim, instead of
closing the tab. Every action that has a key is also in a right-click menu where one makes sense.

### Window

One window, with a tab per PR. A whole stack lives in one tab. Opening a link to a PR that's already
open switches to its tab, at that layer.

- **Header.** The PR's title, number and author, the account you're acting as, the merge status and
  the revision picker.
- **Left.** The stack tree, with the file tree below it.
- **Middle.** The overview, the diff or the timeline. One key cycles between them. When code is
  opened beside the overview, the middle splits in two and the diff shows in its inline layout.
- **Right.** The threads panel.

Each panel opens and closes with a key. With no PR open, Lo shows the PRs you opened recently,
across all accounts.

On first launch, and whenever no account is signed in, Lo shows a welcome screen. From the top, it
has:

- the Lo mark, a headline and a line on what Lo does;
- "Sign in with GitHub", the default action (`⏎`), which starts GitHub's device flow;
- "Import from gh", when the `gh` CLI is found, with how many accounts `gh` is signed in to. It
  lists those accounts to import;
- a box to open a public PR by its link without signing in, with an "Open" button;
- three optional set-up steps, each with a one-line description and its own button: installing the
  `lo` command, sending PR links from other apps to Lo, and installing the overview skill. Sending
  PR links opens a dialog with ready-made rules for Finicky, Velja and Choosy to copy, and a link to
  the docs. Lo registers as a link handler when it's installed, so the step registers nothing;
- when git is missing or too old, a notice at the bottom with how to install it and a "Check again"
  button, which finds git without restarting Lo.

### Settings

Settings live in a file in `~/.config/lo/` and in a Settings screen. They cover accounts, trusted
repos and PRs, the theme, the cache, and whether a PR opens on its overview or its diff.

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
  the merge, and Lo shows the new revision with the changes since the one you saw.
- **Approve and ship** checks for a newer push before it does anything, and if there is one it stops
  before approving.

### GitHub

- **Offline.** Cached PRs open with a banner showing when the data is from. You can still write
  comments: they're kept on this computer as drafts, and you post them yourself once you're back
  online. Nothing posts by itself. Reviewing and merging are off until then.
- **Unsent text.** Text in comment boxes is saved on this computer until it's posted, so a crash or
  restart doesn't lose it.
- **Rate limit used up.** A banner shows when it resets. Polling pauses until then, and so does
  writing, as it does for a minute when GitHub turns a comment away as sent too fast. A comment,
  review or merge asked for meanwhile isn't sent, and says when it can be. A change to a stack's
  base branches waits, and goes once the pause is over.
- **Signed out.** If an account's token is revoked, that account's tabs ask you to sign in again.
  Other accounts keep working.
- **Single sign-on.** If an org requires SSO approval for the token, Lo shows GitHub's link to grant
  it.
- **PR state changes.** When a PR is closed, merged or reopened while it's open in Lo, the tab
  updates and the actions change to match.

### The local copy

- **First open.** The diff appears straight away from GitHub's API. Whole-file context, navigation
  and rebase-aware comparison turn on when the local copy is ready, with progress shown.
- **Fetch fails.** Those features stay off, a banner explains why, and Lo retries.
- **Disk full.** A banner offers to clear the cache.
- **Missing revisions.** A force-pushed revision that GitHub no longer has, and that Lo never
  fetched, is shown as "no longer available."

### Stacks

- **Busy repos.** Stacks are found among the 1,000 most recently updated open PRs. A note says so
  when a repo has more.
- **Conversion fails partway.** Lo lists what it changed and offers to put the base branches back.
- **Async merge fails.** Branch rules are checked when the merge runs, so a failure can arrive late.
  Lo shows GitHub's reason.

### Overviews

- **An artifact that can't be read.** If it's invalid, too large or in a newer format, the overview
  view says why, and the PR opens on its diff.
- **A broken code reference.** If a block's file or lines don't exist at the overview's commit, that
  block says so and the rest of the overview shows.
- **A broken figure.** A figure that's missing or fails sanitizing is left out, with a note in its
  place.
- **A missing commit.** If the overview's commit was force-pushed away and Lo never fetched it, the
  text still shows, and its code blocks say the code is no longer available.
- **Fetch fails.** The PR opens on its diff, and Lo retries.

### The file tree

Until the tree can load, the panel shows only the PR's changed files.

### Hostile files

A file that's too costly to parse is shown without highlighting and left out of the syntax index.
Each job in the background process stops at a time limit, and the process restarts past a memory
cap.

### Language servers

If one fails to download, crashes or hangs, syntax-based navigation carries on, the status bar shows
the problem, and a button restarts it. A repo's language servers stop when its last tab closes.

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

| Decision                                                                         | Rejected                                                           | Why                                                                                                               | Cost we accept                                                                     |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Electron and TypeScript                                                          | A native toolkit; a Rust backend behind a web view; forking an IDE | Overviews are web content, tests can drive the real app, and one language can be shared with a mobile app         | A larger download and more memory than a native app                                |
| CodeMirror 6 for every code view                                                 | Monaco; a read-only diff renderer                                  | Many editors on one page stay cheap, it's styled with plain CSS, it works on phones and it has a real text cursor | Lo builds thread alignment, the many-file scroll, the peek and the references list |
| tree-sitter for highlighting                                                     | CodeMirror's own grammars                                          | One set of grammars covers highlighting, navigation and the later syntax-aware diff                               | A bridge between tree-sitter and CodeMirror                                        |
| Logic in core packages that run anywhere                                         | Logic inside the app                                               | A mobile app can reuse it                                                                                         | Those packages can't touch git, files, processes, Node or Electron                 |
| Overviews are structured documents Lo renders                                    | Sandboxed HTML pages                                               | They follow Lo's design, never run scripts and tell Lo every code reference                                       | Layout is limited to Lo's blocks, with no agent-written widgets in v1              |
| Overviews live in a hidden ref per PR                                            | One shared branch; a PR comment; a Lo backend                      | No size limit, nothing visible on GitHub, no races between agents, no server                                      | They can't be read on github.com, and writing one needs push access                |
| One overview per PR                                                              | One per writer                                                     | One explanation to read, with no picker                                                                           | A new one replaces the last for everyone                                           |
| Code in overviews by reference                                                   | Code written into the artifact                                     | An overview can't misquote the PR                                                                                 | A block needs the code loaded before it shows                                      |
| Lo never writes an overview                                                      | An action that runs a local agent                                  | Lo calls no model                                                                                                 | One copy and paste to get an overview                                              |
| The whole repo in the file tree                                                  | A list of changed files                                            | Changed files are seen in context                                                                                 | More to load in large repos                                                        |
| Language servers for eleven languages in v1                                      | Syntax-based navigation only in v1                                 | Types and exact references are what GitHub can't show                                                             | Each server needs its own download and start-up handling                           |
| A fixed list of language servers built into Lo                                   | An extension store                                                 | Nothing is fetched from a third party's store                                                                     | New languages arrive only with Lo releases                                         |
| The syntax-aware diff comes later                                                | In v1                                                              | Its algorithm must be written from scratch                                                                        | v1 has moved-code detection only                                                   |
| Git is optional                                                                  | Git is required                                                    | A PR is useful from GitHub's API alone                                                                            | Two ways to load a PR                                                              |
| Mac release, Linux preview as deb and rpm                                        | Mac only; both as full releases                                    | The tests already run on Linux                                                                                    | The Linux build is unpolished in v1                                                |
| GPL-3.0 app, MIT skill and format                                                | Permissive everywhere; a source-available license                  | Nobody can ship a closed rebrand, and the format stays easy to adopt                                              | Contributors sign an agreement so the license can change later                     |
| OAuth app                                                                        | GitHub App                                                         | A GitHub App can't comment, approve or merge where it isn't installed, which rules out most open-source repos     | Broad `repo` scope, and orgs that restrict apps must approve Lo                    |
| No backend, polling                                                              | A server receiving webhooks                                        | Nothing to run, pay for or trust                                                                                  | Up to 15–30 seconds of lag, and a rate limit to budget                             |
| A local partial clone                                                            | GitHub's API alone                                                 | Whole-file context, navigation, rebase-aware comparison and language servers all need one                         | git is required, and repos take disk space                                         |
| Three stack rules, including shared commits                                      | Base-branch chains only                                            | Catches agents branching off another branch but targeting `main`, and stacks from forks                           | More data per repo, and the nearest-parent rule can guess wrong                    |
| Convert chains to GitHub stacks to merge them                                    | Merging one layer at a time                                        | Stacks merge as one unit, including through the queue                                                             | It changes PR base branches for everyone, on a feature in preview                  |
| Language servers only for trusted repos and same-repo PRs                        | Language servers everywhere                                        | Some language servers run code from the repo                                                                      | One click per repo, and PRs from forks get syntax-based navigation only            |
| No dependency types                                                              | Installing dependencies                                            | Every repo installs differently, and Lo never runs a repo's code                                                  | Symbols from dependencies show their import only                                   |
| Attachments uploaded the way `gh --attach` does                                  | No attachments                                                     | You want GIFs in reviews                                                                                          | The upload endpoint is undocumented and needs write access                         |
| Comments collect into a pending review                                           | Posting each one right away                                        | Agents act on each comment as it lands                                                                            | One extra key to post a single comment                                             |
| Read-only: no "Update branch," applying suggestions, PR edits or branch deletion | Matching GitHub's web UI                                           | Lo changes nothing but reviews, comments and merges                                                               | Those actions stay on GitHub                                                       |
| Several accounts in v1                                                           | One account                                                        | You work across several GitHub accounts                                                                           | Choosing an account for each owner, plus account names shown everywhere            |
| Signed download and Homebrew                                                     | Mac App Store                                                      | App Store rules forbid downloading and running code                                                               | No App Store discovery or updates                                                  |
