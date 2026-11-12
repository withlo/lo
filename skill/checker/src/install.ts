/**
 * `install`: copies the overview skill into a skills folder, in a folder of its own named for the
 * skill, `lo-overview`, where Claude Code, Codex or another coding agent finds it.
 *
 * Only the skill's own files are written there, each replaced whole, and nothing is deleted, so a
 * file someone added to the skill's folder stays. A folder named for the skill that holds another
 * skill, or files that aren't the skill's, is left alone. Nothing is written through a link: a link
 * where the skill's folder, a folder in it or one of its files goes is refused, since it could lead
 * anywhere, such as into a checkout of the skill's source. The folders above the skill's own may be
 * links, as a skills folder kept with someone's other settings often is.
 *
 * Every folder is checked before anything is written, so a refusal leaves them all as they were.
 */

import { randomBytes } from 'node:crypto';
import {
  closeSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
  type Stats,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';

import { SKILL_FILES, SKILL_NAME } from './skill.ts';

/**
 * Why the skill couldn't be installed, for a caller that words it for itself, since the messages
 * speak to the command line. `path` is the folder or file the refusal is about.
 *
 * - `nothingSetUp`: no agent was named, and neither is set up here;
 * - `link`: a link is where the skill's folder, a folder in it or one of its files goes;
 * - `notFolder`, `notFile`: something else is where a folder or a file goes;
 * - `otherSkill`: the skill's folder holds another skill, `name` if it says one;
 * - `otherFiles`: the skill's folder holds files that aren't the skill's, and no `SKILL.md`;
 * - `failed`: the file system refused something in the skills folder `skills`, saying `detail`.
 */
export type InstallReason =
  | { kind: 'nothingSetUp' }
  | { kind: 'link'; path: string }
  | { kind: 'notFolder'; path: string }
  | { kind: 'notFile'; path: string }
  | { kind: 'otherSkill'; path: string; name: string | undefined }
  | { kind: 'otherFiles'; path: string }
  | { kind: 'failed'; skills: string; detail: string };

/** The skill couldn't be installed. Its message says why to the command line; `reason` says it plain. */
export class InstallError extends Error {
  override name = 'InstallError';
  readonly reason: InstallReason;

  constructor(message: string, reason: InstallReason) {
    super(message);
    this.reason = reason;
  }
}

/** A coding agent with a skills folder of the user's own. */
export type Agent = 'claude' | 'codex';

/** Every agent, in the order they're installed for. */
export const AGENTS: readonly Agent[] = ['claude', 'codex'];

/** Each agent's name, as its users know it. */
export const AGENT_NAMES: Readonly<Record<Agent, string>> = {
  claude: 'Claude Code',
  codex: 'Codex',
};

/** Where to install the skill: the agents named, and a skills folder, when one's given. */
export interface Wanted {
  agents: readonly Agent[];
  dir: string | undefined;
}

/** A skills folder to install the skill in, and the agent it's for, when it's an agent's. */
export interface Target {
  agent: Agent | undefined;
  skills: string;
}

/** Where the skill was installed: the target, and the skill's own folder in it. */
export interface Installed extends Target {
  folder: string;
}

/**
 * Where `agent` keeps the user's own skills, and the folder that says it's set up here.
 *
 * - Claude Code reads personal skills from `~/.claude/skills/<name>/SKILL.md`
 *   (https://code.claude.com/docs/en/skills). `CLAUDE_CONFIG_DIR` moves `~/.claude`, under which it
 *   keeps everything of its own (https://code.claude.com/docs/en/env-vars).
 * - Codex reads the user's skills from `$HOME/.agents/skills/<name>/SKILL.md`
 *   (https://developers.openai.com/codex/skills). It keeps its own state in `~/.codex`, or in
 *   `CODEX_HOME` when that's set (https://developers.openai.com/codex/environment-variables).
 */
export function agentFolders(
  agent: Agent,
  env: NodeJS.ProcessEnv,
): { skills: string; setUp: string } {
  const home = homedir();
  switch (agent) {
    case 'claude': {
      const config = absolute(env.CLAUDE_CONFIG_DIR) ?? join(home, '.claude');
      return { skills: join(config, 'skills'), setUp: config };
    }
    case 'codex':
      return {
        skills: join(home, '.agents', 'skills'),
        setUp: absolute(env.CODEX_HOME) ?? join(home, '.codex'),
      };
    default:
      agent satisfies never;
      throw new Error(`Unknown agent ${JSON.stringify(agent)}`);
  }
}

/** `path`, when it's an absolute path. */
function absolute(path: string | undefined): string | undefined {
  return path !== undefined && isAbsolute(path) ? path : undefined;
}

/**
 * The skills folders `wanted` names, each once. With no agent and no folder named, those of each
 * agent that's set up here, whose own folder is there. Throws when there's none.
 */
export function targetsOf(wanted: Wanted, env: NodeJS.ProcessEnv): Target[] {
  let targets: Target[] = wanted.agents.map((agent) => ({
    agent,
    skills: agentFolders(agent, env).skills,
  }));
  if (wanted.dir !== undefined) targets.push({ agent: undefined, skills: resolve(wanted.dir) });
  if (targets.length === 0) {
    targets = AGENTS.filter((agent) => isSetUp(agent, env)).map((agent) => ({
      agent,
      skills: agentFolders(agent, env).skills,
    }));
  }
  if (targets.length === 0) {
    throw new InstallError(
      `Lo found neither Claude Code nor Codex set up here. Say where to install the skill with --claude, --codex or --dir <folder>. ${NOTHING}`,
      { kind: 'nothingSetUp' },
    );
  }
  return targets.filter(
    (target, at) => targets.findIndex(({ skills }) => skills === target.skills) === at,
  );
}

/** Whether `agent` is set up here: the folder that says so is there. */
export function isSetUp(agent: Agent, env: NodeJS.ProcessEnv): boolean {
  return isFolder(agentFolders(agent, env).setUp);
}

/** Whether there's a folder at `path`, or a link to one. */
function isFolder(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** What a refusal ends with when nothing was written. */
const NOTHING = 'Nothing was installed.';

/**
 * Installs the skill in each of `targets`, once each has been checked, and returns where. Throws
 * with why when one can't take it, before writing anything.
 */
export function install(targets: readonly Target[]): Installed[] {
  const checked = targets.map((target) => ({
    ...target,
    folder: attempt(target.skills, NOTHING, () => check(join(target.skills, SKILL_NAME))),
  }));
  // Past the checks, only the file system can fail, or something changing the folders meanwhile.
  for (const target of checked) {
    attempt(target.skills, "Install the skill again once that's fixed.", () => write(target));
  }
  return checked;
}

/**
 * Runs `work` for the skills folder `skills`, saying what the file system refused as Lo would, and
 * ending what's said of a failure with `after`.
 */
function attempt<T>(skills: string, after: string, work: () => T): T {
  try {
    return work();
  } catch (error) {
    if (error instanceof InstallError) {
      throw new InstallError(`${error.message} ${after}`, error.reason);
    }
    const detail = error instanceof Error ? error.message : String(error);
    throw new InstallError(`Lo couldn't install the skill in ${skills}: ${detail} ${after}`, {
      kind: 'failed',
      skills,
      detail,
    });
  }
}

/** What's at `path`, never following a link there, or `undefined` when nothing is. */
function entryAt(path: string): Stats | undefined {
  try {
    return lstatSync(path);
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw error;
  }
}

/** Whether `error` says there's nothing at a path. */
function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

/** The ending of each refusal: what to do about it. */
const INSTEAD = 'Remove it, or install the skill somewhere else with --dir.';

/** Throws unless `stats`, what's at `path`, is a folder or a file, as `kind` says. */
function refuseOther(path: string, stats: Stats, kind: 'folder' | 'file'): void {
  if (stats.isSymbolicLink()) {
    throw new InstallError(
      `${path} is a link, and Lo doesn't install the skill through links, since one could lead anywhere. ${INSTEAD}`,
      { kind: 'link', path },
    );
  }
  if (kind === 'folder' ? !stats.isDirectory() : !stats.isFile()) {
    throw new InstallError(`${path} isn't a ${kind}, so the skill can't go there. ${INSTEAD}`, {
      kind: kind === 'folder' ? 'notFolder' : 'notFile',
      path,
    });
  }
}

/** Each folder inside the skill's own, by its path there, parents first. */
const OWN_FOLDERS = [
  ...new Set(
    SKILL_FILES.flatMap(({ path }) =>
      path
        .split('/')
        .slice(0, -1)
        .map((_, at, parts) => parts.slice(0, at + 1).join('/')),
    ),
  ),
];

/** Each of the skill's own files and folders, by its path in the skill's folder. */
const OWN = new Set([...OWN_FOLDERS, ...SKILL_FILES.map(({ path }) => path)]);

/**
 * Checks the skill can go in its folder, `folder`: that nothing there is a link, and that the
 * folder holds the skill, or nothing yet. Returns the folder, and throws with why not.
 */
function check(folder: string): string {
  const found = entryAt(folder);
  if (found === undefined) return folder;
  refuseOther(folder, found, 'folder');
  for (const path of OWN_FOLDERS) {
    const stats = entryAt(join(folder, path));
    if (stats) refuseOther(join(folder, path), stats, 'folder');
  }
  for (const { path } of SKILL_FILES) {
    const stats = entryAt(join(folder, path));
    if (stats) refuseOther(join(folder, path), stats, 'file');
  }
  const skill = join(folder, 'SKILL.md');
  if (entryAt(skill)) {
    const name = skillName(head(skill));
    if (name !== SKILL_NAME) {
      const which = name === undefined ? 'another skill' : `another skill, ${JSON.stringify(name)}`;
      throw new InstallError(`${folder} holds ${which}, so Lo left it alone. ${INSTEAD}`, {
        kind: 'otherSkill',
        path: folder,
        name,
      });
    }
  } else if (!onlyOwn(folder, '')) {
    throw new InstallError(
      `${folder} holds files that aren't the ${SKILL_NAME} skill's, and no SKILL.md, so Lo left it alone. ${INSTEAD}`,
      { kind: 'otherFiles', path: folder },
    );
  }
  return folder;
}

/**
 * Whether the folder `inner`, inside the skill's folder `folder`, holds nothing but the skill's own
 * files and folders, as an install cut short leaves it. Its folders have been checked aren't links.
 */
function onlyOwn(folder: string, inner: string): boolean {
  for (const name of readdirSync(join(folder, inner))) {
    const path = inner === '' ? name : `${inner}/${name}`;
    if (!OWN.has(path)) return false;
    if (OWN_FOLDERS.includes(path) && !onlyOwn(folder, path)) return false;
  }
  return true;
}

/** The most of a `SKILL.md` read to find its name. */
const HEAD = 64 * 1024;

/** The start of the file at `path`, as text. */
function head(path: string): string {
  const bytes = Buffer.alloc(HEAD);
  const file = openSync(path, 'r');
  try {
    return bytes.subarray(0, readSync(file, bytes, 0, HEAD, 0)).toString('utf8');
  } finally {
    closeSync(file);
  }
}

/** The name a skill's `SKILL.md`, `text`, gives in its front matter, if it gives one. */
export function skillName(text: string): string | undefined {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  if (lines[0] !== '---') return undefined;
  for (const line of lines.slice(1)) {
    if (line === '---') return undefined;
    const match = /^name:[ \t]*(["']?)(.*?)\1[ \t]*$/.exec(line);
    if (match) return match[2];
  }
  return undefined;
}

/**
 * Whether the skill is installed in the skills folder `skills`: its folder holds a `SKILL.md` that
 * names it. A link there counts, as it does for the agent that reads the skill through it.
 */
export function installedIn(skills: string): boolean {
  try {
    return skillName(head(join(skills, SKILL_NAME, 'SKILL.md'))) === SKILL_NAME;
  } catch {
    return false;
  }
}

/** Writes the skill's files in its folder, `folder`, in `skills`, replacing each whole. */
function write({ skills, folder }: Installed): void {
  mkdirSync(skills, { recursive: true });
  makeFolder(folder);
  for (const path of OWN_FOLDERS) makeFolder(join(folder, path));
  for (const { path, text } of SKILL_FILES) replace(join(folder, path), text);
}

/** Makes the folder `path`, unless one's there, refusing a link or anything else there. */
function makeFolder(path: string): void {
  try {
    mkdirSync(path);
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error;
  }
  refuseOther(path, lstatSync(path), 'folder');
}

/**
 * Replaces the file at `path` with `text`: written beside it under a name nothing has, then renamed
 * over it, so that nothing is ever written through a link, and no agent reads it half written.
 */
function replace(path: string, text: string): void {
  const temporary = join(dirname(path), `.${SKILL_NAME}-${randomBytes(8).toString('hex')}.tmp`);
  // Made new, or not at all, so that it's only ever removed when it's the skill's own.
  const file = openSync(temporary, 'wx', 0o644);
  try {
    try {
      writeFileSync(file, text);
    } finally {
      closeSync(file);
    }
    renameSync(temporary, path);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
}
