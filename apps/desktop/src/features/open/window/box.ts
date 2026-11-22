// The open box: what's in it, what main said of it, and what `⏎` does. Main reads the link and
// looks it up; the window never reads the clipboard itself, and asks main for the pull request
// link on it, if there's one, as the box opens.

import { createStore } from 'zustand/vanilla';

import { IpcError } from '../../../ipc/contract.ts';
import { announce } from '../../../window/commands/notices.tsx';
import { client } from '../../../window/ipc.ts';
import { contract as accounts } from '../../accounts/contract.ts';
import { signIn } from '../../accounts/window/shared.ts';
import { contract as tabs } from '../../tab/contract.ts';
import type { Opened, Preview, Refusal } from '../contract.ts';
import { main } from './main.ts';
import {
  blockedWords,
  isNotPull,
  refusalReason,
  wayLabel,
  webWords,
  type BlockedWay,
} from './words.ts';

/**
 * Something the box was asked to do that failed, said under its field as an error: what failed, why
 * when that changes what the reader does, and main's own words behind Details. `retry` says `⏎`
 * looks the link up again.
 */
export interface BoxError {
  readonly title: string;
  readonly reason?: string | undefined;
  readonly details?: string | undefined;
  readonly retry?: boolean | undefined;
}

export interface BoxState {
  readonly open: boolean;
  readonly text: string;
  /** Whether the text is the link the clipboard held, as Lo filled it in. */
  readonly fromClipboard: boolean;
  /** What main said of `lookedAt`. */
  readonly preview: Preview | undefined;
  readonly lookedAt: string | undefined;
  /** Whether a link is opening. */
  readonly opening: boolean;
  /** Why the last try to open didn't, or to look the link up failed. */
  readonly error: BoxError | undefined;
  /** The account of the row the keys are on, among those that can open the pull request. */
  readonly highlighted: string | undefined;
}

const closed: BoxState = {
  open: false,
  text: '',
  fromClipboard: false,
  preview: undefined,
  lookedAt: undefined,
  opening: false,
  error: undefined,
  highlighted: undefined,
};

export const boxStore = createStore<BoxState>()(() => closed);

/** How long typing has to pause before Lo looks the link up. */
export const LOOK_AFTER = 200;

let timer: ReturnType<typeof setTimeout> | undefined;

/** Asks main what `text` is, unless it's changed by the time main answers. */
function lookUp(text: string): void {
  clearTimeout(timer);
  timer = undefined;
  if (text.trim() === '') {
    boxStore.setState({ preview: { kind: 'empty' }, lookedAt: text });
    return;
  }
  main()
    .look({ text })
    .then(
      (preview) => {
        if (boxStore.getState().text === text) boxStore.setState({ preview, lookedAt: text });
      },
      (error: unknown) => {
        console.error("Lo couldn't look the link up:", error);
        if (boxStore.getState().text === text) {
          boxStore.setState({
            lookedAt: undefined,
            error: { title: 'Couldn’t check the link', details: said(error), retry: true },
          });
        }
      },
    );
}

/**
 * Opens the box with `text` in it, or empty and then filled in with the pull request link on the
 * clipboard, if there's one and nothing has been typed meanwhile.
 */
export function openBox(text?: string): void {
  clearTimeout(timer);
  boxStore.setState({ ...closed, open: true, text: text ?? '' });
  if (text !== undefined) {
    lookUp(text);
    return;
  }
  main()
    .clipboard()
    .then((link) => {
      const state = boxStore.getState();
      if (link === null || !state.open || state.text !== '') return;
      boxStore.setState({ text: link, fromClipboard: true });
      lookUp(link);
    })
    .catch((error: unknown) => console.error("Lo couldn't read the clipboard:", error));
}

export function closeBox(): void {
  clearTimeout(timer);
  boxStore.setState({ open: false });
}

/** Clears what the box held, once it has closed. */
export function boxClosed(): void {
  if (!boxStore.getState().open) boxStore.setState(closed);
}

/** What's typed changed: Lo looks it up once typing pauses. */
export function typeText(text: string): void {
  boxStore.setState({ text, fromClipboard: false, error: undefined });
  clearTimeout(timer);
  timer = setTimeout(() => lookUp(text), LOOK_AFTER);
}

/** The keys or the pointer moved to the row of `login`'s account, or to no account's. */
export function highlight(login: string | undefined): void {
  if (boxStore.getState().highlighted !== login) boxStore.setState({ highlighted: login });
}

/** What main said of the text in the box now, if it's said. */
export function currentPreview(state: BoxState = boxStore.getState()): Preview | undefined {
  return state.lookedAt === state.text ? state.preview : undefined;
}

/** What main said went wrong, as it came, for Details. */
function said(error: unknown): string | undefined {
  if (error instanceof IpcError) return error.message;
  return error instanceof Error ? error.message : undefined;
}

/**
 * What opening a link did, as the window says it: a refusal carries its reason in words, for a
 * field that says why under itself, with code between backticks; empty where the title says it.
 */
export type OpenedHere =
  | Exclude<Opened, { kind: 'refused' }>
  | { readonly kind: 'refused'; readonly why: Refusal; readonly message: string };

/**
 * Opens `text`, as `login` if given, and closes the box once it has; or says why it didn't. Main
 * opens a pull request in its tab and hands any other web link to the browser.
 */
export async function openText(text: string, login?: string): Promise<OpenedHere | undefined> {
  boxStore.setState({ opening: true, error: undefined });
  try {
    const done = await main().open(login === undefined ? { text } : { text, login });
    if (done.kind === 'refused') {
      const reason = refusalReason(done.why);
      const title = isNotPull(done.why) ? 'Not a pull request link' : 'Couldn’t open the link';
      boxStore.setState({ opening: false, error: { title, reason } });
      return { kind: 'refused', why: done.why, message: reason ?? '' };
    }
    boxStore.setState({ opening: false });
    closeBox();
    return done;
  } catch (error) {
    console.error("Lo couldn't open the link:", error);
    boxStore.setState({
      opening: false,
      error: { title: 'Couldn’t open the link', details: said(error) },
    });
    return undefined;
  }
}

/**
 * Opens the pull request in the box as `login`, one of the accounts that can see it, and
 * remembers that account for its owner, or for its repository alone when the owner's repositories
 * open with another account, as the account picker does by default.
 */
export async function openAs(login: string): Promise<void> {
  const state = boxStore.getState();
  const preview = currentPreview(state);
  if (preview?.kind !== 'pull' || preview.as.kind !== 'ask') return;
  try {
    await client(accounts).choose({
      owner: preview.owner,
      name: preview.repo,
      login,
      remember: preview.as.remember,
    });
  } catch (error) {
    // Opening as the account chosen matters more than remembering it.
    console.error(`Lo couldn't remember ${login} for ${preview.owner}:`, error);
  }
  await openText(state.text, login);
}

/** What `⏎` does in the box now: its label, or nothing. */
export function enterAction(state: BoxState = boxStore.getState()): string | undefined {
  if (state.error?.retry === true) return 'Try again';
  const preview = currentPreview(state);
  if (preview === undefined) return state.text.trim() === '' ? undefined : 'Open';
  switch (preview.kind) {
    case 'empty':
    case 'invalid':
      return undefined;
    case 'pull':
      if (preview.as.kind !== 'ask') return 'Open';
      return `Open as ${state.highlighted ?? preview.as.logins[0] ?? ''}`;
    case 'web':
      return webWords(preview).action;
    case 'blocked': {
      const { way } = blockedWords(preview.why, preview);
      return way === undefined ? undefined : wayLabel(way);
    }
    default:
      preview satisfies never;
      return undefined;
  }
}

/** `⏎` with no row to act on: what the box offers for what's in it. */
export function submit(): void {
  const state = boxStore.getState();
  if (state.opening) return;
  if (state.error?.retry === true) {
    boxStore.setState({ error: undefined });
    lookUp(state.text);
    return;
  }
  const preview = currentPreview(state);
  if (preview === undefined) {
    // Still looking it up: main reads it and opens it as it would.
    if (state.text.trim() !== '') void openText(state.text);
    return;
  }
  switch (preview.kind) {
    case 'empty':
    case 'invalid':
      return;
    case 'pull':
      void openText(state.text);
      return;
    case 'web':
      if (preview.secure) void openText(state.text);
      else void copyLink(preview.url);
      return;
    case 'blocked': {
      const { way } = blockedWords(preview.why, preview);
      if (way !== undefined) takeWay(way, state.text);
      return;
    }
    default:
      preview satisfies never;
  }
}

/** Does what a way on for a pull request the box can't open says. */
export function takeWay(way: BlockedWay, text: string): void {
  switch (way.kind) {
    case 'link':
      void openPage(way.url);
      return;
    case 'openAnyway':
      void openText(text);
      return;
    case 'signIn':
      addAccount();
      return;
    default:
      throw new Error(`A way on Lo doesn't know: ${JSON.stringify(way satisfies never)}`);
  }
}

/** Opens one of GitHub's pages for fixing what's wrong, such as asking for an approval. */
export async function openPage(url: string): Promise<void> {
  try {
    await client(tabs).openExternal({ url });
  } catch (error) {
    console.error("Lo couldn't open GitHub's page:", error);
    boxStore.setState({ error: { title: 'Couldn’t open GitHub’s page', details: said(error) } });
  }
}

/**
 * Copies a link Lo won't hand to the browser, for the person to open themselves, and closes the
 * box; or says why it couldn't.
 */
export async function copyLink(url: string): Promise<void> {
  try {
    await client(tabs).copy({ text: url });
    closeBox();
    announce('Copied link');
  } catch (error) {
    console.error("Lo couldn't copy the link:", error);
    boxStore.setState({ error: { title: 'Couldn’t copy the link', details: said(error) } });
  }
}

/** Closes the box and starts signing in, for an account that can see the pull request. */
export function addAccount(): void {
  closeBox();
  signIn();
}
