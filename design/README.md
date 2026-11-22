**Lo's design language.** These are the rules every screen in Lo follows. Read this file before you
change anything in the interface. Values live in `tokens.json`; the stylesheets that use them live
in `css/`.

Lo is a desktop app for reviewing GitHub pull requests, for people who read far more code than they
write. It should look like its own product: a quiet reading room built around one accent, not the
code editor it started as.

## Principles

1. **Reading comes first.** The overview reads like a document, the diff like code, and the chrome
   stays out of the way. When in doubt, take something away.
2. **One accent, for where you are.** Powder (`lo-accent`) marks focus, the cursor, selection,
   links, the main button and the thing on screen. Nothing else is Powder.
3. **Status keeps GitHub's meanings.** Green is open, added or passing; red is closed, removed or
   failing; purple is merged; amber is waiting or changed. Never use these colors for decoration.
4. **The keyboard is discoverable.** Every action has a key and a visible control. A control shows
   its key where the key works now, and in its tooltip everywhere else.
5. **The middle view is a sheet.** The overview, diff and timeline sit on the ground (`lo-bg`) with
   round top corners, set into the lighter chrome the way the mark's ball sits in its socket.
6. **Show what's true.** Real code, real states, real counts. Don't fake progress, round away errors
   or hide why something can't happen.

## The mark

- Draw the mark, wordmark and lockup in `lo-mark` only: chalk (`lo-chalk`) on dark grounds, ink
  (`lo-ink`) on light ones. Never Powder, never a status color, never a gradient, glow, outline or
  shadow.
- Use the files in `brand/logo/`: `*-chalk.svg` on dark, `*-ink.svg` on light. Never redraw the mark
  in CSS or retype the wordmark.
- Inside the app, the mark appears on the welcome screen and the sign-in screen, plus the places
  `brand/README.md` lists. It never appears in the tab bar, the PR header or as an icon inside the
  interface. Window titles use the name as text.
- Write the name **Lo**, capital L, wherever people read it. Lowercase `lo` only in code: the
  command, `lo://` links, file paths.
- Keep the ball's radius clear around the mark on every side. The mark is at least 16 px.

## Color

Dark (Lo Glow Dark) is the default. Every color comes from `tokens.json` through a CSS variable:
`var(--lo-bg)`, never a hex value in a component.

### Surfaces

| Token                                 | Where                                                                               |
| ------------------------------------- | ----------------------------------------------------------------------------------- |
| `lo-bg`                               | The ground: the middle view, every code view, the tab strip.                        |
| `lo-bg-chrome`                        | One step lighter: PR header, side panels, status bar, the active tab, file headers. |
| `lo-bg-raised`                        | Things that sit on a surface as their own object: threads, cards.                   |
| `lo-bg-overlay`                       | Popovers: hover cards, menus.                                                       |
| `lo-bg-well`                          | Inputs and segmented-control tracks set into chrome.                                |
| `lo-hover`, `lo-press`, `lo-selected` | Translucent states that work on any surface.                                        |
| `lo-current`                          | The thing on screen: the file in the diff, the layer, the step.                     |

- Separate areas with a surface step first, a hairline (`lo-border`, `lo-border-subtle`) second, and
  a shadow only on things that float (`lo-shadow-pop`, `lo-shadow-dialog`).
- Don't add a new surface color. If none of these fits, the layout is wrong.
- Light and dark carry the same number of steps. Every new tint is checked in both.
- The scrim behind a dialog (`lo-scrim`) dims the window without changing its color: in light the
  cream stays cream, and the dialog's shadow does the separating.

### Text

- `lo-fg` for primary text, `lo-fg-muted` for meta, `lo-fg-subtle` for placeholders and separators.
  All reach 4.5:1 on `lo-bg`, `lo-bg-chrome`, `lo-bg-raised` and `lo-bg-overlay` in both themes.
- The three levels read as three in both themes. Dim something with the next level down, never with
  opacity.
- `lo-fg-dim` marks unchanged files beside changed ones in the tree, and rings a switch that's off.
  Use it for nothing else.
- `lo-fg-disabled` and `lo-code-gutter` fall below 4.5:1 on purpose. Use them only for disabled
  controls and line numbers.

### The accent

- Use `lo-accent` for: the focus ring, the text cursor, selection, links, the one main button in a
  view, and what's on screen (current file, current layer, current step, the overview marker).
- Put `lo-on-accent` on Powder fills, never white or chalk directly.
- One main (`lo-btn--primary`) button per view at most.
- Don't use the accent for headings, icons at rest, borders at rest or to make something "pop".
- The on-screen tint and Powder mean "this is where you are", and nothing else.

### Status, PR state and diffs

- PR state: `lo-state-open`, `-draft`, `-merged`, `-closed`, each with `-bg` and `-border`. Always
  pair the color with the state's icon and word.
- Status: `lo-success`, `lo-warning`, `lo-danger`, `lo-info`, each with `-bg` and `-border`. A
  status color never appears without a word or icon that says the same thing.
- Diff: whole lines use `lo-diff-add-bg` / `lo-diff-del-bg`; changed words inside them
  `lo-diff-add-word` / `lo-diff-del-word`; signs and gutters `lo-diff-add-fg` / `lo-diff-del-fg`.
  Moved code uses the `lo-diff-moved-*` tokens, never green or red: a near-neutral ground, with the
  label over the block and the `⇄` in its gutter carrying the meaning, so it never reads as a
  selection.
- Syntax uses the `lo-syn-*` tokens only, named after tree-sitter captures. Parameters, comments and
  `this` are italic; nothing else is.

## Type

- **Host Grotesk** for the interface and for reading. **Fragment Mono** for code, paths, branch
  names, commit ids and keys. Ship both with the app; never load fonts from the network.
- Set text with the shorthands from `css/type.css`: `font: var(--lo-text-ui)`. Don't set font size,
  weight and line height separately.
- The interface scale is small and dense: `text-ui` (13/18) is the default, `text-small` (12/16) for
  meta and tree rows, `text-micro` (11/14) for counts and tags, `text-label` (11/14, 600, uppercase,
  `--lo-track-label`) for panel labels.
- Titles take the wordmark's weight: `text-title` (18/24, 700) for the PR title, `text-heading`
  (24/30, 800) for empty states and dialogs, with `--lo-track-tight`.
- Reading text has its own scale: `read-body` (15/24), `read-lead` (17/27, the tl;dr), `read-h2`
  (22/28, 800), `read-h3` (16/22, 700), `read-comment` (13.5/21). Keep reading lines under
  `--lo-read-measure` (680 px).
- Code is `--lo-code-size` on a fixed `--lo-code-line` (12.5/20) so both sides of a diff share one
  row grid.
- Use `font-variant-numeric: tabular-nums` (`.lo-num`) wherever digits line up: counts, line
  numbers, sizes, times.
- Sentence case everywhere. Uppercase only for `text-label`.

## Space, shape and depth

- Space on a 4 px grid: `lo-sp-4`, `-8`, `-12`, `-16`, `-24`, `-32`, `-48`, `-64`, with `-2` and
  `-6` for tight spots inside controls. Lay out siblings with flex or grid and `gap`.
- Rows are `lo-row-h` (24 px) in lists, `lo-code-line` (20 px) in code. Controls are `lo-control-h`
  (28 px) or `lo-control-h-sm` (22 px).
- Corners are round like the mark: `lo-r-xs` (3) keys and tags, `lo-r-sm` (6) controls and rows,
  `lo-r-md` (9) threads, cards and popovers, `lo-r-lg` (12) the sheet and dialogs, `lo-r-pill`
  segmented controls, chips and avatars.
- State is drawn with balls: an empty ring is "not yet", a filled ball is "done" or "here". The
  viewed mark, the stack rail, the overview marker and the outline all use them. Don't swap them for
  checkboxes or bars.
- Don't add colored left-border stripes to cards, gradients, or shadows on things that don't float.

## Controls

- Disabled dims a control. It never removes its outline. A disabled button keeps its box and its
  size: the border stays, at `lo-border-subtle`, a main button keeps a flat fill, and the label is
  `lo-fg-disabled`. A row's layout doesn't change with its state.
- A state that's a fact isn't a disabled button. "Installed" is an icon and the word in
  `lo-fg-muted`.
- A switch that's off keeps a ring, so its track shows on every surface in both themes.
- A button at work is `busy`, not disabled: see [Waiting](#waiting).
- A control whose face doesn't say what it is, such as an icon button, names itself and its key in a
  tooltip: `hint` and `hintKeys` on `Button`, or `Tooltip` around anything else. A tooltip shows
  after 500 ms, or at once when another was just showing (one `TooltipGroup` goes around the window,
  in `Window.tsx`). It never carries an error, a state or anything that's the only place to learn
  something.
- A dimmed control says why in its tooltip, in a few words with no full stop: "Offline", "Write a
  comment first". Give `Button` the reason as its `hint` while it's off, and name the reason for a
  screen reader with `aria-describedby`, since a tooltip is never read. A reason with something to
  do about it isn't a tooltip: it's a line with its button.
- A screen reader never hears a tooltip's key caps. Give `Button` the key as `aria-keyshortcuts`
  says it, in `hintShortcut` (`liveShortcut` gives it), and it sets the attribute; a sequence, which
  the attribute can't say, is described from `hintKeys`. Anything else in a `Tooltip` sets
  `aria-keyshortcuts` itself.

### Every action has a control

Keyboard first isn't keyboard only: whatever a key does, the mouse does too, from a control drawn
where the action's target is.

- **A control is its command's.** It takes its label, its key and whether it can run from the
  registry, and runs the command as the key does: `controlOf(id, target)` and
  `runControl(id, target)` in `@lo/ui/commands`. It never keeps a label or a key of its own, so it
  follows the keymap file, and while its command can't run it's dimmed with the command's reason as
  its tooltip.
- **Every command names its route.** In a feature's `keys.ts`, a command says how the mouse reaches
  it: `control` (where its control is drawn, in a few words), `menu` (a right-click menu) or `bar`
  (the app menu). The route check (`checkRoutes`) fails on a command with none. The commands still
  waiting for one are listed in `apps/desktop/src/window/commands/routes.ts`: take a command off the
  list in the change that gives it a route, and never add to it.
- **Hints are buttons.** A row of key hints, such as a panel's foot, is made of `HintButton`: a
  command's label and its key, which runs the command when clicked.
  `<HintButton command="comments.showThread" target={target}>Show</HintButton>`. Give it the target
  the key would act on, and words of its own only where the command's label is too long for the row.
  A click leaves focus where it was, so the keys beside it go on working. No hint is only text.
- **Anything with a right-click menu has a `⋯` button.** `MoreButton` goes inside the element whose
  right-click opens the menu, at the end of its row (before a chevron that opens or closes the row,
  as on a thread's card), and opens that same menu under itself (`openMenuUnder`), so the two can
  never list different things. It's named "More actions", or "More actions for retry.ts" (`label`)
  where a row has several.
- **A control a code view draws** in its own DOM, where React doesn't reach, carries its command's
  id in `data-command`. The view runs the command on the line or file the control is drawn at, and
  gives it the tooltip a `Button` would have: the command's label and key, or why it can't run.
  `data-tip` holds other words where the control's state changes what a click does.

## Motion

Lo moves fast. A move shows what changed and is over; only the mark's own animations take their
time.

- Anything that appears, leaves or changes size uses one of these moves.
- Exits are faster than entrances.
- Nothing waits on an animation. Input is live from the first frame. A popup gives focus back, and
  runs what was chosen, as it starts to leave, not once it has faded. A key pressed again cancels
  the last move and never queues behind it.

| Move  | What it's for                                                                                      | Runs                 | How to use it                                                   |
| ----- | -------------------------------------------------------------------------------------------------- | -------------------- | --------------------------------------------------------------- |
| Tint  | Hover, press and selection: a color changes, and nothing else.                                     | 90 ms                | `move-tint`. `Button`, `Switch` and `SegmentedControl` have it. |
| Pop   | A menu, popover, tooltip or palette fades in over 4 px from its anchor's side.                     | 90 ms in, 90 ms out  | `Popover`, `ContextMenu`, `Tooltip`, `Palette`.                 |
| Sheet | A dialog fades in and rises 8 px, as its scrim fades in.                                           | 160 ms in, 90 ms out | `Dialog`.                                                       |
| Open  | Something in the flow takes its height and fades in: a thread, a reply, a banner, a fold, a toast. | 160 ms in, 90 ms out | `Collapse`.                                                     |
| Slide | Something that stays on screen goes from one place to another: a thumb.                            | 160 ms               | `move-slide`. `SegmentedControl` and `Switch` have it.          |
| Swap  | What replaces something in the same box fades in over it: a skeleton's content, Overview to Diff.  | 90 ms                | `Swap`.                                                         |
| Land  | Where a jump ended. The scroll is instant, and the target takes a tint that fades.                 | 260 ms               | `reveal()`, or `land()` for a target already in view.           |

- Three durations: `--lo-dur-fast` (90 ms), `--lo-dur` (160 ms), `--lo-dur-slow` (260 ms). Nothing
  in the interface runs longer.
- Three curves, the brand's: `--lo-ease-out` for what arrives, `--lo-ease-in` for what leaves,
  `--lo-ease-in-out` for what goes from one place to another.
- The moves are the `move-*` utilities in `packages/desktop/ui/src/styles.css`. Use a move through
  its component where it has one. Don't write a transition or a keyframe in a feature.

### Using the moves

- **`Collapse`** (`open`, `appear`, `onGone`, `className`) draws nothing while closed and keeps what
  it held until it has gone, so render
  `<Collapse open={error !== undefined}>{error && <Callout … />}</Collapse>` and nothing more.
  What's already open when its view first draws doesn't move unless `appear` is set. Opened again
  before it has gone, it turns back from where it is. `onGone` fires once it has left the page,
  after its move, unlike a popup's `onClosed`, which fires as the popup starts to leave.
- **`Swap`** (`id`, `className`) is one box whose content fades in when `id` changes:
  `<Swap id={loaded ? 'diff' : 'loading'}>…</Swap>`. What's there when it first draws doesn't move.
- **`reveal(element, { block })`** brings an element into view by scrolling its own pane and nothing
  else. Use it in place of `scrollIntoView`, which scrolls the window's shell too. A jump (`start`,
  `center`, `end`) lands; keeping a cursor in view (`nearest`, the default) doesn't. An element
  under a pinned header sets `scroll-margin-top` to the header's height.
- **`land(element)`** marks a target that's already in view. One target shows at a time, so a held
  key moves the tint and never stacks it. A view that draws its own rows, such as a code view, puts
  `LAND_CLASS` on the row itself.

### Reduce Motion

One switch turns every move off: popups, heights and tints change at once, and the mark is still.

- It follows the system's setting by default. `setMotion('reduce' | 'full' | 'system')` from
  `@lo/ui` sets it for the window, by writing `data-lo-motion` on `<html>`, which `css/base.css`
  reads.
- The stylesheet reaches every transition and animation. Anything that moves from a script asks
  `motionReduced()` (in a component, `useMotionReduced()`) and shows where it would have ended.
- Off, a transition takes no time and never ends, since it never starts. Wait for a move with
  `whenSettled()`, not for `transitionend`.

### The mark's animations

`LogoMotion` plays the three animations in `brand/motion/motion.json`, drawn from the brand's own
keys in `lo-mark`, so chalk on dark and ink on light with nothing to set.

| `play`   | When                                                 | Size                   | Length      |
| -------- | ---------------------------------------------------- | ---------------------- | ----------- |
| `unmeld` | The first screen of the welcome.                     | 96 px (`size-mark-lg`) | 1.4 s, once |
| `meld`   | A view with nothing to draw yet. `Loading` shows it. | 48 px                  | 2.8 s, loop |
| `kiss`   | Something is done: an approval, a merge that landed. | 40 px                  | 1.2 s, once |

It never holds anything up: what it marks has already happened, and what it waits for shows the
moment it comes. Each plays once and rests as the mark, calling `onDone`. To play one again, give it
a new `key`.

## Waiting

Lo waits in three ways. Use the first that fits, and never two for one wait.

| When                                 | What shows                                                                                                                                        | Component                        |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| A whole view has nothing to draw yet | The meld loop over one line that names the wait. Nothing for the first 300 ms, so a quick load shows nothing. After 8 s, what's slow, and Cancel. | `Loading`                        |
| The view's shape is known            | Blocks laid out as the content will be, which the content replaces in one Swap.                                                                   | `Skeleton`, inside a `Swap`      |
| A control is doing its work          | The control keeps its width, its fill and focus, and reads its verb beside a turning ring: "Merging…".                                            | `busy` and `working` on `Button` |

- `Loading` takes `status` ("Fetching diff…"), and optionally `slow`, `onCancel` and `cancelKeys`.
  It fills the view it's in.
- `Skeleton` is the `skeleton` utility on a block. Give each the size of what it stands for.
- A view that shows `Loading` or skeletons sets `aria-busy` on its own box until its content is in,
  so a screen reader waits for the content rather than reading the wait.
- Pass `busy={false}` to a button that can be busy, not nothing, and its `working` too, so it holds
  room for both and doesn't change width. A busy button is `aria-busy`, takes no press and isn't
  greyed. Without a `working`, it shows its label beside the ring, so it keeps its name.
- It's as wide as the wider of its label and its `working` beside the ring, so keep `working` short:
  "Checking…", not "Checking what merges with it". Where the words change as the work goes on, as
  trusting a repo's do ("Checking…", "Waiting…", "Trusting…"), keep each within the label's width,
  and give the first at rest.
- What takes a button's props does the same: a `Banner`'s and a `Problem`'s action and the merge
  panel's main button (`MergeFoot`'s `primary`) each take `busy` and `working` as `Button` does.
- `Spinner` (the `spinner` utility) alone is for a wait inside a line, such as a status bar item.
  Never beside a button, which is `busy`, and never for a whole view.

## Floating pieces

Everything that floats over the window is one of these, from `packages/desktop/ui`. Each comes and
goes with its move, takes focus as it mounts, and gives it back as it's asked to close, only while
focus is still its own: focus that moved into a dialog or popup that opened in its place stays
there. `onClosed` fires then, while it fades, and it keeps what it showed until it's gone, so a
caller can clear its state at once. While it fades it takes no clicks and no focus: a caller that
focuses something in it then, as one that follows its main button from step to step does a frame or
two later, leaves focus where it went back.

They sit in layers, lowest first: a dialog or the palette (`z-dialog`), then a popover or menu
(`z-popover`), which can open from a dialog, then toasts (`z-toast`), then tooltips (`z-tooltip`),
which name a control wherever it is. Each piece takes its layer's utility, and so does anything else
that floats.

- **`Dialog`** asks or shows one thing, over a scrim. Three widths: `size="sm"` (420 px, one
  question), `md` (540 px, the default) and `lg` (720 px, a list or code). Its top edge stays 96 px
  from the window's top whatever its height, so it never jumps between steps: a taller step grows it
  downward in the Sheet move's time. While it grows (`data-growing`), its body is clipped at the
  top, not scrolled, so no scroll bar shows. It focuses its main button, or what `initialFocus`
  names, as it mounts, without scrolling its body. With an `action` it draws its own foot and takes
  a `state`: `ask`, `working`, `done` or `failed`. The body stays put through all four. The button
  that leaves reads "Cancel" until something is sent, "Close" after a failure and "Done" once it has
  worked; the main button reads its `label`, then `working`, then "Try again". What went wrong goes
  in `problem`, above the foot. While it's `working`, nothing leaves it: Cancel, `Esc` and a click
  outside all refuse.
- **`Popover`** is a small panel beside what it's about: a status item's details, a picker. Give it
  its `trigger`, or an `anchor` when a key opens it.
- **`ContextMenu`** is the menu at a point: what can be done to what was right-clicked, each with
  its key.
- **`Palette`** is the box that finds things by typing, from the top of the window.
- **`Tooltip`** names a control and its key: see [Controls](#controls).
- **`ToastStack`** shows results at the bottom right, above the status bar: three at most, four
  seconds each, paused under the pointer or focus. A toast is one line, clamped to three, and one
  action at most. One that waits for the reader may add a `body`: plain words wrap, anywhere a long
  path needs to, and clamp to three lines; a body of its own markup, such as a command to copy,
  shows whole. A toast never reports a failure: that's a `Problem` where it happened. Keep each
  toast the same object while it shows. To show one again, as a second "Copied path", put a new
  object with the same `id` in `toasts`: it stays in its place and its four seconds start over.
- **`Problem`** is something that went wrong, in one shape: what failed, why, the one thing to do,
  and the raw text behind Details with Copy. `layout="view"` takes a failed view's place;
  `layout="inline"` sits by the control whose action failed. It's said once: no toast repeats it. A
  screen reader hears what failed and why as an alert, and not the buttons.
- **`CopyButton`** copies and says so itself: it reads "Copied" for two seconds, and no toast says
  it again. When copying throws or rejects, it reads "Couldn’t copy" instead. A live region beside
  it says the same to a screen reader.
- **`CopyRoute`** gives everything inside it the window's way to copy. The window is refused every
  permission, so it can't use the browser's clipboard: it copies through main's `tab.copy`, and one
  `CopyRoute` around the window (`Window.tsx`) says so. `Problem`'s Copy goes through it, and a
  feature's `CopyButton` does too, with `const copy = useCopy()` and
  `<CopyButton onCopy={() => copy(text)} />`. Without a `CopyRoute`, as in a test that draws a piece
  alone, copying rejects and the button reads "Couldn’t copy".
- **`Banner`** is a full-width message under the PR header about the whole tab. One that comes or
  goes while the tab is open does it inside a `Collapse`. An action that can be busy takes `busy`
  (`false` at rest) and `working`, as a `Button` does.

Base UI's popup parts (dialog, menu, popover, tooltip, toast and the like) are imported only by
these pieces. `ui:lint` runs `scripts/check-popups.ts`, which fails on an import anywhere else, so a
new popup is built from a shared piece or added to one.

## Focus and the keyboard

Every action has a key; see `keyboard.md` for the rules and focus, and section 12 of
[`docs/design.md`](../docs/design.md) for the keys.

- Show keyboard focus with `--lo-ring` (a 1.5 px Powder edge and a soft halo). Rows in lists use
  `--lo-ring-inset` so they don't jump. Never remove a focus style without replacing it.
- Focus and "current" are different: focus is where the keyboard is; current (`lo-current`, a Powder
  ball) is what's on screen. They can sit on different rows.
- Show a control's key on the control with `Key` (`lo-kbd`, or `lo-keys` for a sequence). The chip
  comes last, after the label; in menus it sits at the right.
- **A chip shows where its key works now.** Always on a surface's main button, dialog buttons, menu
  and palette rows and `HintButton`. On a control that every card or row repeats, only on the one
  the keyboard is on: give those `Key` `when="focus"`, and mark the card or row `data-key-scope`
  (with `data-focused` while the keyboard is on it, if it doesn't hold DOM focus). The others give
  the key in their tooltip. A chip never comes on hover, which would move the buttons beside it.
- A chip takes its control's state by itself: on a main button's fill it's drawn in the fill's text
  colour, and on a dimmed control or menu row it dims with the label. Don't colour a chip by hand.
- Code has a caret, in `lo-code-cursor`. With Vim keys on it's Vim's block cursor, with a halo,
  which goes hollow when the view loses focus. In a code view the caret doesn't blink, and the
  cursor line's number takes `lo-code-gutter-active`, so where the cursor is shows in every frame. A
  caret in a comment box blinks.
- Vim's mode shows only with Vim keys on: once in the status bar (`StatusMode`), and in the comment
  box that has focus. Nothing else names a mode.

## The window

- One window, a tab per PR (a whole stack in one tab). Rows top to bottom: tab strip
  (`lo-tabbar-h`), PR header, banners, body, status bar (`lo-statusbar-h`).
- The body is left panel (stack, then files), the middle sheet, and the threads panel. Each panel
  opens and closes with a key.
- The window never scrolls. Panes do. The shell hides what overflows it and puts itself back if a
  script scrolls it, and anything brought into view goes through `reveal()`, which scrolls the pane
  it's in. The shell hides with `overflow: hidden`, never `clip`: an image loads as it comes near
  the screen, and a clipped box cuts "near" off at its edge.
- A toolbar or foot never wraps or clips. Narrow, it drops chips, then hints, then labels.
- Lo draws its own tab strip on both systems and nothing else. On macOS the strip starts after the
  traffic lights (`--lo-window-inset-start`); on Linux set `data-lo-platform="linux"` on `<html>`.
  Never depend on macOS-only window chrome.
- `⌘` in a key becomes `Ctrl` on Linux. Write keys in the macOS form in docs; the app shows each
  platform its own.

## Components

Lo's components are React components in `packages/desktop/ui`, styled with Tailwind CSS on these
tokens. Their code is the source for how each one looks.

| Group            | Components                                                                       |
| ---------------- | -------------------------------------------------------------------------------- |
| Window           | PullRequestTab, TabBar, PRHeader, StatusBar, Banner                              |
| Panels           | StackTree, FileTree                                                              |
| Controls         | Button, HintButton, MoreButton, CopyButton, Key, SegmentedControl, Switch, Input |
| Marks            | StatePill, Tag, Avatar, Marks                                                    |
| Floating         | Dialog, Popover, ContextMenu, Palette, Tooltip, ToastStack                       |
| Motion and waits | Collapse, Swap, Loading, Skeleton, Spinner, LogoMotion, Problem                  |
| Review           | Thread, Diff, CodeView, CommentBox                                               |
| Overview         | OverviewDocument, CodeBlock, Figure, Walkthrough, TabsAndFolds, Glossary         |
| Flows            | Choice, Checklist, Composer, Peek, Timeline                                      |

Build new screens from these. If something new is needed, make it from the same tokens and keep it
to one job.

## Code and diffs

- Every code view is CodeMirror 6, themed by `css/code.css`. Lo's own decorations use `.lo-*`
  classes; CodeMirror's merge classes (`cm-changedLine`, `cm-changedText`, `cm-mergeSpacer`,
  `cm-collapsedLines`) share the same rules.
- Side by side by default. Both sides stay on one row grid: a thread or a wrapped line on one side
  leaves hatched space (`lo-spacer`) on the other.
- Long lines wrap. Wrapped lines continue four columns past the line's own indent (`--ind`).
- Whitespace changes show by default; a re-indented line highlights only its new leading spaces.
- Generated files, lockfiles and very large files start collapsed with a reason and a way to open
  them.
- Code is set as written: no ligatures. Every rule that sets the mono face turns them off with it.
- A file's header reads once across both sides. The file you're in stays pinned under the diff bar.
- **The viewed ball is a checkbox drawn as the ball.** It has a checkbox's semantics
  (`role="checkbox"`, `aria-checked`, named "Viewed") and is never drawn as a box. A click marks or
  unmarks the file, as `e` does. Its tooltip is what a click does, with the key: "Mark viewed" or
  "Unmark viewed", or the reason while it can't. A file changed since it was viewed isn't viewed:
  its ball is the amber ring, unchecked, and "Changed since viewed" is written beside it in the
  header, in amber, so the third state is in words and not only in the ball. The tooltip stays the
  command.
- **A `+` follows the pointer down the gutter** beside each line that takes a comment. A click
  comments on that line, as `c` does. It sits over the start of the line's number, clear of the
  overview markers, takes no room and moves nothing, and it's gone over a header, a thread or a box.
- **What you open is in view when it opens.** A comment box, a thread or a peek that opens scrolls
  its pane the least that shows all of it, at once, with `reveal` (`block: 'nearest'`), and never
  with `scrollIntoView`. One taller than its pane shows from its top. A comment box does this itself
  whenever it takes focus (`Composer.focus()`), and keeps itself in view as it's laid out, until the
  reader's next key, press or scroll. It keeps `lo-sp-8` under it (its `scroll-margin-bottom`, which
  `reveal` honours), so its ring shows whole above the pane's foot.

## Comments

**Every place you write is the same box.** A new comment on lines, on a file or on the pull request,
a reply and an edit are all `CommentBox` (`packages/desktop/ui`), around the one editor the code
view makes (`compose` on a code view, or `createComposer` outside one). A feature never draws its
own.

The review's summary, in the submit dialog, is the same editor in the same frame, with the same
notes, upload rows and foot bar (`CommentBoxFootBar`), but it isn't the whole box yet: it has no
head, so "Summary" and Preview are in its foot, as a hint and a button, and it has no "Discard
draft". Bring it onto the head (`CommentBoxHeadBar`) when the submit dialog is next changed; don't
copy its foot.

- **Head.** What the comment is on, at the left, in the words a line is named everywhere: "Line 3",
  "Lines 39–41", "Line 3, removed", "File", "Pull request", "Reply", "Edit", "Summary". Why it's on
  that, where the reader asked for something else, is one quiet line under it (`why`). Write |
  Preview is at the right, then the control that closes the box (`close`), which keeps the draft.
  "as login" shows only when more than one account is signed in.
- **Body.** The editor, or its preview. The box has one ring, which is its focus; nothing inside it
  has another. An empty box says what it's for in a quiet hint (`hint`): "Reply", "Comment on #264".
- **Foot.** "Attach files…" as an icon button at the left, then "Discard draft"; the actions at the
  right, the main one last, each with its key. The foot never runs past the box: as the box narrows
  it gives up its key chips (under 480px), then the labels of the controls that keep an icon (under
  410px, the width a foot with every control and Vim's mode needs), then its hint, and the actions
  keep their words (`box-chip`, `box-label`, `box-hint` in `styles.css`, on the foot's own
  `@container`). Whatever still doesn't fit wraps: the actions go to a row of their own, at its end,
  as in a box beside the code in a small window. It's the one place a foot wraps. The head wraps
  under 320px (`box-row`). In a box taller than its pane, the foot stays at the pane's foot.
- **Actions.** "Add to review" and "Send now" under a line or a thread, "Send" under the pull
  request, "Save" in an edit. While a review is pending GitHub adds every comment to it, so the box
  has "Add to review" alone. A dimmed action says why in its tooltip.
- **Sending.** A comment is its card from the moment it's sent: the box draws the text as it will
  read, with "Sending…" where its time will be (`SentPost`; "Saving…" for an edit), and the card
  from GitHub takes its place. The text never leaves the screen. A send that fails turns back into
  the open box with the text as it was, under a note that says what wasn't sent and why, with "Try
  again".
- **Never a blind resend.** When GitHub's answer never came, nobody knows whether the comment
  posted, and sending it again could post it twice. The box then says "Comment not confirmed" and
  offers "Check again", which only looks. Its buttons are dimmed with "Check again first" until Lo
  knows: found, the card takes the box's place; not found, the note offers "Try again". An edit and
  a resolve follow the same rule.
- **Attached files.** A file goes in at the cursor as a placeholder while it uploads. If the upload
  fails or is refused, Lo takes the placeholder out itself and the file's row says what happened. A
  comment isn't sent while a placeholder is in its text.
- **A line reference is data.** What a comment is on is held as its side, lines and revision
  (`LineRef`) and worded in one place (`lineRefText`): "Line 3", "Lines 39–41", "Line 3, removed",
  with "· r2" where the revision isn't the one on screen. Never build the words by hand.
- **Lines.** Something to know that needs no answer is one quiet line over the foot's controls
  (`lines`): "Draft from 12 min ago". Something that stops the comment going, with what to do about
  it, is a note over the editor (`notes`), with its buttons.
- The mode chip shows only with Vim keys on, in the box that has focus.

`CommentBoxHeadBar`, `CommentBoxNotes` and `CommentBoxFootBar` are the same parts for a caller that
draws them in the parts a code view makes (`BoxFrame`); `CommentBox` draws all of them around an
editor given as its child.

## Overviews

- The overview is a document: an outline on the left, the article at reading measure, wide blocks
  (code, figures, walkthroughs) up to 840 px.
- Lo renders only its own blocks. The writer chooses which sections exist and their order; never
  assume the default five.
- Code blocks show the real code at the overview's commit, as a diff. Flag lines that changed since;
  say plainly when code is missing or a reference doesn't resolve.
- Figures use the `fig-*` colors only. `figures.md` is the contract for agents that draw them.

## Writing

Every string a person reads follows `writing.md`: its rules, its terms (a pull request as of one
push is a revision, written r3) and the shape of each kind of message. Nothing here restates it.

## Do and don't

**Do**

- Take every color, size and radius from a token.
- Show the key on every control that has one.
- Keep one accent, one main button and one focused thing per view.
- Pair every status color with a word or an icon.
- Check both themes, and check them at the window's real density.
- Use the files in `brand/logo/` for the mark, in `lo-mark`, and `LogoMotion` where it moves.
- Use a move for anything that appears, leaves or changes size.

**Don't**

- Color the mark, or put it in the interface's chrome.
- Write hex values, pixel font sizes or new shadows in components.
- Use Powder, green, red or purple for decoration.
- Add gradients, glows (other than the focus halo), colored left-border cards or emoji.
- Use the system font, or load fonts from the network.
- Hide focus, or show hover styles that the keyboard can't reach.
- Make anything wait for an animation, or scroll the window.
- Import a popup from Base UI in a feature.
- Copy macOS-only window chrome, or assume `⌘` exists on Linux.

## Where things are

| Path                                       | What                                                                                                               |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `tokens.json`                              | Every color (both themes), shadow, space, radius, size, type style, duration and curve. The one source for values. |
| `syntax.json`                              | The syntax tokens `code.css` styles as `lo-syn-*` classes, numbered as highlights number them.                     |
| `css/index.css`                            | Imports the stylesheets in order. The app imports this file.                                                       |
| `css/tokens.css`, `css/type.css`           | Generated from `tokens.json`. Don't edit.                                                                          |
| `css/foundation.css`                       | Focus rings, font aliases, tracking, layers, platform insets.                                                      |
| `css/base.css`, `code.css`, `overview.css` | Element defaults and the Reduce Motion rule, CodeMirror and diffs, the overview.                                   |
| `keyboard.md`, `figures.md`, `writing.md`  | Key rules and focus, figure colors for overview agents, interface copy.                                            |
| `assets/Logos/README.md`                   | The rules for the logo files in `brand/logo/` and `brand/icon/`.                                                   |
| `scripts/build.mjs`                        | Regenerates the generated files.                                                                                   |
| `stylelint.config.mjs`                     | Keeps the plain CSS on the tokens.                                                                                 |

To change a value, edit `tokens.json` and run `node design/scripts/build.mjs`, then commit the
generated files with it; CI fails when they're out of date. Everything inside the app sits under an
element with `class="lo-app"`; set `data-theme="light"` on `<html>` for the light theme, or on any
element to pin one.
