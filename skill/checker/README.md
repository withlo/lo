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

### In a repository

Install the skill into a clone, and commit what it writes in a pull request:

```sh
npx @withlo/overview install --repo
```

From then on, everyone's coding agent writes or updates the overview of each pull request it opens
or pushes to, in the background, as it goes on with its work. `install --repo [<folder>]` writes:

- the skill, `lo-overview`, in `.claude/skills/lo-overview`, and a link to it in
  `.agents/skills/lo-overview`, where Codex reads skills, unless `.agents/skills` is a link to
  `.claude/skills`;
- its hook in `.claude/settings.json` for Claude Code, and in `.codex/hooks.json` for Codex, with
  every other key of each file kept. After `git push`, `gh pr create` or an MCP tool that opens a
  pull request, the hook finds the pull request and asks the agent to start the skill for it, once
  at a time;
- `Skill(lo-overview)` in `.claude/settings.json`'s allowed rules, so that Claude Code starts it
  without asking;
- `.lo/overview.md` and `.lo/settings.json`, templates for the team's instructions and settings,
  only where there's no file yet.

Run again, it updates what it wrote, and leaves the rest. On Codex, each person approves the hook
once, in `/hooks`.

`"overview.auto": false` turns it off: in the clone's `.lo/settings.json` for everyone, or in your
own `~/.config/lo/settings.json` (Linux: `$XDG_CONFIG_HOME/lo/settings.json`) for you alone, which
Lo's Settings › Integrations sets too.

### For yourself

Install your own copy of the skill, `lo-explain`, which runs only when you ask:

```sh
npx @withlo/overview install
```

With no options, it installs for each of Claude Code and Codex that's set up on your computer.
`--claude` or `--codex` installs for one, and `--dir <folder>` installs in a skills folder of your
own. It replaces a copy an older version installed under the name `lo-overview`, which a
repository's copy has now.

Then ask your agent to write a Lo overview for a pull request, such as
`Write a Lo overview of https://github.com/<owner>/<repo>/pull/<n>`.

### The checker's other commands

The skill runs the checker's other commands itself, by the exact version it was installed with:
`check` checks an overview as Lo would, against the code at the commit it describes, and its
glossary's marks against the repository's definitions at `refs/lo/terms`, when it has them. `commit`
checks it, then writes it as a commit to push to the pull request's ref, or the stack's.
`transcript --out <folder>` copies the agent's session, Claude Code's or Codex's, as text the skill
reads. `start <link>` and `done <link>` mark the pull request's overview as being written, in the
git folder of the clone `--repo` names or in `/tmp`, so the hook starts no other writer for it
meanwhile, and say whether a push came in that it's to write the overview again for.
`lo-overview --help` lists every command and option (`npx @withlo/overview --help` runs it).

## The repository's workflow

A repository's `.github/workflows/lo-overview.yml` runs two more commands, on GitHub, for its pull
requests:

- `keep` copies the overview of a pull request from a fork, and the stack overview it names, to
  `refs/lo/kept/pr/<n>` and `refs/lo/kept/stack/<id>` in the repository, so it outlives the fork.
- `fold` adds the terms a merged pull request's overview marks `(new)` or `(changed)` to the
  repository's definitions, at `refs/lo/terms`.

The workflow runs on `pull_request_target` with a token that can write the repository's contents and
read its pull requests. It never checks out a pull request or runs its code: it fetches git data
alone, into an empty repository of its own, and checks what it fetched as Lo checks an overview
before it pushes anything.

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
