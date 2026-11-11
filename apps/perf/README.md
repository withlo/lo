# perf

Lo's performance suite. It measures the diff view on large, real pull requests, against fixed bars,
with recorded data and no GitHub calls.

## The pull requests

| Manifest            | Pull request                                                                         | Files | Lines changed     |
| ------------------- | ------------------------------------------------------------------------------------ | ----: | ----------------- |
| `kubernetes-125488` | [kubernetes/kubernetes#125488](https://github.com/kubernetes/kubernetes/pull/125488) |   486 | +24,749 −37,722   |
| `typescript-51387`  | [microsoft/TypeScript#51387](https://github.com/microsoft/TypeScript/pull/51387)     |   656 | +282,700 −284,842 |
| `typescript-54820`  | [microsoft/TypeScript#54820](https://github.com/microsoft/TypeScript/pull/54820)     |   560 | +28,486 −23,296   |

kubernetes#125488 has renames and hundreds of review threads. TypeScript#51387 changes nearly every
line of `checker.ts`, 78,892 in all. TypeScript#54820 changes 4,465 lines of the same file, out of
about 50,000.

## The data

Each PR has a manifest in [`data/`](data/):

- the merge base and head commits;
- each changed file's path, previous path, status, and lines added and removed;
- each review thread's file, side and line, and the length of each of its comments.

The manifests hold no comment text and no names: nothing measured depends on the words, and they're
other people's. The files' text isn't committed either. It's tens of megabytes of other projects'
code, which the commits pin: git checks every object it downloads against its ID.

## Getting the files

```sh
pnpm nx run perf:fetch
```

This downloads each PR's two commits and both versions of every file it changes from the public
repos, with git, and needs no token. It keeps one shallow, blobless clone per repo in
`~/.cache/lo/perf` (or `$XDG_CACHE_HOME/lo/perf`, or `$LO_PERF_CACHE`), which every checkout of Lo
on the machine shares. The three PRs' files are about 140 MB of text, which git stores in under 20
MB. Running it again downloads only what's missing.

## Opening a pull request

```sh
pnpm nx run perf:open -- kubernetes-125488
```

This builds the app and the grammars, fetches what's missing, and opens the PR's whole diff in one
window, through `@lo/ui/code`'s `createDiffView`, as the app's diff opens one: both sides of every
file in one scroll, each side one CodeMirror editor, with the PR's review threads, and made-up ones
on the left side, where recorded PRs have few. Each file starts collapsed, and fills in as worker
threads in a background process diff and highlight it; the moved code comes last. A file with more
than 5,000 changed lines stays out of the documents until `za` loads it, and a binary file shows
only its header.

The two sides stay level through a spacer pass, which runs only over the rows both editors draw:
rows with lines on both sides start at the same height on both, so a block of added lines faces
empty space. It runs after the editors measure and before the page is painted, from the heights
CodeMirror measured. The page sets `window.diffView` to the view's probe: `misalignment()` says how
far apart, as drawn, the rows on screen start on the two sides, headers and collapsed blocks
included, and how many are drawn on one side only, cheaply enough to call every frame; `movement()`
says how far a line on screen moved since it was last called against what the wheel or a moved
cursor asked, to call every frame too; `passStats` says what the pass has cost, `spacers` how many
spacers each side holds, `layout` which layout shows, and `cursor()` where the cursor is and whether
it's on screen. `window.diffLoaded` is set once everything has arrived.

### Keys

Click a line to give its side focus. Keys take the app's path: the command registry
(`@lo/ui/commands`) sees each first and runs Lo's commands, declared here with the diff's keys, and
the rest go to Vim, from CodeMirror's Vim package, so `j`/`k`, counts, `gg`/`G`, `V` and `/` work as
in Vim. These are Lo's:

| Keys      | What they do                                                         |
| --------- | -------------------------------------------------------------------- |
| `]c`/`[c` | Next or previous change                                              |
| `]f`/`[f` | Next or previous file                                                |
| `]t`/`[t` | Next or previous thread                                              |
| `Tab`     | The same row on the other side                                       |
| `zo`/`zc` | Open or close the unchanged lines at the cursor                      |
| `zR`      | Open every run of unchanged lines in the file                        |
| `za`      | Load a large file, or close a file into one block and open it again  |
| `gi`      | The inline layout, one document with deleted lines before added ones |
| `c`       | A comment box on the line, or under the lines `v` selected           |
| `yl`      | Copy GitHub's link to the line                                       |

Lo's jumps are Vim motions, so they take counts and work in visual mode. `Ctrl-o` and `Ctrl-i` go
back and forth through the tab's history: the places Vim's jumps and `Tab` left, on either side and
in either layout. The keys that go by the screen, `PageDown`/`PageUp`, `Ctrl-f`/`b`/`d`/`u`/`e`/`y`,
`H`/`M`/`L` and `zt`/`zz`/`zb`, go by the box that scrolls both sides, as Vim's go by its window,
and take counts as Vim's do. No key edits the diff or enters insert mode there.

In a comment box, which grows as you type, Vim's keys keep their own meanings, `Ctrl-o` and `Ctrl-i`
walk the box's own jumps, and `Tab` indents in insert mode. `⌘⏎` adds the comment to the line's
thread, which goes nowhere else; `Esc` leaves insert mode, and `Esc` again closes the box and keeps
the draft for the next `c` on that line.

### The key spec

```sh
pnpm nx run perf:e2e
```

This writes a small PR of its own, a few files with a rename, a move and threads on both sides,
opens it with `LO_PERF_PULL` naming the file, so nothing is fetched, and presses real keys: the
cursor stays on screen, `Tab` and `Ctrl-o` cross and come back, a comment box keeps its keys and
stays level as it grows, a held key dies on blur, and `y w` still reaches Vim. Another shows a file
as GitHub's diff leaves it, unchanged lines between hunks left out, then fills it in place as the
local copy would (`gaps` and `copyAfterMs` in the file): the cursor and the scroll stay put. CI runs
them on Linux.

## The bench

```sh
pnpm nx run perf:bench
```

This measures the diff view against its bars, on kubernetes#125488 and TypeScript#51387, at 1440 px
wide and at the screen's full width, and `zR` on TypeScript#54820's `checker.ts`, three runs of
each. It runs only on a Mac, logged in with the display awake, and never in CI: frame times mean
nothing without a display to pace them. It stops if the screen is locked, or if frames don't come at
the display's rate. Give it a quiet machine; a full run takes about three hours.

It starts the built suite unpackaged, as Playwright can't drive a packaged build, with
`--js-flags=--expose-gc` so it can read the heap after a collection. The window opens at 1440 by 900
px, or with `LO_PERF_WINDOW=screen` as large as the screen allows. The page notes when main started
opening the pull request, when the page itself started, and when its first file and everything else
arrived (`window.perfMarks`), and the bench adds a recorder that reads every frame after its layout
and before its paint. Input is real, through Chromium's input pipeline: scrolling is Chromium's own
synthesized scroll gesture, paced by the display as a trackpad's is, and keys are sent on a clock as
a keyboard sends them. Each run:

- opens the pull request, and times it from the page starting to open it to the first file drawn
  with its diff and highlighting, with the window's long tasks, and from the background process
  getting the files to every diff and the moves arriving; main reading the files and the window
  starting are reported on their own;
- presses `]f`, `]c` and `G` from the top, holds `j`, types a comment on each side and crosses with
  `Tab`, timing each key from its keydown to the next frame on the display with the Event Timing
  API; it also holds F7, whose only effect is to recolour a 4 px square, the floor any key that
  paints stands on, and `Esc`, which paints nothing;
- scrolls from the top to the bottom at 8,000 px a second, twice; then 40,000 px from the top at
  each of 3,000, 8,000 and 15,000 px a second, and in flings that slow down as a trackpad's do,
  noting each frame's time, how level the rows on screen are, and anything blank on screen;
- holds PageDown from the top to the bottom; where PageDown stops moving short of the bottom, it
  notes the place and scrolls past it with the wheel, and where PageDown keeps going back there, it
  says how far down it got;
- reads the renderer's footprint (macOS's `phys_footprint`) and resident memory, the GPU process's
  footprint, and the heap after each of the two full scrolls;
- in TypeScript#51387, loads `checker.ts`, which stays out of the documents until `za`.

Then a run with tracing writes JSON traces of the opening, the keys, scrolling and PageDown, which
open in DevTools' Performance panel or at ui.perfetto.dev, and a last run records a video of each
pull request at 1440 px, converted to MP4 in a hidden window with Chromium's own encoder. The
report, `report.md` and `report.json`, the traces, the videos and every frame recorded go to
`bench/results/<date>/`, which git ignores. `report.md` says what each timer starts and stops on.

For a short trial, run one of each and stop each full scroll early:

```sh
pnpm nx run perf:bench -- --runs 1 --pull kubernetes-125488 --width 1440 --limit 50000 --no-traces --no-videos
```

`--pull` and `--width` (`1440` or `screen`) can each be given more than once; `--no-zr`,
`--no-traces` and `--no-videos` leave those out. `--report <folder>` writes a folder's `report.md`
again from its `report.json`, with the folder's `notes.md`, if it has one, under the summary.
Recording a video needs Playwright's own ffmpeg, which the bench downloads the first time.

## Recording the manifests

The manifests are committed, so only a maintainer adding or refreshing a PR needs this:

```sh
pnpm nx run perf:record -- typescript-54820
```

It reads the PR from GitHub's API as the project's test account, and refuses any other account. The
token comes from the file `LO_FIXTURE_TOKEN_FILE` names. To add a PR, add it to `pullRequests` in
[`scripts/record.ts`](scripts/record.ts), record it, then fetch it.
