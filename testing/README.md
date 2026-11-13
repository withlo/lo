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
is `app_comments`. `fixtures/comments-reset.sh`, run with `LO_FIXTURE_TOKEN_FILE` as `record.ts` is,
deletes what a recording with writes added there and resolves and unresolves the threads as
`comments.sh` left them. Which posts the window asks GitHub to render at once depends on what's near
the screen, so the app's tests answer those reads from every post the cassette recorded
(`apps/desktop/e2e/bodies.ts`).

## The credential scan

`test/fixtures.test.ts` checks every file under `fixtures/` the way the recorder checks a new one,
so a token can't reach the repository by hand either.
