/** A server's states, and what the reader is told when one fails. */

/** A gigabyte, as memory caps count it. */
const GB = 1024 ** 3;
/** A megabyte. */
const MB = 1024 ** 2;

/** Why a server failed. */
export type Failure =
  /** It couldn't be started: its program is missing, not allowed or not its own. */
  | { readonly kind: 'start'; readonly message: string }
  /** It exited, or a signal stopped it, without being asked to. */
  | { readonly kind: 'exited'; readonly code: number | null; readonly signal: string | null }
  /** Its family held more than `cap` bytes, so Lo stopped it. */
  | { readonly kind: 'memory'; readonly cap: number }
  /** Lo couldn't read its memory, so couldn't hold it to its cap, and stopped it. */
  | { readonly kind: 'memoryUnread' }
  /** Its answer to `initialize` wasn't one Lo can use, or it didn't answer. */
  | { readonly kind: 'initialize'; readonly message: string }
  /** It sent something Lo can't read, or too much of it. */
  | { readonly kind: 'protocol'; readonly message: string };

/** Work the server says it's doing, through work-done progress. */
export interface Progress {
  readonly title: string;
  /** How far along, 0 to 100, when it says. */
  readonly percentage?: number | undefined;
}

/** Where a server is in its life. */
export type State =
  | { readonly kind: 'starting' }
  /** It answers, and says it's working, such as loading the project. */
  | { readonly kind: 'indexing'; readonly progress: Progress }
  | { readonly kind: 'ready' }
  /** It missed several deadlines in a short while. It may come back. */
  | { readonly kind: 'notAnswering' }
  | { readonly kind: 'failed'; readonly failure: Failure }
  | { readonly kind: 'stopping' }
  | { readonly kind: 'stopped' };

/** What the reader is told about `failure`. */
export function failureMessage(failure: Failure): string {
  switch (failure.kind) {
    case 'start':
    case 'initialize':
    case 'protocol':
      return failure.message;
    case 'exited':
      return failure.code === null
        ? `It quit on ${failure.signal ?? 'a signal'}.`
        : `It quit with exit code ${failure.code}.`;
    case 'memory':
      return `It ran out of memory at ${size(failure.cap)}.`;
    case 'memoryUnread':
      return 'Lo couldn’t read how much memory it used, so it stopped it.';
    default:
      throw new Error(`a failure Lo doesn't know: ${JSON.stringify(failure satisfies never)}`);
  }
}

/** `bytes` in GB when it's whole gigabytes, else in MB. */
function size(bytes: number): string {
  return bytes >= GB && bytes % GB === 0 ? `${bytes / GB} GB` : `${Math.round(bytes / MB)} MB`;
}
