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
5. **Each view is a sheet.** The overview, diff and timeline sit on the ground (`lo-bg`) with round
   top corners, set into the lighter chrome the way the mark's ball sits in its socket. Two views
   side by side are two sheets, `lo-sp-8` of chrome apart.
6. **Show what's true.** Real code, real states, real counts. Don't fake progress, round away errors
   or hide why something can't happen.

## The mark

- Draw the mark, wordmark and lockup in `lo-mark` only: chalk (`lo-chalk`) on dark grounds, ink
  (`lo-ink`) on light ones. Never Powder, never a status color, never a gradient, glow, outline or
  shadow.
- Use the files in `brand/logo/`: `*-chalk.svg` on dark, `*-ink.svg` on light. Never redraw the mark
  in CSS or retype the wordmark.
- Inside the app, the mark appears in the welcome and on the sign-in screen, plus the places
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
  label over the block carrying the meaning, so it never reads as a selection.
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
  (24/30, 800) for the welcome's step headings, with `--lo-track-tight`.
- Reading text has its own scale: `read-body` (15/24), `read-lead` (17/27, the tl;dr), `read-h2`
  (22/28, 800), `read-h3` (16/22, 700), `read-comment` (13.5/21). Keep reading lines under
  `--lo-read-measure` (680 px). The measure is for text, not for what holds it: a code block in a
  post takes the post's whole width, set in `code-small`, in a list, a fold or an alert too, and
  only the text around it keeps to the measure. The timeline's column is up to `--lo-timeline-w`
  (856 px), so a code block of 100 columns fits beside its rail.
- Text at a comment's size is a comment's prose, wherever it shows: a comment, a review, a
  description, a comment's preview, a hover card's docs. Draw it with
  `lo-prose lo-prose--comment read-comment`, spaced as GitHub spaces a comment: nothing above its
  first block, 16 px between blocks, in a quote or an alert too, and under a heading, and 24 above a
  heading. `lo-prose` alone is the overview's, a document with room around its sections, and never
  right for a comment.
- A column's width follows the pane it's in, never the window: size it from its own box
  (`@container`), not a media query or `vw`, since panes resize.
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
  viewed mark, the stack rail, the overview marker, the outline and the status bar's items all use
  them. A spinner is a ball at work. Don't swap them for checkboxes or bars.
- Don't add colored left-border stripes to cards, gradients, or shadows on things that don't float.

## Icons

Lo's icons come from one set, Lucide (`lucide`, ISC, pinned), drawn by `Icon` from `@lo/ui`. The
mark isn't an icon.

- `Icon` takes a `name` from `icons.ts`, the list of the Lucide icons Lo uses, and a `size`. To use
  a new icon, add its name there. Nothing else imports `lucide`, and no component writes an `<svg>`
  of its own: `lo/no-inline-icon` refuses one anywhere but `Icon`, the mark and figures, as an
  element, as markup or a data URL in a string, or as an imported file. A code view's own DOM takes
  `iconElement`.
- Four sizes, each with its stroke in pixels: 12 px at 1.25 px beside `text-micro`, `text-small` and
  in a key chip; 14 px at 1.25 px beside `text-ui`; 16 px at 1.5 px for an icon alone in a control
  and beside titles and reading text; 24 px at 1.5 px in an empty state. An icon that stands in for
  its words when a narrow row gives them up (`data-takes`) is alone in its control, so it's 16 px.
- An icon takes its text's color. Alone it's `lo-icon`, or `lo-icon-muted` for file, folder and
  secondary icons. Stroke only, round caps and joins: never filled, never two tones.
- A character the fonts don't hold is an icon. Host Grotesk and Fragment Mono have no `⌘`, `⏎`, `→`,
  `✓`, `⋯` or `↗`, and the system would draw each in another weight. `Key` draws a key's symbols and
  `Glyphs` the rest, from `glyphs.ts`, as `r1 → r3`; a code view's own DOM takes `glyphNodes`.
  `Ticks`, `Tooltip`, `Toast` and `LinkButton` draw a string they're given through `Glyphs`. In a
  flex row, put `Glyphs` in a `span`, so its string stays one run of text. `· › … –` are in both
  fonts and stay text.
- State is a ball, not an icon. Another brand's mark is that brand's own file, never redrawn.
- An icon with no words beside it names itself: `label` on `Icon` for a mark, a tooltip for a
  control.

## Controls

- Disabled dims a control. It never removes its outline. A disabled button keeps its box and its
  size: the border stays, at `lo-border-subtle`, a main button keeps a flat fill, and the label is
  `lo-fg-disabled`. A row's layout doesn't change with its state.
- A state that's a fact isn't a disabled button. "Installed" is an icon and the word in
  `lo-fg-muted`: `SetupDone`, or `done` on a `SetupItem`.
- A switch that's off keeps a ring, so its track shows on every surface in both themes, and its
  thumb is `lo-fg-muted`: a thumb in `lo-fg` is a near-black knob in light, which reads as on.
- A button at work is `busy`, not disabled: see [Waiting](#waiting).
- A control whose face doesn't say what it is, such as an icon button, names itself and its key in a
  tooltip: `hint` and `hintKeys` on `Button`, or `Tooltip` around anything else. A tooltip shows
  after 500 ms, or at once when another was just showing (one `TooltipGroup` goes around the window,
  in `Window.tsx`). It never carries an error, a state or anything that's the only place to learn
  something. A button that takes focus by itself, as a dialog's main button does when the dialog
  opens, shows its hint under the pointer only (`hintOn="hover"`, or `on="hover"` on `Tooltip`), so
  nothing opens with a tooltip already over it.
- A mark with no words, such as a file's change letter or a thread count, names itself in a
  `Tooltip` with no key: "Added", "2 unresolved threads". A screen reader hears the same words, as
  the mark's `aria-label` with `role="img"`, since a tooltip is never read. A name cut short with an
  ellipsis, a path, a branch or a title, shows whole in a `Tooltip` with `cut`, which stays shut
  while the name fits. A code view's own DOM takes `data-tip` for either, and `data-tip-cut` for a
  name.
- Never the system's tooltip: no `title` on an element, which shows late, unstyled and whatever it
  holds. `lo/no-native-title` refuses one in the app and in `ui`. A component's `title`, a
  `Dialog`'s or a `Problem`'s, is its heading, not a tooltip.
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
- **Hints are buttons.** A row of key hints, such as a panel's foot, is a `HintRow` of
  `HintButton`s: a command's label and its key, which runs the command when clicked.
  `<HintButton command="comments.showThread" target={target}>Show</HintButton>`. Give it the target
  the key would act on, and words of its own only where the command's label is too long for the row.
  A click leaves focus where it was, so the keys beside it go on working. No hint is only text.
  `HintRow` keeps the row on one line: where the hints don't fit with their key chips, it measures
  and drops the chips, and each hint gives its key in its tooltip. Never guess a width for that: a
  key is wider on Linux ("Enter") than on macOS (`⏎`).
- **A row too narrow for what it draws gives it up, in an order of its own.** A row that has to stay
  one line, such as a comment's head on its card or a comment box's head and foot, measures what
  fits with `useGiveUp(row, steps)`, as `HintRow` does, and never takes a width to give a step up
  at: names and keys are wider on one system, or for one person, than another. It marks what goes at
  each step (`data-gives`), what comes in its place, as an icon for words (`data-takes`), and what
  it must keep whole until nothing else is left to give up, such as an author's name (`data-fit`).
  What it gave up comes back as soon as there's room for it, however the room came: the window
  widened, a panel closed, or what's beside it got shorter. A row as wide as what it draws, as one
  beside a spacer is, doesn't grow with the window, so `useGiveUp` also watches what's beside it,
  out to the first box as wide as its container lets it be; never fit a row only as it's drawn. Key
  chips go first; a control that gives up its words is the small control's square, with its words as
  its tooltip. What's cut short keeps `min-w-cut` at least, 48 px or all of its words where they're
  shorter, so `main` isn't padded, and what can't keep that goes whole: the PR header gives up its
  branches, with "wants to merge" and the arrow, and the merge status its detail, never cut to a
  letter. What it gives up that nothing else in the row says, as the merge status's detail or the
  note's facts, is still heard (`data-heard`), as a given-up title is. The PR header's first row
  cuts its title, and gives up "Submit review…"'s key chip, then the merge status's detail, then its
  words, which leave its ball with the verdict and the reasons as its tooltip, so nothing overlaps
  it. The diff bar is the revisions note, then Compare revisions and the view's own controls, 16 px
  apart, one `HintRow`: narrow, it drops the hint's chips, then the hint, then the note's facts
  after its first `·`, last first, so "base → r2" never cuts and no two groups touch. A diff's file
  header gives up what follows its name (the counts, where a rename was, the tags), then cuts its
  folders, then drops them, leaving the name with the whole path as its tooltip, and only then cuts
  the name at its end; its end, from the threads to the `⋯`, is never cut.
- **A choice of two to four is one `SegmentedControl`,** never buttons or pills drawn by hand: the
  header's view switch, the Files panel's Tree and Review order, the threads' filter, a comment
  box's Write and Preview, and Settings' choices are all one. Its thumb slides to the segment
  chosen, and the key that steps through them follows it. It's `md` in the header alone, and `sm`
  everywhere else: a panel's toolbar, a box's head, a Settings row. While it can't be changed it's
  `disabled`, and `why` is each segment's tooltip, as the Files panel's "Reading files…" is; its key
  chip goes meanwhile, keeping its room. One thing on or off, as "Changed files only" is, stays a
  toggle of its own.
- **A segment can be its icon alone.** Where a `SegmentedControl` has to narrow, as a comment box's
  Write and Preview do, each segment's label holds its icon and its words, the words marked as a row
  that gives up marks them (`data-gives`). Give the segment its `name`, which a screen reader hears
  whichever it shows, and its `tip`: its words as its tooltip while it's its icon alone, and `null`
  while its words show.
- **A command with nothing to say refuses with an empty reason.** A command only some controls
  offer, such as one of a box's notes, gives `''` from `enabled` where none offers it: a key bound
  to it then does nothing, and no toast says so. So does one whose dimmed label says it all, as Back
  and Forward do with nowhere to go: their menu rows dim with no reason under them. And so does Go
  to view with focus already where the middle view puts it and nothing there to close: each middle
  view says where its focus goes (`holds`) and what `Esc` closes there (`escape`), without closing
  it. The palette and keyboard shortcuts' "Here" leave out a command that refuses, so a command that
  can't act where it's asked refuses from `enabled`, not only in `run`, and neither lists it: a tab
  by its place with no tab there, or with that tab on screen; `j` in Recent with no rows; Open pull
  request with none highlighted. Only what Lo can't know until the command runs, as whether the
  clipboard holds a link, is left to `run` to say.
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

- Anything that appears, leaves or changes size uses one of these moves, but a pane's width, which
  never animates (see [The window](#the-window)).
- Exits are faster than entrances.
- Nothing waits on an animation. Input is live from the first frame. A popup gives focus back, and
  runs what was chosen, as it starts to leave, not once it has faded. A key pressed again cancels
  the last move and never queues behind it.
- The theme changes in one frame across the window, with no fade: `setTheme` from `@lo/ui` holds
  every transition off for the frame that draws the new colors.

| Move  | What it's for                                                                                      | Runs                 | How to use it                                                   |
| ----- | -------------------------------------------------------------------------------------------------- | -------------------- | --------------------------------------------------------------- |
| Tint  | Hover, press and selection: a color changes, and nothing else.                                     | 90 ms                | `move-tint`. `Button`, `Switch` and `SegmentedControl` have it. |
| Pop   | A menu, popover, tooltip or palette fades in over 4 px from its anchor's side.                     | 90 ms in, 90 ms out  | `Popover`, `ContextMenu`, `Tooltip`, `Palette`.                 |
| Sheet | A dialog fades in and rises 8 px, as its scrim fades in.                                           | 160 ms in, 90 ms out | `Dialog`.                                                       |
| Open  | Something in the flow takes its height and fades in: a thread, a reply, a banner, a fold, a toast. | 160 ms in, 90 ms out | `Collapse`.                                                     |
| Slide | Something that stays on screen goes from one place to another: a thumb.                            | 160 ms               | `move-slide`. `SegmentedControl` and `Switch` have it.          |
| Swap  | What replaces something in the same box fades in over it: a skeleton's content, Overview to Diff.  | 90 ms                | `Swap`.                                                         |
| Land  | Where a jump ended. The scroll is instant, and the target takes a tint that fades.                 | 260 ms               | `reveal()`, or `land()` for a target already in view.           |
| Fill  | A merge lands with no dialog to say so: the header's merge dot fills from a ring of its color.     | 260 ms               | `move-fill`. `MergeStatus` has it, with `landed`.               |

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
  It draws its content anew for each `id`. Content that must not be drawn anew, such as a code view
  or middle views kept drawn while hidden, goes in a layer of its own over what it replaces: drawn
  unseen (`opacity-0`, `pointer-events-none`, not `inert`, so it can take focus and keys meanwhile)
  until it's laid out, then `swapIn(layer)`, while the last layer stays drawn under it, `inert`,
  until the move has run (`whenSettled`). So no frame shows the box empty. Never fade a box in over
  nothing where something was drawn: a box fading in from nothing shows the ground for most of the
  move. A layer is laid out a frame after it's drawn, once it shows no `Loading` (`loadingIn`); one
  that still does when a wait would show it (`LOADING_DELAY_MS`) comes then, with its wait, so
  nothing is held longer. The diff's code views and the switch between a tab's middle views work
  this way. Never put `move-swap` on an element yourself.
- **`reveal(element, { block })`** brings an element into view by scrolling its own pane and nothing
  else. Use it in place of `scrollIntoView`, which scrolls the window's shell too. A jump (`start`,
  `center`, `end`) lands; keeping a cursor in view (`nearest`, the default) doesn't. An element
  under a pinned header sets `scroll-margin-top` to the header's height.
- **`land(element)`** marks a target that's already in view. One target shows at a time, so a held
  key moves the tint and never stacks it. A view that draws its own rows, such as a code view, puts
  `LAND_CLASS` on the row itself.

### Reduce Motion

One switch turns every move off: popups, heights and tints change at once, and the mark is still.

- It follows the system's setting by default, or `motion.reduce` in Settings › Appearance, except in
  tests, which start the window with every move off and keep it so.
  `setMotion('reduce' | 'full' | 'system')` from `@lo/ui` sets it for the window, by writing
  `data-lo-motion` on `<html>`, which `css/base.css` reads.
- The stylesheet reaches every transition and animation. Anything that moves from a script asks
  `motionReduced()` (in a component, `useMotionReduced()`) and shows where it would have ended.
- Off, a transition takes no time and never ends, since it never starts. Wait for a move with
  `whenSettled()`, not for `transitionend`.

### The mark's animations

`LogoMotion` plays the three animations in `brand/motion/motion.json`, drawn from the brand's own
keys in `lo-mark`, so chalk on dark and ink on light with nothing to set.

| `play`   | When                                                 | Size                   | Length      |
| -------- | ---------------------------------------------------- | ---------------------- | ----------- |
| `unmeld` | The first step of the welcome.                       | 96 px (`size-mark-lg`) | 1.4 s, once |
| `meld`   | A view with nothing to draw yet. `Loading` shows it. | 48 px                  | 2.8 s, loop |
| `kiss`   | Something is done: an approval, a merge that landed. | 40 px                  | 1.2 s, once |

It never holds anything up: what it marks has already happened, and what it waits for shows the
moment it comes. Each plays once and rests as the mark, calling `onDone`. To play one again, give it
a new `key`.

The welcome is where the mark's moves live: Unmeld on its first step, and Kiss beside the heading of
its last, as the step appears. Where one would play again on a step the reader comes back to, draw
`Mark` instead.

## Waiting

Lo waits in three ways. Use the first that fits, and never two for one wait. Never replace drawn
content with a wait: what's drawn stays until what replaces it is ready and laid out, marked as at
work where it says so (a `Spinner` in its bar), and takes no input; then the new content takes its
place in one Swap, over it, and whatever else says what it shows (a bar's line, a list beside it)
changes in the same frame.

| When                                 | What shows                                                                                                                                        | Component                        |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| A whole view has nothing to draw yet | The meld loop over one line that names the wait. Nothing for the first 300 ms, so a quick load shows nothing. After 8 s, what's slow, and Cancel. | `Loading`                        |
| The view's shape is known            | Blocks laid out as the content will be, which the content replaces in one Swap.                                                                   | `Skeleton`, inside a `Swap`      |
| A control is doing its work          | The control keeps its width, its fill and focus, and reads its verb beside a turning ring: "Merging…".                                            | `busy` and `working` on `Button` |

- `Loading` takes `status` ("Fetching diff…"), and optionally `slow`, `onCancel` and `cancelKeys`.
  It fills the view it's in. A wait that several views draw in turn, as a tab's opening is, looks
  like one `Loading`: each takes the wait's `since`, so the mark goes on turning, and the line it
  showed last (`before`), which its own line swaps in over. `onLine` says each line as it shows, for
  the next view's `before`. `Loading` centers its mark in its box; where the box moves under the
  wait, as a view's bar or a banner comes above it, the caller holds the mark where it came on
  screen (a tab's placeholder does).
- `Skeleton` is the `skeleton` utility on a block. Give each the size of what it stands for.
- A view that shows `Loading` or skeletons sets `aria-busy` on its own box until its content is in,
  so a screen reader waits for the content rather than reading the wait.
- Pass `busy={false}` to a button that can be busy, not nothing, and its `working` too, so it holds
  room for both and doesn't change width. A busy button is `aria-busy`, takes no press and isn't
  greyed. Without a `working`, it shows its label beside the ring, so it keeps its name.
- `working` is a node, for a button that can be its icon alone: give its words the same mark its
  label's have (`data-gives` in a row that gives up, see `useGiveUp`), so as its icon the ring takes
  the icon's place and no words come back with it, as Delete… on a narrow comment's head does.
- It's as wide as the wider of its label and its `working` beside the ring, so keep `working` short:
  "Checking…", not "Checking what merges with it". Where the words change as the work goes on, as
  trusting a repo's do ("Checking…", "Waiting…", "Trusting…"), keep each within the label's width,
  and give the first at rest.
- What a button says sits in the middle of the room it holds. One at the end of a row takes
  `align="end"`, so its label ends where the row does whichever it says.
- What takes a button's props does the same: a `Banner`'s and a `Problem`'s action and the merge
  panel's main button (`MergeFoot`'s `primary`) each take `busy` and `working` as `Button` does.
- `Spinner` (the `spinner` utility) alone is for a wait inside a line, such as a status bar item.
  Never beside a button, which is `busy`, and never for a whole view. It has one size, 12 px, the
  ring a busy button turns, whatever the text beside it. A ball that a spinner stands in for, as a
  status item's or a tab's, keeps a 12 px box, so nothing moves when one becomes the other.

## Empty states

A view or a list with nothing in it shows `EmptyState`, from `@lo/ui`: an icon, a title in body
text, and a button only where there's something to do here. With `Loading` and `Problem` it's one of
the three things a view shows in place of its content, and it's the only shape for this one: never a
heading, a lone line of muted text or a paragraph.

```tsx
<EmptyState
  icon="git-pull-request"
  title="No pull requests yet"
  line="Pull requests you open are listed here."
  actions={['open.box', 'open.paste']}
/>
```

- `icon` is one name from `icons.ts`: the thing that's absent, `search-x` for a search with nothing
  left, `funnel-x` for a filter. It's `lo-icon-muted`, never a status color or the accent.
- `title` is what's absent, in `text-ui` and `lo-fg-muted`: six words at most, no full stop. It's
  never set in `text-heading` or `text-title`, and it isn't a heading element.
- `line` is one line in `text-small` and `lo-fg-subtle`, and optional.
- `fit` says where it sits. `view` (a tab's or the sheet's whole content) and `panel` (a side panel
  or a pane) fill their box and centre a column, the icon at 24 px; only `view` has a main button,
  and `panel`'s are small. `list` (a list's place in a page) sits in the flow, top- and
  left-aligned, the icon at 16 px beside the title. `row` (a popup's or a table's list) is one of
  the list's rows, the icon at 14 px, with no line and no button.
- Under 160 px wide, `view` and `panel` show the icon alone, named in a tooltip.
- A list that can be empty takes its `row` where it draws its rows, at their height and inset:
  `Palette`, `ReferencesList` and `QueueTable` take it as `empty`, as `FileTree` and `ThreadList`
  take a `panel`. It comes in place of `Loading` or another empty state in one Swap.
- `actions` is two commands at most, by their ids. In a `view` the first is drawn as the main
  button. Each is a real button that takes its label, its key and whether it can run from the
  registry, as every control does: it shows the key in a chip, follows the keymap file, and while
  its command can't run it's dimmed with the reason as its tooltip. An action is the id alone, or
  `{ command, target, label }`: `target` is what the command runs on, as a key pressed there would,
  and `label` is other words where the command's label isn't what the view says.
- An action whose command starts work the view waits on is `busy` until it's done, with `working`
  its verb: "Check again" reads "Checking…" at the same width. One that copies takes `copied`, what
  its last copy came to from `useCopySaid` (`null` at rest), and reads "Copied" or "Couldn’t copy"
  for two seconds with `CopyButton`'s own faces, whether its press or its key copied.
- `children` is what the state holds for its actions to act on, between the line and the buttons:
  the prompt that Copy prompt copies, as code. Never more words.
- Offer the action here. A state never says where else an action lives ("from the status bar", "in
  the command palette"), and never has a button that isn't a command.
- A filter or a search with nothing left is the same shape: "No matches" with the command that
  clears the filter, or `No commands match “queue”`.
- [`writing.md`](writing.md#empty-state) has the words.

## Set-up

A feature that needs set-up adds a step to the welcome flow and a row in Settings, not a banner.

- In the welcome, that's a `SetupItem` in the `welcome.setup` slot, inside the step's `SetupList`:
  an `icon`, a `title` of six words at most, a `description` of one line, and one small button as
  its child. Once it's done, pass what to say as `done` ("Installed"), and it takes the button's
  place, so the row never changes height.
- A row that's a setting has no `icon`: the setting's label, a line, and the control its row in
  Settings has, which writes it as it's changed. The step that says what an overview is has two, in
  the `welcome.overviewRows` slot.
- `below` is what the button's last press left to say, under the row's line: a step still to take
  ("Add `/opt/lo/bin` to your PATH."), or a `Problem` where it failed. It comes and goes as
  `Collapse` moves. A row says how its own press went, and no toast says it again.
- `SetupDone` is the same mark and word by itself, for a step that's done outside a row: "Signed in
  as ravi-k".
- A step that sets a setting shows its options as cards (`Choices`), named by the setting's own
  option labels, with the one on file chosen, and its place in Settings at the end of the group's
  label row. A press writes the setting at once and Continue writes nothing, so walking the welcome
  without choosing changes nothing. A switch is a `Switch` on a row, never two cards.
- A card's `picture` is what its option looks like, drawn from tokens, 64 px high: bars for lines of
  code, the diff's own grounds, the real icon for a mark. Never a screenshot or an image file, and
  no words in it. A picture follows the theme; only a picture of a theme pins one. Use one where
  options differ in how Lo looks, not in what it does. The pictures are `@lo/ui`'s (`ThemePicture`,
  `LayoutPicture`, `ThreadsPicture`), drawn over one `MiniCode`.
- The welcome's foot stays on screen. In a window too short for a step, the step scrolls under it.
- The welcome's steps, its buttons and its keys are in `AGENTS.md`, under "The welcome flow".

## Offers

Something Lo offers or advises unasked, such as converting a branch stack to a GitHub stack, sits on
the control or panel it belongs to, and the reader can dismiss it, here or everywhere.

- **It's an `Offer`:** its line, Dismiss at the line's end, and its command's button under it. An
  offer that's a change to what's on screen, such as where a layer's diff starts, is a `Banner` with
  `dismissChoices`.
- **Dismiss asks where.** It opens the offer's menu, which its right-click opens too (a `notice`
  target, in a `notice` scope: `useNoticeTarget`): "Dismiss for #264", or "Dismiss for this stack",
  where the offer is tied to one pull request or stack, then "Dismiss for all stacks", or for all of
  whatever it's about.
- **"For all" turns off a setting,** which brings it back: a switch in Settings › Pull requests,
  beside the other offers', labelled "Offer GitHub stacks". A dismissal for one pull request is kept
  in the feature's own table, so it holds through restarts.
- **Its keys are Dismiss's menu's.** `Tab` reaches Dismiss, and `⏎` or `⇧F10` there opens its menu,
  whose rows run as any menu's do. The palette lists them too.
- News keeps its one-press Dismiss: it's seen once and goes. A failure has no Dismiss: it stays
  until it's fixed.

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
  names, as it mounts, without scrolling its body. When a state takes the control with focus out of
  sight, focus goes to the main button. With an `action` it draws its own foot and takes a `state`:
  `ask`, `working`, `done` or `failed`. The body stays put through all four. The button that leaves
  reads "Cancel" until something is sent, "Close" after a failure and "Done" once it has worked; the
  main button reads its `label`, then `working`, then "Try again", or the action's `again` ("Check
  again" for a result that isn't known), and isn't there at all for `again: null`, where there's
  nothing to do but close. Its fill is its `tone` only while it can be pressed for its action or
  does it: "Try again" and "Done" are always the standard primary. What went wrong goes in
  `problem`, above the foot. From the moment something is sent until GitHub answers, it's `working`,
  and nothing leaves it: Cancel is dimmed, with `stays` as its tooltip, and `Esc` and a click
  outside refuse. An action's `busy` is at work while it can still be left, as while it's checked
  before it's sent, or while "Check again" looks. `widest` holds the room of its widest label from
  the first draw; `other` is a button before the one that leaves ("Open #265"); and `mainRef`
  follows the main button. A `Problem` in the body is red once the action failed, and amber where
  the action is `unconfirmed`: what was sent may have gone through and Lo can't tell, as when
  GitHub's answer was lost, so nothing is known to have failed. Set it where that's so, never by the
  button's words: "Check again" also looks again for something missing, as GitHub CLI, which has
  failed. `ProblemTone` gives the body's `Problem` the dialog's tone, and a foot of its own sets the
  tone on its `Problem`. A dialog whose list changes as it's used, as Keyboard shortcuts' does as
  you type, takes `tall`: it stays at the height a dialog can be, and its list scrolls inside, so it
  never changes height. Every question Lo asks is a `Dialog` but one: whether to trust a repo is
  main's own native dialog, since what runs in the window could answer a question the window draws
  (`AGENTS.md`, "Trust").
- **`Popover`** is a small panel beside what it's about: a status item's details, a picker. Give it
  its `trigger`, or an `anchor` when a key opens it. One that opens unasked, as an offer, takes
  `takeFocus={false}`, so focus stays where the reader is until they go to it.
- **`ContextMenu`** is the menu at a point: what can be done to what was right-clicked, each with
  its key. A command that does one of two things is named by which it would do there, from its
  handler's `named`: "Unresolve" on a resolved thread, "Expand" on one drawn collapsed (a
  `ThreadTarget`'s `collapsed`). A focused overview block's chip names its buttons the same way:
  "Open link" for `⏎` on prose that links to a page, "Next tab" for `→` on tabs. A menu that can
  list more than the window holds, such as the tabs that don't fit, takes `long`: it grows to a
  palette's list at most, and scrolls.
- **Keyboard shortcuts** lists a run of commands that differ only by number, such as Tab 1 to Tab 8,
  as one row, "Tab 1–8" with `⌘1`–`⌘8`: each declares the same `series`. The palette still lists
  each.
- **`Palette`** is the box that finds things by typing, from the top of the window. A command that
  does one of two things is named there by which it would do, from its handler's `labelled`:
  "Unresolve thread" on a resolved thread. Its foot's `PaletteHint`s say what a key does, then the
  key, and one given `onClick` is that key's control too. Its field shows no key: the key that
  opened it is in the menu bar and Keyboard shortcuts.
- **`ThreadPopover`** is the review threads that end on a line, over the code, beside lines: a
  thread, a reply and a new comment's box open in it, and nothing in the flow moves. A code view
  draws one, in a layer of its own scroll, so it moves with its line and passes under the pinned
  file header as code does. Several threads on the line share it, unresolved first, then oldest,
  `lo-sp-12` apart with a `lo-border-subtle` hairline between. It's 520 px wide (`lo-thread-pop-w`)
  at every window width, in its side's column where that has room, else over the other side, 8 px
  inside the pane; as tall as its threads up to `lo-thread-pop-h`, past which they scroll inside it,
  a box's foot staying at its foot. Its top is 4 px under the range's last line and its left edge on
  the thread lane's, so the bubble sits at its corner. It never covers its lines unless they fill
  the pane: under the last line, else its foot 4 px above the first, else at the pane's foot. A
  preview takes the first with room and never scrolls; opened by a click or a key, it goes under the
  last line and the pane scrolls the least that shows it whole, with the range's first line too
  where both fit; only at a file's end does it go above. The pointer resting on a mark previews it,
  with no key chips and no Close, never taking focus, and it closes when the pointer leaves mark and
  popover, on a key, a press elsewhere or a scroll. A click on the mark or in the preview pins it:
  Close and the chips Swap in, in the room the preview kept for them. Pinned, it stays through
  pointer moves and scrolling, and closes on `Esc`, Close, a click on its mark, a press outside, or
  the cursor leaving its lines; with a comment box open in it, only the box closing closes it. While
  one is pinned no preview opens: a click on another mark, or `] t`, moves the pin, a box open in it
  closing first and keeping its draft. To a screen reader it's a dialog that doesn't hold focus in,
  named for its first thread.
- **`Tooltip`** names a control and its key: see [Controls](#controls).
- **`ToastStack`** shows results at the bottom right, above the status bar: three at most, four
  seconds each, paused under the pointer or focus. One with an action or Details stays eight
  seconds, and stays while its Details is open. A toast is one line, clamped to three, and one
  action at most. One that waits for the reader may add a `body`: plain words wrap, anywhere a long
  path needs to, and clamp to three lines; a body of its own markup, such as a command to copy,
  shows whole. A failure is said where it happened: a `Problem` in its view, or the control that was
  pressed. Only one with nothing in view to host it goes in a toast, at danger tone, with what main
  said behind Details where it said something: a command run from the menu, a toast that has gone,
  or a key pressed with no control for it on screen, such as `ya` from the diff. Keep each toast the
  same object while it shows. To show one again, as a second "Copied path", put a new object with
  the same `id` in `toasts`: it stays in its place and its time starts over.
- **`Problem`** is something that went wrong, in one shape: what failed, why, the one thing to do,
  and the raw text behind Details with Copy. The action's label starts with a verb, and is a node,
  so a name that's code stays code in it: "Open `settings.json`". `layout="view"` takes a failed
  view's place; `layout="inline"` sits by the control whose action failed; `layout="details"` goes
  in a status item's details, which are its box, so it has no border or ground: the title on its row
  after the triangle, the reason the details' width, each command whole in its own well with Copy at
  its end (`commands`), then one row of buttons: what helps first, then Details, then `others`, such
  as a language server's "Show log". A missing toolchain's install command is in its well, with no
  Restart until it's installed. Its `tone` is the item's ball's: `warn` while it waits, as to try
  again, `danger` only once it failed. A failed view that can also be left offers its other ways on
  as `others`, drawn quieter after the action: "Open on GitHub", "Close tab". It's said once: no
  toast repeats it. A screen reader hears what failed and why as an alert, and not the buttons.
  Anything else that says what failed, such as a comment box's note, puts the raw text behind the
  same Details and Copy with `useDetails(details)`, which gives the button and the text it opens to
  draw where they go.
- **Nothing in a `Problem` changes on a timer except through `Countdown`.** A retry's wait is
  `Retrying <Countdown at={retryAt} />.`: it counts "in 8 s" down for the eye, and a screen reader
  hears the wait as it stood when first drawn, spelled out ("in 8 seconds"), and nothing after, so
  the alert is read once, not every second. A new retry time is a new count.
- **`CopyButton`** copies and says so itself: it reads "Copied" for two seconds, and no toast says
  it again. When copying throws or rejects, it reads "Couldn’t copy" instead. A live region beside
  it says the same to a screen reader. Any other control that copies says it the same way:
  `useCopySaid()` gives what to say and `say`, `<CopyFaces said={said}>` draws the three faces in
  the button at the widest one's width, and `<CopyStatus said={said} />` is the live region beside
  it.
- **`CopyRoute`** gives everything inside it the window's way to copy. The window is refused every
  permission, so it can't use the browser's clipboard: it copies through main's `tab.copy`, and one
  `CopyRoute` around the window (`Window.tsx`) says so. `Problem`'s Copy goes through it, and a
  feature's `CopyButton` does too, with `const copy = useCopy()` and
  `<CopyButton onCopy={() => copy(text)} />`. Without a `CopyRoute`, as in a test that draws a piece
  alone, copying rejects and the button reads "Couldn’t copy".
- **`Banner`** is a full-width message under the PR header about the whole tab. A banner reports a
  change to this pull request. Offers, set-up and standing states go on the control they belong to.
  It's one line: a `title`, an `action` and Dismiss. The tab shows one at a time, the most urgent
  (`danger`, then `warn`, then `info`), with "+1" for the rest, which moves to the next; the row
  opens and closes with the Open move, and one banner gives way to the next with Swap. A `danger`
  banner that arrives takes the front, even once "+1" chose another. Focus stays in the row as they
  do, whatever takes one away (`handOffFocus`, in `keyboard.md`). The row says each banner once, as
  it arrives or comes to the front: politely, or assertively for `danger`. A title that changes in
  place isn't said again. The diff under the row keeps its rows still as a banner comes, by
  scrolling, unless that would put the cursor's row out of its top, as the first file's header at
  the top would go: then it stays at the top and its content moves down with the row. An action that
  can be busy takes `busy` (`false` at rest) and `working`, as a `Button` does. A banner that offers
  takes `dismissChoices`, and its Dismiss asks where (see [Offers](#offers)).

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
- **A key with a symbol is an icon in its chip; a key with a name is its letters.** `Key` does this
  from the string the keymap gives. On macOS `⌘ ⌃ ⌥ ⇧ ⏎ ⇥ ⌫ ⌦` and the arrows are icons; letters,
  digits, punctuation, Esc, Space, Home, End, PgUp, PgDn and Menu are Fragment Mono. On Linux only
  the arrows are icons, and the rest are words (`Ctrl+Shift+P`). The icons are 12 px at a 1.25 px
  stroke, centred on the capitals, in the chip's color. Never draw a chip without `Key`; a code
  view's tooltip takes `keyCap`.
- **A chip shows where its key works now.** Always on a surface's main button, dialog buttons, menu
  and palette rows and `HintButton`. On a control that every card or row repeats, only on the one
  the keyboard is on: give those `Key` `when="focus"`, and mark the card or row `data-key-scope`
  (with `data-focused` while the keyboard is on it, if it doesn't hold DOM focus). The others give
  the key in their tooltip. A chip never comes on hover, which would move the buttons beside it. A
  thread's card is the keyboard's whenever the code cursor is on its line and its keys would act on
  it, not only after `]t`, which also brings the whole card into view.
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
- A narrowing tab cuts its title short first, then drops its stack's count, then shortens its
  repository's name, never past its first letter or half the tab. Its number stays whole, and so
  does its mark, the state's ball or the spinner: where the number then wouldn't fit beside the
  mark, the title's words go and the mark takes their room at the tab's end, under the close button
  where that shows.
- Each thing the tab says has one place. A pull request it can't show is a `Problem` in place of the
  view, and nothing around it waits or acts: the header names the repo and number as text, with no
  places held, no merge status, review or revisions, and the view's controls, the panel toggles and
  the files are dimmed and inert (`controls-off`), with no files. How the tab stands with GitHub
  (offline, signed out, the rate limit, a read that failed after the view was drawn, which stays) is
  the PR header's chip, whose details say why, then "Checked 4 min ago" while there's a view it's
  about, and the one thing to do. Its words follow the cause: "Offline" only where no connection
  reached GitHub, "No response" where GitHub took a read and never answered, "Can’t read the
  sign-in" where the account's sign-in can't be read, and "Can’t reach GitHub" where Lo can't tell
  why it's out of reach; a read that failed for a cause Lo can't tell is "GitHub error". A control
  that's off while GitHub gives no answer says it the same way. While the tab's view is its
  `Problem`, as when it can't open, there's no chip: the `Problem` says why, once. Offline is said
  there alone, in the chip or in the `Problem`, and the merge status never says when it was checked.
  A change to the pull request is the banner.
- The status bar holds `StatusItem`s: a ball and a label. A ring while it's off or not there yet, a
  spinner at work, filled once ready, amber while it waits or holds back, red only once it failed,
  and not while it waits to try again. A click on an item with a ball always opens something, in
  every state, a ring and a filled ball too: its details, or what its `onClick` does, as "Overview
  ready" shows the overview. `StatusItem` won't take a ball without one or the other; only a fact
  with no ball, as a count or "Checked 5 min ago", is text.
- An item's details are, in order: what it is in one line, where its label doesn't say, as the code
  index's doesn't; one line of state (`StatusLine`); the facts it knows (`StatusFacts`), such as
  what it covers, where it is and when it last ran, never a number it doesn't know; and its actions
  (`StatusActions` of `StatusCommand`s, a command's button with its key in its tooltip), or a
  `Problem` once it failed. Work under way names what it works on and how far it has got there
  ("Fetching rozed-dev/e2e · 62%"), not the label again. A path is code, whole, with a way to show
  it in Finder and to copy it. The details are as wide as they say, 280 to 420 px. Items keep their
  place: one that has nothing to say yet shows its ring, and one that comes and goes, as "Rate limit
  low", goes last on the left.
- The body is one row: the left panel (stack, then files), one view or two, and the threads panel.
  Two views are a reading view, Overview or Timeline, with the diff beside it on the right, inline:
  Code beside. Nothing else tiles. Each panel, and Code beside, opens and closes with a key and with
  its button in the header's cluster, which shows what's drawn: one put away for room reads
  unpressed, and pressing it asks for it, so the others give way. One that can't fit beside a view
  at its minimum is dimmed: "Widen the window first".
- A view comes on screen through `showMiddle`, which never changes the layout: a view already drawn
  is scrolled, not switched to. A link to code from a view gives the code focus, one from a panel
  leaves focus in the panel, and with code beside, its line Lands. What only follows, as the code
  beside follows what has focus in the reading view, leaves focus where it is and records no
  history.
- Every edge in the row, the gap between two views among them, is a `Splitter` in a `Panes` row, and
  the seam of a side-by-side diff, which the view draws, drags with the same `dragEdge`: 8 px to
  grab, no line at rest, a 2 px `lo-border` line under the pointer, `lo-accent` while pressed. Only
  a drag that moves it somewhere new changes a width; a click, `Esc`, or a drag back to where it
  began puts back what was there. A double-click puts it back to its default. A feature never
  handles a drag of its own.
- The seam's handle runs from under the pinned file header to the view's foot, beneath what's drawn
  on the seam (a header, the `+`, a marker, a fold, a thread, a box), which keeps the pointer and
  every press, even one that arrived under a pointer at rest. It shares the diff's width: each side
  keeps `lo-side-min-w` or a quarter of the diff, whichever is wider, and at twice `lo-side-min-w`
  the sides split evenly with no handle. A diff narrower than that draws inline, without writing the
  layout asked for (`diff.layout`), and side by side again as soon as it's that wide, the line at
  the top of the screen staying where it is. Meanwhile Side by side and Inline refuse, "Widen the
  window first": the menu dims them and the palette leaves them out, while Settings' Diff layout,
  the preference, still changes it. As the seam moves, the first row under the pinned header keeps
  its place and the rows stay level in every frame. Sides let go at even keep no share, as the
  default.
- Widths never animate: a width re-wraps code. A change lands in one frame, and what arrives fades
  in with Swap. Nothing draws under its minimum: `fit` puts away the threads panel, then the left
  panel, then the view without focus, never what was asked for last, and brings each back when
  there's room.
- The layout is the window's, not a preference: one for every tab, saved as it changes, with no row
  in Settings. Reset layout puts it back. The window opens where it was, as big.
- The window never scrolls. Panes do. The shell hides what overflows it and puts itself back if a
  script scrolls it, and anything brought into view goes through `reveal()`, which scrolls the pane
  it's in. Lint refuses an element's `scrollIntoView` outside tests (`lo/no-scroll-into-view`). The
  shell hides with `overflow: hidden`, never `clip`: an image loads as it comes near the screen, and
  a clipped box cuts "near" off at its edge.
- A toolbar or foot never wraps or clips. Narrow, it drops chips, then hints, then labels.
- Lo draws its own tab strip on both systems and nothing else. On macOS the strip starts after the
  traffic lights (`--lo-window-inset-start`); on Linux set `data-lo-platform="linux"` on `<html>`.
  Never depend on macOS-only window chrome.
- `⌘` in a key becomes `Ctrl` on Linux. Write keys in the macOS form in docs; the app shows each
  platform its own.

## Settings

Settings is a page in a tab of its own (`⌘,`, the gear at the end of the tab strip, or the palette):
a list of its groups on the left, and the rows in a 720 px column beside it, under a search field
(`/` or `⌘F`) that filters them by label, line and key. The field spans the column, with its key's
chip at its end until it has focus or holds text, and room is kept for the scrollbar under it as
beside the rows (`gutter-stable`), so the two line up and nothing moves as the scrollbar comes and
goes. A search that finds nothing is an `EmptyState` in the middle of the column, with "Clear
search", whose key (`⌘⌫`) works on it alone, so in a field the key stays the field's. The groups are
Accounts, Appearance, Keyboard, Pull requests, Code intelligence, Storage, Integrations and About,
in that order. At the foot of the list, "Open `settings.json`" and "Open keymap file".

A preference is a setting with a row. The menu bar and the palette may toggle it, and never own it.

- **The row.** Each row is a `Setting`: its label, in four words at most, and one line under it, and
  its control at the end. Its key (`diff.layout`) shows beside the label under the pointer or focus.
  "Reset" shows beside the control while the setting isn't its default. What's wrong with a value is
  a line under the row's own line, and the result of something the row did goes under it, as a
  `Problem` when it failed. A change the settings file refused is that `Problem`: "Couldn’t change
  the theme", the file's reason, and "Open `settings.json`" or "Try again", with main's own words
  behind Details. It stays until the value or the file changes.
- **The line is at most 90 characters,** ending with a full stop, on what the setting does. It never
  says "Lo", "This setting" or what the default is: the row's Reset says that. `defineSetting` and
  `defineRow` refuse a missing or longer one. A path or a command goes under the line, not in its
  place.
- **The control is drawn from the setting.** A setting on or off is a `Switch`; one with a few
  options is a `SegmentedControl` of them. Anything else has a control of its own. A setting a key
  also changes elsewhere gives that key in its control's tooltip, not as a chip on the row, since
  the key doesn't work in Settings.
- **A list is a `SettingsList`:** the row's label, line and controls for adding to it, then the list
  in a box under them, each item a `SettingsListItem` with its own lead, label, line and buttons.
  Accounts, trusted repos and toolchains share it. An empty list is an `EmptyState` `list` in the
  box, with what to do about it.
- **A row's button for a command is `SettingsCommand`,** which takes the command's label, key and
  reason as any control does. A row that stands for one thing, such as a pull request's language
  servers, gives it the `target` the command runs on.
- **A feature adds its own rows.** `settingRow(setting, { order })` in its `window/index.ts` draws a
  setting's row from what `defineSetting` says of it (group, label, line, options), and search reads
  the same. `defineRow` makes any other row, given its group, label and line.
- **A switch that takes a part of Lo out takes all of it,** as "Show overviews" does: its view, menu
  items, palette commands and keys, its banners, notes, status items and offers, the rows and
  options in Settings that only it needs, and what main reads for it. Turned back on, it all comes
  back at once, with no restart. The switch itself stays, beside the rows it changes.

## Components

Lo's components are React components in `packages/desktop/ui`, styled with Tailwind CSS on these
tokens. Their code is the source for how each one looks.

| Group            | Components                                                                                      |
| ---------------- | ----------------------------------------------------------------------------------------------- |
| Window           | PullRequestTab, TabBar, PRHeader, StatusBar, Banner, Offer, DismissButton, Panes, Splitter      |
| Panels           | StackTree, FileTree                                                                             |
| Controls         | Button, CommandButton, HintButton, MoreButton, CopyButton, Key, SegmentedControl, Switch, Input |
| Marks            | Icon, Glyphs, StatePill, Tag, Avatar, Marks                                                     |
| Floating         | Dialog, Popover, ThreadPopover, ContextMenu, Palette, Tooltip, ToastStack                       |
| Motion and waits | Collapse, Swap, Loading, Skeleton, Spinner, LogoMotion, Problem, EmptyState                     |
| Review           | Thread, Diff, CodeView, CommentBox                                                              |
| Overview         | OverviewDocument, CodeBlock, Figure, Walkthrough, TabsAndFolds, Glossary                        |
| Flows            | Choice, Checklist, Composer, Peek, Timeline, SetupList, SetupItem, SetupDone                    |
| Settings         | SettingsPage, SettingsGroup, Setting, SettingsList, SettingsListItem, SettingsCommand           |

Build new screens from these. If something new is needed, make it from the same tokens and keep it
to one job.

An `Avatar` whose picture the window already holds shows it from the first frame, with no initials
first, so a card drawn again doesn't flash them.

## Code and diffs

- Every code view is CodeMirror 6, themed by `css/code.css`. Lo's own decorations use `.lo-*`
  classes; CodeMirror's merge classes (`cm-changedLine`, `cm-changedText`, `cm-mergeSpacer`,
  `cm-collapsedLines`) share the same rules.
- Side by side by default. Both sides stay on one row grid: a wrapped line, or a thread between
  lines, on one side leaves space (`lo-spacer`) on the other.
- **A marker sits against the code it's about.** Line numbers, then the thread lane, then the
  overview lane on a side that shows new lines, then the code. A lane is as wide empty as full.
- **A thread is a bubble, the overview is a ball.** A thread's mark is a `message-square` icon with
  a bracket up its range, amber while unresolved or pending, grey once resolved or out of date. The
  overview's is the Powder ball and rail. Neither borrows from the other.
- **A thread opens over the code, not in it.** With Threads in code at "Beside lines", the default,
  a thread, a reply and a new comment's box open in `ThreadPopover` under the last line they're
  about, and no line of code moves. It never covers its own lines unless they fill the pane.
  "Between lines" draws them in the flow, with space on the other side.
- **A hover previews, a click pins.** A preview is the pinned popover without its keys, so pinning
  moves nothing. One popover per code view.
- **Filler is quieter than code.** Everything in a diff that isn't code (that space, folds of
  unchanged lines, the row under a file's header) sits on one flat ground, `lo-diff-filler`, in type
  smaller and dimmer than code. Only a run of space three lines tall or less is hatched, so a line
  missing on one side still reads as missing, and a run is hatched or flat throughout. A side with
  none of a file's lines, as an added or deleted file's, is flat: a missing file isn't a gap.
- Long lines wrap. Wrapped lines continue four columns past the line's own indent (`--ind`).
- Whitespace changes show by default; a re-indented line highlights only its new leading spaces.
- Generated files, lockfiles and very large files start collapsed with a reason and a way to open
  them. The way is a button under the file's header that says what a click shows, "Expand file" or
  "Show 18,000 lines", and runs what `za` runs there. Its tooltip gives the key.
- Code is set as written: no ligatures. Every rule that sets the mono face turns them off with it.
- A file's header reads once across both sides. The file you're in stays pinned under the diff bar,
  on an opaque band: the next file's header pushes it up as it comes under it, in step with the
  scroll, and the row is that file's once its header reaches the top. A jump to another file swaps
  the row's content in one Swap. What belongs to the file and not to a line (the button that shows
  its lines, a wait, a `Problem` such as a refused "Mark viewed") is under its header, never a
  toast.
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
  It's an outline until it's pressed, when it fills: the accent is spent on the press, not the
  hover. On a line that takes no comment it's dimmed from the first frame.
- **What you open is in view when it opens.** A comment box, a thread or a peek that opens scrolls
  its pane the least that shows all of it, at once, with `reveal` (`block: 'nearest'`), and never
  with `scrollIntoView`. One taller than its pane shows from its top. A comment box does this itself
  whenever it takes focus (`Composer.focus()`), and keeps itself in view as it's laid out, until the
  reader's next key, press or scroll. It keeps `lo-sp-8` under it (its `scroll-margin-bottom`, which
  `reveal` honours), so its ring shows whole above the pane's foot.
- **A box that grows keeps its foot in view**, as an editor keeps its caret. With focus in it, a box
  that grows as a line is typed, its preview is drawn or its text wraps in less width scrolls its
  pane the least that keeps `lo-sp-8` under it. One that shrinks moves nothing, and one whose foot
  the reader scrolled off screen stays where they left it.

## Comments

**Every place you write is the same box.** A new comment on lines, on a file or on the pull request,
a reply and an edit are all `CommentBox` (`packages/desktop/ui`), around the one editor the code
view makes (`compose` on a code view, or `createComposer` outside one). A feature never draws its
own.

The review's summary, in the submit dialog, is the same editor in the same frame, with the same head
(`CommentBoxHeadBar`), notes, upload rows and foot bar (`CommentBoxFootBar`); it has no "Discard
draft". While its review is sent, and until Lo knows how that went, it's held as text, not as a card
(`hold(true, { empty: 'No summary', icon: 'file-text' })`): it keeps its height, head and foot, its
text is read-only in `lo-fg-muted`, and Write | Preview and "Attach files…" dim.

- **Head.** What the comment is on, at the left, in the words a line is named everywhere: "Line 3",
  "Lines 39–41", "Line 3, removed", "File", "Pull request", "Reply", "Edit", "Summary". Why it's on
  that, where the reader asked for something else, is one quiet line under it (`why`). Write |
  Preview is at the right, then the control that closes the box (`close`), which keeps the draft.
  "as login" shows only when more than one account is signed in.
- **Body.** The editor, or its preview. The box has one ring, which is its focus; nothing inside it
  has another. An empty box under the pull request says what it's for in a quiet hint (`hint`):
  "Comment on #264"; one whose head says it, as a reply's does, has none.
- **Foot.** "Attach files…" as an icon button at the left, then "Discard draft"; the actions at the
  right, each with its key, always in one order, "Send now", then "Add to review", however the box
  was opened. Only the fill moves, to the main one.
- **Narrow.** Between lines, side by side, a box is never narrower than 256px: where its side of the
  diff is, it takes both sides, over the room kept for it on the other. The head and the foot are
  one line each at any width, and give up what they must (`useGiveUp`): the foot its key chips, then
  the words of "Discard draft", then its hint, then the actions' words for their icons, the filled
  one's last; the head who it's from, then the switch's key chip, then the words of Write and
  Preview for their icons, before what the comment is on is cut short. In a box taller than its
  pane, the foot stays at the pane's foot.
- **Actions.** "Add to review" and "Send now" under a line or a thread, "Send" under the pull
  request, "Save" in an edit. While a review is pending GitHub adds every comment to it, so the box
  has "Add to review" alone. A dimmed action says why in its tooltip.
- **Sending.** A comment is its card from the moment it's sent: the box draws the text as it will
  read, with "Sending…" where its time will be (`SentPost`; "Saving…" for an edit), in the room the
  box had. The box keeps that height, and the comment on it, until the card from GitHub is drawn,
  and gives way to it in one frame: the text never leaves the screen, and what's under it moves
  once. A send that fails turns back into the open box with the text as it was, under a note that
  says what wasn't sent and why, in the danger tone. The box's own action sends it again: a note
  never offers a second button for what a button under it does. A screen reader hears each step from
  the comments' one live region (`tell`): that it's sending, that it was sent, or the note. A note
  takes focus back into its box only from a reader still there, or with focus nowhere: one who left
  for the code keeps their place.
- **An edit's box is the comment.** From an edit opening to its card showing what was saved, the
  comment's text shows once, in the box: the thread's card draws without that comment and offers no
  reply meanwhile.
- **Never a blind resend.** When GitHub's answer never came, nobody knows whether the comment
  posted, and sending it again could post it twice. The box then says "Comment not confirmed" and
  offers "Check again", which only looks. Its buttons are dimmed with "Check again first" until Lo
  knows: found, the card takes the box's place; not found, the box's action sends it again. The card
  that says "Checking…" comes on screen whole as Lo starts to look, unless the reader has left the
  box. An edit and a resolve follow the same rule: a card's "Resolve not confirmed" offers "Check
  again", and "Try again" only once Lo knows it didn't go. A resolve, an unresolve or a delete shows
  as asked, its control at work, until the thread itself shows it, so a card never flips back
  between GitHub's answer and the next read of its threads. If they don't show it in ten seconds the
  control is its own again, and the card still shows what was asked until they're read again. One
  change to a thread at a time: while one is at work, resolving it or deleting from it is dimmed,
  with what's at work as the reason ("Resolving…").
- **Said where it's seen.** A send, an edit, a resolve or a delete that fails, or can't be
  confirmed, where its card or box isn't on screen to say it, as beside lines once its popover has
  closed, is said in one toast, in its note's tone, whose "Show thread" opens the thread where its
  card or box says the rest. Its thread's mark has the dot while the card or box says it. Nothing is
  sent again from the toast.
- **Attached files.** A file goes in at the cursor as a placeholder while it uploads. If the upload
  fails or is refused, Lo takes the placeholder out itself and the file's row says what happened. A
  comment isn't sent while a placeholder is in its text. What Lo changes in the text itself, as a
  link taking its placeholder's place, is no step of the box's undo (`Composer.replace` with
  `record` false): undo goes on past it to what the reader typed.
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
- Give an element a `title`: the tooltip is Lo's `Tooltip`.
- Copy macOS-only window chrome, or assume `⌘` exists on Linux.
- Write an `<svg>` icon in a component, or type a symbol the fonts don't hold.

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
