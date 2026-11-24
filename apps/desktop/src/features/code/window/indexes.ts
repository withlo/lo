// How far each view's code index has got, as main last said: kept with the view, and gone when its
// tab closes. What its status bar item says follows from it, as a plain function tested alone.

import { bytes } from '@lo/ui';

import { tabState } from '../../tab/window/shared.ts';
import type { IndexState, Indexed, PartialWhy } from '../contract.ts';
import { TREE_BYTES, TREE_FILES } from '../jobs.ts';
import { main } from './main.ts';

/** Each view's index, once main has said. */
export const indexes = tabState<IndexState | null>(() => null);

/** Builds view `view`'s index again now, where it failed, as "Try now" asks. */
export function retryIndex(view: string): void {
  main()
    .retryIndex({ view })
    .catch((error: unknown) => console.error("Lo couldn't index the code again:", error));
}

/** Takes what main said of a view's index. */
export function takeIndex({ view, state }: Indexed): void {
  if (JSON.stringify(indexes.get(view)) !== JSON.stringify(state)) indexes.set(view, state);
}

const asked = new Set<string>();

/** Asks main how far a view's index has got, once, for a view drawn before main said. */
export function catchUpIndex(view: string): void {
  if (asked.has(view) || indexes.get(view) !== null) return;
  asked.add(view);
  main()
    .index({ view })
    .then((state) => {
      if (state && indexes.get(view) === null) indexes.set(view, state);
    })
    .catch((error: unknown) => console.error("Lo couldn't ask about the syntax index:", error))
    .finally(() => asked.delete(view));
}

/** What the status bar's item says of a view's index, and what's behind it in its details. */
export interface IndexItem {
  readonly ball: 'off' | 'working' | 'ready' | 'warn' | 'failed';
  readonly text: string;
  /** The details' one line: how far it has got, or why it holds what it holds. */
  readonly lines?: readonly string[];
  /**
   * That it couldn't be built, for its details' `Problem`: what main said, for Details, and when
   * it's built again by itself, if it is.
   */
  readonly failure?: { readonly message: string; readonly retryAt: number | null };
}

const count = (value: number) => value.toLocaleString('en-US');

/** Why an index is partial, a sentence each. */
const WHY: Readonly<Record<PartialWhy, string>> = {
  files: `The ${count(TREE_FILES)} files nearest the changes are indexed.`,
  bytes: `The first ${bytes(TREE_BYTES)} of files are indexed.`,
  offline: 'Offline.',
  listing: 'The repo has too many files to list.',
};

/**
 * The index's item for `repository`'s code: how far it has got while it builds, with what it
 * indexes in its details, its name once it's ready, with how much a partial one has, and why, in its
 * details. A ring while it waits for the local copy, and nothing
 * without git, which the local copy's item says. One that failed is amber while it waits to be
 * built again, as it does by itself, and red once it doesn't.
 */
export function indexItem(state: IndexState | null, repository: string): IndexItem | undefined {
  switch (state?.kind) {
    case undefined:
    case 'noGit':
      return undefined;
    case 'waiting':
      return { ball: 'off', text: 'Code index' };
    case 'building':
      return state.total === 0
        ? { ball: 'working', text: 'Indexing code…', lines: [`Indexing ${repository}…`] }
        : {
            ball: 'working',
            text: `Indexing code · ${count(state.done)} / ${count(state.total)}`,
            lines: [`Indexing ${repository} · ${count(state.done)} / ${count(state.total)} files`],
          };
    case 'ready': {
      const { partial } = state;
      if (!partial) return { ball: 'ready', text: 'Code index' };
      return {
        ball: 'warn',
        text:
          partial.total > 0
            ? `Code index · ${count(partial.indexed)} / ${count(partial.total)} files`
            : 'Code index',
        lines: partial.why.map((why) => WHY[why]),
      };
    }
    case 'failed':
      return {
        ball: state.retryAt === null ? 'failed' : 'warn',
        text: 'Can’t index the code',
        failure: { message: state.message, retryAt: state.retryAt },
      };
    default:
      state satisfies never;
      return undefined;
  }
}
