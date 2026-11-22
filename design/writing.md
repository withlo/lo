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

| Write        | For                                                                                         | Never                                                 |
| ------------ | ------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| pull request | What’s under review. A specific one is its number: #264, or owner/repo#264 outside its tab. | PR, pull, “pull request #264”                         |
| repo         | A GitHub repository, written owner/repo.                                                    | repository, project                                   |
| revision     | The pull request as of one push, written r3. “Pushed” is only a verb: “ravi-k pushed r5”.   | push as a noun, version, head, snapshot               |
| latest       | The newest revision: “Show latest”.                                                         | newest, newer, current, tip                           |
| out of date  | Behind the latest revision: “Written for r3 · now r5”.                                      | stale, outdated, old                                  |
| commit       | One Git commit, named by its short ID in code.                                              | SHA, hash, ref, object                                |
| base branch  | The branch a pull request merges into, in code: `main`.                                     | target, base ref, upstream                            |
| thread       | A comment on the diff with its replies.                                                     | conversation, discussion                              |
| comment      | One message, in a thread or on the timeline.                                                | post, note, message                                   |
| review       | Your verdict with its comments. A pending review holds comments not yet submitted.          | draft review                                          |
| summary      | The text written with a review.                                                             | review body, review note                              |
| description  | The pull request’s own text.                                                                | body                                                  |
| draft        | A comment written and not yet sent. The pull request state is “draft pull request”.         | unsent comment                                        |
| checks       | GitHub’s checks.                                                                            | CI, statuses, builds                                  |
| merge queue  | GitHub’s merge queue. “Queue” alone only inside its own tab.                                | train                                                 |
| auto-merge   | GitHub merging by itself once its requirements are met.                                     | Merge when ready, automerge                           |
| bypass rules | Merging though a branch rule blocks it: “Bypass rules and merge…”.                          | Merge anyway, past the rules, without the rules, skip |
| viewed       | A file marked viewed.                                                                       | seen, read, done                                      |
| account      | A GitHub account Lo is signed in to, by its name: ravi-k.                                   | login, user, token, credentials                       |

### Lo’s things

| Write              | For                                                                                                                       | Never                                             |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| overview           | The document that explains a pull request.                                                                                | summary, artifact, write-up                       |
| overview skill     | What a coding agent installs to write overviews. In code: `lo-overview`.                                                  | Lo skill, agent skill, “the skill” alone          |
| stack              | Pull requests that each build on the one before.                                                                          | chain, train                                      |
| layer              | One pull request in a stack.                                                                                              | level, node                                       |
| GitHub stack       | A stack GitHub itself tracks.                                                                                             | native stack                                      |
| layers 2–4         | Several layers shown as one diff, named by their span.                                                                    | run, range                                        |
| local copy         | Lo’s copy of a repo on this computer.                                                                                     | clone, checkout, working copy                     |
| cache              | Everything Lo stores to open pull requests fast: local copies and saved data.                                             | saved answers, store                              |
| language server    | The program behind definitions, references and types. Name a server as its makers write it: Pyright, gopls.               | LSP, “server” alone                               |
| code intelligence  | What language servers give: definitions, references, types.                                                               | code answers, smart features                      |
| code index         | Lo’s own index of names, used when no language server runs.                                                               | syntax index, symbol index, fallback              |
| trust              | Letting language servers run on a repo or a pull request: “Trust repo…”, “Stop trusting”.                                 | allow, approve, enable                            |
| update             | A newer version of Lo: “Lo 0.2.0 is available”. Its buttons: “Update”, then “Restart to update”. Its notes: “What’s new”. | release, “is out”, upgrade, Install, changelog    |
| welcome            | The steps a new reader sees first. Its one command, in Help and the palette: “Welcome to Lo”.                             | onboarding, setup, tour, “Show welcome”           |
| Settings           | Capital S. A place in it is a path: Settings › Storage. The file is `settings.json`.                                      | preferences, options, config, “the settings file” |
| keyboard shortcuts | The list of Lo’s keys. One of them is a key.                                                                              | key help, keybindings, hotkeys                    |
| Vim keys           | The setting for Vim’s modal editing. Its modes are written as Vim writes them: NORMAL, INSERT, V-LINE.                    | Vim mode, Vim-style keys                          |
| command            | A row in the command palette.                                                                                             | action                                            |
| comment box        | Where a comment is written: “Close comment box”.                                                                          | composer, editor, input, “the box” alone          |
| preview            | The comment as it will read once sent. Its switch in the comment box: “Preview”.                                          | “Write or preview”, rendered                      |
| whole file         | A file in full, not only its changed lines: “Open whole file”.                                                            | full file, entire file, file view                 |
| definitions        | What “Show definition” brings up under the line: “Next definition”, “Close definitions”.                                  | peek, answers, popup                              |
| rule               | What an app such as Finicky uses to send pull request links to Lo: “Show rules”, “Copy rule”.                             | handler, setup, config                            |

### The window

| Write | For                                                                                 | Never                             |
| ----- | ----------------------------------------------------------------------------------- | --------------------------------- |
| tab   | One pull request or stack, the Recent tab, a merge queue.                           | page, window                      |
| view  | What fills the middle of a tab: Overview, Diff or Timeline.                         | middle view, mode, pane, screen   |
| panel | The left panel, the threads panel, the merge panel.                                 | sidebar, pane, drawer             |
| files | The list of files in the left panel, as a tree or in review order.                  | “the tree”, explorer, file finder |
| area  | Where a key works: Diff, Files, Comment box. Keyboard shortcuts has a tab for each. | scope, context, mode              |

What a list holds has one noun, and stepping uses it: a block in the overview, an event on the
timeline, a row in the files, a group in Settings, a reason in the merge panel. “Next block”,
“Previous event”.

Component names never reach the screen: banner, toast, dialog, popover, callout, notice, status
item. Nor does “on screen”: write “this revision”, not “the revision on screen”.

### Verbs

| Write                     | For                                                                                                                                                    | Never                                                |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------- |
| Open                      | Bring a pull request, a file or a link into Lo: “Open pull request…”. “Open on GitHub” goes to the browser. A page off GitHub: “Open in browser”.      | Load, Launch, View, Review                           |
| Show, Hide                | Bring something into view, or put it out of view until it’s shown again: “Show r5”, “Hide whitespace changes”.                                         | Load, Display, See, Toggle                           |
| Collapse, Expand          | Fold a folder, a file or a thread, and unfold it: “Collapse file”, then “Expand file”.                                                                 | Open, Close, Fold, Toggle                            |
| Go to                     | Move to a place in the code or the window: “Go to file…”, “Go to definition”.                                                                          | Jump to, Navigate to                                 |
| Next, Previous            | Step through one kind of thing: “Next change”. Back and Forward are for history alone.                                                                 | Prev                                                 |
| Send                      | A comment or a reply: “Sending…”.                                                                                                                      | Post, Publish                                        |
| Save                      | An edit to a comment.                                                                                                                                  | Update, Apply                                        |
| Submit                    | A review: “Submit review…”.                                                                                                                            | Send, Finish                                         |
| Merge                     | Merging, by any method.                                                                                                                                | Ship, Land                                           |
| Approve and ship          | The one command that approves, then merges, queues or turns on auto-merge. Its result says which: “Approved and merged #264”.                          | “Ship” alone                                         |
| Remove                    | Take a thing out of a list. It still exists: “Remove from merge queue”.                                                                                | Take out, Drop                                       |
| Delete                    | Destroy something for good: “Delete comment…”.                                                                                                         | Remove, Erase                                        |
| Discard                   | Throw away text not yet sent: “Discard draft”.                                                                                                         | Delete, Drop                                         |
| Clear                     | Empty a store or a field: “Clear cache”.                                                                                                               | Purge, Wipe                                          |
| Reset                     | Put a setting back to its default: “Reset zoom”.                                                                                                       | Restore, Revert, Actual size                         |
| Dismiss                   | Put away a banner or a toast for good.                                                                                                                 | Hide, Close                                          |
| Copy                      | To the clipboard: “Copy link”. The button reads “Copied” for 2 s.                                                                                      | Yank                                                 |
| Install                   | Put something on this computer: the `lo` command, the overview skill, a language server.                                                               | Set up, Add                                          |
| Sign in, Sign out         | “Sign in with GitHub…” is the one command, for any account. “Sign in again” after a sign-out. The noun is “sign-in”.                                   | Log in, Add an account, Connect, Authorize           |
| Try again                 | Repeat what failed. A retry that’s counting down reads “Retrying in 20 s”, with the button “Try now”. That countdown is the one place “retry” appears. | “Retry” on a button, Reload, “tries again by itself” |
| Check again               | Look again for something missing or not known: Git, a merge’s result. It only looks, and repeats nothing.                                              | Recheck, Look again                                  |
| Paste                     | Open the pull request link on the clipboard: “Paste link”.                                                                                             | “Open the link on the clipboard”                     |
| Turn on, Turn off         | Something of GitHub’s that’s on or off: “Turn on auto-merge”.                                                                                          | Enable, Disable, Toggle                              |
| Continue, Skip            | A welcome step’s buttons. See [Welcome step](#welcome-step).                                                                                           | Next, Not now, Later, Get started                    |
| Cancel, Close, Done, Back | A dialog’s other button. See [Confirmation](#confirmation).                                                                                            | OK, Got it, Not now                                  |

A state is “on” or “off”: “Auto-merge is on”. Never “enabled”, “disabled” or “active”.

For an action that isn’t listed, use the plainest verb for it: Reply, Undo, Rename.

### The system’s things

- **macOS:** Keychain, Finder (“Show in Finder”), Applications, Trash.
- **Linux:** keyring, “Show in file manager”.
- **GitHub CLI** by its name. `gh` only as a command to type.
- **Git** as a name. `git` only as a command to type.
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
- **The thing, “not confirmed”:** the result isn’t known. “Merge not confirmed”

One wording per cause:

| Cause                  | Reason                                            | Button                     |
| ---------------------- | ------------------------------------------------- | -------------------------- |
| No connection          | Offline.                                          | Try again                  |
| GitHub failed          | GitHub returned an error.                         | Try again                  |
| No answer in time      | GitHub didn’t respond.                            | Try again                  |
| Sent, result not known | GitHub didn’t respond.                            | Check again                |
| Rate limit             | GitHub’s rate limit resets at 14:05.              | None                       |
| Rate limit, no time    | GitHub’s rate limit was reached.                  | Try again                  |
| Signed out             | ravi-k is signed out.                             | Sign in again              |
| Sign-in can’t be read  | ravi-k’s sign-in can’t be read from the Keychain. | Try again                  |
| Missing or hidden      | It doesn’t exist, or ravi-k can’t see it.         | Sign in with GitHub…       |
| Newer revision         | #264 has a newer revision.                        | Show latest                |
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

A view or a list with nothing in it.

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

Names a control and gives its key.

| Part  | Limit                                        | Example     |
| ----- | -------------------------------------------- | ----------- |
| Label | The control’s command label.                 | Merge panel |
| Key   | A chip beside it, never typed into the text. | `m`         |

- **A dimmed control’s** tooltip is its refusal reason.
- **A name cut short** shows whole: a path, a branch.
- **Never** a sentence, an error, or anything shown nowhere else.

`packages/desktop/ui/src/MergeStatus.tsx`:

| Before          | After           |
| --------------- | --------------- |
| Merge panel (m) | Merge panel `m` |

### Command label

One label per command: the same in the palette, the menus, the keyboard shortcuts, its button and
its tooltip.

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
  “Next thread filter”. The control lists the options by name.
- **A menu on the thing itself** may drop the object: “Reply”, “Resolve”.
- **A label can be filled in.** The palette, the menus and the keyboard shortcuts show it plain:
  “Show latest”, “Merge…”, “Compare”. A control on the thing names what it acts on: “Show r5”,
  “Merge #264”, “Compare r2 → r5”.
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

`welcome/window/Cover.tsx` and `welcome/window/Steps.tsx`:

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
  written as Vim writes them: NORMAL, INSERT, V-LINE.
- **Lo** has a capital L. Lowercase `lo` only in code: the command, `lo://` links.
- **Apostrophes and quotes are curly:** ’ “ ”. Straight ones only inside code.
- **Quote only what the reader typed:** No commands match “queue”
- **Names are plain text:** repos, accounts, pull requests, language servers. Never quoted, never
  code.
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

| Write                 | For                                                                        |
| --------------------- | -------------------------------------------------------------------------- |
| 20 s, 5 min, 2 h, 3 d | The units, after a space. The largest whole unit only: never “2 h 14 min”. |
| just now              | Under a minute ago.                                                        |
| 5 min ago, 2 h ago    | The past.                                                                  |
| Nov 12                | More than 30 days ago: the date.                                           |
| Nov 12, 2025          | A date in another year.                                                    |
| in 5 min              | Ahead.                                                                     |
| Retrying in 20 s      | A countdown, which says what it’s waiting for.                             |
| about 5 min           | An estimate. Never `~`.                                                    |
| 14:05                 | A time of day, in the system’s own format.                                 |

Never milliseconds. Never “a moment”, “a while” or “soon”.

### Sizes

| Write        | For                                                                    |
| ------------ | ---------------------------------------------------------------------- |
| 512 B, 38 KB | The units, after a space, counted in 1,024s. Whole numbers below 1 MB. |
| 6.2 GB       | One decimal from 1 MB up.                                              |
| 6 GB         | Never “6.0 GB”.                                                        |

Never KiB, MiB or GiB.

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

## Before a string ships

1. Lo does nothing in it. It starts with “Lo” only to name a version.
2. Where Terms names the thing, it uses that row’s Write word and none of that row’s Never words.
3. It fits its shape’s limits.
4. Nothing is said twice, hedged or reassured.
5. It has no straight quote, no three dots, no semicolon and no bracket.
