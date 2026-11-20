// Which of the update commands apply where updates stand now, and why one doesn't, in words for the
// reader: the app menu greys the others, and the palette says why when one is chosen anyway. Main
// refuses a command that doesn't apply as well, with these words or nearly: this is what the window
// can tell without asking.

import { BREW_UPGRADE, type How, type UpdateState } from '../contract.ts';

/** `true`, or why not. */
export type Applies = true | string;

type Offered = Extract<UpdateState, { status: 'available' }>;

/** The offer, while one is on offer. */
function offerOf(state: UpdateState): Offered | undefined {
  return state.status === 'available' ? state : undefined;
}

/** Why there's no update to do something with, or what has become of the one there is. */
function without(state: UpdateState, what: string): string {
  switch (state.status) {
    case 'idle':
      return `There’s no update to ${what}.`;
    case 'available':
      return `Lo ${state.version} isn’t downloaded yet.`;
    case 'downloading':
      return `Lo ${state.version} is downloading.`;
    case 'ready':
      return `Lo ${state.version} is ready. It installs when you quit, or now.`;
    default:
      throw new Error(`An update state Lo doesn't know: ${JSON.stringify(state satisfies never)}`);
  }
}

/** Why an offer can't be taken the way a command takes it, by how this copy of Lo takes it. */
function otherWay(offer: Offered): string {
  switch (offer.how) {
    case 'install':
      return 'Lo installs this update itself. Use "Install the update".';
    case 'move':
      return 'Lo can’t update itself from where it is. Move it to Applications first.';
    case 'brew':
      return `You installed Lo with Homebrew, so update it there: ${BREW_UPGRADE}`;
    case 'page':
      return 'Lo can’t install updates here. Download it from its release page.';
    default:
      throw new Error(
        `A way to update Lo doesn't know: ${JSON.stringify(offer.how satisfies never)}`,
      );
  }
}

/** Check for updates: whenever one isn't going. */
export function canCheck(checking: boolean): Applies {
  return checking ? 'A check is already going.' : true;
}

/** Install the update: an offer this copy of Lo takes itself. */
export function canInstall(state: UpdateState): Applies {
  const offer = offerOf(state);
  if (offer === undefined) return without(state, 'install');
  return offer.how === 'install' ? true : otherWay(offer);
}

/** Restart to update: an update that's ready. */
export function canRestart(state: UpdateState): Applies {
  switch (state.status) {
    case 'ready':
      return true;
    case 'idle':
      return 'No update is ready to install.';
    case 'available':
      return `Lo ${state.version} isn’t downloaded yet.`;
    case 'downloading':
      return `Lo ${state.version} is still downloading.`;
    default:
      throw new Error(`An update state Lo doesn't know: ${JSON.stringify(state satisfies never)}`);
  }
}

/** Why Lo can't be moved to Applications, when how it takes an update isn't to be moved. */
function stays(how: How): string {
  return how === 'page' ? 'Lo can’t move itself from here.' : 'Lo is in Applications already.';
}

/**
 * Move Lo to Applications: where Lo must be moved to update itself, which an offer says, and main
 * says with none on offer, as `how`, until when it can't be told. With a download going or ready,
 * Lo is in Applications already.
 */
export function canMove(state: UpdateState, how: How | undefined): Applies {
  switch (state.status) {
    case 'idle':
      if (how === undefined) return 'Lo can’t tell yet whether it needs to move.';
      return how === 'move' ? true : stays(how);
    case 'available':
      return state.how === 'move' ? true : stays(state.how);
    case 'downloading':
    case 'ready':
      return stays('install');
    default:
      throw new Error(`An update state Lo doesn't know: ${JSON.stringify(state satisfies never)}`);
  }
}

/** Hide the update until Lo restarts: an offer. */
export function canHide(state: UpdateState): Applies {
  return state.status === 'available' ? true : without(state, 'hide');
}

/** What's new: an update, on offer, downloading or ready, has a release page. */
export function canOpenNotes(state: UpdateState): Applies {
  return state.status === 'idle' ? 'There’s no update to read about.' : true;
}

/** Download the update: an offer whose way is its release page. */
export function canDownload(state: UpdateState): Applies {
  const offer = offerOf(state);
  if (offer === undefined) return without(state, 'download');
  return offer.how === 'page' ? true : otherWay(offer);
}

/** Copy the Homebrew command: an offer that's updated through Homebrew. */
export function canCopy(state: UpdateState): Applies {
  const offer = offerOf(state);
  if (offer === undefined) return without(state, 'update with Homebrew');
  return offer.how === 'brew' ? true : otherWay(offer);
}

/** Go to the update: while its toast is there. */
export function canGoTo(state: UpdateState): Applies {
  return state.status === 'idle' ? 'There’s no update to go to.' : true;
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
