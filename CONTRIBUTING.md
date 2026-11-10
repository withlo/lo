# Contributing to Lo

Lo is in early development. [`docs/design.md`](docs/design.md) describes what it does and how it's
built, and [`AGENTS.md`](AGENTS.md) holds the working rules in full: the same rules apply to people
and to coding agents.

## Setting up

You need git and pnpm 11 or later. Then, in your clone:

```sh
pnpm install
```

`package.json` pins Node and pnpm under `devEngines`, and pnpm downloads both. The install also sets
up the git hooks, which check your commit messages and format staged files.

## Making a change

- Work on a branch and open a pull request against `main`. Pull requests are squash-merged.
- Commit messages and pull request titles follow
  [Conventional Commits](https://www.conventionalcommits.org/), such as
  `feat(review): mark a file viewed` or `fix(git): keep fetched revisions after a force-push`. The
  title becomes the commit on `main`.
- The pull request's description says what changed and why, readable without opening the diff, and
  how it was tested. The template has the sections.
- Docs describe the product and how it works. When a change alters what Lo does, update
  `docs/design.md` in the same pull request.
- To update your branch, merge `main` into it.

## Where code goes

A package's folder says where it runs:

- `packages/core/` runs anywhere. These packages use `fetch` for the network, take storage and
  secrets as parameters, and touch no git, file system, child process, Node or Electron. They import
  only other core packages.
- `packages/desktop/` runs only in the desktop app.
- `packages/core/markdown`, `packages/core/artifact` and `skill/` are MIT-licensed, and import only
  other MIT-licensed packages.
- Nothing imports an app, and only tests import `testing/`.

Each package's Nx tags say which rules apply to it, and `pnpm check:boundaries` checks them. See
"Boundaries" in [`AGENTS.md`](AGENTS.md#boundaries).

Before you work on the interface, read the design system's rules in
[`design/README.md`](design/README.md).

## Checks

CI runs these on every pull request. Run them before you push:

```sh
pnpm nx affected -t lint typecheck test build
pnpm nx sync:check
pnpm format:check
pnpm check:boundaries
pnpm check:generated
pnpm check:symlinks
```

`pnpm format` fixes formatting, `pnpm nx sync` fixes the TypeScript project references, and
`pnpm nx run-many -t codegen` brings generated files up to date.

## Security

Please report security problems privately, as [`SECURITY.md`](SECURITY.md) describes, not in a
public issue.
