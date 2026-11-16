// How far each view's syntax index has got, as main last said: kept with the view, and gone when
// its tab closes. What the status bar says of it follows from it, as a plain function tested alone.

import { tabState } from '../../tab/window/shared.ts';
import type { IndexState, Indexed, PartialWhy } from '../contract.ts';
import { TREE_BYTES, TREE_FILES } from '../jobs.ts';
import { main } from './main.ts';

/** Each view's index, once main has said. */
export const indexes = tabState<IndexState | null>(() => null);

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

/** What the status bar's item says of a view's index, if anything. */
export interface IndexItem {
  readonly dot: 'ok' | 'busy' | 'warn' | 'fail';
  readonly text: string;
  readonly title?: string;
}

const count = (value: number) => value.toLocaleString('en-US');

/** Why an index is partial, a sentence each. */
const WHY: Readonly<Record<PartialWhy, string>> = {
  files: `Lo reads ${count(TREE_FILES)} files of a tree at most, nearest the PR’s own first.`,
  bytes: `Lo downloads ${count(TREE_BYTES / 1024 ** 2)} MB of a tree’s files at most.`,
  offline: 'Offline, Lo reads only what the local copy has.',
  listing: 'A tree has more files than Lo lists, so none of them are read.',
};

/**
 * The index's item: how far it has got while it builds, its name once it's ready, and that it's
 * partial, with how much and why on hover. Nothing without git or before the local copy, which
 * say so themselves.
 */
export function indexItem(state: IndexState | null): IndexItem | undefined {
  switch (state?.kind) {
    case undefined:
    case 'noGit':
    case 'waiting':
      return undefined;
    case 'building':
      return {
        dot: 'busy',
        text:
          state.total === 0
            ? 'Syntax index'
            : `Syntax index ${count(state.done)} / ${count(state.total)}`,
      };
    case 'ready': {
      const { partial } = state;
      if (!partial) return { dot: 'ok', text: 'Syntax index' };
      const reasons = partial.why.map((why) => WHY[why]);
      return {
        dot: 'warn',
        text: 'Syntax index partial',
        title: [
          ...(partial.total > 0
            ? [`It has ${count(partial.indexed)} of ${count(partial.total)} files.`]
            : []),
          ...reasons,
        ].join(' '),
      };
    }
    case 'failed':
      return {
        dot: 'fail',
        text: 'Syntax index failed',
        title: `${state.message} Lo tries again by itself.`,
      };
    default:
      state satisfies never;
      return undefined;
  }
}
