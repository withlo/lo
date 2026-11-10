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

## Boundaries

A package's folder says where it runs, and its Nx tags (`"nx": { "tags": [...] }` in its
`package.json`) say what it may import. `pnpm check:boundaries` checks:

- a project in `packages/core/` is tagged `platform:core`, one in `packages/desktop/` is tagged
  `platform:desktop`, and no other project has a platform tag;
- core projects import only core projects, and use no Node built-in, Electron or child process
  (their tests may use Node);
- `license:mit` projects import only `license:mit` projects, and carry the MIT license in their own
  `LICENSE`;
- nothing imports an app;
- only tests import `testing/`. Tests are `*.test.*` files and anything in `test/` or `e2e/`.

oxlint also stops core code from reaching for `process`, `Buffer`, `window`, `document` and other
globals of a particular platform. To share code across a boundary, move it into a package on the
right side; don't loosen the rules.

## Tests

Unit tests are `*.test.ts` files beside the code, run by Vitest. The root `vitest.config.ts` has one
project per package and caps Vitest at two workers.

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
