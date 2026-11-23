// Each view's language servers, as main last said: kept with the view, and gone when its tab
// closes. What each status item shows follows from it, as plain functions tested alone; "Restart"
// and the log only ask main.

import type { ServerState as ItemState } from '@lo/ui';
import type { NoTarget, TabTarget } from '@lo/ui/commands';
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

/**
 * Whether each view's Language servers item has its details open: `open` as the reader opened
 * them, or `offered` as the first `g d` in a repo nothing trusts opened them, unasked, which leaves
 * focus where it was. Closed again once the view's servers are no longer off, as once trusted, so
 * the item a later Stop trusting brings back starts closed.
 */
export const offered = tabState<'closed' | 'offered' | 'open'>(() => 'closed');

/** Takes what main said of a view's servers. */
export function takeServers(shown: Servers): void {
  if (JSON.stringify(servers.get(shown.view)) !== JSON.stringify(shown)) {
    servers.set(shown.view, shown);
  }
  if (!shown.off && offered.get(shown.view) !== 'closed') offered.set(shown.view, 'closed');
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
    case 'unpacking':
    case 'building':
    case 'waiting':
    case 'starting':
    case 'indexing':
    case 'ready':
    case 'notAnswering':
    case 'missing':
    case 'refused':
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

/**
 * Asks main to start view `view`'s server `server` again. A failure is said in a note, with what
 * main said behind Details, since the server's item has nowhere to say it yet.
 */
export async function restartServer(view: string, server: string, name: string): Promise<void> {
  try {
    await main().restart({ view, server });
  } catch (error) {
    console.error(`Lo couldn't start ${name} again:`, error);
    notify(`Couldn’t restart ${name}`, '', {
      details: error instanceof IpcError && error.code !== 'internal' ? error.message : undefined,
      action: { label: 'Try again', onClick: () => void restartServer(view, server, name) },
    });
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

/**
 * The servers of the view `target` names, as a row of Settings' list of them does, or else of the
 * view on screen, or why there are none to act on.
 */
export function serversFor(target: NoTarget | TabTarget): Servers | string {
  if (target.kind === 'none') return serversOnScreen();
  const shown = servers.get(target.tab);
  if (!shown || shown.servers.length === 0) return 'No language server is running';
  return shown;
}

/** The view on screen's servers, or why there are none to act on. */
export function serversOnScreen(): Servers | string {
  const tab = activeTab();
  if (tab?.kind !== 'pull') return 'Open a pull request first';
  const shown = servers.get(tab.id);
  if (!shown || shown.servers.length === 0) return 'No language server is running';
  return shown;
}
