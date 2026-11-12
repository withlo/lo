// The overview skill as the window knows it: where it stands for each agent, and installing it from
// Settings, the welcome screen or the app menu alike.

import { createStore } from 'zustand/vanilla';

import { notify } from '../../../window/commands/notices.tsx';
import type { SkillResult, SkillState } from '../contract.ts';
import { main } from './main.ts';
import { agentsToInstall, resultWords } from './words.ts';

/** What the notice and the command are called. */
export const TITLE = 'Install overview skill';

export interface SkillStore {
  /** Where the skill stands for each agent, once main has said. */
  readonly state: SkillState | undefined;
  /** Whether it's being installed. */
  readonly installing: boolean;
  /** What went wrong when main couldn't be asked to install it, until the next install. */
  readonly said: string | undefined;
}

export const skillStore = createStore<SkillStore>()(() => ({
  state: undefined,
  installing: false,
  said: undefined,
}));

/** How many times main has pushed where the skill stands. */
let pushes = 0;

/**
 * Asks main where the skill stands. What main pushed while it was being asked is newer than the
 * answer, which it gave from before, so the answer is dropped then.
 */
export async function checkSkill(): Promise<void> {
  const asked = pushes;
  try {
    const state = await main().currentSkill();
    if (pushes === asked) skillStore.setState({ state });
  } catch (error) {
    console.error("Lo couldn't find out where the overview skill is:", error);
  }
}

/** Takes where the skill stands each time main says it changed. Returns a way to stop. */
export function followSkill(): () => void {
  return main().subscribe('skill', (state) => {
    pushes++;
    skillStore.setState({ state });
  });
}

/**
 * Installs the skill for the agents that lack it, else again for those that are set up, and says
 * how it went in a notice. Where the skill stands then, and what stops it where it does, are
 * Settings' row's to say. Resolves with what main did, or nothing when it couldn't be asked.
 */
export async function installSkill(): Promise<readonly SkillResult[] | undefined> {
  if (skillStore.getState().installing) return undefined;
  skillStore.setState({ installing: true, said: undefined });
  let said: string;
  let results: readonly SkillResult[] | undefined;
  try {
    // Asked just now, so the choice is made of where things stand and not of when the window looked.
    const before = await main().currentSkill();
    results = await main().installSkill({ agents: agentsToInstall(before) });
    said = resultWords(results, before);
  } catch (error) {
    console.error("Lo couldn't install the overview skill:", error);
    said = "Lo couldn't install the overview skill.";
    skillStore.setState({ said });
  }
  // Still installing while the window learns where things stand, so no button offers what it was.
  await checkSkill();
  skillStore.setState({ installing: false });
  notify(TITLE, said);
  return results;
}
