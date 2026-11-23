<!-- Written by `pnpm nx run desktop:codegen` from each feature's keys.ts in apps/desktop. Change those, not this file. -->

# Keys

Lo is keyboard first: every command has a key, but for a few done once in a while, which a control,
the app menu and the command palette reach. These are its keys as it ships, from the commands each
of its features declares. Keys are written as macOS shows them; on Linux, Ctrl takes the place of
`⌘` (see [Keys for one system](#keys-for-one-system)). A sequence's keys are pressed one after
another: `] f` is `]`, then `f`.

The commands are in 8 groups, the same in Keyboard shortcuts (`?`), the command palette and the app
menu: Go, Review, Comments, Code, View, Merge, Tabs and App. Each command's ID is what
[the keymap file](#the-keymap-file) binds keys to.

## Go

| Command            | Keys              | Where                                                                                                   | ID                       |
| ------------------ | ----------------- | ------------------------------------------------------------------------------------------------------- | ------------------------ |
| Next change        | `] c`             | In `diff`; in code views with Vim keys on, Vim's motion                                                 | `diff.nextChange`        |
| Previous change    | `[ c`             | In `diff`; in code views with Vim keys on, Vim's motion                                                 | `diff.previousChange`    |
| Next file          | `] f`             | In `diff`; in code views with Vim keys on, Vim's motion                                                 | `diff.nextFile`          |
| Previous file      | `[ f`             | In `diff`; in code views with Vim keys on, Vim's motion                                                 | `diff.previousFile`      |
| Next thread        | `] t`             | In `diff`; in code views with Vim keys on, Vim's motion                                                 | `diff.nextThread`        |
| Previous thread    | `[ t`             | In `diff`; in code views with Vim keys on, Vim's motion                                                 | `diff.previousThread`    |
| Go to moved code   | `g m`             | In `diff`; in code views, only in normal mode                                                           | `diff.otherEnd`          |
| Go to other side   | `Tab`             | In `diff`; in code views, only in normal mode                                                           | `diff.otherSide`         |
| Next line          | `j`               | Vim's own key, in code views                                                                            | `diff.down`              |
| Previous line      | `k`               | Vim's own key, in code views                                                                            | `diff.up`                |
| Select lines       | `v`               | Vim's own key, in code views                                                                            | `diff.select`            |
| Find…              | `/`               | Vim's own key, in code views                                                                            | `diff.search`            |
| Find…              | `⌘F` (macOS only) | In `diff` and `file`                                                                                    | `diff.find`              |
| Next match         | `n`               | Vim's own key, in code views                                                                            | `diff.nextMatch`         |
| Previous match     | `N`               | Vim's own key, in code views                                                                            | `diff.previousMatch`     |
| Go to view         | `Esc`             | Anywhere but `menu`, `dialog`, `palette` and `box`; in code views, only in normal mode                  | `keys.escape`            |
| Back               | `⌃o`              | Anywhere but `box`                                                                                      | `keys.back`              |
| Forward            | `⌃i`              | Anywhere but `box`                                                                                      | `keys.forward`           |
| Next block         | `] b`             | In `overview`                                                                                           | `overview.nextBlock`     |
| Previous block     | `[ b`             | In `overview`                                                                                           | `overview.previousBlock` |
| Go to code         | `⏎`               | In `overview`                                                                                           | `overview.follow`        |
| Next link          | `Tab`             | In `overview`                                                                                           | `overview.nextLink`      |
| Previous link      | `⇧Tab`            | In `overview`                                                                                           | `overview.previousLink`  |
| Next step          | `→`               | In `overview`                                                                                           | `overview.nextStep`      |
| Previous step      | `←`               | In `overview`                                                                                           | `overview.previousStep`  |
| Scroll down        | `j`, `↓`          | In `overview`                                                                                           | `overview.scrollDown`    |
| Scroll up          | `k`, `↑`          | In `overview`                                                                                           | `overview.scrollUp`      |
| Go to top          | `g g`, `Home`     | In `overview`                                                                                           | `overview.top`           |
| Go to bottom       | `G`, `End`        | In `overview`                                                                                           | `overview.bottom`        |
| Page down          | `PgDn`            | In `overview`                                                                                           | `overview.pageDown`      |
| Page up            | `PgUp`            | In `overview`                                                                                           | `overview.pageUp`        |
| Next layer         | `] s`             | Anywhere but `menu`, `dialog`, `palette` and `box`; in code views, only in normal mode                  | `stacks.nextLayer`       |
| Previous layer     | `[ s`             | Anywhere but `menu`, `dialog`, `palette` and `box`; in code views, only in normal mode                  | `stacks.previousLayer`   |
| Go to stack        | `-`               | In `tree`                                                                                               | `stacks.focus`           |
| Go to files        | `+`               | In `stack`                                                                                              | `stacks.files`           |
| Next layer         | `j`, `↓`          | In `stack`                                                                                              | `stacks.down`            |
| Previous layer     | `k`, `↑`          | In `stack`                                                                                              | `stacks.up`              |
| Show layer         | `⏎`               | In `stack`                                                                                              | `stacks.show`            |
| Next event         | `j`, `↓`          | In `timeline`                                                                                           | `timeline.down`          |
| Previous event     | `k`, `↑`          | In `timeline`                                                                                           | `timeline.up`            |
| Next link          | `Tab`             | In `timeline`                                                                                           | `timeline.nextLink`      |
| Previous link      | `⇧Tab`            | In `timeline`                                                                                           | `timeline.previousLink`  |
| Go to file…        | `⌘P`              | Anywhere but `dialog` and `palette`                                                                     | `tree.find`              |
| Changed files only | `Tab`             | In `palette`                                                                                            | `tree.findChanged`       |
| Open whole file    | `⌘⏎`              | In `palette`                                                                                            | `tree.findWhole`         |
| Go to files        | `-`               | Anywhere but `menu`, `dialog`, `palette`, `box`, `tree` and `stack`; in code views, only in normal mode | `tree.focus`             |
| Next row           | `j`, `↓`          | In `tree`                                                                                               | `tree.down`              |
| Previous row       | `k`, `↑`          | In `tree`                                                                                               | `tree.up`                |
| Go to top          | `g g`, `Home`     | In `tree`                                                                                               | `tree.top`               |
| Go to bottom       | `G`, `End`        | In `tree`                                                                                               | `tree.bottom`            |
| Page down          | `PgDn`            | In `tree`                                                                                               | `tree.pageDown`          |
| Page up            | `PgUp`            | In `tree`                                                                                               | `tree.pageUp`            |
| Show file          | `⏎`               | In `tree`                                                                                               | `tree.show`              |

## Review

| Command                  | Keys  | Where                                                                                  | ID                |
| ------------------------ | ----- | -------------------------------------------------------------------------------------- | ----------------- |
| Mark viewed              | `e`   | In `diff`; in code views, only in normal mode                                          | `diff.markViewed` |
| Approve and ship…        | `⌘⇧⏎` | Anywhere but `box`, `dialog`, `palette` and `menu`                                     | `merge.ship`      |
| Submit review…           | `⌘⏎`  | Anywhere but `box`, `dialog`, `palette` and `menu`                                     | `review.submit`   |
| Convert to GitHub stack… | `g S` | Anywhere but `menu`, `dialog`, `palette` and `box`; in code views, only in normal mode | `stacks.convert`  |
| Mark viewed              | `e`   | In `tree`                                                                              | `tree.markViewed` |

## Comments

| Command                 | Keys                                                           | Where                                                                                                  | ID                        |
| ----------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------- |
| Comment                 | `c`                                                            | In `diff`; in code views, only in normal and visual mode                                               | `comments.comment`        |
| Comment now             | `C`                                                            | In `diff`; in code views, only in normal and visual mode                                               | `comments.commentNow`     |
| Suggest change          | `s`                                                            | In `diff`; in code views, only in normal and visual mode                                               | `comments.suggest`        |
| Comment on file         | `c`                                                            | In `tree`                                                                                              | `comments.commentOnFile`  |
| Comment on lines        | `c`                                                            | In `overview` and `file`; in code views, only in normal and visual mode                                | `comments.commentOnBlock` |
| Comment on file         | `⏎`                                                            | In `diff`; in code views, only in normal mode                                                          | `comments.onFileInstead`  |
| Reply                   | `r`                                                            | In `diff`; in code views, only in normal mode                                                          | `comments.reply`          |
| Resolve thread          | `x`                                                            | In `diff`; in code views, only in normal mode                                                          | `comments.resolve`        |
| Edit comment            | `i`                                                            | In `diff`; in code views, only in normal mode                                                          | `comments.edit`           |
| Delete comment…         | `d d`                                                          | In `diff`; in code views, only in normal mode                                                          | `comments.remove`         |
| Discard draft           | None: its control, its right-click menu or the command palette | In `box`                                                                                               | `comments.discard`        |
| Undo discard            | None: its control or the command palette                       | Anywhere                                                                                               | `comments.undiscard`      |
| Send again              | None: its control, its right-click menu or the command palette | In `box`                                                                                               | `comments.sendAnyway`     |
| Check again             | None: its control, its right-click menu or the command palette | In `box`                                                                                               | `comments.checkAgain`     |
| Move comment to file    | None: its control, its right-click menu or the command palette | In `box`                                                                                               | `comments.moveToFile`     |
| Add to review           | `⌘⏎`                                                           | In `box`; the editor's own key, which the keymap file can't change                                     | `comments.addToReview`    |
| Send now                | `⌥⏎`                                                           | In `box`; the editor's own key, which the keymap file can't change                                     | `comments.postNow`        |
| Preview                 | `⌘⇧V`                                                          | In `box`; the editor's own key, which the keymap file can't change                                     | `comments.preview`        |
| Attach files…           | `⌘⇧A`                                                          | In `box`; the editor's own key, which the keymap file can't change                                     | `comments.attach`         |
| Leave INSERT mode       | `Esc`                                                          | Vim's own key, in code views                                                                           | `comments.leaveInsert`    |
| Close comment box       | `Esc`                                                          | In `box`; in code views, only in normal mode; the editor's own key, which the keymap file can't change | `comments.close`          |
| Show kept drafts        | None: its control or the command palette                       | Anywhere                                                                                               | `comments.keptDrafts`     |
| Next thread             | `j`, `↓`                                                       | In `threads`                                                                                           | `comments.nextThread`     |
| Previous thread         | `k`, `↑`                                                       | In `threads`                                                                                           | `comments.previousThread` |
| Show in diff            | `⏎`                                                            | In `threads`                                                                                           | `comments.showThread`     |
| Resolve thread          | `x`                                                            | In `threads`                                                                                           | `comments.resolveInPanel` |
| Next thread filter      | `f`                                                            | In `threads`                                                                                           | `comments.filterThreads`  |
| Clear filter            | `⌘⌫`                                                           | In `threads`                                                                                           | `comments.clearFilter`    |
| Collapse thread         | `z a`                                                          | In `diff`; in code views, only in normal mode; only on a thread                                        | `diff.toggleThread`       |
| Comment on pull request | `c`                                                            | In `timeline`                                                                                          | `timeline.comment`        |
| Edit comment            | `i`                                                            | In `timeline`                                                                                          | `timeline.editComment`    |
| Delete comment…         | `d d`                                                          | In `timeline`                                                                                          | `timeline.deleteComment`  |
| Show comment            | None: its right-click menu or the command palette              | In `timeline`                                                                                          | `timeline.showComment`    |
| Show in diff            | None: its right-click menu or the command palette              | In `timeline`                                                                                          | `timeline.showInDiff`     |

The comment box's editor runs these keys itself, so Lo's key engine never does: the command palette
and menus don't offer them, and neither the keymap file nor a `vim` line in it can change them. A
`bind` that names one, or would take its keys in a comment box, is reported, and an `unbind` with no
command leaves them as they are.

`⌘⏎` adds the comment to your review in a box on a line, a file or a thread's reply. In the box for
a comment on the pull request itself, which joins no review, it posts the comment; in a box that
edits one of your comments it saves the edit; and in the review summary's box it submits the review.
`⌥⏎` posts a comment, or a reply, right away, outside your pending review, and posts or saves in the
pull request's own box and an edit's, as `⌘⏎` does. `Esc` closes the box and keeps the draft. With
Vim keys on, `Esc` leaves insert mode first, which is Vim's, and closes the box once it's in normal
mode. In the box's preview, or on its frame, `Esc` closes it at once, from any mode.

## Code

| Command                  | Keys                                              | Where                                                               | ID                       |
| ------------------------ | ------------------------------------------------- | ------------------------------------------------------------------- | ------------------------ |
| Show definition          | `g d`                                             | In `diff` and `file`; in code views, only in normal mode            | `code.definition`        |
| Show references          | `g r`                                             | In `diff`, `file` and `peek`; in code views, only in normal mode    | `code.references`        |
| Show type                | `K`                                               | In `diff` and `file`; in code views, only in normal mode            | `code.type`              |
| Outline                  | `g O`                                             | In `diff` and `file`; in code views, only in normal mode            | `code.outline`           |
| Next definition          | `j`, `↓`                                          | In `peek`; in code views, only in normal mode                       | `code.nextAnswer`        |
| Previous definition      | `k`, `↑`                                          | In `peek`; in code views, only in normal mode                       | `code.previousAnswer`    |
| Go to definition         | `⏎`                                               | In `peek`; in code views, only in normal mode                       | `code.goAnswer`          |
| Close definitions        | `Esc`                                             | In `peek`; in code views, only in normal mode                       | `code.closePeek`         |
| Next reference           | `j`, `↓`                                          | In `references`                                                     | `code.nextReference`     |
| Previous reference       | `k`, `↑`                                          | In `references`                                                     | `code.previousReference` |
| Go to reference          | `⏎`                                               | In `references`                                                     | `code.goReference`       |
| Close references         | `Esc`                                             | In `references`                                                     | `code.closeReferences`   |
| Trust repo…              | None: its control or the command palette          | Anywhere                                                            | `code.trust`             |
| Trust pull request…      | None: its control or the command palette          | Anywhere                                                            | `code.trustPull`         |
| Stop trusting            | None: its control or the command palette          | Anywhere                                                            | `code.untrust`           |
| Restart language servers | None: its control or the command palette          | Anywhere                                                            | `code.restart`           |
| Show language server log | None: its control or the command palette          | Anywhere                                                            | `code.log`               |
| Open whole file          | `g f`                                             | In `diff`; in code views, only in normal mode                       | `diff.wholeFile`         |
| Show large file          | `z a`                                             | In `file`; in code views, only in normal mode                       | `diff.loadWhole`         |
| Copy lines               | `y y`                                             | In `diff` and `file`; in code views, only in normal and visual mode | `diff.copyLines`         |
| Copy link to line        | `y l`                                             | In `diff` and `file`; in code views, only in normal mode            | `diff.copyLink`          |
| Copy path                | `y p`                                             | In `diff` and `file`; in code views, only in normal mode            | `diff.copyPath`          |
| Open on GitHub           | `g x`                                             | In `diff` and `file`; in code views, only in normal mode            | `diff.openOnGithub`      |
| Show overview note       | None: its right-click menu or the command palette | In `diff`; in code views, only in normal mode                       | `diff.overviewNote`      |
| Open whole file          | `g f`                                             | In `tree`                                                           | `tree.wholeFile`         |
| Copy path                | `y p`                                             | In `tree`                                                           | `tree.copyPath`          |
| Open on GitHub           | `g x`                                             | In `tree`                                                           | `tree.openOnGithub`      |

## View

| Command                    | Keys                                                           | Where                                                                                               | ID                      |
| -------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ----------------------- |
| Zoom in                    | `⌘=`, `⌘⇧=`                                                    | Anywhere                                                                                            | `app.zoomIn`            |
| Zoom out                   | `⌘-`                                                           | Anywhere                                                                                            | `app.zoomOut`           |
| Reset zoom                 | `⌘0`                                                           | Anywhere                                                                                            | `app.actualSize`        |
| Type hints                 | `g h`                                                          | In `diff` and `file`; in code views, only in normal mode                                            | `code.hints`            |
| Show latest                | None: its control, its right-click menu or the command palette | In `box`                                                                                            | `comments.showLatest`   |
| Diff                       | None: its control, the app menu or the command palette         | Anywhere                                                                                            | `diff.show`             |
| Side by side               | None: the app menu or the command palette                      | In `diff`                                                                                           | `diff.sideBySide`       |
| Inline                     | `g i`                                                          | In `diff`; in code views, only in normal mode                                                       | `diff.inline`           |
| Hide whitespace changes    | `g w`                                                          | In `diff`; in code views, only in normal mode                                                       | `diff.whitespace`       |
| Show unchanged lines       | `z o`                                                          | In `diff`; in code views, only in normal mode                                                       | `diff.openRun`          |
| Hide unchanged lines       | `z c`                                                          | In `diff`; in code views, only in normal mode                                                       | `diff.closeRun`         |
| Show all unchanged lines   | `z R`                                                          | In `diff`; in code views, only in normal mode                                                       | `diff.openFile`         |
| Collapse file              | `z a`                                                          | In `diff`; in code views, only in normal mode                                                       | `diff.toggleFile`       |
| Command palette            | `⌘⇧P`                                                          | Anywhere                                                                                            | `keys.palette`          |
| Overview                   | None: its control, the app menu or the command palette         | Anywhere                                                                                            | `overview.show`         |
| Code beside                | `o`                                                            | In `overview`                                                                                       | `overview.beside`       |
| Close code beside          | `Esc`                                                          | In `overview`                                                                                       | `overview.closeBeside`  |
| Show latest overview       | None: its right-click menu or the command palette              | Anywhere                                                                                            | `overview.loadNewer`    |
| Try again                  | None: its right-click menu or the command palette              | Anywhere                                                                                            | `overview.retry`        |
| Copy prompt                | `y a`                                                          | Anywhere but `menu`, `dialog`, `palette` and `box`; in code views, only in normal mode              | `overview.copyPrompt`   |
| Compare revisions…         | `g v`                                                          | Anywhere but `menu`, `dialog`, `palette`, `box` and `revisions`; in code views, only in normal mode | `revisions.picker`      |
| Next revision              | `j`, `↓`                                                       | In `revisions`                                                                                      | `revisions.down`        |
| Previous revision          | `k`, `↑`                                                       | In `revisions`                                                                                      | `revisions.up`          |
| Set comparison end         | `Space`                                                        | In `revisions`                                                                                      | `revisions.end`         |
| Compare                    | `⏎`                                                            | In `revisions`                                                                                      | `revisions.compare`     |
| Compare since your review  | `r`                                                            | In `revisions`                                                                                      | `revisions.sinceReview` |
| Compare since last opened  | `s`                                                            | In `revisions`                                                                                      | `revisions.sinceSeen`   |
| Compare whole pull request | `w`                                                            | In `revisions`                                                                                      | `revisions.whole`       |
| Close revisions            | `Esc`                                                          | In `revisions`                                                                                      | `revisions.close`       |
| Select layers              | `v`                                                            | In `stack`                                                                                          | `stacks.choose`         |
| Show layers to here        | None: its right-click menu or the command palette              | Anywhere                                                                                            | `stacks.upTo`           |
| Stop selecting layers      | `Esc`                                                          | In `stack`                                                                                          | `stacks.cancel`         |
| Show single layer          | `Esc`                                                          | In `diff`; in code views, only in normal mode                                                       | `stacks.back`           |
| Left panel                 | `⌘\`                                                           | Anywhere but `dialog` and `palette`                                                                 | `tab.leftPanel`         |
| Threads panel              | `⌘⇧\`                                                          | Anywhere but `dialog` and `palette`                                                                 | `tab.rightPanel`        |
| Next view                  | `` ` ``                                                        | Anywhere but `menu`, `dialog`, `palette` and `box`; in code views, only in normal mode              | `tab.nextView`          |
| Previous view              | `~`                                                            | Anywhere but `menu`, `dialog`, `palette` and `box`; in code views, only in normal mode              | `tab.previousView`      |
| Timeline                   | None: its control, the app menu or the command palette         | Anywhere                                                                                            | `timeline.show`         |
| Compare                    | None: its right-click menu or the command palette              | In `timeline`                                                                                       | `timeline.compare`      |
| Tree                       | None: its control or the command palette                       | In `tree`                                                                                           | `tree.asTree`           |
| Review order               | `t`                                                            | In `tree`                                                                                           | `tree.reviewOrder`      |
| Changed files only         | `f`                                                            | In `tree`                                                                                           | `tree.changedOnly`      |
| Expand folder              | `l`, `→`                                                       | In `tree`                                                                                           | `tree.open`             |
| Collapse folder            | `h`, `←`                                                       | In `tree`                                                                                           | `tree.close`            |
| Expand all folders         | `z R`                                                          | In `tree`                                                                                           | `tree.openAll`          |
| Collapse all folders       | `z M`                                                          | In `tree`                                                                                           | `tree.closeAll`         |

## Merge

| Command                  | Keys                                              | Where                                                                                                     | ID                     |
| ------------------------ | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ---------------------- |
| Merge panel              | `m`                                               | Anywhere but `menu`, `dialog`, `palette`, `box`, `merge` and `commit`; in code views, only in normal mode | `merge.panel`          |
| Next reason              | `j`, `↓`                                          | In `merge`                                                                                                | `merge.down`           |
| Previous reason          | `k`, `↑`                                          | In `merge`                                                                                                | `merge.up`             |
| Open in browser          | `o`                                               | In `merge`                                                                                                | `merge.open`           |
| Next merge method        | `Tab`                                             | In `merge`                                                                                                | `merge.nextMethod`     |
| Previous merge method    | `⇧Tab`                                            | In `merge`                                                                                                | `merge.previousMethod` |
| Edit commit message      | `e`                                               | In `merge`                                                                                                | `merge.edit`           |
| Next unresolved thread   | `] t`                                             | In `merge`                                                                                                | `merge.nextThread`     |
| Merge…                   | `⏎`                                               | In `merge`                                                                                                | `merge.merge`          |
| Turn on auto-merge…      | `a`                                               | In `merge`                                                                                                | `merge.autoMerge`      |
| Bypass rules and merge…  | `⌥⏎`                                              | In `merge`                                                                                                | `merge.override`       |
| Check merge again        | None: its right-click menu or the command palette | Anywhere but `menu`, `dialog`, `palette` and `box`                                                        | `merge.askAgain`       |
| Close merge panel        | `Esc`                                             | In `merge`                                                                                                | `merge.close`          |
| Go to merge panel        | `Esc`                                             | In `commit`                                                                                               | `merge.leaveCommit`    |
| Merge queue              | `g q`                                             | Anywhere but `menu`, `dialog`, `palette` and `box`; in code views, only in normal mode                    | `queue.show`           |
| Next pull request        | `j`, `↓`                                          | In `queue`                                                                                                | `queue.down`           |
| Previous pull request    | `k`, `↑`                                          | In `queue`                                                                                                | `queue.up`             |
| Open pull request        | `⏎`                                               | In `queue`                                                                                                | `queue.open`           |
| Remove from merge queue… | `x`                                               | In `queue`                                                                                                | `queue.remove`         |
| Move to front…           | `J`                                               | In `queue`                                                                                                | `queue.jump`           |
| Turn off auto-merge      | `a`                                               | In `queue`                                                                                                | `queue.autoMerge`      |
| Next branch              | `Tab`                                             | In `queue`                                                                                                | `queue.nextBranch`     |
| Previous branch          | `⇧Tab`                                            | In `queue`                                                                                                | `queue.previousBranch` |
| Open on GitHub           | `g x`                                             | In `queue`                                                                                                | `queue.openOnGithub`   |

## Tabs

| Command               | Keys                                                   | Where                                      | ID                      |
| --------------------- | ------------------------------------------------------ | ------------------------------------------ | ----------------------- |
| Open pull request…    | `⌘L`, `⌘O` (macOS only)                                | Anywhere but `dialog` and `palette`        | `open.box`              |
| Paste link            | `⌘V`                                                   | In `recent`                                | `open.paste`            |
| Filter pull requests… | `/`                                                    | In `recent`                                | `open.filter`           |
| Clear filter          | `⌘⌫`                                                   | In `recent`                                | `open.clearFilter`      |
| Open pull request     | `⏎`                                                    | In `recent`                                | `open.openRecent`       |
| Next pull request     | `j`, `↓`                                               | In `recent`                                | `open.nextRecent`       |
| Previous pull request | `k`, `↑`                                               | In `recent`                                | `open.previousRecent`   |
| Open on GitHub        | `g x`                                                  | In `stack`                                 | `stacks.openOnGithub`   |
| Tab 1                 | `⌘1`                                                   | Anywhere but `dialog` and `palette`        | `tab.show1`             |
| Tab 2                 | `⌘2`                                                   | Anywhere but `dialog` and `palette`        | `tab.show2`             |
| Tab 3                 | `⌘3`                                                   | Anywhere but `dialog` and `palette`        | `tab.show3`             |
| Tab 4                 | `⌘4`                                                   | Anywhere but `dialog` and `palette`        | `tab.show4`             |
| Tab 5                 | `⌘5`                                                   | Anywhere but `dialog` and `palette`        | `tab.show5`             |
| Tab 6                 | `⌘6`                                                   | Anywhere but `dialog` and `palette`        | `tab.show6`             |
| Tab 7                 | `⌘7`                                                   | Anywhere but `dialog` and `palette`        | `tab.show7`             |
| Tab 8                 | `⌘8`                                                   | Anywhere but `dialog` and `palette`        | `tab.show8`             |
| Last tab              | `⌘9`                                                   | Anywhere but `dialog` and `palette`        | `tab.showLast`          |
| Next tab              | `⌘⇧]`, `⌃⇥`                                            | Anywhere but `dialog` and `palette`        | `tab.next`              |
| Previous tab          | `⌘⇧[`, `⌃⇧⇥`                                           | Anywhere but `dialog` and `palette`        | `tab.previous`          |
| Move tab left         | `⌃⇧PgUp`                                               | Anywhere but `dialog` and `palette`        | `tab.moveLeft`          |
| Move tab right        | `⌃⇧PgDn`                                               | Anywhere but `dialog` and `palette`        | `tab.moveRight`         |
| More tabs             | `⌘⇧A`                                                  | Anywhere but `dialog`, `palette` and `box` | `tab.more`              |
| Open on GitHub        | None: the app menu or the command palette              | Anywhere                                   | `tab.openOnGithub`      |
| Copy link             | None: the app menu or the command palette              | Anywhere                                   | `tab.copyLink`          |
| Choose account…       | None: its control, the app menu or the command palette | Anywhere but `dialog` and `palette`        | `tab.chooseAccount`     |
| Next message          | None: its control or the command palette               | Anywhere                                   | `tab.nextBanner`        |
| Dismiss message       | None: its control or the command palette               | Anywhere                                   | `tab.dismissBanner`     |
| Close tab             | `⌘W`                                                   | Anywhere but `dialog` and `palette`        | `tab.close`             |
| Open on GitHub        | `g x`                                                  | In `timeline`                              | `timeline.openOnGithub` |

## App

| Command                 | Keys                                                           | Where                                                                                  | ID                            |
| ----------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ----------------------------- |
| Copy sign-in code       | `y y`                                                          | In `dialog`                                                                            | `accounts.copyCode`           |
| Sign in with GitHub…    | None: its control or the command palette                       | Anywhere                                                                               | `accounts.addAccount`         |
| Sign out…               | None: its control or the command palette                       | Anywhere                                                                               | `accounts.signOut`            |
| Open licenses           | None: its control, its right-click menu or the command palette | Anywhere                                                                               | `app.licenses`                |
| Documentation           | None: the app menu or the command palette                      | Anywhere                                                                               | `app.docs`                    |
| Report issue            | None: the app menu or the command palette                      | Anywhere                                                                               | `app.report`                  |
| Vim keys                | None: its control or the command palette                       | Anywhere                                                                               | `comments.vim`                |
| Keyboard shortcuts      | `?`                                                            | Anywhere                                                                               | `keys.help`                   |
| Show key                | `⌥⏎`                                                           | In `palette`                                                                           | `keys.showKey`                |
| Show right-click menu   | `Menu`, `⇧F10`                                                 | Anywhere but `menu`, `dialog` and `palette`                                            | `keys.menu`                   |
| Open keymap file        | `g ,`                                                          | Anywhere but `menu`, `dialog`, `palette` and `box`; in code views, only in normal mode | `keys.openKeymap`             |
| Install `lo` command    | None: its control or the command palette                       | Anywhere                                                                               | `open.installCommand`         |
| Install overview skill  | None: its control or the command palette                       | Anywhere                                                                               | `overview.installSkill`       |
| Copy install command    | `y c`                                                          | In `settings`                                                                          | `overview.copyInstallCommand` |
| Settings                | `⌘,`                                                           | Anywhere but `dialog` and `palette`                                                    | `settings.open`               |
| Next group              | `j`                                                            | In `settings`                                                                          | `settings.nextSection`        |
| Previous group          | `k`                                                            | In `settings`                                                                          | `settings.previousSection`    |
| Search settings         | `/`, `⌘F`                                                      | In `settings` and `noMatch`                                                            | `settings.search`             |
| Clear search            | `⌘⌫`                                                           | In `noMatch`                                                                           | `settings.clearSearch`        |
| Open settings.json      | `g .`                                                          | Anywhere but `menu`, `dialog`, `palette` and `box`; in code views, only in normal mode | `settings.openFile`           |
| Show cache folder       | `g c`                                                          | In `settings`                                                                          | `settings.showCache`          |
| Check for updates       | None: its control, the app menu or the command palette         | Anywhere                                                                               | `updates.check`               |
| Update Lo               | None: its control or the command palette                       | Anywhere                                                                               | `updates.install`             |
| Restart to update       | None: its control, the app menu or the command palette         | Anywhere                                                                               | `updates.restart`             |
| Move Lo to Applications | None: its control or the command palette                       | Anywhere                                                                               | `updates.move`                |
| Hide update             | None: its control or the command palette                       | Anywhere                                                                               | `updates.later`               |
| What’s new              | None: its control, the app menu or the command palette         | Anywhere                                                                               | `updates.whatsNew`            |
| Download update         | None: its control or the command palette                       | Anywhere                                                                               | `updates.download`            |
| Copy Homebrew command   | None: its control or the command palette                       | Anywhere                                                                               | `updates.copy`                |
| Go to update            | None: its control or the command palette                       | Anywhere                                                                               | `updates.focus`               |
| Welcome to Lo           | None: its control, the app menu or the command palette         | Anywhere                                                                               | `welcome.show`                |
| Continue                | `⏎`                                                            | In `welcome`                                                                           | `welcome.continue`            |

## Where keys apply

A key applies in a scope: the nearest part of the window around the focused element that names one,
or `window`. A key for a scope beats one for anywhere, so the same chord can mean one thing in a
comment box and another elsewhere. A key for one kind of thing, such as a review thread, applies
only while it's on one: the thread `] t` landed on, or the only one under the cursor's line. There
it beats the key for the scope, so `z a` collapses the thread it's on, and the file elsewhere.

| Scope        | What it is                                                                            |
| ------------ | ------------------------------------------------------------------------------------- |
| `window`     | Anywhere no other scope has focus.                                                    |
| `menu`       | A menu. Only commands that name it run there, and `j` and `k` move as `↓` and `↑` do. |
| `dialog`     | A dialog, which keeps the browser's `Tab`.                                            |
| `palette`    | A palette, such as the command palette.                                               |
| `diff`       | The diff, a code view.                                                                |
| `file`       | A whole file, a code view.                                                            |
| `peek`       | A peek at code elsewhere, such as a definition, a code view.                          |
| `box`        | A comment box, a code view with an insert mode.                                       |
| `references` | Named by `code`.                                                                      |
| `threads`    | Named by `comments`.                                                                  |
| `merge`      | Named by `merge`.                                                                     |
| `commit`     | Named by `merge`.                                                                     |
| `recent`     | Named by `open`.                                                                      |
| `overview`   | Named by `overview`.                                                                  |
| `queue`      | Named by `queue`.                                                                     |
| `revisions`  | Named by `revisions`.                                                                 |
| `settings`   | Named by `settings`.                                                                  |
| `noMatch`    | Named by `settings`.                                                                  |
| `stack`      | Named by `stacks`.                                                                    |
| `timeline`   | Named by `timeline`.                                                                  |
| `tree`       | Named by `tree`.                                                                      |
| `toasts`     | Named by `updates`.                                                                   |
| `welcome`    | Named by `welcome`.                                                                   |

Vim keys are a setting, `editor.vim`, off as Lo starts. Off, a code view has a plain caret: Lo's
keys run there as they do anywhere, and of the keys listed as Vim's own the code view runs `j`, `k`,
`g g`, `G`, `/`, `n` and `N` itself. A comment box is typed in from the moment it has focus, so only
chords are Lo's there. With Vim keys on, keys in a code view follow Vim's mode. In insert mode, and
while Vim waits for the rest of a command (after a count or an operator), only chords are Lo's, and
other keys go to Vim, but for the keys of Lo's commands that take a count, after a count alone in
normal mode (see [Counts](#counts)). In a text field, typing and moving through the text are the
field's.

In a field that can be edited, a comment box's text among them, so are the keys that edit text,
chords too, and they run no command there but one that edits that field itself: `⌥⌫`, `⌘⌫`, `⌥⌦`,
`⌘A`, `⌘Z`, `⌘⇧Z`, `⌥←`, `⌥⇧←`, `⌥→`, `⌥⇧→`, `⌥↑`, `⌥⇧↑`, `⌥↓`, `⌥⇧↓`, `⌘←`, `⌘⇧←`, `⌘→`, `⌘⇧→`,
`⌘↑`, `⌘⇧↑`, `⌘↓`, `⌘⇧↓`, `Home`, `⇧Home`, `End`, `⇧End`, `⌃a`, `⌃⇧A`, `⌃e`, `⌃⇧E`, `⌃b`, `⌃⇧B`,
`⌃f`, `⌃⇧F`, `⌃p`, `⌃⇧P`, `⌃n`, `⌃⇧N`, `⌃h`, `⌃d`, `⌃k`, `⌃t` and `⌃o` on macOS, and
`Ctrl+Backspace`, `Ctrl+Delete`, `Ctrl+A`, `Ctrl+Z`, `Ctrl+Shift+Z`, `Ctrl+Y`, `Ctrl+←`,
`Ctrl+Shift+←`, `Ctrl+→`, `Ctrl+Shift+→`, `Ctrl+↑`, `Ctrl+Shift+↑`, `Ctrl+↓`, `Ctrl+Shift+↓`,
`Ctrl+Home`, `Ctrl+Shift+Home`, `Ctrl+End`, `Ctrl+Shift+End`, `Home`, `Shift+Home`, `End` and
`Shift+End` on Linux. A read-only field, and a code view's own text, edit nothing, so Lo's keys run
there.

A key that starts one of Lo's sequences waits for the rest. In a code view it waits however long it
takes, as Vim's own `y` and `g` do, and a key that doesn't go on with it goes to the code view after
it, so with Vim keys on `y w` still yanks a word. Anywhere else it waits up to 1 s, and if the rest
doesn't come it's dropped, and the next key counts on its own. A chord Lo runs drops the waiting
key, as do `Esc`, focus leaving, a click, by the pointer or as VoiceOver and Voice Control click,
and a tab switch. A key typed with focus nowhere in particular, rather than on a button or another
control, as while a pull request's tab is still loading, isn't dropped when Lo gives a view focus:
it goes on there, if one of the view's sequences starts with it, still for up to 1 s, and in a code
view a key that doesn't go on with it goes to the code view after it, as if both were typed there,
so `g g` still goes to the top. The status bar shows the keys waiting, after any count, as Vim shows
a command it's waiting on the rest of.

`Tab` doesn't move focus out of a scope; only dialogs and forms keep the browser's `Tab`.

## Counts

Digits typed just before a key are a count, as in Vim, for the commands that take one: `3 e` marks
three files viewed, and `1 e` one, where `e` alone clears a mark. Before any other key a count is
dropped, and the key runs once; in a code view with Vim keys on it goes on to Vim with the key, so
`3 j` still moves three lines. `Esc` drops a count and does nothing else.

| Command        | Keys     | Counts | Where                                                                                  | ID                     |
| -------------- | -------- | ------ | -------------------------------------------------------------------------------------- | ---------------------- |
| Mark viewed    | `e`      | files  | In `diff`; in code views, only in normal mode                                          | `diff.markViewed`      |
| Copy lines     | `y y`    | lines  | In `diff` and `file`; in code views, only in normal and visual mode                    | `diff.copyLines`       |
| Next layer     | `] s`    | layers | Anywhere but `menu`, `dialog`, `palette` and `box`; in code views, only in normal mode | `stacks.nextLayer`     |
| Previous layer | `[ s`    | layers | Anywhere but `menu`, `dialog`, `palette` and `box`; in code views, only in normal mode | `stacks.previousLayer` |
| Next row       | `j`, `↓` | rows   | In `tree`                                                                              | `tree.down`            |
| Previous row   | `k`, `↑` | rows   | In `tree`                                                                              | `tree.up`              |
| Mark viewed    | `e`      | files  | In `tree`                                                                              | `tree.markViewed`      |

In a code view with Vim keys on, the count is Vim's until one of these keys takes it, in normal mode
only; with them off, a code view counts as any other scope does. Elsewhere digits are a count only
in `tree`, where a command of the scope's own takes one, and a count waits for its key as a
sequence's first key does.

## Keys for one system

On Linux, Ctrl takes the place of `⌘` in every key, and Lo shows each system its keys in its own
form: `⌘⇧P` is `Ctrl+Shift+P` on Linux. `⌃` is Ctrl on both, so Vim's `⌃o` is `Ctrl+O` on Linux.

These keys are on one system only:

| Command                 | Keys                                                            | On    | Where                                       | ID               |
| ----------------------- | --------------------------------------------------------------- | ----- | ------------------------------------------- | ---------------- |
| Quit Lo                 | `Ctrl+Q`                                                        | Linux | Anywhere                                    | `app.quit`       |
| Full screen             | `F11`                                                           | Linux | Anywhere                                    | `app.fullScreen` |
| About Lo                | None: the app menu, its right-click menu or the command palette | Linux | Anywhere                                    | `app.about`      |
| Find…                   | `⌘F`                                                            | macOS | In `diff` and `file`                        | `diff.find`      |
| Find…                   | `Ctrl+Shift+F`                                                  | Linux | In `diff` and `file`                        | `diff.find`      |
| Show menu               | `F10`                                                           | Linux | Anywhere but `menu`, `dialog` and `palette` | `keys.appMenu`   |
| Open pull request…      | `⌘O`                                                            | macOS | Anywhere but `dialog` and `palette`         | `open.box`       |
| Move Lo to Applications | None: its control or the command palette                        | macOS | Anywhere                                    | `updates.move`   |

On Linux, in a comment box in insert mode, and in a field inside a code view such as Vim's search,
Lo never takes `Ctrl+C`, `Ctrl+X`, `Ctrl+V`, `Ctrl+A`, `Ctrl+Z` or `Ctrl+W`: they keep their editing
meanings.

## Keys over Vim's

With Vim keys on, code views (`diff`, `file`, `peek` and `box`) run Vim, and Lo leaves Vim's keys to
it there, except these, which run Lo's command in place of Vim's key. With Vim keys off, which is
how Lo starts, they run Lo's command too:

| Keys             | Command                 | Vim's key | Where                                                                | ID                        |
| ---------------- | ----------------------- | --------- | -------------------------------------------------------------------- | ------------------------- |
| `c`              | Comment                 | `c`       | `diff`                                                               | `comments.comment`        |
| `C`              | Comment now             | `C`       | `diff`                                                               | `comments.commentNow`     |
| `s`              | Suggest change          | `s`       | `diff`                                                               | `comments.suggest`        |
| `⏎`              | Comment on file         | `⏎`       | `diff` (normal)                                                      | `comments.onFileInstead`  |
| `r`              | Reply                   | `r`       | `diff` (normal)                                                      | `comments.reply`          |
| `x`              | Resolve thread          | `x`       | `diff` (normal)                                                      | `comments.resolve`        |
| `i`              | Edit comment            | `i`       | `diff` (normal)                                                      | `comments.edit`           |
| `d d`            | Delete comment…         | `d`       | `diff` (normal)                                                      | `comments.remove`         |
| `e`              | Mark viewed             | `e`       | `diff` (normal)                                                      | `diff.markViewed`         |
| `g i`            | Inline                  | `g i`     | `diff` (normal)                                                      | `diff.inline`             |
| `g w`            | Hide whitespace changes | `g w`     | `diff` (normal)                                                      | `diff.whitespace`         |
| `y y`            | Copy lines              | `y`       | `diff` and `file`                                                    | `diff.copyLines`          |
| `y l`            | Copy link to line       | `y`       | `diff` (normal) and `file` (normal)                                  | `diff.copyLink`           |
| `y p`            | Copy path               | `y`       | `diff` (normal) and `file` (normal)                                  | `diff.copyPath`           |
| `?`              | Keyboard shortcuts      | `?`       | `diff`, `file`, `peek` and `box` (normal and visual)                 | `keys.help`               |
| `⌃o`             | Back                    | `⌃o`      | `diff`, `file` and `peek`                                            | `keys.back`               |
| `⌃i`             | Forward                 | `⌃i`      | `diff`, `file` and `peek`                                            | `keys.forward`            |
| `m`              | Merge panel             | `m`       | `diff` (normal), `file` (normal) and `peek` (normal)                 | `merge.panel`             |
| `y a`            | Copy prompt             | `y`       | `diff` (normal), `file` (normal) and `peek` (normal)                 | `overview.copyPrompt`     |
| `g q`            | Merge queue             | `g q`     | `diff` (normal), `file` (normal) and `peek` (normal)                 | `queue.show`              |
| `g v`            | Compare revisions…      | `g v`     | `diff` (normal), `file` (normal) and `peek` (normal)                 | `revisions.picker`        |
| `` ` ``          | Next view               | `` ` ``   | `diff` (normal), `file` (normal) and `peek` (normal)                 | `tab.nextView`            |
| `~`              | Previous view           | `~`       | `diff` (normal), `file` (normal) and `peek` (normal)                 | `tab.previousView`        |
| `-`              | Go to files             | `-`       | `diff` (normal), `file` (normal) and `peek` (normal)                 | `tree.focus`              |
| `c`              | Comment on lines        | `c`       | `file`                                                               | `comments.commentOnBlock` |
| `j`              | Next definition         | `j`       | `peek` (normal)                                                      | `code.nextAnswer`         |
| `↓`              | Next definition         | `↓`       | `peek` (normal)                                                      | `code.nextAnswer`         |
| `k`              | Previous definition     | `k`       | `peek` (normal)                                                      | `code.previousAnswer`     |
| `↑`              | Previous definition     | `↑`       | `peek` (normal)                                                      | `code.previousAnswer`     |
| `⏎`              | Go to definition        | `⏎`       | `peek` (normal)                                                      | `code.goAnswer`           |
| `Ctrl+Q` (Linux) | Quit Lo                 | `Ctrl+Q`  | `diff`, `file`, `peek` and `box` (normal and visual)                 | `app.quit`                |
| `Ctrl+W` (Linux) | Close tab               | `Ctrl+W`  | `diff` (normal), `file` (normal), `peek` (normal) and `box` (normal) | `tab.close`               |
| `Ctrl+P` (Linux) | Go to file…             | `Ctrl+P`  | `diff`, `file`, `peek` and `box` (normal and visual)                 | `tree.find`               |

With Vim keys on, Vim runs Lo's motions in code views (next change, previous change, next file,
previous file, next thread and previous thread) under Lo's keys, so a count repeats them and they
extend a selection in visual mode. With Vim keys off, Lo runs them itself.

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
`bind` doesn't apply when it names one of Vim's own keys or one of the comment box's (see Comment
box), repeats a key the command already has, or would keep another command's key from running: one
of the two being the start of the other where both apply. A `bind` that would take the comment box's
keys there is refused too, and an `unbind` with no command leaves them as they are. A `vim` line
can't take them either: the box's editor runs its own keys before Vim's.

Lo watches the file, so a saved change applies within a second, with no restart, and Keyboard
shortcuts (`?`) shows the new keys and the lines Lo can't use. To open the file, use the button in
Keyboard shortcuts, the command palette or `g ,`: Lo opens it as text in your system's text editor,
writing it first, with a header of comments, if there isn't one. Opening never runs anything, so Lo
doesn't open a file that is executable, isn't a plain file (a folder, or an app a link leads to) or
is over the limit below: Keyboard shortcuts says why, and has no button. The editor is the app for
text whatever the file's name or contents, even through a link to a file named like a launcher or a
web page: on Linux, the app `xdg-mime query default text/plain` names, started with `gio launch`.
Without one of those, Lo says so and opens nothing. A link to a file in a dotfiles folder is
followed. Lo reads a file of up to 1 MB and lines of up to 1,000 characters; a longer line is
reported and skipped, and a longer file isn't read. Nothing in the file is ever run.

### Writing keys

Keys are written the same way in the keymap file and in Lo's code:

- A chord joins modifiers and a key with `+`: `cmd+shift+p`. `cmd` is `⌘` on macOS and Ctrl on
  Linux, `ctrl` is `⌃` on macOS and Ctrl on Linux, `alt` is `⌥` (Alt) and `shift` is `⇧`.
- A sequence separates its keys with spaces: `] f`, `g S`.
- A key is one character, or one of `enter`, `esc`, `tab`, `space`, `backspace`, `delete`, `up`,
  `down`, `left`, `right`, `home`, `end`, `pageup`, `pagedown`, `insert`, `menu`, and `f1` to `f20`.
  `plus` is `+`.
- A lone letter's case is its key: `G` is Shift and G, as is `shift+g`.
