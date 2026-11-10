/**
 * How each file shows in a pull request's diff (`docs/design.md`, "The diff view"): whether it
 * starts collapsed and why, and what a binary file says.
 */

import { changedLines, type ChangedFile } from './changed.ts';
import type { Generated } from './generated.ts';
import { initialState, LARGE_FILE_LINES } from './state.ts';

/**
 * Why a file shows collapsed, which its header says.
 *
 * - `generated`: `.gitattributes` marks it `linguist-generated`, or it's a lockfile.
 * - `large`: too large to load at once, so its diff loads on a key. `why` says how large.
 * - `largePatch`: too large for GitHub's diff to show in full. Its key opens GitHub's patch of it,
 *   and the local copy's diff loads it.
 * - `tooLarge`: too large to show at all, even on request. `why` says how large.
 * - `whitespaceOnly`: every change in it is to whitespace, and whitespace changes are hidden.
 * - `noChanges`: nothing in its text that shows changed: it was renamed, or only its mode, its line
 *   endings or bytes that aren't UTF-8 changed.
 */
export type Collapsed =
  | { readonly kind: 'generated'; readonly generated: Generated }
  | { readonly kind: 'large'; readonly generated: Generated | undefined; readonly why: string }
  | { readonly kind: 'largePatch'; readonly generated: Generated | undefined; readonly why: string }
  | { readonly kind: 'tooLarge'; readonly why: string }
  | { readonly kind: 'whitespaceOnly' }
  | { readonly kind: 'noChanges' };

/** What the file's header says, where `loadKey` is the key that loads a large file. */
export function collapsedLabel(collapsed: Collapsed, loadKey: string): string {
  switch (collapsed.kind) {
    case 'generated':
      return generatedLabel(collapsed.generated);
    case 'large':
      return `${withGenerated(collapsed.generated)}large: load with ${loadKey}`;
    case 'largePatch':
      return `${withGenerated(collapsed.generated)}large: open with ${loadKey}`;
    case 'tooLarge':
      return 'too large to show';
    case 'whitespaceOnly':
      return 'whitespace only';
    case 'noChanges':
      return 'no visible change';
    default:
      return collapsed satisfies never;
  }
}

/** The label's tooltip. */
export function collapsedDetail(collapsed: Collapsed, loadKey: string): string {
  switch (collapsed.kind) {
    case 'generated':
      return collapsed.generated === 'attribute'
        ? "The repository's .gitattributes marks this file linguist-generated, so it starts collapsed."
        : 'Lockfiles start collapsed.';
    case 'large':
      return `This file isn't loaded: ${collapsed.why}. ${loadKey} loads it.`;
    case 'largePatch':
      return (
        `This file is collapsed: ${collapsed.why}. ${loadKey} opens GitHub's patch of it; the ` +
        "local copy's diff loads it in full once it's ready."
      );
    case 'tooLarge':
      return `Lo doesn't show this file: ${collapsed.why}.`;
    case 'whitespaceOnly':
      return 'Every change to this file is to whitespace, and whitespace changes are hidden.';
    case 'noChanges':
      return (
        "Nothing in this file's text that shows changed: it was renamed, or only its mode, its " +
        "line endings or bytes that aren't UTF-8 changed."
      );
    default:
      return collapsed satisfies never;
  }
}

/** Whether the file's diff isn't loaded until a key loads it. */
export function isLarge(collapsed: Collapsed): boolean {
  return collapsed.kind === 'large';
}

function generatedLabel(generated: Generated): string {
  switch (generated) {
    case 'attribute':
      return 'generated';
    case 'lockfile':
      return 'lockfile';
    default:
      return generated satisfies never;
  }
}

/** A large file's label starts by saying it's generated, if it is. */
function withGenerated(generated: Generated | undefined): string {
  return generated === undefined ? '' : `${generatedLabel(generated)}, `;
}

/**
 * Why a file starts collapsed, or nothing when it starts expanded, from {@link initialState}:
 * generated files and lockfiles, and files too large to load at once. Both diffs, GitHub's and the
 * local copy's, decide with this. `loads` says whether Lo would load anything for the file: a
 * binary file that isn't an image shows only that it changed, so its size doesn't matter.
 */
export function initialCollapse(file: ChangedFile, loads: boolean): Collapsed | undefined {
  const state = initialState(file);
  if (state.large && loads) {
    return { kind: 'large', generated: state.generated, why: largeWhy(file) };
  }
  return state.generated === undefined
    ? undefined
    : { kind: 'generated', generated: state.generated };
}

/** The most a file Lo shows can hold, on either side, even loaded on request. */
export const MAX_SHOWN_BYTES = 50 * 1024 * 1024;

/**
 * The longest line a file Lo shows can have: a minified bundle on one line is as slow to lay out as
 * it is large.
 */
export const MAX_LINE_BYTES = 1024 * 1024;

/**
 * Why a file is too large to show at all, from its larger side's size and its two sides' bytes
 * when they've been read; nothing when it can show.
 */
export function tooLargeToShow(
  size: number | undefined,
  sides: readonly Uint8Array[],
): string | undefined {
  if (size !== undefined && size > MAX_SHOWN_BYTES) {
    return `${sizeText(size)}, more than the 50 MiB Lo shows`;
  }
  return sides.some(hasLongLine) ? 'it has a line over 1 MiB long' : undefined;
}

/** Whether a line of `bytes` is longer than {@link MAX_LINE_BYTES}. */
function hasLongLine(bytes: Uint8Array): boolean {
  for (let start = 0; ;) {
    const end = bytes.indexOf(0x0a, start);
    if ((end < 0 ? bytes.length : end) - start > MAX_LINE_BYTES) return true;
    if (end < 0) return false;
    start = end + 1;
  }
}

/**
 * How large a file is, for a `large` {@link Collapsed}: its changed lines when there are too many,
 * otherwise its size.
 */
function largeWhy(file: ChangedFile): string {
  if (changedLines(file) > LARGE_FILE_LINES) {
    return (
      `${file.additions} lines added and ${file.deletions} deleted, more than the ` +
      `${LARGE_FILE_LINES} Lo loads at once`
    );
  }
  return `${sizeText(file.size ?? 0)}, more than the 1 MiB Lo loads at once`;
}

const KIB = 1024;
const MIB = 1024 * 1024;

/** A size in bytes, as "512 B", "2.1 KiB" or "3.4 MiB". */
export function sizeText(bytes: number): string {
  if (bytes < KIB) return `${bytes} B`;
  if (bytes < MIB) return `${tenths(bytes, KIB)} KiB`;
  return `${tenths(bytes, MIB)} MiB`;
}

/** `bytes` in `unit`s, to one decimal place, rounding a half to the even tenth. */
function tenths(bytes: number, unit: number): string {
  let whole = Math.floor((bytes * 10) / unit);
  const rest = bytes * 10 - whole * unit;
  if (rest * 2 > unit || (rest * 2 === unit && whole % 2 === 1)) whole++;
  return `${Math.floor(whole / 10)}.${whole % 10}`;
}

/** What a binary file that isn't an image shows: that it changed, and its sizes. */
export function binaryText(oldSize: number | undefined, newSize: number | undefined): string {
  if (oldSize === undefined && newSize !== undefined) {
    return `(binary file added: ${sizeOrUnknown(newSize)})`;
  }
  if (oldSize !== undefined && newSize === undefined) {
    return `(binary file deleted: ${sizeOrUnknown(oldSize)})`;
  }
  return `(binary file changed: ${sizeOrUnknown(oldSize)} → ${sizeOrUnknown(newSize)})`;
}

function sizeOrUnknown(bytes: number | undefined): string {
  return bytes === undefined ? 'size unknown' : sizeText(bytes);
}
