import type { Repo } from '@lo/git';

import { defineService } from '../../main/services.ts';
import type { Acting, LocalState, Opening, Tabs } from './contract.ts';

/** A pull request's tab, as features in main that show what's in it follow it. */
export interface PullTabInfo {
  readonly id: string;
  /** Its repository, by the name GitHub gives it now, once known; else as the tab was opened. */
  readonly repository: { readonly owner: string; readonly name: string };
  readonly number: number;
  /** Who it acts as on GitHub, once that's worked out. */
  readonly acting: Acting | undefined;
  /**
   * The head on screen, once the tab has been shown and GitHub has said: the head it opened at,
   * until the newer push is loaded.
   */
  readonly shown: string | undefined;
  /**
   * Whether the head on screen is the one Lo saved, shown until GitHub says which head the pull
   * request is at now, which replaces it.
   */
  readonly provisional: boolean;
  /** Its local copy. */
  readonly local: LocalState;
}

/**
 * The window's tabs, for features that open them from main, as links from other apps do, and for
 * features that show what's in a pull request's tab.
 */
export interface TabService {
  /** The tabs in the strip's order, and the one on screen. */
  list(): Tabs;
  /**
   * Opens a tab and shows it, and returns its id. A pull request already open, by any name it's
   * known by, or Settings when it's open, shows the tab it's in.
   */
  open(opening: Opening): string;
  /** What main has of a pull request's tab now, or nothing for a tab that isn't one, or is closed. */
  pull(id: string): PullTabInfo | undefined;
  /**
   * Calls `listener` with a pull request's tab's id each time what {@link TabService.pull} says of
   * it may have changed, and once it's closed. Returns a function that stops it.
   */
  onPull(listener: (id: string) => void): () => void;
  /**
   * A pull request's tab's local copy, opened, to read what's been fetched into it: nothing until
   * the tab first fetches. The tab closes it as the tab closes, so a reader never does.
   */
  clone(id: string): Promise<Repo> | undefined;
  /**
   * Says a pull request's tab's diff is drawn at `head`. If that's the head on screen, it stays
   * there from now on, until the reader loads a newer one: a head taken from what Lo saved, which
   * GitHub's first answer would otherwise replace, is no longer replaced, and a newer head from
   * GitHub is offered as a newer push instead, so the diff never moves under the reader.
   */
  drawn(id: string, head: string): void;
}

export const tabs = defineService<TabService>('tab.tabs');
