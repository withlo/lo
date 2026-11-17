// How the window words a pull request in a merge queue: the merge panel's line for one queued, or
// ready to join a queue, with what's ahead; the panel's row once it will be removed, and once it
// left; and the banner that says it left, and why. Text from GitHub, such as check names and
// logins, is drawn as text without the characters that turn text around, which the components take
// out. Nothing here draws.

import type { Ahead, InQueue, LeftQueue, MergeState } from '../contract.ts';
import {
  capitalized,
  counted,
  duration,
  listed,
  ordinal,
  PARTIAL_CHECKS,
  rowsOf,
  type PanelHead,
  type Row,
} from './words.ts';

/**
 * What's ahead in the merge queue of the branch a pull request would join, as the merge panel read
 * it as it opened: nothing yet, being read, read, or why GitHub didn't say.
 */
export type AheadRead =
  | { readonly kind: 'none' }
  | { readonly kind: 'reading' }
  | { readonly kind: 'read'; readonly ahead: Ahead }
  | { readonly kind: 'failed'; readonly why: string };

/** What's ahead in a queue, after the branch: "4 ahead, about 18 min". Nothing for no queue. */
export function aheadWords(ahead: Ahead): string | undefined {
  if (ahead.kind === 'none') return undefined;
  const { count, atLeast, timeToMerge } = ahead;
  if (atLeast && count === 0) return 'Lo can’t tell how many are ahead';
  if (!atLeast && count === 0) return 'none ahead';
  const how = `${atLeast ? 'at least ' : ''}${count} ahead`;
  return timeToMerge === null ? how : `${how}, about ${duration(timeToMerge)}`;
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
        verdict: 'Left the queue',
        into: false,
        after: `The merge queue for ${state.base} no longer lists it · Lo is reading whether it merged`,
      };
    }
    const position = place?.kind === 'listed' ? place.position : state.position;
    const removal = place?.kind === 'listed' && place.state === 'UNMERGEABLE';
    return {
      kind: removal ? 'blocked' : 'queued',
      verdict: removal ? 'Will be removed' : 'Queued',
      into: false,
      after: `In the merge queue for ${state.base}${position === null ? '' : ` · ${ordinal(position)}`}`,
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
        return { ...head, after: `${before} · Lo couldn’t read the queue` };
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
 * Why a pull request left its merge queue for `base`, as a sentence after "left the merge queue:",
 * starting in lowercase but for a name: "test (node 20) failed with its group."
 */
export function leftWhy(left: LeftQueue, base: string): string {
  const { why } = left;
  let said: string;
  switch (why.kind) {
    case 'failedChecks':
      said =
        why.checks.length > 0
          ? `${listed(why.checks.map((check) => check.name))} failed with its group.`
          : 'its checks failed with its group.';
      break;
    case 'conflict':
      said = `it conflicts with ${base} or an entry ahead of it.`;
      break;
    case 'timedOut':
      said = 'its checks ran past the queue’s time limit.';
      break;
    case 'removed':
      said = why.you
        ? 'you took it out.'
        : why.by === null
          ? 'someone took it out.'
          : `${why.by} took it out.`;
      break;
    case 'other':
      said = why.reason === null ? 'GitHub gave no reason.' : `GitHub says “${why.reason}”.`;
      break;
    case 'unknown':
      said =
        why.why !== null
          ? `Lo couldn’t read why: ${why.why.trim().replace(/[.!?]$/, '')}.`
          : left.partial
            ? 'Lo can’t tell why: GitHub left it out of its answer.'
            : 'Lo can’t tell why.';
      break;
    default:
      why satisfies never;
      said = 'Lo can’t tell why.';
  }
  return partly(left, said);
}

/** `said` of `left`, saying GitHub may have left part of why out. */
function partly(left: LeftQueue, said: string): string {
  return left.partial && left.why.kind !== 'unknown'
    ? `${said} GitHub left part of why out, so there may be more.`
    : said;
}

/**
 * Why a pull request left its merge queue for `base`, as the panel's row says it: a sentence of its
 * own, whose names from GitHub keep their case, with the checks under it.
 */
function rowWhy(left: LeftQueue, base: string): string {
  const { why } = left;
  if (why.kind === 'failedChecks') {
    const count = why.checks.length;
    return partly(
      left,
      count > 0
        ? `${counted(count, 'check')} failed with its group.`
        : 'Its checks failed with its group.',
    );
  }
  if (why.kind === 'removed' && !why.you && why.by !== null) {
    return partly(left, `Taken out by ${why.by}.`);
  }
  return capitalized(leftWhy(left, base));
}

/** The banner's first words for pull request `number`, which `leftWhy` goes on from. */
export function leftTitle(number: number): string {
  return `#${number} left the merge queue:`;
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
    title: 'It left the merge queue',
    detail: rowWhy(left, base),
    link: undefined,
    subs: checks.map((check, index) => ({
      key: `${index}`,
      name: check.name,
      note: 'failed',
      tone: 'fail',
      link: check.url === null ? undefined : { label: 'Open the run ↗', url: check.url },
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
            title: 'Lo can’t see its place in the queue',
            detail: 'GitHub left part of the queue out, or it’s longer than Lo reads.',
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
          ? `${counted(count, 'check')} failed in the queue`
          : 'It can’t merge as the queue tested it',
      detail: place.partial
        ? `GitHub takes it out of the queue. ${PARTIAL_CHECKS}`
        : 'GitHub takes it out of the queue.',
      link: undefined,
      subs: place.failed.map((check, index) => ({
        key: `${index}`,
        name: check.name,
        note: 'failed',
        tone: 'fail',
        link: check.url === null ? undefined : { label: 'Open the run ↗', url: check.url },
      })),
      nextThread: false,
      inTheWay: true,
    },
  ];
}

/** The merge panel's rows for `state` at `now`, its merge queue's first. */
export function panelRows(state: MergeState, queue: InQueue | undefined, now?: number): Row[] {
  return [...queueRows(state, queue), ...rowsOf(state, now)];
}
