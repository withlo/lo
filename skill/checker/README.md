# @withlo/overview

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/withlo/lo/81e9d8bf6c3c2ceca0af1064b4c4be3425401718/brand/banner/banner-dark.svg">
  <img alt="Lo" src="https://raw.githubusercontent.com/withlo/lo/81e9d8bf6c3c2ceca0af1064b4c4be3425401718/brand/banner/banner-light.svg" width="100%">
</picture>

[Lo](https://github.com/withlo/lo) is a fast, keyboard-first desktop app for reviewing GitHub pull
requests, built for people who read far more code than they write.

This package is Lo's overview skill for coding agents, such as Claude Code and Codex, and its
checker. The skill teaches an agent to write an overview of a pull request, the explanation Lo shows
reviewers beside the diff, then check it and push it to `refs/lo/pr/<n>`. Lo shows the overview to
everyone who opens the pull request in Lo.

## Use

Install the skill:

```sh
npx @withlo/overview install
```

With no options, it installs for each of Claude Code and Codex that's set up on your computer.
`--claude` or `--codex` installs for one, and `--dir <folder>` installs in a skills folder of your
own.

Then ask your agent to write a Lo overview for a pull request, such as
`Write a Lo overview of https://github.com/<owner>/<repo>/pull/<n>`.

The skill runs the checker's other commands itself, by the exact version it was installed with:
`check` checks an overview as Lo would, against the code at the commit it describes, and `commit`
checks it, then writes it as a commit to push to the pull request's ref. `lo-overview --help` lists
every command and option (`npx @withlo/overview --help` runs it).

## Needs

- Node 20 or later.
- `git`, and `gh` signed in to GitHub.
- Push access to the pull request's repository, or to its fork when it comes from one, to push an
  overview.

## Links

- [Lo](https://github.com/withlo/lo)
- [The overview format](https://github.com/withlo/lo/blob/main/skill/references/format.md)

## License

[MIT](https://github.com/withlo/lo/blob/main/skill/checker/LICENSE)
