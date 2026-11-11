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
window: both sides of every file in one scroll, each side one CodeMirror editor, with the PR's
review threads, and made-up ones on the left side, where recorded PRs have few. Each file starts
collapsed, and fills in as worker threads in a background process diff and highlight it; the moved
code comes last. A file with more than 5,000 changed lines, or a binary file, stays collapsed.

The two sides stay level through a spacer pass, which runs only over the rows both editors draw:
rows with lines on both sides start at the same height on both, so a block of added lines faces
empty space. It runs after the editors measure and before the page is painted, from the heights
CodeMirror measured. The page sets `window.diffView`: `misalignment()` says how far apart, as drawn,
the rows on screen start on the two sides, headers and collapsed blocks included, and how many are
drawn on one side only, cheaply enough to call every frame; `movement()` says how far a line on
screen moved since it was last called against what the wheel or a moved cursor asked, to call every
frame too; `passStats` says what the pass has cost, and `spacers` how many spacers each side holds.
`window.diffLoaded` is set once everything has arrived.

## Recording the manifests

The manifests are committed, so only a maintainer adding or refreshing a PR needs this:

```sh
pnpm nx run perf:record -- typescript-54820
```

It reads the PR from GitHub's API as the project's test account, and refuses any other account. The
token comes from the file `LO_FIXTURE_TOKEN_FILE` names. To add a PR, add it to `pullRequests` in
[`scripts/record.ts`](scripts/record.ts), record it, then fetch it.
