// What the welcome does: opening and leaving, walking its steps, signing in, choosing keys,
// looking for Git again, opening a pull request, and what `⏎` does with the control that has focus.

import { onVim, vimOn } from '@lo/ui/code';
import { NO_TARGET } from '@lo/ui/commands';

import { registry } from '../../../window/commands/registry.ts';
import { client } from '../../../window/ipc.ts';
import { contract as accounts } from '../../accounts/contract.ts';
import { openLink } from '../../open/window/shared.ts';
import { contract as tabs } from '../../tab/contract.ts';
import { activeTab } from '../../tab/window/shared.ts';
import { DOCS } from './routers.ts';
import { main } from './main.ts';
import { stepFrom, welcomeStore, type Step } from './store.ts';

/** The welcome's element while it's on screen, which `⏎` looks inside for the control to press. */
let screen: HTMLElement | undefined;

/** Says where the welcome is, or that it's gone. */
export function setScreen(element: HTMLElement | undefined): void {
  screen = element;
}

/**
 * `⏎` in the welcome: the control with focus does what it says, a button or a card by being
 * pressed and the link field, once it holds something, by opening its link. With focus anywhere
 * else, the empty link field included, the step's main button is pressed, the one marked
 * `data-welcome-default`. A field outside a form, the practice's comment box, keeps `⏎` to itself.
 */
export function enter(): void {
  const focused = document.activeElement;
  if (screen?.contains(focused ?? null)) {
    if (focused instanceof HTMLButtonElement) {
      focused.click();
      return;
    }
    if (focused instanceof HTMLInputElement) {
      if (focused.form === null) return;
      if (focused.value.trim() !== '') {
        focused.form.requestSubmit();
        return;
      }
    }
  }
  screen?.querySelector<HTMLButtonElement>('[data-welcome-default]')?.click();
}

/** Asks main whether the reader has finished the welcome before, once as the window starts. */
export async function loadState(): Promise<void> {
  try {
    const { finished } = await main().state();
    // Finished since, in this window, is newer than the answer.
    if (welcomeStore.getState().finished === undefined) welcomeStore.setState({ finished });
  } catch (error) {
    console.error("Lo couldn't ask whether the welcome was finished:", error);
    // Not knowing, Lo doesn't put it in the way.
    welcomeStore.setState({ finished: true });
  }
}

/**
 * Opens the welcome by itself, over the Recent tab, at its first step: for a reader who hasn't
 * finished it and has no account signed in.
 */
export function openFirst(): void {
  if (welcomeStore.getState().open) return;
  welcomeStore.setState({ open: true, over: undefined, step: 'account' });
}

/**
 * Opens the welcome because the reader asked, over the tab on screen, at its first step. Each step
 * shows how it stands now.
 */
export function show(): void {
  const tab = activeTab();
  welcomeStore.setState({
    open: true,
    over: tab === undefined || tab.kind === 'recent' ? undefined : tab.id,
    step: 'account',
  });
}

/**
 * Leaves the welcome, as "Skip" and "Done" do and a pull request opened from it does, and keeps
 * that the reader finished it, so it doesn't open by itself again.
 */
export function leave(): void {
  welcomeStore.setState({ open: false, over: undefined, step: 'account', finished: true });
  main()
    .finish()
    .catch((error: unknown) => {
      console.error("Lo couldn't keep that the welcome was finished:", error);
    });
}

/** Shows `step`. */
export function goTo(step: Step): void {
  welcomeStore.setState({ step });
}

/** "Continue": the next step, and from the last, "Done", out of the welcome. */
export function next(): void {
  const after = stepFrom(welcomeStore.getState().step, 1);
  if (after === undefined) leave();
  else goTo(after);
}

/** "Back": the step before. */
export function back(): void {
  const before = stepFrom(welcomeStore.getState().step, -1);
  if (before !== undefined) goTo(before);
}

/** Asks GitHub CLI what it has to import, so the first step can offer it when there is one. */
export async function loadGh(): Promise<void> {
  try {
    welcomeStore.setState({ gh: await client(accounts).ghAccounts() });
  } catch (error) {
    console.error("Lo couldn't ask what GitHub CLI has to import:", error);
    welcomeStore.setState({ gh: undefined });
  }
}

/** Looks for Git again, for a Git installed since, and says by the button when it couldn't look. */
export async function checkGit(): Promise<void> {
  if (welcomeStore.getState().checking) return;
  welcomeStore.setState({ checking: true, checkFailed: false });
  let failed = false;
  try {
    await main().checkGit();
  } catch (error) {
    console.error("Lo couldn't look for Git:", error);
    failed = true;
  }
  welcomeStore.setState((state) => ({
    checking: false,
    checkFailed: failed,
    checks: state.checks + 1,
  }));
}

/** Whether a choice of keys is on its way to the settings file, so a second press waits for it. */
let switching = false;

/**
 * Chooses the keys code and comment boxes are edited with: Vim's, or the standard ones. It's the
 * `editor.vim` setting, switched as "Vim keys" in the command palette switches it.
 */
export function chooseVim(on: boolean): void {
  if (switching || vimOn() === on) return;
  switching = true;
  const settled = onVim(() => {
    switching = false;
    settled();
  });
  // Refused, or never answered, the next press asks again.
  if (registry().run('comments.vim', NO_TARGET) !== true) {
    switching = false;
    settled();
  }
}

/** Opens the page that writes the rules out, and resolves whether it did. */
export async function openDocs(): Promise<boolean> {
  try {
    await client(tabs).openExternal({ url: DOCS });
    return true;
  } catch (error) {
    console.error("Lo couldn't open the documentation:", error);
    return false;
  }
}

/** What the link field says when a link didn't open and nothing says why. */
export const NOT_OPENED = 'Couldn’t open the link';

/**
 * Opens the pull request link typed or pasted in the last step's field, or the sample's, through
 * the open feature. Resolves with why it didn't, or nothing when it opened. A pull request's tab
 * leaves the welcome, since the tab is what shows next; a link that went to the browser doesn't.
 */
export async function openPublic(text: string): Promise<string | undefined> {
  const done = await openLink(text.trim());
  if (done === undefined) return NOT_OPENED;
  if (done.kind === 'refused') return done.message;
  if (done.kind === 'tab') leave();
  return undefined;
}
