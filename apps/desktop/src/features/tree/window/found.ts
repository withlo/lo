// What the file finder lists, worked out from what main found and what the tab's tree knows: the
// files as rows, the changed ones first and marked, each path shortened in the middle to fit its
// row, and the groups, counts and hints around them. Pure, so it's tested without a window.

import { withoutBidi } from '../../tab/window/shared.ts';
import {
  PATH_LIMIT,
  pathBytes,
  type Change,
  type Changed,
  type Found,
  type TreePath,
} from '../contract.ts';
import { viewedOf, type Viewed } from './model.ts';
import { keyOf } from './paths.ts';

/** What `tree.find` answered for a query. */
export interface Answer {
  readonly query: string;
  /** The commit the tree was of, or none while it had no files yet. */
  readonly at: string | null;
  readonly found: readonly Found[];
  /** How many files matched in all, however many `found` holds. */
  readonly total: number;
}

/** A file the finder lists. */
export interface Item {
  /** The file's key: the tree's name for it, and the diff's. A path is never the key. */
  readonly id: string;
  readonly path: TreePath;
  /** The places in the path's text the query matched. */
  readonly matched: readonly number[];
  /** Whether the pull request changes it. */
  readonly changed: boolean;
  /** How, if it does and the tree has said. */
  readonly change: Change | undefined;
  readonly viewed: Viewed | undefined;
}

/** Text as a row shows it, and the places in it to mark. */
export interface Shown {
  readonly text: string;
  readonly marks: readonly number[];
}

/** The most characters of a file's name a row shows before its middle gives way to an ellipsis. */
export const NAME_SHOWN = 48;

/** The most characters of the folder a file is in that a row shows. */
export const FOLDER_SHOWN = 48;

/** The most characters of a whole path a row's tooltip holds. */
const TITLE_SHOWN = 2_048;

const isHigh = (unit: number) => unit >= 0xd800 && unit <= 0xdbff;
const isLow = (unit: number) => unit >= 0xdc00 && unit <= 0xdfff;

/**
 * `shown` with its middle cut out for an ellipsis when it's longer than `length` characters, the
 * marks in the middle gone and those after it moved up. A character of two halves is not cut
 * between them.
 */
export function shorten({ text, marks }: Shown, length: number): Shown {
  if (text.length <= length) return { text, marks };
  let head = Math.ceil((length - 1) / 3);
  let tail = length - 1 - head;
  if (head > 0 && isHigh(text.charCodeAt(head - 1))) head--;
  if (isLow(text.charCodeAt(text.length - tail))) tail++;
  const from = text.length - tail;
  return {
    text: `${text.slice(0, head)}…${text.slice(from)}`,
    marks: marks.flatMap((mark) =>
      mark < head ? [mark] : mark >= from ? [mark - from + head + 1] : [],
    ),
  };
}

/**
 * `shown` without the characters that turn the direction of the text after them around: a changed
 * file's name could use them to read as another's. A mark on one of them goes.
 */
export function plain({ text, marks }: Shown): Shown {
  const clean = withoutBidi(text);
  if (clean.length === text.length) return { text, marks };
  // Where each character lands once the others are gone, or nowhere.
  const lands: number[] = [];
  let next = 0;
  for (const character of text) lands.push(withoutBidi(character) === '' ? -1 : next++);
  return {
    text: clean,
    marks: marks.flatMap((mark) => {
      const to = lands[mark];
      return to === undefined || to < 0 ? [] : [to];
    }),
  };
}

/** A path as a row shows it: its name, the folder it's in, and its whole path when cut short. */
export interface Place {
  readonly name: Shown;
  readonly folder: Shown;
  /** The path whole, for a tooltip, when the row shows only part of it. */
  readonly title: string | undefined;
}

/**
 * Where `matched`, the places a query matched in `text`, fall in the file's name and in its folder,
 * each shortened in the middle: a path of any length shows, with its name and the end of its
 * folder.
 */
export function placeOf(text: string, matched: readonly number[]): Place {
  const slash = text.lastIndexOf('/');
  const name = text.slice(slash + 1);
  const folder = slash > 0 ? text.slice(0, slash) : '';
  const long = name.length > NAME_SHOWN || folder.length > FOLDER_SHOWN;
  return {
    name: plain(
      shorten(
        {
          text: name,
          marks: matched.filter((mark) => mark > slash).map((mark) => mark - slash - 1),
        },
        NAME_SHOWN,
      ),
    ),
    folder: plain(
      shorten({ text: folder, marks: matched.filter((mark) => mark < slash) }, FOLDER_SHOWN),
    ),
    title: long ? withoutBidi(shorten({ text, marks: [] }, TITLE_SHOWN).text) : undefined,
  };
}

/** The changes of a tab, by file key. */
const byKey = new WeakMap<readonly Changed[], ReadonlyMap<string, Changed>>();

/** `changes` by file key, worked out once for each list. */
export function changesByKey(changes: readonly Changed[] | null): ReadonlyMap<string, Changed> {
  if (changes === null) return new Map();
  let kept = byKey.get(changes);
  if (!kept) {
    kept = new Map(changes.map((change) => [keyOf(change.path), change]));
    byKey.set(changes, kept);
  }
  return kept;
}

/** GitHub's viewed marks by path, kept only for paths short enough to key a map by. */
export function viewedByPath(
  files: readonly { readonly path: string; readonly viewed: Viewed }[],
): ReadonlyMap<string, Viewed> {
  return new Map(
    files.flatMap((file) =>
      pathBytes({ text: file.path }) <= PATH_LIMIT ? [[file.path, file.viewed] as const] : [],
    ),
  );
}

/**
 * The files the finder lists for `answer`, in the order main gave them: the changed files first.
 * With `changedOnly`, only the changed ones: main puts those first, so the answer holds every one
 * of them that matched, up to its limit.
 */
export function itemsOf(
  answer: Answer | undefined,
  changes: ReadonlyMap<string, Changed>,
  viewed: ReadonlyMap<string, Viewed>,
  changedOnly: boolean,
): Item[] {
  if (!answer) return [];
  return answer.found.flatMap((file) => {
    if (changedOnly && !file.changed) return [];
    const id = keyOf(file.path);
    const change = file.changed ? changes.get(id) : undefined;
    return [
      {
        id,
        path: file.path,
        matched: file.matched,
        changed: file.changed,
        change: change?.change,
        viewed: viewedOf(change, viewed),
      },
    ];
  });
}

/** A run of the finder's rows under a label. */
export interface Group {
  readonly label: string;
  readonly items: readonly Item[];
}

/** The rows in groups: those the pull request changes, then the rest of the repository's. */
export function groupsOf(items: readonly Item[], repo: string): Group[] {
  const changed = items.filter((item) => item.changed);
  const others = items.filter((item) => !item.changed);
  const groups: Group[] = [];
  if (changed.length > 0) {
    groups.push({
      label: `Changed in this pull request · ${changed.length.toLocaleString('en')}`,
      items: changed,
    });
  }
  if (others.length > 0) {
    groups.push({
      label: `Everywhere else in ${repo} · ${others.length.toLocaleString('en')}`,
      items: others,
    });
  }
  return groups;
}

/** What `⏎` does on `item`, for the finder's foot. */
export function enterAction(item: Item | undefined): string | undefined {
  if (item === undefined) return undefined;
  return item.changed ? 'Show in the diff' : 'Show the whole file';
}

/** `count` as a person reads it. */
const n = (count: number) => count.toLocaleString('en');

/**
 * How many files the finder lists, for its foot: of the repository's files when the tree has said
 * how many and all that matched are listed, else of what matched, or of the changed files.
 */
export function countText(
  answer: Answer | undefined,
  shown: number,
  files: number | undefined,
  changed: number | undefined,
  changedOnly: boolean,
): string {
  if (answer === undefined) return '';
  if (changedOnly) {
    return changed === undefined
      ? `${n(shown)} changed`
      : `${n(shown)} of ${n(changed)} changed files`;
  }
  if (answer.total > answer.found.length) {
    const what = answer.query.trim() === '' ? 'files' : 'matches';
    return `${n(answer.found.length)} of ${n(answer.total)} ${what}`;
  }
  if (files === undefined) return `${n(shown)} ${shown === 1 ? 'file' : 'files'}`;
  return `${n(shown)} of ${n(files)} files`;
}
