---
format: 1
pr: 182
commit: 8cb8adb16cc52f313813e32d51b9ef974e96ee89
---

## tl;dr

Moved code in the diff had "Moved from" and "Moved to" labels that led nowhere. Now `g m` goes from
a moved line to the line it moved with at the [other end](<term:other end>), and a click on a label
goes to the first line there. Both are jumps in the tab's history, so `⌃o` comes back.

## How it works

`g m` is a new command of the diff, `diff.otherEnd`. It acts on the cursor's line, and it's declared
a jump, so the place it leaves is recorded before it runs:

:::code apps/desktop/src/features/diff/keys.ts#L71-L78
:::

The key and the label's click share one small module, `moved.ts`. Each asks the code view where the
other end is, goes into that end's file, then puts the cursor there:

:::code apps/desktop/src/features/diff/window/moved.ts#L28-L56
:::

:::walkthrough From a moved line to its other end
:::step apps/desktop/src/features/diff/window/index.ts#L156-L161
The command can run only on a line in moved code. Anywhere else it says "There’s no moved code on
this line.", and the palette doesn't offer it.
:::
:::step packages/desktop/ui/src/code/view.ts#L2749-L2770
The code view finds the move the line is in and pairs the two ends line for line, leaving blank
lines out, as the move was found. While either end's file has no lines in the view, nothing pairs
them, so it answers with the block's first line. That early return is new.
:::
:::step apps/desktop/src/features/diff/window/drawing.ts#L365-L379
`enter` is new too. Going into a file counts as acting on it, like a key pressed there. A file
[kept out](<term:kept out>) whose lines have already come takes them now.
:::
:::step apps/desktop/src/features/diff/window/moved.ts#L28-L34
`fromMoved` asks for the other end, enters its file, then asks again. The second answer can pair
the lines that `enter` just brought in.
:::
:::step apps/desktop/src/features/diff/window/moved.ts#L52-L56
The file opens if it was closed, and the cursor lands on the line by the least scroll, with focus.
:::
:::

A label's click takes the same path through `followLabel`, with one difference. A click doesn't
move the cursor, so the place it records in the history is the label's own line, not the cursor's:

:::code apps/desktop/src/features/diff/window/drawing.ts#L486-L489
:::

## Where to look

- **The early return in [`otherEnd`](code:packages/desktop/ui/src/code/view.ts#L2757-L2760).** It
  used to give the last line of the other end while that end's file had no lines. Check that every
  caller is happy with the block's first line instead.
- **Asking twice in [`fromMoved`](code:apps/desktop/src/features/diff/window/moved.ts#L31-L32).**
  The first answer may be the block's first line, because the file was kept out. The second, after
  `enter`, is the paired line when the lines came in time, and falls back to the first answer.
- **[`enter`](code:apps/desktop/src/features/diff/window/drawing.ts#L375-L379) reads the pending
  change before `acted` deletes it.** The order matters: swapped, a file waiting to be brought in
  would never be.
- **`g m` isn't declared over Vim's key.** The code views' Vim has no `g m` of its own, so the
  check for shadowed keys refuses the declaration. The command's comment in
  [`keys.ts`](code:apps/desktop/src/features/diff/keys.ts#L65-L70) says so.

:::fold Why the label records its own line
"Read it in the overview" already works this way: a click on something drawn in the diff records the
line it's drawn at. Recording the cursor's line would send `⌃o` somewhere the reader wasn't looking.
:::

## How it was checked

The pull request's checks all passed on this commit: `check`, the four `app` end-to-end shards,
`format`, `oldest-git` and the rest.

It adds these tests. They ran in those checks; nothing was run again for this overview.

- [`moved.test.ts`](code:apps/desktop/src/features/diff/window/moved.test.ts) covers `g m` to the
  same line and back, ends that differ in blank lines, a file kept out, and the label's click.
- [`drawing.test.ts`](code:apps/desktop/src/features/diff/window/drawing.test.ts#L472-L490) covers
  `enter` taking the lines that wait for a file.
- [`view.test.ts`](code:packages/desktop/ui/src/code/view.test.ts#L2164-L2173) covers `otherEnd`.
- [`diff.spec.ts`](code:apps/desktop/e2e/diff.spec.ts#L452-L467) presses `g m` in the built app,
  comes back with `⌃o`, and clicks a label. The description says all 23 of its cases passed.

## Glossary

- **Other end**: where moved code went, seen from where it came from, or the reverse. A move has
  two ends: the lines removed from one place and the same lines added in another.
- **Kept out**: a file the diff lists but hasn't drawn the lines of yet, such as a large one. Its
  header shows, and its lines come when the reader opens it.
