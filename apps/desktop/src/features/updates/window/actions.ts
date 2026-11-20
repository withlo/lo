// What the update toasts, Settings and the commands ask of main, in one place so a button and its
// command do the same. Each says why in a note when it can't, since a toast's button that did
// nothing would leave the reader guessing. Nothing here installs or restarts unless asked to: each
// runs only from a press or a command.

import { IpcError } from '../../../ipc/contract.ts';
import { announce, notify } from '../../../window/commands/notices.tsx';
import { client, type Client } from '../../../window/ipc.ts';
import { contract as tabs } from '../../tab/contract.ts';
import { BREW_UPGRADE, contract, type CheckAnswer } from '../contract.ts';
import { setChecking, updatesStore } from './store.ts';

let connected: Client<typeof contract> | undefined;

/** The feature's client, made when it's first needed, once the window's bridge is there. */
export function main(): Client<typeof contract> {
  connected ??= client(contract);
  return connected;
}

/** What went wrong asking main, in words to show. */
function whyNot(error: unknown): string {
  return error instanceof IpcError ? error.message : 'Lo couldn’t ask for it. Try again.';
}

/** Runs `request`, and says why it didn't happen in a note titled `title`. */
async function asking(title: string, request: () => Promise<void>): Promise<void> {
  try {
    await request();
  } catch (error) {
    notify(title, whyNot(error));
  }
}

/**
 * Says what a check asked for found. A newer Lo, one downloading and one ready are toasts of their
 * own, which main's `state` brings, so they get no note.
 */
function tell(answer: CheckAnswer): void {
  switch (answer.status) {
    case 'newest':
      announce(`Lo ${answer.version} is the newest version.`);
      return;
    case 'failed':
      notify('Lo couldn’t check for updates', answer.reason);
      return;
    case 'available':
    case 'downloading':
    case 'ready':
      return;
    default:
      throw new Error(
        `A check's answer Lo doesn't know: ${JSON.stringify(answer satisfies never)}`,
      );
  }
}

/**
 * Checks GitHub Releases now, whether or not Lo checks by itself, and says what it found. A check
 * already going is the one that answers: asking again meanwhile does nothing more.
 */
export async function check(): Promise<void> {
  if (updatesStore.getState().checking) return;
  setChecking(true);
  try {
    tell(await main().check());
  } catch (error) {
    notify('Lo couldn’t check for updates', whyNot(error));
  } finally {
    setChecking(false);
  }
}

/** Downloads the update on offer, to install as Lo quits. */
export function install(): Promise<void> {
  return asking('Lo couldn’t install the update', () => main().install());
}

/** Quits Lo, installs the update that's ready and starts Lo again. */
export function restart(): Promise<void> {
  return asking('Lo couldn’t restart to update', () => main().restart());
}

/** Moves Lo to Applications, where it can update itself, and starts it again from there. */
export function move(): Promise<void> {
  return asking('Lo couldn’t move to Applications', () => main().move());
}

/** Hides the update on offer until Lo starts again. */
export function later(): Promise<void> {
  return asking('Lo couldn’t hide the update', () => main().later());
}

/** Opens a release's page, which `page` is: main built it from the release's version. */
export async function openPage(page: string): Promise<void> {
  try {
    await client(tabs).openExternal({ url: page });
  } catch (error) {
    console.error("Lo couldn't open the release page:", error);
    notify('Open the release page', 'Lo couldn’t open it.');
  }
}

/** Puts the command that updates Lo through Homebrew on the clipboard. Resolves whether it did. */
export async function copyBrewCommand(): Promise<boolean> {
  try {
    await client(tabs).copy({ text: BREW_UPGRADE });
    return true;
  } catch (error) {
    console.error("Lo couldn't copy the command:", error);
    notify('Copy the command', 'Lo couldn’t copy it.');
    return false;
  }
}
