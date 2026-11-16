#!/usr/bin/env bash
# The pull requests the code features are tried on, in GitHub's rozed-dev/e2e test repository:
# `code/feature` into `code/base`, and the same changes from rozed-bot's fork of it, `code/fork`.
#
#   LO_FIXTURE_TOKEN_FILE=<file holding rozed-bot's token> bash testing/fixtures/code.sh
#   bash testing/fixtures/code.sh --local <folder>
#
# The first makes the commits and, as rozed-bot, pushes them (replacing any branch of those names in
# rozed-dev/e2e and the fork), opens the two pull requests if they aren't open, and prints their
# numbers. Run again, it puts the branches and the pull requests' titles and descriptions back, and
# opens one that was closed. It checks the token's account first and writes nowhere but those two
# repositories. `code-reset.sh` also deletes what a test wrote on them.
#
# The second reads no network and needs no token. It refuses a <folder> inside a git work tree,
# whose tools would load what it builds, and makes, in <folder>:
#
# - `rozed-dev/e2e.git`, a bare repository holding what GitHub holds for the pull requests, commit
#   for commit: `code/base`, `code/feature`, and `code/fork`, the same commit as `code/feature`, and
#   each head again as `refs/pull/<number>/head`. It lets clients filter and fetch any commit by ID,
#   as GitHub does, so Lo can fetch from it with `LO_GIT_REMOTE=file://<folder>`;
# - `work`, a working copy with `code/base` and `code/feature`.
#
# Every commit has fixed names, dates and contents, so it comes out with the same ID on any machine,
# with any git.
#
# The pull requests have a small project in each language Lo has a syntax index for, from
# `testing/fixtures/code/`: TypeScript, JavaScript, Python, Rust, Go, Terraform, Java, Kotlin, C#,
# Ruby, PHP, Swift and Elixir. Each counts and summarizes words: its `words` file defines
# `countWords` and `Tally`, its `report` file calls them, and `main` runs the report. `cases.json`
# there says where to ask about `countWords` in each, and where its definition is. The pull request:
#
# - adds `report` and `main` to every project but TypeScript and Python, so each call of
#   `countWords` is in a file it adds and its definition is in `words`, which it doesn't change:
#   `gd` goes to `words`, which is the same on both sides, and `gr` finds the uses in the files it
#   adds;
# - changes `report` in TypeScript and Python, which had the `wrap` function in them, by moving it
#   to `layout`, a file it adds, and by summarizing the most common word. `wrap` is the moved code,
#   so `gm` goes from `typescript/src/layout.ts` to `typescript/src/report.ts` and back, and from
#   `python/sample/layout.py` to `python/sample/report.py`. They add `main`;
# - changes Rust's `lib.rs`, to declare the module `report` it adds.
#
# The pull request from the fork, `rozed-bot:code/fork`, is the same commit, so a reader trusts it
# with "Trust this PR", and not by trusting the repository.

# `scratch`, `work` and `pull` are set by code-lib.sh's functions and by `main`.
# shellcheck disable=SC2154

set -euo pipefail

# The pull requests' numbers on GitHub: the one across the repository, and the one from the fork.
CODE_PULL=98
CODE_FORK_PULL=99

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=testing/fixtures/code-lib.sh
. "$here/code-lib.sh"
# The sample projects: the head of the pull request.
samples=$here/code

# The files the pull request adds. Every other file of a sample project is in the base too.
added=(
  typescript/src/layout.ts typescript/src/main.ts
  javascript/src/report.js javascript/src/main.js
  python/sample/layout.py python/sample/main.py
  rust/src/report.rs rust/src/main.rs
  go/report.go go/main.go
  terraform/main.tf terraform/outputs.tf
  java/src/main/java/sample/Report.java java/src/main/java/sample/Main.java
  kotlin/src/main/kotlin/sample/Report.kt kotlin/src/main/kotlin/sample/Main.kt
  csharp/Report.cs csharp/Program.cs
  ruby/lib/report.rb ruby/main.rb
  php/src/Report.php php/main.php
  swift/Sources/Sample/Report.swift swift/Sources/Sample/main.swift
  elixir/lib/report.ex
)

CODE_TITLE='Code fixture: count and summarize words'
# (read, not a command substitution: macOS's bash 3.2 can't parse an apostrophe in its heredoc.)
IFS= read -r -d '' CODE_BODY <<'EOF' || true
**A test fixture for Lo's code features, not code to merge.** `testing/fixtures/code.sh` in withlo/lo makes every commit of it.

A small project in each language Lo has a syntax index for: TypeScript, JavaScript, Python, Rust, Go, Terraform, Java, Kotlin, C#, Ruby, PHP, Swift and Elixir. Each counts and summarizes words: `words` defines `countWords` and `Tally`, `report` calls them, and `main` runs the report.

- Every project has a `report` and a `main`, which this pull request adds, except TypeScript's and Python's `report`, which it changes. Their calls of `countWords` have its definition in `words`, which it doesn't touch.
- TypeScript and Python move `wrap` from `report` to a new `layout` file, which is moved code to go between.
- Rust's `lib.rs` declares the `report` module.

`rozed-bot:code/fork` has the same changes, as a pull request from a fork.
EOF
FORK_TITLE='Code fixture: from a fork'
IFS= read -r -d '' FORK_BODY <<'EOF' || true
**A test fixture for Lo's code features, not code to merge.** `testing/fixtures/code.sh` in withlo/lo makes every commit of it.

The code fixture's changes, from rozed-bot/e2e, a fork, for Lo's tests of trusting a pull request from a fork. Its head is the same commit as `code/feature`'s.
EOF

# Makes `code/base` and `code/feature` in the working copy, `work`, from the sample projects.
build_code() {
  local dir file
  rm -rf "$work"
  mkdir -p "$work"
  git init -q -b code/base "$work"

  put README.md <<'EOF'
# Code fixture

What Lo's code features are tried on: a small project in each language it has a syntax index for,
counting and summarizing words. A pull request adds a report and a main to each, and moves a
function from one file to another in TypeScript and Python.
`testing/fixtures/code.sh` in withlo/lo makes every commit of it.
EOF

  # The base is the projects without what the pull request adds, and with the three files it
  # changes as they were.
  for dir in "$samples"/*/; do cp -R "${dir%/}" "$work/"; done
  for file in "${added[@]}"; do rm "$work/$file"; done
  put typescript/src/report.ts <<'EOF'
import { countWords } from './words.ts';

/** Splits `text` into lines of at most `width` characters, breaking between words. */
function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
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

/** A summary of `text`: how many words it has. */
export function summarize(text: string): string {
  return `${countWords(text)} words`;
}

/** The summary of `text`, wrapped to lines of at most `width` characters. */
export function report(text: string, width: number): string[] {
  return wrap(summarize(text), width);
}
EOF
  put python/sample/report.py <<'EOF'
"""Summaries of a text."""

from __future__ import annotations

from .words import count_words


def wrap(text: str, width: int) -> list[str]:
    """Split `text` into lines of at most `width` characters, breaking between words."""
    lines: list[str] = []
    line = ""
    for word in text.split():
        if line != "" and len(line) + 1 + len(word) > width:
            lines.append(line)
            line = word
        else:
            line = word if line == "" else f"{line} {word}"
    if line != "":
        lines.append(line)
    return lines


def summarize(text: str) -> str:
    """Summarize `text`: how many words it has."""
    return f"{count_words(text)} words"


def report(text: str, width: int) -> list[str]:
    """The summary of `text`, wrapped to lines of at most `width` characters."""
    return wrap(summarize(text), width)
EOF
  put rust/src/lib.rs <<'EOF'
//! A small project for Lo's code features: counting and summarizing words.

pub mod words;
EOF
  commit 'Start the code fixture' 2026-11-15T09:00:00Z

  # The pull request: the sample projects as they are.
  g switch -q -c code/feature
  for dir in "$samples"/*/; do cp -R "${dir%/}" "$work/"; done
  commit 'Count and summarize words' 2026-11-15T09:10:00Z
}

# Pushes the branches, and opens the pull requests. Sets `code_pull` and `fork_pull`.
publish_code() {
  ensure_fork
  reopen_pull code/feature code/base
  reopen_pull "${FORK_REPO%%/*}:code/fork" code/base
  push_to "$E2E_REPO" code/base:refs/heads/code/base code/feature:refs/heads/code/feature
  push_to "$FORK_REPO" code/feature:refs/heads/code/fork
  ensure_pull code/feature code/base "$CODE_TITLE" "$CODE_BODY"
  code_pull=$pull
  ensure_pull "${FORK_REPO%%/*}:code/fork" code/base "$FORK_TITLE" "$FORK_BODY"
  fork_pull=$pull
  expect_pull "$code_pull" "$CODE_PULL" CODE_PULL
  expect_pull "$fork_pull" "$CODE_FORK_PULL" CODE_FORK_PULL
}

main() {
  local folder
  case ${1-} in
    '')
      code_setup
      work=$scratch/work
      code_login code.sh
      build_code
      publish_code
      echo "the code fixture is $E2E_REPO#$code_pull, and from the fork $E2E_REPO#$fork_pull"
      ;;
    --local)
      folder=${2:?usage: bash testing/fixtures/code.sh --local <folder>}
      check_local_folder code.sh "$folder"
      mkdir -p "$folder"
      folder=$(cd "$folder" && pwd)
      code_setup
      work=$folder/work
      build_code
      make_bare "$folder/$E2E_REPO.git" \
        code/base:refs/heads/code/base \
        code/feature:refs/heads/code/feature \
        code/feature:refs/heads/code/fork \
        "code/feature:refs/pull/$CODE_PULL/head" \
        "code/feature:refs/pull/$CODE_FORK_PULL/head"
      ;;
    *)
      echo "usage: bash testing/fixtures/code.sh [--local <folder>]" >&2
      exit 2
      ;;
  esac
}

# Run, unless another script sources this one for `build_code` and `publish_code`.
if [ "${BASH_SOURCE[0]}" = "$0" ]; then main "$@"; fi
