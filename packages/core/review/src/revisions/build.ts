/** Merging what each source saw into one ordered list of revisions. */

import {
  Revisions,
  SOURCES,
  type PushedAt,
  type PushRecord,
  type Revision,
  type Source,
} from '../revisions.ts';
import { sha } from './sha.ts';

/**
 * Merges push records from every source into the pull request's revisions, one per head SHA.
 *
 * `commits` are the pull request's current commits from git, as `git rev-list --topo-order
 * --reverse <base>..<head>` lists them: oldest first, each after its parents. Until the local copy
 * has them, pass none, not GitHub's commit list, which stops at 250. `head` is the pull request's
 * current head (`headRefOid`), which is always the latest revision, even when no source saw it or
 * a source's time says otherwise. `openedAt` is when the pull request opened (`createdAt`).
 *
 * - **Starting where the pull request opened.** The first revision is the head when the pull
 *   request opened: the newest head pushed at or before `openedAt`. Older heads were pushed before
 *   the pull request existed and aren't revisions.
 * - **Deduplicated by head.** A head several sources saw is one revision, listing them all. A head
 *   pushed twice (`a` → `b` → `a`) is one revision, placed at its latest push.
 * - **Ordered by the push chain, ancestry and time.** A head comes after the head its push
 *   replaced, and among the current commits, after its ancestors. Times order the rest. Times from
 *   the activity API, or else a force-push event, are exact. A review, check suite or the poller
 *   only says the head was pushed by then, and so does a later head's push, which places a head no
 *   source dated, such as a force-push's `before`, just before the push that replaced it. Heads
 *   outside the current commits come before the latest force-push when its head is in them, since
 *   every push after it was then a fast-forward. Where these constraints loop because a head was
 *   pushed again, the heads in the loop go by their own times, whatever order the records came in.
 * - **Previous head and forced.** The activity API is trusted first, then force-push events, then
 *   check suites, though a push that creates the branch says nothing about forcing. A check suite
 *   names the previous head only when its previous SHA is a head another record names or a current
 *   commit, and the earliest such suite does. With no source's word, the previous head is the
 *   revision before, and ancestry in the current commits tells whether the push was forced when it
 *   can. A branch re-created after a revision counts as forced unless ancestry says otherwise.
 */
export function buildRevisions(
  records: readonly PushRecord[],
  commits: readonly string[],
  head: string,
  openedAt: number,
): Revisions {
  const heads = new Heads();
  for (const record of records) heads.add(record);
  heads.see(head, 'head');
  const pullHead = heads.indexOf(sha(head));

  const positions = new Map<string, number>();
  for (const [position, commit] of commits.entries()) {
    if (!positions.has(commit)) positions.set(commit, position);
  }
  heads.chooseCheckSuites(positions);
  const after = successors(heads, positions, pullHead);
  const components = new Components(after);
  const latest = latestPushTimes(heads.seen, after, components);
  let order = revisionOrder(latest, after, components);
  if (pullHead !== undefined) {
    order = order.filter((index) => index !== pullHead);
    order.push(pullHead);
  }
  const pushedByOpening = (index: number): boolean => {
    const at = latest[index];
    return at !== undefined && at <= openedAt;
  };
  const first = order.findLastIndex(pushedByOpening);
  if (first > 0) order = order.slice(first);

  const list = order.map((index, position): Revision => {
    const seen = heads.at(index);
    const before = position > 0 ? heads.at(order[position - 1] ?? index).head : undefined;
    const previous = seen.previous() ?? before;
    const forced =
      seen.forced() ??
      (previous === undefined
        ? undefined
        : forcedByAncestry(previous, seen.head, positions, heads)) ??
      (seen.recreated() && previous !== undefined ? true : undefined);
    const exact = seen.exact();
    const by = latest[index];
    const pushedAt: PushedAt =
      exact !== undefined
        ? { kind: 'exact', at: exact }
        : by !== undefined
          ? { kind: 'by', at: by }
          : { kind: 'unknown' };
    return {
      head: seen.head,
      previous,
      forced,
      pushedAt,
      sources: SOURCES.filter((source) => seen.sources.has(source)),
      available: true,
    };
  });
  return new Revisions(list);
}

/**
 * Whether the push from `previous` to `head` was forced, as far as the current commits tell. A push
 * from an ancestor wasn't. A push back to an ancestor was, and so was a push over a revision that's
 * no longer in the current commits, since that one can't be the new head's ancestor.
 */
function forcedByAncestry(
  previous: string,
  head: string,
  positions: ReadonlyMap<string, number>,
  heads: Heads,
): boolean | undefined {
  const at = positions.get(head);
  if (at === undefined) return undefined;
  const previousAt = positions.get(previous);
  if (previousAt !== undefined) return previousAt === at ? undefined : previousAt > at;
  return heads.indexOf(previous) === undefined ? undefined : true;
}

/**
 * The heads that must come after each head, by index, in ascending order: the heads whose push
 * replaced it, its nearest descendant among the heads in the current commits, and, for a head
 * outside them, the latest force-push when its head is in them. Nothing comes after the pull
 * request's head.
 */
function successors(
  heads: Heads,
  positions: ReadonlyMap<string, number>,
  pullHead: number | undefined,
): number[][] {
  const after = heads.seen.map(() => new Set<number>());
  const precedes = (earlier: number, later: number): void => {
    if (earlier !== later && earlier !== pullHead) after[earlier]?.add(later);
  };
  for (const [index, head] of heads.seen.entries()) {
    const previous = heads.indexOf(head.previous());
    if (previous !== undefined) precedes(previous, index);
  }
  const current: { position: number; index: number }[] = [];
  for (const [index, head] of heads.seen.entries()) {
    const position = positions.get(head.head);
    if (position !== undefined) current.push({ position, index });
  }
  const ordered = current.toSorted((a, b) => a.position - b.position || a.index - b.index);
  // A head pushed back to from its own descendant was pushed after it, so its place among the
  // current commits says nothing about when.
  const pushedBack = (index: number): boolean => {
    const head = heads.at(index);
    const previous = head.previous();
    const previousAt = previous === undefined ? undefined : positions.get(previous);
    const at = positions.get(head.head);
    return previousAt !== undefined && (at === undefined || previousAt > at);
  };
  for (let pair = 1; pair < ordered.length; pair++) {
    const [earlier, later] = [ordered[pair - 1], ordered[pair]];
    if (earlier && later && !pushedBack(earlier.index)) precedes(earlier.index, later.index);
  }
  // When the latest force-push's head is a current commit, every push since was a fast-forward, so
  // a head outside the current commits was pushed before it.
  const forced = latestForcePush(heads.seen);
  if (forced !== undefined && positions.has(heads.at(forced).head)) {
    for (const [index, head] of heads.seen.entries()) {
      if (!positions.has(head.head)) precedes(index, forced);
    }
  }
  return after.map((later) => [...later].toSorted((a, b) => a - b));
}

/** The head of the latest push the activity API or a force-push event says was forced. */
function latestForcePush(seen: readonly Seen[]): number | undefined {
  let latest: { at: number; index: number } | undefined;
  for (const [index, head] of seen.entries()) {
    const push = (head.activity?.forced === true ? head.activity : undefined) ?? head.forcePush;
    // Ties go to the head the records named last.
    if (push && (latest === undefined || push.at >= latest.at)) latest = { at: push.at, index };
  }
  return latest?.index;
}

/**
 * The strongly connected components of the heads under the constraints: sets of heads whose
 * constraints loop, which happens when a head was pushed again.
 */
class Components {
  /** Each component's heads. A component comes before every component with a constraint to it. */
  readonly members: number[][] = [];
  /** Each head's component. */
  readonly of: Int32Array;

  /** Tarjan's algorithm, without recursion so that long histories can't overflow the stack. */
  constructor(after: readonly (readonly number[])[]) {
    const unseen = -1;
    const count = after.length;
    const found = new Int32Array(count).fill(unseen);
    const low = new Int32Array(count);
    const onStack = new Uint8Array(count);
    const stack: number[] = [];
    let nextFound = 0;
    const visit = (head: number): void => {
      found[head] = nextFound;
      low[head] = nextFound;
      nextFound++;
      stack.push(head);
      onStack[head] = 1;
    };
    for (let root = 0; root < count; root++) {
      if (found[root] !== unseen) continue;
      visit(root);
      // Each head being visited, and how many of its successors it has gone through.
      const frames = [{ head: root, next: 0 }];
      for (let frame = frames.at(-1); frame !== undefined; frame = frames.at(-1)) {
        const { head } = frame;
        const next = after[head]?.[frame.next];
        if (next !== undefined) {
          frame.next++;
          if (found[next] === unseen) {
            visit(next);
            frames.push({ head: next, next: 0 });
          } else if (onStack[next] === 1) {
            low[head] = Math.min(low[head]!, found[next]!);
          }
          continue;
        }
        frames.pop();
        const parent = frames.at(-1);
        if (parent) low[parent.head] = Math.min(low[parent.head]!, low[head]!);
        if (low[head] === found[head]) {
          const component: number[] = [];
          for (let member = stack.pop(); member !== undefined; member = stack.pop()) {
            onStack[member] = 0;
            component.push(member);
            if (member === head) break;
          }
          this.members.push(component);
        }
      }
    }
    this.of = new Int32Array(count);
    for (const [component, heads] of this.members.entries()) {
      for (const head of heads) this.of[head] = component;
    }
  }
}

/**
 * The latest each head can have been pushed: its exact time, or else the earliest of its sightings
 * and the times of the heads that must come after it. Missing when nothing bounds it.
 *
 * Constraints inside a loop don't carry times: one of them is wrong, and which one depends on the
 * times themselves.
 */
function latestPushTimes(
  seen: readonly Seen[],
  after: readonly (readonly number[])[],
  components: Components,
): (number | undefined)[] {
  const latest = seen.map((head) => head.exact() ?? head.seenBy);
  // A component comes before every component with a constraint to it, so a head's successors in
  // other components already have their times when it's reached: one pass is enough.
  for (const heads of components.members) {
    for (const index of heads) {
      if (seen[index]?.exact() !== undefined) continue;
      for (const next of after[index] ?? []) {
        const by = latest[next];
        if (components.of[next] === components.of[index] || by === undefined) continue;
        const own = latest[index];
        if (own === undefined || by < own) latest[index] = by;
      }
    }
  }
  return latest;
}

/**
 * The heads in revision order: each after the heads that must come before it, the earliest first.
 * Heads nothing bounds go last, and ties keep the order the records first named them in. A loop's
 * heads go together, ordered by their times without the loop's own constraints, and ties among
 * them again in the order the records first named them.
 */
function revisionOrder(
  latest: readonly (number | undefined)[],
  after: readonly (readonly number[])[],
  components: Components,
): number[] {
  /** Whether head `a` ranks before head `b`: dated before undated, then by time, then by index. */
  const before = (a: number, b: number): number => {
    const [x, y] = [latest[a], latest[b]];
    if (x === undefined || y === undefined) {
      if (x !== y) return x === undefined ? 1 : -1;
    } else if (x !== y) {
      return x - y;
    }
    return a - b;
  };
  const members = components.members.map((heads) => heads.toSorted(before));
  const waitingOn = new Int32Array(members.length);
  for (const [index, later] of after.entries()) {
    for (const next of later) {
      if (components.of[next] !== components.of[index]) waitingOn[components.of[next]!]!++;
    }
  }
  // Components ready to place, earliest first: a component ranks as its earliest head.
  const ready = new Heap<number>((a, b) => before(members[a]![0]!, members[b]![0]!));
  for (let component = 0; component < members.length; component++) {
    if (waitingOn[component] === 0) ready.push(component);
  }
  const order: number[] = [];
  for (let component = ready.pop(); component !== undefined; component = ready.pop()) {
    for (const index of members[component] ?? []) {
      order.push(index);
      for (const next of after[index] ?? []) {
        const later = components.of[next]!;
        if (later === component) continue;
        waitingOn[later]!--;
        if (waitingOn[later] === 0) ready.push(later);
      }
    }
  }
  return order;
}

/** A binary heap: `pop` takes the item `compare` ranks first. */
class Heap<T> {
  readonly #items: T[] = [];
  readonly #compare: (a: T, b: T) => number;

  constructor(compare: (a: T, b: T) => number) {
    this.#compare = compare;
  }

  push(item: T): void {
    const items = this.#items;
    items.push(item);
    for (let at = items.length - 1; at > 0;) {
      const parent = (at - 1) >> 1;
      if (this.#compare(items[at]!, items[parent]!) >= 0) break;
      [items[at], items[parent]] = [items[parent]!, items[at]!];
      at = parent;
    }
  }

  pop(): T | undefined {
    const items = this.#items;
    const top = items[0];
    const last = items.pop();
    if (items.length === 0 || last === undefined) return top;
    items[0] = last;
    for (let at = 0; ;) {
      const [left, right] = [2 * at + 1, 2 * at + 2];
      let first = at;
      if (left < items.length && this.#compare(items[left]!, items[first]!) < 0) first = left;
      if (right < items.length && this.#compare(items[right]!, items[first]!) < 0) first = right;
      if (first === at) break;
      [items[at], items[first]] = [items[first]!, items[at]!];
      at = first;
    }
    return top;
  }
}

/** Every head the records name, in the order they first name them. */
class Heads {
  readonly seen: Seen[] = [];
  readonly #index = new Map<string, number>();

  add(record: PushRecord): void {
    switch (record.kind) {
      case 'activity': {
        const head = this.see(record.after, 'activity');
        if (head) {
          // A push that creates the branch has no head before it to be forced over.
          const created = sha(record.before) === undefined;
          const forced = created ? undefined : record.forced;
          head.activity = latestOf(head.activity, pushed(record.at, record.before, forced));
        }
        return;
      }
      case 'forcePush': {
        const head = this.see(record.after, 'forcePush');
        if (head) head.forcePush = latestOf(head.forcePush, pushed(record.at, record.before, true));
        // The head a force-push replaced was a revision too. An activity entry's head before is
        // always another entry's head, except for the first.
        if (record.before !== undefined) this.see(record.before, 'forcePush');
        return;
      }
      case 'checkSuite': {
        const head = this.see(record.next, 'checkSuite');
        if (head) {
          head.checkSuites.push(pushed(record.at, record.previous, undefined));
          head.sighted(record.at);
        }
        return;
      }
      case 'review':
      case 'reviewedCommit':
        this.see(record.commit, record.kind)?.sighted(record.at);
        return;
      case 'polled':
        this.see(record.head, 'poller')?.sighted(record.at);
        return;
      default:
        record satisfies never;
    }
  }

  /**
   * Picks the check suite that names each head's previous head: the earliest whose previous SHA is
   * a head another record names or a current commit. A suite for the same commit pushed to another
   * branch, such as a backport, names that branch's head instead. The previous heads the chosen
   * suites name are revisions too.
   */
  chooseCheckSuites(positions: ReadonlyMap<string, number>): void {
    const known = (commit: string): boolean => this.#index.has(commit) || positions.has(commit);
    for (const head of this.seen) {
      let chosen: Push | undefined;
      for (const suite of head.checkSuites) {
        // Ties go to the suite the records named first.
        if (
          suite.before !== undefined &&
          known(suite.before) &&
          !(chosen && chosen.at <= suite.at)
        ) {
          chosen = suite;
        }
      }
      head.checkSuite = chosen;
    }
    const previous = this.seen.flatMap((head) => head.checkSuite?.before ?? []);
    for (const head of previous) this.see(head, 'checkSuite');
  }

  /** The head's entry, noting that `source` saw it. Nothing for the all-zero SHA. */
  see(commit: string, source: Source): Seen | undefined {
    const head = sha(commit);
    if (head === undefined) return undefined;
    let index = this.#index.get(head);
    if (index === undefined) {
      index = this.seen.length;
      this.seen.push(new Seen(head));
      this.#index.set(head, index);
    }
    const seen = this.at(index);
    seen.sources.add(source);
    return seen;
  }

  /** The index of the head with this SHA. */
  indexOf(head: string | undefined): number | undefined {
    return head === undefined ? undefined : this.#index.get(head);
  }

  /** The head at `index`, which must be one. */
  at(index: number): Seen {
    const seen = this.seen[index];
    if (seen === undefined) throw new RangeError(`no head at ${index}`);
    return seen;
  }
}

/** A push of a head, as one source reported it. */
interface Push {
  at: number;
  /** The head it replaced. */
  before: string | undefined;
  forced: boolean | undefined;
}

function pushed(at: number, before: string | undefined, forced: boolean | undefined): Push {
  return { at, before: sha(before), forced };
}

/** The later of two pushes of a head, the newer on a tie: a revision stands for its head's latest push. */
function latestOf(kept: Push | undefined, next: Push): Push {
  return kept === undefined || next.at >= kept.at ? next : kept;
}

/** What the sources saw of one head. */
class Seen {
  readonly head: string;
  readonly sources = new Set<Source>();
  /** The head's latest push in the activity API. */
  activity: Push | undefined;
  /** The latest force-push to the head. */
  forcePush: Push | undefined;
  /** Every check suite the head's push started. */
  readonly checkSuites: Push[] = [];
  /** The check suite that names the previous head, once chosen. */
  checkSuite: Push | undefined;
  /** The earliest a review, check suite or the poller saw the head. */
  seenBy: number | undefined;

  constructor(head: string) {
    this.head = head;
  }

  sighted(at: number): void {
    if (this.seenBy === undefined || at < this.seenBy) this.seenBy = at;
  }

  /** The pushes sources reported, most trusted first. */
  #reported(): Push[] {
    return [this.activity, this.forcePush, this.checkSuite].filter((push) => push !== undefined);
  }

  /** The push's exact time: the activity API's, or else a force-push event's. */
  exact(): number | undefined {
    return (this.activity ?? this.forcePush)?.at;
  }

  previous(): string | undefined {
    return this.#reported().find((push) => push.before !== undefined)?.before;
  }

  forced(): boolean | undefined {
    return this.#reported().find((push) => push.forced !== undefined)?.forced;
  }

  /**
   * Whether the activity API says the push created the branch, which is a re-creation when a
   * revision came before it.
   */
  recreated(): boolean {
    return this.activity !== undefined && this.activity.before === undefined;
  }
}
