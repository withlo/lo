#!/usr/bin/env bash
# The pull request the app's end-to-end tests open: rozed-dev/e2e#80, from
# `app/feature` into `app/base`, in GitHub's rozed-dev/e2e test repository.
#
#   bash testing/fixtures/app.sh <folder> [--without-first-push]
#
# makes, in <folder>:
#
# - `rozed-dev/e2e.git`, a bare repository holding what GitHub holds for the pull request, commit
#   for commit: `app/base` and `app/feature` as they are now, the head again as
#   `refs/pull/<number>/head`, and the first push's head, which GitHub keeps after the second
#   replaced it, under a ref of its own. It lets clients filter and fetch any commit by ID, as
#   GitHub does, so Lo can fetch from it with `LO_GIT_REMOTE=file://<folder>`. With
#   `--without-first-push` it leaves the first push out, as if GitHub no longer had it;
# - `work`, a working copy with every commit on a branch: `app/base-1` and `app/head-1` for the
#   first push, `app/base` and `app/head` for the second;
# - `overview`, the pull request's overview as its writer left it: `artifact.md` and `figures/`.
#   The bare repository holds it as GitHub does, at `refs/lo/pr/<number>`: one commit of exactly
#   those files, written as `lo-overview commit` writes it.
#
# Nothing here reads the network. Every commit has fixed names, dates and contents, so it comes out
# with the ID GitHub has for it, on any machine, with any git. The pull request was made by pushing
# `app/base` (its two commits, earlier) and `app/head-1` to `app/feature`, and opening it; then
# force-pushing `app/head` to `app/feature`.
#
# The pull request has two pushes, across a rebase: the first is on the base's first commit, and
# the base has moved on since. The first push:
#
# - renames src/parse.ts to src/parser.ts, changing two lines;
# - moves `wrap` from src/format.ts into src/text/wrap.ts, unchanged;
# - deletes src/legacy.ts;
# - adds data/numbers.txt, 5,001 lines;
# - changes pnpm-lock.yaml, a lockfile;
# - redraws assets/mark.png, a binary, from 1×1 to 2×2.
#
# The base's second commit changes README.md. The second push rebases the first push's two commits
# onto it, as `git rebase` does, each keeping its author's date, then adds a commit that changes
# src/parser.ts.
#
# The overview was written for the first push, so the second leaves it out of date. It has code
# blocks on lines the pull request changed, on lines it didn't, in a file it doesn't touch and on
# lines the second push changed; a figure with parts, a walkthrough, terms, tabs and a fold; an
# illustration, and a code block whose file isn't there.

set -euo pipefail

# The pull request's number on GitHub.
APP_PULL=80

folder=${1:?usage: bash testing/fixtures/app.sh <folder> [--without-first-push]}
first_push=true
case ${2:-} in
  '') ;;
  --without-first-push) first_push=false ;;
  *)
    echo "usage: bash testing/fixtures/app.sh <folder> [--without-first-push]" >&2
    exit 2
    ;;
esac
mkdir -p "$folder"
folder=$(cd "$folder" && pwd)
work=$folder/work
bare=$folder/rozed-dev/e2e.git
overview=$folder/overview
rm -rf "$work" "$bare" "$overview"

# None of the user's or the system's settings, so nothing signs or rewrites a commit.
home=$(mktemp -d)
trap 'rm -rf "$home"' EXIT
export HOME=$home GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 LC_ALL=C
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES
export GIT_AUTHOR_NAME=rozed-bot GIT_AUTHOR_EMAIL=353226052+rozed-bot@users.noreply.github.com
export GIT_COMMITTER_NAME=rozed-bot GIT_COMMITTER_EMAIL=353226052+rozed-bot@users.noreply.github.com
umask 022

g() { git -C "$work" -c core.autocrlf=false -c core.fileMode=true -c commit.gpgSign=false "$@"; }

# Writes stdin to <path> in the working copy, making its folder.
put() {
  mkdir -p "$(dirname "$work/$1")"
  cat >"$work/$1"
}

# Commits everything in the working copy as written at <author date>, committed at <commit date>.
commit() {
  g add -A
  GIT_AUTHOR_DATE=$2 GIT_COMMITTER_DATE=$3 g commit -q -m "$1"
}

# The 1×1 and 2×2 marks: one pixel of Powder, then four of chalk.
mark_1() {
  printf '\x89\x50\x4e\x47\x0d\x0a\x1a\x0a\x00\x00\x00\x0d\x49\x48\x44\x52\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90\x77\x53\xde\x00\x00\x00\x0c\x49\x44\x41\x54\x78\xda\x63\xe8\xd9\x72\x03\x00\x03\xe8\x02\x19\x39\x1c\x07\x95\x00\x00\x00\x00\x49\x45\x4e\x44\xae\x42\x60\x82'
}
mark_2() {
  printf '\x89\x50\x4e\x47\x0d\x0a\x1a\x0a\x00\x00\x00\x0d\x49\x48\x44\x52\x00\x00\x00\x02\x00\x00\x00\x02\x08\x02\x00\x00\x00\xfd\xd4\x9a\x73\x00\x00\x00\x10\x49\x44\x41\x54\x78\xda\x63\x78\xf1\xec\x31\x10\x31\x40\x28\x00\x4b\x7e\x0a\xc5\x2d\xe0\xb7\xce\x00\x00\x00\x00\x49\x45\x4e\x44\xae\x42\x60\x82'
}

# The base's first commit.
base_files() {
  put README.md <<'EOF'
# App fixture

What Lo's end-to-end tests open: a pull request with a rename, a move, a lockfile, a large file, a
binary and a deletion, pushed twice across a rebase.
EOF
  put src/parse.ts <<'EOF'
/** A line of input: its number, from 1, and its text. */
export interface Line {
  readonly number: number;
  readonly text: string;
}

/** Splits `input` into lines, on `\n`. */
export function parse(input: string): Line[] {
  return input.split('\n').map((text, index) => ({ number: index + 1, text }));
}

/** The lines of `input` that aren't blank. */
export function filled(input: string): Line[] {
  return parse(input).filter((line) => line.text.trim() !== '');
}
EOF
  put src/format.ts <<'EOF'
import type { Line } from './parse.ts';

/** `lines` as text, each after its number. */
export function format(lines: readonly Line[]): string {
  return lines.map((line) => `${line.number}: ${line.text}`).join('\n');
}

/** `text` broken into lines of at most `width` characters, at spaces. */
export function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    if (line !== '' && line.length + 1 + word.length > width) {
      lines.push(line);
      line = word;
    } else {
      line = line === '' ? word : `${line} ${word}`;
    }
  }
  if (line !== '') lines.push(line);
  return lines;
}
EOF
  put src/legacy.ts <<'EOF'
/** The old name for `format`, kept for callers that haven't moved. */
export { format as render } from './format.ts';
EOF
  put pnpm-lock.yaml <<'EOF'
lockfileVersion: '9.0'

settings:
  autoInstallPeers: true
  excludeLinksFromLockfile: false

importers:

  .:
    dependencies:
      zod:
        specifier: 4.6.6
        version: 4.6.6

packages:

  zod@4.6.6:
    resolution: {integrity: sha512-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==}

snapshots:

  zod@4.6.6: {}
EOF
  mkdir -p "$work/assets"
  mark_1 >"$work/assets/mark.png"
}

# The head's first commit: the rename, the move and the deletion.
first_change() {
  g mv src/parse.ts src/parser.ts
  put src/parser.ts <<'EOF'
/** A line of input: its number, from 1, and its text. */
export interface Line {
  readonly number: number;
  readonly text: string;
}

/** Splits `input` into lines, on `\n` or `\r\n`. */
export function parse(input: string): Line[] {
  return input.split(/\r?\n/).map((text, index) => ({ number: index + 1, text }));
}

/** The lines of `input` that aren't blank. */
export function filled(input: string): Line[] {
  return parse(input).filter((line) => line.text.trim() !== '');
}
EOF
  put src/format.ts <<'EOF'
import type { Line } from './parser.ts';

export { wrap } from './text/wrap.ts';

/** `lines` as text, each after its number. */
export function format(lines: readonly Line[]): string {
  return lines.map((line) => `${line.number}: ${line.text}`).join('\n');
}
EOF
  put src/text/wrap.ts <<'EOF'
/** `text` broken into lines of at most `width` characters, at spaces. */
export function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    if (line !== '' && line.length + 1 + word.length > width) {
      lines.push(line);
      line = word;
    } else {
      line = line === '' ? word : `${line} ${word}`;
    }
  }
  if (line !== '') lines.push(line);
  return lines;
}
EOF
  g rm -q src/legacy.ts
}

# The head's second commit: the large file, the lockfile and the binary.
second_change() {
  mkdir -p "$work/data"
  awk 'BEGIN { for (i = 1; i <= 5001; i++) printf "%05d %d\n", i, (i * 7919) % 10007 }' \
    >"$work/data/numbers.txt"
  put pnpm-lock.yaml <<'EOF'
lockfileVersion: '9.0'

settings:
  autoInstallPeers: true
  excludeLinksFromLockfile: false

importers:

  .:
    dependencies:
      zod:
        specifier: 4.6.7
        version: 4.6.7

packages:

  zod@4.6.7:
    resolution: {integrity: sha512-BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB==}

snapshots:

  zod@4.6.7: {}
EOF
  mark_2 >"$work/assets/mark.png"
}

# The base's second commit.
base_moves_on() {
  put README.md <<'EOF'
# App fixture

What Lo's end-to-end tests open: a pull request with a rename, a move, a lockfile, a large file, a
binary and a deletion, pushed twice across a rebase. `testing/fixtures/app.sh` in withlo/lo makes
every commit of it.
EOF
}

# The second push's last commit.
third_change() {
  put src/parser.ts <<'EOF'
/** A line of input: its number, from 1, and its text. */
export interface Line {
  readonly number: number;
  readonly text: string;
}

/** Splits `input` into lines, on `\n` or `\r\n`. Empty input has no lines. */
export function parse(input: string): Line[] {
  if (input === '') return [];
  return input.split(/\r?\n/).map((text, index) => ({ number: index + 1, text }));
}

/** The lines of `input` that aren't blank. */
export function filled(input: string): Line[] {
  return parse(input).filter((line) => line.text.trim() !== '');
}
EOF
}

# The overview, written for the first push, as its writer left it in <folder>/overview.
overview_files() {
  mkdir -p "$overview/figures"
  {
    printf -- '---\nformat: 1\npr: %s\ncommit: %s\n---\n' "$APP_PULL" "$(g rev-parse app/head-1)"
    cat <<'EOF'

## tl;dr

The parser moves to src/parser.ts and splits on `\r\n` as well as `\n`, so a file saved on Windows
reads as the same [lines](term:line). `wrap` moves into a module of its own, and src/legacy.ts goes.

## How it works

[The parser](code:src/parser.ts) now splits on either line ending:

:::code src/parser.ts#L7-L10
:::

The formatter takes its `Line` from the new path, and passes `wrap` on from where it lives now:

:::code src/format.ts#L1-L3
:::

How a [line](term:line) is written out hasn't changed:

:::code src/format.ts#L5-L8
:::

:::figure figures/flow.svg
Input goes through parse, then format. Wrap sits in its own module, which format passes on.

- [parse](code:src/parser.ts#L8-L10)
- [format](code:src/format.ts#L6-L8)
- [wrap](code:src/text/wrap.ts#L2-L15)
- [lines](term:line)
:::

:::walkthrough From input to text
:::step src/parser.ts#L8-L10
`parse` splits the input on `\n` or `\r\n` and numbers each [line](term:line) from 1.
:::
:::step src/parser.ts#L13-L15
`filled` keeps the lines that aren't blank.
:::
:::step src/format.ts#L6-L8
`format` writes each line after its number.
:::
:::

For example:

```ts
format(parse('first\r\nsecond'));
// '1: first\n2: second'
```

## Where to look

:::tabs
:::tab Before
`wrap` sat in src/format.ts, beside `format`.
:::
:::tab After
`wrap` has src/text/wrap.ts to itself, and src/format.ts passes it on.
:::
:::

The README, which this pull request doesn't touch, says what the fixture is for:

:::code README.md#L1-L4
:::

The cache this pull request was meant to add never landed:

:::code src/cache.ts#L1-L4
:::

:::fold Why src/legacy.ts goes
Nothing imports `render` any more. Everything that did now calls `format`, as [above](#how-it-works)
shows.
:::

## How it was checked

Splitting `first\r\nsecond` gives two lines, with no `\r` left on the first.

## Glossary

- **Line**: one line of input, with its number from 1 and its text, without its line ending.
EOF
  } >"$overview/artifact.md"
  cat >"$overview/figures/flow.svg" <<'EOF'
<svg viewBox="0 0 660 132" xmlns="http://www.w3.org/2000/svg">
  <g id="parse">
    <rect x="0" y="12" width="180" height="60" rx="10" fill="var(--fig-blue-soft)" stroke="var(--fig-blue)"/>
    <text x="16" y="38" fill="var(--fig-ink)" font-weight="600">parse</text>
    <text x="16" y="58" fill="var(--fig-blue)" font-family="monospace" font-size="11">src/parser.ts</text>
  </g>
  <path d="M180 42h60" stroke="var(--fig-muted)" stroke-width="1.5"/>
  <text id="lines" x="190" y="34" fill="var(--fig-muted)" font-size="11">lines</text>
  <g id="format">
    <rect x="240" y="12" width="180" height="60" rx="10" fill="var(--fig-panel)" stroke="var(--fig-line)"/>
    <text x="256" y="38" fill="var(--fig-ink)" font-weight="600">format</text>
    <text x="256" y="58" fill="var(--fig-muted)" font-family="monospace" font-size="11">src/format.ts</text>
  </g>
  <path d="M420 42h60" stroke="var(--fig-muted)" stroke-width="1.5"/>
  <g id="wrap">
    <rect x="480" y="12" width="180" height="60" rx="10" fill="var(--fig-blue-soft)" stroke="var(--fig-blue)"/>
    <text x="496" y="38" fill="var(--fig-ink)" font-weight="600">wrap</text>
    <text x="496" y="58" fill="var(--fig-blue)" font-family="monospace" font-size="11">src/text/wrap.ts</text>
  </g>
  <text x="0" y="112" fill="var(--fig-muted)" font-size="12">Input becomes lines, then text. Wrap is passed on, not called.</text>
</svg>
EOF
}

# Writes the overview as `lo-overview commit` writes it, and prints the commit's ID: a blob of each
# file, a tree of `artifact.md` and `figures/`, and a commit of that tree with no parent.
overview_commit() {
  local artifact flow figures tree
  artifact=$(g hash-object -w --no-filters "$overview/artifact.md")
  flow=$(g hash-object -w --no-filters "$overview/figures/flow.svg")
  figures=$(printf '100644 blob %s\tflow.svg\0' "$flow" | g mktree -z)
  tree=$(
    {
      printf '100644 blob %s\tartifact.md\0' "$artifact"
      printf '040000 tree %s\tfigures\0' "$figures"
    } | g mktree -z
  )
  GIT_AUTHOR_DATE=2026-11-11T09:30:00Z GIT_COMMITTER_DATE=2026-11-11T09:30:00Z \
    g commit-tree "$tree" -m "Overview of pull request #$APP_PULL"
}

mkdir -p "$work"
git init -q -b app/base-1 "$work"

base_files
commit 'Start the app fixture' 2026-11-11T09:00:00Z 2026-11-11T09:00:00Z

g switch -q -c app/head-1
first_change
commit 'Rename the parser, move wrap into its own module, and drop legacy.ts' \
  2026-11-11T09:10:00Z 2026-11-11T09:10:00Z
second_change
commit 'Add the numbers, update zod in the lockfile, and redraw the mark' \
  2026-11-11T09:20:00Z 2026-11-11T09:20:00Z

g switch -q -c app/base app/base-1
base_moves_on
commit 'Say where the fixture comes from' 2026-11-11T10:00:00Z 2026-11-11T10:00:00Z

# The first push's two commits rebased onto the moved base, then one more commit.
g switch -q -c app/head app/base
first_change
commit 'Rename the parser, move wrap into its own module, and drop legacy.ts' \
  2026-11-11T09:10:00Z 2026-11-11T10:10:00Z
second_change
commit 'Add the numbers, update zod in the lockfile, and redraw the mark' \
  2026-11-11T09:20:00Z 2026-11-11T10:11:00Z
third_change
commit 'Read empty input as no lines' 2026-11-11T10:20:00Z 2026-11-11T10:20:00Z

overview_files
overview_id=$(overview_commit)

mkdir -p "$(dirname "$bare")"
git init -q --bare "$bare"
git -C "$bare" config uploadpack.allowFilter true
git -C "$bare" config uploadpack.allowAnySHA1InWant true
git -C "$bare" config gc.auto 0
g push -q "$bare" \
  app/base:refs/heads/app/base \
  app/head:refs/heads/app/feature \
  "app/head:refs/pull/$APP_PULL/head" \
  "$overview_id:refs/lo/pr/$APP_PULL"
if $first_push; then
  g push -q "$bare" app/head-1:refs/fixture/first-push
fi
