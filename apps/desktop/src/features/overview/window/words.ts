// What the window says of the overview skill: where it stands for each agent, what the button does,
// and how an install went. Plain functions of what main reported, so each wording is tested alone.

import type { Agent, SkillAgent, SkillRefusal, SkillResult, SkillState } from '../contract.ts';

/** `names` as a list in a sentence: "A", "A and B", "A, B and C". */
function list(names: readonly string[]): string {
  return names.length <= 1
    ? (names[0] ?? '')
    : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

/** The agents that are set up and lack the skill: what installing it for the rest installs for. */
function rest(state: SkillState): SkillAgent[] {
  return state.agents.filter((each) => each.setUp && !each.installed);
}

/**
 * The agents an install with no choice made is for: those set up that lack the skill, else, to
 * bring it up to date, all that are set up; and none when none is.
 */
export function agentsToInstall(state: SkillState): Agent[] {
  const missing = rest(state);
  const chosen = missing.length > 0 ? missing : state.agents.filter((each) => each.setUp);
  return chosen.map((each) => each.agent);
}

/** Whether the skill is installed for every agent that's set up, and for one at least. */
export function installedEverywhere(state: SkillState | undefined): boolean {
  if (state === undefined) return false;
  return state.agents.some((each) => each.installed) && rest(state).length === 0;
}

/**
 * What the button for installing says: "Install", for the rest once it's installed for some, whose
 * rows under it name them, or "Install again".
 */
export function installLabel(state: SkillState | undefined): string {
  if (state === undefined || !state.agents.some((each) => each.installed)) return 'Install';
  return rest(state).length > 0 ? 'Install' : 'Install again';
}

/** What the skill is for, before Lo has found where it stands. */
export const ABOUT = 'Teaches Claude Code and Codex to write overviews.';

/** Where the skill stands for one agent, as a line of its row: "Codex · not installed". */
export interface Standing {
  /** Which agent, and whether the skill is installed for it. */
  readonly line: string;
  /**
   * The folder it's installed in, said after the line, since a Lo opened from the Dock doesn't see
   * a shell's `CLAUDE_CONFIG_DIR`.
   */
  readonly folder?: string;
  /** What would stop an install for it, when something would. */
  readonly why?: string;
}

/** Where the skill stands for each agent, a line each. */
export function standing(state: SkillState): Standing[] {
  return state.agents.map((each) => {
    const said = each.blocked === null ? '' : refusalWords(each.blocked, state);
    const why = said === '' ? {} : { why: said };
    if (each.installed) {
      return each.blocked === null
        ? { line: `${each.name} · installed in`, folder: each.skills }
        : { line: `${each.name} · installed, can’t update`, ...why };
    }
    if (each.setUp) return { line: `${each.name} · not installed`, ...why };
    return { line: `${each.name} · not set up` };
  });
}

/** Why the skill wasn't installed, with each path between backticks, as code. */
export function refusalWords(why: SkillRefusal, state: SkillState): string {
  switch (why.kind) {
    case 'nothingSetUp':
      return `Set up ${state.agents.map((each) => each.name).join(' or ')} first`;
    case 'link':
      return `\`${why.path}\` is a link, not a folder.`;
    case 'notFolder':
      return `\`${why.path}\` is a file, not a folder.`;
    case 'notFile':
      return `\`${why.path}\` is a folder, not a file.`;
    case 'otherSkill':
      return `\`${why.path}\` holds another skill${why.name === null ? '' : `, “${why.name}”`}.`;
    case 'otherFiles':
      return `\`${why.path}\` holds other files.`;
    case 'failed': {
      const at = why.path ?? why.skills;
      if (why.code === 'EACCES' || why.code === 'EPERM') {
        return `\`${at}\` isn’t writable.`;
      }
      if (why.code === 'EROFS') {
        return `\`${at}\` is read-only.`;
      }
      if (why.code === 'ENOSPC') {
        return 'The disk is full.';
      }
      // A cause Lo can't name has no reason line: the system's words are its Details.
      return '';
    }
    default:
      why satisfies never;
      return '';
  }
}

/** What the system said of a failed install, as it came, for Details. */
export function refusalDetails(why: SkillRefusal): string | undefined {
  return why.kind === 'failed' ? why.detail : undefined;
}

/**
 * Why the skill can't be installed while no agent is set up, which dims its buttons and the
 * command: "Set up Claude Code or Codex first". Nothing while one is, or before Lo knows.
 */
export function notSetUp(state: SkillState | undefined): string | undefined {
  if (state === undefined || state.agents.some((each) => each.setUp)) return undefined;
  return `Set up ${state.agents.map((each) => each.name).join(' or ')} first`;
}

/** What an install a command asked for says, in notes: what's done, and each agent's failure. */
export interface InstallSaid {
  /** "Installed overview skill", or with some failed, the agents it's installed for. */
  readonly done: string | undefined;
  /** For each agent it couldn't be installed for, what failed, why, and the system's words. */
  readonly failed: readonly {
    readonly title: string;
    readonly body: string;
    readonly details: string | undefined;
  }[];
}

/**
 * How an install for agents went, from main's `results`: done, naming the agents it's for when it
 * failed for others ("Installed overview skill for Claude Code"), and a failure for each of those,
 * named, with why ("Couldn’t install Codex’s overview skill").
 */
export function installWords(results: readonly SkillResult[], state: SkillState): InstallSaid {
  const name = (agent: Agent) => state.agents.find((each) => each.agent === agent)?.name ?? agent;
  const installed = results.flatMap((each) =>
    each.kind === 'installed' ? [name(each.agent)] : [],
  );
  const failed = results.flatMap((each) =>
    each.kind === 'refused' && each.agent !== null
      ? [
          {
            title: `Couldn’t install ${name(each.agent)}’s overview skill`,
            body: refusalWords(each.why, state),
            details: refusalDetails(each.why),
          },
        ]
      : [],
  );
  if (installed.length === 0) return { done: undefined, failed };
  const done =
    failed.length === 0
      ? 'Installed overview skill'
      : `Installed overview skill for ${list(installed)}`;
  return { done, failed };
}
