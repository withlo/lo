// The overview skill on this computer, for the coding agents Lo installs it for: where each keeps
// its skills, whether it's set up and has the skill, and installing it. The installer is the
// checker's own (`@withlo/overview/install`), so the skill Lo installs is the one the checker does.
//
// Everything is read from the environment main has. A Lo opened from the Dock doesn't have the
// variables a shell sets, such as `CLAUDE_CONFIG_DIR`, so what's found is only where Lo looked, and
// the window says which folders those were.

import { homedir } from 'node:os';

import {
  agentFolders,
  AGENT_NAMES,
  AGENTS,
  install,
  installedIn,
  InstallError,
  isSetUp,
  type Agent,
  type InstallReason,
} from '@withlo/overview/install';

import type { SkillRefusal, SkillResult, SkillState } from '../contract.ts';

/** `path` as a person writes it: `~` for the home folder, when it's in it. */
export function shown(path: string, home: string = homedir()): string {
  if (path === home) return '~';
  return path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}

/** Where the skill goes for each agent, and what's there, in the environment `env`. */
export function skillState(env: NodeJS.ProcessEnv): SkillState {
  return {
    agents: AGENTS.map((agent) => {
      const { skills, setUp } = agentFolders(agent, env);
      return {
        agent,
        name: AGENT_NAMES[agent],
        setUp: isSetUp(agent, env),
        installed: installedIn(skills),
        config: shown(setUp),
        skills: shown(skills),
      };
    }),
  };
}

/** The refusal `reason` gives, for the window to word. */
function refusal(reason: InstallReason): SkillRefusal {
  switch (reason.kind) {
    case 'nothingSetUp':
      return { kind: 'nothingSetUp' };
    case 'link':
    case 'notFolder':
    case 'notFile':
    case 'otherFiles':
      return { kind: reason.kind, path: reason.path };
    case 'otherSkill':
      return { kind: 'otherSkill', path: reason.path, name: reason.name ?? null };
    case 'failed':
      return { kind: 'failed', skills: reason.skills, detail: reason.detail };
    default:
      reason satisfies never;
      throw new Error(`Unknown reason ${JSON.stringify(reason)}`);
  }
}

/** Installs the skill for `agent`, and says how that went. */
function installFor(agent: Agent, env: NodeJS.ProcessEnv): SkillResult {
  try {
    install([{ agent, skills: agentFolders(agent, env).skills }]);
    return { kind: 'installed', agent };
  } catch (error) {
    if (!(error instanceof InstallError)) throw error;
    return { kind: 'refused', agent, why: refusal(error.reason) };
  }
}

/**
 * Installs the skill for `agents`, each on its own, so that an agent whose folder refuses it leaves
 * the others installed, and says how it went for each, in the order agents are installed for. With
 * none named, for each agent that's set up, or a refusal saying none is.
 */
export function installSkill(agents: readonly Agent[], env: NodeJS.ProcessEnv): SkillResult[] {
  const chosen = AGENTS.filter((agent) =>
    agents.length > 0 ? agents.includes(agent) : isSetUp(agent, env),
  );
  if (chosen.length === 0) return [{ kind: 'refused', agent: null, why: { kind: 'nothingSetUp' } }];
  return chosen.map((agent) => installFor(agent, env));
}
