// What the window knows of each view's merge status, as main last said, and of its merge panel:
// whether it's open, the reason the keyboard is on, the method chosen, the squash commit's text as
// GitHub would start it and as the reader typed it. What's typed is kept until the tab closes, or
// the merge it went with merged. And of merging: the dialog that confirms a merge and follows it,
// and each merge Lo sent, by its pull request, as main last said. Only this feature writes here.

import { createStore } from 'zustand/vanilla';

import { tabState } from '../../tab/window/shared.ts';
import type {
  JobView,
  MergePlan,
  MergeStatusView,
  MergeView,
  Method,
  Placement,
  Refusal,
} from '../contract.ts';

export interface StatusState {
  /** Each view's status, by its id, as main last said. */
  readonly views: ReadonlyMap<string, MergeView>;
}

export const statuses = createStore<StatusState>()(() => ({ views: new Map() }));

/** Takes a view's status as main says it. */
export function takeStatus({ id, view }: MergeStatusView): void {
  const views = new Map(statuses.getState().views);
  views.set(id, view);
  statuses.setState({ views });
}

/** Forgets a closed view's status. */
export function forgetStatus(id: string): void {
  if (!statuses.getState().views.has(id)) return;
  const views = new Map(statuses.getState().views);
  views.delete(id);
  statuses.setState({ views });
}

/**
 * The squash commit's text as GitHub would start it, for the head and title it was read at:
 * being read, read, or why GitHub didn't say.
 */
export type Squash =
  | { readonly kind: 'none' }
  | { readonly kind: 'reading'; readonly at: string }
  | {
      readonly kind: 'read';
      readonly at: string;
      readonly title: string;
      readonly message: string;
    }
  | { readonly kind: 'failed'; readonly at: string; readonly why: string };

/**
 * Where the pull request sits, as main said when the panel asked, for the status it was asked at:
 * being asked, or what main said.
 */
export type Place =
  | { readonly kind: 'none' }
  | { readonly kind: 'reading'; readonly at: string }
  | { readonly kind: 'read'; readonly at: string; readonly placement: Placement };

/** A view's merge panel. */
export interface Panel {
  readonly open: boolean;
  /** The reason the keyboard is on, by its row's key. */
  readonly focused: string | undefined;
  /** The method chosen in the panel, until another is. */
  readonly method: Method | undefined;
  /** The squash commit's title and message as the reader typed them: empty leaves GitHub's. */
  readonly title: string;
  readonly message: string;
  readonly squash: Squash;
  /** Where it sits: a stack's layer, a chain's, or alone. */
  readonly place: Place;
}

export const panels = tabState<Panel>(() => ({
  open: false,
  focused: undefined,
  method: undefined,
  title: '',
  message: '',
  squash: { kind: 'none' },
  place: { kind: 'none' },
}));

/** Where view `id`'s pull request sits, as main last said, if it has. */
export function placementOf(id: string): Placement | undefined {
  const { place } = panels.get(id);
  return place.kind === 'read' ? place.placement : undefined;
}

/**
 * The merge's dialog, in the panel's place:
 *
 * - `planning`: main is planning the merge view `id` offers, for pull request `number`, which the
 *   panel's main button named `label`, or what `a` or `⌥⏎` asked for, which `title` says;
 * - `confirm`: the plan, for the reader to confirm, with `note`, what changed since one before it,
 *   while `sending` the confirmation to main; for a merge past the rules, with the number `typed`;
 * - `sent`: the plan went, and the merge from it goes as `jobs` says;
 * - `refused`: main refused the plan as it was confirmed, for `refusal`.
 */
export type MergeDialog =
  | {
      readonly kind: 'planning';
      readonly id: string;
      readonly number: number;
      readonly label: string;
      readonly title?: string | undefined;
    }
  | {
      readonly kind: 'confirm';
      readonly plan: MergePlan;
      readonly note: string | undefined;
      readonly sending: boolean;
      readonly typed?: string | undefined;
    }
  | { readonly kind: 'sent'; readonly plan: MergePlan }
  | { readonly kind: 'refused'; readonly plan: MergePlan; readonly refusal: Refusal };

export interface MergingState {
  readonly dialog: MergeDialog | undefined;
  /** The merges Lo sent, by their pull request ({@link pullKey}), as main last said. */
  readonly jobs: ReadonlyMap<string, JobView>;
  /** The keys of the merges whose end the reader dismissed, or saw in the dialog. */
  readonly seen: ReadonlySet<string>;
}

export const merging = createStore<MergingState>()(() => ({
  dialog: undefined,
  jobs: new Map(),
  seen: new Set(),
}));

/** What names a pull request among the merges: its repository, ignoring case, and its number. */
export function pullKey(owner: string, repo: string, number: number): string {
  return `${owner.toLowerCase()}/${repo.toLowerCase()}#${number}`;
}

/** The merge Lo sent of view `tab`'s pull request, if it has one. */
export function jobOf(tab: { owner: string; repo: string; number: number }): JobView | undefined {
  return merging.getState().jobs.get(pullKey(tab.owner, tab.repo, tab.number));
}
