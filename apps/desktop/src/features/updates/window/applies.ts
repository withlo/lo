// Which of the update commands apply where updates stand now, and why one doesn't, in words for the
// reader: the app menu greys the others, and the palette says why when one is chosen anyway. Main
// refuses a command that doesn't apply as well, with these words or nearly: this is what the window
// can tell without asking.

import type { How, UpdateState } from '../contract.ts';

/** `true`, or why not. */
export type Applies = true | string;

type Offered = Extract<UpdateState, { status: 'available' }>;

/** The offer, while one is on offer. */
function offerOf(state: UpdateState): Offered | undefined {
  return state.status === 'available' ? state : undefined;
}

/** Why there's no update to do something with, or what has become of the one there is. */
function without(state: UpdateState): string {
  switch (state.status) {
    case 'idle':
      return 'No update available';
    case 'available':
      return `Lo ${state.version} isn’t downloaded`;
    case 'downloading':
      return `Lo ${state.version} is downloading`;
    case 'ready':
      return `Lo ${state.version} is ready`;
    default:
      throw new Error(`An update state Lo doesn’t know: ${JSON.stringify(state satisfies never)}`);
  }
}

/** Why an offer can't be taken the way a command takes it, by how this copy of Lo takes it. */
function otherWay(offer: Offered): string {
  switch (offer.how) {
    case 'install':
      return 'This copy of Lo updates itself';
    case 'move':
      return 'Move Lo to Applications first';
    case 'brew':
      return 'This copy of Lo updates with Homebrew';
    case 'page':
      return 'This copy of Lo can’t update itself';
    default:
      throw new Error(
        `A way to update Lo doesn’t know: ${JSON.stringify(offer.how satisfies never)}`,
      );
  }
}

/** Check for updates: whenever one isn't going. */
export function canCheck(checking: boolean): Applies {
  return checking ? 'Already checking' : true;
}

/** Update Lo: an offer this copy of Lo takes itself. */
export function canInstall(state: UpdateState): Applies {
  const offer = offerOf(state);
  if (offer === undefined) return without(state);
  return offer.how === 'install' ? true : otherWay(offer);
}

/** Restart to update: an update that's ready. */
export function canRestart(state: UpdateState): Applies {
  switch (state.status) {
    case 'ready':
      return true;
    case 'idle':
      return 'No update is ready';
    case 'available':
      return `Lo ${state.version} isn’t downloaded`;
    case 'downloading':
      return `Lo ${state.version} is downloading`;
    default:
      throw new Error(`An update state Lo doesn’t know: ${JSON.stringify(state satisfies never)}`);
  }
}

/** Why Lo can't be moved to Applications, when how it takes an update isn't to be moved. */
function stays(how: How): string {
  return how === 'page' ? 'This copy of Lo can’t be moved' : 'Already in Applications';
}

/**
 * Move Lo to Applications: where Lo must be moved to update itself, which an offer says, and main
 * says with none on offer, as `how`, until when it can't be told. With a download going or ready,
 * Lo is in Applications already.
 */
export function canMove(state: UpdateState, how: How | undefined): Applies {
  switch (state.status) {
    case 'idle':
      if (how === undefined) return 'Checking where Lo is installed';
      return how === 'move' ? true : stays(how);
    case 'available':
      return state.how === 'move' ? true : stays(state.how);
    case 'downloading':
    case 'ready':
      return stays('install');
    default:
      throw new Error(`An update state Lo doesn’t know: ${JSON.stringify(state satisfies never)}`);
  }
}

/** Hide the update until Lo restarts: an offer. */
export function canHide(state: UpdateState): Applies {
  return state.status === 'available' ? true : without(state);
}

/** Download the update: an offer whose way is its release page. */
export function canDownload(state: UpdateState): Applies {
  const offer = offerOf(state);
  if (offer === undefined) return without(state);
  return offer.how === 'page' ? true : otherWay(offer);
}

/** Copy the Homebrew command: an offer that's updated through Homebrew. */
export function canCopy(state: UpdateState): Applies {
  const offer = offerOf(state);
  if (offer === undefined) return without(state);
  return offer.how === 'brew' ? true : otherWay(offer);
}

/** Go to the update: while its toast is there. */
export function canGoTo(state: UpdateState): Applies {
  return state.status === 'idle' ? 'No update available' : true;
}

/**
 * What the app menu depends on: the state's status and how it's taken, which change the answers
 * above, but not a download's progress, which would send the menu again at every step. With
 * nothing on offer, how Lo takes an update is `how`, as main last said.
 */
export function menuKey(state: UpdateState, checking: boolean, how: How | undefined): string {
  const way = state.status === 'available' ? state.how : state.status === 'idle' ? how : undefined;
  return `${state.status}${way === undefined ? '' : `-${way}`}${checking ? '-checking' : ''}`;
}
