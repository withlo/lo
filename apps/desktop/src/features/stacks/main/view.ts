// The stack a pull request's tab shows, worked out from its repository's stacks, the open pull
// request list they were found in, and the state of the layers, as read for the tab on screen:
// each row, the head and the notes. Nothing here calls Electron or GitHub.

import {
  MAX_OPEN_PULL_REQUESTS,
  openPullRequest,
  viewedFiles,
  type OpenPullRequestList,
  type PullRequestReviewDecision,
  type StackLayer,
  type StackLayerList,
  type StatusState,
} from '@lo/github';
import { layerOf, stackOf, type Cycle, type Rule, type Stack, type Stacks } from '@lo/stacks';

import type { PullState } from '../../tab/contract.ts';
import type { Checks, Note, Review, Row, StackView } from '../contract.ts';

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
  /** How it was linked to the layer it sat on, if it sat on one. */
  readonly rule: Rule | undefined;
}

/** A tab's stack, what to keep of it, and the layers to read the state of. */
export interface ViewOutput {
  readonly view: StackView;
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
  const rows: ShownRow[] = stack.layers.map((number) => {
    const layer = layerOf(forest, number);
    const pr = openPullRequest(list, number);
    const parent = layer?.parent.kind === 'pr' ? layer.parent.number : undefined;
    // A layer that sat on the one that left sits elsewhere now: it was linked as it was shown.
    const linked = parent === undefined && left ? shownRule(input.shown, number) : undefined;
    return {
      id: pr?.id ?? '',
      parent,
      rule: parent === undefined ? linked : layer?.rule,
      row: {
        number,
        title: pr?.title ?? '',
        author: pr?.author?.login ?? null,
        state: pr?.isDraft ? 'draft' : 'open',
        current: number === input.number,
        branch: false,
        on: null,
        ...stateOf(read(number)),
        needsRebase: layer?.needsRebase !== undefined,
        viewed: viewedOf(read(number), number === input.number),
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
        queue: null,
        needsRebase: false,
        viewed: { source: 'tab' },
        ...(state ? { review: reviewOf(state.reviewDecision), checks: checksOf(state) } : {}),
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
  return {
    view: {
      kind: 'stack',
      root: stack.root,
      head: headOf(layers, placed),
      rows: placed.map(({ row }) => row),
      notes: notesOf(input, forest, list, stack),
    },
    shown: { rows: placed },
    ids: placed.map(({ id }) => id).filter((id) => id !== ''),
  };
}

/** How `number` was linked to the layer it sat on when the tab showed it. */
function shownRule(shown: Shown | undefined, number: number): Rule | undefined {
  const kept = shown?.rows.find(({ row }) => row.number === number);
  return kept?.parent === undefined ? undefined : kept.rule;
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

/** "4 layers · by base branch", or "GitHub stack · 4 layers" when every layer is in one. */
export function headOf(
  layers: readonly { readonly nativeStack: { readonly stack: number } | undefined }[],
  rows: readonly Pick<ShownRow, 'rule'>[],
): string {
  const count = `${rows.length} ${rows.length === 1 ? 'layer' : 'layers'}`;
  const github = new Set(layers.map((layer) => layer.nativeStack?.stack));
  if (layers.length > 0 && github.size === 1 && !github.has(undefined)) {
    return `GitHub stack · ${count}`;
  }
  // A GitHub stack's layers go into the branch of the layer below, as a chain by base branch does.
  const found = new Set(
    rows.flatMap(({ rule }) => (rule === 'nativeStack' ? 'baseBranch' : (rule ?? []))),
  );
  const by =
    found.has('baseBranch') && found.has('sharedCommits')
      ? 'by base branch and shared commits'
      : found.has('baseBranch')
        ? 'by base branch'
        : found.has('sharedCommits')
          ? 'by shared commits'
          : undefined;
  return by === undefined ? count : `${count} · ${by}`;
}

/** What the tree says under the rows of `stack`: what Lo couldn't read, cycles and rebases. */
function notesOf(
  input: ViewInput,
  forest: Stacks,
  list: OpenPullRequestList,
  stack: Stack,
): Note[] {
  const { repository } = input;
  const notes: Note[] = [];
  const gaps = new Set(forest.gaps.map((gap) => gap.kind));
  if (gaps.has('openPullRequests')) {
    notes.push({
      kind: 'busy',
      text: `${repository} has ${counted(list.totalCount)} open PRs. Lo looks for stacks among the ${counted(MAX_OPEN_PULL_REQUESTS)} opened most recently.`,
    });
  }
  if (gaps.has('mergedPullRequests') || input.layers?.lookupsFailed !== undefined) {
    notes.push({
      kind: 'merged',
      text: "Some merged PRs weren't looked up yet, so a layer may show on its own.",
    });
  }
  if (gaps.has('rulesets')) {
    notes.push({
      kind: 'rulesets',
      text: `Lo couldn't read ${repository}'s rulesets, so it can't make a GitHub stack here yet.`,
    });
  }
  const inStack = new Set(stack.layers);
  for (const cycle of forest.cycles) {
    if (cycle.prs.some((pr) => inStack.has(pr)))
      notes.push({ kind: 'cycle', text: cycleText(cycle) });
  }
  for (const number of stack.layers) {
    const merged = layerOf(forest, number)?.needsRebase?.merged;
    if (merged === undefined) continue;
    notes.push({
      kind: 'needsRebase',
      text: `#${number} needs a rebase. #${merged} was squash-merged, so its changes are hidden here, and #${number} is compared with #${merged}'s last commit.`,
    });
  }
  return notes;
}

/** "#12 and #14 each sit on the other. Lo shows #12 on its own base." */
function cycleText({ prs }: Cycle): string {
  const [first] = prs;
  const named = prs.map((pr) => `#${pr}`);
  const sit =
    named.length === 2
      ? `${named.join(' and ')} each sit on the other.`
      : `${named.slice(0, -1).join(', ')} and ${named.at(-1) ?? ''} sit on each other in a loop.`;
  return first === undefined ? sit : `${sit} Lo shows #${first} on its own base.`;
}

/** A count as the interface writes it: "1,342". */
function counted(value: number): string {
  return value.toLocaleString('en-US');
}
