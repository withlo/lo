// The files as the diff view is given them: in the left panel's order, each starting out as main
// said, with what's been worked out of it so far.

import { sizeText } from '@lo/review';
import type { DiffFile, FileHeader } from '@lo/ui/code';

import type { FileVersions } from '../contract.ts';
import type { Entry, Shown } from './loader.ts';

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
 * What makes a view of these files a new one: their ids in order and how each starts out. Two
 * lists with the same key draw the same files the same way, so one view takes the other's files
 * in place.
 */
export function viewKey(at: string, entries: readonly Entry[]): string {
  return `${at}|${entries.map((entry) => `${entry.id}:${entry.versions.start}`).join(',')}`;
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

/** The labels after a file's counts: why it starts as it does. */
export function tagsOf(versions: FileVersions): string[] {
  const tags: string[] = [];
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
      tags.push(versions.change === 'renamed' ? 'renamed' : 'no change to its text');
      break;
    case 'shown':
    case 'collapsed':
      break;
    default:
      versions.start satisfies never;
      throw new Error(`A start Lo doesn't know: ${JSON.stringify(versions.start)}.`);
  }
  return tags;
}

/** A file's header: its counts and tags. */
export function headerOf(versions: FileVersions): FileHeader {
  const tags = tagsOf(versions);
  const header: FileHeader = { additions: versions.additions, deletions: versions.deletions };
  if (tags.length > 0) header.tags = tags;
  return header;
}

/**
 * A file as the view is given it. One that shows its lines has them by the time it's drawn, or
 * couldn't be loaded and waits for `za`, as a large file does; a large one has them once it's been
 * loaded.
 */
export function diffFileOf(entry: Entry, shown: Shown | undefined): DiffFile {
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
    header: headerOf(versions),
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
  if (shown.gaps.length > 0) file.gaps = shown.gaps;
  if (versions.start === 'collapsed') file.collapsed = true;
  return file;
}
