// What the window knows of updates: where main last said they stand, which version and build this
// Lo is, and whether a check the reader asked for is going. Only this feature writes here.

import { createStore } from 'zustand/vanilla';

import type { UpdateState } from '../contract.ts';

export interface UpdatesWindowState {
  /** Where updates stand: nothing on offer until main says. */
  readonly state: UpdateState;
  /** This copy of Lo's version, once main has said. */
  readonly version: string | undefined;
  /** What names this build beside its version, as {@link buildText} says it, once main has said. */
  readonly build: string | undefined;
  /** A check the reader asked for is going. */
  readonly checking: boolean;
}

export const updatesStore = createStore<UpdatesWindowState>()(() => ({
  state: { status: 'idle' },
  version: undefined,
  build: undefined,
  checking: false,
}));

/** Shows where updates stand, as main says. */
export function showState(state: UpdateState): void {
  updatesStore.setState({ state });
}

/** Shows this copy of Lo's version, and what names its build when something does. */
export function showVersion(version: string, build?: string): void {
  updatesStore.setState({ version, build });
}

/** Whether a check the reader asked for is going. */
export function setChecking(checking: boolean): void {
  updatesStore.setState({ checking });
}
