// What the window knows of making a chain a GitHub stack: the dialog, while it's open, and each
// conversion main says how it goes. Only this feature writes here.

import { createStore } from 'zustand/vanilla';

import type { ConversionView, Plan } from '../contract.ts';

/**
 * The dialog, for the pull request `number` in tab `tab`:
 *
 * - `planning`: main is asking GitHub; the dialog shows only once that takes a moment (`shown`);
 * - `confirm`: the plan, for the reader to confirm; `sending` once they have, and `problem`, why
 *   main didn't run it, if it didn't;
 * - `conversion`: the conversion named `key`, as main says it goes.
 */
export type Dialog =
  | {
      readonly kind: 'planning';
      readonly tab: string;
      readonly number: number;
      readonly shown: boolean;
    }
  | {
      readonly kind: 'confirm';
      readonly tab: string;
      readonly number: number;
      readonly plan: Plan;
      readonly sending: boolean;
      readonly problem: string | undefined;
    }
  | {
      readonly kind: 'conversion';
      readonly tab: string;
      readonly number: number;
      readonly key: string;
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
