#!/usr/bin/env bash
# The pull requests the merging features are tried on, in GitHub's rozed-dev/e2e test repository:
# ready ones, one that conflicts, a draft, a GitHub stack, a chain, ones that wait for checks, an
# approval or a code owner, ones that join a merge queue, and one an admin may merge past a rule.
#
#   LO_FIXTURE_TOKEN_FILE=<file holding rozed-bot's token> bash testing/fixtures/merge.sh <generation>
#   LO_FIXTURE_TOKEN_FILE=<file holding rozed-bot's token> bash testing/fixtures/merge.sh <generation> --push
#   LO_FIXTURE_TOKEN_FILE=<file holding rozed-bot's token> bash testing/fixtures/merge.sh <generation> --check
#   bash testing/fixtures/merge.sh --local <folder> <generation> [--push]
#
# A merge can't be undone, so the pull requests come in numbered generations, and a recording or a
# check that merges some uses up what it merged. Make the next generation for another, and never
# use one up that something else is still reading. A generation's pull requests are titled
# `Fixture M<generation>: ...`.
#
# Given a generation, it makes the commits and, as rozed-bot, pushes them and opens the pull
# requests, a GitHub stack of two of them and the one ruleset below if the repository lacks it, and
# prints their numbers. It writes only to rozed-dev/e2e, and only once GET /user says the token is
# rozed-bot's. It reads before it writes, and stops unless everything is as it expects (`--check`
# stops after these reads):
#
# - the repository: rozed-bot is an admin of it, `main` is its default branch, merge commits,
#   squashes and rebases are all allowed, and "Automatically delete head branches" is off (with it
#   on, GitHub moves a chain's upper layer itself when the layer below merges, and a merged pull
#   request's branch is gone);
# - the `ci` workflow, which `main` has and which is active;
# - the rulesets: E4's two, "E4 gated" and "E4 queued", as they were recorded, and this one's, which
#   it makes if the repository has no ruleset of its name, below. Any other ruleset stops it;
# - `e4/gated` and `e4/queued`, which hold the commit the pull requests into them are cut from.
#
# It says whether "Allow auto-merge" is on, which a repository's owner turns on and it never does.
#
# It disturbs nothing else. Every file it adds is under `merge/<generation>/`, so a merge into
# `e4/gated` or `e4/queued` never makes another fixture's pull request conflict, and each
# generation's commits differ from the last, since the generation is in their contents. It only
# makes branches under `merge/<generation>/`: it never replaces or deletes a branch, so a merged
# pull request's branch stays, and a branch that isn't as it makes it, or a pull request that was
# closed or merged, is said and left alone. It never touches `main`, `code/*`, rozed-bot's fork or
# another fixture's branches or pull requests, and it never changes E4's rulesets. Run again for a
# generation, it adds only what's missing.
#
# The pull requests, on `merge/<generation>/base` (which no ruleset covers) unless it says:
#
# - `squash`, `merge` and `rebase`: ready, one for each way to merge, the first and last with two
#   commits;
# - `conflict`: it changes a line the base changed;
# - `draft`: a draft;
# - `stack-1` and `stack-2`: layers, `stack-2` into `stack-1`, which it makes a GitHub stack;
# - `chain-1` and `chain-2`: layers, `chain-2` into `chain-1`, which no GitHub stack holds;
# - `moved`: ready, for a merge whose head moved after it was shown. `--push` adds a commit to its
#   branch, as a push by anyone else would, once, without replacing anything;
# - `gated-failing` and `gated-passing`, into `e4/gated` (which requires `ci`, an approval, a code
#   owner's, and every conversation resolved): the first has `ci` failing and an unresolved
#   conversation, the second `ci` passing, so it waits only for an approval;
# - `queued-pass`, `queued-slow-1`, `queued-slow-2` and `queued-fail`, into `e4/queued` (which
#   requires `ci` and merges through a queue): `ci` passes, passes after ten minutes (twice), and
#   passes on the pull request and fails in the queue;
# - `overridden`, into `merge/<generation>/override`: the ruleset below requires an approval of
#   it, which rozed-bot can't give its own pull request, and lets the repository's admins bypass it.
#
# The ruleset, "Merge override", has one target: `refs/heads/merge/*/override`, so no other branch
# has a rule because of it. It requires one approving review, and the repository's admins may
# bypass it, as rozed-bot, an admin, does to merge past it. (GitHub offers an admin the merge past
# a rule only when the ruleset lets them bypass it always, not when only in a pull request.)
#
# `ci` takes its result from the `ci-result` files a pull request adds (`.github/workflows/ci.yml`
# on `main` says how): `pass`, `fail`, `slow` or `fail-in-queue`.
#
# Pull requests into `e4/gated` and `e4/queued` are cut from the commit both branches share,
# `E4_ANCESTOR` below, not from their tips, which merges move: a commit never changes, so the
# generation's commits come out with the same IDs after something merges there. GitHub made that
# commit and the ones before it, which a script can't build with their IDs, so
# `testing/fixtures/merge-e4.bundle` holds them: both branches' history as GitHub had it when
# the bundle was made, which the script unbundles, with no network, as `--local` does too.
#
# With `--local`, it reads no network and needs no token. It makes, in <folder>:
#
# - `rozed-dev/e2e.git`, a bare repository holding what GitHub holds for the generation, commit for
#   commit: its branches, and each pull request's head again as `refs/pull/<number>/head`. It lets
#   clients filter and fetch any commit by ID, as GitHub does, so Lo can fetch from it with
#   `LO_GIT_REMOTE=file://<folder>`. It's for a generation whose numbers `recorded_numbers`
#   below has. With `--push`, it has the commit that adds. A base GitHub merged into can't be
#   rebuilt with its ID, so it keeps `merge/<generation>/base` as it was before, and `e4/gated` and
#   `e4/queued` as the bundle has them: what GitHub merged into any of them since isn't there. Every
#   commit has the ID GitHub has for it, the pull requests into the E4 branches' included;
# - `work`, a working copy with every branch, and `merge/<generation>/moved-pushed`, the commit
#   `--push` adds.
#
# Every commit has fixed names, dates and contents, so it comes out with the same ID on any machine,
# with any git.

# `scratch` and `work` are set by code-lib.sh's functions and by `main`. The JavaScript is in single
# quotes so the shell leaves its `$` alone.
# shellcheck disable=SC2016,SC2154

set -euo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=testing/fixtures/code-lib.sh
. "$here/code-lib.sh"

# The commit `e4/gated` and `e4/queued` share, "Add the workflows E4 and E5 run": the one every pull
# request into either is cut from.
E4_ANCESTOR=1f54e3f8f371da4c4fa8a3dbdeeed241e361e9a9
# Both branches' history as GitHub has it, made with `git bundle create` (testing/README.md says
# how to make it again): the commits every pull request into them is built on.
E4_BUNDLE=$here/merge-e4.bundle
# The ruleset this fixture makes, and the only one of its kind.
OVERRIDE_RULESET='Merge override'

# The pull requests' numbers on GitHub, and the GitHub stack's, by generation: the names below, in
# the order they were opened. A generation that isn't here can be made on GitHub, which prints what
# to add, but not with `--local`.
recorded_numbers() {
  case $1 in
    1)
      cat <<'EOF'
squash=101
merge=102
rebase=103
conflict=104
draft=105
stack-1=106
stack-2=107
chain-1=108
chain-2=109
moved=110
gated-failing=111
gated-passing=112
queued-pass=113
queued-slow-1=114
queued-slow-2=115
queued-fail=116
overridden=117
stack=118
EOF
      ;;
    2)
      cat <<'EOF'
squash=119
merge=120
rebase=121
conflict=122
draft=123
stack-1=124
stack-2=125
chain-1=126
chain-2=127
moved=128
gated-failing=129
gated-passing=130
queued-pass=131
queued-slow-1=132
queued-slow-2=133
queued-fail=134
overridden=135
stack=136
EOF
      ;;
    3)
      cat <<'EOF'
squash=138
merge=139
rebase=140
conflict=141
draft=142
stack-1=143
stack-2=144
chain-1=145
chain-2=146
moved=147
gated-failing=148
gated-passing=149
queued-pass=150
queued-slow-1=151
queued-slow-2=152
queued-fail=153
overridden=154
stack=155
EOF
      ;;
    4)
      cat <<'EOF'
squash=156
merge=157
rebase=158
conflict=159
draft=160
stack-1=161
stack-2=162
chain-1=163
chain-2=164
moved=165
gated-failing=166
gated-passing=167
queued-pass=168
queued-slow-1=169
queued-slow-2=170
queued-fail=171
overridden=172
stack=173
EOF
      ;;
    *) ;;
  esac
}

# Each pull request of a generation, in the order it's opened: its name (its branch is
# `merge/<generation>/<name>`), the branch it goes into (`@` stands for `merge/<generation>`), its
# title after `Fixture M<generation>: `, and what it's for.
PULLS=(
  'squash|@/base|squash and merge|Ready to merge, for a squash. It has two commits, which GitHub lists in the squash commit.'
  'merge|@/base|merge commit|Ready to merge, for a merge commit.'
  'rebase|@/base|rebase and merge|Ready to merge, for a rebase. It has two commits, which a rebase keeps one by one.'
  'conflict|@/base|conflicts with its base|It changes line 3 of `conflict.txt`, as the base did, so GitHub says it conflicts.'
  'draft|@/base|a draft|A draft, which GitHub merges only once it is ready for review.'
  'stack-1|@/base|stack, first layer|The bottom layer of a GitHub stack of two.'
  'stack-2|@/stack-1|stack, second layer|The top layer of a GitHub stack of two.'
  'chain-1|@/base|chain, bottom layer|The bottom layer of a chain of two that no GitHub stack holds: the next one sits on it by its base branch alone.'
  'chain-2|@/chain-1|chain, top layer|The top layer of a chain of two that no GitHub stack holds.'
  'moved|@/base|its head moves|Ready to merge. `merge.sh <generation> --push` adds a commit to it, for a merge whose head moved after it was shown.'
  'gated-failing|e4/gated|gated, checks failing and a conversation open|Into `e4/gated`: its `ci` fails, it needs an approval from a code owner, and it has an unresolved conversation.'
  'gated-passing|e4/gated|gated, waiting for an approval|Into `e4/gated`: its `ci` passes, so it waits only for an approval from a code owner.'
  'queued-pass|e4/queued|queued, passing|Into `e4/queued`, which merges through a queue: its `ci` passes.'
  'queued-slow-1|e4/queued|queued, slow (1)|Into `e4/queued`, which merges through a queue: its `ci` passes after ten minutes.'
  'queued-slow-2|e4/queued|queued, slow (2)|Into `e4/queued`, which merges through a queue: its `ci` passes after ten minutes.'
  'queued-fail|e4/queued|queued, fails in the queue|Into `e4/queued`, which merges through a queue: its `ci` passes on the pull request and fails in the queue.'
  'overridden|@/override|needs an approval an admin may skip|Into `merge/<generation>/override`, which requires an approval and lets the repository'"'"'s admins bypass it.'
)

# The ruleset's body, which a ruleset of its name on GitHub is checked against, key by key.
IFS= read -r -d '' OVERRIDE_RULESET_JSON <<'EOF' || true
{
  "name": "Merge override",
  "target": "branch",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ["refs/heads/merge/*/override"], "exclude": [] } },
  "bypass_actors": [{ "actor_id": 5, "actor_type": "RepositoryRole", "bypass_mode": "always" }],
  "rules": [
    {
      "type": "pull_request",
      "parameters": {
        "required_approving_review_count": 1,
        "dismiss_stale_reviews_on_push": false,
        "require_code_owner_review": false,
        "require_last_push_approval": false,
        "required_review_thread_resolution": false
      }
    }
  ]
}
EOF

# --- The commits ------------------------------------------------------------------------------

# Starts the branch `merge/<generation>/<name>` at <parent> and switches to it.
branch_from() { g switch -q -c "merge/$generation/$1" "$2"; }

# Writes the notes of the pull request <name>, saying <what>.
notes() {
  put "merge/$generation/$1/notes.md" <<EOF
# Fixture M$generation: $1

$2
EOF
}

# Makes the branch `merge/<generation>/<name>` from <parent>, with a `ci-result` file saying <result>
# and notes, in one commit.
ci_pull() {
  branch_from "$1" "$4"
  printf '%s\n' "$2" | put "merge/$generation/$1/ci-result"
  notes "$1" "$3"
  commit "Add the $1 pull request, whose ci says $2" 2026-11-16T09:40:00Z
}

# Makes every branch of the generation in the working copy, `work`, from fixed names, dates and
# contents. The pull requests into `e4/gated` and `e4/queued` are cut from E4_ANCESTOR, in the
# history of those branches that it unbundles into `e4/gated` and `e4/queued`.
build_merge() {
  local base=merge/$generation/base root tip e4_parent
  rm -rf "$work"
  mkdir -p "$work"
  git init -q -b "$base" "$work"

  put "merge/$generation/README.md" <<EOF
# Merge fixture $generation

What Lo's merging features are tried on: pull requests that are ready, conflict, are drafts, sit in
a stack or a chain, wait for an approval or for checks, or join a merge queue.
\`testing/fixtures/merge.sh\` in withlo/lo makes every commit of them.
EOF
  put "merge/$generation/conflict.txt" <<'EOF'
line 1
line 2
line 3
line 4
line 5
EOF
  commit "Start merge fixture $generation" 2026-11-16T09:00:00Z
  root=$(g rev-parse HEAD)
  put "merge/$generation/conflict.txt" <<'EOF'
line 1
line 2
line 3, as the base has it
line 4
line 5
EOF
  commit 'Change line 3 of conflict.txt' 2026-11-16T09:10:00Z
  tip=$(g rev-parse HEAD)

  branch_from squash "$tip"
  notes squash 'Ready to merge, for a squash.'
  commit "Add the squash pull request's notes" 2026-11-16T09:20:00Z
  put "merge/$generation/squash/more.md" <<'EOF'
# More

A second commit, so GitHub's squash commit lists two.
EOF
  commit 'Add what a second commit says' 2026-11-16T09:21:00Z

  branch_from merge "$tip"
  notes merge 'Ready to merge, for a merge commit.'
  commit "Add the merge pull request's notes" 2026-11-16T09:20:00Z

  branch_from rebase "$tip"
  notes rebase 'Ready to merge, for a rebase.'
  commit "Add the rebase pull request's notes" 2026-11-16T09:20:00Z
  put "merge/$generation/rebase/more.md" <<'EOF'
# More

A second commit, which a rebase puts on the base after the first.
EOF
  commit 'Add what a second commit says' 2026-11-16T09:21:00Z

  # Cut from the base's first commit, so it changes line 3 of the file the base's second changed.
  branch_from conflict "$root"
  put "merge/$generation/conflict.txt" <<'EOF'
line 1
line 2
line 3, as the pull request has it
line 4
line 5
EOF
  notes conflict 'It changes line 3 of conflict.txt, which the base changed too.'
  commit 'Change line 3 of conflict.txt' 2026-11-16T09:20:00Z

  branch_from draft "$tip"
  notes draft 'A draft.'
  commit "Add the draft pull request's notes" 2026-11-16T09:20:00Z

  branch_from stack-1 "$tip"
  notes stack-1 'The bottom layer of a GitHub stack of two.'
  commit "Add the stack's first layer" 2026-11-16T09:20:00Z
  branch_from stack-2 "merge/$generation/stack-1"
  notes stack-2 'The top layer of a GitHub stack of two.'
  commit "Add the stack's second layer" 2026-11-16T09:30:00Z

  branch_from chain-1 "$tip"
  notes chain-1 "The bottom layer of a chain of two, which no GitHub stack holds."
  commit "Add the chain's bottom layer" 2026-11-16T09:20:00Z
  branch_from chain-2 "merge/$generation/chain-1"
  notes chain-2 "The top layer of a chain of two, which no GitHub stack holds."
  commit "Add the chain's top layer" 2026-11-16T09:30:00Z

  branch_from moved "$tip"
  notes moved 'Ready to merge. A push after it was opened adds pushed.md.'
  commit "Add the moved pull request's notes" 2026-11-16T09:20:00Z
  # What `--push` adds, on a branch of its own that only `--push` publishes.
  branch_from moved-pushed "merge/$generation/moved"
  put "merge/$generation/moved/pushed.md" <<'EOF'
# Pushed

A commit pushed after the pull request was opened, as anyone with write access may.
EOF
  commit 'Add what a later push says' 2026-11-16T10:00:00Z

  # The pull requests into `e4/gated` and `e4/queued`, on the history GitHub made.
  g fetch -q --no-tags "$E4_BUNDLE" +refs/heads/e4/gated:refs/heads/e4/gated \
    +refs/heads/e4/queued:refs/heads/e4/queued
  e4_parent=$(g rev-parse "$E4_ANCESTOR^{commit}")
  if [ "$e4_parent" != "$E4_ANCESTOR" ]; then
    echo "merge.sh: $E4_BUNDLE doesn't hold $E4_ANCESTOR" >&2
    return 1
  fi
  ci_pull gated-failing fail 'Into e4/gated: ci fails, and a conversation on this line is open.' "$e4_parent"
  ci_pull gated-passing pass 'Into e4/gated: ci passes, so it waits only for an approval.' "$e4_parent"
  ci_pull queued-pass pass 'Into e4/queued: ci passes.' "$e4_parent"
  ci_pull queued-slow-1 slow 'Into e4/queued: ci passes after ten minutes.' "$e4_parent"
  ci_pull queued-slow-2 slow 'Into e4/queued: ci passes after ten minutes.' "$e4_parent"
  ci_pull queued-fail fail-in-queue 'Into e4/queued: ci passes here, and fails in the merge queue.' "$e4_parent"

  # The base the ruleset covers has history of its own, and the pull request into it is cut from it.
  g switch -q --orphan "merge/$generation/override"
  put "merge/$generation/override/README.md" <<EOF
# Override base $generation

The base of the pull request an admin merges past a ruleset's approval.
EOF
  commit "Start merge fixture $generation's override base" 2026-11-16T09:50:00Z
  g switch -q -c "merge/$generation/overridden"
  notes overridden 'Needs an approval, which an admin may bypass.'
  commit "Add the overridden pull request's notes" 2026-11-16T09:55:00Z
}

# --- GitHub, as rozed-bot ---------------------------------------------------------------------

# Pushes <refspec>... from the working copy to rozed-dev/e2e as they are, without replacing or
# deleting a branch: `<branch>:refs/heads/merge/<generation>/<name>`, all or none. Nothing else
# takes a push, and git is given the token by a credential helper that reads the file, so it's in
# no argument or variable.
push_new() {
  local spec helper
  for spec in "$@"; do
    case $spec in
      +*)
        echo "merge.sh: refusing to push $spec, which would replace a branch" >&2
        return 1
        ;;
      :*)
        echo "merge.sh: refusing to push $spec, which would delete a branch" >&2
        return 1
        ;;
      *:*:*)
        echo "merge.sh: refusing to push $spec" >&2
        return 1
        ;;
    esac
    case ${spec#*:} in
      *..*)
        echo "merge.sh: refusing to push to ${spec#*:}" >&2
        return 1
        ;;
      "refs/heads/merge/$generation/"*) ;;
      *)
        echo "merge.sh: refusing to push to ${spec#*:}" >&2
        return 1
        ;;
    esac
  done
  helper='!f() { test "$1" = get || exit 0; echo username=rozed-bot; printf "password=%s\n" "$(tr -d "[:space:]" <"$LO_FIXTURE_TOKEN_FILE")"; }; f'
  g -c credential.helper= -c "credential.helper=$helper" push --quiet --atomic \
    "https://github.com/$E2E_REPO.git" "$@"
}

# Reads what is wrong with the repository, and what to say of it, and stops on a problem. Every
# read is a GET.
check_repo() {
  local dir=$scratch/read id gated queued
  mkdir -p "$dir"
  api GET "/repos/$E2E_REPO" >"$dir/repo.json"
  api GET "/repos/$E2E_REPO/actions/workflows/ci.yml" >"$dir/workflow.json"
  api GET "/repos/$E2E_REPO/contents/.github/workflows/ci.yml?ref=main" >/dev/null
  api GET "/repos/$E2E_REPO/contents/.github/CODEOWNERS?ref=e4/gated" >/dev/null
  api GET "/repos/$E2E_REPO/rulesets?includes_parents=false&per_page=100" >"$dir/rulesets.json"
  mkdir -p "$dir/ruleset"
  for id in $(read_json 'json.map((ruleset) => ruleset.id).join(" ")' <"$dir/rulesets.json"); do
    api GET "/repos/$E2E_REPO/rulesets/$id" >"$dir/ruleset/$id.json"
  done
  gated=$(api GET "/repos/$E2E_REPO/git/ref/heads/e4/gated" | read_json 'json.object.sha')
  queued=$(api GET "/repos/$E2E_REPO/git/ref/heads/e4/queued" | read_json 'json.object.sha')
  api GET "/repos/$E2E_REPO/compare/$E4_ANCESTOR...$gated" >"$dir/gated.json"
  api GET "/repos/$E2E_REPO/compare/$E4_ANCESTOR...$queued" >"$dir/queued.json"
  OVERRIDE_RULESET_JSON=$OVERRIDE_RULESET_JSON E4_ANCESTOR=$E4_ANCESTOR node -e '
    const fs = require("node:fs");
    const dir = process.argv[1];
    const read = (name) => JSON.parse(fs.readFileSync(`${dir}/${name}`, "utf8"));
    const problems = [];

    /** What of `expected` is not in `actual`: every key it has, down to its arrays, which match in order. */
    function missing(expected, actual, path) {
      if (Array.isArray(expected)) {
        if (!Array.isArray(actual) || actual.length !== expected.length) return [`${path} is ${JSON.stringify(actual)}`];
        return expected.flatMap((each, at) => missing(each, actual[at], `${path}[${at}]`));
      }
      if (expected !== null && typeof expected === "object") {
        if (actual === null || typeof actual !== "object") return [`${path} is ${JSON.stringify(actual)}`];
        return Object.keys(expected).flatMap((key) => missing(expected[key], actual[key], `${path}.${key}`));
      }
      return expected === actual ? [] : [`${path} is ${JSON.stringify(actual)}, not ${JSON.stringify(expected)}`];
    }
    const sorted = (ruleset) => ({ ...ruleset, rules: [...(ruleset.rules ?? [])].sort((a, b) => a.type.localeCompare(b.type)) });
    const checkRuleset = (expected, actual) => {
      for (const line of missing(sorted(expected), sorted(actual), "")) {
        problems.push(`the ruleset ${expected.name} is not as recorded: ${line.replace(/^\./, "")}`);
      }
    };

    const repo = read("repo.json");
    if (repo.default_branch !== "main") problems.push(`the default branch is ${repo.default_branch}, not main`);
    if (!repo.permissions?.admin) problems.push("rozed-bot is not an admin of the repository");
    for (const [setting, name] of [["allow_merge_commit", "merge commits"], ["allow_squash_merge", "squashes"], ["allow_rebase_merge", "rebases"]]) {
      if (repo[setting] !== true) problems.push(`${name} are not allowed`);
    }
    if (repo.delete_branch_on_merge !== false) {
      problems.push("Automatically delete head branches is on: the repository owner turns it off in its settings");
    }
    const workflow = read("workflow.json");
    if (workflow.name !== "ci" || workflow.state !== "active") problems.push(`the ci workflow is ${workflow.name}, ${workflow.state}`);

    const pullRequest = (extra) => ({
      required_approving_review_count: 1, dismiss_stale_reviews_on_push: false, required_reviewers: [],
      require_code_owner_review: true, dismissal_restriction: { enabled: false, allowed_actors: [] },
      require_last_push_approval: false, required_review_thread_resolution: true,
      require_extra_approval_for_unattributed_changes: true, allowed_merge_methods: ["merge", "squash", "rebase"], ...extra,
    });
    const checks = { strict_required_status_checks_policy: false, do_not_enforce_on_create: false, required_status_checks: [{ context: "ci", integration_id: 15368 }] };
    const known = {
      "E4 gated": {
        name: "E4 gated", target: "branch", enforcement: "active", bypass_actors: [],
        conditions: { ref_name: { include: ["refs/heads/e4/gated"], exclude: [] } },
        rules: [{ type: "pull_request", parameters: pullRequest({}) }, { type: "required_status_checks", parameters: checks }],
      },
      "E4 queued": {
        name: "E4 queued", target: "branch", enforcement: "active", bypass_actors: [],
        conditions: { ref_name: { include: ["refs/heads/e4/queued"], exclude: [] } },
        rules: [
          { type: "merge_queue", parameters: { merge_method: "SQUASH", max_entries_to_build: 5, min_entries_to_merge: 1, max_entries_to_merge: 5, min_entries_to_merge_wait_minutes: 0, grouping_strategy: "ALLGREEN", check_response_timeout_minutes: 60 } },
          { type: "required_status_checks", parameters: checks },
        ],
      },
      [JSON.parse(process.env.OVERRIDE_RULESET_JSON).name]: JSON.parse(process.env.OVERRIDE_RULESET_JSON),
    };
    const seen = new Set();
    for (const { id } of read("rulesets.json")) {
      const actual = read(`ruleset/${id}.json`);
      seen.add(actual.name);
      if (known[actual.name] === undefined) problems.push(`the repository has a ruleset this fixture does not know: ${actual.name}`);
      else checkRuleset(known[actual.name], actual);
    }
    for (const name of ["E4 gated", "E4 queued"]) if (!seen.has(name)) problems.push(`the ruleset ${name} is missing`);

    for (const name of ["gated", "queued"]) {
      const compared = read(`${name}.json`);
      if (!["ahead", "identical"].includes(compared.status) || compared.merge_base_commit?.sha !== process.env.E4_ANCESTOR) {
        problems.push(`e4/${name} no longer holds ${process.env.E4_ANCESTOR}`);
      }
    }

    for (const problem of problems) console.error(`merge.sh: ${problem}`);
    console.log(`auto-merge is ${repo.allow_auto_merge ? "allowed" : "not allowed"} in the repository`);
    console.log(`the override ruleset ${seen.has(JSON.parse(process.env.OVERRIDE_RULESET_JSON).name) ? "is there" : "is missing, and the first run makes it"}`);
    process.exit(problems.length === 0 ? 0 : 1);' "$dir"
}

# Reads the generation's branches into `$scratch/refs`, as lines of `refs/heads/<branch> <commit>`.
read_refs() {
  api GET "/repos/$E2E_REPO/git/matching-refs/heads/merge/$generation/" |
    read_json 'json.map((ref) => `${ref.ref} ${ref.object.sha}`).join("\n")' >"$scratch/refs"
}

# Prints the commit of the branch `merge/<generation>/<name>` on GitHub, or nothing.
remote_commit() { sed -n "s#^refs/heads/merge/$generation/$1 ##p" "$scratch/refs"; }

# Appends to `to_push` the branch `merge/<generation>/<name>` if GitHub lacks it. A branch it has is
# left as it is, and it stops if that isn't as it makes it or a commit pushed after.
want_branch() {
  local name=$1 ours theirs status
  ours=$(g rev-parse "refs/heads/merge/$generation/$name")
  theirs=$(remote_commit "$name")
  if [ -z "$theirs" ]; then
    to_push+=("merge/$generation/$name:refs/heads/merge/$generation/$name")
  elif [ "$theirs" != "$ours" ]; then
    status=$(api GET "/repos/$E2E_REPO/compare/$ours...$theirs" | read_json 'json.status')
    if [ "$status" != ahead ]; then
      echo "merge.sh: merge/$generation/$name is $theirs on GitHub, which doesn't hold $ours" >&2
      return 1
    fi
    echo "merge/$generation/$name has moved on from what merge.sh makes, and is left as it is"
  fi
}

# Prints the JSON that opens a pull request: <title> <head> <base> <body> <draft>.
pull_json() {
  node -e '
    const [title, head, base, body, draft] = process.argv.slice(1);
    console.log(JSON.stringify({ title, head, base, body, draft: draft === "true" }));' "$@"
}

# Opens every pull request that isn't open yet, and writes `$scratch/pulls`, a line of `<name>
# <number> <state>` for each. A pull request that is closed or merged is said and left alone.
open_pulls() {
  local row name base title what found number state body
  : >"$scratch/pulls"
  for row in "${PULLS[@]}"; do
    IFS='|' read -r name base title what <<<"$row"
    base=${base//@/merge/$generation}
    found=$(find_pull "merge/$generation/$name")
    if [ -z "$found" ]; then
      body="**A test fixture for Lo's merge features, not code to merge.** \`testing/fixtures/merge.sh\` in withlo/lo makes every commit of it, and a generation's pull requests are used up by merging them.

${what//<generation>/$generation}"
      number=$(api POST "/repos/$E2E_REPO/pulls" \
        "$(pull_json "Fixture M$generation: $title" "merge/$generation/$name" "$base" "$body" \
          "$([ "$name" = draft ] && echo true || echo false)")" | read_json 'json.number')
      state=open
      echo "opened $E2E_REPO#$number: merge/$generation/$name into $base"
      sleep 2
    else
      number=${found% *}
      state=${found#* }
      echo "$E2E_REPO#$number is $state: merge/$generation/$name"
    fi
    if [ "$state" = open ]; then
      api POST "/repos/$E2E_REPO/issues/$number/labels" "{\"labels\":[\"$LABEL\"]}" >/dev/null
    fi
    printf '%s %s %s\n' "$name" "$number" "$state" >>"$scratch/pulls"
  done
}

# Prints the number of the pull request <name>.
pull_of() { sed -n "s/^$1 \([0-9]*\) .*/\1/p" "$scratch/pulls"; }

# Prints the state of the pull request <name>: `open`, `closed` or `merged`.
state_of() { sed -n "s/^$1 [0-9]* //p" "$scratch/pulls"; }

# Writes the one conversation `gated-failing` is blocked by: a comment on the first line of its
# notes, unless it has one.
ensure_conversation() {
  local number head found
  number=$(pull_of gated-failing)
  if [ "$(state_of gated-failing)" != open ]; then return 0; fi
  found=$(api GET "/repos/$E2E_REPO/pulls/$number/comments?per_page=100" |
    read_json "json.filter((comment) => comment.body.startsWith('Fixture M$generation:')).length")
  if [ "$found" = 0 ]; then
    head=$(api GET "/repos/$E2E_REPO/pulls/$number" | read_json 'json.head.sha')
    api POST "/repos/$E2E_REPO/pulls/$number/comments" "$(node -e '
      const [body, commit_id, path] = process.argv.slice(1);
      console.log(JSON.stringify({ body, commit_id, path, line: 1, side: "RIGHT" }));' \
      "Fixture M$generation: this conversation stays open." "$head" \
      "merge/$generation/gated-failing/notes.md")" >/dev/null
    echo "opened a conversation on $E2E_REPO#$number"
  fi
}

# Makes `stack-1` and `stack-2` a GitHub stack, unless they are one, or one of them is closed.
ensure_stack() {
  local bottom top found
  bottom=$(pull_of stack-1)
  top=$(pull_of stack-2)
  found=$(api GET "/repos/$E2E_REPO/stacks?pull_request=$bottom" |
    read_json "json.filter((stack) => stack.open && stack.pull_requests.map((pull) => pull.number).join() === '$bottom,$top').map((stack) => stack.number).join(' ')")
  if [ -n "$found" ]; then
    stack=$found
  elif [ "$(state_of stack-1)" = open ] && [ "$(state_of stack-2)" = open ]; then
    stack=$(api POST "/repos/$E2E_REPO/stacks" "{\"pull_requests\":[$bottom,$top]}" | read_json 'json.number')
    echo "made GitHub stack $E2E_REPO#$stack of #$bottom and #$top"
    return 0
  else
    stack=
    echo "$E2E_REPO#$bottom and #$top aren't both open, so they're not made a GitHub stack"
    return 0
  fi
  echo "GitHub stack $E2E_REPO#$stack holds #$bottom and #$top"
}

# Makes the ruleset that lets an admin merge `overridden`, unless the repository has it (`check_repo`
# said it's as it should be), and checks what it covers.
ensure_ruleset() {
  local found id covered bypass
  found=$(api GET "/repos/$E2E_REPO/rulesets?includes_parents=false&per_page=100" |
    read_json "json.filter((ruleset) => ruleset.name === '$OVERRIDE_RULESET').length")
  if [ "$found" = 0 ]; then
    api POST "/repos/$E2E_REPO/rulesets" "$OVERRIDE_RULESET_JSON" >/dev/null
    echo "made the ruleset $OVERRIDE_RULESET"
  fi
  id=$(api GET "/repos/$E2E_REPO/rulesets?includes_parents=false&per_page=100" |
    read_json "json.find((ruleset) => ruleset.name === '$OVERRIDE_RULESET').id")
  # The ruleset's only branch is the override base, and its rules reach no other base.
  for branch in merge/$generation/override merge/$generation/base main e4/gated e4/queued code/base; do
    covered=$(api GET "/repos/$E2E_REPO/rules/branches/${branch//\//%2F}" |
      read_json "json.filter((rule) => rule.ruleset_id === $id).length")
    case $branch in
      "merge/$generation/override") [ "$covered" != 0 ] ;;
      *) [ "$covered" = 0 ] ;;
    esac || {
      echo "merge.sh: the ruleset $OVERRIDE_RULESET covers $branch ($covered rules)" >&2
      return 1
    }
  done
  bypass=$(api GET "/repos/$E2E_REPO/rulesets/$id" | read_json 'json.current_user_can_bypass')
  echo "rozed-bot's bypass of $OVERRIDE_RULESET: $bypass"
  if [ "$bypass" = never ]; then
    echo "merge.sh: rozed-bot can't bypass $OVERRIDE_RULESET, so nobody can merge overridden's pull request past it" >&2
    return 1
  fi
}

# Pushes what GitHub lacks, opens the pull requests, the conversation, the GitHub stack and the
# ruleset. Sets `stack`.
publish_merge() {
  local row name
  read_refs
  to_push=()
  want_branch base
  for row in "${PULLS[@]}"; do
    name=${row%%|*}
    want_branch "$name"
  done
  # The override base last: the ruleset, once made, takes a branch of that name only as a commit
  # that is already on GitHub, and `overridden` is pushed first, with the commit.
  if [ -z "$(remote_commit override)" ]; then
    if [ ${#to_push[@]} -gt 0 ]; then push_new "${to_push[@]}"; fi
    push_new "merge/$generation/override:refs/heads/merge/$generation/override"
  else
    want_branch override
    if [ ${#to_push[@]} -gt 0 ]; then push_new "${to_push[@]}"; fi
  fi
  open_pulls
  ensure_conversation
  ensure_stack
  ensure_ruleset
}

# Adds the commit `--push` adds to `moved`, once.
push_moved() {
  local ours pushed theirs
  read_refs
  ours=$(g rev-parse "refs/heads/merge/$generation/moved")
  pushed=$(g rev-parse "refs/heads/merge/$generation/moved-pushed")
  theirs=$(remote_commit moved)
  if [ "$(find_pull "merge/$generation/moved" | cut -d' ' -f2)" != open ]; then
    echo "merge.sh: merge/$generation/moved's pull request isn't open" >&2
    return 1
  fi
  if [ "$theirs" = "$pushed" ]; then
    echo "merge/$generation/moved already has the commit --push adds"
  elif [ "$theirs" = "$ours" ]; then
    push_new "merge/$generation/moved-pushed:refs/heads/merge/$generation/moved"
    echo "pushed $pushed to merge/$generation/moved"
  else
    echo "merge.sh: merge/$generation/moved is $theirs, which isn't what merge.sh made or what it adds" >&2
    return 1
  fi
}

# Prints what each pull request is and where it is now, and what to record.
report() {
  local row name base number head recorded missing=false
  echo "the generation $generation of the merge fixture in $E2E_REPO:"
  for row in "${PULLS[@]}"; do
    IFS='|' read -r name base _ _ <<<"$row"
    number=$(pull_of "$name")
    head=$(api GET "/repos/$E2E_REPO/pulls/$number" | read_json 'json.head.sha')
    echo "  #$number $name: $head into ${base//@/merge/$generation} ($(state_of "$name"))"
    recorded=$(recorded_numbers "$generation" | sed -n "s/^$name=//p")
    if [ -z "$recorded" ]; then
      missing=true
    elif [ "$recorded" != "$number" ]; then
      echo "merge.sh: GitHub numbered $name $number, and recorded_numbers says $recorded" >&2
      return 1
    fi
  done
  if [ -n "${stack-}" ]; then echo "  GitHub stack #$stack"; fi
  if [ "$missing" = true ]; then
    echo "not recorded: add to recorded_numbers, under $generation, and to MERGE_PULLS in @lo/testing/git:"
    for row in "${PULLS[@]}"; do
      name=${row%%|*}
      echo "$name=$(pull_of "$name")"
    done
    echo "stack=${stack-}"
  fi
}

usage() {
  cat >&2 <<'EOF'
usage: LO_FIXTURE_TOKEN_FILE=<file> bash testing/fixtures/merge.sh <generation> [--push | --check]
       bash testing/fixtures/merge.sh --local <folder> <generation> [--push]
EOF
  exit 2
}

# Makes the bare repository for `--local`.
make_local() {
  local row name number specs=() head
  for row in "${PULLS[@]}"; do
    name=${row%%|*}
    number=$(recorded_numbers "$generation" | sed -n "s/^$name=//p")
    head=merge/$generation/$name
    if [ "$name" = moved ] && [ "$push" = true ]; then head=merge/$generation/moved-pushed; fi
    specs+=("$head:refs/heads/merge/$generation/$name" "$head:refs/pull/$number/head")
  done
  make_bare "$folder/$E2E_REPO.git" \
    "merge/$generation/base:refs/heads/merge/$generation/base" \
    "merge/$generation/override:refs/heads/merge/$generation/override" \
    e4/gated:refs/heads/e4/gated \
    e4/queued:refs/heads/e4/queued \
    "${specs[@]}"
}

main() {
  local arg
  push=false
  check=false
  folder=
  local_mode=false
  stack=
  if [ "${1-}" = --local ]; then
    [ $# -ge 3 ] || usage
    folder=$2
    local_mode=true
    shift 2
  fi
  [ $# -ge 1 ] || usage
  generation=$1
  shift
  for arg in "$@"; do
    case $arg in
      --push) push=true ;;
      --check) check=true ;;
      *) usage ;;
    esac
  done
  [[ $generation =~ ^[1-9][0-9]{0,5}$ ]] || usage
  # `--check` only reads, so it takes neither `--push` nor `--local`.
  if [ "$check" = true ] && { [ "$push" = true ] || [ "$local_mode" = true ]; }; then usage; fi

  code_setup
  if [ "$local_mode" = true ]; then
    check_local_folder merge.sh "$folder"
    if [ -z "$(recorded_numbers "$generation")" ]; then
      echo "merge.sh: the numbers of generation $generation aren't recorded" >&2
      return 1
    fi
    mkdir -p "$folder"
    folder=$(cd "$folder" && pwd)
    work=$folder/work
    build_merge
    make_local
    return 0
  fi
  work=$scratch/work
  code_login merge.sh
  check_repo
  if [ "$check" = true ]; then return 0; fi
  build_merge
  if [ "$push" = true ]; then
    push_moved
  else
    publish_merge
    report
  fi
}

# Run, unless another script sources this one.
if [ "${BASH_SOURCE[0]}" = "$0" ]; then main "$@"; fi
