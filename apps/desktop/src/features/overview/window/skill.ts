// The overview skill as the window knows it: where it stands for each agent, and installing it from
// Settings, the welcome screen or the app menu alike; and the command that installs it from a
// terminal, which Settings shows and copies.

import { COPIED_MS, type CopySaid } from '@lo/ui';
import { createStore } from 'zustand/vanilla';

import { menuStale } from '../../../window/commands/bar.ts';
import { announce, fail, notify, refuse } from '../../../window/commands/notices.tsx';
import type { Agent, SkillResult, SkillState } from '../contract.ts';
import { main, tabs } from './main.ts';
import { agentsToInstall, notSetUp, refusalWords } from './words.ts';

/** The checker Lo builds in, `@withlo/overview@<version>`, as electron.vite.config.ts reads it. */
declare const LO_OVERVIEW_CHECKER: string;

/** What an install that failed says, in a note or on the row that asked. */
export const FAILED = 'Couldn’t install the overview skill';

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
  /**
   * Main couldn't be asked to install it when a row asked: the error's words, which the row gives
   * behind Details, until the next install.
   */
  readonly failed: string | undefined;
  /**
   * How the last copy of the install command went, a moment ago, for its button to say: not since
   * Settings' row appeared.
   */
  readonly copied: CopySaid | undefined;
}

export const skillStore = createStore<SkillStore>()(() => ({
  state: undefined,
  installing: false,
  failed: undefined,
  copied: undefined,
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

/**
 * Takes where the skill stands each time main says it changed, and has the app menu made again
 * when that changes whether it can be installed. Returns a way to stop.
 */
export function followSkill(): () => void {
  let was = installable();
  const unwatch = skillStore.subscribe(() => {
    const now = installable();
    if (now === was) return;
    was = now;
    menuStale();
  });
  const stop = main().subscribe('skill', (state) => {
    pushes++;
    skillStore.setState({ state });
  });
  return () => {
    unwatch();
    stop();
  };
}

/**
 * Why the command can't install the skill now, which dims it, or `true`: while it's being
 * installed. Whether an agent is set up it asks main as it runs, since the folders change outside
 * Lo and the window looks at them only while a row shows. The rows dim their buttons on that too.
 */
export function installable(): true | string {
  return skillStore.getState().installing ? 'Installing…' : true;
}

/**
 * Installs the skill for `only`, the agents a row names, or else for the agents that lack it, or
 * again for those that are set up, and says how it went once: on the row when a row asked (`row`),
 * and in a note when a command did, with nothing in view. Where the skill stands then, and what
 * stops it where it does, are the rows' to say. While no agent is set up, the rows' buttons are
 * dimmed with why; the command asked then says the reason alone. Resolves with what main did, or
 * nothing when it couldn't be asked.
 */
export async function installSkill(
  only?: readonly Agent[],
  from: 'command' | 'row' = 'command',
): Promise<readonly SkillResult[] | undefined> {
  if (skillStore.getState().installing) return undefined;
  skillStore.setState({ installing: true, failed: undefined });
  let tell: (() => void) | undefined;
  let results: readonly SkillResult[] | undefined;
  try {
    // Asked just now, so the choice is made of where things stand and not of when the window looked.
    const before = await main().currentSkill();
    const done = await main().installSkill({ agents: [...(only ?? agentsToInstall(before))] });
    results = done;
    const none = done.find((each) => each.kind === 'refused' && each.agent === null);
    const refused = done.find((each) => each.kind === 'refused');
    if (none?.kind === 'refused') {
      const why = notSetUp(before) ?? refusalWords(none.why, before);
      tell = () => refuse(why);
    } else if (from === 'command') {
      tell =
        refused?.kind === 'refused'
          ? () => notify(FAILED, refusalWords(refused.why, before))
          : () => announce('Installed overview skill');
    }
  } catch (error) {
    console.error("Lo couldn't install the overview skill:", error);
    const details = error instanceof Error ? error.message : String(error);
    if (from === 'row') skillStore.setState({ failed: details });
    else tell = () => notify(FAILED, '', { details });
  }
  // Still installing while the window learns where things stand, so no button offers what it was.
  await checkSkill();
  skillStore.setState({ installing: false });
  tell?.();
  return results;
}

/** How long the button says "Copied" or "Couldn’t copy" after a copy, in ms. */
export const COPIED_FOR = COPIED_MS;

let forgetting: ReturnType<typeof setTimeout> | undefined;

/** How many of Settings' rows with the install command's Copy button are drawn. */
let buttons = 0;

/**
 * Says that Settings' row with the install command's Copy button is drawn, so a copy says how it
 * went on the button. Returns a function to call when the row goes.
 */
export function drawCopyButton(): () => void {
  buttons += 1;
  return () => {
    buttons -= 1;
  };
}

/**
 * Puts the command that installs the skill from a terminal on the clipboard, as `yc` does, and says
 * how that went, each time: on Settings' Copy button while its row is drawn, which reads "Copied"
 * or "Couldn’t copy" for a moment, and otherwise in a note, as for `yc` while a search hides it.
 */
export async function copyInstallCommand(): Promise<void> {
  let failed: string | undefined;
  try {
    await tabs().copy({ text: INSTALL_COMMAND });
  } catch (error) {
    console.error("Lo couldn't copy the command that installs the overview skill:", error);
    failed = error instanceof Error ? error.message : String(error);
  }
  if (buttons === 0) {
    if (failed === undefined) announce('Copied install command');
    else fail('Couldn’t copy the command', failed);
    return;
  }
  clearTimeout(forgetting);
  skillStore.setState({ copied: failed === undefined ? 'copied' : 'failed' });
  forgetting = setTimeout(() => skillStore.setState({ copied: undefined }), COPIED_FOR);
}
