import type { Repo } from '@lo/git';

import { defineService } from '../../main/services.ts';
import type { Acting, LocalState, Opening, Stack, Tabs } from './contract.ts';

/**
 * A view of a pull request's tab, as features in main that show what's in it follow it: the tab's
 * view of the pull request it opened on, by the tab's id, or of another layer of a stack it holds,
 * by `<tab id>:<number>`. Each keeps its own place, comparison and overview.
 */
export interface PullTabInfo {
  readonly id: string;
  /** Its repository, by the name GitHub gives it now, once known; else as the tab was opened. */
  readonly repository: { readonly owner: string; readonly name: string };
  readonly number: number;
  /** Who it acts as on GitHub, once that's worked out. */
  readonly acting: Acting | undefined;
  /**
   * Where the pull request's head is, once GitHub has said: `fork` names the fork it's in, or is
   * `null` when it's in the pull request's own repository, or in a fork GitHub no longer has.
   */
  readonly head:
    { readonly fork: { readonly owner: string; readonly name: string } | null } | undefined;
  /**
   * The head on screen, once the tab has been shown and GitHub has said: the head it opened at,
   * until the newer push is loaded.
   */
  readonly shown: string | undefined;
  /** GitHub's newest head, as far as the tab knows: the head on screen, or a newer push. */
  readonly latest: string | undefined;
  /**
   * Whether the head on screen is the one Lo saved, shown until GitHub says which head the pull
   * request is at now, which replaces it.
   */
  readonly provisional: boolean;
  /** Its local copy. */
  readonly local: LocalState;
  /**
   * The commit its diff starts from, for a stack's layer compared with the layer below it
   * ({@link TabService.compareFrom}); nothing while it's compared with its base branch, as GitHub
   * compares a pull request. The local copy says where the head meets it, once it's worked out.
   */
  readonly compareFrom: string | undefined;
  /**
   * Whether its diff has been drawn at the head on screen since it was last told where to start:
   * from then on, a new start would move what the reader is reading.
   */
  readonly drawn: boolean;
}

/**
 * The window's tabs, for features that open them from main, as links from other apps do, and for
 * features that show what's in a pull request's tab. A pull request's tab holds a view of each
 * layer of a stack the reader has shown, and these name it by its view on screen, so a feature
 * that follows the tabs follows the layers too.
 */
export interface TabService {
  /**
   * The tabs in the strip's order, and the one on screen: a pull request's tab by its view on
   * screen, that view's id and its layer's number.
   */
  list(): Tabs;
  /**
   * Opens a tab and shows it, and returns the id of the view that shows what was opened. A pull
   * request already open, by any name it's known by, shows the tab it opened in, at its layer; else
   * one a tab's stack holds ({@link TabService.setLayers}) shows the first such tab, at that layer.
   * Settings when it's open shows its tab. A new pull request's tab acts as `as.login` when given,
   * an account that can see its repository, and otherwise works out its account itself.
   */
  open(opening: Opening, as?: { login: string }): string;
  /**
   * Keeps the stack the pull request's tab of view `id` holds, `undefined` once it holds none, so a
   * link to any of its layers shows that tab, at that layer, and the window's title says where in
   * the stack the layer on screen is. Two tabs that turn out to hold one stack stay two.
   */
  setLayers(id: string, stack: Stack | undefined): void;
  /** What main has of a view of a pull request's tab now, or nothing for no such view. */
  pull(id: string): PullTabInfo | undefined;
  /**
   * Compares view `id`'s pull request with `commit`, where a stack's layer's own changes start, or
   * with its base branch for nothing: its local copy's merge base becomes where the head meets the
   * commit, fetched by its ID if the copy lacks it, so its diff, tree, whole files and overview
   * start there. Its diff starts again, so call it before the view is drawn, or when the reader
   * asks. Nothing for no such view.
   */
  compareFrom(id: string, commit: string | undefined): void;
  /**
   * Calls `listener` with a view's id each time what {@link TabService.pull} says of it may have
   * changed, and once it's closed, with its tab. Returns a function that stops it.
   */
  onPull(listener: (id: string) => void): () => void;
  /**
   * Calls `listener` with the tabs, as {@link TabService.list} names them, each time they change:
   * one opened, closed, moved or shown, or another layer shown. Returns a function that stops it.
   */
  onTabs(listener: (tabs: Tabs) => void): () => void;
  /**
   * A view's local copy, opened, to read what's been fetched into it: nothing until the view first
   * fetches. The tab closes it as the tab closes, so a reader never does.
   */
  clone(id: string): Promise<Repo> | undefined;
  /**
   * Says a view's diff is drawn at `head`. If that's the head on screen, it stays there from now
   * on, until the reader loads a newer one: a head taken from what Lo saved, which GitHub's first
   * answer would otherwise replace, is no longer replaced, and a newer head from GitHub is offered
   * as a newer push instead, so the diff never moves under the reader.
   */
  drawn(id: string, head: string): void;
}

export const tabs = defineService<TabService>('tab.tabs');
