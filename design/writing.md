# Writing the interface

Lo's copy is plain, short and specific. It names things the way a reviewer would say them out loud,
and it never makes the reader guess what will happen.

## Rules

- **Sentence case** for everything: buttons, menus, headings, tabs. Only panel labels are uppercase,
  and that's styling (`text-label`), not the text.
- **Buttons say what they do,** starting with a verb: "Load the newer push", "Trust this repo", "Add
  to review", "Comment now", "Clear the cache", "Make this a GitHub stack". Not "OK", "Submit" or
  "Continue".
- **Use the reviewer's words.** A push, a revision (`r3`), the local copy, a stack and its layers,
  an overview, viewed. Not "refetch", "snapshot", "clone", "artifact" or "node".
- **Say what happened, then what to do.** "The repo's file list didn't load (GitHub returned 502).
  Retrying in 20 s." "Git 2.38 or later is needed. How to install it." No apologies, no "Oops", no
  "Something went wrong".
- **Name the cause when Lo knows it,** and say when it doesn't: "GitHub blocks this merge for a
  reason Lo can't see. Open the PR on GitHub."
- **Short sentences, active voice.** Drop words that don't change the meaning. One idea per
  sentence.
- **Address the reader as "you"** and Lo as "Lo". Never "we", never "I".
- **No exclamation marks, no emoji, no jokes** in the interface.
- **Numbers as numbers:** "214 files", "41 / 214 viewed", "3 hours ago", "r3 → r5", "#4821". Use `→`
  for a comparison and `·` to separate meta.
- **Write the name Lo** with a capital L. Lowercase `lo` only for the command and `lo://` links.

## Patterns

| Situation                  | Write                                                                                                          |
| -------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Empty state                | What's missing, then the one thing to do. "This PR has no overview yet. Copy this prompt into a coding agent." |
| Out of date                | What and since when. "Written for r3. The PR is at r5."                                                        |
| Confirmation               | Exactly what will happen, in order. "Approve, then add to the merge queue for main."                           |
| A thing that can't happen  | Each reason on its own line, linked to where to fix it.                                                        |
| Progress                   | What's happening and how far. "Fetching the local copy · 62%".                                                 |
| Something Lo did by itself | Say so once, quietly, in the status bar.                                                                       |
