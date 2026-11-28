// What a pull request's tab opens on when Settings says the overview: its overview, when it has one
// Lo can show, else its timeline, where the description is first. The tab opens on the overview's
// view, which draws the tab's placeholder until it knows, for {@link holdLimit} at most, then stays
// or hands the middle to the timeline. Handing it over, the view draws the placeholder until it's
// gone from the screen, so the timeline takes the wait over at once and the overview's own state,
// such as there being none, is never on screen on the way. Once chosen, it's never chosen again for
// the tab: an overview that comes later is offered, never switched to. A view the reader picks
// while the tab waits is where the tab stays. A tab that opened on another view, as Settings said,
// shows the overview as it is whenever the reader comes to it.

import { holdLimit } from '../../revisions/window/shared.ts';
import { tabState } from '../../tab/window/shared.ts';
import type { Known } from './facts.ts';

/** What a tab that opened on the overview stays on, once it's chosen; `waiting` until then. */
export type Opening = 'waiting' | 'overview' | 'timeline';

/**
 * What a tab that opened on the overview stays on, the overview being `known`, `waited`
 * milliseconds after the tab first drew: the overview once it's known to show, the timeline once
 * it's known not to, and the timeline when that isn't known at the bound.
 */
export function openingOf(known: Known, waited: number): Opening {
  if (known === 'shown') return 'overview';
  if (known === 'other' || waited >= holdLimit()) return 'timeline';
  return 'waiting';
}

/**
 * How a tab that opened on the overview went on:
 *
 * - `since`: when its overview view first drew, which the bound counts from;
 * - `on`: what it stayed on, once chosen: the timeline only for want of an overview to show, so
 *   one that comes later is offered;
 * - `seen`: the overview has been on screen since it showed, so it's no longer offered;
 * - `chose`: the reader showed another middle view while it waited, so it stays where they are;
 * - `handing`: it's handing its middle to the timeline, and the overview's view is still on screen.
 */
export interface Opened {
  readonly since: number | undefined;
  readonly on: Exclude<Opening, 'waiting'> | undefined;
  readonly seen: boolean;
  readonly chose: boolean;
  readonly handing: boolean;
}

export const openings = tabState<Opened>(() => ({
  since: undefined,
  on: undefined,
  seen: false,
  chose: false,
  handing: false,
}));

/**
 * Where history's place at the overview itself, at no block, goes in a tab that opened as `opened`:
 * the overview; or the timeline, where the tab went there and has never shown its overview, as
 * when the place was left while the tab still chose. It goes to the view the tab went to, not to one
 * it never did.
 */
export function overviewPlace(opened: Opened): 'overview' | 'timeline' {
  return opened.on === 'timeline' && !opened.seen ? 'timeline' : 'overview';
}

/**
 * Whether a tab that opened as `opened` offers its overview, now known as `known`: one that went to
 * the timeline for want of one, and hasn't shown it since.
 */
export function offered(opened: Opened, known: Known): boolean {
  return opened.on === 'timeline' && !opened.seen && known === 'shown';
}
