// What the update toasts, Settings and the commands ask of main, in one place so a button and its
// command do the same. Each says why in a note when it can't, since a toast's button that did
// nothing would leave the reader guessing: what failed, or, where main refused, why alone. Nothing
// here installs or restarts unless asked to: each runs only from a press or a command.

import { IpcError } from '../../../ipc/contract.ts';
import { announce, notify, refuse } from '../../../window/commands/notices.tsx';
import { client, type Client } from '../../../window/ipc.ts';
import { contract as tabs } from '../../tab/contract.ts';
import {
  BREW_UPGRADE,
  contract,
  releasePage,
  RELEASES,
  type CheckAnswer,
  type Failure,
  type UpdateState,
} from '../contract.ts';
import { setChecking, showHow, showState, updatesStore } from './store.ts';
import { checkBlocked, checkFailedTitle, failureReason, failureWay } from './words.ts';

let connected: Client<typeof contract> | undefined;

/** The feature's client, made when it's first needed, once the window's bridge is there. */
export function main(): Client<typeof contract> {
  connected ??= client(contract);
  return connected;
}

/** What main or the system said went wrong, as it came, for Details. */
function said(error: unknown): string | undefined {
  return error instanceof Error ? error.message : undefined;
}

/**
 * Runs `request`, and says why it didn't happen: main's reason alone, where main refused it as not
 * applying now, or else `title`, what failed, with main's words behind Details. Run from a toast
 * that has gone, or from the menu, nothing in view holds the failure, so a note does.
 */
async function asking(title: string, request: () => Promise<void>): Promise<void> {
  try {
    await request();
  } catch (error) {
    console.error(`${title}:`, error);
    if (error instanceof IpcError && error.code === 'unavailable') refuse(error.message);
    else notify(title, '', { details: said(error), tone: 'danger' });
  }
}

/**
 * What a check that failed leaves the reader to do, as a note's or a row's button: try again, or
 * open Lo's page on GitHub, where a copy that doesn't check gets a newer one.
 */
export function checkWay(
  why: Failure,
  from: 'command' | 'settings',
): { label: string; onClick: () => void } | undefined {
  const way = failureWay(why);
  if (way === 'again') return { label: 'Try again', onClick: () => void check(from) };
  if (way === 'github') return { label: 'Open on GitHub', onClick: () => void openPage(RELEASES) };
  return undefined;
}

/**
 * Says what a check asked for found. A newer Lo, one downloading and one ready are toasts of their
 * own, which main's `state` brings, so they get no note.
 */
function tell(answer: CheckAnswer): void {
  switch (answer.status) {
    case 'newest':
      announce('No update available');
      return;
    case 'failed':
      // A copy that doesn't check is blocked, not failed: a warning, with the way on.
      notify(checkFailedTitle(answer.why), failureReason(answer.why) ?? '', {
        action: checkWay(answer.why, 'command'),
        details: answer.details,
        tone: checkBlocked(answer.why) ? 'warning' : 'danger',
      });
      return;
    case 'available':
    case 'downloading':
    case 'ready':
      return;
    default:
      throw new Error(
        `A check’s answer Lo doesn’t know: ${JSON.stringify(answer satisfies never)}`,
      );
  }
}

/**
 * Asks main how this copy of Lo takes a newer version, which it decides again each time. With
 * nothing on offer that's what says whether Lo can be moved to Applications.
 */
export function readHow(): Promise<void> {
  return main()
    .how()
    .then(showHow)
    .catch((error: unknown) => console.error("Lo couldn't read how it updates:", error));
}

/**
 * Checks GitHub Releases now, whether or not Lo checks by itself, and says what it found: in a note
 * when a command asked, and on its row when Settings did, which keeps when it answered and why it
 * failed. A failure is said once: a check a command asked for that fails is the note's alone, with
 * the way on, which for a copy of Lo that doesn't check is Lo's page on GitHub. A check already
 * going is the one that answers: asking again meanwhile does nothing more.
 */
export async function check(from: 'command' | 'settings' = 'command'): Promise<void> {
  if (updatesStore.getState().checking) return;
  setChecking(true);
  updatesStore.setState({ failed: undefined });
  try {
    const answer = await main().check();
    if (answer.status !== 'failed') {
      updatesStore.setState({ checkedAt: Date.now(), failed: undefined });
    } else if (from === 'settings') {
      updatesStore.setState({
        failed:
          answer.details === undefined
            ? { why: answer.why }
            : { why: answer.why, details: answer.details },
      });
    }
    if (from === 'command') tell(answer);
  } catch (error) {
    console.error("Lo couldn't check for updates:", error);
    const details = said(error);
    const failed =
      details === undefined ? { why: 'unknown' as const } : { why: 'unknown' as const, details };
    if (from === 'settings') updatesStore.setState({ failed });
    else tell({ status: 'failed', ...failed });
  } finally {
    setChecking(false);
    // Lo may have been moved since it last said, and the answer may have taken an offer back.
    void readHow();
  }
}

/**
 * Takes in where updates stand, as main says. A download that failed says why on the offer, whose
 * button then tries again, in its toast and in Settings.
 */
export function hear(state: UpdateState): void {
  const before = updatesStore.getState().state;
  showState(state);
  // With nothing on offer, how Lo takes an update isn't in the state.
  if (state.status === 'idle' && before.status !== 'idle') void readHow();
}

/** Downloads the update on offer, to install as Lo quits. */
export function install(): Promise<void> {
  return asking('Couldn’t update Lo', () => main().install());
}

/** Quits Lo, installs the update that's ready and starts Lo again. */
export function restart(): Promise<void> {
  return asking('Couldn’t restart Lo', () => main().restart());
}

/** Moves Lo to Applications, where it can update itself, and starts it again from there. */
export function move(): Promise<void> {
  return asking('Couldn’t move Lo to Applications', () => main().move());
}

/** Hides the update on offer until Lo starts again. */
export function later(): Promise<void> {
  return asking('Couldn’t hide the update', () => main().later());
}

/**
 * Opens one of Lo's pages on GitHub, which `page` is: a release's, which main built from its
 * version, or the list of them.
 */
export async function openPage(page: string): Promise<void> {
  try {
    await client(tabs).openExternal({ url: page });
  } catch (error) {
    console.error("Lo couldn't open the update's page:", error);
    notify('Couldn’t open the update’s page', '', { details: said(error), tone: 'danger' });
  }
}

/** Puts the command that updates Lo through Homebrew on the clipboard. Resolves whether it did. */
export async function copyBrewCommand(): Promise<boolean> {
  try {
    await client(tabs).copy({ text: BREW_UPGRADE });
    return true;
  } catch (error) {
    console.error("Lo couldn't copy the command:", error);
    notify('Couldn’t copy the Homebrew command', '', { details: said(error), tone: 'danger' });
    return false;
  }
}

/** The page of the release of the update on offer, downloading or ready, if there is one. */
export function pageOfUpdate(state: UpdateState): string | undefined {
  switch (state.status) {
    case 'idle':
      return undefined;
    case 'available':
      return state.page;
    case 'downloading':
    case 'ready':
      return releasePage(state.version);
    default:
      throw new Error(`An update state Lo doesn’t know: ${JSON.stringify(state satisfies never)}`);
  }
}

/**
 * Opens the page of the release of the update now, for What's new and Download; with none on
 * offer, the list of Lo's releases, newest first.
 */
export async function openUpdatePage(): Promise<void> {
  await openPage(pageOfUpdate(updatesStore.getState().state) ?? RELEASES);
}

/**
 * Puts the toast's first button in focus, which `Tab` then moves from, or, while the toast steps
 * aside for Settings › About, the offer's main button there (its filled one), or its first while it
 * has none, as while the update downloads. The toast never does.
 */
export function goToToast(): void {
  const first =
    document.querySelector<HTMLElement>('[data-lo-scope="toasts"] button') ??
    document.querySelector<HTMLElement>('[data-lo-offer] button[data-fill]') ??
    document.querySelector<HTMLElement>('[data-lo-offer] button');
  first?.focus();
}
