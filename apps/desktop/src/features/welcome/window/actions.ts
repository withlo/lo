// What the welcome does: opening and leaving, walking its steps, signing in, choosing keys,
// looking for Git again, opening a pull request, and what `⏎` does with the control that has focus.

import { vimOn } from '@lo/ui/code';

import { client } from '../../../window/ipc.ts';
import { contract as accounts } from '../../accounts/contract.ts';
import type { Refusal } from '../../open/contract.ts';
import { chooseVimKeys } from '../../comments/window/shared.ts';
import { openLink } from '../../open/window/shared.ts';
import { contract as tabs } from '../../tab/contract.ts';
import { activeTab } from '../../tab/window/shared.ts';
import { DOCS } from './routers.ts';
import { main } from './main.ts';
import { stepFrom, welcomeStore, type MarkMove, type Step } from './store.ts';

/** The welcome's element while it's on screen, which `⏎` looks inside for the control to press. */
let screen: HTMLElement | undefined;

/** Says where the welcome is, or that it's gone. */
export function setScreen(element: HTMLElement | undefined): void {
  screen = element;
}

/** The reader did something in the welcome, so an account signing in no longer closes it. */
export function touch(): void {
  if (!welcomeStore.getState().touched) welcomeStore.setState({ touched: true });
}

/**
 * `⏎` in the welcome: the control with focus does what it says, a button or a card by being
 * pressed and the link field, once it holds something, by opening its link. With focus anywhere
 * else, the empty link field included, the step's main button is pressed, the one marked
 * `data-welcome-default`. The practice's comment box keeps `⏎` to itself.
 */
export function enter(): void {
  touch();
  const focused = document.activeElement;
  if (screen?.contains(focused ?? null)) {
    // A comment box's keys are its own, buttons and all, as the registry has them there.
    if (focused?.closest('[data-lo-scope="box"]')) return;
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
  welcomeStore.setState({
    open: true,
    over: undefined,
    touched: false,
    step: 'account',
    played: [],
  });
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
    touched: true,
    step: 'account',
    played: [],
  });
}

/**
 * Leaves the welcome, as "Skip" and "Done" do and a pull request opened from it does, and keeps
 * that the reader finished it, so it doesn't open by itself again.
 */
export function leave(): void {
  welcomeStore.setState({
    open: false,
    over: undefined,
    touched: false,
    step: 'account',
    finished: true,
  });
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

/**
 * Looks for Git again, for a Git installed since, and says where the notice was when it couldn't
 * look, with main's words behind Details.
 */
export async function checkGit(): Promise<void> {
  if (welcomeStore.getState().checking) return;
  welcomeStore.setState({ checking: true });
  let failed: string | undefined;
  try {
    await main().checkGit();
  } catch (error) {
    console.error("Lo couldn't look for Git:", error);
    failed = error instanceof Error ? error.message : String(error);
  }
  welcomeStore.setState((state) => ({
    checking: false,
    checkFailed: failed,
    checks: state.checks + 1,
  }));
}

/** How many choices of keys are being written. */
let writing = 0;

/**
 * Chooses the keys code and comment boxes are edited with: Vim's, or the standard ones. It's the
 * `editor.vim` setting, as "Vim keys" in the command palette switches it. Each press writes its own
 * choice, so the last one stays, and the cards show it until every write has ended, landed or not.
 */
export async function chooseVim(on: boolean): Promise<void> {
  if (writing === 0 && vimOn() === on) return;
  writing += 1;
  welcomeStore.setState({ choosing: on });
  try {
    await chooseVimKeys(on);
  } finally {
    writing -= 1;
    // The setting has every choice there is, or said why it couldn't take one: the cards follow it.
    if (writing === 0) welcomeStore.setState({ choosing: undefined });
  }
}

/** Notes that the mark played `move` since the welcome opened: a step that shows again rests. */
export function markPlayed(move: MarkMove): void {
  const { played } = welcomeStore.getState();
  if (!played.includes(move)) welcomeStore.setState({ played: [...played, move] });
}

/** Opens the page that writes the rules out, and resolves with main's words when it didn't. */
export async function openDocs(): Promise<string | undefined> {
  try {
    await client(tabs).openExternal({ url: DOCS });
    return undefined;
  } catch (error) {
    console.error("Lo couldn't open the documentation:", error);
    return error instanceof Error ? error.message : String(error);
  }
}

/** Why the welcome's field opened nothing: main's refusal, where it gave one, and its reason. */
export interface NotOpened {
  readonly why: Refusal | undefined;
  /** The reason in words, with code between backticks; empty when nothing says why. */
  readonly message: string;
}

/**
 * Opens the pull request link typed or pasted in the last step's field, or the sample's, through
 * the open feature. Resolves with why it didn't, or nothing when it opened. A pull request's tab
 * leaves the welcome, since the tab is what shows next; a link that went to the browser doesn't.
 */
export async function openPublic(text: string): Promise<NotOpened | undefined> {
  const done = await openLink(text.trim());
  if (done === undefined) return { why: undefined, message: '' };
  if (done.kind === 'refused') return { why: done.why, message: done.message };
  if (done.kind === 'tab') leave();
  return undefined;
}
