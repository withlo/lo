// What the window knows of updates: where main last said they stand, how this Lo takes one, which
// version and build it is, and whether a check the reader asked for is going. Only this feature writes here.

import { createStore } from 'zustand/vanilla';

import type { Failed, How, UpdateState } from '../contract.ts';
import type { Build } from './words.ts';

export interface UpdatesWindowState {
  /** Where updates stand: nothing on offer until main says. */
  readonly state: UpdateState;
  /**
   * How this copy of Lo takes a newer version, as main last said it with nothing on offer; an offer
   * says it itself. Which of the commands that depend on it, such as moving Lo to Applications,
   * apply while nothing is on offer.
   */
  readonly how: How | undefined;
  /** This copy of Lo's version, once main has said. */
  readonly version: string | undefined;
  /** What names this build beside its version, once main has said. */
  readonly build: Build | undefined;
  /** A check the reader asked for is going. */
  readonly checking: boolean;
  /** When a check the reader asked for last answered, in milliseconds. */
  readonly checkedAt: number | undefined;
  /** Why the last check Settings asked for failed, when it did. */
  readonly failed: Failed | undefined;
  /**
   * The offer is in view under Settings › About's Lo row, which says it whole, so its toast steps
   * aside meanwhile rather than say it twice.
   */
  readonly offerInView: boolean;
}

export const updatesStore = createStore<UpdatesWindowState>()(() => ({
  state: { status: 'idle' },
  how: undefined,
  version: undefined,
  build: undefined,
  checking: false,
  checkedAt: undefined,
  failed: undefined,
  offerInView: false,
}));

/** Shows where updates stand, as main says. */
export function showState(state: UpdateState): void {
  updatesStore.setState({ state });
}

/** Shows how this copy of Lo takes a newer version, as main says it. */
export function showHow(how: How): void {
  updatesStore.setState({ how });
}

/** Shows this copy of Lo's version, and what names its build when something does. */
export function showVersion(version: string, build?: Build): void {
  updatesStore.setState({ version, build });
}

/** Whether a check the reader asked for is going. */
export function setChecking(checking: boolean): void {
  updatesStore.setState({ checking });
}
