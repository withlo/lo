// What a pull request's tab opens on: its overview, when it has one Lo can show and Settings says
// to open on it, else its diff. The overview is the first middle view, so the tab starts on it; it
// draws the tab's placeholder until it knows, for {@link HOLD_LIMIT} at most, then stays or hands
// the middle to the diff before either has drawn anything. Once chosen, it's never chosen again for
// the tab: an overview that comes later is offered, never switched to.

import { HOLD_LIMIT } from '../../revisions/contract.ts';
import { tabState } from '../../tab/window/shared.ts';
import type { OpenOn } from '../settings.ts';
import type { Known } from './facts.ts';

/** What a tab opens on, once it's chosen; `waiting` until then. */
export type Opening = 'waiting' | 'overview' | 'diff';

/**
 * What the tab opens on: the diff when Settings says so; else the overview once it's known to
 * show, the diff once it's known not to, and the diff when it isn't known `waited` milliseconds
 * after the tab first drew, at the bound.
 */
export function openingOf(setting: OpenOn, known: Known, waited: number): Opening {
  if (setting === 'diff') return 'diff';
  if (known === 'shown') return 'overview';
  if (known === 'other') return 'diff';
  return waited >= HOLD_LIMIT ? 'diff' : 'waiting';
}

/**
 * How a tab opened:
 *
 * - `since`: when its overview view first drew, which the bound counts from;
 * - `on`: what it opened on, once chosen;
 * - `late`: it opened on the diff for want of an overview to show, not because Settings said, so
 *   one that comes later is offered;
 * - `seen`: the overview has been on screen since it showed, so it's no longer offered.
 */
export interface Opened {
  readonly since: number | undefined;
  readonly on: Exclude<Opening, 'waiting'> | undefined;
  readonly late: boolean;
  readonly seen: boolean;
}

export const openings = tabState<Opened>(() => ({
  since: undefined,
  on: undefined,
  late: false,
  seen: false,
}));

/** Whether a tab that opened as `opened` offers its overview, now known as `known`. */
export function offered(opened: Opened, known: Known): boolean {
  return opened.on === 'diff' && opened.late && !opened.seen && known === 'shown';
}
