<picture>
  <source media="(prefers-color-scheme: light)" srcset="brand/banner/banner-light.svg">
  <img alt="Lo" src="brand/banner/banner-dark.svg" width="100%">
</picture>

Lo is a fast, keyboard-first desktop app for reviewing GitHub pull requests. It's for people who
read far more code than they write, such as someone reviewing the pull requests their coding agents
open. It talks to GitHub directly and has no backend of its own.

Lo is in early development, and there's no release yet. To run it from source, see
[`CONTRIBUTING.md`](CONTRIBUTING.md#running-lo).

## What it does

- **Overviews.** A pull request can carry an overview: an explanation a coding agent wrote, with
  definitions, diagrams and walkthroughs tied to the real code. Lo opens it before the diff.
- **The whole repo.** The file tree shows changed files among their unchanged neighbors.
- **Stacks.** Any chain of pull requests is a stack: native GitHub stacks, chains of base branches,
  and pull requests that contain another's commits. Stacks show as a tree, you review them layer by
  layer, and they merge as one unit wherever GitHub allows.
- **Diffs.** Side by side by default, with moved-code detection and rebase-aware "changes since my
  last review".
- **Code.** Syntax-based navigation everywhere, plus types, hovers and exact references from
  language servers on repos you trust.
- **Merging.** Approve and ship on one key, a clear "why can't this merge" panel, and full merge
  queue support.

Lo only reviews and merges: it never edits files or pushes commits, calls no AI model, sends no
telemetry and never runs a repository's code. Every action has a key.

It's built for the Mac first, as a signed download and a Homebrew cask, with Linux builds as a
preview in deb and rpm packages.

## Docs

- [`docs/design.md`](docs/design.md): what Lo does and how it's built.
- [`CONTRIBUTING.md`](CONTRIBUTING.md): setting up, the checks, and how changes land.
- [`design/README.md`](design/README.md): the design system's rules.
- [`brand/README.md`](brand/README.md): the mark, colors, type and motion.
- [`SECURITY.md`](SECURITY.md): reporting a security problem.

## License

Lo is free software under the [GNU General Public License v3.0](LICENSE).

The overview skill (`skill/`) and the artifact format with the Markdown parser it builds on
(`packages/core/artifact` and `packages/core/markdown`) are under the MIT license, so teams can copy
them into their own repos and other tools can read overviews. Each of those folders carries its own
`LICENSE`.
