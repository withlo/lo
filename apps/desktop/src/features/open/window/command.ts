// The `lo` command, as the window knows it: where it's installed, and installing it, from the app
// menu, Settings or the welcome screen alike.

import { createStore } from 'zustand/vanilla';

import { notify } from '../../../window/commands/notices.tsx';
import type { CommandState, Installed } from '../contract.ts';
import { main } from './main.ts';

export interface CommandStore {
  /** Where `lo` is, once main has said. */
  readonly state: CommandState | undefined;
  /** Whether it's being installed. */
  readonly installing: boolean;
  /** What the last install said. */
  readonly said: string | undefined;
}

export const commandStore = createStore<CommandStore>()(() => ({
  state: undefined,
  installing: false,
  said: undefined,
}));

/** Asks main where `lo` is. */
export async function checkCommand(): Promise<void> {
  try {
    commandStore.setState({ state: await main().command() });
  } catch (error) {
    console.error("Lo couldn't find out where the lo command is:", error);
  }
}

/** What an install did, in words for the person. */
export function installedWords(done: Installed): string {
  switch (done.kind) {
    case 'installed':
      return done.onPath
        ? `Installed ${done.path}. Review a pull request from a terminal with lo <link>.`
        : `Installed ${done.path}. Add ${done.path.slice(0, done.path.lastIndexOf('/'))} to your PATH if your shell doesn't find lo.`;
    case 'taken':
      return `There's already a ${done.path} that Lo didn't write, so Lo left it as it is.`;
    case 'failed':
      return done.message;
    default:
      done satisfies never;
      return "Lo couldn't install the lo command.";
  }
}

/**
 * Installs `lo`, asking for an administrator on macOS, and says how it went: in a notice, and
 * wherever the command's state shows. Resolves with what main did, or nothing when it couldn't be
 * asked.
 */
export async function installCommand(): Promise<Installed | undefined> {
  if (commandStore.getState().installing) return undefined;
  commandStore.setState({ installing: true, said: undefined });
  try {
    const done = await main().installCommand();
    const said = installedWords(done);
    commandStore.setState({ said });
    notify('Install command-line tool', said);
    return done;
  } catch (error) {
    console.error("Lo couldn't install the lo command:", error);
    const said = "Lo couldn't install the lo command.";
    commandStore.setState({ said });
    notify('Install command-line tool', said);
    return undefined;
  } finally {
    commandStore.setState({ installing: false });
    await checkCommand();
  }
}
