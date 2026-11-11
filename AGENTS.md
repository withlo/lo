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
| `skill/`            | The overview skill, with the checker's command line in `skill/checker`   |
| `testing/`          | Test helpers and recorded fixtures, for tests only                       |
| `design/`           | The design system: rules, tokens, and the CSS Tailwind can't reach       |
| `docs/`             | The design and the product's docs                                        |
| `brand/`            | The mark, wordmark, app icon, colors and motion; `brand/README.md` rules |
| `scripts/`          | Repo scripts: the boundary check, git hooks, CI checks                   |

Every package is a private pnpm workspace package named `@lo/<name>`, and an Nx project named after
its folder (`"nx": { "name": "<name>", "tags": [...] }` in its `package.json`). Names are one short
word, without hyphens, unless clarity needs two.

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
  and refuses `return value satisfies never`, which would hand the value back as the answer.

## Boundaries

A package's folder says where it runs, and its Nx tags (`"nx": { "tags": [...] }` in its
`package.json`) say what it may import. `pnpm check:boundaries` checks:

- a project in `packages/core/` is tagged `platform:core`, one in `packages/desktop/` is tagged
  `platform:desktop`, and no other project has a platform tag;
- projects in `packages/core/markdown`, `packages/core/artifact` and `skill/` are tagged
  `license:mit`, and every `license:mit` project carries the MIT license in its own `LICENSE`;
- core projects import only core projects, and use no Node built-in, Electron or child process
  (their tests may use Node);
- core projects load modules by name: an `import()` or `require()` of anything but a literal fails;
- `license:mit` projects import only `license:mit` projects;
- nothing imports an app;
- only tests import `testing/`. Tests are `*.test.*` files and anything in `test/` or `e2e/`, and
  `testing` belongs in `devDependencies`.

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
- a module's name or path has no percent escapes, since Node decodes them, and isn't a URL other
  than `node:`;
- a `#name` import is one the `package.json`'s `imports` map;
- no tsconfig sets `paths`, nor any tsconfig it extends or references;
- the root `package.json` holds the repo's tooling only: no workspace package, and no alias besides
  TypeScript's two.

oxlint also stops core code from reaching for `process`, `Buffer`, `window`, `document` and other
globals of a particular platform. To share code across a boundary, move it into a package on the
right side; don't loosen the rules.

## Tests

Unit tests are `*.test.ts` files beside the code, run by Vitest. The root `vitest.config.ts` has one
project per package. Nx runs one project's tests at a time, and Vitest uses two workers, or all of a
CI runner's cores.

## The desktop app

`apps/desktop` is Lo's Electron app. `src/main/` is the main process, `src/preload/` the window's
bridge to it, `src/window/` the window, `src/platform/` the code that differs between macOS and
Linux, and `src/features/` the features.

```sh
pnpm nx run desktop:dev    # run it with hot reloading
pnpm nx run desktop:start  # build it, then run the build
pnpm nx run desktop:e2e    # build it, then run its smoke test
```

- The `electron` package downloads Electron's binary the first time it's needed.
  `pnpm --filter @lo/desktop exec install-electron` fetches it ahead of time.
- A build run from source keeps its data in its own folder (`Lo Dev`, beside an installed Lo's), or
  in `LO_USER_DATA_DIR` when that's set. A packaged build ignores both.
- Code that doesn't call Electron goes in its own module, with unit tests beside it. The smoke test
  in `e2e/` drives the built app with Playwright, each test on an empty data folder, and covers what
  needs Electron. On Linux it needs a display: CI runs it under `xvfb-run`.

The window shows untrusted content, so it's locked down, and the smoke test shows each guard
holding:

- It runs in Chromium's sandbox, with context isolation and without Node.
- It loads only Lo's own files, from the `lo-app:` scheme, never from `file:`. Its content security
  policy, sent as a header, allows no inline scripts or styles and nothing from elsewhere.
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
- `main/index.ts` exports `defineFeature(contract, { handlers, start })` by default: a handler for
  every request, and optionally a `start` that runs before the window opens, to publish on the
  feature's topics. Both get the feature's context: `publish`, `database` and `git`. A handler
  throws an `IpcError` for a failure the window should see; any other error is logged and reaches
  the window only as `internal`.
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
  deadline that starts when the job does and a cap on its JavaScript heap (10 s and 256 MB unless
  the job sets its own). Past either, the job fails as `timeout` or `memory`. Every message with an
  id gets an answer, and the window gives up on one after a minute (`unanswered`).
- Main watches the process's memory and stops it past 2 GB, since memory outside the heap
  (WebAssembly's) can't be capped any other way, and treats a fatal error the same way. Jobs the
  window had sent fail as `restarted` at once; the process starts again, waiting longer after each
  quick failure, and the window gets a new port.
- A build run from source with `LO_TEST_JOBS=1` adds the smoke test's jobs and exposes the window's
  connection to it, and takes another cap from `LO_BACKGROUND_MEMORY_CAP_MB`. A packaged build
  ignores both.
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
