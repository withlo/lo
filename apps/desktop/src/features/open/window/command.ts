// The `lo` command, as the window knows it: where it's installed, and installing it, from the app
// menu, Settings or the welcome screen alike.

import { createStore } from 'zustand/vanilla';

import { announce, notify } from '../../../window/commands/notices.tsx';
import type { CommandState, Installed } from '../contract.ts';
import { main } from './main.ts';

export interface CommandStore {
  /** Where `lo` is, once main has said. */
  readonly state: CommandState | undefined;
  /** Whether it's being installed. */
  readonly installing: boolean;
  /**
   * What the last install a row asked for did, which the row shows; `undefined` when main couldn't
   * be asked, and `null` for nothing to show.
   */
  readonly done: Installed | null | undefined;
}

export const commandStore = createStore<CommandStore>()(() => ({
  state: undefined,
  installing: false,
  done: null,
}));

/** Asks main where `lo` is. */
export async function checkCommand(): Promise<void> {
  try {
    commandStore.setState({ state: await main().command() });
  } catch (error) {
    console.error("Lo couldn't find out where the lo command is:", error);
  }
}

/** What stopped an install, the title it fails under says. */
export const NOT_INSTALLED = 'Couldn’t install the `lo` command';

/** Why an install failed, with code between backticks, for one that main said didn't. */
export function notInstalledReason(done: Exclude<Installed, { kind: 'installed' }>): string {
  if (done.kind === 'taken') return 'Another `lo` file is already there.';
  return done.why === 'unreadable'
    ? 'The existing `lo` file can’t be read.'
    : 'The `lo` file can’t be written.';
}

/** The folder of `path`, which the shell must search to find `lo` there. */
export function folderOf(path: string): string {
  return path.slice(0, path.lastIndexOf('/'));
}

/**
 * Says how an install a command asked for went, in a note: there's no row in view to say it. A
 * failure keeps what main or the system said behind Details: the path, and why it failed.
 */
function tell(done: Installed | undefined, details?: string): void {
  if (done === undefined) {
    notify(NOT_INSTALLED, '', { details, tone: 'danger' });
  } else if (done.kind === 'installed') {
    announce(
      'Installed `lo` command',
      done.onPath ? '' : `Add \`${folderOf(done.path)}\` to \`PATH\`.`,
    );
  } else {
    notify(NOT_INSTALLED, notInstalledReason(done), {
      details: done.kind === 'taken' ? done.path : done.details,
      tone: 'danger',
    });
  }
}

/**
 * Installs `lo`, asking for an administrator on macOS, and says how it went once: on the row that
 * asked (`row`), which keeps what it did for the row to show, or in a notice when a command did.
 * Resolves with what main did, or nothing when it couldn't be asked.
 */
export async function installCommand(
  from: 'command' | 'row' = 'command',
): Promise<Installed | undefined> {
  if (commandStore.getState().installing) return undefined;
  commandStore.setState({ installing: true, done: null });
  try {
    const done = await main().installCommand();
    commandStore.setState({ done: from === 'row' ? done : null });
    if (from === 'command') tell(done);
    return done;
  } catch (error) {
    console.error("Lo couldn't install the lo command:", error);
    commandStore.setState({ done: from === 'row' ? undefined : null });
    if (from === 'command') tell(undefined, error instanceof Error ? error.message : undefined);
    return undefined;
  } finally {
    commandStore.setState({ installing: false });
    await checkCommand();
  }
}
