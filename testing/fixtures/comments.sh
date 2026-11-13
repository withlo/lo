#!/usr/bin/env bash
# The pull requests the app's end-to-end tests read review threads on, in GitHub's rozed-dev/e2e
# test repository: #94, from `comments/feature` into `comments/base`, and #95, from
# `comments/renamed` into `comments/base`.
#
#   bash testing/fixtures/comments.sh <folder>
#
# makes, in <folder>:
#
# - `rozed-dev/e2e.git`, a bare repository holding what GitHub holds for the pull requests, commit
#   for commit: `comments/base`, `comments/feature` and `comments/renamed` as they are now, and
#   each head again as `refs/pull/<number>/head`. It lets clients filter and fetch any commit by
#   ID, as GitHub does, so Lo can fetch it with `LO_GIT_REMOTE=file://<folder>`;
# - `work`, a working copy with every commit on a branch: `comments/base`, `comments/head-1` for
#   #94's first push, `comments/head` for its second, and `comments/renamed`.
#
# Nothing here reads the network. Every commit has fixed names, dates and contents, so it comes out
# with the ID GitHub has for it, on any machine, with any git. rozed-bot pushed `comments/base`
# and `comments/head-1` to `comments/feature`, opened the pull request, wrote the threads on the
# first push, then pushed `comments/head` to `comments/feature`, a commit on top of the first, and
# wrote the rest. Every comment, the review's summary included, starts with `Fixture C:`, so
# `comments-reset.sh` can tell what a recording added.
#
# The first push adds src/backoff.ts, makes src/retry.ts use it, changes src/queue.ts in three
# hunks, and changes docs/usage.md. The second caps the backoff, which changes the line one thread
# is on, so that thread is outdated, and moves the lines below it down by three. The threads:
#
# - on the first push:
#   - src/backoff.ts, line 14 (17 since the second push), the new side: a line;
#   - src/queue.ts, lines 10 to 35, the new side: a range across two hunks;
#   - src/retry.ts, line 2, the old side: a line the pull request deletes;
#   - docs/usage.md: on the file;
#   - src/backoff.ts, line 5: resolved, with one reply;
#   - src/retry.ts, line 16, the new side: three replies;
#   - src/backoff.ts, line 2: a suggested change;
#   - src/backoff.ts, line 12 (15 since): a 2×2 PNG attached in rozed-dev/e2e;
#   - src/queue.ts, line 10: a GIF from another site, which GitHub serves through its image proxy;
#   - src/backoff.ts, line 9: on the line the second push changes, so outdated;
# - on the second push: src/backoff.ts, line 8, the new side.
#
# The pull request also has a comment on its conversation with the PNG, a review rozed-bot
# submitted as a comment with a summary, and the `fixture` label.
#
# #95 renames docs/usage.md to docs/guide.md and changes its last line, in one push. Its one thread
# is on line 5 of the base's side, which GitHub names by the file's new path, docs/guide.md. It has
# the `fixture` label too.

set -euo pipefail

# The pull requests' numbers on GitHub.
COMMENTS_PULL=94
COMMENTS_RENAME_PULL=95

folder=${1:?usage: bash testing/fixtures/comments.sh <folder>}
mkdir -p "$folder"
folder=$(cd "$folder" && pwd)
work=$folder/work
bare=$folder/rozed-dev/e2e.git
rm -rf "$work" "$bare"

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

# Commits everything in the working copy as written and committed at <date>.
commit() {
  g add -A
  GIT_AUTHOR_DATE=$2 GIT_COMMITTER_DATE=$2 g commit -q -m "$1"
}

mkdir -p "$work"
git init -q -b comments/base "$work"

put README.md <<'EOF'
# Comments fixture

What Lo's end-to-end tests read review threads on: a pull request pushed twice, with threads on
lines, a range, the old side, a file, and some resolved, outdated, suggested or with images.
`testing/fixtures/comments.sh` in withlo/lo makes every commit of it.
EOF
put src/queue.ts <<'EOF'
/** A job the queue runs: a name, and the work itself. */
export interface Job {
  readonly name: string;
  readonly run: () => Promise<void>;
}

/** How many jobs run at once. */
const CONCURRENCY = 2;

/** Jobs waiting their turn, first in first out. */
const waiting: Job[] = [];

/** How many jobs are running now. */
let running = 0;

/** Adds a job to the end of the queue, and starts it if there's room. */
export function enqueue(job: Job): void {
  waiting.push(job);
  next();
}

/** How many jobs wait their turn. */
export function size(): number {
  return waiting.length;
}

/** Starts the next job, if one waits and there's room. */
function next(): void {
  if (running >= CONCURRENCY) return;
  const job = waiting.shift();
  if (job === undefined) return;
  running += 1;
  void job.run().finally(() => {
    running -= 1;
    next();
  });
}
EOF
put src/retry.ts <<'EOF'
/** How long to wait between tries, in milliseconds. */
const DELAY = 1000;

/** Waits `ms` milliseconds. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Runs `attempt` until it succeeds, at most `times` times, and throws its last error. */
export async function retry(attempt: () => Promise<void>, times = 3): Promise<void> {
  let last: unknown;
  for (let tried = 0; tried < times; tried++) {
    try {
      return await attempt();
    } catch (error) {
      last = error;
      await sleep(DELAY);
    }
  }
  throw last;
}
EOF
put docs/usage.md <<'EOF'
# Usage

Add a job with `enqueue`. Two jobs run at once, and the rest wait their turn.

A job that fails is tried again, up to three times, a second apart.
EOF
commit 'Start the comments fixture' 2026-11-13T12:00:00Z

# The first push: back off between retries.
g switch -q -c comments/head-1
put src/backoff.ts <<'EOF'
/** The first wait between tries, in milliseconds. */
const FIRST = 250;

/** How much longer each wait is than the one before. */
const FACTOR = 2;

/** How long to wait after try `tried`, counted from 0: longer each time. */
export function delayFor(tried: number): number {
  return FIRST * FACTOR ** tried;
}

/** A wait of up to `delay` milliseconds, at random, so clients that failed together retry apart. */
export function jittered(delay: number, random = Math.random): number {
  return Math.floor(delay * random());
}
EOF
put src/retry.ts <<'EOF'
import { delayFor, jittered } from './backoff.ts';

/** Waits `ms` milliseconds. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Runs `attempt` until it succeeds, at most `times` times, and throws its last error. */
export async function retry(attempt: () => Promise<void>, times = 3): Promise<void> {
  let last: unknown;
  for (let tried = 0; tried < times; tried++) {
    try {
      return await attempt();
    } catch (error) {
      last = error;
      await sleep(jittered(delayFor(tried)));
    }
  }
  throw last;
}
EOF
put src/queue.ts <<'EOF'
import { retry } from './retry.ts';

/** A job the queue runs: a name, and the work itself. */
export interface Job {
  readonly name: string;
  readonly run: () => Promise<void>;
}

/** How many jobs run at once. */
const CONCURRENCY = 4;

/** Jobs waiting their turn, first in first out. */
const waiting: Job[] = [];

/** How many jobs are running now. */
let running = 0;

/** Adds a job to the end of the queue, and starts it if there's room. */
export function enqueue(job: Job): void {
  waiting.push(job);
  next();
}

/** How many jobs wait their turn. */
export function size(): number {
  return waiting.length;
}

/** Starts the next job, if one waits and there's room. */
function next(): void {
  if (running >= CONCURRENCY) return;
  const job = waiting.shift();
  if (job === undefined) return;
  running += 1;
  void retry(job.run).finally(() => {
    running -= 1;
    next();
  });
}
EOF
put docs/usage.md <<'EOF'
# Usage

Add a job with `enqueue`. Four jobs run at once, and the rest wait their turn.

A job that fails is tried again, up to three times, a second apart.
EOF
commit 'Back off between retries' 2026-11-13T12:10:00Z

# The second push: cap the backoff.
g switch -q -c comments/head
put src/backoff.ts <<'EOF'
/** The first wait between tries, in milliseconds. */
const FIRST = 250;

/** How much longer each wait is than the one before. */
const FACTOR = 2;

/** The longest wait, in milliseconds. */
const MOST = 30_000;

/** How long to wait after try `tried`, counted from 0: longer each time, up to `MOST`. */
export function delayFor(tried: number): number {
  return Math.min(MOST, FIRST * FACTOR ** tried);
}

/** A wait of up to `delay` milliseconds, at random, so clients that failed together retry apart. */
export function jittered(delay: number, random = Math.random): number {
  return Math.floor(delay * random());
}
EOF
commit 'Cap the backoff' 2026-11-13T12:20:00Z

# The second pull request: rename the usage notes, changing their last line.
g switch -q -c comments/renamed comments/base
rm "$work/docs/usage.md"
put docs/guide.md <<'EOF'
# Usage

Add a job with `enqueue`. Two jobs run at once, and the rest wait their turn.

A job that fails is tried again, up to three times, with a longer wait each time.
EOF
commit 'Rename the usage notes' 2026-11-13T12:30:00Z

mkdir -p "$(dirname "$bare")"
git init -q --bare "$bare"
git -C "$bare" config uploadpack.allowFilter true
git -C "$bare" config uploadpack.allowAnySHA1InWant true
git -C "$bare" config gc.auto 0
g push -q "$bare" \
  comments/base:refs/heads/comments/base \
  comments/head:refs/heads/comments/feature \
  "comments/head:refs/pull/$COMMENTS_PULL/head" \
  comments/renamed:refs/heads/comments/renamed \
  "comments/renamed:refs/pull/$COMMENTS_RENAME_PULL/head"
