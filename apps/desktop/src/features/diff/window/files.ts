// The files as the diff view is given them: in the left panel's order, each starting out as main
// said, closed when it's viewed, with its viewed mark and what's been worked out of it so far.

import { sizeText } from '@lo/review';
import type { DiffFile, FileHeader } from '@lo/ui/code';

import type { Mark } from '../../revisions/window/shared.ts';
import type { Changed } from '../../tree/contract.ts';
import type { FileVersions, Start } from '../contract.ts';
import type { Entry, Shown } from './loader.ts';

/** How a file starts out, with its viewed mark: one viewed that would show its lines starts closed. */
export function startWith(versions: FileVersions, mark: Mark | undefined): Start {
  return mark === 'viewed' && versions.start === 'shown' ? 'collapsed' : versions.start;
}

/**
 * `entries` in the left panel's `order`, by key, then any it doesn't list, in main's order. `find`
 * gives a key's id, if the tab has one.
 */
export function inOrder(
  entries: readonly Entry[],
  order: readonly string[],
  find: (key: string) => string | undefined,
): Entry[] {
  const places = new Map<string, number>();
  order.forEach((key, index) => {
    const id = find(key);
    if (id !== undefined && !places.has(id)) places.set(id, index);
  });
  return entries.toSorted(
    (a, b) => (places.get(a.id) ?? Infinity) - (places.get(b.id) ?? Infinity) || a.place - b.place,
  );
}

/**
 * The order a tab's diff draws its files in: worked out in the panel's way, and kept until the
 * reader changes how the panel orders them, or the files change. What the files say of themselves
 * changing, as when the local copy marks one generated, which moves it in review order, doesn't
 * reorder a view that's drawn.
 */
export interface KeptOrder {
  readonly mode: string;
  readonly at: string;
  /** The files' keys, sorted, to tell when they change. */
  readonly files: string;
  readonly order: readonly string[];
}

/** {@link KeptOrder} for `entries` at `at` in `mode`: `kept`, or a new one from `orderOf`. */
export function keptOrder(
  kept: KeptOrder | undefined,
  at: string,
  entries: readonly Entry[],
  mode: string,
  orderOf: (changes: readonly Changed[]) => readonly string[],
): KeptOrder {
  const files = entries
    .map((entry) => entry.key)
    .toSorted()
    .join('\n');
  if (kept && kept.mode === mode && kept.at === at && kept.files === files) return kept;
  return { mode, at, files, order: orderOf(entries.map(changeOf)) };
}

/** A file as the panel orders it. */
export function changeOf({ versions: { path, previous, change, generated } }: Entry): Changed {
  return { path, previous, change, generated };
}

/**
 * What makes a view of these files a new one: their ids, in order. Two lists with the same key
 * draw the same files, so one view takes the other's in place, however each starts out.
 */
export function viewKey(at: string, entries: readonly Entry[]): string {
  return `${at}|${entries.map((entry) => entry.id).join(',')}`;
}

/** The longest path a header shows whole. */
const SHOWN_PATH = 240;

/**
 * A path as a header shows it: whole, or past {@link SHOWN_PATH} characters, its start and its end
 * with an ellipsis between them, so a path many kilobytes long still shows, and where it leads.
 */
export function shownPath(path: string): string {
  if (path.length <= SHOWN_PATH) return path;
  const half = (SHOWN_PATH - 1) / 2;
  return `${path.slice(0, Math.ceil(half))}…${path.slice(-Math.floor(half))}`;
}

/** A side's size, as a header says it, once it's known. */
function sizeOf(side: FileVersions['old']): string | undefined {
  return side?.size === null || side === null ? undefined : sizeText(side.size);
}

/** What a header says of where a file shows from, for one a push changed since it was viewed. */
function sinceText(since: NonNullable<FileVersions['since']>): string {
  return since.why === 'viewed' ? since.label : `your review in ${since.label}`;
}

/** The labels after a file's counts: where it shows from, and why it starts as it does. */
export function tagsOf(versions: FileVersions): string[] {
  const tags: string[] = [];
  const { since } = versions;
  // A file nothing changed in since it was viewed says only that.
  if (since && versions.start === 'unchanged') return [`no change since ${sinceText(since)}`];
  if (since) tags.push(`since ${sinceText(since)}`);
  if (versions.conflicted) tags.push('resolved a conflict');
  if (versions.generated === 'attribute') tags.push('generated');
  if (versions.generated === 'lockfile') tags.push('lockfile');
  switch (versions.start) {
    case 'binary': {
      const old = sizeOf(versions.old);
      const added = sizeOf(versions.new);
      const sizes =
        versions.old === null
          ? added
          : versions.new === null
            ? old
            : old !== undefined || added !== undefined
              ? `${old ?? '?'} → ${added ?? '?'}`
              : undefined;
      tags.push(sizes === undefined ? 'binary' : `binary, ${sizes}`);
      break;
    }
    case 'large':
      tags.push('large');
      break;
    case 'unchanged':
      tags.push(
        versions.submodule === 'both'
          ? 'submodule'
          : versions.change === 'renamed'
            ? 'renamed'
            : 'no change to its text',
      );
      break;
    case 'shown':
    case 'collapsed':
      if (versions.submodule === 'new') tags.push('now a submodule');
      if (versions.submodule === 'old') tags.push('was a submodule');
      break;
    default:
      versions.start satisfies never;
      throw new Error(`A start Lo doesn't know: ${JSON.stringify(versions.start)}.`);
  }
  return tags;
}

/** A file's header: its counts, tags and viewed mark. */
export function headerOf(versions: FileVersions, mark?: Mark): FileHeader {
  const tags = tagsOf(versions);
  const header: FileHeader = { additions: versions.additions, deletions: versions.deletions };
  if (tags.length > 0) header.tags = tags;
  if (mark) header.viewed = mark === 'dismissed' ? 'stale' : mark;
  return header;
}

/**
 * A file as the view is given it, with its viewed mark. One that shows its lines has them by the
 * time it's drawn, or couldn't be loaded and waits for `za`, as a large file does; a large one has
 * them once it's been loaded. A viewed one starts closed.
 */
export function diffFileOf(entry: Entry, shown: Shown | undefined, mark?: Mark): DiffFile {
  const { versions } = entry;
  const file: DiffFile = {
    id: entry.id,
    path: shownPath(versions.path.text),
    change:
      versions.change === 'added'
        ? 'added'
        : versions.change === 'deleted'
          ? 'deleted'
          : 'modified',
    header: headerOf(versions, mark),
  };
  if (versions.previous) file.previousPath = shownPath(versions.previous.text);
  switch (versions.start) {
    case 'binary':
      file.skip = 'binary';
      return file;
    case 'unchanged':
      file.skip = 'empty';
      return file;
    case 'shown':
    case 'collapsed':
    case 'large':
      break;
    default:
      versions.start satisfies never;
      throw new Error(`A start Lo doesn't know: ${JSON.stringify(versions.start)}.`);
  }
  if (!shown) {
    file.skip = 'large';
    return file;
  }
  file.lines = shown.lines;
  file.diff = shown.diff;
  file.tokens = shown.tokens;
  if (shown.gaps.length > 0) file.gaps = shown.gaps;
  if (startWith(versions, mark) === 'collapsed') file.collapsed = true;
  return file;
}
