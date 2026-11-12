// The overview skill as the window knows it: where it stands for each agent, and installing it from
// Settings, the welcome screen or the app menu alike.

import { createStore } from 'zustand/vanilla';

import { notify } from '../../../window/commands/notices.tsx';
import type { SkillResult, SkillState } from '../contract.ts';
import { main } from './main.ts';
import { agentsToInstall, anyRefused, resultWords } from './words.ts';

/** What the notice and the command are called. */
export const TITLE = 'Install overview skill';

export interface SkillStore {
  /** Where the skill stands for each agent, once main has said. */
  readonly state: SkillState | undefined;
  /** Whether it's being installed. */
  readonly installing: boolean;
  /** What the last install said, when it didn't go as asked. */
  readonly said: string | undefined;
}

export const skillStore = createStore<SkillStore>()(() => ({
  state: undefined,
  installing: false,
  said: undefined,
}));

/** Asks main where the skill stands. */
export async function checkSkill(): Promise<void> {
  try {
    skillStore.setState({ state: await main().currentSkill() });
  } catch (error) {
    console.error("Lo couldn't find out where the overview skill is:", error);
  }
}

/** Takes where the skill stands each time main says it changed. Returns a way to stop. */
export function followSkill(): () => void {
  return main().subscribe('skill', (state) => skillStore.setState({ state }));
}

/**
 * Installs the skill for the agents that lack it, else again for those that are set up, and says
 * how it went: in a notice, and in Settings' row when something was refused. Resolves with what
 * main did, or nothing when it couldn't be asked.
 */
export async function installSkill(): Promise<readonly SkillResult[] | undefined> {
  if (skillStore.getState().installing) return undefined;
  skillStore.setState({ installing: true, said: undefined });
  try {
    // Asked just now, so the choice is made of where things stand and not of when the window looked.
    const state = await main().currentSkill();
    const results = await main().installSkill({ agents: agentsToInstall(state) });
    const said = resultWords(results, state);
    skillStore.setState({ state, said: anyRefused(results) ? said : undefined });
    notify(TITLE, said);
    return results;
  } catch (error) {
    console.error("Lo couldn't install the overview skill:", error);
    const said = "Lo couldn't install the overview skill.";
    skillStore.setState({ said });
    notify(TITLE, said);
    return undefined;
  } finally {
    skillStore.setState({ installing: false });
    await checkSkill();
  }
}
