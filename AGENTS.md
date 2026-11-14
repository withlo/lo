# Lo

Lo (as in "lo and behold") is a desktop app for reviewing GitHub pull requests, for people who read
far more code than they write. It's an Electron app written in TypeScript, and it talks to GitHub
directly, with no backend. [`docs/design.md`](docs/design.md) is the design: build it as written.

`CLAUDE.md` is a link to this file, so every coding agent reads the same rules.

## The name

Text a person reads says "Lo", with a capital L, even mid-sentence: menus, window titles, messages,
logs, comments and docs. A lowercase l reads as a capital I in sans-serif fonts. Lowercase `lo` is
only for names that are code: the `lo` command, the repository (`withlo/lo`), packages (`@lo/*`),
git refs (`refs/lo/`), the `lo://` links, `~/.config/lo` and environment variables (`LO_*`).

## Principles

These bind every change (design section 1).

- **Read-only.** Lo never edits files or pushes commits. It writes to GitHub only to review and
  merge: comments and their attachments, reviews, viewed marks, merges, queue and auto-merge
  changes, and changing a PR's base branch to form a stack.
- **No AI inside Lo.** Lo calls no model and runs no agent. It displays what agents write elsewhere.
- **No backend, no telemetry.** Lo talks only to GitHub and to language servers' official download
  sources. Updates come from GitHub Releases.
- **Never runs a repo's code.** No dependency installs or build steps. Language servers run only on
  repos the user trusts, and overviews contain no scripts.
- **Keyboard first.** Every action has a key.

## Layout

| Folder              | What                                                                     |
| ------------------- | ------------------------------------------------------------------------ |
| `apps/`             | The desktop app (`apps/desktop`) and the performance suite (`apps/perf`) |
| `packages/core/`    | Packages that run anywhere: no Node, no Electron, no git                 |
| `packages/desktop/` | Packages for the desktop app only                                        |
| `skill/`            | The overview skill, with its checker and installer in `skill/checker`    |
| `testing/`          | Test helpers and recorded fixtures, for tests only                       |
| `design/`           | The design system: rules, tokens, and the CSS Tailwind can't reach       |
| `docs/`             | The design and the product's docs                                        |
| `brand/`            | The mark, wordmark, app icon, colors and motion; `brand/README.md` rules |
| `scripts/`          | Repo scripts: the boundary check, git hooks, CI checks                   |

Every package but one is a private pnpm workspace package named `@lo/<name>`, and each is an Nx
project named after its folder (`"nx": { "name": "<name>", "tags": [...] }` in its `package.json`).
Names are one short word, without hyphens, unless clarity needs two. The one package published to
npm, `skill/checker`, is named `@withlo/overview`: it holds the checker and, built in, the skill it
installs (see "Publishing the checker").

## Set up

```sh
pnpm install
```

That's all: `package.json` pins Node and pnpm under `devEngines`, and pnpm 11 or later downloads
both. It also installs the git hooks. Run it in every new clone and worktree.

## Tasks

Nx runs every task, from each package's `package.json` scripts, and caches results in `.nx/cache`.
It runs without a daemon and never connects to Nx Cloud.

```sh
pnpm nx affected -t lint typecheck test build  # what your branch changed, against main
pnpm nx run-many -t lint typecheck test build  # everything
pnpm nx run scripts:test                        # one project's target
```

Each package defines `lint` (`oxlint`) and `test`
(`vitest run --root <path to the repo root> --project @lo/<name>`, so the root `vitest.config.ts`
applies) as scripts. Add `test` with the package's first test: Vitest fails a project that has none.
`typecheck` comes from Nx's TypeScript plugin: `tsc --build` over the package's project references.

## TypeScript

- `tsc` is TypeScript 7. The `typescript` package is TypeScript 6, which Nx's TypeScript plugin
  needs for its API; nothing else uses it.
- Packages export their source (`"exports": { ".": "./src/index.ts" }`), with no build step. Write
  relative imports with their `.ts` extension.
- A package's `tsconfig.json` extends `tsconfig.base.json`, lists no files, and references a
  `tsconfig.lib.json` for its source and a `tsconfig.test.json` for its tests. Each sets its own
  `outDir` under `.tsbuild/`.
- The source's config extends the preset for where the code runs, which decides what it may use:
  `tsconfig.core.json` (anywhere: no Node types), `tsconfig.node.json` (the main process and other
  Node code), `tsconfig.background.json` (the background process) or `tsconfig.window.json` (the
  window: DOM and JSX). The tests' config extends `tsconfig.node.json`, since tests run in Node.
- A package whose code all runs in Node, such as `scripts`, can have a single `tsconfig.json` that
  extends `tsconfig.node.json`.
- `nx sync` keeps the project references in step with the dependencies in each `package.json`. Run
  it after adding a dependency between packages; CI runs `nx sync:check`.
- A `switch` over a union names every member and ends with a `default` that checks the value is
  `never` (`value satisfies never`), so a new member fails to compile wherever it isn't handled. The
  `default` still runs for a value outside the union. When the value can come from outside Lo, such
  as GitHub's answer or what Lo saved, it returns a safe answer (`review`'s `outsideCase` does
  both); otherwise it throws an error naming the value. Lint requires the cases and the `default`,
  and refuses handing `value satisfies never` on (returning, assigning or yielding it, or making it
  a branch or a member of an object or array), which would pass the value off as an answer.

## Boundaries

A package's folder says where it runs, and its Nx tags (`"nx": { "tags": [...] }` in its
`package.json`) say what it may import. `pnpm check:boundaries` checks:

- a project in `packages/core/` is tagged `platform:core`, one in `packages/desktop/` is tagged
  `platform:desktop`, and no other project has a platform tag;
- projects in `packages/core/markdown`, `packages/core/artifact` and `skill/` are tagged
  `license:mit`, and every `license:mit` project carries the MIT license in its own `LICENSE`;
- core projects import only core projects, and use no Node built-in, Electron or child process
  (their tests may use Node);
- core projects load modules by name: an `import()` of anything but a literal fails;
- `license:mit` projects import only `license:mit` projects;
- nothing imports an app;
- only tests import `testing/`. Tests are `*.test.*` files and anything in `test/` or `e2e/`, and
  `testing` belongs in `devDependencies`;
- only `packages/desktop/ui/src/code/` uses CodeMirror (`@codemirror/*`, `@lezer/*`,
  `@replit/codemirror-vim`), and only `ui`'s `package.json` lists it, or a package that depends on
  it. Everything else, tests included, reaches the code views through that folder's `index.ts`,
  `@lo/ui/code`, and no type `ui` hands out names CodeMirror (`ui`'s `lint` checks), so that
  changing editors rewrites one folder;
- in the desktop app, a feature imports from another feature only the files it shares through (see
  "Features" under "The desktop app").

Imports resolve the way Node finds them, through `node_modules`, symlinks, and the `imports` and
`exports` in a `package.json`, to the project they reach, so a name or path can't disguise where an
import goes. The same rules apply to type and path references, to a `require` that `createRequire()`
makes, to what a project's `package.json` lists in its dependencies (aliases included) and points to
in its `imports` and `exports`, and to every edge in Nx's project graph. Also:

- a relative import stays inside its project's folder, and so does where a symlink takes it, unless
  that's in the workspace's `node_modules` (the root's, or a project's own); projects reach each
  other by package name. What a project's `imports` and `exports` map to stays in its folder too;
- nothing imports files outside every project, other than packages in the workspace's
  `node_modules`;
- a module's name or path has no percent escapes or backslashes, since Node decodes the one and
  reads the other as `/`, and isn't a URL other than `node:`;
- a `#name` import is one the `package.json`'s `imports` map;
- an `import.meta.glob` counts as an import of each file it matches, so its patterns and its base
  start with `./` or `../`, and it has no option that changes what it matches;
- nothing imports a source file in a folder the check skips (`node_modules`, `dist`, `fixtures` or a
  hidden folder), since what that file imports isn't checked;
- `require` appears only in a call that names its module, such as `require('./x.js')`;
- only the files that `scripts/boundaries/check.ts` lists use `createRequire` or `getBuiltinModule`,
  since what they load can't be followed;
- pnpm's overrides and package extensions point no dependency at a folder with `link:` or `file:`;
- no tsconfig sets `paths`, nor any tsconfig it extends or references, and every `extends` is one
  the check can find;
- the root `package.json` holds the repo's tooling only: no workspace package, and no alias besides
  TypeScript's two.

oxlint also stops core code from reaching for `process`, `Buffer`, `window`, `document` and other
globals of a particular platform. To share code across a boundary, move it into a package on the
right side; don't loosen the rules.

## Tests

Unit tests are `*.test.ts` files beside the code, run by Vitest. The root `vitest.config.ts` has one
project per package. Nx runs one project's tests at a time, and Vitest uses two workers, or all of a
CI runner's cores.

What `ui`'s components do that only a real browser shows, such as where `Tab` moves focus, is tested
by Playwright specs in `packages/desktop/ui/e2e/`. Each builds its own page with Vite and opens it
in Electron's Chromium (`pnpm nx run ui:e2e`), and CI runs them with the app's smoke test.

## The desktop app

`apps/desktop` is Lo's Electron app. `src/main/` is the main process, `src/preload/` the window's
bridge to it, `src/window/` the window, `src/platform/` the code that differs between macOS and
Linux, and `src/features/` the features.

```sh
pnpm nx run desktop:dev      # run it with hot reloading
pnpm nx run desktop:start    # build it, then run the build
pnpm nx run desktop:e2e      # build it, then run its smoke test
pnpm nx run desktop:package  # build it, then make the Mac zip in apps/desktop/release/
```

- The `electron` package downloads Electron's binary the first time it's needed.
  `pnpm --filter @lo/desktop exec install-electron` fetches it ahead of time.
- `desktop:package` runs electron-builder (`apps/desktop/build/electron-builder.yml`) on a Mac and
  makes `Lo-<version>-arm64.zip`: an Apple silicon build signed ad hoc, with no certificate, secret
  or notarization, registered for `lo://` and web links. It runs with the hardened runtime and only
  the two entitlements in `build/entitlements.plist`, which the config's comments explain. Its fuses
  are set so the debugger, `NODE_OPTIONS` and `ELECTRON_RUN_AS_NODE` do nothing, and Electron loads
  only the asar and checks it against its hash. Gatekeeper doesn't trust an ad hoc signature: a zip
  downloaded in a browser is quarantined, so allow it in System Settings > Privacy & Security > Open
  Anyway, since macOS 15 has no right-click > Open. A zip from `gh run download` has no quarantine
  flag and opens as it is. The `package` workflow, which only a person starts, builds the same zip
  on a Mac runner and uploads it as an artifact. `scripts/check-package.sh` checks a zip: the
  signature and its flags, the entitlements, every fuse, the asar's contents and hash, the
  registered links, and that the app quits when given switches or the variables below. electron-vite
  bundles everything the app imports, so the package holds only `dist/` and `package.json`, and no
  `node_modules`.
- A packaged Lo takes no command-line switches: first of all in main, before `ready`, it quits with
  status 1 on any argument that isn't a `lo://`, `https://` or `http://` link from its first
  character (`src/main/arguments.ts`). Chromium's switches can send main's requests, with their
  `Authorization` header, to another server, write out the secrets of every connection, or open a
  port that drives the window, and none is Lo's. Chromium trims the whitespace around an argument
  before it looks for a switch, so Lo takes links alone rather than looking for switches itself.
  Links reach a packaged Lo as events, or, from the `lo` command, as its one argument. Nor does it
  start with the variables that do what some switches do, which Chromium and Node read whatever Lo
  does: `SSLKEYLOGFILE` (Chromium writes every connection's TLS secrets to it),
  `ELECTRON_ENABLE_LOGGING` and `ELECTRON_LOG_FILE` (Chromium's own logs), and
  `NODE_TLS_REJECT_UNAUTHORIZED=0`. The certificate authorities' variables, which networks that
  inspect TLS need, and proxies are left alone. A build run from source takes every switch and
  variable, as `electron-vite dev` and the tests pass some.
- A build run from source goes by `Lo Dev`, so it never touches an installed Lo's data or its key in
  the system's keychain: it keeps its data in its own folder (`Lo Dev`), or in `LO_USER_DATA_DIR`
  when that's set, and its key under "Lo Dev Safe Storage". A packaged build is `Lo`, and ignores
  `LO_USER_DATA_DIR`. Such a build reads the keymap file from `config/keymap` in that folder, rather
  than from `~/.config/lo`, and the settings file from `config/settings.json` the same way, and
  opens the keymap file with the program `LO_KEYMAP_EDITOR` names (an absolute path), if set, in
  place of the system's text editor, so a test starts no editor.
- Code that doesn't call Electron goes in its own module, with unit tests beside it. The smoke test
  in `e2e/` drives the built app with Playwright, each test on an empty data folder, and covers what
  needs Electron. On Linux it needs a display: CI runs it under `xvfb-run`, in four shards, one job
  each (`app (1/4)` to `app (4/4)`), which split the tests by count with Playwright's `--shard`;
  `pnpm nx run desktop:e2e -- --shard=2/4` runs one. In CI each test records a trace of the window,
  kept in its results when it fails, which CI uploads as `app-test-results-<shard>`; a test that
  times the page's frames opts out (`traced: false`), since recording slows them. CI retries a
  failed test once, and Playwright shows one that then passes as flaky. A test drives Lo's window
  only once it has drawn, through the `page` fixture or, for a copy of Lo it starts itself,
  `drawnWindow`: the page runs before Electron's GPU process has started, which in CI has taken up
  to half a minute, and until it has, nothing that waits on a frame happens, such as a closed dialog
  leaving.

The window shows untrusted content, so it's locked down, and the smoke test shows each guard
holding:

- It runs in Chromium's sandbox, with context isolation and without Node.
- It loads only Lo's own files, from the `lo-app:` scheme, never from `file:`, and images main
  serves from GitHub, from the `lo-image:` scheme (see "Images from GitHub"). Its content security
  policy, sent as a header, allows no inline scripts and nothing from elsewhere but those images,
  and no inline styles but the style elements that carry the page's nonce, which the code views
  make. Each load of the page gets a new nonce, which `app.info` hands the page.
- Its session cancels every request outside `lo-app:`, but an image's at an address `lo-image:`
  serves, which the page can draw but not `fetch`. WebRTC, which sends nothing the session can
  cancel, may use only the session's proxy, which leads nowhere. Every permission and every download
  is refused. It can't navigate away, follow a redirect, open other windows or attach a webview.
- Its only way to main is `window.lo`, with `invoke` and `subscribe`. Main answers a request only
  from Lo's own page, and only once its input matches the feature's contract. A reply is
  `{ ok: true, value }` or `{ ok: false, error: { code, message } }`, never an error's text or
  stack.

`src/main/policy.ts` holds these rules. Loosen one only for a stated reason, with a test that shows
the new limit.

### Features

Each feature is a folder, `src/features/<feature>/`, and nothing outside it lists features: main and
the window find them with `import.meta.glob`.

- `contract.ts` defines the feature's contract with `defineContract`: each request's input as a Zod
  schema and its reply's type, and each topic main pushes, with its schema. Channels are named
  `<feature>.<name>`. Objects in an input are `z.strictObject`, so unknown keys are refused; a test
  checks every contract. Main and the window both load contracts, so lint keeps Electron, Node and
  either side's code out of them.
- `main/index.ts` exports `defineFeature(contract, { uses, handlers, provide, start, stop })` by
  default: the other features' services it `uses`; a handler for every request; optionally a
  `provide` that returns the values of the feature's services; optionally a `start` that runs before
  the window opens, to publish on the feature's topics; and optionally a `stop` that runs once as Lo
  quits. A feature stops before the features whose services it uses, and otherwise the last to start
  stops first, each once the one before it has. Each gets 5 s of its own, and once they've taken 30
  s in all no more start stopping, except features that provide services, which always get their own
  5 s; the database closes once nothing stopping is still within its own 5 s. Each part gets the
  feature's context: `publish`, `database`, `git` and `use`. A handler throws an `IpcError` for a
  failure the window should see; any other error is logged and reaches the window only as
  `internal`.
- `service.ts` names what the feature's main side offers other features, each with
  `defineService<T>('<feature>.<name>')`: the GitHub clients, say. Its `provide` pairs each with its
  value (`provides(service, value)`). Every feature's `provide` runs before any feature's `start`,
  and features reach a service with `use(service)` in `start`, `stop` or a handler, never in
  `provide`, so it doesn't matter which feature starts first. A feature lists the other features'
  services it uses in its `uses`, and `use` refuses one it doesn't list. What a feature tells others
  about, such as an account removed, is a member of its service. Lo doesn't start while a service in
  a `service.ts` or a feature's `uses` goes unprovided, or while features use each other's services,
  and only the feature a service is named for may provide it.
- `settings.ts` declares the settings the feature has, each with
  `defineSetting(key, schema, default, accepts)` from `settings/contract.ts`: a flat key
  (`diff.layout`), what its value may be as a Zod schema, the value without one, and what it accepts
  in words. The settings feature reads `settings.json` from the config folder, watches it, reports a
  value a schema refuses and uses the default, keeps every key no feature declared, and writes the
  file whole, atomically, only after main has checked the value again. Main reaches the values
  through the settings feature's `service.ts` (`use(settings).watch(setting, listener)`, which also
  declares the setting), the window through its `window/shared.ts` (`useSetting`, `changeSetting`),
  where a feature puts its section of Settings in the `settings.sections` slot with `defineSection`.
  `docs/settings.md` lists every setting; a test fails when one is missing.
- `migrations/001-<name>.sql`, `002-<name>.sql` and on create and change the feature's tables. At
  startup, before any handler can be asked anything, each feature's new migrations run in order,
  each in a transaction, and are recorded with their SHA-256.
  - A feature's tables, indexes, views and triggers are named `<feature>_…`. While a migration runs,
    SQLite's authorizer lets it read and write only its feature's tables, which may include FTS5
    tables, and use `json_each` and the like on them: it can't touch another feature's, end its
    transaction, attach a database, set a pragma or make anything temporary, and its triggers and
    views are compiled so their bodies are held to the same. Foreign keys to another feature's
    tables are refused too. So features apply in any order, and cleanup across features (an account
    removed, say) goes through main.
  - Never edit a migration once it has run: Lo refuses to start on a database where one has changed
    (line endings aside). Add a new one instead.
  - Lo also refuses a database holding a migration it doesn't have, which a newer Lo wrote.
- `window/index.ts` exports a `WindowFeature` by default. The window calls main through
  `client(contract)`, whose methods and types come from the contract.
- `window/shared.ts` holds what the feature's screens share: the slots it renders, each from
  `defineSlot<Props>('<feature>.<name>')`, and the few functions other features may call and the
  state they may read. Other features fill a slot by listing views in their `WindowFeature`'s
  `views`, each from `defineView(slot, { id, order, render })`, so a feature adds a view, a panel or
  a header item to another's screen without editing it. `<Slot slot={…} props={…} />` renders a
  slot's views in order, and `useViews(slot)` lists them for an owner that lays them out itself. A
  slot is named for the feature whose `window/shared.ts` exports it, and views go only in exported
  slots. Every view runs inside its own error boundary, from `<Slot>` or `useViews` alike: one that
  throws shows a short note in its place, and its error is logged. In a build run from source, it
  then stops the window too, so tests can't miss it.

Features share only through `contract.ts`, `keys.ts`, `service.ts` and `window/shared.ts`.
`pnpm check:boundaries` reads every file in a feature's folder that Vite could bundle, in any
folder, and refuses an import, an `import.meta.glob`, a `new URL(…, import.meta.url)`, a
`declare module` or a stylesheet's `@import` or `url()` that reaches anything else in another
feature's folder, or that folder itself. It follows each to the file it lands on, follows a glob's
`base` and symlinked folders as Vite does, and refuses glob options that would change what a glob
matches, and a module chosen at run time, except in a test or fixture nothing in a feature's folder
bundles. A shared file names what it shares: it exports none of its own feature's other files, or
what it imports from them, in any form but their types. Main code reaches another feature's
`service.ts`, and window code its `window/shared.ts`; each side's tsconfig holds only its own.

The database is SQLite through Node's built-in `node:sqlite`, in `lo.db` in the data folder: WAL
mode, foreign keys enforced, defensive. `src/main/database.ts` is the only module that uses
`node:sqlite`; everything else goes through its `Database`.

### The background process

Pure work, such as parsing, highlighting and diffing, runs in one background process, an Electron
utility process the window talks to directly over a MessagePort that main hands both of them. It has
Node, so it gets an environment main builds for it (nothing of main's, so no token), and never reads
files or the network for the window.

- A feature's jobs are a contract in `jobs.ts`, exported as `contract` (`defineJobs`: each job's
  input schema and reply type, held to the same rules as `contract.ts`), and their code in
  `background/index.ts` (`defineRunner`, the default export), found by `import.meta.glob`. The
  window runs them through `jobs(contract)`.
- Jobs take plain data: objects, arrays, strings, numbers, booleans and null, within limits. The
  window refuses anything else before sending, and the process checks every message, then each job's
  input, before anything runs.
- Jobs wait for one of as many workers as the machine has cores, each a thread of its own, under a
  deadline and a cap on its JavaScript heap (10 s and 256 MB unless the job sets its own). Past
  either, the job fails as `timeout` or `memory`. The deadline starts when the job's code does, once
  its worker has loaded the process's script, so neither the wait for a worker nor the load counts
  against it. A worker gets 10 s of its own to load, past which the job fails as `busy`, as it does
  when too many jobs are waiting. Every message with an id gets an answer, and the window gives up
  on one after a minute (`unanswered`). The window can cancel a job it sent (`run`'s `signal`): one
  still waiting never starts, and one running has its worker stopped; either fails as `cancelled`.
- Main watches the process's memory and stops it past 2 GB, since memory outside the heap
  (WebAssembly's) can't be capped any other way, and treats a fatal error the same way. Jobs the
  window had sent fail as `restarted` at once; the process starts again, waiting longer after each
  quick failure, and the window gets a new port.
- A build run from source with `LO_TEST_JOBS=1` adds the smoke test's jobs and exposes the window's
  connection to it, and takes another cap from `LO_BACKGROUND_MEMORY_CAP_MB`. A packaged build
  ignores both. Main refuses a cap it couldn't hand the process whole, such as one too large to be a
  whole number exactly: it logs a warning and keeps 2 GB.
- Main always puts the cap in the process's environment, and the process sizes its pool of workers
  from it. A missing or invalid cap is a startup error: the process reports it and exits, and main
  starts it again like after any other exit. It never runs on a pool without a bound.

### Git

Only main runs git, through `@lo/git`, and the background process never sees git or a token.
`src/main/git.ts` holds it, and features reach it as `git` in their context.

- Once the window is up, or a few seconds after it opens if it never says so, main looks for git: on
  a Mac, Apple's git once the Command Line Tools are installed, then each on `PATH`, then the
  system's usual folders, and the newest new enough wins. `app.info` says what it found, `checking`
  until it has, and `app.git` pushes each answer. Asking again (`git.check()`) finds a git installed
  since.
- With git, main opens the cache, `Lo` in the system's folder for caches (`Lo Dev` for a build run
  from source, or `cache` in `LO_USER_DATA_DIR`), as `git.cache`, and cleans it up without anyone
  waiting. `git.setCap()` sets the size it's kept under.
- Every git gets an environment of Lo's own making, never main's, and only a fetch gets the
  account's token, from a source read as each fetch starts. Fetches take the proxy Lo's own requests
  take.
- Lo quits once every git has stopped, a look for git's included: each is asked to stop, then killed
  with what it started.
- A build run from source takes the git to run from `LO_GIT`, a path or `none`, and fetches from
  `LO_GIT_REMOTE`, a server or folder on this machine, for its tests. A packaged build ignores both.

### Accounts

Only main talks to GitHub, through `@lo/github`, and only main holds a token. The `accounts` feature
provides `accounts.github` to the others: each account's client and poller, a client for public
repositories, which account opens a repository, and the pull requests opened lately.

- Each account's grant (its token, and the refresh token that renews it) is one row in the database,
  encrypted whole by Electron's `safeStorage`, which keeps its key in the system's keychain. Where
  the system has no keychain to encrypt with (a Linux desktop where no keyring answers, or
  Chromium's `--use-mock-keychain`), Lo neither keeps nor reads a token, except in a test run. On
  Linux what decides is how the ciphertext is marked, never the store `safeStorage` reports, which
  is only the one chosen for the desktop: Chromium marks its built-in key's `v10`, the Secret
  Service's and KWallet's `v11` and the portal's `v12`, and Lo refuses `v10`.
- Every request to GitHub goes through Chromium's network stack (`src/main/fetch.ts`, on
  `net.request`), so it takes the system's proxy, with nothing kept in Chromium's cache and no
  cookie. Electron's `net.fetch` isn't used: it fails a redirect GitHub's client asks to see, and
  the client follows redirects itself, only to where the token may go.
- Each account's requests go one at a time through its poller's queue. One whose answer hasn't begun
  within 15 s (GitHub gives up on a request after 10 s), or hasn't all come within 30 s, is given up
  as an answer lost, so the queue goes on: a read is tried again later, and a write may have been
  done, so it's never sent again by itself. An upload has a limit of its own. The one exception to
  the queue is the read of whether an account can write to a repository, which attachments ask first
  (`comments.attachable`): it's read with the account's client, outside the queue, with the same
  limits, so nothing waits on it. A view's first read of its review threads goes ahead of polls and
  of the tab's other reads while it's on screen, as an opening tab's overview reads do, since the
  diff's first draw waits on it.
- Each account's poller keeps what it read in the database, read back only by the build of Lo that
  wrote it (a hash of main's output folder), talking to the same GitHub.
- The window gets each account's summary (its login and name, how it signed in, whether it's signed
  out, and whether its token waits for a keyring), never a token.
- Signing in is GitHub's device flow, one sign-in at a time. Before asking GitHub for a code, Lo
  checks it can keep a token (on Linux, by what a fresh encryption is marked), so a desktop with no
  keyring is refused before anyone goes to GitHub. The window shows the code; main copies it and
  opens GitHub's own page for codes, never one GitHub's answer names. Polls follow GitHub's
  `interval` and `slow_down`, and stop once the dialog closes, another sign-in starts, the window
  goes or Lo quits. A build run from source takes another wait between polls from
  `LO_DEVICE_POLL_MS`, for its tests; a packaged build ignores it.
- Accounts can be imported from `gh`, found as git is: on `PATH`, then the system's usual folders,
  passing over one that someone besides this user or root could change. gh runs with an argument
  list, never a shell, under a time limit, with an environment of Lo's making that holds no token
  (`GH_TOKEN` and the like never reach it). Its tokens are read through a pipe, checked with
  `GET /user` to be the account's, and kept as any other. Once GitHub refuses one, Lo reads gh's
  newer token, which gh renews itself.
- As Lo quits, the feature saves any renewed token the keychain refused, waiting for renewals GitHub
  is answering only as long as its own limit for stopping allows.
- A build run from source talks to a GitHub on this machine when `LO_GITHUB` names its address
  (`http://127.0.0.1:<port>`, serving GitHub's API, website and uploads under `/api`, `/web` and
  `/uploads`, and its image hosts under `/images/<host>`, as the replay server does), which makes it
  a test run. It adds the account whose token is in the file `LO_TEST_TOKEN_FILE` names as it
  starts. It runs the gh `LO_GH` names (an absolute path, or `none`) rather than one it finds, and a
  test run runs none unless `LO_GH` names one, so the gh on `PATH`, which holds the tokens of
  whoever runs the tests, never sends one to the test's GitHub. It opens web pages with the program
  `LO_BROWSER` names, rather than the system's browser, so a test opens no browser. A packaged build
  ignores all four.

### A pull request's tab

The `tab` feature keeps the window's tabs and draws a pull request's: its header, two banners at
most, the left panel, the middle and the right panel other features fill through its slots, and its
status bar.

- Main watches each pull request's tab with its account's poller, so the strip has its title, and
  the one on screen most often. A tab keeps the account it acts as, and its repository's name as
  GitHub gives it, so it comes back as it was, offline too. A tab with no account yet works it out
  as a link does the first time it's shown: the one that can see the repository, the one remembered
  for it, nobody for a public repository, or a question.
- Main keeps the strip's order in `tab_tabs`. A tab dragged along the strip, or moved a place by
  `⌃⇧PgUp` and `⌃⇧PgDn`, moves there through `tab.move`, so the tabs come back in that order after
  Lo restarts. A step with no tab named moves the one on screen as main has it, so two quick presses
  move it two places.
- The strip shows the first tabs in the order and folds the rest into "N more". A tab past them that
  comes on screen (chosen from "N more", opened by a link, restored, or reached by `⌘9`) moves into
  the last place shown, and the tab there folds, so a drag or a key moves exactly what's shown.
  `⌘⇧]`, `⌘⇧[` and the moving keys stay within the tabs shown (`within` in `tab.select` and
  `tab.move`).
- The first time a tab is shown, main reads the pull request and fetches it into the local copy
  through `@lo/git`, with the account's token, read as each fetch starts. A fetch that fails is
  tried again after 5 s, doubling to 5 minutes, unless waiting won't help, and a tab reads what an
  earlier fetch brought while GitHub can't be reached.
- The head on screen is GitHub's when the tab opened. A newer push says so in a banner, and moves
  nothing until it's loaded.
- Other features' banners go in the `tab.banners` slot. Each view there says whether it shows a
  banner for a tab (`shows`) and when that may change (`subscribe`), so the tab makes room only for
  the banners it has.
- A tab holds a whole stack: a view of each layer the reader has shown (`tab.layer`), each a pull
  request's tab as described here, with an id of its own: the tab's for the pull request it opened
  on, and `<tab id>:<number>` for another layer. What main and the other features keep of a pull
  request's tab, they keep for each view, so each layer keeps its place, folds, comparison and
  overview until the tab closes. Only the view on screen is drawn. `tab.tabs`' `list` and `onTabs`,
  and the window's `activeTab`, name a pull request's tab by its view on screen, so what follows the
  tabs follows the layers. `tab_tabs.layer` keeps the layer on screen, and a tab comes back at it,
  with only that view made. The strip shows the layer on screen's title and state, and the window's
  title where it is in its stack. The stacks feature tells the tab which stack each holds
  (`setLayers`), so a link to a layer shows the tab opened on it, or else the first whose stack
  holds it, at that layer. Two tabs that turn out to hold one stack stay two.
- The stacks feature tells a view where its layer's diff starts (`compareFrom`): the commit the
  layer below ends at, or none for its base branch. The local copy fetches that commit by its ID if
  it lacks it, and reports where the head meets it as the merge base, the commit itself when the
  head holds it, never earlier than where the head left its base branch. A commit it can't get
  leaves the merge base on the base branch, and `from.missing` says so. The tab says whether the
  diff was drawn at the head on screen from that start (`drawn`); a new start clears it.
- A tab says it's offline once GitHub has been out of reach for 25 s, so a blip says nothing. A
  build run from source takes another wait from `LO_OFFLINE_AFTER_MS`, for its tests; a packaged
  build ignores it.
- The window gets what it shows on `tab.pull`, `tab.files` and `tab.local`, each sent only when it
  changes, and asks for all three with `tab.state`. None of it holds a token. `tab.copy` puts up to
  1 MiB of text on the clipboard, and `tab.openExternal` opens pages on `https://github.com/` only,
  for every feature.
- Its smoke test opens rozed-dev/e2e#80, whose repository `testing/fixtures/app.sh` builds with
  GitHub's commit IDs, as `LO_GIT_REMOTE`, while the replay server answers from the `app_e2e`
  cassette, recorded from the app itself (`testing/README.md`).

### A pull request's files

The `tree` feature draws a pull request's tab's left panel: the repository's files at the head on
screen, as a tree, with the files the pull request changes marked, or those alone in review order.
Main follows each pull request's tab through `tab.tabs` (`pull`, `onPull` and `clone`).

- Once the tab's local copy is ready at the head on screen, main lists the files and what changed
  from it: the files from the commit's trees, what changed from the merge base with the base branch
  (renames found, both sides downloaded first, at most 200 MB), and what's generated from the head's
  `.gitattributes` and the lockfiles `@lo/review` names. Until then it reads GitHub's tree of the
  head and the pull request's files from the REST API. A tree GitHub lists only in part, or one that
  couldn't be read, leaves the changed files alone, saying why. What the copy says replaces what
  GitHub said, and a new head on screen starts again. A stack's layer compared with the layer below
  lists what changed from GitHub's comparison of the two commits (`readComparison`), 300 files at
  most, until the copy has worked out where the head meets that commit, and the pull request's own
  files when GitHub can't compare them, without asking again. A new start reads what changed again,
  and keeps the files. GitHub is asked only about a head it gave, never one restored from what Lo
  saved, and a read that fails is tried again after 5 s, doubling to 5 minutes.
- Up to 20,000 files go to the window whole, on `tree.state`. Past that, main sends the root's
  entries, and the window asks for each folder's (`tree.folder`) as it opens one, 500 folders a
  request at most. Past 500,000, the tree shows only the changed files.
- A path travels as its text, with its bytes in hex beside it when they aren't UTF-8, since git
  stores paths as bytes. The window keys a file by its text, or by a NUL and its bytes for such a
  path (`fileKey` in the contract); that key is the file's id in targets and to other features. V8
  hashes a long string by its length alone, so nothing keys a map by a path longer than 1,024 bytes.
  A changed file with one still shows everywhere, in both orders, `fileOrder`, `find` and the
  counts, known by a NUL, `#` and its path's SHA-256: under the deepest of its folders short enough,
  its name shortened in the middle, with the whole path in its tooltip and from Copy path. An
  unchanged one is left out, and counted in a note. A listing whose paths come to more than 32 MB
  shows only the changed files.
- `tree.find` finds files by name, the changed ones first, 100 at most, matching in chunks so main
  stays free; a newer search for the same tab stops the one before.
- Other features reach the tree through its `window/shared.ts`: `fileOrder` and `useFileOrder`, the
  changed files in the order the panel lists them, which the diff shows them in; `followFile`, which
  the middle view calls with the file on screen, for the tree to mark and scroll to; and
  `onShowFile`, through which the diff shows a changed file the tree asks for, and the whole-file
  view any file. Until a view has asked, `⏎` and "Whole file" say there's nowhere to show the file.
- A click on a row, or `⏎` on it, makes it the row the keyboard is on, in the tree. On a changed
  file, the diff puts the file's header at the top of the screen, on screen or not, however the file
  shows and wherever the diff is in loading it: a jump, which `⌃o` comes back from. Near the end of
  the diff it makes room after the last file to get there, as a fold does to keep what's on screen
  in place; the room goes once it's off screen. Until the reader moves, a banner coming over the
  diff takes the header down with the diff's box, never over it.

### A pull request's diff

The `diff` feature draws a pull request's tab's middle: every changed file in one scroll, in the
order the tree lists them, through `@lo/ui/code`'s diff view. It works that order out from its own
files with the tree's `orderIn`, so the view is drawn in it from the start, before the tree has the
files, and keeps it until the reader orders the files another way: what the files say of themselves
changing, as when the local copy marks one generated, doesn't reorder a drawn view.

- Main lists each changed file's versions at the head on screen (`diff.state`): from the local
  copy's comparison once it's ready, with each side's blob and size, and from GitHub's list of the
  pull request's files until then; or, while two revisions are compared, from their comparison in
  the local copy, which a new comparison starts again. A stack's layer's view starts where the
  stacks feature says (`compareFrom`): from GitHub's comparison with that commit, 300 files at most,
  until the local copy is ready compared with the same commit, which the diff waits for once the
  copy is ready at the head. When GitHub can't compare them, for any reason, the pull request's own
  files stand in, and `uncompared` says so. A new start is a new view, never swapped in place, and
  the whole-file view and an overview's code read their base side again. Each says how the file
  starts out: shown, closed as generated, kept out as large until `za`, binary, or unchanged. Files
  are named by their place in the list, never by their paths.
- The window asks for files' texts in batches (`diff.texts`), first files first, and the background
  process diffs them (`diff.files`), finds moved code (`diff.moves`) and highlights them
  (`diff.highlight`). The view is drawn once every file that shows its lines has its diff, and the
  highlighting follows. A new order, or other files, is a new view, which puts the cursor's line
  back where it was on the page, or else what was at the top of the screen. Another comparison of
  revisions is a new view with the cursor's file at the top, if it has that file. A batch that fails
  whole is tried a file at a time, and closing the tab cancels its jobs.
- GitHub's diff is drawn as GitHub gives it: its hunks at their real line numbers, and placeholders
  between them that stay collapsed. Its lines are never diffed again; only the words inside each
  change are looked for. A file whose hunks reach past line 100,000 waits for the local copy, as
  does one past the first million lines GitHub's diffs of the tab's files draw between them, counted
  in the panel's order, and a batch's files go over several jobs so no job draws more than 200,000.
  When the local copy's files are the same ones, each is swapped in place as its diff arrives, and
  what was at the top of the screen stays where it is; otherwise the view is drawn anew once they're
  all in. Nothing on screen moves meanwhile: a file on screen whose new lines would draw in other
  rows (`keepsShape`) keeps GitHub's lines, diff and colors, and every file on screen its moved-code
  labels, until it's off screen once the reader stops scrolling, moves the cursor, or opens or
  closes it, and then takes the loader's latest; a file off screen changes at once, how it starts
  out included (generated, large, or no longer either).
- Once the view is drawn, the window says so (`diff.drawn`, with where it starts), and the tab keeps
  that head on screen, even one it took from what it saved: a newer one from GitHub is offered as a
  newer push.
- `diff.layout` and `diff.whitespace` are settings; `gi` and `gw` change them.

### Revisions

The `revisions` feature lists a pull request's revisions, one for each push to its branch, and says
what its tab compares: the whole pull request at the head on screen, or one revision with another.
The diff and the tree follow it through the feature's `revisions.comparisons` service.

- Main builds the revisions with `@lo/review` from the push history the account's poller keeps
  (GitHub's GraphQL `PullRequestRevisions` and the activity API) and the heads every account's
  poller saw (`revisions_seen`), once the history's head is GitHub's newest the tab knows of. Once
  the local copy is ready, it fetches every revision's head into it, and the tips of the base branch
  each was pushed on, and works out where each branched off. A revision whose head GitHub no longer
  has, and the copy lacks, is no longer available, and can't be compared.
- Two markers say where the reader left off: the commit of the account's last review, from the push
  history, and "last seen here", the newest revision the diff was drawn with when the reader last
  left the pull request: for another tab, as the tab closes, or as Lo quits (`revisions_lastseen`).
  Rows go with their account, and 30 days after their pull request closed (`revisions_closed`),
  unless noted since.
- A tab opens on `defaultComparison`: the more recent marker's revision against the head on screen,
  or the whole pull request, saying "Nothing new since" when a marker is on that head. Once anything
  is drawn, what's compared changes only when the reader asks. When "last seen here" asks for a
  comparison, the diff waits for it for 1 s, about as long as a large pull request's diff takes to
  load and draw anyway. A comparison that isn't ready by then, or that only the push history asks
  for, as one since the reader's last review, is offered in the note over the diff instead, and `gv`
  opens the picker at it. A build run from source takes another wait from `LO_COMPARE_WAIT_MS`, for
  its tests; a packaged build ignores it.
- The window holds back what a tab shows first, the overview or a place in the diff, for
  `HOLD_LIMIT`, and past it shows the diff, or the file whole. A build run from source takes another
  bound from `LO_HOLD_LIMIT_MS`, which main hands the window in `app.info`, so a test that isn't
  about the bound doesn't race it on a busy machine; a packaged build ignores it.
- Two revisions are compared in the local copy with `compareRevisions`, across a rebase when the
  base moved, once it has both: until then the comparison on screen stays, and the note over the
  diff says what waits. The comparison is made once, for the diff and the tree, and says how it
  went: across a rebase, retargeted, or conflicted, with the files the replay conflicted on marked.
  A comparison that can't be made says why, and the whole pull request shows.
- Loading a newer push moves a comparison that ended at the head on screen to the new one, keeping
  where it starts.
- The window gets each tab's revisions on `revisions.comparison`, and asks for them with
  `revisions.list` and for a comparison with `revisions.compare`. The header's button shows what's
  compared ("r1 → r3"), and opens the revision picker, as `gv` does: `j` and `k` move, `Space` makes
  a revision an end, `⏎` compares the ends, and `r`, `s` and `w` compare since your review, since
  you last looked, or the whole pull request. The note over the diff, in the diff's `diff.notes`
  slot, says what's compared, one line high from the first frame. While two revisions are compared,
  the tree marks the files that changed between them, and steps the pull request's other changes
  back.

### Stacks

The `stacks` feature finds the stack a pull request's tab is in: the open pull requests that sit on
each other with it, by base branch, by shared commits, or as a GitHub stack, as `@lo/stacks` finds
them.

- Every account's poller looks up the merged pull requests a watched repository's stacks link
  through, after each new list of its open pull requests (`@lo/stacks`' `lookUpMerged`), so a layer
  whose lower layer merged still sits where it did.
- For each repository a pull request's tab is in, main keeps its stacks (`stacksOf`), from the
  account's poller's list of its open pull requests, its rulesets, and the merged pull requests the
  layers' state found below layers GitHub moved. They're worked out again, once for all the
  repository's tabs, when any of those changes. Until the rulesets have been read once, a tab's
  stack is unknown, and a tab that acts as nobody has none to show.
- A tab shows its stack when it has two layers or more, when its pull request is in a GitHub stack,
  or when it needs a rebase on a merged layer. Only the tab on screen reads its layers' state
  (`poller.stackLayers`, by the layers' node IDs): their reviews, checks, places in the merge queue
  and viewed counts. It reads them again when a list fetched after the state shows a layer at
  another head, and stops once the tab closes or its pull request leaves the stack. It also reads
  which pull requests have an overview, once for the repository (`overviewRefNumbers`, through
  `poller.readCached`, kept with its ETag and read again on the 5-minute refresh).
- Where the layer on screen's diff starts is `@lo/stacks`' `layerStart` for its head, once the list
  the stack was found in has the head on screen (`planStart`). Before the diff is drawn, main sets
  it on the tab (`compareFrom`). Once it's drawn, a different start is only offered: `stacks.stack`
  carries the offer, a banner in the tab's `tab.banners` slot shows it, and its button calls
  `stacks.useStart`, which starts the diff again from there. A start that isn't known for the head
  on screen goes back to the base branch while nothing is drawn. When the local copy can't get the
  commit, the stack's notes say so.
- When the pull request on screen merges or closes, its row stays where it was, among the other
  layers as the stack now has them, while they're still one stack.
- The window gets each tab's stack on `stacks.stack`, and asks for it with `stacks.state`: its rows
  in the order `]s` walks them, how it was found (`found`, which the tree words), the offer to make
  it a GitHub stack while `planConversion` has a plan for the layer on screen, and notes on what Lo
  couldn't read, cycles it broke and layers that need a rebase. Titles, logins and branch names are
  GitHub's, as text, and go through `withoutBidi` before they're drawn.
- As a tab's stack changes, main tells the tab its layers (`TabService.setLayers`), so a link to any
  layer shows the stack's tab.

The window draws the stack's tree at the top of the left panel (`features/stacks/window/Stack.tsx`),
and nothing while there's no stack.

- A layer shows in its tab through `tab.layer`, never `select`: the tab keeps a view of each layer
  shown, each with its own place. Showing one isn't a jump, so it's not in `⌃o`'s history.
- `]s` and `[s` walk the rows in order, anywhere in a pull request's tab, and refuse at either end.
  `-` in the file tree goes up to the tree, where `j` and `k` move, `⏎` and a click show a layer,
  `gx` opens it on GitHub and `Esc` goes back to the middle. A layer's menu has the same, and `gS`.
- The layer on screen's overview mark and viewed count come from its tab, as they change; the other
  layers' from main.
- A tab restored at a layer whose pull request is gone offers to show the layer it was opened at.

`gS` makes the chain the pull request on screen is in a GitHub stack
(`features/stacks/main/conversion.ts`), and the confirmation is the only way anything is sent.

- Main plans it (`stacks.plan`): first Lo's own reasons (a tab that acts as nobody, a conversion
  already running in the repository), then GitHub's stacks holding the pull request, read through
  the account's queue (a 404 means the repository has no Stacks API, and an answer that disagrees
  with the list has it listed again), then whether a layer is in a merge queue, from the layers'
  state, then `@lo/stacks`' `planConversion`. A refusal lists every reason in words. A plan is kept
  in main under a random key, a tab's last one only, and the window confirms the key
  (`stacks.convert`): it never names a change.
- Each plan runs once: it's taken from the plans kept before anything is sent. Its changes go in
  order through `poller.runConversionStep`, stopping at the first GitHub refuses or that fails. They
  wait out GitHub's pauses, which the dialog says, and the reader's stop (`stacks.stop`) gives up
  the next one before it's sent. Nothing is ever sent again by itself; a change whose answer was
  lost counts as maybe done.
- A conversion that failed or stopped can put back what it changed, once the reader asks
  (`stacks.putBack`): a stack it may have made, only while GitHub's stack holds exactly the plan's
  pull requests (`poller.unstack`, which refuses as `stackChanged`), then the base branches it
  changed, last first, through `poller.retarget`. A base branch changed elsewhere since is left and
  named, and so is an add to a GitHub stack that may have gone through. "Try again" plans anew, once
  the repository's pull requests have been listed since.
- A repository has one conversion at a time, and none outlives Lo: as it quits, what isn't sent is
  given up on, and no plan is kept. The window hears how each goes on `stacks.conversion`.

### Opening pull requests

The `open` feature opens links: typed or pasted in the open box (`⌘L`, and `⌘O` on macOS), a row of
Recent pull requests, and links from other apps. Each is untrusted text, read the same way in main
(`features/open/main/link.ts`).

- A link to a pull request, its files, commits or checks, over `https`, `http` or `lo://`, opens in
  its tab, through the tab feature's `tabs` service. Main works out the account first: the one that
  can see the repository, the one remembered for it, or the one a Recent row was opened with while
  it still can. When several can, the tab asks; when none can, a public pull request opens read
  only, without signing in: no poller watches it, so it's never among the recent ones, and its
  header says revisions need an account. When the account Lo would use can't check the repository,
  as when an organization restricts Lo, the tab says why, with GitHub's link to fix it.
- Any other `https` link goes to the system's browser, unless Lo is that browser or the link comes
  straight back from it, which would send it round in a circle. From the window, which main can't
  tell from a page that made a link up, a plain `http` link goes nowhere, and the open box offers to
  copy it; from another app, it goes to the browser as it came. A `lo://` link that isn't a pull
  request's opens nothing.
- The open box shows what a link opens and as whom, or why it can't, before anything opens. As it
  opens it asks main for the pull request link on the clipboard, which comes back written as Lo
  writes one; nothing else on the clipboard reaches the window.
- Other apps hand Lo links as `open-url` events (`lo://`, and web links from a link router), and as
  the arguments of a second launch, which hands them to the Lo running and quits. A packaged Lo
  registers itself for `lo://` as it starts.
- "Install command-line tool", in the macOS app menu, Settings and the command palette, with no key
  since it's done once, writes `lo`, a shell script that takes one argument, refuses anything but a
  `lo://`, `https://` or `http://` link, and passes it on quoted: on macOS to
  `open -n -b com.scornz.lo --args`, since `open` drops the arguments of an app that's running, in
  `/usr/local/bin` once the system's prompt for an administrator allows it, or `~/.local/bin`; on
  Linux to Lo's program, in `~/.local/bin`. It never replaces a `lo` it didn't write, or one it
  can't read. A build run from source writes it in `LO_COMMAND_FOLDER` when that's set, without
  asking, and a packaged build ignores it.

### The welcome screen

The `welcome` feature draws over the Recent tab, through the tab feature's `tab.cover` slot, while
no account is signed in: none is, or GitHub refused every one. Other tabs, a pull request opened
without signing in and Settings among them, are drawn as they are.

- It offers signing in (`⏎`, through the accounts feature's dialog), importing from `gh` when Lo
  finds one, a box that opens a public pull request through the open feature, the optional steps in
  its `welcome.setup` slot (installing the `lo` command, which the open feature does, and sending
  pull request links to Lo, with the rules for Finicky, Velja and Choosy in `docs/link-routers.md`),
  and a notice with "Check again" when Lo can't find a git it can run. `welcome.checkGit` asks main
  to look for git again (`git.check()`); what Lo finds reaches the window on `app.git`.
- Under the screen the Recent list is `inert`, so no key or reader reaches it. The screen is a form
  like Settings: its scope has `data-lo-tab="browser"`, so `Tab` walks its controls. `⏎` presses the
  control with focus, opens the link in the box, and signs in anywhere else on the screen.
- Another feature's step goes in the slot as a `SetupItem` from `@lo/ui`, in `order`.

### The timeline

The `timeline` feature shows a pull request's GitHub timeline as the third of its tab's middle views
(`tab.middle`, order 30, after the overview and the diff).

- Main reads a view's timeline (GitHub's GraphQL `Timeline`) and what goes beside its description
  (`PullRequestSidebar`: labels, reviewers, assignees and draft state) the first time the window
  shows it, through the account's poller, which keeps both current from then on (`TIMELINE`,
  `PULL_REQUEST_SIDEBAR`). The window asks with `timeline.show`, and gets each change on the
  `timeline.timeline` and `timeline.sidebar` topics. A tab acting as nobody reads none, and asks the
  reader to sign in; a run of a stack's layers has none of its own.
- `window/rows.ts` turns what main sent into rows, plain functions tested alone: the description
  card, a note of older items not read, consecutive commits as one push split where a revision ends,
  with its last commit's checks, comments and submitted reviews as cards, a force-push that can
  compare its revisions, and every other item as a one-line event in Lo's words.
- The rows are one listbox, the focusable element, with the row the keyboard is on as its active
  descendant: `j` and `k` move, staying put at the ends, and `gx` opens the row on GitHub. `Tab` and
  `⇧Tab` go through the links and buttons of that row, round through the list, and `Esc` gives focus
  back to the list. A row is a `row` target, the keys' from the scope and a right-click's from the
  row clicked: its menu, and the palette for the row the keyboard is on, offer what its buttons do,
  each listed only for rows that have it.
- What main sends while the timeline is on screen waits for the reader's next key, click or scroll
  (`window/holding.ts`, `window/store.ts`), except what their own write changed, which the comments
  feature tells it of (`onCommentWritten`) and which shows as it comes, for a minute at most. As it
  goes on screen, what the reader is at keeps its place (`window/place.ts`): the box at the end
  while they write in it or the list is at its end, or else the keyboard's row while it's on screen,
  or else the first row on screen. When the keyboard's row goes, as a comment deleted, the keyboard
  moves to its neighbour, with nothing scrolled.
- The box at the end comments on the pull request itself, and your comments there have Edit and
  Delete (`i`, `dd`), drawn through the comments feature's `PullCommentBox`, `PullCommentEdit` and
  `PullCommentNote`. `window/yours.ts` says which row a key acts on, and refuses the rest in Lo's
  words.

### Posts

The `comments` feature draws a post's text, a comment's, a review's, a review comment's or a
description's, for the timeline and the diff's threads alike, with its `Post` component.

- A post shows its Markdown, through `@lo/markdown`, until the HTML GitHub renders for it arrives,
  then GitHub's rendering, read as untrusted (`githubTree`). Both become a tree in the background
  process (`comments.render`), with the pull request's repository as what references refer to.
- The window asks main for posts' HTML (`comments.bodies`, read by the poller's `renderedBodies`) as
  they come on screen or near it, a hundred at most an ask, one ask at a time for each view. The
  HTML stays in the window's memory, never in main's or the poll cache, since its images' addresses
  are signed for a few minutes; a post whose images are on screen is asked for again once its HTML
  is 4 minutes old. The HTML is held for the Markdown it was asked for: an edited post shows its new
  Markdown at once, and is asked for again. Main offers the same read to other features as
  `comments.bodies`.
- A thread's collapsed line and the threads panel's rows show its first comment's opening as one
  line of plain words, never its Markdown. The window asks the background process for them
  (`comments.excerpts`, 500 comments or a megabyte of Markdown an ask), which reads each comment in
  full with `@lo/markdown`, raw HTML as the words it shows (`plainText`'s `html`: an `<img>` is its
  alt text, or "image"), and cuts the words at 120 characters, after reading, so none of a link or
  an image's syntax is left in them. The window holds the newest 2,000, joins an ask in flight for a
  comment wanted again, and the line shows none until its words are read.
- The threads panel lists the threads main sent once their openings are read (`listed`, in
  `window/threads.ts`), and keeps the last list until then, so a row is never drawn without its
  words and nothing in it moves as they come: an edited comment's row changes in one step. The diff,
  the tree and the cards take main's threads at once.

### Writing comments

The `comments` feature writes review comments from the diff: `c` on a line, the lines `v` selected
or a file's header, `C` to post right away, `s` for a suggestion, and `c` on a file in the tree.

- The window opens a comment box through the diff (`writingDiff(tab).compose`) and draws its frame
  (`window/Frame.tsx`); `window/boxes.ts` keeps each view's boxes, and `window/writing.ts` works out
  where a comment goes, as plain functions tested alone. Main says which lines GitHub takes a
  comment on (`comments.commentable`): from GitHub's patch at the latest head, or else the local
  copy's from where the revision branched off.
- Main keeps every box's text as a draft (`comments_drafts`), saved 300 ms after typing stops and at
  once as the box closes or the window goes, by account, pull request and place, until GitHub takes
  it. Drafts saved before Lo started, or before the window was loaded again, reopen, unfocused, once
  their view's diff draws their line. A push moves a draft to the newer revision when its file
  didn't change. A box open in the diff when the diff is drawn again stays in its box (`kept`, with
  its editor as `Composer.keep()` gave it): the diff drawn anew opens it as it was, whatever the
  overview did meanwhile, on its line; else under its file's header in that diff, as for a file
  closed as viewed, still on the line; else under its block if the overview has it; else nowhere,
  and the status bar says it was kept (`keptAway`) until its line or block takes it (`placeKept`).
  `kept` lasts until that diff has placed it or couldn't. Focus comes back only to a box that had
  it, with no key, click or wheel since and focus where the redraw left it.
- `comments.send` plans each write with `@lo/review`'s `YourReview` and sends it with the poller's
  `sendReview`, one write to a pull request at a time, each planned from your pending review as read
  after the last one's answer. The box's text is held, read-only, while it's sent. A refusal keeps
  the draft and says why in the box. From the send until GitHub's answer, the draft is marked sent,
  with when, in the database. When the answer is lost, the mark stays, a restart included, and the
  draft can't be sent again until main's own read of the threads, made 10 s or more after it was
  sent, settles it, even after a restart: found among your comments made since, by GitHub's clock,
  the box closes; not found, or not read, the box says so. While the read can't be made, as offline,
  it stays checking and main tries again. Text changed since it was sent stays as the draft. Nothing
  is sent again by itself, and nothing is sent while GitHub can't be reached.
- A comment sent to post at once (`⌥⏎`) while you have a pending review joins it, since GitHub posts
  nothing else from you until it's submitted, and the notice says so ("Added to your pending
  review"). Main says it did when it planned the comment into your review, and for a reply when
  GitHub's answer says it joined a review Lo hadn't read (`joined`). One whose answer was lost says
  it too, once the read that settles it finds the comment pending in your review
  (`comments.joined`).
- The box's keys (`⌘⏎`, `⌥⏎`, `⌘⇧V`, `⌘⇧A`, `Esc`) are declared in `keys.ts` as `editor` commands
  but run by the box's editor (`createComposer`'s keymap in `@lo/ui/code`), as its own: the registry
  lists them in key help and `docs/keys.md` and checks them for clashes, and never runs, swallows or
  offers them, so the editor and the summary's `⌘⏎` hear every key as before. The keymap file can't
  rebind them, and a `vim` line can't map them, as the editor runs the four keys with a modifier
  before Vim's. The foot's labels read the declarations (`window/boxkeys.ts`), and
  `window/boxkeys.test.ts` presses each declared key in a real box. Change a key in both places.
- Files dropped on a box, pasted into it or picked with "Attach" (`⌘⇧A`), ten on their way into a
  box at a time, are attached (`window/uploads.ts`): each goes in at the cursor at once as a
  placeholder, the background process checks it and takes its metadata out (`comments.prepare`) from
  the bytes of the window's own `File`, and `comments.upload` hands those bytes to main, which never
  reads a path the window names. Main checks the kind, size and first bytes again, and that the
  account can write to the repository, then uploads through the poller's `upload`, one at a time for
  each account, saying how far it has gone on `comments.uploads`; `comments.cancelUpload` gives one
  up. The placeholder becomes the file's Markdown, or goes when it's refused, fails or is cancelled;
  one the reader took out meanwhile leaves its row offering "Insert". When GitHub answers Not Found
  though the account can write, main reads gh's token for that login (`accounts.github`'s `ghToken`)
  for that upload alone, never keeping or logging it, and sends it once more. Once a view's diff is
  drawn, `comments.attachable` says whether its account can write to the repository, read with the
  account's client outside its poller's queue, so no read waits on it. Where it can't, or GitHub
  takes no uploads with Lo's sign-in and gh has none, the view's boxes take no file, and an image's
  `https` address pasted or dropped goes in as an image; a file dropped before main said goes in,
  and out again before it's sent. Nothing is uploaded again by itself. A placeholder's address holds
  a token made for its upload (`lo-upload:` and 16 hex digits), so only one Lo wrote counts as one.
  A comment, or a review's summary, isn't sent while a file is on its way into it, nor while its
  text holds a placeholder whose upload isn't under way, as after a restart; the box names the file,
  and the reader takes the placeholder out. A box's uploads are given up as its draft goes, and a
  summary's files go once the review is submitted.

### Acting on review threads

On a thread in the diff, `r` replies, `x` resolves or unresolves it, `i` edits your newest comment
and `dd` deletes it, as do the card's buttons and its right-click menu (`window/acts.ts`). A key
acts on the thread `]t` landed on, or the only one the view has drawn on the cursor's line or under
the file's header (`threadsDrawn`), never one placed there that hasn't come on screen yet. `]t`
stops at each drawn thread, so one of several on a line, or on a file, can be picked. The threads
panel's `x` resolves the thread the keyboard is on, through the same function.

- A reply's box and an edit's are comment boxes, kept by their thread (`reply` and `edit` places),
  and drawn right after the thread's card. The code view keeps a box for each place and name, so a
  reply's box and a new comment's on the same line both stay open.
- An edit's draft keeps the text it started from (`base`, in `comments_drafts`), GitHub's as the
  card showed it when `i` started it (`comments.editing`), through a restart. `comments.edit` reads
  the comment afresh (`reviewComment`) and saves only if GitHub's text is still that one
  (`beforeEdit`); otherwise the box keeps the text and offers to discard it.
- `comments.resolve` and `comments.remove` go in their turn among the pull request's writes, like a
  comment. A delete reads the comment afresh first, and goes only if it's as the question showed it
  (its text, whether it's pending, whether it's its thread's only comment). Lo changes only your own
  comments.
- A write whose answer is lost is never sent again by itself: main reads the comment or the threads
  10 s or more after it was sent, and `comments.acts` says how it stands meanwhile, which the card
  shows, with "Try again" once Lo found it didn't go or can't tell.
- A thread the reader acts on is claimed in the diff (`claimThread`), so what their write changes
  there comes at once and keeps their line in place, as what comes under a sent box's line does.

### Writing on the pull request itself

The comment box at the end of the timeline comments on the pull request itself, and `i` and `dd` on
your comment there edit and delete it (`window/conversation.ts`, `window/TimelineBox.tsx`).

- The box is the comment box's editor (`createComposer`), in the same frame, taking files as the
  diff's boxes do, kept with the drafts as the `conversation` place: one a pull request, which
  restores after a restart with how sending it stands. `comments.send` posts it at once, in its turn
  among the pull request's writes, with the poller's `addConversationComment`
  (`main/conversation.ts`). Its answer lost, main reads the timeline afresh 10 s or more after, and
  looks for your comment with its text made since, by GitHub's clock.
- The draft is the one an overview's code block writes on the pull request too. It opens under that
  block while the overview has it (`opensUnderBlock`), and otherwise in this box (`isPullsOwn`),
  checked again as the overview changes. A draft the box shows stays in it while it's open, whatever
  the overview does, so nothing moves and focus stays. One in no box waits while Lo reads or checks
  the overview, which the box says. A draft the box lets go while it's still open, as the timeline
  goes, opens where it opens now (`leftTimeline`), though its block was drawn first. While it's
  under the block, the box says so, and `c` or its "Write it here" brings the draft into the box
  (`bringToTimeline`).
- An edit of your comment there is an `edit` place with no thread, drawn in the comment's card. It,
  and a delete, read the comment afresh from a full read of the timeline (`readPullComment`); one
  the read may have left out among older events settles nothing. A delete's question is the diff's
  dialog, and only the comment's text has to be as it showed.

### Submitting a review

The `review` feature submits your review of the pull request on screen: `⌘⏎` anywhere in its tab but
a comment box, a dialog, the palette or a menu, or the status bar's "3 pending · ⌘⏎", opens the
submit dialog (`tab.dialogs`). The palette says the count too, "Submit review · 3 pending": a
command's handler may say something after its label (`detail`).

- The dialog asks main what it shows as it opens (`review.dialog`): your pending review and its
  comments, the revision on screen, and whether you opened the pull request, in which case only
  Comment is offered. `window/model.ts` words the verdicts, the refusals and the notes, as plain
  functions tested alone, and plans the review with `@lo/review`'s `YourReview`, so what can't go
  says so before anything is sent. A banner says once when your pending review sits on another
  revision than the one on screen.
- The summary box is the comment box's editor (`createComposer`). Main keeps its text with the
  comments' drafts (`comments.drafts`, as a `summary` place), saved as it's typed. Files are
  attached to it as to any comment box, through the comments' `window/shared.ts`.
- `review.submit` sends in its turn among the comments' writes to the pull request
  (`comments.reviews`' `inTurn`), with the poller's `sendReview`. The summary is marked sent, with
  when, as a comment's draft is. When GitHub's answer is lost, nothing more is sent until a fresh
  read of your reviews (`YourReviews`), made 10 s or more after the send, says whether it was
  submitted, by GitHub's clock, even after a restart; when GitHub refuses that read, only "Submit
  anyway" sends. Once it's submitted, the summary goes, a toast names the verdict, and the threads
  and the timeline read again. A tab acting as nobody or showing a run of layers can't submit, nor
  can one offline, or while GitHub asked Lo to hold off.

### Images from GitHub

The window shows an image from outside Lo only as `<img src="lo-image://…">`, which main serves.
`src/ipc/images.ts` holds the two addresses, which the window builds and main reads, and the
`comments` feature serves them.

- `lo-image://post/<view>/<address>` is an image in a post, at an address on one of GitHub's image
  hosts (`@lo/markdown`'s `imageAddress`), fetched as the account the view `<view>` acts as.
  `lo-image://avatar/<login>?s=<px>` is an account's avatar. Features build both with
  `window/images.ts`; a bot or a team gets no address, and keeps its initials. Given where from
  (`Markdown`'s `images`), the Markdown renderer loads a text's first 30 images, lazily, and shows
  the rest, and any that fail, as links.
- Main fetches each through Chromium's network stack, as it does GitHub's requests: over `https` on
  the default port with no user name, from GitHub's image hosts or `avatars.githubusercontent.com`,
  following at most 5 redirects, each to the same hosts, within 30 s and 16 MiB, 6 at once. On
  github.com, only an attachment's address (`/user-attachments/assets/<uuid>`) is fetched, and only
  when the window asks for it does it get the account's token: its redirect to GitHub's attachment
  store on S3, the only way that host is reached, and every later hop go without it.
- It serves a PNG, JPEG, GIF or WebP, by its first bytes alone, read with `@lo/artifact`'s image
  reader and held to 16,384 pixels a side and 40 megapixels, as that type with `nosniff`, and
  nothing else. It keeps the last 64 MiB it served, each by the account it was fetched as (or
  nobody) and its whole address, signature included: no other account, and no address signed
  otherwise, finds it.
- A test run fetches the image hosts from the test's GitHub too, each under `/images/<host>/`,
  through `githubSettings`, so a packaged build never does.

## The interface

Lo's React components live in `packages/desktop/ui` (`@lo/ui`), ported from the design system's
guidelines one at a time, as features need them. They're styled with Tailwind CSS on Lo's tokens;
the window imports `@lo/ui/styles.css`, which brings the design system's CSS, the fonts and the
utilities.

- The Tailwind theme (`src/theme.css`) is generated from `design/tokens.json`
  (`pnpm nx run ui:codegen`). Tailwind's own palette and sizes are off, so the utilities are Lo's
  tokens: colors (`bg-bg-chrome`, `text-fg-muted`), radii, shadows, named sizes (`h-tabbar-h`), type
  styles (`text-ui`, `read-body`, `code-text`, each the whole font shorthand), and spacing from the
  `lo-sp-*` steps (`gap-8` is `lo-sp-8`, 8 px). There is no multiplier, so a number that isn't a
  step (`p-17`, `max-w-1234`) makes no CSS; zero is allowed (`p-0`, `min-w-0`). The font families
  are `font-sans` and `font-code`.
- Arbitrary values, bracketed or in parentheses (`text-[11px]`, `!p-[17px]`, `p-(--lo-tabbar-h)`,
  `[&>*]:p-4`), fail lint wherever they sit in a class, in `ui` and in the app. Lint reads every
  file Tailwind reads classes from, `.html` and `.md` as well as scripts. Where Tailwind can't
  reach, add a utility to `src/styles.css` with `@utility`, reading `var(--lo-*)`.
- Variants go through `cva` from `class-variance-authority`. Prettier sorts the classes.
- The fonts, Host Grotesk and Fragment Mono, are bundled as files (never `data:` addresses, which
  the content security policy blocks), and their licenses ship beside the window's files.
- Screenshot baselines are made on Linux only, in `apps/desktop/e2e/snapshots/`.

## Generated files

Generated files are committed, and each project that makes them has a `codegen` target. Never edit
one by hand: change its source, run `pnpm nx run-many -t codegen`, and commit both together.
`pnpm check:generated` fails when one is out of date.

## Publishing the checker

The `publish` workflow publishes `@withlo/overview` to npm. To release a change to the checker or
the skill it carries, bump `version` in `skill/checker/package.json` and merge: the workflow tests,
builds and packs the checker, and publishes that version with npm's trusted publishing, which needs
no token and signs provenance. The skill runs the checker by that exact version, so CI's `overview`
job fails a pull request whose package differs from npm's copy of its version, its manifest's
`devDependencies`, `nx` and build scripts aside (the scripts an install runs count).
`scripts/overview-npm.sh` packs the package the same way for both. The workflow's runs go one at a
time, in the order they started, so every bumped version is published, and bumps merged close
together publish in order. A version that isn't above every release npm has, as when a failed run is
re-run after a newer bump has published, or a prerelease, goes out under the `previous` tag, so
`latest` only moves forward. A version can't carry build metadata (`1.2.3+build`) or a leading v
(`v1.2.3`): npm drops it when it publishes, so the version on npm wouldn't be the one the skill
runs, and CI's `overview` job and the workflow both refuse it.

Only main can publish. The publish job runs in the `npm` environment, and npm's trusted publisher
for the package names that environment, so a branch's edited copy of the workflow can't publish as
long as the environment takes deployments from `main` alone. In the repository's settings, the `npm`
environment is set to Deployment branches and tags → Selected branches and tags → `main`. Protected
branches only won't do: while no branch is protected, it lets every branch deploy. GitHub creates a
missing environment, without protection, the first time a job uses it, so the `npm` environment must
exist, limited to `main`, before the trusted publisher is added.

npm adds a trusted publisher only to a package it already has, so the first version is published by
hand. Build the tarball fresh from main when publishing it: start the workflow, which builds and
uploads it and, with no package on npm, publishes nothing, then download it, log in to npm, and
publish it.

```sh
gh workflow run publish.yml --repo withlo/lo --ref main
gh run download <run id> --repo withlo/lo -n withlo-overview-<version> -D <folder>
npm login
npm publish <folder>/withlo-overview-<version>.tgz --access public
```

Then add the trusted publisher in the package's settings on npmjs.com, under Trusted publishing:
GitHub Actions, `withlo`, `lo`, `publish.yml`, environment `npm`, allowing `npm publish`. A trusted
publisher expires unless it publishes within two days of being added, and an expired one can't be
used or edited, only deleted and added again. So add it just before the next version merges.

## Design

Read [`design/README.md`](design/README.md) before you write or change any interface, and
[`brand/README.md`](brand/README.md) before you use the mark or the brand's colors.

## Verify

Run these before every push. CI runs the same.

```sh
pnpm nx affected -t lint typecheck test build
pnpm nx sync:check
pnpm format:check
pnpm check:boundaries
pnpm check:generated
pnpm check:symlinks
```

## Agent rules

- `AGENTS.md` is the source. Every `AGENTS.md` has a `CLAUDE.md -> AGENTS.md` symlink beside it.
- Skills live in `.claude/skills/`, with an `.agents/skills -> ../.claude/skills` symlink.
- `pnpm check:symlinks` checks both, in CI too.

## Git

- All changes land through squash-merged pull requests from a branch. The git hooks refuse commits
  on `main` and pushes to it.
- Commits and PR titles follow [Conventional Commits](https://www.conventionalcommits.org/). The PR
  title becomes the commit on `main`. commitlint checks both, in the `commit-msg` hook and in CI.
- A PR describes the change and why it's needed. Write it with the `pr-writing` skill, and say how
  the change was tested.
- Docs describe the product and how it works.
- Commit through the git hooks, and update a branch by merging `origin/main` into it, so a pushed
  branch's history is never rewritten.
- Commits and PRs carry no AI attribution.
- Repository settings, rulesets and branch protection are the maintainers' to change.

## Secrets

Never print, log or commit tokens, passwords or two-factor secrets. Read them into the process or
environment that needs them without echoing them.
