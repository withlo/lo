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

Every package is a private pnpm workspace package named `@lo/<name>`, and an Nx project named after
its folder (`"nx": { "name": "<name>", "tags": [...] }` in its `package.json`). Names are one short
word, without hyphens, unless clarity needs two. The one package made for npm, `skill/checker`, is
named `@withlo/overview`: it holds the checker and, built in, the skill it installs.

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
  needs Electron. On Linux it needs a display: CI runs it under `xvfb-run`. In CI each test records
  a trace of the window, kept in its results when it fails, which CI uploads; a test that times the
  page's frames opts out (`traced: false`), since recording slows them. CI retries a failed test
  once, and Playwright shows one that then passes as flaky.

The window shows untrusted content, so it's locked down, and the smoke test shows each guard
holding:

- It runs in Chromium's sandbox, with context isolation and without Node.
- It loads only Lo's own files, from the `lo-app:` scheme, never from `file:`. Its content security
  policy, sent as a header, allows no inline scripts and nothing from elsewhere, and no inline
  styles but the style elements that carry the page's nonce, which the code views make. Each load of
  the page gets a new nonce, which `app.info` hands the page.
- Its session cancels every request outside `lo-app:`. WebRTC, which sends nothing the session can
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
- Each account's poller keeps what it read in the database, read back only by the build of Lo that
  wrote it (a hash of main's output folder), talking to the same GitHub.
- The window gets each account's summary (its login and name, how it signed in, whether it's signed
  out, and whether its token waits for a keyring), never a token.
- Signing in is GitHub's device flow, one sign-in at a time. Before asking GitHub for a code, Lo
  checks it can keep a token (on Linux, by what a fresh encryption is marked), so a desktop with no
  keyring is refused before anyone goes to GitHub. The window shows the code; main copies it and
  opens GitHub's own page for codes, never one GitHub's answer names. Polls follow GitHub's
  `interval` and `slow_down`, and stop once the dialog closes, another sign-in starts, the window
  goes or Lo quits.
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
  `/uploads`, as the replay server does), which makes it a test run. It adds the account whose token
  is in the file `LO_TEST_TOKEN_FILE` names as it starts. It runs the gh `LO_GH` names (an absolute
  path, or `none`) rather than one it finds, and a test run runs none unless `LO_GH` names one, so
  the gh on `PATH`, which holds the tokens of whoever runs the tests, never sends one to the test's
  GitHub. It opens web pages with the program `LO_BROWSER` names, rather than the system's browser,
  so a test opens no browser. A packaged build ignores all four.

### A pull request's tab

The `tab` feature keeps the window's tabs and draws a pull request's: its header, two banners at
most, the left panel, the middle and the right panel other features fill through its slots, and its
status bar.

- Main watches each pull request's tab with its account's poller, so the strip has its title, and
  the one on screen most often. A tab keeps the account it acts as, and its repository's name as
  GitHub gives it, so it comes back as it was, offline too. A tab with no account yet works it out
  as a link does the first time it's shown: the one that can see the repository, the one remembered
  for it, nobody for a public repository, or a question.
- The first time a tab is shown, main reads the pull request and fetches it into the local copy
  through `@lo/git`, with the account's token, read as each fetch starts. A fetch that fails is
  tried again after 5 s, doubling to 5 minutes, unless waiting won't help, and a tab reads what an
  earlier fetch brought while GitHub can't be reached.
- The head on screen is GitHub's when the tab opened. A newer push says so in a banner, and moves
  nothing until it's loaded.
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
  GitHub said, and a new head on screen starts again. GitHub is asked only about a head it gave,
  never one restored from what Lo saved, and a read that fails is tried again after 5 s, doubling to
  5 minutes.
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

### A pull request's diff

The `diff` feature draws a pull request's tab's middle: every changed file in one scroll, in the
order the tree lists them, through `@lo/ui/code`'s diff view. It works that order out from its own
files with the tree's `orderIn`, so the view is drawn in it from the start, before the tree has the
files, and keeps it until the reader orders the files another way: what the files say of themselves
changing, as when the local copy marks one generated, doesn't reorder a drawn view.

- Main lists each changed file's versions at the head on screen (`diff.state`): from the local
  copy's comparison once it's ready, with each side's blob and size, and from GitHub's list of the
  pull request's files until then; or, while two revisions are compared, from their comparison in
  the local copy, which a new comparison starts again. Each says how the file starts out: shown,
  closed as generated, kept out as large until `za`, binary, or unchanged. Files are named by their
  place in the list, never by their paths.
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
- Once the view is drawn, the window says so (`diff.drawn`), and the tab keeps that head on screen,
  even one it took from what it saved: a newer one from GitHub is offered as a newer push.
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
