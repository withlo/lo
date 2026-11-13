#!/usr/bin/env bash
# The stacks the app's end-to-end tests open, in GitHub's rozed-dev/e2e test repository: open pull
# requests that sit on each other by base branch, by shared commits and as a GitHub stack, and one
# on a pull request that was squash-merged.
#
#   bash testing/fixtures/stack.sh <folder>
#
# makes, in <folder>:
#
# - `rozed-dev/e2e.git`, a bare repository holding what GitHub holds for the pull requests, commit
#   for commit: each branch as it is now, each head again as `refs/pull/<number>/head`, and #B's
#   overview at `refs/lo/pr/<B>`. It lets clients filter and fetch any commit by ID, as GitHub
#   does, so Lo can fetch from it with `LO_GIT_REMOTE=file://<folder>`;
# - `work`, a working copy with every branch;
# - `overview`, #B's overview as its writer left it: `artifact.md`. The bare repository holds it as
#   GitHub does: one commit of exactly that file, as `lo-overview commit` wrote it.
#
# Nothing here reads the network. Every commit has fixed names, dates and contents, so it comes out
# with the ID GitHub has for it, on any machine, with any git. The pull requests, each from and into
# branches of their own:
#
# - `stack/root`, a branch no pull request comes from, and nothing protects;
# - #A, `stack/a` into `stack/root`;
# - #B, `stack/b` into `stack/a`: on #A by its base branch;
# - #C, `stack/c` into `stack/root`, cut from #B's head with one more commit: on #B by the commits
#   they share. Making #A, #B and #C a GitHub stack changes its base branch to `stack/b`;
# - #D, `stack/d` into `stack/a`, opened after #B: a second layer on #A, so the stack branches;
# - #M, `stack/m` into `stack/mroot`, squash-merged, and #E, `stack/e` into `stack/m`, cut from #M's
#   head: #E still carries #M's commits, so it needs a rebase. GitHub's squash commit on
#   `stack/mroot` has a date no script can know, so `stack/mroot` is here as it was before the
#   merge, and no test fetches it;
# - #G1, `stack/g1` into `stack/root`, and #G2, `stack/g2` into `stack/g1`, which rozed-bot made a
#   GitHub stack.
#
# rozed-bot pushed every branch, opened the pull requests in this order, made #G1 and #G2 a GitHub
# stack, squash-merged #M, and pushed #B's overview, which `lo-overview commit` wrote from
# `overview` in `work`. `stack-reset.sh` puts back what making a GitHub stack of #A, #B and #C
# changes.

set -euo pipefail

# The pull requests' numbers on GitHub.
STACK_A=82
STACK_B=83
STACK_C=84
STACK_D=85
STACK_M=86
STACK_E=87
STACK_G1=88
STACK_G2=89

folder=${1:?usage: bash testing/fixtures/stack.sh <folder>}
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

# Commits everything in the working copy as written and committed at <date>.
commit() {
  g add -A
  GIT_AUTHOR_DATE=$2 GIT_COMMITTER_DATE=$2 g commit -q -m "$1"
}

mkdir -p "$work"
git init -q -b stack/root "$work"

put README.md <<'EOF'
# Stack fixture

What Lo's end-to-end tests open as stacks: pull requests that sit on each other by base branch, by
shared commits and as a GitHub stack, and one on a pull request that was squash-merged.
`testing/fixtures/stack.sh` in withlo/lo makes every commit of them.
EOF
put src/limits.ts <<'EOF'
/** How much of GitHub's rate limit a client may spend in an hour. */
export interface Limit {
  readonly points: number;
}

/** The limit every client gets. */
export const DEFAULT_LIMIT: Limit = { points: 5000 };
EOF
commit 'Start the stack fixture' 2026-11-13T09:00:00Z

# #A: plans and their limits.
g switch -q -c stack/a
put src/plans.ts <<'EOF'
import { DEFAULT_LIMIT, type Limit } from './limits.ts';

/** Each plan's limit, by the plan's name. */
const PLANS: Readonly<Record<string, Limit>> = {
  free: DEFAULT_LIMIT,
  team: { points: 15000 },
};

/** The limit of the plan named `name`, or the default for a plan Lo doesn't know. */
export function limitOf(name: string): Limit {
  return Object.hasOwn(PLANS, name) ? (PLANS[name] ?? DEFAULT_LIMIT) : DEFAULT_LIMIT;
}
EOF
commit 'Load per-plan limits' 2026-11-13T09:10:00Z

# #B: on #A, by its base branch.
g switch -q -c stack/b
put src/cost.ts <<'EOF'
import type { Limit } from './limits.ts';

/** What GitHub charges for a query: one point for each 100 nodes it may read, at least one. */
export function costOf(nodes: number): number {
  return Math.max(1, Math.ceil(nodes / 100));
}

/** Whether a query of `nodes` fits in what's left of `limit` after `spent` points. */
export function fits(limit: Limit, spent: number, nodes: number): boolean {
  return spent + costOf(nodes) <= limit.points;
}
EOF
commit 'Rate limit GraphQL queries by cost' 2026-11-13T09:20:00Z

# #C: #B's commits and one more, into the root, so only the commits they share link them.
g switch -q -c stack/c
put src/nodes.ts <<'EOF'
/** How many nodes a connection of `first` items, each with `inner` items of its own, may read. */
export function nodesOf(first: number, inner = 0): number {
  return first + first * inner;
}
EOF
commit "Count a query's nodes" 2026-11-13T09:30:00Z

# #D: a second layer on #A.
g switch -q -c stack/d stack/a
put src/log.ts <<'EOF'
import type { Limit } from './limits.ts';

/** The line logged when a client reaches its plan's limit. */
export function limitReached(plan: string, limit: Limit): string {
  return `${plan} reached its limit of ${limit.points} points`;
}
EOF
commit "Log when a plan's limit is reached" 2026-11-13T09:40:00Z

# #M, squash-merged into `stack/mroot`, and #E on it.
g branch stack/mroot stack/root
g switch -q -c stack/m stack/mroot
put src/cache.ts <<'EOF'
/** Plans read lately, by the plan's name. */
const cached = new Map<string, number>();

/** Keeps the limit read for the plan named `name`. */
export function keep(name: string, points: number): void {
  cached.set(name, points);
}
EOF
commit 'Cache the plans' 2026-11-13T09:50:00Z
put src/cache.ts <<'EOF'
/** Plans read lately, by the plan's name. */
const cached = new Map<string, number>();

/** Keeps the limit read for the plan named `name`. */
export function keep(name: string, points: number): void {
  cached.set(name, points);
}

/** The limit kept for the plan named `name`, if any. */
export function kept(name: string): number | undefined {
  return cached.get(name);
}
EOF
commit 'Read the cached plans' 2026-11-13T09:55:00Z

g switch -q -c stack/e
put src/cache.ts <<'EOF'
/** Plans read lately, by the plan's name, with when each was read. */
const cached = new Map<string, { points: number; at: number }>();

/** How long a plan is kept, in milliseconds. */
const KEPT_FOR = 60_000;

/** Keeps the limit read for the plan named `name`, at `at`. */
export function keep(name: string, points: number, at: number): void {
  cached.set(name, { points, at });
}

/** The limit kept for the plan named `name`, unless it was read too long before `now`. */
export function kept(name: string, now: number): number | undefined {
  const plan = cached.get(name);
  return plan !== undefined && now - plan.at < KEPT_FOR ? plan.points : undefined;
}
EOF
commit 'Expire cached plans' 2026-11-13T10:00:00Z

# #G1 and #G2, a GitHub stack.
g switch -q -c stack/g1 stack/root
put src/retry.ts <<'EOF'
/** Runs `attempt` until it succeeds, at most `times` times, and throws its last error. */
export async function retry<T>(attempt: () => Promise<T>, times: number): Promise<T> {
  let last: unknown;
  for (let tried = 0; tried < times; tried++) {
    try {
      return await attempt();
    } catch (error) {
      last = error;
    }
  }
  throw last;
}
EOF
commit 'Add a retry helper' 2026-11-13T10:10:00Z

g switch -q -c stack/g2
put src/reads.ts <<'EOF'
import { retry } from './retry.ts';

/** Reads `path`, trying three times when a read times out. */
export function read(path: string, fetch: (path: string) => Promise<string>): Promise<string> {
  return retry(() => fetch(path), 3);
}
EOF
commit 'Retry reads that time out' 2026-11-13T10:20:00Z

# #B's overview, as its writer left it.
mkdir -p "$overview"
{
  printf -- '---\nformat: 1\npr: %s\ncommit: %s\n---\n' "$STACK_B" "$(g rev-parse stack/b)"
  cat <<'EOF'

## tl;dr

Each GraphQL query is charged what GitHub charges for it, so a client stays within its plan's limit
by the points its queries cost rather than by how many it sends.

## How it works

[`costOf`](code:src/cost.ts#L4-L6) charges a point for each 100 nodes a query may read:

:::code src/cost.ts#L3-L6
:::

[`fits`](code:src/cost.ts#L9-L11) says whether a query fits in what's left of the limit.

## How it was checked

A query of 250 nodes costs 3 points, and one of no nodes costs 1.
EOF
} >"$overview/artifact.md"

# Writes the overview as `lo-overview commit` wrote it, and prints the commit's ID: a blob of
# `artifact.md`, a tree of it, and a commit of that tree with no parent.
overview_commit() {
  local artifact tree
  artifact=$(g hash-object -w --no-filters "$overview/artifact.md")
  tree=$(printf '100644 blob %s\tartifact.md\0' "$artifact" | g mktree -z)
  GIT_AUTHOR_DATE=2026-11-13T10:30:00Z GIT_COMMITTER_DATE=2026-11-13T10:30:00Z \
    g commit-tree "$tree" -m "Overview of pull request #$STACK_B"
}
overview_id=$(overview_commit)

mkdir -p "$(dirname "$bare")"
git init -q --bare "$bare"
git -C "$bare" config uploadpack.allowFilter true
git -C "$bare" config uploadpack.allowAnySHA1InWant true
git -C "$bare" config gc.auto 0
g push -q "$bare" \
  stack/root:refs/heads/stack/root \
  stack/a:refs/heads/stack/a \
  stack/b:refs/heads/stack/b \
  stack/c:refs/heads/stack/c \
  stack/d:refs/heads/stack/d \
  stack/mroot:refs/heads/stack/mroot \
  stack/m:refs/heads/stack/m \
  stack/e:refs/heads/stack/e \
  stack/g1:refs/heads/stack/g1 \
  stack/g2:refs/heads/stack/g2 \
  "stack/a:refs/pull/$STACK_A/head" \
  "stack/b:refs/pull/$STACK_B/head" \
  "stack/c:refs/pull/$STACK_C/head" \
  "stack/d:refs/pull/$STACK_D/head" \
  "stack/m:refs/pull/$STACK_M/head" \
  "stack/e:refs/pull/$STACK_E/head" \
  "stack/g1:refs/pull/$STACK_G1/head" \
  "stack/g2:refs/pull/$STACK_G2/head" \
  "$overview_id:refs/lo/pr/$STACK_B"
