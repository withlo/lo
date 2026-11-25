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
  changes, and changing a PR's base branch to form a stack or to merge a chain.
- **No AI inside Lo.** Lo calls no model and runs no agent. It displays what agents write elsewhere.
- **No backend, no telemetry.** Lo talks only to GitHub and to language servers' official download
  sources. Updates come from GitHub Releases.
- **Never runs a repo's code.** No dependency installs or build steps. Language servers run only on
  repos the user trusts, and overviews contain no scripts.
- **Keyboard first, not keyboard only.** Every action has a key and a visible control.

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
CI runner's cores. A test that runs git, cloning and fetching repositories it builds, takes longer
when the machine is busy than the 5 s a test gets, so a package whose tests mostly run git sets a
longer `testTimeout` for the whole project (`@lo/git`). The desktop app's tests that import
`@lo/testing/git`, directly or through a module they import, are found by `gitTests()` in
`apps/desktop/vitest.config.ts` and run as `@lo/desktop:git`, a project of their own with 30 s; the
rest of the desktop's tests keep the default.

A string is pinned once, in its words module's own test, or, for one with no words module, in the
test of the module that says it, as `review/window/model.test.ts` pins the review dialog's verdicts.
Any other test gets the string from that module, or checks the kind of message and one key word: one
that tells it apart from the messages beside it, matched as a whole word, as `/\blink\b/` tells
"First link" from "First block". A test that restates a sentence fails each time it's reworded, and
catches nothing the module's own test doesn't.

What `ui`'s components do that only a real browser shows, such as where `Tab` moves focus, is tested
by Playwright specs in `packages/desktop/ui/e2e/`. Each builds its own page with Vite and opens it
in Electron's Chromium (`pnpm nx run ui:e2e`), and CI runs them with the app's smoke test. On Linux
each worker opens its pages on an Xvfb display of its own, as the smoke test's workers do, so a run
there needs Xvfb, and shows nothing on the screen.

## The desktop app

`apps/desktop` is Lo's Electron app. `src/main/` is the main process, `src/preload/` the window's
bridge to it, `src/window/` the window, `src/platform/` the code that differs between macOS and
Linux, and `src/features/` the features.

```sh
pnpm nx run desktop:dev      # run it with hot reloading
pnpm nx run desktop:start    # build it, then run the build
pnpm nx run desktop:e2e      # build it, then run its smoke test
pnpm nx run desktop:package  # build it, then make the Mac zip in apps/desktop/release/
pnpm nx run desktop:release  # build it, then make a release's DMGs and zips (needs a Developer ID)
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
  registered links, that its Info.plist has the config's copyright and `licenses.txt` is beside the
  asar, not in it, with Lo's own notice first and the packages that must always be there, that it
  holds no `app-update.yml`, so it never looks for updates, that its window draws, and that the app
  quits when given switches or the variables below. electron-vite bundles everything the app
  imports, so the package holds only `dist/` and `package.json`, and no `node_modules`.
- `desktop:release` makes the Mac's release from `build/release.yml`, which extends the package's
  config with what a release needs: a DMG and a zip each for arm64 and x64,
  `Lo-<version>-<arch>.<ext>`, with `latest-mac.yml` and blockmaps beside them. The app and its
  helpers are signed with the Developer ID certificate in `CSC_LINK`, with only `allow-jit`
  (`build/entitlements.release.plist`), then notarized and stapled, and the DMGs signed. With no
  certificate the build fails, since a release is never unsigned, and the minimum macOS is
  Electron's own. The app holds an `app-update.yml` naming GitHub Releases of `withlo/lo`, and the
  build never publishes (`--publish never`). The version comes from the tag, passed as
  `-c.extraMetadata.version`, so `package.json` stays `0.0.0`; the config also names the package
  `lo`, which names the folder electron-updater downloads to, `lo-updater`. "Releasing" says how the
  `release` workflow runs it, and what checks the files.
- `pnpm run release:linux`, in `apps/desktop` after a build, makes a release's Linux packages from
  the same config, for the architecture it runs on or `--x64` or `--arm64`:
  `Lo-<version>-<amd64|arm64>.deb` and `Lo-<version>-<x86_64|aarch64>.rpm`, and a run writes
  `latest-linux.yml` (x64) or `latest-linux-arm64.yml` beside them. Linux is a preview, so they're
  unsigned and Lo doesn't install its own updates from them: it says when a newer release is out,
  and links its page. Both put Lo in `/opt/Lo` with its program at `/opt/Lo/lo` and the `lo` command
  at `/usr/bin/lo`, depend on libsecret, which Lo keeps its tokens through, and hold only Lo, its
  desktop file and its icons.
  - The desktop file opens `/opt/Lo/lo %U` and registers `lo://` alone. The web links the Mac
    registers (`mac.protocols`) would, on a desktop with no default browser set, let Lo take every
    web link. `desktopName` is `lo.desktop`, so that when Lo makes itself the handler of `lo://`
    links, Electron names the file the package installs.
  - Chromium's sandbox helper, `/opt/Lo/chrome-sandbox`, is setuid root in the package itself
    (`build/linux/after-pack.ts` sets the mode, the rpm says so with `%attr`, and the install script
    sets it again), as Chrome's packages hold it. A packaged Lo refuses `--no-sandbox`, so it must
    start with Chromium's sandbox: in user namespaces where they can be made, and through the helper
    where they can't. Wherever AppArmor runs and takes the profile's ABI (4.0),
    `build/linux/after-install.sh` also installs electron-builder's profile for `/opt/Lo/lo` as
    `/etc/apparmor.d/lo` and loads it (in a chroot, the next boot does). It's `flags=(unconfined)`
    with `userns,` alone: it restricts nothing and only adds user namespaces, which Ubuntu 24.04 and
    later stop for a program with no profile. What Lo starts keeps it unless another profile
    attaches.
  - The install script makes `/usr/bin/lo` only where it's Lo's to make, through
    `update-alternatives` where there is one: a `lo` of anyone else's stays as it is. The removal
    script (`after-remove.sh`) takes away only Lo's, and does nothing on an upgrade, since an rpm's
    new install script runs before the old one's removal. On a packaged Linux Lo, `/usr/bin/lo`
    leading to Lo's own program counts as the installed `lo` command.
  - Electron checks no asar hash on Linux, so the packages have none, and the fuse that asks for one
    does nothing there. `SECURITY.md` says so.
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
  variable, as `electron-vite dev` and the tests pass some. The switches people reach for on Linux
  are refused too, `--no-sandbox` and `--disable-gpu` among them. `--disable-gpu` is what people
  reach for when a window stays blank, so `app.gpu`, which is on unless the settings file says
  `false`, stands in for it. Electron takes `app.disableHardwareAcceleration()` only before `ready`,
  so main reads that one key from the file itself as it starts (`src/main/gpu.ts`, reading the file
  as the settings feature does), and a change applies at the next start. It's in the file and
  `docs/settings.md`, not in Settings, which a window that draws nothing couldn't reach, and the
  window can't change it.
- A build run from source goes by `Lo Dev`, so it never touches an installed Lo's data or its key in
  the system's keychain: it keeps its data in its own folder (`Lo Dev`), or in `LO_USER_DATA_DIR`
  when that's set, and its key under "Lo Dev Safe Storage". A packaged build is `Lo`, and ignores
  `LO_USER_DATA_DIR`. Such a build reads the keymap file from `config/keymap` in that folder, rather
  than from `~/.config/lo`, and the settings file from `config/settings.json` the same way, and
  opens the keymap and settings files with the program `LO_KEYMAP_EDITOR` names (an absolute path),
  if set, in place of the system's text editor (`src/main/editor.ts`), so a test starts no editor.
  It checks for updates only when `LO_UPDATES_FEED` names a feed at `http://127.0.0.1:<port>/`, for
  its tests; a packaged build ignores it (see "Updates").
- Code that doesn't call Electron goes in its own module, with unit tests beside it. The smoke test
  in `e2e/` drives the built app with Playwright, each test on an empty data folder, and covers what
  needs Electron. On Linux each Playwright worker starts its copies of Lo on an Xvfb display of its
  own (`@lo/testing/display`), so a window one worker opens or closes never takes the other's focus:
  a run there needs Xvfb, and shows nothing on the screen. With no window manager, X gives focus to
  the window under the pointer, which rests in the middle, in Lo's centered window, so Lo is in
  front, and reads GitHub every 20 s, for the whole test; a test fails at once if no window of Lo's
  has focus once it has drawn. CI runs it in four shards, one job each (`app (1)` to `app (4)`),
  which split the tests by count with Playwright's `--shard`;
  `pnpm nx run desktop:e2e -- --shard=2/4` runs one. In CI each test records a trace of the window,
  kept in its results when it fails, which CI uploads as `app-test-results-<shard>`; a test that
  times the page's frames opts out (`traced: false`), since recording slows them, and holds each
  frame's own work, the CPU time of the page's main thread from a trace of its timeline, under 50
  ms, and its wall time under 200 ms, for waits that take no CPU: on a CI runner shared with other
  tests, the time between frames takes in theirs too. CI retries a failed test once, and Playwright
  shows one that then passes as flaky. A test drives Lo's window only once it has drawn, through the
  `page` fixture or, for a copy of Lo it starts itself, `drawnWindow`: the page runs before
  Electron's GPU process has started, which in CI has taken up to half a minute, and until it has,
  nothing that waits on a frame happens, such as a closed dialog leaving. Tests start Lo with every
  move off: `appEnvironment` sets `LO_MOTION=reduce`, which a build run from source passes to its
  window's preload, on the window's command line, and the preload sets the motion switch before the
  page's code runs (a packaged build ignores it), so no test waits on a popup fading or meets one
  still leaving. A run that's there to watch Lo move sets `LO_MOTION=system`, and so do a few tests
  that check what's on screen stays put, one each of the diff, the tree and the overview, through
  the `motion` fixture option, since people see Lo with its moves on. A test of what only macOS has,
  such as its menu bar, skips on Linux with a reason that starts "Local only", since CI runs on
  Linux, and runs on a Mac. The smoke test's specs are `e2e/*.spec.ts`, and a `*.test.ts` beside
  them is a unit test of what they use. A run on GitHub itself, with the system's keychain, is a
  `*.live.ts` spec, which only `nx run desktop:live` runs, one at a time, as `testing/README.md`
  describes.

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
  stack. Besides it, main hands each load of the page the code port (see "The syntax index"), whose
  every message main checks as the background process checks its own.

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
  feature's context: `publish`, `database`, `git` and `use`. A handler also gets who asked, as its
  third argument: `{ windowId }`, the window whose page sent the request, for what it shows there,
  as a dialog. A handler throws an `IpcError` for a failure the window should see; any other error
  is logged and reaches the window only as `internal`. A failure crosses as a kind and its data,
  never a sentence: the error's code, or a reply's or topic's value, says what went wrong, and its
  message holds only what the source said (GitHub's, Git's, the system's), for Details. The window
  writes the words, with the Causes in `ipc/cause.ts` and `window/explain.ts`.
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
  `defineSetting(key, schema, default, accepts, { group, label, description, options? })` from
  `settings/contract.ts`: a flat key (`diff.layout`), what its value may be as a Zod schema, the
  value without one, what it accepts in words, and its row: the group of Settings it's in (or
  `'file'` for one only in the file), its label, its one line of at most 90 characters, and the
  words for each option of a choice. The settings feature reads `settings.json` from the config
  folder as JSON with comments and trailing commas (`jsonc-parser`), watches it, reports a value a
  schema refuses and uses the default, and keeps every key no feature declared. To change a setting,
  only after main has checked the value again, it edits that key's value in the file's text, keeping
  every comment and space around it, and writes the file whole, atomically. Main reaches the values
  through the settings feature's `service.ts` (`use(settings).watch(setting, listener)`, which also
  declares the setting), the window through its `window/shared.ts` (`useSetting`, `changeSetting`,
  `watchSetting`), where a feature puts its rows of Settings in the `settings.rows` slot:
  `settingRow(setting, { order })` draws a setting's row from the setting itself, and `defineRow`
  makes any other, such as a list, with the same one line. A row whose line depends on what's there
  takes `useLine`, a hook for it, while search still reads the setting's own line, and a row that
  comes and goes with a part of Lo takes that part's `present`. A screen besides Settings that
  offers a setting of a few options, as the welcome does, takes it as a `SettingChoice`: the feature
  that owns the setting makes one with `choiceOf` in its `window/shared.ts`, rather than handing the
  setting on, and the screen reads and writes it with `useChoice`, which says a change main refused
  as the row's `Problem`, never in a toast. A feature's own row of a setting on such a screen, as
  the welcome's overviews step has, changes it with `useSettingChange` the same way. A change main
  refuses comes back as `settingsFile` or `unsaved`, with main's reason and its details, and the row
  says it as a `Problem`. A setting declared with `{ window: 'read' }`, such as which repositories
  are trusted, the window shows but can't change: `settings.set` refuses it as `unwritable`, and
  only main writes it, with `use(settings).update(setting, change)`. `docs/settings.md` lists every
  setting; a test fails when one is missing.
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
  view given `present` (a `Presence`: `now()` and `subscribe`) is in its slot only while that says
  so, and comes back without a restart. Commands come and go with the registry's `setOff(ids, off)`:
  one that's off is in no menu, list or palette, its keys are free, and running it does nothing. So
  a setting that takes a part of Lo out, as `overview.on` does, takes its views and its commands
  together. A slot is named for the feature whose `window/shared.ts` exports it, and views go only
  in exported slots. Every view runs inside its own error boundary, from `<Slot>` or `useViews`
  alike: one that throws shows a short note in its place, with "Try again", which draws it again,
  and its error is logged. In a build run from source, it then stops the window too, so tests can't
  miss it.

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
utility process the window talks to directly over a MessagePort that main hands both of them. Main
has a port of its own to it, for the work it hands it itself, such as the syntax index's parsing. It
has Node, so it gets an environment main builds for it (nothing of main's, so no token), and never
reads files or the network.

- A feature's jobs are a contract in `jobs.ts`, exported as `contract` (`defineJobs`: each job's
  input schema and reply type, held to the same rules as `contract.ts`), and their code in
  `background/index.ts` (`defineRunner`, the default export), found by `import.meta.glob`. The
  window runs them through `jobs(contract)`, and main through `jobs(contract, mainJobs)`
  (`src/main/background.ts`). A contract made with `{ from: 'main' }` is main's alone: the window's
  port refuses its jobs as `unavailable`.
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
- Main's jobs wait behind the window's: they run one at a time, and only once a worker is free and
  none of the window's jobs is waiting for one, so main's work never slows what the reader asked
  for. Main waits for each one longer than the window does, since its wait doesn't count against its
  deadline. Main's jobs that answer what the reader is waiting on (`asked` in the runner, such as
  `code.render`) have a queue of their own: one at a time, ahead of main's other jobs and beside one
  that runs. Main gives up on those sooner, and a job it gives up on is cancelled.
- Main watches the process's memory and stops it past 2 GB, since memory outside the heap
  (WebAssembly's) can't be capped any other way, and treats a fatal error the same way. Jobs the
  window and main had sent fail as `restarted` at once; the process starts again, waiting longer
  after each quick failure, and the window and main each get a new port.
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
- With git, main opens the cache, as `git.cache`, and cleans it up without anyone waiting.
  `git.setCap()` sets the size it's kept under, which counts all of it but the toolchains language
  servers use (`toolchains/`), since Settings removes those and their gigabytes would otherwise
  evict clones, and what's being deleted (`tmp/*.trash`). Language servers' homes (`code/homes/`)
  count.
- Past the cap, what Lo gets back without a fetch goes first: checkouts and language servers' homes,
  together, least recently used first, by a checkout's stamp and a home's folder time, which the
  cache sets as each server using it starts, every 5 minutes while it runs, and as it stops, before
  letting go. Then clones go, a fetch each to get back, least recently used first, each with its
  checkouts and homes, but never the one used last. Each goes only while the cache is still over. A
  checkout's stamp holds whole seconds, so times are compared to the second, and what was used in
  the same second goes in the order its clone was used, a home left without one first, then by path.
- Nothing of a clone that's open, being written to or that a language server runs on goes, its
  checkouts and homes included. Those checkouts and homes count toward removing nothing else, so a
  running server's large home never pushes out another's checkouts or clone, though the clone's own
  folder counts as any clone's does. Each run looks at what's in use all at once, so a server that
  stops during it has its checkouts and homes kept alike, never one removed without the other. What
  comes into use after it looks stays and frees nothing, and the next goes in its place. A server
  holds its repository (`cache.useForServer`) from just before it starts until it has stopped, and
  one starting waits for cleanup that's removing any of it, but not for collecting the trees
  comparisons replayed, which takes nothing a server reads and so runs alongside servers. A minute
  after nothing has a clone open or runs on it any more, the cache is kept under its cap again. Runs
  keeping the cache under its cap take turns with removing what's unused and clearing the cache, in
  the order they're asked for, so a run never counts what those two are removing. Dropping a
  repository's checkouts and making a clone again go by the clone's lock alone, so a run can count
  them part way. Collecting the trees comparisons replayed, which can take minutes, takes its turns
  with repacks instead, so a fetch that made a clone, which waits for the cap, never waits for it.
  Runs keeping the cache under its cap stop once the cache closes.
- A repository's homes go with its clone, unused for 30 days, past the cap or cleared, through
  `Cache.trash`, and cleanup removes homes left without a clone. A checkout, home or clone past a
  link stays, frees nothing and, kept while its repository is in use, counts for nothing.
- The cache is `Lo` (`Lo Dev` for a build run from source, or `lo-cache` in `LO_USER_DATA_DIR`,
  never `cache`, which a Mac's disk takes for Chromium's own `Cache` there) in the system's folder
  for this user's caches: `$XDG_CACHE_HOME` or `~/.cache` on Linux, and on a Mac the one macOS keeps
  outside the home folder, `DARWIN_USER_CACHE_DIR` (`/var/folders/<xx>/<random>/C/`), as
  `/usr/bin/getconf` names it. Tools that language servers run read settings from every folder above
  their own, such as Cargo's `.cargo/config.toml`, and tsserver loads plugins from every
  `node_modules` above its install, so the home folder is none of them. Lo won't start unless that
  folder, as named and as it resolves, is a folder, not a link, of the user's own that nobody else
  can change, and never falls back to the home folder.
- Once the cache opens, the one an earlier Lo kept in `~/Library/Caches` goes, as the cache removes
  its own: moved into its `tmp/` and deleted with the cache's other deletions, or deleted where it
  is when it's on another volume. Only a folder, never a link, that holds a cache's folders goes,
  never the open cache or a folder holding it, whatever links lead there, and only under its lock,
  never while another Lo has it open. In `LO_USER_DATA_DIR`, what an earlier build made in the
  `cache` it kept there goes the same way, folder by folder, by the names Lo gives them, and
  Chromium's own files there stay.
- Every git gets an environment of Lo's own making, never main's, and only a fetch gets the
  account's token, from a source read as each fetch starts. Fetches take the proxy Lo's own requests
  take.
- Lo quits once every git has stopped, a look for git's included: each is asked to stop, then killed
  with what it started.
- A build run from source takes the git to run from `LO_GIT`, a path or `none`, and fetches from
  `LO_GIT_REMOTE`, a server or folder on this machine, for its tests. A packaged build ignores both.

### Language servers

Only main runs language servers, through `@lo/lsp` (`packages/desktop/lsp`), and speaks the protocol
with them, on `vscode-jsonrpc`. It depends on no other Lo package: the app hands it the folders, the
toolchain and git's variables each server needs.

- A server starts as its own program, by absolute path with an argument list: never through a shell,
  never as a script (a launcher such as `bin/jdtls`), and never as a program in its checkout; what
  starts is the real path that was checked. It leads a process group of its own, and its family is
  that group with whatever descends from it, found by parent, so a stop or a kill reaches whatever
  it started, a process in a session of its own included. A service the system starts for it, which
  its spec names (`services`), is in its family too when its `HOME` is exactly the server's home,
  with what it starts.
- Its environment is built from nothing: a `HOME` of its own with `TMPDIR` inside it, a `PATH` of
  the toolchain's folders and the system's, git's variables from `@lo/git`, a proxy that leads
  nowhere (`NO_NETWORK`, port 0 on this machine) in each spelling programs read, and its adapter's
  own variables, none of which may be a proxy, the SSH agent or named like a secret or credential,
  nor load code into a program or shell (`NODE_OPTIONS`, `DYLD_*`, `BASH_ENV`, `RUSTC_WRAPPER`,
  `GOFLAGS`, `GOPACKAGESDRIVER`, `CLASSPATH`) unless the adapter names it in `allowed`. Its
  adapter's caches (`homeFolders`, such as `GOMODCACHE`) are folders in its `HOME`, by their paths
  there. Each folder is checked as given and as it resolves, against the checkout as given and as it
  resolves, its `HOME` before it's made. Nothing of main's reaches it.
- Lo opens a file on a server with its text from git, at most 50 at once, and asks only for hovers,
  definitions, references, inlay hints and document symbols, each with a deadline. A request is
  cancelled once its deadline passes, its asker gives up or a newer one replaces it, and keeps its
  place at the server until answered or for 30 s, so a server never has more than 32 unanswered. Of
  what a server asks, Lo answers settings, registrations and progress tokens, and refuses the rest.
- Beside the reader, a meter reads each header as `vscode-jsonrpc` does and refuses a message past
  64 MB, a header with two lengths, more than 80 MB read but not handled, and more than 50,000
  messages, 256 MB of output or 50,000 lines of stderr in 10 s. Lo hands the connection one message
  a turn and reads more only while few wait, and reads stderr a piece a turn, of whose lines the log
  handles only the last 1,000, so a flood never keeps main from its turns. Once `shutdown` is
  answered or given up on, nothing more is read. `packages/desktop/lsp/README.md` lists the limits.
- Main reads each server's family's resident memory every 5 s, and stops it if it can't three times
  running. A server past its cap (4 GB) or the meter's limits is killed at once, whatever its state,
  a stop's included: Lo reads nothing more from it, freezes its group, then what it finds outside
  it, round after round until nothing new appears, and only then kills them all. A stop sends
  `shutdown` and `exit`, a second each, reading the family within the first, then freezes the group
  while it reads the family again, so nothing leaves it unseen, sends `SIGTERM` to the family and
  lets the group go on, then kills it 2 s later: 4.75 s at most, a quarter of a second inside a
  feature's 5 s. A kill that begins during a stop takes it over, so nothing lets go on a group the
  kill froze. A process read earlier is signalled only while it's the same one, by its start time.
  The package's README says what can't be found.
- Its stderr and messages make its log, the last 1,000 lines, in memory only.
- What Lo downloads is pinned in `packages/desktop/lsp/servers.json`: each server's version, and
  that of the Node the JavaScript ones run on, with each file's address, size and SHA-256 per
  platform. `pnpm nx run lsp:pin -- <id> <version>` records one, by hand and never in CI: it checks
  each file against its publisher's signature first (Node's releasers' and HashiCorp's keys, in
  `scripts/keys/`, npm's registry keys, and for a NuGet package its author's signature, Microsoft's
  for Roslyn, timestamped and chaining to a root pinned by its key), or for gopls against
  sum.golang.org as `go` does, and that it unpacks as Lo would. rust-analyzer, which publishes no
  signature or attestation for its releases, is checked against the SHA-256 the GitHub REST API
  (`api.github.com`) lists for each release asset, which GitHub computes when the asset is uploaded.
  GitHub runs that API and the host the file comes from, so the check catches a download gone wrong,
  not a release someone else made. Lo trusts only the manifest's hashes.
- gopls is pinned as the modules it's built from, with the `go.mod` and `go.sum` that require them
  and the size and SHA-256 of what each platform's build makes, since the Go team publishes no
  binary. On first use Lo fetches the modules itself, through its downloader and the entry's hosts,
  never by running `go` against the network, lays them out as a module proxy in the download's
  folder, and builds once with its Go, offline, from an environment built from nothing
  (`src/build.ts`). Go's builds are reproducible: a build whose hash isn't the one pinned is
  refused, and so is a Go other than the version gopls was pinned with, so gopls is pinned again
  whenever Go is.
- The toolchains language servers use are pinned the same way, in `toolchains.json`: Go, Rust
  (rustc, cargo, the standard library and its sources, as layers of one sysroot), a Temurin JDK, the
  .NET SDK and, for Linux, Swift, each with what it unpacks to per platform. `lsp:pin` checks Go
  against Google's signature and go.dev's list, Rust against its signed channel file, the JDK
  against Adoptium's signature, Swift against swift.org's, and .NET, which publishes none, against
  the SHA-512 that both Microsoft's download site and the dotnet/core repository list. Swift has an
  entry for each Linux distribution swift.org builds it for and lists packages for
  (`swift-<distribution>`, `src/swift.ts`), x64 and arm64, each pinned on its own, all to one
  version, and measured within a limit of its own, since it unpacks to about 3.5 GB. Pins are
  renewed before each release. A platform whose archive of a new version its vendor hasn't published
  yet keeps the one pinned before, under a `version` of its own that names its folder
  (`versionFor`), and the next pin moves it; a server is one version everywhere. A server uses only
  Lo's copy, never the machine's, nor a version its checkout asks for: `toolchainUse` gives it the
  folder of programs for its `PATH` and the variables that hold the toolchain to Lo's copy
  (`GOTOOLCHAIN=local`, `GOPROXY=off`, an empty `GOFLAGS`, `GOPACKAGESDRIVER=off`, an empty
  `RUSTC_WRAPPER`, `JAVA_HOME`, `DOTNET_ROOT`, MSBuild's `DOTNET_MSBUILD_SDK_RESOLVER_*`, and the
  rest), and the caches it keeps in the server's home.
- A `global.json` can steer `dotnet` past those variables: since .NET 10 its `sdk.paths` names
  folders to find an SDK in, the checkout's own among them, and the SDK's commands and MSBuild read
  the one nearest where they run. So `dotnet` starts a server only as `dotnet exec`, which reads
  none (`checkArguments`), and a server that uses .NET doesn't start on, or move to, a checkout with
  a `global.json` that names `paths` or spells a key with an escape, in it or in a folder above it,
  nor below a folder that holds a `Directory.Build.props`, `Directory.Build.targets`,
  `Directory.Packages.props` or `NuGet.config`, which MSBuild and NuGet read for every project under
  it (`checkoutProblem`, asked by the pool).
- A `go.work` makes the modules it names one workspace, which Go reads from the folder nearest where
  it runs. So a server that uses Go doesn't start on, or move to, a checkout with a `go.work` in a
  folder above it, or one in it that names a folder outside it, by `use` or a `replace` with a path,
  or that Lo can't read for certain (`checkoutProblem`). It looks through the checkout's own
  folders, never through a link, which could lead anywhere on the disk. Every refusal that looks
  through a checkout matches names as a Mac's disk does (`foldName`: NFKC, then a full case fold),
  and reads at most `WALK_LIMIT` entries, refusing a checkout with more.
- Some files steer rust-analyzer or `cargo` past those variables, so a server that uses Rust doesn't
  start on, or move to, a checkout with one (`checkoutProblem`). A `rust-analyzer.toml`'s workspace
  settings win over Lo's client settings and can run a program
  (`cargo.buildScripts.overrideCommand`, `cargo.extraEnv`). A `.cargo/config.toml` or
  `.cargo/config`, read as TOML with `smol-toml`, refuses the checkout for an `[env]` table, set on
  the `rustc` `cargo metadata` runs whatever Lo's environment holds; an `[unstable]` table, which
  takes effect since rust-analyzer runs `cargo` with `RUSTC_BOOTSTRAP=1`; or an `include`, which
  reads another config, outside the checkout too; and so does one that doesn't parse or isn't a
  plain file, or a `.cargo` that isn't a plain folder. Lo's variables answer the config's other keys
  (`build.rustc*` by `RUSTC`/`RUSTC_WRAPPER`/`RUSTC_WORKSPACE_WRAPPER`, `rustflags` and
  `rustdocflags` by an empty `CARGO_ENCODED_RUSTFLAGS` and `CARGO_ENCODED_RUSTDOCFLAGS`, the
  registries and sources by `CARGO_NET_OFFLINE`, and `resolver.lockfile-path` by
  `CARGO_RESOLVER_LOCKFILE_PATH`), so they don't. Anything named `.cargo/config.toml` or
  `.cargo/config` in a folder above the checkout, a link included, is refused outright.
- A download goes over `https` only, on the usual port, to its entry's hosts, following at most 5
  redirects itself, each held to the same rules, and refusing an answer its `fetch` was redirected
  to unseen, with no token or cookie. In the app it goes through `net.request` (`netFetch` with
  `stream`), so it takes the system's proxy, and reads the connection only as fast as the file is
  written. It's written to `<cache>/servers/.partial/` and stopped past the pinned size, and nothing
  reads it before its size and hash match. A connection that fails, brings nothing for 30 s, an
  answer's headers included, or brings less than 16 KB in any 5 minutes, is tried 3 times in all,
  and a download as a whole has no deadline.
- Then it's unpacked there: a `tar.gz` (npm's `tar`), a `zip` (`yauzl`), a gzipped program, a
  program as it is, an npm package's tarballs laid out as `node_modules`, or layers, each tarball's
  component folder laid over the one before, with nothing run. Absolute paths, `..`, hard links,
  devices, links that resolve outside and a path two layers both write are refused, and so is more
  than 100,000 entries or 2 GB, or, for a download recorded with what it unpacks to, more than that
  and 5%. Before a download starts, the disk must have room for it and what it unpacks to.
  Everything is synced to the disk, a marker last, before the folder is renamed into
  `<cache>/servers/<id>/<version>/`, or a toolchain's into `<cache>/toolchains/<id>/<version>/`. The
  marker names what it holds, the version of the rules it was unpacked under, each file's size, each
  folder and each link's target; a folder whose marker doesn't match, or whose files, folders or
  links don't match its marker, any folder below `<cache>/servers/` or `<cache>/toolchains/` that's
  become a link included, is removed and fetched again. Two installs of a version at once make one
  download.
- A server installed by the user is used only from where its adapter says it may be, when the app's
  folder check passes it (the one git is held to), it isn't in Lo's cache, and it isn't a version
  manager's shim, which picks a program from the checkout.
- The servers that run on Lo's Node have their adapters in `src/adapters/`: vtsls for TypeScript and
  JavaScript, and Pyright for Python, each from npm. Each starts as Node, by its absolute path, with
  a cap on its heap, then the server's own entry point, never npm's launcher. What it's told is the
  adapter's alone, and nothing in the checkout picks what runs: vtsls runs its own TypeScript, loads
  no `tsserver` plugin from the checkout, and acquires no types; Pyright's Python is `/dev/null`, so
  it runs no interpreter. A plugin a `tsconfig.json` names is still looked for by its package's
  name, beside Lo's TypeScript and in each `node_modules` above Lo's install, which neither vtsls
  nor `tsserver` can turn off (`test/plugins.test.ts`): on a Mac, where the cache is outside the
  home folder, that's never `~/node_modules`; on Linux it can be. No server has a sandbox: each
  reads what the user can, outside the checkout too, and Lo never opens a place outside the checkout
  an answer names. Each says whether it gives inlay hints (`hints`): Pyright and terraform-ls give
  none. The package's README lists each with its source, version and license, and a server's details
  name its license beside its version.
- Rust's server, rust-analyzer, is a compiled program Lo downloads, with its adapter in
  `src/adapters/` too, run on Lo's Rust toolchain. It runs Lo's `cargo` and `rustc` (`CARGO`,
  `RUSTC`, empty `RUSTC_WRAPPER`, `RUSTC_WORKSPACE_WRAPPER`, `CARGO_ENCODED_RUSTFLAGS` and
  `CARGO_ENCODED_RUSTDOCFLAGS`, `cargo.sysroot` set), reads no `rust-toolchain.toml` (no rustup),
  fetches nothing (`CARGO_NET_OFFLINE=true`, a private `CARGO_HOME`), writes nothing in the checkout
  (the `Cargo.lock` `cargo metadata` writes for a workspace that has none goes to
  `CARGO_RESOLVER_LOCKFILE_PATH`, a file in its home for its checkout alone, removed as it starts,
  so it starts again on another checkout rather than moving there), and runs no build script or
  proc-macro (`cargo.buildScripts.enable` and `procMacro.enable` off), so a crate's dependencies it
  can't resolve offline load without them.
- PHP's server, php-lsp, is a program of its own, with its adapter in `src/adapters/` too: an
  archive per platform from its GitHub releases, which nobody signs, so `lsp:pin` checks each
  against the checksum its release lists beside it. It starts as its program, by its absolute path,
  and needs no PHP. It's told which PHP to read code as, so it never runs a `php` to ask; it runs
  neither PHPStan nor PHPCS; and it skips `vendor/` as it indexes, for its memory and time. Its
  cache is where it keeps one by default, `.cache/php-lsp` in its `HOME`, with its own caps and
  cleanup: Lo names no `cachePath`, which php-lsp would take as the whole cache, and sets no
  `XDG_CACHE_HOME`. What Lo tells it wins over a checkout's `.php-lsp.json` key by key, and that
  file can't turn the tools on or move the cache.
- Go's and Terraform's servers are programs of their own too, started as php-lsp is
  (`launchNative`), with their toolchains' folders and variables: gopls for Go, with Lo's Go, its
  settings turning vulncheck off and its heap held under the cap by `GOMEMLIMIT`; and terraform-ls
  for Terraform, from releases.hashicorp.com, given `/dev/null` as Terraform so it runs neither
  `terraform` nor a provider's plugin, and so reads only the provider schemas it carries. Each
  adapter's comment says what in a checkout can reach its server and what can't.
- Java's server, Eclipse JDT LS, runs on Lo's Temurin JDK: one archive for every platform from
  download.eclipse.org, which `lsp:pin` checks against the SHA-256 Eclipse lists beside it, since
  only some of its jars are signed. It starts as the JDK's `java` with `-jar` and Equinox's
  launcher, with `JAVA_HOME` the JDK's. It imports nothing: Gradle's and Maven's imports are off,
  and every folder is left out of its search for build files, so it reads no `build.gradle`,
  `pom.xml` or `.project`, and runs no build script, wrapper, plugin or annotation processor. Lo
  finds the checkout's source folders from each `.java` file's package, read past comments and
  annotations by a small scanner that leaves out any file it can't read (`sourcePaths`, in the
  20,000 folders and files nearest the root), and JDT LS makes a project of them in its home,
  compiling nothing. What a server is told can depend on where it runs: an adapter's `place` gives
  it, as it starts, arguments, variables, files written in its home and settings. JDT LS's `place`
  names its home as the JVM's home and temporary folder, Equinox's configuration and its workspace,
  writes a `gradle.properties` that holds a Gradle to Lo's JDK in Gradle's home (`GRADLE_USER_HOME`,
  one of its `homeFolders`), and has its JVM look names up only in an empty hosts file there. It
  uses no proxy, which would look names up itself (`jdt.ls.disableProxies`,
  `java.net.useSystemProxies=false`), so Buildship's look for Gradle's versions and the
  search.maven.org lookup of a `lib/` jar's sources, which no setting stops, reach no host. Java
  isn't available for a repository that commits Eclipse's `.settings` folder at its root, which
  Java's server would read and write as its project's (the adapter's `checkout`, asked after the
  toolchains' `checkoutProblem`). It finds its folders only as it starts, so it starts again rather
  than moving (`stays`).
- C#'s server, Roslyn, is a package per platform at the build the C# extension for VS Code's newest
  stable release ships, from the feed that extension gets it from, Microsoft's `msft_consumption` on
  Azure DevOps, which `lsp:pin` takes only signed by Microsoft. It starts as Lo's `dotnet exec` on
  its own assembly, with the SDK's variables and `DOTNET_GCHeapHardLimit`. It never loads a project
  of the checkout's, since MSBuild runs what a project and the files above it bring: Lo writes
  `project/checkout.csproj` in its home, listing the checkout's `.cs` files and importing only the
  SDK's own files, with no restore, package, analyzer or source generator, sends it that project
  (`project/open`), and tells it, and runs it in, that folder (the spec's `workspace`), so it never
  moves with the head and never looks through the checkout. Its settings turn off restores,
  file-based programs and fetched sources. The adapter's comment says what reaches it and what's
  lost.
- Swift's server on macOS, SourceKit-LSP, is the one Lo doesn't download: it comes with Xcode and
  with Apple's Command Line Tools, and Lo runs the copy in the developer folder that
  `/usr/bin/xcode-select -p` names when run with only the system's `PATH` (`developerFolder`), never
  the `/usr/bin` shim, one on `PATH` or what `xcrun` finds, which read `DEVELOPER_DIR` and the like.
  Given a workspace it would run what a checkout's build files name (a build server, SwiftPM's
  manifest and plugins, a compile database's flags) and read its `.sourcekit-lsp` settings, which no
  option turns off, so it runs rootless: told of no workspace (`rootUri` and `workspaceFolders`
  `null`), in its home, each file Lo opens built only by the fallback settings Lo gives it and the
  macOS SDK. What depends on where it runs comes from its adapter's `place`, once its home is made:
  its generated files and module cache in its home, by its options, and `CFFIXED_USER_HOME`, so
  Foundation's home folder is its home too. A checkout with a `buildServer.json`, a `.bsp` or a
  `.sourcekit-lsp` anywhere in it is refused all the same (`sourceKitCheckoutProblem`, asked through
  the adapter's `checkout`), against a later SourceKit-LSP that looked for them beside a file. Its
  answers are each file's own, and it finds references only in a build's index, so `gr` answers from
  the syntax index (`noReferences`). Its `SourceKitService` is an XPC service `launchd` starts,
  outside the server's group, so the adapter names it (`services`) and each read of the family takes
  in the process of that name whose `HOME` is exactly the server's home: it counts against the cap
  and is stopped with the server. It also reads the machine's
  `/Library/Application Support/org.swift.sourcekit-lsp/config.json`, which no option turns off;
  Lo's options win over it key by key.
- Swift's server on Linux is the SourceKit-LSP in the Swift toolchain Lo downloads for the
  distribution, which `/etc/os-release` names (`swiftDistroFor`): its own release, the one a
  distribution built on Ubuntu, Debian or Red Hat Enterprise Linux names, or for Fedora, the newest
  swift.org builds for, Fedora 41, with `libxml2_2.13` besides from Fedora 45, which moved libxml2
  past the library the build links. It's started and told as on macOS, rootless and refusing the
  same checkouts, with no SDK and no service: `sourcekitd` runs in its process. `CFFIXED_USER_HOME`
  matters more there: Foundation on Linux takes its home folder from that, then from the user's
  entry in the system's list of users, and from `HOME` only without one, and SourceKit-LSP writes
  its logs in `.sourcekit-lsp/logs` there. The toolchain needs some of the distribution's packages,
  those swift.org's install instructions list, so before anything downloads Lo looks for them in
  dpkg's list or asks rpm (`missingPackages`), and with any missing, Swift's item says which and the
  command that installs them. A Linux none of swift.org's builds fits has no Swift server.
- Tests start only the fake server, `testing/lsp/fake-server.ts`, at most two at once in a test
  file, each killed with its group when the test ends. No test starts a real server or downloads
  one: download tests serve archives they build from a server on this machine. The live check,
  `pnpm nx run lsp:live`, by hand only, installs what's pinned, toolchains included, into
  `~/.cache/lo-live/`, or the folder `LO_LIVE_CACHE` names, starts each server as its adapter does
  on the checkouts the code fixtures build with `--local`, asks what `gd`, `gr`, `K`, `gh` and `gO`
  ask at the places `testing/fixtures/code/cases.json` names, and fails if anything ran what the
  hostile fixture plants, wrote in a checkout or held an internet socket. One real server runs in
  CI: the `swift` job, on Ubuntu 24.04, runs `pnpm nx run lsp:sourcekit` (`scripts/sourcekit.ts`)
  when Swift's pins change, or anything it runs does (the workflow lists them: `@lo/lsp`'s and
  `@lo/git`'s source, the lockfile, the code fixture's script and projects). It installs the
  distribution's Swift with Lo's installer and the packages swift.org lists with `apt-get`, starts
  SourceKit-LSP as Lo does on the code fixture's checkout, and fails unless it answers a hover on
  `countWords` with its signature, keeps its logs in its own home and writes nothing, at any depth,
  in the runner's: it lists the home before and after, and names what was added, changed or removed,
  but in the runner's own folders (its work folder and its logs).

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
- Every read from GitHub goes through Chromium's network stack (`src/main/fetch.ts`, on
  `net.request`), so it takes the system's proxy, with nothing kept in Chromium's cache and no
  cookie. Electron's `net.fetch` isn't used: it fails a redirect GitHub's client asks to see, and
  the client follows redirects itself, only to where the token may go.
- Every write (a request the client marks `once`: each but a `GET` or a GraphQL query, and each form
  posted to GitHub's website) is sent at most once, over undici, Node's HTTP stack, on one HTTP/1.1
  connection of its own (`src/main/once.ts`), never through Chromium, which sends a request again by
  itself when the kept-alive connection it reused drops before the answer. It takes the first way
  Chromium names for the address (`session.resolveProxy`): direct, or an HTTP, HTTPS or SOCKS5
  proxy. A proxy that fails, or one of another kind, stops the write, which never goes another way.
  It trusts what Node's `--use-system-ca` does: Node's bundled roots, the system's that Node reads,
  and `NODE_EXTRA_CA_CERTS`. A write whose connection drops after it went fails as an answer lost,
  so it may have posted.
- Each account's requests go one at a time through its poller's queue. One whose answer hasn't begun
  within 15 s (GitHub gives up on a request after 10 s), or hasn't all come within 30 s, is given up
  as an answer lost, so the queue goes on: a read is tried again later, and a write may have been
  done, so it's never sent again by itself. An upload has a limit of its own. The one exception to
  the queue is the read of whether an account can write to a repository, which attachments ask first
  (`comments.attachable`): it's read with the account's client, outside the queue, with the same
  limits, so nothing waits on it. A view's first read of its review threads goes ahead of polls and
  of the tab's other reads while it's on screen, as an opening tab's overview reads do, since the
  diff's first draw waits on it. A background read gives way to those, and to the pull request's
  files while the diff is on screen: it waits while one is under way or next, rather than take the
  queue between its requests, unless it's one of the poller's own, or the tab's read of the pull
  request as it opens, which the open pull request's first poll waits for
  (`RequestQueue.giveWayWhile`). A `next` read, as the Files panel's list beside another view, goes
  right after those, before the other background reads, polls included; and a poll, which holds the
  queue for all its requests, waits for a pull request's files someone wants soon rather than start
  between their pages, but for one tried at once, which goes ahead of every poll merely due, however
  overdue: the reads waiting give way to it, so none of them waits on a poll that waits on them. A
  read whose first part is what someone waits on, as a timeline's newest page, can go aside once
  that's in: the rest goes on beside the poll loop, at `next` while someone waits on it, held behind
  a pull request's files someone wants soon (`gate`'s `holds`), and polls but the open pull
  request's details wait for it too. It stops at its next request once its read is let go of, as its
  tab closes, and a run of a read let go of, or of one let go of and asked for again since, writes
  nothing.
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
- A build run from source takes other waits on GitHub from three more, for its tests, so a test
  needn't wait out Lo's own; a packaged build ignores them. `LO_POLL_MS` is how often it reads
  what's on screen, in place of 20 s: the pull request on screen, the merge queue a queued one is
  in, and a merge queue's tab. `LO_WATCHED_POLL_MS` is how often it lists each watched repository's
  open pull requests, each list looking up the merged pull requests the last one left out, and reads
  the pull requests it watches off screen, in place of 2 minutes. `LO_ANSWER_START_MS` is how long a
  request waits for GitHub's answer to begin before Lo gives up on it, in place of 15 s. For these,
  `LO_DEVICE_POLL_MS` and `LO_HOLD_LIMIT_MS`, a wait below 1 ms, or past the longest a timer takes,
  2,147,483,647 ms, is left for Lo's own.

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
- The first time a tab is shown, main reads the pull request, ahead of polls while it's on screen,
  and fetches it into the local copy through `@lo/git`, with the account's token, read as each fetch
  starts. A fetch that fails is tried again after 5 s, doubling to 5 minutes, unless waiting won't
  help, and a tab reads what an earlier fetch brought while GitHub can't be reached. The poller
  takes that read for its first poll of the pull request (`setOpen`), which reads its details only
  after the first reads of the view on screen.
- The head on screen is GitHub's when the tab opened. A newer push says so in a banner, and moves
  nothing until it's loaded.
- The `tab.open` setting says which middle view a pull request's tab opens on: the overview, the
  timeline or the diff. A tab that opens on the overview waits for it, up to `HOLD_LIMIT`, and goes
  to the timeline, where the description is first, when there's none or it's late. The tab keeps its
  middle view by id (`Panels.middle`): while that view isn't there, as the overview isn't with
  `overview.on` off, the timeline stands in, and the tab goes back to it when it returns. The key
  `tab.open` replaced, `overview.open`, stays declared, file-only: main carries a `diff` saved there
  over once, where `tab.open` is still its default, then sets it to `null` (`tab/main/carry.ts`),
  and the window reads it meanwhile.
- The row's layout is the window's, every pull request's tab alike: each panel open or not, and its
  width, unset while it's the default. Main keeps it in `tab_window` (`tab.layout`,
  `tab.keepLayout`), clamping each width to its limits as it's read, and a layout that won't read is
  the first one. The window reads it before it draws a tab, so the first frame is laid out, and
  keeps each change as it's made: a switch flipped, a drag's end, a key's step. `layout.ts` draws it
  with `fit` in the row's width, which puts away what has no room, and remembers the panel asked for
  last; what's drawn, not what's kept, is what the panels' buttons, the menu's checks and
  `rightShown` say. The same row keeps the window's place (`tab/main/window.ts`): as each window is
  made, main moves it where the last one was, as big, maximized or full screen if it was, unless the
  display that held its top is gone. Part of it off every display, it's fitted to the display that
  holds most of its top. Main keeps its place as it settles, and as it closes or as Lo quits,
  whichever comes first: the database closes as the feature stops, and a window made after keeps
  nothing. A panel asked for, put back by Reset layout, or back as its key or button closes the
  other, fades in with Swap, and focus in a panel goes back to the middle view as the panel stops
  being drawn, by any route.
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
  build ignores it. Out of reach carries why, as `causeOf` names it, from the poller's status or the
  tab's own read: only no connection at all is offline, and a read GitHub took and never answered is
  no answer in time.
- A read that waits on GitHub (out of reach, the rate limit, a refused token) leaves what the tab
  kept on screen, and the header's chip says why. With nothing kept to show, the tab can't open its
  pull request: it says why in place of its view, with the read's cause, until the read that's due
  opens it. Out of reach, it stays on its loading view until that has lasted, as the chip waits, so
  a blip says nothing. Read as nobody while an account is signed out, a read GitHub refuses or finds
  nothing for names that account, since signing in to it again may open it: the one remembered for
  the repository or its owner, else one GitHub refused as Lo checked which can see it, else the only
  account there is, and none where other accounts are signed in. An account added, or signed in
  again, has a tab read as nobody under the rate limit work out its account again, and has the
  others name the signed-out account afresh.
- What says GitHub gave no answer, anywhere, says why, by the cause `causeOf` gave it, which crosses
  as data for the window to word with `offlineLabel`, `chipLabel` and `explain`: the tab's
  connection, merge's `Off` and its refusals for it, the queue's `ActWhy` while its poller can't
  reach GitHub, the overview's `offline` problem, and the stall of a poller that can't read now,
  which the merge status and the review threads carry. Main words none of it.
- The window gets what it shows on `tab.pull`, `tab.files` and `tab.local`, each sent only when it
  changes, and asks for all three with `tab.state`. None of it holds a token. A ready local copy
  says where its clone is (`folder`), `~` for the home folder, which its status bar item's details
  show. Copy path and Show in Finder ask main (`tab.copyLocal`, `tab.showLocal`), which copies or
  shows the whole path it keeps for the view, never one the window names, and refuses a folder
  that's gone (`gone`). `tab.copy` puts up to 1 MiB of text on the clipboard, and `tab.openExternal`
  opens pages on `https://github.com/` only, for every feature.
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
  head and the pull request's files from the REST API, the files read once for the tree and the diff
  (`SharedPullFiles`, through `poller.pullFiles`, or `anonymousPullFiles` as nobody), kept 30 s, and
  only while one of them still wants them when a page's turn comes. While their tab is on screen,
  they go first if the diff is its view on screen, as the window says (`diff.shown`), else right
  after the reads that view waits on first, ahead of polls (`next`), while the Files panel is drawn
  (`tree.shown`), else in their turn; they move up if the diff, or the panel, comes on screen while
  they wait. A tree GitHub lists only in part, or one that couldn't be read, leaves the changed
  files alone, saying why. What the copy says replaces what GitHub said, and a new head on screen
  starts again. A stack's layer compared with the layer below lists what changed from GitHub's
  comparison of the two commits (`readComparison`), 300 files at most, until the copy has worked out
  where the head meets that commit, and the pull request's own files when GitHub can't compare them,
  without asking again. A new start reads what changed again, and keeps the files. GitHub is asked
  only about a head it gave, never one restored from what Lo saved, and a read that fails is tried
  again after 5 s, doubling to 5 minutes.
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
  has, and the copy lacks, is no longer available, and can't be compared. The revisions are built
  again with the copy's commits once it's ready, and are settled from then (`settled`); or without
  them when there are none to be had (no git, or the copy failed or waits to try again), or once
  they're `SETTLE_LIMIT` (2 s) late, so a copy later than that changes them once more at most. Until
  then a revision may come or go.
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
  `HOLD_LIMIT`, and past it shows the timeline in the overview's place, and the diff, or the file
  whole, in the place's. A build run from source takes another bound from `LO_HOLD_LIMIT_MS`, which
  main hands the window in `app.info`, so a test that isn't about the bound doesn't race it on a
  busy machine; a packaged build ignores it.
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
  `poller.readCached`, kept with its ETag and read again on the 5-minute refresh), while overviews
  are on (the overview feature's `overviews` service). Turned off, the finder has the poller forget
  that read (`forgetRead`), so no refresh makes it.
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
- The offer over the tree to convert the stack, and the banner that offers where a layer's diff
  starts, each have Dismiss, whose menu (a `notice` target naming the tab, which `⇧F10` on Dismiss
  opens too) dismisses it for this stack or this layer, or for all stacks. Main keeps the first in
  `stacks_dismissed`, for each layer the stack has then, or for the layer, and sends neither offer
  while it's dismissed there. The tree's offer is kept by which it is, `convert` or `add` (layers
  not yet in the GitHub stack below them), so dismissing one leaves the other. "For all stacks"
  turns off its setting, `stacks.offerConvert` or `stacks.offerStart`, whose switch in Settings ›
  Pull requests turns it back on; main sends no offer before it has read the file.

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
- Main says what a link is, and why it opened nothing, as kinds (`preview`, `refusal`, `blocked`,
  `cause`), never in words: `window/words.ts` words them, the same under the open box's field, the
  welcome's and in a note.
- Other apps hand Lo links as `open-url` events (`lo://`, and web links from a link router), and as
  the arguments of a second launch, which hands them to the Lo running and quits. A packaged Lo
  registers itself for `lo://` as it starts.
- "Install `lo` command", in Settings and the command palette, with no key since it's done once,
  writes `lo`, a shell script that takes one argument, refuses anything but a `lo://`, `https://` or
  `http://` link, and passes it on quoted: on macOS to `open -n -b com.scornz.lo --args`, since
  `open` drops the arguments of an app that's running, in `/usr/local/bin` once the system's prompt
  for an administrator allows it, or `~/.local/bin`; on Linux to Lo's program, in `~/.local/bin`. It
  never replaces a `lo` it didn't write, or one it can't read. A build run from source writes it in
  `LO_COMMAND_FOLDER` when that's set, without asking, and a packaged build ignores it.

### Updates

The `updates` feature checks GitHub Releases for a newer Lo, offers it, and, where Lo can replace
its own app, installs it when the reader says so.

- **Who checks.** Only a packaged Lo that has `app-update.yml` among its resources, which only a
  release build writes (`build/release.yml`), so the zips `desktop:package` makes and a build run
  from source never check. It then checks the releases of `withlo/lo` on github.com whatever the
  file says: the feed's options are Lo's own constant, never private and never with a token, so
  nothing from `GH_TOKEN` or `GITHUB_TOKEN` reaches GitHub. A build run from source checks only a
  feed `LO_UPDATES_FEED` names at `http://127.0.0.1:<port>/`; a packaged build never reads it, and
  `check-package.sh` and `check-linux.sh` prove it never asks that feed.
- **The library.** electron-updater's GitHub provider, in the version electron-builder pairs it
  with, wrapped in `main/updater.ts`: nothing downloads until asked, none is offered an older
  version, and no id of the copy goes with a request (electron-updater's per-copy staging id is one
  constant). Under Electron, electron-updater's own time limit never fires, so Lo gives up on a
  check GitHub hasn't answered in 60 s, cancels its requests, and the next check asks again. A
  prerelease of Lo reads the feed twice, so it's offered the newest release as well as its channel's
  prerelease, and a release is never offered a prerelease.
- **How a copy takes an update** is decided as Lo starts, and again for each offer and before Lo
  moves or downloads (`main/how.ts`): `install` on a packaged Mac in an Applications folder it can
  write (`/Applications` or `~/Applications`), where electron-updater downloads the zip, checks its
  SHA-512 and hands it to Squirrel.Mac, which installs it only if its signature is the running Lo's;
  `brew`, checked first, in an Applications folder while Homebrew's Caskroom has `lo`
  (`/opt/homebrew/Caskroom/lo` or `/usr/local/Caskroom/lo`), where Lo never replaces itself, since
  Homebrew's record of the version would go stale, and the toast gives `BREW_UPGRADE`,
  `brew upgrade --cask withlo/tap/lo`; `move` on a Mac anywhere else, such as the disk image or a
  translocated download, where "Move Lo to Applications" asks before it replaces a Lo already there,
  in Lo's own dialog (see "Questions main asks"): Electron's move takes its answer at once, from
  inside the move, so Lo first moves replacing nothing, asks only once that stops at a Lo in the
  way, and moves again once the reader says "Replace Lo" (`main/move.ts`), unless Lo can't write
  Applications, where macOS asks for an administrator's password and Electron replaces a Lo there
  without asking Lo first, as it always has; `page` on Linux, from source, or where Lo can't write
  its own folder, where "Download update" opens the release's page. Only `install` builds
  electron-updater's Mac updater: the rest get one that can check and has no way to download.
- **When.** 30 s after the window is up, then every 6 hours, and on `updates.check`, the command,
  the overview's "Get a newer Lo" and Settings' "Check now". The `updates.check` setting (on) turns
  off only the timed checks. A timed check that fails is logged and tried at the next, and one the
  reader asked for says why it failed: main sends a kind (`failure`), and `window/words.ts` words
  it. A copy that doesn't check, as a build from source, offers Lo's releases on GitHub instead of
  another try.
- **State** is one topic, `state`: `idle`, `available` (the version, the first line of the notes as
  plain text cut to 140 characters, `how`, and the release's page), `downloading` and `ready`. The
  page is built from the version, which must be SemVer, never taken from the feed. The requests are
  `read`, `how`, `check`, `install`, `restart`, `later` (hides that version until Lo starts again,
  or a check the reader asked for) and `move`. `install` downloads, and a download that fails goes
  back to `available` with why. A finished download installs as Lo quits, and Lo restarts into it
  only on `restart`: it quits through its own `will-quit` stop, so every feature stops, and only
  then calls `quitAndInstall()`. If the installer can't, or takes over 15 s, Lo quits anyway and the
  update installs then.
- **The window.** The toast is in the `tab.toasts` slot, below a note that passes, and it waits
  until it's acted on. It never takes focus, no button installs or restarts but by its own press,
  and a press in the half second after a toast comes or changes does nothing. Every button is a
  keyless command too: Lo's menu in the app menu holds "Check for updates", or "Restart to update"
  in its place once an update is ready, and Help holds "What’s new". Settings' Updates section shows
  the version and commit, "Check now" and the switch for `updates.check`. The overview runs "Check
  for updates" through the command registry, importing `updates/keys.ts`.

### The welcome flow

The `welcome` feature draws over a tab through the tab feature's `tab.cover` slot. It's six steps,
one job each, walked with "Continue", "Back" and "Skip": an account, the look, the keys, overviews,
set-up, and opening a pull request.

- **When it opens.** By itself over the Recent tab, for a reader who hasn't finished it and has no
  account signed in: none is, or GitHub refused every one. "Skip", "Done" and a pull request opened
  from it finish it, which main keeps (`welcome.finish`, read back with `welcome.state`), so it
  never opens by itself again. `welcome.show` ("Welcome to Lo", in Help, the palette and Settings ›
  About) opens it again over the tab on screen. Until Lo knows the accounts and whether it was
  finished, the Recent tab is covered by plain ground, so its list never shows under a welcome
  that's about to open. Signing in from it doesn't close it: the first step says who signed in. An
  account that signs in before the reader has touched the welcome, as one added from another window,
  does.
- **The steps.**
  1. The mark, which plays Unmeld once, what Lo is for, and an account: signing in (through the
     accounts feature's dialog) or importing from GitHub CLI when Lo finds one. A notice with "Check
     again" is here when Lo can't find a Git it can run: `welcome.checkGit` asks main to look again
     (`git.check()`), and what Lo finds reaches the window on `app.git`.
  2. How Lo looks: `theme` and `diff.layout`, each a group of `Choices` cards with a `picture`,
     written as a card is pressed. The feature that owns each setting offers it from its
     `window/shared.ts` as a `SettingChoice` (`choiceOf`), and the step reads and writes it with
     `useChoice`. A write the file refuses is the `Problem` the setting's row in Settings shows,
     under its group, and the cards show what's on file again.
  3. Standard keys or Vim keys, which is the `editor.vim` setting, written with the comments
     feature's `chooseVimKeys`. A diff drawn for the step is where `j`, `k` and `c` work. `c` opens
     the comment box every comment is written in (`createComposer`), with the keys chosen. Nothing
     typed there is sent.
  4. What an overview is: the overview feature's `Example` (`OverviewExample`), then `overview.on`
     and `tab.open` as the rows Settings has, each put in the `welcome.overviewRows` slot by the
     feature that owns it, with no icon, and written with `useSettingChange` as it's changed. Focus
     starts on "Continue" here, so `⏎` never flips the switch.
  5. The rows in its `welcome.setup` slot: installing the `lo` command, which the open feature does,
     and sending pull request links to Lo, with the rules for Finicky, Velja and Choosy in
     `docs/link-routers.md`. Another feature's row goes in the slot as a `SetupItem` from `@lo/ui`,
     in `order`, and the same thing has a row in Settings. A row says how its button's press went on
     itself (`below`), never in a toast: the `lo` command's row installs with
     `installCommand('row')`, which leaves the result for the row. The overview skill's row is there
     only while there are overviews.
  6. A field that opens a pull request's link through the open feature, and a sample pull request,
     whose line says it has an overview while there are overviews. The mark plays Kiss as the step
     first appears.
- **Choosing.** Each press of a card writes its own choice, so the last one pressed is the one that
  stays, and its group shows that card until every write of the setting has ended (`choosing` in the
  welcome's store, by the setting's key); then it shows what's on file. Back, Continue and Skip
  write nothing.
- **Moving between steps.** Each step is drawn afresh as it shows, in a `Swap`. The mark's moves
  play once each time the welcome opens: a step the reader comes back to draws the mark at rest.
- **Keys.** Under the welcome the tab's view is `inert`, so no key or reader reaches it. The welcome
  is a form like Settings: its scope has `data-lo-tab="browser"`, so `Tab` walks its controls. `⏎`
  is `welcome.continue`: it presses the button, switch or segment with focus, opens the link in the
  field once it holds one, and anywhere else presses the step's main button, which is "Sign in with
  GitHub…" on the first step until an account is signed in, "Open" on the last while the field holds
  a link, and "Continue" or "Done" otherwise. The main button carries the `⏎` chip. `⏎` on a
  choice's card is "Continue", since the arrows and `Space` choose. `⇧⏎` is `welcome.back`, whose
  control is "Back", with its key in its tooltip. Every step is in the tree from the start, in one
  grid cell, so the foot's buttons never move; the steps off screen are `inert`. "Continue" holds
  the room of its label with its key in every state. The foot stays on screen: in a window too short
  for a step, the steps scroll in a pane of their own above it, and what takes focus there comes
  into view with `reveal()`.
- **A feature that needs set-up** adds a row to the set-up step and a row in Settings. It doesn't
  put up a banner or a dialog of its own.

### The timeline

The `timeline` feature shows a pull request's GitHub timeline as the third of its tab's middle views
(`tab.middle`, order 30, after the overview and the diff).

- Main reads a view's timeline (GitHub's GraphQL `Timeline`) and what goes beside its description
  (`PullRequestSidebar`: labels, reviewers, assignees and draft state) the first time the window
  shows it, through the account's poller, which keeps both current from then on (`TIMELINE`,
  `PULL_REQUEST_SIDEBAR`). The window asks with `timeline.show`, and gets each change on the
  `timeline.timeline` and `timeline.sidebar` topics. A tab acting as nobody reads none, and asks the
  reader to sign in; a run of a stack's layers has none of its own.
- The reader waits on those first reads, so while the view's tab is on screen they go ahead of polls
  in the account's queue (`foreground`), as the review threads do, in the order of the reads' names:
  what goes beside the description, which is quick, then the review threads, then the timeline, and
  once its newest page is in, the push history the revisions feature reads, which the rows split
  pushes by once the revisions are settled (`settled`), so a push splits once. A timeline of more
  than a page sends its newest page while the older pages are read (`readTimeline`'s `onNewest`,
  never kept), and its older pages, off screen until the reader scrolls back, go aside once it's in:
  after the push history and after the pull request's files for the Files panel, ahead of polls
  (`Poller.timeline`). The view is `loading` with that page as its timeline, and the window draws
  it, with "Reading older events…" where the older ones go, and draws the whole timeline in its
  place as it comes, without waiting for input.
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
  full with `@lo/markdown`, and cuts the words at 120 characters, after reading, so none of a link
  or an image's syntax is left in them. Only the Markdown tree's raw HTML is read as the words it
  shows (`markdownTree`'s `html: 'words'`: an `<img>` is its alt text, or "image"); text, escapes
  and entities stay as GitHub shows them, so `if a<b then` and `&lt;b&gt;` are kept. The window
  holds the newest 2,000, joins an ask in flight for a comment wanted again, and the line shows none
  until its words are read.
- The threads panel lists the threads main sent once their openings are read (`listed`, in
  `window/threads.ts`), and keeps the last list until then, so a row is never drawn without its
  words and nothing in it moves as they come: an edited comment's row changes in one step. A row
  reserves its two lines of words whatever they are (`min-h-2lh`), so one that has none yet, or
  never gets them, is already its final height. The diff, the tree and the cards take main's threads
  at once. A row whose thread has just gone from main's list says so (`GONE`) to `⏎` and `x`, rather
  than that it isn't on the pull request.

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
  closed as viewed, still on the line; else under its block if the overview has it; else nowhere
  (`placeKept`). A diff drawn over the last one is drawn before the last goes, so a box is placed as
  it's taken down too, not only as a diff is drawn, once for all the boxes it took down. While its
  tab is on screen, from the moment the diff takes it down until a box takes it, whether the diff
  drawn anew is there yet or not, the status bar counts it as kept (`keptAway`), in one note for all
  such drafts, whose click, and "Show kept drafts", say where each is. A tab left, or closed, takes
  its diff down uncounted, and the diff drawn as it's shown again places its boxes. `kept` lasts
  until that diff has placed it or couldn't. Focus comes back only to a box that had it, with no
  key, click, wheel or app menu command since, no key held for the rest of a sequence, and focus
  where the redraw left it.
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
a comment box, a dialog, the palette or a menu, "Submit review…" in the header beside the merge
status (`tab.headerStatus`), or the status bar's "3 pending comments", opens the submit dialog
(`tab.dialogs`). The palette says the count too, "Submit review… · 3 pending": a command's handler
may say something after its label (`detail`).

- The dialog asks main what it shows as it opens (`review.dialog`): your pending review and its
  comments, the revision on screen, and whether you opened the pull request, in which case Approve
  and Request changes are dimmed with why. `window/model.ts` words the verdicts and the refusals,
  and works out where the dialog has got to (`stepOf`: its main button, the button that leaves and
  what went wrong), as plain functions tested alone, and plans the review with `@lo/review`'s
  `YourReview`, so what can't go dims the button or the verdict before anything is sent. A banner
  says once when your pending review sits on another revision than the one on screen.
- The summary box is the comment box's editor (`createComposer`), in the comment box's frame: headed
  "Summary", with Write | Preview. Main keeps its text with the comments' drafts (`comments.drafts`,
  as a `summary` place), saved as it's typed. Files are attached to it as to any comment box,
  through the comments' `window/shared.ts`.
- `review.submit` sends in its turn among the comments' writes to the pull request
  (`comments.reviews`' `inTurn`), with the poller's `sendReview`. The summary is marked sent, with
  when, as a comment's draft is. When GitHub's answer is lost, nothing more is sent until a fresh
  read of your reviews (`YourReviews`), made 10 s or more after the send, says whether it was
  submitted, by GitHub's clock, even after a restart; when GitHub refuses that read, the dialog says
  "Review not confirmed" and offers "Check again" (`review.check`), which only reads again. Only a
  read that finds it wasn't submitted lets it go again. Once it's submitted, the summary goes, and
  the threads and the timeline read again: an approval's dialog stays open, done, with the mark's
  kiss, and any other review's closes, with a toast that names the verdict, as an approval's does
  once its dialog was closed before the end. A tab acting as nobody or showing a run of layers can't
  submit, nor can one offline, or while GitHub asked Lo to hold off.

### Whether it can merge

The `merge` feature says in the pull request's header whether it can merge (`tab.headerStatus`), and
`m`, or a click on that line, opens the merge panel under it.

- Main follows each view on screen (`main/reads.ts`): its account's poller reads the merge facts
  (`poller.mergeFacts`), and `@lo/review`'s `mergeSnapshot` maps them with the head on screen, the
  method last used in the repository (`merge_methods`) and, only where the rules want the head up to
  date, whether the local copy's head holds the base's tip, fetched first (`main/holds.ts`), asked
  again at a later read, backing off, while the copy can't tell. Each view's status goes out on
  `merge.status` as it changes, and `merge.state` asks for it. A view acting as nobody, or showing a
  run of layers, reads nothing, and `m` says why. A view whose account's poller couldn't be had
  starts again once it's shown.
- A status says when it may be out of date (`stale`): a read after it failed, or the poller can't
  read. The header then says how old it is, as it does for one unread for ten minutes, and a ready
  pull request GitHub may not have told all of reads "Ready to merge · Lo may not see everything",
  never in the ready colour.
- The panel has a row for each reason, worded by `window/words.ts` as plain functions tested alone:
  `j` and `k` move, `o` opens the row's page, `Tab` steps through the methods the repository allows,
  `e` goes to the squash commit's title, `]t` to the next unresolved conversation, and `Esc` closes
  it. Only an `https://` page a view's status links opens, through main (`merge.open`). The status
  and each reason are rows to the right-click menus (`merge/status`, `merge/reason/<key>`), listed
  for the merge feature's commands only: Merge panel, and Open.
- A squash shows the commit GitHub would write (`merge.panel`), read as the panel opens and again
  when the head or the title moves, drawn without bidi controls, since the pull request's author
  wrote it. Text the reader types stands in front of it, kept per view in the window until the tab
  closes.

### Merging

`⏎` in the merge panel merges the pull request, or adds it to its base's merge queue, once the
dialog that opens in the panel's place (`tab.dialogs`) is confirmed.

- Main plans the merge from what GitHub said last (`merge.plan`, `main/merging.ts`) and keeps it
  under a key; the window confirms the key (`merge.confirm`) and never sends a merge itself. A plan
  runs once. Only a fresh `⏎` once the confirmation shows confirms it: the dialog drops held keys,
  ignores a press made before it showed, and leaves one a field handled. `Esc` forgets the plan.
- As it's confirmed, main checks again: the view still acts as its account, signed in; GitHub can be
  reached and isn't holding writes; the head on screen is the newest push the tab knows of and
  GitHub's head, with the merge facts whole and confirmed in the last 7 minutes, else read again;
  where the pull request sits is known (`main/where.ts`, with the open pull requests from each
  branch it merges into read afresh), and what goes with it is read again (`main/together.ts`);
  nothing else merges it or the pull requests it names; and no conversion runs on their path. When
  something the confirmation named changed, main asks again with a new plan; otherwise it says why
  it didn't send. `Esc` while it checks cancels it: its reads are given up and nothing is sent.
  Right before it sends, the tab, the account and the connection are checked again.
- Merges go through one `MergeJobs` for the app, with the head on screen as the `sha`, and the
  squash commit's text only as the reader typed it. One merge write to a pull request at a time,
  app-wide and whatever the account: `merge.writes` hands out the turns (`main/turns.ts`), and
  conversions to a GitHub stack wait for them. A merge outlives its view, and `merge.jobs` says how
  each goes. GitHub's `409` is followed as the merge it was already running. A lost answer is
  settled by reading the pull request, never by sending again, and the pull request takes no other
  merge write until a read made after it ended has settled it, as when its tab opens again;
  meanwhile a merge of it is refused with "Ask GitHub again", and "Ask GitHub again" is a read. The
  method is remembered for the repository once GitHub takes a merge with it.
- Done, a toast says so. Refused, or ended without Lo knowing how, the dialog says so while it's
  open, else a banner on the pull request's tab does. The panel's main button is off, with why,
  while GitHub can't be reached, asks Lo to hold off writing, or the account is signed out.
- Each time the panel opens, and as the window hears the stack's layers move (`stacks.stack`), main
  says where the pull request sits (`merge.place`, `window/placing.ts`), and the main button says
  what it merges, or, until main first says, that Lo is checking what merges with it. `⏎` waits for
  that answer, and asks again where what the panel heard keeps it from merging. A GitHub stack's
  layer merges with the open layers below it, as GitHub's Stacks API names them, at the heads it
  gave as the confirmation opened, read again at the press, where a stack that merges into another
  branch than the rules Lo read were for is refused and read again; the merge holds the turn of
  every layer, those above included, again while GitHub is asked again how it went, each as soon as
  no other write holds it, and the dialog shows each layer as the Stacks API says at each change of
  the merge, and which went in when GitHub stops partway. A chain that stacks could make a GitHub
  stack is made one first (`gS`, offered in the panel). One that can't merges from its bottom layer
  alone (`@lo/stacks`' `mergeOneLayerAtATime`): its base moves onto the root first when it isn't
  there, and the merge is planned under the root's rules; once GitHub says it merged, a run in main
  (`main/chains.ts`), while Lo is open, moves each layer on it onto the root, in order, once,
  whether GitHub's answer or a read of the pull request says first that it merged, holding their
  turns until then; after a squash or a rebase, not a merge commit, it says they need a rebase.
  After a queue entry it reads the pull request until it merges, for 6 hours at most, or leaves the
  queue; after a lost answer, for 15 minutes from the last one. Each move reads the base first and
  leaves one someone else moved; the first move that doesn't go stops the run, and nothing is put
  back. Above a chain's bottom layer, and on a bottom layer that needs a rebase, `⏎` is refused.

### Images from GitHub

The window shows an image from outside Lo only at a `lo-image://…` address, which main serves: an
`<img src>`, or a `<picture>`'s `<source srcset>`. `src/ipc/images.ts` holds the three kinds of
address, which the window builds and main reads, and the `comments` feature serves them.

- `lo-image://post/<view>/<address>` is an image in a post, at an address on one of GitHub's image
  hosts (`@lo/markdown`'s `imageAddress`), fetched as the account the view `<view>` acts as.
  `lo-image://avatar/<login>?s=<px>` is a person's or an organization's avatar, and
  `lo-image://bot/<slug>?s=<px>` a bot's, by its app's slug, as GraphQL names a bot. Features build
  them with `window/images.ts`; a team, or any other account, gets no address, and keeps its
  initials. Given where from (`Markdown`'s `images`), the Markdown renderer loads a text's first 30
  images, lazily, and shows the rest, and any that fail, as links.
- A bot's picture is its app's, which GitHub keeps at an address its login doesn't name
  (`avatars.githubusercontent.com/in/<app id>`): the bot's login there is someone else's picture, or
  a pattern. Main asks GitHub for the bot's account (`@lo/github`'s `botAvatar`,
  `GET /users/<slug>[bot]`) as the first account signed in, in its queue as a background read, and
  only while its rate limit is normal and GitHub answers; it fetches the picture its `avatar_url`
  gives, on the avatars' host alone, once it has the address, so asking takes none of an image's
  turns or time. `comments/main/bots.ts` asks about each bot at most once a run, one at a time, and
  100 bots at most, and keeps what GitHub said for the run, a bot it doesn't have included. After an
  ask GitHub answered with an error it asks nothing for a minute, twice as long after each failure
  in a row, an hour at most, or until an account is added or signs in again; one the account then
  shows (GitHub out of reach, a rate limit) waits on the account's status instead, until its poller
  hears from GitHub again. With no account signed in, a bot keeps its initials.
- An image is drawn as GitHub draws it: at the `width` and `height` the post gives it, its height
  following its width, inline in its text, and never wider than the text. A `<picture>` with a
  source for each `prefers-color-scheme` shows the one for Lo's theme: the window's color scheme
  follows Lo's `theme` setting.
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

### Questions main asks

The `ask` feature lets main ask the reader something in Lo's own dialog, and wait for the answer, as
the `updates` feature asks "Replace Lo in Applications?".

- A feature asks through `ask.asking`, `ask(window, question, signal)`, in the window whose request
  it's answering: a title, what happens that the title doesn't say, and the action's label. It
  answers whether the reader pressed the action. Anything else is Cancel: `⏎` and `Esc`, no such
  window, the window closing, `signal` aborting, Lo quitting, and a question asked while another is
  up, which stays up alone.
- Main gives each question an id and pushes it on `question`, and a window loaded meanwhile reads it
  with `read`. Only `answer` with that id, from the window it was asked in, ends it; any other
  answer is ignored. A question the window can't be told is never up: the ask fails, and the next
  one is asked as usual.
- The window draws it as a small `Dialog` in the `tab.dialogs` slot, over any other. Cancel has
  focus as it opens, so `⏎` presses it, and a held key's repeats do nothing.
- A question here guards against a slip, not against the page: whatever runs in the window can read
  its id and answer it. What the window must not decide by itself isn't asked here, so trust is
  asked in main's native dialog.

### Trust

The `code` feature decides which pull requests language servers may run on. Nothing else changes
with trust: highlighting, the diff, comments and the syntax index work the same on every repository.

- What's trusted is `code.trusted` in the settings file, a setting the window may only read: an
  entry `{ repo, id, at }` for a repository, and `{ repo, id, pull, from, fromId, at }` for one pull
  request from a fork, each `id` GitHub's node ID. An entry Lo can't read, as one without an `id`,
  is reported and ignored.
- Each view of a tab decides for itself (`main/decide.ts`), a run of layers as its top layer.
  Without git, nothing runs. With no entry naming its repository or pull request, it's untrusted,
  and nothing is read from GitHub. Once one does and the local copy is ready, main reads
  `PullRequestRepositories`: a repository's entry trusts the view when its ID is the base's and the
  head is in the base, and a pull request's when it matches the base's ID, the number and the fork's
  ID and name. A pull request whose fork is gone is a fork. A decision rests only on a read started
  after its view opened and its pull request was last pushed to or reloaded (`main/views.ts`), and a
  pull request's reads are forgotten once its last view closes. A read that fails leaves the view
  untrusted, and is tried again after 5 s, doubling to 5 minutes. A renamed repository, or fork, is
  asked about again.
- Only main writes trust, once its own native dialog, attached to the window that asked, says
  "Trust" (`main/confirm.ts`); `code.trust` only asks main to ask. It stays native, not one of the
  questions Lo draws itself: the window shows what GitHub and the repo hold, and whatever runs in it
  could answer a question the window draws, as it can't answer main's own dialog. "Cancel" is the
  dialog's default and its `Esc`, one dialog asks at a time, and closing the window meanwhile trusts
  nothing. A test answers it with `answerDialogs` in `e2e/app.ts`.
- While main trusts a view, the view's status says how far it has got (`trusting`: reading the
  repository's IDs, asking, saving), and the banner's and the status item's buttons show it
  ("Checking with GitHub", "Waiting for your answer", then "Trusting" once the reader said "Trust"),
  so a second press does nothing. A window loaded meanwhile reads it with the view's state, and main
  clears it however the ask ends, so no window waits on an answer that won't come. The read, which
  the reader waits on, goes ahead of the poller's waiting reads (`readOnce`'s `foreground`); it's
  given up on, leaving the queue, after 30 s, or once the window or the view's tab closes, which
  ends the ask. The write has no limit: it's local, and ends or fails, so Lo never says it couldn't
  trust what it then trusts.
- A failed ask is said where it was asked, in the banner or the status item's details, and the
  button comes back: `settingsFile` when what the settings file holds kept Lo from writing it, then
  what to do, with "Open the settings file", which opens it as text as the keymap file is opened
  (`settings/main/open.ts`), until the settings change; `unsaved` when the disk did; and `asking`
  while main asks about another view, whose window main brings forward. Asked from the palette with
  the banner gone, it's said in a note.
- An untrusted view's banner shows until it's dismissed for its repository (`code_dismissed`).
  Settings' Trust section lists the entries; its "Remove", or "Stop trusting this repo", takes one
  out: the entry that trusts the view, by the newest read, while it's checked again after a push
  too, or none. However an entry leaves the file, Lo stops the servers it alone trusted and lets go
  of their checkouts (`main/entries.ts`, `main/checkouts.ts`), and as it starts, of any checkout no
  entry trusts, for one taken out while Lo was closed.

### The syntax index

The `code` feature keeps an index of each view's definitions and the names its files refer to, read
with `@lo/syntax`'s tags, so code features answer on every repository, trusted or not. It needs no
trust: it reads blobs through git, never runs the repository's code, and has the background process
parse them under `@lo/syntax`'s limits.

- For each view, once its local copy is ready at what it compares, main indexes the new side's tree,
  then the old side's, the view on screen's first, one tree at a time (`main/indexer.ts`,
  `main/build.ts`). A tree shown by several views is built once.
- A file is read when its language has tags, it's at most 1 MB, and it's neither a lockfile nor
  marked `linguist-generated`; a minified file (a line over 10,000 characters) is skipped. At most
  20,000 files of a tree, and 200 MB downloaded for it, the files nearest the pull request's own
  first (their folders, then upward), in git's path order after (`main/select.ts`), going through a
  large tree a stretch at a time so main's other work runs between. Past either, the index is
  partial and says so, as it is for a tree with more files than git lists for Lo, which it doesn't
  read. Offline, it reads only what the clone has, and once the view is back online it builds what
  it left.
- Main reads the blobs in batches and sends them to the background process as `code.symbols` jobs,
  over its own port, a job at a time, each 500 files and 4 MB at most. The `code` jobs are main's
  alone: the window's port refuses them. A job that fails for its files (past its deadline or
  memory, or throwing) is tried again in halves, and a file that fails alone is kept as failed until
  the version changes. One that fails otherwise, as when the background process restarts, leaves its
  files to read again.
- The store is `<cache>/code/symbols.db`, which only a worker thread of main's opens
  (`main/store/`), so its writes and lookups never hold main's event loop: each blob's definitions,
  names and imports once, by its ID and language, stamped with the version of the grammars and
  queries that read it, and each tree's paths and blobs. A row with another version is read again as
  it's needed. Past 1 GB, the trees and then the blobs no open view holds go, least recently used
  first. Settings counts it with the cache, and "Clear the cache" clears it.
- The status bar says how far a view's index has got (`code.index`, the `indexed` topic): "Indexing
  code · 1,204 / 3,880" while it builds, again from the start once the cache is cleared, "Code
  index" once it's ready, with how many files a partial one has. Its details say what it is, its
  state, and once it's ready, how many of the head's files it read are in each language, by path and
  leaving out those it skipped, and when its trees were last built, from what it read or kept.
- The window asks over the code port (`port.ts`): a port main makes with each load of the page,
  handed over through the preload as `lo:code`, in the jobs protocol's shapes (`{ id, job, input }`,
  replies, `{ cancel }`). Main checks every message as plain data and each input against the
  contract, and answers only about an open view, while the port's window is alive, a tree that view
  shows and a line its file has (`main/serve.ts`). That's all the view check needs: Lo has one
  window, which every tab is in. Definitions are found by name among the tree's blobs and ranked by
  `@lo/syntax`, 100 at most; references are the blobs whose names include it, 2,000 files at most,
  each blob looked through once by `code.find` jobs for where, whatever paths hold it, and what's
  found goes to every one of them, 5,000 uses at most, "By name"; the hover is the top definition's
  line; the outline is the file's definitions, nested. An answer names its file by the side's commit
  and path, and the first 10 come with 30 lines around them.
- The window asks from the diff and the whole file, on either side, through the diff feature's
  `codeViews` (`code/window/navigate.ts`), and a new question cancels the last of its kind. `gd`
  opens a peek under the line, which comes on screen whole by the least scroll; one whose code is
  still to come is as tall as code gets, and stays so as it comes, so nothing moves without the
  reader. `j` and `k` pick an answer, drawn with its code at once when that came with it, and `⏎`
  goes there, in the diff on its side, or the file whole, as a jump. `gr` lists the references in
  the right panel, which shows one view at a time, and `Esc` puts the panel back as it stood. `K`,
  or the pointer resting on a word, shows a card over it that never takes focus and closes at the
  next input, which stops one still coming too. `gO` opens the outline. With no answer, the status
  bar says why and nothing opens. Each answer says where it came from (the peek's list, or its head
  for a single answer), and when the index answered because a server couldn't, why: "TypeScript is
  starting."

### Servers in the app

The `code` feature runs language servers on the views the reader trusts, and their answers come
before the syntax index's. A server is whatever an adapter (`main/adapters.ts`) says to start for
its languages: Lo ships those for TypeScript and JavaScript, and Python, each downloaded with the
Node it runs on; Rust, rust-analyzer, which runs on Lo's Rust toolchain; PHP, whose server is a
program of its own; Go, gopls, which Lo builds with the Go it then runs with; Terraform,
terraform-ls, which reads a `.tfvars` file as Terraform's variables; Java, JDT LS, which runs on
Lo's Temurin JDK; C#, Roslyn, which runs on Lo's .NET SDK; and Swift: on macOS, the SourceKit-LSP
that comes with Xcode or Apple's Command Line Tools, which Lo doesn't download, and on Linux, the
one in the Swift toolchain Lo downloads for the distribution. Without Xcode or the tools, Swift's
item says it needs Apple's Command Line Tools, and to install them with `xcode-select --install`; on
Linux, without the packages its toolchain needs, it says which, and the command that installs them.

- Nothing starts for a view nothing trusts: no download, no checkout, no server. Once a trusted view
  is on screen and a file its pull request adds or changes on the new side, or one asked about, is
  in an adapter's language, main checks out its head (`@lo/git`'s `checkout`) and starts that server
  there (`main/serving.ts`). A view checked again after a push keeps what runs, but nothing starts
  or moves for it until it's trusted again. Each start, restart, crash's restart and move checks,
  after whatever it waited for, that the view on screen is trusted then and shows the head of its
  checkout. Once a view of a pull request is decided untrusted, for whatever reason, a tab opened
  again included, and no other view of it is trusted, then or once the one that is closes, what runs
  on its checkouts stops, those stopping waited for, and they go; one finished after that goes as
  it's made. While its trust can't be worked out, as when GitHub can't be reached after a push, what
  runs stops and its checkouts stay.
- One server runs per repository and adapter, on the checkout of the head on screen, and moves with
  it: by `workspace/didChangeWorkspaceFolders`, sent only once trust is checked again, where it
  takes that and its adapter doesn't say it `stays`, as Java's does, else by starting again
  (`main/servers.ts`). A rootless server, told of no workspace, moves with only its files closed. It
  doesn't start on, or move to, a checkout its toolchains or its adapter refuse (`checkoutRefusal`
  in `main/toolchains.ts`): .NET's for a `global.json` that steers it, Go's for a `go.work` that
  reaches outside it, Rust's for a `rust-analyzer.toml` or a Cargo config that could load code,
  Java's for a `.settings` at the root, Swift's for a build server's file or SourceKit-LSP's
  settings anywhere in it. Its `HOME` is `<cache>/code/homes/<owner>/<name>/<adapter>`
  (`Cache.homeFolder`), which the cache's cap counts and trims and which goes with the repository's
  clone, but never while a server of the repository runs (see Git). Its `PATH` is its toolchain's
  folders, then Lo's git's, then the system's, so a git from a folder of other programs, as
  Homebrew's is, can't bring that folder's `go` ahead of the toolchain's.
- An adapter names what its server downloads up front, the server and the toolchains it uses, so the
  status bar adds them up from the first byte ("Java downloading · 38.1 MB of 177.4 MB"), counting
  only what isn't installed yet, in the units Settings counts in (`bytes` in `@lo/ui`). It gets only
  the toolchains it names. A toolchain that can't download says which and why ("The Temurin JDK
  couldn't download. …"). Toolchains are installed in `<cache>/toolchains/`, which the cache's cap
  doesn't count, and as Lo starts, versions `toolchains.json` no longer pins are removed.
- Settings' Toolchains section lists each toolchain pinned for the system, how much room it takes by
  its marker or that it isn't downloaded and how large it is, and the servers that use it. "Remove"
  refuses installs of it from the start, with the message its servers then show ("Go was removed.
  Restart downloads it again."), so nothing that starts meanwhile, "Restart" included, gets the
  folder that's going. Then it stops those servers and every install of it under way, those nobody
  waits for any longer included, and once each has ended, renames its folder aside before deleting
  it. Its button waits while it runs, and a notice says why one wasn't removed
  (`main/toolchains.ts`). On macOS it lists Swift too, the system's (`system` on its adapter), with
  where the SourceKit-LSP Lo would run is from ("From Xcode") or what it needs, and nothing to
  remove. On Linux it lists the Swift toolchain for the system's distribution alone, and as Lo
  starts, one for another distribution is removed, as after an upgrade.
- It stops 10 minutes after the pull request whose checkout it runs on was last on screen, once no
  tab of its repository is open, once its repository or pull request isn't trusted, and as Lo quits,
  each within 5 s; Lo's quitting waits for each one stopping. After a crash it starts again by
  itself once, if it had run for a minute; otherwise it waits for "Restart". At most 4 run, those
  stopping included, holding 8 GB in all, read every 5 s: past either, the one used longest ago that
  isn't on screen stops, and the next starts once it has; one on screen is never stopped for
  another.
- A server's answer comes first, labelled with its name, and the index answers in its place when it
  can't (`main/served.ts`): a definition in 2 s (an adapter may allow longer), references in 10 s, a
  hover in 1.5 s, inlay hints and the outline in 3 s. An empty definition falls back to the file's
  import and the index, and an empty hover to the index; empty references or an empty outline are
  the server's answer. One whose adapter says its references can't be used (`noReferences`,
  SourceKit-LSP's) is never asked: the index answers, saying why. A server whose adapter says it
  finds references only from a declaration (`referencesFromDefinition`, terraform-ls) and finds none
  where the reader is, as at a use, is asked for the definition, then for the references there, all
  within the 10 s; with no definition in the repository the index answers, saying why, and with none
  at all, that the server found no references there, as at a declaration nothing uses. Each file is
  opened on a server as its own language, by its path (`languageOf`), so a `.tf` file reached from a
  `.tfvars` file is still `terraform`. A place outside the checkout shows as "Outside this
  repository" and is never read; the references panel counts those it doesn't list. The old side
  always answers from the index, and a server answers only about the head it runs on, for a file
  whose checkout matches git's. A checkout the local copy no longer counts as its own, as once the
  local copy was made again, gets the index's answers, saying the server can't run because the
  checkout isn't usable, and is made again: what runs on the pull request's checkouts stops first,
  then starts on the new one. One made again that's no better fails, for "Restart". Once no view of
  a pull request is open, its checkouts are forgotten, so the next view of it checks its head out
  again.
- A hover in Markdown is read into `@lo/markdown`'s tree by the background process (`code.render`,
  main's own job), as any text from anyone is, and the card never draws the Markdown as text: the
  code blocks it starts with, in order, are the declaration (rust-analyzer's module path, then the
  signature), and the rest is the docs. One that can't be read in 5 s leaves the index to answer,
  saying why, as does a hover the index has nothing for, which `K` shows after "No definition found
  at the cursor.".
- `gh` shows a server's inlay hints, held until the reader's next input. With none, the status bar
  says why: the server is starting, failed, needs a toolchain or gave none, no server reads the code
  on screen, or the repo isn't trusted. A server that doesn't offer inlay hints, or whose adapter
  says it has none, isn't asked for them, and `gh` says so ("Pyright has no type hints.",
  "terraform-ls has no type hints.").
- The status bar has an item for each server, its details offering "Restart", "Show the log" and
  "Stop trusting this repo"; on an untrusted view, "Language servers off" offers to trust it
  (`code.servers`, the `served` topic). The log dialog shows the last 1,000 lines, and copies as
  many of the newest as fit in 1 MB.
- In a build run from source, `LO_TEST_SERVERS` names a manifest of servers to run for tests
  (`main/tests.ts`), each by absolute path with its arguments and nothing downloaded; `testServers`
  in `e2e/app.ts` writes one for the fake server. They run in place of Lo's own, and a test run
  without them runs none, so no test starts or downloads a real server. A packaged build never reads
  it, which `scripts/check-package.sh` checks.

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
- Anything that appears, leaves or changes size takes one of the moves in `design/README.md`'s
  "Motion", by its class (`move-pop`, `move-open`) or its component (`Collapse`, `Swap`), but a
  pane's width, which never animates. No component writes a duration or a curve of its own.
  `setMotion` is the one switch that turns the moves off; without a call Lo follows the system.
- A row of panes is a `Panes`, each edge in it that moves a `Splitter`, and `fit` works out each
  pane's width from the layout and the row's.
- A popup (a dialog, menu, popover, tooltip or toast) is drawn by one of `ui`'s shared pieces, which
  hold how it comes and goes and where focus returns. Lint fails a Base UI popup imported anywhere
  else (`scripts/check-popups.ts`).
- The fonts, Host Grotesk and Fragment Mono, are bundled as files (never `data:` addresses, which
  the content security policy blocks), and their licenses ship beside the window's files.
- Icons come from `lucide`, through `Icon` and the list in `packages/desktop/ui/src/icons.ts`, the
  only file that imports it. Lint fails an `<svg>` written anywhere but `Icon` and `iconElement`
  (its twin for a code view's own DOM), the mark and figures (`lo/no-inline-icon`), or the files
  whose icons are still drawn by hand, which `scripts/oxlint/svgs.ts` lists and which only shrinks.
  Its license ships beside the fonts'.
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

## Releasing

The `release` workflow (`.github/workflows/release.yml`) builds Lo from a version tag and drafts the
release on GitHub. It publishes nothing: a maintainer reads the draft and publishes it. Publishing
it starts the workflow's `cask` job, which proposes the release's Homebrew cask to the tap. Renew
the pins first (see "Language servers"), and run a dry run on `main` before tagging.

- **The tag is the version.** Push `v<version>`: a `v` and SemVer 2.0.0 with no build metadata, such
  as `v0.1.0` or `v0.1.0-rc.1`, on a commit `main` holds. `scripts/release/version.sh` checks it,
  and `version.test.ts` tests the script. A tag that fails stops the run before anything builds. A
  version with a prerelease part makes a GitHub prerelease, which only a prerelease of Lo is
  offered. `package.json` stays `0.0.0`: the tag's version is built in. There's no changelog file:
  the notes are the ones GitHub generates from the merged pull requests, which the maintainer edits
  in the draft (`.github/release.yml` leaves out dependency bumps and bots).
- **The jobs.**
  - `version` checks the tag, and gives the version and whether it's a prerelease.
  - `mac` (`macos-26`, 90 minutes) builds Lo before any secret is in reach, then fails if one is
    missing, since electron-builder only warns when the notary key's variables are.
    `pnpm run release` signs and notarizes the app, staples it, and makes the zips and DMGs. The job
    then notarizes each DMG with `notarytool` and leaves it unstapled, since stapling would change a
    file `latest-mac.yml` has hashed. It checks all four files with `check-package.sh --release`,
    and `latest-mac.yml` against each file's SHA-512 and blockmap.
  - `linux (x64)` and `linux (arm64)` run on a runner of each architecture (`ubuntu-24.04` and
    `ubuntu-24.04-arm`): they build the deb and the rpm with `pnpm run release:linux`, check both
    with `check-linux.sh`, and check `latest-linux.yml` or `latest-linux-arm64.yml` the same way.
  - Each build job uploads its files as an artifact. `draft` runs only for a tag, once every one of
    them has passed: it downloads the artifacts, writes `SHA256SUMS` over every file, and runs
    `gh release create v<version> --draft --verify-tag --generate-notes`, with `--prerelease` for a
    prerelease. A re-run replaces a draft's files, and refuses a tag that has a published release.
  - `cask` runs alone when a release is published or a prerelease is made a release
    (`release: released`), and only for a release that is neither a draft nor a prerelease, by the
    release's flags and by its tag. A version no newer than the cask on the tap's `main` is left out
    with a notice, since `brew upgrade` takes any other version as an update and would take Lo back.
    `version` checks the release's tag as it checks a pushed one, and the version, the branch and
    every file name come from that tag alone. The job downloads the two DMGs from the addresses the
    cask names, checks each against the release's `SHA256SUMS`, renders `Casks/lo.rb` with
    `scripts/release/cask.sh`, and opens a pull request on `withlo/homebrew-tap` from
    `lo-<version>`, titled `lo <version>` (`(new cask)` the first time), through GitHub's API. A
    re-run reuses the branch and the pull request. Merge it once the tap's checks pass.
- **Environments and secrets.** The `mac` job of a tag's run is the only one that reads the signing
  secrets, through the `release` environment. Releasing requires that environment, in the
  repository's settings, to wait for a maintainer's approval and to take only `v*` tags: the
  workflow enforces neither. The secrets are `MACOS_CERT_P12` and `MACOS_CERT_PASSWORD`, the
  Developer ID certificate (`CSC_LINK` and `CSC_KEY_PASSWORD`), and `NOTARY_KEY_ID`,
  `NOTARY_ISSUER_ID` and `NOTARY_KEY_P8`, the App Store Connect key (`APPLE_API_KEY_ID`,
  `APPLE_API_ISSUER`, and a file only its user can read, which `APPLE_API_KEY` names and a step that
  always runs removes). Keep them on the environment, never the repository, and give the environment
  its reviewer and its `v*` tag rule before the first tag: GitHub creates a missing environment
  without protection. The `draft` job has `contents: write` and no secret, and runs none of the
  repository's code. `TAP_TOKEN` is in the `tap` environment, which takes only `v*` tags and needs
  no approval, since a maintainer has just published the release. It's a fine-grained token whose
  resource owner is `withlo`, for `withlo/homebrew-tap` alone, with Contents and Pull requests read
  and write. Only the `cask` job's last step reads it, and that step runs `gh` alone. A tag pushed
  with an edited workflow could read it, which is why it reaches only the tap, whose pull requests a
  maintainer merges. The `npm` environment is the checker's.
- **Homebrew.** The cask is `scripts/release/lo.rb.in`, which
  `cask.sh <version> <arm64 SHA-256> <x64 SHA-256>` fills in, refusing a version `version.sh`
  wouldn't take (`semver.sh`, without the v) and any SHA-256 that isn't 64 lowercase hex digits.
  `cask.test.ts` checks the output against the files in `scripts/release/golden/` (`vitest -u`
  rewrites them), and the template's app name, bundle ID, minimum macOS and updater folder against
  `build/electron-builder.yml` and `build/release.yml`. CI's `cask-style` job renders it with fixed
  values and runs `brew style` on it when the template, the script or `ci.yml` changes. A Lo that
  Homebrew installed never downloads its own updates, and gives the brew command instead, so the
  cask has no `auto_updates`. Its `livecheck` reads GitHub's latest release. `zap` trashes Lo's
  cache (`/private/var/folders/*/*/C/Lo`), `~/.config/lo`, `~/Library/Application Support/Lo`,
  `~/Library/Caches/lo-updater`, Squirrel.Mac's `~/Library/Caches/com.scornz.lo.ShipIt` and
  `~/Library/Preferences/ByHost/com.scornz.lo.ShipIt.*.plist` (from a Lo installed from a DMG that
  updated itself), and the Preferences and Saved Application State of `com.scornz.lo`; a change to
  where Lo keeps data changes it too. The tap's own checks, on a macOS runner, run `brew style`,
  `brew audit --cask --strict --online` for both architectures (with `--new` while `main` has no
  cask, leaving out `github_repository`, the check of how widely the repository is followed, which
  only Homebrew's own cask list needs), `brew install --cask`, a check that the installed app is
  signed by Lo's Developer ID team and notarized, and `brew uninstall --cask --zap` on each pull
  request.
- **No cache, nothing floating.** The workflow uses no Actions cache and pins each action by its
  SHA. It installs pnpm with `scripts/install-pnpm.sh`, checked against the SHA-512 the lockfile
  holds, and the dependencies from the lockfile alone, since `pnpm/setup` restores and saves a cache
  of its own whatever it's told, and nothing released should come from one. Every job but `draft`
  can only read the repository, and no checkout keeps its token. A ref has one run at a time, and a
  tag's is never cancelled.
- **A dry run** is the same build as `0.0.0-dry.<run number>`, signed ad hoc with
  `build/entitlements.plist`, in no environment, with no secret, and it drafts nothing. It runs for
  a pull request that changes how Lo is packaged (the workflow, `apps/desktop/build/`,
  `apps/desktop/package.json`, `scripts/release/`, `check-package.sh` or `check-linux.sh`), and by
  hand once the workflow is on `main`:

  ```sh
  gh workflow run release.yml --repo withlo/lo --ref <branch or tag>
  gh run download <run id> --repo withlo/lo -D <folder>  # the mac, linux-x64 and linux-arm64 files
  ```

  The files are kept 14 days. A dry run's `mac` job doesn't notarize or sign the DMGs, and checks
  with `check-package.sh --release --ad-hoc`; the Linux jobs are a tag's, since the packages are
  never signed. To make one by hand on a Mac (Rosetta checks the Intel files):

  ```sh
  pnpm nx run desktop:build
  (cd apps/desktop && pnpm run release -c.extraMetadata.version=0.0.0-dry.1 -c.mac.identity=- \
    -c.mac.notarize=false -c.mac.entitlements=build/entitlements.plist \
    -c.mac.entitlementsInherit=build/entitlements.plist -c.dmg.sign=false)
  sh scripts/check-package.sh --release --ad-hoc apps/desktop/release/Lo-0.0.0-dry.1-arm64.dmg
  ```

  and on Linux, for the architecture it runs on:

  ```sh
  pnpm nx run desktop:build
  (cd apps/desktop && pnpm run release:linux -c.extraMetadata.version=0.0.0-dry.1)
  sh scripts/check-linux.sh apps/desktop/release/Lo-0.0.0-dry.1-amd64.deb  # and the rpm
  ```

- **`check-package.sh --release [--ad-hoc] <file>`** takes `Lo-<version>-<arm64|x64>.<dmg|zip>`. It
  checks that the app is built for that architecture, with that version in Info.plist and a minimum
  macOS no older than its Electron's; that `app-update.yml` names GitHub Releases of `withlo/lo` and
  nothing else; that the app and each helper is signed with a Developer ID of one team, chained to
  Apple's root, with a secure timestamp, the hardened runtime and exactly
  `build/entitlements.release.plist`; and that Gatekeeper says `Notarized Developer ID` and the
  app's ticket is stapled. A DMG must hold only the app and a link to `/Applications`, be signed by
  the same team and be notarized, as Gatekeeper says for a disk image. `--ad-hoc` checks a dry run's
  build: all of it but the Developer ID and notarization, with an ad hoc signature and
  `build/entitlements.plist`. Either way the app must have every fuse set, an asar of `dist/` and
  `package.json` alone whose hash is Info.plist's, the registered links, the copyright and
  `licenses.txt`; quit when started with a switch, a file or a refused variable; and draw its window
  without reading `LO_TEST_SERVERS` or asking the feed `LO_UPDATES_FEED` names. An Intel build
  starts only through Rosetta, so the workflow installs it, and each start gets more time.
- **`check-linux.sh <deb|rpm>`** takes `Lo-<version>-<amd64|arm64>.deb` or
  `Lo-<version>-<x86_64|aarch64>.rpm`, on a machine of that architecture: a deb needs `sudo`,
  `dpkg-deb`, Xvfb and `xwininfo`, and an rpm `rpm`, `rpm2cpio`, `cpio` and Docker, which installs
  it in a Fedora container. It checks the package's fields (name, version, GPL-3.0-only, maintainer,
  homepage, libsecret), that its scripts are `build/linux/`'s, that root owns every file, that the
  sandbox helper is setuid root in the package and nothing else is setuid or setgid, that it holds
  only Lo, its desktop file and its icons, and that the desktop file opens `/opt/Lo/lo %U` for
  `lo://` alone. It checks that `app-update.yml` names GitHub Releases of `withlo/lo` alone, that
  the AppArmor profile is the one that only adds user namespaces, the fuses, and the asar's contents
  and `desktopName`. It then installs the package and checks `lo`'s link, the helper's mode, the
  libraries, Lo's profile where AppArmor runs and, for an rpm, that `rpm -V` finds nothing changed.
  Started under Xvfb by someone other than root, Lo must refuse switches (`--no-sandbox` and
  `--disable-gpu` among them) and the refused variables, draw its window with every page under
  Chromium's sandbox, open its database, never read `LO_TEST_SERVERS` or ask `LO_UPDATES_FEED`'s
  feed, take a link from the `lo` command, and leave `lo.desktop` the handler of `lo://` links and
  not of web links. Installed again it must keep all that, and removed it must leave nothing behind.
  Where `/usr/bin/lo` is someone else's, installing and removing must leave it as it is.

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
- A PR merges only once everyone who wrote its commits has signed [`CLA.md`](CLA.md), which the
  `license/cla` check shows.
- Repository settings, rulesets and branch protection are the maintainers' to change.

## Secrets

Never print, log or commit tokens, passwords or two-factor secrets. Read them into the process or
environment that needs them without echoing them.
