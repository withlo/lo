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
4. **The keyboard is visible.** Every action has a key, and every control that has one shows it.
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

### Text

- `lo-fg` for primary text, `lo-fg-muted` for meta, `lo-fg-subtle` for placeholders and separators.
  All reach 4.5:1 on `lo-bg`, `lo-bg-chrome`, `lo-bg-raised` and `lo-bg-overlay` in both themes.
- `lo-fg-dim` marks unchanged files beside changed ones in the tree. Use it for nothing else.
- `lo-fg-disabled` and `lo-code-gutter` fall below 4.5:1 on purpose. Use them only for disabled
  controls and line numbers.

### The accent

- Use `lo-accent` for: the focus ring, the text cursor, selection, links, the one main button in a
  view, and what's on screen (current file, current layer, current step, the overview marker).
- Put `lo-on-accent` on Powder fills, never white or chalk directly.
- One main (`lo-btn--primary`) button per view at most.
- Don't use the accent for headings, icons at rest, borders at rest or to make something "pop".

### Status, PR state and diffs

- PR state: `lo-state-open`, `-draft`, `-merged`, `-closed`, each with `-bg` and `-border`. Always
  pair the color with the state's icon and word.
- Status: `lo-success`, `lo-warning`, `lo-danger`, `lo-info`, each with `-bg` and `-border`. A
  status color never appears without a word or icon that says the same thing.
- Diff: whole lines use `lo-diff-add-bg` / `lo-diff-del-bg`; changed words inside them
  `lo-diff-add-word` / `lo-diff-del-word`; signs and gutters `lo-diff-add-fg` / `lo-diff-del-fg`.
  Moved code uses the `lo-diff-moved-*` tokens, never green or red.
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

## Motion

- Use the brand curves: `--lo-ease-out` for things arriving, `--lo-ease-in-out` for things settling.
  `--lo-dur-fast` (90 ms) for hovers, `--lo-dur` (160 ms) for most, `--lo-dur-slow` (260 ms) at
  most.
- Nothing waits on an animation. Reduce Motion turns all of it off; `base.css` already does.
- The meld loop (brand/motion) is the only loading animation for a whole view. Inline waits use
  `lo-spinner` or `lo-skel`.

## Focus and the keyboard

Every action has a key; see `keyboard.md` for the rules and focus, and section 12 of
[`docs/design.md`](../docs/design.md) for the keys.

- Show keyboard focus with `--lo-ring` (a 1.5 px Powder edge and a soft halo). Rows in lists use
  `--lo-ring-inset` so they don't jump. Never remove a focus style without replacing it.
- Focus and "current" are different: focus is where the keyboard is; current (`lo-current`, a Powder
  ball) is what's on screen. They can sit on different rows.
- Show a control's key on the control with `lo-kbd` (or `lo-keys` for a sequence). In menus, the key
  sits at the right.
- Vim's block cursor is `lo-code-cursor` with a halo; it goes hollow when the view loses focus.

## The window

- One window, a tab per PR (a whole stack in one tab). Rows top to bottom: tab strip
  (`lo-tabbar-h`), PR header, banners, body, status bar (`lo-statusbar-h`).
- The body is left panel (stack, then files), the middle sheet, and the threads panel. Each panel
  opens and closes with a key.
- Lo draws its own tab strip on both systems and nothing else. On macOS the strip starts after the
  traffic lights (`--lo-window-inset-start`); on Linux set `data-lo-platform="linux"` on `<html>`.
  Never depend on macOS-only window chrome.
- `⌘` in a key becomes `Ctrl` on Linux. Write keys in the macOS form in docs; the app shows each
  platform its own.

## Components

Lo's components are React components in `packages/desktop/ui`, styled with Tailwind CSS on these
tokens. Their code is the source for how each one looks.

| Group             | Components                                                               |
| ----------------- | ------------------------------------------------------------------------ |
| Window            | PullRequestTab, TabBar, PRHeader, StatusBar, Banner                      |
| Panels            | StackTree, FileTree                                                      |
| Controls          | Button, Key, SegmentedControl, Toggle, Input                             |
| Marks             | StatePill, Tag, Avatar, Marks                                            |
| Popovers          | Popover                                                                  |
| Review            | Thread, Diff, CodeView                                                   |
| Overview          | OverviewDocument, CodeBlock, Figure, Walkthrough, TabsAndFolds, Glossary |
| Dialogs and flows | Dialog, Palette, Choice, Checklist, Toast, Composer, Peek, Timeline      |

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

## Overviews

- The overview is a document: an outline on the left, the article at reading measure, wide blocks
  (code, figures, walkthroughs) up to 840 px.
- Lo renders only its own blocks. The writer chooses which sections exist and their order; never
  assume the default five.
- Code blocks show the real code at the overview's commit, as a diff. Flag lines that changed since;
  say plainly when code is missing or a reference doesn't resolve.
- Figures use the `fig-*` colors only. `figures.md` is the contract for agents that draw them.

## Writing

Interface copy is plain, short and specific. See `writing.md`. In brief: sentence case, verbs on
buttons ("Load the newer push"), the user's words (push, revision, local copy), and errors that say
what happened and what to do next.

## Do and don't

**Do**

- Take every color, size and radius from a token.
- Show the key on every control that has one.
- Keep one accent, one main button and one focused thing per view.
- Pair every status color with a word or an icon.
- Check both themes, and check them at the window's real density.
- Use the files in `brand/logo/` for the mark, in `lo-mark`.

**Don't**

- Color the mark, or put it in the interface's chrome.
- Write hex values, pixel font sizes or new shadows in components.
- Use Powder, green, red or purple for decoration.
- Add gradients, glows (other than the focus halo), colored left-border cards or emoji.
- Use the system font, or load fonts from the network.
- Hide focus, or show hover styles that the keyboard can't reach.
- Copy macOS-only window chrome, or assume `⌘` exists on Linux.

## Where things are

| Path                                       | What                                                                                              |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `tokens.json`                              | Every color (both themes), shadow, space, radius, size and type style. The one source for values. |
| `syntax.json`                              | The syntax tokens `code.css` styles as `lo-syn-*` classes, numbered as highlights number them.    |
| `css/index.css`                            | Imports the stylesheets in order. The app imports this file.                                      |
| `css/tokens.css`, `css/type.css`           | Generated from `tokens.json`. Don't edit.                                                         |
| `css/foundation.css`                       | Focus rings, font aliases, tracking, motion, layers, platform insets.                             |
| `css/base.css`, `code.css`, `overview.css` | Element defaults, CodeMirror and diffs, the overview.                                             |
| `keyboard.md`, `figures.md`, `writing.md`  | Key rules and focus, figure colors for overview agents, interface copy.                           |
| `assets/Logos/README.md`                   | The rules for the logo files in `brand/logo/` and `brand/icon/`.                                  |
| `scripts/build.mjs`                        | Regenerates the generated files.                                                                  |
| `stylelint.config.mjs`                     | Keeps the plain CSS on the tokens.                                                                |

To change a value, edit `tokens.json` and run `node design/scripts/build.mjs`, then commit the
generated files with it; CI fails when they're out of date. Everything inside the app sits under an
element with `class="lo-app"`; set `data-theme="light"` on `<html>` for the light theme, or on any
element to pin one.
