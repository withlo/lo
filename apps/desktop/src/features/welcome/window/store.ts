// What the welcome screen knows: what Lo found of git, what gh has to import, and whether the
// dialog of link rules is open. Only this feature writes here.

import { createStore } from 'zustand/vanilla';

import type { GitInfo } from '../../app/contract.ts';
import type { GhListing } from '../../accounts/contract.ts';

export interface WelcomeState {
  /** Whether the welcome screen is on screen. */
  readonly shown: boolean;
  /** What Lo found when it last looked for git, once it has said. */
  readonly git: GitInfo | undefined;
  /** Whether "Check again" is looking for git. */
  readonly checking: boolean;
  /** Whether a look the person asked for has ended, so the notice can say what it found. */
  readonly checked: boolean;
  /** What gh has to import, once Lo has asked; nothing when there's no gh Lo runs. */
  readonly gh: GhListing | undefined;
  /** Whether the dialog of rules for link routers is open. */
  readonly rules: boolean;
}

export const welcomeStore = createStore<WelcomeState>()(() => ({
  shown: false,
  git: undefined,
  checking: false,
  checked: false,
  gh: undefined,
  rules: false,
}));

/** Takes what Lo found of git. */
export function showGit(git: GitInfo): void {
  welcomeStore.setState({ git });
}

/** Whether git is a problem to tell the person of: Lo looked, and found none it can use. */
export function gitProblem(
  git: GitInfo | undefined,
): git is Extract<GitInfo, { status: 'missing' | 'tooOld' }> {
  return git?.status === 'missing' || git?.status === 'tooOld';
}
