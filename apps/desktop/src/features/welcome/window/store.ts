// What the welcome knows: whether it's open, over which tab and at which step, whether the reader
// has finished it, what Lo found of Git, what GitHub CLI has to import, and whether the dialog of
// link rules is open. Only this feature writes here.

import { createStore } from 'zustand/vanilla';

import type { GitInfo } from '../../app/contract.ts';
import type { GhListing } from '../../accounts/contract.ts';

/** The welcome's steps, in order: signing in, choosing keys, setting up, opening a pull request. */
export const STEPS = ['account', 'keys', 'setup', 'open'] as const;
export type Step = (typeof STEPS)[number];

export interface WelcomeState {
  /** Whether the welcome is on screen. */
  readonly shown: boolean;
  /** Whether the welcome is open: until the reader finishes it, and again when they ask for it. */
  readonly open: boolean;
  /**
   * The tab it's open over, by its id, when the reader asked for it over a pull request or
   * Settings. Without one it's over the Recent tab, whichever tab that is now.
   */
  readonly over: string | undefined;
  /**
   * Whether the reader has done anything in the welcome since it opened: pressed a key or a button
   * in it, or asked for it.
   */
  readonly touched: boolean;
  /** The step on screen. */
  readonly step: Step;
  /** Whether the reader has finished the welcome before, once main has said. */
  readonly finished: boolean | undefined;
  /** What Lo found when it last looked for Git, once it has said. */
  readonly git: GitInfo | undefined;
  /** Whether "Check again" is looking for Git. */
  readonly checking: boolean;
  /** Whether the last look the reader asked for failed, which the line by the button says. */
  readonly checkFailed: boolean;
  /** How many looks the reader asked for have ended, so a screen reader hears each. */
  readonly checks: number;
  /** What GitHub CLI has to import, once Lo has asked; nothing when there's none Lo runs. */
  readonly gh: GhListing | undefined;
  /** Whether the dialog of rules for the apps that open links is open. */
  readonly rules: boolean;
}

export const welcomeStore = createStore<WelcomeState>()(() => ({
  shown: false,
  open: false,
  over: undefined,
  touched: false,
  step: 'account',
  finished: undefined,
  git: undefined,
  checking: false,
  checkFailed: false,
  checks: 0,
  gh: undefined,
  rules: false,
}));

/** Takes what Lo found of Git. */
export function showGit(git: GitInfo): void {
  welcomeStore.setState({ git });
}

/** Whether Git is a problem to tell the reader of: Lo looked, and found none it can use. */
export function gitProblem(
  git: GitInfo | undefined,
): git is Extract<GitInfo, { status: 'missing' | 'tooOld' }> {
  return git?.status === 'missing' || git?.status === 'tooOld';
}

/** The step after `step`, or before it: nothing past either end. */
export function stepFrom(step: Step, by: 1 | -1): Step | undefined {
  return STEPS[STEPS.indexOf(step) + by];
}
