// How the window words a pull request in a merge queue: the merge panel's line for one queued, or
// ready to join a queue, with what's ahead; the panel's row once it's leaving, and once it left;
// and the banner that says it left. Text from GitHub, such as check names and
// logins, is drawn as text without the characters that turn text around, which the components take
// out. Nothing here draws.

import { about } from '@lo/ui';

import type { Ahead, InQueue, LeftQueue, MergeState } from '../contract.ts';
import { counted, listed, ordinal, rowsOf, type PanelHead, type Row, type Who } from './words.ts';

/**
 * What's ahead in the merge queue of the branch a pull request would join, as the merge panel read
 * it as it opened: nothing yet, being read, read, or why GitHub didn't say.
 */
export type AheadRead =
  | { readonly kind: 'none' }
  | { readonly kind: 'reading' }
  | { readonly kind: 'read'; readonly ahead: Ahead }
  | { readonly kind: 'failed'; readonly why: string };

/**
 * What's ahead in a queue, after the branch: "4 ahead · merges in about 18 min". Nothing for no
 * queue, or where nothing is known of it.
 */
export function aheadWords(ahead: Ahead): string | undefined {
  if (ahead.kind === 'none') return undefined;
  const { count, atLeast, timeToMerge } = ahead;
  if (atLeast && count === 0) return undefined;
  const how = `${count}${atLeast ? '+' : ''} ahead`;
  return timeToMerge === null ? how : `${how} · merges in ${about(timeToMerge * 1000)}`;
}

/**
 * The merge panel's head for a pull request in a merge queue, or ready to join one, from `head`,
 * the head for `state` alone: where it is in the queue as Lo last read it (`queue`), or what's
 * ahead of it, as the panel read it as it opened (`ahead`).
 */
export function queueHead(
  head: PanelHead,
  state: MergeState,
  queue: InQueue | undefined,
  ahead: AheadRead,
): PanelHead {
  if (state.verdict === 'queued') {
    const place = queue?.place;
    if (place?.kind === 'unlisted' && !place.partial) {
      return {
        kind: 'waiting',
        verdict: 'Left merge queue',
        before: undefined,
        branch: undefined,
        after: 'Checking…',
      };
    }
    const position = place?.kind === 'listed' ? place.position : state.position;
    const removal = place?.kind === 'listed' && place.state === 'UNMERGEABLE';
    return {
      kind: removal ? 'blocked' : 'queued',
      verdict: removal ? 'Leaving merge queue' : 'Queued',
      before: 'In the merge queue for',
      branch: state.base,
      after: position === null ? undefined : `· ${ordinal(position)}`,
    };
  }
  if (state.verdict === 'ready' && state.action.kind === 'enqueue') {
    const before = head.after ?? '';
    switch (ahead.kind) {
      case 'read': {
        const words = aheadWords(ahead.ahead);
        return words === undefined ? head : { ...head, after: `${before} · ${words}` };
      }
      case 'failed':
        return { ...head, after: `${before} · place not known` };
      case 'none':
      case 'reading':
        return head;
      default:
        ahead satisfies never;
        return head;
    }
  }
  return head;
}

/**
 * Why a pull request left its merge queue, while that's news for `state`: not once it's queued
 * again, or merged.
 */
export function leftNow(state: MergeState, queue: InQueue | undefined): LeftQueue | undefined {
  const left = queue?.left;
  if (!left || state.verdict === 'queued' || state.verdict === 'merged') return undefined;
  return left;
}

/**
 * Why a pull request left its merge queue for `base`, in a sentence: "test (node 20) failed in the
 * merge queue." Nothing where GitHub gave no reason Lo can name.
 */
export function leftWhy(left: LeftQueue, base: string): string | undefined {
  const { why } = left;
  switch (why.kind) {
    case 'failedChecks':
      return why.checks.length > 0
        ? `${listed(why.checks.map((check) => check.name))} failed in the merge queue.`
        : 'Its checks failed in the merge queue.';
    case 'conflict':
      return `It conflicts with ${base} or a pull request ahead of it.`;
    case 'timedOut':
      return 'Its checks ran past the merge queue’s time limit.';
    case 'removed':
      return why.you
        ? 'You removed it.'
        : why.by === null
          ? 'It was removed.'
          : `${why.by} removed it.`;
    case 'other':
    case 'unknown':
      return undefined;
    default:
      why satisfies never;
      return undefined;
  }
}

/**
 * Why a pull request left its merge queue for `base`, as the panel's row says it, with the checks
 * under it.
 */
function rowWhy(left: LeftQueue, base: string): string | undefined {
  const { why } = left;
  if (why.kind === 'failedChecks' && why.checks.length > 0) {
    return `${counted(why.checks.length, 'check')} failed in the merge queue.`;
  }
  return leftWhy(left, base);
}

/** The banner's one line for pull request `number`; the panel's row says why. */
export function leftTitle(number: number): string {
  return `#${number} left the merge queue`;
}

/** How loud the banner is: a failure in the queue is a danger; the rest is news. */
export function leftTone(left: LeftQueue): 'danger' | 'warn' {
  switch (left.why.kind) {
    case 'failedChecks':
    case 'conflict':
    case 'timedOut':
      return 'danger';
    case 'removed':
    case 'other':
    case 'unknown':
      return 'warn';
    default:
      left.why satisfies never;
      return 'warn';
  }
}

/** The panel's row for a pull request that left its merge queue. */
function leftRow(left: LeftQueue, base: string): Row {
  const { why } = left;
  const checks = why.kind === 'failedChecks' ? why.checks : [];
  const glyph: Row['glyph'] =
    why.kind === 'failedChecks'
      ? 'failed'
      : why.kind === 'conflict'
        ? 'conflict'
        : why.kind === 'timedOut'
          ? 'pending'
          : why.kind === 'removed'
            ? 'review'
            : 'unknown';
  return {
    key: 'left',
    kind: leftTone(left) === 'danger' ? 'fail' : 'info',
    glyph,
    title: 'Left merge queue',
    detail: rowWhy(left, base),
    link: undefined,
    subs: checks.map((check, index) => ({
      key: `${index}`,
      name: check.name,
      note: 'failed',
      tone: 'fail',
      link: check.url === null ? undefined : { label: 'Open in browser', url: check.url },
    })),
    nextThread: false,
    inTheWay: false,
  };
}

/**
 * The merge panel's rows of the merge queue for `state`: once it left the queue without merging,
 * why, first; while queued, that it will be removed, with the checks that failed in the queue, or
 * that Lo can't see its place when GitHub left part of the queue out.
 */
export function queueRows(state: MergeState, queue: InQueue | undefined): Row[] {
  const left = leftNow(state, queue);
  if (left) return [leftRow(left, state.base)];
  const place = queue?.place;
  if (state.verdict !== 'queued' || !place) return [];
  if (place.kind === 'unlisted') {
    return place.partial
      ? [
          {
            key: 'queue-unlisted',
            kind: 'info',
            glyph: 'unknown',
            title: 'Place in merge queue not known',
            detail: undefined,
            link: undefined,
            subs: [],
            nextThread: false,
            inTheWay: false,
          },
        ]
      : [];
  }
  if (place.state !== 'UNMERGEABLE') return [];
  const count = place.failed.length;
  return [
    {
      key: 'queue-removal',
      kind: 'fail',
      glyph: 'failed',
      title:
        count > 0
          ? `${counted(count, 'check')} failed in the merge queue`
          : 'Failed in the merge queue',
      detail: 'GitHub will remove it from the merge queue.',
      link: undefined,
      subs: place.failed.map((check, index) => ({
        key: `${index}`,
        name: check.name,
        note: 'failed',
        tone: 'fail',
        link: check.url === null ? undefined : { label: 'Open in browser', url: check.url },
      })),
      nextThread: false,
      inTheWay: true,
    },
  ];
}

/** The merge panel's rows for `state` at `now`, its merge queue's first. `who` names the account. */
export function panelRows(
  state: MergeState,
  queue: InQueue | undefined,
  now?: number,
  who?: Who,
): Row[] {
  return [...queueRows(state, queue), ...rowsOf(state, now, who)];
}
