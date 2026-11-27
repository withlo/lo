// The stack a pull request's tab shows, worked out from its repository's stacks, the open pull
// request list they were found in, the state of the layers and the repository's overviews, as read
// for the tab on screen: each row, the notes, and the offer to make the chain a GitHub stack.
// Nothing here calls Electron or GitHub.

import {
  layerThreads,
  MAX_OPEN_PULL_REQUESTS,
  openPullRequest,
  viewedFiles,
  type OpenPullRequestList,
  type PullRequestReviewDecision,
  type StackLayer,
  type StackLayerList,
  type StatusState,
} from '@lo/github';
import {
  chain,
  layerOf,
  planConversion,
  stackOf,
  type Cycle,
  type Layer,
  type Stack,
  type Stacks,
} from '@lo/stacks';

import type { PullState } from '../../tab/contract.ts';
import { type Checks, type Note, type Review, type Row, type StackView } from '../contract.ts';
import { calloutKind, calloutText, CHECKING_MERGED, numbers, type CalloutKind } from './words.ts';

/** What a tab's stack is worked out from. */
export interface ViewInput {
  /** The tab's pull request. */
  readonly number: number;
  /** Its repository's name, as the notes name it. */
  readonly repository: string;
  /** Its repository's stacks, or nothing until they're known. */
  readonly forest: Stacks | undefined;
  /** The open pull requests the stacks were found among. */
  readonly list: OpenPullRequestList | undefined;
  /** The layers' state, as last read for the tab, if it was. */
  readonly layers: StackLayerList | undefined;
  /** The pull requests in the repository that have an overview, once that's been read. */
  readonly overviews: readonly number[] | undefined;
  /** The pull request's state, as its tab has it. */
  readonly state: PullState | undefined;
  /** The stack the tab showed last, if it showed one. */
  readonly shown: Shown | undefined;
}

/** A stack a tab showed: its rows, each with what it sat on, which kept a row it showed in place. */
export interface Shown {
  readonly rows: readonly ShownRow[];
}

/** A row a tab showed. */
export interface ShownRow {
  readonly row: Row;
  /** The pull request's node ID, to read its state by. */
  readonly id: string;
  /** The layer it sat on, if it sat on one. */
  readonly parent: number | undefined;
}

/** A tab's stack, what to keep of it, and the layers to read the state of. */
export interface ViewOutput {
  readonly view: StackView;
  /** Which offer `view`'s callout is, where it has one. */
  readonly callout?: CalloutKind | undefined;
  readonly shown: Shown | undefined;
  /** The node IDs of the layers whose state the tree shows, bottom first: none for no stack. */
  readonly ids: readonly string[];
}

/**
 * The stack the tab of pull request `input.number` shows. It's unknown until the forest is, and
 * shows when it has two layers or more, when the pull request is in a GitHub stack, or when it needs
 * a rebase, alone or not, so its note says why its diff starts where it does. Once the pull request
 * merges or closes, its row stays where it was in the stack it showed, among the other layers as
 * the forest now has them, while they're still one stack.
 */
export function viewOf(input: ViewInput): ViewOutput {
  const { forest, list, number, shown } = input;
  if (!forest || !list) return { view: { kind: 'unknown' }, shown, ids: [] };
  const own = layerOf(forest, number);
  if (own) {
    const stack = stackOf(forest, number);
    const alone = own.nativeStack === undefined && own.needsRebase === undefined;
    if (!stack || (stack.layers.length < 2 && alone)) {
      return { view: { kind: 'none' }, shown: undefined, ids: [] };
    }
    return drawn(input, forest, list, stack, undefined);
  }
  const left = leftAs(input);
  const kept = shown?.rows.find((shownRow) => shownRow.row.number === number);
  if (left === undefined || !shown || !kept || shown.rows.length < 2) {
    return { view: { kind: 'none' }, shown, ids: [] };
  }
  // The other layers it showed that are still open, while they're still one stack.
  const others = shown.rows.filter(
    ({ row }) => row.number !== number && layerOf(forest, row.number) !== undefined,
  );
  const stacks = new Set(others.map(({ row }) => stackOf(forest, row.number)));
  const [stack] = stacks;
  if (stacks.size !== 1 || !stack) return { view: { kind: 'none' }, shown, ids: [] };
  return drawn(input, forest, list, stack, { kept, state: left });
}

/** The layer on screen, merged or closed, as its row stays. */
interface Left {
  readonly kept: ShownRow;
  readonly state: 'merged' | 'closed';
}

/** Whether the tab's pull request merged or closed, as its tab or the layers' state say. */
function leftAs({ state, layers, number }: ViewInput): 'merged' | 'closed' | undefined {
  if (state === 'merged' || state === 'closed') return state;
  const read = layers?.layers.find((layer) => layer.number === number);
  if (read?.state === 'MERGED') return 'merged';
  if (read?.state === 'CLOSED') return 'closed';
  return undefined;
}

/** `stack`'s rows, head and notes, with the layer on screen kept as `left` when it left the stack. */
function drawn(
  input: ViewInput,
  forest: Stacks,
  list: OpenPullRequestList,
  stack: Stack,
  left: Left | undefined,
): ViewOutput {
  const read = (number: number) => input.layers?.layers.find((layer) => layer.number === number);
  const [bottom = input.number] = stack.layers;
  const rows: ShownRow[] = stack.layers.map((number) => {
    const layer = layerOf(forest, number);
    const pr = openPullRequest(list, number);
    const parent = layer?.parent.kind === 'pr' ? layer.parent.number : undefined;
    return {
      id: pr?.id ?? '',
      parent,
      row: {
        number,
        title: pr?.title ?? '',
        author: pr?.author?.login ?? null,
        head: pr?.headRefName ?? '',
        state: pr?.isDraft ? 'draft' : 'open',
        current: number === input.number,
        branch: false,
        on: null,
        path: chain(forest, bottom, number) ?? [number],
        ...stateOf(read(number)),
        needsRebase: layer?.needsRebase !== undefined,
        overview: overviewOf(input.overviews, layer),
        viewed: viewedOf(read(number), number === input.number),
        threads: threadsOf(read(number)),
      },
    };
  });
  if (left) {
    const shownNumbers = input.shown?.rows.map(({ row }) => row.number) ?? [];
    const after = shownNumbers.slice(shownNumbers.indexOf(left.kept.row.number) + 1);
    const at = rows.findIndex(({ row }) => after.includes(row.number));
    const state = read(left.kept.row.number);
    rows.splice(at < 0 ? rows.length : at, 0, {
      ...left.kept,
      row: {
        ...left.kept.row,
        state: left.state,
        current: true,
        // It's no longer a layer, so no run holds it.
        path: [],
        queue: null,
        needsRebase: false,
        viewed: { source: 'tab' },
        ...(state
          ? {
              review: reviewOf(state.reviewDecision),
              checks: checksOf(state),
              threads: threadsOf(state),
            }
          : {}),
      },
    });
  }
  // Where each row sits: a later layer on the same one is a branch, and a layer that isn't on the
  // row above names the one it's on.
  const placed = rows.map((shownRow, index) => {
    const { parent } = shownRow;
    const above = rows[index - 1]?.row.number;
    const branch =
      parent !== undefined && rows.slice(0, index).some((before) => before.parent === parent);
    return {
      ...shownRow,
      row: {
        ...shownRow.row,
        branch,
        on: parent !== undefined && parent !== above ? parent : null,
      },
    };
  });
  const layers = stack.layers.flatMap((number) => layerOf(forest, number) ?? []);
  const callout = left ? null : calloutOf(input, forest);
  return {
    view: {
      kind: 'stack',
      root: stack.root,
      githubStack: oneGithubStack(layers),
      rows: placed.map(({ row }) => row),
      notes: [...githubNotes(layers), ...notesOf(input, forest, list, stack)],
      // Until the finder hears what the reader dismissed or turned off.
      offered: true,
      callout: callout?.line ?? null,
    },
    callout: callout?.kind,
    shown: { rows: placed },
    ids: placed.map(({ id }) => id).filter((id) => id !== ''),
  };
}

/** A layer's review, checks and place in the merge queue, from its state as read. */
function stateOf(layer: StackLayer | undefined): Pick<Row, 'review' | 'checks' | 'queue'> {
  if (!layer) return { review: null, checks: null, queue: null };
  const position = layer.mergeQueueEntry?.position;
  return {
    review: reviewOf(layer.reviewDecision),
    checks: checksOf(layer),
    queue:
      position !== undefined && Number.isSafeInteger(position) && position >= 1 ? position : null,
  };
}

/** A review decision as GitHub gives it, or none for one Lo doesn't know. */
export function reviewOf(decision: PullRequestReviewDecision | null | undefined): Review | null {
  if (decision == null) return null;
  switch (decision) {
    case 'APPROVED':
      return 'approved';
    case 'CHANGES_REQUESTED':
      return 'changesRequested';
    case 'REVIEW_REQUIRED':
      return 'reviewRequired';
    default:
      // GitHub may add a decision: it shows as none.
      decision satisfies never;
      return null;
  }
}

/** How a layer's checks stand together, or none without checks or for a state Lo doesn't know. */
export function checksOf(layer: Pick<StackLayer, 'statusCheckRollup'>): Checks | null {
  const state: StatusState | undefined = layer.statusCheckRollup?.state;
  if (state === undefined) return null;
  switch (state) {
    case 'SUCCESS':
      return 'passing';
    case 'PENDING':
    case 'EXPECTED':
      return 'running';
    case 'FAILURE':
    case 'ERROR':
      return 'failing';
    default:
      // GitHub may add a state: it shows as none.
      state satisfies never;
      return null;
  }
}

/** Where a layer's viewed count comes from: the tab's files for the layer on screen. */
function viewedOf(layer: StackLayer | undefined, current: boolean): Row['viewed'] {
  if (current) return { source: 'tab' };
  if (!layer) return null;
  return { source: 'layers', ...viewedFiles(layer) };
}

/** How many of a layer's review threads are unresolved, as read with the layers. */
function threadsOf(layer: StackLayer | undefined): Row['threads'] {
  return layer ? layerThreads(layer) : null;
}

/** Whether every one of `layers` is in one GitHub stack, as the head then says. */
export function oneGithubStack(layers: readonly Pick<Layer, 'nativeStack'>[]): boolean {
  const github = new Set(layers.map((layer) => layer.nativeStack?.stack));
  return layers.length > 0 && github.size === 1 && !github.has(undefined);
}

/**
 * Which layers are a GitHub stack, a note for each GitHub stack in a stack that isn't one, bottom
 * first: "#82 and #83 are a GitHub stack.", or "#2 is in a GitHub stack." for its one layer here.
 * The head says so when every layer is in one.
 */
export function githubNotes(layers: readonly Pick<Layer, 'number' | 'nativeStack'>[]): Note[] {
  if (oneGithubStack(layers)) return [];
  const stacks = Map.groupBy(
    layers.filter((layer) => layer.nativeStack !== undefined),
    (layer) => layer.nativeStack?.stack,
  );
  return [...stacks.values()].map((held) => {
    const prs = held
      .toSorted((a, b) => (a.nativeStack?.position ?? 0) - (b.nativeStack?.position ?? 0))
      .map(({ number }) => number);
    return {
      kind: 'github',
      text: `${numbers(prs)} ${prs.length === 1 ? 'is in' : 'are'} a GitHub stack.`,
    };
  });
}

/**
 * Whether `layer` has an overview, of those `overviews` lists: nothing until they're read, and for
 * a layer from a fork, whose overview's ref would be in the fork, where Lo doesn't look.
 */
function overviewOf(
  overviews: readonly number[] | undefined,
  layer: Layer | undefined,
): boolean | null {
  if (overviews === undefined || !layer?.headInBaseRepo) return null;
  return overviews.includes(layer.number);
}

/**
 * Which offer to make the chain through the layer on screen a GitHub stack the tree makes, and what
 * it says, while the core would plan it. The Stacks API is taken to be there until `gS` finds otherwise, and the layers'
 * state must have been read, to know none of the chain is in a merge queue.
 */
function calloutOf(
  input: ViewInput,
  forest: Stacks,
): { readonly kind: CalloutKind; readonly line: string } | null {
  const { layers } = input;
  if (!layers) return null;
  const queued = layers.layers.flatMap((read) => (read.isInMergeQueue ? [read.number] : []));
  const conversion = planConversion(forest, input.number, { stacksApi: true, queued });
  if (conversion.kind !== 'plan') return null;
  const read = new Set(layers.layers.map((layer) => layer.number));
  if (!conversion.plan.path.every((number) => read.has(number))) return null;
  return { kind: calloutKind(conversion.plan), line: calloutText(conversion.plan) };
}

/** What the tree says under the rows of `stack`: what Lo couldn't read, and loops. */
function notesOf(
  input: ViewInput,
  forest: Stacks,
  list: OpenPullRequestList,
  stack: Stack,
): Note[] {
  const notes: Note[] = [];
  const gaps = new Set(forest.gaps.map((gap) => gap.kind));
  if (gaps.has('openPullRequests')) {
    notes.push({
      kind: 'busy',
      text: `Stacks are found among the ${counted(MAX_OPEN_PULL_REQUESTS)} newest of ${counted(list.totalCount)} open pull requests.`,
    });
  }
  if (input.layers?.lookupsFailed !== undefined) {
    notes.push({ kind: 'mergedFailed', text: 'Couldn’t check merged pull requests' });
  } else if (gaps.has('mergedPullRequests')) {
    notes.push({ kind: 'merged', text: CHECKING_MERGED });
  }
  const inStack = new Set(stack.layers);
  for (const cycle of forest.cycles) {
    if (cycle.prs.some((pr) => inStack.has(pr)))
      notes.push({ kind: 'cycle', text: cycleText(cycle) });
  }
  return notes;
}

/** "#12 and #14 are each based on the other." */
function cycleText({ prs }: Cycle): string {
  const named = prs.map((pr) => `#${pr}`);
  return named.length === 2
    ? `${named.join(' and ')} are each based on the other.`
    : `${named.slice(0, -1).join(', ')} and ${named.at(-1) ?? ''} are based on each other in a loop.`;
}

/** A count as the interface writes it: "1,342". */
function counted(value: number): string {
  return value.toLocaleString('en-US');
}
