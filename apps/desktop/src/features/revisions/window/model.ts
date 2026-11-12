// What the revision picker, the header's button and the note over the diff say of a pull request's
// revisions: their labels, the rows, the ends a key moves, the shortcuts and the note. Pure
// functions of what main sent, so they're tested without a window.

import type { RevisionPickerRow, RevisionShortcut, RevisionTag } from '@lo/ui';

import type { Compared, ComparisonView, RevisionRow } from '../contract.ts';

/** The base's row in the picker, last. */
export const BASE = 'base';

/** The two rows a comparison runs between: a row's key, the base's included. */
export interface Ends {
  readonly from: string;
  readonly to: string;
}

/** A head, cut short as git does. */
export function short(head: string): string {
  return head.slice(0, 7);
}

/** A revision's label: `r3`, or its head cut short for a commit reviewed but never pushed. */
export function labelOf(view: ComparisonView, head: string): string {
  const number = view.revisions.find((revision) => revision.head === head)?.number;
  return number === undefined || number === null ? short(head) : `r${number}`;
}

/** What a comparison runs between, as the button says it: `base → r5`, `r3 → r5`. */
export function comparisonLabel(view: ComparisonView, compared: Compared): string {
  const from = compared.from === null ? 'base' : labelOf(view, compared.from);
  return `${from} → ${labelOf(view, compared.to)}`;
}

/**
 * Why a comparison starts where it does, when a marker or the whole pull request says: "since your
 * review", "since you last looked", "every change".
 */
export function reasonOf(view: ComparisonView, compared: Compared): string | undefined {
  if (compared.from === null) return 'every change';
  if (compared.from === view.markers.review) return 'since your review';
  if (compared.from === view.markers.lastSeen) return 'since you last looked';
  return undefined;
}

/** How long ago `at` was, in words, from `now`. */
export function ago(at: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  const days = Math.round(hours / 24);
  return `${days} ${days === 1 ? 'day' : 'days'} ago`;
}

/** What a revision's push did, as its row says it. */
function lineOf(view: ComparisonView, revision: RevisionRow, index: number): string {
  if (!revision.available) return 'No longer available';
  if (revision.number === null) return 'Reviewed, never pushed';
  if (revision.forced) {
    return revision.rebased && view.base
      ? `Force-pushed · rebased onto ${view.base.branch}`
      : 'Force-pushed';
  }
  if (index === 0) return 'Opened';
  return revision.rebased && view.base ? `Pushed onto a newer ${view.base.branch}` : 'Pushed';
}

/** Who pushed a revision, when, and its head. */
function metaOf(revision: RevisionRow, now: number): string {
  const when =
    revision.pushedAt.kind === 'exact'
      ? ago(revision.pushedAt.at, now)
      : revision.pushedAt.kind === 'by'
        ? `seen ${ago(revision.pushedAt.at, now)}`
        : undefined;
  return [revision.pusher, when, short(revision.head)]
    .filter((part) => part !== undefined && part !== null)
    .join(' · ');
}

/** The picker's rows: the revisions, newest first, then the base. */
export function rowsOf(view: ComparisonView, now: number): RevisionPickerRow[] {
  const newest = view.revisions.at(-1)?.head;
  const rows = view.revisions.map((revision, index): RevisionPickerRow => {
    const tags: RevisionTag[] = [];
    if (revision.head === newest) tags.push({ label: 'Newest', kind: 'newest' });
    if (revision.head === view.markers.review) tags.push({ label: 'Your review', kind: 'review' });
    if (revision.head === view.markers.lastSeen) {
      tags.push({ label: 'Last seen here', kind: 'seen' });
    }
    return {
      key: revision.head,
      label: revision.number === null ? '' : `r${revision.number}`,
      line: lineOf(view, revision, index),
      forced: revision.available && revision.forced === true,
      meta: metaOf(revision, now),
      tags,
      disabled: !revision.available,
    };
  });
  const base: RevisionPickerRow = {
    key: BASE,
    label: 'base',
    line: view.base?.branch ?? 'The base branch',
    meta:
      view.base?.tip === null || view.base === null
        ? 'Where each revision branched off'
        : `at ${short(view.base.tip)}`,
    base: true,
  };
  return [...rows.toReversed(), base];
}

/** The ends of `compared`, as rows' keys. */
export function endsOf(compared: Compared): Ends {
  return { from: compared.from ?? BASE, to: compared.to };
}

/** What `ends` compare, for main. */
export function comparedOf(ends: Ends): Compared {
  return { from: ends.from === BASE ? null : ends.from, to: ends.to };
}

/** The row `step` rows on from `focused`, stopping at either end. */
export function moved(
  rows: readonly RevisionPickerRow[],
  focused: string | undefined,
  step: 1 | -1,
): string | undefined {
  const at = rows.findIndex((row) => row.key === focused);
  const next = at < 0 ? 0 : Math.min(rows.length - 1, Math.max(0, at + step));
  return rows[next]?.key;
}

/**
 * The ends once `key`'s row becomes one: it takes the place of the nearer end, or of the newer when
 * it's newer than both, or the older when it's older than both. A row that can't be compared, or
 * the base as the newer end, changes nothing.
 */
export function withEnd(rows: readonly RevisionPickerRow[], ends: Ends, key: string): Ends {
  const row = rows.find((each) => each.key === key);
  if (!row || row.disabled) return ends;
  // Newest first: a lower index is newer.
  const at = rows.indexOf(row);
  const to = rows.findIndex((each) => each.key === ends.to);
  const from = rows.findIndex((each) => each.key === ends.from);
  if (at === to || at === from) return ends;
  let next: Ends;
  if (at < to) next = { from: ends.from, to: key };
  else if (at > from) next = { from: key, to: ends.to };
  else next = at - to < from - at ? { from: ends.from, to: key } : { from: key, to: ends.to };
  return next.to === BASE ? ends : next;
}

/** The comparisons the picker's shortcuts make, if they can be made. */
export interface Shortcuts {
  readonly review: Compared | undefined;
  readonly seen: Compared | undefined;
  readonly whole: Compared | undefined;
}

/** What each shortcut compares: since a marker, or the whole pull request, up to the head on screen. */
export function shortcutsOf(view: ComparisonView): Shortcuts {
  const to = view.shown;
  if (to === null) return { review: undefined, seen: undefined, whole: undefined };
  const end = view.revisions.findIndex((revision) => revision.head === to);
  const since = (marker: string | null): Compared | undefined => {
    if (marker === null) return undefined;
    const at = view.revisions.findIndex((revision) => revision.head === marker);
    if (at < 0 || end < 0 || at >= end) return undefined;
    return view.revisions[at]?.available ? { from: marker, to } : undefined;
  };
  return {
    review: since(view.markers.review),
    seen: since(view.markers.lastSeen),
    whole: { from: null, to },
  };
}

/** The shortcuts as the picker shows them, each with its key. */
export function shortcutRows(
  view: ComparisonView,
  keys: {
    review?: string[] | undefined;
    seen?: string[] | undefined;
    whole?: string[] | undefined;
  },
): RevisionShortcut[] {
  const shortcuts = shortcutsOf(view);
  const on = view.comparison;
  const pressed = (compared: Compared | undefined) =>
    compared !== undefined && on !== null && compared.from === on.from && compared.to === on.to;
  const rows: RevisionShortcut[] = [];
  if (shortcuts.review) {
    rows.push({
      id: 'review',
      label: `Since your review · ${comparisonLabel(view, shortcuts.review)}`,
      keys: keys.review,
      pressed: pressed(shortcuts.review),
    });
  }
  if (shortcuts.seen) {
    rows.push({
      id: 'seen',
      label: `Since last seen · ${comparisonLabel(view, shortcuts.seen)}`,
      keys: keys.seen,
      pressed: pressed(shortcuts.seen),
    });
  }
  if (shortcuts.whole) {
    rows.push({
      id: 'whole',
      label: `Whole PR · ${comparisonLabel(view, shortcuts.whole)}`,
      keys: keys.whole,
      pressed: pressed(shortcuts.whole),
    });
  }
  return rows;
}

/** What the note over the diff says, and how: as information, or as a warning. */
export interface Note {
  readonly text: string;
  readonly tone: 'plain' | 'info' | 'warn';
}

/**
 * The note over the diff: what it compares, and anything to know about how. A comparison offered,
 * which came too late to be drawn first, is named with the key that opens the picker at it,
 * `pickerKey`.
 */
export function noteOf(view: ComparisonView | undefined, pickerKey = 'gv'): Note {
  if (!view || view.comparison === null) {
    const pending = view?.pending;
    if (view && pending) {
      return {
        tone: 'plain',
        text: `Comparing ${comparisonLabel(view, pending)} once the local copy has both…`,
      };
    }
    return { tone: 'plain', text: 'Every change in the pull request' };
  }
  const { comparison } = view;
  const label = comparisonLabel(view, comparison);
  const reason = reasonOf(view, comparison);
  const parts: string[] = [
    comparison.from === null ? `Every change, ${label}` : reason ? `${label}, ${reason}` : label,
  ];
  let tone: Note['tone'] = 'plain';
  if (view.problem !== null) {
    parts.push(view.problem);
    tone = 'warn';
  } else if (view.replay === 'conflicted') {
    const from = comparison.from === null ? 'the base' : labelOf(view, comparison.from);
    const files = view.conflicted === 1 ? '1 file' : `${view.conflicted} files`;
    parts.push(
      `Lo couldn’t replay ${from} across the rebase, so this compares the heads, and shows what came with the base too${view.conflicted > 0 ? `: ${files} had conflicts` : ''}`,
    );
    tone = 'warn';
  } else if (view.replay === 'retargeted') {
    parts.push(
      'The base changed in a way a rebase doesn’t explain, so some of this may have come with it',
    );
    tone = 'warn';
  } else if (view.uncertain) {
    parts.push('Lo isn’t sure where a revision branched off, so some of this may be the base’s');
    tone = 'warn';
  } else if (view.replay === 'clean') {
    parts.push('across a rebase: only what the author changed');
  }
  if (tone === 'plain' && view.pending) {
    parts.push(`comparing ${comparisonLabel(view, view.pending)} once the local copy has both…`);
  } else if (tone === 'plain' && view.offered) {
    const why = reasonOf(view, view.offered);
    parts.push(`${comparisonLabel(view, view.offered)}${why ? `, ${why}` : ''}: ${pickerKey}`);
    return { tone: 'info', text: parts.join(' · ') };
  }
  if (tone === 'plain' && view.nothingNewSince !== null && comparison.from === null) {
    parts.push(`Nothing new since ${labelOf(view, view.nothingNewSince)}`);
    tone = 'info';
  }
  return { tone, text: parts.join(' · ') };
}
