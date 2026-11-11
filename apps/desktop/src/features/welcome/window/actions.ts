// What the welcome screen's controls do: sign in, look for git again, copy a rule, and what `⏎`
// does with the control that has focus.

import { notify } from '../../../window/commands/notices.tsx';
import { client } from '../../../window/ipc.ts';
import { contract as accounts } from '../../accounts/contract.ts';
import { signIn } from '../../accounts/window/shared.ts';
import { openLink } from '../../open/window/shared.ts';
import { contract as tabs } from '../../tab/contract.ts';
import { DOCS } from './routers.ts';
import { main } from './main.ts';
import { welcomeStore } from './store.ts';

/** The screen's element while it's on screen, which `⏎` looks inside for the control to press. */
let screen: HTMLElement | undefined;

/** Says where the screen is, or that it's gone. */
export function setScreen(element: HTMLElement | undefined): void {
  screen = element;
}

/**
 * `⏎` on the welcome screen: the control with focus does what it says, a button by being pressed
 * and the link field by opening its link, and with focus anywhere else on the screen it signs in.
 */
export function enter(): void {
  const focused = document.activeElement;
  if (screen?.contains(focused ?? null) && focused instanceof HTMLElement) {
    // The default control, the sign-in button, is marked `data-welcome-default`: `⏎` signs in.
    if (!focused.hasAttribute('data-welcome-default')) {
      if (focused instanceof HTMLButtonElement) {
        focused.click();
        return;
      }
      if (focused instanceof HTMLInputElement && focused.form !== null) {
        focused.form.requestSubmit();
        return;
      }
    }
  }
  signIn();
}

/** Asks gh what it has to import, so the screen can offer it when there is a gh. */
export async function loadGh(): Promise<void> {
  try {
    welcomeStore.setState({ gh: await client(accounts).ghAccounts() });
  } catch (error) {
    console.error("Lo couldn't ask what gh has to import:", error);
    welcomeStore.setState({ gh: undefined });
  }
}

/** Looks for git again, for a git installed since, and says when the look is over. */
export async function checkGit(): Promise<void> {
  if (welcomeStore.getState().checking) return;
  welcomeStore.setState({ checking: true, checked: false });
  try {
    await main().checkGit();
    welcomeStore.setState({ checked: true });
  } catch (error) {
    console.error("Lo couldn't look for git:", error);
    notify('Check again', "Lo couldn't look for git.");
  } finally {
    welcomeStore.setState({ checking: false });
  }
}

/**
 * Copies a router's rule through main. Resolves whether it did: the dialog says so itself, since a
 * note at the foot of the window sits under the dialog.
 */
export async function copyRule(name: string, rule: string): Promise<boolean> {
  try {
    await client(tabs).copy({ text: rule });
    return true;
  } catch (error) {
    console.error(`Lo couldn't copy the rule for ${name}:`, error);
    return false;
  }
}

/** Opens the page that writes the rules out. */
export async function openDocs(): Promise<void> {
  try {
    await client(tabs).openExternal({ url: DOCS });
  } catch (error) {
    console.error("Lo couldn't open the docs:", error);
    notify('Send PR links to Lo', "Lo couldn't open the docs.");
  }
}

/**
 * Opens the pull request link typed or pasted in the screen's field, through the open feature, and
 * says why it didn't when it can't. Resolves with the reason, or nothing when it opened.
 */
export async function openPublic(text: string): Promise<string | undefined> {
  const done = await openLink(text.trim());
  if (done === undefined) return "Lo couldn't open the link.";
  return done.kind === 'refused' ? done.message : undefined;
}
