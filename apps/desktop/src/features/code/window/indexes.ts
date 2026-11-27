// How far each view's code index has got, as main last said: kept with the view, and gone when its
// tab closes. What its status bar item says follows from it, as a plain function tested alone.

import { agoAlone, bytes } from '@lo/ui';

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

/** One fact the index's details state, as `StatusFacts` draws it. */
export interface IndexFact {
  readonly label: string;
  /** What it says, or a list of things, a line each. */
  readonly value: string | readonly string[];
  /** Under the value: why a partial index holds what it holds, a sentence each. */
  readonly why?: readonly string[] | undefined;
}

/** What the status bar's item says of a view's index, and what's behind it in its details. */
export interface IndexItem {
  readonly ball: 'off' | 'working' | 'ready' | 'warn' | 'failed';
  readonly text: string;
  /**
   * Its details' facts, under the line that says what it is: its state in words, then, once it's
   * ready, what it covers and when it was built.
   */
  readonly facts: readonly IndexFact[];
  /**
   * That it couldn't be built, for its details' `Problem`: what main said, for Details, and when
   * it's built again by itself, if it is.
   */
  readonly failure?: { readonly message: string; readonly retryAt: number | null };
}

/** What the index is, the first line of its details. */
export const INDEX_LINE = 'Finds definitions and references when no language server runs.';

const count = (value: number) => value.toLocaleString('en-US');

/** "1 file", "3,102 files". */
const files = (value: number) => `${count(value)} ${value === 1 ? 'file' : 'files'}`;

/** Why an index is partial, a sentence each. */
const WHY: Readonly<Record<PartialWhy, string>> = {
  files: `The ${count(TREE_FILES)} files nearest the changes are indexed.`,
  bytes: `The first ${bytes(TREE_BYTES)} of files are indexed.`,
  offline: 'Offline.',
  listing: 'The repo has too many files to list.',
};

/**
 * What a ready index covers, the head's files it read in each language, and when its trees were
 * built, as facts, `now` being the time now: the files in all, only beside two languages or more,
 * which they'd only say again; then a language a line, most files first; then when.
 */
function covered(state: Extract<IndexState, { kind: 'ready' }>, now: number): IndexFact[] {
  const read = state.languages.reduce((sum, language) => sum + language.files, 0);
  const languages = state.languages.toSorted((a, b) => b.files - a.files);
  return [
    // A partial one's state counts its files already.
    ...(state.partial || read === 0 || languages.length < 2
      ? []
      : [{ label: 'Files', value: count(read) }]),
    ...(languages.length === 0
      ? []
      : [
          {
            label: 'Languages',
            value: languages.map((language) => `${language.name} · ${files(language.files)}`),
          },
        ]),
    ...(state.at > 0 ? [{ label: 'Built', value: agoAlone(state.at, now) }] : []),
  ];
}

/**
 * The index's item for `repository`'s code, `now` being the time now: how far it has got while it
 * builds, its name once it's ready, with how much a partial one has, and why. Its details say what
 * it is, its state, and once it's ready, the files it read in each language and when it was built.
 * A ring while it waits for the local copy, and nothing without git, which the local copy's item
 * says. One that failed is amber while it waits to be built again, as it does by itself, and red
 * once it doesn't.
 */
export function indexItem(
  state: IndexState | null,
  repository: string,
  now: number,
): IndexItem | undefined {
  switch (state?.kind) {
    case undefined:
    case 'noGit':
      return undefined;
    case 'waiting':
      return {
        ball: 'off',
        text: 'Code index',
        facts: [{ label: 'State', value: 'Waiting for local copy…' }],
      };
    case 'building':
      return state.total === 0
        ? {
            ball: 'working',
            text: 'Indexing code…',
            facts: [{ label: 'State', value: `Indexing ${repository}…` }],
          }
        : {
            ball: 'working',
            text: `Indexing code · ${count(state.done)} / ${count(state.total)}`,
            facts: [
              {
                label: 'State',
                value: `Indexing ${repository} · ${count(state.done)} / ${count(state.total)} files`,
              },
            ],
          };
    case 'ready': {
      const { partial } = state;
      if (!partial) {
        return {
          ball: 'ready',
          text: 'Code index',
          facts: [{ label: 'State', value: 'Ready' }, ...covered(state, now)],
        };
      }
      const counted = `${count(partial.indexed)} / ${count(partial.total)} files`;
      return {
        ball: 'warn',
        text: partial.total > 0 ? `Code index · ${counted}` : 'Code index',
        facts: [
          {
            label: 'State',
            value: partial.total > 0 ? `Partial · ${counted}` : 'Partial',
            why: partial.why.map((why) => WHY[why]),
          },
          ...covered(state, now),
        ],
      };
    }
    case 'failed':
      return {
        ball: state.retryAt === null ? 'failed' : 'warn',
        text: 'Can’t index the code',
        facts: [],
        failure: { message: state.message, retryAt: state.retryAt },
      };
    default:
      state satisfies never;
      return undefined;
  }
}
