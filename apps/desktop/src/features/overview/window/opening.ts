// What a pull request's tab opens on: its overview, when it has one Lo can show and Settings says
// to open on it, else its diff. The overview is the first middle view, so the tab starts on it; it
// draws the tab's placeholder until it knows, for {@link holdLimit} at most, then stays or hands
// the middle to the diff before either has drawn anything. Once chosen, it's never chosen again for
// the tab: an overview that comes later is offered, never switched to. A view the reader picks
// while the tab waits is where the tab stays.

import { holdLimit } from '../../revisions/window/shared.ts';
import { tabState } from '../../tab/window/shared.ts';
import type { OpenOn } from '../settings.ts';
import type { Known } from './facts.ts';

/** What a tab opens on, once it's chosen; `waiting` until then. */
export type Opening = 'waiting' | 'overview' | 'diff';

/**
 * What the tab opens on, once `setting` is known (`undefined` until main has said what the
 * settings file holds): the diff when Settings says so; else the overview once it's known to show,
 * the diff once it's known not to, and the diff when either isn't known `waited` milliseconds
 * after the tab first drew, at the bound.
 */
export function openingOf(setting: OpenOn | undefined, known: Known, waited: number): Opening {
  if (waited >= holdLimit() && (setting === undefined || known === 'unknown')) return 'diff';
  if (setting === undefined) return 'waiting';
  if (setting === 'diff') return 'diff';
  if (known === 'shown') return 'overview';
  if (known === 'other') return 'diff';
  return 'waiting';
}

/**
 * How a tab opened:
 *
 * - `since`: when its overview view first drew, which the bound counts from;
 * - `on`: what it opened on, once chosen;
 * - `late`: it opened on the diff for want of an overview to show, not because Settings said, so
 *   one that comes later is offered;
 * - `seen`: the overview has been on screen since it showed, so it's no longer offered;
 * - `chose`: the reader showed another middle view while it waited, so it stays where they are.
 */
export interface Opened {
  readonly since: number | undefined;
  readonly on: Exclude<Opening, 'waiting'> | undefined;
  readonly late: boolean;
  readonly seen: boolean;
  readonly chose: boolean;
}

export const openings = tabState<Opened>(() => ({
  since: undefined,
  on: undefined,
  late: false,
  seen: false,
  chose: false,
}));

/**
 * Whether a tab that opened as `opened` offers its overview, now known as `known`, with Settings
 * saying `setting`: only while Settings is known to say the overview, which a tab that opened
 * before main said may not.
 */
export function offered(opened: Opened, known: Known, setting: OpenOn | undefined): boolean {
  return (
    setting === 'overview' &&
    opened.on === 'diff' &&
    opened.late &&
    !opened.seen &&
    known === 'shown'
  );
}
