// The stacks pull requests' tabs show, followed with an account's poller that holds what the
// recorded cassettes say of rozed-dev/e2e: its tree (#2 a → main, #3 b → a, #4 c → b, #5 e → b and
// #6 d → main holding c), its GitHub stack (#7, #8), #11, alone on #10, which was squash-merged, and
// #19, alone.

import {
  openPullRequest,
  PullRef,
  STACK_LAYERS,
  type Cached,
  type GithubClient,
  type OpenPullRequestList,
  type OverviewRefNumbers,
  type ReadKind,
  type RepoRef,
  type StackLayerList,
  type TrunkRuleList,
} from '@lo/github';
import { describe, expect, it } from 'vitest';

import { stack as stackSchema, type StackState } from '../contract.ts';
import { OVERVIEW_REFS, StackFinder, type FinderPoller, type FinderTab } from './finder.ts';
import { changeLayer, changePull, E2E, idsOf, leaving, recorded } from './test/support.ts';

const LOGIN = 'rozed-bot';
const LAYERS = [2, 3, 4, 6, 5, 7, 8, 11, 19];

/** A poller that holds what a test gives it, and notes what it's asked to read. */
class FakePoller implements FinderPoller {
  readonly login = LOGIN;
  readonly lists = new Map<string, Cached<OpenPullRequestList>>();
  readonly rules = new Map<string, Cached<TrunkRuleList>>();
  readonly reads = new Map<string, Cached<StackLayerList>>();
  readonly overviews = new Map<string, Cached<OverviewRefNumbers>>();
  /** The pull requests the repository's overviews were asked to be read for. */
  readonly overviewsAsked: string[] = [];
  /** Each read of layers asked for: the pull request it's for, and the layers' node IDs. */
  readonly asked: [string, string[]][] = [];
  /** The pull requests whose layers were to be read again at once. */
  readonly again: string[] = [];
  /** The pull requests whose layers were no longer to be read. */
  readonly forgotten: string[] = [];
  readonly #listeners = new Set<() => void>();
  /** When each read was fetched, by a clock that moves on with each. */
  #clock = 0;

  openPullRequests(repo: RepoRef): Cached<OpenPullRequestList> | undefined {
    return this.lists.get(repo.key);
  }

  trunkRules(repo: RepoRef): Cached<TrunkRuleList> | undefined {
    return this.rules.get(repo.key);
  }

  stackLayers(pull: PullRef, ids: readonly string[]): Promise<Cached<StackLayerList> | undefined> {
    this.asked.push([pull.toString(), [...ids]]);
    return Promise.resolve(this.reads.get(pull.key));
  }

  readCached<T>(
    pull: PullRef,
    kind: ReadKind<T>,
    _request: (client: GithubClient, known: T | undefined) => Promise<T>,
  ): Promise<Cached<T> | undefined> {
    if (kind.name !== OVERVIEW_REFS.name) throw new Error(`The finder read ${kind.name}`);
    this.overviewsAsked.push(pull.toString());
    return Promise.resolve(this.cachedRead(pull, kind));
  }

  cachedRead<T>(pull: PullRef, kind: ReadKind<T>): Cached<T> | undefined {
    const reads = new Map<string, Map<string, Cached<unknown>>>([
      [STACK_LAYERS.name, this.reads],
      [OVERVIEW_REFS.name, this.overviews],
    ]).get(kind.name);
    if (!reads) throw new Error(`The finder read ${kind.name}`);
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the read of the kind asked.
    return reads.get(pull.key) as Cached<T> | undefined;
  }

  readStackLayersAgain(pull: PullRef): void {
    this.again.push(pull.toString());
  }

  forgetStackLayers(pull: PullRef): void {
    this.forgotten.push(pull.toString());
  }

  onChange(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Lists `repo`'s open pull requests anew, or reads its rulesets, as a poll would. */
  set(repo: RepoRef, change: { list?: OpenPullRequestList; rules?: TrunkRuleList }): void {
    if (change.list) this.lists.set(repo.key, { value: change.list, fetchedAt: ++this.#clock });
    if (change.rules) this.rules.set(repo.key, { value: change.rules, fetchedAt: ++this.#clock });
    this.changed();
  }

  /** Reads which pull requests have an overview for `pull`, as the poller does once it's open. */
  readOverviews(pull: PullRef, numbers: number[], fetchedAt = 0): void {
    this.overviews.set(pull.key, { value: { numbers, etag: undefined }, fetchedAt });
    this.changed();
  }

  /** Reads the layers for `pull`, as the poller does once it's open. */
  read(pull: PullRef, layers: StackLayerList): void {
    this.reads.set(pull.key, { value: layers, fetchedAt: ++this.#clock });
    this.changed();
  }

  changed(): void {
    for (const listener of this.#listeners) listener();
  }
}

/** A finder on `poller`, with what it sends, each checked as the window would take it. */
function started(poller: FakePoller | undefined) {
  const sent: StackState[] = [];
  const logged: string[] = [];
  /** Each start set, by the tab it's set for: a commit, or nothing for the base branch. */
  const starts: [string, string | undefined][] = [];
  const finder = new StackFinder({
    poller: (login) =>
      poller && login === LOGIN
        ? Promise.resolve(poller)
        : Promise.reject(new Error(`Lo isn't signed in to ${login}`)),
    publish: (state) => sent.push(stackSchema.parse(state)),
    compareFrom: (id, commit) => starts.push([id, commit]),
    log: (line) => logged.push(line),
  });
  return { finder, sent, logged, starts };
}

/** The tab of pull request `number` in rozed-dev/e2e, acting as rozed-bot. */
function tab(number: number, more: Partial<FinderTab> = {}): FinderTab {
  return {
    id: `t${number}`,
    pull: PullRef.of(E2E, number),
    repository: 'e2e',
    login: LOGIN,
    state: 'open',
    onScreen: false,
    head: undefined,
    compareFrom: undefined,
    drawn: false,
    missing: false,
    ...more,
  };
}

/** Runs what's waiting: the poller being got, and a refresh it asked for. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** The numbers of the rows tab `id` shows, or its stack's kind. */
function rows(finder: StackFinder, id: string): number[] | string {
  const stack = finder.state(id)?.stack;
  if (!stack) return 'nothing';
  return stack.kind === 'stack' ? stack.rows.map((row) => row.number) : stack.kind;
}

describe('the stacks tabs show', () => {
  it("are unknown until the repository's rulesets are read, then sent once each change", async () => {
    const found = await recorded('stacks_e2e', E2E, LAYERS);
    const poller = new FakePoller();
    const { finder, sent } = started(poller);
    finder.follow([tab(4, { onScreen: true })]);
    expect(rows(finder, 't4')).toBe('unknown');
    await settle();
    poller.set(E2E, { list: found.list });
    await settle();
    expect(rows(finder, 't4')).toBe('unknown');
    poller.set(E2E, { rules: found.rules });
    await settle();
    expect(rows(finder, 't4')).toEqual([2, 3, 4, 6, 5]);
    // Nothing that changes the stack sends nothing more.
    poller.changed();
    await settle();
    expect(sent.map((state) => state.stack.kind)).toEqual(['unknown', 'stack']);
    expect(finder.state('t9')).toBeUndefined();
  });

  it('are unknown for a tab that acts as nobody, or as an account without a poller', async () => {
    const { finder, sent, logged } = started(undefined);
    finder.follow([tab(4, { login: undefined }), tab(2, { id: 'other', login: 'someone' })]);
    await settle();
    expect(rows(finder, 't4')).toBe('unknown');
    expect(rows(finder, 'other')).toBe('unknown');
    expect(sent).toHaveLength(2);
    // It's asked for again as the tabs change, and said once.
    finder.follow([tab(4, { login: undefined }), tab(2, { id: 'other', login: 'someone' })]);
    await settle();
    expect(logged).toEqual(["no poller for someone: Error: Lo isn't signed in to someone"]);
  });

  it('read the layers of the stack on screen, and of no other', async () => {
    const found = await recorded('stacks_e2e', E2E, LAYERS);
    const poller = new FakePoller();
    poller.set(E2E, { list: found.list, rules: found.rules });
    const { finder } = started(poller);
    finder.follow([tab(4, { onScreen: true }), tab(8), tab(19)]);
    await settle();
    expect(rows(finder, 't8')).toEqual([7, 8]);
    expect(rows(finder, 't19')).toBe('none');
    expect(poller.asked).toEqual([['rozed-dev/e2e#4', idsOf(found.list, [2, 3, 4, 6, 5])]]);
    // The GitHub stack comes on screen: its layers are read for its tab.
    finder.follow([tab(4), tab(8, { onScreen: true }), tab(19)]);
    expect(poller.asked.at(-1)).toEqual(['rozed-dev/e2e#8', idsOf(found.list, [7, 8])]);
    // A pull request on its own reads none, nor which pull requests have an overview.
    finder.follow([tab(4), tab(8), tab(19, { onScreen: true })]);
    expect(poller.asked).toHaveLength(2);
    expect(poller.overviewsAsked).toEqual(['rozed-dev/e2e#4', 'rozed-dev/e2e#8']);
    // Coming back asks again, to start from the newest read.
    finder.follow([tab(4, { onScreen: true }), tab(8), tab(19)]);
    expect(poller.asked).toHaveLength(3);
    expect(poller.again).toEqual([]);
  });

  it("read which of the repository's pull requests have an overview, for the stack on screen", async () => {
    const found = await recorded('stacks_e2e', E2E, LAYERS);
    const poller = new FakePoller();
    poller.set(E2E, { list: found.list, rules: found.rules });
    const { finder } = started(poller);
    const marks = (id: string) => {
      const stack = finder.state(id)?.stack;
      return stack?.kind === 'stack' && stack.rows.map((row) => row.overview);
    };
    finder.follow([tab(4, { onScreen: true }), tab(8)]);
    await settle();
    expect(poller.overviewsAsked).toEqual(['rozed-dev/e2e#4']);
    expect(marks('t4')).toEqual([null, null, null, null, null]);
    poller.readOverviews(PullRef.of(E2E, 4), [3]);
    await settle();
    expect(marks('t4')).toEqual([false, true, false, false, false]);
    // One read serves every tab in the repository, and a layer shown since asks once for its own.
    expect(marks('t8')).toEqual([false, false]);
    finder.follow([tab(4), tab(8, { onScreen: true })]);
    finder.follow([tab(4, { onScreen: true }), tab(8)]);
    finder.follow([tab(4), tab(8, { onScreen: true })]);
    expect(poller.overviewsAsked).toEqual(['rozed-dev/e2e#4', 'rozed-dev/e2e#8']);
    // The newest read wins.
    poller.readOverviews(PullRef.of(E2E, 8), [7], 1);
    await settle();
    expect(marks('t4')).toEqual([false, false, false, false, false]);
    expect(marks('t8')).toEqual([true, false]);
  });

  it('read the layers again when the list shows one at a newer head than its state', async () => {
    const found = await recorded('stacks_e2e', E2E, LAYERS);
    const poller = new FakePoller();
    poller.set(E2E, { list: found.list, rules: found.rules });
    const pull = PullRef.of(E2E, 4);
    if (found.layers) poller.read(pull, found.layers);
    const { finder } = started(poller);
    finder.follow([tab(4, { onScreen: true })]);
    await settle();
    expect(poller.again).toEqual([]);
    poller.set(E2E, {
      list: changePull(found.list, 6, (pr) => ({ ...pr, headRefOid: 'a'.repeat(40) })),
    });
    await settle();
    expect(poller.again).toEqual(['rozed-dev/e2e#4']);
    // Once for that head, however often the poller changes before the read comes.
    poller.changed();
    await settle();
    expect(poller.again).toHaveLength(1);
    poller.set(E2E, {
      list: changePull(found.list, 6, (pr) => ({ ...pr, headRefOid: 'b'.repeat(40) })),
    });
    await settle();
    expect(poller.again).toHaveLength(2);
  });

  it('read the layers again only for a list fetched after their state', async () => {
    const found = await recorded('stacks_e2e', E2E, LAYERS);
    if (!found.layers) throw new Error('no layers');
    const poller = new FakePoller();
    poller.set(E2E, { list: found.list, rules: found.rules });
    const pull = PullRef.of(E2E, 4);
    // #6 was pushed to: the layers' state, read since, has its new head before the list does.
    const pushed = 'c'.repeat(40);
    poller.read(
      pull,
      changeLayer(found.layers, 6, (layer) => ({ ...layer, headRefOid: pushed })),
    );
    const { finder } = started(poller);
    finder.follow([tab(4, { onScreen: true })]);
    await settle();
    poller.changed();
    await settle();
    expect(poller.again).toEqual([]);
    // The list, fetched again, has it too.
    poller.set(E2E, {
      list: changePull(found.list, 6, (pr) => ({ ...pr, headRefOid: pushed })),
    });
    await settle();
    expect(poller.again).toEqual([]);
  });

  it('stop reading the layers once the tab closes, or its pull request leaves the stack', async () => {
    const found = await recorded('stacks_e2e', E2E, LAYERS);
    const poller = new FakePoller();
    poller.set(E2E, { list: found.list, rules: found.rules });
    const { finder } = started(poller);
    finder.follow([tab(4, { onScreen: true }), tab(8)]);
    await settle();
    finder.follow([tab(8)]);
    expect(poller.forgotten).toEqual(['rozed-dev/e2e#4']);
    expect(finder.state('t4')).toBeUndefined();

    finder.follow([tab(8, { onScreen: true })]);
    // #7 closes, and #8 is in a GitHub stack still, by itself.
    poller.set(E2E, { list: leaving(found.list, 7, 'closed') });
    await settle();
    expect(rows(finder, 't8')).toEqual([8]);
    // b's branch has none but c on it, apart from #8.
    poller.set(E2E, {
      list: changePull(found.list, 8, (pr) => ({ ...pr, stackEntry: null, baseRefName: 'e2/z' })),
    });
    await settle();
    expect(rows(finder, 't8')).toBe('none');
    expect(poller.forgotten).toEqual(['rozed-dev/e2e#4', 'rozed-dev/e2e#8']);
  });

  it('link layers through the merged pull requests their read found', async () => {
    const found = await recorded('stacks_e2e', E2E, LAYERS);
    const poller = new FakePoller();
    // b merged, and the list didn't look it up: only the layers' read of c finds it, from the
    // branch GitHub moved c from. e sits on c here.
    const merged = leaving(
      changePull(found.list, 5, (pr) => ({ ...pr, baseRefName: 'e2/c' })),
      3,
      'merged',
    );
    const list = { ...merged, merged: merged.merged.filter((pr) => pr.number !== 3) };
    poller.set(E2E, { list, rules: found.rules });
    const { finder } = started(poller);
    finder.follow([tab(4, { onScreen: true })]);
    await settle();
    expect(rows(finder, 't4')).toEqual([4, 5]);
    if (!found.layers) throw new Error('no layers');
    poller.read(PullRef.of(E2E, 4), {
      ...found.layers,
      merged: merged.merged.filter((pr) => pr.number === 3),
    });
    await settle();
    expect(rows(finder, 't4')).toEqual([2, 4, 5, 6]);
  });

  it("keep the layer on screen's row once it merges", async () => {
    const found = await recorded('stacks_e2e', E2E, LAYERS);
    const poller = new FakePoller();
    poller.set(E2E, { list: found.list, rules: found.rules });
    const { finder } = started(poller);
    finder.follow([tab(3, { onScreen: true })]);
    await settle();
    poller.set(E2E, { list: leaving(found.list, 3, 'merged') });
    finder.follow([tab(3, { onScreen: true, state: 'merged' })]);
    await settle();
    const stack = finder.state('t3')?.stack;
    expect(stack?.kind === 'stack' && stack.rows.map((row) => [row.number, row.state])).toEqual([
      [2, 'open'],
      [3, 'merged'],
      [4, 'open'],
      [6, 'open'],
      [5, 'open'],
    ]);
  });

  it("forget an account's stacks once it's removed", async () => {
    const found = await recorded('stacks_e2e', E2E, LAYERS);
    const poller = new FakePoller();
    poller.set(E2E, { list: found.list, rules: found.rules });
    const { finder } = started(poller);
    finder.follow([tab(4, { onScreen: true })]);
    await settle();
    expect(rows(finder, 't4')).toEqual([2, 3, 4, 6, 5]);
    finder.forgetAccount(LOGIN);
    // Its poller is got again, as the tab asks.
    expect(rows(finder, 't4')).toBe('unknown');
    await settle();
    expect(rows(finder, 't4')).toEqual([2, 3, 4, 6, 5]);
  });
});

/** The head pull request `number` is at, as recorded. */
const headIn = (list: OpenPullRequestList, number: number) =>
  openPullRequest(list, number)?.headRefOid ?? '';

describe('where the layer on screen starts', () => {
  it('is set before its diff is drawn, offered after, and set on the banner’s button', async () => {
    const found = await recorded('app_stack', E2E);
    const { list, rules } = found;
    const poller = new FakePoller();
    const { finder, starts } = started(poller);
    const c = { onScreen: true, head: headIn(list, 84) };
    // #84's diff was drawn before its stack was known.
    finder.follow([tab(84, { ...c, drawn: true })]);
    await settle();
    poller.set(E2E, { list, rules });
    await settle();
    expect(starts).toEqual([]);
    const b = headIn(list, 83);
    expect(finder.state('t84')?.offer).toEqual({
      title: "#84's diff includes #83's changes.",
      action: "Show only #84's",
      commit: b,
    });
    // Only what's offered is taken.
    expect(finder.useStart('t84', null)).toBe(false);
    expect(finder.useStart('t84', b)).toBe(true);
    expect(starts).toEqual([['t84', b]]);
    expect(finder.useStart('t84', b)).toBe(false);
    // The tab starts there now, and its diff starts again: nothing is offered.
    finder.follow([tab(84, { ...c, compareFrom: b })]);
    expect(finder.state('t84')?.offer).toBeNull();
    // #87 needs a rebase, but its base branch still sits at #86's head, where GitHub's diff of it
    // already starts: its stack shows, with the note, and nothing is set or offered.
    for (const drawn of [false, true]) {
      finder.follow([
        tab(84, { ...c, compareFrom: b }),
        tab(87, { head: headIn(list, 87), drawn }),
      ]);
      expect(starts).toEqual([['t84', b]]);
      expect(finder.state('t87')).toMatchObject({
        stack: { kind: 'stack', rows: [{ number: 87 }], notes: [{ kind: 'needsRebase' }] },
        offer: null,
      });
    }
  });

  it("says when the local copy couldn't get the commit, under the stack's notes", async () => {
    const found = await recorded('app_stack', E2E);
    const poller = new FakePoller();
    poller.set(E2E, { list: found.list, rules: found.rules });
    const { finder } = started(poller);
    const b = headIn(found.list, 83);
    finder.follow([
      tab(84, { onScreen: true, head: headIn(found.list, 84), compareFrom: b, missing: true }),
    ]);
    await settle();
    const stack = finder.state('t84')?.stack;
    expect(stack?.kind === 'stack' && stack.notes.at(-1)).toEqual({
      kind: 'start',
      text: "Lo couldn't fetch #83's head, so #84's diff includes #83's changes.",
    });
  });
});
