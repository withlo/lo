// The overview skill as the window knows it: where it stands for each agent, and installing it from
// Settings, the welcome screen or the app menu alike; and the command that installs it from a
// terminal, which Settings shows and copies.

import { createStore } from 'zustand/vanilla';

import { notify } from '../../../window/commands/notices.tsx';
import type { Agent, SkillResult, SkillState } from '../contract.ts';
import { main, tabs } from './main.ts';
import { agentsToInstall, resultWords } from './words.ts';

/** The checker Lo builds in, `@withlo/overview@<version>`, as electron.vite.config.ts reads it. */
declare const LO_OVERVIEW_CHECKER: string;

/** What the notice and the command are called. */
export const TITLE = 'Install overview skill';

/**
 * The command that installs the skill from a terminal: the checker by the exact version the skill
 * Lo installs runs, so the skill it installs is the one Lo does.
 */
export const INSTALL_COMMAND = `npx ${LO_OVERVIEW_CHECKER} install`;

export interface SkillStore {
  /** Where the skill stands for each agent, once main has said. */
  readonly state: SkillState | undefined;
  /** Whether it's being installed. */
  readonly installing: boolean;
  /** What went wrong when main couldn't be asked to install it, until the next install. */
  readonly said: string | undefined;
  /** Whether the install command was copied a moment ago: not since Settings' row appeared. */
  readonly copied: boolean;
}

export const skillStore = createStore<SkillStore>()(() => ({
  state: undefined,
  installing: false,
  said: undefined,
  copied: false,
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
 * Installs the skill for `only`, the agents a row names, or else for the agents that lack it, or
 * again for those that are set up, and says how it went in a notice. Where the skill stands then,
 * and what stops it where it does, are the rows' to say. Resolves with what main did, or nothing
 * when it couldn't be asked.
 */
export async function installSkill(
  only?: readonly Agent[],
): Promise<readonly SkillResult[] | undefined> {
  if (skillStore.getState().installing) return undefined;
  skillStore.setState({ installing: true, said: undefined });
  let said: string;
  let results: readonly SkillResult[] | undefined;
  try {
    // Asked just now, so the choice is made of where things stand and not of when the window looked.
    const before = await main().currentSkill();
    results = await main().installSkill({ agents: [...(only ?? agentsToInstall(before))] });
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

/** What the notice for copying the command is called. */
export const COPY_TITLE = 'Copy the install command';

/** How long the button says "Copied" after a copy, in ms. */
export const COPIED_FOR = 3000;

let forgetting: ReturnType<typeof setTimeout> | undefined;

/**
 * Puts the command that installs the skill from a terminal on the clipboard, as `yc` does, and says
 * so for a few seconds, each time. When it can't, says that in a notice.
 */
export async function copyInstallCommand(): Promise<void> {
  let copied = true;
  try {
    await tabs().copy({ text: INSTALL_COMMAND });
  } catch (error) {
    console.error("Lo couldn't copy the command that installs the overview skill:", error);
    notify(COPY_TITLE, "Lo couldn't copy the command.");
    copied = false;
  }
  clearTimeout(forgetting);
  skillStore.setState({ copied });
  if (copied) forgetting = setTimeout(() => skillStore.setState({ copied: false }), COPIED_FOR);
}
