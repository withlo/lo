// A tab's stack, from recorded answers: rozed-dev/e2e's tree (#2 a → main, #3 b → a, #4 c → b,
// #5 e → b and #6 d → main holding c), its GitHub stack #9 (#7, #8), and #11 y on #10, which was
// squash-merged; and github/gh-stack, whose pull requests each sit on `main` by themselves. What
// GitHub can't be made to show on demand is changed from what it said.

import { RepoRef } from '@lo/github';
import { stacksOf } from '@lo/stacks';
import { describe, expect, it } from 'vitest';

import { stack as stackSchema, type Row, type StackView } from '../contract.ts';
import {
  changeLayer,
  changePull,
  E2E,
  forestOf,
  idsOf,
  leaving,
  recorded,
  type Recorded,
} from './test/support.ts';
import { checksOf, headOf, reviewOf, viewOf, type ViewInput } from './view.ts';

/** The tree and the GitHub stack, in the order `]s` walks them, and #11, with their state. */
const LAYERS = [2, 3, 4, 6, 5, 7, 8, 11, 19];

/** The tab of pull request `number`, from `found`, with nothing shown before. */
function input(found: Recorded, number: number, more: Partial<ViewInput> = {}): ViewInput {
  return {
    number,
    repository: 'e2e',
    forest: forestOf(found),
    list: found.list,
    layers: found.layers,
    state: 'open',
    shown: undefined,
    ...more,
  };
}

/** A stack's rows, checked as the window would take them. */
function rowsOf(view: StackView): Row[] {
  stackSchema.parse({ id: 't1', stack: view });
  if (view.kind !== 'stack') throw new Error(`no stack: ${view.kind}`);
  return view.rows;
}

/** Each row, briefly: its number, then what marks it. */
function brief(view: StackView): string[] {
  return rowsOf(view).map((row) =>
    [
      `#${row.number}`,
      row.current ? 'current' : '',
      row.branch ? 'branch' : '',
      row.on === null ? '' : `on #${row.on}`,
      row.needsRebase ? 'needs rebase' : '',
    ]
      .filter(Boolean)
      .join(' '),
  );
}

describe("a tab's stack", () => {
  it('is its tree, in the order ]s walks it, saying how each layer sits', async () => {
    const found = await recorded('stacks_e2e', E2E, LAYERS);
    const { view, ids } = viewOf(input(found, 4));
    if (view.kind !== 'stack') throw new Error(view.kind);
    expect(view.root).toBe('main');
    // c and e on b in the order they were opened, d on c: e is a branch, on b, not the row above.
    expect(brief(view)).toEqual(['#2', '#3', '#4 current', '#6', '#5 branch on #3']);
    expect(view.head).toBe('5 layers · by base branch and shared commits');
    expect(view.notes).toEqual([]);
    expect(view.rows[0]).toEqual({
      number: 2,
      title: 'E2: layer a',
      author: 'rozed-bot',
      state: 'open',
      current: false,
      branch: false,
      on: null,
      review: null,
      checks: null,
      queue: null,
      needsRebase: false,
      viewed: { source: 'layers', viewed: 0, files: 1, complete: true },
    });
    // The layer on screen counts from its tab's files; d changes a's, b's and c's files, and its own.
    expect(view.rows.map((row) => row.viewed)).toEqual([
      { source: 'layers', viewed: 0, files: 1, complete: true },
      { source: 'layers', viewed: 0, files: 1, complete: true },
      { source: 'tab' },
      { source: 'layers', viewed: 0, files: 4, complete: true },
      { source: 'layers', viewed: 0, files: 1, complete: true },
    ]);
    // The layers' state is read for each row, bottom first.
    expect(ids).toEqual(idsOf(found.list, [2, 3, 4, 6, 5]));
  });

  it('says a GitHub stack is one', async () => {
    const found = await recorded('stacks_e2e', E2E, LAYERS);
    const { view } = viewOf(input(found, 8));
    expect(brief(view)).toEqual(['#7', '#8 current']);
    expect(view).toMatchObject({ head: 'GitHub stack · 2 layers', root: 'main' });
  });

  it('shows none for a pull request on its own, which reads no layers', async () => {
    const found = await recorded('stacks_e2e', E2E, LAYERS);
    // #11 sits alone on the branch its squash-merged layer went into.
    expect(viewOf(input(found, 11))).toEqual({ view: { kind: 'none' }, shown: undefined, ids: [] });
    const gh = await recorded('stacks_gh_stack', new RepoRef('github', 'gh-stack'));
    const [first] = gh.list.pullRequests;
    if (!first) throw new Error('no pull requests');
    expect(viewOf({ ...input(gh, first.number), repository: 'gh-stack' })).toEqual({
      view: { kind: 'none' },
      shown: undefined,
      ids: [],
    });
  });

  it("is unknown until the repository's stacks are, and reads nothing meanwhile", async () => {
    const found = await recorded('stacks_e2e', E2E, LAYERS);
    expect(viewOf(input(found, 4, { forest: undefined }))).toEqual({
      view: { kind: 'unknown' },
      shown: undefined,
      ids: [],
    });
  });

  it("gives each layer's review, checks, place in the queue and draft as GitHub says", async () => {
    const found = await recorded('stacks_e2e', E2E, LAYERS);
    const layers = found.layers;
    if (!layers) throw new Error('no layers');
    let changed = changeLayer(layers, 2, (layer) => ({
      ...layer,
      reviewDecision: 'CHANGES_REQUESTED',
      statusCheckRollup: { state: 'PENDING' },
    }));
    changed = changeLayer(changed, 3, (layer) => ({
      ...layer,
      reviewDecision: 'APPROVED',
      statusCheckRollup: { state: 'FAILURE' },
      isInMergeQueue: true,
      mergeQueueEntry: { position: 2, state: 'QUEUED' },
    }));
    changed = changeLayer(changed, 5, (layer) => ({
      ...layer,
      reviewDecision: 'REVIEW_REQUIRED',
      statusCheckRollup: { state: 'SUCCESS' },
      files: {
        totalCount: 214,
        nodes: Array.from({ length: 100 }, () => ({ viewerViewedState: 'VIEWED' as const })),
      },
    }));
    const list = changePull(found.list, 6, (pr) => ({ ...pr, isDraft: true }));
    const { view } = viewOf(input({ ...found, list }, 4, { layers: changed }));
    expect(
      rowsOf(view).map(({ number, state, review, checks, queue }) => [
        number,
        state,
        review,
        checks,
        queue,
      ]),
    ).toEqual([
      [2, 'open', 'changesRequested', 'running', null],
      [3, 'open', 'approved', 'failing', 2],
      [4, 'open', null, null, null],
      [6, 'draft', null, null, null],
      [5, 'open', 'reviewRequired', 'passing', null],
    ]);
    // Only the first 100 files' marks are read, so the count says it's past them.
    expect(rowsOf(view).at(-1)?.viewed).toEqual({
      source: 'layers',
      viewed: 100,
      files: 214,
      complete: false,
    });
  });

  it('shows no review, checks or count until the layers are read', async () => {
    const found = await recorded('stacks_e2e', E2E, LAYERS);
    const { view } = viewOf(input(found, 4, { layers: undefined }));
    expect(rowsOf(view).map(({ review, checks, viewed }) => [review, checks, viewed])).toEqual([
      [null, null, null],
      [null, null, null],
      [null, null, { source: 'tab' }],
      [null, null, null],
      [null, null, null],
    ]);
  });
});

describe("the app's stacks", () => {
  it("are #C's, branching at #A, found by base branch and shared commits", async () => {
    const found = await recorded('app_stack', E2E, [82, 83, 84, 85]);
    const { view, ids } = viewOf(input(found, 84));
    // #D, opened after #B, is a second layer on #A.
    expect(brief(view)).toEqual(['#82', '#83', '#84 current', '#85 branch on #82']);
    expect(view).toMatchObject({
      root: 'stack/root',
      head: '4 layers · by base branch and shared commits',
      notes: [],
    });
    expect(rowsOf(view).map(({ title }) => title)).toEqual([
      'Stack A: load per-plan limits',
      'Stack B: rate limit GraphQL queries by cost',
      "Stack C: count a query's nodes",
      "Stack D: log when a plan's limit is reached",
    ]);
    expect(ids).toEqual(idsOf(found.list, [82, 83, 84, 85]));
  });

  it('show none for #E, alone on #M, which was squash-merged', async () => {
    const found = await recorded('app_stack', E2E);
    expect(forestOf(found).layers[87]?.needsRebase).toMatchObject({ merged: 86 });
    expect(viewOf(input(found, 87)).view).toEqual({ kind: 'none' });
  });

  it('say #G1 and #G2 are a GitHub stack', async () => {
    const found = await recorded('app_stack', E2E, [88, 89]);
    const { view } = viewOf(input(found, 89));
    expect(brief(view)).toEqual(['#88', '#89 current']);
    expect(view).toMatchObject({ root: 'stack/root', head: 'GitHub stack · 2 layers' });
  });
});

describe('the notes', () => {
  it('say when the repository has more open pull requests than Lo reads', async () => {
    const found = await recorded('stacks_e2e', E2E, LAYERS);
    const list = { ...found.list, truncated: true, totalCount: 1342 };
    const { view } = viewOf(input(found, 4, { forest: stacksOf(list, found.rules), list }));
    expect(view).toMatchObject({
      notes: [
        {
          kind: 'busy',
          text: 'e2e has 1,342 open PRs. Lo looks for stacks among the 1,000 opened most recently.',
        },
      ],
    });
  });

  it("say when merged pull requests weren't looked up, from the list or the layers' read", async () => {
    const found = await recorded('stacks_e2e', E2E, LAYERS);
    const text = "Some merged PRs weren't looked up yet, so a layer may show on its own.";
    const list = { ...found.list, mergedTruncated: true };
    const fromList = viewOf(input(found, 4, { forest: stacksOf(list, found.rules), list }));
    expect(fromList.view).toMatchObject({ notes: [{ kind: 'merged', text }] });
    const layers = found.layers && { ...found.layers, lookupsFailed: 'a lookup failed' };
    expect(viewOf(input(found, 4, { layers })).view).toMatchObject({
      notes: [{ kind: 'merged', text }],
    });
  });

  it("say when the repository's rulesets couldn't be read", async () => {
    const found = await recorded('stacks_e2e', E2E, LAYERS);
    const rules = { ...found.rules, unavailable: 'GitHub answered 502' };
    const { view } = viewOf(input(found, 4, { forest: stacksOf(found.list, rules) }));
    expect(view).toMatchObject({
      notes: [
        {
          kind: 'rulesets',
          text: "Lo couldn't read e2e's rulesets, so it can't make a GitHub stack here yet.",
        },
      ],
    });
  });

  it('say which pull requests sat on each other, and which Lo put on its own base', async () => {
    const found = await recorded('stacks_e2e', E2E, LAYERS);
    // a targets b's branch, and b a's.
    const list = changePull(found.list, 2, (pr) => ({ ...pr, baseRefName: 'e2/b' }));
    const { view } = viewOf(input(found, 4, { forest: stacksOf(list, found.rules), list }));
    expect(view).toMatchObject({
      root: 'e2/b',
      notes: [
        { kind: 'cycle', text: '#2 and #3 each sit on the other. Lo shows #2 on its own base.' },
      ],
    });
    // d goes into `main`, a trunk, so it no longer sits on a stack on another root.
    expect(brief(view)).toEqual(['#2', '#3', '#4 current', '#5 branch on #3']);
  });

  it('say which layer needs a rebase, and why', async () => {
    const found = await recorded('stacks_e2e', E2E, LAYERS);
    // e goes on y, which still carries x's commits.
    const list = changePull(found.list, 5, (pr) => ({ ...pr, baseRefName: 'e3/y' }));
    const { view } = viewOf(input(found, 5, { forest: stacksOf(list, found.rules), list }));
    expect(brief(view)).toEqual(['#11 needs rebase', '#5 current']);
    expect(view).toMatchObject({
      head: '2 layers · by base branch',
      notes: [
        {
          kind: 'needsRebase',
          text: "#11 needs a rebase. #10 was squash-merged, so its changes are hidden here, and #11 is compared with #10's last commit.",
        },
      ],
    });
  });
});

describe('the layer on screen leaving', () => {
  it('keeps its row where it was, merged, among the layers as the forest now has them', async () => {
    const found = await recorded('stacks_e2e', E2E, LAYERS);
    const before = viewOf(input(found, 3));
    expect(brief(before.view)).toEqual(['#2', '#3 current', '#4', '#6', '#5 branch on #3']);
    // b merges: c and e now sit on a, through it.
    const list = leaving(found.list, 3, 'merged');
    const after = viewOf(
      input(found, 3, {
        forest: stacksOf(list, found.rules),
        list,
        state: 'merged',
        shown: before.shown,
      }),
    );
    expect(brief(after.view)).toEqual([
      '#2',
      '#3 current',
      '#4 branch on #2',
      '#6',
      '#5 branch on #2',
    ]);
    expect(rowsOf(after.view)[1]).toMatchObject({
      number: 3,
      title: 'E2: layer b',
      state: 'merged',
      viewed: { source: 'tab' },
    });
    expect(after.view).toMatchObject({ head: '5 layers · by base branch and shared commits' });
    // Its state is still read with the others'.
    expect(after.ids).toEqual(idsOf(found.list, [2, 3, 4, 6, 5]));
    // And stays as it is the next time.
    const again = viewOf(
      input(found, 3, {
        forest: stacksOf(list, found.rules),
        list,
        state: 'merged',
        shown: after.shown,
      }),
    );
    expect(again.view).toEqual(after.view);
  });

  it("knows it merged from the layers' state before its tab does", async () => {
    const found = await recorded('stacks_e2e', E2E, LAYERS);
    const before = viewOf(input(found, 3));
    const list = leaving(found.list, 3, 'merged');
    const layers =
      found.layers && changeLayer(found.layers, 3, (layer) => ({ ...layer, state: 'MERGED' }));
    const after = viewOf(
      input(found, 3, { forest: stacksOf(list, found.rules), list, layers, shown: before.shown }),
    );
    expect(rowsOf(after.view)[1]).toMatchObject({ number: 3, state: 'merged' });
  });

  it('shows none once the other layers are no longer one stack', async () => {
    const found = await recorded('stacks_e2e', E2E, LAYERS);
    const before = viewOf(input(found, 3));
    // b closes: c and e sit on its branch, apart from a.
    const list = leaving(found.list, 3, 'closed');
    const after = viewOf(
      input(found, 3, {
        forest: stacksOf(list, found.rules),
        list,
        state: 'closed',
        shown: before.shown,
      }),
    );
    expect(after.view).toEqual({ kind: 'none' });
    expect(after.ids).toEqual([]);
  });
});

describe('the wording', () => {
  it('names how the layers were found, and counts them', () => {
    const open = { nativeStack: undefined };
    expect(headOf([open, open], [{ rule: undefined }, { rule: 'sharedCommits' }])).toBe(
      '2 layers · by shared commits',
    );
    // A GitHub stack's layers go into the branch below, as a chain by base branch does.
    expect(headOf([open, open], [{ rule: undefined }, { rule: 'nativeStack' }])).toBe(
      '2 layers · by base branch',
    );
    const native = { nativeStack: { stack: 9 } };
    expect(headOf([native], [{ rule: undefined }])).toBe('GitHub stack · 1 layer');
    expect(headOf([native, { nativeStack: { stack: 10 } }], [{ rule: undefined }])).toBe('1 layer');
  });

  it("takes a review or checks state Lo doesn't know as none", () => {
    // As a newer GitHub might send them.
    const decision: Parameters<typeof reviewOf>[0] = JSON.parse('"SOMETHING_NEW"');
    const layer: Parameters<typeof checksOf>[0] = JSON.parse(
      '{ "statusCheckRollup": { "state": "SOMETHING_NEW" } }',
    );
    expect(reviewOf(decision)).toBeNull();
    expect(reviewOf(null)).toBeNull();
    expect(checksOf(layer)).toBeNull();
    expect(checksOf({ statusCheckRollup: { state: 'ERROR' } })).toBe('failing');
    expect(checksOf({ statusCheckRollup: { state: 'EXPECTED' } })).toBe('running');
    expect(checksOf({ statusCheckRollup: null })).toBeNull();
  });
});
