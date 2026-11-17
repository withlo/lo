# `@lo/testing`

Test helpers and recorded fixtures, for tests only. Nothing that ships imports this package, and the
boundary check holds everything else to that.

## Replaying GitHub

`fixtures/github/` holds recorded GitHub responses, in folders called cassettes. Code that talks to
GitHub takes `fetch` and GitHub's addresses as parameters, so a test can answer it from a cassette
instead of the network, two ways:

- **`replayFetch(name)`**, for unit tests: a `fetch` that answers from the cassette `name`. It keeps
  every request it's sent in `.seen`, so a test can check headers and counts.
- **`serveReplay(name)`** from `@lo/testing/server`, for tests of the app, whose `fetch` can't be
  swapped out: the same replayer behind an HTTP server on `127.0.0.1` and a free port. Give the app
  `server.urls` as GitHub's API, website and uploads addresses, and `await server.close()` when the
  test ends. It serves GitHub's image hosts too, each under `/images/<host>/` (`IMAGE_HOSTS`), and
  hands their redirects back as they were recorded, for the app to read against the host.

A request is matched by its key:

- a REST request by its method and URL, with the query sorted, plus the `If-None-Match` or
  `If-Modified-Since` it sent, so only a request for the right ETag gets a recorded `304`;
- a GraphQL request by its operation's name and its variables, with their keys sorted;
- any other request with a body, such as a REST write, by a hash of the body's exact bytes. A
  recorded write matches only a body serialized exactly as it was then: compact JSON, keys in the
  same order.

Each key's responses come back in the order they were recorded, and the last one repeats, the steady
state of a poll. A request the cassette can't answer fails the test, even when the code under test
catches the error, and the message names the nearest recorded request and, for a write, the body
that was sent. The server answers such a request with a 500, and `close()` then rejects.

### When a query changes

Each recorded GraphQL request keeps `query_sha256`, a hash of its query normalized: parsed and
printed again by graphql-js, with its operations and fragments sorted by name. Comments, formatting
and the order of definitions don't change it. Anything else does, and the replay fails with
"re-record cassette X: the Y query changed since it was recorded". Record the cassette again.

Where the rest of a cassette must stay as it is, as when its tests rely on what it read of other
pull requests, record only that query's answers again, in place:

```sh
LO_FIXTURE_TOKEN_FILE=<file holding rozed-bot's token> \
  node testing/scripts/rerecord.ts <query's .graphql file> <cassette>[/<file>] ...
```

Each of the query's recorded requests is sent again with its recorded variables, or only the files
named, and GitHub's answer replaces the one recorded. It checks the token's account, sends only
queries, and keeps and refuses what `record.ts` does. It writes nothing unless every answer came as
the recorded one did, with the same status and with errors only where it had them, and it notes the
operation and when in `cassette.json` (`rerecorded`). Before recording an answer whose state has
moved on since, such as a pull request's base changed by a recording with writes, put GitHub in that
state first, and back after.

### When the app reads something new

When the app begins to send a request its cassettes were recorded without, add only that request's
answer to each, in place:

```sh
LO_FIXTURE_TOKEN_FILE=<file holding rozed-bot's token> \
  node testing/scripts/add-answers.ts <query's .graphql file> <variables as JSON> <cassette> ...
```

Each cassette gets its own answer from GitHub, in a file after its others, so the requests recorded
before it stay as they were. It checks the token's account and keeps and refuses what `rerecord.ts`
does, refuses a cassette that holds the request already, and notes the operation and when in
`cassette.json` (`added`). An answer another cassette recorded, such as an avatar, goes in as it is,
with nothing sent to GitHub:

```sh
node testing/scripts/add-answers.ts --copy <recorded request's file> <cassette> ...
```

A REST read is added with `--rest <path>`, such as `/repos/rozed-dev/e2e/rules/branches/main`:
GitHub's first answer, and its `304` to the read again with the first's `ETag`, as a poll reads it.

### What GitHub can't be made to answer

Some answers can't be recorded on demand: a lost answer, a refusal of content sent too fast, or an
approval of a pull request rozed-bot opened, which GitHub refuses from its author, and rozed-bot
opened every pull request in rozed-dev/e2e. `src/derivations.ts` lists them, each a cassette derived
from a recorded one, and

```sh
node testing/scripts/derive-answers.ts [cassette ...]
```

writes them, as `nx run testing:codegen` does, sending nothing to GitHub. A derived cassette's
folder holds only what it changes: each answer in the file of the recorded one it replaces, by
number, and each it adds numbered after them, with `derived_from` naming the recorded cassette in
its `cassette.json`. Read, it's the recorded cassette with those in place, so the replayer and
`bodies.ts` take it by name as any other. Answers are never added to one in place: change its
recording, then write it again. A test checks that each is as its derivation writes it now.

- `app_comments_write_others`: `app_comments_write` as if someone else had opened #94, with the
  pending review's submission answered for Approve and Request changes. The replayer matches GraphQL
  by operation and variables, so each verdict gets its own answer.
- `app_comments_write_lost`: the submission answered 502, after which Lo reads your reviews.
- `app_comments_now_too_fast`: the comment posted at once refused as "was submitted too quickly".
- `review_writes_e2e_23_not_in_diff`: a thread on lines outside the diff, answered with no thread.
- `attachments_e2e_not_found`: an upload answered 404.

To add one, add its derivation to the list, with what it changes in its description, and run the
script.

## A cassette

```
fixtures/github/<cassette>/
  cassette.json                          what it shows, when and where it was recorded
  001-GET-repos_rozed-dev_playground_pulls_1.json
  002-POST-graphql-PullRequestCheck.json
```

Each request file holds `{ request, response }`:

- `request`: `method`, `url`, and for GraphQL `operation`, `variables` and `query_sha256`; for any
  other body `body_sha256`, or `body` itself in a cassette written by hand; and `if_none_match` or
  `if_modified_since` for a conditional request. Request headers are never stored.
- `response`: `status`, `headers` (only those `KEPT_HEADERS` lists) and `body` as JSON, `body_text`
  when it's other text, or `body_base64` when it's an image or other bytes.

A cassette written by hand, for what can't be recorded on demand, says `"synthetic": true` in its
`cassette.json`. Its stand-in tokens are spelled like `gho_FAKE_SIGNED_IN`.

The fixtures stay exactly as recorded: Prettier skips them.

## Recording

Recordings come from the test organization `rozed-dev`, as its bot, `rozed-bot`. They're committed
to a public repository, so they're never made as a person.

```sh
LO_FIXTURE_TOKEN_FILE=<file holding rozed-bot's token> \
  node testing/scripts/record.ts <scenarios module> [cassette ...]
```

The scenarios module exports `scenarios`, a list of `Scenario`s: each names its cassette and sends
its requests through the `fetch` it's given. With cassette names, only those are recorded. The
script:

- asks GitHub whose the token is, and stops unless it's `rozed-bot`;
- records into `fixtures/github/<cassette>`, replacing what's there;
- sends nothing that writes to GitHub (anything but a read or a GraphQL query) unless the scenario
  says it writes and `LO_RECORD_WRITES=1` is set; without it, such scenarios are skipped;
- never stores request headers, keeps only the allowed response headers, redacts signed URLs, in
  what it requested as in what came back, and blanks credential fields such as a private
  repository's `temp_clone_token`;
- refuses to write the token, as is, percent-encoded or in base64, or anything shaped like a GitHub
  token, and deletes the cassette if it would.

Record a cassette again only when its request has to change, such as when its query does, and check
the diff before committing: the recorded data is published with the repository.

## Recording from the app

What the app's own tests replay is recorded from the app, so the app holds no recording code:

```sh
LO_FIXTURE_TOKEN_FILE=<file holding rozed-bot's token> \
  node testing/scripts/record-proxy.ts <cassette> <repository> <description>
```

starts a proxy on `127.0.0.1` that stands in for GitHub as the replay server does, its image hosts
included, and prints the address to start Lo with as `LO_GITHUB`. Start Lo with a stand-in token in
`LO_TEST_TOKEN_FILE`: the proxy signs each request it forwards with the bot's token, and an
anonymous one stays anonymous, so Lo never holds the bot's token. Of the image hosts, only an
attachment's address on github.com is ever signed; the signed addresses it redirects to are recorded
with their signatures redacted, as the redirect is. Drive Lo through what the cassette should hold,
long enough for its polls to repeat, then stop the proxy with Ctrl+C. It checks the token's account
and every file as `record.ts` does, and sends nothing that writes to GitHub unless
`LO_RECORD_WRITES=1` is set: then each write Lo sends goes to GitHub and is recorded, so record
writes only to rozed-dev's fixtures, and put them back after.

The pull request the app's tests open, rozed-dev/e2e#80, comes from `fixtures/app.sh`, which builds
its repository with fixed names, dates and contents, so every commit has the ID GitHub has for it: a
rename, a move, a lockfile, a 5,001-line file, a binary and a deletion, in two pushes, the second a
force-push that rebased the first onto a newer base. It has an overview at `refs/lo/pr/80`, written
for the first push, which rozed-bot pushed once: one commit of `artifact.md` and a figure, as
`lo-overview commit` writes it, with code blocks, a figure with parts, a walkthrough, terms, tabs, a
fold, an illustration and a broken reference. `writeAppRemote` from `@lo/testing/git` builds it as a
remote for `LO_GIT_REMOTE`, and `APP_PULL` names its commits; `{ firstPush: false }` leaves the
first push out, as if GitHub no longer had it. The overview's files are left in `overview/` beside
it. Its cassette is `app_e2e`, and `app_e2e_late` is the same with GitHub's patch of one file left
out.

`images_e2e` holds the images the app's security test loads, recorded with main's own image loader
(`apps/desktop/src/features/comments/main/test/images.ts` is its scenarios module): a 2x2 PNG
attached in rozed-dev/e2e, by its address on github.com and the signed address that redirects to,
and rozed-bot's avatar.

The stacks the app's tests open come from `fixtures/stack.sh`, built the same way, in rozed-dev/e2e:

- #82, #83, #84 and #85, a stack on `stack/root`, a branch no pull request comes from: #83 on #82 by
  its base branch, #84 on #83 by the commits they share, and #85, opened after #83, a second layer
  on #82;
- #87 on #86, which was squash-merged, so #87 needs a rebase;
- #88 and #89, GitHub stack #90.

#83 has an overview at `refs/lo/pr/83`. `writeStackRemote` from `@lo/testing/git` builds the remote,
and `STACK_PULLS` names the pull requests and their heads. Their cassette is `app_stack`.

`app_stack_convert` was recorded with writes, as Lo made #82, #83 and #84 a GitHub stack: it changed
#84's base branch to `stack/b`, then made GitHub stack #92. `fixtures/stack-reset.sh`, run with
`LO_FIXTURE_TOKEN_FILE` as `record.ts` is, unstacks them and changes #84's base back, as `stack.sh`
made them, so that can be recorded again. What GitHub can't be made to do on demand, a lost answer,
the app's tests answer from the same cassette with that answer changed
(`apps/desktop/e2e/convert.spec.ts`). #83 has one review thread, on `src/cost.ts`.

The review threads the app's tests read come from `fixtures/comments.sh`, built the same way:
rozed-dev/e2e#94, two pushes, and threads on a line, on a range, on the base's side, on a file,
resolved, with replies, with a suggestion, with an image attached and one from another site,
outdated, and written on the second push; and #95, which renames a file, with a thread on its base's
side. Every comment on them starts with `Fixture C:`. `writeCommentsRemote` from `@lo/testing/git`
builds the remote, and `COMMENTS_PULL` and `COMMENTS_RENAME_PULL` name their commits. Their cassette
is `app_comments`, and `app_comments_write` was recorded with writes, as Lo started rozed-bot's
pending review on #94 with a comment on a line and then submitted it as a comment, and
`app_comments_now` as Lo posted one at once. `app_comments_act` was recorded with writes as Lo acted
on #94's threads: a reply posted at once on line 2's thread, then edited, then deleted, and line 5's
resolved thread unresolved and resolved again, and `app_comments_box` as Lo wrote on #94 itself from
its timeline: a comment posted from the box at its end, then edited, then deleted.
`fixtures/comments-reset.sh`, run with `LO_FIXTURE_TOKEN_FILE` as `record.ts` is, deletes what a
recording with writes added there and resolves and unresolves the threads as `comments.sh` left
them. A submitted review can't be deleted, so each recording of `app_comments_write` leaves one more
on #94. Which posts the window asks GitHub to render at once depends on what's near the screen, so
the app's tests answer those reads from every post the cassette recorded
(`apps/desktop/e2e/bodies.ts`).

The code features' pull requests, rozed-dev/e2e#98, #99 and #100, come from `fixtures/code.sh`,
`fixtures/code-hostile.sh` and `fixtures/code-reset.sh`, which write to GitHub rather than only
build a repository to fetch from. They run as rozed-bot, with `LO_FIXTURE_TOKEN_FILE` as `record.ts`
has it, and only once `GET /user` says the token is rozed-bot's:

- `code.sh` pushes `code/base` and `code/feature` to rozed-dev/e2e and `code/feature` again to
  rozed-bot's fork of it as `code/fork`, and opens the pull request from each into `code/base`: #98
  within the repository, and #99 from the fork. Their files are `fixtures/code/`, a small project in
  each language Lo has a syntax index for, which count and summarize words, with a definition in a
  file the pull request leaves alone and a function moved from one file to another in TypeScript and
  Python. The language servers' live check asks questions of the same projects, at the places
  `fixtures/code/cases.json` names.
- `code-hostile.sh` adds one commit to the code fixture, `code/hostile`, and opens #100 from it. Its
  files try to run code, steer a language server or a version manager, or fetch from the network,
  and each only writes an empty `lo-hostile-<name>` file beside itself or names a host ending
  `.lo-hostile.invalid`, so none ran while no `lo-hostile-*` file is in a checkout and no proxy log
  names such a host. It's all text the script writes: none of it is in this repository as a file a
  tool here would pick up, and the tests read it back without running it.
- `code-reset.sh` makes every commit again and pushes them, replacing the branches, opens a pull
  request that was closed, puts back each one's title, description and base, and deletes the
  comments and pending reviews a test wrote on them.

The three share `fixtures/code-lib.sh`, as does `merge.sh` below. `code.sh` and `code-hostile.sh`
take `--local <folder>`, which builds the same commits, with the IDs GitHub has, into
`<folder>/rozed-dev/e2e.git` and `<folder>/work` and reads no network, as the other fixtures do. Run
again, they put the branches back and open a closed pull request. They refuse a folder inside a git
work tree, whether it exists yet or not, since git, Nx and the other tools run there would load what
they build, the hostile fixture's plants among it: build them in a folder of their own, such as
`"$(mktemp -d)"`. So does `merge.sh --local`.

The pull requests the merging features are tried on come from `fixtures/merge.sh`. A merge can't be
undone, so it makes them in numbered generations, `merge.sh <generation>`, and what merges, queues
or removes one uses it up: make the next generation for the next recording or check, and name the
one a recording used in its `cassette.json`. It runs as rozed-bot with `LO_FIXTURE_TOKEN_FILE`, as
`code.sh` does, and writes only to rozed-dev/e2e. A generation has branches under
`merge/<generation>/`, pull requests titled `Fixture M<generation>: …`, and every file it adds in a
folder of that name, so a merge into another fixture's base never makes its pull requests conflict,
and each generation's commits differ from the last. Its pull requests:

- on `merge/<generation>/base`, which no ruleset covers: `squash`, `merge` and `rebase`, ready, one
  for each way to merge (the first and last have two commits); `conflict`; `draft`; `stack-1` and
  `stack-2`, which it makes a GitHub stack; `chain-1` and `chain-2`, which sit on each other by
  their base branch alone; and `moved`, the one `merge.sh <generation> --push` adds a commit to,
  once, for a merge whose head moved after it was shown;
- on `e4/gated`, which E4's ruleset gives a required `ci`, an approval from a code owner and every
  conversation resolved: `gated-failing`, with `ci` failing and an unresolved conversation, and
  `gated-passing`, with `ci` passing, so it waits only for an approval;
- on `e4/queued`, which E4's ruleset gives a required `ci` and a merge queue: `queued-pass`, two
  slow ones (`ci` passes after ten minutes) and `queued-fail`, which passes on the pull request and
  fails in the queue. Each picks `ci`'s result with its `ci-result` file;
- on `merge/<generation>/override`: `overridden`, under the "Merge override" ruleset, which requires
  an approval and lets the repository's admins bypass it, so rozed-bot, an admin, can merge it past
  the rule. Its one target is `refs/heads/merge/*/override`, so no other branch has a rule because
  of it. The script makes it once, if the repository has none by that name.

It reads before it writes, and stops unless the repository is as it expects: rozed-bot is an admin
of it, merge commits, squashes and rebases are all allowed, "Automatically delete head branches" is
off (with it on, GitHub moves a chain's upper layer itself when the layer below merges, and a merged
pull request's branch is gone), the `ci` workflow is active on `main`, E4's two rulesets are as they
were recorded, the repository has no other ruleset, and `e4/gated` and `e4/queued` still hold the
commit its pull requests into them are cut from. It says whether "Allow auto-merge" is on, which a
repository's owner turns on and it never does. `--check` stops after those reads.

It never replaces or deletes a branch: a branch that isn't as it makes it, or a pull request that
was closed or merged, is said and left alone, and run again for a generation it adds only what's
missing. It never touches `main`, `code/*`, rozed-bot's fork or another fixture's branches or pull
requests, and never changes E4's rulesets.

`merge.sh --local <folder> <generation> [--push]` builds the same commits into
`<folder>/rozed-dev/e2e.git` and `<folder>/work` and reads no network, for a generation whose
numbers the script has. `writeMergeRemote(folder, generation, { pushed })` from `@lo/testing/git`
builds it as a remote for `LO_GIT_REMOTE`, `MERGE_PULLS` names each recorded generation's pull
requests, with their numbers, heads and bases, and `pushed` adds the commit `--push` does. Every
commit has the ID GitHub has for it, so Lo can fetch any head or base tip a cassette names. A base
GitHub merged into can't be rebuilt with its ID, so the remote keeps `merge/<generation>/base` as it
was made, and no spec fetches what GitHub built there.

The pull requests into `e4/gated` and `e4/queued` are cut from a commit GitHub made, which no script
can build with its ID, so `fixtures/merge-e4.bundle` holds it: a git bundle of both branches'
history as GitHub had it when the bundle was made, which `merge.sh` unbundles (`MERGE_E4` names its
commits). Pull requests merge into those branches, so a cassette recorded later names a tip the
bundle lacks, and the remote can't serve it. Make the bundle again from GitHub's history, which
reads the public repository and needs no token:

```sh
git init --bare e2e.git
git -C e2e.git fetch --no-tags https://github.com/rozed-dev/e2e.git \
  +refs/heads/e4/gated:refs/heads/e4/gated +refs/heads/e4/queued:refs/heads/e4/queued
git -C e2e.git bundle create <this repository>/testing/fixtures/merge-e4.bundle e4/gated e4/queued
```

and update the tips in `MERGE_E4`. The commits stay the same, so no generation's IDs change.

To record a generation: run `merge.sh <generation>`, which prints each pull request's number and
head, add them to `recorded_numbers` in the script and to `MERGE_PULLS`, and take `pushed` from
`merge.sh --local <folder> <generation> --push`. Generation 1 is rozed-dev/e2e#101 to #117, with
GitHub stack #118. Its repository didn't allow auto-merge when it was made. Generation 2 is #119 to
#135, with GitHub stack #136; the merge queue's recordings used it. Generation 3 is #138 to #154,
with GitHub stack #155; `app_merge` used it. Generation 4 is #156 to #172, with GitHub stack #173;
`app_queue` used it, recorded while #169 and #168 were tested together in `e4/queued`'s queue and
#170, its `ci` run again, waited to join it with auto-merge on. Each was taken out of the queue, or
its auto-merge turned off, after, so none merged and `e4/queued` is still at `MERGE_E4.queued`.
Generation 5 is #174 to #190, with GitHub stack #191; `app_merge_write` used it, recorded with
writes as Lo merged #174, #175 and #176, one way each, and confirmed #183's merge just after
`merge.sh 5 --push`, which GitHub then failed. `app_merge_write_lost` is the same with that merge's
answer lost. `app_merge_write_moved` is the same with that pull request's polls before the merge
answered as the first after it, which saw the push, and `app_merge_write_polled` adds GitHub's
answer to a poll of each merged pull request after the recording's last. `app_merge_enqueue` used it
too, recorded with writes as Lo added #187 to `e4/queued`'s queue, which was taken out of it after,
so it didn't merge. Generation 7 is #210 to #221 and the odd numbers from #223 to #231, with GitHub
stack #234. `app_merge_auto` used it, recorded with writes as Lo turned on auto-merge for #221 and
"Merge when ready" for #225 while its `ci` ran again, and `app_merge_auto_off` as Lo turned both off
before that `ci` passed, so neither merged nor joined the queue, and `e4/queued` is still at
`MERGE_E4.queued`. `app_merge_override` is Lo merging #231 past its base's rule. #210, #212 and #219
were merged into `merge/7/base` through the API, to move that base while #211's tab was open: GitHub
refuses auto-merge for a pull request nothing blocks, which Lo asks for only while it reads GitHub
as still checking whether it merges cleanly, and GitHub had checked each time before Lo read it. So
`app_merge_auto_now`, that refusal, is derived.

## The fake language server

`lsp/fake-server.ts` is a language server for tests: it speaks the protocol over stdio on
`vscode-jsonrpc`, and Node runs it as it is, stripping its types. It does what a scenario file says
(`lsp/scenario.ts`): its answers by method and file (`$ROOT` stands for the checkout's URI), how
long each takes, a crash after some requests, a hang, memory to fill, requests and notifications to
send Lo, a process of its own to start and one in a session of its own, either of which can start
sleepers in sessions of their own as fast as it can, a flood of output once initialized, in place of
its answer to `shutdown` or after it, on stderr too, and whether it ignores `shutdown`, `exit` and
`SIGTERM`. It writes each message whole, so a flood never lands inside one. It reports what it sees,
one JSON object per line: its environment and `argv0`, `initialize`, the files opened and closed,
each request and cancel, Lo's replies to its requests, and each sleeper started.

`fakeServer(folder, scenario)` from `@lo/testing/lsp` writes the scenario and returns the program,
arguments and report to start it with, and `readReport` reads what it saw. It's the only server
tests start.

## Running the app on GitHub itself

The app's tests (`apps/desktop/e2e/`) start Lo through Playwright, which adds Chromium's stand-ins
for the system's keychain to every Electron it starts: `--use-mock-keychain` on a Mac, and
`--password-store=basic` on Linux. Both encrypt with a key every copy of Chromium knows, so a token
kept with them is as good as plain text, and Lo keeps or reads one with them only in a test run, one
on `LO_GITHUB`. On GitHub itself, Lo started with a stand-in refuses to sign in, and can't read a
token it kept with the system's keychain.

A run on GitHub itself is a spec of its own, a `*.live.ts` in `e2e/`, which the suite never runs:
its config takes only `*.spec.ts`. `nx run desktop:live` builds the app, then runs the live specs
with `e2e/live.config.ts`, which turns on the harness's `live` option for them and runs them one at
a time: each starts Lo on the same data folder, and Lo quits a second copy started on a folder
another holds. The harness refuses a live run with more than one worker.

Lo then starts with the system's keychain: `e2e/keychain.cjs`, preloaded after Playwright's own
preload, takes the stand-ins off again. It keeps its data in the folder `LO_USER_DATA_DIR` names,
taken by its real path, with every link followed. The harness refuses to start Lo without one, or in
a folder that is, is in or holds a folder a Lo you use keeps its data in: the installed Lo's,
`Lo Dev`'s, `~/.config/lo` and their caches, by the XDG folders too on Linux. It also refuses a
folder that holds anything Lo didn't make, so start from a new one. Sign in there first with a build
run from source, which keeps its data in the same folder, then run the specs:

```sh
export LO_USER_DATA_DIR="$(mktemp -d)"
pnpm nx run desktop:start
pnpm nx run desktop:live
```

To run one spec, name it: `pnpm nx run desktop:live -- <spec>`. The rest is as in a test, unless the
spec's `launch` says otherwise: the stand-ins for the editor and the browser, and no gh.

On a Mac, the key Lo encrypts tokens with is the item `Lo Dev Safe Storage` in your login keychain,
which Chromium makes the first time it needs it, and which every build run from source shares,
`desktop:dev` and `desktop:start` too. Once you're done, delete the run's data folder, which holds
its tokens, encrypted with that key. Delete the item too, unless another build run from source keeps
tokens with it, since that build then can't read them:

```sh
security delete-generic-password -s 'Lo Dev Safe Storage'
```

On Linux, the desktop's keyring, such as GNOME Keyring or KWallet, keeps the key instead. Remove it
with the keyring's own tool.

## The credential scan

`test/fixtures.test.ts` checks every file under `fixtures/` the way the recorder checks a new one,
so a token can't reach the repository by hand either.
