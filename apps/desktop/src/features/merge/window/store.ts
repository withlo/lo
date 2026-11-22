// What the window knows of each view's merge status, as main last said, and of its merge panel:
// whether it's open, the reason the keyboard is on, the method chosen, the squash commit's text as
// GitHub would start it and as the reader typed it. What's typed is kept until the tab closes, or
// the merge it went with merged. And of merging: the dialog that confirms a merge and follows it,
// and each merge Lo sent, by its pull request, as main last said. And of approve and ship: its
// dialog, each run as main last said, and what the auto-merge watch last said of each pull request.
// Only this feature writes here.

import { createStore } from 'zustand/vanilla';

import { tabState } from '../../tab/window/shared.ts';
import type {
  Asked,
  JobView,
  MergePlan,
  MergeStatusView,
  MergeView,
  Method,
  Placement,
  PlanKind,
  Refusal,
  ShipPlan,
  ShipView,
  Watched,
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
 * Where the pull request sits, as main said when the panel asked, for what it was asked at (the
 * status, the panel's round of asking and the stack's layers): being asked, with what main said
 * the time before, if anything, which stands until it answers; what main said; or that it couldn't
 * say.
 */
export type Place =
  | { readonly kind: 'none' }
  | { readonly kind: 'reading'; readonly at: string; readonly last: Placement | undefined }
  | { readonly kind: 'read'; readonly at: string; readonly placement: Placement }
  | { readonly kind: 'failed'; readonly at: string };

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
  /**
   * How many times the panel has asked where it sits afresh, whatever it was asked at: as it
   * opens, while Lo lists the open pull requests again, and as `⏎` asks again.
   */
  readonly round: number;
  /**
   * What went wrong with what the panel did at once, as turning off auto-merge, shown above its
   * foot until it's asked again or the panel closes.
   */
  readonly trouble: PanelTrouble | undefined;
}

/** A failure the panel shows: what failed, why, and GitHub's own text. */
export interface PanelTrouble {
  readonly title: string;
  readonly reason: string | undefined;
  readonly details: string | undefined;
}

export const panels = tabState<Panel>(() => ({
  open: false,
  focused: undefined,
  method: undefined,
  title: '',
  message: '',
  squash: { kind: 'none' },
  place: { kind: 'none' },
  round: 0,
  trouble: undefined,
}));

/**
 * Where view `id`'s pull request sits, as main last said, if it has: while it's asked again, what
 * it said the time before.
 */
export function placementOf(id: string): Placement | undefined {
  const { place } = panels.get(id);
  switch (place.kind) {
    case 'read':
      return place.placement;
    case 'reading':
      return place.last;
    case 'none':
    case 'failed':
      return undefined;
    default:
      place satisfies never;
      throw new Error(`A place Lo doesn't know: ${JSON.stringify(place)}`);
  }
}

/**
 * Whether a panel at `place` is still waiting to hear where its pull request sits for the first
 * time, so it can't yet say what its main button merges.
 */
export function placeUnknown(place: Place): boolean {
  return place.kind === 'none' || (place.kind === 'reading' && place.last === undefined);
}

/**
 * What a merge names, as its dialog states it: the view `id` of pull request `number`, the account
 * it merges as, how, into what, the head on screen, the squash commit's title as typed, and
 * whether a GitHub stack's layers merge with it. A plan has it all, and so does the panel before
 * there's a plan, which is how the dialog states it from the moment it opens.
 */
export interface Sketch {
  readonly id: string;
  readonly number: number;
  readonly login: string;
  readonly kind: PlanKind;
  readonly method: Method | null;
  readonly base: string;
  readonly head: string;
  readonly title: string;
  readonly stack: boolean;
}

/**
 * What a merge's plan is asked of main with: the view, what was `asked`, the method shown, and the
 * squash commit's text as typed. Asked again as it was, "Try again" plans the same merge afresh.
 */
export interface PlanAsk {
  readonly id: string;
  readonly asked: Asked;
  readonly method: Method | null;
  readonly title: string;
  readonly message: string;
}

/**
 * The merge's dialog, in the panel's place:
 *
 * - `planning`: main is planning the merge view `id` offers (`ask`), for pull request `number`,
 *   which the panel's main button named `label`, under the `title` its plan will have, with what
 *   the panel knows of it already, `sketch`; or main said why there's none (`failed`, in its
 *   words, or `error`, what went wrong on the way);
 * - `confirm`: the plan, for the reader to confirm, with `note`, what changed since one before it,
 *   while `sending` the confirmation to main; for a merge past the rules, with the number `typed`;
 * - `sent`: the plan went, with the `note` it was confirmed with, and the merge from it goes as
 *   `jobs` says;
 * - `refused`: main refused the plan as it was confirmed, for `refusal`.
 */
export type MergeDialog =
  | {
      readonly kind: 'planning';
      readonly id: string;
      readonly number: number;
      readonly label: string;
      readonly title: string;
      readonly ask: PlanAsk;
      readonly sketch?: Sketch | undefined;
      /** The plan asked again, whose body stays while main plans it afresh. */
      readonly last?: MergePlan | undefined;
      /**
       * Why main planned nothing: `again` true while Lo is still finding out what the merge takes,
       * as while it looks up a stack's branches, which the dialog waits on, asking again as it
       * goes, and false where it can't go as things are; none for a request that never reached
       * main. `details`, what GitHub or the error said.
       */
      readonly failed?:
        | {
            readonly why: string | undefined;
            readonly details?: string | undefined;
            readonly again?: boolean | undefined;
          }
        | undefined;
    }
  | {
      readonly kind: 'confirm';
      readonly plan: MergePlan;
      readonly note: string | undefined;
      readonly sending: boolean;
      readonly typed?: string | undefined;
    }
  | { readonly kind: 'sent'; readonly plan: MergePlan; readonly note: string | undefined }
  | {
      readonly kind: 'refused';
      readonly plan: MergePlan;
      readonly refusal: Refusal;
      readonly note: string | undefined;
      /** What went wrong on the way to main, when it never answered. */
      readonly details?: string | undefined;
    };

export interface MergingState {
  readonly dialog: MergeDialog | undefined;
  /** The merges Lo sent, by their pull request ({@link pullKey}), as main last said. */
  readonly jobs: ReadonlyMap<string, JobView>;
  /** The keys of the merges whose end the reader dismissed, or saw in the dialog. */
  readonly seen: ReadonlySet<string>;
  /** The keys of the merges GitHub is being asked about again, as "Check again" does. */
  readonly checking: ReadonlySet<string>;
  /** The views whose auto-merge is being turned off, until main answers. */
  readonly turningOff: ReadonlySet<string>;
}

export const merging = createStore<MergingState>()(() => ({
  dialog: undefined,
  jobs: new Map(),
  seen: new Set(),
  checking: new Set(),
  turningOff: new Set(),
}));

/** What names a pull request among the merges: its repository, ignoring case, and its number. */
export function pullKey(owner: string, repo: string, number: number): string {
  return `${owner.toLowerCase()}/${repo.toLowerCase()}#${number}`;
}

/** The merge Lo sent of view `tab`'s pull request, if it has one. */
export function jobOf(tab: { owner: string; repo: string; number: number }): JobView | undefined {
  return merging.getState().jobs.get(pullKey(tab.owner, tab.repo, tab.number));
}

/**
 * Approve and ship's dialog:
 *
 * - `planning`: main is planning it for view `id`, of pull request `number`;
 * - `confirm`: the plan, for the reader to confirm, with `note`, what changed since one before it,
 *   while `sending` the confirmation to main;
 * - `refused`: main refused it, for `refusal`, and nothing was sent: as it planned, for a newer push
 *   than the one on screen, or as it was confirmed, `plan`; or, for a refusal of kind `unread` or
 *   `where` with no plan, Lo is still finding out where its merge would go, and asks again;
 * - `running`: it was confirmed and runs, as `runs` says.
 */
export type ShipDialog =
  | { readonly kind: 'planning'; readonly id: string; readonly number: number }
  | {
      readonly kind: 'confirm';
      readonly plan: ShipPlan;
      readonly note: string | undefined;
      readonly sending: boolean;
    }
  | {
      readonly kind: 'refused';
      readonly id: string;
      readonly number: number;
      readonly plan: ShipPlan | undefined;
      readonly refusal: Refusal;
    }
  | {
      readonly kind: 'running';
      readonly plan: ShipPlan;
      /** "Check again" is looking whether an approval whose answer was lost went through. */
      readonly looking?: boolean | undefined;
    };

export interface ShippingState {
  readonly dialog: ShipDialog | undefined;
  /** Each run, by its plan's key, as main last said. */
  readonly runs: ReadonlyMap<string, ShipView>;
  /** What the auto-merge watch last said, by its pull request ({@link pullKey}). */
  readonly watched: ReadonlyMap<string, Watched>;
}

export const shipping = createStore<ShippingState>()(() => ({
  dialog: undefined,
  runs: new Map(),
  watched: new Map(),
}));

/** The key of the merge approve and ship's dialog shows now, if it shows one. */
export function shipShows(): string | undefined {
  const { dialog, runs } = shipping.getState();
  if (dialog?.kind !== 'running') return undefined;
  const phase = runs.get(dialog.plan.key)?.phase;
  return phase?.kind === 'sending' ? phase.job : undefined;
}

/** Whether the merge named `key` was sent by approve and ship. */
export function shipSent(key: string): boolean {
  for (const run of shipping.getState().runs.values()) {
    if (run.phase.kind === 'sending' && run.phase.job === key) return true;
  }
  return false;
}
