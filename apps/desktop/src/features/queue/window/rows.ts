// How a merge queue's tab words what main read: each entry's state and times, the entries GitHub
// tests together as one group, those waiting to join and what they wait for, those Lo saw leave
// and why, the queue's settings, and how long ago it was read. And the rows the keyboard moves
// through, in the table's order. Nothing here touches the DOM.

import type {
  LeftEntry as TableLeft,
  LeftReason,
  QueueItem,
  QueueEntry as TableEntry,
  WaitingEntry as TableWaiting,
} from '@lo/ui';

import type {
  Entry,
  EntryState,
  LeftEntry,
  QueueMethod,
  QueueRead,
  WaitingEntry,
} from '../contract.ts';

/** A row the keyboard can be on: a pull request in the queue, or one waiting to join it. */
export interface Row {
  /** What tells it from the others, as the table keys it. */
  readonly key: string;
  readonly number: number;
  /** Its page on GitHub. */
  readonly url: string;
}

/** An entry's key in the table. */
export function entryKey(number: number): string {
  return `queued-${number}`;
}

/** A pull request waiting to join's key in the table. */
export function waitingKey(number: number): string {
  return `waiting-${number}`;
}

/** A pull request that left the queue's key in the table. */
export function leftKey(number: number): string {
  return `left-${number}`;
}

/**
 * The rows the keyboard moves through, in the table's order: the entries, then those waiting to
 * join, then those Lo saw leave the queue.
 */
export function rowsOf(read: QueueRead | undefined): Row[] {
  if (read?.kind !== 'queue') return [];
  return [
    ...read.entries.map(({ number, url }) => ({ key: entryKey(number), number, url })),
    ...read.waiting.map(({ number, url }) => ({ key: waitingKey(number), number, url })),
    ...read.left.map(({ number, url }) => ({ key: leftKey(number), number, url })),
  ];
}

/** The row the keyboard is on among `rows`: the one `key` names while it's there, or the first. */
export function focusedRow(rows: readonly Row[], key: string | undefined): Row | undefined {
  return rows.find((row) => row.key === key) ?? rows[0];
}

/** The row `by` rows from the one the keyboard is on, staying put at the ends. */
export function stepRow(
  rows: readonly Row[],
  key: string | undefined,
  by: 1 | -1,
): Row | undefined {
  const at = rows.findIndex((row) => row.key === focusedRow(rows, key)?.key);
  return rows[Math.min(Math.max(at + by, 0), rows.length - 1)];
}

/** How the table draws an entry's state: its checks running, waiting its turn, or about to go. */
export function tableState(state: EntryState): TableEntry['state'] {
  switch (state) {
    case 'AWAITING_CHECKS':
      return 'running';
    case 'QUEUED':
    case 'MERGEABLE':
    case 'LOCKED':
      return 'waiting';
    case 'UNMERGEABLE':
      return 'removal';
    default:
      state satisfies never;
      return 'waiting';
  }
}

/** A length of time in minutes, as the table gives it: "14 min", "2 h", "1 h 5 min". */
function minutes(count: number): string {
  if (count < 60) return `${count} min`;
  const hours = Math.floor(count / 60);
  const rest = count % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

/** How long an entry has been in the queue, from when it joined: "14 min", or "—" when unknown. */
export function inQueue(enqueuedAt: number | null, now: number): string {
  if (enqueuedAt === null) return '—';
  const count = Math.floor(Math.max(0, now - enqueuedAt) / 60_000);
  return count < 1 ? '<1 min' : minutes(count);
}

/** When an entry should merge, from GitHub's estimate in seconds: "~2 min", or "—" without one. */
export function toMerge(seconds: number | null): string {
  if (seconds === null) return '—';
  return `~${minutes(Math.max(1, Math.round(seconds / 60)))}`;
}

function tableEntry(entry: Entry, now: number): TableEntry {
  return {
    key: entryKey(entry.number),
    position: entry.position,
    title: entry.title,
    number: entry.number,
    author: entry.author ?? 'A deleted account',
    state: tableState(entry.state),
    inQueue: inQueue(entry.enqueuedAt, now),
    merges: toMerge(entry.timeToMerge),
    yours: entry.yours,
    stack:
      entry.stack === null
        ? undefined
        : { layers: entry.stack.layers, range: `#${entry.stack.first}–#${entry.stack.last}` },
  };
}

/**
 * The queue's entries as the table lists them, in order: those GitHub tests together, from the
 * front, as one group, then the others one by one.
 */
export function itemsOf(entries: readonly Entry[], now: number): QueueItem[] {
  const together = entries.filter((entry) => entry.testedTogether);
  const items: QueueItem[] = [];
  let grouped = false;
  for (const entry of entries) {
    if (!entry.testedTogether) {
      items.push({ kind: 'entry', entry: tableEntry(entry, now) });
    } else if (!grouped) {
      grouped = true;
      items.push({
        kind: 'group',
        group: {
          key: `together-${entry.number}`,
          entries: together.map((each) => tableEntry(each, now)),
        },
      });
    }
  }
  return items;
}

/**
 * What a pull request waiting to join waits for before GitHub adds it: an approval, its checks, or
 * nothing more, in which case GitHub adds it shortly.
 */
export function waitsFor({ review, checks }: Pick<WaitingEntry, 'review' | 'checks'>): string {
  const approval = review === 'required' || review === 'changesRequested';
  const check =
    checks === 'failed'
      ? 'its failed checks pass'
      : checks === 'running'
        ? 'checks pass'
        : undefined;
  if (approval && check !== undefined) return `when approved and ${check}`;
  if (approval) return 'when approved';
  if (check !== undefined) return `when ${check}`;
  return 'when GitHub adds it';
}

/** Those waiting to join as the table lists them. */
export function waitingOf(waiting: readonly WaitingEntry[]): TableWaiting[] {
  return waiting.map((entry) => ({
    key: waitingKey(entry.number),
    title: entry.title,
    number: entry.number,
    author: entry.author ?? 'A deleted account',
    yours: entry.yours,
    until: waitsFor(entry),
  }));
}

/** How long ago `at` was, from `now`: "just now", "3 min ago", "2 h ago", "3 days ago". */
export function ago(at: number, now: number): string {
  const count = Math.floor(Math.max(0, now - at) / 60_000);
  if (count < 1) return 'just now';
  if (count < 60) return `${count} min ago`;
  const hours = Math.floor(count / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? 'day' : 'days'} ago`;
}

/** Why a pull request left, as the table says it, its failed check's run opening with `open`. */
function reasonOf(left: LeftEntry, open: (url: string) => void): LeftReason {
  const { why } = left;
  switch (why.kind) {
    case 'merged':
    case 'conflict':
    case 'timedOut':
    case 'unknown':
      return { kind: why.kind };
    case 'failedChecks': {
      const [check] = why.checks;
      const url = check?.url ?? null;
      return {
        kind: 'failed',
        check:
          check === undefined || url === null
            ? undefined
            : { name: check.name, onOpen: () => open(url) },
      };
    }
    case 'removed':
      return { kind: 'removed', by: why.by ?? undefined };
    case 'other':
      return { kind: 'other', word: why.reason ?? 'GitHub gave no reason' };
    default:
      why satisfies never;
      return { kind: 'unknown' };
  }
}

/**
 * Those Lo saw leave the queue as the table lists them at `now`, the latest first, each with why,
 * when, and how long it had been in the queue; a failed check's run opens with `open`.
 */
export function leftOf(
  left: readonly LeftEntry[],
  now: number,
  open: (url: string) => void,
): TableLeft[] {
  return left.map((entry) => ({
    key: leftKey(entry.number),
    title: entry.title,
    number: entry.number,
    reason: reasonOf(entry, open),
    when: ago(entry.at, now),
    inQueue: entry.enqueuedAt === null ? undefined : inQueue(entry.enqueuedAt, entry.at),
    partial: entry.partial,
  }));
}

/** A queue's method, as its settings line says it. */
function methodWords(method: QueueMethod): string {
  switch (method) {
    case 'merge':
      return 'merge commits';
    case 'squash':
      return 'squash';
    case 'rebase':
      return 'rebase';
    default:
      method satisfies never;
      return method;
  }
}

/**
 * The queue's settings, as the header says them after the branch: "squash, groups of up to 5 ·
 * next merges in about 6 min". Nothing for what the account may not read, or GitHub didn't
 * estimate. The method is the queue's own: every entry merges with it, those that joined with
 * auto-merge on included.
 */
export function settingsOf(read: QueueRead | undefined): string | undefined {
  if (read?.kind !== 'queue') return undefined;
  const how = [
    ...(read.method === null ? [] : [methodWords(read.method)]),
    ...(read.groups === null
      ? []
      : [read.groups === 1 ? 'one at a time' : `groups of up to ${read.groups}`]),
  ].join(', ');
  const next =
    read.nextMerge === null
      ? undefined
      : `next merges in about ${minutes(Math.max(1, Math.round(read.nextMerge / 60)))}`;
  const parts = [how, next].filter((part) => part !== undefined && part !== '');
  return parts.length === 0 ? undefined : parts.join(' · ');
}

/** When the queue was last read, as the status bar says it: "Updated 10 s ago". */
export function updated(readAt: number, now: number): string {
  const seconds = Math.floor(Math.max(0, now - readAt) / 1000);
  if (seconds < 5) return 'Updated just now';
  if (seconds < 60) return `Updated ${seconds} s ago`;
  return `Updated ${minutes(Math.floor(seconds / 60))} ago`;
}

/** When Lo reads again after a failure, as a failure's note says it: "in 40 s". */
export function retryIn(retryAt: number | null, now: number): string | undefined {
  if (retryAt === null) return undefined;
  const seconds = Math.max(1, Math.ceil((retryAt - now) / 1000));
  return seconds < 60 ? `in ${seconds} s` : `in ${minutes(Math.ceil(seconds / 60))}`;
}
