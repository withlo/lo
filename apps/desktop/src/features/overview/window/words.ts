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

/** What the button for installing says: for the rest, once it's installed for some, or again. */
export function installLabel(state: SkillState | undefined): string {
  if (state === undefined || !state.agents.some((each) => each.installed)) return 'Install';
  const missing = rest(state);
  return missing.length > 0
    ? `Install for ${list(missing.map((each) => each.name))}`
    : 'Install again';
}

/** What the skill is for, before Lo has found where it stands. */
export const ABOUT = 'Teaches Claude Code and Codex to write overviews that Lo shows.';

/**
 * Where the skill stands for each agent, naming the folder Lo looked in, since a Lo opened from the
 * Dock doesn't see a shell's `CLAUDE_CONFIG_DIR`: "Installed for Claude Code in ~/.claude/skills.
 * Not installed for Codex, which reads ~/.agents/skills."
 */
export function standing(state: SkillState | undefined): string {
  if (state === undefined) return ABOUT;
  return state.agents
    .map((each) => {
      if (each.installed) return `Installed for ${each.name} in ${each.skills}.`;
      if (each.setUp) return `Not installed for ${each.name}, which reads ${each.skills}.`;
      return `${each.name} isn't set up here: Lo found no ${each.config}.`;
    })
    .join(' ');
}

/** Why the skill wasn't installed, and what to do about it. */
export function refusalWords(why: SkillRefusal, state: SkillState): string {
  switch (why.kind) {
    case 'nothingSetUp':
      return `Lo found neither ${state.agents.map((each) => each.name).join(' nor ')} set up on this computer. Set one up, then install the skill.`;
    case 'link':
      return `${why.path} is a link, and Lo doesn't install the skill through links. Remove it, then install again.`;
    case 'notFolder':
      return `${why.path} isn't a folder, so the skill can't go there. Remove it, then install again.`;
    case 'notFile':
      return `${why.path} isn't a file, so the skill can't go there. Remove it, then install again.`;
    case 'otherSkill':
      return `${why.path} holds another skill${why.name === null ? '' : `, "${why.name}"`}. Move it, then install again.`;
    case 'otherFiles':
      return `${why.path} holds files that aren't the skill's. Move them, then install again.`;
    case 'failed':
      return `Lo couldn't write in ${why.skills}: ${why.detail.replace(/\.+$/, '')}. Fix that, then install again.`;
    default:
      why satisfies never;
      return "Lo couldn't install the skill.";
  }
}

/** What an install did for each agent, in a few sentences: where it installed, and why not. */
export function resultWords(results: readonly SkillResult[], state: SkillState): string {
  const name = (agent: Agent) => state.agents.find((each) => each.agent === agent)?.name ?? agent;
  const skills = (agent: Agent) => state.agents.find((each) => each.agent === agent)?.skills;
  const installed = results.flatMap((each) =>
    each.kind === 'installed' ? [`${name(each.agent)} in ${skills(each.agent)}`] : [],
  );
  const refused = results.flatMap((each) =>
    each.kind === 'refused'
      ? [
          each.agent === null
            ? refusalWords(each.why, state)
            : `Not installed for ${name(each.agent)}. ${refusalWords(each.why, state)}`,
        ]
      : [],
  );
  const done = installed.length > 0 ? [`Installed the overview skill for ${list(installed)}.`] : [];
  return [...done, ...refused].join(' ');
}

/** Whether an install was refused for any agent. */
export function anyRefused(results: readonly SkillResult[]): boolean {
  return results.some((each) => each.kind === 'refused');
}
