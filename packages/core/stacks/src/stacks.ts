/**
 * Finds stacks among a repository's pull requests (`docs/design.md`, "Stacks").
 *
 * A stack is a tree of open pull requests. Each layer sits on the pull request below it, and the
 * bottom layer sits on a root branch: a trunk such as `main`, or a branch no open pull request
 * comes from, such as `feature-x`. {@link findStacks} builds the forest from the repository's pull
 * requests, and the result drives the stack sidebar and its walk. `./convert.ts` plans turning a
 * chain of layers into a GitHub stack, and `./merge.ts` merges one that can't become one, a layer
 * at a time.
 *
 * Everything here is plain data: the forest crosses between processes as it is.
 */

/**
 * A pull request, with the fields finding stacks reads. The doc on each field names the GraphQL
 * `PullRequest` field it comes from.
 *
 * Pass the repository's open pull requests, its recently merged ones, and the merged pull requests
 * from the branches open ones target: {@link branchesToLookUp} lists the branches still to read
 * (`pullRequests(headRefName:, states: MERGED)`). Merged pull requests link the layers above them,
 * so without them a layer whose lower layer merged sits on that layer's branch as a root.
 */
export interface PullRequest {
  /** `number`. */
  readonly number: number;
  /** `state`, plus what git says about a merged pull request. */
  readonly state: State;
  /** `baseRefName`: the branch it merges into. */
  readonly baseRef: string;
  /**
   * The base branch's tip right now: `baseRef { target { oid } }`, or nothing once the branch is
   * deleted. Not `baseRefOid`, which only moves when the pull request's head does, so it's stale on
   * most open pull requests.
   */
  readonly baseTip: string | undefined;
  /** `headRefName`: the branch it merges from. */
  readonly headRef: string;
  /**
   * Whether the head branch is in the base repository: `!isCrossRepository`. False for a pull
   * request from a fork.
   */
  readonly headInBaseRepo: boolean;
  /** `headRefOid`: the head branch's latest commit. */
  readonly headOid: string;
  /** The pull request's recent commits' SHAs, oldest first: `commits(last: n)`. The last is the head. */
  readonly commits: readonly string[];
  /** `createdAt`, in milliseconds since the Unix epoch. */
  readonly createdAt: number;
  /** `stackEntry`, when the pull request is a layer of a GitHub stack. */
  readonly nativeStack: NativeStackEntry | undefined;
}

/**
 * A pull request's state. A closed one, closed without merging, is ignored, as if it weren't
 * passed.
 */
export type State =
  | { readonly kind: 'open' }
  | { readonly kind: 'closed' }
  | {
      readonly kind: 'merged';
      /**
       * Whether the pull request's head commit is in its base branch: true after a merge commit or
       * a fast-forward, false after a squash or rebase merge. From GraphQL, it's true when
       * `headRefOid` is one of `mergeCommit { parents }` or is `mergeCommit { oid }`.
       *
       * Known limit: this is about the branch the pull request merged into. One merge-committed
       * into `feature-x`, which was then squash-merged into `main`, still counts as in its base, so
       * the layers above it aren't marked as needing a rebase.
       */
      readonly headInBase: boolean;
    };

/** A pull request's place in a GitHub stack. */
export interface NativeStackEntry {
  /**
   * The stack's number: `stack.number`. Stack numbers share the repository's pull request numbers
   * but are never a pull request's.
   */
  readonly stack: number;
  /** `position`: 1 is the bottom layer. */
  readonly position: number;
}

function isOpen(pr: PullRequest): boolean {
  return pr.state.kind === 'open';
}

/** Whether `pr` was squash- or rebase-merged, so its commits never landed as they are. */
function isSquashed(pr: PullRequest): boolean {
  return pr.state.kind === 'merged' && !pr.state.headInBase;
}

/** Orders strings by their code units, as plain `<` does, for sorting. */
function byText(a: string, b: string): number {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

/**
 * The branches whose merged pull requests {@link findStacks} still needs: those that open pull
 * requests target, or that merged pull requests leading down from them target, which no open or
 * merged pull request in `prs` comes from and which aren't trunks. Sorted by name.
 */
export function branchesToLookUp(prs: readonly PullRequest[], trunks: readonly string[]): string[] {
  const openHeads = new Set<string>();
  const mergedByHead = new Map<string, string[]>();
  for (const pr of prs) {
    if (!pr.headInBaseRepo) continue;
    if (pr.state.kind === 'open') {
      openHeads.add(pr.headRef);
    } else if (pr.state.kind === 'merged') {
      const bases = mergedByHead.get(pr.headRef);
      if (bases) bases.push(pr.baseRef);
      else mergedByHead.set(pr.headRef, [pr.baseRef]);
    }
  }
  const pending = prs.filter(isOpen).map((pr) => pr.baseRef);
  const seen = new Set<string>();
  const missing = new Set<string>();
  for (let branch = pending.pop(); branch !== undefined; branch = pending.pop()) {
    const first = !seen.has(branch);
    seen.add(branch);
    if (!first || trunks.includes(branch) || openHeads.has(branch)) continue;
    const bases = mergedByHead.get(branch);
    if (bases) pending.push(...bases);
    else missing.add(branch);
  }
  return [...missing].toSorted(byText);
}

/**
 * The rule that linked a layer to the pull request below it. When several rules apply, the first
 * here wins, so they're listed strongest first. When a rule matches several pull requests equally
 * well, an open one wins over a merged one, then the newest, except that a commit several merged
 * pull requests list belongs to the oldest of them, which brought it in.
 *
 * - `nativeStack`: the pull request below is the next layer down in the same GitHub stack. Closed
 *   layers, and layers not passed, are skipped, so a closed middle layer doesn't split the stack.
 *   The bottom layer passed links by the other rules.
 * - `baseBranch`: its base branch is the head branch of the pull request below. Never links to a
 *   fork's branch, nor an open pull request to a merged one's branch that has moved on since the
 *   merge.
 * - `sharedCommits`: its commits contain the head commit of the open pull request below, or any
 *   commit of a squash- or rebase-merged pull request below. If several match, the nearest wins:
 *   the one matching its latest commit. A pull request with the same head commit isn't below it,
 *   and neither is a merged one whose head is in its base branch.
 */
export type Rule = 'nativeStack' | 'baseBranch' | 'sharedCommits';

/** The rules, strongest first. */
export const RULES: readonly Rule[] = ['nativeStack', 'baseBranch', 'sharedCommits'];

/** What a layer sits on: the open pull request below it, or a root branch. */
export type Parent =
  | { readonly kind: 'pr'; readonly number: number }
  /**
   * A root branch: a trunk such as `main`, or a branch no open pull request comes from, such as
   * `feature-x`.
   */
  | { readonly kind: 'branch'; readonly branch: string };

/** An open pull request's place in the forest. */
export interface Layer {
  readonly number: number;
  /**
   * What it sits on. When its rule matched a merged pull request, it sits where that one sat: on the
   * pull request or root branch the merged one's own link leads to.
   */
  readonly parent: Parent;
  /**
   * The rule that linked it to the pull request below, which may be a merged one. Nothing when no
   * rule did, or its link was dropped to break a cycle; it then sits on its own base branch.
   */
  readonly rule: Rule | undefined;
  /**
   * Set when a merged pull request below it was squash- or rebase-merged, so this layer still
   * carries commits that never landed as they are. Never set on a layer linked by `nativeStack`,
   * because GitHub rebases those itself.
   *
   * Known limit: a layer rebased onto the root branch but still targeting the merged pull request's
   * branch is still marked, because its base branch links it to the merged one.
   */
  readonly needsRebase: NeedsRebase | undefined;
  /**
   * The base branch "Make this a GitHub stack" must give it: the head branch of the pull request
   * below, or the root branch. Nothing when its base branch is already that, or when the pull
   * request below is from a fork, whose branch can't be a base.
   */
  readonly retargetTo: string | undefined;
  /** The layers sitting on this one, oldest first. */
  readonly children: readonly number[];
  /** How many layers sit below it: 0 for a stack's bottom layer. */
  readonly depth: number;
  /** Its base branch now, as passed to {@link findStacks}. */
  readonly baseRef: string;
  /** Whether its head branch is in the base repository, not a fork. */
  readonly headInBaseRepo: boolean;
  /** Its place in a GitHub stack, if it's in one. */
  readonly nativeStack: NativeStackEntry | undefined;
}

/** Why a layer needs a rebase, and what to compare it against until then. */
export interface NeedsRebase {
  /** The merged pull request the layer's rule matched: the nearest merged one below it. */
  readonly merged: number;
  /**
   * The commit to compare the layer against, so changes that already landed stay hidden: the
   * newest of the merged pull request's commits that the layer lists, or the merged one's head if
   * it lists none.
   */
  readonly compareAgainst: string;
}

/**
 * A change to a pull request's base branch: `PATCH /repos/{owner}/{repo}/pulls/{pr}` with
 * `{"base": to}`.
 */
export interface Retarget {
  readonly pr: number;
  /** Its base branch now. */
  readonly from: string;
  /** The base branch it gets. */
  readonly to: string;
}

/**
 * One tree: a bottom layer sitting on a root branch, and every layer above it. Each pull request
 * sitting directly on a root branch starts its own stack, whether the root is `main` or
 * `feature-x`.
 */
export interface Stack {
  /** The root branch the bottom layer sits on. */
  readonly root: string;
  /**
   * Every layer, in the order `]s` walks them: a pre-order walk that starts at the bottom layer and
   * finishes each child's branch before starting the next child's.
   */
  readonly layers: readonly number[];
}

/** The layer after `number` in the walk (`]s`), or nothing after the last. */
export function nextLayer(stack: Stack, number: number): number | undefined {
  const index = stack.layers.indexOf(number);
  return index < 0 ? undefined : stack.layers[index + 1];
}

/** The layer before `number` in the walk (`[s`), or nothing before the first. */
export function previousLayer(stack: Stack, number: number): number | undefined {
  const index = stack.layers.indexOf(number);
  return index < 1 ? undefined : stack.layers[index - 1];
}

/** A root branch and the stacks sitting on it. */
export interface Root {
  readonly branch: string;
  /** One stack per bottom layer, oldest bottom layer first. */
  readonly stacks: readonly Stack[];
}

/**
 * Links that formed a cycle. {@link findStacks} breaks each cycle by dropping one open pull
 * request's link: the one found by the weakest rule (shared commits, then base branch, then GitHub
 * stack), and of those the oldest pull request's. A cycle of merged pull requests alone is broken
 * too, but not reported.
 */
export interface Cycle {
  /**
   * The open pull requests in the cycle, in link order: each linked, directly or through merged
   * ones, to the next, and the last back to the first. The first is the one whose link was dropped;
   * it sits on its own base branch instead.
   */
  readonly prs: readonly number[];
}

/** The stacks among a repository's pull requests: a forest of trees grouped by root branch. */
export interface Stacks {
  /**
   * The root branches: the trunks passed to {@link findStacks}, in that order, then the rest sorted
   * by name. Only branches with a layer on them are listed.
   */
  readonly roots: readonly Root[];
  /** Each open pull request's layer, by its number. */
  readonly layers: Readonly<Record<number, Layer>>;
  /** Each layer's stack, as indexes into `roots` and that root's `stacks`, by its number. */
  readonly stackIndex: Readonly<Record<number, readonly [number, number]>>;
  /** The cycles found and broken, by the number of the pull request whose link was dropped. */
  readonly cycles: readonly Cycle[];
  /**
   * What the reads the stacks were found from left out, which can put a layer on the wrong pull
   * request or branch, such as a merged pull request's dead branch. No plan is made while there's
   * any. Empty from {@link findStacks}, which takes what it's given as everything; `stacksOf` says
   * what the reads it's given left out.
   */
  readonly gaps: readonly Gap[];
}

/** Something the reads stacks were found from left out. */
export type Gap =
  /**
   * The repository has more open pull requests than Lo reads, so the oldest were left out, and a
   * layer above one of them sits on its branch as a root.
   */
  | { readonly kind: 'openPullRequests' }
  /**
   * Some branches' merged pull requests weren't looked up, so a layer above one of them sits on its
   * dead branch as a root. They're looked up again after a wait.
   */
  | { readonly kind: 'mergedPullRequests' }
  /**
   * The repository's rulesets couldn't be read, for the reason `why`, so a branch only a ruleset
   * protects may be taken for a layer's. They're read again after a wait.
   */
  | { readonly kind: 'rulesets'; readonly why: string };

/** The layer for an open pull request, or nothing for any other number. */
export function layerOf(stacks: Stacks, number: number): Layer | undefined {
  return Object.hasOwn(stacks.layers, number) ? stacks.layers[number] : undefined;
}

/** The stack an open pull request is a layer of, or nothing for any other number. */
export function stackOf(stacks: Stacks, number: number): Stack | undefined {
  if (!Object.hasOwn(stacks.stackIndex, number)) return undefined;
  const [root, stack] = stacks.stackIndex[number] ?? [-1, -1];
  return stacks.roots[root]?.stacks[stack];
}

/**
 * Finds the stacks among `prs`. Every open pull request becomes a layer; merged ones only link the
 * layers above them, and closed ones are ignored. When a number repeats, an open pull request wins,
 * then a merged one, then the first.
 *
 * `trunks` are the repository's long-lived branches: its default branch plus protected or
 * ruleset-covered ones. They're always roots: a pull request from a trunk, such as a deploy
 * `production <- main` or a back-merge `develop <- main`, is never below another. A fork's branch
 * is never a trunk, whatever its name.
 */
export function findStacks(prs: readonly PullRequest[], trunks: readonly string[]): Stacks {
  const graph = new Graph(prs, trunks);
  const links = graph.links();
  const cycles = graph.breakCycles(links);
  const landings: (Landing | undefined)[] = graph.prs.map(() => undefined);
  const placed = graph.prs.flatMap((pr, index) =>
    isOpen(pr) ? [graph.place(index, links, landings)] : [],
  );
  return { ...build(placed, trunks), cycles, gaps: [] };
}

/** An open pull request and where it sits. */
interface Placed {
  readonly pr: PullRequest;
  readonly parent: Parent;
  readonly rule: Rule | undefined;
  readonly needsRebase: NeedsRebase | undefined;
  readonly retargetTo: string | undefined;
}

/** Lays out the open pull requests, each with what it sits on, as trees. */
function build(
  open: readonly Placed[],
  trunks: readonly string[],
): Omit<Stacks, 'cycles' | 'gaps'> {
  const order = new Map(open.map(({ pr }) => [pr.number, pr.createdAt]));
  const byCreation = (a: number, b: number) => (order.get(a) ?? 0) - (order.get(b) ?? 0) || a - b;

  const layers: Record<number, Layer> = {};
  const children = new Map<number, number[]>();
  const bottoms = new Map<string, number[]>();
  for (const { pr, parent, rule, needsRebase, retargetTo } of open) {
    if (parent.kind === 'pr') addTo(children, parent.number, pr.number);
    else addTo(bottoms, parent.branch, pr.number);
    layers[pr.number] = {
      number: pr.number,
      parent,
      rule,
      needsRebase,
      retargetTo,
      children: [],
      depth: 0,
      baseRef: pr.baseRef,
      headInBaseRepo: pr.headInBaseRepo,
      nativeStack: pr.nativeStack,
    };
  }
  for (const [number, above] of children) {
    const layer = layers[number];
    if (layer) layers[number] = { ...layer, children: above.toSorted(byCreation) };
  }

  const roots: Root[] = [];
  const stackIndex: Record<number, readonly [number, number]> = {};
  const trunkRoots = trunks.flatMap((trunk) => {
    const found = bottoms.get(trunk);
    if (found === undefined) return [];
    bottoms.delete(trunk);
    return [[trunk, found] as const];
  });
  const others = [...bottoms].toSorted(([a], [b]) => byText(a, b));
  for (const [branch, onBranch] of [...trunkRoots, ...others]) {
    const rootIndex = roots.length;
    const stacks: Stack[] = [];
    for (const bottom of onBranch.toSorted(byCreation)) {
      const walk = walkFrom(layers, bottom);
      for (const number of walk) stackIndex[number] = [rootIndex, stacks.length];
      stacks.push({ root: branch, layers: walk });
    }
    roots.push({ branch, stacks });
  }
  return { roots, layers, stackIndex };
}

/** Adds `number` to the list `lists` holds for `key`. */
function addTo<K>(lists: Map<K, number[]>, key: K, number: number): void {
  const list = lists.get(key);
  if (list) list.push(number);
  else lists.set(key, [number]);
}

/** Walks the tree above `bottom` in pre-order, setting each layer's depth on the way. */
function walkFrom(layers: Record<number, Layer>, bottom: number): number[] {
  const walk: number[] = [];
  const pending: [number, number][] = [[bottom, 0]];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    const [number, depth] = next;
    const layer = layers[number];
    if (!layer) continue;
    layers[number] = { ...layer, depth };
    walk.push(number);
    pending.push(
      ...layer.children.toReversed().map((child): [number, number] => [child, depth + 1]),
    );
  }
  return walk;
}

/** Where a layer on a merged pull request sits. */
interface Landing {
  /** The open pull request or root branch that following links down from the merged one reaches. */
  readonly parent: Parent;
  /** The branch that is: none for a fork's pull request's. */
  readonly base: string | undefined;
  /** Whether a squash- or rebase-merged pull request was on the way. */
  readonly squashed: boolean;
}

/** A link from a pull request to the one below it, as an index into {@link Graph.prs}. */
interface Edge {
  readonly below: number;
  readonly rule: Rule;
}

/** Each rule's lookup from what it matches to the pull request below, as indexes into the graph's. */
interface Lookups {
  /** By GitHub stack: its pull requests' positions and indexes, by position. */
  readonly position: Map<number, [number, number][]>;
  readonly headRef: Map<string, number>;
  readonly commit: Map<string, number>;
}

/** The pull requests the rules link: the first open or merged one with each number. */
class Graph {
  readonly prs: readonly PullRequest[];
  readonly #trunks: ReadonlySet<string>;

  constructor(prs: readonly PullRequest[], trunks: readonly string[]) {
    // Of pull requests with the same number, keep an open one, then a merged one, then the first.
    const preference = (pr: PullRequest) => ({ open: 2, merged: 1, closed: 0 })[pr.state.kind];
    const chosen = new Map<number, number>();
    prs.forEach((pr, index) => {
      const best = chosen.get(pr.number);
      const bestPr = best === undefined ? undefined : prs[best];
      if (bestPr === undefined || preference(pr) > preference(bestPr)) chosen.set(pr.number, index);
    });
    this.prs = prs.filter(
      (pr, index) => chosen.get(pr.number) === index && pr.state.kind !== 'closed',
    );
    this.#trunks = new Set(trunks);
  }

  #pr(index: number): PullRequest {
    const pr = this.prs[index];
    if (pr === undefined) throw new Error(`no pull request at ${index}`);
    return pr;
  }

  /** Each pull request's link to the one below it. */
  links(): (Edge | undefined)[] {
    // Each GitHub stack's positions, lowest first, with the pull request at each.
    const position = new Map<number, [number, number][]>();
    const byEntry = this.#index(
      (pr) => (pr.nativeStack ? [`${pr.nativeStack.stack}:${pr.nativeStack.position}`] : []),
      newest,
    );
    for (const index of byEntry.values()) {
      const entry = this.#pr(index).nativeStack;
      if (!entry) continue;
      const positions = position.get(entry.stack);
      if (positions) positions.push([entry.position, index]);
      else position.set(entry.stack, [[entry.position, index]]);
    }
    for (const positions of position.values()) positions.sort(([a], [b]) => a - b);
    const by: Lookups = {
      position,
      headRef: this.#index((pr) => (pr.headInBaseRepo ? [pr.headRef] : []), newest),
      commit: this.#index((pr) => {
        switch (pr.state.kind) {
          case 'open':
            return [pr.headOid];
          // Squashing or rebasing left all of its commits out of its base branch, so a layer cut
          // before its last commit still has some of them.
          case 'merged':
            return pr.state.headInBase ? [] : [...pr.commits, pr.headOid];
          // A merge-committed pull request's head is in its base branch, so it's history like any
          // other commit there, not a layer below.
          case 'closed':
            return [];
          default:
            pr.state satisfies never;
            return [];
        }
      }, owner),
    };
    return this.prs.map((_, index) => this.#link(index, by));
  }

  /** The link from the pull request at `index` to the one below it, by the first rule that applies. */
  #link(index: number, by: Lookups): Edge | undefined {
    const pr = this.#pr(index);
    // The nearest lower position that's still there, skipping closed layers and any not passed.
    const nativeStack = (): number | undefined => {
      const entry = pr.nativeStack;
      if (!entry) return undefined;
      const positions = by.position.get(entry.stack) ?? [];
      return positions.findLast(([position]) => position < entry.position)?.[1];
    };
    // An open pull request's base branch only leads to a merged one while it still points where
    // that one merged from. Once it moves on, like a long-lived `develop`, it's a root. A merged
    // pull request's base branch has moved on by merging it, so links between merged ones skip the
    // check.
    const baseBranch = (): number | undefined => {
      const below = by.headRef.get(pr.baseRef);
      if (below === undefined || below === index) return undefined;
      const lower = this.#pr(below);
      const unmoved = pr.baseTip !== undefined && pr.baseTip === lower.headOid;
      return isOpen(lower) || !isOpen(pr) || unmoved ? below : undefined;
    };
    // The nearest: the latest of its commits that another pull request matches. One with the same
    // head commit isn't below it.
    const sharedCommits = (): number | undefined => {
      for (const oid of pr.commits.toReversed()) {
        if (oid === pr.headOid) continue;
        const below = by.commit.get(oid);
        if (below !== undefined && below !== index) return below;
      }
      return undefined;
    };
    const native = nativeStack();
    if (native !== undefined) return { below: native, rule: 'nativeStack' };
    const base = baseBranch();
    if (base !== undefined) return { below: base, rule: 'baseBranch' };
    const shared = sharedCommits();
    return shared === undefined ? undefined : { below: shared, rule: 'sharedCommits' };
  }

  /**
   * Where the open pull request at `index` sits. When its link reaches a merged one, it sits where
   * that one would, following links down to an open pull request or a root branch.
   */
  place(
    index: number,
    links: readonly (Edge | undefined)[],
    landings: (Landing | undefined)[],
  ): Placed {
    const pr = this.#pr(index);
    const edge = links[index];
    if (!edge) {
      return {
        pr,
        parent: { kind: 'branch', branch: pr.baseRef },
        rule: undefined,
        needsRebase: undefined,
        retargetTo: undefined,
      };
    }
    const { parent, base, squashed } = this.#land(edge.below, links, landings);
    const retargetTo = base !== undefined && base !== pr.baseRef ? base : undefined;
    // GitHub rebases a stack's layers itself when a lower one merges.
    const merged = this.#pr(edge.below);
    let needsRebase: NeedsRebase | undefined;
    if (squashed && edge.rule !== 'nativeStack') {
      const listed = new Set(pr.commits);
      const compareAgainst = merged.commits.findLast((oid) => listed.has(oid)) ?? merged.headOid;
      needsRebase = { merged: merged.number, compareAgainst };
    }
    return { pr, parent, rule: edge.rule, needsRebase, retargetTo };
  }

  /**
   * Where a layer on the pull request at `start` sits: on that one if it's open, or where following
   * links down from it through merged ones lands. Remembers the landing of every merged one on the
   * way in `landings`, so each chain of merged pull requests is walked once.
   */
  #land(
    start: number,
    links: readonly (Edge | undefined)[],
    landings: (Landing | undefined)[],
  ): Landing {
    const path: number[] = [];
    let next = start;
    let landing: Landing;
    // `breakCycles` has run, so this ends.
    for (;;) {
      const known = landings[next];
      if (known) {
        landing = known;
        break;
      }
      const below = this.#pr(next);
      if (isOpen(below)) {
        landing = {
          parent: { kind: 'pr', number: below.number },
          base: below.headInBaseRepo ? below.headRef : undefined,
          squashed: false,
        };
        break;
      }
      path.push(next);
      const link = links[next];
      if (!link) {
        landing = {
          parent: { kind: 'branch', branch: below.baseRef },
          base: below.baseRef,
          squashed: false,
        };
        break;
      }
      next = link.below;
    }
    for (const merged of path.toReversed()) {
      landing = { ...landing, squashed: landing.squashed || isSquashed(this.#pr(merged)) };
      landings[merged] = landing;
    }
    return landing;
  }

  /** Breaks each cycle in `links` by dropping one link, and returns the cycles. */
  breakCycles(links: (Edge | undefined)[]): Cycle[] {
    const UNSEEN = 0;
    const ON_PATH = 1;
    const DONE = 2;
    const visits: number[] = links.map(() => UNSEEN);
    const cycles: Cycle[] = [];
    for (let start = 0; start < links.length; start++) {
      const path: number[] = [];
      // Each pull request has at most one link, so follow it until it reaches one seen before.
      for (let index: number | undefined = start; index !== undefined;) {
        const visit = visits[index];
        if (visit === UNSEEN) {
          visits[index] = ON_PATH;
          path.push(index);
          index = links[index]?.below;
          continue;
        }
        if (visit === ON_PATH)
          cycles.push(...this.#breakCycle(path.slice(path.lastIndexOf(index)), links));
        break;
      }
      for (const index of path) visits[index] = DONE;
    }
    return cycles.toSorted((a, b) => (a.prs[0] ?? 0) - (b.prs[0] ?? 0));
  }

  /**
   * Breaks the cycle `cycle`, its pull requests' indexes in link order, dropping an open one's link
   * if there's one, so that pull request sits on its own base branch rather than on a merged one's.
   * Returns it, unless it holds no open pull request.
   */
  #breakCycle(cycle: readonly number[], links: (Edge | undefined)[]): Cycle[] {
    const isOpenAt = (at: number) => isOpen(this.#pr(cycle[at] ?? -1));
    const anyOpen = cycle.some((_, at) => isOpenAt(at));
    // The weakest link: the weakest rule, then the oldest pull request, then the lowest number.
    let weakest = 0;
    let weakestKey: [number, number, number] | undefined;
    cycle.forEach((index, at) => {
      if (!isOpenAt(at) && anyOpen) return;
      const pr = this.#pr(index);
      const rule = links[index]?.rule;
      const key: [number, number, number] = [
        rule === undefined ? -1 : RULES.indexOf(rule),
        -pr.createdAt,
        -pr.number,
      ];
      const stronger =
        weakestKey === undefined ||
        key[0] > weakestKey[0] ||
        (key[0] === weakestKey[0] &&
          (key[1] > weakestKey[1] || (key[1] === weakestKey[1] && key[2] >= weakestKey[2])));
      if (stronger) {
        weakest = at;
        weakestKey = key;
      }
    });
    const dropped = cycle[weakest];
    if (dropped !== undefined) links[dropped] = undefined;
    const prs = [...cycle.slice(weakest), ...cycle.slice(0, weakest)]
      .map((index) => this.#pr(index))
      .filter(isOpen)
      .map((pr) => pr.number);
    return prs.length > 0 ? [{ prs }] : [];
  }

  /**
   * Indexes the pull requests that can be below another by their `keys`. Where several share a key,
   * keeps the one `prefer` picks.
   */
  #index<K>(
    keys: (pr: PullRequest) => readonly K[],
    prefer: (pr: PullRequest, other: PullRequest) => boolean,
  ): Map<K, number> {
    const index = new Map<K, number>();
    this.prs.forEach((pr, at) => {
      const fromTrunk = pr.headInBaseRepo && this.#trunks.has(pr.headRef);
      if (fromTrunk) return;
      for (const key of keys(pr)) {
        const best = index.get(key);
        if (best === undefined || prefer(pr, this.#pr(best))) index.set(key, at);
      }
    });
    return index;
  }
}

/** Compares two tuples of numbers in order. */
function compareRanks(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < a.length; i++) {
    const difference = (a[i] ?? 0) - (b[i] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

/** Whether a rule links to `pr` rather than `other`: an open pull request before a merged one, then the newest. */
function newest(pr: PullRequest, other: PullRequest): boolean {
  const rank = (of: PullRequest) => [isOpen(of) ? 1 : 0, of.createdAt, of.number];
  return compareRanks(rank(pr), rank(other)) > 0;
}

/**
 * Whether a commit both list belongs to `pr` rather than `other`: an open pull request's head
 * before a merged one's commit, then the newest open one, or the oldest merged one, which brought
 * the commit in. A merged pull request stacked on another by commits lists the lower one's commits
 * too.
 */
function owner(pr: PullRequest, other: PullRequest): boolean {
  const age = (of: PullRequest) => [of.createdAt, of.number];
  if (isOpen(pr) !== isOpen(other)) return isOpen(pr);
  const older = compareRanks(age(pr), age(other));
  return isOpen(pr) ? older > 0 : older < 0;
}
