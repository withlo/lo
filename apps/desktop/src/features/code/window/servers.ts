// Each view's language servers, as main last said: kept with the view, and gone when its tab
// closes. What each status item shows follows from it, as plain functions tested alone; "Restart",
// the log, a license and what a server said only ask main.

import type { ServerState as ItemState, NoticeAct } from '@lo/ui';
import { createStore } from 'zustand/vanilla';

import { IpcError } from '../../../ipc/contract.ts';
import { notify } from '../../../window/commands/notices.tsx';
import { client } from '../../../window/ipc.ts';
import { contract as tabs } from '../../tab/contract.ts';
import { activeTab, tabState } from '../../tab/window/shared.ts';
import type { ServerState, Servers } from '../contract.ts';
import { main } from './main.ts';

/** Each view's servers, once main has said. */
export const servers = tabState<Servers | null>(() => null);

/** Takes what main said of a view's servers. */
export function takeServers(shown: Servers): void {
  if (JSON.stringify(servers.get(shown.view)) !== JSON.stringify(shown)) {
    servers.set(shown.view, shown);
  }
}

const asked = new Set<string>();

/** Asks main about a view's servers, once, for a view drawn before main said. */
export function catchUpServers(view: string): void {
  if (asked.has(view) || servers.get(view) !== null) return;
  asked.add(view);
  main()
    .servers({ view })
    .then((shown) => {
      if (shown && servers.get(view) === null) servers.set(view, shown);
    })
    .catch((error: unknown) => console.error("Lo couldn't ask about language servers:", error))
    .finally(() => asked.delete(view));
}

/** Bytes as the status item counts them. */
function gigabytes(bytes: number): string {
  const value = bytes / 1024 ** 3;
  return Number.isInteger(value) ? `${value} GB` : `${Math.round(bytes / 1024 ** 2)} MB`;
}

/** What a server's item shows for what main said of it. */
export function itemState(state: ServerState): ItemState {
  switch (state.kind) {
    case 'downloading':
    case 'starting':
    case 'indexing':
    case 'ready':
    case 'notAnswering':
    case 'missing':
    case 'license':
      return state;
    case 'failed': {
      const { why } = state;
      switch (why.kind) {
        case 'memory':
          return { kind: 'failed', why: { kind: 'memory', limit: gigabytes(why.cap) } };
        case 'download':
        case 'error':
          return { kind: 'failed', why };
        default:
          why satisfies never;
          return { kind: 'failed', why: { kind: 'error', message: 'It stopped.' } };
      }
    }
    default:
      state satisfies never;
      return { kind: 'starting' };
  }
}

/** Asks main to start view `view`'s server `server` again. */
export async function restartServer(view: string, server: string, name: string): Promise<void> {
  try {
    await main().restart({ view, server });
  } catch (error) {
    console.error(`Lo couldn't start ${name} again:`, error);
    notify(
      `Restart ${name}`,
      error instanceof IpcError && error.code !== 'internal'
        ? error.message
        : `Lo couldn't start ${name} again.`,
    );
  }
}

/** What a license's `act` is called, for what Lo says when it fails. */
const LICENSE_ACTS = {
  read: 'Read the license',
  accept: 'Accept the license',
  withdraw: 'Withdraw acceptance',
} as const;

/**
 * Asks main to act on the license of server `server`, an adapter's: open its page, accept it, so
 * its server may download, or withdraw it, which stops its servers.
 */
export async function actOnLicense(server: string, act: keyof typeof LICENSE_ACTS): Promise<void> {
  try {
    await main().license({ server, act });
  } catch (error) {
    console.error(`Lo couldn't ${act} a license:`, error);
    notify(
      LICENSE_ACTS[act],
      error instanceof IpcError && error.code !== 'internal'
        ? error.message
        : act === 'read'
          ? "Lo couldn't open the license's page."
          : "Lo couldn't change the settings file.",
    );
  }
}

/** Asks main to act on notice `notice` of view `view`'s server `server`, as the reader chose. */
export async function actOnNotice(
  view: string,
  server: string,
  notice: number,
  act: NoticeAct,
): Promise<void> {
  try {
    await main().notice({ view, server, notice, act });
  } catch (error) {
    console.error("Lo couldn't act on a language server's message:", error);
    notify(
      act === 'open' ? 'Open the page' : act === 'dismiss' ? 'Dismiss' : 'Answer',
      error instanceof IpcError && error.code !== 'internal'
        ? error.message
        : "Lo couldn't pass that on to the language server.",
    );
  }
}

/** The log the dialog shows, while it's open. */
export interface LogShown {
  readonly view: string;
  readonly server: string;
  readonly name: string;
}

export const logStore = createStore<{ shown: LogShown | undefined }>(() => ({ shown: undefined }));

/** Opens the dialog with view `view`'s server `server`'s log. */
export function showLog(shown: LogShown): void {
  logStore.setState({ shown });
}

/** How much a copy may hold: what `tab.copy` takes, as UTF-8. */
const COPY_LIMIT = 1024 * 1024;

/** The last of `lines` that fit in a copy, oldest first, as one text. */
export function copiedLog(lines: readonly string[]): string {
  const encoder = new TextEncoder();
  const kept: string[] = [];
  let bytes = 0;
  for (const line of lines.toReversed()) {
    const size = encoder.encode(line).length + 1;
    if (bytes + size > COPY_LIMIT) break;
    kept.push(line);
    bytes += size;
  }
  return kept.toReversed().join('\n');
}

/** Copies a server's log through main, and says whether it did. */
export async function copyLog(lines: readonly string[]): Promise<boolean> {
  try {
    await client(tabs).copy({ text: copiedLog(lines) });
    return true;
  } catch (error) {
    console.error("Lo couldn't copy the log:", error);
    return false;
  }
}

/** The view on screen's servers, or why there are none to act on. */
export function serversOnScreen(): Servers | string {
  const tab = activeTab();
  if (tab?.kind !== 'pull') return "There's no pull request on screen.";
  const shown = servers.get(tab.id);
  if (!shown || shown.servers.length === 0) return 'No language server runs on this PR.';
  return shown;
}
