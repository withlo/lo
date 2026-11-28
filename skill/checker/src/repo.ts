/**
 * `install --repo`: writes a repository's copy of the overview skill, `lo-overview`, into a clone,
 * for its team to review and merge, so that everyone's coding agent writes an overview of each pull
 * request it opens or pushes to:
 *
 * - the skill, in `.claude/skills/lo-overview`, with its hook, `hook.mjs`;
 * - `.agents/skills/lo-overview`, a link to it, where Codex reads skills, unless `.agents/skills`
 *   and `.claude/skills` are the same folder;
 * - the hook in `.claude/settings.json` for Claude Code, and in `.codex/hooks.json` for Codex, with
 *   every other key of each file kept, and the skill allowed to start without asking
 *   (`Skill(lo-overview)`, with arguments or none) on Claude Code;
 * - `.lo/overview.md` and `.lo/settings.json`, templates for the team's own, only where there's no
 *   file yet: from then on they're the team's.
 *
 * Run again, it writes the skill and the hook again, replacing what it wrote before. Every file and
 * folder is checked before anything is written, so a refusal leaves the clone as it was. Nothing is
 * written through a link, and a folder that's a link is followed only to a folder in the clone.
 */

import {
  closeSync,
  constants,
  fstatSync,
  mkdirSync,
  openSync,
  readlinkSync,
  readSync,
  realpathSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

import {
  agentFolders,
  AGENTS,
  check,
  entryAt,
  INSTEAD,
  InstallError,
  installedIn,
  replace,
  writeSkill,
  type Agent,
} from './install.ts';
import { REPO_SKILL } from './skill.ts';

/** `install --repo` can't write the skill into the clone: its message says why, and what to do. */
export class RepoError extends Error {
  override name = 'RepoError';
}

/** What `install --repo` did with one file or folder, by its path in the clone. */
export interface RepoChange {
  path: string;
  /** Written new, written again over what it wrote before, or left as it was. */
  state: 'written' | 'updated' | 'kept';
}

/** What `install --repo` did. */
export interface RepoInstalled {
  /** The clone's top folder. */
  root: string;
  /** The skill's folder, its link for Codex, the hooks' files and the templates, in that order. */
  changes: RepoChange[];
  /** Whether Codex reads the skill where Claude Code does, through `.agents/skills` itself. */
  shared: boolean;
  /**
   * A person's own copies of the skill under its old name, `lo-overview`, which run in place of the
   * clone's on Claude Code, and stop Codex picking either by name: each its folder, and the agent.
   */
  shadows: { agent: Agent; folder: string }[];
}

/** The skill's folder in a clone, by its path there. */
export const SKILL_FOLDER = '.claude/skills/lo-overview';

/** The command Claude Code runs the hook with, from wherever in the clone it was started. */
export const CLAUDE_COMMAND = `node "$CLAUDE_PROJECT_DIR/${SKILL_FOLDER}/hook.mjs"`;

/**
 * The command Codex runs the hook with, through the person's shell (`$SHELL -lc`), from the folder
 * its session started in, which may be one in the clone: so the hook is found from the clone's top,
 * as Codex's documentation advises. Codex asks each person to trust a hook once, and asks again when
 * its command changes, so it stays the same in every version.
 */
export const CODEX_COMMAND =
  'node "$(git rev-parse --show-toplevel)/.agents/skills/lo-overview/hook.mjs"';

/**
 * The command Codex runs the hook with on Windows, through `cmd /C`, which has no `$(…)`: from the
 * clone's top, where a session started there finds it.
 */
export const CODEX_WINDOWS_COMMAND = 'node .agents/skills/lo-overview/hook.mjs';

/**
 * How long Claude Code and Codex give the hook, in seconds: it asks `gh` for a pushed branch's pull
 * request, three at most, 15 s each.
 */
const TIMEOUT = 60;

/**
 * What lets Claude Code start the skill without asking, which an automatic run needs: with no
 * arguments, and with any, which a rule of the name alone doesn't take in.
 */
export const SKILL_RULES = [`Skill(${REPO_SKILL.name})`, `Skill(${REPO_SKILL.name} *)`];

/**
 * The hook's groups in `.claude/settings.json`'s `PostToolUse`. Each Bash handler's `if` names the
 * commands it's for, so Node starts only for those: `git *push*` takes in `git -C <folder> push`
 * and options before `push`. A command that does both runs the hook twice, and it answers once.
 */
export const CLAUDE_GROUPS = [
  {
    matcher: 'Bash',
    hooks: ['Bash(git *push*)', 'Bash(gh pr create *)', 'Bash(gh pr new *)'].map((rule) => ({
      type: 'command',
      if: rule,
      command: CLAUDE_COMMAND,
      timeout: TIMEOUT,
    })),
  },
  {
    matcher: 'mcp__.*__create_pull_request',
    hooks: [{ type: 'command', command: CLAUDE_COMMAND, timeout: TIMEOUT }],
  },
];

/** The hook's group in `.codex/hooks.json`'s `PostToolUse`: one, so it's trusted once. */
export const CODEX_GROUPS = [
  {
    matcher: 'Bash|mcp__.*__create_pull_request',
    hooks: [
      {
        type: 'command',
        command: CODEX_COMMAND,
        commandWindows: CODEX_WINDOWS_COMMAND,
        timeout: TIMEOUT,
      },
    ],
  },
];

/** `.lo/overview.md` as the template writes it. */
export const OVERVIEW_TEMPLATE = `<!--
How coding agents write Lo overviews of this repository's pull requests, read from its default
branch before each one.

- Under "Required": what every overview follows. A writer's own instructions, in
  ~/.config/lo/overview.md, can't change it.
- Under "Defaults": what a writer's own instructions may change. Text under neither heading counts
  as Defaults.

Anything this file leaves out follows Lo's defaults, which come with the overview skill.
-->

## Required

## Defaults
`;

/** `.lo/settings.json` as the template writes it. */
export const SETTINGS_TEMPLATE = `// Lo's settings for this repository: JSON, with comments.
{
  // Coding agents write or update the overview of each pull request they open or push to, with
  // the lo-overview skill. false turns that off for this repository; a person turns it off for
  // themselves in Lo's own settings file.
  "overview.auto": true
}
`;

/** The most of a hook's file read. */
const JSON_LIMIT = 1024 * 1024;

/** What a file of the hook's says it was written by: the hook, wherever it is. */
const OURS = `${REPO_SKILL.name}/hook.mjs`;

/** A file `install --repo` writes whole, as it'll be. */
interface Planned {
  path: string;
  text: string;
  state: RepoChange['state'];
}

/**
 * Writes a repository's copy of the skill into the clone `from` is in, and says what it did.
 * Throws with why, writing nothing, when it can't.
 */
export function installRepo(from: string, env: NodeJS.ProcessEnv): RepoInstalled {
  const root = topOf(from);
  for (const folder of [
    '.claude',
    '.claude/skills',
    '.agents',
    '.agents/skills',
    '.codex',
    '.lo',
  ]) {
    checkFolder(root, folder);
  }
  const skills = join(root, '.claude', 'skills');
  const folder = checkSkill(join(root, SKILL_FOLDER));
  const skillState: RepoChange['state'] = !entryAt(folder)
    ? 'written'
    : REPO_SKILL.files.every(({ path, text }) => sameText(join(folder, path), text))
      ? 'kept'
      : 'updated';
  const agents = join(root, '.agents', 'skills');
  const shared = sameFolder(agents, skills);
  const link = join(agents, REPO_SKILL.name);
  const linkState = shared ? undefined : planLink(link, folder);
  const hooks = [
    planJson(join(root, '.claude', 'settings.json'), (value, path) => withClaude(value, path)),
    planJson(join(root, '.codex', 'hooks.json'), (value, path) =>
      withHooks(value, path, CODEX_GROUPS),
    ),
  ];
  const templates = [
    { path: join(root, '.lo', 'overview.md'), text: OVERVIEW_TEMPLATE },
    { path: join(root, '.lo', 'settings.json'), text: SETTINGS_TEMPLATE },
  ].map(({ path, text }): Planned => ({ path, text, state: entryAt(path) ? 'kept' : 'written' }));

  // Past the checks, only the file system can fail, or something changing the clone meanwhile.
  try {
    writeSkill(skills, folder, REPO_SKILL);
    if (linkState === 'written') {
      mkdirSync(agents, { recursive: true });
      symlinkSync(relative(realpathSync(agents), realpathSync(folder)), link, 'dir');
    }
    for (const { path, text, state } of hooks) {
      if (state === 'kept') continue;
      mkdirSync(dirname(path), { recursive: true });
      replace(path, text, REPO_SKILL.name);
    }
    for (const { path, text, state } of templates) {
      if (state === 'kept') continue;
      mkdirSync(dirname(path), { recursive: true });
      writeNew(path, text);
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new RepoError(
      `Lo couldn't write the skill into ${root}: ${detail} Install it again once that's fixed.`,
    );
  }
  const at = (path: string) => relative(root, path).split(sep).join('/');
  return {
    root,
    changes: [
      { path: `${SKILL_FOLDER}/`, state: skillState },
      ...(linkState === undefined ? [] : [{ path: at(link), state: linkState }]),
      ...[...hooks, ...templates].map(({ path, state }) => ({ path: at(path), state })),
    ],
    shared,
    shadows: AGENTS.flatMap((agent) => {
      const own = agentFolders(agent, env).skills;
      return installedIn(own, REPO_SKILL.name)
        ? [{ agent, folder: join(own, REPO_SKILL.name) }]
        : [];
    }),
  };
}

/** Checks the skill can go in its folder, `folder`, as a person's install does. */
function checkSkill(folder: string): string {
  try {
    return check(folder, REPO_SKILL);
  } catch (error) {
    if (!(error instanceof InstallError)) throw error;
    throw new RepoError(
      `${error.message.replace(INSTEAD, 'Remove it, and install the skill again.')} ${NOTHING}`,
    );
  }
}

/** Whether the file at `path` holds `text`, as checked as the skill's own: not a link. */
function sameText(path: string, text: string): boolean {
  try {
    return entryAt(path)?.isFile() === true && readText(path) === text;
  } catch {
    return false;
  }
}

/** What a refusal ends with: nothing was written. */
const NOTHING = 'Nothing was written.';

/**
 * The top folder of the clone `from` is in: the nearest folder up from it holding `.git`, as a
 * folder, or as the file a worktree has. Throws when there's none.
 */
function topOf(from: string): string {
  const start = resolve(from);
  if (!statSync(start, { throwIfNoEntry: false })?.isDirectory()) {
    throw new RepoError(`There's no folder at ${start} to install the skill in. ${NOTHING}`);
  }
  for (let at = realpathSync(start); ; at = dirname(at)) {
    if (entryAt(join(at, '.git'))) return at;
    if (dirname(at) === at) break;
  }
  throw new RepoError(
    `${start} isn't in a clone of a repository. Run this in one, or name one with --repo <folder>. ${NOTHING}`,
  );
}

/**
 * Throws unless what's at `inner`, a folder's path in the clone `root`, is a folder, a link to a
 * folder in the clone, or nothing yet.
 */
function checkFolder(root: string, inner: string): void {
  const path = join(root, inner);
  const found = entryAt(path);
  if (found === undefined) return;
  if (found.isSymbolicLink()) {
    let real: string | undefined;
    try {
      real = realpathSync(path);
    } catch {
      real = undefined;
    }
    if (real !== undefined && statSync(real).isDirectory() && isIn(root, real)) return;
    // A link to a folder the install makes, such as `.agents/skills` to `.claude/skills` before
    // there's one, which leads there once it's made.
    const target = linkTarget(path);
    const made = [join(root, '.claude'), join(root, '.claude', 'skills')];
    if (real === undefined && target !== undefined && made.includes(target) && !entryAt(target))
      return;
    throw new RepoError(
      `${path} is a link that doesn't lead to a folder in the clone, and Lo doesn't write through it. Make it a folder, or remove it. ${NOTHING}`,
    );
  }
  if (!found.isDirectory()) {
    throw new RepoError(`${path} isn't a folder, so the skill can't go there. ${NOTHING}`);
  }
}

/** Whether `path`, a real path, is the clone `root` or in it. */
function isIn(root: string, path: string): boolean {
  const top = realpathSync(root);
  return path === top || path.startsWith(top + sep);
}

/** Where the link at `path` leads, resolved from its folder, or `undefined` when it isn't a link. */
function linkTarget(path: string): string | undefined {
  if (entryAt(path)?.isSymbolicLink() !== true) return undefined;
  return resolve(dirname(path), readlinkSync(path));
}

/** The real path of `path`, or `undefined` when there's nothing there. */
function realOf(path: string): string | undefined {
  try {
    return realpathSync(path);
  } catch {
    return undefined;
  }
}

/**
 * Whether the folders `a` and `b` are the same one, as when `.agents/skills` is a link to
 * `.claude/skills`, before either is made.
 */
function sameFolder(a: string, b: string): boolean {
  if (linkTarget(a) === b || linkTarget(b) === a) return true;
  const [realA, realB] = [realOf(a), realOf(b)];
  return realA !== undefined && realA === realB;
}

/**
 * Whether the link for Codex at `link` is to be made or is there already, leading to the skill's
 * folder `folder`. Throws when something else is there.
 */
function planLink(link: string, folder: string): RepoChange['state'] {
  const found = entryAt(link);
  if (found === undefined) return 'written';
  const target = linkTarget(link);
  if (target !== undefined) {
    const real = realOf(target);
    if (target === folder || (real !== undefined && real === realOf(folder))) return 'kept';
  }
  throw new RepoError(
    `${link} isn't the link to ${SKILL_FOLDER} that Codex reads the skill through, so Lo left it alone. Remove it, and install the skill again. ${NOTHING}`,
  );
}

/**
 * The file at `path` with the hook added by `edit`, or written new when it isn't there: kept, when
 * it holds the hook already. Throws when what's there isn't a file, or isn't JSON holding an object
 * of the shape `edit` expects.
 */
function planJson(
  path: string,
  edit: (value: Record<string, unknown>, path: string) => Record<string, unknown>,
): Planned {
  const found = entryAt(path);
  if (found === undefined) {
    return { path, text: `${JSON.stringify(edit({}, path), null, 2)}\n`, state: 'written' };
  }
  if (found.isSymbolicLink()) {
    throw new RepoError(
      `${path} is a link, and Lo doesn't write through links, since one could lead anywhere. Make it a file, and install the skill again. ${NOTHING}`,
    );
  }
  const before = readText(path);
  let value: unknown;
  try {
    value = JSON.parse(before);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new RepoError(
      `${path} isn't JSON Lo can read (${detail}). Fix it, and install the skill again. ${NOTHING}`,
    );
  }
  if (!isObject(value)) {
    throw new RepoError(
      `${path} doesn't hold a JSON object. Fix it, and install the skill again. ${NOTHING}`,
    );
  }
  const text = `${JSON.stringify(edit(value, path), null, indentOf(before))}${before.endsWith('\n') ? '\n' : ''}`;
  return { path, text, state: text === before ? 'kept' : 'updated' };
}

/**
 * The text of the file at `path`, at most `JSON_LIMIT` bytes. It opens without waiting, so a pipe
 * there is no wait, and reads only a file.
 */
function readText(path: string): string {
  const file = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const stats = fstatSync(file);
    if (!stats.isFile()) {
      throw new RepoError(`${path} isn't a file, so Lo can't add the hook to it. ${NOTHING}`);
    }
    if (stats.size > JSON_LIMIT) {
      throw new RepoError(`${path} is over 1 MB, more than Lo reads. ${NOTHING}`);
    }
    const bytes = Buffer.alloc(stats.size);
    let read = 0;
    while (read < bytes.length) {
      const got = readSync(file, bytes, read, bytes.length - read, read);
      if (got === 0) break;
      read += got;
    }
    return bytes.subarray(0, read).toString('utf8').replace(/^﻿/, '');
  } finally {
    closeSync(file);
  }
}

/** The indent the JSON `text` uses: its first indented line's, or two spaces. */
function indentOf(text: string): string | number {
  const found = /\n([ \t]+)\S/.exec(text);
  if (!found?.[1]) return 2;
  return found[1].startsWith('\t') ? '\t' : Math.min(found[1].length, 10);
}

/** Whether `value` is a JSON object. */
function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** `value[key]`, an object, or an empty one when there's none. Throws when it's something else. */
function objectAt(
  value: Record<string, unknown>,
  key: string,
  path: string,
): Record<string, unknown> {
  const found = value[key];
  if (found === undefined) return {};
  if (isObject(found)) return found;
  throw new RepoError(`${path}'s "${key}" isn't an object, so Lo can't add to it. ${NOTHING}`);
}

/** `value[key]`, a list, or an empty one when there's none. Throws when it's something else. */
function listAt(value: Record<string, unknown>, key: string, path: string): unknown[] {
  const found = value[key];
  if (found === undefined) return [];
  if (Array.isArray(found)) return found;
  throw new RepoError(`${path}'s "${key}" isn't a list, so Lo can't add to it. ${NOTHING}`);
}

/** Whether `handler`, one of a group's hooks, runs the overview hook. */
function isOurs(handler: unknown): boolean {
  return isObject(handler) && typeof handler.command === 'string' && handler.command.includes(OURS);
}

/**
 * `value`, a hooks file's object, with `groups` as the last of its `hooks.PostToolUse`, and every
 * handler of the hook's from before taken out, with a group it leaves empty. Every other key stays
 * where it was.
 */
function withHooks(
  value: Record<string, unknown>,
  path: string,
  groups: readonly Record<string, unknown>[],
): Record<string, unknown> {
  const hooks = objectAt(value, 'hooks', path);
  const kept = listAt(hooks, 'PostToolUse', path).flatMap((group) => {
    if (!isObject(group) || !Array.isArray(group.hooks) || !group.hooks.some(isOurs))
      return [group];
    const others = group.hooks.filter((handler) => !isOurs(handler));
    return others.length === 0 ? [] : [{ ...group, hooks: others }];
  });
  return { ...value, hooks: { ...hooks, PostToolUse: [...kept, ...groups] } };
}

/** `.claude/settings.json`'s object, `value`, with the hook, and the skill allowed to start. */
function withClaude(value: Record<string, unknown>, path: string): Record<string, unknown> {
  const hooked = withHooks(value, path, CLAUDE_GROUPS);
  const permissions = objectAt(hooked, 'permissions', path);
  const allow = listAt(permissions, 'allow', path);
  return {
    ...hooked,
    permissions: {
      ...permissions,
      allow: [...allow, ...SKILL_RULES.filter((rule) => !allow.includes(rule))],
    },
  };
}

/** Writes `text` to a new file at `path`, never over one, nor through a link. */
function writeNew(path: string, text: string): void {
  const file = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o644);
  try {
    writeFileSync(file, text);
  } finally {
    closeSync(file);
  }
}
