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
  test ends.

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
- `response`: `status`, `headers` (only those `KEPT_HEADERS` lists) and `body` as JSON, or
  `body_text` when it isn't JSON.

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
- never stores request headers, keeps only the allowed response headers, redacts signed URLs and
  blanks credential fields such as a private repository's `temp_clone_token`;
- refuses to write the token, as is, percent-encoded or in base64, or anything shaped like a GitHub
  token, and deletes the cassette if it would.

Record a cassette again only when its request has to change, such as when its query does, and check
the diff before committing: the recorded data is published with the repository.

## The credential scan

`test/fixtures.test.ts` checks every file under `fixtures/` the way the recorder checks a new one,
so a token can't reach the repository by hand either.
