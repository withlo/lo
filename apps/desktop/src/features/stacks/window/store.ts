// What the window knows of converting a chain to a GitHub stack: the dialog, while it's open, and
// each conversion main says how it goes. Only this feature writes here.

import { createStore } from 'zustand/vanilla';

import type { ConversionView, Plan } from '../contract.ts';

/** Why what the dialog asked of main didn't go: a line when that's known, and the error's words. */
export interface Failure {
  readonly reason: string | null;
  readonly details: string | null;
}

/**
 * The dialog, for the pull request `number` in tab `tab`:
 *
 * - `planning`: main is checking the stack; the dialog shows only once that takes a moment
 *   (`shown`), or at once when it's checked again from the dialog; `problem` once the check
 *   failed;
 * - `confirm`: the plan, for the reader to confirm; `sending` once they have, and `problem`, why
 *   main didn't run it, if it didn't;
 * - `conversion`: the conversion named `key`, of `plan`, as main says it goes; `asking` while main
 *   is asked to undo its changes, and `problem`, why it didn't, if it didn't.
 */
export type Dialog =
  | {
      readonly kind: 'planning';
      readonly tab: string;
      readonly number: number;
      readonly shown: boolean;
      readonly problem: Failure | undefined;
    }
  | {
      readonly kind: 'confirm';
      readonly tab: string;
      readonly number: number;
      readonly plan: Plan;
      readonly sending: boolean;
      readonly problem: Failure | undefined;
    }
  | {
      readonly kind: 'conversion';
      readonly tab: string;
      readonly number: number;
      readonly key: string;
      readonly plan: Plan;
      readonly asking: boolean;
      readonly problem: Failure | undefined;
    };

export interface StacksWindowState {
  /** The dialog, or nothing while it's closed. */
  readonly dialog: Dialog | undefined;
  /** Each conversion, by its plan's key, as main last said. */
  readonly conversions: ReadonlyMap<string, ConversionView>;
}

export const stacksStore = createStore<StacksWindowState>()(() => ({
  dialog: undefined,
  conversions: new Map(),
}));
