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

/**
 * A row the keyboard can be on: a pull request in the queue (`entry`), one waiting to join it
 * (`waiting`), or one Lo saw leave it (`left`).
 */
export interface Row {
  /** What tells it from the others, as the table keys it. */
  readonly key: string;
  readonly kind: 'entry' | 'waiting' | 'left';
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
    ...read.entries.map(({ number, url }) => ({
      key: entryKey(number),
      kind: 'entry' as const,
      number,
      url,
    })),
    ...read.waiting.map(({ number, url }) => ({
      key: waitingKey(number),
      kind: 'waiting' as const,
      number,
      url,
    })),
    ...read.left.map(({ number, url }) => ({
      key: leftKey(number),
      kind: 'left' as const,
      number,
      url,
    })),
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

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** A length of time in its largest whole unit only: "40 s", "14 min", "2 h", "4 d". */
export function lengthOf(ms: number): string {
  const at = Math.max(0, ms);
  if (at < MINUTE) return `${Math.floor(at / 1000)} s`;
  if (at < HOUR) return `${Math.floor(at / MINUTE)} min`;
  if (at < DAY) return `${Math.floor(at / HOUR)} h`;
  return `${Math.floor(at / DAY)} d`;
}

/** How long an entry has been in the queue, from when it joined: "14 min", or "—" when unknown. */
export function inQueue(enqueuedAt: number | null, now: number): string {
  if (enqueuedAt === null) return '—';
  return lengthOf(now - enqueuedAt);
}

/** GitHub's estimate, in seconds, as an estimate says it: "about 2 min", a minute at least. */
function about(seconds: number): string {
  return `about ${lengthOf(Math.max(1, Math.round(seconds / 60)) * MINUTE)}`;
}

/** When an entry should merge, from GitHub's estimate in seconds: "about 2 min", or "—" without one. */
export function toMerge(seconds: number | null): string {
  if (seconds === null) return '—';
  return about(seconds);
}

function tableEntry(entry: Entry, now: number): TableEntry {
  return {
    key: entryKey(entry.number),
    position: entry.position,
    title: entry.title,
    number: entry.number,
    author: entry.author ?? 'Deleted account',
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
 * What a pull request waiting to join waits on before GitHub adds it, as its state: an approval,
 * its checks, both, or nothing more, which "Waiting to join" says already.
 */
export function waitsFor({ review, checks }: Pick<WaitingEntry, 'review' | 'checks'>): string {
  const facts = [
    ...(review === 'required' || review === 'changesRequested' ? ['needs approval'] : []),
    ...(checks === 'failed' ? ['checks failed'] : checks === 'running' ? ['checks running'] : []),
  ];
  return facts.join(' · ');
}

/** Those waiting to join as the table lists them. */
export function waitingOf(waiting: readonly WaitingEntry[]): TableWaiting[] {
  return waiting.map((entry) => ({
    key: waitingKey(entry.number),
    title: entry.title,
    number: entry.number,
    author: entry.author ?? 'Deleted account',
    yours: entry.yours,
    until: waitsFor(entry),
  }));
}

/**
 * How long ago `at` was, from `now`, in its largest whole unit: "just now", "3 min ago", "2 h ago",
 * "3 d ago"; and more than 30 days ago, the date: "Nov 12", with its year in another year.
 */
export function ago(at: number, now: number): string {
  const since = Math.max(0, now - at);
  if (since < MINUTE) return 'just now';
  if (since <= 30 * DAY) return `${lengthOf(since)} ago`;
  const date = new Date(at);
  const year = date.getFullYear() === new Date(now).getFullYear() ? undefined : 'numeric';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year });
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
      // Without GitHub's word, why isn't known.
      return why.reason === null ? { kind: 'unknown' } : { kind: 'other', word: why.reason };
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

/** A queue's method, as its settings line says it: by its name. */
function methodWords(method: QueueMethod): string {
  switch (method) {
    case 'merge':
      return 'Merge commit';
    case 'squash':
      return 'Squash';
    case 'rebase':
      return 'Rebase';
    default:
      method satisfies never;
      return method;
  }
}

/**
 * The queue's settings, as the header says them after the branch: "Squash · groups of up to 5 ·
 * next merge in about 6 min". Nothing for what the account may not read, or GitHub didn't
 * estimate. The method is the queue's own: every entry merges with it, those that joined with
 * auto-merge on included.
 */
export function settingsOf(read: QueueRead | undefined): string | undefined {
  if (read?.kind !== 'queue') return undefined;
  const parts = [
    ...(read.method === null ? [] : [methodWords(read.method)]),
    ...(read.groups === null
      ? []
      : [read.groups === 1 ? 'one at a time' : `groups of up to ${read.groups}`]),
    ...(read.nextMerge === null ? [] : [`next merge in ${about(read.nextMerge)}`]),
  ];
  return parts.length === 0 ? undefined : parts.join(' · ');
}

/** When the queue was last read from GitHub, as the status bar says it: "Checked 5 min ago". */
export function updated(readAt: number, now: number): string {
  return `Checked ${ago(readAt, now)}`;
}

/** When the queue is read again after a failure, counting down: "Retrying in 40 s.". */
export function retryIn(retryAt: number | null, now: number): string | undefined {
  if (retryAt === null) return undefined;
  const seconds = Math.max(1, Math.ceil((retryAt - now) / 1000));
  return seconds < 60 ? `Retrying in ${seconds} s.` : `Retrying in ${Math.ceil(seconds / 60)} min.`;
}
