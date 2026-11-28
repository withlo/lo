/**
 * The overview checker's command line. `install` puts the overview skill where a coding agent finds
 * it, for one person, or in a repository with `--repo`; `check` reads an overview from a folder and
 * checks it as Lo would; `commit` checks it, then writes it as a commit to push to its pull
 * request's or its stack's ref. The skill runs `transcript`, `start` and `done` as it writes. `keep`
 * and `fold` are the repository's overview workflow's: they copy a fork's overview, and add a merged
 * pull request's definitions to the repository's.
 *
 * `check` and `commit` exit 0 when the overview has no errors (warnings are fine), 1 when it has
 * errors, and 2 when it can't be checked: no git, no repository, the commit its header names isn't
 * there, or a file couldn't be read. `keep` and `fold` exit 0 once they've done what there was to
 * do, which may be nothing, and 2 when they couldn't. The others exit 0 once they've done it, and 2
 * when they couldn't.
 */

import { statSync } from 'node:fs';
import { resolve } from 'node:path';

import { ARTIFACT, type Finding, type OnRef } from '@lo/artifact';

import { actionsContext, actionsLog, ContextError, repositoryUrl } from './actions.ts';
import { checkFolder, type FolderCheck } from './check.ts';
import { refOf, writeCommit, type CommitFile, type Owner, type Written } from './commit.ts';
import { FolderError } from './folder.ts';
import { fold } from './fold.ts';
import { GitError, gitIn } from './git.ts';
import { gitHubApi, GitHubError } from './github.ts';
import {
  AGENT_NAMES,
  install,
  InstallError,
  targetsOf,
  type Agent,
  type Installed,
} from './install.ts';
import { keep, WorkflowError, type WorkflowOptions } from './keep.ts';
import { tokenHeader, Workspace } from './remote.ts';
import { installRepo, RepoError, type RepoInstalled } from './repo.ts';
import { PERSONAL_SKILL, REPO_SKILL } from './skill.ts';
import { copyTranscript, TranscriptError, type Copied } from './transcript.ts';
import { done, start, WritingError } from './writing.ts';

const USAGE = `Installs Lo's overview skill for coding agents, and checks an overview and commits it for
its pull request or stack.

Usage:
  lo-overview install [--claude] [--codex] [--dir <folder>] [--json]
  lo-overview install --repo [<folder>] [--json]
  lo-overview check [<dir>] [--pr <number> | --stack <number>] [--repo <folder>] [--json]
  lo-overview commit <dir> (--pr <number> | --stack <number>) [--repo <folder>] [--json]
  lo-overview transcript --out <folder> [--from <file>] [--json]
  lo-overview start <pull request's link> [--repo <folder>] [--json]
  lo-overview done <pull request's link> [--repo <folder>] [--json]
  lo-overview keep --pr <number>
  lo-overview fold --pr <number>

Commands:
  install   Install the ${PERSONAL_SKILL.name} skill, which teaches a coding agent to write an overview
            when asked, check it and push it: for Claude Code, for Codex, or in a skills folder of
            your own. With none of the options, for each of Claude Code and Codex set up here. Only
            the skill's own files are replaced, and an older copy named ${REPO_SKILL.name} is removed.
            With --repo, install the ${REPO_SKILL.name} skill in the repository's clone for its team
            to commit, so that coding agents write the overview of each pull request they open or
            push to, by themselves: the skill and its hook for Claude Code and Codex, and templates
            for the repository's .lo/overview.md and .lo/settings.json where it has none.
  check     Check the overview in <dir>, the current folder unless given: its artifact.md and
            figures/, the code it names, read from the repository at the commit its header names,
            and its glossary's marks, against the repository's definitions at refs/lo/terms when
            the repository has that ref.
  commit    Check the overview, then write exactly what was checked as a commit in the repository,
            whose parent is refs/lo/pr/<number>, or refs/lo/stack/<number> for a stack's, if that
            ref is there. Prints the commit's id and how to push it. No ref, index or working tree
            changes.
  transcript
            Copy the transcript of the coding agent's session as text, to <folder>/transcript.txt:
            its messages, and the commands it ran with their exit codes. The session is the one
            --from names, or the one Claude Code or Codex says is running.
  start     Mark the overview of the pull request as being written, in the repository's git
            folder or /tmp, so that the skill's hook starts no other writer for it meanwhile.
  done      Say the overview is written. When a push came in meanwhile, it says to write it again.
  keep      For the repository's workflow: when pull request <number> comes from a fork, copy
            the fork's refs/lo/pr/<number>, and the stack overview its header names, to
            refs/lo/kept/pr/<number> and refs/lo/kept/stack/<id> in the repository, when it's an
            overview Lo shows and the copy moves forward to it.
  fold      For the repository's workflow: when pull request <number> has merged, add the terms
            its overview marks (new) or (changed) to the repository's definitions, refs/lo/terms,
            or, for a locked term, suggest the change.

            Both run in GitHub Actions, in the repository GITHUB_REPOSITORY names, with the token
            in GITHUB_TOKEN, and fetch nothing but git data, as data.

Options:
  --claude        Install the skill for Claude Code, in ~/.claude/skills, or in skills in
                  $CLAUDE_CONFIG_DIR when that's set.
  --codex         Install the skill for Codex, in ~/.agents/skills.
  --dir <folder>  Install the skill in the skills folder <folder>, as <folder>/${PERSONAL_SKILL.name}.
  --pr <number>   The pull request the overview is for. Its header must name the same one.
  --stack <number>
                  The stack the overview is for, when it's a stack's. Its header must name the
                  same one, in place of a pull request.
  --repo <folder> The pull request's repository: the one the current folder is in unless given.
                  For install, the clone to install the skill in; for start and done, the clone
                  whose lock it is, by its path or its file: link.
  --out <folder>  The folder to write transcript.txt in.
  --from <file>   The transcript to copy: a Claude Code or Codex session's .jsonl or .jsonl.zst.
  --json          Print what was found, or done, as JSON.
  --help          Print this.

Exit status: check and commit exit 0 when the overview has no errors, 1 when it has errors, and 2
when it can't be checked. keep and fold exit 0 once they've done what there was to do, and 2 when
they couldn't. The others exit 0 once they've done it, and 2 when they couldn't.
`;

/** What the command line asks for. */
type Command =
  | { kind: 'help' }
  | { kind: 'install'; agents: Agent[]; dir: string | undefined; json: boolean }
  | { kind: 'installRepo'; repo: string; json: boolean }
  | { kind: 'check'; dir: string; on: OnRef; repo: string | undefined; json: boolean }
  | { kind: 'commit'; dir: string; owner: Owner; repo: string | undefined; json: boolean }
  | { kind: 'transcript'; out: string; from: string | undefined; json: boolean }
  | { kind: 'start' | 'done'; link: string; repo: string; json: boolean }
  | { kind: 'keep' | 'fold'; pr: number };

/** Where the checker writes. */
export interface Streams {
  out: (text: string) => void;
  err: (text: string) => void;
}

/**
 * Runs the command line `args`, writing to `streams`, and returns its exit status. Never rejects
 * unless writing does: whatever goes wrong is said, as JSON with `--json`, and exits 2.
 */
export async function main(
  args: readonly string[],
  streams: Streams,
  env: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  // Read before the rest, so a mistake in the rest is answered as JSON too.
  const end = args.indexOf('--');
  const json = (end === -1 ? args : args.slice(0, end)).includes('--json');
  const fail = (message: string, usage = false): number => {
    if (json) streams.out(`${JSON.stringify({ error: message }, null, 2)}\n`);
    else streams.err(usage ? `${message}\n\n${USAGE}` : `${message}\n`);
    return 2;
  };
  try {
    let command: Command;
    try {
      command = parse(args);
    } catch (error) {
      return fail(messageOf(error), true);
    }
    try {
      switch (command.kind) {
        case 'help':
          streams.out(USAGE);
          return 0;
        case 'install':
          return installed(install(targetsOf(command, process.env)), command.json, streams);
        case 'installRepo':
          return installedRepo(installRepo(command.repo, process.env), command.json, streams);
        case 'transcript':
          return copied(
            await copyTranscript(command.out, command.from, process.env),
            command.json,
            streams,
          );
        case 'start': {
          const { locked, said } = start(command.link, command.repo, process.env);
          return lockSaid(locked, said, { locked }, command.json, streams);
        }
        case 'done': {
          const { again, failed, said } = done(command.link, command.repo, process.env);
          return lockSaid(!failed, said, { again, failed }, command.json, streams);
        }
        case 'check': {
          const git = gitIn(repository(command.repo));
          return report(await checkFolder(command.dir, git, command.on), command.json, streams);
        }
        case 'commit':
          return await commit(command, streams);
        case 'keep':
        case 'fold':
          return await workflow(command, streams, env);
        default:
          command satisfies never;
          throw new Error(`Unknown command ${JSON.stringify(command)}`);
      }
    } catch (error) {
      if (
        error instanceof InstallError ||
        error instanceof RepoError ||
        error instanceof TranscriptError ||
        error instanceof WritingError
      ) {
        return fail(error.message);
      }
      if (error instanceof GitError || error instanceof FolderError || isFileSystemError(error)) {
        return fail(`Lo can't check the overview. ${error.message}`);
      }
      throw error;
    }
  } catch (error) {
    // Nothing above throws on any overview, so this is the checker's own fault: it can't check.
    return fail(`Lo couldn't check the overview, for a reason it can't name: ${messageOf(error)}`);
  }
}

/** What `error` says. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The command `args` ask for. Throws with what's wrong with them. */
function parse(args: readonly string[]): Command {
  const positional: string[] = [];
  let json = false;
  let pr: string | undefined;
  let stack: string | undefined;
  let help = false;
  const agents: Agent[] = [];
  let dir: string | undefined;
  let repo: string | undefined;
  let repoNamed = false;
  let out: string | undefined;
  let from: string | undefined;
  // A value an option takes: the word after it, or what follows its `=`.
  const valueOf = (arg: string, name: string, at: number): [string | undefined, number] =>
    arg === name ? [args[at + 1], at + 1] : [arg.slice(name.length + 1), at];
  for (let at = 0; at < args.length; at++) {
    const arg = args[at]!;
    if (arg === '--') {
      positional.push(...args.slice(at + 1));
      break;
    }
    if (arg === '--json') json = true;
    else if (arg === '--help' || arg === '-h') help = true;
    else if (arg === '--pr') {
      pr = args[++at];
      if (pr === undefined) throw new Error("--pr takes a pull request's number.");
    } else if (arg.startsWith('--pr=')) pr = arg.slice('--pr='.length);
    else if (arg === '--stack') {
      stack = args[++at];
      if (stack === undefined) throw new Error("--stack takes a stack's number.");
    } else if (arg.startsWith('--stack=')) stack = arg.slice('--stack='.length);
    else if (arg === '--claude') agents.push('claude');
    else if (arg === '--codex') agents.push('codex');
    else if (arg === '--dir' || arg.startsWith('--dir=')) {
      dir = arg === '--dir' ? args[++at] : arg.slice('--dir='.length);
      if (!dir) throw new Error('--dir takes the skills folder to install the skill in.');
    } else if (arg === '--repo' || arg.startsWith('--repo=')) {
      repoNamed = true;
      // For install, the folder may be left out, as the next word, or an option, shows.
      const next = args[at + 1];
      if (arg === '--repo' && (next === undefined || next.startsWith('-'))) repo = undefined;
      else [repo, at] = valueOf(arg, '--repo', at);
      if (repo === '') repo = undefined;
    } else if (arg === '--out' || arg.startsWith('--out=')) {
      [out, at] = valueOf(arg, '--out', at);
      if (!out) throw new Error('--out takes the folder to write the transcript in.');
    } else if (arg === '--from' || arg.startsWith('--from=')) {
      [from, at] = valueOf(arg, '--from', at);
      if (!from) throw new Error('--from takes the transcript to copy.');
    } else if (arg.startsWith('-')) throw new Error(`${JSON.stringify(arg)} isn't an option.`);
    else positional.push(arg);
  }
  const [name, ...rest] = positional;
  if (help || name === 'help' || name === undefined) return { kind: 'help' };
  const installing = agents.length > 0 || dir !== undefined;
  if (name !== 'install' && installing)
    throw new Error('--claude, --codex and --dir are for install.');
  if (name !== 'transcript' && (out !== undefined || from !== undefined)) {
    throw new Error('--out and --from are for transcript.');
  }
  if (name !== 'install' && repoNamed && repo === undefined) {
    throw new Error("--repo takes the pull request's repository.");
  }
  switch (name) {
    case 'keep':
    case 'fold': {
      if (rest.length > 0 || stack !== undefined || repo !== undefined || json) {
        throw new Error(`${name} takes only --pr, the pull request's number.`);
      }
      const number = numberOf(pr, 'pr');
      if (number === undefined) throw new Error(`${name} needs --pr, the pull request's number.`);
      return { kind: name, pr: number };
    }
    case 'install': {
      if (pr !== undefined || stack !== undefined)
        throw new Error('install takes no --pr or --stack.');
      if (repoNamed) {
        if (installing) throw new Error('install --repo takes no --claude, --codex or --dir.');
        if (rest.length > 0) throw new Error('install --repo takes one folder.');
        return { kind: 'installRepo', repo: repo ?? '.', json };
      }
      if (rest.length > 0) throw new Error('install takes a skills folder with --dir <folder>.');
      return { kind: 'install', agents: [...new Set(agents)], dir, json };
    }
    case 'transcript': {
      if (rest.length > 0 || pr !== undefined || stack !== undefined || repoNamed) {
        throw new Error('transcript takes only --out <folder> and --from <file>.');
      }
      if (out === undefined) throw new Error('transcript needs --out, the folder to write it in.');
      return { kind: 'transcript', out, from, json };
    }
    case 'start':
    case 'done': {
      if (rest.length !== 1 || pr !== undefined || stack !== undefined) {
        throw new Error(`${name} takes the pull request's link, and --repo <folder>.`);
      }
      return { kind: name, link: rest[0]!, repo: repo ?? '.', json };
    }
    case 'check': {
      if (rest.length > 1) throw new Error('check takes one folder.');
      if (pr !== undefined && stack !== undefined) {
        throw new Error('check takes --pr or --stack, not both.');
      }
      const on: OnRef =
        stack === undefined ? { pr: numberOf(pr, 'pr') } : { stack: numberOf(stack, 'stack') };
      return { kind: 'check', dir: rest[0] ?? '.', on, repo, json };
    }
    case 'commit': {
      if (rest.length !== 1) throw new Error("commit takes the overview's folder.");
      if (pr !== undefined && stack !== undefined) {
        throw new Error('commit takes --pr or --stack, not both.');
      }
      const owner: Owner | undefined =
        stack !== undefined
          ? { stack: numberOf(stack, 'stack')! }
          : pr !== undefined
            ? { pr: numberOf(pr, 'pr')! }
            : undefined;
      if (owner === undefined) {
        throw new Error(
          "commit needs --pr, the pull request's number, or --stack, the stack's number.",
        );
      }
      return { kind: 'commit', dir: rest[0]!, owner, repo, json };
    }
    default:
      throw new Error(`${JSON.stringify(name)} isn't a command.`);
  }
}

/** `given`, a pull request's or a stack's number, as one. Throws for anything else. */
function numberOf(given: string | undefined, option: 'pr' | 'stack'): number | undefined {
  if (given === undefined) return undefined;
  if (!/^[1-9]\d{0,15}$/.test(given) || !Number.isSafeInteger(Number(given))) {
    const what = option === 'pr' ? "a pull request's number" : "a stack's number";
    throw new Error(`--${option} takes ${what}, not ${JSON.stringify(given)}.`);
  }
  return Number(given);
}

/**
 * Runs `keep` or `fold`, as the repository's workflow does, in a repository of its own that's
 * removed after, and returns the exit status: 2 for anything that kept it from its work.
 */
async function workflow(
  { kind, pr }: Extract<Command, { kind: 'keep' | 'fold' }>,
  streams: Streams,
  env: NodeJS.ProcessEnv,
): Promise<number> {
  const log = actionsLog(streams.out);
  let workspace: Workspace | undefined;
  try {
    const context = actionsContext(env);
    workspace = await Workspace.open(env);
    const options: WorkflowOptions = {
      pr,
      base: {
        name: context.repository,
        remote: {
          url: repositoryUrl(context.server, context.repository),
          authorization: tokenHeader(context.token),
        },
      },
      // A fork is fetched from without the token, which is for the base repository alone.
      fork: (name) => ({ url: repositoryUrl(context.server, name) }),
      github: gitHubApi(context.api, context.token),
      log,
      workspace,
    };
    if (kind === 'keep') await keep(options);
    else await fold(options);
    return 0;
  } catch (error) {
    if (
      error instanceof ContextError ||
      error instanceof WorkflowError ||
      error instanceof GitHubError ||
      error instanceof GitError
    ) {
      log.error(error.message);
      return 2;
    }
    throw error;
  } finally {
    workspace?.close();
    log.end();
  }
}

/** Says where the skill was installed, and returns the exit status. */
function installed(where: readonly Installed[], json: boolean, streams: Streams): number {
  if (json) {
    const each = where.map(({ agent, folder, old }) => ({
      agent: agent ?? null,
      folder,
      ...(old === undefined ? {} : { old }),
    }));
    streams.out(`${JSON.stringify({ installed: each }, null, 2)}\n`);
    return 0;
  }
  for (const { agent, folder, old } of where) {
    const forWhom = agent === undefined ? '' : ` for ${AGENT_NAMES[agent]},`;
    streams.out(`Installed the ${PERSONAL_SKILL.name} skill${forWhom} in ${folder}.\n`);
    if (old?.kind === 'removed') {
      streams.out(`Removed its older copy, named ${REPO_SKILL.name}, from ${old.path}.\n`);
    } else if (old?.kind === 'kept') {
      streams.out(
        `${old.path} holds a skill named ${REPO_SKILL.name} with files of its own, so Lo left it. It runs in place of a repository's ${REPO_SKILL.name} skill: remove it.\n`,
      );
    }
  }
  return 0;
}

/** Says what `install --repo` wrote, and returns the exit status. */
function installedRepo(result: RepoInstalled, json: boolean, streams: Streams): number {
  if (json) {
    streams.out(`${JSON.stringify(result, null, 2)}\n`);
    return 0;
  }
  const said: Record<string, string> = {
    written: 'written',
    updated: 'updated',
    kept: 'kept as it was',
  };
  const lines = result.changes.map(({ path, state }) => `  ${path}: ${said[state]}`);
  if (result.shared) lines.splice(1, 0, `  .agents/skills: Codex reads the skill through it`);
  streams.out(
    `Installed the ${REPO_SKILL.name} skill in ${result.root}:\n\n${lines.join('\n')}\n\nCommit them in a pull request. On Codex, each person approves the hook once, in /hooks.\n`,
  );
  for (const { agent, folder } of result.shadows) {
    streams.out(
      `\n${folder}, a copy of your own under the same name, runs in place of the repository's on ${AGENT_NAMES[agent]}. Run npx @withlo/overview install to replace it with ${PERSONAL_SKILL.name}.\n`,
    );
  }
  return 0;
}

/** Says what `transcript` wrote, and returns the exit status. */
function copied(copy: Copied, json: boolean, streams: Streams): number {
  if (json) {
    streams.out(`${JSON.stringify(copy, null, 2)}\n`);
    return 0;
  }
  const cut = copy.cut ? ', cut short at its limit' : '';
  streams.out(
    `Copied ${copy.source} to ${copy.path}: ${copy.messages} messages and ${copy.commands} commands${cut}.\n`,
  );
  return 0;
}

/**
 * Says what `start` or `done` did, `said`, or that it couldn't, when it isn't `ok`, and returns the
 * exit status: 2 when it couldn't keep or give back the lock.
 */
function lockSaid(
  ok: boolean,
  said: string,
  shown: Record<string, boolean>,
  json: boolean,
  streams: Streams,
): number {
  if (json) streams.out(`${JSON.stringify(shown, null, 2)}\n`);
  else if (ok) streams.out(`${said}\n`);
  else streams.err(`${said}\n`);
  return ok ? 0 : 2;
}

/**
 * The folder git runs in: `given`, the repository `--repo` names, from the current folder, or the
 * current folder. Throws when `given` isn't a folder, which git couldn't start in.
 */
function repository(given: string | undefined): string {
  if (given === undefined) return process.cwd();
  const path = resolve(given);
  if (!statSync(path, { throwIfNoEntry: false })?.isDirectory()) {
    throw new FolderError(`There's no folder at ${JSON.stringify(path)} for --repo.`);
  }
  return path;
}

/** Checks the overview in `dir`, and when it passes, commits it for `owner`. */
async function commit(
  { dir, owner, repo, json }: Extract<Command, { kind: 'commit' }>,
  streams: Streams,
): Promise<number> {
  const git = gitIn(repository(repo));
  const found = await checkFolder(dir, git, owner);
  const status = exitStatus(found);
  const { outcome } = found.checked;
  if (status !== 0 || outcome.kind !== 'shown') {
    return report(found, json, streams, ' Nothing was committed.');
  }
  const shown = [...new Set(outcome.figures.map(({ reference }) => reference.path))];
  const files: CommitFile[] = [];
  for (const path of [ARTIFACT, ...shown]) {
    const bytes = found.folder.contents(path);
    if (!bytes) throw new FolderError(`${path} wasn't read whole, so it can't be committed.`);
    files.push({ path, bytes });
  }
  const written = await writeCommit(git, owner, files);
  // Files in figures/ that no block shows aren't checked, so they're left out.
  const unshown = found.folder.entries
    .map(({ path }) => new TextDecoder().decode(path))
    .filter((path) => path.startsWith('figures/') && !shown.includes(path))
    .toSorted();
  return report(found, json, streams, '', { owner, written, unshown });
}

/** What `commit` wrote. */
interface Committed {
  owner: Owner;
  written: Written;
  unshown: string[];
}

/** The exit status for what was found. */
function exitStatus({ checked, incomplete }: FolderCheck): number {
  if (incomplete.length > 0) return 2;
  return checked.findings.some(({ severity }) => severity === 'error') ? 1 : 0;
}

/** Writes what was found, and what was committed, and returns the exit status. */
function report(
  found: FolderCheck,
  json: boolean,
  streams: Streams,
  after = '',
  committed?: Committed,
): number {
  const status = exitStatus(found);
  const { findings } = found.checked;
  if (json) {
    streams.out(
      `${JSON.stringify(
        {
          outcome: found.checked.outcome.kind,
          findings,
          incomplete: found.incomplete,
          ...(committed
            ? {
                commit: committed.written.id,
                parent: committed.written.parent ?? null,
                ref: refOf(committed.owner),
                unshown: committed.unshown,
              }
            : {}),
        },
        null,
        2,
      )}\n`,
    );
    return status;
  }
  const lines = findings.map(findingLine);
  if (lines.length > 0) streams.out(`${lines.join('\n')}\n\n`);
  for (const sentence of found.incomplete) streams.err(`${sentence}\n`);
  if (status === 2) {
    streams.err(`Lo couldn't check all of the overview.${after}\n`);
    return status;
  }
  streams.out(`${summary(findings)}${status === 1 ? after : ''}\n`);
  if (committed) {
    const { owner, written, unshown } = committed;
    for (const path of unshown) {
      streams.out(`${path} isn't shown in artifact.md, so it's left out of the commit.\n`);
    }
    const ref = refOf(owner);
    const parent = written.parent
      ? `with ${ref} (${written.parent}) as its parent`
      : `with no parent, since there's no ${ref} here`;
    const whose = owner.stack === undefined ? "the pull request's" : "the stack's";
    streams.out(
      `\nCommitted the overview as ${written.id}, ${parent}. Push it to ${whose} repository:\n\n  git push <remote> ${written.id}:${ref}\n`,
    );
  }
  return status;
}

/** A finding as a line: where it is, how bad, what it says, and its code. */
export function findingLine(finding: Finding): string {
  const where = finding.line === undefined ? finding.file : `${finding.file}:${finding.line}`;
  return `${where}: ${finding.severity}: ${finding.message} [${finding.code}]`;
}

/** How many errors and warnings there are, in a sentence. */
function summary(findings: readonly Finding[]): string {
  const errors = findings.filter(({ severity }) => severity === 'error').length;
  const warnings = findings.length - errors;
  if (findings.length === 0) return 'No errors or warnings.';
  if (errors === 0) return `No errors, and ${count(warnings, 'warning')}.`;
  return warnings === 0
    ? `${count(errors, 'error')}.`
    : `${count(errors, 'error')} and ${count(warnings, 'warning')}.`;
}

/** `n` of `what`, as a sentence counts them. */
function count(n: number, what: string): string {
  return `${n} ${what}${n === 1 ? '' : 's'}`;
}

/** Whether `error` is the file system's, such as a folder that isn't there. */
function isFileSystemError(error: unknown): error is Error & { code: string } {
  return error instanceof Error && 'code' in error && typeof error.code === 'string';
}
