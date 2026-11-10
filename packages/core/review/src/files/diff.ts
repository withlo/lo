/**
 * A line diff: which lines of one text became which lines of another, by histogram diff, as git's
 * `--histogram` computes it.
 */

/** A run of lines, from `start` up to but not including `end`. */
export interface LineRange {
  readonly start: number;
  readonly end: number;
}

/** One change: the lines `before` covers became the lines `after` covers. Either may be empty. */
export interface Hunk {
  readonly before: LineRange;
  readonly after: LineRange;
}

/**
 * The hunks that turn `before` into `after`, in order, comparing whole lines.
 *
 * Histogram diff anchors each region on the longest run of lines the two sides share whose lines
 * are the rarest, so it lines up unique lines such as declarations rather than braces and blank
 * lines. Where every line the two sides share repeats more than 63 times, it falls back to Myers's
 * algorithm, which stays fast on such repetitive text.
 */
export function diffLines(before: readonly string[], after: readonly string[]): Hunk[] {
  // Each distinct line as a number, so comparing two lines is comparing two numbers.
  const ids = new Map<string, number>();
  const intern = (line: string): number => {
    let id = ids.get(line);
    if (id === undefined) {
      id = ids.size;
      ids.set(line, id);
    }
    return id;
  };
  const a = Int32Array.from(before, intern);
  const b = Int32Array.from(after, intern);
  const changes: Changes = {
    a,
    b,
    removed: new Uint8Array(a.length),
    added: new Uint8Array(b.length),
  };

  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let aEnd = a.length;
  let bEnd = b.length;
  while (aEnd > start && bEnd > start && a[aEnd - 1] === b[bEnd - 1]) {
    aEnd--;
    bEnd--;
  }
  histogram(changes, { aStart: start, aEnd, bStart: start, bEnd }, ids.size);
  return hunks(changes.removed, changes.added);
}

/** Both sides as line numbers, and which of their lines changed: 1 for changed, 0 for not. */
interface Changes {
  readonly a: Int32Array;
  readonly b: Int32Array;
  readonly removed: Uint8Array;
  readonly added: Uint8Array;
}

/** A region of both sides still to compare: `a`'s lines `aStart` to `aEnd`, and `b`'s. */
interface Region {
  readonly aStart: number;
  readonly aEnd: number;
  readonly bStart: number;
  readonly bEnd: number;
}

/** A run of lines the two sides share: `length` lines from `aStart` in `a` and `bStart` in `b`. */
interface Run {
  readonly aStart: number;
  readonly bStart: number;
  readonly length: number;
}

/** Lines that repeat more often than this in a region don't anchor it. */
const MAX_OCCURRENCES = 63;

/**
 * Marks the lines of `whole` that change, with histogram diff. `lines` is how many distinct lines
 * there are.
 */
function histogram(changes: Changes, whole: Region, lines: number): void {
  // Where each line occurs in the region being compared, reused from region to region.
  const occurrences: number[][] = Array.from({ length: lines }, () => []);
  // Regions left of an anchor wait here; the region right of it is compared at once.
  const regions: Region[] = [whole];
  for (let region = regions.pop(); region !== undefined; region = regions.pop()) {
    let { aStart, bStart } = region;
    const { aEnd, bEnd } = region;
    for (;;) {
      if (aStart === aEnd) {
        changes.added.fill(1, bStart, bEnd);
        break;
      }
      if (bStart === bEnd) {
        changes.removed.fill(1, aStart, aEnd);
        break;
      }
      const current = { aStart, aEnd, bStart, bEnd };
      const run = rarestRun(changes, current, occurrences);
      if (run === undefined) {
        myers(changes, current);
        break;
      }
      if (run.length === 0) {
        changes.removed.fill(1, aStart, aEnd);
        changes.added.fill(1, bStart, bEnd);
        break;
      }
      regions.push({ aStart, aEnd: run.aStart, bStart, bEnd: run.bStart });
      aStart = run.aStart + run.length;
      bStart = run.bStart + run.length;
    }
  }
}

/**
 * The run of shared lines to anchor `region` on, as git's histogram diff picks it: the longest of
 * the runs whose rarest line occurs fewest times in `a`. An empty run when the two sides share no
 * line, and nothing when every line they share repeats too often.
 */
function rarestRun(
  { a, b }: Changes,
  { aStart, aEnd, bStart, bEnd }: Region,
  occurrences: readonly number[][],
): Run | undefined {
  for (let at = aStart; at < aEnd; at++) occurrences[lineAt(a, at)]?.push(at);
  const count = (id: number): number => occurrences[id]?.length ?? 0;

  let best: Run = { aStart: 0, bStart: 0, length: 0 };
  let fewest = MAX_OCCURRENCES + 1;
  let shared = false;
  let atB = bStart;
  while (atB < bEnd) {
    const id = lineAt(b, atB);
    const places = occurrences[id] ?? [];
    if (places.length === 0 || places.length > fewest) {
      shared ||= places.length > 0;
      atB++;
      continue;
    }
    shared = true;
    let next = atB + 1;
    // Each place the line occurs in `a`, extended both ways for as long as the sides agree.
    for (let place = 0; place < places.length;) {
      const atA = places[place] ?? aEnd;
      let rarity = places.length;
      let startA = atA;
      let startB = atB;
      while (startA > aStart && startB > bStart && a[startA - 1] === b[startB - 1]) {
        startA--;
        startB--;
        rarity = Math.min(rarity, count(lineAt(a, startA)));
      }
      let endA = atA + 1;
      let endB = atB + 1;
      while (endA < aEnd && endB < bEnd && a[endA] === b[endB]) {
        rarity = Math.min(rarity, count(lineAt(a, endA)));
        endA++;
        endB++;
      }
      next = Math.max(next, endB);
      const length = endB - startB;
      if (best.length < length || fewest > rarity) {
        fewest = rarity;
        best = { aStart: startA, bStart: startB, length };
      }
      // The line's next place in `a` past this run.
      place++;
      while (place < places.length && (places[place] ?? aEnd) < endA) place++;
    }
    atB = next;
  }

  for (let at = aStart; at < aEnd; at++) {
    const places = occurrences[lineAt(a, at)];
    if (places !== undefined) places.length = 0;
  }
  return shared && fewest > MAX_OCCURRENCES ? undefined : best;
}

/** Marks the lines of `whole` that change, with Myers's algorithm, in linear space. */
function myers(changes: Changes, whole: Region): void {
  const { a, b, removed, added } = changes;
  const regions: Region[] = [whole];
  for (let region = regions.pop(); region !== undefined; region = regions.pop()) {
    let { aStart, aEnd, bStart, bEnd } = region;
    while (aStart < aEnd && bStart < bEnd && a[aStart] === b[bStart]) {
      aStart++;
      bStart++;
    }
    while (aStart < aEnd && bStart < bEnd && a[aEnd - 1] === b[bEnd - 1]) {
      aEnd--;
      bEnd--;
    }
    if (aStart === aEnd) {
      added.fill(1, bStart, bEnd);
      continue;
    }
    if (bStart === bEnd) {
      removed.fill(1, aStart, aEnd);
      continue;
    }
    const split = middle(changes, { aStart, aEnd, bStart, bEnd });
    if (split === undefined) {
      removed.fill(1, aStart, aEnd);
      added.fill(1, bStart, bEnd);
      continue;
    }
    regions.push(
      { aStart, aEnd: split.a, bStart, bEnd: split.b },
      { aStart: split.a, aEnd, bStart: split.b, bEnd },
    );
  }
}

/**
 * Where to split `region` so that diffing each half gives a shortest diff of the whole: the end of
 * the middle snake, found by searching forward from the start and backward from the end until the
 * two meet. Nothing when the two sides share no line.
 *
 * Past a cost of `max(256, √(lines))` it gives up on the shortest diff and splits at the furthest
 * point the forward search reached, so that very different repetitive text stays fast.
 */
function middle(
  { a, b }: Changes,
  { aStart, aEnd, bStart, bEnd }: Region,
): { a: number; b: number } | undefined {
  const n = aEnd - aStart;
  const m = bEnd - bStart;
  const most = Math.ceil((n + m) / 2);
  const offset = most + 1;
  const size = 2 * most + 3;
  // The furthest x reached on each diagonal k = x - y, forward and backward from the end.
  const forward = new Int32Array(size).fill(-1);
  const backward = new Int32Array(size).fill(-1);
  forward[offset + 1] = 0;
  backward[offset + 1] = 0;
  const delta = n - m;
  const odd = (delta & 1) !== 0;
  const cost = Math.max(256, Math.floor(Math.sqrt(n + m)));
  let [forwardStart, forwardEnd, backwardStart, backwardEnd] = [0, 0, 0, 0];
  let furthest: { a: number; b: number } | undefined;
  let furthestReach = 0;

  for (let d = 0; d < most; d++) {
    if (d > cost) return furthest;
    for (let k = -d + forwardStart; k <= d - forwardEnd; k += 2) {
      const at = offset + k;
      let x =
        k === -d || (k !== d && reach(forward, at - 1) < reach(forward, at + 1))
          ? reach(forward, at + 1)
          : reach(forward, at - 1) + 1;
      let y = x - k;
      while (x < n && y < m && a[aStart + x] === b[bStart + y]) {
        x++;
        y++;
      }
      forward[at] = x;
      if (x > n) {
        forwardEnd += 2;
      } else if (y > m) {
        forwardStart += 2;
      } else {
        if (x + y > furthestReach && x + y < n + m) {
          furthest = { a: aStart + x, b: bStart + y };
          furthestReach = x + y;
        }
        const other = offset + delta - k;
        if (odd && reach(backward, other) !== -1 && x >= n - reach(backward, other)) {
          return { a: aStart + x, b: bStart + y };
        }
      }
    }
    for (let k = -d + backwardStart; k <= d - backwardEnd; k += 2) {
      const at = offset + k;
      let x =
        k === -d || (k !== d && reach(backward, at - 1) < reach(backward, at + 1))
          ? reach(backward, at + 1)
          : reach(backward, at - 1) + 1;
      let y = x - k;
      while (x < n && y < m && a[aEnd - 1 - x] === b[bEnd - 1 - y]) {
        x++;
        y++;
      }
      backward[at] = x;
      if (x > n) {
        backwardEnd += 2;
      } else if (y > m) {
        backwardStart += 2;
      } else {
        const other = offset + delta - k;
        const forwardX = reach(forward, other);
        if (!odd && forwardX !== -1 && forwardX >= n - x) {
          return { a: aStart + forwardX, b: bStart + forwardX - (delta - k) };
        }
      }
    }
  }
  return undefined;
}

/** The furthest x a search reached on a diagonal, or -1 where it hasn't been. */
function reach(diagonals: Int32Array, at: number): number {
  return diagonals[at] ?? -1;
}

/** The line at `at`, as its number. */
function lineAt(lines: Int32Array, at: number): number {
  return lines[at] ?? -1;
}

/** The changes as hunks: each run of changed lines on either side between two unchanged ones. */
function hunks(removed: Uint8Array, added: Uint8Array): Hunk[] {
  const found: Hunk[] = [];
  let atA = 0;
  let atB = 0;
  while (atA < removed.length || atB < added.length) {
    const before = atA;
    const after = atB;
    while (atA < removed.length && removed[atA] === 1) atA++;
    while (atB < added.length && added[atB] === 1) atB++;
    if (atA > before || atB > after) {
      found.push({ before: { start: before, end: atA }, after: { start: after, end: atB } });
    }
    // Past the unchanged line each side has next, which are the same line.
    atA++;
    atB++;
  }
  return found;
}
