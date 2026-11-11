// The open box: what's in it, what main said of it, and what `⏎` does. Main reads the link and
// looks it up; the window never reads the clipboard itself, and asks main for the pull request
// link on it, if there's one, as the box opens.

import { createStore } from 'zustand/vanilla';

import { IpcError } from '../../../ipc/contract.ts';
import { notify } from '../../../window/commands/notices.tsx';
import { client } from '../../../window/ipc.ts';
import { contract as accounts } from '../../accounts/contract.ts';
import { signIn } from '../../accounts/window/shared.ts';
import { contract as tabs } from '../../tab/contract.ts';
import type { Opened, Preview } from '../contract.ts';
import { main } from './main.ts';

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
  readonly error: string | undefined;
}

const closed: BoxState = {
  open: false,
  text: '',
  fromClipboard: false,
  preview: undefined,
  lookedAt: undefined,
  opening: false,
  error: undefined,
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
          boxStore.setState({ lookedAt: undefined, error: "Lo couldn't look the link up." });
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

/** What main said of the text in the box now, if it's said. */
export function currentPreview(state: BoxState = boxStore.getState()): Preview | undefined {
  return state.lookedAt === state.text ? state.preview : undefined;
}

/** Why opening failed, in words for the person. */
function why(error: unknown): string {
  return error instanceof IpcError ? error.message : "Lo couldn't open the link.";
}

/**
 * Opens `text`, as `login` if given, and closes the box once it has; or says why it didn't. Main
 * opens a pull request in its tab and hands any other web link to the browser.
 */
export async function openText(text: string, login?: string): Promise<Opened | undefined> {
  boxStore.setState({ opening: true, error: undefined });
  try {
    const done = await main().open(login === undefined ? { text } : { text, login });
    if (done.kind === 'refused') {
      boxStore.setState({ opening: false, error: done.message });
    } else {
      boxStore.setState({ opening: false });
      closeBox();
    }
    return done;
  } catch (error) {
    console.error("Lo couldn't open the link:", error);
    boxStore.setState({ opening: false, error: why(error) });
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

/** What `⏎` does in the box now, for its foot: its label, or nothing. */
export function enterAction(preview: Preview | undefined, text: string): string | undefined {
  if (preview === undefined) return text.trim() === '' ? undefined : 'Open';
  switch (preview.kind) {
    case 'empty':
    case 'invalid':
      return undefined;
    case 'pull':
      return preview.as.kind === 'ask' ? 'Open as the account chosen' : 'Open';
    case 'web':
      return preview.browse ? 'Open in the browser' : 'Copy the link';
    case 'blocked': {
      const [first] = preview.links;
      if (first) return first.label;
      if (preview.openAnyway) return 'Open anyway';
      return preview.signIn ? 'Add an account' : undefined;
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
      if (preview.browse) void openText(state.text);
      else void copyLink(preview.url);
      return;
    case 'blocked': {
      const [first] = preview.links;
      if (first) {
        void openPage(first.url);
      } else if (preview.openAnyway) {
        void openText(state.text);
      } else if (preview.signIn) {
        addAccount();
      }
      return;
    }
    default:
      preview satisfies never;
  }
}

/** Opens one of GitHub's pages for fixing what's wrong, such as asking for an approval. */
export async function openPage(url: string): Promise<void> {
  try {
    await client(tabs).openExternal({ url });
  } catch (error) {
    console.error("Lo couldn't open GitHub's page:", error);
    boxStore.setState({ error: "Lo couldn't open GitHub's page." });
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
    notify('Copy the link', `Copied ${url}.`);
  } catch (error) {
    console.error("Lo couldn't copy the link:", error);
    boxStore.setState({ error: "Lo couldn't copy the link." });
  }
}

/** Closes the box and starts signing in, for an account that can see the pull request. */
export function addAccount(): void {
  closeBox();
  signIn();
}
