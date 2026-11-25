# Writing the interface

Lo’s copy is a set of labels. A label names the reader’s thing and its state. A sentence appears
only when it carries a reason the reader needs, and then it’s one line.

This file covers every string a person reads: the window, the menus and the system’s dialogs.

- **A line** is 90 characters at most.
- **A word limit** counts a name, a number or a piece of code as one word.
- **Each pair** is a string Lo shipped and its rewrite, with the file it came from. Paths start at
  `apps/desktop/src/features/` unless they start with `packages/`.

## Rules

1. **The thing is the subject, not Lo.** “Couldn’t send the comment”, not “Lo couldn’t send your
   comment”. Lo never does anything in a string. Name it only as a thing: the app by name, the app a
   link opens in, or a version of it. “Welcome to Lo”, “Open in Lo”, “Lo 0.2.0 is available”. Only a
   version’s name starts a string with “Lo”. Say “you” only where a line is unclear without it:
   “Offline”, not “You’re offline”. Never “we” or “I”.
2. **One fact, one action.** A title says what happened. A reason follows only if it changes what
   the reader does. The button is the next step. Nothing restates the title.
3. **The reader’s words.** Where [Terms](#terms) names a thing, use its word. No refs, job names,
   status codes, milliseconds or names from the code. GitHub’s and Git’s own text sits behind
   Details.
4. **Format carries structure.**
   - Steps are a numbered list.
   - Code, commands, paths, branches and commit IDs are code (`code-text`), with Copy when they’re
     meant to be pasted.
   - Keys are chips (`Key`), never characters in a string.
   - A place in Lo is a path: Settings › Accounts.
5. **No hedging, no reassurance, no narration.**
   - Hedging: “may have”, “likely”, “should”, “try to”. When the result isn’t known, say that as the
     fact: “Merge not confirmed”.
   - Reassurance: “Nothing was sent”, “You can close this”, “Your browser stays the default”.
   - Narration: “Lo keeps”, “tries again by itself”, “the tab shows how it ends”. Don’t announce
     what happens by itself. Show the state on the thing.
6. **One word per thing.** An action keeps its name from command to button to result: “Merge #264”,
   “Merging…”, “Merged #264”.

## Terms

One term per thing. A Never column bans a word for its own row’s meaning, and nowhere else: “Send”
is wrong for a review and right for a comment. For something of GitHub’s that isn’t listed, use
GitHub’s own name for it.

### GitHub’s things

| Write              | For                                                                                                                                                                     | Never                                                 |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| pull request       | What’s under review. A specific one is its number: #264, or owner/repo#264 outside its tab.                                                                             | PR, pull, “pull request #264”                         |
| repo               | A GitHub repository, written owner/repo.                                                                                                                                | repository, project                                   |
| revision           | The pull request as of one push, written r3. “Pushed” is only a verb: “ravi-k pushed r5”.                                                                               | push as a noun, version, head, snapshot               |
| latest             | The newest revision: “Show latest”.                                                                                                                                     | newest, newer, current, tip                           |
| out of date        | Behind the latest revision: “Written for r3 · now r5”.                                                                                                                  | stale, outdated, old                                  |
| branch out of date | A branch behind its base branch. Always with “branch”: “out of date” alone is a revision.                                                                               | behind, stale, “needs update”                         |
| commit             | One Git commit, named by its short ID in code.                                                                                                                          | SHA, hash, ref, object                                |
| base branch        | The branch a pull request merges into, in code: `main`.                                                                                                                 | target, base ref, upstream                            |
| thread             | A comment on the diff with its replies.                                                                                                                                 | conversation, discussion                              |
| comment            | One message, in a thread or on the timeline.                                                                                                                            | post, note, message                                   |
| review             | Your verdict with its comments. A pending review holds comments not yet submitted.                                                                                      | draft review                                          |
| verdict            | What a review says: Comment, Approve or Request changes. In Submit review the three sit under the label “Verdict”. The first part of a merge status is its verdict too. | decision, outcome, “review type”                      |
| summary            | The text written with a review.                                                                                                                                         | review body, review note                              |
| description        | The pull request’s own text.                                                                                                                                            | body                                                  |
| draft              | A comment written and not yet sent. The pull request state is “draft pull request”.                                                                                     | unsent comment                                        |
| event              | One thing on the timeline: the description, a comment, a review, a commit. “12 older events”, “This event isn’t a comment”.                                             | activity, item, entry                                 |
| checks             | GitHub’s checks.                                                                                                                                                        | CI, statuses, builds                                  |
| merge queue        | GitHub’s merge queue. “Queue” alone only inside its own tab. What it holds are pull requests.                                                                           | train, entry                                          |
| place              | Where a pull request stands in a merge queue, as an ordinal: “Queued, 2nd”. Not known: “place not known”.                                                               | position, spot, rank                                  |
| ahead              | How many pull requests are before one in a merge queue: “3 ahead”, “0 ahead”. A count cut short: “3+ ahead”.                                                            | “none ahead”, “at least 3”                            |
| front              | 1st place in a merge queue: “Move to front…”.                                                                                                                           | top, head, “jump the queue”                           |
| group              | Pull requests a merge queue tests and merges together: “Groups of up to 5”. In Settings, a group is the settings under one name.                                        | batch, train                                          |
| waiting to join    | Auto-merge is on, and the pull request hasn’t joined the merge queue yet. In the merge status it’s a detail, never a verdict: “Auto-merge is on · waiting to join”.     | pending, “not yet”, “not queued”                      |
| auto-merge         | GitHub merging by itself once nothing blocks it.                                                                                                                        | Merge when ready, automerge                           |
| bypass rules       | Merging though a branch rule blocks it: “Bypass rules and merge…”.                                                                                                      | Merge anyway, past the rules, without the rules, skip |
| merge method       | How a pull request merges, by its name: Squash, Merge commit, Rebase. Never in a button.                                                                                | strategy, merge type, “Squash and merge”              |
| approval           | A review that approves: “2 more approvals”. The verb is “approve”. An organization also approves Lo: “Request approval on GitHub”.                                      | sign-off, stamp, LGTM                                 |
| code owner         | Someone whose approval a changed file requires: “1 approval from a code owner”.                                                                                         | “owner” alone, CODEOWNERS, “code owner review”        |
| viewed             | A file marked viewed. Its mark is drawn as a ball and works as a checkbox. A file that changed after it was marked is “Changed since viewed”.                           | seen, read, done                                      |
| account            | A GitHub account Lo is signed in to, by its name: ravi-k.                                                                                                               | login, user, token, credentials                       |
| read only          | A pull request opened without an account: “Read only”.                                                                                                                  | anonymous, guest, “signed-out mode”                   |
| sign-in code       | The code typed on GitHub to sign in: “Copy sign-in code”. In the sign-in dialog it’s “the code”: “The code expired.”                                                    | device code, one-time code, user code                 |

GitHub’s Markdown keeps GitHub’s names for what it draws in a comment or a description: “Suggested
change”, “Footnotes”, and the alerts “Note”, “Tip”, “Important”, “Warning” and “Caution”. The
command that writes a suggested change is “Suggest change”, and a suggested change is never a
“suggestion”. An alert’s “Note” is GitHub’s word. It’s neither a comment nor an overview note.

### Lo’s things

| Write                    | For                                                                                                                                                                                                                                                | Never                                                     |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| overview                 | The document that explains a pull request.                                                                                                                                                                                                         | summary, artifact, write-up                               |
| overview skill           | What a coding agent installs to write overviews. In code: `lo-overview`.                                                                                                                                                                           | Lo skill, agent skill, “the skill” alone                  |
| written for              | The revision an overview or a comment was written at: “Written for r3 · now r5”. After `·` it’s lower case: “ravi-k · 2 d ago · written for r3”.                                                                                                   | “from r3”, “made at r3”, “targets r3”                     |
| code block, figure, link | What a block of an overview can hold: a code block, a figure, a link into the code. “Part of the figure”.                                                                                                                                          | snippet, diagram, embed                                   |
| illustration             | A code block in an overview whose code isn’t the pull request’s, such as pseudo-code: “Illustration · not from this pull request”. Always text, never a figure.                                                                                    | example, sample, sketch, mock-up                          |
| link                     | A web address: “Copy link”, “Paste link”. One to a pull request is a “pull request link”. In an overview’s block, a link goes into the code instead: “No links in this block”.                                                                     | URL, web address, hyperlink                               |
| walkthrough              | An overview block that goes through code in steps: “Next step”, “No steps in this block”.                                                                                                                                                          | tour, slideshow, guide                                    |
| overview note            | An overview’s words under a line of the diff: “Show overview note”, “No overview note on this line”. Always both words.                                                                                                                            | annotation, “note” alone, remark                          |
| glossary                 | The list of words an overview defines. The card on one of those words points to it: “In the glossary.”, “More in the glossary.”                                                                                                                    | definitions, dictionary, word list                        |
| code beside              | A file’s diff shown beside the overview: “Code beside”, “Close code beside”, “Code beside is closed”.                                                                                                                                              | side diff, split view, companion                          |
| last opened              | The revision in view when the reader last had the pull request open: “Compare since last opened”.                                                                                                                                                  | last seen, “last looked”, last visit                      |
| stack                    | Pull requests that each build on the one before.                                                                                                                                                                                                   | chain, train                                              |
| layer                    | One pull request in a stack.                                                                                                                                                                                                                       | level, node                                               |
| GitHub stack             | A stack GitHub itself tracks.                                                                                                                                                                                                                      | native stack                                              |
| branch stack             | A stack GitHub doesn’t track, held together only by its branches. Named only where the difference from a GitHub stack matters. Elsewhere it’s a stack.                                                                                             | chain, plain stack, implicit stack, detected stack        |
| bottom layer, top layer  | The two ends of a stack. The bottom layer merges first.                                                                                                                                                                                            | first, last, root, base, tip                              |
| above, below             | Where one layer is from another: “Layers above #264”. A layer is “based on” the one below it.                                                                                                                                                      | upstack, downstack, parent, child, “sits on”, “on top of” |
| needs a rebase           | A layer whose branch still holds commits already merged below it: “Needs a rebase”.                                                                                                                                                                | restack, “needs rebase”, “may need a rebase”, out of date |
| layers 2–4               | Several layers shown as one diff, named by their span.                                                                                                                                                                                             | run, range                                                |
| merge status             | The verdict in a pull request’s header. It reads as one of the lines under [Merge status](#merge-status).                                                                                                                                          | merge state, mergeability, merge box                      |
| reason                   | One thing that blocks a merge, as a row in the merge panel: “3 reasons”, “Next reason”. The Reason under an error’s title is the name of a part in this guide, and never reaches the screen.                                                       | blocker, issue, requirement, problem                      |
| blocked                  | Stopped from merging by one or more reasons. The merge panel’s list of them is “Blocked”. A reason GitHub doesn’t give is “Blocked by GitHub”. In the merge status it’s a detail, never a verdict: “Can’t merge · blocked by GitHub”.              | in the way, held up, stuck, “GitHub says no”              |
| local copy               | Lo’s copy of a repo on this computer.                                                                                                                                                                                                              | clone, checkout, working copy                             |
| cache                    | Everything Lo stores to open pull requests fast: local copies and saved data.                                                                                                                                                                      | saved answers, store                                      |
| language server          | The program behind definitions, references and types. Name a server as its makers write it: Pyright, gopls.                                                                                                                                        | LSP, “server” alone                                       |
| code intelligence        | What language servers give: definitions, references, types.                                                                                                                                                                                        | code answers, smart features                              |
| code index               | Lo’s own index of names, used when no language server runs.                                                                                                                                                                                        | syntax index, symbol index, fallback                      |
| toolchain                | What a language server needs to read a language, by its name: Go, Temurin JDK.                                                                                                                                                                     | runtime, compiler, “SDK” alone                            |
| trust                    | Letting language servers run on a repo or a pull request: “Trust repo…”, “Stop trusting”.                                                                                                                                                          | allow, approve, enable                                    |
| update                   | A newer version of Lo: “Lo 0.2.0 is available”. Its buttons: “Update”, then “Restart to update”. Its notes: “What’s new”. A check that finds none: “No update available”.                                                                          | release, “is out”, upgrade, Install, changelog            |
| damaged                  | A file Lo downloads or decodes that fails a check: a download with the wrong checksum, a figure whose image can’t be decoded. “The download was damaged.”, “diagram.png is damaged.” Never a file the reader edits, such as `settings.json`.       | corrupt, corrupted, invalid, broken, “checksum mismatch”  |
| welcome                  | The steps a new reader sees first. Its one command, in Help and the palette: “Welcome to Lo”.                                                                                                                                                      | onboarding, setup, tour, “Show welcome”                   |
| Settings                 | Capital S. A place in it is a path: Settings › Storage. The file is `settings.json`.                                                                                                                                                               | preferences, options, config, “the settings file”         |
| keyboard shortcuts       | The list of Lo’s keys. One of them is a key.                                                                                                                                                                                                       | key help, keybindings, hotkeys                            |
| keymap file              | The file that holds changed keys: “Open keymap file”.                                                                                                                                                                                              | keybindings file, key config, shortcuts file              |
| fixed                    | A key the keymap file can’t change, such as one of the comment box’s own. Keyboard shortcuts tags it “Fixed”.                                                                                                                                      | locked, reserved, built-in, hard-coded                    |
| Vim keys                 | The setting for Vim’s modal editing. Its modes are written as Vim writes them: NORMAL, INSERT, VISUAL, V-LINE. The mode in use shows as its name alone.                                                                                            | Vim mode, Vim-style keys                                  |
| keys typed               | The keys of a command typed so far, at the end of the status bar: `g`, `2y`. The item’s name is “Keys typed”.                                                                                                                                      | pending keys, key buffer, “keys typed so far”             |
| command                  | A row in the command palette. Something typed in a terminal is a command too, and always says which: “Copy Homebrew command”.                                                                                                                      | action                                                    |
| `lo` command             | What opens a pull request from a terminal, in code: “Install `lo` command”.                                                                                                                                                                        | command-line tool, CLI, “shell command”                   |
| comment box              | Where a comment is written: “Close comment box”.                                                                                                                                                                                                   | composer, editor, input, “the box” alone                  |
| preview                  | The comment as it will read once sent. A choice in the comment box: “Write”, “Preview”.                                                                                                                                                            | “Write or preview”, rendered                              |
| placeholder              | The text that stands in a comment for a file while it uploads: “Remove the leftover placeholder first”.                                                                                                                                            | stub, marker, token                                       |
| kept draft               | A draft whose lines aren’t in the diff in view: “Show kept drafts”, “1 kept draft”, “No kept drafts”. Always in that order.                                                                                                                        | orphaned draft, saved draft, hidden draft, “1 draft kept” |
| elsewhere                | Somewhere Lo can’t see, when it isn’t known where: on GitHub’s site, in another app, on another computer. “It was edited elsewhere.”, “It was deleted elsewhere.”                                                                                  | remotely, “by someone else”, “on GitHub” as a guess       |
| whole file               | A file in full, not only its changed lines: “Open whole file”.                                                                                                                                                                                     | full file, entire file, file view                         |
| removed                  | After a line’s number, and only there, the old side of a diff: “Line 3, removed”. The new side goes unsaid, except in “New side only”. See [Lines](#lines). Anywhere else, “removed” is the past of Remove: “You removed it.”, “Metadata removed”. | old, left, minus, “old side”                              |
| GitHub’s diff            | The diff as GitHub gives it, shown until the local copy is ready: “GitHub’s diff”. After `·`: “showing GitHub’s diff”.                                                                                                                             | API diff, remote diff, fallback                           |
| binary file              | A file that can’t be shown as text: “Binary file”. As a tag it’s lower case, with its sizes: “binary · 69 B → 73 B”.                                                                                                                               | blob, data file, “not text”                               |
| large file               | A file that shows only when asked: “Show large file”, “Show 5,001 lines”, “2.4 MB file”. Showing it isn’t unfolding it, so the verb is Show, not Expand.                                                                                           | big file, huge file, heavy, “Expand file”                 |
| text changes             | Changed lines. A file with only a new name or mode has “no text changes”.                                                                                                                                                                          | content changes, “no diff”, “empty diff”                  |
| A, D, M, R, T            | The letter beside a file in the files, for how the file changes. Each has one name: “Added”, “Deleted”, “Modified”, “Renamed”, “Changed type”.                                                                                                     | New, Removed, Edited, Moved, “Type changed”               |
| definitions              | What “Show definition” brings up under the line: “Next definition”, “Close definitions”.                                                                                                                                                           | peek, answers, popup                                      |
| references               | The list of places a name is used: “Show references”, “Next reference”, “Close references”.                                                                                                                                                        | usages, uses, callers                                     |
| type, type hints         | “Show type” gives one name’s type. Type hints are the types a language server shows in the code, and a switch: “Type hints”.                                                                                                                       | hover, inlay hints, inlays                                |
| outline                  | The list of a file’s symbols: “Outline”. A symbol is a function, a class or another named thing in the file: “1,204 symbols”.                                                                                                                      | symbol list, structure, breadcrumbs                       |
| rule                     | What an app such as Finicky uses to send pull request links to Lo: “Show rules”, “Copy rule”. The steps for an app keep its own word, in code: Finicky’s `handlers`. On a merge, rules are GitHub’s branch rules.                                  | handler, setup, config                                    |

### Merge status

The merge status is a verdict, then one detail: “Queued, 2nd · merges in about 12 min”. Each verdict
has one wording.

| Write                 | When                                                         |
| --------------------- | ------------------------------------------------------------ |
| Checking…             | GitHub hasn’t answered yet.                                  |
| Ready to merge        | It can merge now.                                            |
| Ready for merge queue | It can be added to the merge queue.                          |
| Can’t merge yet       | Something is still to come: a review, running checks.        |
| Can’t merge           | Something has to change first: conflicts, a failed check.    |
| Auto-merge is on      | GitHub merges it once nothing blocks it.                     |
| Queued                | It’s in the merge queue. With its place: “Queued, 2nd”.      |
| Leaving merge queue   | It’s in the merge queue, and about to leave without merging. |
| Left merge queue      | It was in the merge queue, and is neither there nor merged.  |
| Merged, Closed        | GitHub’s own words for its state.                            |

Never “mergeable”, “pending”, “dequeued” or “clean”.

### The window

| Write   | For                                                                                                           | Never                             |
| ------- | ------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| tab     | One pull request or stack, the Recent tab, a merge queue. In keyboard shortcuts, a tab holds one area’s keys. | page, window                      |
| view    | What fills the middle of a tab: Overview, Diff or Timeline.                                                   | middle view, mode, pane, screen   |
| panel   | The left panel, the threads panel, the merge panel.                                                           | sidebar, pane, drawer             |
| files   | The list of files in the left panel, as a tree or in review order.                                            | “the tree”, explorer, file finder |
| area    | Where a key works: Diff, Files, Comment box. Keyboard shortcuts has a tab for each.                           | scope, context, mode              |
| message | A line under a pull request’s header that reports a change to it: “Next message”, “Dismiss message”.          | banner, notice, alert             |

What a list holds has one noun, and stepping uses it: a block in the overview, a step in a
walkthrough, an event on the timeline, a row in the files, a symbol in the outline, a group in
Settings, a reason in the merge panel. “Next block”, “Previous event”.

Component names never reach the screen: banner, toast, dialog, popover, callout, notice, status
item. Nor does “on screen”: write “this revision”, not “the revision on screen”.

### Verbs

| Write                     | For                                                                                                                                                                                                | Never                                                |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Open                      | Bring a pull request, a file or a link into Lo: “Open pull request…”. “Open on GitHub” goes to the browser. A page off GitHub: “Open in browser”.                                                  | Load, Launch, View, Review                           |
| Show, Hide                | Bring something into view, or put it out of view until it’s shown again: “Show r5”, “Hide whitespace changes”.                                                                                     | Load, Display, See, Toggle                           |
| Collapse, Expand          | Fold a folder, a file or a thread, and unfold it: “Collapse file”, then “Expand file”.                                                                                                             | Open, Close, Fold, Toggle                            |
| Close                     | Put away what was opened, until it’s opened again: a tab, a comment box, definitions. “Close tab”.                                                                                                 | Dismiss, Hide, Exit                                  |
| Go to                     | Move to a place in the code or the window: “Go to file…”, “Go to definition”.                                                                                                                      | Jump to, Navigate to                                 |
| Next, Previous            | Step through one kind of thing: “Next change”. Back and Forward are for history alone.                                                                                                             | Prev                                                 |
| Send                      | A comment or a reply: “Sending…”.                                                                                                                                                                  | Post, Publish                                        |
| Save                      | An edit to a comment.                                                                                                                                                                              | Update, Apply                                        |
| Attach                    | Put a file into a comment: “Attach files…”, “Drop to attach files”, “Couldn’t attach diagram.png”. What the file then does is “upload”, only as a verb: “Uploading…”, “A file is still uploading”. | Upload, “an upload”, Add file                        |
| Submit                    | A review: “Submit review…”. Its result names the verdict in the past: “Approved #264”, “Commented on #264”, “Requested changes on #264”.                                                           | Send, Finish                                         |
| Merge                     | Merging, by any method.                                                                                                                                                                            | Ship, Land                                           |
| Approve and ship          | The one command that approves, then merges, queues or turns on auto-merge. Its result says which: “Approved and merged #264”.                                                                      | “Ship” alone                                         |
| Add                       | Put a pull request into a merge queue or a GitHub stack: “Add to merge queue…”, “Adding…”, “Added #264 to merge queue”.                                                                            | Enqueue, Send to, Put in                             |
| Remove                    | Take a thing out of what holds it: a pull request out of a merge queue, a placeholder out of a comment, a location out of a photo. “Remove from merge queue”, “Location removed”.                  | Take out, Drop                                       |
| Move                      | Change a layer’s base branch: “Move #265 onto `main`”. Or a pull request’s place in a merge queue: “Move to front…”, “Moved #264 to 2nd”.                                                          | Retarget, Repoint, Rebase, Jump, Bump                |
| Convert                   | Make a branch stack a GitHub stack: “Convert to GitHub stack…”, “Converting…”, “Converted to GitHub stack”. Taking its steps back is “Undo changes”.                                               | Make, Create, Turn into, “Stack” as a verb           |
| Delete                    | Destroy something for good: “Delete comment…”.                                                                                                                                                     | Remove, Erase                                        |
| Discard                   | Throw away text not yet sent: “Discard draft”.                                                                                                                                                     | Delete, Drop                                         |
| Clear                     | Empty a store or a field: “Clear cache”.                                                                                                                                                           | Purge, Wipe                                          |
| Reset                     | Put a setting back to its default: “Reset zoom”.                                                                                                                                                   | Restore, Revert, Actual size                         |
| Dismiss                   | Put away a banner or a toast for good. An offer’s asks where: “Dismiss for #264”, “Dismiss for this stack”, “Dismiss for all stacks”.                                                              | Hide, Close                                          |
| Copy                      | To the clipboard: “Copy link”. The button reads “Copied” for 2 s.                                                                                                                                  | Yank                                                 |
| Install                   | Put something on this computer: the `lo` command, the overview skill, a language server.                                                                                                           | Set up, Add                                          |
| Sign in, Sign out         | “Sign in with GitHub…” is the one command, for any account. “Sign in again” after a sign-out. The noun is “sign-in”. Single sign-on alone keeps GitHub’s word: “Authorize on GitHub”.              | Log in, Add an account, Connect, Authorize           |
| Try again                 | Repeat what failed. A retry that’s counting down reads “Retrying in 20 s”, with the button “Try now”. That countdown is the one place “retry” appears.                                             | “Retry” on a button, Reload, “tries again by itself” |
| Check again               | Look again for something missing or not known: Git, a merge’s result. It only looks, and repeats nothing.                                                                                          | Recheck, Look again                                  |
| Paste                     | Open the pull request link on the clipboard: “Paste link”.                                                                                                                                         | “Open the link on the clipboard”                     |
| Turn on, Turn off         | Something of GitHub’s that’s on or off: “Turn on auto-merge”.                                                                                                                                      | Enable, Disable, Toggle                              |
| Continue, Skip            | A welcome step’s buttons. See [Welcome step](#welcome-step).                                                                                                                                       | Next, Not now, Later, Get started                    |
| Cancel, Close, Done, Back | A dialog’s other button. See [Confirmation](#confirmation).                                                                                                                                        | OK, Got it, Not now                                  |

A state is “on” or “off”: “Auto-merge is on”. Never “enabled”, “disabled” or “active”.

The reader adds a pull request to a merge queue and removes it. What happens without them has its
own words: a pull request “joins” a merge queue and “leaves” it.

For an action that isn’t listed, use the plainest verb for it: Reply, Undo, Rename.

### The system’s things

- **macOS:** Keychain, Finder (“Show in Finder”), Applications, Trash.
- **Linux:** keyring, “Show in file manager”.
- **GitHub CLI** by its name. `gh` only as a command to type.
- **Git** as a name. `git` only as a command to type.
- **Homebrew** by its name. `brew` only as a command to type.
- **This computer** is where Lo runs: “No toolchains for this computer”. Never “this system”, “this
  machine” or “this device”.
- **The macOS app menu** keeps the system’s wording: “About Lo”, “Settings…”, “Quit Lo”.

## Shapes

Every message is one of these. A string that fits none of them is a label: name the thing.

### Error

Something failed, or can’t load.

| Part    | Limit                                                                                        | Example                                    |
| ------- | -------------------------------------------------------------------------------------------- | ------------------------------------------ |
| Title   | Six words, in one of the three forms below.                                                  | Can’t open #80                             |
| Reason  | One line, and only if it changes what the reader does: the cause, then any retry.            | GitHub returned an error. Retrying in 1 s. |
| Button  | One: the next step.                                                                          | Try now                                    |
| Details | GitHub’s or Git’s own text, unedited, with Copy. Status codes and file paths live only here. | `500 Server Error`                         |

The title’s three forms:

- **“Couldn’t”, a verb, the thing:** an action the reader started has failed. “Couldn’t send the
  comment”
- **“Can’t”, a verb, the thing:** a view or a feature is blocked. It reads this way for as long as
  it’s blocked, even while a retry counts down. “Can’t open #80”, “Can’t find Git”
- **The thing, “not confirmed”:** the result isn’t known. The thing is the command’s word: “Merge
  not confirmed”, “Auto-merge not confirmed”, “Move not confirmed”. On a comment or a thread:
  “Comment not confirmed”, “Edit not confirmed”, “Delete not confirmed”, “Resolve not confirmed”,
  “Unresolve not confirmed”. A review names its verdict where the verdict has a noun: one that
  approves is “Approval not confirmed”, and any other is “Review not confirmed”. A step in a list
  reads “Not confirmed”.

One wording per cause:

| Cause                  | Reason                                            | Button                     |
| ---------------------- | ------------------------------------------------- | -------------------------- |
| No connection          | Offline.                                          | Try again                  |
| GitHub failed          | GitHub returned an error.                         | Try again                  |
| No answer in time      | GitHub didn’t respond.                            | Try again                  |
| Sent, result not known | GitHub didn’t respond.                            | Check again                |
| Rate limit             | GitHub’s rate limit resets at 14:05.              | None                       |
| Rate limit, no time    | GitHub’s rate limit was reached.                  | Try again                  |
| Rate limit, signed out | GitHub’s rate limit resets at 14:05.              | Sign in with GitHub…       |
| Signed out             | ravi-k is signed out.                             | Sign in again              |
| Sign-in can’t be read  | ravi-k’s sign-in can’t be read from the Keychain. | Try again                  |
| Missing or hidden      | It doesn’t exist, or ravi-k can’t see it.         | Sign in with GitHub…       |
| Out of date            | This revision is out of date.                     | Show latest                |
| Single sign-on         | rozed-dev requires single sign-on.                | Authorize on GitHub        |
| Lo not approved        | rozed-dev hasn’t approved Lo.                     | Request approval on GitHub |
| Certificate            | GitHub’s certificate couldn’t be verified.        | Try again                  |
| Proxy                  | The proxy couldn’t connect to GitHub.             | Try again                  |
| Proxy needs a sign-in  | The proxy requires a sign-in.                     | None                       |
| Proxy of another kind  | The proxy isn’t HTTP, HTTPS or SOCKS5.            | None                       |
| Disk full              | The disk is full.                                 | Clear cache                |
| Took too long          | It took too long.                                 | Try again                  |
| Out of memory          | It ran out of memory.                             | None                       |
| Unknown                | No reason line.                                   | Try again                  |

“The Keychain” reads “the keyring” on Linux. “Took too long” and “Out of memory” are for work on
this computer. GitHub not answering is “No answer in time”.

“Try again” repeats the action. Where repeating could do it twice, as with a merge that was sent and
never answered, the button is “Check again”, which only looks.

- **Where it shows:** a failed view takes the view. A failed action shows on its control. A failed
  background job shows on its status bar item. Never in a tooltip.
- **Never:** “Sorry”, “Oops”, “Something went wrong”, “Please”, “Error” or “Failed” as a title, the
  command’s name as the title, the title said again as the reason.

`tab/window/banners.ts` and `packages/core/github/src/choice.ts`:

|         | Before                                                                                                                                                             | After                                      |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------ |
| Title   | Lo couldn't read this pull request.                                                                                                                                | Can’t open #80                             |
| Reason  | No account Lo is signed in to could check rozed-dev/e2e, so it didn't open without signing in. rozed-bot: GitHub answered 500: Server Error Lo tries again in 1 s. | GitHub returned an error. Retrying in 1 s. |
| Button  | Try again                                                                                                                                                          | Try now                                    |
| Details | None                                                                                                                                                               | `500 Server Error`                         |

### Empty state

A view or a list with nothing in it. `EmptyState` draws it, from the heading, the line and the
commands ([README](README.md#empty-states)).

| Part    | Limit                                                                           | Example                                 |
| ------- | ------------------------------------------------------------------------------- | --------------------------------------- |
| Heading | Six words: what’s absent.                                                       | No pull requests yet                    |
| Line    | One, optional: what will be listed, or why there’s nothing.                     | Pull requests you open are listed here. |
| Buttons | Two at most, each a real command with its key. The first is the primary button. | Open pull request… `⌘L`                 |

- **Offer the action here.** Never say where else it lives: “from the status bar”, “in the command
  palette”.
- **A filter with nothing left:** “No matches”, with “Clear filter”. A search names what was typed:
  No commands match “queue”
- **Never:** “Nothing to show yet”, a paragraph on what the feature is.

`open/window/Recent.tsx`:

|         | Before                                                                                                      | After                                     |
| ------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| Heading | No pull requests yet                                                                                        | No pull requests yet                      |
| Line    | Paste a link to a pull request. Every pull request you open, from any account, shows up here, newest first. | Pull requests you open are listed here.   |
| Buttons | Review a pull request · Paste a link                                                                        | Open pull request… `⌘L` · Paste link `⌘V` |

### Progress

Work the reader waits on.

| Part    | Limit                                                                            | Example                   |
| ------- | -------------------------------------------------------------------------------- | ------------------------- |
| Label   | Three words: the verb ending in “-ing”, the thing if it isn’t obvious, then `…`. | Fetching local copy…      |
| Measure | Takes the place of `…` when Lo knows how far: a percent, a count or a countdown. | Fetching local copy · 62% |
| Cancel  | Only where it stops the work.                                                    | Cancel                    |

- **On a button:** its own verb, with a spinner. “Merge #264” becomes “Merging…”.
- **A sent comment** shows at once, marked “Sending…”.
- **Never** a sentence: “GitHub is merging it”, “Please wait”, “Cancel stops it”, “You can close
  this”. Never a made-up measure.

`merge/window/words.ts`:

| Before                                                               | After                                                          |
| -------------------------------------------------------------------- | -------------------------------------------------------------- |
| GitHub is merging it. You can close this; the tab shows how it ends. | No sentence. The Merge button reads “Merging…” with a spinner. |

### Confirmation

A dialog that asks first. Only before what can’t be undone, what other people will see, or what
carries a risk.

| Part    | Limit                                                                                                                  | Example                                                   |
| ------- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Title   | Six words: the verb, the object, a question mark.                                                                      | Delete comment?                                           |
| Body    | Two lines: what happens that the title doesn’t say. Several things in order are a numbered list of five steps at most. | 1. Approve #264. 2. Add it to the merge queue for `main`. |
| Primary | The title’s verb and object. A name in the title becomes its kind: “Trust repo”.                                       | Delete comment                                            |
| Other   | Cancel.                                                                                                                | Cancel                                                    |

- **A dialog with fields** takes its command’s name and no question mark: “Merge #264”, “Submit
  review”.
- **The other button:** “Cancel” before anything is sent, “Close” when nothing is pending, “Done”
  only after success, “Back” only to an earlier step.
- **While it works,** the primary shows progress: “Merging…”. If it fails, an error sits above the
  buttons and the primary reads “Try again”.
- **Never:** “Are you sure”, “Yes”, “No”, “OK”, what won’t happen, how to close the dialog.

`code/main/confirm.ts`:

|         | Before                                                                                                                                                                                                                                                               | After                                                                                                              |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Title   | Trust rozed-dev/e2e?                                                                                                                                                                                                                                                 | Trust rozed-dev/e2e?                                                                                               |
| Body    | Lo will check out its pull requests and run language servers on them. The servers read its code and settings. Lo limits what they run, but they aren’t sandboxed. The repo’s settings can still steer them. A file that exploits a bug in one could run code as you. | Language servers read this repo’s code and settings. They aren’t sandboxed. Trust only repos whose code you’d run. |
| Buttons | Trust · Cancel                                                                                                                                                                                                                                                       | Trust repo · Cancel                                                                                                |

### Refusal

A command that can’t run now.

- **Its control is dimmed,** and the reason is its tooltip or its menu row.
- **A key pressed with no control in view** gets a toast with the reason alone.
- **Where the dimmed control says it all, say nothing:** Back with no history.
- **Several reasons** are a list, one line each.

| Reason             | Limit                          | Example                         |
| ------------------ | ------------------------------ | ------------------------------- |
| The reader can act | Eight words: what to do first. | Sign in to comment              |
| The reader can’t   | Eight words: the fact.         | Draft pull requests can’t merge |

- **Never:** the command’s name as a title, “Lo is still…”, “isn’t offered”, “not now”, a second
  sentence.

`merge/window/words.ts`:

| Before                                                              | After                           |
| ------------------------------------------------------------------- | ------------------------------- |
| #264 is a draft, which GitHub doesn’t merge, past the rules or not. | Draft pull requests can’t merge |

### Tooltip

Names a control and gives its key, or names a mark.

| Part  | Limit                                            | Example     |
| ----- | ------------------------------------------------ | ----------- |
| Label | The control’s command label, or the mark’s name. | Merge panel |
| Key   | A chip beside it, never typed into the text.     | `m`         |

- **A dimmed control’s** tooltip is its refusal reason.
- **A name cut short** shows whole: a path, a branch.
- **A mark with no words** shows its name alone, with no key, since a mark isn’t a control: the
  letter A beside a file is “Added”, a layer’s checks mark is “Checks passed”.
- **Never** a sentence, an error, or anything shown nowhere else. A mark’s name is the one
  exception: it’s in the tooltip and in what a screen reader reads, and nowhere else.

`packages/desktop/ui/src/MergeStatus.tsx`:

| Before          | After           |
| --------------- | --------------- |
| Merge panel (m) | Merge panel `m` |

### Command label

One label per command, the same everywhere. Only a control on the thing may fill it in, as below.

| Part   | Limit                                                                                                                 | Example     |
| ------ | --------------------------------------------------------------------------------------------------------------------- | ----------- |
| Verb   | First. Where [Verbs](#verbs) lists the action, its word.                                                              | Copy        |
| Object | No article. “This” and “your” only if the label is unclear without them.                                              | Copy path   |
| `…`    | Only when the command asks for more before it acts: a name, a choice, a confirmation. Not when it only opens a place. | Go to file… |

- **Four words at most.**
- **A place is its name,** with no `…`: “Settings”, “Merge panel”, “Welcome to Lo”. Not “Open
  Settings”.
- **A switch is a setting of Lo’s** that stays as it’s set. Its label is what it turns on, with a
  check: “Type hints”, “Left panel”, “Hide whitespace changes”. Not “Show or hide”, not “on or off”.
- **A choice is one command per option,** with one checked: “Side by side”, “Inline”.
- **A command that changes something on GitHub is never a switch.** It takes the name of what it
  does now: “Resolve thread”, then “Unresolve thread”. “Turn on auto-merge”, then “Turn off
  auto-merge”.
- **Nor is a fold.** It takes the name of what it does now: “Collapse file”, then “Expand file”.
- **Stepping names the thing, not the place:** “Next thread”. Not “Next thread in the panel”.
- **A key that steps through three or more options** is named the same way: “Next merge method”,
  “Next thread filter”. It stands in place of a command per option, not beside one. The control
  lists the options by name.
- **A menu on the thing itself** may drop the object: “Reply”, “Resolve”.
- **A label can be filled in.** The palette, the menus and the keyboard shortcuts show it plain:
  “Show latest”, “Merge…”, “Compare”. A control on the thing names what it acts on: “Show r5”,
  “Merge #264”, “Compare r2 → r5”. `…` follows its own rule on each: the merge panel’s button opens
  the confirmation, so it reads “Merge #264…”. The dialog’s primary acts, so it reads “Merge #264”.
- **A name that’s code stays code inside a label:** “Install `lo` command”.
- **A description,** where a command has one, is one line that adds what the label can’t.
- **Never** “OK”, “Yes” or a bare “Submit”.

`diff/keys.ts`:

| Before                          | After                                    |
| ------------------------------- | ---------------------------------------- |
| Hide or show whitespace changes | Hide whitespace changes, checked when on |

### Setting description

One row in Settings: a label, a description and a control.

| Part        | Limit                                                        | Example                            |
| ----------- | ------------------------------------------------------------ | ---------------------------------- |
| Label       | Four words: the thing set. A switch reads true when it’s on. | Check for updates automatically    |
| Description | One line: what it changes that the label doesn’t say.        | Checks at startup, then every 6 h. |
| Options     | One or two words each, and not repeated in the description.  | Dark · Light · System              |

- **A group’s name** is one or two words: Appearance, Pull requests.
- **An offer’s switch** names what’s offered: “Offer GitHub stacks”. Its row turns back on what
  “Dismiss for all stacks” turned off.
- **Never:** “Lo”, “This setting”, “Whether to”, “Controls”, “Lets you”, the default, the setting’s
  key.

`updates/window/Settings.tsx`:

|             | Before                                                                      | After                              |
| ----------- | --------------------------------------------------------------------------- | ---------------------------------- |
| Label       | Check for updates by itself                                                 | Check for updates automatically    |
| Description | 30 s after Lo starts, then every 6 hours. Off, Lo checks only when you ask. | Checks at startup, then every 6 h. |

### Welcome step

One screen of the welcome, with one job: sign in, choose keys, set up, open a pull request.

| Part    | Limit                                                                                              | Example                                           |
| ------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Heading | Six words, no full stop: the step’s job. The first step’s says what Lo is for.                     | Review pull requests from the keyboard            |
| Line    | One: what the reader gets, or where to change it later.                                            | Each of these is also in Settings › Integrations. |
| Row     | A label of six words, one line and one button. Once it’s done, its state takes the button’s place. | Overview skill · “Install”, then “Installed”      |
| Buttons | “Continue” and “Skip” on every step, and “Back” from the second step on. Only these words.         | Continue                                          |

- **Continue** goes to the next step with what’s set. **Skip** leaves the welcome from any step.
  **Back** goes to the step before.
- **The last step** has “Done” in place of Continue, and no Skip.
- **A step’s own action** is its command, by its label: “Sign in with GitHub…”.
- **A choice’s cards** are named like options: “Standard”, “Vim keys”.
- **A step that’s done says so in place:** “Signed in as ravi-k”, “Installed”.
- **Progress** has no words on screen. To a screen reader it’s “Step 2 of 4”.
- **Never:** “Welcome!”, “Let’s get started”, “You’re all set”, “Next”, “Not now”, “Later”,
  “optional”, “if you like”, a list of features, what Lo will do later.

`welcome/window/Account.tsx` and `welcome/window/Setup.tsx`:

|         | Before                                                                                                                        | After                                                                                             |
| ------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Heading | Review pull requests from the keyboard.                                                                                       | Review pull requests from the keyboard                                                            |
| Line    | Lo reads whole stacks, shows the overviews your coding agent writes, and has a key for every action.                          | Every action has a key.                                                                           |
| Row     | Send PR links to Lo · Lets a link router such as Finicky hand GitHub PR links to Lo. Your browser stays the default. · Set up | Send pull request links to Lo · Pull request links clicked in other apps open in Lo. · Show rules |

### Result

What an action did.

- **A toast** is one line: the command’s verb in the past, then its object. “Merged #264”, “Copied
  path”. One button at most: “Undo”, “Show”.
- **Nothing for what shows in place.** A Copy button reads “Copied” for 2 s. A sent comment appears
  in its thread.
- **A banner** reports a change to this pull request, in one line with one button and Dismiss:
  “ravi-k pushed r5”, with “Show r5”.

`queue/window/acting.ts`:

| Before                                                                          | After             |
| ------------------------------------------------------------------------------- | ----------------- |
| Moved #264 up to 2nd in the merge queue for main, behind what GitHub is testing | Moved #264 to 2nd |

## Punctuation and formats

- **Sentence case** everywhere. Capitals only for names: Lo, GitHub, Settings, Keychain. Panel
  labels are uppercase by styling (`text-label`), not in the text. The one exception is Vim’s modes,
  written as Vim writes them: NORMAL, INSERT, VISUAL, V-LINE.
- **Lo** has a capital L. Lowercase `lo` only in code: the command, `lo://` links.
- **Apostrophes and quotes are curly:** ’ “ ”. Straight ones only inside code.
- **Quote only what the reader typed:** No commands match “queue”
- **Names are plain text:** repos, accounts, pull requests, language servers, and a file by its
  name: utils.ts. Never quoted, never code. A file’s path is code: `src/utils.ts`. So is a file
  [Terms](#terms) names: `settings.json`.
- **`…` is one character, in two places:** progress without a measure, and a command that asks for
  more. Never three dots, never to trail off.
- **No full stop** on a title, heading, label, button, menu row, tooltip, toast or refusal reason.
- **A full stop on every body line:** a reason, an empty state’s line, a description, a dialog’s
  body, a step.
- **Articles:** a label has no “the” or “a” before its object. That’s a command on its button, its
  menu row and its tooltip, a dialog’s title, a toast and a setting’s label: “Clear cache”, “Delete
  comment?”, “Copied path”. A sentence keeps its articles. That’s an error’s title, a reason, a
  description and a body line: “Couldn’t clear the cache”.
- **One fact per sentence.** No semicolon, no brackets, and no dash or colon joining two clauses. A
  sentence that needs one holds two facts: split it or cut one.
- **Contractions always:** can’t, couldn’t, isn’t, it’s, you’re. Never “cannot” or “is not”.
- **No exclamation marks, emoji or jokes.** No “please”, “sorry”, “successfully” or “simply”.
- **Symbols:** `→` between two things compared, `·` between facts on one line, `›` between the steps
  of a path, `–` in a span.

### Numbers

| Write           | For                                          |
| --------------- | -------------------------------------------- |
| 3 files         | Digits always, never “three”.                |
| 1,204 files     | A comma in thousands.                        |
| 1 file, 2 files | Both forms written out, never “file(s)”.     |
| 41 / 214 viewed | A part of a whole.                           |
| #264, r3, 2nd   | A pull request, a revision, a place in line. |
| 62%             | No space before the sign.                    |
| r3 → r5         | A comparison.                                |

### Times

| Write                 | For                                                                                                     |
| --------------------- | ------------------------------------------------------------------------------------------------------- |
| 20 s, 5 min, 2 h, 3 d | The units, after a space. The largest whole unit only: never “2 h 14 min”.                              |
| just now              | Under a minute ago.                                                                                     |
| 5 min ago, 2 h ago    | The past.                                                                                               |
| Checked 5 min ago     | When something was last read from GitHub. Never “Updated” or “Refreshed”.                               |
| Nov 12                | More than 30 days ago: the date.                                                                        |
| Nov 12, 2025          | A date in another year.                                                                                 |
| in 5 min              | Ahead.                                                                                                  |
| Retrying in 20 s      | A countdown, which says what it’s waiting for.                                                          |
| about 5 min           | An estimate. Never `~`. Outside a column that names it, it says what it’s of: “merges in about 12 min”. |
| 14:05                 | A time of day, in the system’s own format.                                                              |

Never milliseconds. Never “a moment”, “a while” or “soon”.

### Sizes

| Write        | For                                                                    |
| ------------ | ---------------------------------------------------------------------- |
| 512 B, 38 KB | The units, after a space, counted in 1,024s. Whole numbers below 1 MB. |
| 6.2 GB       | One decimal from 1 MB up.                                              |
| 6 GB         | Never “6.0 GB”.                                                        |

Never KiB, MiB or GiB.

### Lines

One form wherever a line is named: on a comment box, a thread, a kept draft, a pending comment.

| Write                      | For                                                 |
| -------------------------- | --------------------------------------------------- |
| Line 3                     | One line on the new side. The new side goes unsaid. |
| Lines 39–41                | A span, with an en dash.                            |
| Line 3, removed            | A line on the old side.                             |
| Line 3, removed, to line 5 | A span that starts on the old side.                 |
| File, Pull request         | A comment on the file, or on the pull request.      |
| Line 9 · r1                | A line at a revision other than the one in view.    |
| utils.ts · line 3 · r3     | After `·`, in lower case.                           |

Never “new 12”, “old 3” or “L12”. A path with its line, `src/utils.ts:12`, only as code.

## Before and after

More pairs, by the rule each one shows.

**Steps are a list.** `welcome/window/routers.ts`

- Before: This setup hasn’t been tried in Velja. In Velja’s settings, open Rules. Add a rule with a
  Source Apps matcher set to Lo that opens in your browser, so links Lo opens go to the browser. Add
  a rule that opens in Lo, with a URL Matchers matcher with this pattern. If Lo’s own GitHub links
  come back to Lo, the source-app rule must sit above the Lo rule.
- After:
  - Heading: Velja › Settings › Rules
  - Step 1: Add a rule that opens your browser when Source Apps is Lo.
  - Step 2: Below it, add a rule that opens Lo when URL Matchers is this pattern.
  - Then the pattern as code, with Copy.

**Code is code.** `packages/desktop/git/src/find.ts`

- Before: Lo can't find git. Install or update the Xcode Command Line Tools: run
  `xcode-select --install` in Terminal. Or install git with Homebrew: `brew install git`.
- After:
  - Title: Can’t find Git
  - Code, with Copy: `xcode-select --install`
  - Button: Check again

**An empty state offers the action.** `overview/window/States.tsx`

- Before: An overview explains a PR in prose, figures and its real code. Lo doesn’t write them:
  paste this prompt into a coding agent, and it writes one and pushes it to refs/lo/pr/80. Open the
  PR again once it’s pushed to see it.
- After:
  - Heading: No overview yet
  - Line: A coding agent writes one from this prompt.
  - Button: Copy prompt

**An unknown result is a fact.** `merge/window/words.ts`

- Before: Lo can’t tell whether #264 merged.
- After:
  - Title: Merge not confirmed
  - Reason: GitHub didn’t respond.
  - Button: Check again

**A failure shows on its control.** `settings/window/Cache.tsx`

- Before: a toast titled “Clear the cache”, reading “Lo couldn't clear the cache.”
- After, on the button’s row:
  - Title: Couldn’t clear the cache
  - Button: Try again

The short ones:

| File                            | Before                                                                 | After                                        |
| ------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------- |
| `merge/window/MergeConfirm.tsx` | Lo deletes no branches; the repo’s own setting applies.                | Cut. It says what won’t happen.              |
| `merge/window/MergeConfirm.tsx` | Checking #264 with GitHub before it’s sent. Cancel stops it.           | Checking…                                    |
| `keys/window/index.ts`          | A toast titled “Back”: There's nowhere to go back to.                  | No message. Back is dimmed.                  |
| `comments/window/writing.ts`    | Offline. Lo keeps this as a draft until you send it.                   | Offline                                      |
| `comments/window/writing.ts`    | Suggestions work on the new side only, since GitHub applies them there | New side only                                |
| `updates/window/Offer.tsx`      | Lo 0.2.0 is out                                                        | Lo 0.2.0 is available                        |
| `updates/window/Offer.tsx`      | Install                                                                | Update                                       |
| `settings/window/Cache.tsx`     | Clear the cache                                                        | Clear cache                                  |
| `settings/keys.ts`              | Open Settings                                                          | Settings                                     |
| `comments/keys.ts`              | Resolve or unresolve the thread                                        | Resolve thread, then Unresolve thread        |
| `merge/keys.ts`                 | Turn auto-merge on or off                                              | Turn on auto-merge, then Turn off auto-merge |
| `comments/keys.ts`              | Load the newer push                                                    | Show r5                                      |
| `merge/keys.ts`                 | Next unresolved conversation                                           | Next unresolved thread                       |
| `code/keys.ts`                  | Trust this PR…                                                         | Trust pull request…                          |
| `open/keys.ts`                  | Review a pull request                                                  | Open pull request…                           |
| `open/keys.ts`                  | Open the link on the clipboard                                         | Paste link                                   |
| `stacks/window/Stack.tsx`       | Make this a GitHub stack…                                              | Convert to GitHub stack…                     |
| `queue/window/acting.ts`        | Take #264 out of the merge queue for main?                             | Remove #264 from merge queue?                |
| `queue/window/rows.ts`          | 1 h 5 min                                                              | 1 h                                          |

## Before a string ships

1. Lo does nothing in it. It starts with “Lo” only to name a version.
2. Where Terms names the thing, it uses that row’s Write word and none of that row’s Never words.
3. It fits its shape’s limits.
4. Nothing is said twice, hedged or reassured.
5. It has no straight quote, no three dots, no semicolon and no bracket.
