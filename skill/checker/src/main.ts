/**
 * The overview checker's command line. `install` puts the overview skill where a coding agent finds
 * it; `check` reads an overview from a folder and checks it as Lo would; `commit` checks it, then
 * writes it as a commit to push to its pull request's ref.
 *
 * `check` and `commit` exit 0 when the overview has no errors (warnings are fine), 1 when it has
 * errors, and 2 when it can't be checked: no git, no repository, the commit its header names isn't
 * there, or a file couldn't be read. `install` exits 0 once the skill is installed, and 2 when it
 * isn't.
 */

import { statSync } from 'node:fs';
import { resolve } from 'node:path';

import { ARTIFACT, type Finding } from '@lo/artifact';

import { checkFolder, type FolderCheck } from './check.ts';
import { refOf, writeCommit, type CommitFile, type Written } from './commit.ts';
import { FolderError } from './folder.ts';
import { GitError, gitIn } from './git.ts';
import {
  AGENT_NAMES,
  install,
  InstallError,
  targetsOf,
  type Agent,
  type Installed,
} from './install.ts';
import { SKILL_NAME } from './skill.ts';

const USAGE = `Installs Lo's overview skill for coding agents, and checks an overview and commits it for
its pull request.

Usage:
  lo-overview install [--claude] [--codex] [--dir <folder>] [--json]
  lo-overview check [<dir>] [--pr <number>] [--repo <folder>] [--json]
  lo-overview commit <dir> --pr <number> [--repo <folder>] [--json]

Commands:
  install   Install the ${SKILL_NAME} skill, which teaches a coding agent to write an overview,
            check it and push it: for Claude Code, for Codex, or in a skills folder of your own.
            With none of the options, for each of Claude Code and Codex set up here. Only the
            skill's own files are replaced.
  check     Check the overview in <dir>, the current folder unless given: its artifact.md and
            figures/, and the code it names, read from the repository at the commit its header
            names.
  commit    Check the overview, then write exactly what was checked as a commit in the repository,
            whose parent is refs/lo/pr/<number>, if that ref is there. Prints the commit's id and
            how to push it. No ref, index or working tree changes.

Options:
  --claude        Install the skill for Claude Code, in ~/.claude/skills, or in skills in
                  $CLAUDE_CONFIG_DIR when that's set.
  --codex         Install the skill for Codex, in ~/.agents/skills.
  --dir <folder>  Install the skill in the skills folder <folder>, as <folder>/${SKILL_NAME}.
  --pr <number>   The pull request the overview is for. Its header must name the same one.
  --repo <folder> The pull request's repository: the one the current folder is in unless given.
  --json          Print what was found, or installed, as JSON.
  --help          Print this.

Exit status: check and commit exit 0 when the overview has no errors, 1 when it has errors, and 2
when it can't be checked. install exits 0 once the skill is installed, and 2 when it isn't.
`;

/** What the command line asks for. */
type Command =
  | { kind: 'help' }
  | { kind: 'install'; agents: Agent[]; dir: string | undefined; json: boolean }
  | { kind: 'check'; dir: string; pr: number | undefined; repo: string | undefined; json: boolean }
  | { kind: 'commit'; dir: string; pr: number; repo: string | undefined; json: boolean };

/** Where the checker writes. */
export interface Streams {
  out: (text: string) => void;
  err: (text: string) => void;
}

/**
 * Runs the command line `args`, writing to `streams`, and returns its exit status. Never rejects
 * unless writing does: whatever goes wrong is said, as JSON with `--json`, and exits 2.
 */
export async function main(args: readonly string[], streams: Streams): Promise<number> {
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
        case 'check': {
          const git = gitIn(repository(command.repo));
          return report(await checkFolder(command.dir, git, command.pr), command.json, streams);
        }
        case 'commit':
          return await commit(command, streams);
        default:
          command satisfies never;
          throw new Error(`Unknown command ${JSON.stringify(command)}`);
      }
    } catch (error) {
      if (error instanceof InstallError) return fail(error.message);
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
  let help = false;
  const agents: Agent[] = [];
  let dir: string | undefined;
  let repo: string | undefined;
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
    else if (arg === '--claude') agents.push('claude');
    else if (arg === '--codex') agents.push('codex');
    else if (arg === '--dir' || arg.startsWith('--dir=')) {
      dir = arg === '--dir' ? args[++at] : arg.slice('--dir='.length);
      if (!dir) throw new Error('--dir takes the skills folder to install the skill in.');
    } else if (arg === '--repo' || arg.startsWith('--repo=')) {
      repo = arg === '--repo' ? args[++at] : arg.slice('--repo='.length);
      if (!repo) throw new Error("--repo takes the pull request's repository.");
    } else if (arg.startsWith('-')) throw new Error(`${JSON.stringify(arg)} isn't an option.`);
    else positional.push(arg);
  }
  const [name, ...rest] = positional;
  if (help || name === 'help' || name === undefined) return { kind: 'help' };
  const installing = agents.length > 0 || dir !== undefined;
  if (name !== 'install' && installing)
    throw new Error('--claude, --codex and --dir are for install.');
  switch (name) {
    case 'install': {
      if (rest.length > 0) throw new Error('install takes a skills folder with --dir <folder>.');
      if (pr !== undefined || repo !== undefined)
        throw new Error('install takes no --pr or --repo.');
      return { kind: 'install', agents: [...new Set(agents)], dir, json };
    }
    case 'check': {
      if (rest.length > 1) throw new Error('check takes one folder.');
      return { kind: 'check', dir: rest[0] ?? '.', pr: pullRequest(pr), repo, json };
    }
    case 'commit': {
      if (rest.length !== 1) throw new Error("commit takes the overview's folder.");
      if (pr === undefined) throw new Error("commit needs --pr, the pull request's number.");
      return { kind: 'commit', dir: rest[0]!, pr: pullRequest(pr)!, repo, json };
    }
    default:
      throw new Error(`${JSON.stringify(name)} isn't a command.`);
  }
}

/** `given`, a pull request's number, as one. Throws for anything else. */
function pullRequest(given: string | undefined): number | undefined {
  if (given === undefined) return undefined;
  if (!/^[1-9]\d{0,15}$/.test(given) || !Number.isSafeInteger(Number(given))) {
    throw new Error(`--pr takes a pull request's number, not ${JSON.stringify(given)}.`);
  }
  return Number(given);
}

/** Says where the skill was installed, and returns the exit status. */
function installed(where: readonly Installed[], json: boolean, streams: Streams): number {
  if (json) {
    const each = where.map(({ agent, folder }) => ({ agent: agent ?? null, folder }));
    streams.out(`${JSON.stringify({ installed: each }, null, 2)}\n`);
    return 0;
  }
  for (const { agent, folder } of where) {
    const forWhom = agent === undefined ? '' : ` for ${AGENT_NAMES[agent]},`;
    streams.out(`Installed the ${SKILL_NAME} skill${forWhom} in ${folder}.\n`);
  }
  return 0;
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

/** Checks the overview in `dir`, and when it passes, commits it for `pr`. */
async function commit(
  { dir, pr, repo, json }: Extract<Command, { kind: 'commit' }>,
  streams: Streams,
): Promise<number> {
  const git = gitIn(repository(repo));
  const found = await checkFolder(dir, git, pr);
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
  const written = await writeCommit(git, pr, files);
  // Files in figures/ that no block shows aren't checked, so they're left out.
  const unshown = found.folder.entries
    .map(({ path }) => new TextDecoder().decode(path))
    .filter((path) => path.startsWith('figures/') && !shown.includes(path))
    .toSorted();
  return report(found, json, streams, '', { pr, written, unshown });
}

/** What `commit` wrote. */
interface Committed {
  pr: number;
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
                ref: refOf(committed.pr),
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
    const { pr, written, unshown } = committed;
    for (const path of unshown) {
      streams.out(`${path} isn't shown in artifact.md, so it's left out of the commit.\n`);
    }
    const parent = written.parent
      ? `with ${refOf(pr)} (${written.parent}) as its parent`
      : `with no parent, since there's no ${refOf(pr)} here`;
    streams.out(
      `\nCommitted the overview as ${written.id}, ${parent}. Push it to the pull request's repository:\n\n  git push <remote> ${written.id}:${refOf(pr)}\n`,
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
